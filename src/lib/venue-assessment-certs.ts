import { getAll as getFlameJobs, type FlameJob } from "@/lib/stores/flame-jobs";
import {
  completedAtOf,
  getAll as getInspections,
  type InspectionRecord,
} from "@/lib/stores/inspections";
import type { InspectionRef } from "@/lib/stores/assessment";

type FlameRefRecord = Pick<
  FlameJob,
  "id" | "customerId" | "locationId" | "stage" | "completedAt"
>;

type InspectionRefRecord = Pick<
  InspectionRecord,
  | "id"
  | "customerId"
  | "locationId"
  | "stage"
  | "surveyDate"
  | "reportDate"
  | "updatedAt"
  | "level"
>;

function isoDate(timestamp: number | null): string {
  return timestamp == null ? "" : new Date(timestamp).toISOString().slice(0, 10);
}

export function resolveCertsFromRecords(
  flameJobs: FlameRefRecord[],
  inspections: InspectionRefRecord[],
  customerId: string | null,
  locationId: string | null
): Record<string, InspectionRef> {
  if (!customerId || !locationId) return {};

  const matchingFlames = flameJobs
    .filter((job) => job.customerId === customerId && job.locationId === locationId && job.stage === "completed")
    .sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));
  const matchingInspections = inspections
    .filter((record) => record.customerId === customerId && record.locationId === locationId && record.stage === "completed")
    .sort((a, b) => (completedAtOf(b) || 0) - (completedAtOf(a) || 0));

  const refs: Record<string, InspectionRef> = {};
  const flame = matchingFlames[0];
  if (flame) {
    refs.curtains = {
      onFile: "yes",
      type: "Flame test certificate",
      date: isoDate(flame.completedAt),
      source: "auto",
      recordId: flame.id,
    };
  }
  const inspection = matchingInspections[0];
  if (inspection) {
    refs.rigging = {
      onFile: "yes",
      type: `Level ${inspection.level || 1} rigging inspection`,
      date: isoDate(completedAtOf(inspection)),
      source: "auto",
      recordId: inspection.id,
    };
  }
  return refs;
}

export async function resolveCerts(
  customerId: string | null,
  locationId: string | null
): Promise<Record<string, InspectionRef>> {
  if (!customerId || !locationId) return {};
  const [flameJobs, inspections] = await Promise.all([getFlameJobs(), getInspections()]);
  return resolveCertsFromRecords(flameJobs, inspections, customerId, locationId);
}
