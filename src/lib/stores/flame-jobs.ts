import {
  getDoc,
  insertWithPrefixedId,
  listDocs,
  patchDoc,
  softDeleteDoc,
  upsertDoc,
} from "@/db/doc-store";
import { get as getCustomerDoc } from "./customers";
import { flameJobsSeed } from "@/db/seeds/flame-jobs";

/**
 * FlameJobStore — server port of app/flamejobs.js (localStorage key
 * rss_flamejobs_v1) over the "flame_jobs" collection.
 *
 * A flame test starts life as an auto-priced QUOTE (quoteType 'flame_test',
 * priced by src/lib/flametest-engine.ts). When that quote is accepted
 * (status 'won') it becomes a small self-contained flame-test JOB tracked
 * here — independent of the Installs projects.
 *
 * Lifecycle:  approved → scheduled → completed
 *   - approved  — quote accepted, needs a date + tech
 *   - scheduled — assigned a date + technician
 *   - completed — results logged; completedAt stamped and
 *                 dueAt = completedAt + 1 year (NFPA 705 is ANNUAL — every
 *                 completed test schedules its own renewal)
 *
 * Renewals: a completed test whose 1-year anniversary is within
 * RENEWAL_LEAD_DAYS (60) or past surfaces as due_soon / overdue so the
 * office contacts the customer in time for compliance.
 *
 * Field names, id format (FT-#### from base 3000), stage keys, renewal
 * states and the renewal math are the spec — ported exactly. Timestamps are
 * epoch-ms numbers; scheduledDate is an ISO 'YYYY-MM-DD' string ('' when
 * unset) exactly as the prototype's date inputs stored it.
 *
 * Server-side deltas (documented, not behavioral inventions):
 * - syncState / syncedAt / rev bookkeeping, SyncEngine registration,
 *   pending(), _setSync() and the cloud-seed poll are the prototype's
 *   offline-outbox machinery; doc-store owns rev/receivedAt at the row
 *   level now, so those fields and hooks are dropped.
 * - `window.Team.CURRENT` owner fallback becomes the caller-supplied
 *   partial.owner; the prototype's final 'Jeff Chesebro' fallback is kept.
 * - remove() is a soft delete (doc-store semantics). Like the prototype's
 *   hard remove, a removed job's quote becomes eligible for re-creation by
 *   syncFromQuotes (the tombstone is excluded from the live list).
 * - venueCoords()/jobCoords() resolve the coords embedded on each venue
 *   (fromQuote copies them from the customer record at creation, same as
 *   the prototype). The prototype's render-time CustomerStore/Geo.geocode
 *   fallbacks belong to the geo module and are not duplicated here.
 * - emit()/emitSync()/kick() events become revalidatePath/router.refresh
 *   in the calling server actions.
 */

const DAY = 86400000;
const YEAR = 365 * DAY;
/** Flag a renewal this many days before the anniversary. */
export const RENEWAL_LEAD_DAYS = 60;

function now(): number {
  return Date.now();
}

/* ---------- record shapes ---------- */

export type FlameJobStage = "approved" | "scheduled" | "completed";
export type RenewalState = "overdue" | "due_soon" | "upcoming" | "ok" | "none";

export type FlameJobContact = {
  name?: string;
  role?: string;
  email?: string;
  phone?: string;
};

export type FlameJobVenue = {
  id: string | null;
  label: string;
  city: string;
  state: string;
  lat: number | null;
  lng: number | null;
  curtains: number;
};

/** Per-venue outcome logged on completion (flamejobs.js rv()). */
export type FlameJobVenueResult = {
  id: string | null;
  label: string;
  tested: number;
  passed: number;
  failed: number;
  retreated: number;
  treatment: string;
  notes: string;
};

/** Results subdoc logged on completion (flamejobs.js results()). */
export type FlameJobResults = {
  /** 'pass' | 'partial' | 'fail' */
  overall: string;
  cert: string;
  performedBy: string;
  method: string;
  venues: FlameJobVenueResult[];
  notes: string;
};

