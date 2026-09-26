"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import {
  getDesign,
  addDesignRevision,
  promoteDesignToQuote,
  type DesignRecord,
} from "@/lib/stores/designs";
import { GRID_DESIGN_REFUSAL, quickPromoteCheck, quickSaveFields, saveQuickDesign } from "@/lib/stores/design-pricing";

/**
 * Quick Design server actions — the screen computes budgetary math
 * client-side (port of the prototype's logic class) and persists through
 * these. Mirrors sandbox.js saveDesign / saveRevision / addToQuotes.
 */

/** What the Quick Design screen persists (makeDesign() output). */
export type DesignPartial = {
  name: string;
  venue: string;
  size: string;
  tier: string;
  width: number;
  depth: number;
  grid: number;
  systems: string[];
  /** The screen's own total — sent, but NEVER stored or used (D-GEM-23):
   *  saveQuickDesign derives `budget` from `config` on the server. */
  budget: number;
  /** Equipment-map completeness of the chosen tier (#GEM D-GEM-10) —
   *  makeDesign() computes it for the screen, but the server NEVER trusts it
   *  (D-GEM-19): saveQuickDesign re-derives it from `config` before writing,
   *  so a stale or hand-built client value can't mark a design complete. */
  incomplete?: { needsPart: number };
  customerId: string | null;
  locationId: string | null;
  customer: string;
  /** full designer state — opaque to the server, round-trips on reopen */
  config: Record<string, unknown>;
};

/**
 * Every Quick Design save goes through saveQuickDesign (D-GEM-19/D-GEM-23,
 * final review M1/M2): only the whitelisted design fields are written (never
 * review / quoteId / owner / layoutMode / gridProjectId), `budget` and
 * `incomplete` are the server's own price of `config`, and a Grid record is
 * refused. Returns the typed failure, or the saved record.
 */
async function persistDesign(
  id: string | null,
  clientPartial: DesignPartial,
  owner: string,
  /** Already priced by the caller this request (Add to Quotes' check). */
  known?: { needsPart: number; budget: number }
): Promise<{ ok: true; record: DesignRecord } | { ok: false; error: string }> {
  return saveQuickDesign(id, clientPartial, owner, known);
}

/** Save / update the design in the sandbox (NOT the pipeline). */
export async function saveDesignAction(
  id: string | null,
  partial: DesignPartial
): Promise<{ ok: true; record: DesignRecord } | { ok: false; error: string }> {
  const user = await requireUser();
  // #80: persistDesign falls through to createDesign, whose mint
  // (insertWithPrefixedId) THROWS once an id collision outlasts its retry
  // budget (doc-store.ts). Rare, but this is a Save button — report it as a
  // typed message instead of letting a raw exception escape as a 500.
  let res: Awaited<ReturnType<typeof persistDesign>>;
  try {
    res = await persistDesign(id, partial, user.name);
  } catch (err) {
    console.error("saveDesignAction: design mint failed", err);
    return { ok: false, error: "Couldn’t save that design — please try again." };
  }
  if (!res.ok) return res;
  revalidatePath("/design/designs");
  return { ok: true, record: res.record };
}

/** Snapshot the current design as an immutable revision (saving first if needed). */
export async function saveRevisionAction(
  id: string | null,
  partial: DesignPartial
): Promise<
  { ok: true; record: DesignRecord; rev: number } | { ok: false; error: string }
> {
  const user = await requireUser();
  // #80: same mint throw as saveDesignAction — a revision saves the design
  // first, so the create path is identical.
  let res: Awaited<ReturnType<typeof persistDesign>>;
  try {
    res = await persistDesign(id, partial, user.name);
  } catch (err) {
    console.error("saveRevisionAction: design mint failed", err);
    return { ok: false, error: "Couldn’t save that revision — please try again." };
  }
  if (!res.ok) return res;
  const saved = res.record;
  const snap = {
    name: partial.name,
    tier: partial.tier,
    // D-GEM-23: the revision records the server's budget, never the client's.
    budget: saved.budget,
    venue: partial.venue,
    size: partial.size,
    width: partial.width,
    depth: partial.depth,
    grid: partial.grid,
    systems: partial.systems,
    customer: partial.customer || "",
    config: partial.config,
    by: user.name,
  };
  const r = await addDesignRevision(saved.id, snap);
  const record = (await getDesign(saved.id)) || saved;
  revalidatePath("/design/designs");
  return { ok: true, record, rev: r ? r.rev : 0 };
}

/**
 * The bridge: save the design, promote it into the pipeline (flagged
 * requote), remove it from the sandbox — the caller opens the new quote in
 * the Estimator to requote.
 */
export async function addToQuotesAction(
  id: string | null,
  partial: DesignPartial
): Promise<{ ok: true; quoteId: string } | { ok: false; error: string; needsPart?: number }> {
  const user = await requireUser();
  // M1: a Grid (manual-layout) record is never promoted through Quick Design.
  const existing = id ? await getDesign(id) : null;
  if (existing?.layoutMode === "manual") return { ok: false, error: GRID_DESIGN_REFUSAL };
  // #GEM D-GEM-10/D-GEM-19/D-GEM-23: never promote an incomplete estimate.
  // The server re-prices the design's config against the Equipment map — the
  // client's `incomplete` and `budget` are never read — so a stale or forged
  // client can't bypass it, and the quote's value is the server's figure.
  const { price, blocked } = await quickPromoteCheck({ ...(existing || {}), ...quickSaveFields(partial) });
  if (blocked) return { ok: false, error: blocked.error, needsPart: blocked.needsPart };
  let saved: DesignRecord;
  try {
    const res = await persistDesign(id, partial, user.name, price);
    if (!res.ok) return res;
    saved = res.record;
  } catch (err) {
    console.error("addToQuotesAction: design mint failed", err);
    return { ok: false, error: "Couldn’t save that design for quoting — please try again." };
  }
  // Tier stamp at promotion (item 11, D88): Quick Design stays a sandbox at
  // its own engine margins; the customer's tier takes over when the design
  // becomes a quote (it's flagged requote and re-priced in the Estimator).
  // promoteDesignToQuote() → designToQuotePartial() already resolves and
  // stamps pricingTier/tierMargin (punch #65) — no need to re-resolve here.
  let q: Awaited<ReturnType<typeof promoteDesignToQuote>>;
  try {
    q = await promoteDesignToQuote(saved.id, user.name, price);
  } catch (err) {
    console.error("addToQuotesAction: quote promotion failed", err);
    return { ok: false, error: "Couldn’t create the quote — please try again." };
  }
  if (!q) return { ok: false, error: "That design could not be found for quoting." };
  revalidatePath("/design/designs");
  revalidatePath("/quotes");
  return { ok: true, quoteId: q.id };
}
