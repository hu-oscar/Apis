"""Worker→buyer result side-channel (file-based).

After `submit_completion` lands, the on-chain Job stores only
`completion_proof_hash` (sha256 of the PNG). The IPFS CID isn't on-chain
— so the buyer's web UI needs another way to find the rendered image.

Mirror of `spec_channel.py` but in the reverse direction: writes
`/tmp/apis_results/{job_pda_str}.json` with `{cid, proof_hash_hex,
completed_at}`. The Next.js `/job/[id]` route reads it via a server-side
API handler.

Scope: hackathon-only, requires web + worker on the same box. W4 (dropped)
was supposed to replace this with an MCP-served /jobs/{pda} endpoint that
the buyer queries directly. Until then, the spec/result file pair is the
contract between the buyer UI and the worker.
"""

from __future__ import annotations

import json
import logging
import os
import time
from pathlib import Path

log = logging.getLogger("apis_worker.result_channel")

RESULT_DIR = Path(os.environ.get("APIS_RESULT_DIR", "/tmp/apis_results"))


def store_result(job_pda_str: str, cid: str, proof_hash: bytes) -> Path:
    """Write the (cid, proof_hash) tuple keyed by Job PDA. Returns the
    path of the file written (handy for log lines + tests)."""
    RESULT_DIR.mkdir(parents=True, exist_ok=True)
    path = RESULT_DIR / f"{job_pda_str}.json"
    payload = {
        "cid": cid,
        "proof_hash_hex": proof_hash.hex(),
        "completed_at": int(time.time()),
    }
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    log.debug("stored result for %s at %s", job_pda_str[:12], path)
    return path


def lookup_result(job_pda_str: str) -> dict | None:
    """Read back what `store_result` wrote, or None if the file is missing
    (worker hasn't completed this job yet, or it ran on a different box)."""
    path = RESULT_DIR / f"{job_pda_str}.json"
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        log.warning("could not decode result file %s: %s", path, exc)
        return None
