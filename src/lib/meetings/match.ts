import { hitsCore, nameCore, normalizeText } from "./names";
import type { MeetingSuggestion, Strength, WorkType } from "./types";
import { NOISE_MAX_SEC } from "./types";

export type MatchCompany = { id: string; name: string; keywords: string[] };
export type MatchSite = { id: string; companyId: string; name: string; locationName: string | null };
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

type Cand = { id: string; label: string; score: number; reasons: string[]; venueId: string | null; visit: MatchVisit | null };

function domainOf(email: string): string { return email.slice(email.lastIndexOf("@") + 1).toLowerCase(); }

/** The best (longest) core of a company or its venues that `text` hits. */
function coreHit(text: string, company: MatchCompany, sites: MatchSite[]): { venueId: string | null; core: string } | null {
  let best: { venueId: string | null; core: string } | null = null;
  const consider = (core: string | null, venueId: string | null) => {
    if (!core || !hitsCore(text, core)) return;
    if (!best || core.length > best.core.length) best = { venueId, core };
  };
  consider(nameCore(company.name), null);
  for (const k of company.keywords) consider(nameCore(k), null);
  const companyCore = nameCore(company.name);
  for (const s of sites) {
    for (const nm of [s.name, s.locationName]) {
      const c = nameCore(nm);
      if (c && c !== companyCore) consider(c, s.id); // a venue core equal to the company core is not more specific
    }
  }
  return best;
}

function overlaps(v: MatchVisit, start: number, end: number): boolean {
  return v.startMs < end && start < v.endMs;
}

export function matchMeeting(input: MatchInput, index: MatchIndex): MatchResult {
  if (input.durationSec != null && input.durationSec < NOISE_MAX_SEC) return { noise: true, suggestions: [] };

  const sitesBy = new Map<string, MatchSite[]>();
  for (const s of index.sites) sitesBy.set(s.companyId, [...(sitesBy.get(s.companyId) || []), s]);
  const internalEmails = new Set(index.users.flatMap((u) => u.emails.map((e) => e.toLowerCase())));
  const isInternal = (email: string) => internalEmails.has(email.toLowerCase()) || index.internalDomains.includes(domainOf(email));
  const contactByEmail = new Map<string, MatchContact>();
  for (const c of index.contacts) for (const e of c.emails) contactByEmail.set(e.toLowerCase(), c);

  const start = input.startMs ?? 0;
  const end = input.endMs ?? (start + (input.durationSec ?? 0) * 1000);
  const ownerVisits = input.startMs == null ? [] :
    index.visits.filter((v) => v.assigneeUserId === input.ownerUserId && overlaps(v, start, end));

  const externalEmails = input.attendees.map((a) => a.email?.toLowerCase() || "").filter((e) => e && !isInternal(e));
  const firstNames = new Set(input.speakerNames.map((n) => normalizeText(n).split(" ")[0]).filter(Boolean));

  const cands: Cand[] = [];
  for (const co of index.companies) {
    const sites = sitesBy.get(co.id) || [];
    let score = 0; const reasons: string[] = []; let venueId: string | null = null; let visit: MatchVisit | null = null;
    const t = coreHit(input.title, co, sites);
    if (t) {
      score += P.title + (t.venueId ? P.venueBonus : 0); venueId = t.venueId;
      reasons.push(`title says “${t.core}”`);
    }
    if (input.calendarTitle) {
      const c = coreHit(input.calendarTitle, co, sites);
      if (c) { score += P.calendar; venueId = venueId || c.venueId; reasons.push(`calendar: “${input.calendarTitle}”`); }
    }
    const contactHits = externalEmails.map((e) => contactByEmail.get(e)).filter((c): c is MatchContact => !!c && c.companyId === co.id);
    if (contactHits.length) {
      score += P.emailContact;
      reasons.push(`${contactHits[0].emails[0]} is ${contactHits[0].firstName} ${contactHits[0].lastName}`.trim());
    } else if (externalEmails.some((e) => (index.domainCompanies[domainOf(e)] || []).includes(co.id))) {
      score += P.emailDomain; reasons.push("attendee email domain");
    }
    const v = ownerVisits.find((x) => x.companyId === co.id);
    if (v) { score += P.visit; visit = v; venueId = venueId || v.siteId; reasons.push(`during ${v.label}`); }
    if (input.summaryText && coreHit(input.summaryText, co, sites)) { score += P.summary; reasons.push("named in the notes"); }
    if (firstNames.size && index.contacts.some((c) => c.companyId === co.id && firstNames.has(normalizeText(c.firstName)))) {
      score += P.speaker; reasons.push("a speaker's first name matches a contact");
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
      for (const c of cands.slice(1)) {
        if (c.score < WEAK_MIN || top.score - c.score >= STRONG_LEAD) break;
        out.push({ kind: "company", id: c.id, label: c.label, score: c.score, strength: "weak", reasons: c.reasons });
      }
    }
    if (top.venueId) {
      const s = index.sites.find((x) => x.id === top.venueId);
      if (s) out.push({ kind: "venue", id: s.id, label: s.name, score: top.score, strength, reasons: top.reasons });
    }
    for (const e of externalEmails) {
      const c = contactByEmail.get(e);
      if (c && (c.companyId === top.id || c.companyId === null) && !out.some((x) => x.kind === "contact" && x.id === c.id)) {
        out.push({ kind: "contact", id: c.id, label: `${c.firstName} ${c.lastName}`.trim(), score: top.score, strength, reasons: [`attendee ${e}`] });
      }
    }
    const work = workFor(top, index.openWork);
    if (work) out.push({ kind: "work", id: work.id, label: work.label, workType: work.type, score: top.score, strength, reasons: work.reasons });
    return { noise: false, suggestions: out };
  }

  // Internal: no external candidate reached the bar.
  const internal = new Map<string, { label: string; byEmail: boolean }>();
  for (const a of input.attendees) {
    const u = a.email ? index.users.find((x) => x.emails.some((e) => e.toLowerCase() === a.email!.toLowerCase())) : null;
    if (u && u.id !== input.ownerUserId) internal.set(u.id, { label: u.name, byEmail: true });
  }
  for (const n of input.speakerNames) {
    const u = index.users.find((x) => normalizeText(x.name) === normalizeText(n));
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
