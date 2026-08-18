import { getAll as allFlame } from "@/lib/stores/flame-jobs";
import { completedAtOf, getAll as allInspections } from "@/lib/stores/inspections";
import type { InspectionRef } from "@/lib/stores/assessment";

/** Resolve the latest completed compliance documents for a venue. Read-only. */
export async function resolveCerts(customerId: string | null, locationId: string | null): Promise<Record<string, InspectionRef>> {
  if (!customerId || !locationId) return {};
  const [flame, inspections] = await Promise.all([allFlame(), allInspections()]);
  const latestFlame = flame.filter((item) => item.stage === "completed" && item.customerId === customerId && item.locationId === locationId).sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0))[0];
  const latestInspection = inspections.filter((item) => item.stage === "completed" && item.customerId === customerId && item.locationId === locationId).sort((a, b) => (completedAtOf(b) || 0) - (completedAtOf(a) || 0))[0];
  const refs: Record<string, InspectionRef> = {};
  if (latestFlame) refs.curtains = { onFile: "yes", type: "Flame test", date: latestFlame.completedAt ? new Date(latestFlame.completedAt).toISOString().slice(0, 10) : "", source: "auto", recordId: latestFlame.id };
  if (latestInspection) refs.rigging = { onFile: "yes", type: `Inspection — Level ${latestInspection.level}`, date: latestInspection.reportDate || latestInspection.surveyDate || "", source: "auto", recordId: latestInspection.id };
  return refs;
}
