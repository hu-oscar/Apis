use anchor_lang::prelude::*;

/// Singleton configuration for the Apis protocol.
///
/// PDA seeds: `[b"config"]`
///
/// Initialised once via `initialize_config` (the first caller becomes
/// `admin`). After that, only `admin` can mutate (W2+ adds an
/// `update_config` instruction; not in this commit).
///
/// W2 only uses `admin`, `treasury`, `usdc_mint`, `fee_bps`, and `paused`.
/// The remaining fields are W3 levers (bond/dispute/slash) declared
/// up front so the GlobalConfig account doesn't need a `realloc` when
/// W3 lands — same forward-declaration pattern we used for `Provider`
/// and `Job` in W1.
#[account]
#[derive(InitSpace)]
pub struct GlobalConfig {
    /// Wallet authorised to mutate `fee_bps`, `paused`, `treasury`, etc.
    pub admin: Pubkey,
    /// Where the protocol fee is sent on `confirm_completion`.
    /// Defaults to `admin` at init; can be updated by `admin` later.
    pub treasury: Pubkey,
    /// SPL mint of the payment token (devnet USDC at hackathon).
    pub usdc_mint: Pubkey,
    /// Protocol fee in basis points (10_000 = 100%). Capped by the
    /// `MAX_FEE_BPS` constraint in `initialize_config`.
    pub fee_bps: u16,
    /// W3: minimum bond a provider must lock per active job.
    /// Sentinel `0` in W2 means "bond not yet enforced."
    pub min_bond_lamports: u64,
    /// W3: seconds after `submit_completion` during which the buyer can
    /// raise a dispute. Sentinel `0` in W2.
    pub dispute_window_secs: i64,
    /// W3: split (in bps) of slashed bond between challenger and
    /// treasury (e.g. `5000` = 50/50). Sentinel `0` in W2.
    pub slash_split_bps: u16,
    /// Emergency pause — when true, `create_job` is rejected.
    /// Existing in-flight jobs are unaffected; settlement still works.
    pub paused: bool,
    /// PDA bump.
    pub bump: u8,
}
