/**
 * #96 — wires the pure resolver to real data and stamps threads. Backfill and
 * re-sweep live here too (Task 4).
 */
import { getDoc, listDocs, patchDoc } from "@/db/doc-store";
import { contactByEmail, contactsByEmails } from "@/lib/identity/lookup";
import {
  contactsForCompany,
  displayName as contactDisplayName,
  emailsFor,
  emailsForContacts,
  getContact,
  saveContact,
  setEmails,
} from "@/lib/identity/contacts";
import { mintId } from "@/lib/identity/ids";
import { nameFor as customerNameFor } from "@/lib/stores/customers";
import type { CommLink, CommThread } from "@/lib/stores/comms";
import { domainOf, isPublicDomain } from "./config";
import { claimDomain, customersForDomain, customersForDomains } from "./domains";
import { resolveSender, type Resolution } from "./resolve";
import { quoteNameFromSubject } from "@/lib/inbox-links";
import { resolveAddressFor } from "@/lib/inbox-identity";

export async function resolveForThread(email: string): Promise<Resolution> {
  return resolveSender(email, {
    contactByEmail,
    customersByDomain: async (d) => (await customersForDomain(d)).map((r) => r.customerId),
  });
}

/** Mutates `t` in place. Never downgrades an existing customerId. */
export async function applyResolution(t: CommThread, r: Resolution): Promise<void> {
  if (t.customerId) {
    t.resolution = "linked";
    return;
  }
  if (r.kind === "linked" && r.via === "contact") {
    t.customerId = r.customerId;
    t.customer = await customerNameFor(r.customerId);
    t.resolvedContactId = r.contactId ?? null;
    t.resolution = "linked";
    t.suggestedCustomerId = null;
    t.candidates = [];
  } else if (r.kind === "linked" && r.via === "domain") {
    t.resolution = t.suggestionDismissed ? "unknown" : "suggested";
    t.suggestedCustomerId = r.customerId;
    t.candidates = [];
  } else if (r.kind === "ambiguous") {
    t.resolution = "ambiguous";
    t.suggestedCustomerId = null;
    t.candidates = await Promise.all(
      r.candidates.map(async (c) => ({ customerId: c.customerId, name: await customerNameFor(c.customerId) }))
    );
  } else {
    t.resolution = "unknown";
    t.suggestedCustomerId = null;
    t.candidates = [];
  }
}

/** Applies a precomputed `next` resolution onto the fresh doc `d`, unless a
 *  manual link landed between `listDocs` and `patchDoc` — in which case it
 *  declines and leaves `d` untouched. Returns whether it patched. Extracted
 *  from the `resweepThreads` callback so the guard can be unit-tested
 *  directly (the `patchDoc` callback itself is synchronous, so `next` has to
 *  be computed outside it, before the fresh doc `d` is even in hand). */
export function applyResweepPatch(d: CommThread, next: CommThread): boolean {
  // A manual link landed since we listed — keep it.
  if (d.customerId && d.resolution === "linked") return false;
  // Fresh doc has a customer the snapshot didn't — never downgrade.
  if (d.customerId && !next.customerId) return false;
  // #124 — a venue belongs to one customer; a different customer drops it.
  if (d.customerId !== next.customerId) d.siteId = null;
  d.customerId = next.customerId;
  d.customer = next.customer;
  d.resolvedContactId = next.resolvedContactId ?? null;
  d.resolution = next.resolution;
  d.suggestedCustomerId = next.suggestedCustomerId ?? null;
  d.candidates = next.candidates ?? [];
  return true;
}

function matchesFilter(t: CommThread, f?: { email?: string; domain?: string }): boolean {
  if (!f) return true;
  const e = resolveAddressFor(t); // #125 — the picked identity message, else the counterpart
  if (f.email && e !== f.email.toLowerCase()) return false;
  if (f.domain && domainOf(e) !== f.domain.toLowerCase()) return false;
  return true;
}

/** Re-run the resolver over unlinked threads. Idempotent; patches only when
 *  something changes. Resolves in two batched queries (every candidate
 *  address, every candidate domain) rather than two per thread. */
