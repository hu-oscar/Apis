use anchor_lang::prelude::*;

/// Per-job escrow + lifecycle account.
///
/// PDA seeds: `[b"job", buyer.key().as_ref(), id.to_le_bytes().as_ref()]`
///
/// W1: created with `status = Created`, `price_lamports_usdc = 0` (no
/// escrow yet), `completion_proof_hash = None`. W2 will transition
/// `create_job` to lock USDC into an `EscrowVault` SPL token account and
/// set `status = Funded` directly (skipping `Created`); the `Created`
/// variant remains for reserved-historical purposes only.
///
/// Tech Design §3 names the buyer field `client` and the id field `nonce`;
/// Apis product copy uses `buyer` and `id`. Same on-chain bytes either way.
#[account]
#[derive(InitSpace)]
pub struct Job {
    /// Buyer-supplied unique nonce so the same buyer can submit many jobs.
    pub id: u64,
    /// The wallet paying for the job.
    pub buyer: Pubkey,
    /// The provider PDA chosen for the job.
    pub provider: Pubkey,
    /// Price in USDC base units (6 decimals). 0 in W1 (no escrow).
    pub price_lamports_usdc: u64,
    /// sha256 of the full JobSpec JSON: prompt + model + scheduler + steps
    /// + guidance_scale + seed + dtype + resolution + cuda/torch/diffusers
    /// versions + gpu_arch_class. Per Research §4 this is what verification
    /// reproduces — NOT just the prompt.
    pub spec_hash: [u8; 32],
    /// Lifecycle state. W1 only ever sets `Created`. W2/W3 transition
    /// through the remaining variants.
    pub status: JobStatus,
    /// Unix timestamp (seconds) at job creation. Tech Design §3 names this
    /// `funded_at` because in W2 escrow is locked at the same instant.
    pub funded_at: i64,
    /// Unix timestamp (seconds) after which `auto_release` becomes valid
    /// (W2). In W1 we still set this so the field is initialised.
    pub deadline: i64,
    /// sha256 of the provider-signed completion artifact. `None` until the
    /// provider calls `submit_completion` (W2).
    pub completion_proof_hash: Option<[u8; 32]>,
    /// PDA bump.
    pub bump: u8,
}

/// Job lifecycle state.
///
/// Append-only: never reorder or remove variants — borsh 1.x serialises
/// enums by ordinal (Anchor v1 migration guide §14). Inserting a variant
/// in the middle would shift every subsequent ordinal and invalidate
/// every existing `Job` account.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum JobStatus {
    /// W1 only: created, no USDC locked yet.
    Created,
    /// W2: USDC locked into EscrowVault; awaiting provider acceptance.
    Funded,
    /// W2: provider has called `accept_job`.
    Started,
    /// W2: provider has called `submit_completion`.
    Completed,
    /// W3: dispute raised; resolution pending.
    Disputed,
    /// W3: refunded after dispute resolution or cancel.
    Refunded,
    /// W3: provider was slashed; payout split per protocol policy.
    Slashed,
}
