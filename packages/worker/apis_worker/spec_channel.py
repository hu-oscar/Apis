"""Buyer→worker prompt side-channel.

The on-chain `Job.spec_hash` is `sha256(prompt + model + steps + ...)`.
The worker can't reconstruct the prompt from the hash alone, so we
need an off-chain channel for buyer→worker prompt delivery.

Two modes:

  - **HTTP** (deployed web app on Vercel, worker runs on user's Mac).
    Set `APIS_API_BASE=https://apis-mvp.vercel.app` and the worker GETs
    the spec from `${APIS_API_BASE}/api/spec/{hash}`. This is what the
    Vercel deploy uses — the buyer's `/submit` page POSTs the spec to
    `/api/spec`, which writes to KV, and the worker reads it back.

  - **Filesystem** (single-machine local dev). Without `APIS_API_BASE`
    set, both buyer and worker share `/tmp/apis_specs/{hash}.json`.
    Used by the Python-driven test scripts and by `pnpm --filter web
    dev` running alongside the worker on the same box.
"""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any

import httpx

log = logging.getLogger("apis_worker.spec_channel")

SPEC_DIR: Path = Path(
    os.environ.get("APIS_SPEC_DIR", "/tmp/apis_specs")
).expanduser()


def _api_base() -> str | None:
    base = os.environ.get("APIS_API_BASE")
    return base.rstrip("/") if base else None


def store_spec(spec_hash: bytes, spec: dict[str, Any]) -> Path:
    """Buyer-side (test scripts only): persist a spec for the worker via FS.

    The web `/submit` page POSTs to `/api/spec` directly — it never
    calls this. This helper exists for the Python e2e test scripts
    (scripts/test_create_job.py).
    """
    SPEC_DIR.mkdir(parents=True, exist_ok=True)
    p = SPEC_DIR / f"{spec_hash.hex()}.json"
    p.write_text(json.dumps(spec, indent=2))
    log.debug("stored spec at %s", p)
    return p


def lookup_spec(spec_hash: bytes) -> dict[str, Any] | None:
    """Worker-side: fetch the spec for a given hash. None if missing.

    Tries `APIS_API_BASE/api/spec/{hash}` if the env var is set, else
    falls back to the local filesystem. On HTTP error (network, 404,
    timeout) we return None — the listener logs a warning and skips
    the job, which is the same behavior as a missing FS file.
    """
    base = _api_base()
    if base:
        url = f"{base}/api/spec/{spec_hash.hex()}"
        try:
            r = httpx.get(url, timeout=10.0)
            if r.status_code == 200:
                payload = r.json()
                spec = payload.get("spec")
                if isinstance(spec, dict):
                    return spec
                log.warning("spec response missing 'spec' field: %s", payload)
                return None
            log.warning("spec fetch %s returned %d", url, r.status_code)
            return None
        except (httpx.HTTPError, json.JSONDecodeError) as exc:
            log.warning("spec fetch %s failed: %s", url, exc)
            return None

    # Filesystem mode.
    p = SPEC_DIR / f"{spec_hash.hex()}.json"
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        log.error("spec %s read error: %s", spec_hash.hex()[:12], exc)
        return None
