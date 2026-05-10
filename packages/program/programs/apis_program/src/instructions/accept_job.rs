use anchor_lang::prelude::*;

use crate::error::ApisError;
use crate::state::{Job, JobStatus, Provider, ProviderStatus};

/// Account context for `accept_job`.
///
/// The provider's authority signs to claim a `Funded` job. Three
/// constraints lock the relationship between signer / provider / job:
/// - `provider` PDA seeds match the signer's pubkey (no swapping in
///   another provider account)
/// - `provider.authority == signer` (has_one)
/// - `job.provider == provider.key()` (the job was targeted to this
///   provider, not someone else)
/// - `job.status == Funded` (no double-accept; no jumping a non-funded
///   job)
#[derive(Accounts)]
pub struct AcceptJob<'info> {
    /// Provider's authority — must match `provider.authority`.
    pub authority: Signer<'info>,

    /// Provider PDA the signer owns.
    #[account(
        seeds = [b"provider", authority.key().as_ref()],
        bump = provider.bump,
        has_one = authority @ ApisError::WrongProviderAuthority,
        constraint = provider.status == ProviderStatus::Active
            @ ApisError::ProviderNotActive,
    )]
    pub provider: Account<'info, Provider>,

    /// Job to accept. Must target this provider and be in `Funded`
    /// status. We rederive the PDA from `job.buyer` / `job.id` to make
    /// sure the caller hasn't substituted a fake account at the same
    /// type — Anchor will deserialise + then verify seeds match.
    #[account(
        mut,
        seeds = [b"job", job.buyer.as_ref(), job.id.to_le_bytes().as_ref()],
        bump = job.bump,
        constraint = job.provider == provider.key() @ ApisError::WrongProvider,
        constraint = job.status == JobStatus::Funded @ ApisError::JobNotFunded,
    )]
    pub job: Account<'info, Job>,
}

/// `accept_job` instruction body.
///
/// Pure status transition: `Funded → Started`. No money moves; no
/// counters mutate yet (`Provider.active_jobs` increments will land
/// alongside `confirm_completion` / `cancel_job` in W2-1e/1f when the
/// terminal counter increment is also wired up).
pub fn accept_job_handler(ctx: Context<AcceptJob>) -> Result<()> {
    ctx.accounts.job.status = JobStatus::Started;
    Ok(())
}
