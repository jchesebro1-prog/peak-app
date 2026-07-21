/**
 * Operations work assembler (D100) — SERVER ONLY.
 *
 * Reads the three service stores (PGlite-backed) and normalizes them into
 * WorkItem[] via the pure helpers in ./operations-work. Never import this from
 * a "use client" module. Projects are fetched by the pages themselves
 * (getAllProjects) and merged there.
 */
import { getAll as getAllFlame } from "@/lib/stores/flame-jobs";
import { getAll as getAllInspections } from "@/lib/stores/inspections";
import { getAll as getAllRepairs } from "@/lib/stores/repair-jobs";
import { serviceToWorkItems, type WorkItem } from "./operations-work";

/** All live, dated flame + inspection + repair jobs as normalized WorkItems. */
export async function loadServiceWork(): Promise<WorkItem[]> {
  const [flame, inspections, repairs] = await Promise.all([
    getAllFlame(),
    getAllInspections(),
    getAllRepairs(),
  ]);
  return [
    ...serviceToWorkItems(flame, "flame", (id) => "/flame-tests/results?job=" + encodeURIComponent(id)),
    ...serviceToWorkItems(inspections, "inspection", (id) => "/inspections/" + encodeURIComponent(id)),
    ...serviceToWorkItems(repairs, "repair", (id) => "/repairs/results?job=" + encodeURIComponent(id)),
  ];
}
