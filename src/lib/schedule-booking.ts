import type { ProjectRecord } from "@/lib/stores/projects";

export type ScheduleBookingSeedReason = "delivery_eta" | "install_start" | "today";

export type ScheduleBookingSeed = {
  start: number;
  reason: ScheduleBookingSeedReason;
};

export function nextPendingDeliveryEta(
  project: Pick<ProjectRecord, "deliveries">
): number | null {
  const pending = (project.deliveries || [])
    .filter((d) => d.status !== "received" && Number.isFinite(d.eta) && (d.eta || 0) > 0)
    .map((d) => d.eta as number)
    .sort((a, b) => a - b);
  return pending[0] ?? null;
}

export function scheduleBookingSeed(
  project: Pick<ProjectRecord, "deliveries" | "installStart">,
  today: number
): ScheduleBookingSeed {
  const eta = nextPendingDeliveryEta(project);
  if (eta) return { start: eta, reason: "delivery_eta" };
  if (project.installStart) return { start: project.installStart, reason: "install_start" };
  return { start: today, reason: "today" };
}
