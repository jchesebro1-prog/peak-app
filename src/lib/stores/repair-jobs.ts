import {
  getDoc,
  listDocs,
  nextPrefixedId,
  patchDoc,
  softDeleteDoc,
  upsertDoc,
} from "@/db/doc-store";

/**
 * RepairStore — server port of app/repairjobs.js (rss_repairjobs_v1).
 *
 * A repair starts life as an auto-priced QUOTE (quoteType 'repair', see
 * repair-engine.ts). When that quote is ACCEPTED (status 'won') it becomes a
 * self-contained repair JOB tracked here. Repairs also commonly originate
 * from a rigging INSPECTION finding (an open Urgent / Necessary log) — the
 * source is recorded so the two modules stay linked.
 *
 * Lifecycle:  approved → scheduled → completed
 *   • approved  — quote accepted, needs a date + crew
 *   • scheduled — assigned a date + technician
 *   • completed — completedAt is stamped and the warranty clock starts
 *                 (warrantyMonths from that date). The WARRANTY window is the
 *                 recurrence-analog: a repair whose warranty is near expiry or
 *                 lapsed surfaces so the office can follow up / re-quote.
 *
 * Prototype semantics kept exactly (field names, id format RP-#### base 4000,
 * priority/category/warranty meta, warranty math with the 45-day lead).
 * localStorage/SyncEngine plumbing (pending, _setSync, resetToSeed, events)
 * is replaced by the doc-store: rev/updatedAt columns are the ported dirty(),
 * deletes are soft, seeds live in src/db/seeds/repair-jobs.ts.
 * Cross-store reads (quotes, customers, inspections) go through doc-store
 * primitives only.
 */

const DAY = 86400000;
const MONTH = 30 * DAY;
/** Flag a warranty this many days before it lapses. */
export const WARRANTY_LEAD_DAYS = 45;
export const DEFAULT_WARRANTY_MONTHS = 12;

function now(): number {
  return Date.now();
}

/* ---------- record types (field names are THE SPEC) ---------- */

export type RepairStageKey = "approved" | "scheduled" | "completed";
export type RepairPriorityKey = "emergency" | "urgent" | "standard" | "low";
export type RepairCategoryKey =
  | "rigging"
  | "curtains"
  | "motors"
  | "track"
  | "firecurtain"
  | "fallprotection"
  | "electrics"
  | "structural"
  | "other";
export type WarrantyState = "expired" | "expiring" | "active" | "none";

export type RepairScopeItem = { label: string; qty: number; note: string };
export type RepairPart = { name: string; qty: number; cost: number };

export type RepairSourceKind = "inspection" | "survey" | "quote" | "direct";
export type RepairSource = {
  kind: RepairSourceKind;
  refId?: string;
  logId?: number;
  label: string;
};

export type RepairContact = {
  name: string;
  role?: string;
  email?: string;
  phone?: string;
};

export type RepairVenue = {
  id: string | null;
  label: string;
  city?: string;
  state?: string;
  /** Coords may arrive as strings from client form inputs — venueCoords() coerces. */
  lat?: number | string | null;
  lng?: number | string | null;
};

export type RepairCompletion = {
  performedBy: string;
  workPerformed: string;
  partsUsed: string[];
  followUp: string;
  photos: string[];
};

export type RepairJobRecord = {
  id: string;
  quoteId: string | null;
  customer: string;
  customerId: string | null;
  locationId: string | null;
  venue: string;
  value: number;
  category: RepairCategoryKey;
  priority: RepairPriorityKey;
  title: string;
  scope: string;
  source: RepairSource;
  items: RepairScopeItem[];
  parts: RepairPart[];
  laborHours: number;
  contact: RepairContact | null;
  venues: RepairVenue[];
  stage: RepairStageKey;
  assignedTo: string;
  crew: string[];
  approvedAt: number;
  scheduledDate: string; // ISO 'YYYY-MM-DD' or ''
  completedAt: number | null;
  warrantyMonths: number;
  completion: RepairCompletion | null;
  owner: string;
  createdAt: number;
  updatedAt: number;
  /** Device-sync metadata from the prototype — preserved on seeds and client
   *  pushes; the server never manages it (doc-store rev/updatedAt columns are
   *  the ported dirty()). */
  syncState?: "pending" | "syncing" | "synced" | "error";
  syncedAt?: number | null;
  rev?: number;
};

