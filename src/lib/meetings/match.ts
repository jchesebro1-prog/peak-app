import { nameCore, normalizeText, venueCore } from "./names";
import type { MeetingSuggestion, Strength, WorkType } from "./types";
import { NOISE_MAX_SEC } from "./types";

/** `cores`: the company's name + keyword cores, precomputed by prepareMatchIndex. */
export type MatchCompany = { id: string; name: string; keywords: string[]; cores?: string[] };
/** `cores`: the venue's distinctive cores (venue-type words stripped, shared cores dropped), precomputed by prepareMatchIndex. */
export type MatchSite = { id: string; companyId: string; name: string; locationName: string | null; cores?: string[] };
export type MatchContact = { id: string; companyId: string | null; firstName: string; lastName: string; emails: string[] };
export type MatchUser = { id: string; name: string; emails: string[] };
export type MatchVisit = {
  kind: "site_visit" | "survey"; id: string; label: string;
  companyId: string | null; siteId: string | null; startMs: number; endMs: number; assigneeUserId: string | null;
};
export type MatchWork = { type: "lead" | "project" | "engagement"; id: string; label: string; companyId: string };

export type MatchIndex = {
  companies: MatchCompany[];
  sites: MatchSite[];
  contacts: MatchContact[];
  users: MatchUser[];
  internalDomains: string[];
  /** lowercased email domain → company ids (customersForDomain) */
  domainCompanies: Record<string, string[]>;
  visits: MatchVisit[];
  openWork: MatchWork[];
  /** set by prepareMatchIndex: every company and site carries its `cores` */
  prepared?: true;
};

export type MatchInput = {
  title: string;
  calendarTitle: string | null;
  summaryText: string;
  attendees: { name: string; email: string | null }[];
  speakerNames: string[];
  startMs: number | null;
  endMs: number | null;
  durationSec: number | null;
  ownerUserId: string;
};

export type MatchResult = { noise: boolean; suggestions: MeetingSuggestion[] };

const P = { title: 50, venueBonus: 10, calendar: 30, emailContact: 60, emailDomain: 40, visit: 40, summary: 20, speaker: 10 };
const STRONG_MIN = 80, STRONG_LEAD = 30, WEAK_MIN = 40;
/** A venue core shared by more companies' venues than this names a kind of room, not a customer. */
export const MAX_VENUE_CORE_COMPANIES = 3;
/** Weak ties beyond this are noise for the rep: at most this many company suggestions when none is strong. */
export const MAX_WEAK_COMPANIES = 3;

type Cand = { id: string; label: string; score: number; reasons: string[]; venueId: string | null; visit: MatchVisit | null };

function domainOf(email: string): string { return email.slice(email.lastIndexOf("@") + 1).toLowerCase(); }

const uniq = (xs: (string | null)[]): string[] => [...new Set(xs.filter((x): x is string => !!x))];

/**
 * Precompute every company's and venue's name cores ONCE (buildMatchIndex calls this; matchMeeting prepares an
 * unprepared index itself). Venue cores are the venue's distinctive part — generic + venue-type words stripped
 * (`venueTypeLabels`: the editable venue-type list's labels) — never equal to the company's own core, and a core
 * that more than MAX_VENUE_CORE_COMPANIES companies' venues share is dropped. Pure.
 */
export function prepareMatchIndex(index: MatchIndex, venueTypeLabels: readonly string[] = []): MatchIndex {
  const typeWords = new Set(venueTypeLabels.flatMap((l) => normalizeText(l).split(" ")).filter(Boolean));
  const companyCore = new Map(index.companies.map((c) => [c.id, nameCore(c.name)]));
  const companies = index.companies.map((c) => ({ ...c, cores: uniq([nameCore(c.name), ...c.keywords.map((k) => nameCore(k))]) }));
  const raw = index.sites.map((s) =>
    uniq([venueCore(s.name, typeWords), venueCore(s.locationName, typeWords)]).filter((c) => c !== companyCore.get(s.companyId)));
  const owners = new Map<string, Set<string>>();
  index.sites.forEach((s, i) => {
    for (const c of raw[i]) {
      const set = owners.get(c) ?? new Set<string>();
      set.add(s.companyId);
      owners.set(c, set);
    }
  });
  const sites = index.sites.map((s, i) => ({ ...s, cores: raw[i].filter((c) => (owners.get(c)?.size ?? 0) <= MAX_VENUE_CORE_COMPANIES) }));
  return { ...index, companies, sites, prepared: true };
}

