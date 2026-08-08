"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import {
  createDesign,
  updateDesign,
  getDesign,
  addDesignRevision,
  promoteDesignToQuote,
  type DesignRecord,
} from "@/lib/stores/designs";
import { priceFromGridOrParametric } from "@/lib/design/quick-grid-seam";

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
  budget: number;
  customerId: string | null;
  locationId: string | null;
  customer: string;
  /** full designer state — opaque to the server, round-trips on reopen */
  config: Record<string, unknown>;
  /** Quote this estimate is being priced against (#41), when the screen was
   *  opened with one. Null on an ordinary sandbox design. */
  quoteId: string | null;
};

/**
 * The Grid-BOM-if-present seam (#41) applied to what actually gets STORED.
 *
 * `partial.budget` arrives as the client's live parametric total, which is
 * the right fallback by construction. When a Grid project links to this
 * design's quote, its BOM wins — re-resolved here at save time rather than
 * trusting the snapshot the screen loaded with, so a design saved after the
 * Grid layout changed stores the current number. With no quoteId there is
 * nothing to look up and the parametric total is stored unchanged, exactly
 * as before this feature.
 */
async function budgetFor(partial: DesignPartial): Promise<number> {
  if (!partial.quoteId) return partial.budget;
  const priced = await priceFromGridOrParametric(partial.quoteId, () => partial.budget);
  return priced.value;
}

async function persistDesign(
  id: string | null,
  partial: DesignPartial,
  owner: string
): Promise<DesignRecord> {
  const priced: DesignPartial = { ...partial, budget: await budgetFor(partial) };
  if (id) {
    const d = await updateDesign(id, priced);
    if (d) return d;
  }
  // prototype: SandboxStore.create() stamps the current user as owner
  return createDesign({ ...priced, owner });
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
  let record: DesignRecord;
  try {
    record = await persistDesign(id, partial, user.name);
  } catch (err) {
    console.error("saveDesignAction: design mint failed", err);
    return { ok: false, error: "Couldn’t save that design — please try again." };
  }
  revalidatePath("/design/designs");
  return { ok: true, record };
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
  let saved: DesignRecord;
  try {
    saved = await persistDesign(id, partial, user.name);
  } catch (err) {
    console.error("saveRevisionAction: design mint failed", err);
    return { ok: false, error: "Couldn’t save that revision — please try again." };
  }
  const snap = {
    name: partial.name,
    tier: partial.tier,
    // The SAVED budget, not the incoming parametric one — a revision has to
    // record the number the design actually carries once the Grid seam has
    // had its say (#41), or the history would contradict the design.
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
): Promise<{ ok: true; quoteId: string }> {
  const user = await requireUser();
  const saved = await persistDesign(id, partial, user.name);
  // Tier stamp at promotion (item 11, D88): Quick Design stays a sandbox at
  // its own engine margins; the customer's tier takes over when the design
  // becomes a quote (it's flagged requote and re-priced in the Estimator).
  // promoteDesignToQuote() → designToQuotePartial() already resolves and
  // stamps pricingTier/tierMargin (punch #65) — no need to re-resolve here.
  const q = await promoteDesignToQuote(saved.id, user.name);
  if (!q) throw new Error("Design not found");
  revalidatePath("/design/designs");
  revalidatePath("/quotes");
  return { ok: true, quoteId: q.id };
}
