/**
 * Ask AI read tools (spec 2026-10-13-ask-ai-design.md §3) — the eleven
 * read-only lookups the model may call, each run as the asking user under
 * that user's access rule:
 *  - thread: `loadThreadFor` (a live email thread in the user's own mailbox);
 *  - meeting: `canSeeMeeting` (the reader's rule) — never the transcript;
 *  - my_tasks / task: the user's own tasks and assignments;
 *  - everything else: any signed-in team member (the record pages are
 *    `requireUser` only).
 * A forbidden record answers exactly like a missing one (`notFoundText`).
 *
 * Every result is compact labelled text, capped (`capText`) and wrapped as an
 * untrusted `<record>` (`wrapRecord`), plus the refs it exposed (the panel's
 * link whitelist) and the email addresses it showed (the email card's
 * recipient whitelist). Quotes print the customer's rows (`customerLines`):
 * the estimator-bonus lines never show, as on every customer surface.
 *
 * Request-scope free (the route owns requireUser and the gate) so the DB
 * checks can drive it directly.
 */
import { z } from "zod";
import { listDocsByField, listDocsFiltered, searchDocs } from "@/db/doc-store";
import { get as getCustomer } from "@/lib/stores/customers";
import { getCompany } from "@/lib/identity/companies";
import { get as getQuote, type Quote } from "@/lib/stores/quotes";
import { get as getLead, sla, type LeadRecord } from "@/lib/stores/leads";
import { getProject, projectsForCustomer } from "@/lib/stores/projects";
import { get as getSurvey, type SurveyRecord } from "@/lib/stores/surveys";
import { allTasks, getTask, tasksForProject, type TaskRecord } from "@/lib/stores/tasks";
import { allAssignments, getAssignment, type Assignment } from "@/lib/stores/assignments";
import { get as getPart, type CatalogPart } from "@/lib/stores/catalog";
import { getMeeting } from "@/lib/stores/meetings";
import { resolveQuoteInput } from "@/lib/stores/estimate-numbers";
import { visibleTo, type CommThread } from "@/lib/stores/comms";
import type { NoteRecord } from "@/lib/stores/notes";
import { getSite, sitesForCompany } from "@/lib/identity/sites";
import { displayName, getContact } from "@/lib/identity/contacts";
import { partSearchHaystack } from "@/lib/catalog-rename/sku";
import { grantsFor } from "@/lib/portal";
import { loadVenueHistory } from "@/lib/venue-history-server";
import { activeUsers } from "@/lib/users";
import { canSeeMeeting } from "@/lib/meetings/visibility";
import { renderMeeting } from "@/lib/meetings/render";
import { displayLeadNumber, displayQuoteNumber } from "@/lib/estimate-number";
import { isBonusItem } from "@/lib/estimate-bonus/flags";
import { globalSearch, type Group } from "@/lib/search/global-search";
import { customerLines, lineExtSellOf, systemSellTotal } from "@/app/(app)/estimator/pricing";
import { rankCatalogParts } from "@/app/(app)/estimator/catalog-rank";
import type { SpecItem, SpecSection } from "@/app/(app)/estimator/types";
import { loadThreadFor } from "./thread-access";
import { toJsonSchema } from "./run";
import { chicagoToday } from "./config";
import { hrefFor, type RefHrefHint, type RefKind } from "./features/ask-refs";
import { ASK_TOOL_RESULT_MAX, capText, wrapRecord } from "./features/ask-prompt";
import { cleanEmail, oneLine } from "./features/ask-cards";
import { cleanPromptField, defangWrappers, promptMessages } from "./features/thread-text";
import { surveyText } from "./features/suggest-sources";

/* ---------------- shapes ---------------- */

/** The asking user — the signed-in team member. */
export type AskUser = { id: string; name: string };

/** One record a tool exposed: becomes a `ref` event (the panel's link whitelist). */
export type AskToolRef = { kind: RefKind; id: string; title: string; href: string };

export type ReadToolResult = {
  /** The wrapped, capped tool result the model reads. */
  text: string;
  refs: AskToolRef[];
  /** Email addresses the result showed (lower-cased) — the email card's recipient whitelist. */
  emails: string[];
  /** Set for an unknown tool, invalid input or a failed lookup — the runner returns it with `is_error`. */
  isError?: true;
};

/** A loaded record before wrapping: the page context reuses it unwrapped. */
type Loaded = {
  /** The record itself (null for a list result such as search). */
  self: AskToolRef | null;
  body: string;
  refs: AskToolRef[];
  emails: string[];
};

/* ---------------- limits ---------------- */

export const ASK_COMPANY_LATEST = 10;
export const ASK_COMPANY_NOTES = 5;
export const ASK_VENUE_SERVICE_LATEST = 3;
export const ASK_VENUE_QUOTES = 10;
export const ASK_LIST_QUOTES_MAX = 20;
export const ASK_THREAD_MESSAGES = 8;
export const ASK_THREAD_MESSAGE_CHARS = 1500;
export const ASK_CATALOG_MAX = 10;
export const ASK_MY_TASKS_MAX = 25;
export const ASK_SYSTEM_LINES_MAX = 40;
export const ASK_SINCE_DAYS_MAX = 3650;
/** Long lists (venues, people, crew, meeting items) print this many, then "…N more". */
export const ASK_LIST_CAP = 25;
/** Catalog rows read per search_catalog call (SQL pre-filter, every query token ANDed), before ranking. */
export const ASK_CATALOG_CANDIDATES = 400;
/** The body budget before wrapping: the wrapped result stays ≤ ASK_TOOL_RESULT_MAX. */
export const ASK_TOOL_BODY_MAX = ASK_TOOL_RESULT_MAX - 400;
/** Contacts read to name a meeting's attendees and speakers. */
export const ASK_MEETING_CONTACTS_MAX = 60;
const TITLE_MAX = 120;
const QUERY_MAX = 200;
const ID_MAX = 160;
const DAY_MS = 86_400_000;

/* ---------------- tool inputs ---------------- */

const Id = z.string().trim().min(1).max(ID_MAX);
const QUOTE_TYPES = ["system", "flame_test", "repair", "inspection", "consulting", "rental"] as const;
const QUOTE_STATUSES = ["draft", "sent", "won", "lost"] as const;

const SearchInput = z.object({ query: z.string().trim().min(2).max(QUERY_MAX).describe("Words, a name, an email, an estimate number (EST-1089) or an id.") });
const IdInput = z.object({ id: Id.describe("The record's id, exactly as a tool result printed it.") });
const QuoteIdInput = z.object({ id: Id.describe("A quote's internal id (Q-2041) or its estimate number (EST-1089, FLM-1002-2).") });
const ListQuotesInput = z.object({
  customerId: Id.optional().describe("Only this company's quotes (a company id such as C-1042)."),
  status: z.enum(QUOTE_STATUSES).optional(),
  type: z.enum(QUOTE_TYPES).optional().describe("system = an Estimator / install quote."),
  sinceDays: z.number().int().min(1).max(ASK_SINCE_DAYS_MAX).optional().describe("Only quotes updated in the last N days."),
  limit: z.number().int().min(1).max(ASK_LIST_QUOTES_MAX).optional().describe("At most 20; default 10."),
});
const CatalogInput = z.object({
  query: z.string().trim().min(2).max(QUERY_MAX).describe("A model, part number, manufacturer or description words."),
  limit: z.number().int().min(1).max(ASK_CATALOG_MAX).optional().describe("At most 10; default 10."),
});
const NoInput = z.object({});

