/**
 * Superseding the July Daylite import — the record-level rules (Task 12b).
 *
 * `scripts/import-daylite.ts` ran in July 2026 and wrote cruder records: a
 * `P-dl-*` project per Projects row (service calls and cancelled jobs
 * included), an `L-dl-*` lead per opportunity, and a stub company for every
 * raw Companies cell not in the book — multi-company cells included, so the
 * book holds "combined-name" companies such as "C.D. Smith Construction,
 * Muermann Engineering". Jeff decided (2026-09-24) the history import
 * replaces the July projects, removes the July leads and retires those stubs.
 *
 * Only records the July script wrote AND nobody has touched since may be
 * replaced or removed; every removal is a soft delete. Design spec §4.6.
 *
 * This module holds the pieces that don't need the import plan: what counts
 * as a July record, the July leads, and the combined-name company scan. The
 * per-row project decisions live in ./history-commit (they need the plan).
 */

import { and, eq, inArray, like, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/db";
import { softDeleteDocs } from "@/db/doc-store";
import { DOC_TABLES, blobs, type CollectionName } from "@/db/doc-tables";
import { appSettings, contacts, customerDomains, sites } from "@/db/schema";
import { allCompanies, softDeleteCompanies } from "@/lib/identity/companies";
import { junkCompanyParts } from "./history";
import { baseSiteId, norm } from "./ids";

/** "Untouched": updated less than a minute after it was created. */
export const UNTOUCHED_MS = 60_000;

/**
 * A July record: its id carries the July prefix and it has NO
 * `source.system === "daylite"` marker — the history import always writes
 * one on the projects it makes; the July script never did.
 */
export function isJulyRecord(prefix: "P-dl-" | "L-dl-", doc: { id: string; source?: unknown }): boolean {
  if (!doc.id.startsWith(prefix)) return false;
  const src = doc.source;
  return !(src && typeof src === "object" && (src as { system?: unknown }).system === "daylite");
}

/** Doc-level timestamps: nobody edited it after the July script wrote it. */
export function isUntouched(doc: Record<string, unknown>): boolean {
  const c = Number(doc.createdAt);
  const u = Number(doc.updatedAt);
  return Number.isFinite(c) && Number.isFinite(u) && u - c < UNTOUCHED_MS;
}

/* ---------------------------------------------------------------------------
 * July leads (§3)
 * ------------------------------------------------------------------------- */

/**
 * Live July leads split by whether anyone has touched them. Reads three JSON
 * fields per row, not whole documents — there are ~1,700 of them.
 */
export async function julyLeads(): Promise<{ untouched: string[]; edited: string[] }> {
  const db = await getDb();
  const t = DOC_TABLES.leads;
  const rows = await db
    .select({
      id: t.id,
      createdAt: sql<string | null>`${t.doc}->>'createdAt'`,
      updatedAt: sql<string | null>`${t.doc}->>'updatedAt'`,
      system: sql<string | null>`${t.doc}->'source'->>'system'`,
    })
    .from(t)
    .where(and(eq(t.deleted, false), like(t.id, "L-dl-%")));
  const untouched: string[] = [];
  const edited: string[] = [];
  for (const r of rows) {
    if (r.system === "daylite") continue;
    (isUntouched(r) ? untouched : edited).push(r.id);
  }
  return { untouched: untouched.sort(), edited: edited.sort() };
}

/** Live July projects still in the data (untouched or edited). */
export async function countLiveJulyProjects(): Promise<number> {
  const db = await getDb();
  const t = DOC_TABLES.projects;
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(t)
    .where(
      and(
        eq(t.deleted, false),
        like(t.id, "P-dl-%"),
        sql`coalesce(${t.doc}->'source'->>'system', '') <> 'daylite'`
      )
    );
  return Number(rows[0]?.n ?? 0);
}

/* ---------------------------------------------------------------------------
 * Combined-name companies (§4)
 * ------------------------------------------------------------------------- */

export type JunkCompany = { id: string; name: string };
export type JunkKept = JunkCompany & { reason: string };

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** An id as a whole token: not part of a longer id (`st-co-x-1` ≠ `co-x`), but a `co-x|loc1` key still counts. */
const tokenRe = (token: string) => new RegExp(`(?<![A-Za-z0-9_-])${escapeRe(token)}(?![A-Za-z0-9_-])`);

/**
 * Every live company whose name has a comma and is made entirely of OTHER
 * live companies' names (≥2), then — in a fixed handful of queries, however
 * many candidates — everything that still references each one:
 *   - a live contact whose home company it is;
 *   - a live venue other than its own auto base venue (`baseSiteId(id)`);
 *   - a customer_domains row;
 *   - any live doc, in ANY doc table, that mentions its id or its base
 *     venue's id (one query per table, all candidates at once), plus the
 *     settings / blobs singletons.
 * `exclude` drops docs from the scan — the preview uses it for July records
 * the same import will already have retired or replaced.
 */
export async function scanJunkCompanies(
  exclude: Partial<Record<CollectionName, ReadonlySet<string>>> = {}
): Promise<{ retire: JunkCompany[]; kept: JunkKept[] }> {
  const all = await allCompanies();
  const idsByName = new Map<string, string[]>();
  for (const c of all) {
    const k = norm(c.name);
    const list = idsByName.get(k);
    if (list) list.push(c.id);
    else idsByName.set(k, [c.id]);
  }
  const candidates: JunkCompany[] = [];
  for (const c of all) {
    if (!c.name.includes(",")) continue;
    const parts = junkCompanyParts(c.name, (n) => (idsByName.get(norm(n)) || []).some((id) => id !== c.id));
    if (parts) candidates.push({ id: c.id, name: c.name });
  }
  if (!candidates.length) return { retire: [], kept: [] };

  const ids = candidates.map((c) => c.id);
  const reasons = new Map<string, string[]>();
  const why = (id: string, text: string) => {
    const list = reasons.get(id);
    if (list) list.push(text);
    else reasons.set(id, [text]);
  };

  const db = await getDb();
  const [contactRows, siteRows, domainRows] = await Promise.all([
    db
      .select({ co: contacts.homeCompanyId })
      .from(contacts)
      .where(and(eq(contacts.deleted, false), inArray(contacts.homeCompanyId, ids))),
    db
      .select({ id: sites.id, co: sites.companyId, legacy: sites.legacyLocId })
      .from(sites)
      .where(and(eq(sites.deleted, false), inArray(sites.companyId, ids))),
    db.select({ co: customerDomains.customerId }).from(customerDomains).where(inArray(customerDomains.customerId, ids)),
  ]);

  const tally = (rows: Array<{ co: string | null }>) => {
    const n = new Map<string, number>();
    for (const r of rows) if (r.co) n.set(r.co, (n.get(r.co) || 0) + 1);
    return n;
  };
  for (const [co, n] of tally(contactRows)) why(co, `${n} contact${n === 1 ? "" : "s"}`);
  for (const [co, n] of tally(domainRows)) why(co, `${n} linked email domain${n === 1 ? "" : "s"}`);

  // Tokens a doc may carry: each candidate's id, and its base venue's doc id
  // (legacyLocId when set — what docs store as locationId).
  const tokenOwner = new Map<string, string>();
  for (const id of ids) tokenOwner.set(id, id);
  const otherVenues = new Map<string, number>();
  for (const s of siteRows) {
    if (s.id === baseSiteId(s.co)) {
      tokenOwner.set(s.legacy ?? s.id, s.co);
      if (s.legacy) tokenOwner.set(s.id, s.co);
    } else {
      otherVenues.set(s.co, (otherVenues.get(s.co) || 0) + 1);
    }
  }
  for (const [co, n] of otherVenues) why(co, `${n} other venue${n === 1 ? "" : "s"}`);

  const tokens = [...tokenOwner.keys()];
  const matchers = tokens.map((t) => ({ owner: tokenOwner.get(t)!, re: tokenRe(t) }));
  // A regex alternation of the tokens, so Postgres scans each document's
  // text once per group (a LIKE ANY of N patterns scans it N times — heavy on the
  // 37k-row catalog and the multi-MB plan sheets). A substring match is a
  // superset; the JS token regex below is the precise test.
  // Alternations are capped at 150 tokens each (OR-ed) to stay well inside
  // Postgres's regex size limits however many stubs the book holds.
  const groups: string[] = [];
  for (let i = 0; i < tokens.length; i += 150) groups.push(tokens.slice(i, i + 150).map(escapeRe).join("|"));
  const mentions = (text: SQL) => sql.join(groups.map((g) => sql`${text} ~ ${g}`), sql` or `);

  // One query per doc table, every candidate at once.
  const docRefs = new Map<string, string[]>();
  const tables = Object.entries(DOC_TABLES) as Array<[CollectionName, (typeof DOC_TABLES)[CollectionName]]>;
  const docHits = await Promise.all(
    tables.map(async ([coll, t]) => {
      const rows = await db
        .select({ id: t.id, text: sql<string>`${t.doc}::text` })
        .from(t)
        .where(and(eq(t.deleted, false), sql`(${mentions(sql`${t.doc}::text`)})`));
      return rows.filter((r) => !exclude[coll]?.has(r.id)).map((r) => ({ where: `${coll} ${r.id}`, text: r.text }));
    })
  );
  const singletonHits = await Promise.all([
    db
      .select({ id: blobs.id, text: sql<string>`${blobs.data}::text` })
      .from(blobs)
      .where(mentions(sql`${blobs.data}::text`)),
    db
      .select({ id: appSettings.id, text: sql<string>`${appSettings.data}::text` })
      .from(appSettings)
      .where(mentions(sql`${appSettings.data}::text`)),
  ]);
  const hits = [
    ...docHits.flat(),
    ...singletonHits[0].map((r) => ({ where: `blob ${r.id}`, text: r.text })),
    ...singletonHits[1].map((r) => ({ where: `settings ${r.id}`, text: r.text })),
  ];
  for (const h of hits) {
    const owners = new Set(matchers.filter((m) => m.re.test(h.text)).map((m) => m.owner));
    for (const co of owners) {
      const list = docRefs.get(co);
      if (list) list.push(h.where);
      else docRefs.set(co, [h.where]);
    }
  }
  for (const [co, where] of docRefs) {
    const shown = where.slice(0, 3).join(", ");
    why(co, `used by ${shown}${where.length > 3 ? ` (+${where.length - 3} more)` : ""}`);
  }

  const retire: JunkCompany[] = [];
  const kept: JunkKept[] = [];
  for (const c of candidates) {
    const r = reasons.get(c.id);
    if (r) kept.push({ ...c, reason: r.join("; ") });
    else retire.push(c);
  }
  return { retire, kept };
}

/** Soft-delete the scan's unreferenced stubs (and with them their base venues). */
export async function retireJunkCompanies(retire: JunkCompany[]): Promise<void> {
  await softDeleteCompanies(retire.map((c) => c.id));
}

/** Soft-delete the given July leads — the leads store's own remove() is softDeleteDoc. */
export async function retireJulyLeads(ids: string[]): Promise<void> {
  await softDeleteDocs("leads", ids);
}
