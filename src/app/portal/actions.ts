"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { portalSession, PORTAL_COOKIE } from "@/lib/portal";
import { get as getCustomer } from "@/lib/stores/customers";
import { create as createLead } from "@/lib/stores/leads";

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

  revalidatePath("/", "layout");
  redirect("/portal?sent=1");
}

export async function portalSignOut(): Promise<void> {
  const jar = await cookies();
  jar.delete(PORTAL_COOKIE);
  redirect("/portal");
}
