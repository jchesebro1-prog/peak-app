import type { Quote } from "@/lib/stores/quotes";
import type { KeyProduct, SpecItem, SpecSection } from "@/app/(app)/estimator/types";
import { latestSentRevision } from "@/lib/quote-pdf/state";
import { displayQuoteNumber } from "@/lib/estimate-number";
import { isRewardCreditItem } from "@/lib/rewards/credit-line";
import { applyAutoFreight } from "@/app/(app)/estimator/freight-default";
import {
  keyProductHeading,
  remapKeyProducts,
  resolveKeyProducts,
  sanitizeKeyProducts,
  withKeyProducts,
} from "@/app/(app)/estimator/narrative";

/**
 * #293 slice 2 — the system library: every system on a SENT or WON system
 * quote, read from that quote's latest sent revision (a won quote with no
 * sent revision uses its live spec). Computed, never curated — drafts,
 * post-send edits, lost quotes, Daylite history, service quotes and customer-built
 * portal quotes never appear. Pure and client-safe: the server index, the Load core, the
 * library modal and the harness all share it.
 */

export const LIBRARY_SNIPPET = 140;
export const LIBRARY_SEARCH_LIMIT = 50;
export const LIBRARY_QUERY_MAX = 200;
export const LIBRARY_GONE = "That estimate is no longer available";

export type LibraryKeyProduct = KeyProduct & { heading: string };

export type SystemLibraryEntry = {
  /** `${quoteId}:${rev|"live"}:${sectionId}` */
  key: string;
  quoteId: string;
  estNumber: string;
  quoteName: string;
  customer: string;
  status: "won" | "sent";
  /** The sent revision's `at`; won-without-send: the quote's updatedAt. */
  at: number;
  rev: number | null;
  sectionId: string;
  systemName: string;
  /** The section's narrative, trimmed. */
  intro: string;
  /** Resolved ("ok") blocks only, each with the heading it prints under. */
  keyProducts: LibraryKeyProduct[];
  lineCount: number;
  skus: string[];
  descs: string[];
  presentation: "itemized" | "narrative";
};

/** What the browser list gets: no intro, block text, skus or descriptions —
 *  140-char snippets and counts (spec §4.1). */
export type SystemLibraryHit = {
  key: string;
  quoteId: string;
  estNumber: string;
  quoteName: string;
  customer: string;
  status: "won" | "sent";
  at: number;
  rev: number | null;
  sectionId: string;
  systemName: string;
  lineCount: number;
  presentation: "itemized" | "narrative";
  introSnippet: string;
  keyProductCount: number;
  keyProductSnippets: Array<{ sku: string; heading: string; snippet: string }>;
};

export type LibrarySource = { spec: unknown; rev: number | null; at: number; status: "won" | "sent"; tierMargin: number | null };

/** Load system's answer (here, not in the "use server" file, so client
 *  components can name the type). */
export type LoadedLibrarySystem = {
  ok: true;
  section: SpecSection;
  systemName: string;
  estNumber: string;
  costsUpdated: number;
  tierRepriced: number;
  vendorLinesDropped: number;
};
export type LoadLibrarySystemResult = LoadedLibrarySystem | { ok: false; error: string };

/** Quotes a customer built in the portal (#245 catalog, #248 service, and
 *  the retired self-serve builder) — the same set portal-quote-names.ts
 *  calls customer-built, inlined because this module must stay client-safe.
 *  Their systems are the customer's picks, not Peak's work, so they never
 *  join the library (a default Jeff can reverse). */
const PORTAL_BUILT_SOURCES: ReadonlySet<string> = new Set(["portal-catalog", "portal-service", "portal-self-serve"]);

/** Which snapshot of this quote the library reads, or null when the quote
 *  isn't in the library. The Daylite test mirrors isImportedHistoryQuote
 *  (stores/quotes.ts) — inlined because this module must stay client-safe. */
export function librarySourceOf(q: Quote): LibrarySource | null {
  if (!q || typeof q !== "object") return null;
  if (q.source === "daylite") return null;
  if (typeof q.source === "string" && PORTAL_BUILT_SOURCES.has(q.source)) return null;
  if ((q.quoteType || "system") !== "system") return null;
  if (q.status !== "sent" && q.status !== "won") return null;
  const sent = latestSentRevision(Array.isArray(q.revisions) ? q.revisions : []);
  if (sent) return { spec: sent.spec, rev: sent.rev, at: sent.at, status: q.status, tierMargin: sent.tierMargin ?? null };
  if (q.status === "won") return { spec: q.spec, rev: null, at: q.updatedAt || 0, status: "won", tierMargin: q.tierMargin ?? null };
  return null;
}

