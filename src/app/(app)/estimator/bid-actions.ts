"use server";

import { revalidatePath } from "next/cache";
import { getDoc } from "@/db/doc-store";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/team";
import type { BidPanelResult } from "@/lib/parties/bid-vm";
import { loadBidPanel, viewerOf } from "@/lib/parties/bid-panel-server";
import { addBidder, awardBid, markSubmitted, setBidDetails, undoAward, updateBidder } from "@/lib/stores/bids";
import { get as getQuote, type QuoteStatus } from "@/lib/stores/quotes";
import { scheduleQuotePdf } from "@/lib/quote-pdf/schedule";
import { addendumDraftNote } from "@/lib/parties/bids";
import { quoteNextStepFor } from "@/lib/quote-next-step-server";
import type { QuoteNextStepView } from "@/lib/quote-next-step";

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
  run: (userId: string, userName: string) => Promise<{ ok: boolean; error?: string; note?: string }>,
  /** #348 2b-i: the write can change what the customer document prints → re-render the PDF. `true` = always;
   *  `"if-awarded"` = only when the quote currently has an award (due date / addenda print only with an addressee). */
  rerender: boolean | "if-awarded" = false
): Promise<BidPanelResult> {
  const user = await requireUser();
  if (!can("create", user.roles)) return { ok: false, error: DENIED };
  const quoteId = typeof quoteRef === "function" ? await (quoteRef as () => Promise<unknown>)() : quoteRef;
  if (!isId(quoteId)) return { ok: false, error: "That estimate wasn't found." };
  const r = await run(user.id, user.name);
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

/** #348 (Jeff 2026-10-15): when the save added an addendum to a sent estimate, the store moved it back to Draft —
 *  the result then carries the note and `sync` (the fresh status + next step) so the Estimator's header follows. */
export type BidDetailsResult = BidPanelResult & { sync?: { status: QuoteStatus; next: QuoteNextStepView | null; /** #368: the revise re-priced lines — reload. */ repriced?: boolean } };

export async function setBidDetailsAction(quoteId: string, raw: unknown): Promise<BidDetailsResult> {
  let moved: number[] | undefined;
  // #368: a re-price stamped at or after this moment was made by this call's revise.
  const startedAt = Date.now();
  const res = await mutate(
    quoteId,
    async (_uid, name) => {
      const r = await setBidDetails(quoteId, raw, name);
      if (r.ok && r.backToDraft?.length) {
        moved = r.backToDraft;
        return { ok: true, note: addendumDraftNote(r.backToDraft) };
      }
      return r;
    },
    "if-awarded"
  );
  if (!res.ok || !moved) return res;
  try {
    const user = await requireUser();
    const q = await getQuote(quoteId);
    const repriced = (q?.repricedOnRevise?.at ?? 0) >= startedAt;
    return q ? { ...res, sync: { status: q.status, next: await quoteNextStepFor(q, user), ...(repriced ? { repriced: true } : {}) } } : res;
  } catch (e) {
    console.error("[bid-details] next-step refresh failed", e);
    return res;
  }
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
