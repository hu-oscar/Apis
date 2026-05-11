"""WebSocket listener — subscribes to apis_program logs on devnet, decodes
emitted events, and (for JobCreated events targeting our Provider PDA) runs
the full job pipeline: accept_job → inference → IPFS upload →
submit_completion."""

from __future__ import annotations

import asyncio
import base64
import hashlib
import logging

import websockets.exceptions
from solana.rpc.websocket_api import connect
from solders.keypair import Keypair
from solders.pubkey import Pubkey
from solders.rpc.config import RpcTransactionLogsFilterMentions

from .config import APIS_PROGRAM_ID, RPC_WS_URL
from .decoder import EventDecoder, load_event_decoders, try_decode_event
from .heartbeat import heartbeat_loop
from .inference import run_inference
from .ipfs import public_url, upload_png
from .result_channel import store_result
from .spec_channel import lookup_spec
from .submit import accept_job, submit_completion
from .wallet import load_worker_keypair

log = logging.getLogger("apis_worker")

# Anchor's emit! macro prints event payloads as: "Program data: <base64>"
_EMIT_PREFIX = "Program data: "

# Serializes the full job pipeline (accept_job → inference → IPFS upload →
# submit_completion). mflux + Flux Schnell takes ~12-15 GB of unified
# memory per process; running two pipelines concurrently on M3 Pro 18 GB
# thrashes the Metal command queue and slows each by ~5×. This lock keeps
# the worker single-threaded against the GPU; new jobs queue at
# `async with _job_lock` and are processed in arrival order. (Python's
# asyncio.Lock is FIFO since 3.11, which matches what we want.)
_job_lock: asyncio.Lock = asyncio.Lock()


def _find_provider_pda(authority: Pubkey, program_id: Pubkey) -> Pubkey:
    pda, _ = Pubkey.find_program_address(
        [b"provider", bytes(authority)], program_id
    )
    return pda


# Reconnect backoff: 1s → 2s → 4s → 8s → 16s, capped at 30s. Reset on a
# successful subscription. Devnet RPCs drop idle subscriptions on a
# variable schedule, so we re-establish on every error and keep going.
_RECONNECT_INITIAL_BACKOFF_S = 1.0
_RECONNECT_MAX_BACKOFF_S = 30.0


async def listen_for_jobs() -> None:
    """Connect to devnet, subscribe to apis_program logs, decode events,
    and run the full inference pipeline for jobs assigned to us.

    Resilient to WebSocket drops: on `ConnectionClosed*` (devnet RPCs
    routinely drop idle subs after a few minutes) we re-connect and
    re-subscribe with exponential backoff. Inflight `_process_job` tasks
    are unaffected because they're spawned via `asyncio.create_task` and
    do their own RPC over HTTP, not the WS subscription.
    """
    program_id = Pubkey.from_string(APIS_PROGRAM_ID)
    decoders = load_event_decoders()

    worker_keypair = load_worker_keypair()
    our_provider_pda = _find_provider_pda(worker_keypair.pubkey(), program_id)
    our_provider_pda_bytes = bytes(our_provider_pda)

    log.info(
        "loaded %d event decoder(s): %s",
        len(decoders),
        ", ".join(d.name for d in decoders),
    )
    log.info("worker authority:  %s", worker_keypair.pubkey())
    log.info("worker provider:   %s", our_provider_pda)

    # Background liveness heartbeat — runs alongside the WS listener.
    # Posts to ${APIS_API_BASE}/api/heartbeat/<pda> every 30s; the UI
    # reads it for the real "online" indicator. No-op if APIS_API_BASE
    # is unset (local-only dev).
    hb_task = asyncio.create_task(heartbeat_loop(str(our_provider_pda)))

    backoff = _RECONNECT_INITIAL_BACKOFF_S
    while True:
        try:
            log.info("connecting to %s", RPC_WS_URL)
            async with connect(RPC_WS_URL) as ws:
                await ws.logs_subscribe(
                    filter_=RpcTransactionLogsFilterMentions(program_id),
                    commitment="confirmed",
                )
                first = await ws.recv()
                sub_id = first[0].result
                log.info("subscribed (id=%s); waiting for jobs…", sub_id)
                # Successful subscription — reset the backoff so the next
                # disconnect retries quickly.
                backoff = _RECONNECT_INITIAL_BACKOFF_S

                async for batch in ws:
                    for msg in batch:
                        await _handle_log_message(
                            msg, decoders, worker_keypair, our_provider_pda_bytes
                        )
                # `async for` exits cleanly only if the server closed
                # gracefully. Treat as a transient drop + retry.
                log.warning("WS stream ended cleanly; reconnecting…")
        except (
            websockets.exceptions.ConnectionClosed,
            websockets.exceptions.WebSocketException,
            asyncio.IncompleteReadError,
            ConnectionError,
            OSError,
        ) as exc:
            log.warning(
                "WS error (%s: %s); reconnecting in %.1fs",
                type(exc).__name__,
                exc,
                backoff,
            )
        except asyncio.CancelledError:
            log.info("listener cancelled; shutting down")
            hb_task.cancel()
            raise
        await asyncio.sleep(backoff)
        backoff = min(backoff * 2, _RECONNECT_MAX_BACKOFF_S)