/* ---------- lifecycle stages (shared shape with FlameJobStore) ---------- */

export type RepairStageMeta = {
  label: string;
  ink: string;
  soft: string;
  bd: string;
  dot: string;
};

export const STAGES: Array<{ key: RepairStageKey; label: string }> = [
  { key: "approved", label: "Approved" },
  { key: "scheduled", label: "Scheduled" },
  { key: "completed", label: "Completed" },
];

export const STAGE_META: Record<RepairStageKey, RepairStageMeta> = {
  approved: { label: "Approved", ink: "#8a6d1f", soft: "#fbf3dd", bd: "#f0e2bd", dot: "#c98a2b" },
  scheduled: { label: "Scheduled", ink: "#3155a8", soft: "#e9eefb", bd: "#d4ddf3", dot: "#3155a8" },
  completed: { label: "Completed", ink: "#1f7a52", soft: "#eaf6ef", bd: "#cce9da", dot: "#1f7a52" },
};

export function stageMeta(k: string | null | undefined): RepairStageMeta {
  return (
    (STAGE_META as Record<string, RepairStageMeta | undefined>)[k || ""] || {
      label: k || "—",
      ink: "#8c919c",
      soft: "#f1f2f5",
      bd: "#e4e7ec",
      dot: "#8c919c",
    }
  );
}

export function stageIndex(k: string | null | undefined): number {
  const i = STAGES.findIndex((s) => s.key === k);
  return i < 0 ? 0 : i;
}

/* ---------- priority (how soon the repair must happen) ---------- */

export type RepairPriorityMeta = {
  label: string;
  long: string;
  ink: string;
  soft: string;
  bd: string;
  dot: string;
  bar: string;
};

export const PRIORITIES: Array<{ key: RepairPriorityKey; label: string }> = [
  { key: "emergency", label: "Emergency" },
  { key: "urgent", label: "Urgent" },
  { key: "standard", label: "Standard" },
  { key: "low", label: "Low" },
];

export const PRIORITY_META: Record<RepairPriorityKey, RepairPriorityMeta> = {
  emergency: { label: "Emergency", long: "Emergency — out of service", ink: "#8a2f22", soft: "#f4dcd6", bd: "#e6c1b8", dot: "#8a2f22", bar: "#8a2f22" },
  urgent: { label: "Urgent", long: "Urgent repair", ink: "#b4543a", soft: "#f7e9e5", bd: "#f0d6cd", dot: "#b4543a", bar: "#b4543a" },
  standard: { label: "Standard", long: "Standard repair", ink: "#9a6a1f", soft: "#fbf3dd", bd: "#f0e2bd", dot: "#c98a2b", bar: "#c98a2b" },
  low: { label: "Low", long: "Low priority", ink: "#5b616e", soft: "#f1f2f5", bd: "#e4e7ec", dot: "#8c919c", bar: "#8c919c" },
};

export function priorityMeta(k: string | null | undefined): RepairPriorityMeta {
  return (
    (PRIORITY_META as Record<string, RepairPriorityMeta | undefined>)[k || ""] ||
    PRIORITY_META.standard
  );
}

export const PRIORITY_ORDER: Record<RepairPriorityKey, number> = {
  emergency: 0,
  urgent: 1,
  standard: 2,
  low: 3,
};

/** Map a rigging-inspection severity onto a repair priority. */
export function priorityFromSeverity(
  sev: string | null | undefined
): RepairPriorityKey {
  return sev === "urgent"
    ? "urgent"
    : sev === "necessary"
      ? "standard"
      : sev === "basic"
        ? "low"
        : "standard";
}

/* ---------- repair categories (what kind of work) ---------- */

export type RepairCategory = {
  key: RepairCategoryKey;
  label: string;
  short: string;
};

export const CATEGORIES: RepairCategory[] = [
  { key: "rigging", label: "Rigging & counterweight", short: "Rigging" },
  { key: "curtains", label: "Curtains & soft goods", short: "Curtains" },
  { key: "motors", label: "Motors & automation", short: "Motors" },
  { key: "track", label: "Curtain track", short: "Track" },
  { key: "firecurtain", label: "Fire curtain", short: "Fire curtain" },
  { key: "fallprotection", label: "Fall protection & access", short: "Fall protection" },
  { key: "electrics", label: "Stage electrics", short: "Electrics" },
  { key: "structural", label: "Structural", short: "Structural" },
  { key: "other", label: "Other", short: "Other" },
];

