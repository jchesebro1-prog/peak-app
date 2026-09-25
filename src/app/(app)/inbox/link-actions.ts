"use server";

/**
 * #96 §2 — server actions for the link sidebar: link a thread to a
 * customer, claim a domain manually, dismiss a suggestion, remember a
 * sender's address (contact + learned domain), and the three quick-add
 * flows (customer / contact / venue). Label sync to Gmail is Task 10 —
 * nothing here talks to Gmail.
 */
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { patchDoc } from "@/db/doc-store";
import { get as getThread, resolveCustomerId, visibleTo } from "@/lib/stores/comms";
import type { CommThread } from "@/lib/stores/comms";
import { get as getCustomer, contactsForId } from "@/lib/stores/customers";
import { saveCustomerAction } from "@/app/(app)/companies/actions";
import { toContactInput, toLocationInput } from "@/app/(app)/companies/lib";
import type { ContactInput, LocationInput } from "@/app/(app)/companies/types";
import { savePersonAction } from "@/app/(app)/people/actions";
import type { SavePersonInput } from "@/app/(app)/people/types";
import { claimDomain, releaseDomain } from "@/lib/gmail/domains";
import { domainOf, isPublicDomain } from "@/lib/gmail/config";
import {
  linkThread,
  rememberAddress,
  resweepThreads,
  setIdentityMessage,
  setThreadSite,
} from "@/lib/gmail/linking";
import { identityAddressFor, resolveAddressFor } from "@/lib/inbox-identity";

type R = { ok: true } | { ok: false; error: string };
const revalidate = () => revalidatePath("/", "layout");

/** Link sidebar's Link / pick — links a thread to an existing customer,
 *  optionally remembering the sender's address and/or claiming their
 *  domain. */
export async function linkThreadToCustomerAction(
  threadId: string,
  customerId: string,
  opts: {
    remember: boolean;
    contactId?: string | null;
    /** the sidebar's "on contact" pick — an existing contact's display
     *  name on `customerId`; rememberAddress reuses that contact by name
     *  (or mints one with this name when it no longer exists) */
    contactName?: string;
    claimDomain?: boolean;
  }
): Promise<R> {
  const me = await requireUser();
  const t = await getThread(threadId);
  if (!t) return { ok: false, error: "Thread not found." };
  if (!(await getCustomer(customerId))) return { ok: false, error: "Customer not found." };

  // #125 — the picked identity message's address, else the thread contact.
  const sender = identityAddressFor(t);
  const senderEmail = resolveAddressFor(t);
  const senderName = sender?.name || t.contactName;
  let contactId = opts.contactId ?? null;
  if (opts.remember && senderEmail) {
    const nameForContact = (opts.contactName || "").trim() || senderName;
    contactId = await rememberAddress(customerId, senderEmail, nameForContact, contactId, {
      id: me.id,
      name: me.name,
    });
  }
  if (opts.claimDomain && senderEmail) {
    const d = domainOf(senderEmail);
    if (d && !isPublicDomain(d)) {
      await claimDomain(d, customerId, "manual", me.name);
      await resweepThreads({ domain: d });
    }
  }
  await linkThread(threadId, customerId, contactId);
  revalidate();
  return { ok: true };
}

/** Link sidebar's "claim this domain" — a manual claim, single owner. */
export async function claimDomainAction(domain: string, customerId: string): Promise<R> {
  const me = await requireUser();
  const d = (domain || "").trim().toLowerCase();
  if (!d || isPublicDomain(d)) return { ok: false, error: "That domain can't identify a customer." };
  if (!(await getCustomer(customerId))) return { ok: false, error: "Customer not found." };
  await claimDomain(d, customerId, "manual", me.name);
  await resweepThreads({ domain: d });
  revalidate();
  return { ok: true };
}

/** Linked card's "Stop" on "Emails from @domain link here automatically"
 *  — drops this customer's claim on the domain and re-sweeps so threads
 *  that were only suggested by it fall back to unknown. Threads already
 *  linked stay linked (re-sweep never downgrades). */
export async function releaseDomainAction(domain: string, customerId: string): Promise<R> {
  await requireUser();
  const d = (domain || "").trim().toLowerCase();
  if (!d || isPublicDomain(d)) return { ok: false, error: "That domain can't identify a customer." };
  if (!customerId) return { ok: false, error: "Customer not found." };
  await releaseDomain(d, customerId);
  await resweepThreads({ domain: d });
  revalidate();
  return { ok: true };
}

/** Link sidebar's "not them" on a suggested match. */
export async function dismissSuggestionAction(threadId: string): Promise<R> {
  await requireUser();
  if (!(await getThread(threadId))) return { ok: false, error: "Thread not found." };
  await patchDoc<CommThread>("comms", threadId, (d) => {
    d.suggestionDismissed = true;
    if (d.resolution === "suggested") d.resolution = "unknown";
  });
  revalidate();
  return { ok: true };
}

/** Link sidebar's "new customer" quick-add — creates the customer, links
 *  the thread (always, regardless of `remember`), and optionally remembers
 *  the sender's address on the new customer. */