/** Renewal-outreach stamp (IDEAS #37): the office reached out about this
 *  cycle's renewal. Lives on the latest completed job — a new completed
 *  test is a new record, so every cycle starts un-contacted. */
export type RenewalOutreach = { at: number; by: string };

export type FlameJob = {
  id: string;
  quoteId: string | null;
  /** Denormalized display name — customerId is the canonical link. */
  customer: string;
  customerId: string | null;
  locationId: string | null;
  /** Primary venue label (venues[0]). */
  venue: string;
  value: number;
  curtainsTotal: number;
  contact: FlameJobContact | null;
  venues: FlameJobVenue[];
  stage: FlameJobStage;
  assignedTo: string;
  approvedAt: number;
  /** ISO 'YYYY-MM-DD' or '' when unscheduled. */
  scheduledDate: string;
  completedAt: number | null;
  /** completedAt + 1yr, stamped by complete(); null until completed. */
  dueAt: number | null;
  results: FlameJobResults | null;
  /** Set when the office contacts the customer about THIS cycle's renewal. */
  renewalOutreach?: RenewalOutreach | null;
  owner: string;
  createdAt: number;
  updatedAt: number;
};

export type RenewalStatus = {
  state: RenewalState;
  days: number;
  dueAt: number | null;
};

/* ---------- lifecycle stages ---------- */

export type StageBadge = {
  label: string;
  ink: string;
  soft: string;
  bd: string;
  dot: string;
};

export const STAGES: Array<{ key: FlameJobStage; label: string }> = [
  { key: "approved", label: "Approved" },
  { key: "scheduled", label: "Scheduled" },
  { key: "completed", label: "Completed" },
];

export const STAGE_META: Record<FlameJobStage, StageBadge> = {
  approved: { label: "Approved", ink: "#8a6d1f", soft: "#fbf3dd", bd: "#f0e2bd", dot: "#c98a2b" },
  scheduled: { label: "Scheduled", ink: "#3155a8", soft: "#e9eefb", bd: "#d4ddf3", dot: "#3155a8" },
  completed: { label: "Completed", ink: "#1f7a52", soft: "#eaf6ef", bd: "#cce9da", dot: "#1f7a52" },
};

