"""File-based prompt side-channel (W2 stub).

The on-chain `Job.spec_hash` is `sha256(prompt + model + steps + ...)`.
The worker can't reconstruct the prompt from the hash alone, so we
need an off-chain channel for buyer→worker prompt delivery.

W2 simplification: a directory shared between buyer and worker
processes. Buyer writes `{SPEC_DIR}/{spec_hash_hex}.json`; worker
reads it on JobCreated. Works because both run on the same machine
during local testing.

W4 MCP server replaces this with proper signed channel delivery
(per Tech Design §4 F4 + Research §6) and removes the shared-fs
assumption — production buyers won't share a filesystem with the
provider running the worker.
"""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any

log = logging.getLogger("apis_worker.spec_channel")

SPEC_DIR: Path = Path(
    os.environ.get("APIS_SPEC_DIR", "/tmp/apis_specs")
).expanduser()


def store_spec(spec_hash: bytes, spec: dict[str, Any]) -> Path:
    """Buyer-side: persist a spec for the worker to pick up."""
    SPEC_DIR.mkdir(parents=True, exist_ok=True)
    p = SPEC_DIR / f"{spec_hash.hex()}.json"
    p.write_text(json.dumps(spec, indent=2))
    log.debug("stored spec at %s", p)
    return p


def lookup_spec(spec_hash: bytes) -> dict[str, Any] | None:
    """Worker-side: fetch the spec for a given hash. None if missing."""
    p = SPEC_DIR / f"{spec_hash.hex()}.json"
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        log.error("spec %s read error: %s", spec_hash.hex()[:12], exc)
        return None
