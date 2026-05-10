"""One-shot: generate the worker's local Solana keypair if missing,
print its address + funding instructions.

Usage:
    .venv/bin/python scripts/bootstrap_keypair.py
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from apis_worker.wallet import create_worker_keypair_if_missing, keypair_path


def main() -> None:
    kp, created = create_worker_keypair_if_missing()
    path = keypair_path()
    pubkey = kp.pubkey()

    print(f"Keypair file: {path}")
    print(f"Worker pubkey: {pubkey}")
    print()
    if created:
        print("✓ New keypair generated (mode 0600, gitignored).")
        print()
        print("Next steps:")
        print(f"  1. Fund the worker on devnet — open Phantom (devnet),")
        print(f"     send ~0.05 SOL to {pubkey}.")
        print(f"     Or:  solana transfer {pubkey} 0.05 --url devnet --allow-unfunded-recipient")
        print()
        print(f"  2. Register on-chain:")
        print(f"     .venv/bin/python scripts/register_provider.py")
    else:
        print("✓ Existing keypair loaded; nothing to do.")


if __name__ == "__main__":
    main()
