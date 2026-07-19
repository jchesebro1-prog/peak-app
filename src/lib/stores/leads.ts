import {
  getDoc,
  listDocs,
  nextPrefixedId,
  patchDoc,
  softDeleteDoc,
  upsertDoc,
} from "@/db/doc-store";

/**
 * LeadStore — direct port of app/lead.js (rss_leads_v1).
 *
 * Inbound SALES LEADS + pipeline, the step BEFORE a customer or a quote
 * exists. Pipeline: new → contacted → qualified → quoted → won / lost.
 * Every open lead carries an SLA first-response clock (firstContactAt,
 * slaHours), a manual nextAction date, and an activity log; followUps()
 * rolls those into one "nothing goes cold" worklist.
 *
 * Field names, id formats (L-####, base 1050), lifecycles and formulas are
 * the prototype's spec — ported exactly. Differences from the prototype:
 * - localStorage read/write/ensure → doc-store (Postgres JSONB).
 * - `window.Team.CURRENT` (meName) → explicit `me` parameter on mutations,
 *   defaulting to the prototype's fallback "Jeff Chesebro".
 * - dirty(): the prototype marked records syncState:'pending' for the
 *   SyncEngine to push; a server write IS the cloud write, so mutations
 *   land syncState:'synced' with syncedAt stamped (in-doc rev still bumps).
 * - remove() soft-deletes (doc-store semantics) instead of filtering.
 * - SyncEngine registration, _setSync, initCloudSeed and resetToSeed are
 *   client sync plumbing replaced by doc-store/seq — not ported.
 */

const DAY = 86400000;

/** Open lead with no activity this long → "going cold". */
export const STALE_DAYS = 5;

function now(): number {
  return Date.now();
}

/* ---- pipeline stages ----------------------------------------------------- */

export const STAGES = [
  "new",
  "contacted",
  "qualified",
  "quoted",
  "won",
  "lost",
] as const;
export type LeadStage = (typeof STAGES)[number];

export const OPEN_STAGES: readonly LeadStage[] = [
  "new",
  "contacted",
  "qualified",
  "quoted",
] as const;

export interface LeadStageMeta {
  label: string;
  short: string;
  ink: string;
  soft: string;
  bd: string;
  dot: string;
}

export const STAGE_META: Record<LeadStage, LeadStageMeta> = {
  new: { label: "New", short: "New", ink: "#b4543a", soft: "#f8ece7", bd: "#eccfc4", dot: "#c85a3c" },
  contacted: { label: "Contacted", short: "Contacted", ink: "#8a6d1f", soft: "#fbf3dd", bd: "#f0e2bd", dot: "#c8a53c" },
  qualified: { label: "Qualified", short: "Qualified", ink: "#3155a8", soft: "#e9eefb", bd: "#d4ddf3", dot: "#3d6fd0" },
  quoted: { label: "Quoted", short: "Quoted", ink: "#5b4b8a", soft: "#efeaf6", bd: "#ddd4ec", dot: "#7b5fb0" },
  won: { label: "Won", short: "Won", ink: "#1f7a52", soft: "#eaf6ef", bd: "#cce9da", dot: "#2f9d6b" },
  lost: { label: "Lost", short: "Lost", ink: "#8c919c", soft: "#f1f2f5", bd: "#e4e7ec", dot: "#aab0bb" },
};

export function stageMeta(k: string): LeadStageMeta {
  return STAGE_META[k as LeadStage] || STAGE_META.new;
}

export function stageIndex(k: string): number {
  return Math.max(0, (STAGES as readonly string[]).indexOf(k));
}

export function isOpen(l: Pick<LeadRecord, "stage">): boolean {
  return OPEN_STAGES.indexOf(l.stage) >= 0;
}

/* ---- sources -------------------------------------------------------------- */

export const SOURCES = [
  "website",
  "referral",
  "phone",
  "manual",
  "event",
  "existing",
] as const;
export type LeadSource = (typeof SOURCES)[number];

