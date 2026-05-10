use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{
        close_account, transfer_checked, CloseAccount, Mint, Token, TokenAccount,
        TransferChecked,
    },
};

use crate::error::ApisError;
use crate::state::{GlobalConfig, Job, JobStatus, Provider};

/// Account context for `confirm_completion`.
///
/// Buyer signs to release the escrowed USDC. Payout is split:
///   provider_usdc_ata gets `price - fee`
///   treasury_usdc_ata gets `fee = price * config.fee_bps / 10_000`
///
/// After both transfers, the EscrowVault is closed (rent → buyer) via
/// SPL Token's `close_account` CPI signed by the Job PDA. The Job
/// account itself is closed by Anchor's `close = buyer` constraint
/// (rent → buyer).
///
/// Both `provider_usdc_ata` and `treasury_usdc_ata` use `init_if_needed`
/// so the buyer can confirm even if those wallets have never held USDC
/// before — the buyer pays the rent for any newly-created ATAs.
#[derive(Accounts)]
pub struct ConfirmCompletion<'info> {
    /// Buyer confirming the job. Pays rent for any newly-created ATAs.
    /// Receives the rent refund from the closed Job + EscrowVault.
    #[account(mut)]
    pub buyer: Signer<'info>,

    /// Singleton config — provides treasury and fee_bps. The
    /// `treasury == treasury.key()` constraint defends against a buyer
    /// substituting their own ATA in place of the real treasury's.
    #[account(
        seeds = [b"config"],
        bump = config.bump,
        constraint = config.treasury == treasury.key() @ ApisError::WrongTreasury,
    )]
    pub config: Account<'info, GlobalConfig>,

    /// Job being confirmed. Anchor closes it (rent → buyer) at the end
    /// of this instruction via `close = buyer`.
    #[account(
        mut,
        close = buyer,
        seeds = [b"job", buyer.key().as_ref(), job.id.to_le_bytes().as_ref()],
        bump = job.bump,
        has_one = buyer @ ApisError::WrongBuyer,
        constraint = job.provider == provider.key() @ ApisError::WrongProvider,
        constraint = job.status == JobStatus::Completed
            @ ApisError::JobNotCompleted,
    )]
    pub job: Account<'info, Job>,

    /// Provider PDA. We constrain it to match `job.provider`
    /// (above on `job`) and to have `provider.authority ==
    /// provider_authority.key()` so the payout ATA below is the
    /// provider authority's, not some attacker's.
    #[account(
        seeds = [b"provider", provider.authority.as_ref()],
        bump = provider.bump,
        constraint = provider.authority == provider_authority.key()
            @ ApisError::WrongProviderAuthority,
    )]
    pub provider: Account<'info, Provider>,

    /// CHECK: This account is constrained by `provider.authority ==
    /// provider_authority.key()` above. We never deserialize its data;
    /// it's only used as the SPL ATA owner for `provider_usdc_ata`.
    pub provider_authority: SystemAccount<'info>,

    /// CHECK: This account is constrained by `config.treasury ==
    /// treasury.key()` above. Same role as `provider_authority` but
    /// for `treasury_usdc_ata`.
    pub treasury: SystemAccount<'info>,

    /// USDC mint — must match config.usdc_mint.
    /// Boxed (along with the SPL token accounts below) to keep the
    /// generated `try_accounts` frame under BPF's 4096-byte stack
    /// limit; this struct is large.
    #[account(address = config.usdc_mint @ ApisError::WrongMint)]
    pub usdc_mint: Box<Account<'info, Mint>>,

    /// Per-job EscrowVault — drained then closed.
    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = job,
    )]
    pub escrow_vault: Box<Account<'info, TokenAccount>>,

    /// Provider's USDC ATA — receives payout.
    #[account(
        init_if_needed,
        payer = buyer,
        associated_token::mint = usdc_mint,
        associated_token::authority = provider_authority,
    )]
    pub provider_usdc_ata: Box<Account<'info, TokenAccount>>,

    /// Treasury's USDC ATA — receives fee.
    #[account(
        init_if_needed,
        payer = buyer,
        associated_token::mint = usdc_mint,
        associated_token::authority = treasury,
    )]
    pub treasury_usdc_ata: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

