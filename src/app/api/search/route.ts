import { NextResponse } from "next/server";
import { auth } from "@/auth";
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
import { allCompanies, getCompanies } from "@/lib/identity/companies";
import { allContacts, displayName, emailsForContacts } from "@/lib/identity/contacts";
import { normalizeRecording, recordingStatusChip, type RecordingRecord } from "@/lib/stores/recordings";
import { summarySearchText } from "@/lib/krisp/derive";
import { partSearchHaystack, staffPartLabel, type SearchPartLike } from "@/lib/catalog-rename/sku";

/**
 * Global nav search (⌘K) — port of Nav.dc.html's search sources:
 * quotes, designs, surveys, inspections, comm threads, companies + people
 * (the identity core, D85), and catalog parts. Simple case-insensitive
 * substring match over the fields the prototype searched; small data
 * volumes make this instant.
 */

type Result = {
  id: string;
  title: string;
  sub: string;
  href: string;
  letter: string;
  color: string;
};
type Group = { label: string; items: Result[] };

const LIMIT_PER_GROUP = 5;

function matches(q: string, ...fields: Array<unknown>): boolean {
  return fields.some(
    (f) => typeof f === "string" && f.toLowerCase().includes(q)
  );
}

/** #223 — a doc as the estimate-number helpers read it. */
type NumberedDoc = QuoteNumberFields & { id: string; name?: string | null; customer?: string | null };
const asNumbered = (d: Doc): NumberedDoc => d as unknown as NumberedDoc;

/** #302: "Jupiter 4 · 80-0043" — the model first, the order # beside it. */
function staffLabelText(p: SearchPartLike): string {
  const l = staffPartLabel(p);
  return [l.primary, l.secondary].filter(Boolean).join(" · ");
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.active) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const q = (new URL(req.url).searchParams.get("q") || "")
    .trim()
    .toLowerCase();
  if (q.length < 2) return NextResponse.json({ groups: [] });

  // Pull only a small candidate set per table from SQL (matches anywhere in
  // the doc), then apply the precise per-field filter below. Avoids
  // materializing whole tables — the catalog alone is ~10.7k rows.
  const CANDIDATES = 100;
  const [quotes, designs, surveys, inspections, comms, companies, people, parts, recordings, partialQuotes] =
    await Promise.all([
      searchDocs("quotes", q, CANDIDATES),
      searchDocs("designs", q, CANDIDATES),
      searchDocs("surveys", q, CANDIDATES),
      searchDocs("inspections", q, CANDIDATES),
      searchDocs("comms", q, CANDIDATES),
      allCompanies(),
      allContacts(),
      searchDocs("catalog_parts", q, CANDIDATES),
      searchDocs<RecordingRecord>("recordings", q, CANDIDATES),
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
  const seenQuote = new Set<string>();
  const quoteHits = [...numberedQuotes, ...[...partialQuotes, ...quotes].filter((d) => quoteMatchesSearch(asNumbered(d), q))]
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
      sub: `${displayQuoteNumber(asNumbered(d))} · ${String(d.customer || "")}`,
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
  add(
    "Designs",
    designs
      .filter((d) => matches(q, d.id, d.name, d.customer))
      .map((d) => ({
        id: d.id,
        title: String(d.name || d.id),
        sub: `${d.id} · ${String(d.customer || "")}`,
        href: `/design/designs?id=${encodeURIComponent(d.id)}`,
        letter: "D",
        color: "#3155a8",
      }))
  );
  add(
    "Surveys",
    surveys
      .filter((d) => matches(q, d.id, d.customer, d.venue))
      .map((d) => ({
        id: d.id,
        title: String(d.customer || d.id),
        sub: `${d.id} · ${String(d.venue || "site survey")}`,
        href: `/venue-assessments`,
        letter: "S",
        color: "#1f7a52",
      }))
  );
  add(
    "Inspections",
    inspections
      .filter((d) => matches(q, d.id, d.customer, d.venue))
      .map((d) => ({
        id: d.id,
        title: String(d.customer || d.id),
        sub: `${d.id} · ${String(d.venue || "rigging inspection")}`,
        href: `/inspections`,
        letter: "I",
        color: "#7b3f8a",
      }))
  );
  add(
    "Email threads",
    comms
      .filter((d) => matches(q, d.subject, d.customer, d.contactName, d.contactEmail))
      .map((d) => ({
        id: d.id,
        title: String(d.subject || d.id),
        sub: String(d.customer || d.contactEmail || ""),
        href: `/inbox?thread=${encodeURIComponent(d.id)}`,
        letter: "@",
        color: "#b4543a",
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
  // Recordings (Krisp spec §4.5): id / title / customer / venue / joined
  // summary text. The transcript sits in the JSONB candidate scan above but
  // is never the label or the sub.
  {
    const now = Date.now();
    add(
      "Recordings",
      recordings
        .map((d) => normalizeRecording(d))
        .filter((r) => matches(q, r.id, r.title, r.customer, r.venue, summarySearchText(r)))
        .map((r) => ({
          id: r.id,
          title: r.title || r.id,
          sub: `${recordingStatusChip(r, now)} · ${r.customer || r.venue || r.parentId}`,
          href: `/recordings/${encodeURIComponent(r.id)}`,
          letter: "R",
          color: "#6b4fa1",
        }))
    );
  }
  add(
    "Catalog",
    parts
      // #302: sku/desc/mfr/MFR P/N/Model #/former SKUs (one haystack), plus the category.
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

  return NextResponse.json({ groups });
}
