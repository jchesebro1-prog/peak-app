import { assistSettingsOf, assistStatusLine, monthKeyChicago, type AssistKeyInfo } from "@/lib/assist/config";
import { assistKeyInfo, getAssistEnv } from "@/lib/assist/key-store";
import { estimateOutcomeFor, type DraftLine } from "@/lib/assist/outcome";
import { assistReport, filingReport, recentMonthKeys, type FilingReport } from "@/lib/assist/report";
import { loadOrgContext } from "@/lib/inbox-org/pipeline";
import { loadSenderRuleRows } from "@/lib/inbox-org/rule-list-server";
import type { SenderRuleRowVM } from "@/lib/inbox-org/rule-list";
import { getFilingLog, getOwnDomainOverride, promiseTaskRows } from "@/lib/stores/inbox-org";
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
  // D881: where the key comes from — the card gets last4 + source, never the key.
  // noCache: right after a save/remove on another instance, never show a stale key.
  const [env, keyInfo] = await Promise.all([getAssistEnv({ noCache: true }), assistKeyInfo({ noCache: true })]).catch((e): [Record<string, string | undefined>, AssistKeyInfo] => {
    console.error("[assist] reading the Assist key state failed", e instanceof Error ? e.name : "error");
    return [process.env, { source: "none", last4: null, savedAt: null, savedBy: null, unreadable: false, previewIgnored: false }];
  });
  const org = await loadOrgVM(runs, month);
  return {
    settings: assistSettingsOf(settings),
    status: assistStatusLine(env, keyInfo),
    keyInfo,
    month,
    months: Array.from(new Set([...recentMonthKeys(now, 3, monthKeyChicago), month])),
    spendUsd: runs.reduce((sum, r) => sum + (r.costUsd || 0), 0),
    report: assistReport(runs, estOutcomes),
    org,
  };
}

/** #335 — the Inbox-organization half of the card: the month's filing report
 *  (AI `file` runs + the filing log + promise-tasks), the company-wide sender
 *  rules and the own-domain override with the domains in effect. Never
 *  throws: each part falls back to empty. */
async function loadOrgVM(runs: AssistRun[], month: string): Promise<AssistVM["org"]> {
  const inMonth = (ms: number) => !!ms && monthKeyChicago(ms) === month;
  let filing: FilingReport;
  try {
    const [log, tasks] = await Promise.all([getFilingLog(), promiseTaskRows()]);
    filing = filingReport(runs, log.filter((e) => inMonth(e.at)), tasks.filter((t) => inMonth(t.createdAt)));
  } catch (e) {
    console.error("[inbox-org] loading the filing report failed", e instanceof Error ? e.name : "error");
    filing = filingReport([], [], []);
  }
  let companyRules: SenderRuleRowVM[] = [];
  let ownDomainOverride = "";
  let ownDomains: string[] = [];
  try {
    const [rules, override, ctx] = await Promise.all([loadSenderRuleRows({ scope: "company" }), getOwnDomainOverride(), loadOrgContext({ fresh: true })]);
    companyRules = rules;
    ownDomainOverride = override ?? "";
    ownDomains = ctx.ownDomains;
  } catch (e) {
    console.error("[inbox-org] loading sender rules / own domains failed", e instanceof Error ? e.name : "error");
  }
  return { filing, companyRules, ownDomainOverride, ownDomains };
}
