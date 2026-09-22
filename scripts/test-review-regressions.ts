import assert from "node:assert/strict";
import { setRates as setFlameRates, getRates as getFlameRates } from "@/lib/flametest-engine";
import { setRates as setRepairRates, getRates as getRepairRates } from "@/lib/repair-engine";
import { setRates as setInspectionRates, getRates as getInspectionRates } from "@/lib/inspection-engine";
import {
  allEngagements,
  attachQuoteToEngagement,
  createManualEngagement,
  ensureEngagementForQuote,
  getEngagement,
  syncEngagementsFromQuotes,
} from "@/lib/stores/engagements";
import { upsertDoc, patchDoc } from "@/db/doc-store";
import type { Quote } from "@/lib/stores/quotes";
import { contactByEmail } from "@/lib/identity/lookup";
import { emailsFor, saveContact, setEmails, softDeleteContact } from "@/lib/identity/contacts";
import { claimDomain, customersForDomain } from "@/lib/gmail/domains";
import { applyResolution, applyResweepPatch, resolveForThread, resweepThreads } from "@/lib/gmail/linking";
import {
  syncPeakLabels,
  queueLabelSync,
  pendingLabelSyncCount,
  awaitLabelSyncIdle,
} from "@/lib/gmail/label-sync";
import type { CommThread } from "@/lib/stores/comms";
import { interpretLabelEvents } from "@/lib/gmail/label-interpret";
import { saveConnection, replaceLabels } from "@/lib/gmail/connections";
import { GMAIL_MODIFY_SCOPE } from "@/lib/gmail/config";
import { get as getLead, getAll as getAllLeads } from "@/lib/stores/leads";
import { addUser } from "@/lib/users";
import {
  upsert as upsertCustomer,
  get as getCustomer,
  all as allCustomers,
  remove as removeCustomer,
  findCustomerByName,
  findCustomerById,
} from "@/lib/stores/customers";

