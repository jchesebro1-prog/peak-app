/**
 * Customer Rewards — server-minted perk ids (#282 phase 4; moved here by the
 * perks+points follow-up so perks.ts and purchase-perks.ts can both mint
 * without importing each other). Pure and client-safe.
 */

/** "Free lift inspection!" → "free-lift-inspection" (≤ 32 chars, never empty). */
export function perkSlug(name: string): string {
  const s = String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
    .replace(/-+$/g, "");
  return s || "perk";
}

/**
 * A new perk id: `<slug>-<4 base36>`, never one in `taken` (every id ever
 * stored — live perks, tombstones and ids the ledger references).
 */
export function mintPerkId(name: string, taken: Set<string>, rand: () => number = Math.random): string {
  const slug = perkSlug(name);
  for (let i = 0; i < 50; i++) {
    const suffix = Math.floor(rand() * 36 ** 4)
      .toString(36)
      .padStart(4, "0")
      .slice(-4);
    const id = `${slug}-${suffix}`;
    if (!taken.has(id)) return id;
  }
  let n = 1;
  while (taken.has(`${slug}-${n}`)) n++;
  return `${slug}-${n}`;
}
