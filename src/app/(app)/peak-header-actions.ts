"use server";

import { loadPeakHeaderDefault } from "@/lib/letterhead-server";
import { requireUser } from "@/lib/session";

/** Grid notes #9 — the company "Put the Peak header on documents" default,
 *  for a per-build checkbox's initial state (e.g. the Grid's Outputs menu). */
export async function peakHeaderDefaultAction(): Promise<boolean> {
  await requireUser();
  return loadPeakHeaderDefault();
}
