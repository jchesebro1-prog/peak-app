/** Draft estimate (spec §9). Pure: schemas, prompts, sanitizer, section builder. Prices ONLY via catalogAddPrice. */
import { z } from "zod";
import { SYSTEM_PRICE_STEP } from "@/app/(app)/estimator/pricing";
import { catalogAddPrice } from "@/app/(app)/estimator/tier-reprice";
import type { AssistDraftView, SpecItem, SpecSection } from "@/app/(app)/estimator/types";
import type { AssistDraftInfo } from "@/lib/stores/quotes";
import type { SystemCategory } from "@/lib/system-categories";
import type { DraftLine } from "../outcome";
import { UNTRUSTED_NOTE } from "./thread-text";

export const ExtractSchema = z.strictObject({
  quoteName: z.string(),
  venue: z.string(),
  requests: z.array(z.strictObject({ phrase: z.string(), qty: z.number() })),
  systems: z.array(z.string()),
});
export type Extract = { quoteName: string; venue: string; requests: { phrase: string; qty: number }[]; systems: string[] };

export const EXTRACT_SYSTEM = [
  "You read an email asking Peak Systems Group (theatrical rigging, curtains, lighting, AV) for pricing.",
  "List the equipment or work requested. phrase: a short catalog-style search phrase (\"black velour main curtain\", \"LED ellipsoidal\", \"motorized rigging hoist\"). qty: the stated quantity, else 1.",
  "systems: up to 8 short system names the request breaks into (\"Main curtain\", \"Stage lighting\"). quoteName: a short estimate name (\"Lincoln HS — stage curtains\"). venue: the venue or room if named, else \"\".",
  "Return empty lists if the email asks for no equipment or work.",
  UNTRUSTED_NOTE,
].join("\n");

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

export const DRAFT_SYSTEM = [
  "You draft a first-pass equipment estimate for Peak Systems Group, a theatrical rigging, curtain, lighting and AV contractor. A Peak estimator reviews every line before anything is sent.",
  "Group the request into systems (one per category of work). For each line: sku MUST be copied exactly from the candidate parts list, or \"\" when no candidate fits — then put a clear description in desc for the estimator to source.",
  "qty: whole numbers. Use the past systems as evidence of what Peak usually includes alongside the requested items (accessories, hardware), but only add an item when the request implies it.",
  "categoryId: the matching category id from the list, or \"\". reason: one short line on why this part/qty.",
  "notes: assumptions and questions for the estimator (missing dimensions, venue details). Never output prices or costs.",
  UNTRUSTED_NOTE,
].join("\n");

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
}): string {
  return [
    "Requested (from the email):",
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

export function buildDraftSections(
  draft: z.infer<typeof DraftSchema>,
  ctx: { parts: Map<string, PricePart>; tierMargin: number; freightPct: number; categories: SystemCategory[]; sectionIdBase: number }
): { sections: SpecSection[]; reasons: Record<string, string>; lines: DraftLine[]; dropped: number; unresolved: number } {
  const sections: SpecSection[] = [];
  const reasons: Record<string, string> = {};
  const lines: DraftLine[] = [];
  let dropped = 0; // blank lines removed
  let unresolved = 0; // skus outside the candidate set, kept as custom lines
  const catById = new Map(ctx.categories.map((c) => [c.id, c]));
  // Line ids are unique across the WHOLE quote — the Estimator finds/removes a line by id alone.
  let nextId = 1;
  for (const sys of (draft?.systems ?? []).slice(0, 12)) {
    const sectionId = "sys" + (ctx.sectionIdBase + sections.length);
    const items: SpecItem[] = [];
    for (const l of (sys.lines ?? []).slice(0, 60)) {
      const qty = Math.min(9999, Math.max(1, Math.floor(Number(l.qty) || 1)));
      // Only a part from the server-built candidate map is priced, and only from ITS cost/list — never from the draft.
      const part = l.sku ? ctx.parts.get(l.sku) : undefined;
      const id = nextId++;
      if (part) {
        items.push({ id, sku: part.sku, desc: part.desc, qty, unit: part.unit || "ea", cost: part.cost || 0, price: catalogAddPrice(part.cost || 0, part.list || 0, ctx.tierMargin) });
        lines.push({ sku: part.sku, qty });
      } else {
        const desc = (l.desc || l.sku || "").replace(/\s+/g, " ").trim().slice(0, 200);
        if (!desc) { dropped++; nextId--; continue; }
        if (l.sku) unresolved++; // a sku outside the candidate set — kept only as a custom line
        items.push({ id, sku: "", desc, qty, unit: "ea", cost: 0, price: 0, custom: true, internalNote: "Assist: needs a part and price" });
        lines.push({ sku: "", qty });
      }
      const why = (l.reason || "").trim().slice(0, 200);
      if (why) reasons[`${sectionId}:${id}`] = why;
    }
    if (!items.length) continue;
    const cat = catById.get(sys.categoryId);
    sections.push({
      id: sectionId,
      name: (sys.name || cat?.name || "System").trim().slice(0, 80),
      kind: "materials",
      mfr: "",
      freightPct: ctx.freightPct,
      freightAuto: true,
      priceRound: SYSTEM_PRICE_STEP, // same as the Estimator's own new-system path
      items,
      ...(cat?.discipline ? { discipline: cat.discipline } : {}),
    });
  }
  return { sections, reasons, lines, dropped, unresolved };
}

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