/// `confirm_completion` instruction body.
///
/// The on-chain payment release. Money-touching invariants per
/// AGENTS.md:
///
/// - `transfer_checked` everywhere (mint+decimals enforced).
/// - All math via `checked_*` (defence against overflow even with
///   profile-level overflow-checks on).
/// - Pre-CPI invariant: `vault.amount == job.price` (catches any drift
///   between create_job's lock and now).
/// - Post-CPI: vault is fully drained, then closed via
///   `close_account` CPI (buyer recovers the vault's rent).
/// - Job PDA signs the vault drain with seeds [b"job", buyer, id].
///
/// Fee math: `fee = price * fee_bps / 10_000` (integer division,
/// rounded down → favours the provider over the treasury by at most
/// 1 base unit when fee_bps doesn't divide evenly).
pub fn confirm_completion_handler(ctx: Context<ConfirmCompletion>) -> Result<()> {
    let price = ctx.accounts.job.price_lamports_usdc;
    let fee_bps = ctx.accounts.config.fee_bps as u64;

    let fee = price
        .checked_mul(fee_bps)
        .ok_or(ApisError::ArithmeticOverflow)?
        .checked_div(10_000)
        .ok_or(ApisError::ArithmeticOverflow)?;
    let payout = price
        .checked_sub(fee)
        .ok_or(ApisError::ArithmeticOverflow)?;

    // Pre-CPI invariant — vault must hold exactly the locked price.
    require!(
        ctx.accounts.escrow_vault.amount == price,
        ApisError::VaultAmountMismatch
    );

    // Build PDA signer seeds for the vault transfers + close.
    let buyer_key = ctx.accounts.job.buyer;
    let id_le = ctx.accounts.job.id.to_le_bytes();
    let job_bump = ctx.accounts.job.bump;
    let job_seeds: &[&[u8]] = &[b"job", buyer_key.as_ref(), &id_le, &[job_bump]];
    let signer_seeds = &[job_seeds];

    let token_program = ctx.accounts.token_program.key();
    let mint_decimals = ctx.accounts.usdc_mint.decimals;

    // Payout to provider (omit if 0 — happens only at fee_bps == 10_000).
    if payout > 0 {
        let cpi_accounts = TransferChecked {
            from: ctx.accounts.escrow_vault.to_account_info(),
            mint: ctx.accounts.usdc_mint.to_account_info(),
            to: ctx.accounts.provider_usdc_ata.to_account_info(),
            authority: ctx.accounts.job.to_account_info(),
        };
        let cpi_ctx =
            CpiContext::new_with_signer(token_program, cpi_accounts, signer_seeds);
        transfer_checked(cpi_ctx, payout, mint_decimals)?;
    }

    // Fee to treasury (omit if 0 — happens whenever fee_bps == 0).
    if fee > 0 {
        let cpi_accounts = TransferChecked {
            from: ctx.accounts.escrow_vault.to_account_info(),
            mint: ctx.accounts.usdc_mint.to_account_info(),
            to: ctx.accounts.treasury_usdc_ata.to_account_info(),
            authority: ctx.accounts.job.to_account_info(),
        };
        let cpi_ctx =
            CpiContext::new_with_signer(token_program, cpi_accounts, signer_seeds);
        transfer_checked(cpi_ctx, fee, mint_decimals)?;
    }

    // Close the now-empty vault — rent goes to the buyer.
    let close_accounts = CloseAccount {
        account: ctx.accounts.escrow_vault.to_account_info(),
        destination: ctx.accounts.buyer.to_account_info(),
        authority: ctx.accounts.job.to_account_info(),
    };
    let cpi_ctx =
        CpiContext::new_with_signer(token_program, close_accounts, signer_seeds);
    close_account(cpi_ctx)?;

    // Job account is closed by Anchor's `close = buyer` at end of ix.
    Ok(())
}
