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
    /// W1: `price_lamports_usdc = 0`, no token transfer. The buyer pays
    /// only rent for the Job PDA. W2 will replace this with USDC vault
    /// locking.
    pub fn create_job(
        ctx: Context<CreateJob>,
        id: u64,
        spec_hash: [u8; 32],
        deadline_offset_secs: i64,
    ) -> Result<()> {
        create_job_handler(ctx, id, spec_hash, deadline_offset_secs)
    }
}
