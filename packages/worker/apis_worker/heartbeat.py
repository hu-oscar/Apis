"""Worker liveness heartbeat — Sprint 3.1 of Phase 1.5.

Every HEARTBEAT_INTERVAL_S, sign + POST a heartbeat to
`${APIS_API_BASE}/api/heartbeat/{provider_pda}`. The Vercel route
verifies the Ed25519 signature against the on-chain
`Provider.authority`, then writes the payload into KV. The buyer UI
reads it for the "online" indicator + the provider-card hardware
strip.

What's in the payload:
  - `at`               (unix ms — also doubles as replay-protection)
  - `version`          (worker semver string)
  - `capacity`         (max concurrent jobs the worker will accept)
  - `chip`             (e.g. "Apple M3 Pro", from APIS_PROVIDER_CHIP)
  - `ramGb`            (int, from APIS_PROVIDER_RAM_GB)
  - `cpuCores`         (int, from APIS_PROVIDER_CPU_CORES)
  - `secondsPerImage`  (str | None — decimal string like "12.500";
                        a string rather than a float so both Python's
                        and JS's JSON encoders produce byte-identical
                        canonical output for any value, including
                        integer-valued floats where they otherwise
                        disagree — "12.0" vs "12")
  - `suggestedPriceUsdcBase`
                       (str | None — u64 USDC base units at $1/hr fair
                        tier, as a decimal string for JSON precision)

The desktop provider app populates the optional fields via env vars
when it spawns the worker (see settingsToWorkerEnv in
packages/apis-provider/src/lib/settings.ts). Running the worker
standalone (CLI mode) sends the auth fields only — no hardware,
no benchmark — and the UI degrades gracefully.

Signing
─────────
We sign the canonical JSON encoding of `payload` with the worker's
Solana keypair (Ed25519). The web side verifies:
  1. signature is valid for (canonical payload, public key)
  2. public key == on-chain Provider.authority for `pda`
  3. payload.at is within ±5min of server time (replay window)

Disabled (no-op) when APIS_API_BASE is unset.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from typing import Any

import httpx
from solders.keypair import Keypair

log = logging.getLogger("apis_worker.heartbeat")

HEARTBEAT_INTERVAL_S = 30
# Loosely tracks `apis_worker` package version; surfaced in the UI's
# provider details panel so debugging "which worker version is this"
# is a glance away.
WORKER_VERSION = "0.3.0"


def _api_base() -> str | None:
    base = os.environ.get("APIS_API_BASE")
    return base.rstrip("/") if base else None


def _build_payload() -> dict[str, Any]:
    """Build the signed heartbeat payload from current env + clock.

    All hardware/benchmark fields are optional — falsy values become
    None or "" so the canonical encoding is stable whether or not the
    desktop has populated them. Numeric env vars that fail to parse
    fall back to 0 silently (we'd rather report "0 GB RAM" than crash
    the loop)."""
    chip = os.environ.get("APIS_PROVIDER_CHIP", "")
    ram_gb = _int_env("APIS_PROVIDER_RAM_GB", 0)
    cpu_cores = _int_env("APIS_PROVIDER_CPU_CORES", 0)
    raw_seconds = os.environ.get("APIS_BENCHMARK_SECONDS_PER_IMAGE", "").strip()
    # Normalize to a 3-decimal string. We keep this as a string in the
    # payload so both Python (`json.dumps`) and JS (`JSON.stringify`)
    # produce identical canonical bytes — float→JSON disagrees on
    # integer-valued floats (Python emits "12.0", JS emits "12") and
    # would break signature verification.
    seconds_per_image: str | None
    try:
        seconds_per_image = f"{float(raw_seconds):.3f}" if raw_seconds else None
    except ValueError:
        seconds_per_image = None
    suggested = os.environ.get("APIS_SUGGESTED_PRICE_USDC_BASE", "").strip()
    suggested_price = suggested if suggested else None
    return {
        "at": int(time.time() * 1000),
        "version": WORKER_VERSION,
        "capacity": 1,
        "chip": chip,
        "ramGb": ram_gb,
        "cpuCores": cpu_cores,
        "secondsPerImage": seconds_per_image,
        "suggestedPriceUsdcBase": suggested_price,
    }


def _int_env(key: str, default: int) -> int:
    raw = os.environ.get(key)
    if raw is None or raw.strip() == "":
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _canonical_json(payload: dict[str, Any]) -> bytes:
    """Stable serialization for signing.

    Matches the web side's canonical encoder exactly: keys sorted,
    no whitespace, ensure_ascii left default so the UTF-8 output is
    byte-identical to JS's TextEncoder.encode(canonicalJson(payload)).
    """
    return json.dumps(
        payload,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    ).encode("utf-8")


async def heartbeat_loop(
    provider_pda_str: str,
    keypair: Keypair,
) -> None:
    """Long-running task: sign + POST a heartbeat every
    HEARTBEAT_INTERVAL_S.

    Cancel via `asyncio.CancelledError` to stop. Transient HTTP
    failures + signature-rejected responses are logged at WARNING; the
    loop keeps running (next sample retries).
    """
    base = _api_base()
    if not base:
        log.info(
            "heartbeat disabled (APIS_API_BASE not set) — running local-only",
        )
        return

    url = f"{base}/api/heartbeat/{provider_pda_str}"
    public_key_str = str(keypair.pubkey())
    log.info(
        "starting signed heartbeat loop → %s (every %ds, signer=%s)",
        url,
        HEARTBEAT_INTERVAL_S,
        public_key_str,
    )

    while True:
        payload = _build_payload()
        message = _canonical_json(payload)
        signature = keypair.sign_message(message)
        body = {
            "payload": payload,
            "signature": str(signature),  # solders.Signature → base58
            "publicKey": public_key_str,  # solders.Pubkey → base58
        }
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                r = await client.post(url, json=body)
                if r.status_code != 200:
                    log.warning(
                        "heartbeat POST %s returned %d: %s",
                        url,
                        r.status_code,
                        r.text[:200],
                    )
        except (httpx.HTTPError, OSError) as exc:
            log.warning("heartbeat POST %s failed: %s", url, exc)
        await asyncio.sleep(HEARTBEAT_INTERVAL_S)