export interface LeadSourceMeta {
  label: string;
  short: string;
  verb: string;
  /** First-response SLA hours for leads from this source. */
  sla: number;
  color: string;
}

export const SOURCE_META: Record<LeadSource, LeadSourceMeta> = {
  website: { label: "Website form", short: "Website", verb: "submitted the website form", sla: 24, color: "#3155a8" },
  referral: { label: "Referral", short: "Referral", verb: "was referred to us", sla: 48, color: "#1f7a52" },
  phone: { label: "Phone / walk-in", short: "Phone", verb: "called in", sla: 24, color: "#b5683a" },
  manual: { label: "Manual entry", short: "Manual", verb: "was added by the team", sla: 48, color: "#8c919c" },
  event: { label: "Trade show / event", short: "Event", verb: "met us at an event", sla: 48, color: "#8a6d1f" },
  existing: { label: "Existing customer", short: "Existing", verb: "is an existing customer", sla: 48, color: "#5b4b8a" },
};

export function sourceMeta(k: string | undefined): LeadSourceMeta {
  return SOURCE_META[k as LeadSource] || SOURCE_META.manual;
}

export function slaForSource(k: string | undefined): number {
  return sourceMeta(k).sla;
}

/* ---- record shape ---------------------------------------------------------- */

export type SyncState = "synced" | "pending" | "syncing" | "error";

export const ACTIVITY_TYPES = [
  "note",
  "call",
  "email",
  "meeting",
  "system",
  "stage",
] as const;
export type LeadActivityType = (typeof ACTIVITY_TYPES)[number];

export interface LeadActivity {
  /** aid() — 'a' + 6 base-36 chars. */
  id: string;
  at: number;
  type: LeadActivityType;
  by: string;
  note: string;
}

export interface LeadRecord {
  [key: string]: unknown; // doc-store JSONB compatibility
  id: string; // L-#### (base 1050)
  org: string;
  contact: string;
  email: string;
  phone: string;
  city: string;
  state: string;
  source: LeadSource;
  stage: LeadStage;
  owner: string;
  interest: string;
  timeline: string;
  value: number;
  message: string;
  slaHours: number;
  firstContactAt: number | null;
  nextActionAt: number | null;
  nextActionNote: string;
  lostReason: string;
  customerId: string | null;
  convertedCustomerId: string | null;
  convertedQuoteId: string | null;
  convertedAt: number | null;
  activities: LeadActivity[];
  createdAt: number;
  updatedAt: number;
  lastActivityAt: number;
  syncState: SyncState;
  syncedAt: number | null;
  rev: number;
}

/* ---- record builders (shared with the seed) -------------------------------- */

export function aid(): string {
  return "a" + Math.random().toString(36).slice(2, 8);
}

export function act(
  at: number,
  type: LeadActivityType,
  by?: string,
  note?: string
): LeadActivity {
  return { id: aid(), at, type, by: by || "", note: note || "" };
}

export interface LeadSeedSpec {
  id: string;
  org?: string;
  contact?: string;
  email?: string;
  phone?: string;
  city?: string;
  state?: string;
  source?: string;
  stage?: string;
  owner?: string;
  interest?: string;
  timeline?: string;
  value?: number;
  message?: string;
  slaHours?: number;
  firstContactAt?: number | null;
  nextActionAt?: number | null;
  nextActionNote?: string;
  lostReason?: string;
  customerId?: string | null;
  convertedCustomerId?: string | null;
  convertedQuoteId?: string | null;
  convertedAt?: number | null;
  activities?: LeadActivity[];
  createdAt?: number;
  updatedAt?: number;
  lastActivityAt?: number;
  syncState?: SyncState;
  syncedAt?: number | null;
  rev?: number;
}

