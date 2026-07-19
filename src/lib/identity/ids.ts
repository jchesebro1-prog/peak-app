/**
 * Id minting for identity rows (D85). Matches the project-subrecord uid
 * convention: short prefix + 6-char base36. Converter rows use deterministic
 * ids instead (see convert.ts) so re-runs stay idempotent.
 */
export function mintId(prefix: string): string {
  let s = "";
  for (let i = 0; i < 6; i++) s += Math.floor(Math.random() * 36).toString(36);
  return `${prefix}-${s}`;
}
