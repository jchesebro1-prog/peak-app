"use server";

import { revalidatePath } from "next/cache";
import { getDoc } from "@/db/doc-store";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/team";
import type { BidPanelResult } from "@/lib/parties/bid-vm";
import { loadBidPanel, viewerOf } from "@/lib/parties/bid-panel-server";
import { addBidder, awardBid, markSubmitted, setBidDetails, undoAward, updateBidder } from "@/lib/stores/bids";
import { get as getQuote } from "@/lib/stores/quotes";
import { scheduleQuotePdf } from "@/lib/quote-pdf/schedule";

/** #348 slice 2a — the Bidders card's server actions. Reads need a signed-in user; every mutation needs `create`. */
export type { BidPanelResult };

const DENIED = "You can't change this bid.";
const isId = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 200;

export async function bidPanelAction(quoteId: string): Promise<BidPanelResult> {
  const user = await requireUser();
  return loadBidPanel(quoteId, viewerOf(user));
}

/**
 * Gate, run the store call, then return the fresh panel (or the store's error). The gate runs first, so a
 * `quoteId` given as a resolver (a bidder id → its quote) is only looked up for a permitted user.
 */
async function mutate(
  quoteRef: unknown | (() => Promise<unknown>),
  run: (userId: string) => Promise<{ ok: boolean; error?: string; note?: string }>,
  /** #348 2b-i: the write can change what the customer document prints → re-render the PDF. `true` = always;
   *  `"if-awarded"` = only when the quote currently has an award (due date / addenda print only with an addressee). */
  rerender: boolean | "if-awarded" = false
): Promise<BidPanelResult> {
  const user = await requireUser();
  if (!can("create", user.roles)) return { ok: false, error: DENIED };
  const quoteId = typeof quoteRef === "function" ? await (quoteRef as () => Promise<unknown>)() : quoteRef;
  if (!isId(quoteId)) return { ok: false, error: "That estimate wasn't found." };
  const r = await run(user.id);
  if (!r.ok) return { ok: false, error: r.error || "That didn't save." };
  revalidatePath("/", "layout");
  if (rerender === true || (rerender === "if-awarded" && !!(await getQuote(quoteId))?.bid?.awardedPartyId)) await scheduleQuotePdf(quoteId);
  const panel = await loadBidPanel(quoteId, viewerOf(user));
  return panel.ok && r.note ? { ...panel, note: r.note } : panel;
}

/** The quote a bidder belongs to (a bidder id is a party id; its record id is the quote). */
async function quoteOfBidder(partyId: unknown): Promise<string | null> {
  if (!isId(partyId)) return null;
  const p = await getDoc<{ id: string; recordType: string; recordId: string }>("record_parties", partyId);
  return p && p.recordType === "quote" ? p.recordId : null;
}

export async function setBidDetailsAction(quoteId: string, raw: unknown): Promise<BidPanelResult> {
  return mutate(quoteId, () => setBidDetails(quoteId, raw), "if-awarded");
}

export async function addBidderAction(
  quoteId: string,
  input: { companyId: string; contactId?: string | null; role: "gc" | "ec"; submitVia?: "email" | "website" }
): Promise<BidPanelResult> {
  return mutate(quoteId, (uid) => {
    if (!input || typeof input !== "object" || !isId(input.companyId)) return Promise.resolve({ ok: false, error: "Pick a company." });
    if (input.contactId != null && !isId(input.contactId)) return Promise.resolve({ ok: false, error: "That person isn't at this company." });
    if (input.role !== "gc" && input.role !== "ec") return Promise.resolve({ ok: false, error: "Bidders are GCs or ECs." });
    return addBidder(
      { quoteId, companyId: input.companyId, contactId: input.contactId ?? null, role: input.role, submitVia: input.submitVia === "website" ? "website" : "email" },
      uid
    ).then((r) => (r.ok && r.existed ? { ...r, note: "Already a bidder." } : r));
  });
}

export async function updateBidderAction(partyId: string, raw: unknown): Promise<BidPanelResult> {
  return mutate(() => quoteOfBidder(partyId), () => updateBidder(partyId, raw));
}

export async function markSubmittedAction(partyId: string, confirmation: string): Promise<BidPanelResult> {
  return mutate(() => quoteOfBidder(partyId), (uid) => markSubmitted(partyId, uid, typeof confirmation === "string" ? confirmation : ""));
}

export async function awardBidAction(quoteId: string, partyId: string): Promise<BidPanelResult> {
  return mutate(quoteId, () => (isId(partyId) ? awardBid(quoteId, partyId) : Promise.resolve({ ok: false, error: "That bidder wasn't found." })), true);
}

export async function undoAwardAction(quoteId: string): Promise<BidPanelResult> {
  return mutate(quoteId, () => undoAward(quoteId), true);
}
