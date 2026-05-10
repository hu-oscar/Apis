"""Buyer-side e2e test: confirm a Completed job.

Reads the on-chain Job + Provider + GlobalConfig accounts to derive all
the addresses confirm_completion needs. Releases the escrowed USDC:

  payout = price - fee  →  provider's USDC ATA
  fee    = price * fee_bps / 10_000  →  treasury USDC ATA
  vault  closed (rent → buyer)
  Job    closed (rent → buyer)

Usage:
    .venv/bin/python scripts/test_confirm_job.py <JOB_PDA>
"""

from __future__ import annotations

import asyncio
import hashlib
import json
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

CONFIRM_COMPLETION_DISCRIMINATOR: bytes = hashlib.sha256(
    b"global:confirm_completion"
).digest()[:8]

TOKEN_PROGRAM_ID = Pubkey.from_string("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA")
ASSOCIATED_TOKEN_PROGRAM_ID = Pubkey.from_string(
    "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
)

DEPLOYER_KEYPAIR_PATH = Path.home() / ".config" / "solana" / "id.json"


def _load_keypair(path: Path) -> Keypair:
    secret = json.loads(path.read_text())
    return Keypair.from_bytes(bytes(secret))


def _config_pda(program_id: Pubkey) -> Pubkey:
    pda, _ = Pubkey.find_program_address([b"config"], program_id)
    return pda


def _ata(owner: Pubkey, mint: Pubkey) -> Pubkey:
    pda, _ = Pubkey.find_program_address(
        [bytes(owner), bytes(TOKEN_PROGRAM_ID), bytes(mint)],
        ASSOCIATED_TOKEN_PROGRAM_ID,
    )
    return pda


async def main() -> None:
    if len(sys.argv) != 2:
        print(__doc__.strip())
        sys.exit(1)
    job_pda = Pubkey.from_string(sys.argv[1])

    if not DEPLOYER_KEYPAIR_PATH.exists():
        print(f"✗ Deployer keypair not found at {DEPLOYER_KEYPAIR_PATH}")
        sys.exit(1)
    buyer = _load_keypair(DEPLOYER_KEYPAIR_PATH)
    program_id = Pubkey.from_string(APIS_PROGRAM_ID)
    config_pda = _config_pda(program_id)

    async with AsyncClient(RPC_HTTP_URL) as client:
        # Read Job, Config, Provider accounts.
        job_info = (await client.get_account_info(job_pda)).value
        if job_info is None:
            print(f"✗ Job account {job_pda} not found.")
            sys.exit(1)
        job_data = bytes(job_info.data)
        # Job layout: discriminator(8) + id(8) + buyer(32) + provider(32) + ...
        job_buyer = Pubkey.from_bytes(job_data[8 + 8 : 8 + 8 + 32])
        job_provider = Pubkey.from_bytes(job_data[8 + 8 + 32 : 8 + 8 + 32 + 32])

        if bytes(job_buyer) != bytes(buyer.pubkey()):
            print(
                f"✗ Job's buyer {job_buyer} != deployer {buyer.pubkey()}; "
                f"only the buyer can confirm."
            )
            sys.exit(1)

        config_info = (await client.get_account_info(config_pda)).value
        if config_info is None:
            print(f"✗ GlobalConfig {config_pda} not found.")
            sys.exit(1)
        cfg_data = bytes(config_info.data)
        # Config layout: disc(8) + admin(32) + treasury(32) + usdc_mint(32) + ...
        treasury = Pubkey.from_bytes(cfg_data[8 + 32 : 8 + 32 + 32])
        usdc_mint = Pubkey.from_bytes(cfg_data[8 + 32 + 32 : 8 + 32 + 32 + 32])

        provider_info = (await client.get_account_info(job_provider)).value
        if provider_info is None:
            print(f"✗ Provider account {job_provider} not found.")
            sys.exit(1)
        # Provider layout: disc(8) + authority(32) + ...
        provider_authority = Pubkey.from_bytes(
            bytes(provider_info.data)[8 : 8 + 32]
        )

        provider_usdc_ata = _ata(provider_authority, usdc_mint)
        treasury_usdc_ata = _ata(treasury, usdc_mint)
        escrow_vault = _ata(job_pda, usdc_mint)

        print("──── Confirm parameters ────")
        print(f"Job PDA:           {job_pda}")
        print(f"Buyer:             {buyer.pubkey()}")
        print(f"Provider PDA:      {job_provider}")
        print(f"Provider authority:{provider_authority}")
        print(f"Treasury:          {treasury}")
        print(f"USDC mint:         {usdc_mint}")
        print(f"Escrow vault:      {escrow_vault}")
        print(f"Provider USDC ATA: {provider_usdc_ata}")
        print(f"Treasury USDC ATA: {treasury_usdc_ata}")
        print()

        accounts = [
            AccountMeta(pubkey=buyer.pubkey(), is_signer=True, is_writable=True),
            AccountMeta(pubkey=config_pda, is_signer=False, is_writable=False),
            AccountMeta(pubkey=job_pda, is_signer=False, is_writable=True),
            AccountMeta(pubkey=job_provider, is_signer=False, is_writable=False),
            AccountMeta(pubkey=provider_authority, is_signer=False, is_writable=False),
            AccountMeta(pubkey=treasury, is_signer=False, is_writable=False),
            AccountMeta(pubkey=usdc_mint, is_signer=False, is_writable=False),
            AccountMeta(pubkey=escrow_vault, is_signer=False, is_writable=True),
            AccountMeta(pubkey=provider_usdc_ata, is_signer=False, is_writable=True),
            AccountMeta(pubkey=treasury_usdc_ata, is_signer=False, is_writable=True),
            AccountMeta(pubkey=TOKEN_PROGRAM_ID, is_signer=False, is_writable=False),
            AccountMeta(
                pubkey=ASSOCIATED_TOKEN_PROGRAM_ID, is_signer=False, is_writable=False
            ),
            AccountMeta(pubkey=SYSTEM_PROGRAM_ID, is_signer=False, is_writable=False),
        ]
        ix = Instruction(
            program_id=program_id,
            accounts=accounts,
            data=CONFIRM_COMPLETION_DISCRIMINATOR,
        )

        blockhash = (await client.get_latest_blockhash()).value.blockhash
        msg = MessageV0.try_compile(
            payer=buyer.pubkey(),
            instructions=[ix],
            address_lookup_table_accounts=[],
            recent_blockhash=blockhash,
        )
        tx = VersionedTransaction(msg, [buyer])
        sig = (await client.send_transaction(tx)).value
        print(f"confirm_completion submitted: {sig}")
        print(f"  → https://explorer.solana.com/tx/{sig}?cluster=devnet")
        await client.confirm_transaction(sig, "confirmed")
        print(f"✓ Confirmed.")
        print()
        print(f"Settlement complete. Vault + Job accounts closed.")


if __name__ == "__main__":
    asyncio.run(main())