export async function resweepThreads(
  filter?: { email?: string; domain?: string },
  onlyAccountKey?: string
): Promise<number> {
  const started = Date.now();
  const all = await listDocs<CommThread>("comms");
  const candidates = all.filter(
    (t) =>
      !t.deleted &&
      !(t.customerId && t.resolution === "linked") &&
      !(onlyAccountKey && t.gmailAccountKey !== onlyAccountKey) &&
      matchesFilter(t, filter) &&
      !!resolveAddressFor(t)
  );
  if (!candidates.length) return 0;
  const addresses = candidates.map((t) => resolveAddressFor(t));
  const [contactHits, domainOwners] = await Promise.all([
    contactsByEmails(addresses),
    customersForDomains(addresses.map(domainOf)),
  ]);
  const lookups = {
    contactByEmail: async (e: string) => contactHits.get(e) ?? null,
    customersByDomain: async (d: string) => domainOwners.get(d) ?? [],
  };
  let changed = 0;
  for (const t of candidates) {
    const r = await resolveSender(resolveAddressFor(t), lookups);
    const before = JSON.stringify([t.customerId, t.resolution, t.suggestedCustomerId, t.candidates]);
    const next = { ...t };
    await applyResolution(next, r);
    const after = JSON.stringify([next.customerId, next.resolution, next.suggestedCustomerId, next.candidates]);
    if (before === after) continue;
    let didPatch = false;
    await patchDoc<CommThread>("comms", t.id, (d) => {
      didPatch = applyResweepPatch(d, next);
    });
    if (didPatch) {
      changed++;
      if (next.resolution === "linked") {
        // Lazy import — label-sync pulls in connections/api, and a static
        // import here would set up an import cycle with those.
        const { queueLabelSync } = await import("./label-sync");
        queueLabelSync(t.id);
      }
    }
  }
  if (changed > 0) {
    console.info("[gmail] link backfill:", { threads: candidates.length, changed, ms: Date.now() - started });
  }
  return changed;
}

export async function backfillMailbox(key: string): Promise<number> {
  return resweepThreads(undefined, key);
}

/** A live contact on `customerId` that already carries `email`, or failing
 *  that one whose display name equals `name` (case-insensitive, trimmed).
 *  Address wins over name so a renamed sender still lands on their record. */
async function findReusableContact(customerId: string, email: string, name: string): Promise<string> {
  const live = await contactsForCompany(customerId);
  if (!live.length) return "";
  const emails = await emailsForContacts(live.map((c) => c.id));
  const byAddress = live.find((c) =>
    (emails.get(c.id) || []).some((x) => x.email.trim().toLowerCase() === email)
  );
  if (byAddress) return byAddress.id;
  const nm = name.trim().toLowerCase();
  if (!nm) return "";
  const byName = live.find((c) => contactDisplayName(c).trim().toLowerCase() === nm);
  return byName?.id || "";
}

/** Remember a sender's address on `customerId` — the link sidebar's
 *  "remember this address" checkbox. Appends to an existing contact
 *  (`contactId`, or a live contact on the customer that already carries
 *  the address or matches `displayName`) and mints a new one from
 *  `displayName` (split on the last space) only when none fits. Then, if
 *  the address's domain isn't public and nobody has claimed it yet, learns
 *  the domain for this customer, and re-sweeps the backlog for that
 *  address. Returns the contact id used. */
export async function rememberAddress(
  customerId: string,
  email: string,
  displayName: string,
  contactId: string | null | undefined,
  addedBy: { id: string; name: string }
): Promise<string> {
  const e = (email || "").trim().toLowerCase();
  if (!e) return "";
  let cid = contactId || "";
  if (cid) {
    const ct = await getContact(cid);
    if (!ct || ct.homeCompanyId !== customerId) cid = "";
  }
  if (!cid) cid = await findReusableContact(customerId, e, displayName || "");
  if (cid) {
    const existing = await emailsFor(cid);
    if (!existing.some((x) => x.email.toLowerCase() === e)) {
      await setEmails(cid, [
        ...existing.map((x) => ({ value: x.email, label: x.label, isPrimary: x.isPrimary })),
        { value: e, label: "work", isPrimary: existing.length === 0 },
      ]);
    }
  } else {
    const nm = (displayName || "").trim();
    const sp = nm.lastIndexOf(" ");
    cid = mintId("ct");
    await saveContact({
      id: cid,
      firstName: sp > 0 ? nm.slice(0, sp) : nm || e.split("@")[0],
      lastName: sp > 0 ? nm.slice(sp + 1) : "",
      homeCompanyId: customerId,
      title: "",
      pricingTier: null,
      status: "active",
      userId: null,
      ownerUserId: addedBy.id,
      isPrimary: false,
      createdAt: Date.now(),
    });
    await setEmails(cid, [{ value: e, label: "work", isPrimary: true }]);
  }
  const d = domainOf(e);
  if (d && !isPublicDomain(d) && (await customersForDomain(d)).length === 0) {
    await claimDomain(d, customerId, "learned", addedBy.name);
  }
  await resweepThreads({ email: e });
  return cid;
}