export type ReadToolName =
  | "search"
  | "get_company"
  | "get_venue"
  | "get_quote"
  | "list_quotes"
  | "get_lead"
  | "get_project"
  | "get_thread"
  | "get_meeting"
  | "search_catalog"
  | "my_tasks";

export type ReadToolDef = { name: ReadToolName; description: string; input: z.ZodType; schema: Record<string, unknown> };

const def = (name: ReadToolName, description: string, input: z.ZodType): ReadToolDef => ({ name, description, input, schema: toJsonSchema(input) });

export const ASK_READ_TOOLS: readonly ReadToolDef[] = [
  def("search", "Search Peak's records the way ⌘K does: quotes, opportunities, companies, people, venue assessments, email threads, meetings, catalog parts and more. Start here when you don't have an id.", SearchInput),
  def("get_company", "One company: type, address, venues, people (name, title, email, phone), counts and the latest quotes / projects / leads, portal access count and the latest notes.", IdInput),
  def("get_venue", "One venue: its facts, owning company, latest flame-test / inspection / repair records and its quotes.", IdInput),
  def("get_quote", "One quote by internal id or estimate number: number, name, type, status, customer, lead estimator, dates, total (sell) and each system's lines (sku, description, qty, line sell).", QuoteIdInput),
  def("list_quotes", "Quotes filtered by company, status, type and recency, newest first: number, name, status, total, date.", ListQuotesInput),
  def("get_lead", "One lead / opportunity: its fields, first-response SLA and the subjects of the user's email threads linked to it.", IdInput),
  def("get_project", "One install project or order: stage, dates, crew, procurement summary and open tasks.", IdInput),
  def("get_thread", "One email thread in the user's own mailbox: subject, participants and the latest messages.", IdInput),
  def("get_meeting", "One Krisp meeting the user may see: title, date, attendees, summary, key points and to-dos (never the transcript).", IdInput),
  def("search_catalog", "Search the parts catalog: sku / model, manufacturer, description, unit, cost and list price.", CatalogInput),
  def("my_tasks", "The user's own open tasks and assignments (title, due date, links), soonest first.", NoInput),
];

const TOOL_BY_NAME: ReadonlyMap<string, ReadToolDef> = new Map(ASK_READ_TOOLS.map((t) => [t.name, t]));

export function isReadToolName(name: string): name is ReadToolName {
  return TOOL_BY_NAME.has(name);
}

/* ---------------- formatting helpers ---------------- */

