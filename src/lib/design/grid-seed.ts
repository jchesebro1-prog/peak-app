/**
 * Seed placeholders (#38 Task 2, D149) — what is LEFT of the old "generate
 * starting layout" seeder. The seeder itself — the per-dims placement
 * generator and its server action — is gone: the Auto intake's catalog-backed
 * fill (#GEM, grid-auto-fill.ts) replaced it, as D186 planned. These helpers
 * stay because a preview deploy may have written placeholder placements
 * (D186), and the quote guard, the editor and the drawing set still
 * recognise them.
 */

/** Non-catalog placeholder prefix — never resolves against the catalog. */
export const SEED_PART_PREFIX = "grid-seed:";

export function seedPlaceholderPartId(key: string): string {
  return `${SEED_PART_PREFIX}${key}`;
}

/** True for any placement carrying a seed placeholder id. */
export function isSeedPlaceholder(partId: string): boolean {
  return partId.startsWith(SEED_PART_PREFIX);
}