export async function quickAddCustomerAction(input: {
  name: string;
  type: string;
  senderName: string;
  senderEmail: string;
  remember: boolean;
  threadId: string;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const me = await requireUser();
  if (!(await getThread(input.threadId))) return { ok: false, error: "Thread not found." };
  const name = (input.name || "").trim();
  if (!name) return { ok: false, error: "Enter a name for the new customer." };

  const res = await saveCustomerAction({ name, type: input.type || "", locations: [], contacts: [] });
  if (!res.ok) return { ok: false, error: "Couldn't create that customer." };

  let contactId: string | null = null;
  if (input.remember && input.senderEmail) {
    contactId = await rememberAddress(res.id, input.senderEmail, input.senderName, null, {
      id: me.id,
      name: me.name,
    });
  }
  await linkThread(input.threadId, res.id, contactId);
  revalidate();
  return { ok: true, id: res.id };
}

/** Link sidebar's "new contact" quick-add. */
export async function quickAddContactAction(input: {
  customerId: string;
  name: string;
  role: string;
  email: string;
  phone: string;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  await requireUser();
  const nm = (input.name || "").trim();
  if (!nm) return { ok: false, error: "Enter a name." };
  const sp = nm.lastIndexOf(" ");
  const email = (input.email || "").trim();
  const phone = (input.phone || "").trim();
  const person: SavePersonInput = {
    firstName: sp > 0 ? nm.slice(0, sp) : nm,
    lastName: sp > 0 ? nm.slice(sp + 1) : "",
    title: input.role || "",
    homeCompanyId: input.customerId,
    status: "active",
    pricingTier: null,
    isPrimary: ((await contactsForId(input.customerId)) || []).length === 0,
    emails: email ? [{ value: email, label: "work", isPrimary: true }] : [],
    phones: phone ? [{ value: phone, label: "work", isPrimary: true }] : [],
  };
  const res = await savePersonAction(person);
  if (!res.ok) return res;
  if (email) await resweepThreads({ email });
  revalidate();
  return res;
}

/** Link sidebar's "new venue" quick-add — appends a location to the
 *  customer through the SAME path the Companies screen and guided quote
 *  intake use (saveCustomerAction), never the legacy name-keyed
 *  setLocations blob. Returns the new site's directory id; with `threadId`
 *  (the Venue card's "+ New venue", #124) it also links that venue to the
 *  thread, adopting the customer first if the thread had none stored. */
export async function quickAddVenueAction(input: {
  customerId: string;
  label: string;
  city: string;
  state: string;
  threadId?: string;
}): Promise<{ ok: true; siteId: string | null } | { ok: false; error: string }> {
  const me = await requireUser();
  const existing = await getCustomer(input.customerId);
  if (!existing) return { ok: false, error: "Customer not found." };
  const thread = input.threadId ? await getThread(input.threadId) : null;
  if (input.threadId && (!thread || !visibleTo(thread, me.name)))
    return { ok: false, error: "Thread not found." };

  const beforeIds = new Set((existing.locations || []).map((l) => l.id).filter(Boolean));
  const locations: LocationInput[] = (existing.locations || []).map(toLocationInput);
  locations.push({
    label: (input.label || "").trim() || "Venue",
    // First location on the record → primary. Never demotes one that's
    // already there.
    primary: locations.length === 0,
    address: "",
    city: (input.city || "").trim(),
    state: (input.state || "").trim(),
    lat: null,
    lng: null,
    venueKind: "proscenium",
    travelMiles: null,
    travelMin: null,
  });
  const contacts: ContactInput[] = (existing.contacts || []).map(toContactInput);

  const res = await saveCustomerAction({
    id: existing.id,
    name: existing.name,
    type: existing.type || "",
    pricingTier: existing.pricingTier ?? null,
    locations,
    contacts,
  });
  if (!res.ok) return { ok: false, error: "Couldn't save that venue." };

  const after = await getCustomer(existing.id);
  const added = (after?.locations || []).find((l) => !!l.id && !beforeIds.has(l.id));
  const siteId = added?.id || null;
  if (thread && siteId) {
    if (!thread.customerId) await linkThread(thread.id, existing.id, thread.resolvedContactId ?? null);
    await setThreadSite(thread.id, siteId);
  }
  revalidate();
  return { ok: true, siteId };
}

/** #124 — Venue card: stamp (or clear) the thread's venue. The venue must
 *  be one of the linked customer's own locations; a thread that only
 *  resolved read-time (needsAdopt) adopts the customer first so siteId
 *  never exists without a stored customerId. */
export async function setThreadSiteAction(threadId: string, siteId: string | null): Promise<R> {
  const me = await requireUser();
  const t = await getThread(threadId);
  if (!t || !visibleTo(t, me.name)) return { ok: false, error: "Thread not found." };
  const customerId = t.customerId || (await resolveCustomerId(t));
  if (!customerId) return { ok: false, error: "Link a customer first." };
  const clean = (siteId || "").trim() || null;
  if (clean) {
    const c = await getCustomer(customerId);
    if (!(c?.locations || []).some((l) => l.id === clean))
      return { ok: false, error: "That venue isn't on this customer." };
  }
  if (!t.customerId) await linkThread(threadId, customerId, t.resolvedContactId ?? null);
  await setThreadSite(threadId, clean);
  revalidate();
  return { ok: true };
}

/** #125 — "Linking from" picker: which message's addresses drive resolution
 *  and quick-add. null = the thread contact. Re-resolves this one thread. */
export async function setIdentityMessageAction(
  threadId: string,
  messageId: string | null
): Promise<R> {
  const me = await requireUser();
  const t = await getThread(threadId);
  if (!t || !visibleTo(t, me.name)) return { ok: false, error: "Thread not found." };
  const id = (messageId || "").trim() || null;
  if (id && !(t.messages || []).some((m) => m.id === id))
    return { ok: false, error: "That message isn't on this thread." };
  await setIdentityMessage(threadId, id);
  revalidate();
  return { ok: true };
}