/** Per-index lookups, built once per index object (a sync matches every meeting against one index). */
type Lookups = {
  ix: MatchIndex;
  sitesBy: Map<string, MatchSite[]>;
  internalEmails: Set<string>;
  contactByEmail: Map<string, MatchContact>;
  /** company id → its contacts' normalized first names */
  firstNamesBy: Map<string, Set<string>>;
};
const lookupCache = new WeakMap<MatchIndex, Lookups>();

function lookups(index: MatchIndex): Lookups {
  const hit = lookupCache.get(index);
  if (hit) return hit;
  const ix = index.prepared ? index : prepareMatchIndex(index);
  const sitesBy = new Map<string, MatchSite[]>();
  for (const s of ix.sites) {
    const list = sitesBy.get(s.companyId);
    if (list) list.push(s);
    else sitesBy.set(s.companyId, [s]);
  }
  const contactByEmail = new Map<string, MatchContact>();
  const firstNamesBy = new Map<string, Set<string>>();
  for (const c of ix.contacts) {
    for (const e of c.emails) contactByEmail.set(e.toLowerCase(), c);
    if (!c.companyId) continue;
    const fn = normalizeText(c.firstName);
    if (!fn) continue;
    const set = firstNamesBy.get(c.companyId) ?? new Set<string>();
    set.add(fn);
    firstNamesBy.set(c.companyId, set);
  }
  const out: Lookups = {
    ix, sitesBy, contactByEmail, firstNamesBy,
    internalEmails: new Set(ix.users.flatMap((u) => u.emails.map((e) => e.toLowerCase()))),
  };
  lookupCache.set(index, out);
  return out;
}

/** " " + normalized text + " ", so a core hit is one whole-word `includes`. */
const padded = (text: string | null | undefined) => " " + normalizeText(text) + " ";

/** The best (longest) precomputed core of a company or its venues that the padded text hits. */
function coreHit(text: string, company: MatchCompany, sites: MatchSite[]): { venueId: string | null; core: string } | null {
  let best: { venueId: string | null; core: string } | null = null;
  const consider = (core: string, venueId: string | null) => {
    if (!text.includes(" " + core + " ")) return;
    if (!best || core.length > best.core.length) best = { venueId, core };
  };
  for (const c of company.cores ?? []) consider(c, null);
  for (const s of sites) for (const c of s.cores ?? []) consider(c, s.id);
  return best;
}

function overlaps(v: MatchVisit, start: number, end: number): boolean {
  return v.startMs < end && start < v.endMs;
}

