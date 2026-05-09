pub mod create_job;
pub mod register_provider;

// Glob re-exports — pull every public item from each instruction module
// (Accounts struct + the `*_handler` function + Anchor-generated client
// account structs `__client_accounts_*` and `__cpi_client_accounts_*`) up
// to crate root via lib.rs's `pub use instructions::*;`. Anchor's
// `#[program]` macro requires the generated structs to be reachable as
// `crate::__client_accounts_<ix_name>`.
//
// Per-module handler functions are named `<ix_name>_handler` to avoid
// collision when both modules glob-re-export.
pub use create_job::*;
pub use register_provider::*;