/** Stamp a thread as linked to `customerId` (the sidebar's Link / pick).
 *  Queues the Peak → Gmail label mirror so every link path (sidebar actions,
 *  re-sweep, Task 11) goes through the same bounded queue — never calls
 *  `syncPeakLabels` directly. Lazy import: label-sync pulls in
 *  connections/api, and a static import here would set up an import cycle
 *  with those (mirrors resweepThreads' own lazy import below). */
export async function linkThread(
  threadId: string,
  customerId: string,
  contactId?: string | null
): Promise<void> {
  const name = await customerNameFor(customerId);
  await patchDoc<CommThread>("comms", threadId, (d) => {
    // #124 — a venue belongs to one customer; a different customer drops it.
    if (d.customerId !== customerId) d.siteId = null;
    d.customerId = customerId;
    d.customer = name;
    d.resolvedContactId = contactId ?? d.resolvedContactId ?? null;
    d.resolution = "linked";
    d.suggestedCustomerId = null;
    d.candidates = [];
  });
  const { queueLabelSync } = await import("./label-sync");
  queueLabelSync(threadId);
}

export type LinkThreadToNewQuoteInput = {
  customerId: string;
  customer: string;
  locationId: string | null;
  /** I1 review — the venue's own label; without it flame/repair/inspection
   *  venue rows would show blank ("Venue" fallback) once opened in their
   *  builder. */
  locationLabel?: string;
  contactName: string;
  contactRole?: string;
  contactEmail?: string;
  quoteType: string;
  category: string;
  owner: string;
  /** the intake's optional "Quote name" field; falls back to the thread
   *  subject (Re:/Fwd: stripped) when blank. */
  name?: string;
};

export type LinkThreadToNewQuoteResult =
  | { ok: true; quoteId: string; name: string; reused: boolean }
  | { ok: false; reason: "not-found" }
  /** I4 review — the thread already points at something that ISN'T an
   *  inbox-minted draft for this customer; the caller must not overwrite it
   *  without an explicit confirm (opts.confirmReplace). */
  | { ok: false; reason: "linked-elsewhere"; link: CommLink };

/** #123 — "+ New quote" from a thread. The guided intake's builders only
 *  mint a quote on their first save (createQuoteIntakeAction just redirects
 *  into one), so this mints the draft directly to have an id to link: the
 *  thread's work link points at it, and a thread with no stored customer
 *  adopts the intake's (same rule as setLinkAction's adopt).
 *
 *  I1 review — seeds exactly the fields each builder's own first save
 *  writes (a `contact` object for the four service types, a minimal
 *  `venues`/`consulting.venueCustomerId` shape per type — see each
 *  builder's page.tsx for what it reads back), not just locationId +
 *  contactName (the estimator's own shape, which is all the old version
 *  seeded regardless of type).
 *
 *  I4 review — idempotent and non-destructive: a thread already linked to
 *  an inbox-minted draft for the SAME customer hands that quote back
 *  instead of minting a duplicate (double submit, a second tab, the back
 *  button); a thread linked to anything else refuses (reason
 *  "linked-elsewhere") unless the caller passes opts.confirmReplace, so a
 *  lead or another quote a thread already points at is never silently
 *  swapped out from under it.
 *
 *  Lazy imports: comms lazily imports this module, and quotes pulls in the
 *  assignments store — neither belongs in this module's static graph. */
