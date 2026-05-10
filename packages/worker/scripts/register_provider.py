"""One-shot: register the worker's Provider PDA on devnet.

Reads the worker keypair (via apis_worker.wallet), derives the Provider
PDA seeds [b"provider", authority], builds + signs + sends a
register_provider instruction directly (no anchorpy — discriminator
hard-coded from the on-chain IDL).

Usage:
    .venv/bin/python scripts/register_provider.py
"""

from __future__ import annotations

import asyncio
import hashlib
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from solana.rpc.async_api import AsyncClient
from solders.hash import Hash
from solders.instruction import AccountMeta, Instruction
from solders.message import MessageV0
from solders.pubkey import Pubkey
from solders.system_program import ID as SYSTEM_PROGRAM_ID
from solders.transaction import VersionedTransaction

from apis_worker.config import APIS_PROGRAM_ID, RPC_HTTP_URL
from apis_worker.wallet import load_worker_keypair

# Discriminator for register_provider, from
# packages/program/target/idl/apis_program.json events / instructions.
# (Anchor uses sha256("global:register_provider")[:8] for the instruction
# discriminator. Hard-coded here because anchorpy 0.21 doesn't grok
# Anchor 1.0 IDLs.)
REGISTER_PROVIDER_DISCRIMINATOR: bytes = bytes(
    [254, 209, 54, 184, 46, 197, 109, 78]
)

# Stub identity for W2. Real provider GPU specs / endpoint URI will land
# in W4 alongside the MCP server.
GPU_SPECS: str = "Apis worker · M3 Pro 18 GB · MLX (mflux 0.17)"
ENDPOINT_URI: str = "wss://demo.local:8787"

MIN_BALANCE_LAMPORTS: int = 5_000_000  # ~0.005 SOL — enough for rent + fees


def find_provider_pda(authority: Pubkey, program_id: Pubkey) -> Pubkey:
    pda, _bump = Pubkey.find_program_address(
        [b"provider", bytes(authority)], program_id
    )
    return pda


async def main() -> None:
    kp = load_worker_keypair()
    authority = kp.pubkey()
    program_id = Pubkey.from_string(APIS_PROGRAM_ID)
    provider_pda = find_provider_pda(authority, program_id)

    print(f"Worker pubkey:  {authority}")
    print(f"Provider PDA:   {provider_pda}")
    print(f"apis_program:   {APIS_PROGRAM_ID}")
    print()

    async with AsyncClient(RPC_HTTP_URL) as client:
        balance = (await client.get_balance(authority)).value
        print(f"Balance: {balance / 1e9:.6f} SOL")
        if balance < MIN_BALANCE_LAMPORTS:
            print(
                f"\n✗ Insufficient balance ({balance} lamports < "
                f"{MIN_BALANCE_LAMPORTS}).\n"
                f"  Fund {authority} with at least 0.05 SOL on devnet, "
                f"then re-run.\n"
                f"  e.g. from Phantom (devnet): Send → paste address."
            )
            sys.exit(1)

        existing = (await client.get_account_info(provider_pda)).value
        if existing is not None:
            print(
                f"\n✓ Provider PDA already exists "
                f"({len(existing.data)} bytes); nothing to do."
            )
            return

        # Build the instruction.
        gpu_specs_hash = hashlib.sha256(GPU_SPECS.encode("utf-8")).digest()
        endpoint_uri_hash = hashlib.sha256(ENDPOINT_URI.encode("utf-8")).digest()
        data = (
            REGISTER_PROVIDER_DISCRIMINATOR + gpu_specs_hash + endpoint_uri_hash
        )
        ix = Instruction(
            program_id=program_id,
            accounts=[
                AccountMeta(pubkey=authority, is_signer=True, is_writable=True),
                AccountMeta(pubkey=provider_pda, is_signer=False, is_writable=True),
                AccountMeta(
                    pubkey=SYSTEM_PROGRAM_ID, is_signer=False, is_writable=False
                ),
            ],
            data=data,
        )

        # Sign + send.
        recent_blockhash: Hash = (
            await client.get_latest_blockhash()
        ).value.blockhash
        msg = MessageV0.try_compile(
            payer=authority,
            instructions=[ix],
            address_lookup_table_accounts=[],
            recent_blockhash=recent_blockhash,
        )
        tx = VersionedTransaction(msg, [kp])
        send_resp = await client.send_transaction(tx)
        sig = send_resp.value
        print(f"\nSubmitted: {sig}")
        print(
            f"  → https://explorer.solana.com/tx/{sig}?cluster=devnet"
        )

        await client.confirm_transaction(sig, "confirmed")
        print(f"✓ Confirmed.")
        print(
            f"\nProvider PDA active. Worker can now claim jobs assigned "
            f"to {provider_pda}."
        )


if __name__ == "__main__":
    asyncio.run(main())
