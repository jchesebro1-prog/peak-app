// src/lib/meetings/names.ts
import type { KrispPerson } from "./types";

/** Words that never identify a customer on their own (spec §Matcher "Name cores"). */
const GENERIC = new Set([
  "school", "schools", "district", "dist", "public", "high", "middle", "elementary", "junior", "senior",
  "isd", "usd", "sd", "hs", "ms", "area", "unified", "independent", "community", "college", "university",
  "city", "church", "theatre", "theater", "center", "centre", "pac", "auditorium", "performing", "arts",
  "inc", "llc", "co", "company", "corp", "the", "of", "and",
]);

export function normalizeText(s: string | null | undefined): string {
  return (s || "")
    .toLowerCase()
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function nameCore(name: string | null | undefined): string | null {
  const core = normalizeText(name).split(" ").filter((w) => w && !GENERIC.has(w)).join(" ");
  return core.length >= 4 ? core : null;
}

export function hitsCore(text: string | null | undefined, core: string): boolean {
  return (" " + normalizeText(text) + " ").includes(" " + core + " ");
}

export function personName(p: { firstName?: string | null; lastName?: string | null; name?: string | null } | KrispPerson): string {
  const anyP = p as { firstName?: string | null; lastName?: string | null; name?: string | null };
  const full = [anyP.firstName, anyP.lastName].filter(Boolean).join(" ").trim();
  return full || (anyP.name || "").trim();
}