/** Build a lead record from a compact spec, filling activity/timestamps (prototype mk()). */
export function mkLead(o: LeadSeedSpec): LeadRecord {
  const created = o.createdAt != null ? o.createdAt : now();
  const activities = (o.activities || []).slice().sort((a, b) => a.at - b.at);
  if (!activities.length) activities.push(act(created, "system", "", "Lead created"));
  const lastAt = activities[activities.length - 1].at;
  return {
    id: o.id,
    org: o.org || "",
    contact: o.contact || "",
    email: o.email || "",
    phone: o.phone || "",
    city: o.city || "",
    state: o.state || "WI",
    source:
      (SOURCES as readonly string[]).indexOf(o.source || "") >= 0
        ? (o.source as LeadSource)
        : "manual",
    stage:
      (STAGES as readonly string[]).indexOf(o.stage || "") >= 0
        ? (o.stage as LeadStage)
        : "new",
    owner: o.owner != null ? o.owner : "",
    interest: o.interest || "",
    timeline: o.timeline || "",
    value: o.value || 0,
    message: o.message || "",
    slaHours: o.slaHours != null ? o.slaHours : slaForSource(o.source),
    firstContactAt: o.firstContactAt != null ? o.firstContactAt : null,
    nextActionAt: o.nextActionAt != null ? o.nextActionAt : null,
    nextActionNote: o.nextActionNote || "",
    lostReason: o.lostReason || "",
    customerId: o.customerId || null,
    convertedCustomerId: o.convertedCustomerId || null,
    convertedQuoteId: o.convertedQuoteId || null,
    convertedAt: o.convertedAt || null,
    activities,
    createdAt: created,
    updatedAt: o.updatedAt != null ? o.updatedAt : lastAt,
    lastActivityAt: o.lastActivityAt != null ? o.lastActivityAt : lastAt,
    syncState: o.syncState || "synced",
    syncedAt: o.syncedAt != null ? o.syncedAt : lastAt,
    rev: o.rev || 1,
  };
}

/* ---- internal write helpers ------------------------------------------------ */

/**
 * Prototype dirty() + markSynced collapsed: a server write is durable, so
 * the record lands 'synced' instead of queueing 'pending' for a SyncEngine.
 */
function dirty(l: LeadRecord): void {
  l.updatedAt = now();
  l.rev = (l.rev || 1) + 1;
  l.syncState = "synced";
  l.syncedAt = now();
}

function touch(l: LeadRecord, at?: number): void {
  l.lastActivityAt = at || now();
}

/** Prototype meName() fallback — callers should pass the session user's name. */
const DEFAULT_ME = "Jeff Chesebro";

/* ---- reads ------------------------------------------------------------------ */