export function matchMeeting(input: MatchInput, index: MatchIndex): MatchResult {
  if (input.durationSec != null && input.durationSec < NOISE_MAX_SEC) return { noise: true, suggestions: [] };

  const { ix, sitesBy, internalEmails, contactByEmail, firstNamesBy } = lookups(index);
  const isInternal = (email: string) => internalEmails.has(email.toLowerCase()) || ix.internalDomains.includes(domainOf(email));

  const start = input.startMs ?? 0;
  const end = input.endMs ?? (start + (input.durationSec ?? 0) * 1000);
  const ownerVisits = input.startMs == null ? [] :
    ix.visits.filter((v) => v.assigneeUserId === input.ownerUserId && overlaps(v, start, end));

  const externalEmails = input.attendees.map((a) => a.email?.toLowerCase() || "").filter((e) => e && !isInternal(e));
  const firstNames = new Set(input.speakerNames.map((n) => normalizeText(n).split(" ")[0]).filter(Boolean));
  const title = padded(input.title);
  const calendar = input.calendarTitle ? padded(input.calendarTitle) : null;
  const summary = input.summaryText ? padded(input.summaryText) : null;

  const cands: Cand[] = [];
  for (const co of ix.companies) {
    const sites = sitesBy.get(co.id) || [];
    let score = 0; const reasons: string[] = []; let venueId: string | null = null; let visit: MatchVisit | null = null;
    const t = coreHit(title, co, sites);
    if (t) {
      score += P.title + (t.venueId ? P.venueBonus : 0); venueId = t.venueId;
      reasons.push(`title says “${t.core}”`);
    }
    if (calendar) {
      const c = coreHit(calendar, co, sites);
      if (c) { score += P.calendar; venueId = venueId || c.venueId; reasons.push(`calendar: “${input.calendarTitle}”`); }
    }
    const contactHits = externalEmails.map((e) => contactByEmail.get(e)).filter((c): c is MatchContact => !!c && c.companyId === co.id);
    if (contactHits.length) {
      score += P.emailContact;
      reasons.push(`${contactHits[0].emails[0]} is ${contactHits[0].firstName} ${contactHits[0].lastName}`.trim());
    } else if (externalEmails.some((e) => (ix.domainCompanies[domainOf(e)] || []).includes(co.id))) {
      score += P.emailDomain; reasons.push("attendee email domain");
    }
    // the owner's visits for this company count once; only an unambiguous one names the work and the venue
    const vs = ownerVisits.filter((x) => x.companyId === co.id);
    if (vs.length) {
      score += P.visit;
      if (vs.length === 1) { visit = vs[0]; venueId = venueId || vs[0].siteId; reasons.push(`during ${vs[0].label}`); }
      else reasons.push(`during ${vs.length} of your visits`);
    }
    if (summary && coreHit(summary, co, sites)) { score += P.summary; reasons.push("named in the notes"); }
    if (firstNames.size) {
      const known = firstNamesBy.get(co.id);
      if (known && [...firstNames].some((f) => known.has(f))) { score += P.speaker; reasons.push("a speaker's first name matches a contact"); }
    }
    if (score > 0) cands.push({ id: co.id, label: co.name, score, reasons, venueId, visit });
  }
  cands.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));

  const out: MeetingSuggestion[] = [];
  const top = cands[0];
  if (top && top.score >= WEAK_MIN) {
    const second = cands[1]?.score ?? 0;
    const strength: Strength = top.score >= STRONG_MIN && top.score - second >= STRONG_LEAD ? "strong" : "weak";
    out.push({ kind: "company", id: top.id, label: top.label, score: top.score, strength, reasons: top.reasons });
    if (strength === "weak") {
      for (const c of cands.slice(1, MAX_WEAK_COMPANIES)) {
        if (c.score < WEAK_MIN || top.score - c.score >= STRONG_LEAD) break;
        out.push({ kind: "company", id: c.id, label: c.label, score: c.score, strength: "weak", reasons: c.reasons });
      }
    }
    if (top.venueId) {
      const s = ix.sites.find((x) => x.id === top.venueId);
      if (s) out.push({ kind: "venue", id: s.id, label: s.name, score: top.score, strength, reasons: top.reasons });
    }
    for (const e of externalEmails) {
      const c = contactByEmail.get(e);
      if (c && (c.companyId === top.id || c.companyId === null) && !out.some((x) => x.kind === "contact" && x.id === c.id)) {
        out.push({ kind: "contact", id: c.id, label: `${c.firstName} ${c.lastName}`.trim(), score: top.score, strength, reasons: [`attendee ${e}`] });
      }
    }
    const work = workFor(top, ix.openWork);
    if (work) out.push({ kind: "work", id: work.id, label: work.label, workType: work.type, score: top.score, strength, reasons: work.reasons });
    return { noise: false, suggestions: out };
  }

  // Internal: no external candidate reached the bar.
  const internal = new Map<string, { label: string; byEmail: boolean }>();
  for (const a of input.attendees) {
    const u = a.email ? ix.users.find((x) => x.emails.some((e) => e.toLowerCase() === a.email!.toLowerCase())) : null;
    if (u && u.id !== input.ownerUserId) internal.set(u.id, { label: u.name, byEmail: true });
  }
  for (const n of input.speakerNames) {
    const u = ix.users.find((x) => normalizeText(x.name) === normalizeText(n));
    if (u && u.id !== input.ownerUserId && !internal.has(u.id)) internal.set(u.id, { label: u.name, byEmail: false });
  }
  for (const [id, v] of internal) {
    out.push({ kind: "internal", id, label: v.label, score: 0, strength: v.byEmail ? "strong" : "weak",
      reasons: [v.byEmail ? "Peak attendee" : "Peak speaker"] });
  }
  return { noise: false, suggestions: out };
}

function workFor(top: Cand, openWork: MatchWork[]): { type: WorkType; id: string; label: string; reasons: string[] } | null {
  if (top.visit) return { type: top.visit.kind, id: top.visit.id, label: top.visit.label, reasons: [`during ${top.visit.label}`] };
  for (const type of ["lead", "engagement", "project"] as const) {
    const mine = openWork.filter((w) => w.companyId === top.id && w.type === type);
    if (mine.length === 1) return { type, id: mine[0].id, label: mine[0].label, reasons: [`the only open ${type}`] };
    if (mine.length > 1) return null; // ambiguous at the most specific level → never guess
  }
  return null;
}
