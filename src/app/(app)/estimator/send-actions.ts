"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { displayQuoteNumber } from "@/lib/estimate-number";
import { estimateEmailDefaults, type EstimateEmailDefaults } from "@/lib/estimate-email/compose";
import {
  liveEstimateEmailDeps, openEstimateInInbox, SEND_COPY, sendEstimateEmail,
  type EstimateEmailInput, type OpenInInboxResult, type SendEstimateResult,
} from "@/lib/estimate-email/send-server";
import { leadEstimator } from "@/lib/estimate-output/responses";
import { gmailEnabled, personalKey } from "@/lib/gmail/config";
import { getConnectionInfo } from "@/lib/gmail/connections";
import { quoteNextStepFor } from "@/lib/quote-next-step-server";
import type { QuoteNextStepView } from "@/lib/quote-next-step";
import { printOriginFor } from "@/lib/quote-pdf/origin";
import { pdfKindForQuoteType } from "@/lib/quote-pdf/state";
import { shareSecret } from "@/lib/quote-share/links";
import { ONLINE_COPY } from "@/lib/quote-share/view";
import { requireUser, type SessionUser } from "@/lib/session";
import { contactByName } from "@/lib/stores/customers";
import { get as getQuote, type QuoteStatus } from "@/lib/stores/quotes";
import { can } from "@/lib/team";
import { activeUsers, getUser } from "@/lib/users";

/**
 * Estimator Phase 3 (spec §10.1–10.3) — the Send & track step's server
 * actions. Thin: session + permission + the request origin here, the ordered
 * work in src/lib/estimate-email/send-server.ts. Runs under the Estimator
 * page's maxDuration (120 s) — one cover render (≤ 45 s) fits.
 */

/** Every send/inbox result also carries the quote's fresh status and
 *  next-step view whenever the quote may have changed, so the client can
 *  applySync like the next-step control does. */
export type SendEstimateActionResult = SendEstimateResult & { status?: QuoteStatus; next?: QuoteNextStepView | null };
export type OpenInInboxActionResult = OpenInInboxResult & { status?: QuoteStatus; next?: QuoteNextStepView | null };

const canSendOrApprove = (u: SessionUser) => can("send", u.roles) || can("approve", u.roles);

function cleanInput(raw: unknown): EstimateEmailInput {
  const o = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  return {
    to: str(o.to),
    cc: str(o.cc),
    subject: str(o.subject),
    body: str(o.body),
    attachEstimate: o.attachEstimate === true,
    attachCover: o.attachCover === true,
    followUpDays: typeof o.followUpDays === "number" ? o.followUpDays : Number.NaN,
    asOf: typeof o.asOf === "number" && Number.isFinite(o.asOf) ? o.asOf : undefined,
  };
}

/** The request's print origin (the cover's link line uses it too); refused before anything is touched. */
async function requestWhere(): Promise<{ origin: string; host: string | null; proto: string | null } | { error: string }> {
  const h = await headers();
  const host = h.get("x-forwarded-host") || h.get("host");
  const proto = h.get("x-forwarded-proto");
  const where = printOriginFor(process.env, host, proto);
  return "error" in where ? { error: where.error } : { origin: where.origin, host, proto };
}

async function freshView(quoteId: string, user: SessionUser): Promise<{ status?: QuoteStatus; next: QuoteNextStepView | null }> {
  revalidatePath("/", "layout");
  try {
    const q = quoteId ? await getQuote(quoteId) : null;
    return q ? { status: q.status, next: await quoteNextStepFor(q, user) } : { next: null };
  } catch (e) {
    // The send's own result must still reach the client.
    console.error("[estimate-email] next-step refresh failed", e);
    return { next: null };
  }
}

export async function sendEstimateEmailAction(quoteId: string, input: unknown): Promise<SendEstimateActionResult> {
  const user = await requireUser();
  if (!canSendOrApprove(user)) return { ok: false, error: SEND_COPY.needsPerm };
  if (!shareSecret()) return { ok: false, error: ONLINE_COPY.noSecret };
  const where = await requestWhere();
  if ("error" in where) return { ok: false, error: where.error };
  const id = String(quoteId || "");
  const actor = { id: user.id, name: user.name, roles: user.roles };
  const r = await sendEstimateEmail(liveEstimateEmailDeps({ ...where, actor }), actor, id, cleanInput(input));
  if (!r.ok && !r.markedSent) return r;
  return { ...r, ...(await freshView(id, user)) };
}

export async function openEstimateInInboxAction(quoteId: string, input: unknown): Promise<OpenInInboxActionResult> {
  const user = await requireUser();
  if (!canSendOrApprove(user)) return { ok: false, error: SEND_COPY.needsPerm };
  if (!shareSecret()) return { ok: false, error: ONLINE_COPY.noSecret };
  const where = await requestWhere();
  if ("error" in where) return { ok: false, error: where.error };
  const id = String(quoteId || "");
  const actor = { id: user.id, name: user.name, roles: user.roles };
  const r = await openEstimateInInbox(liveEstimateEmailDeps({ ...where, actor }), actor, id, cleanInput(input));
  if (!r.ok && !r.markedSent) return r;
  return { ...r, ...(await freshView(id, user)) };
}

export type EstimateEmailDefaultsResult =
  | ({ ok: true; gmailConnected: boolean; fromAddress: string } & EstimateEmailDefaults)
  | { ok: false; error: string };

/** §10.2 — the composer's starting values, computed server-side. */
export async function estimateEmailDefaultsAction(quoteId: string): Promise<EstimateEmailDefaultsResult> {
  const user = await requireUser();
  const q = await getQuote(String(quoteId || ""));
  if (!q) return { ok: false, error: SEND_COPY.gone };
  if (pdfKindForQuoteType(q.quoteType) !== "quote") return { ok: false, error: SEND_COPY.notEstimate };
  const [contact, roster, me] = await Promise.all([
    q.customerId && q.contactName ? contactByName(q.customerId, q.contactName).catch(() => null) : Promise.resolve(null),
    activeUsers(),
    getUser(user.id),
  ]);
  const lead = leadEstimator(q.owner, q.preparedBy, roster);
  const senderEmail = (me?.email || user.email || "").trim();
  let fromAddress = senderEmail;
  let gmailConnected = false;
  try {
    const info = gmailEnabled() ? await getConnectionInfo(personalKey(user.id)) : null;
    if (info) {
      gmailConnected = true;
      fromAddress = info.address || senderEmail;
    }
  } catch (e) {
    console.error("[estimate-email] gmail connection lookup failed", e);
  }
  return {
    ok: true,
    ...estimateEmailDefaults({
      projectName: q.name || "",
      estimateNumber: displayQuoteNumber(q),
      contactName: q.contactName || contact?.name || "",
      contactEmail: contact?.email || "",
      senderName: user.name,
      senderEmail,
      leadName: lead?.name || "",
      // The sender is never Cc'd on their own email, whatever address Gmail sends from.
      leadEmail: lead && lead.id !== user.id ? (lead.email || "").trim() : "",
    }),
    gmailConnected,
    fromAddress,
  };
}
