"""Bootstrap apis_program on devnet for the W2-Step-2 e2e test.

One-shot: creates a test SPL mint owned by the deployer (~/.config/solana/id.json),
initializes the apis_program GlobalConfig with that mint, and mints 1000
test "USDC" (6 decimals) to the deployer's ATA so create_job can lock
funds in tests.

Idempotent — re-running detects the existing config + reads the mint
from it. Safe to invoke multiple times.

Usage:
    .venv/bin/python scripts/bootstrap_devnet.py
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import subprocess
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

# Anchor v1 instruction discriminator: sha256("global:<name>")[:8]
INITIALIZE_CONFIG_DISCRIMINATOR: bytes = hashlib.sha256(
    b"global:initialize_config"
).digest()[:8]

DEPLOYER_KEYPAIR_PATH = Path.home() / ".config" / "solana" / "id.json"
FEE_BPS_DEFAULT = 50  # 0.5%
INITIAL_MINT_AMOUNT_TOKENS = 1_000  # 1000 test USDC (will scale by 10**6 for 6 decimals)


def _load_keypair(path: Path) -> Keypair:
    secret = json.loads(path.read_text())
    return Keypair.from_bytes(bytes(secret))


def _config_pda(program_id: Pubkey) -> Pubkey:
    pda, _ = Pubkey.find_program_address([b"config"], program_id)
    return pda


def _run_solana_cli(cmd: list[str]) -> str:
    """Shell out to the Solana / spl-token CLI; return stdout stripped."""
    proc = subprocess.run(cmd, check=True, capture_output=True, text=True)
    return proc.stdout.strip()


def _create_test_mint(deployer_path: Path) -> Pubkey:
    """Create a new SPL mint via spl-token CLI; return its address."""
    print("Creating test SPL mint (decimals=6, fee-payer=deployer)…")
    out = _run_solana_cli([
        "spl-token", "create-token",
        "--decimals", "6",
        "--mint-authority", str(deployer_path),
        "--fee-payer", str(deployer_path),
        "--url", "devnet",
    ])
    # Output looks like: "Creating token 6mWP...\nAddress:  6mWP...\nDecimals: 6\nSignature: ..."
    for line in out.splitlines():
        if line.startswith("Address:"):
            mint_str = line.split()[1]
            return Pubkey.from_string(mint_str)
    raise RuntimeError(f"Couldn't parse mint address from spl-token output:\n{out}")


def _ensure_buyer_ata_funded(deployer_path: Path, mint: Pubkey, amount_tokens: int) -> Pubkey:
    """Create the deployer's ATA for the mint (if needed) + mint tokens to it.
    Returns the ATA address."""
    print(f"Creating + funding deployer's ATA for {mint}…")
    # spl-token create-account is idempotent (-i flag = idempotent)
    out = _run_solana_cli([
        "spl-token", "create-account",
        str(mint),
        "--fee-payer", str(deployer_path),
        "--owner", str(deployer_path),
        "--url", "devnet",
    ])
    # Output: "Creating account <ata>" or "<ata> already exists"
    ata_str = None
    for line in out.splitlines():
        words = line.split()
        for w in words:
            if len(w) >= 32 and len(w) <= 44 and w[0].isalnum():
                try:
                    Pubkey.from_string(w)
                    ata_str = w
                    break
                except ValueError:
                    continue
        if ata_str:
            break
    if not ata_str:
        # Fallback: derive deterministically
        from solders.system_program import ID as _SYS
        # The ATA is deterministic; we can also compute it via spl_associated_token_account_interface
        # but that's another dep. Just use spl-token to query.
        addr_out = _run_solana_cli([
            "spl-token", "address",
            "--token", str(mint),
            "--owner", _run_solana_cli(["solana", "address", "--keypair", str(deployer_path)]),
            "--url", "devnet",
            "--verbose",
        ])
        for line in addr_out.splitlines():
            if "Associated" in line:
                ata_str = line.split()[-1]
                break
    if not ata_str:
        raise RuntimeError(f"Couldn't determine ATA address from:\n{out}")
    ata = Pubkey.from_string(ata_str)

    print(f"Minting {amount_tokens} tokens (= {amount_tokens * 10**6} base units) to {ata}…")
    _run_solana_cli([
        "spl-token", "mint",
        str(mint),
        str(amount_tokens),
        str(ata),
        "--mint-authority", str(deployer_path),
        "--fee-payer", str(deployer_path),
        "--url", "devnet",
    ])
    return ata


async def _initialize_config(
    deployer: Keypair,
    program_id: Pubkey,
    config_pda: Pubkey,
    usdc_mint: Pubkey,
    fee_bps: int,
) -> str:
    """Build + sign + send initialize_config; return tx signature."""
    # Args: usdc_mint (32 bytes), fee_bps (u16, little-endian)
    data = (
        INITIALIZE_CONFIG_DISCRIMINATOR
        + bytes(usdc_mint)
        + fee_bps.to_bytes(2, "little")
    )
    accounts = [
        AccountMeta(pubkey=deployer.pubkey(), is_signer=True, is_writable=True),
        AccountMeta(pubkey=config_pda, is_signer=False, is_writable=True),
        AccountMeta(pubkey=SYSTEM_PROGRAM_ID, is_signer=False, is_writable=False),
    ]
    ix = Instruction(program_id=program_id, accounts=accounts, data=data)

    async with AsyncClient(RPC_HTTP_URL) as client:
        blockhash = (await client.get_latest_blockhash()).value.blockhash
        msg = MessageV0.try_compile(
            payer=deployer.pubkey(),
            instructions=[ix],
            address_lookup_table_accounts=[],
            recent_blockhash=blockhash,
        )
        tx = VersionedTransaction(msg, [deployer])
        sig = (await client.send_transaction(tx)).value
        await client.confirm_transaction(sig, "confirmed")
    return str(sig)


async def main() -> None:
    if not DEPLOYER_KEYPAIR_PATH.exists():
        print(f"✗ Deployer keypair not found at {DEPLOYER_KEYPAIR_PATH}")
        sys.exit(1)
    deployer = _load_keypair(DEPLOYER_KEYPAIR_PATH)
    program_id = Pubkey.from_string(APIS_PROGRAM_ID)
    config_pda = _config_pda(program_id)

    print(f"Deployer:    {deployer.pubkey()}")
    print(f"Program:     {APIS_PROGRAM_ID}")
    print(f"Config PDA:  {config_pda}")
    print()

    async with AsyncClient(RPC_HTTP_URL) as client:
        existing = (await client.get_account_info(config_pda)).value

    if existing is not None:
        # Read the stored usdc_mint from config (offset 8 + 32 + 32 = 72 bytes
        # in: discriminator(8) + admin(32) + treasury(32) + usdc_mint(32) + ...)
        data = bytes(existing.data)
        usdc_mint = Pubkey.from_bytes(data[8 + 32 + 32 : 8 + 32 + 32 + 32])
        print(f"✓ Config already initialized.")
        print(f"  usdc_mint: {usdc_mint}")
        print()
        # Still ensure the ATA + balance.
        ata = _ensure_buyer_ata_funded(
            DEPLOYER_KEYPAIR_PATH, usdc_mint, INITIAL_MINT_AMOUNT_TOKENS
        )
    else:
        # Create the mint, then init config with it.
        usdc_mint = _create_test_mint(DEPLOYER_KEYPAIR_PATH)
        print(f"✓ Test mint: {usdc_mint}")

        sig = await _initialize_config(
            deployer, program_id, config_pda, usdc_mint, FEE_BPS_DEFAULT
        )
        print(f"✓ initialize_config sent: {sig}")
        print()

        ata = _ensure_buyer_ata_funded(
            DEPLOYER_KEYPAIR_PATH, usdc_mint, INITIAL_MINT_AMOUNT_TOKENS
        )

    print()
    print("──── Bootstrap state ────")
    print(f"Buyer (deployer): {deployer.pubkey()}")
    print(f"Buyer USDC ATA:   {ata}")
    print(f"USDC mint:        {usdc_mint}")
    print(f"Config PDA:       {config_pda}")
    print()
    print("Next step: scripts/test_create_job.py")


if __name__ == "__main__":
    asyncio.run(main())
