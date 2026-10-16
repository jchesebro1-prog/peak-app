/* Assessments engine (#340) — the rolling venue profile (spec §4): one `venue_profiles` doc per venue, doc id =
   sites.id. Only a completed assessment writes here (completeAssessment), and only its `profile: true` answers.
   Kept through the go-live wipe, like venues. */
import { ASSESSMENT_LOCK_NAMESPACE, withAdvisoryLock } from "@/db";
import { listDocs } from "@/db/doc-store";
import { nextRev, readRow, writeRow } from "./assessment-rows";

export interface VenueProfile {
  siteId: string;
  customerId: string;
  /** profile:true question key → the last confirmed value, when, and the assessment (AS-id) it came from */
  facts: Record<string, { v: unknown; at: number; from: string }>;
  /** Jeff 2026-10-15 #10 — the venue's next assessment date (epoch ms), set by hand on the venue page; null / absent =
   *  none. The assessment reminder (src/lib/assessments/reminders.ts) goes to the account rep 30 days before it. */
  nextAssessmentAt?: number | null;
  updatedAt: number;
}

const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function normalizeProfile(d: Record<string, unknown>, siteId: string): VenueProfile {
  const facts: VenueProfile["facts"] = {};
  const raw = d.facts && typeof d.facts === "object" && !Array.isArray(d.facts) ? (d.facts as Record<string, unknown>) : {};
  for (const [k, f] of Object.entries(raw)) {
    if (UNSAFE_KEYS.has(k) || !f || typeof f !== "object") continue;
    const x = f as { v?: unknown; at?: unknown; from?: unknown };
    facts[k] = { v: x.v, at: typeof x.at === "number" ? x.at : 0, from: typeof x.from === "string" ? x.from : "" };
  }
  const next = typeof d.nextAssessmentAt === "number" && Number.isFinite(d.nextAssessmentAt) && d.nextAssessmentAt > 0 ? d.nextAssessmentAt : null;
  return {
    siteId,
    customerId: typeof d.customerId === "string" ? d.customerId : "",
    facts,
    ...(next ? { nextAssessmentAt: next } : {}),
    updatedAt: typeof d.updatedAt === "number" ? d.updatedAt : 0,
  };
}

/** Every live venue profile (the reminder sweep reads them all — one row per assessed venue, a small table). */
export async function listVenueProfiles(): Promise<VenueProfile[]> {
  return (await listDocs("venue_profiles")).map((d) => normalizeProfile(d, d.id));
}

/**
 * Jeff 2026-10-15 #10 — set (or clear, with null) a venue's next assessment date. Keeps every fact; creates the
 * profile when the venue has none yet. Under the venue's lock, like writeProfileFacts.
 */
export async function setNextAssessmentAt(siteId: string, customerId: string, at: number | null): Promise<void> {
  if (!siteId) return;
  const when = typeof at === "number" && Number.isFinite(at) && at > 0 ? Math.round(at) : null;
  await withAdvisoryLock(ASSESSMENT_LOCK_NAMESPACE, `profile:${siteId}`, async () => {
    const row = await readRow("venue_profiles", siteId);
    const cur = row && !row.deleted ? normalizeProfile(row.doc, siteId) : { siteId, customerId, facts: {}, updatedAt: 0 };
    const next: VenueProfile = { ...cur, customerId: cur.customerId || customerId, updatedAt: Date.now() };
    if (when) next.nextAssessmentAt = when;
    else delete next.nextAssessmentAt;
    await writeRow("venue_profiles", siteId, { ...next, rev: nextRev(row) }, !row);
  });
}

export async function getVenueProfile(siteId: string): Promise<VenueProfile | null> {
  if (!siteId) return null;
  const row = await readRow("venue_profiles", siteId);
  if (!row || row.deleted) return null;
  return normalizeProfile(row.doc, siteId);
}

/**
 * Records `facts` (question key → value) as confirmed now by assessment `from`. Facts not named are kept.
 * Read-merge-write under the venue's lock, so two completions at once both land. Joins an open transaction
 * (completeAssessment calls it inside its own).
 */
export async function writeProfileFacts(siteId: string, customerId: string, facts: Record<string, unknown>, from: string): Promise<void> {
  const keys = Object.keys(facts).filter((k) => !UNSAFE_KEYS.has(k));
  if (!siteId || !keys.length) return;
  await withAdvisoryLock(ASSESSMENT_LOCK_NAMESPACE, `profile:${siteId}`, async () => {
    const row = await readRow("venue_profiles", siteId);
    const cur = row && !row.deleted ? normalizeProfile(row.doc, siteId) : { siteId, customerId, facts: {}, updatedAt: 0 };
    const now = Date.now();
    const next: VenueProfile = { ...cur, customerId, facts: { ...cur.facts }, updatedAt: now };
    for (const k of keys) next.facts[k] = { v: facts[k], at: now, from };
    await writeRow("venue_profiles", siteId, { ...next, rev: nextRev(row) }, !row);
  });
}

/** key → value, for the evaluator's `profile` input and the editor's "On file" pre-fill. */
export function profileValues(p: VenueProfile | null): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!p) return out;
  for (const [k, f] of Object.entries(p.facts)) out[k] = f.v;
  return out;
}