/** One untrusted single-line field (no line breaks, wrapper closes defanged, capped). */
const f = (s: unknown, max = TITLE_MAX) => cleanPromptField(typeof s === "string" ? s : s == null ? "" : String(s), max);
/** A ref title: one line, capped (rendered as text by the panel). */
const t = (s: unknown) => oneLine(typeof s === "string" ? s : "", TITLE_MAX);
const day = (ms: unknown) => (typeof ms === "number" && Number.isFinite(ms) && ms > 0 ? chicagoToday(ms).date : "—");
const money = (n: unknown) => {
  const v = typeof n === "number" && Number.isFinite(n) ? n : 0;
  return `${v < 0 ? "-" : ""}$${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const tok = (kind: RefKind, id: string) => `[[${kind}:${id}]]`;
const line = (label: string, value: string) => (value ? `${label}: ${value}` : "");
const join = (parts: Array<string | null | undefined | false>) => parts.filter(Boolean).join("\n");

function mkRef(kind: RefKind, id: string, title: string, hint?: RefHrefHint): AskToolRef {
  return { kind, id, title: t(title) || id, href: hrefFor(kind, id, hint) };
}

const quoteTitle = (q: Pick<Quote, "id" | "name"> & Parameters<typeof displayQuoteNumber>[0]) => `${displayQuoteNumber(q)} ${q.name || ""}`.trim();
const quoteRef = (q: Quote) => mkRef("quote", q.id, quoteTitle(q), { quoteType: q.quoteType ?? null });
const companyRef = (c: { id: string; name?: string | null }) => mkRef("company", c.id, c.name || c.id);

/** A long list: the first ASK_LIST_CAP rows, then "…N more". */
function capList(rows: string[], cap = ASK_LIST_CAP): string[] {
  return rows.length > cap ? [...rows.slice(0, cap), `- …${rows.length - cap} more`] : rows;
}
const leadTitle = (l: LeadRecord) => `${displayLeadNumber(l)} ${l.org || l.contact || ""}`.trim();
const surveyTitle = (s: Pick<SurveyRecord, "id" | "customer" | "venue">) => [s.customer, s.venue].map((x) => (x || "").trim()).filter(Boolean).join(" — ") || s.id;

/** The company a record points at, as a ref + a printed label; null when it no longer exists. */
async function companyLink(id: string | null | undefined): Promise<{ ref: AskToolRef; label: string } | null> {
  if (!id) return null;
  const c = await getCompany(id); // the companies row only — no venues / contacts composed
  return c ? { ref: companyRef(c), label: `${f(c.name)} ${tok("company", c.id)}` } : null;
}

function pushEmail(out: Set<string>, raw: unknown): void {
  if (typeof raw !== "string") return;
  for (const part of raw.split(/[,;]/)) {
    const m = /<([^>]+)>/.exec(part);
    const e = cleanEmail((m ? m[1] : part).trim());
    if (e) out.add(e.toLowerCase());
  }
}

/** The constant "not found" answer — a forbidden record reads exactly the same. */
export function notFoundText(kind: string, id: string): string {
  return `Not found: no ${kind} "${f(id, ID_MAX)}" that you can open.`;
}

/** Cap, then wrap; re-cap if defanging pushed the wrapped text past the tool-result limit. */
function finish(kind: string, id: string, body: string): string {
  // Defanged first (idempotent — wrapRecord's own pass then changes nothing), so the cap measures the final text.
  const clean = defangWrappers(body);
  let max = ASK_TOOL_BODY_MAX;
  let out = wrapRecord(kind, id, capText(clean, max));
  while (out.length > ASK_TOOL_RESULT_MAX && max > 500) {
    max -= out.length - ASK_TOOL_RESULT_MAX + 100;
    out = wrapRecord(kind, id, capText(clean, max));
  }
  return out;
}

/** One message body: CRs dropped, blank runs squeezed, capped (wrapper closes are defanged by wrapRecord). */
const messageBody = (b: string) => {
  const x = (b || "").replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
  return x.length > ASK_THREAD_MESSAGE_CHARS ? x.slice(0, ASK_THREAD_MESSAGE_CHARS) + " …[trimmed]" : x;
};

const dedupeRefs = (refs: AskToolRef[]): AskToolRef[] => {
  const seen = new Set<string>();
  return refs.filter((r) => (seen.has(`${r.kind}:${r.id}`) ? false : (seen.add(`${r.kind}:${r.id}`), true)));
};

/* ---------------- loaders (one per record kind) ---------------- */

async function loadCompany(id: string): Promise<Loaded | null> {
  const c = await getCustomer(id);
  if (!c) return null;
  const now = Date.now();
  const [sites, linkedQuotes, nameQuotes, projects, leadsA, leadsB, notes, grants] = await Promise.all([
    sitesForCompany(c.id),
    listDocsByField<Quote>("quotes", "customerId", [c.id]),
    // the company page's name fallback for quotes never linked to a customer id
    c.name ? listDocsByField<Quote>("quotes", "customer", [c.name]) : Promise.resolve([] as Quote[]),
    projectsForCustomer(c.id),
    listDocsByField<LeadRecord>("leads", "customerId", [c.id]),
    listDocsByField<LeadRecord>("leads", "convertedCustomerId", [c.id]),
    listDocsByField<NoteRecord>("notes", "customerId", [c.id]),
    grantsFor(c.id),
  ]);
  const quotes = [...linkedQuotes, ...nameQuotes.filter((q) => !q.customerId)].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const leadMap = new Map([...leadsA, ...leadsB].map((l) => [l.id, l]));
  const leads = [...leadMap.values()].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const activeGrants = grants.filter((g) => !g.revokedAt && (g.expiresAt || 0) > now).length;
  const recentNotes = notes.sort((a, b) => (b.at || b.createdAt || 0) - (a.at || a.createdAt || 0)).slice(0, ASK_COMPANY_NOTES);

  const refs: AskToolRef[] = [];
  const emails = new Set<string>();
  const venueLines = sites.slice(0, ASK_LIST_CAP).map((s) => {
    refs.push(mkRef("venue", s.id, s.name || s.id));
    const where = [s.address, [s.city, s.state].filter(Boolean).join(", "), s.zip].filter(Boolean).join(" ");
    return `- ${tok("venue", s.id)} ${f(s.name) || "(unnamed venue)"}${s.isPrimary ? " (primary)" : ""}${where ? ` — ${f(where, 200)}` : ""}`;
  });
  if (sites.length > ASK_LIST_CAP) venueLines.push(`- …${sites.length - ASK_LIST_CAP} more`);
  const contacts = c.contacts || [];
  const peopleLines = contacts.slice(0, ASK_LIST_CAP).map((p) => {
    pushEmail(emails, p.email);
    return `- ${f(p.name)}${p.role ? `, ${f(p.role)}` : ""}${p.email ? ` · ${f(p.email)}` : ""}${p.phone ? ` · ${f(p.phone, 40)}` : ""}${p.mobile ? ` · mobile ${f(p.mobile, 40)}` : ""}${p.primary ? " (primary)" : ""}`;
  });
  if (contacts.length > ASK_LIST_CAP) peopleLines.push(`- …${contacts.length - ASK_LIST_CAP} more`);
  const quoteLines = quotes.slice(0, ASK_COMPANY_LATEST).map((q) => {
    refs.push(quoteRef(q));
    return `- ${tok("quote", q.id)} ${f(displayQuoteNumber(q))} ${f(q.name)} — ${q.status} — ${money(q.value)} — updated ${day(q.updatedAt)}`;
  });
  const projectLines = projects.slice(0, ASK_COMPANY_LATEST).map((p) => {
    refs.push(mkRef("project", p.id, p.name || p.id));
    return `- ${tok("project", p.id)} ${f(p.name)} — ${f(p.stageMeta?.label ?? p.stage, 60)} — updated ${day(p.updatedAt)}`;
  });
  const leadLines = leads.slice(0, ASK_COMPANY_LATEST).map((l) => {
    refs.push(mkRef("lead", l.id, leadTitle(l)));
    return `- ${tok("lead", l.id)} ${f(displayLeadNumber(l))} ${f(l.interest || l.org, 80)} — ${l.stage} — updated ${day(l.updatedAt)}`;
  });
  const noteLines = recentNotes.map((n) => `- ${day(n.at)} ${f(n.by, 60)}: ${f(n.text, 400)}`);
  const open = quotes.filter((q) => q.status === "draft" || q.status === "sent");
  const won = quotes.filter((q) => q.status === "won");
  const self = companyRef(c);
  const address = [c.location, c.zip].filter(Boolean).join(" ");
  const body = join([
    `Company ${tok("company", c.id)} ${f(c.name)}`,
    line("Type", f(c.type, 40)),
    line("Lifecycle", f(c.lifecycle, 40)),
    line("Location", f(address, 200)),
    line("Phone", f(c.phone, 40)),
    line("Website", f(c.website, 120)),
    line("Account owner", f(c.owner, 60)),
    line("Pricing tier", f(c.pricingTier, 40)),
    `Counts: ${quotes.length} quotes (${open.length} open, ${money(open.reduce((a, q) => a + (q.value || 0), 0))} open value; ${won.length} won), ${projects.length} projects, ${leads.length} leads, ${sites.length} venues, ${activeGrants} active portal grants`,
    venueLines.length ? `Venues:\n${venueLines.join("\n")}` : "Venues: none",
    peopleLines.length ? `People:\n${peopleLines.join("\n")}` : "People: none",
    quoteLines.length ? `Latest quotes:\n${quoteLines.join("\n")}` : "",
    projectLines.length ? `Latest projects:\n${projectLines.join("\n")}` : "",
    leadLines.length ? `Latest leads:\n${leadLines.join("\n")}` : "",
    noteLines.length ? `Latest notes:\n${noteLines.join("\n")}` : "",
  ]);
  return { self, body, refs: [self, ...refs], emails: [...emails] };
}

async function loadVenue(id: string): Promise<Loaded | null> {
  const site = await getSite(id);
  if (!site) return null;
  const [company, history, quoteDocs] = await Promise.all([
    getCompany(site.companyId),
    loadVenueHistory(site),
    listDocsByField<Quote>("quotes", "customerId", [site.companyId]),
  ]);
  const quoteById = new Map(quoteDocs.map((q) => [q.id, q]));
  const refs: AskToolRef[] = [];
  const self = mkRef("venue", site.id, site.name || site.id);
  if (company) refs.push(companyRef(company));
  const svc = (kind: "flame" | "inspection" | "repair", label: string) => {
    const rows = history.filter((r) => r.kind === kind).slice(0, ASK_VENUE_SERVICE_LATEST);
    return rows.length ? `Latest ${label}:\n${rows.map((r) => `- ${r.id} ${f(r.title)} — ${f(r.status, 40)} — ${day(r.ts)}`).join("\n")}` : `Latest ${label}: none`;
  };
  const quoteLines = history
    .filter((r) => r.kind === "quote")
    .slice(0, ASK_VENUE_QUOTES)
    .map((r) => {
      const q = quoteById.get(r.id);
      if (q) refs.push(quoteRef(q));
      return `- ${q ? tok("quote", q.id) + " " + f(displayQuoteNumber(q)) : r.id} ${f(r.title)} — ${f(r.status, 40)}${q ? ` — ${money(q.value)}` : ""} — ${day(r.ts)}`;
    });
  const where = [site.address, [site.city, site.state].filter(Boolean).join(", "), site.zip].filter(Boolean).join(" ");
  const body = join([
    `Venue ${tok("venue", site.id)} ${f(site.name)}`,
    company ? `Company: ${f(company.name)} ${tok("company", company.id)}` : "",
    line("Location name", f(site.locationName)),
    line("Address", f(where, 200)),
    line("Venue kind", f(site.venueKind, 40)),
    line("Category", f(site.kind, 40)),
    site.isPrimary ? "Primary venue of its company" : "",
    site.travelMiles ? `Travel: ${f(site.travelMiles, 20)} mi${site.travelMin ? `, ${f(site.travelMin, 20)} min` : ""}` : "",
    line("Address check", f(site.geoStatus, 20)),
    svc("flame", "flame tests"),
    svc("inspection", "inspections"),
    svc("repair", "repairs"),
    quoteLines.length ? `Quotes:\n${quoteLines.join("\n")}` : "Quotes: none",
  ]);
  return { self, body, refs: [self, ...refs], emails: [] };
}

type Sections = { sections?: SpecSection[] } | null | undefined;

function systemLines(q: Quote): string[] {
  const sections = ((q.spec as Sections)?.sections ?? []).filter((s) => s && Array.isArray(s.items));
  const out: string[] = [];
  for (const sec of sections) {
    const rows = customerLines(sec);
    const options = sec.items.filter((it: SpecItem) => it.option && !isBonusItem(it));
    if (!rows.length && !options.length) continue;
    out.push(`System: ${f(sec.name) || "(unnamed)"} — ${money(systemSellTotal(sec))}${sec.alternate === true ? " (alternate — priced separately, not in the total)" : ""}`);
    const shown = rows.slice(0, ASK_SYSTEM_LINES_MAX);
    for (const r of shown) {
      if (r.item) out.push(`- ${f(r.item.sku, 80) || "—"} · ${f(r.item.desc, 160)} · qty ${r.item.qty} · ${money(r.ext)}`);
      else out.push(`- ${f(r.desc, 160)} · ${money(r.ext)}`);
    }
    if (rows.length > shown.length) out.push(`- …${rows.length - shown.length} more lines`);
    for (const it of options.slice(0, ASK_SYSTEM_LINES_MAX)) out.push(`- Option: ${f(it.sku, 80) || "—"} · ${f(it.desc, 160)} · qty ${it.qty} · ${money(lineExtSellOf(it))}`);
  }
  return out;
}

type FlatLine = { sku?: unknown; desc?: unknown; qty?: unknown; price?: unknown; ext?: unknown };
const num = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? n : 0);

/**
 * A quote's printable lines: an Estimator quote's systems (`spec.sections`,
 * customer rows), a Grid quote's flat `spec.lines` (sku · desc · qty · ext,
 * D111/D316), else a note — the service / consulting / rental engines keep
 * their own subdocs, which aren't line lists.
 */
function quoteLinesText(q: Quote): string {
  const spec = (q.spec && typeof q.spec === "object" ? q.spec : {}) as { sections?: unknown; lines?: unknown };
  if (Array.isArray(spec.sections)) {
    const sys = systemLines(q);
    return sys.length ? `Systems and lines (sell):\n${sys.join("\n")}` : "Lines: none";
  }
  if (Array.isArray(spec.lines)) {
    const rows = (spec.lines as FlatLine[])
      .filter((l) => l && typeof l === "object")
      .map((l) => {
        const qty = num(l.qty);
        const ext = typeof l.ext === "number" && Number.isFinite(l.ext) ? l.ext : qty * num(l.price);
        return `- ${f(l.sku, 80) || "—"} · ${f(l.desc, 160)} · qty ${qty} · ${money(ext)}`;
      });
    return rows.length ? `Lines (sell):\n${capList(rows, ASK_SYSTEM_LINES_MAX).join("\n")}` : "Lines: none";
  }
  return "Lines are not available for this quote type.";
}

async function loadQuote(input: string): Promise<Loaded | { ambiguous: string[] } | null> {
  const r = await resolveQuoteInput(input);
  if (!r.ok) return r.reason === "ambiguous" ? { ambiguous: r.numbers } : null;
  const q = await getQuote(r.id);
  if (!q) return null;
  const refs: AskToolRef[] = [];
  const self = quoteRef(q);
  const cust = await companyLink(q.customerId);
  if (cust) refs.push(cust.ref);
  const body = join([
    `Quote ${tok("quote", q.id)} ${f(displayQuoteNumber(q))} — ${f(q.name)}`,
    `Type: ${q.quoteType || "system"}${q.category ? ` (${f(q.category, 60)})` : ""}`,
    `Status: ${q.status}`,
    `Customer: ${cust ? cust.label : f(q.customer) || "—"}`,
    line("Contact", f(q.contactName)),
    line("Lead estimator", f(q.owner, 60)),
    line("Prepared by", f(q.preparedBy, 60)),
    `Created: ${day(q.createdAt)} · Updated: ${day(q.updatedAt)}`,
    `Total (sell): ${money(q.value)}`,
    line("Install timeframe", f(q.installTimeframe, 120)),
    quoteLinesText(q),
  ]);
  return { self, body, refs: [self, ...refs], emails: [] };
}

async function loadLead(id: string, me: AskUser): Promise<Loaded | null> {
  const l = await getLead(id);
  if (!l) return null;
  const refs: AskToolRef[] = [];
  const self = mkRef("lead", l.id, leadTitle(l));
  const [cust, converted, quote, mine] = await Promise.all([
    companyLink(l.customerId),
    l.convertedCustomerId && l.convertedCustomerId !== l.customerId ? companyLink(l.convertedCustomerId) : Promise.resolve(null),
    l.convertedQuoteId ? getQuote(l.convertedQuoteId) : Promise.resolve(null),
    // my own mailbox's threads that mention the lead id (in SQL); the exact link is checked below
    searchDocs<CommThread>("comms", l.id, 200, { fieldEquals: { mailbox: "personal", mailboxUser: me.name, channel: "email" } }),
  ]);
  for (const x of [cust, converted]) if (x) refs.push(x.ref);
  if (quote) refs.push(quoteRef(quote));
  // Only the user's own mailbox: another rep's thread subject is theirs (loadThreadFor's rule).
  const threads = mine
    .filter((th) => !th.deleted && th.channel === "email" && visibleTo(th, me.name) && th.link?.type === "lead" && th.link.id === l.id)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .slice(0, 10);
  for (const th of threads) refs.push(mkRef("thread", th.id, th.subject || th.id));
  const s = sla(l);
  const emails = new Set<string>();
  pushEmail(emails, l.email);
  const slaText =
    s.state === "met" ? `met${s.at ? ` (first contact ${day(s.at)})` : ""}` : s.state === "pending" ? `pending — due ${day(s.deadline)}` : s.state === "breached" ? `breached — was due ${day(s.deadline)}` : "n/a";
  const body = join([
    `Lead ${tok("lead", l.id)} ${f(displayLeadNumber(l))} — ${f(l.org || l.contact)}`,
    `Stage: ${l.stage} · Source: ${f(l.source, 40)} · Owner: ${f(l.owner, 60) || "—"}`,
    line("Contact", [f(l.contact), f(l.contactRole, 60)].filter(Boolean).join(", ")),
    line("Email", f(l.email)),
    line("Phone", f(l.phone, 40)),
    line("Address", f([l.address, l.city, l.state].filter(Boolean).join(", "), 200)),
    line("Interest", f(l.interest, 200)),
    line("Timeline", f(l.timeline, 80)),
    l.value ? `Value: ${money(l.value)}` : "",
    `First-response SLA: ${slaText}`,
    l.nextActionAt ? `Next action: ${day(l.nextActionAt)}${l.nextActionNote ? ` — ${f(l.nextActionNote, 200)}` : ""}` : "",
    l.forecastAt ? `Forecast close: ${day(l.forecastAt)}` : "",
    line("Lost reason", f(l.lostReason, 200)),
    cust ? `Company: ${cust.label}` : "",
    converted ? `Converted to company: ${converted.label}` : "",
    quote ? `Converted quote: ${tok("quote", quote.id)} ${f(quoteTitle(quote))}` : "",
    `Created: ${day(l.createdAt)} · Last activity: ${day(l.lastActivityAt || l.updatedAt)}`,
    l.message ? `Message:\n${(l.message || "").slice(0, 2000)}` : "",
    threads.length ? `Your email threads linked to it:\n${threads.map((th) => `- ${tok("thread", th.id)} ${f(th.subject, 200)} — ${day(th.updatedAt)}`).join("\n")}` : "Your email threads linked to it: none",
  ]);
  return { self, body, refs: [self, ...refs], emails: [...emails] };
}

async function loadProject(id: string): Promise<Loaded | null> {
  const p = await getProject(id);
  if (!p) return null;
  const refs: AskToolRef[] = [];
  const self = mkRef("project", p.id, p.name || p.id);
  const [cust, quote, tasks] = await Promise.all([companyLink(p.customerId), p.quoteId ? getQuote(p.quoteId) : Promise.resolve(null), tasksForProject(p.id)]);
  if (cust) refs.push(cust.ref);
  if (quote) refs.push(quoteRef(quote));
  const proc = Array.isArray(p.procurement) ? p.procurement : [];
  const byStatus = (s: string) => proc.filter((x) => x.status === s).length;
  const crew = (Array.isArray(p.crew) ? p.crew : []).map((c) => `- ${f(c.person, 60)}${c.role ? `, ${f(c.role, 40)}` : ""} — ${day(c.start)} to ${day(c.end)}`);
  const open = tasks.filter((x) => x.status !== "done").sort((a, b) => (a.dueAt || Infinity) - (b.dueAt || Infinity));
  const body = join([
    `Project ${tok("project", p.id)} ${f(p.name)}${p.kind === "order" ? " (order)" : ""}`,
    `Stage: ${f(p.stageMeta?.label ?? p.stage, 60)}`,
    `Customer: ${cust ? cust.label : f(p.customer) || "—"}`,
    line("Owner", f(p.owner, 60)),
    p.valueUnknown ? "Value: unknown" : `Value: ${money(p.value)}`,
    quote ? `From quote: ${tok("quote", quote.id)} ${f(quoteTitle(quote))}` : "",
    `Started: ${day(p.startedAt)} · Target: ${day(p.targetDate)} · Install: ${day(p.installStart)} to ${day(p.installEnd)}`,
    p.signoff ? `Signed off ${day(p.signoff.signedAt)} by ${f(p.signoff.signedBy, 60)}` : "",
    proc.length
      ? `Procurement: ${proc.length} lines — ${byStatus("pending")} pending, ${byStatus("ordered")} ordered, ${byStatus("shipped")} shipped, ${byStatus("received")} received`
      : "Procurement: none",
    crew.length ? `Crew:\n${capList(crew).join("\n")}` : "Crew: none assigned",
    open.length
      ? `Open tasks:\n${open
          .slice(0, 25)
          .map((x) => `- ${f(x.title, 160)}${x.assigneeName ? ` — ${f(x.assigneeName, 60)}` : ""}${x.dueAt ? ` — due ${day(x.dueAt)}` : ""}`)
          .join("\n")}`
      : "Open tasks: none",
  ]);
  return { self, body, refs: [self, ...refs], emails: [] };
}

async function loadThread(id: string, me: AskUser): Promise<Loaded | null> {
  const th = await loadThreadFor(id, me.name);
  if (!th) return null;
  const refs: AskToolRef[] = [];
  const self = mkRef("thread", th.id, th.subject || th.id);
  const cust = await companyLink(th.customerId);
  if (cust) refs.push(cust.ref);
  const emails = new Set<string>();
  pushEmail(emails, th.contactEmail);
  pushEmail(emails, th.cc);
  const people = new Set<string>();
  if (th.contactName || th.contactEmail) people.add(`${f(th.contactName)}${th.contactEmail ? ` <${f(th.contactEmail)}>` : ""}`.trim());
  for (const m of th.messages || []) {
    if (m.channel !== "email") continue;
    pushEmail(emails, m.fromEmail);
    pushEmail(emails, m.to);
    pushEmail(emails, m.cc);
    if (m.author) people.add(`${f(m.author, 80)}${m.fromEmail ? ` <${f(m.fromEmail)}>` : ""}`);
  }
  const participants = [...people].join("; ");
  const header = defangWrappers(
    join([
      `Email thread ${tok("thread", th.id)} — ${f(th.subject, 200)}`,
      `Status: ${th.status}${th.archived ? " (archived)" : ""} · Updated: ${day(th.updatedAt)}`,
      cust ? `Company: ${cust.label}` : line("Customer", f(th.customer)),
      th.link ? `Linked to: ${f(th.link.type, 20)} ${f(th.link.id, 80)}${th.link.label ? ` (${f(th.link.label)})` : ""}` : "",
      people.size ? `Participants: ${participants.length > ASK_PARTICIPANTS_CHARS ? participants.slice(0, ASK_PARTICIPANTS_CHARS) + " …" : participants}` : "",
    ])
  );
  const blocks = promptMessages(th)
    .sort((a, b) => a.at - b.at)
    .slice(-ASK_THREAD_MESSAGES)
    .map((m) => ({ head: defangWrappers(`--- ${m.direction === "in" ? "RECEIVED" : "SENT BY PEAK"} · ${f(m.author, 80) || "unknown"} · ${day(m.at)}`), body: defangWrappers(messageBody(m.body)) }));
  const msgs = budgetMessages(blocks, ASK_TOOL_BODY_MAX - header.length - THREAD_BUDGET_RESERVE);
  const body = join([
    header,
    msgs.text
      ? `Latest messages (oldest first${msgs.dropped ? `; ${msgs.dropped} earlier message${msgs.dropped === 1 ? "" : "s"} not shown` : ""}):\n${msgs.text}`
      : "Messages: none",
  ]);
  return { self, body, refs: [self, ...refs], emails: [...emails] };
}

/** Room kept beside the header for the messages' heading line. */
const THREAD_BUDGET_RESERVE = 120;
export const ASK_PARTICIPANTS_CHARS = 800;

/**
 * Fit thread messages (oldest → newest, already defanged) into `budget`
 * characters, keeping the NEWEST: whole messages are taken newest-first
 * while they fit and the oldest are dropped; when even the newest alone is
 * too long, its body keeps its start, trimmed to fit. Printed oldest → newest.
 * Pure — exported for the checks.
 */
export function budgetMessages(blocks: readonly { head: string; body: string }[], budget: number): { text: string; dropped: number } {
  const kept: string[] = [];
  let used = 0;
  for (let i = blocks.length - 1; i >= 0; i--) {
    const s = `${blocks[i].head}\n${blocks[i].body}`;
    const cost = s.length + (kept.length ? 1 : 0);
    if (used + cost <= budget) {
      kept.unshift(s);
      used += cost;
      continue;
    }
    if (kept.length) return { text: kept.join("\n"), dropped: i + 1 }; // messages 0..i left out
    // even the newest alone is too long: keep its start, trimmed to fit; everything older is left out
    const room = Math.max(0, budget - blocks[i].head.length - 1 - " …[trimmed]".length);
    return { text: `${blocks[i].head}\n${blocks[i].body.slice(0, room).trimEnd()} …[trimmed]`, dropped: i };
  }
  return { text: kept.join("\n"), dropped: 0 };
}

async function loadMeeting(id: string, me: AskUser): Promise<Loaded | null> {
  const m = await getMeeting(id).catch(() => null);
  if (!m || !canSeeMeeting(m, me.id)) return null;
  // Only the people this meeting names (attendees, mapped speakers) — never the whole contact book.
  const contactIds = [
    ...new Set([...m.attendees.map((a) => a.contactId), ...Object.values(m.speakerMap).map((s) => s.contactId)].filter((x): x is string => !!x)),
  ].slice(0, ASK_MEETING_CONTACTS_MAX);
  const [contacts, users] = await Promise.all([Promise.all(contactIds.map((cid) => getContact(cid))), activeUsers()]);
  const contactName = new Map(contacts.filter((c): c is NonNullable<typeof c> => !!c).map((c) => [c.id, displayName(c)]));
  const userName = new Map(users.map((u) => [u.id, u.name]));
  const r = renderMeeting(m, { contact: (cid) => contactName.get(cid) ?? null, user: (uid) => userName.get(uid) ?? null });
  const refs: AskToolRef[] = [];
  const self = mkRef("meeting", m.id, m.krisp.title || "Meeting", { filedAt: m.filedAt, noise: m.noise });
  const [cust, site] = await Promise.all([companyLink(m.links.customerId), m.links.siteId ? getSite(m.links.siteId) : Promise.resolve(null)]);
  if (cust) refs.push(cust.ref);
  if (site) refs.push(mkRef("venue", site.id, site.name || site.id));
  const emails = new Set<string>();
  const attendees = r.attendees.map((a) => {
    pushEmail(emails, a.email);
    return `${f(a.display, 80)}${a.email ? ` <${f(a.email)}>` : ""}`;
  });
  const mins = typeof m.krisp.durationSec === "number" ? Math.round(m.krisp.durationSec / 60) : null;
  const w = m.links.work;
  const body = join([
    `Meeting ${tok("meeting", m.id)} — ${f(m.krisp.title) || "Untitled meeting"}`,
    `Date: ${day(m.krisp.startedAt)}${mins != null ? ` · ${mins} min` : ""} · ${m.filedAt ? `filed ${day(m.filedAt)}` : m.noise ? "noise" : "not filed yet"}`,
    cust ? `Company: ${cust.label}` : "",
    site ? `Venue: ${f(site.name)} ${tok("venue", site.id)}` : "",
    w ? `Linked work: ${w.type} ${f(w.id, 80)}${w.label ? ` (${f(w.label)})` : ""}` : "",
    attendees.length ? `Attendees:\n${capList(attendees.map((a) => `- ${a}`)).join("\n")}` : "",
    r.summary.length ? `Summary:\n${capList(r.summary.map((s) => `- ${f(s.title, 200)}${s.description ? `: ${f(s.description, 1200)}` : ""}`)).join("\n")}` : "Summary: none",
    r.keyPoints.length ? `Key points:\n${capList(r.keyPoints.map((k) => `- ${f(k, 300)}`)).join("\n")}` : "",
    r.todos.length
      ? `To-dos:\n${capList(
          r.todos.map((x) => `- ${f(x.title, 200)}${x.assigneeDisplay ? ` — ${f(x.assigneeDisplay, 60)}` : ""}${x.dueDate ? ` — due ${f(x.dueDate, 20)}` : ""}${x.decision ? ` — decided: ${x.decision.kind}` : ""}`)
        ).join("\n")}`
      : "",
    "(The transcript is not available to Ask AI.)",
  ]);
  return { self, body, refs: [self, ...refs], emails: [...emails] };
}

async function loadSurvey(id: string): Promise<Loaded | null> {
  const s = await getSurvey(id);
  if (!s) return null;
  const self = mkRef("survey", s.id, surveyTitle(s));
  const refs: AskToolRef[] = [];
  const cust = await companyLink(s.customerId);
  if (cust) refs.push(cust.ref);
  // surveyText's own <site_visit> wrapper lines are dropped: the <record> is the wrapper here.
  const inner = surveyText(s)
    .split("\n")
    .filter((l, i, a) => !(i === 0 && l.startsWith("<site_visit")) && !(i === a.length - 1 && l === "</site_visit>"));
  const body = join([`Venue assessment ${tok("survey", s.id)} — ${f(surveyTitle(s), 200)}`, line("Stage", f(s.stage, 40)), cust ? `Company: ${cust.label}` : "", ...inner]);
  return { self, body, refs: [self, ...refs], emails: [] };
}

/* ---------------- list tools ---------------- */

/** ⌘K group label → the ref kind its rows link as (groups not listed have no kind). */
const SEARCH_GROUP_KIND: Readonly<Record<string, RefKind>> = {
  Quotes: "quote",
  Opportunities: "lead",
  Surveys: "survey",
  "Email threads": "thread",
  Companies: "company",
  Meetings: "meeting",
  Catalog: "part",
};

async function runSearch(query: string, me: AskUser): Promise<Loaded> {
  // threadsOf: only the user's own mailbox reaches the email-thread group, before its cut to 5.
  const groups: Group[] = await globalSearch(query, me, { threadsOf: me.name });
  const refs: AskToolRef[] = [];
  const blocks: string[] = [];
  for (const g of groups) {
    const kind = SEARCH_GROUP_KIND[g.label];
    const rows: string[] = [];
    for (const item of g.items) {
      if (kind === "thread") {
        // ⌘K lists every mailbox's subjects; Ask reads only the user's own (loadThreadFor).
        if (!(await loadThreadFor(item.id, me.name))) continue;
        refs.push(mkRef("thread", item.id, item.title));
      } else if (kind === "quote") {
        const q = await getQuote(item.id);
        if (!q) continue;
        refs.push(quoteRef(q));
      } else if (kind === "meeting") {
        // globalSearch already applied canSeeMeeting; its href is the reader's (meetingReaderHref).
        refs.push({ kind, id: item.id, title: t(item.title) || item.id, href: item.href.startsWith("/") ? item.href : hrefFor("meeting", item.id) });
      } else if (kind) {
        refs.push(mkRef(kind, item.id, item.title));
      }
      const label = kind ? tok(kind, item.id) : `(id ${f(item.id, ID_MAX)})`;
      rows.push(`- ${label} ${f(item.title, 160)}${item.sub ? ` — ${f(item.sub, 200)}` : ""}`);
    }
    if (rows.length) blocks.push(`${g.label}${kind ? "" : " (no link)"}:\n${rows.join("\n")}`);
  }
  const body = blocks.length ? `Search results for "${f(query, QUERY_MAX)}":\n${blocks.join("\n")}` : `No results for "${f(query, QUERY_MAX)}".`;
  return { self: null, body, refs, emails: [] };
}

/** The quote fields list_quotes reads — a header projection, never whole quote documents. */
const QUOTE_HEADER_FIELDS = ["name", "customer", "customerId", "status", "quoteType", "value", "updatedAt", "estNo", "estSuffix"] as const;

async function runListQuotes(input: z.infer<typeof ListQuotesInput>): Promise<Loaded> {
  const limit = input.limit ?? 10;
  const all = input.customerId
    ? await listDocsByField<Quote>("quotes", "customerId", [input.customerId])
    : await listDocsFiltered<Quote>("quotes", { fields: QUOTE_HEADER_FIELDS });
  const since = input.sinceDays ? Date.now() - input.sinceDays * DAY_MS : 0;
  const rows = all
    .filter((q) => (!input.status || q.status === input.status) && (!input.type || (q.quoteType || "system") === input.type) && (!since || (q.updatedAt || 0) >= since))
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const shown = rows.slice(0, limit);
  const refs = shown.map(quoteRef);
  const filters = [
    input.customerId ? `company ${f(input.customerId, ID_MAX)}` : "",
    input.status ? `status ${input.status}` : "",
    input.type ? `type ${input.type}` : "",
    input.sinceDays ? `updated in the last ${input.sinceDays} days` : "",
  ].filter(Boolean);
  const body = join([
    `Quotes${filters.length ? ` (${filters.join(", ")})` : ""}: ${rows.length} match${rows.length === 1 ? "" : "es"}${rows.length > shown.length ? `, newest ${shown.length} shown` : ""}`,
    ...shown.map((q) => `- ${tok("quote", q.id)} ${f(displayQuoteNumber(q))} ${f(q.name)} — ${f(q.customer, 80)} — ${q.status} — ${money(q.value)} — updated ${day(q.updatedAt)}`),
  ]);
  return { self: null, body, refs, emails: [] };
}

/** The catalog fields search_catalog's SQL pre-filter searches (a superset of rankCatalogParts' fields). */
const CATALOG_TEXT_FIELDS = ["sku", "desc", "mfr", "manufacturerPartNumber", "manufacturerModelNumber", "formerSkus", "category"] as const;
/** The catalog fields read back — a projection, never whole part documents. */
const CATALOG_FIELDS = ["sku", "desc", "category", "unit", "list", "cost", "mfr", "manufacturerPartNumber", "manufacturerModelNumber", "formerSkus"] as const;
const CATALOG_TOKENS_MAX = 8;

/**
 * Catalog search without reading the book: SQL keeps live parts whose fields
 * hold EVERY query word (ASK_CATALOG_CANDIDATES at most), then the
 * Estimator's ranking (`rankCatalogParts`, the whole phrase) orders them and
 * the other every-word matches follow; an exact SKU (renames followed) leads.
 */
async function runSearchCatalog(input: z.infer<typeof CatalogInput>): Promise<Loaded> {
  const limit = input.limit ?? ASK_CATALOG_MAX;
  const q = input.query.trim().toLowerCase();
  const tokens = [...new Set(q.split(/\s+/).filter(Boolean))].slice(0, CATALOG_TOKENS_MAX);
  const [cands, exact] = await Promise.all([
    listDocsFiltered<CatalogPart>("catalog_parts", { textFields: CATALOG_TEXT_FIELDS, allText: tokens, limit: ASK_CATALOG_CANDIDATES, fields: CATALOG_FIELDS }),
    getPart(input.query.trim()),
  ]);
  const ranked = rankCatalogParts(cands, q).map((x) => x.p);
  const inRanked = new Set(ranked.map((p) => p.sku));
  const rest = cands
    .filter((p) => !inRanked.has(p.sku) && tokens.every((tk) => partSearchHaystack(p).includes(tk) || (p.category || "").toLowerCase().includes(tk)))
    .sort((a, b) => (a.desc || "").localeCompare(b.desc || ""));
  const seen = new Set<string>();
  const hits = [...(exact ? [exact] : []), ...ranked, ...rest].filter((p) => (seen.has(p.sku) ? false : (seen.add(p.sku), true))).slice(0, limit);
  const refs = hits.map((p) => mkRef("part", p.sku, p.desc || p.sku));
  const body = hits.length
    ? join([
        `Catalog parts for "${f(input.query, QUERY_MAX)}"${cands.length >= ASK_CATALOG_CANDIDATES ? " (many matches — add words to narrow it)" : ""}:`,
        ...hits.map((p) => {
          const model = (p.manufacturerModelNumber || "").trim();
          const mpn = (p.manufacturerPartNumber || "").trim();
          return `- ${tok("part", p.sku)} ${f(p.desc, 200)} — ${f(p.mfr, 60) || "no manufacturer"}${model ? ` · model ${f(model, 80)}` : ""}${mpn ? ` · P/N ${f(mpn, 80)}` : ""} · ${f(p.category, 40)} · unit ${f(p.unit || "ea", 20)} · cost ${money(p.cost)} · list ${money(p.list)}`;
        }),
      ])
    : `No catalog parts match "${f(input.query, QUERY_MAX)}".`;
  return { self: null, body, refs, emails: [] };
}

/** Mine: assigned to my id, else (legacy) to my name. */
const myTask = (x: TaskRecord, me: AskUser) => x.assigneeUserId === me.id || (!x.assigneeUserId && (x.assigneeName || "").trim().toLowerCase() === me.name.trim().toLowerCase());

function taskLinks(x: TaskRecord): string {
  const parts = [
    x.customerId ? `company ${x.customerId}` : "",
    x.projectId ? `project ${x.projectId}` : "",
    x.quoteId ? `quote ${x.quoteId}` : "",
    x.leadId ? `lead ${x.leadId}` : "",
    x.threadId ? `thread ${x.threadId}` : "",
    x.meetingId ? `meeting ${x.meetingId}` : "",
    x.engagementId ? `engagement ${x.engagementId}` : "",
  ].filter(Boolean);
  return parts.length ? ` — links: ${f(parts.join(", "), 300)}` : "";
}

async function runMyTasks(me: AskUser): Promise<Loaded> {
  const [tasks, assignments] = await Promise.all([allTasks(), allAssignments()]);
  type Row = { id: string; title: string; due: number; text: string };
  const rows: Row[] = [];
  for (const x of tasks) {
    // a "Waiting on customer" nudge is the customer's to-do, not mine (the queue's rule)
    if (x.status === "done" || x.waitingOn || !myTask(x, me)) continue;
    rows.push({
      id: x.id,
      title: x.title,
      due: x.dueAt || 0,
      text: `${f(x.title, 200)}${x.status !== "open" ? ` (${x.status})` : ""}${x.dueAt ? ` — due ${day(x.dueAt)}` : " — no due date"}${taskLinks(x)}`,
    });
  }
  for (const a of assignments as Assignment[]) {
    if (a.done || a.assignee !== me.name) continue;
    rows.push({
      id: a.id,
      title: a.title,
      due: a.dueDate || 0,
      text: `${f(a.title, 200)} (assigned by ${f(a.createdBy, 60)})${a.dueDate ? ` — due ${day(a.dueDate)}` : " — no due date"}${a.link ? ` — links: ${a.link.kind} ${f(a.link.id, 80)}${a.link.label ? ` (${f(a.link.label)})` : ""}` : ""}`,
    });
  }
  rows.sort((a, b) => (a.due || Infinity) - (b.due || Infinity) || a.title.localeCompare(b.title));
  const shown = rows.slice(0, ASK_MY_TASKS_MAX);
  const refs = shown.map((r) => mkRef("task", r.id, r.title));
  const body = shown.length
    ? join([`Your open tasks and assignments: ${rows.length}${rows.length > shown.length ? `, soonest ${shown.length} shown` : ""} (dates are America/Chicago)`, ...shown.map((r) => `- ${tok("task", r.id)} ${r.text}`)])
    : "You have no open tasks or assignments.";
  return { self: null, body, refs, emails: [] };
}

/* ---------------- the entry points ---------------- */

const error = (message: string): ReadToolResult => ({ text: message, refs: [], emails: [], isError: true });
const notFound = (kind: string, id: string): ReadToolResult => ({ text: finish(kind, id, notFoundText(kind, id)), refs: [], emails: [] });
const done = (kind: string, id: string, l: Loaded): ReadToolResult => ({ text: finish(kind, id, l.body), refs: dedupeRefs(l.refs), emails: [...new Set(l.emails)] });

/**
 * Run one read tool as `me`. Input is validated here too (the runner may
 * already have): an unknown tool, invalid input or a failed lookup comes
 * back with `isError`. A forbidden record and a missing record both answer
 * `notFoundText`.
 */
export async function runReadTool(name: string, input: unknown, me: AskUser): Promise<ReadToolResult> {
  const tool = TOOL_BY_NAME.get(name);
  if (!tool) return error(`Unknown tool "${f(name, 60)}".`);
  const parsed = tool.input.safeParse(input ?? {});
  if (!parsed.success) return error(`Invalid input for ${tool.name}: ${f(parsed.error.issues.map((i) => `${i.path.join(".") || "input"} ${i.message}`).join("; "), 300)}`);
  const args = parsed.data as Record<string, unknown>;
  const id = typeof args.id === "string" ? args.id : "";
  try {
    switch (tool.name) {
      case "search":
        return done("search", String(args.query), await runSearch(String(args.query), me));
      case "list_quotes":
        return done("quotes", "list", await runListQuotes(args as z.infer<typeof ListQuotesInput>));
      case "search_catalog":
        return done("catalog", "search", await runSearchCatalog(args as z.infer<typeof CatalogInput>));
      case "my_tasks":
        return done("tasks", me.id, await runMyTasks(me));
      case "get_quote": {
        const r = await loadQuote(id);
        if (r && "ambiguous" in r) return { text: finish("quote", id, `More than one quote answers to "${f(id, ID_MAX)}": ${r.ambiguous.map((n) => f(n, 40)).join(", ")}. Ask for the full number.`), refs: [], emails: [] };
        return r ? done("quote", r.self?.id ?? id, r) : notFound("quote", id);
      }
      default: {
        const kind = TOOL_KIND[tool.name];
        const l = await loadKind(kind, id, me);
        return l ? done(kind, l.self?.id ?? id, l) : notFound(kind, id);
      }
    }
  } catch (err) {
    console.error(`[ask] ${tool.name} failed:`, err);
    return error(`The ${tool.name} lookup failed — try again or answer without it.`);
  }
}

const TOOL_KIND: Record<"get_company" | "get_venue" | "get_lead" | "get_project" | "get_thread" | "get_meeting", RefKind> = {
  get_company: "company",
  get_venue: "venue",
  get_lead: "lead",
  get_project: "project",
  get_thread: "thread",
  get_meeting: "meeting",
};

/** The record loader for a kind with a summary (company … survey); null when missing or forbidden. */
async function loadKind(kind: RefKind, id: string, me: AskUser): Promise<Loaded | null> {
  switch (kind) {
    case "company":
      return loadCompany(id);
    case "venue":
      return loadVenue(id);
    case "quote": {
      const r = await loadQuote(id);
      return r && !("ambiguous" in r) ? r : null;
    }
    case "lead":
      return loadLead(id, me);
    case "project":
      return loadProject(id);
    case "thread":
      return loadThread(id, me);
    case "meeting":
      return loadMeeting(id, me);
    case "survey":
      return loadSurvey(id);
    default:
      return null;
  }
}

/** A record summary (unwrapped, uncapped) for the page context: the same loader and access rule as its tool. */
export async function loadRecordSummary(kind: RefKind, id: string, me: AskUser): Promise<{ ref: AskToolRef; body: string; refs: AskToolRef[]; emails: string[] } | null> {
  const l = await loadKind(kind, id, me);
  return l && l.self ? { ref: l.self, body: l.body, refs: dedupeRefs(l.refs), emails: [...new Set(l.emails)] } : null;
}

/**
 * Re-check one `[[kind:id]]` from earlier in the conversation under the same
 * access rule as its tool, cheaply (no summary): the ref to emit again, or
 * null when it is missing or this user may not open it.
 */
export async function resolveAskRef(kind: RefKind, id: string, me: AskUser): Promise<AskToolRef | null> {
  if (!id) return null;
  switch (kind) {
    case "company": {
      const c = await getCompany(id);
      return c ? companyRef(c) : null;
    }
    case "venue": {
      const s = await getSite(id);
      return s ? mkRef("venue", s.id, s.name || s.id) : null;
    }
    case "quote": {
      const q = await getQuote(id);
      return q ? quoteRef(q) : null;
    }
    case "lead": {
      const l = await getLead(id);
      return l ? mkRef("lead", l.id, leadTitle(l)) : null;
    }
    case "project": {
      const p = await getProject(id);
      return p ? mkRef("project", p.id, p.name || p.id) : null;
    }
    case "thread": {
      const th = await loadThreadFor(id, me.name);
      return th ? mkRef("thread", th.id, th.subject || th.id) : null;
    }
    case "meeting": {
      const m = await getMeeting(id).catch(() => null);
      return m && canSeeMeeting(m, me.id) ? mkRef("meeting", m.id, m.krisp.title || "Meeting", { filedAt: m.filedAt, noise: m.noise }) : null;
    }
    case "survey": {
      const s = await getSurvey(id);
      return s ? mkRef("survey", s.id, surveyTitle(s)) : null;
    }
    case "part": {
      // A renamed SKU resolves to its live part, but the ref keeps the REQUESTED id so the
      // earlier [[part:<old sku>]] token still matches the whitelist (the catalog link searches former SKUs).
      const p = await getPart(id);
      return p ? mkRef("part", id, p.desc || p.sku) : null;
    }
    case "task": {
      const x = await getTask(id);
      if (x) return myTask(x, me) ? mkRef("task", x.id, x.title) : null;
      const a = await getAssignment(id);
      return a && a.assignee === me.name ? mkRef("task", a.id, a.title) : null;
    }
  }
}
