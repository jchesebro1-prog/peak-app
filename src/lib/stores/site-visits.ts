import { listDocs, nextPrefixedId, patchDoc, upsertDoc } from "@/db/doc-store";

/**
 * Site visits (D76, Jeff 2026-07-19 — PUNCHLIST #2 phase 1). A visit links a
 * customer + venue + contact to a scheduled time and reason, and records the
 * .ics calendar-invite email sent for it. No prototype ancestor — this is the
 * first post-rebuild collection (drizzle migration 0004).
 *
 * Phase 2 (deferred): direct Google Calendar write (googleEventId is already
 * reserved here) and the in-app calendar.
 */

export type SiteVisitInvite = {
  sentAt: number;
  to: string; // assignee email the .ics went to
  fromMailbox: string; // connection key it was sent from
  gmailId?: string;
  gmailThreadId?: string;
};

export type SiteVisit = {
  id: string; // 'SV-####'
  customerId: string;
  customer: string; // denormalized name
  locationId: string | null;
  venue: string; // denormalized venue label
  address: string; // street + city/state at time of scheduling
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  reason: string; // one of the Settings picklist values
  startAt: number; // epoch-ms
  endAt: number; // epoch-ms
  notes: string;
  assignedTo: string; // team-member NAME (app convention)
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  invite?: SiteVisitInvite | null;
  googleEventId?: string; // phase 2
};

/** Default reason picklist (Jeff: picklist, not free text). Editable in
 *  Settings — stored overrides live in AppSettingsData.visitReasons. */
export const DEFAULT_VISIT_REASONS: string[] = [
  "Site survey / measure",
  "Sales call",
  "Punch walk",
  "Install check-in",
  "Warranty check",
  "Flame test",
  "Rigging inspection",
  "Service call",
];

/** Stored list if non-empty, else the defaults (mirrors mergedCatalog). */
export function mergedVisitReasons(stored?: string[] | null): string[] {
  const list = (stored || []).map((s) => s.trim()).filter(Boolean);
  return list.length ? list : DEFAULT_VISIT_REASONS;
}

export async function allVisits(): Promise<SiteVisit[]> {
  const list = await listDocs<SiteVisit>("site_visits");
  return list.sort((a, b) => (b.startAt || 0) - (a.startAt || 0));
}

export async function visitsForCustomer(customerId: string): Promise<SiteVisit[]> {
  return (await allVisits()).filter((v) => v.customerId === customerId);
}

export type SiteVisitInput = Omit<
  SiteVisit,
  "id" | "createdAt" | "updatedAt" | "invite"
>;

export async function createVisit(input: SiteVisitInput): Promise<SiteVisit> {
  const id = await nextPrefixedId("site_visits", "SV", 5000);
  const now = Date.now();
  const rec: SiteVisit = {
    ...input,
    id,
    createdAt: now,
    updatedAt: now,
    invite: null,
  };
  await upsertDoc<SiteVisit>("site_visits", rec);
  return rec;
}

/** Record the sent .ics invite on the visit (D76-I). */
export async function stampInvite(
  id: string,
  invite: SiteVisitInvite
): Promise<void> {
  await patchDoc<SiteVisit>("site_visits", id, (d) => {
    d.invite = invite;
    d.updatedAt = Date.now();
  });
}

/** Record the directly-created Google Calendar event (D77). The dashboard
 *  agenda uses this to dedup: a visit with a googleEventId shows via Google,
 *  not as a second local row. */
export async function stampGoogleEvent(
  id: string,
  googleEventId: string
): Promise<void> {
  await patchDoc<SiteVisit>("site_visits", id, (d) => {
    d.googleEventId = googleEventId;
    d.updatedAt = Date.now();
  });
}
