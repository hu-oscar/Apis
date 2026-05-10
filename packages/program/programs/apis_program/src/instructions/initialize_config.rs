use anchor_lang::prelude::*;

use crate::error::ApisError;
use crate::state::GlobalConfig;

/// Maximum value for `fee_bps` — 10_000 = 100%.
pub const MAX_FEE_BPS: u16 = 10_000;

/// Account context for `initialize_config`.
///
/// PDA `init` constraint enforces that the GlobalConfig can only be
/// created once globally. Subsequent calls fail with `already in use`.
#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    /// First caller — becomes `admin`. Pays rent.
    #[account(mut)]
    pub admin: Signer<'info>,

    /// Singleton GlobalConfig PDA.
    #[account(
        init,
        payer = admin,
        space = 8 + GlobalConfig::INIT_SPACE,
        seeds = [b"config"],
        bump
    )]
    pub config: Account<'info, GlobalConfig>,

    pub system_program: Program<'info, System>,
}

/// `initialize_config` instruction body.
///
/// Sets `admin` and `treasury` to the signer; takes `usdc_mint` and
/// `fee_bps` from the caller. W3 fields (`min_bond_lamports`,
/// `dispute_window_secs`, `slash_split_bps`) are zeroed — W3 will
/// populate them via an `update_config` instruction.
///
/// Invariants:
/// - `fee_bps <= MAX_FEE_BPS` (no >100% fee — would be a bug, not just
///   a policy choice).
pub fn initialize_config_handler(
    ctx: Context<InitializeConfig>,
    usdc_mint: Pubkey,
    fee_bps: u16,
) -> Result<()> {
    require!(fee_bps <= MAX_FEE_BPS, ApisError::FeeBpsTooHigh);

    let admin = ctx.accounts.admin.key();
    let config = &mut ctx.accounts.config;
    config.set_inner(GlobalConfig {
        admin,
        treasury: admin, // default; can change via update_config (W2+)
        usdc_mint,
        fee_bps,
        min_bond_lamports: 0,
        dispute_window_secs: 0,
        slash_split_bps: 0,
        paused: false,
        bump: ctx.bumps.config,
    });

    Ok(())
}