function sectionsOf(spec: unknown): SpecSection[] {
  const secs = spec && typeof spec === "object" ? (spec as { sections?: unknown }).sections : null;
  if (!Array.isArray(secs)) return [];
  return secs.filter(
    (s): s is SpecSection => !!s && typeof s === "object" && typeof (s as SpecSection).id === "string" && Array.isArray((s as SpecSection).items)
  );
}

/** A system's lines without the Rewards credit (and without junk rows). */
function linesOf(sec: SpecSection): SpecItem[] {
  return sec.items.filter((it): it is SpecItem => !!it && typeof it === "object" && !isRewardCreditItem(it));
}

const distinct = (xs: string[]): string[] => [...new Set(xs.map((x) => x.trim()).filter(Boolean))];
const statusRank = (s: "won" | "sent"): number => (s === "won" ? 0 : 1);

export function systemLibraryEntries(quotes: Quote[], customerNames: ReadonlyMap<string, string>): SystemLibraryEntry[] {
  const out: SystemLibraryEntry[] = [];
  for (const q of Array.isArray(quotes) ? quotes : []) {
    const src = librarySourceOf(q);
    if (!src) continue;
    const customer = (q.customerId && customerNames.get(q.customerId)) || q.customer || "";
    const estNumber = displayQuoteNumber(q);
    for (const sec of sectionsOf(src.spec)) {
      if (sec.kind === "labor") continue;
      const items = linesOf(sec);
      if (!items.length) continue;
      const clean: SpecSection = { ...sec, items, keyProducts: sanitizeKeyProducts(sec.keyProducts) };
      const keyProducts = resolveKeyProducts(clean).flatMap((r) =>
        r.status === "ok" ? [{ lineKey: r.kp.lineKey, sku: r.kp.sku, text: r.kp.text, photo: r.kp.photo, heading: keyProductHeading(r.item) }] : []
      );
      out.push({
        key: `${q.id}:${src.rev ?? "live"}:${sec.id}`,
        quoteId: q.id,
        estNumber,
        quoteName: q.name || "",
        customer,
        status: src.status,
        at: src.at,
        rev: src.rev,
        sectionId: sec.id,
        systemName: typeof sec.name === "string" ? sec.name : "",
        intro: typeof sec.narrative === "string" ? sec.narrative.trim() : "",
        keyProducts,
        lineCount: items.length,
        skus: distinct(items.map((it) => (typeof it.sku === "string" ? it.sku : ""))),
        descs: distinct(items.map((it) => (typeof it.desc === "string" ? it.desc : ""))),
        presentation: sec.presentation === "narrative" ? "narrative" : "itemized",
      });
    }
  }
  // Stable: ties keep the input order (getAll is newest-first, then section order).
  return out.sort((a, b) => statusRank(a.status) - statusRank(b.status) || b.at - a.at);
}

/** Every token must match (case-insensitively) in the system name, customer,
 *  quote name, estimate number, a sku or a line description. Ranking: won
 *  before sent, newest first, then a system-name match before a lines-only one. */
export function searchSystemLibrary(
  entries: SystemLibraryEntry[],
  query: string,
  opts: { hasNarrative?: boolean; limit?: number } = {}
): SystemLibraryEntry[] {
  const tokens = String(query ?? "").slice(0, LIBRARY_QUERY_MAX).toLowerCase().split(/\s+/).filter(Boolean);
  const limit = Math.max(1, Math.floor(opts.limit ?? LIBRARY_SEARCH_LIMIT));
  const scored: Array<{ e: SystemLibraryEntry; i: number; n: number }> = [];
  (Array.isArray(entries) ? entries : []).forEach((e, i) => {
    if (opts.hasNarrative && !e.intro && !e.keyProducts.length) return;
    const name = e.systemName.toLowerCase();
    const hay = [name, e.customer, e.quoteName, e.estNumber, ...e.skus, ...e.descs].map((s) => s.toLowerCase());
    if (!tokens.every((t) => hay.some((h) => h.includes(t)))) return;
    scored.push({ e, i, n: tokens.some((t) => name.includes(t)) ? 0 : 1 });
  });
  scored.sort((a, b) => statusRank(a.e.status) - statusRank(b.e.status) || b.e.at - a.e.at || a.n - b.n || a.i - b.i);
  return scored.slice(0, limit).map((x) => x.e);
}

const snippet = (s: string): string => (s || "").replace(/\s+/g, " ").trim().slice(0, LIBRARY_SNIPPET);

