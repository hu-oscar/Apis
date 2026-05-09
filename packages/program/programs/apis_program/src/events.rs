use anchor_lang::prelude::*;

/// Emitted by `register_provider`.
///
/// Off-chain indexers (Helius websocket subscribers, the Postgres indexer
/// described in Tech Design §6) listen for this to populate the public
/// provider list rendered on `/providers`.
#[event]
pub struct ProviderRegistered {
    /// PDA address of the new Provider account.
    pub provider: Pubkey,
    /// Wallet authority that owns the provider account.
    pub authority: Pubkey,
    /// sha256 of the GPU spec JSON. Matches `Provider.gpu_specs_hash`.
    pub gpu_specs_hash: [u8; 32],
    /// sha256 of the worker endpoint URI. Matches
    /// `Provider.endpoint_uri_hash`.
    pub endpoint_uri_hash: [u8; 32],
    /// Unix timestamp (seconds) at registration.
    pub registered_at: i64,
}

/// Emitted by `create_job`.
///
/// Worker sidecars subscribe via Helius websocket to detect work
/// assignments — when `provider` matches the worker's own PDA, the worker
/// pulls the matching JobSpec and runs inference.
#[event]
pub struct JobCreated {
    /// PDA address of the new Job account.
    pub job: Pubkey,
    /// Buyer wallet that submitted the job.
    pub buyer: Pubkey,
    /// Provider PDA selected for the job.
    pub provider: Pubkey,
    /// sha256 of the full JobSpec (per Research §4).
    pub spec_hash: [u8; 32],
    /// Quoted price in USDC base units (6 decimals). 0 in W1.
    pub price_lamports_usdc: u64,
    /// Unix timestamp (seconds) at job creation.
    pub funded_at: i64,
    /// Unix timestamp (seconds) after which `auto_release` becomes valid.
    pub deadline: i64,
}
