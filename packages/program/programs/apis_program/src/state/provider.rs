use anchor_lang::prelude::*;

/// Per-provider registry account.
///
/// PDA seeds: `[b"provider", authority.key().as_ref()]`
///
/// W1 only sets `authority`, hashes, `status = Active`, and `registered_at`.
/// `bond_vault` stays at `Pubkey::default()` until W2 (`deposit_bond`); the
/// counters stay at 0 until W2 instructions start incrementing them. This
/// schema matches Tech Design §3 / Research §3 so W2/W3 are additive — no
/// account migration required (per `AGENTS.md` Protected Areas rule).
#[account]
#[derive(InitSpace)]
pub struct Provider {
    /// The wallet authorised to update this provider account.
    pub authority: Pubkey,
    /// sha256 of the GPU spec JSON (model + VRAM + CUDA/driver versions).
    /// We store the hash, not the raw spec, for size + privacy.
    pub gpu_specs_hash: [u8; 32],
    /// sha256 of the worker websocket endpoint URI. Off-chain resolution
    /// avoids leaking provider IPs publicly on-chain.
    pub endpoint_uri_hash: [u8; 32],
    /// SPL Token account holding the provider's bond.
    /// `Pubkey::default()` in W1 (no bond yet); populated by `deposit_bond`
    /// in W2.
    pub bond_vault: Pubkey,
    /// Number of jobs currently `Funded` / `Started`. 0 in W1.
    pub active_jobs: u64,
    /// Lifetime jobs completed (cumulative). 0 in W1.
    pub total_jobs: u64,
    /// Operational status. New providers start at `Active` in W1.
    pub status: ProviderStatus,
    /// Unix timestamp (seconds) when the provider account was created.
    pub registered_at: i64,
    /// PDA bump.
    pub bump: u8,
}

/// Provider operational state.
///
/// Append-only: never reorder or remove variants — borsh 1.x serialises
/// enums by ordinal (Anchor v1 migration guide §14).
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum ProviderStatus {
    /// Default for new providers; can accept new jobs.
    Active,
    /// Voluntarily paused; cannot accept new jobs (W2+).
    Paused,
    /// Punished for fraud; cannot accept new jobs (W3+).
    Slashed,
}
