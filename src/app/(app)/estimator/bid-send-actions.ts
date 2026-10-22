"use server";

import { revalidatePath } from "next/cache";
import { displayQuoteNumber } from "@/lib/estimate-number";
import { bidderEmailDefaults } from "@/lib/estimate-email/compose";
import { requestWhere } from "@/lib/estimate-email/request-where";
import { senderMailbox } from "@/lib/estimate-email/sender-mailbox";
import { liveBidderEmailDeps, SEND_COPY, sendBidderEmail, type BidderSendResult } from "@/lib/estimate-email/send-server";
import { loadBidPanel, viewerOf } from "@/lib/parties/bid-panel-server";
import type { BidPanelVM } from "@/lib/parties/bid-vm";
import type { QuoteNextStepView } from "@/lib/quote-next-step";
import { quoteNextStepFor } from "@/lib/quote-next-step-server";
import { pdfKindForQuoteType } from "@/lib/quote-pdf/state";
import { bidderLinkPath, shareSecret } from "@/lib/quote-share/links";
import { ONLINE_COPY } from "@/lib/quote-share/view";
import { requireUser, type SessionUser } from "@/lib/session";
import { get as getQuote, type QuoteStatus } from "@/lib/stores/quotes";
import { signatureFor } from "@/lib/stores/signatures";
import { can } from "@/lib/team";
import { boxSaleOf } from "@/lib/estimate-box-sale/rules";
import { getUser } from "@/lib/users";

/**
 * #348 2b-ii — the Bidders card's email actions. Thin: session + permission + the request origin here; the ordered
 * work is `sendBidderEmail`. One bidder per call (the client walks "Send to all"), under the Estimator page's
 * maxDuration (120 s).
 */
export type BidderSendActionResult = BidderSendResult & { panel?: BidPanelVM; status?: QuoteStatus; next?: QuoteNextStepView | null };

const str = (v: unknown) => (typeof v === "string" ? v : "");

/** The quote's fresh status + next-step view (the same shape the estimate send returns), never throwing. */
async function freshView(quoteId: string, user: SessionUser): Promise<{ status?: QuoteStatus; next: QuoteNextStepView | null }> {
  try {
    const q = quoteId ? await getQuote(quoteId) : null;
    return q ? { status: q.status, next: await quoteNextStepFor(q, user) } : { next: null };
  } catch (e) {
    console.error("[bidder-send] next-step refresh failed", e);
    return { next: null };
  }
}

export async function sendToBidderAction(quoteId: string, partyId: string, input: unknown): Promise<BidderSendActionResult> {
  const user = await requireUser();
  const pid = String(partyId || "");
  if (!can("send", user.roles) && !can("approve", user.roles)) return { ok: false, partyId: pid, scope: "quote", error: SEND_COPY.needsPerm };
  if (!shareSecret()) return { ok: false, partyId: pid, scope: "quote", error: ONLINE_COPY.noSecret };
  const where = await requestWhere();
  if ("error" in where) return { ok: false, partyId: pid, scope: "quote", error: where.error };
  const o = (input && typeof input === "object" && !Array.isArray(input) ? input : {}) as Record<string, unknown>;
  const clean = {
    subject: str(o.subject),
    body: str(o.body),
    asOf: typeof o.asOf === "number" && Number.isFinite(o.asOf) ? o.asOf : undefined,
    retryUnknown: o.retryUnknown === true,
  };
  const id = String(quoteId || "");
  const actor = { id: user.id, name: user.name, roles: user.roles, email: user.email ?? null };
  const r = await sendBidderEmail(liveBidderEmailDeps({ ...where, actor }), actor, id, pid, clean);
  // The estimate may have moved draft → sent, and the row stamps changed: the client gets all of it in one trip.
  revalidatePath("/", "layout");
  const [panel, view] = await Promise.all([loadBidPanel(id, viewerOf(user)).catch(() => null), freshView(id, user)]);
  return { ...r, ...(panel && panel.ok ? { panel: panel.panel } : {}), ...view };
}

export type BidderEmailDefaultsResult =
  | { ok: true; subject: string; body: string; gmailConnected: boolean; fromAddress: string }
  | { ok: false; error: string };

/** The bidder composer's starting subject and body (one body for every bidder; `{link}` is swapped per bidder). */
export async function bidderEmailDefaultsAction(quoteId: string): Promise<BidderEmailDefaultsResult> {
  const user = await requireUser();
  const q = await getQuote(String(quoteId || ""));
  if (!q) return { ok: false, error: SEND_COPY.gone };
  if (pdfKindForQuoteType(q.quoteType) !== "quote") return { ok: false, error: SEND_COPY.notEstimate };
  const [me, signature] = await Promise.all([getUser(user.id), signatureFor(user.name).catch(() => "")]);
  const mailbox = await senderMailbox(user.id, (me?.email || user.email || "").trim());
  return {
    ok: true,
    ...bidderEmailDefaults({ projectName: q.name || "", estimateNumber: displayQuoteNumber(q), senderName: user.name, signature, boxSale: boxSaleOf(q) }),
    ...mailbox,
  };
}

/** Copy a bidder's own link (Client link permission: send). */
export async function bidderLinkAction(quoteId: string, partyId: string): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  const user = await requireUser();
  if (!can("send", user.roles)) return { ok: false, error: ONLINE_COPY.needsSend };
  const r = await bidderLinkPath(String(quoteId || ""), String(partyId || ""), user.name);
  return r.ok ? { ok: true, path: r.path } : { ok: false, error: r.error };
}
