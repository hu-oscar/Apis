"""Buyer-side e2e test: create a job targeting the worker's Provider PDA.

Runs the deployer as the buyer (since that's whose USDC was minted by
bootstrap_devnet.py). Posts the prompt to the file-based spec channel,
then submits a real create_job tx on devnet.

After this lands, the running worker (apis_worker) should:
  1. See the JobCreated event
  2. accept_job (Funded → Started)
  3. Run Flux Schnell on the prompt
  4. Hash + upload to IPFS
  5. submit_completion (Started → Completed)

The buyer can then call scripts/test_confirm_job.py to settle (release
USDC to provider + treasury, close vault + Job).

Usage:
    .venv/bin/python scripts/test_create_job.py [--prompt "..."]
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
import secrets
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from solana.rpc.async_api import AsyncClient
from solders.instruction import AccountMeta, Instruction
from solders.keypair import Keypair
from solders.message import MessageV0
from solders.pubkey import Pubkey
from solders.system_program import ID as SYSTEM_PROGRAM_ID
from solders.transaction import VersionedTransaction

from apis_worker.config import APIS_PROGRAM_ID, RPC_HTTP_URL
from apis_worker.spec_channel import SPEC_DIR, store_spec
from apis_worker.wallet import load_worker_keypair

# Anchor v1 instruction discriminator: sha256("global:<name>")[:8]
CREATE_JOB_DISCRIMINATOR: bytes = hashlib.sha256(
    b"global:create_job"
).digest()[:8]

TOKEN_PROGRAM_ID = Pubkey.from_string("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA")
ASSOCIATED_TOKEN_PROGRAM_ID = Pubkey.from_string(
    "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
)

DEPLOYER_KEYPAIR_PATH = Path.home() / ".config" / "solana" / "id.json"
DEFAULT_PROMPT = "an astronaut riding a horse on Mars, photorealistic, golden hour"
DEADLINE_OFFSET_SECS = 600  # 10 minutes
PRICE_LAMPORTS_USDC = 1_000_000  # 1.000000 USDC (6 decimals)


def _load_keypair(path: Path) -> Keypair:
    secret = json.loads(path.read_text())
    return Keypair.from_bytes(bytes(secret))


def _config_pda(program_id: Pubkey) -> Pubkey:
    pda, _ = Pubkey.find_program_address([b"config"], program_id)
    return pda


def _provider_pda(authority: Pubkey, program_id: Pubkey) -> Pubkey:
    pda, _ = Pubkey.find_program_address(
        [b"provider", bytes(authority)], program_id
    )
    return pda


def _job_pda(buyer: Pubkey, job_id: int, program_id: Pubkey) -> Pubkey:
    pda, _ = Pubkey.find_program_address(
        [b"job", bytes(buyer), job_id.to_bytes(8, "little")],
        program_id,
    )
    return pda


def _ata(owner: Pubkey, mint: Pubkey, allow_owner_off_curve: bool = False) -> Pubkey:
    """Compute the classic-Token associated token account address."""
    pda, _ = Pubkey.find_program_address(
        [bytes(owner), bytes(TOKEN_PROGRAM_ID), bytes(mint)],
        ASSOCIATED_TOKEN_PROGRAM_ID,
    )
    return pda


async def _read_config_usdc_mint(client: AsyncClient, config_pda: Pubkey) -> Pubkey:
    """Read GlobalConfig from chain + extract usdc_mint."""
    info = (await client.get_account_info(config_pda)).value
    if info is None:
        raise RuntimeError(
            f"GlobalConfig not initialized at {config_pda}. "
            "Run scripts/bootstrap_devnet.py first."
        )
    data = bytes(info.data)
    # Layout: discriminator(8) + admin(32) + treasury(32) + usdc_mint(32) + ...
    return Pubkey.from_bytes(data[8 + 32 + 32 : 8 + 32 + 32 + 32])


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--prompt", default=DEFAULT_PROMPT, help="Image prompt"
    )
    parser.add_argument(
        "--steps", type=int, default=4, help="Inference steps (Flux Schnell: 4)"
    )
    parser.add_argument(
        "--width", type=int, default=512, help="Image width"
    )
    parser.add_argument(
        "--height", type=int, default=512, help="Image height"
    )
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    if not DEPLOYER_KEYPAIR_PATH.exists():
        print(f"✗ Deployer keypair not found at {DEPLOYER_KEYPAIR_PATH}")
        sys.exit(1)
    buyer = _load_keypair(DEPLOYER_KEYPAIR_PATH)

    program_id = Pubkey.from_string(APIS_PROGRAM_ID)
    config_pda = _config_pda(program_id)

    # Worker's Provider PDA is derived from the worker's keypair.
    worker_kp = load_worker_keypair()
    provider_pda = _provider_pda(worker_kp.pubkey(), program_id)

    # Random u64 job id.
    job_id = secrets.randbits(64)
    job_pda = _job_pda(buyer.pubkey(), job_id, program_id)

    # Build the spec (which the worker reads via spec_channel.lookup_spec).
    spec = {
        "prompt": args.prompt,
        "model": "flux-schnell",
        "steps": args.steps,
        "width": args.width,
        "height": args.height,
        "seed": args.seed,
    }
    spec_canonical = json.dumps(
        spec, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    spec_hash = hashlib.sha256(spec_canonical).digest()

    print("──── Job parameters ────")
    print(f"Buyer:       {buyer.pubkey()}")
    print(f"Provider:    {provider_pda}")
    print(f"Job id:      {job_id}")
    print(f"Job PDA:     {job_pda}")
    print(f"Spec hash:   {spec_hash.hex()}")
    print(f"Prompt:      {args.prompt}")
    print(f"Price:       {PRICE_LAMPORTS_USDC / 1e6} USDC")
    print()

    # Stash the spec in the file-based side-channel BEFORE the on-chain
    # tx — the worker may pick up the JobCreated almost immediately and
    # need to read the prompt right away.
    spec_path = store_spec(spec_hash, spec)
    print(f"✓ Spec stored at {spec_path}")

    async with AsyncClient(RPC_HTTP_URL) as client:
        usdc_mint = await _read_config_usdc_mint(client, config_pda)
        buyer_ata = _ata(buyer.pubkey(), usdc_mint)
        escrow_vault = _ata(job_pda, usdc_mint, allow_owner_off_curve=True)
        print(f"USDC mint:        {usdc_mint}")
        print(f"Buyer ATA:        {buyer_ata}")
        print(f"Escrow vault:     {escrow_vault}")
        print()

        # Build the instruction data: discriminator + id + spec_hash + deadline + price
        data = (
            CREATE_JOB_DISCRIMINATOR
            + job_id.to_bytes(8, "little")
            + spec_hash  # 32 bytes
            + DEADLINE_OFFSET_SECS.to_bytes(8, "little", signed=True)
            + PRICE_LAMPORTS_USDC.to_bytes(8, "little")
        )

        accounts = [
            AccountMeta(pubkey=buyer.pubkey(), is_signer=True, is_writable=True),
            AccountMeta(pubkey=config_pda, is_signer=False, is_writable=False),
            AccountMeta(pubkey=provider_pda, is_signer=False, is_writable=False),
            AccountMeta(pubkey=usdc_mint, is_signer=False, is_writable=False),
            AccountMeta(pubkey=buyer_ata, is_signer=False, is_writable=True),
            AccountMeta(pubkey=job_pda, is_signer=False, is_writable=True),
            AccountMeta(pubkey=escrow_vault, is_signer=False, is_writable=True),
            AccountMeta(pubkey=TOKEN_PROGRAM_ID, is_signer=False, is_writable=False),
            AccountMeta(
                pubkey=ASSOCIATED_TOKEN_PROGRAM_ID, is_signer=False, is_writable=False
            ),
            AccountMeta(pubkey=SYSTEM_PROGRAM_ID, is_signer=False, is_writable=False),
        ]
        ix = Instruction(program_id=program_id, accounts=accounts, data=data)

        blockhash = (await client.get_latest_blockhash()).value.blockhash
        msg = MessageV0.try_compile(
            payer=buyer.pubkey(),
            instructions=[ix],
            address_lookup_table_accounts=[],
            recent_blockhash=blockhash,
        )
        tx = VersionedTransaction(msg, [buyer])
        sig = (await client.send_transaction(tx)).value
        print(f"create_job submitted: {sig}")
        print(f"  → https://explorer.solana.com/tx/{sig}?cluster=devnet")
        await client.confirm_transaction(sig, "confirmed")
        print(f"✓ Confirmed.")
        print()
        print(f"Watch the worker process this job (apis_worker should be running).")
        print(f"After the worker submits completion, run:")
        print(f"  .venv/bin/python scripts/test_confirm_job.py {job_pda}")


if __name__ == "__main__":
    asyncio.run(main())