const CATEGORY_MAP: Record<string, RepairCategory> = {};
CATEGORIES.forEach((c) => {
  CATEGORY_MAP[c.key] = c;
});

export function categoryMeta(k: string | null | undefined): RepairCategory {
  return CATEGORY_MAP[k || ""] || CATEGORY_MAP.other;
}

/* ---------- warranty status meta (the recurrence-analog) ---------- */

export type RepairWarrantyMeta = {
  label: string;
  ink: string;
  soft: string;
  bd: string;
  dot: string;
};

export const WARRANTY_META: Record<WarrantyState, RepairWarrantyMeta> = {
  expired: { label: "Warranty lapsed", ink: "#b4543a", soft: "#f7e9e5", bd: "#f0d6cd", dot: "#b4543a" },
  expiring: { label: "Warranty ending", ink: "#9a6a1f", soft: "#fbf3dd", bd: "#f0e2bd", dot: "#c98a2b" },
  active: { label: "Under warranty", ink: "#1f7a52", soft: "#eaf6ef", bd: "#cce9da", dot: "#1f7a52" },
  none: { label: "—", ink: "#8c919c", soft: "#f1f2f5", bd: "#e4e7ec", dot: "#c4c9d2" },
};

export function warrantyMeta(k: string | null | undefined): RepairWarrantyMeta {
  return (
    (WARRANTY_META as Record<string, RepairWarrantyMeta | undefined>)[k || ""] ||
    WARRANTY_META.none
  );
}

/* ---------- date helpers (ISO 'YYYY-MM-DD' for date inputs, ms for math) ---------- */

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function pad(n: number): string {
  return n < 10 ? "0" + n : "" + n;
}

export function iso(ts: number | null | undefined): string {
  if (ts == null) return "";
  const d = new Date(ts);
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}

export function msOf(isoStr: string | null | undefined): number | null {
  const m = /(\d{4})-(\d{2})-(\d{2})/.exec(isoStr || "");
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
}

export function fmtShort(ts: number | null | undefined): string {
  if (ts == null) return "—";
  const d = new Date(ts);
  return MONTHS[d.getMonth()].slice(0, 3) + " " + d.getDate() + ", " + d.getFullYear();
}

export function fmtLong(ts: number | null | undefined): string {
  if (ts == null) return "—";
  const d = new Date(ts);
  return MONTHS[d.getMonth()] + " " + d.getDate() + ", " + d.getFullYear();
}

export function money(n: number | null | undefined): string {
  return "$" + Math.round(n || 0).toLocaleString("en-US");
}

