import { shareEligibility } from "@/lib/quote-share/view";
import { bidDueText, bidderOpensText, bidderOpensTitle, bidderStatusText, BID_RESULT_LABEL, canAward as canAwardStatus, canUndoAward, currentRev, needsRev } from "@/lib/parties/bids";
import type { BidCandidateVM, BidderVM, BidPanelResult } from "@/lib/parties/bid-vm";
import { bidderRecipient } from "@/lib/parties/addressee-server";
import { partyVMs } from "@/lib/parties/view-server";
import { listBidders } from "@/lib/stores/bids";
import { listFor } from "@/lib/stores/parties";
import { get as getQuote } from "@/lib/stores/quotes";
import { can } from "@/lib/team";

/** The Bidders card's one read: rows and the per-viewer permissions. Server-only. */
export type BidViewer = { canEdit: boolean; canLink: boolean };

/** What this user may see on the panel: edits (create), copying a link (send). */
export const viewerOf = (user: { roles: string[] }): BidViewer => ({
  canEdit: can("create", user.roles),
  canLink: can("send", user.roles),
});

const isId = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 200;
const NOT_FOUND = "That estimate wasn't found.";

export async function loadBidPanel(quoteId: string, viewer: BidViewer): Promise<BidPanelResult> {
  if (!isId(quoteId)) return { ok: false, error: NOT_FOUND };
  const q = await getQuote(quoteId);
  if (!q) return { ok: false, error: NOT_FOUND };
  const rev = currentRev(q);
  const parties = await listBidders(quoteId);
  const vms = await partyVMs(parties);
  const recipients = await Promise.all(parties.map((p) => bidderRecipient(p)));
  const bidders: BidderVM[] = parties.map((p, i) => {
    return {
      id: p.id,
      role: p.role as "gc" | "ec",
      companyId: p.companyId,
      companyName: vms[i].companyName,
      contactName: vms[i].contactName,
      contactEmail: recipients[i].email,
      result: p.bid.result,
      resultLabel: BID_RESULT_LABEL[p.bid.result],
      submitVia: p.bid.submitVia,
      bidSiteUrl: /^https?:\/\//i.test(p.bid.bidSiteUrl ?? "") ? (p.bid.bidSiteUrl as string) : "",
      gcBidNo: p.bid.gcBidNo ?? "",
      confirmation: p.bid.confirmation ?? "",
      statusText: bidderStatusText(p.bid, rev),
      needsRev: needsRev(p.bid, rev),
      opensText: bidderOpensText(p.bid.opens),
      opensTitle: bidderOpensTitle(p.bid.opens),
      pdfHref: `/api/quotes/${encodeURIComponent(quoteId)}/bidder-pdf/${encodeURIComponent(p.id)}?download=1`,
    };
  });
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
      canEdit: viewer.canEdit,
      canAward: canAwardStatus(q.status) && !awardedPartyId && bidders.some((b) => b.result === "pending"),
      canUndo: !!awardedPartyId && canUndoAward(q.status),
      canCopyLink: viewer.canLink && shareEligibility(q) === "ok",
    },
  };
}
