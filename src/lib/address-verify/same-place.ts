/** Pure (no imports) — shared by the venue geocode gates (geo-backfill) and
 *  the free-text verification rule (state.ts). */

/**
 * Compare place names the way a human would. Lowercase, drop the
 * "City of" / "Town of" / "Village of" prefixes Nominatim sometimes prepends
 * to a perfectly good match, then strip everything that isn't a letter or a
 * digit — so "LaCrosse" == "La Crosse" and "St. Paul" == "St Paul".
 *
 * Deliberately an EXACT comparison after normalizing, never a prefix test:
 * "Portage County" starts with "Portage" and is 64 miles from the City of
 * Portage. That near-miss is the whole reason this gate exists.
 */
export function samePlace(a: string | null | undefined, b: string | null | undefined): boolean {
  const norm = (s: string | null | undefined) =>
    (s || "")
      .trim()
      .toLowerCase()
      .replace(/^(city|town|village|township) of\s+/, "")
      // Expand the abbreviations place names are written with before the
      // punctuation is stripped, or "Mt. Horeb" never equals "Mount Horeb"
      // and "St. Cloud" never equals "Saint Cloud". The #147 run rejected
      // five perfectly good matches on exactly this.
      .replace(/\bmt\.?\s+/g, "mount ")
      .replace(/\bst\.?\s+/g, "saint ")
      .replace(/\bft\.?\s+/g, "fort ")
      .replace(/[^a-z0-9]/g, "");
  const x = norm(a);
  const y = norm(b);
  return !!x && !!y && x === y;
}
