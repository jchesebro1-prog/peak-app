/**
 * Draft estimate (spec §9) → Estimate suggestion (spec 2026-10-13). Pure:
 * schemas (the prompts live in suggest-prompt.ts), the extract sanitizer, candidate selection and
 * the draft prompt's user text. Nothing here prices: the quote-creating
 * builder went with "Draft estimate" — a suggestion carries no money, and
 * the Estimator prices a line only when the rep adds it (catalogAddPrice).
 */
import { z } from "zod";
import type { AssistDraftView } from "@/app/(app)/estimator/types";
import type { AssistDraftInfo } from "@/lib/stores/quotes";
import type { SystemCategory } from "@/lib/system-categories";

export const ExtractSchema = z.strictObject({
  quoteName: z.string(),
  venue: z.string(),
  requests: z.array(z.strictObject({ phrase: z.string(), qty: z.number() })),
  systems: z.array(z.string()),
});
export type Extract = { quoteName: string; venue: string; requests: { phrase: string; qty: number }[]; systems: string[] };

export function sanitizeExtract(raw: z.infer<typeof ExtractSchema>): Extract {
  const requests = (raw?.requests ?? [])
    .map((r) => ({ phrase: (r.phrase || "").replace(/\s+/g, " ").trim().slice(0, 120), qty: Math.max(1, Math.floor(Number(r.qty) || 1)) }))
    .filter((r) => r.phrase)
    .slice(0, 15);
  const systems = [...new Set((raw?.systems ?? []).map((s) => (s || "").trim().slice(0, 80)).filter(Boolean))].slice(0, 8);
  return { quoteName: (raw?.quoteName || "").trim().slice(0, 120), venue: (raw?.venue || "").trim().slice(0, 120), requests, systems };
}

export const DraftSchema = z.strictObject({
  quoteName: z.string(),
  systems: z.array(
    z.strictObject({
      name: z.string(),
      categoryId: z.string(),
      lines: z.array(z.strictObject({ sku: z.string(), qty: z.number(), desc: z.string(), reason: z.string() })),
    })
  ),
  notes: z.string(),
});

export type CandidatePart = { sku: string; desc: string; mfr: string; unit: string; category: string };
export type ExampleSystem = { label: string; lines: { sku: string; desc: string; qty: number }[] };

/**
 * Pure — the candidate parts, in priority order (D876): `priority` SKUs
 * (system-category items, then example lines) first, then catalog `hits`,
 * up to `cap`. Each requested SKU resolves through `live` (keyed by the
 * requested SKU, renames followed); unresolved SKUs and repeats are skipped.
 */
export function selectCandidateParts<P extends { sku: string }>(priority: string[], hits: string[], live: Map<string, P>, cap: number): P[] {
  const out: P[] = [];
  const seen = new Set<string>();
  for (const sku of [...priority, ...hits]) {
    if (out.length >= cap) break;
    const p = live.get(sku);
    if (!p || seen.has(p.sku)) continue;
    seen.add(p.sku);
    out.push(p);
  }
  return out;
}

/**
 * Pure — example lines rewritten to the SKU each one means today (#304
 * renames), keeping only lines whose part is in the candidate set: an
 * example must never show the model a SKU it may not use.
 */
export function remapExampleLines<L extends { sku: string }>(lines: L[], live: Map<string, { sku: string }>, allowed: Set<string>): L[] {
  const out: L[] = [];
  for (const l of lines) {
    const sku = live.get(l.sku)?.sku;
    if (sku && allowed.has(sku)) out.push({ ...l, sku });
  }
  return out;
}

const exampleLine = (e: ExampleSystem) => `- ${e.label}: ${e.lines.slice(0, 40).map((l) => `${l.sku}×${l.qty}`).join(", ")}`;

export function buildDraftUserText(ctx: {
  thread: string; extract: Extract; categories: SystemCategory[]; pastSystems: ExampleSystem[]; customerSystems: ExampleSystem[]; candidates: CandidatePart[];
  /** Where the request came from ("the email", "the lead", …); the source text is `thread`. */
  requestedFrom?: string;
}): string {
  return [
    `Requested (from ${ctx.requestedFrom || "the email"}):`,
    ...ctx.extract.requests.map((r) => `- ${r.qty} × ${r.phrase}`),
    ctx.extract.systems.length ? `Systems mentioned: ${ctx.extract.systems.join("; ")}` : "",
    ctx.extract.venue ? `Venue: ${ctx.extract.venue}` : "",
    "",
    "System categories (id — name: typical items sku×qty):",
    ...ctx.categories.map((c) => `- ${c.id} — ${c.name}: ${c.items.map((i) => `${i.sku}×${i.qty}`).join(", ") || "(none)"}`),
    "",
    "Similar systems Peak sent or won before:",
    ...(ctx.pastSystems.length ? ctx.pastSystems.map(exampleLine) : ["(none found)"]),
    "",
    "This customer's past estimates:",
    ...(ctx.customerSystems.length ? ctx.customerSystems.map(exampleLine) : ["(none)"]),
    "",
    "Candidate parts (sku | description | manufacturer | unit | category) — the ONLY skus you may use:",
    ...ctx.candidates.map((p) => `${p.sku} | ${p.desc} | ${p.mfr} | ${p.unit} | ${p.category}`),
    "",
    ctx.thread,
  ].filter((l) => l !== "").join("\n");
}

export type PricePart = { sku: string; desc: string; unit: string; cost: number; list: number };

/** The Estimator banner's view of an Assist draft (D877): null when the quote
 *  isn't one or the banner was dismissed. Reasons follow the quote's CURRENT
 *  lines in order — a line the estimator removed drops out. */
export function assistDraftViewOf(q: { id: string; assistDraft?: AssistDraftInfo | null; spec?: unknown } | null): AssistDraftView | null {
  const d = q?.assistDraft;
  if (!q || !d || typeof d !== "object" || d.dismissedAt || typeof d.threadId !== "string" || !d.threadId) return null;
  const reasons: { desc: string; reason: string }[] = [];
  const map = d.reasons && typeof d.reasons === "object" ? d.reasons : {};
  const secs = (q.spec as { sections?: unknown } | null | undefined)?.sections;
  for (const sec of Array.isArray(secs) ? (secs as Array<{ id?: unknown; items?: unknown }>) : []) {
    for (const it of Array.isArray(sec?.items) ? (sec.items as Array<{ id?: unknown; desc?: unknown }>) : []) {
      const key = `${String(sec.id)}:${String(it?.id)}`;
      const reason = Object.prototype.hasOwnProperty.call(map, key) ? map[key] : undefined;
      if (typeof reason === "string" && reason) reasons.push({ desc: typeof it.desc === "string" ? it.desc : "", reason });
    }
  }
  return { quoteId: q.id, threadId: d.threadId, notes: typeof d.notes === "string" ? d.notes : "", reasons };
}
