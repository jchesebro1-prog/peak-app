/**
 * Daylite id derivation — the single source of truth.
 *
 * These were private to scripts/import-daylite.ts until 2026-09-22 (D180).
 * Every id the Daylite import produced is a pure function of a NAME, so any
 * later tooling that wants to find those records again has to hash names the
 * exact same way. A second copy that drifted by one character would not throw:
 * it would match zero rows and report a clean, successful, completely empty
 * run. Hence one module, imported by both.
 *
 * Do not "improve" norm() or hash() — 1,550 companies, 3,801 contacts and
 * their leads/projects are already stored under these ids in production.
 * Changing either function orphans all of them.
 */

/** Trim, lowercase, collapse internal whitespace. */
export const norm = (s: string): string =>
  (s || "").trim().toLowerCase().replace(/\s+/g, " ");

/** djb2, base36. Stable across runs and platforms. */
export function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

export const companyId = (name: string): string => "co-" + hash(norm(name));

export const contactId = (first: string, last: string, company: string): string =>
  "ct-" + hash(norm(first) + "|" + norm(last) + "|" + norm(company));

export const leadId = (name: string, company: string): string =>
  "L-dl-" + hash(norm(name) + "|" + norm(company));

export const projectId = (name: string, company: string): string =>
  "P-dl-" + hash(norm(name) + "|" + norm(company));

/** The base venue the import creates for a non-partner company. */
export const baseSiteId = (companyIdValue: string): string => `st-${companyIdValue}-1`;
