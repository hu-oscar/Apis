use anchor_lang::prelude::*;

use crate::error::ApisError;
use crate::events::JobCreated;
use crate::state::{Job, JobStatus, Provider, ProviderStatus};

/// Account context for `create_job`.
///
/// `provider` is read-only; deserialising successfully as `Account<Provider>`
/// proves the provider is registered. The handler additionally requires
/// `provider.status == Active`.
///
/// The Job PDA is keyed by `(buyer, id)` — `init` enforces idempotency:
/// re-using the same `id` from the same buyer fails (already-in-use), so
/// duplicate-submission is impossible.
#[derive(Accounts)]
#[instruction(id: u64)]
pub struct CreateJob<'info> {
    /// Buyer wallet. Pays rent for the Job PDA.
    #[account(mut)]
    pub buyer: Signer<'info>,

    /// Provider PDA being targeted. Existence proves registration.
    /// Read-only in W1 (no counter increments yet).
    pub provider: Account<'info, Provider>,

    /// New Job PDA.
    #[account(
        init,
        payer = buyer,
        space = 8 + Job::INIT_SPACE,
        seeds = [b"job", buyer.key().as_ref(), id.to_le_bytes().as_ref()],
        bump
    )]
    pub job: Account<'info, Job>,

    pub system_program: Program<'info, System>,
}

/// `create_job` instruction body.
///
/// W1 scope: validate inputs + provider status, create the Job PDA in
/// `Created` state with `price_lamports_usdc = 0`. **No USDC transfer
/// happens in W1** — that's the W2 escrow upgrade (`status` will jump
/// to `Funded` directly, skipping `Created`).
///
/// Invariants checked:
/// - `spec_hash != [0; 32]`
/// - `provider.status == Active`
/// - `deadline_offset_secs > 0` (and the addition doesn't overflow)
pub fn create_job_handler(
    ctx: Context<CreateJob>,
    id: u64,
    spec_hash: [u8; 32],
    deadline_offset_secs: i64,
) -> Result<()> {
    require!(spec_hash != [0u8; 32], ApisError::SpecHashZero);
    require!(
        ctx.accounts.provider.status == ProviderStatus::Active,
        ApisError::ProviderNotActive
    );
    require!(deadline_offset_secs > 0, ApisError::InvalidDeadline);

    let now = Clock::get()?.unix_timestamp;
    let deadline = now
        .checked_add(deadline_offset_secs)
        .ok_or(ApisError::InvalidDeadline)?;

    let job = &mut ctx.accounts.job;
    job.set_inner(Job {
        id,
        buyer: ctx.accounts.buyer.key(),
        provider: ctx.accounts.provider.key(),
        price_lamports_usdc: 0, // W1: no escrow yet
        spec_hash,
        status: JobStatus::Created,
        funded_at: now,
        deadline,
        completion_proof_hash: None,
        bump: ctx.bumps.job,
    });

    emit!(JobCreated {
        job: job.key(),
        buyer: ctx.accounts.buyer.key(),
        provider: ctx.accounts.provider.key(),
        spec_hash,
        price_lamports_usdc: 0,
        funded_at: now,
        deadline,
    });

    Ok(())
}
