import { listDocsByField, searchDocs, type Doc } from "@/db/doc-store";
import {
  displayLeadNumber,
  displayQuoteNumber,
  leadNumberMatches,
  parseEstimateNumber,
  quoteSearchRank,
  quoteMatchesSearch,
  quoteNumberMatches,
  type QuoteNumberFields,
} from "@/lib/estimate-number";
import { quotesByPartialNumber } from "@/lib/stores/estimate-numbers";
import { getMany as getQuotesByIds } from "@/lib/stores/quotes";
import type { Party } from "@/lib/parties/rules";
import { allCompanies, getCompanies } from "@/lib/identity/companies";
import { allContacts, displayName, emailsForContacts } from "@/lib/identity/contacts";
import { partSearchHaystack, staffPartLabel, type SearchPartLike } from "@/lib/catalog-rename/sku";

/**
 * Global nav search (⌘K) — port of Nav.dc.html's search sources:
 * quotes, companies + people
 * (the identity core, D85), and catalog parts. Simple case-insensitive
 * substring match over the fields the prototype searched; small data
 * volumes make this instant.
 */

export type Result = {
  id: string;
  title: string;
  sub: string;
  href: string;
  letter: string;
  color: string;
};
export type Group = { label: string; items: Result[] };

const LIMIT_PER_GROUP = 5;

function matches(q: string, ...fields: Array<unknown>): boolean {
  return fields.some(
    (f) => typeof f === "string" && f.toLowerCase().includes(q)
  );
}

/** #223 — a doc as the estimate-number helpers read it. */
type NumberedDoc = QuoteNumberFields & { id: string; name?: string | null; customer?: string | null; bidders?: readonly string[] | null };
const asNumbered = (d: Doc): NumberedDoc => d as unknown as NumberedDoc;

/** #304: "Jupiter 4 · 80-0043" — the model first, the order # beside it. */
function staffLabelText(p: SearchPartLike): string {
  const l = staffPartLabel(p);
  return [l.primary, l.secondary].filter(Boolean).join(" · ");
}