export function toLibraryHit(e: SystemLibraryEntry): SystemLibraryHit {
  return {
    key: e.key,
    quoteId: e.quoteId,
    estNumber: e.estNumber,
    quoteName: e.quoteName,
    customer: e.customer,
    status: e.status,
    at: e.at,
    rev: e.rev,
    sectionId: e.sectionId,
    systemName: e.systemName,
    lineCount: e.lineCount,
    presentation: e.presentation,
    introSnippet: snippet(e.intro),
    keyProductCount: e.keyProducts.length,
    keyProductSnippets: e.keyProducts.map((k) => ({ sku: k.sku, heading: snippet(k.heading), snippet: snippet(k.text) })),
  };
}

const KEY_RE = /^(.{1,120}):(\d{1,6}|live):([^:]{1,120})$/;
export function parseLibraryKey(key: string): { quoteId: string; rev: number | null; sectionId: string } | null {
  const m = KEY_RE.exec(String(key ?? ""));
  if (!m) return null;
  return { quoteId: m[1], rev: m[2] === "live" ? null : Number(m[2]), sectionId: m[3] };
}

/**
 * The system Load copies, picked by the library rule AS OF NOW (a quote
 * re-sent since indexing loads its newest sent revision). Vendor-quote lines
 * are left out (their records hold job-specific files and terms, and count
 * against the per-estimate attachment budget) and counted; the Rewards
 * credit, blocks on dropped or missing lines, `room`, `clientGoals` and `coverText` (job-specific) go.
 */
export function librarySectionForLoad(
  q: Quote,
  sectionId: string
): { section: SpecSection; source: LibrarySource; vendorLinesDropped: number } | null {
  const source = librarySourceOf(q);
  if (!source) return null;
  const sec = sectionsOf(source.spec).find((s) => s.id === sectionId);
  if (!sec || sec.kind === "labor") return null;
  const items = linesOf(sec);
  if (!items.length) return null;
  const kept = items.filter((it) => !it.vendorQuoteId);
  const keptIds = new Set(kept.map((it) => String(it.id)));
  const base: SpecSection = { ...sec, items: kept };
  delete base.room;
  // #301 (R5): the client's goals and the cover paragraph were written for
  // another customer — the discipline (what the system is) travels.
  delete base.clientGoals;
  delete base.coverText;
  // Freight priced from another venue's drive miles (only portal-built
  // sections carry freightMiles) never travels: auto freight re-applies here.
  if ("freightMiles" in base) {
    delete base.freightMiles;
    base.freightAuto = true;
  }
  const kps = sanitizeKeyProducts(sec.keyProducts).filter((k) => keptIds.has(k.lineKey));
  return { section: withKeyProducts(base, kps), source, vendorLinesDropped: items.length - kept.length };
}

/** Client placement of a loaded system: a fresh section id, every line
 *  re-id'd through the Estimator's counter (ids are unique per section only),
 *  blocks remapped, and auto freight set to this estimate's default. */
export function placeLoadedSection(section: SpecSection, opts: { id: string; nextId: () => number; autoFreightPct: number }): SpecSection {
  const idMap = new Map<number, number>();
  const items = section.items.map((it) => {
    const nid = opts.nextId();
    idMap.set(it.id, nid);
    return { ...it, id: nid };
  });
  const [placed] = applyAutoFreight([{ ...section, id: opts.id, items }], { pct: opts.autoFreightPct });
  return withKeyProducts(placed, remapKeyProducts(section.keyProducts, idMap));
}

const plural = (n: number, w: string): string => `${n} ${w}${n === 1 ? "" : "s"}`;

export function loadNotice(r: Pick<LoadedLibrarySystem, "systemName" | "estNumber" | "costsUpdated" | "tierRepriced" | "vendorLinesDropped">): string {
  const parts = [`Loaded ${r.systemName || "Untitled system"} from ${r.estNumber}`];
  if (r.costsUpdated > 0) parts.push(`${plural(r.costsUpdated, "part")} updated to today's cost`);
  if (r.tierRepriced > 0) parts.push(`${plural(r.tierRepriced, "line")} re-priced to this estimate's tier`);
  if (r.vendorLinesDropped > 0) parts.push(`${plural(r.vendorLinesDropped, "vendor-quote line")} left out`);
  return parts.join(" · ");
}

export function libraryRowMeta(h: Pick<SystemLibraryHit, "customer" | "estNumber" | "status" | "at">): string {
  const date = new Date(h.at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Chicago" });
  return `${h.customer || "—"} · ${h.estNumber} · ${h.status === "won" ? "Won" : "Sent"} · ${date}`;
}

export function libraryRowCounts(h: Pick<SystemLibraryHit, "lineCount" | "keyProductCount">): string {
  return `${plural(h.lineCount, "line")} · ${plural(h.keyProductCount, "key product")}`;
}
