/**
 * #334 Assist — Draft estimate (spec §9, D876–D877). Haiku extracts the request,
 * the server gathers candidate parts (catalog, past systems, this customer's
 * estimates, system categories), Opus drafts systems over ONLY those parts, and
 * the server prices every line itself (catalogAddPrice at the customer's tier)
 * into a new DRAFT Estimator quote. Nothing is sent, linked or status-changed.
 *
 * Request-scope free (the "use server" wrapper owns requireUser, revalidatePath
 * and the PDF schedule) so the DB checks can drive it with fake providers.
 */
import { create as createQuote, update as updateQuote, type Quote } from "@/lib/stores/quotes";
import { resolveCustomerId } from "@/lib/stores/comms";
import { get as getCustomer } from "@/lib/stores/customers";
import { resolveTier } from "@/lib/pricing-tiers";
import { loadFreightRule } from "@/lib/freight-rule-load";
import { canonicalBonusSections } from "@/lib/estimate-bonus/canonical";
import { totals } from "@/app/(app)/estimator/pricing";
import { mergeRunDetail } from "@/lib/stores/assist-runs";
import { runAssist, type RunDeps } from "./run";
import { loadThreadFor } from "./thread-access";
import { gatherEstimateCandidates } from "./estimate-candidates";
import { promptMessages, threadBlock } from "./features/thread-text";
import {
  buildDraftSections,
  buildDraftUserText,
  DRAFT_SYSTEM,
  DraftSchema,
  EXTRACT_SYSTEM,
  ExtractSchema,
  sanitizeExtract,
} from "./features/estimate-draft";

export type DraftEstimateDeps = { extract?: RunDeps; draft?: RunDeps; now?: number };
export type DraftEstimateResult = { ok: true; quoteId: string; quote: Quote } | { ok: false; error: string };

const NOTES_MAX = 2000;

export async function draftEstimateFromThread(
  threadId: string,
  me: { id: string; name: string },
  deps: DraftEstimateDeps = {}
): Promise<DraftEstimateResult> {
  const t = await loadThreadFor(threadId, me.name);
  if (!t) return { ok: false, error: "That email isn't available." };
  const user = { id: me.id, name: me.name };
  const contextRef = "thread:" + t.id;
  const thread = threadBlock({ subject: t.subject, messages: promptMessages(t) }, { maxMessages: 10, maxChars: 2500 });

  // 1. Extract (Haiku): what was asked for. Counts against the hourly limit.
  const a = await runAssist(
    { feature: "estimate", step: "extract", slot: "extract", user, system: EXTRACT_SYSTEM, userText: thread, schema: ExtractSchema, contextRef },
    deps.extract
  );
  if (!a.ok) return { ok: false, error: a.error };
  const extract = sanitizeExtract(a.value);
  if (!extract.requests.length && !extract.systems.length) {
    return { ok: false, error: "Assist didn't find an equipment request in this email." };
  }

  // 2. Candidates — the only SKUs the draft may use; no money in the prompt.
  const customerId = await resolveCustomerId(t);
  const c = await gatherEstimateCandidates({ phrases: extract.requests.map((r) => r.phrase), systems: extract.systems, customerId });

  // 3. Draft (Opus). The second call of one request: not rate-counted again.
  const b = await runAssist(
    {
      feature: "estimate",
      step: "draft",
      slot: "estimate",
      user,
      countRate: false,
      system: DRAFT_SYSTEM,
      userText: buildDraftUserText({ thread, extract, categories: c.categories, pastSystems: c.pastSystems, customerSystems: c.customerSystems, candidates: c.candidates }),
      schema: DraftSchema,
      contextRef,
    },
    deps.draft
  );
  if (!b.ok) return { ok: false, error: b.error };

  // 4. Price server-side: catalog cost/list at the customer's tier, base freight.
  const now = deps.now ?? Date.now();
  const tier = await resolveTier(customerId, t.contactName || null);
  const rule = await loadFreightRule();
  const built = buildDraftSections(b.value, { parts: c.parts, tierMargin: tier.margin, freightPct: rule.basePct, categories: c.categories, sectionIdBase: now });
  const detail = { lines: built.lines, dropped: built.dropped, unresolved: built.unresolved, extractRunId: a.runId };
  if (!built.sections.length) {
    await mergeRunDetail(b.runId, { ...detail, quoteId: null });
    return { ok: false, error: "Assist couldn't build any systems from this email — nothing was created." };
  }

  // 5. A new draft Estimator quote — bonus lines at birth, value from totals().
  const sections = canonicalBonusSections({ source: "estimator", quoteType: "system", status: "draft" }, built.sections);
  const tt = totals(sections, 0);
  const customer = t.customer || (customerId ? (await getCustomer(customerId))?.name || "" : "");
  const name = (b.value.quoteName || extract.quoteName || `Assist draft — ${t.subject || "email"}`).trim().slice(0, 120);
  let q: Quote;
  try {
    q = await createQuote({
      name,
      customer,
      customerId,
      contactName: t.contactName || "",
      source: "estimator",
      status: "draft",
      quoteType: "system",
      spec: { sections, mobs: [] },
      value: tt.grand,
      margin: tt.margin,
      owner: me.name,
      preparedBy: me.name,
      pricingTier: tier.tier,
      tierMargin: tier.margin,
      ...(t.link?.type === "lead" && t.link.id ? { leadId: t.link.id } : {}),
    });
  } catch (e) {
    await mergeRunDetail(b.runId, { ...detail, quoteId: null });
    return { ok: false, error: e instanceof Error ? e.message : "Could not create the estimate." };
  }
  // create() never copies assistDraft (buildQuote) — it rides on the doc via update().
  const withDraft = await updateQuote(q.id, {
    assistDraft: { runId: b.runId, threadId: t.id, at: now, notes: (b.value.notes || "").trim().slice(0, NOTES_MAX), reasons: built.reasons },
  });
  await mergeRunDetail(b.runId, { ...detail, quoteId: q.id });
  return { ok: true, quoteId: q.id, quote: withDraft || q };
}
