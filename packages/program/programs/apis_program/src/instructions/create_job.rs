use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{transfer_checked, Mint, Token, TokenAccount, TransferChecked},
};

use crate::error::ApisError;
use crate::events::JobCreated;
use crate::state::{GlobalConfig, Job, JobStatus, Provider, ProviderStatus};

/// Account context for `create_job`.
///
/// W2: locks `price_lamports_usdc` from the buyer's USDC ATA into a
/// per-job EscrowVault (an associated token account at the Job PDA).
/// Vault rent is paid by the buyer; vault funds are released by
/// `confirm_completion` (success) or `cancel_job` (pre-accept refund).
///
/// `provider` is read-only — its `status == Active` is checked in the
/// handler. `config` provides the canonical `usdc_mint` (constraint
/// rejects mismatches) and the `paused` flag.
#[derive(Accounts)]
#[instruction(id: u64)]
pub struct CreateJob<'info> {
    /// Buyer wallet. Pays rent for the Job + EscrowVault and signs the
    /// USDC transfer into the vault.
    #[account(mut)]
    pub buyer: Signer<'info>,

    /// Singleton config. Read-only; constrains `usdc_mint` below.
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, GlobalConfig>,

    /// Provider PDA being targeted. Existence proves registration.
    pub provider: Account<'info, Provider>,

    /// USDC mint. Constrained to match `config.usdc_mint` so the buyer
    /// can't escrow some other token and call it USDC.
    #[account(address = config.usdc_mint @ ApisError::WrongMint)]
    pub usdc_mint: Account<'info, Mint>,

    /// Buyer's USDC associated token account (source of the escrow).
    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = buyer,
    )]
    pub buyer_usdc_ata: Account<'info, TokenAccount>,

    /// New Job PDA.
    #[account(
        init,
        payer = buyer,
        space = 8 + Job::INIT_SPACE,
        seeds = [b"job", buyer.key().as_ref(), id.to_le_bytes().as_ref()],
        bump
    )]
    pub job: Account<'info, Job>,

    /// Per-job EscrowVault — ATA owned by the Job PDA. Holds the locked
    /// USDC until `confirm_completion` or `cancel_job` closes it.
    #[account(
        init,
        payer = buyer,
        associated_token::mint = usdc_mint,
        associated_token::authority = job,
    )]
    pub escrow_vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

/// `create_job` instruction body.
///
/// W2 scope: validate config + provider + inputs, create the EscrowVault
/// ATA, transfer USDC into it via `transfer_checked`, set the Job to
/// `Funded` status. The Anchor `account(address = ...)` constraint on
/// `usdc_mint` rejects wrong-mint griefing before we get here.
///
/// Money-touching invariants (per AGENTS.md):
/// - `transfer_checked` (mint+decimals enforced) — never bare `transfer`.
/// - `Program<'info, Token>` — never `AccountInfo` for the token program.
/// - Re-read `escrow_vault` after the CPI before asserting the
///   transferred amount; never trust the cached pre-CPI value.
/// - All math via `checked_add` (overflow-checks are also on at profile
///   level for defence-in-depth).
pub fn create_job_handler(
    ctx: Context<CreateJob>,
    id: u64,
    spec_hash: [u8; 32],
    deadline_offset_secs: i64,
    price_lamports_usdc: u64,
) -> Result<()> {
    require!(!ctx.accounts.config.paused, ApisError::ConfigPaused);
    require!(spec_hash != [0u8; 32], ApisError::SpecHashZero);
    require!(
        ctx.accounts.provider.status == ProviderStatus::Active,
        ApisError::ProviderNotActive
    );
    require!(deadline_offset_secs > 0, ApisError::InvalidDeadline);
    require!(price_lamports_usdc > 0, ApisError::ZeroPrice);

    // Lock the buyer's USDC into the vault. Buyer is the source ATA's
    // authority — no PDA signer needed for this leg.
    let cpi_accounts = TransferChecked {
        from: ctx.accounts.buyer_usdc_ata.to_account_info(),
        mint: ctx.accounts.usdc_mint.to_account_info(),
        to: ctx.accounts.escrow_vault.to_account_info(),
        authority: ctx.accounts.buyer.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(ctx.accounts.token_program.key(), cpi_accounts);
    transfer_checked(cpi_ctx, price_lamports_usdc, ctx.accounts.usdc_mint.decimals)?;

    // Re-read the vault after the CPI; assert the exact amount we asked
    // to transfer landed (catches partial-fill edge cases under
    // Token-2022 transfer hooks, etc.).
    ctx.accounts.escrow_vault.reload()?;
    require!(
        ctx.accounts.escrow_vault.amount == price_lamports_usdc,
        ApisError::VaultAmountMismatch
    );

    let now = Clock::get()?.unix_timestamp;
    let deadline = now
        .checked_add(deadline_offset_secs)
        .ok_or(ApisError::InvalidDeadline)?;

    let job = &mut ctx.accounts.job;
    job.set_inner(Job {
        id,
        buyer: ctx.accounts.buyer.key(),
        provider: ctx.accounts.provider.key(),
        price_lamports_usdc,
        spec_hash,
        status: JobStatus::Funded,
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
        price_lamports_usdc,
        funded_at: now,
        deadline,
    });

    Ok(())
}
