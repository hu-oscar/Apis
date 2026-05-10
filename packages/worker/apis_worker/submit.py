"""Build + sign + send submit_completion transactions.

Anchor 1.0 instruction discriminators are sha256("global:<ix_name>")[:8];
we compute them at runtime so the worker stays in sync with apis_program
without having to re-extract them from the IDL each time.
"""

from __future__ import annotations

import hashlib
import logging

from solana.rpc.async_api import AsyncClient
from solana.rpc.commitment import Confirmed
from solana.rpc.types import TxOpts
from solders.instruction import AccountMeta, Instruction
from solders.keypair import Keypair
from solders.message import MessageV0
from solders.pubkey import Pubkey
from solders.transaction import VersionedTransaction

from apis_worker.config import APIS_PROGRAM_ID, RPC_HTTP_URL

log = logging.getLogger("apis_worker.submit")


def _instruction_discriminator(name: str) -> bytes:
    """Anchor v1 instruction discriminator: sha256("global:<name>")[:8]."""
    return hashlib.sha256(f"global:{name}".encode("utf-8")).digest()[:8]


ACCEPT_JOB_DISCRIMINATOR: bytes = _instruction_discriminator("accept_job")
SUBMIT_COMPLETION_DISCRIMINATOR: bytes = _instruction_discriminator(
    "submit_completion"
)


def _find_provider_pda(authority: Pubkey, program_id: Pubkey) -> Pubkey:
    pda, _ = Pubkey.find_program_address(
        [b"provider", bytes(authority)], program_id
    )
    return pda


async def accept_job(
    job_pda: Pubkey,
    signer: Keypair,
    rpc_url: str = RPC_HTTP_URL,
) -> str:
    """Build + sign + send an accept_job tx (Funded → Started). Returns sig.

    Account list per programs/apis_program/src/instructions/accept_job.rs:
      authority  (signer, read-only)
      provider   (read-only, validated via seeds + has_one)
      job        (mut, status transitions Funded → Started)
    """
    program_id = Pubkey.from_string(APIS_PROGRAM_ID)
    authority = signer.pubkey()
    provider_pda = _find_provider_pda(authority, program_id)

    accounts = [
        AccountMeta(pubkey=authority, is_signer=True, is_writable=False),
        AccountMeta(pubkey=provider_pda, is_signer=False, is_writable=False),
        AccountMeta(pubkey=job_pda, is_signer=False, is_writable=True),
    ]
    ix = Instruction(
        program_id=program_id, accounts=accounts, data=ACCEPT_JOB_DISCRIMINATOR
    )

    log.info("accepting job %s…", str(job_pda)[:12] + "…")

    async with AsyncClient(rpc_url) as client:
        blockhash = (await client.get_latest_blockhash()).value.blockhash
        msg = MessageV0.try_compile(
            payer=authority,
            instructions=[ix],
            address_lookup_table_accounts=[],
            recent_blockhash=blockhash,
        )
        tx = VersionedTransaction(msg, [signer])
        # preflight_commitment=Confirmed avoids races where the worker's
        # tx is built before the buyer's create_job has propagated to
        # the cluster's processed-tip view (preflight default).
        opts = TxOpts(preflight_commitment=Confirmed)
        sig = (await client.send_transaction(tx, opts=opts)).value
        await client.confirm_transaction(sig, "confirmed")

    sig_str = str(sig)
    log.info("✓ accept_job confirmed: %s…", sig_str[:16])
    return sig_str


async def submit_completion(
    job_pda: Pubkey,
    proof_hash: bytes,
    signer: Keypair,
    rpc_url: str = RPC_HTTP_URL,
) -> str:
    """Build + sign + send a submit_completion tx. Returns the tx signature.

    The signer is the provider's authority keypair (typically the worker's
    local keypair from `apis_worker.wallet.load_worker_keypair()`).
    """
    if len(proof_hash) != 32:
        raise ValueError(f"proof_hash must be 32 bytes, got {len(proof_hash)}")

    program_id = Pubkey.from_string(APIS_PROGRAM_ID)
    authority = signer.pubkey()
    provider_pda = _find_provider_pda(authority, program_id)

    # Account list per programs/apis_program/src/instructions/submit_completion.rs
    #   authority  (signer, read-only)
    #   provider   (read-only, validated via seeds + has_one)
    #   job        (mut, status transitions Started → Completed)
    accounts = [
        AccountMeta(pubkey=authority, is_signer=True, is_writable=False),
        AccountMeta(pubkey=provider_pda, is_signer=False, is_writable=False),
        AccountMeta(pubkey=job_pda, is_signer=False, is_writable=True),
    ]
    data = SUBMIT_COMPLETION_DISCRIMINATOR + proof_hash

    ix = Instruction(program_id=program_id, accounts=accounts, data=data)

    log.info(
        "submitting completion: job=%s proof_hash=0x%s",
        str(job_pda)[:12] + "…",
        proof_hash.hex()[:16] + "…",
    )

    async with AsyncClient(rpc_url) as client:
        blockhash = (await client.get_latest_blockhash()).value.blockhash
        msg = MessageV0.try_compile(
            payer=authority,
            instructions=[ix],
            address_lookup_table_accounts=[],
            recent_blockhash=blockhash,
        )
        tx = VersionedTransaction(msg, [signer])
        send_resp = await client.send_transaction(tx)
        sig = send_resp.value
        await client.confirm_transaction(sig, "confirmed")

    sig_str = str(sig)
    log.info(
        "✓ submit_completion confirmed: tx=%s",
        f"https://explorer.solana.com/tx/{sig_str}?cluster=devnet",
    )
    return sig_str
