"""WebSocket listener — subscribes to apis_program logs on devnet and decodes
each emitted event."""

from __future__ import annotations

import base64
import logging

from solana.rpc.websocket_api import connect
from solders.pubkey import Pubkey
from solders.rpc.config import RpcTransactionLogsFilterMentions

from .config import APIS_PROGRAM_ID, RPC_WS_URL
from .decoder import EventDecoder, load_event_decoders, try_decode_event

log = logging.getLogger("apis_worker")

# Anchor's emit! macro prints event payloads as: "Program data: <base64>"
_EMIT_PREFIX = "Program data: "


async def listen_for_jobs() -> None:
    """Connect to devnet, subscribe to apis_program logs, decode events.

    Runs until cancelled. Logs each successfully-decoded event as a single
    INFO line; falls back to DEBUG for unknown discriminators (instructions
    don't currently emit them, but fail-soft anyway).
    """
    program_id = Pubkey.from_string(APIS_PROGRAM_ID)
    decoders = load_event_decoders()
    log.info(
        "loaded %d event decoder(s): %s",
        len(decoders),
        ", ".join(d.name for d in decoders),
    )

    log.info("connecting to %s", RPC_WS_URL)
    log.info("subscribing to logs mentioning %s", APIS_PROGRAM_ID)

    async with connect(RPC_WS_URL) as ws:
        await ws.logs_subscribe(
            filter_=RpcTransactionLogsFilterMentions(program_id),
            commitment="confirmed",
        )
        first = await ws.recv()
        sub_id = first[0].result
        log.info("subscribed (id=%s); waiting for events…", sub_id)

        async for batch in ws:
            for msg in batch:
                _handle_log_message(msg, decoders)


def _handle_log_message(msg, decoders: list[EventDecoder]) -> None:
    notification = getattr(msg, "result", None)
    if notification is None:
        return
    value = notification.value

    # If the tx errored, Anchor's emit! never executed → skip.
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
            log.debug("non-base64 emit payload (skipping): %s", line)
            continue

        decoded = try_decode_event(payload, decoders)
        if decoded is None:
            continue
        name, fields = decoded
        log.info("%s  tx=%s…  %s", name, sig[:8], _format_fields(fields))


def _format_fields(fields: dict) -> str:
    """Compact one-line render: pubkeys → base58 (truncated), bytes → hex,
    everything else → str()."""
    parts: list[str] = []
    for k, v in fields.items():
        if k.startswith("_"):
            parts.append(f"{k}={v}")
        elif isinstance(v, bytes) and len(v) == 32 and k in {"job", "buyer", "provider", "authority"}:
            parts.append(f"{k}={str(Pubkey(v))[:12]}…")
        elif isinstance(v, bytes):
            parts.append(f"{k}=0x{v.hex()[:16]}…")
        else:
            parts.append(f"{k}={v}")
    return "  ".join(parts)
