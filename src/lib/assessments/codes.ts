/* Assessments engine (#337) — short codes for printed finding ids (MPSD-LIN-RIG-003). Pure. */

/** 2–6 characters of A–Z / 0–9. */
export const CODE_RE = /^[A-Z0-9]{2,6}$/;

const FILLER = new Set(["the", "of", "st", "saint"]);

/** Alphanumeric words of a name; apostrophes join ("Mary's" → "Marys"), everything else separates. */
function words(name: string): string[] {
  return name.replace(/['’]/g, "").split(/[^A-Za-z0-9]+/).filter(Boolean);
}

/** Pads a too-short base with X so the result always satisfies CODE_RE. */
function fit(base: string, min = 2): string {
  const b = base.toUpperCase().slice(0, 6);
  return b.length >= min ? b : b.padEnd(min, "X");
}

/** Initials of the company name, uppercased, 2–6 characters. A single word falls back to its first three letters. */
export function suggestCompanyCode(name: string): string {
  const ws = words(name);
  if (ws.length <= 1) return fit((ws[0] ?? "").slice(0, 3));
  return fit(ws.map((w) => w[0]).join(""));
}

/** First three letters of the first meaningful word of the venue's location name (the, of, st, saint skipped). */
export function suggestSiteCode(locationName: string): string {
  const ws = words(locationName);
  const w = ws.find((x) => !FILLER.has(x.toLowerCase())) ?? ws[0] ?? "VEN";
  return fit(w.slice(0, 3));
}

/** LIN → LIN2 → LIN3…; the base is truncated so the result stays ≤ 6 characters. */
export function withCollisionSuffix(code: string, taken: Set<string>): string {
  if (!taken.has(code)) return code;
  for (let n = 2; n < 100_000; n++) {
    const suffix = String(n);
    const cand = code.slice(0, Math.max(1, 6 - suffix.length)) + suffix;
    if (!taken.has(cand)) return cand;
  }
  throw new Error("No free short code");
}
