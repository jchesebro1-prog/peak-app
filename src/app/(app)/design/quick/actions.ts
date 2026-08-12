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
};

async function persistDesign(
  id: string | null,
  partial: DesignPartial,
  owner: string
): Promise<DesignRecord> {
  if (id) {
    const d = await updateDesign(id, partial);
    if (d) return d;
  }
  // prototype: SandboxStore.create() stamps the current user as owner
  return createDesign({ ...partial, owner });
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
    budget: partial.budget,
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
): Promise<{ ok: true; quoteId: string } | { ok: false; error: string }> {
  const user = await requireUser();
  let saved: DesignRecord;
  try {
    saved = await persistDesign(id, partial, user.name);
  } catch (err) {
    console.error("addToQuotesAction: design mint failed", err);
    return { ok: false, error: "Couldn’t add that design to Quotes — please try again." };
  }
  // Tier stamp at promotion (item 11, D88): Quick Design stays a sandbox at
  // its own engine margins; the customer's tier takes over when the design
  // becomes a quote (it's flagged requote and re-priced in the Estimator).
  // promoteDesignToQuote() → designToQuotePartial() already resolves and
  // stamps pricingTier/tierMargin (punch #65) — no need to re-resolve here.
  const q = await promoteDesignToQuote(saved.id, user.name);
  if (!q) return { ok: false, error: "Couldn’t find the saved design to add to Quotes." };
  revalidatePath("/design/designs");
  revalidatePath("/quotes");
  return { ok: true, quoteId: q.id };
}