async def _handle_log_message(
    msg,
    decoders: list[EventDecoder],
    worker_keypair: Keypair,
    our_provider_pda_bytes: bytes,
) -> None:
    notification = getattr(msg, "result", None)
    if notification is None:
        return
    value = notification.value

    if value.err is not None:
        return

    sig = str(value.signature)
    for line in value.logs or []:
        if not line.startswith(_EMIT_PREFIX):
            continue
        b64 = line[len(_EMIT_PREFIX):]
        try:
            payload = base64.b64decode(b64)
        except Exception:
            log.debug("non-base64 emit payload (skipping)")
            continue

        decoded = try_decode_event(payload, decoders)
        if decoded is None:
            continue
        name, fields = decoded
        log.info(
            "%s  tx=%s…  %s",
            name,
            sig[:8],
            _format_fields(fields),
        )

        # JobCreated targeting our provider → run the pipeline (in the
        # background so we don't block the websocket reader).
        if name == "JobCreated" and fields.get("provider") == our_provider_pda_bytes:
            asyncio.create_task(_process_job(fields, worker_keypair))


async def _process_job(fields: dict, worker_keypair: Keypair) -> None:
    """Run a job from JobCreated → accept → inference → IPFS → submit_completion.

    Errors are logged but don't crash the listener — the job stays in
    Funded/Started state on-chain and the buyer can `cancel_job` after
    the deadline.
    """
    job_pda = Pubkey(fields["job"])
    spec_hash: bytes = fields["spec_hash"]
    log.info("┌── processing job %s", str(job_pda)[:16])

    spec = lookup_spec(spec_hash)
    if spec is None:
        log.warning(
            "│  no off-chain spec for spec_hash=%s; cannot infer. "
            "Buyer must POST the spec to the side-channel before submitting.",
            spec_hash.hex()[:16] + "…",
        )
        return

    prompt = spec.get("prompt")
    if not prompt or not isinstance(prompt, str):
        log.warning("│  spec for %s missing prompt; skip", spec_hash.hex()[:16])
        return

    # Serialize the pipeline: only one job runs at a time on this worker.
    # If another job is mid-flight, new ones queue here in arrival order.
    if _job_lock.locked():
        log.info("│  waiting for GPU lock (another job in flight)…")
    async with _job_lock:
        await _run_pipeline_locked(job_pda, spec, prompt, worker_keypair)


async def _run_pipeline_locked(
    job_pda: Pubkey,
    spec: dict,
    prompt: str,
    worker_keypair: Keypair,
) -> None:
    """Job pipeline. Caller holds `_job_lock`."""
    try:
        # 1. accept_job: Funded → Started
        log.info("│  [1/4] accept_job …")
        await accept_job(job_pda, worker_keypair)

        # 2. Run Flux Schnell on the prompt (sync; offload to thread pool)
        log.info("│  [2/4] flux schnell inference …")
        png_bytes = await asyncio.to_thread(
            run_inference,
            prompt,
            seed=spec.get("seed", 42),
            steps=spec.get("steps", 4),
            width=spec.get("width", 1024),
            height=spec.get("height", 1024),
        )
        proof_hash = hashlib.sha256(png_bytes).digest()
        log.info(
            "│       generated %d bytes; proof_hash=%s…",
            len(png_bytes),
            proof_hash.hex()[:16],
        )

        # 3. Upload to Pinata IPFS
        log.info("│  [3/4] uploading to IPFS …")
        cid = await upload_png(png_bytes, name=f"job-{str(job_pda)[:8]}.png")
        log.info("│       result at %s", public_url(cid))

        # 3a. Publish (cid, proof_hash) to the result side-channel so
        # the buyer's /job/[id] page can render the image once it polls.
        # File written before submit_completion confirms — the page
        # waits on Job.status == Completed anyway, so the result is
        # ready by the time it's needed.
        store_result(str(job_pda), cid, proof_hash)

        # 4. submit_completion: Started → Completed
        log.info("│  [4/4] submit_completion …")
        await submit_completion(job_pda, proof_hash, worker_keypair)

        log.info("└── job %s done.", str(job_pda)[:16])
    except Exception as exc:
        log.exception("│  job %s pipeline failed: %s", str(job_pda)[:16], exc)
        log.info("└──")


def _format_fields(fields: dict) -> str:
    """Compact one-line render: pubkeys → base58 (truncated), bytes → hex,
    everything else → str()."""
    parts: list[str] = []
    for k, v in fields.items():
        if k.startswith("_"):
            parts.append(f"{k}={v}")
        elif isinstance(v, bytes) and len(v) == 32 and k in {
            "job",
            "buyer",
            "provider",
            "authority",
        }:
            parts.append(f"{k}={str(Pubkey(v))[:12]}…")
        elif isinstance(v, bytes):
            parts.append(f"{k}=0x{v.hex()[:16]}…")
        else:
            parts.append(f"{k}={v}")
    return "  ".join(parts)
