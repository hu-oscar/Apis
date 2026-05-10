"""Worker→buyer result side-channel.

After `submit_completion` lands, the on-chain Job stores only
`completion_proof_hash` (sha256 of the PNG). The IPFS CID isn't on-chain
— so the buyer's web UI needs another way to find the rendered image.

Same dual-mode as `spec_channel.py`:

  - **HTTP** when `APIS_API_BASE` is set — POST `(cid, proof_hash,
    completed_at)` to `${APIS_API_BASE}/api/results/{job_pda}`. The
    Vercel route writes to KV; the buyer's `/job/[id]` page reads it
    back via `/api/jobs/{pda}` which merges KV + on-chain Job state.

  - **Filesystem** otherwise — writes `/tmp/apis_results/{pda}.json`
    for the local-only dev flow.
"""

from __future__ import annotations

import json
import logging
import os
import time
from pathlib import Path

import httpx

log = logging.getLogger("apis_worker.result_channel")

RESULT_DIR = Path(os.environ.get("APIS_RESULT_DIR", "/tmp/apis_results"))


def _api_base() -> str | None:
    base = os.environ.get("APIS_API_BASE")
    return base.rstrip("/") if base else None


def store_result(job_pda_str: str, cid: str, proof_hash: bytes) -> str:
    """Persist the (cid, proof_hash) tuple keyed by Job PDA.

    Returns the location it was written to (HTTP URL when remote, FS
    path string when local) — used for log lines + tests.
    """
    payload = {
        "cid": cid,
        "proof_hash_hex": proof_hash.hex(),
        "completed_at": int(time.time()),
    }
    base = _api_base()
    if base:
        url = f"{base}/api/results/{job_pda_str}"
        try:
            r = httpx.post(url, json=payload, timeout=10.0)
            if r.status_code == 200:
                log.debug("posted result for %s to %s", job_pda_str[:12], url)
                return url
            log.warning("result POST %s returned %d: %s", url, r.status_code, r.text)
        except httpx.HTTPError as exc:
            log.warning("result POST %s failed: %s", url, exc)
        # Fall through to FS so we at least preserve the data locally
        # for inspection / retry.

    RESULT_DIR.mkdir(parents=True, exist_ok=True)
    path = RESULT_DIR / f"{job_pda_str}.json"
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    log.debug("stored result for %s at %s", job_pda_str[:12], path)
    return str(path)


def lookup_result(job_pda_str: str) -> dict | None:
    """Worker-internal: read back what `store_result` persisted via FS.

    The deployed buyer UI doesn't call this — it goes through the
    Next.js API route `/api/jobs/{pda}` instead, which reads from KV.
    Kept around for local debugging / pytest fixtures.
    """
    path = RESULT_DIR / f"{job_pda_str}.json"
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        log.warning("could not decode result file %s: %s", path, exc)
        return None
