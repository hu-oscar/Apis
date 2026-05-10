use anchor_lang::prelude::*;

/// Apis program-wide error codes.
///
/// Anchor v1 migration guide §12: multiple `#[error_code]` blocks no longer
/// compile — every variant for the program lives here. Variants are
/// append-only.
#[error_code]
pub enum ApisError {
    /// `register_provider`: gpu_specs_hash was the zero hash; reject.
    #[msg("gpu_specs_hash must not be zero")]
    GpuSpecsHashZero,
    /// `register_provider`: endpoint_uri_hash was the zero hash; reject.
    #[msg("endpoint_uri_hash must not be zero")]
    EndpointUriHashZero,
    /// `create_job`: spec_hash was the zero hash; reject.
    #[msg("spec_hash must not be zero")]
    SpecHashZero,
    /// `create_job`: referenced provider is not in `Active` status.
    #[msg("provider is not Active and cannot accept new jobs")]
    ProviderNotActive,
    /// `create_job`: deadline_offset_secs was non-positive.
    #[msg("deadline must be in the future")]
    InvalidDeadline,
    /// `initialize_config`: fee_bps was > 10_000 (100%).
    #[msg("fee_bps must be <= 10000 (100%)")]
    FeeBpsTooHigh,
    /// `create_job`: usdc_mint passed didn't match config.usdc_mint.
    /// (Surfaced from the `address = config.usdc_mint` account constraint.)
    #[msg("usdc_mint must match config.usdc_mint")]
    WrongMint,
    /// `create_job`: config.paused == true (admin emergency stop).
    #[msg("config is paused; new jobs are rejected")]
    ConfigPaused,
    /// `create_job`: price_lamports_usdc was 0.
    #[msg("price_lamports_usdc must be > 0")]
    ZeroPrice,
    /// `create_job`: post-CPI vault.amount didn't match price (Token-2022
    /// transfer-hook partial fill or similar). Defence in depth.
    #[msg("escrow vault amount does not match expected price")]
    VaultAmountMismatch,
    /// `accept_job`: job.status was not Funded.
    #[msg("job is not in Funded status")]
    JobNotFunded,
    /// `accept_job`: job.provider didn't match the provider PDA passed in.
    #[msg("job is not assigned to this provider")]
    WrongProvider,
    /// `accept_job`: provider.authority didn't match the signer.
    #[msg("signer is not the provider's authority")]
    WrongProviderAuthority,
    /// `submit_completion`: job.status was not Started.
    #[msg("job is not in Started status")]
    JobNotStarted,
    /// `submit_completion`: proof_hash was the zero hash; reject.
    #[msg("proof_hash must not be zero")]
    ProofHashZero,
    /// `confirm_completion`: signer wasn't the job's buyer (defensive;
    /// the seeds constraint catches this case first in practice).
    #[msg("signer is not the job's buyer")]
    WrongBuyer,
    /// `confirm_completion`: job.status was not Completed.
    #[msg("job is not in Completed status")]
    JobNotCompleted,
    /// `confirm_completion`: passed treasury account didn't match
    /// config.treasury.
    #[msg("treasury account does not match config.treasury")]
    WrongTreasury,
    /// `confirm_completion`: fee math overflowed (price * fee_bps).
    /// Should never trigger under realistic prices + bps caps but is
    /// caught by `checked_*` for defence in depth.
    #[msg("arithmetic overflow in fee calculation")]
    ArithmeticOverflow,
}
