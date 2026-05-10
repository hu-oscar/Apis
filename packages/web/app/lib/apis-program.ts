// Barrel re-export over the Codama-generated apis_program client.
//
// Regenerate via: `pnpm codama:generate` (reads
// ../program/target/idl/apis_program.json, writes
// ./generated/apis-program/src/generated/).
//
// Consumers import everything they need from `@/lib/apis-program`:
//
//   import {
//     APIS_PROGRAM_PROGRAM_ADDRESS,
//     getRegisterProviderInstructionAsync,
//     getCreateJobInstructionAsync,
//     fetchProvider,
//     fetchJob,
//     findProviderPda,
//     findJobPda,
//   } from "@/lib/apis-program";

export * from "./generated/apis-program/src/generated";
