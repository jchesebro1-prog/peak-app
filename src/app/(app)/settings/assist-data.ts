import { assistSettingsOf, assistStatusLine, monthKeyChicago } from "@/lib/assist/config";
import { estimateOutcomeFor, type DraftLine } from "@/lib/assist/outcome";
import { assistReport, recentMonthKeys } from "@/lib/assist/report";
import type { AssistOutcome } from "@/lib/assist/types";
import { listRunsByMonth, type AssistRun } from "@/lib/stores/assist-runs";
import { get as getQuote } from "@/lib/stores/quotes";
import type { AppSettingsData } from "@/lib/settings";
import type { AssistVM } from "./groups/types";

/**
 * #334 — the Settings → Beta Assist pilot card's data: the settings, the
 * status line and one month's usage report. An estimate "draft" run stores no
 * outcome, so it is read off the quote as it stands now (estimateOutcomeFor):
 * a quote that no longer exists, or an explicit `quoteId: null` (nothing was
 * created), counts as discarded; no quoteId key at all stays pending.
 *
 * Never throws: a preview deploy can reach the shared production DB before
 * migration 0039 (assist_runs) has run, and the Data group must not 500 —
 * the card then shows an empty report.
 */
export async function loadAssistVM(settings: AppSettingsData, monthParam?: string): Promise<AssistVM> {
  const now = Date.now();
  const raw = monthParam || "";
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(raw) ? raw : monthKeyChicago(now);
  let runs: AssistRun[] = [];
  const estOutcomes = new Map<string, AssistOutcome>();
  try {
    runs = await listRunsByMonth(month);
    const drafts = runs.filter((r) => r.feature === "estimate" && r.step === "draft" && r.ok && !r.outcome);
    const outcomes = await Promise.all(
      drafts.map(async (r) => {
        const d = (r.outcomeDetail ?? {}) as { quoteId?: string | null; lines?: DraftLine[] };
        const quote = d.quoteId ? await getQuote(d.quoteId) : null;
        return [r.id, estimateOutcomeFor(d, (quote ?? null) as Parameters<typeof estimateOutcomeFor>[1])] as const;
      })
    );
    for (const [id, o] of outcomes) if (o) estOutcomes.set(id, o);
  } catch (e) {
    console.error("[assist] loading the Assist pilot report failed — showing an empty report", e);
    runs = [];
    estOutcomes.clear();
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
