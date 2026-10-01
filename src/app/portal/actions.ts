"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { portalSession, PORTAL_COOKIE } from "@/lib/portal";
import { get as getCustomer } from "@/lib/stores/customers";
import { create as createLead } from "@/lib/stores/leads";
import {
  acceptPortal,
  copyToCart,
  refreshPortalQuote as refreshPortalQuoteFor,
  renamePortalQuote as renamePortalQuoteFor,
} from "@/lib/portal-quotes";
import { resolvePortalViewer } from "@/lib/portal-viewer";
import { portalRedeemPerk } from "@/lib/stores/reward-perks";

/**
 * Portal mutations (IDEAS #47). SECURITY: these run for ANONYMOUS visitors —
 * every action authenticates via portalSession() (the grant cookie) and
 * derives its customerId from the session only. Nothing here touches
 * requireUser()/team endpoints, and no client-posted customer id is trusted.
 */

/* Customer-facing service types → the lead's `interest` field. Mirrored in
 * request-form.tsx ("use server" modules may only export async functions,
 * so the list is duplicated rather than exported). */
const SERVICES = [
  "Flame testing",
  "Rigging inspection",
  "Repair",
  "New system / renovation",
  "Something else",
];
const URGENCIES = ["Standard", "Urgent", "Emergency — out of service"];

export async function submitPortalRequest(formData: FormData): Promise<void> {
  const session = await portalSession();
  if (!session) redirect("/portal?denied=1");

  const cust = await getCustomer(session.customerId);
  if (!cust) redirect("/portal?denied=1");

  const serviceRaw = String(formData.get("service") || "");
  const service = SERVICES.includes(serviceRaw) ? serviceRaw : "Something else";
  const urgencyRaw = String(formData.get("urgency") || "");
  const urgency = URGENCIES.includes(urgencyRaw) ? urgencyRaw : "Standard";
  const venueId = String(formData.get("venue") || "");
  const venue = (cust.locations || []).find((l) => l.id === venueId) || null;
  const phone = String(formData.get("phone") || "").trim().slice(0, 40);
  const details = String(formData.get("details") || "").trim().slice(0, 4000);
  if (!details) redirect("/portal/request?err=details");

  const venueLabel = venue ? venue.label || "Venue" : "Venue TBD";
  const message =
    "[Portal request — " +
    session.name +
    "] " +
    venueLabel +
    " · " +
    service +
    " · " +
    urgency +
    "\n\n" +
    details;

  try {
    await createLead(
      {
        org: cust.name,
        contact: session.name,
        email: session.email,
        phone,
        city: venue?.city || "",
        state: venue?.state || "WI",
        source: "existing",
        owner: "", // unassigned → enters the SLA response queue
        interest: service,
        message,
        customerId: session.customerId,
      },
      session.name
    );
  } catch (error) {
    console.error("submitPortalRequest: lead mint failed", error);
    redirect("/portal/request?err=send");
  }

  revalidatePath("/", "layout");
  redirect("/portal?sent=1");
}

/**
 * Quote acceptance (IDEAS #47 P3 / #245 Task 13, spec §4.4): the customer
 * names how they'll purchase, an optional note (never a card number) and an
 * optional PO file — a human still confirms by marking the quote Won, which
 * runs the normal accepted-quote spawn machinery. Every tenant/eligibility
 * check (this session's customer, sent, not already accepted, a firm quote
 * still in date, not mid-review) lives in `acceptPortal` — the one seam the
 * dialog and any other caller both go through.
 */
export async function acceptPortalQuote(input: {
  quoteId: string;
  purchaseMethod: string;
  notes: string;
  poDocumentId: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await portalSession().catch(() => null);
  const r = await acceptPortal(session, input);
  if (r.ok) revalidatePath("/", "layout");
  return r;
}

/** Refresh pricing on an expired firm portal quote (#245 Task 13, spec §4.5). */
export async function refreshPortalQuote(quoteId: string): Promise<{ ok: true; mode: "firm" | "review" } | { ok: false; error: string }> {
  const session = await portalSession().catch(() => null);
  const r = await refreshPortalQuoteFor(session, quoteId);
  if (r.ok) revalidatePath("/", "layout");
  return r;
}

/** Rename a quote the customer built (#288, spec §1.4). Every check — the
 *  session, tenant scoping, customer-built, not accepted, the name itself,
 *  the rate limit — lives in `renamePortalQuote`. */
export async function renamePortalQuoteAction(quoteId: string, name: string): Promise<{ ok: true; name: string } | { ok: false; error: string }> {
  const session = await portalSession().catch(() => null);
  const r = await renamePortalQuoteFor(session, String(quoteId ?? ""), String(name ?? ""));
  if (r.ok) revalidatePath("/", "layout");
  return r;
}

/**
 * Copy to new quote (#245 Task 13, spec §4.6) — appends the quote's lines to
 * the grant's cart, then lands on the cart page to review/Generate. A plain
 * `<form action>` (no client JS needed), so a refusal redirects with a query
 * param instead of returning a value — matches `submitPortalRequest` above.
 */
export async function copyQuoteToCart(quoteId: string): Promise<void> {
  const session = await portalSession().catch(() => null);
  const r = await copyToCart(session, quoteId);
  if (!r.ok) {
    console.error("copyQuoteToCart refused", quoteId, r.error);
    redirect("/portal?copyerr=1");
  }
  revalidatePath("/portal/catalog/quote");
  revalidatePath("/portal/catalog");
  redirect("/portal/catalog/quote");
}

/**
 * #282 perks+points — the portal Rewards card's Redeem. The company is the
 * grant's own (resolvePortalViewer → portalSession), never a client value:
 * `companyId` is only what the card was rendered for, and a mismatch is
 * refused (a stale page after switching grants). A team preview resolves as
 * `preview` and is refused. The store re-checks the program, the perk, its
 * level / once-yearly window and the points under the company's lock, and
 * refuses if what the button showed ("Free" / "N points") is no longer true.
 */
export async function redeemPortalPerk(input: {
  perkId: string;
  companyId: string;
  mode: "free" | "points";
  pointCost: number | null;
  previewCid?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const viewer = await resolvePortalViewer(String(input.previewCid || "")).catch(() => ({ session: null, preview: false }));
  const r = await portalRedeemPerk(viewer, {
    perkId: String(input.perkId || ""),
    companyId: String(input.companyId || ""),
    expect: { mode: input.mode === "points" ? "points" : "free", pointCost: input.pointCost == null ? null : Number(input.pointCost) },
  });
  if (!r.ok) return r;
  // The card re-renders with the new balance; the staff bell gains "Perks to fulfil".
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function portalSignOut(): Promise<void> {
  const jar = await cookies();
  jar.delete(PORTAL_COOKIE);
  redirect("/portal");
}
