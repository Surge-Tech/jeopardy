/** Formats a score as a plain number, preserving its sign. */
export function formatScore(n: number): string {
  return String(n);
}

/** Formats a score change with an explicit plus sign for positive values. */
export function formatScoreChange(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}
