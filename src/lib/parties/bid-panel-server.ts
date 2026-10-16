import { displayQuoteNumber } from "@/lib/estimate-number";
import { bidderEmailDefaults } from "@/lib/estimate-email/compose";
import { shareEligibility } from "@/lib/quote-share/view";
import { addendaAfterLatestSend, addendaSinceRow, bidderEmailNeed, bidderEmailUsable, bidderSendPlan, bidderSubject } from "@/lib/parties/bid-send";
import { bidDueText, bidderOpensText, bidderOpensTitle, bidderStatusText, BID_RESULT_LABEL, canAward as canAwardStatus, canUndoAward, currentRev, needsRev } from "@/lib/parties/bids";
import type { BidCandidateVM, BidderVM, BidPanelResult } from "@/lib/parties/bid-vm";
import { bidderRecipient } from "@/lib/parties/addressee-server";
import { portalQuoteHasBidders } from "@/lib/parties/portal-bid-server";
import { partyVMs } from "@/lib/parties/view-server";
import { listBidders } from "@/lib/stores/bids";
import { listFor } from "@/lib/stores/parties";
import { get as getQuote } from "@/lib/stores/quotes";
import { can } from "@/lib/team";

/** #348 2b-ii — the Bidders card's one read: rows, the send plan and the per-viewer permissions. Server-only. */
export type BidViewer = { canEdit: boolean; canSend: boolean; canLink: boolean };

/** What this user may see on the panel: edits (create), emailing (send | approve), copying a link (send). */
export const viewerOf = (user: { roles: string[] }): BidViewer => ({
  canEdit: can("create", user.roles),
  canSend: can("send", user.roles) || can("approve", user.roles),
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
  const sendableStatus = q.status === "draft" || q.status === "sent";
  const estimateName = (q.name || "").trim() || displayQuoteNumber(q);
  const baseSubject = bidderEmailDefaults({ projectName: q.name || "", estimateNumber: displayQuoteNumber(q), senderName: "" }).subject;
  const rows = parties.map((p, i) => ({ id: p.id, bid: p.bid, email: recipients[i].email }));
  const bidders: BidderVM[] = parties.map((p, i) => {
    const need = viewer.canSend ? bidderEmailNeed(q, rows[i]) : null;
    const since = addendaSinceRow(q, p.bid);
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
      sendLabel: need === "send" ? "Send" : need === "revision" ? "Send revision" : need === "retry" ? "Retry" : "",
      failedText: p.bid.failed?.error ?? "",
      failedUnknown: !!p.bid.failed?.unknown,
      noEmail: sendableStatus && p.bid.result === "pending" && p.bid.submitVia === "email" && !bidderEmailUsable(recipients[i].email),
      opensText: bidderOpensText(p.bid.opens),
      opensTitle: bidderOpensTitle(p.bid.opens),
      revisedSubject: since.length > 0 ? bidderSubject(baseSubject.length > 0 ? baseSubject : estimateName, estimateName, since) : "",
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
  // #348 follow-up: the staff label only. A failed read shows no label (and is logged); the portal's own check — which
  // is what keeps prices from the owner — runs on every portal read and is unaffected.
  let scopeOnly = false;
  try {
    scopeOnly = await portalQuoteHasBidders(q);
  } catch (e) {
    console.error(`loadBidPanel(${quoteId}): the Scope-only check failed — showing no label`, e);
  }
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
      canSend: viewer.canSend,
      canCopyLink: viewer.canLink && shareEligibility(q) === "ok",
      plan: viewer.canSend ? bidderSendPlan(q, rows) : { ids: [], label: null, noEmail: 0 },
      addendaAfterSend: q.status === "sent" ? addendaAfterLatestSend(q) : [],
      scopeOnly,
    },
  };
}
