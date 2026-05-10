use anchor_lang::prelude::*;

use crate::error::ApisError;
use crate::state::{Job, JobStatus, Provider, ProviderStatus};

/// Account context for `submit_completion`.
///
/// Same locking pattern as `accept_job`: signer must be the provider's
/// authority, the provider must be Active, and the targeted job must
/// be the provider's + currently in `Started`. The proof_hash is the
/// only data input — no money moves yet (release is in
/// `confirm_completion`).
#[derive(Accounts)]
pub struct SubmitCompletion<'info> {
    pub authority: Signer<'info>,

    #[account(
        seeds = [b"provider", authority.key().as_ref()],
        bump = provider.bump,
        has_one = authority @ ApisError::WrongProviderAuthority,
        constraint = provider.status == ProviderStatus::Active
            @ ApisError::ProviderNotActive,
    )]
    pub provider: Account<'info, Provider>,

    #[account(
        mut,
        seeds = [b"job", job.buyer.as_ref(), job.id.to_le_bytes().as_ref()],
        bump = job.bump,
        constraint = job.provider == provider.key() @ ApisError::WrongProvider,
        constraint = job.status == JobStatus::Started @ ApisError::JobNotStarted,
    )]
    pub job: Account<'info, Job>,
}

/// `submit_completion` instruction body.
///
/// Records the provider-signed `proof_hash` (sha256 of the inference
/// result tensor + the JobSpec it was generated against — the buyer
/// uses this off-chain to verify deterministic reproduction in W3)
/// and transitions Started → Completed.
///
/// Invariants:
/// - `proof_hash != [0; 32]` (zero hash is the sentinel for "not yet
///   submitted").
pub fn submit_completion_handler(
    ctx: Context<SubmitCompletion>,
    proof_hash: [u8; 32],
) -> Result<()> {
    require!(proof_hash != [0u8; 32], ApisError::ProofHashZero);

    let job = &mut ctx.accounts.job;
    job.completion_proof_hash = Some(proof_hash);
    job.status = JobStatus::Completed;

    Ok(())
}
