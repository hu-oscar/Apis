// Terminal output helpers — Sprint 4.0g.
//
// Tiny ANSI color + section header helpers so the agent CLI output
// matches the Cyberpunk Swarm aesthetic of the rest of the app:
// Solana green for success, neon violet for headers, red for errors.
// No new deps — raw escape sequences. Falls back to no color when
// stdout isn't a TTY (e.g. CI logs).

const isTTY = process.stdout.isTTY ?? false;

const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[38;5;48m", // approximation of #14F195
  violet: "\x1b[38;5;141m", // approximation of #9945FF
  red: "\x1b[38;5;203m",
  yellow: "\x1b[38;5;221m",
  white: "\x1b[37m",
  gray: "\x1b[90m",
};

function wrap(code: string, text: string): string {
  if (!isTTY) return text;
  return `${code}${text}${ANSI.reset}`;
}

export const c = {
  green: (t: string) => wrap(ANSI.green, t),
  violet: (t: string) => wrap(ANSI.violet, t),
  red: (t: string) => wrap(ANSI.red, t),
  yellow: (t: string) => wrap(ANSI.yellow, t),
  bold: (t: string) => wrap(ANSI.bold, t),
  dim: (t: string) => wrap(ANSI.dim, t),
  gray: (t: string) => wrap(ANSI.gray, t),
};

/** Numbered step header. Used like:
 *    step(1, 5, "Browsing /network…")  →  "[1/5] Browsing /network…"
 *  Colored green when stdout is a TTY. */
export function step(n: number, total: number, label: string): string {
  const tag = c.green(`[${n}/${total}]`);
  return `${tag} ${label}`;
}

/** A single line of indented status under a step header. */
export function indent(text: string): string {
  return `      ${text}`;
}

/** Pretty divider — used to fence off the final summary. */
export function rule(): string {
  return c.dim("─".repeat(64));
}

/** Format elapsed milliseconds as "Nm Xs" or "Xs". */
export function formatElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