export async function getAll(): Promise<LeadRecord[]> {
  const list = await listDocs<LeadRecord>("leads");
  return list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export async function get(id: string): Promise<LeadRecord | null> {
  return getDoc<LeadRecord>("leads", id);
}

export async function byStage(stage: string): Promise<LeadRecord[]> {
  return (await getAll()).filter((l) => l.stage === stage);
}

export async function open(): Promise<LeadRecord[]> {
  return (await getAll()).filter(isOpen);
}

export async function pending(): Promise<LeadRecord[]> {
  const list = await listDocs<LeadRecord>("leads");
  return list.filter((l) => l.syncState === "pending" || l.syncState === "syncing");
}

/* ---- SLA first-response clock ------------------------------------------------ */

export interface SlaInfo {
  state: "met" | "pending" | "breached" | "na";
  ms: number;
  deadline: number;
  at?: number;
}

export function slaDeadline(l: LeadRecord): number {
  return (l.createdAt || 0) + (l.slaHours || 24) * 3600000;
}

/** {state:'met'|'pending'|'breached'|'na', ms, deadline} */
export function sla(l: LeadRecord | null | undefined): SlaInfo {
  if (!l) return { state: "na", ms: 0, deadline: 0 };
  if (l.firstContactAt)
    return { state: "met", ms: 0, deadline: slaDeadline(l), at: l.firstContactAt };
  if (l.stage !== "new") return { state: "met", ms: 0, deadline: slaDeadline(l) };
  if (!isOpen(l)) return { state: "na", ms: 0, deadline: 0 };
  const dl = slaDeadline(l);
  const ms = dl - now();
  return { state: ms < 0 ? "breached" : "pending", ms, deadline: dl };
}

/** Whole days since the last activity (or creation). */
export function aging(l: LeadRecord): number {
  return Math.floor((now() - (l.lastActivityAt || l.createdAt || now())) / DAY);
}

/* ---- the follow-up worklist ("nothing goes cold") ----------------------------- */

export interface FollowUpInfo {
  need: boolean;
  /** 3 SLA breach, 2 follow-up overdue, 1 going stale, 0 none. */
  urgency: 0 | 1 | 2 | 3;
  reason: "sla" | "nextaction" | "stale" | "none";
  label: string;
}

export function followUpInfo(l: LeadRecord | null | undefined): FollowUpInfo {
  if (!l || !isOpen(l)) return { need: false, urgency: 0, reason: "none", label: "" };
  const s = sla(l);
  if (s.state === "breached")
    return { need: true, urgency: 3, reason: "sla", label: "First response overdue" };
  if (l.nextActionAt && l.nextActionAt < now())
    return { need: true, urgency: 2, reason: "nextaction", label: "Follow-up overdue" };
  const age = aging(l);
  if (age >= STALE_DAYS)
    return { need: true, urgency: 1, reason: "stale", label: "No contact in " + age + " days" };
  return { need: false, urgency: 0, reason: "none", label: "" };
}

export function needsFollowUp(l: LeadRecord): boolean {
  return followUpInfo(l).need;
}

export interface FollowUpOpts {
  owner?: string;
  unownedOrMine?: boolean;
  me?: string;
}

export async function followUps(opts: FollowUpOpts = {}): Promise<LeadRecord[]> {
  let list = (await open()).filter((l) => needsFollowUp(l));
  if (opts.owner) list = list.filter((l) => l.owner === opts.owner);
  if (opts.unownedOrMine && opts.me)
    list = list.filter((l) => l.owner === opts.me || !l.owner);
  return list
    .map((l) => ({ lead: l, info: followUpInfo(l) }))
    .sort(
      (a, b) =>
        b.info.urgency - a.info.urgency ||
        (a.lead.nextActionAt || a.lead.createdAt || 0) -
          (b.lead.nextActionAt || b.lead.createdAt || 0)
    )
    .map((x) => x.lead);
}

export async function followUpCount(opts: FollowUpOpts = {}): Promise<number> {
  return (await followUps(opts)).length;
}

/** Unassigned open leads (need triage/routing). */
export async function unassigned(): Promise<LeadRecord[]> {
  return (await open()).filter((l) => !l.owner);
}

/* ---- metrics for dashboards ---------------------------------------------------- */

export interface LeadMetrics {
  counts: Record<LeadStage, number>;
  open: number;
  openValue: number;
  needFollowUp: number;
  slaBreached: number;
  unassigned: number;
  newThisWeek: number;
  won: number;
  lost: number;
  conversion: number;
}

export async function metrics(): Promise<LeadMetrics> {
  const all = await listDocs<LeadRecord>("leads");
  const openList = all.filter(isOpen);
  const counts = {} as Record<LeadStage, number>;
  STAGES.forEach((s) => {
    counts[s] = 0;
  });
  all.forEach((l) => {
    counts[l.stage] = (counts[l.stage] || 0) + 1;
  });
  const won = all.filter((l) => l.stage === "won");
  const lost = all.filter((l) => l.stage === "lost");
  const decided = won.length + lost.length;
  const newThisWeek = all.filter((l) => (l.createdAt || 0) >= now() - 7 * DAY).length;
  return {
    counts,
    open: openList.length,
    openValue: openList.reduce((a, l) => a + (l.value || 0), 0),
    needFollowUp: openList.filter((l) => needsFollowUp(l)).length,
    slaBreached: openList.filter((l) => sla(l).state === "breached").length,
    unassigned: openList.filter((l) => !l.owner).length,
    newThisWeek,
    won: won.length,
    lost: lost.length,
    conversion: decided ? Math.round((won.length / decided) * 100) : 0,
  };
}

/* ---- mutations -------------------------------------------------------------------- */

export interface LeadCreateInput {
  id?: string;
  org?: string;
  contact?: string;
  email?: string;
  phone?: string;
  city?: string;
  state?: string;
  source?: string;
  owner?: string;
  interest?: string;
  timeline?: string;
  value?: number;
  message?: string;
  customerId?: string | null;
}

/**
 * Create a lead (website intake, quick-add, or rep log). Website leads come
 * in unassigned + stage 'new' so they enter the SLA queue; manual/rep-logged
 * leads default to the current user.
 */
export async function create(
  partial: LeadCreateInput = {},
  me: string = DEFAULT_ME
): Promise<LeadRecord> {
  const id = partial.id || (await nextPrefixedId("leads", "L", 1050));
  const src: LeadSource =
    (SOURCES as readonly string[]).indexOf(partial.source || "") >= 0
      ? (partial.source as LeadSource)
      : "manual";
  const t = now();
  const defaultOwner = src === "manual" || src === "existing" ? me : "";
  const firstAct = partial.message
    ? act(
        t,
        src === "website" ? "system" : "note",
        src === "website" ? "" : me,
        src === "website" ? "Website quote request received" : partial.message
      )
    : act(t, "system", "", "Lead created");
  const rec = mkLead({
    id,
    org: partial.org || "",
    contact: partial.contact || "",
    email: partial.email || "",
    phone: partial.phone || "",
    city: partial.city || "",
    state: partial.state || "WI",
    source: src,
    stage: "new",
    owner: partial.owner != null ? partial.owner : defaultOwner,
    interest: partial.interest || "",
    timeline: partial.timeline || "",
    value: partial.value || 0,
    message: partial.message || "",
    customerId: partial.customerId || null,
    createdAt: t,
    activities: [firstAct],
  });
  // mkLead defaults land syncState 'synced' / syncedAt t — the server write
  // is the cloud write (prototype: 'pending' until the SyncEngine pushed).
  await upsertDoc("leads", rec);
  return rec;
}

export async function update(
  id: string,
  patch: Partial<LeadRecord>
): Promise<LeadRecord | null> {
  return patchDoc<LeadRecord>("leads", id, (l) => {
    Object.assign(l, patch || {});
    dirty(l);
  });
}

export interface LogActivityInput {
  type?: string;
  by?: string;
  at?: number;
  note?: string;
  clearNextAction?: boolean;
}

export async function logActivity(
  id: string,
  a: LogActivityInput = {},
  me: string = DEFAULT_ME
): Promise<LeadRecord | null> {
  return patchDoc<LeadRecord>("leads", id, (l) => {
    const type: LeadActivityType =
      (ACTIVITY_TYPES as readonly string[]).indexOf(a.type || "") >= 0
        ? (a.type as LeadActivityType)
        : "note";
    const by = a.by != null ? a.by : me;
    const at = a.at || now();
    l.activities = (l.activities || []).concat([act(at, type, by, a.note || "")]);
    touch(l, at);
    // a real outbound touch satisfies the SLA first-response clock
    if (
      !l.firstContactAt &&
      ["call", "email", "meeting", "note"].indexOf(type) >= 0 &&
      by
    )
      l.firstContactAt = at;
    if (a.clearNextAction) {
      l.nextActionAt = null;
      l.nextActionNote = "";
    }
    dirty(l);
  });
}

export async function setStage(
  id: string,
  stage: string,
  me: string = DEFAULT_ME
): Promise<LeadRecord | null> {
  if ((STAGES as readonly string[]).indexOf(stage) < 0) return null;
  const current = await getDoc<LeadRecord>("leads", id);
  if (!current || current.stage === stage) return current;
  return patchDoc<LeadRecord>("leads", id, (l) => {
    const from = l.stage;
    l.stage = stage as LeadStage;
    if (!l.firstContactAt && stage !== "new") l.firstContactAt = now();
    l.activities = (l.activities || []).concat([
      act(now(), "stage", me, "Moved " + stageMeta(from).label + " → " + stageMeta(stage).label),
    ]);
    touch(l);
    dirty(l);
  });
}

export async function assign(
  id: string,
  owner: string,
  me: string = DEFAULT_ME
): Promise<LeadRecord | null> {
  return patchDoc<LeadRecord>("leads", id, (l) => {
    const prev = l.owner;
    l.owner = owner || "";
    l.activities = (l.activities || []).concat([
      act(
        now(),
        "system",
        me,
        owner ? "Assigned to " + owner + (prev ? " (was " + prev + ")" : "") : "Unassigned"
      ),
    ]);
    touch(l);
    dirty(l);
  });
}

export async function setNextAction(
  id: string,
  at: number | null,
  note?: string
): Promise<LeadRecord | null> {
  return patchDoc<LeadRecord>("leads", id, (l) => {
    l.nextActionAt = at || null;
    l.nextActionNote = note || "";
    dirty(l);
  });
}

export async function markLost(
  id: string,
  reason?: string,
  me: string = DEFAULT_ME
): Promise<LeadRecord | null> {
  return patchDoc<LeadRecord>("leads", id, (l) => {
    l.stage = "lost";
    l.lostReason = reason || "";
    l.activities = (l.activities || []).concat([
      act(now(), "stage", me, "Marked lost" + (reason ? " — " + reason : "")),
    ]);
    touch(l);
    dirty(l);
  });
}

/* ---- convert: lead → Customer + draft Quote ------------------------------------------ */

/** Customer slug id: lowercase, '&'→'and', strip non-alnum, max 18 chars. */
function slugBase(name: string): string {
  return (
    String(name || "lead")
      .toLowerCase()
      .replace(/&/g, "and")
      .replace(/[^a-z0-9]+/g, "")
      .slice(0, 18) || "lead"
  );
}

export interface ConvertOpts {
  venueLabel?: string;
  venueKind?: string;
  role?: string;
  type?: string;
}

export interface ConvertResult {
  customerId: string | null;
  quoteId: string | null;
  lead: LeadRecord;
}

/**
 * Convert a qualified lead → a real Customer + a draft Quote, linked back
 * onto the lead (prototype convert(), one step).
 *
 * Cross-store writes go through doc-store primitives directly — the customer
 * doc is written in CustomerStore.upsert's normalized shape and the quote doc
 * in QuoteStore.create's shape (id Q-#### base 2041, status 'draft',
 * source 'lead', review 'none', history [{at, to:'draft'}]).
 */
export async function convert(
  id: string,
  opts: ConvertOpts = {},
  me: string = DEFAULT_ME
): Promise<ConvertResult | null> {
  const l = await getDoc<LeadRecord>("leads", id);
  if (!l) return null;
  let customerId = l.customerId || l.convertedCustomerId || null;

  // 1) ensure a customer exists
  if (!customerId) {
    // slug collision check against live customer ids (prototype: CS.get)
    const taken = new Set((await listDocs("customers")).map((c) => c.id));
    const base = slugBase(l.org);
    let s = base;
    let i = 2;
    while (taken.has(s)) {
      s = base + i;
      i++;
    }
    customerId = s;
    const loc = {
      id: "loc1",
      label: opts.venueLabel || "Main venue",
      primary: true,
      city: l.city || "",
      state: l.state || "WI",
      venueKind: opts.venueKind || "proscenium",
      travelMiles: null,
      travelMin: null,
    };
    // normalizeRecord keeps phone since D76 — pass it through (the old
    // comment claiming it was dropped went stale; PUNCHLIST #12 bug).
    const contacts = l.contact
      ? [
          {
            name: l.contact,
            role: opts.role || "",
            email: l.email || "",
            phone: l.phone || "",
            primary: true,
          },
        ]
      : [];
    await upsertDoc("customers", {
      id: customerId,
      name: l.org,
      type: opts.type || "",
      location: [l.city, l.state].filter(Boolean).join(", "),
      locations: [loc],
      contacts,
    });
  }

  // 2) create a draft quote linked to that customer (QuoteStore.create shape)
  const quoteId = await nextPrefixedId("quotes", "Q", 2041);
  const t = now();
  await upsertDoc("quotes", {
    id: quoteId,
    name: l.org + (l.interest ? " — " + l.interest : " — New project"),
    customer: l.org,
    customerId: customerId || null,
    locationId: customerId ? "loc1" : null,
    value: Math.round(l.value || 0),
    margin: 0,
    status: "draft",
    source: "lead",
    quoteType: "system",
    flameTest: null,
    contact: null,
    owner: l.owner || me,
    spec: null,
    review: {
      state: "none",
      reviewer: null,
      submittedBy: null,
      submittedAt: null,
      decidedBy: null,
      decidedAt: null,
      note: "",
    },
    createdAt: t,
    updatedAt: t,
    history: [{ at: t, to: "draft" }],
  });

  // 3) link + advance the lead
  const lead = await patchDoc<LeadRecord>("leads", id, (rec) => {
    rec.customerId = customerId;
    rec.convertedCustomerId = customerId || null;
    rec.convertedQuoteId = quoteId || null;
    rec.convertedAt = now();
    if (!rec.firstContactAt) rec.firstContactAt = now();
    rec.stage = "quoted";
    rec.nextActionAt = null;
    rec.nextActionNote = "";
    rec.activities = (rec.activities || []).concat([
      act(now(), "system", me, "Converted to customer" + (quoteId ? " + quote " + quoteId : "")),
    ]);
    touch(rec);
    dirty(rec);
  });
  if (!lead) return null;
  return { customerId, quoteId, lead };
}

export async function remove(id: string): Promise<void> {
  await softDeleteDoc("leads", id);
}

/* ---- time helpers ----------------------------------------------------------------------- */

export function timeAgo(ts: number | null | undefined): string {
  if (!ts) return "—";
  const diff = now() - ts;
  if (diff < 60000) return "just now";
  if (diff < 3600000) return Math.floor(diff / 60000) + "m ago";
  if (diff < DAY) return Math.floor(diff / 3600000) + "h ago";
  const d = Math.floor(diff / DAY);
  if (d === 1) return "yesterday";
  if (d < 14) return d + "d ago";
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function timeFull(ts: number | null | undefined): string {
  if (!ts) return "";
  const d = new Date(ts);
  return (
    d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
    ", " +
    d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
  );
}

/** Compact "time left / over" for an SLA or a next-action date. */
export function dueLabel(ms: number): string {
  const abs = Math.abs(ms);
  let n: number;
  let unit: string;
  if (abs < 3600000) {
    n = Math.max(1, Math.round(abs / 60000));
    unit = "m";
  } else if (abs < DAY) {
    n = Math.round(abs / 3600000);
    unit = "h";
  } else {
    n = Math.round(abs / DAY);
    unit = "d";
  }
  return ms < 0 ? n + unit + " over" : n + unit + " left";
}

export function dateLabel(ts: number | null | undefined): string {
  if (!ts) return "";
  const d = new Date(ts);
  const today = new Date();
  const dd = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const days = Math.round((dd.getTime() - t0.getTime()) / DAY);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
