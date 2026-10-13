import { assistSettingsOf, assistStatusLine, monthKeyChicago } from "@/lib/assist/config";
import { estimateKeep, type DraftLine } from "@/lib/assist/outcome";
import { assistReport, recentMonthKeys } from "@/lib/assist/report";
import type { AssistOutcome } from "@/lib/assist/types";
import { listRunsByMonth } from "@/lib/stores/assist-runs";
import { get as getQuote } from "@/lib/stores/quotes";
import type { AppSettingsData } from "@/lib/settings";
import type { AssistVM } from "./groups/types";

/**
 * #334 — the Settings → Beta Assist pilot card's data: the settings, the
 * status line and one month's usage report. An estimate "draft" run stores no
 * outcome, so it is read off the quote as it stands now; a quote that no
 * longer exists passes null and counts as discarded.
 */
export async function loadAssistVM(settings: AppSettingsData, monthParam?: string): Promise<AssistVM> {
  const now = Date.now();
  const raw = monthParam || "";
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(raw) ? raw : monthKeyChicago(now);
  const runs = await listRunsByMonth(month);
  const estOutcomes = new Map<string, AssistOutcome>();
  for (const r of runs) {
    if (r.feature !== "estimate" || r.step !== "draft" || !r.ok || r.outcome) continue;
    const d = (r.outcomeDetail ?? {}) as { quoteId?: string; lines?: DraftLine[] };
    if (!d.quoteId) continue;
    const q = await getQuote(d.quoteId);
    estOutcomes.set(r.id, estimateKeep(d.lines ?? [], (q ?? null) as Parameters<typeof estimateKeep>[1]).outcome);
  }
  return {
    settings: assistSettingsOf(settings),
    status: assistStatusLine(),
    month,
    months: Array.from(new Set([...recentMonthKeys(now, 3, monthKeyChicago), month])),
    spendUsd: runs.reduce((sum, r) => sum + (r.costUsd || 0), 0),
    report: assistReport(runs, estOutcomes),
  };
}
