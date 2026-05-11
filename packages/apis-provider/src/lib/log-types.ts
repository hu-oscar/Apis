// Shared types for log entries emitted by the Tauri Rust side and
// parsed by the React UI. Kept in its own module so non-React modules
// (event-parser.ts) can import without pulling in App.tsx.

export type LogEntry = {
  stream: "stdout" | "stderr";
  line: string;
  at: number;
};
