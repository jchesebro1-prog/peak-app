"use server";

/**
 * #214 — server actions behind the Inbox Link popup: load one message's
 * participants (matched to contacts) + its sender's parsed signature, the
 * lazy Cc backfill, link/unlink one person, the combined company / venue /
 * person search, and "Add missing details" from the signature. Company and
 * venue links reuse link-actions.ts (linkThreadToCustomerAction,
 * setThreadSiteAction, the quick-adds); nothing here duplicates them.
 */
import { revalidatePath } from "next/cache";
import { requireUser, type SessionUser } from "@/lib/session";
import { patchDoc } from "@/db/doc-store";
import {
  get as getThread,
  resolveCustomerId,
  timeFull,
  visibleTo,
  type CommMessage,
  type CommThread,
} from "@/lib/stores/comms";
import { activeUsers } from "@/lib/users";
import { domainOf, gmailEnabled, personalKey } from "@/lib/gmail/config";
import { getConnectionInfo } from "@/lib/gmail/connections";
import { customersForDomain } from "@/lib/gmail/domains";
import { linkThread } from "@/lib/gmail/linking";
import { allCompanies, getCompanies } from "@/lib/identity/companies";
import {
  allContacts,
  displayName,
  getContact,
  phonesFor,
  saveContact,
  setPhones,
} from "@/lib/identity/contacts";
import { contactByEmail, contactsByEmails, emailsMatching } from "@/lib/identity/lookup";
import { docLocId, getAllSites } from "@/lib/identity/sites";
import { participantsOf, type Participant } from "@/lib/inbox-participants";
import {
  channelLabelFor,
  companyByExactName,
  extractSignature,
  missingContactFields,
} from "@/lib/inbox-signature-parse";
import { applyContactLink, linkedContactIdsOf } from "@/lib/inbox-thread-contacts";
import {
  emptyLinkTargets,
  rankLinkTargets,
  LINK_TARGET_MIN_QUERY,
  type LinkTargetGroups,
  type LinkTargetKind,
} from "@/lib/inbox-link-targets";
import type { LinkPopupData, PopupParticipant } from "./types";

type R = { ok: true } | { ok: false; error: string };
type DataR = { ok: true; data: LinkPopupData } | { ok: false; error: string };
const revalidate = () => revalidatePath("/", "layout");

/** Our own addresses — never offered as people to link: every active team
 *  member's roster + Google addresses, the signed-in user's connected
 *  mailbox, and the mailbox that owns this thread. */
async function ownAddresses(t: CommThread, me: SessionUser): Promise<string[]> {
  const [users, mine, owner] = await Promise.all([
    activeUsers(),
    getConnectionInfo(personalKey(me.id)),
    t.gmailAccountKey ? getConnectionInfo(t.gmailAccountKey) : Promise.resolve(null),
  ]);
  const out: string[] = [me.email];
  for (const u of users) out.push(u.email, u.googleEmail || "");
  if (mine?.address) out.push(mine.address);
  if (owner?.address) out.push(owner.address);
  return out.filter(Boolean);
}

function senderOf(m: CommMessage, t: CommThread): Participant | null {
  if (m.direction !== "in") return null;
  return (
    participantsOf(m, [], { name: t.contactName, email: t.contactEmail }).find((p) => p.role === "from") ||
    null
  );
}

type Loaded = { ok: true; t: CommThread; m: CommMessage } | { ok: false; error: string };

async function loadThread(threadId: string, messageId: string, me: SessionUser): Promise<Loaded> {
  const t = await getThread(threadId);
  if (!t || !visibleTo(t, me.name)) return { ok: false, error: "Thread not found." };
  const m = (t.messages || []).find((x) => x.id === messageId);
  if (!m) return { ok: false, error: "That message isn't on this thread." };
  return { ok: true, t, m };
}

