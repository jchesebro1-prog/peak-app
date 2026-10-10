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
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function nameCore(name: string | null | undefined): string | null {
  const core = normalizeText(name).split(" ").filter((w) => w && !GENERIC.has(w)).join(" ");
  return core.length >= 4 ? core : null;
}

/** Venue-type words: a venue name is "Location — Type" (lib/venue-types), so "Main Stage", "Gym Stage" or
 *  "Black Box" name a kind of room every customer has, never one customer (final review #2). The editable
 *  venue-type list's labels are stripped too (passed in by buildMatchIndex). */
const VENUE_WORDS = new Set([
  "main", "stage", "campus", "gym", "gymnasium", "box", "black", "room", "hall", "studio", "theatre", "theater",
  "auditorium", "arena", "chapel", "sanctuary", "cafeteria", "cafetorium", "commons", "pac", "field", "house",
]);
/** Directions identify nothing on their own ("North"), but do inside a name ("Oshkosh North"). */
const DIRECTIONS = new Set(["north", "south", "east", "west"]);

/** The distinctive part of a venue name: generic and venue-type words stripped, a bare direction refused,
 *  < 4 chars refused. `typeWords` = the normalized words of the shop's venue-type labels. */
export function venueCore(name: string | null | undefined, typeWords: ReadonlySet<string> = new Set()): string | null {
  const words = normalizeText(name).split(" ").filter((w) => w && !GENERIC.has(w) && !VENUE_WORDS.has(w) && !typeWords.has(w));
  if (!words.length || words.every((w) => DIRECTIONS.has(w))) return null;
  const core = words.join(" ");
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
