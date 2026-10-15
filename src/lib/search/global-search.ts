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
import { normalizeRecording, recordingStatusChip, type RecordingRecord } from "@/lib/stores/recordings";
import { summarySearchText } from "@/lib/krisp/derive";
import { partSearchHaystack, staffPartLabel, type SearchPartLike } from "@/lib/catalog-rename/sku";
import { searchMeetingCandidates } from "@/lib/stores/meetings";
import { meetingsReadOr } from "@/lib/meetings/safe-read";
import { canSeeMeeting } from "@/lib/meetings/visibility";
import { renderMeeting, type RenderNames } from "@/lib/meetings/render";
import { lengthLabel, meetingReaderHref } from "@/app/(app)/inbox/meetings/format";
import { canSeeThread, canSeeThreadCond, type CommThread } from "@/lib/stores/comms";
import { normalizeAssessment } from "@/lib/stores/assessments";
import { normalizeFinding } from "@/lib/stores/findings";
import { sitesForCompanies } from "@/lib/identity/sites";
import { assessmentSearchResult, findingSearchResult, matchesAssessment, matchesFinding } from "@/lib/assessments/integration";

/**
 * Global nav search (⌘K) — port of Nav.dc.html's search sources:
 * quotes, designs, surveys, inspections, comm threads, companies + people
 * (the identity core, D85), and catalog parts. Simple case-insensitive
 * substring match over the fields the prototype searched; small data
 * volumes make this instant.
 *
 * Extracted from /api/search (Ask AI, spec 2026-10-13 §3): the route keeps
 * its auth check and returns `{ groups: await globalSearch(q, user) }`, byte
 * for byte what it returned before; Ask AI's `search` tool calls the same
 * function with the asking user.
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

/** #323 — ⌘K renders a meeting's summary without resolving linked names (speed); the text still relabels
 *  mapped speakers by their stored names. */
const NO_NAMES: RenderNames = { contact: () => null, user: () => null };

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

/**
 * The ⌘K search's groups for `rawQ` as `me` may see them (meetings through
 * canSeeMeeting, email threads through canSeeThread). The query is trimmed
 * and lower-cased; under 2 characters there are no groups. `me.id` scopes
 * meetings, `me.name` email threads (mailboxUser / assignedTo hold names).
 *
 * #341 — email-thread candidates are cut to the threads `me` may see — my
 * own mailbox's, ones assigned to me, and ones linked to an entity; never one
 * in Deleted or another person's draft — in SQL (canSeeThreadCond), before
 * the per-group cut, so other people's private mail can't crowd the visible
 * threads out of the 5; canSeeThread re-checks each row. ⌘K and Ask AI share
 * the rule. `opts.emailOnly` (Ask AI) also keeps only email threads (no
 * logged calls or meetings).
 */
export type GlobalSearchOpts = { emailOnly?: boolean };

