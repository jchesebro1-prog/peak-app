import assert from "node:assert/strict";
import { setRates as setFlameRates, getRates as getFlameRates } from "@/lib/flametest-engine";
import { setRates as setRepairRates, getRates as getRepairRates } from "@/lib/repair-engine";
import { setRates as setInspectionRates, getRates as getInspectionRates } from "@/lib/inspection-engine";
import { ensureEngagementForQuote } from "@/lib/stores/engagements";
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
import { get as getLead } from "@/lib/stores/leads";

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
  }

  console.log("review regression checks passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