export function timeAgo(ts: number | null | undefined): string {
  if (!ts) return "—";
  const diff = now() - ts;
  const d = Math.floor(diff / DAY);
  if (d <= 0) {
    const h = Math.floor(diff / 3600000);
    return h <= 0 ? "just now" : h + "h ago";
  }
  if (d === 1) return "yesterday";
  if (d < 14) return d + "d ago";
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function warrantyLabel(days: number, state: WarrantyState | string): string {
  if (state === "expired")
    return days === 0 ? "lapsed today" : "lapsed " + days + " day" + (days === 1 ? "" : "s") + " ago";
  if (state === "expiring")
    return days === 0 ? "ends today" : "ends in " + days + " day" + (days === 1 ? "" : "s");
  if (state === "active") return "under warranty";
  return "—";
}

/* ---------- coords resolution for the maps ---------- */

export type LatLng = { lat: number; lng: number };

/**
 * Prototype venueCoords() also fell back to CustomerStore.locationById +
 * Geo.geocode — client-only modules. Server-side we resolve from the coords
 * embedded on the venue (seeds and fromQuote embed them); callers with a geo
 * service can enrich venues before calling.
 */
export function venueCoords(
  job: RepairJobRecord | null | undefined,
  v: RepairVenue | null | undefined
): LatLng | null {
  if (v && v.lat != null && v.lng != null && v.lat !== "" && v.lng !== "")
    return { lat: Number(v.lat), lng: Number(v.lng) };
  return null;
}

export function jobCoords(job: RepairJobRecord | null | undefined): LatLng | null {
  const vs = (job && job.venues) || [];
  for (let i = 0; i < vs.length; i++) {
    const c = venueCoords(job, vs[i]);
    if (c) return c;
  }
  return venueCoords(job, null);
}

/* ---------- warranty math (the recurrence-analog) ---------- */

export type WarrantyStatus = {
  state: WarrantyState;
  days: number;
  expiresAt: number | null;
};

export function warrantyMonthsOf(job: RepairJobRecord | null | undefined): number {
  return job && job.warrantyMonths != null ? job.warrantyMonths : DEFAULT_WARRANTY_MONTHS;
}

export function warrantyExpiryOf(job: RepairJobRecord | null | undefined): number | null {
  if (!job || job.completedAt == null) return null;
  return job.completedAt + warrantyMonthsOf(job) * MONTH;
}

export function warrantyStatus(job: RepairJobRecord | null | undefined): WarrantyStatus {
  if (!job || job.stage !== "completed") return { state: "none", days: 0, expiresAt: null };
  const exp = warrantyExpiryOf(job);
  if (exp == null) return { state: "none", days: 0, expiresAt: null };
  const diff = exp - now();
  if (diff < 0) return { state: "expired", days: Math.round(-diff / DAY), expiresAt: exp };
  if (diff <= WARRANTY_LEAD_DAYS * DAY)
    return { state: "expiring", days: Math.round(diff / DAY), expiresAt: exp };
  return { state: "active", days: Math.round(diff / DAY), expiresAt: exp };
}

/* ---------- cross-store document shapes (read via doc-store only) ---------- */

/** Minimal structural view of a quote doc (collection "quotes"). */
export type RepairQuoteLike = {
  id: string;
  quoteType?: string;
  status?: string;
  customer?: string;
  customerId?: string | null;
  locationId?: string | null;
  name?: string;
  value?: number;
  owner?: string;
  contact?: RepairContact | null;
  repair?: {
    category?: string;
    priority?: string;
    title?: string;
    scope?: string;
    source?: RepairSource;
    items?: RepairScopeItem[];
    parts?: RepairPart[];
    laborHours?: number;
    warrantyMonths?: number;
    contact?: RepairContact | null;
    venues?: Array<{ id?: string | null; label?: string }>;
  };
};

/** Minimal structural view of a customer doc (collection "customers"). */
type CustomerDocLike = {
  id: string;
  name?: string;
  locations?: Array<{
    id?: string;
    city?: string;
    state?: string;
    lat?: number | string | null;
    lng?: number | string | null;
  }>;
};

/** Minimal structural view of an inspection log (collection "inspections"). */
export type InspectionLogLike = {
  id: number;
  severity?: string;
  status?: string;
  problem?: string;
  explanation?: string;
  solution?: string;
  location?: string;
  firstNoted?: string;
};

/** Minimal structural view of an inspection doc (collection "inspections"). */
export type InspectionRecordLike = {
  id: string;
  customer?: string;
  customerId?: string | null;
  locationId?: string | null;
  venue?: string;
  contact?: string;
  contactEmail?: string;
  contactPhone?: string;
  logs?: InspectionLogLike[];
};

/* ---------- record builders ---------- */

/** Build a job record from an accepted repair quote (reads the customer doc
 *  to embed venue city/state/coords, like the prototype did via CustomerStore). */
async function fromQuote(q: RepairQuoteLike): Promise<Omit<RepairJobRecord, "id">> {
  const rp = q.repair || {};
  const cust = q.customerId
    ? await getDoc<CustomerDocLike>("customers", q.customerId)
    : null;
  const venues: RepairVenue[] = (rp.venues || []).map((v) => {
    let city = "";
    let state = "";
    let lat: number | string | null | undefined = null;
    let lng: number | string | null | undefined = null;
    if (cust) {
      const loc = (cust.locations || []).find((l) => l.id === v.id);
      if (loc) {
        city = loc.city || "";
        state = loc.state || "";
        lat = loc.lat;
        lng = loc.lng;
      }
    }
    return { id: v.id ?? null, label: v.label || "Venue", city, state, lat, lng };
  });
  const t = now();
  return {
    quoteId: q.id,
    customer: q.customer || (cust && cust.name) || "",
    customerId: q.customerId || null,
    locationId: q.locationId || (venues[0] && venues[0].id) || null,
    venue: (venues[0] && venues[0].label) || "",
    value: q.value || 0,
    category: (rp.category || "other") as RepairCategoryKey,
    priority: (rp.priority || "standard") as RepairPriorityKey,
    title: rp.title || q.name || "Repair",
    scope: rp.scope || "",
    source: rp.source || { kind: "quote", label: "From quote " + q.id },
    items: rp.items || [],
    parts: rp.parts || [],
    laborHours: rp.laborHours || 0,
    contact: q.contact || rp.contact || null,
    venues,
    stage: "approved",
    assignedTo: "",
    crew: [],
    approvedAt: t,
    scheduledDate: "",
    completedAt: null,
    warrantyMonths: rp.warrantyMonths || DEFAULT_WARRANTY_MONTHS,
    completion: null,
    owner: q.owner || "Jeff Chesebro",
    createdAt: t,
    updatedAt: t,
  };
}

/** Build a job partial from an open rigging-inspection log. */
export function fromInspectionLog(
  rec: InspectionRecordLike,
  log: InspectionLogLike
): Partial<RepairJobRecord> {
  return {
    customer: rec.customer,
    customerId: rec.customerId,
    locationId: rec.locationId,
    venue: rec.venue,
    value: 0,
    category: "rigging",
    priority: priorityFromSeverity(log.severity),
    title: log.problem || "Repair",
    scope: log.solution || log.explanation || "",
    source: { kind: "inspection", refId: rec.id, logId: log.id, label: "From inspection " + rec.id },
    items: [],
    parts: [],
    laborHours: 0,
    contact: rec.contact
      ? { name: rec.contact, email: rec.contactEmail || "", phone: rec.contactPhone || "" }
      : null,
    venues: rec.locationId ? [{ id: rec.locationId, label: rec.venue || "Venue" }] : [],
    stage: "approved",
  };
}

/* ---------- CRUD (doc-store backed; prototype public API) ---------- */

export async function getAll(): Promise<RepairJobRecord[]> {
  const list = await listDocs<RepairJobRecord>("repair_jobs");
  return list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export async function get(id: string): Promise<RepairJobRecord | null> {
  return getDoc<RepairJobRecord>("repair_jobs", id);
}

export async function byQuote(qid: string): Promise<RepairJobRecord | null> {
  const list = await listDocs<RepairJobRecord>("repair_jobs");
  return list.find((j) => j.quoteId === qid) || null;
}

/** Prototype defaulted owner to window.Team.CURRENT — server callers pass
 *  partial.owner from the session; fallback matches the prototype. */
export async function create(
  partial: Partial<RepairJobRecord> = {}
): Promise<RepairJobRecord> {
  const id = partial.id || (await nextPrefixedId("repair_jobs", "RP", 4000));
  const t = now();
  const rec: RepairJobRecord = {
    quoteId: null,
    customer: "",
    customerId: null,
    locationId: null,
    venue: "",
    value: 0,
    category: "other",
    priority: "standard",
    title: "",
    scope: "",
    source: { kind: "direct", label: "Created directly" },
    items: [],
    parts: [],
    laborHours: 0,
    contact: null,
    venues: [],
    stage: "approved",
    assignedTo: "",
    crew: [],
    approvedAt: t,
    scheduledDate: "",
    completedAt: null,
    warrantyMonths: DEFAULT_WARRANTY_MONTHS,
    completion: null,
    owner: "Jeff Chesebro",
    ...partial,
    id,
    createdAt: t,
    updatedAt: t,
  };
  await upsertDoc<RepairJobRecord>("repair_jobs", rec);
  return rec;
}

export async function createFromQuote(qid: string): Promise<RepairJobRecord | null> {
  const existing = await byQuote(qid);
  if (existing) return existing;
  const q = await getDoc<RepairQuoteLike>("quotes", qid);
  if (!q || q.quoteType !== "repair") return null;
  return create(await fromQuote(q));
}

/** Scan accepted (won) repair quotes and create any job not made yet.
 *  Returns the number of jobs created. */
export async function syncFromQuotes(): Promise<number> {
  const quotes = await listDocs<RepairQuoteLike>("quotes");
  const jobs = await listDocs<RepairJobRecord>("repair_jobs");
  const have: Record<string, boolean> = {};
  jobs.forEach((j) => {
    if (j.quoteId) have[j.quoteId] = true;
  });
  let made = 0;
  for (const q of quotes) {
    if (q.quoteType !== "repair" || q.status !== "won") continue;
    if (have[q.id]) continue;
    await create(await fromQuote(q));
    have[q.id] = true;
    made++;
  }
  return made;
}

export async function update(
  id: string,
  patch: Partial<RepairJobRecord>
): Promise<RepairJobRecord | null> {
  return patchDoc<RepairJobRecord>("repair_jobs", id, (j) => {
    Object.assign(j, patch, { updatedAt: now() });
  });
}

export type ScheduleOpts = {
  scheduledDate?: string;
  assignedTo?: string;
  crew?: string[];
};

export async function schedule(
  id: string,
  opts: ScheduleOpts = {}
): Promise<RepairJobRecord | null> {
  return update(id, {
    scheduledDate: opts.scheduledDate || "",
    assignedTo: opts.assignedTo || "",
    crew: opts.crew || undefined,
    stage: "scheduled",
  });
}

export async function unschedule(id: string): Promise<RepairJobRecord | null> {
  return update(id, { stage: "approved", scheduledDate: "" });
}

export type CompleteOpts = {
  completedAt?: number | null;
  completedDate?: string;
  warrantyMonths?: number | null;
  completion?: RepairCompletion | null;
  assignedTo?: string;
};

/** Log the work → completed; stamp completedAt (warranty clock starts here). */
export async function complete(
  id: string,
  opts: CompleteOpts = {}
): Promise<RepairJobRecord | null> {
  const completedAt =
    opts.completedAt != null ? opts.completedAt : msOf(opts.completedDate) || now();
  const cur = await get(id);
  return update(id, {
    stage: "completed",
    completedAt,
    warrantyMonths:
      opts.warrantyMonths != null
        ? opts.warrantyMonths
        : (cur && cur.warrantyMonths) || DEFAULT_WARRANTY_MONTHS,
    completion: opts.completion || null,
    assignedTo: opts.assignedTo || (cur && cur.assignedTo) || "",
  });
}

export async function reopen(id: string): Promise<RepairJobRecord | null> {
  return update(id, { stage: "scheduled", completedAt: null, completion: null });
}

export async function remove(id: string): Promise<void> {
  await softDeleteDoc("repair_jobs", id);
}

/* ---------- worklists ---------- */

export type WarrantyFollowUpRow = RepairJobRecord & { _warranty: WarrantyStatus };

/** Completed repairs whose warranty is ending or lapsed → office follow-up list. */
export async function warrantyFollowUps(
  opts: { dueOnly?: boolean } = {}
): Promise<WarrantyFollowUpRow[]> {
  const all = await listDocs<RepairJobRecord>("repair_jobs");
  let rows = all
    .filter((j) => j.stage === "completed")
    .map((j) => ({ ...j, _warranty: warrantyStatus(j) }));
  if (opts.dueOnly)
    rows = rows.filter(
      (r) => r._warranty.state === "expired" || r._warranty.state === "expiring"
    );
  rows.sort((a, b) => (warrantyExpiryOf(a) || 0) - (warrantyExpiryOf(b) || 0));
  return rows;
}

export type FlaggedFinding = { rec: InspectionRecordLike; log: InspectionLogLike };

/** Open rigging-inspection findings (Urgent / Necessary) not yet turned into
 *  a repair job. Reads the "inspections" collection via doc-store. */
export async function flaggedFromInspections(): Promise<FlaggedFinding[]> {
  const jobs = await listDocs<RepairJobRecord>("repair_jobs");
  const inspections = await listDocs<InspectionRecordLike>("inspections");
  const claimed: Record<string, boolean> = {};
  jobs.forEach((j) => {
    if (j.source && j.source.kind === "inspection" && j.source.refId != null)
      claimed[j.source.refId + "#" + j.source.logId] = true;
  });
  const out: FlaggedFinding[] = [];
  inspections.forEach((rec) => {
    (rec.logs || []).forEach((log) => {
      if (log.status === "closed") return;
      if (log.severity !== "urgent" && log.severity !== "necessary") return;
      if (claimed[rec.id + "#" + log.id]) return;
      out.push({ rec, log });
    });
  });
  out.sort(
    (a, b) =>
      PRIORITY_ORDER[priorityFromSeverity(a.log.severity)] -
      PRIORITY_ORDER[priorityFromSeverity(b.log.severity)]
  );
  return out;
}
