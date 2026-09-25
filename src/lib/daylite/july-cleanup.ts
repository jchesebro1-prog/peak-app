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
import { DOC_TABLES, blobs, type CollectionName } from "@/db/doc-tables";
import { appSettings, companies, contacts, customerDomains, sites } from "@/db/schema";
import { allCompanies } from "@/lib/identity/companies";
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
  // Numbers only — the same test the retirement UPDATE's SQL guard applies
  // (jsonb_typeof = 'number'); a string timestamp is never "untouched".
  const c = doc.createdAt;
  const u = doc.updatedAt;
  return typeof c === "number" && typeof u === "number" && Number.isFinite(c) && Number.isFinite(u) && u - c < UNTOUCHED_MS;
}

/**
 * Spec-harness seam ONLY: runs just before each guarded retirement UPDATE so a
 * test can change a record between the decision and the write (the "changed
 * since the preview" path). Never set in app code, and ignored outright when
 * NODE_ENV is "production".
 */
export const __julyTestHooks: { beforeRetire?: (coll: "projects" | "leads" | "companies", ids: string[]) => Promise<void> } = {};

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
      // jsonb values (not ->> text), so isUntouched sees real numbers.
      createdAt: sql<unknown>`${t.doc}->'createdAt'`,
      updatedAt: sql<unknown>`${t.doc}->'updatedAt'`,
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
 * Reference scan — shared by July records and combined-name companies
 * ------------------------------------------------------------------------- */

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** An id as a whole token: not part of a longer id (`st-co-x-1` ≠ `co-x`, `co-xy` ≠ `co-x`), but a `co-x|loc1` key still counts. */
const tokenRe = (token: string) => new RegExp(`(?<![A-Za-z0-9_-])${escapeRe(token)}(?![A-Za-z0-9_-])`);

/** Does `text` mention `id` as a whole id (see tokenRe)? Exported for the spec harness. */
export function mentionsId(text: string, id: string): boolean {
  return tokenRe(id).test(text);
}

/** "used by tasks T-1, notes N-2 (+3 more)" */
function usedBy(where: string[]): string {
  const shown = where.slice(0, 3).join(", ");
  return `used by ${shown}${where.length > 3 ? ` (+${where.length - 3} more)` : ""}`;
}

/**
 * Every live doc — in ANY doc table, plus the settings / blobs singletons —
 * that mentions one of the tokens, attributed to the token's owner id. A
 * fixed number of queries however many tokens: one per table, each a regex
 * alternation of all the tokens (groups of 150, OR-ed, to stay inside
 * Postgres's regex size limits) so each document's text is scanned once per
 * group — a LIKE ANY of N patterns would scan it N times (heavy on the 37k-row
 * catalog and the multi-MB plan sheets). The SQL match is a superset
 * (substring); the JS token regex is the precise test.
 *
 * `skipSelf` ignores a doc whose own id IS the owner (every doc stores its
 * id). `exclude` drops docs from the scan (the preview uses it for July
 * records the same import will already have retired).
 */
async function findDocReferences(
  tokenOwner: Map<string, string>,
  opts: { skipSelf?: boolean; exclude?: Partial<Record<CollectionName, ReadonlySet<string>>> } = {}
): Promise<Map<string, string[]>> {
  const refs = new Map<string, string[]>();
  const tokens = [...tokenOwner.keys()];
  if (!tokens.length) return refs;
  const db = await getDb();
  const groups: string[] = [];
  for (let i = 0; i < tokens.length; i += 150) groups.push(tokens.slice(i, i + 150).map(escapeRe).join("|"));
  const mentions = (text: SQL) => sql`(${sql.join(groups.map((g) => sql`${text} ~ ${g}`), sql` or `)})`;

  const tables = Object.entries(DOC_TABLES) as Array<[CollectionName, (typeof DOC_TABLES)[CollectionName]]>;
  const [docHits, blobHits, settingHits] = await Promise.all([
    Promise.all(
      tables.map(async ([coll, t]) => {
        const rows = await db
          .select({ id: t.id, text: sql<string>`${t.doc}::text` })
          .from(t)
          .where(and(eq(t.deleted, false), mentions(sql`${t.doc}::text`)));
        return rows.filter((r) => !opts.exclude?.[coll]?.has(r.id)).map((r) => ({ id: r.id, where: `${coll} ${r.id}`, text: r.text }));
      })
    ),
    db.select({ id: blobs.id, text: sql<string>`${blobs.data}::text` }).from(blobs).where(mentions(sql`${blobs.data}::text`)),
    db
      .select({ id: appSettings.id, text: sql<string>`${appSettings.data}::text` })
      .from(appSettings)
      .where(mentions(sql`${appSettings.data}::text`)),
  ]);
  const hits = [
    ...docHits.flat(),
    ...blobHits.map((r) => ({ id: r.id, where: `blob ${r.id}`, text: r.text })),
    ...settingHits.map((r) => ({ id: r.id, where: `settings ${r.id}`, text: r.text })),
  ];
  // Only tokens that occur in the text at all are regex-tested precisely.
  for (const h of hits) {
    const owners = new Set<string>();
    for (const t of tokens) {
      const owner = tokenOwner.get(t)!;
      if (opts.skipSelf && h.id === owner) continue;
      if (h.text.includes(t) && tokenRe(t).test(h.text)) owners.add(owner);
    }
    for (const o of owners) {
      const list = refs.get(o);
      if (list) list.push(h.where);
      else refs.set(o, [h.where]);
    }
  }
  return refs;
}

/**
 * Task 12b fix — "untouched" timestamps don't see links from OTHER records (a
 * task's projectId, a note's parent, an inbox thread's lead). Before any July
 * project or lead is retired, this scan finds what still points at it; a hit
 * keeps the record (treated like an edited one) with the reason. No
 * relational table holds project or lead ids (schema.ts), so the doc tables
 * and the singletons are the whole search space.
 */
