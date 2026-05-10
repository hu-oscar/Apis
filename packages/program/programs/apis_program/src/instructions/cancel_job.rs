use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{
        close_account, transfer_checked, CloseAccount, Mint, Token, TokenAccount,
        TransferChecked,
    },
};

use crate::error::ApisError;
use crate::state::{GlobalConfig, Job, JobStatus};

/// Account context for `cancel_job`.
///
/// The buyer cancels their own job before any provider accepts it.
/// Status must be `Funded` (no `Started` cancellations — once a
/// provider has committed compute, payout/dispute is the only path).
/// The full vault contents go back to `buyer_usdc_ata`; vault and Job
/// accounts are closed (rent → buyer).
///
/// Smaller account set than `confirm_completion` — no provider /
/// treasury involvement — so we don't need to box anything.
#[derive(Accounts)]
pub struct CancelJob<'info> {
    /// Buyer cancelling. Receives the USDC refund + vault/Job rent.
    #[account(mut)]
    pub buyer: Signer<'info>,

    /// Singleton config — only consulted for `usdc_mint`.
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, GlobalConfig>,

    /// Job to cancel. Must be the buyer's, Funded, and gets closed
    /// (rent → buyer) via Anchor's `close = buyer`.
    #[account(
        mut,
        close = buyer,
        seeds = [b"job", buyer.key().as_ref(), job.id.to_le_bytes().as_ref()],
        bump = job.bump,
        has_one = buyer @ ApisError::WrongBuyer,
        constraint = job.status == JobStatus::Funded @ ApisError::JobNotFunded,
    )]
    pub job: Account<'info, Job>,

    /// USDC mint — matches config.usdc_mint.
    #[account(address = config.usdc_mint @ ApisError::WrongMint)]
    pub usdc_mint: Account<'info, Mint>,

    /// Buyer's USDC ATA — receives the refund.
    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = buyer,
    )]
    pub buyer_usdc_ata: Account<'info, TokenAccount>,

    /// Per-job EscrowVault — drained then closed.
    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = job,
    )]
    pub escrow_vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

/// `cancel_job` instruction body.
///
/// Refund-then-close. No fee, no math (the full vault amount goes
/// back to the buyer). Same money-touching guards as
/// `confirm_completion`:
///
/// - `transfer_checked` (mint+decimals enforced) — never `transfer`.
/// - Pre-CPI invariant: `vault.amount == job.price` (catches drift
///   between create_job's lock and now).
/// - Vault closed via SPL Token's `close_account` CPI signed by the
///   Job PDA; rent goes to the buyer.
/// - Job is closed by Anchor's `close = buyer` at end of ix.
pub fn cancel_job_handler(ctx: Context<CancelJob>) -> Result<()> {
    let price = ctx.accounts.job.price_lamports_usdc;

    require!(
        ctx.accounts.escrow_vault.amount == price,
        ApisError::VaultAmountMismatch
    );

    let buyer_key = ctx.accounts.job.buyer;
    let id_le = ctx.accounts.job.id.to_le_bytes();
    let job_bump = ctx.accounts.job.bump;
    let job_seeds: &[&[u8]] = &[b"job", buyer_key.as_ref(), &id_le, &[job_bump]];
    let signer_seeds = &[job_seeds];

    let token_program = ctx.accounts.token_program.key();
    let mint_decimals = ctx.accounts.usdc_mint.decimals;

    // Refund → buyer's ATA.
    if price > 0 {
        let cpi_accounts = TransferChecked {
            from: ctx.accounts.escrow_vault.to_account_info(),
            mint: ctx.accounts.usdc_mint.to_account_info(),
            to: ctx.accounts.buyer_usdc_ata.to_account_info(),
            authority: ctx.accounts.job.to_account_info(),
        };
        let cpi_ctx =
            CpiContext::new_with_signer(token_program, cpi_accounts, signer_seeds);
        transfer_checked(cpi_ctx, price, mint_decimals)?;
    }

    // Close the empty vault — rent → buyer.
    let close_accounts = CloseAccount {
        account: ctx.accounts.escrow_vault.to_account_info(),
        destination: ctx.accounts.buyer.to_account_info(),
        authority: ctx.accounts.job.to_account_info(),
    };
    let cpi_ctx =
        CpiContext::new_with_signer(token_program, close_accounts, signer_seeds);
    close_account(cpi_ctx)?;

    Ok(())
}
