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
}
