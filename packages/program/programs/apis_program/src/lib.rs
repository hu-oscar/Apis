// Anchor 1.0.2's `#[program]` macro expansion under Rust 1.95.0 emits a
// `clippy::diverging_sub_expression` warning that originates entirely from
// macro-generated code — not from anything we wrote. Target this single
// lint at the crate level rather than blanketing `clippy::all`.
#![allow(clippy::diverging_sub_expression)]

pub mod constants;
pub mod error;
pub mod events;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use error::*;
pub use events::*;
pub use instructions::*;
pub use state::*;

declare_id!("2qe8YXciSpony5vjwxZAYJZ7WfRzSHKRdRzSiH868mhf");

/// Apis program — permissionless GPU compute marketplace on Solana.
///
/// W1 scope: provider registration + job creation (no USDC escrow yet).
/// W2 will replace `create_job` to lock USDC into an EscrowVault, and add
/// `accept_job`/`submit_completion`/`confirm_completion`/`cancel_job`.
/// W3 adds dispute + slashing + spot-check verification.
///
/// Account layouts in `state/` already carry every field W2/W3 will need;
/// no schema migration is expected (per `AGENTS.md` Protected Areas rule).
#[program]
pub mod apis_program {
    use super::*;

    /// Initialize the singleton GlobalConfig (one-shot). The caller becomes
    /// `admin` and `treasury`; `usdc_mint` and `fee_bps` are caller-supplied.
    /// W3 levers (bond/dispute/slash) default to 0.
    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        usdc_mint: Pubkey,
        fee_bps: u16,
    ) -> Result<()> {
        initialize_config_handler(ctx, usdc_mint, fee_bps)
    }

    /// Register a GPU provider account. The PDA `init` constraint enforces
    /// single-Provider-per-authority — a duplicate call from the same
    /// authority fails with `already in use`.
    pub fn register_provider(
        ctx: Context<RegisterProvider>,
        gpu_specs_hash: [u8; 32],
        endpoint_uri_hash: [u8; 32],
    ) -> Result<()> {
        register_provider_handler(ctx, gpu_specs_hash, endpoint_uri_hash)
    }

    /// Create a job targeting a registered provider.
    ///
    /// W2: locks `price_lamports_usdc` of the buyer's USDC into a per-job
    /// EscrowVault PDA. Job status starts at `Funded` (the W1 `Created`
    /// variant is now reserved/historical).
    pub fn create_job(
        ctx: Context<CreateJob>,
        id: u64,
        spec_hash: [u8; 32],
        deadline_offset_secs: i64,
        price_lamports_usdc: u64,
    ) -> Result<()> {
        create_job_handler(
            ctx,
            id,
            spec_hash,
            deadline_offset_secs,
            price_lamports_usdc,
        )
    }

    /// Provider claims a Funded job, transitioning it to Started.
    /// Only the provider's authority can call. No money moves.
    pub fn accept_job(ctx: Context<AcceptJob>) -> Result<()> {
        accept_job_handler(ctx)
    }

    /// Provider records the inference result hash and transitions the
    /// job from Started → Completed. The buyer (or anyone after the
    /// dispute window) can then call `confirm_completion` to release
    /// the escrowed USDC. No money moves here.
    pub fn submit_completion(
        ctx: Context<SubmitCompletion>,
        proof_hash: [u8; 32],
    ) -> Result<()> {
        submit_completion_handler(ctx, proof_hash)
    }

    /// Buyer releases escrow: payout to provider, fee to treasury,
    /// vault + Job accounts closed (rent returned to buyer).
    pub fn confirm_completion(ctx: Context<ConfirmCompletion>) -> Result<()> {
        confirm_completion_handler(ctx)
    }
}