async function main() {
  const flame = await setFlameRates({ laborRate: 123, mileageRate: 1.23 });
  assert.equal(flame.laborRate, 123, "flame-test setRates must return the editable labor rate");
  assert.equal((await getFlameRates()).mileageRate, 1.23, "flame-test getRates must preserve mileage overrides");

  const repair = await setRepairRates({ laborRate: 234, mileageRate: 2.34 });
  assert.equal(repair.laborRate, 234, "repair setRates must return the editable labor rate");
  assert.equal((await getRepairRates()).mileageRate, 2.34, "repair getRates must preserve mileage overrides");

  const inspection = await setInspectionRates({ laborRate: 345, mileageRate: 3.45 });
  assert.equal(inspection.laborRate, 345, "inspection setRates must return the editable labor rate");
  assert.equal((await getInspectionRates()).mileageRate, 3.45, "inspection getRates must preserve mileage overrides");

  const quoteId = "Q-review-venue-regression";
  const quote: Quote = {
    id: quoteId,
    name: "Venue linkage regression",
    customer: "Billing company",
    customerId: "billing-company",
    locationId: "venue-site-1",
    value: 1000,
    margin: 0,
    status: "sent",
    source: "consulting",
    quoteType: "consulting",
    owner: "Tester",
    review: {
      state: "none",
      reviewer: null,
      submittedBy: null,
      submittedAt: null,
      decidedBy: null,
      decidedAt: null,
      note: "",
    },
    consulting: {
      scope: "",
      feeMode: "fixed",
      fees: [],
      terms: "",
      phases: [],
      venueCustomerId: "venue-company",
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
    history: [],
  };
  await upsertDoc("quotes", quote as Quote & Record<string, unknown>);
  const engagement = await ensureEngagementForQuote(quoteId, "proposal_sent");
  assert.equal(engagement?.companyId, "venue-company", "engagement company must follow the venue organization");
  assert.deepEqual(engagement?.siteIds, ["venue-site-1"], "engagement must retain the venue site link");

  // #96 — resolver over real tables
  await saveContact({
    id: "ct-t96", firstName: "Brenda", lastName: "Gauchel", homeCompanyId: "lakefront",
    title: "", pricingTier: null, status: "active", userId: null, ownerUserId: "u1",
    isPrimary: false, createdAt: Date.now(),
  });
  await setEmails("ct-t96", [{ value: "brenda.t96@lakefront.k12.mn.us", label: "work", isPrimary: true }]);
  const hit = await contactByEmail("Brenda.T96@Lakefront.K12.MN.US");
  assert.equal(hit && !("ambiguous" in hit) ? hit.customerId : null, "lakefront", "#96 contactByEmail joins to the home company");
  const r1 = await resolveForThread("brenda.t96@lakefront.k12.mn.us");
  assert.equal(r1.kind, "linked", "#96 exact contact links");

  // #96 Wave A fix 1 — a soft-deleted contact must never resolve a sender,
  // and two live contacts on different customers sharing one address is
  // ambiguous, never a silent pick.
  await saveContact({
    id: "ct-t96gone", firstName: "Gone", lastName: "Person", homeCompanyId: "lakefront",
    title: "", pricingTier: null, status: "active", userId: null, ownerUserId: "u1",
    isPrimary: false, createdAt: Date.now(),
  });
  await setEmails("ct-t96gone", [{ value: "gone.t96@t96gone.org", label: "work", isPrimary: true }]);
  const gone = await contactByEmail("gone.t96@t96gone.org");
  assert.equal(gone && !("ambiguous" in gone) ? gone.contactId : null, "ct-t96gone", "#96 live contact resolves before deletion");
  await softDeleteContact("ct-t96gone");
  assert.equal(await contactByEmail("gone.t96@t96gone.org"), null, "#96 contactByEmail ignores a soft-deleted contact");
  await saveContact({
    id: "ct-t96dupA", firstName: "Dup", lastName: "A", homeCompanyId: "lakefront",
    title: "", pricingTier: null, status: "active", userId: null, ownerUserId: "u1",
    isPrimary: false, createdAt: Date.now(),
  });
  await saveContact({
    id: "ct-t96dupB", firstName: "Dup", lastName: "B", homeCompanyId: "other",
    title: "", pricingTier: null, status: "active", userId: null, ownerUserId: "u1",
    isPrimary: false, createdAt: Date.now(),
  });
  await setEmails("ct-t96dupA", [{ value: "shared.t96@t96dup.org", label: "work", isPrimary: true }]);
  await setEmails("ct-t96dupB", [{ value: "shared.t96@t96dup.org", label: "work", isPrimary: true }]);
  const dup = await contactByEmail("shared.t96@t96dup.org");
  assert.ok(dup && "ambiguous" in dup, "#96 contactByEmail reports two live customers as ambiguous");
  assert.deepEqual(
    dup && "ambiguous" in dup ? [...dup.ambiguous].sort() : [],
    ["lakefront", "other"],
    "#96 contactByEmail lists both live customers"
  );
  const rDup = await resolveForThread("shared.t96@t96dup.org");
  assert.equal(rDup.kind, "ambiguous", "#96 resolver treats a two-customer contact hit as ambiguous");
  assert.equal(r1.kind === "linked" && r1.via, "contact", "#96 exact contact links via contact match");
  await claimDomain("t96district.org", "lakefront", "manual", "test");
  await claimDomain("t96district.org", "other", "learned", "test"); // learned never overwrites
  assert.equal((await customersForDomain("t96district.org")).length, 1, "#96 learned claim doesn't add a second owner");
  const r2 = await resolveForThread("someone@t96district.org");
  assert.equal(r2.kind === "linked" && r2.via, "domain", "#96 domain claim resolves");

  // #96 — applyResolution: a contact match links directly; a domain match
  // only suggests (never auto-assigns customerId).
  const rec: CommThread = {
    id: "C-t96direct", mailbox: "personal", unread: true,
    customerId: null, customer: "", contactName: "Brenda", contactEmail: "brenda.t96@lakefront.k12.mn.us",
    subject: "hi", channel: "email", status: "waiting_us", assignedTo: "", link: null,
    messages: [], createdAt: Date.now(), updatedAt: Date.now(), resolution: undefined,
  };
  await applyResolution(rec, r1);
  assert.equal(rec.resolution, "linked", "#96 applyResolution links a contact match");
  assert.equal(rec.customerId, "lakefront", "#96 applyResolution sets customerId from the contact match");

  const rec2: CommThread = {
    id: "C-t96domain", mailbox: "personal", unread: true,
    customerId: null, customer: "", contactName: "Someone", contactEmail: "someone@t96district.org",
    subject: "hi", channel: "email", status: "waiting_us", assignedTo: "", link: null,
    messages: [], createdAt: Date.now(), updatedAt: Date.now(), resolution: undefined,
  };
  await applyResolution(rec2, r2);
  assert.equal(rec2.resolution, "suggested", "#96 applyResolution suggests a domain match");
  assert.equal(rec2.suggestedCustomerId, "lakefront", "#96 applyResolution suggestion names the domain owner");
  assert.equal(rec2.customerId, null, "#96 applyResolution never auto-assigns a domain suggestion");

  // #96 — re-sweep links the backlog after a domain claim
  await upsertDoc("comms", {
    id: "C-t96", mailbox: "personal", mailboxUser: "Jeff Chesebro", unread: true, archived: false,
    customerId: null, customer: "", contactName: "New Person", contactEmail: "np@t96sweep.org",
    subject: "hi", channel: "email", status: "waiting_us", assignedTo: "", link: null,
    messages: [{ id: "m1", at: Date.now(), direction: "in", channel: "email", author: "New Person", body: "x" }],
    createdAt: Date.now(), updatedAt: Date.now(), resolution: "unknown",
  } as any);
  await claimDomain("t96sweep.org", "lakefront", "manual", "test");
  const n = await resweepThreads({ domain: "t96sweep.org" });
  assert.equal(n, 1, "#96 resweep touched the unlinked thread");
  const { getDoc } = await import("@/db/doc-store");
  const swept = await getDoc<any>("comms", "C-t96");
  assert.equal(swept?.resolution, "suggested", "#96 domain claim surfaces as a suggestion");
  assert.equal(swept?.suggestedCustomerId, "lakefront", "#96 suggestion names the domain owner");

  // #96 — resweep is idempotent: a second pass over the same filter patches nothing
  const n2 = await resweepThreads({ domain: "t96sweep.org" });
  assert.equal(n2, 0, "#96 resweep is idempotent on an already-suggested thread");

  // #96 §? — re-sweep must never clobber a manual link that lands mid-sweep
  // (setLinkAction's update(id, { customerId }) racing listDocs → patchDoc).
  await upsertDoc("comms", {
    id: "C-t96b", mailbox: "personal", mailboxUser: "Jeff Chesebro", unread: true, archived: false,
    customerId: null, customer: "", contactName: "Another Person", contactEmail: "another@t96sweep.org",
    subject: "hi", channel: "email", status: "waiting_us", assignedTo: "", link: null,
    messages: [{ id: "m1", at: Date.now(), direction: "in", channel: "email", author: "Another Person", body: "x" }],
    createdAt: Date.now(), updatedAt: Date.now(), resolution: "unknown",
  } as any);
  // Simulate the race: a manual link lands between listDocs and patchDoc.
  await patchDoc<CommThread>("comms", "C-t96b", (d) => {
    d.customerId = "other";
    d.customer = "Other";
    d.resolution = "linked";
  });
  const n3 = await resweepThreads({ domain: "t96sweep.org" });
  const raced = await getDoc<any>("comms", "C-t96b");
  assert.equal(raced?.customerId, "other", "#96 resweep must not clobber a link that landed mid-sweep");
  assert.equal(raced?.resolution, "linked", "#96 resweep must not revert the manual link's resolution");
  void n3; // resweepThreads' own already-linked filter is what skips C-t96b here

  // #96 Wave A fix 3 — the batched re-sweep resolves every unlinked thread
  // from one domain in a single pass (one contact query + one domain query).
  for (const i of [1, 2, 3]) {
    await upsertDoc("comms", {
      id: `C-t96batch${i}`, mailbox: "personal", mailboxUser: "Jeff Chesebro", unread: true, archived: false,
      customerId: null, customer: "", contactName: `Batch ${i}`, contactEmail: `batch${i}@t96batch.org`,
      subject: "hi", channel: "email", status: "waiting_us", assignedTo: "", link: null,
      messages: [], createdAt: Date.now(), updatedAt: Date.now(), resolution: "unknown",
    } as any);
  }
  await claimDomain("t96batch.org", "lakefront", "manual", "test");
  const nBatch = await resweepThreads({ domain: "t96batch.org" });
  assert.equal(nBatch, 3, "#96 batched resweep touches all three unlinked threads");
  for (const i of [1, 2, 3]) {
    const b = await getDoc<any>("comms", `C-t96batch${i}`);
    assert.equal(b?.resolution, "suggested", `#96 batched resweep suggests thread ${i}`);
    assert.equal(b?.suggestedCustomerId, "lakefront", `#96 batched resweep names the owner on thread ${i}`);
  }
  // …and a contact address in the same sweep links directly (contact step
  // still wins inside the batch).
  await setEmails("ct-t96", [
    { value: "brenda.t96@lakefront.k12.mn.us", label: "work", isPrimary: true },
    { value: "batch2@t96batch.org", label: "other", isPrimary: false },
  ]);
  await resweepThreads({ domain: "t96batch.org" });
  const b2 = await getDoc<any>("comms", "C-t96batch2");
  assert.equal(b2?.resolution, "linked", "#96 batched resweep links a contact address directly");
  assert.equal(b2?.resolvedContactId, "ct-t96", "#96 batched resweep stamps the matched contact");

  // #96 — applyResweepPatch guard, exercised directly (the patchDoc callback
  // is synchronous, so `next` is always precomputed outside it — see linking.ts).
  const linkedFresh: CommThread = { ...rec, id: "guard-linked", customerId: "manual-owner", resolution: "linked" };
  const unlinkedNext: CommThread = { ...rec2, id: "guard-linked", customerId: null, resolution: "unknown" };
  const beforeGuard = JSON.stringify(linkedFresh);
  assert.equal(
    applyResweepPatch(linkedFresh, unlinkedNext), false,
    "#96 applyResweepPatch declines when the fresh doc is already linked"
  );
  assert.equal(JSON.stringify(linkedFresh), beforeGuard, "#96 applyResweepPatch leaves an already-linked doc untouched");

  const unlinkedFresh: CommThread = { ...rec, id: "guard-unlinked", customerId: null, resolution: "unknown" };
  const suggestedNext: CommThread = {
    ...rec2, id: "guard-unlinked", customerId: null, resolution: "suggested", suggestedCustomerId: "lakefront",
  };
  assert.equal(
    applyResweepPatch(unlinkedFresh, suggestedNext), true,
    "#96 applyResweepPatch applies when the fresh doc is unlinked"
  );
  assert.equal(unlinkedFresh.resolution, "suggested", "#96 applyResweepPatch copies the suggested resolution");
  assert.equal(unlinkedFresh.suggestedCustomerId, "lakefront", "#96 applyResweepPatch copies the suggested customer");

  // #96 Task 5 — rememberAddress creates the contact, learns the domain, links the thread
  const { rememberAddress, linkThread } = await import("@/lib/gmail/linking");
  const cid = await rememberAddress("lakefront", "ap.clerk@t96learn.org", "AP Clerk", null, { id: "u1", name: "Test" });
  assert.ok(cid.startsWith("ct-"), "#96 rememberAddress mints a contact");
  assert.equal((await customersForDomain("t96learn.org"))[0]?.source, "learned", "#96 unclaimed domain is learned");

  // Re-calling with the minted contactId must not duplicate the email already on it.
  const cid2 = await rememberAddress("lakefront", "ap.clerk@t96learn.org", "AP Clerk", cid, { id: "u1", name: "Test" });
  assert.equal(cid2, cid, "#96 rememberAddress reuses the given contactId");
  assert.equal((await emailsFor(cid)).length, 1, "#96 rememberAddress doesn't duplicate an email already on the contact");

  // A public-domain address must never claim a domain.
  const cid3 = await rememberAddress("lakefront", "someone@gmail.com", "Someone Else", null, { id: "u1", name: "Test" });
  assert.equal((await customersForDomain("gmail.com")).length, 0, "#96 rememberAddress never claims a public domain");
  void cid3;

  // #96 Task 5 review fix — rememberAddress must refuse a contactId that
  // belongs to a different (or nonexistent) customer, minting a fresh
  // contact on the given customer instead of appending to the foreign one.
  await saveContact({
    id: "ct-t96own", firstName: "Foreign", lastName: "Owner", homeCompanyId: "other-company",
    title: "", pricingTier: null, status: "active", userId: null, ownerUserId: "u1",
    isPrimary: false, createdAt: Date.now(),
  });
  const cid4 = await rememberAddress("lakefront", "x.t96@t96own.org", "X", "ct-t96own", { id: "u1", name: "Test" });
  assert.notEqual(cid4, "ct-t96own", "#96 rememberAddress must not append to a contact owned by a different customer");
  const { getContact } = await import("@/lib/identity/contacts");
  const minted = await getContact(cid4);
  assert.equal(minted?.homeCompanyId, "lakefront", "#96 rememberAddress mints the fallback contact on the given customer");

  // #96 Wave A fix 4 — remembering a second address for the same display
  // name on the same customer must reuse the contact, not mint a twin.
  const same1 = await rememberAddress("lakefront", "pat.t96@t96same.org", "Pat Same", null, { id: "u1", name: "Test" });
  const same2 = await rememberAddress("lakefront", "pat.same@t96other.org", "  pat SAME ", null, { id: "u1", name: "Test" });
  assert.equal(same2, same1, "#96 rememberAddress reuses a same-name contact instead of minting a duplicate");
  assert.equal((await emailsFor(same1)).length, 2, "#96 the reused contact carries both addresses");
  // …and an address already on a contact of that customer reuses it even
  // when the display name differs.
  const same3 = await rememberAddress("lakefront", "PAT.T96@t96same.org", "P. Same (mobile)", null, { id: "u1", name: "Test" });
  assert.equal(same3, same1, "#96 rememberAddress reuses the contact that already carries the address");
  assert.equal((await emailsFor(same1)).length, 2, "#96 reusing by address adds no duplicate email");

  await upsertDoc("comms", {
    id: "C-t96link", mailbox: "personal", unread: true, archived: false,
    customerId: null, customer: "", contactName: "AP Clerk", contactEmail: "ap.clerk@t96learn.org",
    subject: "hi", channel: "email", status: "waiting_us", assignedTo: "", link: null,
    messages: [], createdAt: Date.now(), updatedAt: Date.now(), resolution: "unknown",
  } as any);
  await linkThread("C-t96link", "lakefront", cid);
  const linked = await getDoc<any>("comms", "C-t96link");
  assert.equal(linked?.resolution, "linked", "#96 linkThread stamps linked");
  assert.equal(linked?.customerId, "lakefront", "#96 linkThread sets customerId");
  assert.equal(linked?.resolvedContactId, cid, "#96 linkThread stamps resolvedContactId");

  // #96 Task 5 — the learned claim must be atomic: two concurrent learned
  // claims on a fresh domain from different customers must never both land.
  await Promise.all([
    claimDomain("t96atomic.org", "cust-a", "learned", "test"),
    claimDomain("t96atomic.org", "cust-b", "learned", "test"),
  ]);
  assert.equal(
    (await customersForDomain("t96atomic.org")).length,
    1,
    "#96 concurrent learned claims on a fresh domain never both land"
  );

  // #96 Task 5 review fix — create() must resolve app-created threads too
  // (Compose, Log call/meeting, renewal outreach, simulated inbound), not
  // just Gmail-bridged ones, so Unmatched + suggestions cover them.
  const { create: createThread } = await import("@/lib/stores/comms");
  const suggestedThread = await createThread({
    mailbox: "sales",
    subject: "Quote follow-up",
    contactName: "New Person",
    contactEmail: "new.person@t96sweep.org",
    channel: "email",
  });
  assert.equal(
    suggestedThread.resolution,
    "suggested",
    "#96 create() resolves a claimed domain to a suggestion"
  );
  assert.equal(
    suggestedThread.suggestedCustomerId,
    "lakefront",
    "#96 create() names the domain owner as the suggested customer"
  );

  const unknownThread = await createThread({
    mailbox: "sales",
    subject: "General inquiry",
    contactName: "Nobody",
    contactEmail: "nobody@gmail.com",
    channel: "email",
  });
  assert.equal(
    unknownThread.resolution,
    "unknown",
    "#96 create() leaves a public-domain contact unresolved"
  );

  // #96 §3 — the Peak → Gmail label writer must never throw out of a fire-
  // and-forget caller: a nonexistent thread id resolves cleanly...
  await assert.doesNotReject(
    () => syncPeakLabels("no-such-thread"),
    "#96 syncPeakLabels on an unknown thread id must resolve, never throw"
  );

  // ...and a real thread with no gmailThreadId is skipped before any Gmail
  // call (the regression harness has no network access and GMAIL_ENABLED is
  // unset here, so gmailEnabled() alone already guarantees the immediate
  // return — this pins that behavior).
  await upsertDoc<any>("comms", {
    id: "C-t96label-nogmail",
    mailbox: "sales",
    unread: false,
    archived: false,
    customerId: "lakefront",
    customer: "Lakefront",
    contactName: "No Gmail",
    contactEmail: "no-gmail@t96label.example",
    subject: "No Gmail thread id",
    channel: "email",
    status: "waiting_us",
    assignedTo: "",
    link: null,
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    resolution: "linked",
  } as any);
  await assert.doesNotReject(
    () => syncPeakLabels("C-t96label-nogmail"),
    "#96 syncPeakLabels on a thread with no gmailThreadId must resolve, never throw"
  );

  // #96 §3 review fix (Critical 4) — queueLabelSync coalesces a second call
  // for the same thread while the first is still queued/in-flight, and
  // never throws even with the Gmail gate off.
  assert.doesNotThrow(() => {
    queueLabelSync("x");
    queueLabelSync("x");
  }, "#96 queueLabelSync must never throw");
  assert.equal(
    pendingLabelSyncCount(),
    1,
    "#96 queueLabelSync coalesces a second call for the same thread instead of double-queuing"
  );
  // Task 10 fix — the pending entry is removed at the START of its turn (not
  // in a trailing `finally`), so a mutation landing mid-flight re-queues one
  // trailing sync instead of being coalesced into a turn that already read
  // the doc. awaitLabelSyncIdle() resolves only once the whole chain —
  // including any such trailing sync — has drained.
  await awaitLabelSyncIdle();
  assert.equal(
    pendingLabelSyncCount(),
    0,
    "#96 queueLabelSync's pending entry clears once the chained sync settles"
  );

  // Re-queue semantics: calling queueLabelSync twice back-to-back always
  // yields exactly one pending entry before the first turn starts, and the
  // chain always drains back to zero — whether or not a second call arrives
  // while the first turn is already running.
  assert.doesNotThrow(() => {
    queueLabelSync("y");
    queueLabelSync("y");
  }, "#96 queueLabelSync must never throw on repeat calls");
  assert.equal(
    pendingLabelSyncCount(),
    1,
    "#96 queueLabelSync reflects exactly one pending entry before the first turn starts"
  );
  await awaitLabelSyncIdle();
  assert.equal(
    pendingLabelSyncCount(),
    0,
    "#96 awaitLabelSyncIdle only resolves once the chain (incl. any re-queued trailing sync) is fully drained"
  );

  // #96 §3 Task 11 — Gmail → Peak label interpreter: a status label applies
  // through the store, and Peak/New lead is idempotent even when the Gmail
  // label swap it triggers actually round-trips. No .env.local exists in a
  // fresh worktree (see AUTH_SECRET fallback in smoke-routes.ts) — token
  // encryption needs SOME secret, so fall back to the same kind of
  // test-only value those scripts use.
  process.env.AUTH_SECRET ||= "quartzite-test-secret-not-for-production";
  {
    const mailboxKey = "personal:t11interp";
    await saveConnection({
      mailboxKey,
      address: "t11interp@example.com",
      userId: "t11interp",
      connectedBy: "Tester",
      tokens: {
        accessToken: "fake-access-token",
        refreshToken: "fake-refresh-token",
        expiresAt: Date.now() + 3_600_000,
        // gmail.modify scope: interpretLabelEvents gates its best-effort
        // New-lead label swap on this (mirrors syncPeakLabels' own gate) —
        // this mailbox's tests below rely on the swap actually firing.
        scope: GMAIL_MODIFY_SCOPE,
      },
    });
    await replaceLabels(mailboxKey, [
      { id: "L-t11-newlead", name: "Peak/New lead", type: "user" },
      { id: "L-t11-statusdone", name: "Peak/Status/Done", type: "user" },
    ]);

    // Fake Gmail's HTTP surface for the two calls the New-lead swap makes
    // (create the Peak/Leads/<id> label, then modify the thread) — this
    // harness has no real Gmail connection or network access.
    const realFetch = global.fetch;
    (global as any).fetch = async (url: string, init?: RequestInit) => {
      const u = String(url);
      const method = (init?.method || "GET").toUpperCase();
      if (u.includes("/labels") && method === "POST") {
        return new Response(JSON.stringify({ id: "L-t11-newleadid", name: "Peak/Leads/fake" }), { status: 200 });
      }
      if (u.includes("/modify") && method === "POST") {
        return new Response(JSON.stringify({}), { status: 200 });
      }
      return realFetch(url, init as any);
    };
    try {
      await upsertDoc<any>("comms", {
        id: "C-t11-newlead",
        mailbox: "sales",
        unread: false,
        archived: false,
        customerId: null,
        customer: "",
        contactName: "Prospect Pat",
        contactEmail: "pat@t11-newlead.example",
        subject: "Quote request",
        channel: "email",
        status: "waiting_us",
        assignedTo: "",
        link: null,
        messages: [
          { id: "m1", at: Date.now(), direction: "in", channel: "email", author: "Prospect Pat", body: "Hi", gmailId: "g-t11-m1" },
        ],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        gmailThreadId: "g-t11-thread-newlead",
        gmailAccountKey: mailboxKey,
        resolution: "unknown",
      } as any);

      const newLeadEvent = [{ messageId: "g-t11-m1", threadId: "g-t11-thread-newlead", added: ["L-t11-newlead"], removed: [] }];
      const applied1 = await interpretLabelEvents(mailboxKey, newLeadEvent);
      assert.equal(applied1, 1, "#96 Task 11 a fresh Peak/New lead label applies exactly one command");
      const t1 = await getDoc<CommThread>("comms", "C-t11-newlead");
      assert.ok(t1?.link?.type === "lead", "#96 Task 11 Peak/New lead links the thread to a freshly created lead");
      const leadId = t1!.link!.id;
      assert.ok(await getLead(leadId), "#96 Task 11 Peak/New lead actually created a lead record");

      const applied2 = await interpretLabelEvents(mailboxKey, newLeadEvent);
      assert.equal(applied2, 0, "#96 Task 11 a second Peak/New lead event on an already-spawned thread is a no-op");
      const t2 = await getDoc<CommThread>("comms", "C-t11-newlead");
      assert.equal(t2?.link?.id, leadId, "#96 Task 11 New-lead idempotency: the thread still points at the SAME lead, never a second one");
    } finally {
      (global as any).fetch = realFetch;
    }

    // Status command — Peak/Status/Done applies through setStatus (no Gmail
    // call: GMAIL_ENABLED is unset here, so the writer's own queued sync
    // gates itself off before touching the network).
    await upsertDoc<any>("comms", {
      id: "C-t11-status",
      mailbox: "sales",
      unread: false,
      archived: false,
      customerId: "lakefront",
      customer: "Lakefront",
      contactName: "Someone",
      contactEmail: "someone@t11-status.example",
      subject: "Status test",
      channel: "email",
      status: "waiting_them",
      assignedTo: "",
      link: null,
      messages: [
        { id: "m1", at: Date.now(), direction: "in", channel: "email", author: "Someone", body: "Hi", gmailId: "g-t11-m2" },
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      gmailThreadId: "g-t11-thread-status",
      gmailAccountKey: mailboxKey,
      resolution: "linked",
    } as any);
    const appliedStatus = await interpretLabelEvents(mailboxKey, [
      { messageId: "g-t11-m2", threadId: "g-t11-thread-status", added: ["L-t11-statusdone"], removed: [] },
    ]);
    assert.equal(appliedStatus, 1, "#96 Task 11 a status label applies exactly one command");
    const statusThread = await getDoc<CommThread>("comms", "C-t11-status");
    assert.equal(statusThread?.status, "closed", "#96 Task 11 Peak/Status/Done sets the thread status to closed");

    // #96 §3 review fix (Critical) — Gmail's history API returns a SEPARATE
    // labelAdded record per MESSAGE when a label is applied to the whole
    // thread from the Gmail UI; api.ts flattens those into one
    // GmailLabelEvent per message, all sharing the same threadId. Feed
    // interpretLabelEvents exactly that shape (3 events, same thread, same
    // label) and prove it collapses them into a single New-lead command
    // instead of spawning one duplicate lead per message.
    await replaceLabels(mailboxKey, [
      { id: "L-t11-newlead", name: "Peak/New lead", type: "user" },
      { id: "L-t11-statusdone", name: "Peak/Status/Done", type: "user" },
      { id: "L-t11-assignchris", name: "Peak/Assign/Chris", type: "user" },
    ]);
    {
      const realFetch = global.fetch;
      let modifyCalls = 0;
      (global as any).fetch = async (url: string, init?: RequestInit) => {
        const u = String(url);
        const method = (init?.method || "GET").toUpperCase();
        if (u.includes("/labels") && method === "POST") {
          return new Response(JSON.stringify({ id: "L-t11-newleadid-multi", name: "Peak/Leads/fake" }), { status: 200 });
        }
        if (u.includes("/modify") && method === "POST") {
          modifyCalls++;
          return new Response(JSON.stringify({}), { status: 200 });
        }
        return realFetch(url, init as any);
      };
      try {
        await upsertDoc<any>("comms", {
          id: "C-t11-newlead-multi",
          mailbox: "sales",
          unread: false,
          archived: false,
          customerId: null,
          customer: "",
          contactName: "Multi Message",
          contactEmail: "multi@t11-newlead.example",
          subject: "Quote request (multi)",
          channel: "email",
          status: "waiting_us",
          assignedTo: "",
          link: null,
          messages: [
            { id: "m1", at: Date.now(), direction: "in", channel: "email", author: "Multi Message", body: "Hi 1", gmailId: "g-t11-mm-1" },
            { id: "m2", at: Date.now(), direction: "in", channel: "email", author: "Multi Message", body: "Hi 2", gmailId: "g-t11-mm-2" },
            { id: "m3", at: Date.now(), direction: "out", channel: "email", author: "Peak", body: "Reply", gmailId: "g-t11-mm-3" },
          ],
          createdAt: Date.now(),
          updatedAt: Date.now(),
          gmailThreadId: "g-t11-thread-newlead-multi",
          gmailAccountKey: mailboxKey,
          resolution: "unknown",
        } as any);

        const multiMessageEvent = [
          { messageId: "g-t11-mm-1", threadId: "g-t11-thread-newlead-multi", added: ["L-t11-newlead"], removed: [] },
          { messageId: "g-t11-mm-2", threadId: "g-t11-thread-newlead-multi", added: ["L-t11-newlead"], removed: [] },
          { messageId: "g-t11-mm-3", threadId: "g-t11-thread-newlead-multi", added: ["L-t11-newlead"], removed: [] },
        ];
        const leadsBefore = (await getAllLeads()).length;
        const appliedMulti = await interpretLabelEvents(mailboxKey, multiMessageEvent);
        assert.equal(appliedMulti, 1, "#96 Task 11 collapse: a multi-message thread's repeated label applies the New-lead command exactly once");
        const leadsAfter = (await getAllLeads()).length;
        assert.equal(leadsAfter, leadsBefore + 1, "#96 Task 11 collapse: a 3-message thread spawns exactly one lead, not three");
        assert.equal(modifyCalls, 1, "#96 Task 11 collapse: the Gmail label swap fires exactly once for the thread, not once per message");
        const multiThread = await getDoc<CommThread>("comms", "C-t11-newlead-multi");
        assert.ok(multiThread?.link?.type === "lead", "#96 Task 11 collapse: the thread links to the spawned lead");

        // Re-delivery of the SAME already-collapsed thread event (a retry,
        // or a later sync page) must still be a no-op — idempotency holds
        // whether the duplicate arrives within one call (collapse) or
        // across calls (the guard).
        const appliedMultiAgain = await interpretLabelEvents(mailboxKey, multiMessageEvent);
        assert.equal(appliedMultiAgain, 0, "#96 Task 11 collapse: redelivering the same multi-message event a second time is a no-op");
      } finally {
        (global as any).fetch = realFetch;
      }
    }

    // #96 review fix — ambiguous assignee: two active users sharing a first
    // name must never let a bare Array.find() pick winner-take-first; the
    // assign command is skipped entirely rather than guessing.
    {
      await addUser({ name: "Chris Alpha" });
      await addUser({ name: "Chris Beta" });
      await upsertDoc<any>("comms", {
        id: "C-t11-assign-ambiguous",
        mailbox: "sales",
        unread: false,
        archived: false,
        customerId: null,
        customer: "",
        contactName: "Someone Else",
        contactEmail: "someone-else@t11-assign.example",
        subject: "Assign test",
        channel: "email",
        status: "waiting_us",
        assignedTo: "",
        link: null,
        messages: [
          { id: "m1", at: Date.now(), direction: "in", channel: "email", author: "Someone Else", body: "Hi", gmailId: "g-t11-assign-m1" },
        ],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        gmailThreadId: "g-t11-thread-assign",
        gmailAccountKey: mailboxKey,
        resolution: "unknown",
      } as any);
      const appliedAmbiguous = await interpretLabelEvents(mailboxKey, [
        { messageId: "g-t11-assign-m1", threadId: "g-t11-thread-assign", added: ["L-t11-assignchris"], removed: [] },
      ]);
      assert.equal(appliedAmbiguous, 0, "#96 an ambiguous Peak/Assign/<firstName> (two active users share it) applies no command");
      const ambiguousThread = await getDoc<CommThread>("comms", "C-t11-assign-ambiguous");
      assert.equal(ambiguousThread?.assignedTo, "", "#96 an ambiguous assign never guesses — assignedTo stays unset");
    }

    // #96 echo-window regression — a label event that just reports back our
    // OWN write (writer stamped peakLabelsAppliedAt and wrote the label the
    // thread's current status already wants) must be suppressed, not
    // reprocessed. Without this guard, setStatus -> queuePeakLabelSync ->
    // write Peak/Status/Done -> Gmail echoes labelAdded -> setStatus again is
    // an infinite ping-pong. The command here (setStatus to "closed" on an
    // already-closed thread) would be a silent no-op on status alone, so the
    // real proof is `rev`: touch() bumps it on every patchDoc, suppressed or
    // not — an unchanged rev proves setStatus never ran a second time.
    {
      const doneLabelId = "L-t11-statusdone";
      await upsertDoc<any>("comms", {
        id: "C-t11-echo",
        mailbox: "sales",
        unread: false,
        archived: false,
        customerId: "lakefront",
        customer: "Lakefront",
        contactName: "Echo Tester",
        contactEmail: "echo@t11-echo.example",
        subject: "Echo test",
        channel: "email",
        status: "closed",
        assignedTo: "",
        link: null,
        messages: [
          {
            id: "m1",
            at: Date.now(),
            direction: "in",
            channel: "email",
            author: "Echo Tester",
            body: "Hi",
            gmailId: "g-t11-echo-m1",
            // The writer already applied Peak/Status/Done to this message —
            // this is what makes the upcoming labelAdded event an echo of
            // our own write rather than a person's action.
            gmailLabelIds: [doneLabelId],
          },
        ],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        rev: 1,
        gmailThreadId: "g-t11-thread-echo",
        gmailAccountKey: mailboxKey,
        resolution: "linked",
        // Within the 2-minute echo window.
        peakLabelsAppliedAt: Date.now(),
      } as any);

      const appliedEcho = await interpretLabelEvents(mailboxKey, [
        { messageId: "g-t11-echo-m1", threadId: "g-t11-thread-echo", added: [doneLabelId], removed: [] },
      ]);
      assert.equal(appliedEcho, 0, "#96 echo window: a labelAdded event matching our own recent write applies no command");
      const echoThread = await getDoc<CommThread>("comms", "C-t11-echo");
      assert.equal(echoThread?.status, "closed", "#96 echo window: thread status did not change");
      assert.equal((echoThread as any)?.rev, 1, "#96 echo window: setStatus never ran a second time (rev unchanged) — proves the echo was actually suppressed, not just naturally idempotent");

      // A genuinely new label — one the thread does NOT currently want — on
      // the same recently-synced thread must still be processed, proving the
      // suppression is scoped to matching echoes, not a blanket window mute.
      // Uses a fresh, unambiguous assignee/label pair (Chris Alpha/Beta above
      // are deliberately ambiguous for the earlier test).
      await addUser({ name: "Dana Echo" });
      await replaceLabels(mailboxKey, [
        { id: "L-t11-newlead", name: "Peak/New lead", type: "user" },
        { id: "L-t11-statusdone", name: "Peak/Status/Done", type: "user" },
        { id: "L-t11-assignchris", name: "Peak/Assign/Chris", type: "user" },
        { id: "L-t11-assigndana", name: "Peak/Assign/Dana", type: "user" },
      ]);
      const appliedGenuine = await interpretLabelEvents(mailboxKey, [
        { messageId: "g-t11-echo-m1", threadId: "g-t11-thread-echo", added: ["L-t11-assigndana"], removed: [] },
      ]);
      assert.equal(appliedGenuine, 1, "#96 echo window: a genuinely new label on the same thread is still processed, not swallowed by the window");
      const genuineThread = await getDoc<CommThread>("comms", "C-t11-echo");
      assert.equal(genuineThread?.assignedTo, "Dana Echo", "#96 echo window: the genuine assign command actually applied");
    }
  }

  // #133 — pricedAt moves only when list/cost change; the book date round-trips
  {
    const { get: getPart, mergeUpsert } = await import("@/lib/stores/catalog");
    const { getSettings, setPriceListEffective } = await import("@/lib/settings");
    const D1 = new Date(2026, 0, 15).getTime();
    const D2 = new Date(2026, 5, 1).getTime();
    await mergeUpsert("T133-STAMP", { desc: "Stamp test", category: "Test", unit: "ea", list: 100, cost: 60, mfr: "T133 Stamp" }, { pricedAt: D1 });
    assert.equal((await getPart("T133-STAMP"))?.pricedAt, D1, "#133 a new part is stamped with the write's effective date");
    await mergeUpsert("T133-STAMP", { desc: "Stamp test (renamed)", list: 100, cost: 60 }, { pricedAt: D2 });
    assert.equal((await getPart("T133-STAMP"))?.pricedAt, D1, "#133 an unchanged price keeps its date — a description edit doesn't move it");
    await mergeUpsert("T133-STAMP", { list: 110 }, { pricedAt: D2 });
    assert.equal((await getPart("T133-STAMP"))?.pricedAt, D2, "#133 a list change stamps the effective date that was passed");
    const before = Date.now();
    await mergeUpsert("T133-STAMP", { cost: 70 });
    const stamped = (await getPart("T133-STAMP"))?.pricedAt ?? 0;
    assert.ok(stamped >= before, "#133 a price change through any other path stamps now");
    assert.equal((await getPart("T133-STAMP"))?.desc, "Stamp test (renamed)", "#133 mergeUpsert still preserves fields the patch doesn't carry");

    await setPriceListEffective("t133stamp", D1);
    assert.equal((await getSettings()).priceListEffective?.t133stamp, D1, "#133 setPriceListEffective round-trips through settings");
    await setPriceListEffective("t133stamp", null);
    assert.equal((await getSettings()).priceListEffective?.t133stamp, undefined, "#133 setPriceListEffective(null) clears the key");
  }

  // #132/#133/#134 — the Catalog page importer's body (importCatalog itself needs a session + redirects)
  {
    const { runCatalogImport } = await import("@/app/(app)/catalog/import");
    const { get: getPart } = await import("@/lib/stores/catalog");
    const { getSettings } = await import("@/lib/settings");
    const D1 = new Date(2026, 0, 15).getTime();
    const D2 = new Date(2026, 5, 1).getTime();
    const csv = "SKU,Description,Category,Unit,List,Cost\nT133-A,Test part A,Test,ea,100,60\nT133-B,Test part B,Test,ea,200,120\n";
    const first = await runCatalogImport({ mfr: "T133 Acme", text: csv, bytes: Buffer.byteLength(csv), effectiveAt: D1, defaultCategory: "" });
    assert.ok(first.ok && first.imported === 2 && first.mfr === "T133 Acme", "#133 first import writes both rows under the typed manufacturer");
    assert.equal((await getPart("T133-A"))?.pricedAt, D1, "#133 a new part carries the import's effective date");
    assert.equal((await getSettings()).priceListEffective?.t133acme, D1, "#133 the import records the manufacturer's price-list effective date (D156)");

    const csv2 = "SKU,Description,Category,Unit,List,Cost\nT133-A,Test part A (renamed),Test,ea,100,60\nT133-B,Test part B,Test,ea,210,120\n";
    const second = await runCatalogImport({ mfr: "t133-acme", text: csv2, bytes: Buffer.byteLength(csv2), effectiveAt: D2, defaultCategory: "" });
    assert.ok(second.ok && second.mfr === "T133 Acme", "#132 a re-spelled manufacturer normalizes to the existing spelling");
    assert.equal((await getPart("T133-A"))?.pricedAt, D1, "#133 an unchanged price keeps its date across a re-import");
    assert.equal((await getPart("T133-B"))?.pricedAt, D2, "#133 a changed list price stamps the new effective date");
    assert.equal((await getPart("T133-A"))?.mfr, "T133 Acme", "#132 rows are filed under the normalized spelling");

    const wrong = await runCatalogImport({ mfr: "T133 Acme", text: "SKU,Description\nT133-Z,Zed\n", bytes: 30, effectiveAt: D2, defaultCategory: "" });
    assert.ok(!wrong.ok && /None of the 1 SKU in this file belong to T133 Acme/.test(wrong.error), "#132 zero overlap with an existing manufacturer is rejected with the SKU count");
    const foreign = await runCatalogImport({ mfr: "T133 Other", text: "SKU,Description\nT133-A,Stolen\n", bytes: 30, effectiveAt: D2, defaultCategory: "" });
    assert.ok(!foreign.ok && /T133-A is filed under T133 Acme/.test(foreign.error), "#132 a SKU filed under another manufacturer is named in the error");
    assert.equal((await getPart("T133-A"))?.mfr, "T133 Acme", "#132 a rejected import writes nothing");
    const blank = await runCatalogImport({ mfr: "", text: csv, bytes: 100, effectiveAt: D2, defaultCategory: "" });
    assert.ok(!blank.ok && /Choose a manufacturer/.test(blank.error), "#132 a blank manufacturer is rejected server-side");
    const big = await runCatalogImport({ mfr: "T133 Acme", text: csv, bytes: 1_048_577, effectiveAt: D2, defaultCategory: "" });
    assert.ok(!big.ok && /1 MB/.test(big.error), "#134 an over-size upload is refused before parsing");

    // Final review item 3 — a file without a List/Cost column must neither
    // zero the stored prices nor date the manufacturer's book (D156: a file
    // confirms only the prices it carries).
    const D3 = new Date(2026, 8, 1).getTime();
    const descOnly = "SKU,Description\nT133-A,Test part A (desc only)\n";
    const noPrices = await runCatalogImport({ mfr: "T133 Acme", text: descOnly, bytes: Buffer.byteLength(descOnly), effectiveAt: D3, defaultCategory: "" });
    assert.ok(noPrices.ok && noPrices.imported === 1, "item 3: a SKU+description file still imports");
    const afterDescOnly = await getPart("T133-A");
    assert.equal(afterDescOnly?.desc, "Test part A (desc only)", "item 3: …and updates the description");
    assert.equal(afterDescOnly?.list, 100, "item 3: an absent List column leaves the stored list price alone (not zeroed)");
    assert.equal(afterDescOnly?.cost, 60, "item 3: an absent Cost column leaves the stored cost alone (not zeroed)");
    assert.equal(afterDescOnly?.pricedAt, D1, "item 3: …so pricedAt does not move");
    assert.equal((await getSettings()).priceListEffective?.t133acme, D2, "item 3: a price-less file does NOT re-date the manufacturer's book");
    const withPrices = "SKU,Description,List,Cost\nT133-A,Test part A,120,60\n";
    const priced = await runCatalogImport({ mfr: "T133 Acme", text: withPrices, bytes: Buffer.byteLength(withPrices), effectiveAt: D3, defaultCategory: "" });
    assert.ok(priced.ok, "item 3: a file with prices still imports");
    assert.equal((await getPart("T133-A"))?.list, 120, "item 3: …and a carried List price still updates");
    assert.equal((await getPart("T133-A"))?.pricedAt, D3, "item 3: …stamping the changed line");
    assert.equal((await getSettings()).priceListEffective?.t133acme, D3, "item 3: …and re-dating the manufacturer's book");
  }

  // #132/#133 — the Import hub's catalog writer stamps the commit's effective date
  {
    const { commitImport } = await import("@/app/(app)/import/registry");
    const { parseCsv, autoMap, prepareRows } = await import("@/app/(app)/import/parse");
    const { getTypeMeta } = await import("@/app/(app)/import/types");
    const { get: getPart } = await import("@/lib/stores/catalog");
    const t = getTypeMeta("catalog");
    assert.ok(t, "#132 catalog import type exists");
    const D1 = new Date(2026, 0, 15).getTime();
    const D2 = new Date(2026, 5, 1).getTime();
    const prepOf = (csv: string) => {
      const p = parseCsv(csv);
      return prepareRows(p.rows, autoMap(p.headers, t!.fields), t!.fields);
    };
    const created = await commitImport("catalog", prepOf("SKU,Description,List Price,Cost,Manufacturer\nT133-H1,Hub part,50,30,T133 Hub\n").rows, "update", { effectiveAt: D1 });
    assert.equal(created.created, 1, "#133 hub create path wrote the row");
    assert.equal((await getPart("T133-H1"))?.pricedAt, D1, "#133 the hub stamps the commit's effective date on a new part");
    const same = await commitImport("catalog", prepOf("SKU,Description,List Price,Cost,Manufacturer\nT133-H1,Hub part renamed,50,30,T133 Hub\n").rows, "update", { effectiveAt: D2 });
    assert.equal(same.updated, 1, "#133 hub update path ran");
    assert.equal((await getPart("T133-H1"))?.pricedAt, D1, "#133 an unchanged price through the hub keeps its date");
    await commitImport("catalog", prepOf("SKU,Description,List Price,Cost,Manufacturer\nT133-H1,Hub part,55,30,T133 Hub\n").rows, "update", { effectiveAt: D2 });
    assert.equal((await getPart("T133-H1"))?.pricedAt, D2, "#133 a changed price through the hub stamps the new date");
    const invalid = await commitImport("catalog", prepOf("SKU,Description,List Price,Cost\nT133-H2,No manufacturer,50,30\n").rows, "update", { effectiveAt: D2 });
    assert.equal(invalid.errored, 1, "#132 a hub row without a manufacturer is never written");
    assert.equal(await getPart("T133-H2"), null, "#132 …and does not exist afterwards");

    // Final review item 3 — "Create new" on a SKU that already exists is a
    // merge (the SKU is the document id), so an absent price column must
    // preserve the stored price exactly like "Update existing" does (#81).
    const D3 = new Date(2026, 8, 1).getTime();
    const createDescOnly = await commitImport("catalog", prepOf("SKU,Description,Manufacturer\nT133-H1,Hub part (desc only),T133 Hub\n").rows, "create", { effectiveAt: D3 });
    assert.equal(createDescOnly.created, 1, "item 3: hub create mode on an existing SKU runs the create path");
    const afterCreate = await getPart("T133-H1");
    assert.equal(afterCreate?.desc, "Hub part (desc only)", "item 3: …and updates the description");
    assert.equal(afterCreate?.list, 55, "item 3: hub create mode keeps the stored list price when the file has no List column");
    assert.equal(afterCreate?.cost, 30, "item 3: …and the stored cost when it has no Cost column");
    assert.equal(afterCreate?.pricedAt, D2, "item 3: …so pricedAt does not move");

    // Final review item 1 (D156) — the hub's manufacturer book date is
    // stamped per manufacturer group, only for groups the commit actually
    // wrote: "Skip duplicates" compares nothing, so it confirms nothing.
    // commitCatalogImport is importRecords' body (guard → normalize →
    // commitImport → stamp), split out so it runs here without a session.
    const { commitCatalogImport } = await import("@/app/(app)/import/catalog-commit");
    const { getSettings } = await import("@/lib/settings");
    assert.equal((await getSettings()).priceListEffective?.t133hub, undefined, "item 1: precondition — T133 Hub has no book date yet");
    const skipped = await commitCatalogImport({ rows: prepOf("SKU,Description,List Price,Cost,Manufacturer\nT133-H1,Hub part,55,30,T133 Hub\n").rows, mode: "skip", effectiveAt: D3, priced: true });
    assert.ok(skipped.ok && skipped.res.skipped === 1 && skipped.stamped.length === 0, "item 1: skip mode skips the existing SKU and stamps no book");
    assert.equal((await getSettings()).priceListEffective?.t133hub, undefined, "item 1: a skip-mode commit leaves priceListEffective[key] undefined");
    const updated = await commitCatalogImport({ rows: prepOf("SKU,Description,List Price,Cost,Manufacturer\nT133-H1,Hub part,55,30,t133-hub\n").rows, mode: "update", effectiveAt: D3, priced: true });
    assert.ok(updated.ok && updated.res.updated === 1 && updated.res.written.length === 1, "item 1: update mode writes the row (commitImport reports the written rows)");
    assert.deepEqual(updated.ok ? updated.stamped : [], ["t133hub"], "item 1: …and stamps exactly that manufacturer's book, keyed through mfrKey");
    assert.equal((await getSettings()).priceListEffective?.t133hub, D3, "item 1: an update-mode commit sets priceListEffective[key] to the effective date (an unchanged price still confirms the list)");
    assert.equal((await getPart("T133-H1"))?.pricedAt, D2, "item 1: …while the unchanged line keeps its own pricedAt");
    const D4 = new Date(2026, 8, 15).getTime();
    const unpriced = await commitCatalogImport({ rows: prepOf("SKU,Description,Manufacturer\nT133-H1,Hub part (desc only),T133 Hub\n").rows, mode: "update", effectiveAt: D4, priced: false });
    assert.ok(unpriced.ok && unpriced.res.updated === 1 && unpriced.stamped.length === 0, "item 1/3: a price-less file writes the description but confirms no price");
    assert.equal((await getSettings()).priceListEffective?.t133hub, D3, "item 1/3: …so the hub does not re-date the book either");
    const mixed = await commitCatalogImport({
      rows: prepOf("SKU,Description,List Price,Cost,Manufacturer\n,Blank SKU,1,1,T133 Hub\nT133-H1,Hub part,55,30,T133 Hub\nT133-H3,Other maker's part,10,5,T133 Hub Two\n").rows,
      mode: "update",
      effectiveAt: D4,
      priced: true,
    });
    assert.ok(mixed.ok && mixed.res.errored === 1 && mixed.res.updated === 1 && mixed.res.created === 1 && mixed.res.failed.length === 1, "item 1: a file with one bad row still writes the good rows");
    assert.deepEqual(mixed.ok ? mixed.stamped : [], ["t133hubtwo"], "item 1: per-group — the clean manufacturer is stamped, the one with an errored row is not");
    assert.equal((await getSettings()).priceListEffective?.t133hub, D3, "item 1: …so T133 Hub keeps its earlier date");
    assert.equal((await getSettings()).priceListEffective?.t133hubtwo, D4, "item 1: …and T133 Hub Two gets the file's date");
    const foreign = await commitCatalogImport({ rows: prepOf("SKU,Description,List Price,Cost,Manufacturer\nT133-H1,Hub part,99,30,T133 Other\n").rows, mode: "update", effectiveAt: D4, priced: true });
    assert.ok(!foreign.ok && /T133 Other: .*T133-H1 is filed under T133 Hub/.test(foreign.error), "item 1: the guard still runs first and names the manufacturer + SKU");
    assert.equal((await getPart("T133-H1"))?.list, 55, "item 1: …and a rejected commit writes nothing");
  }
  // #135 (D155) — a manual consulting project: created by hand, listed by
  // the hub, ignored by the sweep, and later linked to a proposal without
  // its milestones changing.
  await syncEngagementsFromQuotes(); // settle any quote-born rows first
  const manual = await createManualEngagement(
    {
      customerId: "t135-co",
      customer: "T135 School District",
      name: "T135 Auditorium study",
      architect: { company: "T135 Architects", contact: "Pat" },
      siteId: "t135-site",
      contactName: "Sam",
      fee: { mode: "fixed", amount: 8000 },
      phases: ["Assessment", "Schematic Design"],
    },
    { name: "Tester" }
  );
  assert.equal(manual.origin, "manual", "#135 manual row is stamped origin=manual");
  assert.equal(manual.quoteId, null, "#135 manual row has no quote");
  assert.equal(manual.status, "awarded", "#135 manual row is born awarded");
  assert.deepEqual(manual.milestones.map((m) => [m.name, m.amount, m.targetDate]), [["Fee", 8000, 0]], "#135 fixed fee → one unscheduled Fee milestone");
  assert.deepEqual(manual.phases.map((p) => p.name), ["Assessment", "Schematic Design"], "#135 phases come from the menu the action resolved");
  assert.deepEqual(manual.siteIds, ["t135-site"], "#135 venue link kept");
  const t135Before = (await allEngagements()).length;
  await syncEngagementsFromQuotes();
  const t135After = await allEngagements();
  assert.equal(t135After.length, t135Before, "#135 the sweep neither duplicates nor drops the manual row");
  assert.ok(t135After.some((e) => e.id === manual.id), "#135 the manual row is in the hub list");
  const t135Still = await getEngagement(manual.id);
  assert.equal(t135Still?.status, "awarded", "#135 the sweep leaves the manual row's stage alone");
  assert.equal(t135Still?.milestones.length, 1, "#135 the sweep leaves the manual row's milestones alone");
  // Attach a WON consulting proposal (#135 review fix) — won, not draft, so
  // engagementSyncAction has a real action to compute for "Q-t135-attach"
  // and the next sweep actually exercises the index: a broken/missing
  // sweepIndexesEngagement would fail to find this row by quoteId, see
  // current=null, and mint a duplicate awarded engagement
  // (engagementSyncAction("won", null) => create). A draft quote can never
  // surface that bug — engagementSyncAction("draft", …) is always null, so
  // the assertions below would pass whether or not the index worked. The
  // quote is created only now (after the earlier settling sweeps), so no
  // sweep-born row exists yet to collide with the id.
  await upsertDoc("quotes", { ...quote, id: "Q-t135-attach", status: "won" } as Quote & Record<string, unknown>);
  const attachResult = await attachQuoteToEngagement(manual.id, "Q-t135-attach");
  assert.equal(attachResult.ok, true, "#135 attach succeeds on a manual row with no proposal yet");
  if (!attachResult.ok) throw new Error("unreachable: attachResult.ok was just asserted true");
  assert.equal(attachResult.engagement.quoteId, "Q-t135-attach", "#135 attach sets quoteId");
  assert.equal(attachResult.engagement.origin, "manual", "#135 attach keeps origin=manual (provenance)");
  assert.equal(attachResult.engagement.milestones.length, 1, "#135 attach never rewrites milestones");
  const t135AttachedUpdatedAt = attachResult.engagement.updatedAt;
  await syncEngagementsFromQuotes();
  const t135Twice = await allEngagements();
  assert.equal(t135Twice.filter((e) => e.quoteId === "Q-t135-attach").length, 1, "#135 the sweep never mints a second engagement for an attached (won) proposal");
  const t135AfterSweep = await getEngagement(manual.id);
  assert.equal(t135AfterSweep?.id, manual.id, "#135 the sweep leaves the manual row's id unchanged");
  assert.equal(t135AfterSweep?.origin, "manual", "#135 the sweep leaves the manual row's origin unchanged");
  assert.equal(t135AfterSweep?.status, "awarded", "#135 an awarded manual row is never demoted by the sweep");
  assert.deepEqual(
    t135AfterSweep?.milestones.map((m) => [m.name, m.amount, m.targetDate]),
    [["Fee", 8000, 0]],
    "#135 the sweep leaves the manual row's milestones unchanged"
  );
  assert.equal(
    t135AfterSweep?.updatedAt,
    t135AttachedUpdatedAt,
    "#135 the sweep does not re-save the manual row at all — won+awarded computes no action"
  );

  // Negative paths (#135 review fix) — attachQuoteToEngagement now enforces
  // the one-engagement-per-quote invariant instead of patching blindly.
  const alreadyAttached = await attachQuoteToEngagement(manual.id, "Q-t135-second");
  assert.equal(alreadyAttached.ok, false, "#135 attach refuses a project that already has a proposal");
  if (alreadyAttached.ok) throw new Error("unreachable: alreadyAttached.ok was just asserted false");
  assert.equal(
    alreadyAttached.error,
    "This project already has a proposal attached.",
    "#135 already-attached refusal carries a plain-English error"
  );

  const secondManual = await createManualEngagement(
    {
      customerId: "t135b-co",
      customer: "T135b School District",
      name: "T135b Gym study",
      fee: null,
      phases: ["Assessment"],
    },
    { name: "Tester" }
  );
  await upsertDoc("quotes", { ...quote, id: "Q-t135-notconsulting", quoteType: "flame" } as Quote & Record<string, unknown>);
  const nonConsulting = await attachQuoteToEngagement(secondManual.id, "Q-t135-notconsulting");
  assert.equal(nonConsulting.ok, false, "#135 attach refuses a quote that is not quoteType 'consulting'");

  const claimed = await attachQuoteToEngagement(secondManual.id, "Q-t135-attach");
  assert.equal(claimed.ok, false, "#135 attach refuses a quote already claimed by another engagement");
  if (claimed.ok) throw new Error("unreachable: claimed.ok was just asserted false");
  assert.equal(
    claimed.error,
    "That proposal already belongs to T135 Auditorium study.",
    "#135 already-claimed refusal names the owning engagement"
  );

  // Fee validation (#135 review fix) — createManualEngagementAction is the
  // guard; the STORE stays permissive so a project with no fee at all still
  // creates cleanly. These two pin the store half of that contract: no fee
  // yields zero milestones (already true — asserted here for the first
  // time), and a fixed fee of 0 ALSO yields zero milestones, documenting
  // why the action must reject `{ mode: "fixed", amount: 0 }` itself rather
  // than trust manualMilestoneSeeds' silence to catch it. The action can't
  // be called from this harness (requirePerm needs a session), so these
  // stay at the store layer.
  const noFeeManual = await createManualEngagement(
    {
      customerId: "t135c-co",
      customer: "T135c School District",
      name: "T135c No-fee study",
      phases: ["Assessment"],
    },
    { name: "Tester" }
  );
  assert.equal(noFeeManual.milestones.length, 0, "#135 fee: undefined yields zero milestones at the store");

  const zeroFixedManual = await createManualEngagement(
    {
      customerId: "t135d-co",
      customer: "T135d School District",
      name: "T135d Zero-fee study",
      fee: { mode: "fixed", amount: 0 },
      phases: ["Assessment"],
    },
    { name: "Tester" }
  );
  assert.equal(
    zeroFixedManual.milestones.length,
    0,
    '#135 { mode: "fixed", amount: 0 } yields zero milestones at the store — the action must guard this itself'
  );

  // #137 T1 — zip / kind / phone / website / mobile plumbing through the customer seam
  {
    await upsertCustomer({
      id: "c-t137-plumb", name: "T137 Plumbing Playhouse", type: "Performing arts",
      zip: "53703", phone: "(608) 555-0100", website: "t137.example",
      locations: [{ id: "l-t137-1", label: "Main Stage", primary: true, address: "215 W Main St", city: "Madison", state: "WI", zip: "53703-1234", kind: "theatre" }],
      contacts: [{ name: "Maria Lopez", email: "maria@t137.example", phone: "(608) 555-0110", mobile: "(608) 555-0111", primary: true }],
    });
    const a = await getCustomer("c-t137-plumb");
    assert.ok(a, "#137 T1 customer written");
    assert.equal(a!.zip, "53703", "#137 T1 company zip persists (companies.zip)");
    assert.equal(a!.phone, "(608) 555-0100", "#137 T1 company phone persists (companies.main_phone)");
    assert.equal(a!.website, "t137.example", "#137 T1 company website persists");
    assert.equal(a!.locations[0].zip, "53703-1234", "#137 T1 venue zip persists (ZIP+4 kept as typed)");
    assert.equal(a!.locations[0].kind, "theatre", "#137 T1 venue kind persists (sites.kind)");
    assert.equal(a!.contacts[0].mobile, "(608) 555-0111", "#137 T1 contact mobile persists as a mobile-labelled phone");
    assert.equal(a!.contacts[0].phone, "(608) 555-0110", "#137 T1 …and the work phone is still `phone`");

    // A writer that doesn't carry the new fields (the Companies modal shape)
    // preserves them AND does not register as a change (D83).
    await upsertCustomer({
      id: "c-t137-plumb", name: "T137 Plumbing Playhouse", type: "Performing arts",
      locations: [{ id: "l-t137-1", label: "Main Stage", primary: true, address: "215 W Main St", city: "Madison", state: "WI" }],
      contacts: [{ name: "Maria Lopez", email: "maria@t137.example", phone: "(608) 555-0110", primary: true }],
    });
    const b = await getCustomer("c-t137-plumb");
    assert.equal(b!.zip, "53703", "#137 T1 company zip preserved when a writer omits it");
    assert.equal(b!.phone, "(608) 555-0100", "#137 T1 company phone preserved when a writer omits it");
    assert.equal(b!.locations[0].zip, "53703-1234", "#137 T1 venue zip preserved when a writer omits it");
    assert.equal(b!.locations[0].kind, "theatre", "#137 T1 venue kind preserved when a writer omits it");
    assert.equal(b!.contacts[0].mobile, "(608) 555-0111", "#137 T1 contact mobile preserved when a writer omits it");
    assert.equal(b!.updatedAt, a!.updatedAt, "#137 T1 an omit-everything re-save is a no-change write (updatedAt unchanged)");

    // …and a writer that carries a value writes it.
    await upsertCustomer({
      id: "c-t137-plumb", name: "T137 Plumbing Playhouse", type: "Performing arts", zip: "53704",
      locations: [{ id: "l-t137-1", label: "Main Stage", primary: true, address: "215 W Main St", city: "Madison", state: "WI", zip: "53704" }],
      contacts: [{ name: "Maria Lopez", email: "maria@t137.example", phone: "(608) 555-0110", primary: true }],
    });
    const c = await getCustomer("c-t137-plumb");
    assert.equal(c!.zip, "53704", "#137 T1 a provided company zip overwrites");
    assert.equal(c!.locations[0].zip, "53704", "#137 T1 a provided venue zip overwrites");
    assert.equal(c!.contacts[0].mobile, "(608) 555-0111", "#137 T1 mobile survives a zip-only change");

    assert.equal((await findCustomerByName("t-137 plumbing PLAYHOUSE!"))?.id, "c-t137-plumb", "#137 T1 findCustomerByName matches case/punctuation-insensitively");
    assert.equal(await findCustomerByName("nobody t137"), null, "#137 T1 findCustomerByName: unknown → null");
    assert.equal((await findCustomerById("c-t137-plumb"))?.name, "T137 Plumbing Playhouse", "#137 T1 findCustomerById");
    assert.ok((await allCustomers()).some((x) => x.id === "c-t137-plumb"), "#137 T1 all() lists it");

    // Re-creating a soft-deleted id (Companies "remove" → a later upsert with
    // the same id, e.g. a re-import) must keep matching the surviving contact
    // rows by name — softDeleteCompany leaves them on the company — so the
    // revival neither duplicates them nor drops their phone/mobile channels.
    await removeCustomer("c-t137-plumb");
    assert.equal(await getCustomer("c-t137-plumb"), null, "#137 T1 soft-deleted customer no longer composes");
    assert.equal(await findCustomerByName("T137 Plumbing Playhouse"), null, "#137 T1 findCustomerByName ignores soft-deleted companies");
    await upsertCustomer({
      id: "c-t137-plumb", name: "T137 Plumbing Playhouse", type: "Performing arts",
      locations: [{ id: "l-t137-1", label: "Main Stage", primary: true, city: "Madison", state: "WI" }],
      contacts: [{ name: "Maria Lopez", email: "maria@t137.example", primary: true }],
    });
    const d = await getCustomer("c-t137-plumb");
    assert.equal(d!.contacts.length, 1, "#137 T1 revived id re-matches the surviving contact by name (no duplicate row)");
    assert.equal(d!.contacts[0].phone, "(608) 555-0110", "#137 T1 revived contact keeps its work phone");
    assert.equal(d!.contacts[0].mobile, "(608) 555-0111", "#137 T1 revived contact keeps its mobile channel");
  }

  console.log("review regression checks passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