async function buildPopupData(t: CommThread, m: CommMessage, me: SessionUser): Promise<LinkPopupData> {
  const parts = participantsOf(m, await ownAddresses(t, me), {
    name: t.contactName,
    email: t.contactEmail,
  });
  const hits = await contactsByEmails(parts.map((p) => p.email));
  const linkedIds = linkedContactIdsOf(t);

  const contactIds = new Set<string>(linkedIds);
  for (const h of hits.values()) if (h && "contactId" in h) contactIds.add(h.contactId);
  const contactRows = (await Promise.all([...contactIds].map((id) => getContact(id)))).filter(
    (c): c is NonNullable<typeof c> => !!c
  );
  const contactById = new Map(contactRows.map((c) => [c.id, c]));
  const companies = await getCompanies(
    contactRows.map((c) => c.homeCompanyId).filter((v): v is string => !!v)
  );
  const companyName = (id: string | null | undefined) => (id ? companies.get(id)?.name || "" : "");

  const participants: PopupParticipant[] = parts.map((p) => {
    const h = hits.get(p.email) ?? null;
    const c = h && "contactId" in h ? contactById.get(h.contactId) ?? null : null;
    return {
      name: p.name,
      email: p.email,
      role: p.role,
      contactId: c?.id ?? null,
      contactName: c ? displayName(c) : "",
      companyId: c?.homeCompanyId ?? null,
      companyName: companyName(c?.homeCompanyId),
      ambiguous: !!h && "ambiguous" in h,
      linked: !!c && linkedIds.includes(c.id),
    };
  });
  const onMessage = new Set(participants.map((p) => p.contactId).filter(Boolean));
  const otherLinked = linkedIds
    .filter((id) => !onMessage.has(id))
    .map((id) => contactById.get(id))
    .filter((c): c is NonNullable<typeof c> => !!c)
    .map((c) => ({ id: c.id, name: displayName(c), companyName: companyName(c.homeCompanyId) }));

  const sender = senderOf(m, t);
  const signature = sender ? extractSignature(m.body || "", { name: sender.name, email: sender.email }) : null;
  const senderRow = sender ? participants.find((p) => p.email === sender.email) ?? null : null;
  const senderContactId = senderRow?.contactId ?? null;

  let missing: LinkPopupData["missing"] = { phones: [] };
  let prefill: LinkPopupData["prefill"] = null;
  if (senderContactId) {
    const c = contactById.get(senderContactId);
    const phones = await phonesFor(senderContactId);
    missing = missingContactFields({ title: c?.title ?? "", phones: phones.map((p) => p.phone) }, signature);
  } else if (sender && !senderRow?.ambiguous) {
    const owners = await customersForDomain(domainOf(sender.email));
    let companyId: string | null = owners.length === 1 ? owners[0].customerId : null;
    if (!companyId && signature?.company) {
      companyId = companyByExactName(
        signature.company,
        (await allCompanies()).map((c) => ({ id: c.id, name: c.name }))
      );
    }
    const phone = signature?.phones.find((p) => p.label === "mobile") ?? signature?.phones[0];
    prefill = {
      name: signature?.name || sender.name || "",
      title: signature?.title || "",
      email: sender.email,
      phone: phone?.number || "",
      companyId,
      companyName: companyId ? (await getCompanies([companyId])).get(companyId)?.name || "" : "",
    };
  }

  return {
    messageId: m.id,
    messageLabel: `${m.author || (m.direction === "in" ? t.contactName : "Me")} · ${
      m.direction === "in" ? "in" : "out"
    } · ${timeFull(m.at)}`,
    inbound: m.direction === "in",
    participants,
    otherLinked,
    ccPending: gmailEnabled() && !!m.gmailId && !m.cc && !m.ccFetched,
    signature,
    senderContactId,
    missing,
    prefill,
  };
}

/** The popup's data for one message. */
export async function linkPopupDataAction(threadId: string, messageId: string): Promise<DataR> {
  const me = await requireUser();
  const r = await loadThread(threadId, messageId, me);
  if (!r.ok) return r;
  return { ok: true, data: await buildPopupData(r.t, r.m, me) };
}

/** Lazy Cc backfill for a Gmail message imported before #214, then the
 *  refreshed popup data. Inert when Gmail is off or the fetch fails: the
 *  popup keeps its From/To participants. */
export async function fetchMessageCcAction(threadId: string, messageId: string): Promise<DataR> {
  const me = await requireUser();
  const r = await loadThread(threadId, messageId, me);
  if (!r.ok) return r;
  if (gmailEnabled() && r.m.gmailId && !r.m.cc && !r.m.ccFetched) {
    try {
      // Lazy import — the bridge (and the Gmail client) only loads when the
      // env gate is on, the same rule comms.ts follows.
      const { fetchMessageCc } = await import("@/lib/gmail/bridge");
      await fetchMessageCc(threadId, messageId);
    } catch (err) {
      console.error("[inbox] Cc fetch failed", threadId, messageId, err);
    }
  }
  const again = await loadThread(threadId, messageId, me);
  if (!again.ok) return again;
  const data = await buildPopupData(again.t, again.m, me);
  // A failed fetch must not make the popup ask again on every open render.
  return { ok: true, data: { ...data, ccPending: false } };
}

