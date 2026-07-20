import { allEngagements, mergedConsultingPhases, type ConsultingEngagement } from "@/lib/stores/engagements";
import { getAll as getAllQuotes } from "@/lib/stores/quotes";
import { getAllDesigns } from "@/lib/stores/designs";
import { allVisits, type SiteVisit } from "@/lib/stores/site-visits";
import { activeUsers } from "@/lib/users";
import { getSettings } from "@/lib/settings";

/**
 * Shared server loader for the Consulting module (D90) — the projects-module
 * pattern: one loader feeding both the list route and the [id] detail route,
 * everything already serializable for the client view.
 */

export type QuoteLite = { id: string; value: number; status: string; name: string };

/** Serializable slice of a linked design (D-### sandbox record) for the Overview tab. */
export type DesignLite = { id: string; name: string; venue: string };

/** Serializable slice of a site visit for the Oversight tab. */
export type VisitLite = {
  id: string;
  customerId: string;
  reason: string;
  venue: string;
  startAt: number;
  assignedTo: string;
  engagementId: string | null;
};

export type ConsultingData = {
  engagements: ConsultingEngagement[];
  quotesById: Record<string, QuoteLite>;
  /** Linked designs (D-### sandbox), keyed by id — the Overview tab's "Linked designs" list. */
  designsById: Record<string, DesignLite>;
  roster: string[];
  phaseMenu: string[];
  /** All visits (lite) — the view filters by engagement / company. */
  visits: VisitLite[];
};

export async function loadConsultingData(): Promise<ConsultingData> {
  const [engagements, quotes, designs, users, settings, visits] = await Promise.all([
    allEngagements(),
    getAllQuotes(),
    getAllDesigns(),
    activeUsers(),
    getSettings(),
    allVisits(),
  ]);

  const wanted = new Set<string>();
  for (const e of engagements) {
    wanted.add(e.quoteId);
    if (e.installQuoteId) wanted.add(e.installQuoteId);
  }
  const quotesById: Record<string, QuoteLite> = {};
  for (const q of quotes) {
    if (!wanted.has(q.id)) continue;
    quotesById[q.id] = { id: q.id, value: q.value || 0, status: q.status, name: q.name };
  }

  const wantedDesigns = new Set<string>();
  for (const e of engagements) {
    for (const did of e.designIds) wantedDesigns.add(did);
  }
  const designsById: Record<string, DesignLite> = {};
  for (const d of designs) {
    if (!wantedDesigns.has(d.id)) continue;
    designsById[d.id] = { id: d.id, name: d.name, venue: d.venue };
  }

  const companyIds = new Set(engagements.map((e) => e.companyId).filter(Boolean));
  const visitLites: VisitLite[] = visits
    .filter((v: SiteVisit) => v.engagementId || companyIds.has(v.customerId))
    .map((v: SiteVisit) => ({
      id: v.id,
      customerId: v.customerId,
      reason: v.reason,
      venue: v.venue,
      startAt: v.startAt,
      assignedTo: v.assignedTo,
      engagementId: v.engagementId || null,
    }));

  return {
    engagements,
    quotesById,
    designsById,
    roster: users.map((u) => u.name),
    phaseMenu: mergedConsultingPhases(settings.consultingPhases),
    visits: visitLites,
  };
}