/** The ⌘K search's groups for `rawQ`. The query is trimmed and lower-cased; under 2 characters there are no groups. */
export async function globalSearch(rawQ: string): Promise<Group[]> {
  const q = (rawQ || "")
    .trim()
    .toLowerCase();
  if (q.length < 2) return [];

  // Pull only a small candidate set per table from SQL (matches anywhere in
  // the doc), then apply the precise per-field filter below. Avoids
  // materializing whole tables — the catalog alone is ~10.7k rows.
  const CANDIDATES = 100;
  const [quotes, companies, people, parts, partialQuotes] =
    await Promise.all([
      searchDocs("quotes", q, CANDIDATES),
      allCompanies(),
      allContacts(),
      searchDocs("catalog_parts", q, CANDIDATES),
      quotesByPartialNumber(q, CANDIDATES),
    ]);

  const groups: Group[] = [];
  const add = (label: string, items: Result[]) => {
    if (items.length) groups.push({ label, items: items.slice(0, LIMIT_PER_GROUP) });
  };

  // #223 — a quote answers to its estimate number (FLM-1002), its OLD
  // internal id (Q-2041) and its name/customer. The doc text holds
  // `"estNo": 1002`, never "FLM-1002", so a typed number is also looked up
  // by value (indexed on doc->>'estNo'). Leads are listed here only when a
  // typed number names them (OPP-1002, or any prefix on the same number).
  // A prefix + partial number (`flm100`, `FLM-100`) is found by its digits
  // inside estNo too (bounded like every candidate set), then filtered by the
  // hub's own rule (quoteMatchesSearch) below.
  const parsedNo = parseEstimateNumber(q);
  const [numberedQuotes, numberedLeads] = parsedNo
    ? await Promise.all([
        listDocsByField("quotes", "estNo", [String(parsedNo.estNo)]).then((rows) =>
          rows.filter((d) => quoteNumberMatches(asNumbered(d), parsedNo))
        ),
        listDocsByField("leads", "estNo", [String(parsedNo.estNo)]).then((rows) =>
          rows.filter((d) => leadNumberMatches(asNumbered(d), parsedNo))
        ),
      ])
    : [[], []];
  // #348 — a quote also answers to a bidder's company name: the companies already loaded for the Companies group
  // that match the term (capped at 50) → their gc/ec party rows with bid state → those quotes, one batched read each.
  // Quotes are visible to every signed-in staff member today, so nothing here widens access.
  const bidderOf = new Map<string, string[]>();
  const bidderSeen = new Map<string, number>(); // quote id → newest bidder-row updatedAt
  {
    const hit = companies.filter((c) => matches(q, c.name)).slice(0, 50);
    if (hit.length) {
      const nameById = new Map(hit.map((c) => [c.id, c.name || c.id]));
      const rows = await listDocsByField<Party & Doc>("record_parties", "companyId", [...nameById.keys()]);
      for (const p of rows) {
        if (p.recordType !== "quote" || !p.bid || (p.role !== "gc" && p.role !== "ec")) continue;
        const list = bidderOf.get(p.recordId) ?? [];
        list.push(nameById.get(p.companyId) || p.companyId);
        bidderOf.set(p.recordId, list);
        bidderSeen.set(p.recordId, Math.max(bidderSeen.get(p.recordId) ?? 0, Number(p.updatedAt) || 0));
      }
    }
  }
  // At most CANDIDATES quotes through the bidder path, newest bidder rows first (a busy GC can be on hundreds).
  const bidderIds = [...bidderSeen.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, CANDIDATES).map(([id]) => id);
  const bidderQuotes = bidderIds.length
    ? [...(await getQuotesByIds(bidderIds)).values()].map((d) => ({ ...d, bidders: bidderOf.get(d.id) ?? [] }) as unknown as Doc)
    : [];
  const quoteDocs = [...partialQuotes, ...quotes, ...bidderQuotes].map((d) =>
    bidderOf.has(d.id) ? ({ ...d, bidders: bidderOf.get(d.id) } as unknown as Doc) : d
  );
  const seenQuote = new Set<string>();
  const quoteHits = [...numberedQuotes, ...quoteDocs.filter((d) => quoteMatchesSearch(asNumbered(d), q))]
    .filter((d) => {
      if (seenQuote.has(d.id)) return false;
      seenQuote.add(d.id);
      return true;
    })
    // Exact-number hits first (stable: the candidate order holds within a tier).
    .map((d, i) => ({ d, i, r: quoteSearchRank(asNumbered(d), q) ?? Number.MAX_SAFE_INTEGER }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.d);
  add(
    "Quotes",
    quoteHits.map((d) => ({
      id: d.id,
      title: String(d.name || d.id),
      sub: `${displayQuoteNumber(asNumbered(d))} · ${String(d.customer || "")}${
        bidderOf.has(d.id) && !matches(q, d.id, d.name, d.customer) ? ` · bidder ${bidderOf.get(d.id)![0]}` : ""
      }`,
      href: `/quotes?id=${encodeURIComponent(d.id)}`,
      letter: "Q",
      color: "var(--accent)",
    }))
  );
  add(
    "Opportunities",
    numberedLeads.map((d) => ({
      id: d.id,
      title: String(d.org || d.contact || d.id),
      sub: `${displayLeadNumber(asNumbered(d))} · ${String(d.interest || "")}`,
      href: `/leads?lead=${encodeURIComponent(d.id)}`,
      letter: "O",
      color: "var(--accent)",
    }))
  );
  // Companies + People search the identity tables directly (D85); volumes
  // are small, and matching in JS mirrors the per-field precision above.
  add(
    "Companies",
    companies
      .filter((c) => matches(q, c.id, c.name, c.city, c.state, c.type))
      .map((c) => ({
        id: c.id,
        title: c.name || c.id,
        sub: [c.city, c.state].filter(Boolean).join(", ") || c.type || "",
        href: `/companies/${encodeURIComponent(c.id)}`,
        letter: "C",
        color: "#8a6d1f",
      }))
  );
  {
    const hits = people.filter((p) => matches(q, displayName(p), p.title));
    // Also match on email address — the identity core keeps them as rows.
    const emailsBy = await emailsForContacts(people.map((p) => p.id));
    const emailHits = people.filter(
      (p) =>
        !hits.includes(p) &&
        (emailsBy.get(p.id) ?? []).some((e) => e.email.toLowerCase().includes(q))
    );
    const all = [...hits, ...emailHits].slice(0, LIMIT_PER_GROUP);
    const companiesBy = await getCompanies(
      all.map((p) => p.homeCompanyId).filter((v): v is string => !!v)
    );
    add(
      "People",
      all.map((p) => ({
        id: p.id,
        title: displayName(p),
        sub:
          [p.title, p.homeCompanyId ? companiesBy.get(p.homeCompanyId)?.name : null]
            .filter(Boolean)
            .join(" · ") || (emailsBy.get(p.id) ?? [])[0]?.email || "",
        href: `/people/${encodeURIComponent(p.id)}`,
        letter: "P",
        color: "#1f7a52",
      }))
    );
  }
  add(
    "Catalog",
    parts
      // #304: sku/desc/mfr/MFR P/N/Model #/former SKUs (one haystack), plus the category.
      .filter((d) => partSearchHaystack(d as unknown as SearchPartLike).includes(q) || matches(q, d.category))
      .map((d) => ({
        id: d.id,
        title: String(d.desc || d.sku),
        sub: `${staffLabelText(d as unknown as SearchPartLike)} · ${String(d.category || "")}`,
        href: `/catalog`,
        letter: "P",
        color: "#5b616e",
      }))
  );

  return groups;
}
