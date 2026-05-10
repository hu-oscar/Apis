"""Worker keypair loading.

The worker holds a local Solana keypair so it can sign:
  - register_provider (one-shot at bootstrap)
  - submit_completion (every job)

Defaults to `~/.config/apis/worker.json` (analogous to the Solana CLI's
`~/.config/solana/id.json`). Override with the `APIS_WORKER_KEYPAIR`
env var.

Per AGENTS.md: "AI never sees private keys." The keypair file is
generated locally, file mode 0600, gitignored.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

from solders.keypair import Keypair

DEFAULT_KEYPAIR_PATH: Path = Path.home() / ".config" / "apis" / "worker.json"


def keypair_path() -> Path:
    """Return the path the worker reads/writes its keypair from."""
    return Path(
        os.environ.get("APIS_WORKER_KEYPAIR", str(DEFAULT_KEYPAIR_PATH))
    ).expanduser()


def load_worker_keypair() -> Keypair:
    """Read the worker keypair from disk. Raise if missing."""
    p = keypair_path()
    if not p.exists():
        raise FileNotFoundError(
            f"Worker keypair not found at {p}.\n"
            "Run `python scripts/bootstrap_keypair.py` first to generate it."
        )
    secret = json.loads(p.read_text())
    return Keypair.from_bytes(bytes(secret))


def create_worker_keypair_if_missing() -> tuple[Keypair, bool]:
    """Generate + persist a fresh keypair if none exists.

    Returns (keypair, created_now). `created_now` is True if a new
    keypair was written; False if an existing one was loaded.
    """
    p = keypair_path()
    if p.exists():
        return load_worker_keypair(), False
    p.parent.mkdir(parents=True, exist_ok=True)
    kp = Keypair()
    p.write_text(json.dumps(list(bytes(kp))))
    p.chmod(0o600)
    return kp, True
