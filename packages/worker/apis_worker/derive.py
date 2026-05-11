"""CLI helper to print the Provider PDA derived from a keypair file.

The Tauri desktop app uses this to look up the on-chain Provider state
without bundling solana-sdk into the Rust side. Invocation:

    python -m apis_worker.derive <keypair_path>

Output (one value per line):

    <authority_base58>
    <provider_pda_base58>

Exits non-zero with a stderr message on any error (missing file,
malformed keypair, etc.). The Rust side parses stdout line-by-line.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from solders.keypair import Keypair
from solders.pubkey import Pubkey

from apis_worker.config import APIS_PROGRAM_ID


def derive(keypair_path: Path) -> tuple[Pubkey, Pubkey]:
    """Load `keypair_path`, return (authority, provider_pda)."""
    raw = json.loads(keypair_path.read_text())
    if not isinstance(raw, list) or len(raw) != 64:
        raise ValueError(
            f"expected a 64-byte JSON array (Solana keypair format), "
            f"got {type(raw).__name__} of length "
            f"{len(raw) if isinstance(raw, list) else 'N/A'}"
        )
    kp = Keypair.from_bytes(bytes(raw))
    authority = kp.pubkey()
    program_id = Pubkey.from_string(APIS_PROGRAM_ID)
    pda, _bump = Pubkey.find_program_address(
        [b"provider", bytes(authority)], program_id
    )
    return authority, pda


def _main() -> int:
    if len(sys.argv) != 2:
        print("usage: python -m apis_worker.derive <keypair_path>", file=sys.stderr)
        return 2
    path = Path(sys.argv[1]).expanduser()
    if not path.exists():
        print(f"keypair file not found: {path}", file=sys.stderr)
        return 1
    try:
        authority, pda = derive(path)
    except (ValueError, OSError, json.JSONDecodeError) as exc:
        print(f"failed to derive PDA: {exc}", file=sys.stderr)
        return 1
    print(authority)
    print(pda)
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
