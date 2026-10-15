"use server";

import { revalidatePath } from "next/cache";
import { getDoc } from "@/db/doc-store";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/team";
import { emailsFor } from "@/lib/identity/contacts";
import { bidDueText, bidderStatusText, BID_RESULT_LABEL, canAward as canAwardStatus, canUndoAward, currentRev, needsRev } from "@/lib/parties/bids";
import type { BidCandidateVM, BidderVM, BidPanelVM } from "@/lib/parties/bid-vm";
import { partyVMs } from "@/lib/parties/view-server";
import { addBidder, awardBid, listBidders, markSubmitted, setBidDetails, undoAward, updateBidder } from "@/lib/stores/bids";
import { listFor } from "@/lib/stores/parties";
import { get as getQuote } from "@/lib/stores/quotes";

/** #348 slice 2a — the Bidders card's server actions. Reads need a signed-in user; every mutation needs `create`. */
export type BidPanelResult = { ok: true; panel: BidPanelVM } | { ok: false; error: string };

const DENIED = "You can't change this bid.";
const isId = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 200;

async function loadPanel(quoteId: string, canEdit: boolean): Promise<BidPanelResult> {
  if (!isId(quoteId)) return { ok: false, error: "That estimate wasn't found." };
  const q = await getQuote(quoteId);
  if (!q) return { ok: false, error: "That estimate wasn't found." };
  const rev = currentRev(q);
  const parties = await listBidders(quoteId);
  const vms = await partyVMs(parties);
  const emails = await Promise.all(parties.map(async (p) => (p.contactId ? ((await emailsFor(p.contactId))[0]?.email ?? "") : "")));
  const bidders: BidderVM[] = parties.map((p, i) => ({
    id: p.id,
    role: p.role as "gc" | "ec",
    companyId: p.companyId,
    companyName: vms[i].companyName,
    contactName: vms[i].contactName,
    contactEmail: emails[i],
    result: p.bid.result,
    resultLabel: BID_RESULT_LABEL[p.bid.result],
    submitVia: p.bid.submitVia,
    bidSiteUrl: p.bid.bidSiteUrl ?? "",
    gcBidNo: p.bid.gcBidNo ?? "",
    confirmation: p.bid.confirmation ?? "",
    statusText: bidderStatusText(p.bid, rev),
    needsRev: needsRev(p.bid, rev),
  }));
  // Candidates: the lead's GC / EC parties that aren't already bidders here.
  let candidates: BidCandidateVM[] = [];
  if (q.leadId) {
    const have = new Set(parties.map((p) => `${p.role}:${p.companyId}`));
    const lead = (await listFor("lead", q.leadId)).filter((p) => (p.role === "gc" || p.role === "ec") && !have.has(`${p.role}:${p.companyId}`));
    const lvms = await partyVMs(lead);
    candidates = lead.map((p, i) => ({ companyId: p.companyId, companyName: lvms[i].companyName, contactId: p.contactId, role: p.role as "gc" | "ec" }));
  }
  const awardedPartyId = q.bid?.awardedPartyId ?? null;
  const dueAt = q.bid?.dueAt ?? null;
  return {
    ok: true,
    panel: {
      quoteId,
      status: q.status,
      ownerName: q.customer || "",
      rev,
      dueAt,
      dueText: dueAt ? bidDueText(dueAt) : "",
      addenda: q.bid?.addenda ?? [],
      awardedPartyId,
      bidders,
      candidates,
      canEdit,
      canAward: canAwardStatus(q.status) && !awardedPartyId && bidders.some((b) => b.result === "pending"),
      canUndo: !!awardedPartyId && canUndoAward(q.status),
    },
  };
}

export async function bidPanelAction(quoteId: string): Promise<BidPanelResult> {
  const user = await requireUser();
  return loadPanel(quoteId, can("create", user.roles));
}

/** Gate, run the store call, then return the fresh panel (or the store's error). */
async function mutate(quoteId: unknown, run: (userId: string) => Promise<{ ok: boolean; error?: string }>): Promise<BidPanelResult> {
  const user = await requireUser();
  if (!can("create", user.roles)) return { ok: false, error: DENIED };
  if (!isId(quoteId)) return { ok: false, error: "That estimate wasn't found." };
  const r = await run(user.id);
  if (!r.ok) return { ok: false, error: r.error || "That didn't save." };
  revalidatePath("/", "layout");
  return loadPanel(quoteId, true);
}

/** The quote a bidder belongs to (a bidder id is a party id; its record id is the quote). */
async function quoteOfBidder(partyId: unknown): Promise<string | null> {
  if (!isId(partyId)) return null;
  const p = await getDoc<{ id: string; recordType: string; recordId: string }>("record_parties", partyId);
  return p && p.recordType === "quote" ? p.recordId : null;
}

export async function setBidDetailsAction(quoteId: string, raw: unknown): Promise<BidPanelResult> {
  return mutate(quoteId, () => setBidDetails(quoteId, raw));
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
    );
  });
}

export async function updateBidderAction(partyId: string, raw: unknown): Promise<BidPanelResult> {
  const qid = await quoteOfBidder(partyId);
  return mutate(qid, () => updateBidder(partyId, raw));
}

export async function markSubmittedAction(partyId: string, confirmation: string): Promise<BidPanelResult> {
  const qid = await quoteOfBidder(partyId);
  return mutate(qid, (uid) => markSubmitted(partyId, uid, typeof confirmation === "string" ? confirmation : ""));
}

export async function awardBidAction(quoteId: string, partyId: string): Promise<BidPanelResult> {
  return mutate(quoteId, () => (isId(partyId) ? awardBid(quoteId, partyId) : Promise.resolve({ ok: false, error: "That bidder wasn't found." })));
}

export async function undoAwardAction(quoteId: string): Promise<BidPanelResult> {
  return mutate(quoteId, () => undoAward(quoteId));
}