export function stageMeta(k: string | null | undefined): StageBadge {
  return (
    (STAGE_META as Record<string, StageBadge>)[k || ""] || {
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

/* ---------- renewal status meta ---------- */

export const RENEWAL_META: Record<RenewalState, StageBadge> = {
  overdue: { label: "Overdue", ink: "#b4543a", soft: "#f7e9e5", bd: "#f0d6cd", dot: "#b4543a" },
  due_soon: { label: "Due soon", ink: "#9a6a1f", soft: "#fbf3dd", bd: "#f0e2bd", dot: "#c98a2b" },
  upcoming: { label: "Upcoming", ink: "#3155a8", soft: "#e9eefb", bd: "#d4ddf3", dot: "#3155a8" },
  ok: { label: "On schedule", ink: "#1f7a52", soft: "#eaf6ef", bd: "#cce9da", dot: "#1f7a52" },
  none: { label: "—", ink: "#8c919c", soft: "#f1f2f5", bd: "#e4e7ec", dot: "#c4c9d2" },
};

export function renewalMeta(k: string | null | undefined): StageBadge {
  return (RENEWAL_META as Record<string, StageBadge>)[k || ""] || RENEWAL_META.none;
}

/* ---------- date helpers (ISO 'YYYY-MM-DD' for date inputs, ms for math) ---------- */

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
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
  return new Date(+m[1], +m[2] - 1, +m[3]).getTime();
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

/* ---------- coords resolution for the maps ---------- */

export type LatLng = { lat: number; lng: number };

/**
 * Coords for one venue — the lat/lng embedded on the venue record (seeded
 * and copied from the customer location by fromQuote). The `_job` param is
 * kept for signature parity with the prototype, whose CustomerStore/Geo
 * geocode fallback lives with the geo module, not here.
 */
export function venueCoords(
  _job: FlameJob | null | undefined,
  v: FlameJobVenue | null | undefined
): LatLng | null {
  if (
    v &&
    v.lat != null &&
    v.lng != null &&
    (v.lat as unknown) !== "" &&
    (v.lng as unknown) !== ""
  ) {
    return { lat: +v.lat, lng: +v.lng };
  }
  return null;
}

/** One representative pin per job (its primary venue). */
export function jobCoords(job: FlameJob | null | undefined): LatLng | null {
  const vs = (job && job.venues) || [];
  for (let i = 0; i < vs.length; i++) {
    const c = venueCoords(job, vs[i]);
    if (c) return c;
  }
  return venueCoords(job, null);
}

/* ---------- cross-collection doc shapes (read via doc-store only) ---------- */

type QuoteFlameTestVenue = {
  id?: string | null;
  label?: string;
  curtains?: number | string | null;
};

type QuoteFlameTest = {
  venues?: QuoteFlameTestVenue[];
  curtainsTotal?: number | null;
  contact?: FlameJobContact | null;
};

type QuoteDoc = {
  id: string;
  quoteType?: string;
  status?: string;
  customer?: string;
  customerId?: string | null;
  locationId?: string | null;
  value?: number;
  contact?: FlameJobContact | null;
  owner?: string;
  flameTest?: QuoteFlameTest | null;
};

type CustomerLocationDoc = {
  id?: string;
  city?: string;
  state?: string;
  lat?: number | null;
  lng?: number | null;
};

type CustomerDoc = {
  id: string;
  name?: string;
  locations?: CustomerLocationDoc[];
};

/** Build a job record from an accepted flame-test quote (flamejobs.js fromQuote). */
async function fromQuote(
  q: QuoteDoc
): Promise<Omit<FlameJob, "id" | "createdAt" | "updatedAt">> {
  const ft: QuoteFlameTest = q.flameTest || {};
  // Identity core (D85): the directory now composes from relational rows;
  // the minimal local type stays as this store's structural contract.
  const cust = q.customerId
    ? ((await getCustomerDoc(q.customerId)) as CustomerDoc | null)
    : null;
  const venues: FlameJobVenue[] = (ft.venues || []).map((v) => {
    let city = "";
    let state = "";
    let lat: number | null = null;
    let lng: number | null = null;
    if (cust) {
      const loc = (cust.locations || []).find((l) => l.id === v.id);
      if (loc) {
        city = loc.city || "";
        state = loc.state || "";
        lat = loc.lat ?? null;
        lng = loc.lng ?? null;
      }
    }
    return {
      id: v.id ?? null,
      label: v.label || "Venue",
      city,
      state,
      lat,
      lng,
      curtains: Number(v.curtains) || 0,
    };
  });
  const curtainsTotal =
    ft.curtainsTotal != null
      ? ft.curtainsTotal
      : venues.reduce((a, v) => a + (v.curtains || 0), 0);
  const t = now();
  return {
    quoteId: q.id,
    customer: q.customer || (cust && cust.name) || "",
    customerId: q.customerId || null,
    locationId: q.locationId || (venues[0] && venues[0].id) || null,
    venue: (venues[0] && venues[0].label) || "",
    value: q.value || 0,
    curtainsTotal,
    contact: q.contact || ft.contact || null,
    venues,
    stage: "approved",
    assignedTo: "",
    approvedAt: t,
    scheduledDate: "",
    completedAt: null,
    dueAt: null,
    results: null,
    owner: q.owner || "Jeff Chesebro",
  };
}

/* ---------- store API ---------- */

/** All jobs, newest activity first (port of getAll). */
export async function getAll(): Promise<FlameJob[]> {
  const list = await listDocs<FlameJob>("flame_jobs");
  return list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export async function get(id: string): Promise<FlameJob | null> {
  return getDoc<FlameJob>("flame_jobs", id);
}

export async function byQuote(qid: string): Promise<FlameJob | null> {
  const list = await listDocs<FlameJob>("flame_jobs");
  return list.find((j) => j.quoteId === qid) || null;
}

/** Create a job; id FT-#### minted from base 3000 (seeds occupy 3001–3008). */
export async function create(partial: Partial<FlameJob> = {}): Promise<FlameJob> {
  const t = now();
  const build = (id: string): FlameJob => ({
    quoteId: null,
    customer: "",
    customerId: null,
    locationId: null,
    venue: "",
    value: 0,
    curtainsTotal: 0,
    contact: null,
    venues: [],
    stage: "approved",
    assignedTo: "",
    approvedAt: t,
    scheduledDate: "",
    completedAt: null,
    dueAt: null,
    results: null,
    owner: "Jeff Chesebro",
    ...partial,
    id,
    createdAt: t,
    updatedAt: t,
  });
  if (partial.id) {
    const rec = build(partial.id);
    await upsertDoc<FlameJob>("flame_jobs", rec);
    return rec;
  }
  return insertWithPrefixedId<FlameJob>("flame_jobs", "FT", 3000, build);
}

/**
 * Make the job for one accepted flame-test quote (idempotent — returns the
 * existing job if the quote already has one; null when the quote is missing
 * or not a flame-test quote).
 */
export async function createFromQuote(qid: string): Promise<FlameJob | null> {
  const existing = await byQuote(qid);
  if (existing) return existing;
  const q = await getDoc<QuoteDoc>("quotes", qid);
  if (!q || q.quoteType !== "flame_test") return null;
  return create(await fromQuote(q));
}

/**
 * Scan accepted (won) flame-test quotes and create any job not made yet.
 * Returns how many jobs were created.
 */
export async function syncFromQuotes(): Promise<number> {
  const jobs = await listDocs<FlameJob>("flame_jobs");
  const have: Record<string, boolean> = {};
  jobs.forEach((j) => {
    if (j.quoteId) have[j.quoteId] = true;
  });
  const quotes = await listDocs<QuoteDoc>("quotes");
  const won = quotes.filter(
    (q) => q.quoteType === "flame_test" && q.status === "won"
  );
  let made = 0;
  for (const q of won) {
    if (have[q.id]) continue;
    const rec = await fromQuote(q);
    const t = now();
    await insertWithPrefixedId<FlameJob>("flame_jobs", "FT", 3000, (id) => ({
      ...rec,
      id,
      createdAt: t,
      updatedAt: t,
    }));
    have[q.id] = true;
    made++;
  }
  return made;
}

/** Shallow-merge a patch into a job; bumps updatedAt. */
export async function update(
  id: string,
  patch: Partial<FlameJob>
): Promise<FlameJob | null> {
  return patchDoc<FlameJob>("flame_jobs", id, (j) => ({
    ...j,
    ...patch,
    id,
    updatedAt: now(),
  }));
}

/** Assign a date + tech → scheduled. */
export async function schedule(
  id: string,
  opts: { scheduledDate?: string; assignedTo?: string } = {}
): Promise<FlameJob | null> {
  return update(id, {
    scheduledDate: opts.scheduledDate || "",
    assignedTo: opts.assignedTo || "",
    stage: "scheduled",
  });
}

export async function unschedule(id: string): Promise<FlameJob | null> {
  return update(id, { stage: "approved", scheduledDate: "" });
}

export type CompleteOpts = {
  /** Epoch-ms; wins over completedDate when present. */
  completedAt?: number | null;
  /** ISO 'YYYY-MM-DD' from a date input; falls back to now(). */
  completedDate?: string;
  results?: FlameJobResults | null;
  assignedTo?: string;
};

/** Log results → completed; stamp completedAt + dueAt (+1yr). Completing
 *  starts a fresh renewal cycle, so any outreach stamp is cleared. */
export async function complete(
  id: string,
  opts: CompleteOpts = {}
): Promise<FlameJob | null> {
  const completedAt =
    opts.completedAt != null ? opts.completedAt : msOf(opts.completedDate) || now();
  return patchDoc<FlameJob>("flame_jobs", id, (j) => ({
    ...j,
    stage: "completed" as const,
    completedAt,
    dueAt: completedAt + YEAR,
    results: opts.results || null,
    renewalOutreach: null,
    assignedTo: opts.assignedTo || j.assignedTo || "",
    updatedAt: now(),
  }));
}

/** Stamp / clear this cycle's renewal outreach (IDEAS #37). */
export async function setRenewalOutreach(
  id: string,
  by: string | null
): Promise<FlameJob | null> {
  return update(id, {
    renewalOutreach: by ? { at: now(), by } : null,
  });
}

export async function reopen(id: string): Promise<FlameJob | null> {
  return update(id, { stage: "scheduled", completedAt: null, dueAt: null });
}

/** Soft delete (prototype filtered the array; server keeps a tombstone for sync). */
export async function remove(id: string): Promise<void> {
  await softDeleteDoc("flame_jobs", id);
}

/* ---------- renewal math ---------- */

export function dueAtOf(
  job: Pick<FlameJob, "dueAt" | "completedAt"> | null | undefined
): number | null {
  if (!job) return null;
  if (job.dueAt != null) return job.dueAt;
  if (job.completedAt != null) return job.completedAt + YEAR;
  return null;
}

export function renewalStatus(job: FlameJob | null | undefined): RenewalStatus {
  if (!job || job.stage !== "completed") return { state: "none", days: 0, dueAt: null };
  const due = dueAtOf(job);
  if (due == null) return { state: "none", days: 0, dueAt: null };
  const diff = due - now();
  if (diff < 0) return { state: "overdue", days: Math.round(-diff / DAY), dueAt: due };
  if (diff <= RENEWAL_LEAD_DAYS * DAY)
    return { state: "due_soon", days: Math.round(diff / DAY), dueAt: due };
  if (diff <= 120 * DAY)
    return { state: "upcoming", days: Math.round(diff / DAY), dueAt: due };
  return { state: "ok", days: Math.round(diff / DAY), dueAt: due };
}

/**
 * Latest completed job per customer+venue, with renewal status attached
 * (superseded tests drop out). dueOnly keeps overdue + due_soon rows.
 * Sorted soonest-due first.
 */
export async function renewals(
  opts: { dueOnly?: boolean } = {}
): Promise<Array<FlameJob & { _renewal: RenewalStatus }>> {
  const all = await listDocs<FlameJob>("flame_jobs");
  const completed = all.filter((j) => j.stage === "completed");
  const latest: Record<string, FlameJob> = {};
  completed.forEach((j) => {
    const k =
      (j.customerId || j.customer || "") + "|" + (j.locationId || j.venue || "");
    if (!latest[k] || (j.completedAt || 0) > (latest[k].completedAt || 0)) {
      latest[k] = j;
    }
  });
  let rows = Object.keys(latest).map((k) => ({
    ...latest[k],
    _renewal: renewalStatus(latest[k]),
  }));
  if (opts.dueOnly) {
    rows = rows.filter(
      (r) => r._renewal.state === "overdue" || r._renewal.state === "due_soon"
    );
  }
  rows.sort((a, b) => (dueAtOf(a) || 0) - (dueAtOf(b) || 0));
  return rows;
}

/* ---------- labels ---------- */

/** Relative-time label for updatedAt (pure; safe to call anywhere). */
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

/** Human label for a renewalStatus() result: 'due today' / 'N days overdue' / 'due in N days' / 'on schedule'. */
export function dueLabel(days: number, state: RenewalState | string): string {
  if (state === "overdue")
    return days === 0 ? "due today" : days + " day" + (days === 1 ? "" : "s") + " overdue";
  if (state === "due_soon" || state === "upcoming")
    return days === 0 ? "due today" : "due in " + days + " day" + (days === 1 ? "" : "s");
  return "on schedule";
}

/** Replace all flame jobs with the seed spread (settings "reset demo data"). */
export async function resetToSeed(): Promise<void> {
  const existing = await listDocs<FlameJob>("flame_jobs");
  for (const j of existing) await softDeleteDoc("flame_jobs", j.id);
  for (const j of flameJobsSeed()) await upsertDoc<FlameJob>("flame_jobs", j);
}