/** Link (`on`) or unlink one person. Linking a person on a thread with no
 *  company yet also links their home company (and makes them primary). */
export async function setThreadContactsAction(
  threadId: string,
  contactId: string,
  on: boolean
): Promise<R> {
  const me = await requireUser();
  const t = await getThread(threadId);
  if (!t || !visibleTo(t, me.name)) return { ok: false, error: "Thread not found." };
  const c = on ? await getContact(contactId) : null;
  if (on && !c) return { ok: false, error: "Person not found." };
  const pre = applyContactLink(t, contactId, on);
  if (!pre.ok) return pre;
  await patchDoc<CommThread>("comms", threadId, (d) => {
    const next = applyContactLink(d, contactId, on);
    if (!next.ok) return;
    d.linkedContactIds = next.linkedContactIds;
    d.resolvedContactId = next.resolvedContactId;
  });
  if (on && c?.homeCompanyId && !(t.customerId || (await resolveCustomerId(t)))) {
    await linkThread(threadId, c.homeCompanyId, pre.resolvedContactId);
  }
  revalidate();
  return { ok: true };
}

/** One search across companies (name, city), venues (name, address, city)
 *  and people (name, email) — ≤ 8 per group. `only` narrows to one kind
 *  (the quick-add contact form's company box). */
export async function searchLinkTargetsAction(
  q: string,
  only?: LinkTargetKind
): Promise<LinkTargetGroups> {
  await requireUser();
  const query = (q || "").trim();
  if (query.length < LINK_TARGET_MIN_QUERY) return emptyLinkTargets();
  const wantSites = !only || only === "venue";
  const wantPeople = !only || only === "person";
  const longest = query.split(/\s+/).sort((a, b) => b.length - a.length)[0] || "";
  const [companies, sites, people, emails] = await Promise.all([
    allCompanies(),
    wantSites ? getAllSites() : Promise.resolve([]),
    wantPeople ? allContacts() : Promise.resolve([]),
    wantPeople ? emailsMatching(longest) : Promise.resolve(new Map<string, string[]>()),
  ]);
  return rankLinkTargets(
    query,
    {
      companies: companies.map((c) => ({ id: c.id, name: c.name, city: c.city, state: c.state })),
      sites: sites.map((s) => ({
        id: docLocId(s),
        companyId: s.companyId,
        name: s.name,
        locationName: s.locationName,
        address: s.address,
        city: s.city,
        state: s.state,
      })),
      people: people.map((p) => ({
        id: p.id,
        name: displayName(p),
        title: p.title,
        companyId: p.homeCompanyId,
        emails: emails.get(p.id) ?? [],
      })),
    },
    only
  );
}

/** "Add missing details": write the title and phones the sender's contact
 *  lacks, re-read from the message on the server — never overwrites a
 *  field that already has a value. */
export async function fillContactBlanksAction(
  threadId: string,
  messageId: string
): Promise<{ ok: true; wrote: string[] } | { ok: false; error: string }> {
  const me = await requireUser();
  const r = await loadThread(threadId, messageId, me);
  if (!r.ok) return r;
  const sender = senderOf(r.m, r.t);
  if (!sender) return { ok: false, error: "Only a received message has a sender's signature." };
  const hit = await contactByEmail(sender.email);
  if (!hit || !("contactId" in hit)) return { ok: false, error: "The sender isn't one known contact." };
  const c = await getContact(hit.contactId);
  if (!c) return { ok: false, error: "Person not found." };
  const phones = await phonesFor(c.id);
  const sig = extractSignature(r.m.body || "", { name: sender.name, email: sender.email });
  const miss = missingContactFields({ title: c.title, phones: phones.map((p) => p.phone) }, sig);
  const wrote: string[] = [];
  if (miss.title) {
    await saveContact({ ...c, title: miss.title });
    wrote.push("title");
  }
  if (miss.phones.length) {
    await setPhones(c.id, [
      ...phones.map((p) => ({ value: p.phone, label: p.label, isPrimary: p.isPrimary })),
      ...miss.phones.map((p, i) => ({
        value: p.number,
        label: channelLabelFor(p.label),
        isPrimary: phones.length === 0 && i === 0,
      })),
    ]);
    wrote.push(miss.phones.length === 1 ? "1 phone" : `${miss.phones.length} phones`);
  }
  if (wrote.length) revalidate();
  return { ok: true, wrote };
}
