/** Home "Today" card rows (spec Part 3 "At risk" → Home card). Pure, client-safe. */
import { chicagoDayKey } from "@/lib/drive-plan/day";
import { fmtBlockTime } from "./labels";
import type { PlanResult } from "./types";

export type TodayRow = { key: string; time: string; title: string; href: string; pinned: boolean; atRisk: boolean };

export function todayRows(r: PlanResult, nowMs: number): TodayRow[] {
  const today = chicagoDayKey(nowMs);
  return r.blocks
    .filter((b) => chicagoDayKey(b.startMs) === today)
    .sort((a, b) => a.startMs - b.startMs || (a.key < b.key ? -1 : 1))
    .map((b) => ({ key: b.key, time: fmtBlockTime(b.startMs, b.endMs), title: b.title, href: b.href, pinned: !!b.pinned, atRisk: b.atRisk }));
}