export async function julyReferences(
  ids: string[],
  exclude?: Partial<Record<CollectionName, ReadonlySet<string>>>
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!ids.length) return out;
  const refs = await findDocReferences(new Map(ids.map((id) => [id, id])), { skipSelf: true, exclude });
  for (const [id, where] of refs) out.set(id, usedBy(where));
  return out;
}

/**
 * Soft-delete July records — re-checking every condition INSIDE the UPDATE
 * (still live, still no daylite marker, still untouched) so a record edited
 * after the preview/decision is never retired. Returns the ids actually
 * retired (the caller reports the rest as changed since the check). Also never
 * a record carrying a `quoteId`. The row change matches softDeleteDoc (deleted, rev + 1,
 * updatedAt/receivedAt; seq re-drawn by the update trigger).
 */
export async function retireUntouchedJuly(coll: "projects" | "leads", ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  const db = await getDb();
  const t = DOC_TABLES[coll];
  const now = Date.now();
  const done: string[] = [];
  if (process.env.NODE_ENV !== "production") await __julyTestHooks.beforeRetire?.(coll, ids);
  for (let i = 0; i < ids.length; i += 500) {
    const rows = await db
      .update(t)
      .set({ deleted: true, rev: sql`${t.rev} + 1`, updatedAt: now, receivedAt: now })
      .where(
        and(
          inArray(t.id, ids.slice(i, i + 500)),
          eq(t.deleted, false),
          sql`coalesce(${t.doc}->'source'->>'system', '') <> 'daylite'`,
          // Never a record a won quote links — that would orphan the quote
          // and make syncProjectsFromQuotes spawn a second project.
          sql`coalesce(${t.doc}->>'quoteId', '') = ''`,
          sql`(case when jsonb_typeof(${t.doc}->'createdAt') = 'number' and jsonb_typeof(${t.doc}->'updatedAt') = 'number'
                then (${t.doc}->>'updatedAt')::numeric - (${t.doc}->>'createdAt')::numeric < ${UNTOUCHED_MS}
                else false end)`
        )
      )
      .returning({ id: t.id });
    done.push(...rows.map((r) => r.id));
  }
  return done;
}

/**
 * The July leads finalize retires: live, untouched, and nothing else pointing
 * at them (an inbox thread, a note, a quote…). Edited and referenced ones are
 * kept; referenced ones carry the reason. Preview and finalize both use this.
 */
export async function julyLeadPlan(): Promise<{
  retire: string[];
  edited: string[];
  referenced: Array<{ id: string; reason: string }>;
}> {
  const { untouched, edited } = await julyLeads();
  const refs = await julyReferences(untouched);
  return {
    retire: untouched.filter((id) => !refs.has(id)),
    edited,
    referenced: untouched.filter((id) => refs.has(id)).map((id) => ({ id, reason: refs.get(id)! })),
  };
}

/* ---------------------------------------------------------------------------
 * Combined-name companies (§4)
 * ------------------------------------------------------------------------- */

export type JunkCompany = { id: string; name: string };
export type JunkKept = JunkCompany & { reason: string };

/**
 * Every live, UNTOUCHED company whose name has a comma and is made entirely of
 * OTHER live companies' names (≥2), then — in a fixed handful of queries,
 * however many candidates — everything that still references each one:
 *   - a live contact whose home company it is;
 *   - a live venue other than its own auto base venue (`baseSiteId(id)`);
 *   - a customer_domains row;
 *   - any live doc, in ANY doc table, that mentions its id or its base
 *     venue's id, plus the settings / blobs singletons (findDocReferences).
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
    // Someone edited it in Quartzite → not the July script's stub any more.
    if (!(c.updatedAt - c.createdAt < UNTOUCHED_MS)) continue;
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

  for (const [co, where] of await findDocReferences(tokenOwner, { exclude })) why(co, usedBy(where));

  const retire: JunkCompany[] = [];
  const kept: JunkKept[] = [];
  for (const c of candidates) {
    const r = reasons.get(c.id);
    if (r) kept.push({ ...c, reason: r.join("; ") });
    else retire.push(c);
  }
  return { retire, kept };
}

/**
 * Soft-delete the scan's unreferenced stubs and their base venues. Venues go
 * FIRST, so a failure between the two statements leaves a live company whose
 * venue is already gone — still a candidate, so a retry finishes the job (the
 * other order would strand a live base venue under a deleted company). Both
 * UPDATEs re-check the company is still live and untouched.
 */
export async function retireJunkCompanies(retire: JunkCompany[]): Promise<string[]> {
  const ids = retire.map((c) => c.id);
  if (!ids.length) return [];
  if (process.env.NODE_ENV !== "production") await __julyTestHooks.beforeRetire?.("companies", ids);
  const done: string[] = [];
  const db = await getDb();
  const t = Date.now();
  const stillStub = (batch: string[]) =>
    and(inArray(companies.id, batch), eq(companies.deleted, false), sql`${companies.updatedAt} - ${companies.createdAt} < ${UNTOUCHED_MS}`);
  for (let i = 0; i < ids.length; i += 500) {
    const batch = ids.slice(i, i + 500);
    await db
      .update(sites)
      .set({ deleted: true, updatedAt: t })
      .where(
        and(
          eq(sites.deleted, false),
          inArray(sites.companyId, db.select({ id: companies.id }).from(companies).where(stillStub(batch)))
        )
      );
    const rows = await db
      .update(companies)
      .set({ deleted: true, updatedAt: t })
      .where(stillStub(batch))
      .returning({ id: companies.id });
    done.push(...rows.map((r) => r.id));
  }
  return done;
}