export async function linkThreadToNewQuote(
  threadId: string,
  input: LinkThreadToNewQuoteInput,
  opts: { confirmReplace?: boolean } = {}
): Promise<LinkThreadToNewQuoteResult> {
  const { get: getThread, setLink } = await import("@/lib/stores/comms");
  const t = await getThread(threadId);
  if (!t) return { ok: false, reason: "not-found" };

  const { get: getQuoteDoc, create: createQuote } = await import("@/lib/stores/quotes");
  if (t.link?.type === "quote") {
    const existingQuote = await getQuoteDoc(t.link.id);
    if (
      existingQuote &&
      existingQuote.source === "inbox" &&
      existingQuote.status === "draft" &&
      existingQuote.customerId === input.customerId
    ) {
      return { ok: true, quoteId: existingQuote.id, name: existingQuote.name, reused: true };
    }
  }
  if (t.link && !opts.confirmReplace) {
    return { ok: false, reason: "linked-elsewhere", link: t.link };
  }

  const contact = input.contactName.trim()
    ? { name: input.contactName.trim(), role: input.contactRole || "", email: input.contactEmail || "" }
    : null;
  const venues = input.locationId ? [{ id: input.locationId, label: input.locationLabel || "Venue" }] : [];
  // I1 review — each service type's builder reads a different shape back
  // (flame-tests/quote/page.tsx, repairs/quote/page.tsx,
  // inspections/quote/page.tsx, rentals/quote/page.tsx,
  // design/engagements/quote/page.tsx); system/custom read only the
  // top-level locationId/contactName set below and need nothing extra.
  const typeFields: Record<string, unknown> = {};
  if (input.quoteType === "flame_test") {
    typeFields.flameTest = { venues };
    typeFields.contact = contact;
  } else if (input.quoteType === "repair") {
    typeFields.repair = { venues };
    typeFields.contact = contact;
  } else if (input.quoteType === "inspection") {
    typeFields.inspection = { venues };
    typeFields.contact = contact;
  } else if (input.quoteType === "rental") {
    // Rentals have no venue concept — rentals/quote/page.tsx never reads a
    // handoff venue — only the contact carries over.
    typeFields.contact = contact;
  } else if (input.quoteType === "consulting") {
    // design/engagements/quote/page.tsx requires BOTH the billed customerId
    // and a venueCustomerId; absent a distinct venue on this thread, the
    // billed customer IS the venue owner.
    typeFields.contact = contact;
    typeFields.consulting = { venueCustomerId: input.customerId, venueCustomer: input.customer };
  }

  const q = await createQuote({
    name: (input.name || "").trim() || quoteNameFromSubject(t.subject),
    customer: input.customer,
    customerId: input.customerId,
    locationId: input.quoteType === "rental" ? null : input.locationId,
    contactName: input.contactName,
    quoteType: input.quoteType,
    category: input.category,
    source: "inbox",
    owner: input.owner,
    ...typeFields,
  });
  if (!t.customerId) await linkThread(threadId, input.customerId, t.resolvedContactId ?? null);
  await setLink(threadId, { type: "quote", id: q.id, label: `${q.id} · ${q.name}` });
  return { ok: true, quoteId: q.id, name: q.name, reused: false };
}

/** #124 — stamp (or clear) the thread's venue. Validation (the site belongs
 *  to the linked customer) is the action's job; this is the store write. */
export async function setThreadSite(
  threadId: string,
  siteId: string | null
): Promise<CommThread | null> {
  return patchDoc<CommThread>("comms", threadId, (d) => {
    d.siteId = siteId || null;
  });
}

/** #125 — pick which message's addresses drive resolution, then re-resolve
 *  this one thread from that address. An unknown message id clears the pick.
 *  Never downgrades a linked thread (applyResweepPatch's guards); a fresh
 *  identity resets "Not them" because the old dismissal was about the old
 *  party's suggestion. */
export async function setIdentityMessage(
  threadId: string,
  messageId: string | null
): Promise<CommThread | null> {
  const t = await getDoc<CommThread>("comms", threadId);
  if (!t) return null;
  const id =
    messageId && (t.messages || []).some((m) => m.id === messageId) ? messageId : null;
  const probe: CommThread = { ...t, identityMessageId: id, suggestionDismissed: false };
  const address = resolveAddressFor(probe);
  const next: CommThread = { ...probe };
  await applyResolution(
    next,
    address ? await resolveForThread(address) : ({ kind: "unknown" } as const)
  );
  let linkedNow = false;
  const res = await patchDoc<CommThread>("comms", threadId, (d) => {
    d.identityMessageId = id;
    d.suggestionDismissed = false;
    if (applyResweepPatch(d, next)) linkedNow = d.resolution === "linked" && !!d.customerId;
  });
  if (linkedNow) {
    // Lazy import — same reason as resweepThreads (label-sync ↔ linking cycle).
    const { queueLabelSync } = await import("./label-sync");
    queueLabelSync(threadId);
  }
  return res;
}
