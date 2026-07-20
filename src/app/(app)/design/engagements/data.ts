import { allEngagements, mergedConsultingPhases, type ConsultingEngagement } from "@/lib/stores/engagements";
import { getAll as getAllQuotes } from "@/lib/stores/quotes";
import { allVisits, type SiteVisit } from "@/lib/stores/site-visits";
import { activeUsers } from "@/lib/users";
import { getSettings } from "@/lib/settings";

/**
 * Shared server loader for the Consulting module (D90) — the projects-module
 * pattern: one loader feeding both the list route and the [id] detail route,
 * everything already serializable for the client view.
 */

export type QuoteLite = { id: string; value: number; status: string; name: string };

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
  roster: string[];
  phaseMenu: string[];
  /** All visits (lite) — the view filters by engagement / company. */
  visits: VisitLite[];
};

export async function loadConsultingData(): Promise<ConsultingData> {
  const [engagements, quotes, users, settings, visits] = await Promise.all([
    allEngagements(),
    getAllQuotes(),
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
    roster: users.map((u) => u.name),
    phaseMenu: mergedConsultingPhases(settings.consultingPhases),
    visits: visitLites,
  };
}