export async function globalSearch(
  rawQ: string,
  me: { id: string; name?: string | null },
  opts: GlobalSearchOpts = {}
): Promise<Group[]> {
  const meName = me.name || "";
  const q = (rawQ || "")
    .trim()
    .toLowerCase();
  if (q.length < 2) return [];
  const meId = me.id;

  // Pull only a small candidate set per table from SQL (matches anywhere in
  // the doc), then apply the precise per-field filter below. Avoids
  // materializing whole tables — the catalog alone is ~10.7k rows.
  const CANDIDATES = 100;
  const [quotes, designs, surveys, inspections, comms, companies, people, parts, recordings, partialQuotes, meetingHits, assessmentDocs, findingDocs] =
    await Promise.all([
      searchDocs("quotes", q, CANDIDATES),
      searchDocs("designs", q, CANDIDATES),
      searchDocs("surveys", q, CANDIDATES),
      searchDocs("inspections", q, CANDIDATES),
      searchDocs<CommThread & Doc>("comms", q, CANDIDATES, {
        ...(opts.emailOnly ? { fieldEquals: { channel: "email" } } : {}),
        where: canSeeThreadCond(meName),
      }),
      allCompanies(),
      allContacts(),
      searchDocs("catalog_parts", q, CANDIDATES),
      searchDocs<RecordingRecord>("recordings", q, CANDIDATES),
      quotesByPartialNumber(q, CANDIDATES),
      // #323 — title / notes-text ILIKE in SQL, visible to me (in the WHERE, before the LIMIT), no transcript;
      // visibility + the rendered summary re-checked below
      meetingsReadOr(searchMeetingCandidates(q, CANDIDATES, meId), [], "search"),
      // #340 — assessments and findings: SQL candidates (anywhere in the doc), the precise match below.
      searchDocs("assessments", q, CANDIDATES),
      searchDocs("findings", q, CANDIDATES),
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
      }
    }
  }
  const bidderQuotes = bidderOf.size
    ? [...(await getQuotesByIds([...bidderOf.keys()])).values()].map((d) => ({ ...d, bidders: bidderOf.get(d.id) ?? [] }) as unknown as Doc)
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
      // #341 — the SQL cut above, re-checked row by row (one rule, comms-visibility.ts)
      .filter((d) => canSeeThread(d, meName))
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
  // #323 Krisp meetings: title + the rendered summary, only what this user may see (canSeeMeeting).
  {
    const DAY = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", year: "numeric" });
    add(
      "Meetings",
      meetingHits
        .filter((m) => canSeeMeeting(m, meId))
        .filter((m) => {
          const r = renderMeeting(m, NO_NAMES);
          return matches(q, m.krisp.title, r.summary.flatMap((x) => [x.title, x.description]).join(" "), r.keyPoints.join(" "));
        })
        .map((m) => ({
          id: m.id,
          title: m.krisp.title || "Untitled meeting",
          sub: `${m.krisp.startedAt != null ? DAY.format(m.krisp.startedAt) : "—"} · ${lengthLabel(m.krisp.durationSec)}`,
          href: meetingReaderHref(m),
          letter: "M",
          color: "#6b4fa1",
        }))
    );
  }
  // #340 assessments (AS-1001 · customer, venue · status) and findings (the printed id, the description). A company
  // whose NAME matches also brings its assessments in (the doc holds the customer id, never the name).
  {
    const byName = companies.filter((c) => matches(q, c.name)).slice(0, 10).map((c) => c.id);
    const nameHits = byName.length ? await listDocsByField("assessments", "customerId", byName) : [];
    const seenA = new Set<string>();
    const cands = [...assessmentDocs, ...nameHits].filter((d) => (seenA.has(d.id) ? false : (seenA.add(d.id), true))).map((d) => normalizeAssessment(d));
    const custBy = new Map(companies.map((c) => [c.id, c.name]));
    const siteBy = new Map<string, string>();
    const siteGroups = await sitesForCompanies([...new Set(cands.map((a) => a.customerId))]);
    for (const list of siteGroups.values()) for (const s of list) siteBy.set(s.id, s.name || s.locationName || s.id);
    const nm = (a: { customerId: string; siteId: string }) => ({ customer: custBy.get(a.customerId) ?? a.customerId, venue: siteBy.get(a.siteId) ?? "" });
    add(
      "Assessments",
      cands
        .filter((a) => matchesAssessment(q, a, nm(a)))
        .sort((a, b) => b.visitDate - a.visitDate || b.id.localeCompare(a.id, undefined, { numeric: true }))
        .map((a) => assessmentSearchResult(a, nm(a)))
    );
    add(
      "Findings",
      findingDocs
        .map((d) => normalizeFinding(d, d.id))
        .filter((f) => matchesFinding(q, f))
        .sort((a, b) => (a.printedId === null ? 1 : 0) - (b.printedId === null ? 1 : 0) || (a.printedId ?? "").localeCompare(b.printedId ?? "", undefined, { numeric: true }) || a.key.localeCompare(b.key))
        .map((f) => findingSearchResult(f))
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
