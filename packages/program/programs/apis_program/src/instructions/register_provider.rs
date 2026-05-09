use anchor_lang::prelude::*;

use crate::error::ApisError;
use crate::events::ProviderRegistered;
use crate::state::{Provider, ProviderStatus};

/// Account context for `register_provider`.
///
/// The PDA `init` constraint enforces single-Provider-per-authority — a
/// second call from the same authority will fail because the account
/// already exists, surfaced to the client as
/// `0x0 (already in use)`.
#[derive(Accounts)]
pub struct RegisterProvider<'info> {
    /// Wallet that will own the new provider account. Pays rent.
    #[account(mut)]
    pub authority: Signer<'info>,

    /// New Provider PDA.
    #[account(
        init,
        payer = authority,
        space = 8 + Provider::INIT_SPACE,
        seeds = [b"provider", authority.key().as_ref()],
        bump
    )]
    pub provider: Account<'info, Provider>,

    pub system_program: Program<'info, System>,
}

/// `register_provider` instruction body.
///
/// W1 scope: validate hashes, set `status = Active`, stamp `registered_at`.
/// `bond_vault` is left at `Pubkey::default()` for W2 to populate via
/// `deposit_bond`. Counters start at 0.
///
/// Invariants checked:
/// - `gpu_specs_hash != [0; 32]`
/// - `endpoint_uri_hash != [0; 32]`
pub fn register_provider_handler(
    ctx: Context<RegisterProvider>,
    gpu_specs_hash: [u8; 32],
    endpoint_uri_hash: [u8; 32],
) -> Result<()> {
    require!(gpu_specs_hash != [0u8; 32], ApisError::GpuSpecsHashZero);
    require!(endpoint_uri_hash != [0u8; 32], ApisError::EndpointUriHashZero);

    let now = Clock::get()?.unix_timestamp;

    let provider = &mut ctx.accounts.provider;
    provider.set_inner(Provider {
        authority: ctx.accounts.authority.key(),
        gpu_specs_hash,
        endpoint_uri_hash,
        bond_vault: Pubkey::default(), // W2 populates via deposit_bond
        active_jobs: 0,
        total_jobs: 0,
        status: ProviderStatus::Active,
        registered_at: now,
        bump: ctx.bumps.provider,
    });

    emit!(ProviderRegistered {
        provider: provider.key(),
        authority: ctx.accounts.authority.key(),
        gpu_specs_hash,
        endpoint_uri_hash,
        registered_at: now,
    });

    Ok(())
}
