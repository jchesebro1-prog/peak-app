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
import { getDoc, upsertDoc, patchDoc } from "@/db/doc-store";
import { withTransaction } from "@/db";
import type { Quote } from "@/lib/stores/quotes";
import { contactByEmail } from "@/lib/identity/lookup";
import { contactsForCompany, emailsFor, saveContact, setEmails, softDeleteContact } from "@/lib/identity/contacts";
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
import { getCompany, saveCompany } from "@/lib/identity/companies";
import { sitesForCompany } from "@/lib/identity/sites";
import { VENDOR_COMPANY_TYPE } from "@/lib/identity/config";
import {
  claimManufacturer, createVendorCompany, getVendorProfile, isVendorCompany, logPriceList,
  saveVendorProfile, setContactRole, vendorCompanyNamed, vendorForManufacturer,
} from "@/lib/stores/vendors";
import { setSettings } from "@/lib/settings";
import { allAssignments, createAssignment, setAssignmentDone } from "@/lib/stores/assignments";
import { ensureVendorAssignments, loadVendors } from "@/lib/vendor-tasks";
import { loadQueue } from "@/lib/queue";
import {
  upsert as upsertCustomer,
  get as getCustomer,
  all as allCustomers,
  remove as removeCustomer,
  findCustomerByName,
  findCustomerById,
} from "@/lib/stores/customers";
import { commitImport, exportCsv } from "@/app/(app)/import/registry";
import { getTypeMeta } from "@/app/(app)/import/types";
import { autoMap, norm, parseCsv, prepareRows } from "@/app/(app)/import/parse";

/** #137 — CSV text → the prepared rows commitImport takes, through the same
 *  parse / autoMap / prepareRows path the import action runs. */
function prepImport(key: string, csv: string) {
  const type = getTypeMeta(key);
  if (!type) throw new Error(`unknown import type ${key}`);
  const p = parseCsv(csv);
  if (!p.ok) throw new Error(`CSV did not parse: ${p.error}`);
  return prepareRows(p.rows, autoMap(p.headers, type.fields), type.fields).rows;
}

async function main() {
  // Engineering batch B1 — ambient transactions must roll back doc-store
  // writes, including writes made through a nested helper transaction.
  const txProbe = `engineering-tx-${Date.now()}`;
  await assert.rejects(
    withTransaction(async () => {
      await upsertDoc("quotes", { id: txProbe, value: "rolled-back" } as any);
      await withTransaction(async () => {
        await patchDoc("quotes", txProbe, (doc: any) => ({ ...doc, nested: true }));
      });
      throw new Error("intentional transaction rollback");
    }),
    /intentional transaction rollback/,
    "B1 transaction failure propagates",
  );
  assert.equal(await getDoc("quotes", txProbe), null, "B1 failed transaction rolls back nested doc writes");

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

  // #131 T10 (review fix) — cleanGridCategoryShapes is the exact "clean or
  // null" step saveGridCategoryShapesAction persists (factored out to a
  // pure helper since the action itself needs a session): an empty map
  // must collapse to null — never {}, which resolveCategoryShapes treats
  // as the whole truth and would drop every category to "rect" — a valid
  // entry round-trips, and an invalid shape is dropped while a valid
  // sibling entry survives.
  {
    const { cleanGridCategoryShapes } = await import("@/lib/design/grid-symbols");
    assert.equal(cleanGridCategoryShapes({}), null, "#131 T10 an empty map collapses to null, not {}");
    assert.deepEqual(
      cleanGridCategoryShapes({ Speakers: "circle" }),
      { Speakers: "circle" },
      "#131 T10 a valid category/shape pair round-trips"
    );
    assert.deepEqual(
      cleanGridCategoryShapes({ Speakers: "circle", Lighting: "not-a-shape" }),
      { Speakers: "circle" },
      "#131 T10 an invalid shape is dropped while a valid sibling entry is kept"
    );
  }

  // #122 — vendor profiles: CRUD, claim moves a manufacturer, vendors get no base venue
  {
    await saveCompany({ id: "v-t122a", name: "Vendor A T122", type: VENDOR_COMPANY_TYPE });
    await saveCompany({ id: "v-t122b", name: "Vendor B T122", type: VENDOR_COMPANY_TYPE });
    assert.equal(await getVendorProfile("v-t122a"), null, "#122 no profile document until something is saved");
    const saved = await saveVendorProfile("v-t122a", { discounts: { note: "Dealer program", percentOffList: 35, terms: "Net 30" } });
    assert.equal(saved.discounts.percentOffList, 35, "#122 saveVendorProfile writes discounts");
    assert.equal((await getVendorProfile("v-t122a"))?.discounts.terms, "Net 30", "#122 the profile round-trips through the doc table");
    await claimManufacturer("v-t122a", "T122 Mfr");
    assert.equal(await vendorForManufacturer("t122-mfr"), "v-t122a", "#122 claim matches by mfrKey (case/punctuation-insensitive)");
    await claimManufacturer("v-t122b", "t122 MFR");
    assert.equal(await vendorForManufacturer("T122 Mfr"), "v-t122b", "#122 claiming moves the manufacturer to the new vendor");
    assert.deepEqual((await getVendorProfile("v-t122a"))?.manufacturers, [], "#122 the previous owner no longer lists it");
    await setContactRole("v-t122b", "ct-t122-x", "Price lists");
    assert.equal((await getVendorProfile("v-t122b"))?.contactRoles["ct-t122-x"], "Price lists", "#122 contact role is stored by contact id");
    await setContactRole("v-t122b", "ct-t122-x", "   ");
    assert.equal((await getVendorProfile("v-t122b"))?.contactRoles["ct-t122-x"], undefined, "#122 a blank role clears the entry");
    const logged = await logPriceList("v-t122b", { receivedAt: 1_000, effectiveAt: 500, note: "old" }, "Tester");
    await logPriceList("v-t122b", { receivedAt: 2_000, effectiveAt: 900, note: "newer" }, "Tester");
    assert.equal(logged.priceLists.length, 1, "#122 logPriceList appends one entry");
    assert.equal((await getVendorProfile("v-t122b"))?.priceLists[0]?.note, "newer", "#122 ledger is newest-first by effectiveAt");
    const made = await createVendorCompany("Acme Rigging T122");
    assert.equal(made.id, "v-acmeriggingt122", "#122 createVendorCompany mints v-<mfrKey>");
    assert.equal(made.type, VENDOR_COMPANY_TYPE, "#122 createVendorCompany presets the vendor type");
    assert.equal((await sitesForCompany(made.id)).length, 0, "#122 a new vendor gets NO base venue (PARTNER_TYPES fix)");
    assert.ok(await getVendorProfile(made.id), "#122 createVendorCompany mints the blank profile");
  }

  // #122 — owner tasks are exactly-once per (vendor, status, date); done ones never reopen
  {
    const part = (sku: string) => ({ id: sku, sku, desc: "T122 cron part " + sku, category: "Rigging", unit: "ea", list: 10, cost: 5, mfr: "T122 Cron Mfr" });
    await upsertDoc("catalog_parts", part("T122-C1"));
    await upsertDoc("catalog_parts", part("T122-C2"));
    await saveCompany({ id: "v-t122c", name: "Vendor C T122", type: VENDOR_COMPANY_TYPE });
    await claimManufacturer("v-t122c", "T122 Cron Mfr");
    const owner = await addUser({ name: "Catalog Owner T122", roles: ["Admin"] });
    await setSettings({ catalogOwner: { userId: owner.id } });

    const before = (await loadVendors("v-t122c")).rows[0];
    assert.equal(before?.status, "no-list", "#122 a vendor with no ledger entry reads no-list");
    assert.equal(before?.partCount, 2, "#122 loadVendors counts the claimed manufacturer's parts");
    assert.equal((await ensureVendorAssignments("v-t122c", "Tester")).created, 0, "#122 no-list creates no task");

    const E = Date.now() - 5 * 86_400_000;
    await logPriceList("v-t122c", { receivedAt: Date.now(), effectiveAt: E, note: "2026 list" }, "Tester");
    const key = `auto: vendor v-t122c newer-list ${E}`;
    const withKey = async () => (await allAssignments()).filter((a) => a.source === key);

    const first = await ensureVendorAssignments("v-t122c", "Tester");
    assert.equal(first.created, 1, "#122 a newer list creates exactly one owner task");
    assert.equal(first.owner, "Catalog Owner T122", "#122 the owner comes from settings.catalogOwner");
    const made = await withKey();
    assert.equal(made.length, 1, "#122 the task is keyed by source");
    assert.equal(made[0].assignee, "Catalog Owner T122", "#122 the task is addressed to the owner by display name");
    assert.equal(made[0].link?.kind, "company", "#122 the task links to the vendor company");
    assert.ok(made[0].title.startsWith("Update catalog: Vendor C T122 price list effective "), "#122 newer-list title");
    assert.equal((await loadVendors("v-t122c")).rows[0]?.openTask?.id, made[0].id, "#122 loadVendors surfaces the open task");

    assert.equal((await ensureVendorAssignments("v-t122c", "Tester")).created, 0, "#122 a second pass doesn't duplicate the open task");
    await setAssignmentDone(made[0].id, true);
    assert.equal((await ensureVendorAssignments("v-t122c", "Tester")).created, 0, "#122 a done task is never re-opened or re-created");
    assert.equal((await withKey()).length, 1, "#122 still exactly one assignment for the key");
    assert.equal((await loadVendors("v-t122c")).rows[0]?.openTask, null, "#122 a done task is no longer the open task");

    // a later import stamps pricedAt ≥ effectiveAt → current, nothing new
    await upsertDoc("catalog_parts", { ...part("T122-C1"), pricedAt: E });
    await upsertDoc("catalog_parts", { ...part("T122-C2"), pricedAt: E + 1 });
    assert.equal((await loadVendors("v-t122c")).rows[0]?.status, "current", "#122 pricedAt ≥ effectiveAt flips the status to current");
    assert.equal((await ensureVendorAssignments("v-t122c", "Tester")).created, 0, "#122 current creates nothing");
    assert.equal((await withKey()).length, 1, "#122 the done task stays done and alone");

    // the cron path with zero vendors in scope
    const none = await ensureVendorAssignments("v-t122-does-not-exist", "Tester");
    assert.deepEqual([none.checked, none.created], [0, 0], "#122 the cron path runs with zero vendors");
  }

  // #122 §3 — a ledger save spawns the owner task immediately, and that task's
  // Home Queue row lands on the vendor's own screen (not back on /queue).
  {
    const part = { id: "T122-D1", sku: "T122-D1", desc: "T122 detail part", category: "Rigging", unit: "ea", list: 10, cost: 5, mfr: "T122 Detail Mfr" };
    await upsertDoc("catalog_parts", part);
    await saveCompany({ id: "v-t122d", name: "Vendor D T122", type: VENDOR_COMPANY_TYPE });
    await claimManufacturer("v-t122d", "T122 Detail Mfr");

    const eff = Date.now() - 3 * 86_400_000;
    const key = `auto: vendor v-t122d newer-list ${eff}`;
    const withKey = async () => (await allAssignments()).filter((a) => a.source === key);

    // what logPriceListAction does: append the entry, then re-derive at once
    await logPriceList("v-t122d", { receivedAt: Date.now(), effectiveAt: eff, note: "2027 list" }, "Tester");
    assert.equal((await ensureVendorAssignments("v-t122d", "Tester")).created, 1, "#122 §3 a ledger save spawns the catalog-owner task right away, not just on the cron");
    assert.equal((await withKey()).length, 1, "#122 §3 …exactly one");

    // re-saving the SAME entry must not spawn a second task
    await logPriceList("v-t122d", { receivedAt: Date.now(), effectiveAt: eff, note: "2027 list again" }, "Tester");
    assert.equal((await ensureVendorAssignments("v-t122d", "Tester")).created, 0, "#122 §3 re-logging the same effective date spawns no second task");
    assert.equal((await withKey()).length, 1, "#122 §3 …still exactly one");

    const taskId = (await withKey())[0].id;
    const queued = (await loadQueue("Catalog Owner T122")).filter((i) => i.key === `assignment:${taskId}`);
    assert.equal(queued.length, 1, "#122 §3 the owner task shows on the owner's Home Queue");
    assert.equal(queued[0].href, "/vendors/v-t122d", "#122 §3 a company-linked assignment links to the vendor record, not back to /queue");
  }

  // #122 — claim from the unclaimed panel: reuse a vendor by normalized name, else create one
  {
    const reused = await vendorCompanyNamed("VENDOR-B T122");
    assert.equal(reused.id, "v-t122b", "#122 vendorCompanyNamed reuses a vendor whose name normalizes the same");
    const fresh = await vendorCompanyNamed("Wenger Corp T122");
    assert.equal(fresh.id, "v-wengercorpt122", "#122 vendorCompanyNamed creates a vendor named after the manufacturer");
    assert.equal(fresh.type, VENDOR_COMPANY_TYPE, "#122 …typed as a vendor");
    await claimManufacturer(fresh.id, "Wenger Corp T122");
    assert.equal(await vendorForManufacturer("wenger corp t122"), fresh.id, "#122 …and it owns the claimed manufacturer");
  }

  // #122 C1 — re-creating a vendor by the name of a SOFT-DELETED one must not
  // silently revive and overwrite it. The slug is taken by ANY company row,
  // deleted or not, so "+ New vendor" mints a fresh id; the deleted vendor
  // keeps its ledger, claims, discounts and contacts (the only history there
  // is — the profile doc has no versions to recover from).
  {
    const made = await createVendorCompany("Deleted Vendor T122");
    assert.equal(made.id, "v-deletedvendort122", "#122 C1 fixture: the first vendor takes the plain v-<mfrKey> slug");
    await upsertCustomer({
      id: made.id,
      name: "Deleted Vendor T122",
      type: VENDOR_COMPANY_TYPE,
      locations: [{ id: "l-t122-c1", label: "Warehouse", primary: true, address: "1 Dock Rd", city: "Madison", state: "WI" }],
      contacts: [{ name: "Dana Ledger", email: "dana@t122c1.example", primary: true }],
    });
    await claimManufacturer(made.id, "T122 C1 Mfr");
    await logPriceList(made.id, { receivedAt: 1_700_000_000_000, effectiveAt: 1_700_000_000_000, note: "2026 list" }, "Tester");
    await saveVendorProfile(made.id, { discounts: { note: "Dealer program", percentOffList: 20, terms: "Net 45" } });
    assert.equal((await contactsForCompany(made.id)).length, 1, "#122 C1 fixture: the vendor carries one contact");

    // The Edit button's Delete — deleteCustomerAction → softDeleteCompany.
    await removeCustomer(made.id);
    assert.equal(await getCompany(made.id), null, "#122 C1 fixture: the vendor reads as deleted");

    const again = await createVendorCompany("Deleted Vendor T122");
    assert.notEqual(again.id, made.id, "#122 C1 a soft-deleted slug is TAKEN — the re-created vendor gets its own id");
    assert.equal(await getCompany(made.id), null, "#122 C1 …and the deleted vendor is not resurrected by the re-create");
    const kept = await getVendorProfile(made.id);
    assert.equal(kept?.priceLists.length, 1, "#122 C1 the deleted vendor's price-list ledger survives");
    assert.deepEqual(kept?.manufacturers, ["T122 C1 Mfr"], "#122 C1 …its manufacturer claims survive");
    assert.equal(kept?.discounts.terms, "Net 45", "#122 C1 …and its discount terms survive");
    assert.equal(
      (await contactsForCompany(made.id)).length,
      1,
      "#122 C1 …and its contacts are not soft-deleted by the re-create's empty contacts list"
    );

    const born = await getVendorProfile(again.id);
    assert.ok(born, "#122 C1 the re-created vendor gets its own blank profile");
    assert.deepEqual(
      [born?.priceLists.length, born?.manufacturers.length],
      [0, 0],
      "#122 C1 …blank, sharing nothing with the deleted vendor's record"
    );
  }

  // #122 I1 — nothing cascades from softDeleteCompany to vendor_profiles, so a
  // deleted vendor's claims must stop counting as ownership: the manufacturer
  // returns to "Unclaimed manufacturers" (the only path back to a real vendor)
  // instead of labelling the Catalog link with a raw id that 404s.
  {
    await upsertDoc("catalog_parts", {
      id: "T122-I1", sku: "T122-I1", desc: "T122 I1 part", category: "Rigging", unit: "ea", list: 10, cost: 5, mfr: "T122 I1 Mfr",
    });
    const co = await createVendorCompany("Stranded Vendor T122");
    await claimManufacturer(co.id, "T122 I1 Mfr");
    const claimed = (await loadVendors(co.id)).directory.find((m) => m.name === "T122 I1 Mfr");
    assert.equal(claimed?.vendorId, co.id, "#122 I1 fixture: a live vendor owns the manufacturer");
    assert.equal(claimed?.vendorName, "Stranded Vendor T122", "#122 I1 fixture: …labelled by name, not by raw id");

    await removeCustomer(co.id);
    const after = (await loadVendors()).directory.find((m) => m.name === "T122 I1 Mfr");
    assert.equal(after?.vendorId, null, "#122 I1 a soft-deleted vendor's manufacturer reappears as unclaimed");
    assert.equal(after?.vendorName, "", "#122 I1 …with no dangling vendor link to label");
    assert.ok(
      (await getVendorProfile(co.id))?.manufacturers.includes("T122 I1 Mfr"),
      "#122 I1 …while the deleted vendor's own profile keeps the claim (C1: nothing blanks it)"
    );
  }

  // #122 T1 — the NEGATIVE half of the queue's company-link rule. The
  // /vendors/<id> deep link is gated on the vendor task's `source` prefix
  // because a "company" link from anywhere else may be a CUSTOMER, and that
  // route notFound()s on one.
  {
    const plain = await createAssignment({
      title: "Ring the T122 T1 customer back",
      assignee: "Catalog Owner T122",
      createdBy: "Tester",
      link: { kind: "company", id: "c-t122-t1-customer", label: "T122 T1 Customer" },
      source: "iMessage from Jena, 2026-09-21",
    });
    const blank = await createAssignment({
      title: "Company task with no source at all",
      assignee: "Catalog Owner T122",
      createdBy: "Tester",
      link: { kind: "company", id: "c-t122-t1-customer", label: "T122 T1 Customer" },
    });
    const queue = await loadQueue("Catalog Owner T122");
    const hrefOf = (id: string) => queue.find((i) => i.key === `assignment:${id}`)?.href;
    assert.equal(hrefOf(plain.id), "/queue", "#122 T1 a company link whose source isn't a vendor task stays on /queue");
    assert.equal(hrefOf(blank.id), "/queue", "#122 T1 …and so does one with no source at all");
  }

  // #122 T1 — the action-layer scope guard (`vendorOr()` in vendors/actions.ts
  // is this predicate turned into "Vendor not found."): only a LIVE company of
  // the vendor type can be written to, so no customer record can ever reach
  // the vendor_profiles collection.
  {
    await upsertCustomer({ id: "c-t122-t1-customer", name: "T122 T1 Customer", type: "Education", locations: [], contacts: [] });
    assert.equal(await isVendorCompany("c-t122-t1-customer"), false, "#122 T1 a customer id is rejected by the vendor scope guard");
    assert.equal(await isVendorCompany("v-t122b"), true, "#122 T1 …a vendor company passes it");
    assert.equal(await isVendorCompany("v-deletedvendort122"), false, "#122 T1 …a soft-deleted vendor is not writable either");
    assert.equal(await isVendorCompany("v-t122-no-such-id"), false, "#122 T1 …nor is an id that doesn't exist");
  }

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

    // #137 T1 review — a supplied phone/mobile that matches an existing
    // number under a different label relabels that row instead of vanishing
    // (else rec.mobile never matches the composed side and D83 never converges).
    await upsertCustomer({
      id: "c-t137-dupphone", name: "T137 Dup Phone Co", type: "Vendor",
      contacts: [{ name: "Sam Duplicate", email: "sam@t137.example", phone: "555-1000", mobile: "555-1000", primary: true }],
    });
    const e = await getCustomer("c-t137-dupphone");
    assert.equal(e!.contacts[0].phone, "555-1000", "#137 T1 review: phone==mobile on first save — phone reads back");
    assert.equal(e!.contacts[0].mobile, "555-1000", "#137 T1 review: phone==mobile on first save — mobile relabelled, not dropped (one row)");
    await upsertCustomer({
      id: "c-t137-dupphone", name: "T137 Dup Phone Co", type: "Vendor",
      contacts: [{ name: "Sam Duplicate", email: "sam@t137.example", phone: "555-1000", mobile: "555-1000", primary: true }],
    });
    const e2 = await getCustomer("c-t137-dupphone");
    assert.equal(e2!.updatedAt, e!.updatedAt, "#137 T1 review: identical phone==mobile re-save leaves updatedAt unchanged (D83)");

    // A genuinely distinct mobile is unaffected: two separate rows, phone unchanged.
    await upsertCustomer({
      id: "c-t137-2phones", name: "T137 Two Phones Co", type: "Vendor",
      contacts: [{ name: "Dana Separate", email: "dana@t137.example", phone: "555-3000", mobile: "555-4000", primary: true }],
    });
    const f = await getCustomer("c-t137-2phones");
    assert.equal(f!.contacts[0].phone, "555-3000", "#137 T1 review: distinct phone/mobile — phone unchanged");
    assert.equal(f!.contacts[0].mobile, "555-4000", "#137 T1 review: distinct phone/mobile — a separate mobile row exists");

    // phone only, mobile never supplied: re-saving identically does not churn.
    await upsertCustomer({
      id: "c-t137-onlyphone", name: "T137 Only Phone Co", type: "Vendor",
      contacts: [{ name: "Pat Phoneonly", email: "pat@t137.example", phone: "555-5000", primary: true }],
    });
    const g = await getCustomer("c-t137-onlyphone");
    assert.equal(g!.contacts[0].mobile, undefined, "#137 T1 review: phone-only contact has no mobile");
    await upsertCustomer({
      id: "c-t137-onlyphone", name: "T137 Only Phone Co", type: "Vendor",
      contacts: [{ name: "Pat Phoneonly", email: "pat@t137.example", phone: "555-5000", primary: true }],
    });
    const g2 = await getCustomer("c-t137-onlyphone");
    assert.equal(g2!.updatedAt, g!.updatedAt, "#137 T1 review: identical phone-only re-save leaves updatedAt unchanged (D83)");
  }

  // #137 T4 — customers import: Category + Zip + Phone + Website, legacy embedded columns, export round-trip
  {
    const res = await commitImport("customers", prepImport("customers", [
      "Customer Name,Category,Address,City,State,Zip,Phone,Website,Notes",
      "T137 Import Playhouse,Worship,215 W Main St,Madison,WI,53703,(608) 555-0100,t137import.example,",
    ].join("\n")), "skip");
    assert.equal(res.created, 1, "#137 T4 one customer created");
    assert.equal(res.errored, 0, "#137 T4 no errors");
    const a = await findCustomerByName("T137 Import Playhouse");
    assert.ok(a, "#137 T4 customer findable by name");
    assert.equal(a!.type, "Worship", "#137 T4 Category → type");
    assert.equal(a!.zip, "53703", "#137 T4 Zip → company zip");
    assert.equal(a!.phone, "(608) 555-0100", "#137 T4 Phone → company phone (no contact on the row)");
    assert.equal(a!.website, "t137import.example", "#137 T4 Website → company website");
    assert.equal(a!.locations.length, 1, "#137 T4 exactly one venue (the address venue, no extra base venue)");
    assert.equal(a!.locations[0].address, "215 W Main St", "#137 T4 Address → primary venue");
    assert.equal(a!.locations[0].zip, "53703", "#137 T4 Zip → primary venue zip too");
    assert.equal(a!.locations[0].primary, true, "#137 T4 …and it is primary");

    // A pre-#137 file (Type / Contact Name / Email / Phone / Venue) in
    // "Update existing" mode: embedded columns still land, nothing is wiped.
    const res2 = await commitImport("customers", prepImport("customers", [
      "Customer Name,Type,Contact Name,Email,Phone,Venue,Address,City,State",
      "T137 Import Playhouse,Performing arts,Maria Lopez,maria@t137import.example,(608) 555-0110,Main Stage,215 W Main St,Madison,WI",
    ].join("\n")), "update");
    assert.equal(res2.updated, 1, "#137 T4 a legacy file matches by name and updates");
    const b = await findCustomerByName("T137 Import Playhouse");
    assert.equal(b!.type, "Performing arts", "#137 T4 legacy Type alias → type");
    assert.equal(b!.locations.length, 1, "#137 T4 legacy Venue claims the unnamed address venue instead of adding one");
    assert.equal(b!.locations[0].label, "Main Stage", "#137 T4 legacy Venue names the primary venue");
    assert.equal(b!.locations[0].zip, "53703", "#137 T4 a file without Zip keeps the stored venue zip");
    assert.equal(b!.zip, "53703", "#137 T4 …and the company zip");
    assert.equal(b!.website, "t137import.example", "#137 T4 …and the website");
    assert.equal(b!.contacts.length, 1, "#137 T4 legacy Contact Name lands as a contact");
    assert.equal(b!.contacts[0].email, "maria@t137import.example", "#137 T4 legacy Email on the contact");
    assert.equal(b!.contacts[0].phone, "(608) 555-0110", "#137 T4 legacy Phone goes to the contact when a Contact Name is present");
    assert.equal(b!.contacts[0].primary, true, "#137 T4 the embedded contact is primary");
    assert.equal(b!.phone, "(608) 555-0100", "#137 T4 …and the company phone is left alone");

    // "Skip duplicates" on the same name is a skip, not a second customer.
    const res3 = await commitImport("customers", prepImport("customers", "Customer Name,Category\nt137 import PLAYHOUSE,Civic"), "skip");
    assert.equal(res3.skipped, 1, "#137 T4 normalized-name duplicate skipped");
    assert.equal((await allCustomers()).filter((c) => norm(c.name) === norm("T137 Import Playhouse")).length, 1, "#137 T4 still one customer");

    // Export round-trip: Category + Zip present, same values, re-import creates nothing.
    const csv = await exportCsv("customers");
    const exp = parseCsv(csv);
    // #137 T7 — no Notes column: nothing on a customer record stores it, so
    // the hub stopped advertising it (the input file above still carries one,
    // and it is still absorbed without erroring).
    assert.equal(exp.headers.join(","), "Customer Name,Category,Address,City,State,Zip,Latitude,Longitude,Phone,Website", "#137 T4 customers export columns = template columns (hidden aliases excluded)");
    const row = exp.objects.find((o) => o["Customer Name"] === "T137 Import Playhouse");
    assert.ok(row, "#137 T4 exported row present");
    assert.equal(row!.Category, "Performing arts", "#137 T4 export Category");
    assert.equal(row!.Zip, "53703", "#137 T4 export Zip");
    assert.equal(row!.Address, "215 W Main St", "#137 T4 export Address from the primary venue");
    assert.equal(row!.Phone, "(608) 555-0100", "#137 T4 export Phone = company phone");
    assert.equal(row!.Website, "t137import.example", "#137 T4 export Website");
    const back = await commitImport("customers", prepImport("customers", csv).filter((r) => String(r.values.name).startsWith("T137")), "skip");
    assert.equal(back.created, 0, "#137 T4 export → re-import creates nothing");
    assert.equal(back.errored, 0, "#137 T4 export → re-import errors nothing");
  }

  // #137 T5 — contacts import: link by name + id, primary demotion, one auto-created customer for several rows, idempotent re-import, export round-trip
  {
    await upsertCustomer({
      id: "c-t137-ct", name: "T137 Contacts Co", type: "Education", locations: [],
      contacts: [{ name: "Old Primary", email: "old@t137ct.example", primary: true }],
    });
    const csv1 = [
      "Customer,Customer ID,Name,Email,Phone,Mobile,Title,Role,Primary",
      "t137 contacts co,,Maria Lopez,maria@t137ct.example,(608) 555-0110,(608) 555-0111,Technical Director,,yes",
      ",c-t137-ct,Sam Ortiz,sam@t137ct.example,,,,billing,no",
      "T137 Brand New Org,,Pat Doe,pat@t137new.example,,,,,",
      "t137 BRAND new org,,Lee Park,lee@t137new.example,,,,,",
    ].join("\n");
    const r1 = await commitImport("contacts", prepImport("contacts", csv1), "skip");
    assert.equal(r1.errored, 0, "#137 T5 no errors");
    assert.equal(r1.created, 4, "#137 T5 four contacts created");
    assert.equal(r1.customersLinked, 2, "#137 T5 two rows linked to the existing customer (one by name, one by id)");
    assert.equal(r1.customersCreated, 1, "#137 T5 exactly one customer auto-created for the two unmatched rows");
    const co = await getCustomer("c-t137-ct");
    const maria = co!.contacts.find((c) => c.name === "Maria Lopez");
    const sam = co!.contacts.find((c) => c.name === "Sam Ortiz");
    const old = co!.contacts.find((c) => c.name === "Old Primary");
    assert.ok(maria && sam && old, "#137 T5 both imported contacts sit on the customer beside the old one");
    assert.equal(maria!.primary, true, "#137 T5 Primary=yes promotes Maria");
    assert.equal(old!.primary, false, "#137 T5 …and demotes the previous primary");
    assert.equal(sam!.primary, false, "#137 T5 Primary=no stays non-primary");
    assert.equal(maria!.mobile, "(608) 555-0111", "#137 T5 Mobile persists");
    assert.equal(maria!.phone, "(608) 555-0110", "#137 T5 Phone persists");
    assert.equal(maria!.role, "Technical Director", "#137 T5 Title → contact title");
    assert.equal(sam!.role, "billing", "#137 T5 Role fills the title when Title is blank");
    const created = (await allCustomers()).filter((c) => norm(c.name) === norm("T137 Brand New Org"));
    assert.equal(created.length, 1, "#137 T5 the unmatched name created exactly one customer");
    assert.equal(created[0].name, "T137 Brand New Org", "#137 T5 …named as the first row spelled it");
    assert.equal(created[0].contacts.length, 2, "#137 T5 both rows landed on that one new customer");
    assert.equal(created[0].contacts.find((c) => c.name === "Pat Doe")?.primary, true, "#137 T5 the first contact on a new customer becomes primary");

    const r2 = await commitImport("contacts", prepImport("contacts", csv1), "skip");
    assert.equal(r2.skipped, 4, "#137 T5 re-importing the same file skips every row");
    assert.equal(r2.customersCreated, 0, "#137 T5 …and creates no customers");
    assert.equal((await getCustomer("c-t137-ct"))!.updatedAt, co!.updatedAt, "#137 T5 a skipped re-import writes nothing (updatedAt unchanged)");
    const r3 = await commitImport("contacts", prepImport("contacts", csv1), "update");
    assert.equal(r3.updated, 4, "#137 T5 update mode re-imports without duplicating");
    assert.equal((await getCustomer("c-t137-ct"))!.contacts.length, 3, "#137 T5 still three contacts after two re-imports");
    assert.equal((await allCustomers()).filter((c) => norm(c.name) === norm("T137 Brand New Org")).length, 1, "#137 T5 still one auto-created customer");
    // The relabel rule from #137 T1 is what makes this converge: saving the
    // same contacts file twice must be a no-change write, not a churn of the
    // phone/mobile channels (D83).
    assert.equal((await getCustomer("c-t137-ct"))!.updatedAt, co!.updatedAt, "#137 T5 saving the same contacts file twice leaves updatedAt unchanged (idempotent)");
    assert.equal((await getCustomer(created[0].id))!.updatedAt, created[0].updatedAt, "#137 T5 …on the auto-created customer too");

    const csv = await exportCsv("contacts");
    const exp = parseCsv(csv);
    assert.equal(exp.headers.join(","), "Customer,Customer ID,Name,Email,Phone,Mobile,Title,Role,Primary", "#137 T5 contacts export columns = template columns (no Notes — a contact has nowhere to store it)");
    const m = exp.objects.find((o) => o.Email === "maria@t137ct.example");
    assert.ok(m, "#137 T5 exported contact present");
    assert.ok(m!.Customer === "T137 Contacts Co" && m!["Customer ID"] === "c-t137-ct" && m!.Mobile === "(608) 555-0111" && m!.Phone === "(608) 555-0110" && m!.Title === "Technical Director" && m!.Primary === "yes", "#137 T5 exported contact carries the customer's name + id and its fields");
    const back = await commitImport("contacts", prepImport("contacts", csv).filter((r) => String(r.values.customer).startsWith("T137")), "skip");
    assert.equal(back.created, 0, "#137 T5 export → re-import creates nothing (round-trip)");
    assert.equal(back.errored, 0, "#137 T5 export → re-import errors nothing");
  }

  // #137 T6 — venues import: link by name + id, zip + category persist, the first venue claims the unnamed base venue, auto-create, idempotent, export round-trip
  {
    await upsertCustomer({ id: "c-t137-vn", name: "T137 Venues District", type: "Education", locations: [], contacts: [] });
    assert.equal((await getCustomer("c-t137-vn"))!.locations.length, 1, "#137 T6 fixture: a new customer starts with its unnamed D85 base venue");
    const csv1 = [
      "Customer,Customer ID,Venue Name,Address,City,State,Zip,Category,Notes",
      "T137 Venues District,,Main Auditorium,5000 N Ballard Rd,Appleton,WI,54913,theatre,",
      ",c-t137-vn,Black Box,5000 N Ballard Rd,Appleton,WI,54913-1234,black box,",
      "T137 Venue Church,,Sanctuary,1 Church St,Oshkosh,WI,54901,church,",
    ].join("\n");
    const r1 = await commitImport("venues", prepImport("venues", csv1), "skip");
    assert.equal(r1.errored, 0, "#137 T6 no errors");
    assert.equal(r1.created, 3, "#137 T6 three venues created");
    assert.equal(r1.customersLinked, 2, "#137 T6 two rows linked (one by name, one by id)");
    assert.equal(r1.customersCreated, 1, "#137 T6 one customer auto-created");
    const d = await getCustomer("c-t137-vn");
    assert.equal(d!.locations.length, 2, "#137 T6 the first venue claimed the unnamed base venue; the second appended");
    const main = d!.locations.find((l) => l.label === "Main Auditorium");
    const bb = d!.locations.find((l) => l.label === "Black Box");
    assert.ok(main && bb, "#137 T6 both venues on the customer");
    assert.equal(main!.zip, "54913", "#137 T6 venue zip persists");
    assert.equal(main!.kind, "theatre", "#137 T6 venue Category → kind");
    assert.equal(main!.address, "5000 N Ballard Rd", "#137 T6 venue address persists");
    assert.equal(main!.primary, true, "#137 T6 the claimed base venue stays primary");
    assert.equal(bb!.zip, "54913-1234", "#137 T6 ZIP+4 kept");
    assert.equal(bb!.kind, "black box", "#137 T6 category kept as typed");
    assert.equal(bb!.venueKind, "blackbox", "#137 T6 a new venue's venueKind derives from Category");
    assert.equal(bb!.primary, false, "#137 T6 an appended venue is not primary");
    const church = (await allCustomers()).find((c) => c.name === "T137 Venue Church");
    assert.ok(church, "#137 T6 unmatched customer auto-created");
    assert.equal(church!.locations.length, 1, "#137 T6 …with exactly one venue (the row's, on the base venue)");
    assert.equal(church!.locations[0].label, "Sanctuary", "#137 T6 …named from the row");
    assert.equal(church!.locations[0].zip, "54901", "#137 T6 …with its zip");

    const r2 = await commitImport("venues", prepImport("venues", csv1), "skip");
    assert.equal(r2.skipped, 3, "#137 T6 re-import skips all three");
    assert.equal((await getCustomer("c-t137-vn"))!.updatedAt, d!.updatedAt, "#137 T6 a skipped re-import writes nothing (updatedAt unchanged)");
    const r3 = await commitImport("venues", prepImport("venues", csv1), "update");
    assert.equal(r3.updated, 3, "#137 T6 update mode re-imports without duplicating");
    assert.equal((await getCustomer("c-t137-vn"))!.locations.length, 2, "#137 T6 no duplicate venues after re-imports");
    // Same D83 contract the contacts file relies on above: re-importing an
    // unchanged venues file is a no-change write, not a churn of the sites.
    assert.equal((await getCustomer("c-t137-vn"))!.updatedAt, d!.updatedAt, "#137 T6 saving the same venues file twice leaves updatedAt unchanged (idempotent)");
    assert.equal((await getCustomer(church!.id))!.updatedAt, church!.updatedAt, "#137 T6 …on the auto-created customer too");

    const csv = await exportCsv("venues");
    const exp = parseCsv(csv);
    assert.equal(exp.headers.join(","), "Customer,Customer ID,Venue Name,Address,City,State,Zip,Latitude,Longitude,Category", "#137 T6 venues export columns = template columns (no Notes — a venue has nowhere to store it)");
    const row = exp.objects.find((o) => o["Customer ID"] === "c-t137-vn" && o["Venue Name"] === "Black Box");
    assert.ok(row, "#137 T6 exported venue present");
    assert.ok(row!.Zip === "54913-1234" && row!.Category === "black box" && row!.Customer === "T137 Venues District" && row!.Address === "5000 N Ballard Rd", "#137 T6 exported venue carries the customer's name + id and its fields");
    const back = await commitImport("venues", prepImport("venues", csv).filter((r) => String(r.values.customer).startsWith("T137")), "skip");
    assert.equal(back.created, 0, "#137 T6 export → re-import creates nothing (round-trip)");
    assert.equal(back.errored, 0, "#137 T6 export → re-import errors nothing");

    // #137 T6 review (punch #137 fix) — a customers import with Address/
    // City/State/Zip but no Venue leaves an ADDRESSED, UNNAMED primary venue
    // (D85 base venue); the venues export emits it with a blank Venue Name;
    // committing that exact row back must not error, must target the SAME
    // venue in place, and must never invent a name for it.
    await upsertCustomer({
      id: "c-t137-vn-addr",
      name: "T137 Venue Addressed Only",
      type: "Education",
      locations: [
        { id: "l-t137-vn-addr-1", label: "", primary: true, address: "9 Probe St", city: "Neenah", state: "WI", zip: "54956" },
      ],
      contacts: [],
    });
    const addrBefore = await getCustomer("c-t137-vn-addr");
    assert.equal(addrBefore!.locations.length, 1, "#137 T6 fix fixture: exactly one venue — unnamed, addressed");
    // Blank labels read back as undefined (composeLocation: `s.name || undefined`), not "".
    assert.ok(!addrBefore!.locations[0].label, "#137 T6 fix fixture: the venue has no name");

    const csvAddr = await exportCsv("venues");
    const expAddr = parseCsv(csvAddr);
    const addrRow = expAddr.objects.find((o) => o["Customer ID"] === "c-t137-vn-addr");
    assert.ok(addrRow, "#137 T6 fix: the addressed unnamed venue is exported");
    assert.equal(addrRow!["Venue Name"], "", "#137 T6 fix: exported with a blank Venue Name");
    assert.equal(addrRow!.Address, "9 Probe St", "#137 T6 fix: exported with its address");

    const addrRowsBack = prepImport("venues", csvAddr).filter((r) => String(r.values.customerId) === "c-t137-vn-addr");
    assert.equal(addrRowsBack.length, 1, "#137 T6 fix: exactly one prepared row for this customer");
    assert.equal(
      addrRowsBack[0].valid,
      true,
      "#137 T6 fix: a blank Venue Name is VALID when the row carries an address (requiredUnless: address)"
    );

    const rt1 = await commitImport("venues", addrRowsBack, "update");
    assert.equal(rt1.errored, 0, "#137 T6 fix: committing the exported blank-label row errors nothing");
    // matchLocation never matches a blank label (by design — see link.ts), so
    // WRITERS.venues.find() can't report this row as "existing"; it always
    // takes the create() path. That's fine: create() re-links the SAME
    // customer and writeVenueRow's mergeLocation (preferPrimary: true)
    // targets the existing primary venue in place rather than appending.
    assert.equal(rt1.created + rt1.updated, 1, "#137 T6 fix: the row is written exactly once");
    const addrAfter1 = await getCustomer("c-t137-vn-addr");
    assert.equal(addrAfter1!.locations.length, 1, "#137 T6 fix: still exactly one venue — no second unnamed venue created");
    assert.ok(!addrAfter1!.locations[0].label, "#137 T6 fix: still unnamed — no name was invented for it");
    assert.equal(addrAfter1!.locations[0].primary, true, "#137 T6 fix: still the primary venue");
    assert.equal(addrAfter1!.locations[0].address, "9 Probe St", "#137 T6 fix: address unchanged");
    assert.equal(
      addrAfter1!.updatedAt,
      addrBefore!.updatedAt,
      "#137 T6 fix: round-tripping identical content is a no-op (updatedAt unchanged)"
    );

    const rt2 = await commitImport("venues", addrRowsBack, "update");
    assert.equal(rt2.errored, 0, "#137 T6 fix: a second identical re-import still errors nothing");
    const addrAfter2 = await getCustomer("c-t137-vn-addr");
    assert.equal(addrAfter2!.locations.length, 1, "#137 T6 fix: still no duplicate venue on a second re-import");
    assert.equal(
      addrAfter2!.updatedAt,
      addrBefore!.updatedAt,
      "#137 T6 fix: …and updatedAt still hasn't moved (idempotent)"
    );

    // A blank-label row for a customer with NO venue at all: a partner-type
    // customer (D85 venue-defaults) gets no auto base venue, so there is
    // nothing to claim — mergeLocation's existing fallback (opts.preferPrimary
    // with an empty list) appends the customer's first venue, still unnamed
    // rather than erroring or inventing a name.
    await upsertCustomer({ id: "c-t137-vn-novenue", name: "T137 Venue Partner Co", type: "Vendor", locations: [], contacts: [] });
    assert.equal(
      (await getCustomer("c-t137-vn-novenue"))!.locations.length,
      0,
      "#137 T6 fix fixture: a partner-type customer has no venue at all"
    );
    const csvNoVenue = [
      ["Customer", "Customer ID", "Venue Name", "Address", "City", "State", "Zip", "Category", "Notes"],
      ["", "c-t137-vn-novenue", "", "200 Vendor Way", "Neenah", "WI", "54956", "warehouse", ""],
    ]
      .map((r) => r.join(","))
      .join("\n");
    const rNoVenue = await commitImport("venues", prepImport("venues", csvNoVenue), "skip");
    assert.equal(rNoVenue.errored, 0, "#137 T6 fix: a blank-label row on a venueless customer does not error");
    assert.equal(rNoVenue.created, 1, "#137 T6 fix: it creates the customer's first venue");
    const novenue = await getCustomer("c-t137-vn-novenue");
    assert.equal(novenue!.locations.length, 1, "#137 T6 fix: exactly one venue now exists");
    assert.ok(!novenue!.locations[0].label, "#137 T6 fix: still no invented name");
    assert.equal(novenue!.locations[0].primary, true, "#137 T6 fix: the sole venue is primary");
    assert.equal(novenue!.locations[0].address, "200 Vendor Way", "#137 T6 fix: its address persists");

    // A row with NEITHER a Venue Name NOR anything else to target (no
    // address/city/state/zip either) is still invalid: required-unless
    // doesn't mean "always optional" — keep it required when there is
    // nothing else for the row to target.
    const csvNothing = [
      ["Customer", "Customer ID", "Venue Name", "Address", "City", "State", "Zip", "Category", "Notes"],
      ["", "c-t137-vn-novenue", "", "", "", "", "", "", ""],
    ]
      .map((r) => r.join(","))
      .join("\n");
    const nothingRows = prepImport("venues", csvNothing);
    assert.equal(
      nothingRows[0].valid,
      false,
      "#137 T6 fix: a blank Venue Name with no address either is still invalid (nothing to target)"
    );
  }

  // #137 C1 (final review — data loss) — the go-live order in MASTER-HOWTO §7
  // is customers.csv → contacts.csv → venues.csv. The customers template has
  // no Venue column, so every customer it writes ends up owning an UNNAMED
  // but ADDRESSED primary venue: the company's mailing address. A labelled
  // venues row for that customer must APPEND a second venue — claiming the
  // addressed slot would overwrite the mailing address with the venue's, and
  // D158 leaves companies.address/city/state to the Daylite import, so
  // nothing else holds it and it is unrecoverable.
  {
    const cRes = await commitImport("customers", prepImport("customers", [
      "Customer Name,Category,Address,City,State,Zip",
      "T137 C1 Mailing Co,Education,215 W Main St,Madison,WI,53703",
    ].join("\n")), "skip");
    assert.equal(cRes.errored, 0, "#137 C1 fixture: the customers row errors nothing");
    assert.equal(cRes.created, 1, "#137 C1 fixture: the customers row creates the customer");
    const c1 = await findCustomerByName("T137 C1 Mailing Co");
    assert.equal(c1!.locations.length, 1, "#137 C1 fixture: one venue — the unnamed mailing venue");
    assert.ok(!c1!.locations[0].label, "#137 C1 fixture: …unnamed (the template has no Venue column)");
    assert.equal(c1!.locations[0].address, "215 W Main St", "#137 C1 fixture: …carrying the mailing address");

    const vRes = await commitImport("venues", prepImport("venues", [
      "Customer,Customer ID,Venue Name,Address,City,State,Zip,Category",
      "T137 C1 Mailing Co,,Main Auditorium,5000 N Ballard Rd,Appleton,WI,54913,theatre",
    ].join("\n")), "skip");
    assert.equal(vRes.errored, 0, "#137 C1 the venues row errors nothing");
    assert.equal(vRes.created, 1, "#137 C1 the venues row writes one venue");
    const c2 = await findCustomerByName("T137 C1 Mailing Co");
    assert.equal(c2!.locations.length, 2, "#137 C1 a labelled venues row APPENDS — it never claims a blank-label venue that already has an address");
    const mail = c2!.locations.find((l) => !l.label);
    const aud = c2!.locations.find((l) => l.label === "Main Auditorium");
    assert.ok(mail && aud, "#137 C1 both the mailing venue and the named venue exist");
    assert.equal(mail!.address, "215 W Main St", "#137 C1 the customer's mailing address survives the venues import");
    assert.equal(mail!.city, "Madison", "#137 C1 …and its city");
    assert.equal(aud!.address, "5000 N Ballard Rd", "#137 C1 the appended venue keeps its own address");
    assert.equal(aud!.city, "Appleton", "#137 C1 …and its city");
    // Revised for #137 I3 (was: the mailing venue stays primary / the appended
    // venue is not): primaryLoc drives the record page's location line, travel
    // estimates and quote defaults, so the venue where the work happens must
    // outrank the unnamed mailing placeholder, which stays as a second location.
    assert.equal(aud!.primary, true, "#137 I3 the appended NAMED venue becomes primary");
    assert.equal(mail!.primary, false, "#137 I3 …and the unnamed mailing placeholder is demoted, not removed");

    // The mirror, the same slot from the other side (#137 C1b) — a customers
    // row must never address a venue that has a name to lose. Two shapes:
    //
    // (1) the go-live re-run ("Update existing"). After I3 the NAMED venue is
    //     the primary one, so the row has to skip it and land on the unnamed
    //     mailing venue it owns — both addresses intact, no third venue.
    const cRes2 = await commitImport("customers", prepImport("customers", [
      "Customer Name,Category,Address,City,State,Zip",
      "T137 C1 Mailing Co,Education,220 E Doty St,Madison,WI,53703",
    ].join("\n")), "update");
    assert.equal(cRes2.errored, 0, "#137 C1b mirror: the second customers file errors nothing");
    assert.equal(cRes2.updated, 1, "#137 C1b mirror: it matches by name and updates");
    const c3 = await findCustomerByName("T137 C1 Mailing Co");
    assert.equal(c3!.locations.length, 2, "#137 C1b mirror: still exactly two venues");
    assert.equal(
      c3!.locations.find((l) => l.label === "Main Auditorium")!.address,
      "5000 N Ballard Rd",
      "#137 C1b mirror: a customers row with no Venue never overwrites an existing named venue's address"
    );
    assert.equal(
      c3!.locations.find((l) => l.label === "Main Auditorium")!.primary,
      true,
      "#137 C1b mirror: …and the named venue is still the primary one"
    );
    assert.equal(
      c3!.locations.find((l) => !l.label)!.address,
      "220 E Doty St",
      "#137 C1b mirror: it updates the unnamed mailing venue it owns instead"
    );

    // (2) the shape the previous round's fixture missed, and the one that
    //     actually loses data: the named, addressed venue IS the primary and
    //     there is no unnamed venue at all — every seeded customer
    //     (src/db/seeds/customers.ts) and anything named through the Companies
    //     modal looks like this. The preferPrimary branch landed straight on
    //     it and overwrote "5000 N Ballard Rd" with the row's mailing address,
    //     which nothing else holds (D158 leaves companies.address/city/state
    //     to the Daylite import).
    await upsertCustomer({
      id: "c-t137-c1b",
      name: "T137 C1b Named Primary Co",
      type: "Education",
      locations: [
        { id: "l-t137-c1b-1", label: "Main Auditorium", primary: true, address: "5000 N Ballard Rd", city: "Appleton", state: "WI", zip: "54913" },
      ],
      contacts: [],
    });
    const b0 = await getCustomer("c-t137-c1b");
    assert.equal(b0!.locations.length, 1, "#137 C1b fixture: one venue — named and addressed");
    assert.equal(b0!.locations[0].primary, true, "#137 C1b fixture: …and it IS the primary venue");
    const bRes = await commitImport("customers", prepImport("customers", [
      "Customer Name,Customer ID,Category,Address,City,State,Zip",
      "T137 C1b Named Primary Co,c-t137-c1b,Education,215 W Main St,Madison,WI,53703",
    ].join("\n")), "update");
    assert.equal(bRes.errored, 0, "#137 C1b the customers row errors nothing");
    assert.equal(bRes.updated, 1, "#137 C1b it matches the existing customer and updates");
    const b1 = await getCustomer("c-t137-c1b");
    assert.equal(b1!.locations.length, 2, "#137 C1b a customers row APPENDS its mailing address — it never addresses a NAMED venue");
    const bAud = b1!.locations.find((l) => l.label === "Main Auditorium");
    const bMail = b1!.locations.find((l) => !l.label);
    assert.ok(bAud && bMail, "#137 C1b both the named venue and the new mailing venue exist");
    assert.equal(bAud!.address, "5000 N Ballard Rd", "#137 C1b the named venue's address survives the customers import");
    assert.equal(bAud!.city, "Appleton", "#137 C1b …and its city");
    assert.equal(bAud!.primary, true, "#137 C1b …and it stays primary (I3: a named venue outranks a mailing placeholder)");
    assert.equal(bMail!.address, "215 W Main St", "#137 C1b the row's mailing address lands on the appended unnamed venue");
    assert.equal(bMail!.city, "Madison", "#137 C1b …and its city");
    assert.equal(bMail!.primary, false, "#137 C1b …and it is not primary");

    // …and a second run updates that mailing venue in place rather than
    // growing a new unnamed venue on every "Update existing" pass.
    const bRes2 = await commitImport("customers", prepImport("customers", [
      "Customer Name,Customer ID,Category,Address,City,State,Zip",
      "T137 C1b Named Primary Co,c-t137-c1b,Education,220 E Doty St,Madison,WI,53703",
    ].join("\n")), "update");
    assert.equal(bRes2.errored, 0, "#137 C1b the second customers run errors nothing");
    const b2 = await getCustomer("c-t137-c1b");
    assert.equal(b2!.locations.length, 2, "#137 C1b a re-run does not grow a third venue");
    assert.equal(b2!.locations.find((l) => !l.label)!.address, "220 E Doty St", "#137 C1b it updates the unnamed mailing venue it owns");
    assert.equal(b2!.locations.find((l) => l.label === "Main Auditorium")!.address, "5000 N Ballard Rd", "#137 C1b …and still never touches the named venue");

    // And the claim that C1 narrows stays intact: when the blank-label venue
    // is a TRUE D85 placeholder (no address of its own), a labelled venues
    // row still fills it rather than leaving an empty twin behind.
    await upsertCustomer({ id: "c-t137-c1-bare", name: "T137 C1 Bare Co", type: "Education", locations: [], contacts: [] });
    const bare = await getCustomer("c-t137-c1-bare");
    assert.equal(bare!.locations.length, 1, "#137 C1 fixture: a new customer starts with its unnamed D85 base venue");
    assert.ok(!bare!.locations[0].address, "#137 C1 fixture: …with no address of its own");
    const vBare = await commitImport("venues", prepImport("venues", [
      "Customer,Customer ID,Venue Name,Address,City,State,Zip,Category",
      ",c-t137-c1-bare,Recital Hall,12 Bare St,Neenah,WI,54956,theatre",
    ].join("\n")), "skip");
    assert.equal(vBare.errored, 0, "#137 C1 the placeholder row errors nothing");
    const bare2 = await getCustomer("c-t137-c1-bare");
    assert.equal(bare2!.locations.length, 1, "#137 C1 an unaddressed base venue is still claimed — no empty twin");
    assert.equal(bare2!.locations[0].label, "Recital Hall", "#137 C1 …and it takes the row's name");
    assert.equal(bare2!.locations[0].address, "12 Bare St", "#137 C1 …and the row's address");
    assert.equal(bare2!.locations[0].primary, true, "#137 C1 …and it stays primary");
  }

  // #43 — per-user layouts persist in the blobs table, one key per surface
  const { layoutFor, saveLayout, resetLayout } = await import("@/lib/dashboard/layout-store");
  const { presetFor } = await import("@/lib/dashboard/registry");
  const fresh = await layoutFor("u-t43", "home", ["Admin"]);
  assert.equal(fresh.customized, false, "#43 no row → preset");
  assert.deepEqual(fresh.ids, presetFor("home", ["Admin"]), "#43 preset ids when nothing stored");
  await saveLayout("u-t43", "home", ["my-queue", "bogus", "my-queue"], ["Admin"]);
  const saved = await layoutFor("u-t43", "home", ["Admin"]);
  assert.deepEqual(saved.ids, ["my-queue"], "#43 save normalizes before writing");
  assert.equal(saved.customized, true, "#43 a stored row marks the layout customized");
  await saveLayout("u-t43-other", "home", ["inbox"], ["Admin"]);
  assert.deepEqual((await layoutFor("u-t43-other", "home", ["Admin"])).ids, ["inbox"], "#43 layouts are isolated by user id");
  await saveLayout("u-t43-gated", "reports", ["my-queue", "book-margin", "total-quoted", "my-queue"], ["Estimator"]);
  assert.deepEqual((await layoutFor("u-t43-gated", "reports", ["Estimator"])).ids, ["total-quoted"], "#43 normalization drops gated and wrong-surface ids");
  await saveLayout("u-t43", "reports", ["total-quoted"], ["Admin"]);
  assert.deepEqual((await layoutFor("u-t43", "home", ["Admin"])).ids, ["my-queue"], "#43 saving reports leaves home untouched (per-key merge)");
  await resetLayout("u-t43", "home");
  assert.equal((await layoutFor("u-t43", "home", ["Admin"])).customized, false, "#43 reset returns to the preset");
  assert.deepEqual((await layoutFor("u-t43", "reports", ["Admin"])).ids, ["total-quoted"], "#43 resetting home preserves the reports layout");
  const { saveLayoutAction, resetLayoutAction } = await import("@/app/(app)/dashboard-actions");
  assert.deepEqual(await saveLayoutAction("invalid" as never, []), { ok: false }, "#43 save action rejects an invalid surface before auth");
  assert.deepEqual(await resetLayoutAction("invalid" as never), { ok: false }, "#43 reset action rejects an invalid surface before auth");

  /* --- specs: template + curtain-template stores --- */
  {
    const SpecTemplates = await import("@/lib/stores/spec-templates");
    const SpecCurtainTemplates = await import("@/lib/stores/spec-curtain-templates");

    // getDb() awaits the dev auto-seed, which has ALREADY run
    // seedStarterTemplates() by the time this block executes — so the first
    // call here legitimately returns 0. Assert the end state, not the count.
    await SpecTemplates.seedStarterTemplates("Seed");
    const all = await SpecTemplates.allTemplates();
    const ids = new Set(all.map((t) => t.id));
    assert(
      SpecTemplates.STARTER_TEMPLATES.every((t) => ids.has(SpecTemplates.templateId(t.key))),
      "templates: after seeding, the collection holds every starter"
    );
    assert((await SpecTemplates.seedStarterTemplates("Seed")) === 0, "templates: seeding again writes nothing");
    assert((await SpecTemplates.ensureStarterTemplates("Seed")) === 0, "templates: ensure is a no-op on a collection that already holds formulas");

    await SpecTemplates.saveTemplate({ key: "Fixtures", title: "Lighting Fixture", headings: [{ label: "X", guidance: "Y" }], rules: "R", example: "E" }, "Jeff");
    const edited = await SpecTemplates.getTemplate(SpecTemplates.templateId("Fixtures"));
    assert(edited?.headings.length === 1 && edited.example === "E", "templates: saving by an existing key replaces that formula, not a duplicate");
    assert((await SpecTemplates.allTemplates()).length === all.length, "templates: saving an existing key adds no row");
    assert((await SpecTemplates.seedStarterTemplates("Seed")) === 0, "templates: re-seeding never overwrites an edited formula");

    await SpecCurtainTemplates.seedStarterCurtainTemplates("Seed");
    const curtainIds = new Set((await SpecCurtainTemplates.allCurtainTemplates()).map((t) => t.id));
    assert(["Border", "Leg", "Draw", "Full"].every((t) => curtainIds.has(t as never)), "curtain templates: one starter per Grid curtain type is present");
    const leg = await SpecCurtainTemplates.getCurtainTemplate("Leg");
    assert(!!leg && leg.id === "Leg", "curtain templates: the id is the curtain type");
    assert(!!leg && ["0", "50", "75", "100"].every((k) => !!leg.fullnessClauses[k as "0"]), "curtain templates: all four fullness clauses ship");
    assert(!!leg && leg.body.includes("{{material}}") && leg.body.includes("{{fullnessClause}}"), "curtain templates: the starter body carries its slots");
    assert((await SpecCurtainTemplates.seedStarterCurtainTemplates("Seed")) === 0, "curtain templates: seeding twice writes nothing");
  }

  /* --- specs: part spec fields + legacy adoption --- */
  {
    const { get: getPart, upsert, mergeUpsert } = await import("@/lib/stores/catalog");
    const { createSection } = await import("@/lib/stores/spec-sections");
    const { createArticle } = await import("@/lib/stores/spec-articles");
    const { adoptAllLegacySpecPointers } = await import("@/lib/specs/legacy-pointers");

    await upsert({ sku: "SPEC-1", desc: "Profile fixture", category: "Fixtures", unit: "ea", list: 100, cost: 50, mfr: "ETC", manufacturerPartNumber: "7060A", mapPrice: 90, ports: [{ kind: "dmx", n: 1 }] } as never);
    // The action's body minus the session gate (requirePerm cannot run here — :1046-1048).
    await mergeUpsert("SPEC-1", { specArticleId: "ar-fix", specTitle: "LED PROFILE FIXTURE", specBody: "Basis of Design: ETC ColorSource Spot", specState: "authored", specSource: "authored", specUpdatedAt: Date.now(), specUpdatedBy: "Tester" });
    const after = await getPart("SPEC-1");
    assert(after?.specTitle === "LED PROFILE FIXTURE" && after?.specState === "authored", "part spec: the fields land");
    assert(!!after?.ports?.length, "part spec: mergeUpsert left ports alone");
    assert(after?.list === 100 && after?.cost === 50 && after?.mapPrice === 90 && after?.manufacturerPartNumber === "7060A", "part spec: pricing and manufacturer numbers are untouched");

    const sec = await createSection({ number: "99 01 13", title: "Legacy Adoption Test", by: "Tester" });
    const art = await createArticle({ sectionId: sec.id, title: "Legacy Instruments" }, "Tester");
    await upsert({ sku: "LEG-1", desc: "Legacy one", category: "X", unit: "ea", list: 1, cost: 1, productMetadata: { specSection: "99-01-13", specArticle: "legacy instruments" } } as never);
    await upsert({ sku: "LEG-2", desc: "Legacy two", category: "X", unit: "ea", list: 1, cost: 1, specArticleId: "ar-authored", productMetadata: { specArticle: "Legacy Instruments" } } as never);
    const first = await adoptAllLegacySpecPointers();
    const leg1 = await getPart("LEG-1");
    assert(leg1?.specSectionId === sec.id && leg1?.specArticleId === art.id, "legacy: resolvable Displays text lands in the canonical pointers");
    assert(leg1?.productMetadata?.specSection === "99-01-13", "legacy: the Displays text itself is kept");
    assert((await getPart("LEG-2"))?.specArticleId === "ar-authored", "legacy: adoption never overwrites a canonical value");
    assert(first.adopted >= 1, "legacy: the first run reports what it adopted");
    assert((await adoptAllLegacySpecPointers()).adopted === 0, "legacy: a second run writes nothing");
  }

  /* --- specs: library import/export --- */
  {
    const Sections = await import("@/lib/stores/spec-sections");
    const Articles = await import("@/lib/stores/spec-articles");
    const Curtains = await import("@/lib/stores/spec-curtain-templates");
    const { exportLibrary, parseLibraryFile, importLibrary } = await import("@/lib/specs/library-io");

    await Sections.createSection({ number: "11 61 43", title: "Stage Curtains", sort: 10, by: "Jeff" });
    const [sec] = await Sections.allSections();
    await Articles.createArticle({ sectionId: sec.id, title: "Theatrical Stage Drapes", manufacturers: ["Rose Brand"], categoryKeys: ["Curtains"], general: "A. General" }, "Jeff");

    const file = await exportLibrary();
    assert(file.kind === "peak-spec-library" && file.version === 1, "library io: the export is stamped and versioned");
    assert(file.sections.length >= 1 && file.articles.length >= 1, "library io: the export carries sections and articles");
    assert(file.templates.length > 0, "library io: the export carries the formulas");

    const round = parseLibraryFile(JSON.stringify(file));
    assert(!!round.file && round.error === null, "library io: an exported file parses back");
    assert(parseLibraryFile("not json").error !== null, "library io: junk is an error, not a throw");
    assert(parseLibraryFile(JSON.stringify({ kind: "something-else" })).error !== null, "library io: a foreign file is refused by kind");
    assert(parseLibraryFile(JSON.stringify({ ...file, version: 99 })).error !== null, "library io: an unknown version is refused");

    const counts = await importLibrary(round.file!, "Jeff");
    assert(counts.sections >= 1, "library io: importing reports what it wrote");
    const after = await Sections.allSections();
    assert(after.length === file.sections.length, "library io: re-importing the same file creates no duplicate section");
    const afterArticles = await Articles.allArticles();
    assert(afterArticles.length === file.articles.length, "library io: re-importing creates no duplicate article");

    const edited = { ...round.file!, sections: round.file!.sections.map((s) => ({ ...s, title: "Renamed" })) };
    await importLibrary(edited, "Jeff");
    assert((await Sections.allSections())[0].title === "Renamed", "library io: an import overwrites the record it matches by id");

    // Catalog parts point at articles by id (specArticleId), so an import must
    // keep the file's ids — a fresh id would orphan every part that pointed at it.
    const fromFile = { ...file.articles[0], id: "ar-from-file", title: "Imported Drapes" };
    await importLibrary({ ...round.file!, articles: [fromFile] }, "Jeff");
    const kept = await Articles.getArticle("ar-from-file");
    assert(kept?.title === "Imported Drapes", "library io: an imported article keeps the id the file gave it");
    await importLibrary({ ...round.file!, articles: [{ ...fromFile, title: "Imported Drapes v2" }] }, "Jeff");
    assert((await Articles.allArticles()).filter((a) => a.id === "ar-from-file").length === 1, "library io: re-importing an article updates it in place");
    assert((await Articles.getArticle("ar-from-file"))?.title === "Imported Drapes v2", "library io: the re-import's text wins");

    const junkCurtain = await importLibrary({ ...round.file!, curtainTemplates: [{ ...round.file!.curtainTemplates[0], id: "Valance" as never, title: "Should not land" }] }, "Jeff");
    assert(junkCurtain.skipped === 1, "library io: a curtain template for an unknown Grid type is skipped");
    assert(!(await Curtains.allCurtainTemplates()).some((t) => t.title === "Should not land"), "library io: a skipped curtain template never overwrites the Border template");
  }

  // #123/I1/I4 review — "+ New quote" from a thread: mint the draft with the
  // right per-type shape, link the thread, adopt the customer, idempotent
  // on a repeat call, and never silently overwrite a different link.
  {
    const { linkThreadToNewQuote } = await import("@/lib/gmail/linking");
    const { get: getQuoteDoc } = await import("@/lib/stores/quotes");
    const r3now = Date.now();
    await upsertDoc<CommThread>("comms", {
      id: "C-r3quote", mailbox: "personal", mailboxUser: "Jeff Chesebro", unread: false, archived: false,
      customerId: null, customer: "", contactName: "Brenda Gauchel", contactEmail: "brenda.t96@lakefront.k12.mn.us",
      subject: "Re: Fwd: Curtain quote for the PAC", channel: "email", status: "waiting_us", assignedTo: "", link: null,
      messages: [], createdAt: r3now, updatedAt: r3now, resolution: "unknown",
    });
    const r3flameInput = {
      customerId: "lakefront", customer: "Lakefront ISD", locationId: "loc1", locationLabel: "Auditorium",
      contactName: "Brenda Gauchel", contactRole: "Director", contactEmail: "brenda.t96@lakefront.k12.mn.us",
      quoteType: "flame_test", category: "", owner: "Tester",
    };
    const r3made = await linkThreadToNewQuote("C-r3quote", r3flameInput);
    assert.ok(r3made.ok, "#123 linkThreadToNewQuote mints on the first call");
    if (!r3made.ok) throw new Error("unreachable");
    assert.ok(r3made.quoteId.startsWith("Q-"), "#123 …a Q- id");
    assert.equal(r3made.reused, false, "#123 …freshly minted, not reused");
    const r3q = await getQuoteDoc(r3made.quoteId);
    assert.equal(r3q?.customerId, "lakefront", "#123 the draft carries the intake's customer");
    assert.equal(r3q?.locationId, "loc1", "#123 …and venue (system-shape top-level locationId)");
    assert.equal(r3q?.contactName, "Brenda Gauchel", "#123 …and contact (system-shape top-level contactName)");
    assert.equal(r3q?.quoteType, "flame_test", "#123 …and quote type");
    assert.equal(r3q?.source, "inbox", "#123 source is inbox");
    assert.equal(r3q?.status, "draft", "#123 the quote starts as a draft");
    assert.equal(r3q?.name, "Curtain quote for the PAC", "#123 name comes from the subject when none was given, prefixes stripped");
    // I1 — flame-tests/quote/page.tsx reads top-level `contact` and
    // `flameTest.venues[].{id,label}` to reconstruct its editor state.
    const r3ft = r3q?.flameTest as { venues?: Array<{ id?: string; label?: string }> } | null;
    assert.deepEqual(r3ft?.venues, [{ id: "loc1", label: "Auditorium" }], "#123/I1 flameTest.venues carries the thread's venue id+label");
    assert.deepEqual(r3q?.contact, { name: "Brenda Gauchel", role: "Director", email: "brenda.t96@lakefront.k12.mn.us" }, "#123/I1 the flame builder's contact object is seeded, not just contactName");
    const r3qt = await getDoc<CommThread>("comms", "C-r3quote");
    assert.equal(r3qt?.link?.type, "quote", "#123 the thread links to a quote");
    assert.equal(r3qt?.link?.id, r3made.quoteId, "#123 …the minted one");
    assert.equal(r3qt?.link?.label, `${r3made.quoteId} · Curtain quote for the PAC`, "#123 label matches the picker's format");
    assert.equal(r3qt?.customerId, "lakefront", "#123 an unlinked thread adopts the intake's customer");
    assert.equal(r3qt?.resolution, "linked", "#123 …and reads as linked");

    // I4 — a repeat mint for the SAME customer is idempotent: hands back the
    // same draft instead of minting a second one (double submit, a second
    // tab, the back button); the new call's own `name` is never applied —
    // the existing draft's identity wins outright.
    const r3again = await linkThreadToNewQuote("C-r3quote", { ...r3flameInput, name: "Ignored — reused" });
    assert.ok(r3again.ok, "#123/I4 the repeat call still succeeds");
    if (!r3again.ok) throw new Error("unreachable");
    assert.equal(r3again.quoteId, r3made.quoteId, "#123/I4 …the SAME quote id — no duplicate minted");
    assert.equal(r3again.reused, true, "#123/I4 …flagged as reused");
    assert.equal((await getQuoteDoc(r3again.quoteId))?.name, "Curtain quote for the PAC", "#123/I4 the reused draft's name is untouched by the new call's input");

    // I4 — the thread now links a LEAD instead: refused outright...
    await patchDoc<CommThread>("comms", "C-r3quote", (d) => {
      d.link = { type: "lead", id: "L-9001", label: "L-9001 · Some Lead" };
    });
    const r3blocked = await linkThreadToNewQuote("C-r3quote", r3flameInput);
    assert.ok(!r3blocked.ok && r3blocked.reason === "linked-elsewhere", "#123/I4 a thread linked to something else refuses to mint over it");
    assert.equal((await getDoc<CommThread>("comms", "C-r3quote"))?.link?.type, "lead", "#123/I4 …the existing link is untouched");
    // ...but an explicit confirm mints a NEW draft and takes over the link.
    const r3confirmed = await linkThreadToNewQuote("C-r3quote", r3flameInput, { confirmReplace: true });
    assert.ok(r3confirmed.ok, "#123/I4 confirmReplace mints anyway");
    if (!r3confirmed.ok) throw new Error("unreachable");
    assert.notEqual(r3confirmed.quoteId, r3made.quoteId, "#123/I4 …a genuinely NEW draft, not the one from before the lead link");
    assert.equal((await getDoc<CommThread>("comms", "C-r3quote"))?.link?.id, r3confirmed.quoteId, "#123/I4 …and the thread now points at it");

    assert.deepEqual(
      await linkThreadToNewQuote("C-r3-no-such-thread", { customerId: "lakefront", customer: "x", locationId: null, contactName: "", quoteType: "system", category: "", owner: "Tester" }),
      { ok: false, reason: "not-found" },
      "#123 unknown thread → not-found, nothing minted"
    );
  }

  // I1 — the other service types read a different shape than flame_test's;
  // rentals have no venue concept at all, consulting needs venueCustomerId.
  {
    const { linkThreadToNewQuote } = await import("@/lib/gmail/linking");
    const { get: getQuoteDoc } = await import("@/lib/stores/quotes");
    const r3now = Date.now();
    await upsertDoc<CommThread>("comms", {
      id: "C-r3rental", mailbox: "personal", mailboxUser: "Jeff Chesebro", unread: false, archived: false,
      customerId: null, customer: "", contactName: "Tom Reyes", contactEmail: "tom@lakefront.k12.mn.us",
      subject: "Rental for spring musical", channel: "email", status: "waiting_us", assignedTo: "", link: null,
      messages: [], createdAt: r3now, updatedAt: r3now, resolution: "unknown",
    });
    const r3rental = await linkThreadToNewQuote("C-r3rental", {
      customerId: "lakefront", customer: "Lakefront ISD", locationId: "loc1", locationLabel: "Auditorium",
      contactName: "Tom Reyes", contactEmail: "tom@lakefront.k12.mn.us", quoteType: "rental", category: "", owner: "Tester",
    });
    assert.ok(r3rental.ok, "#123/I1 rental mints");
    if (!r3rental.ok) throw new Error("unreachable");
    const r3rq = await getQuoteDoc(r3rental.quoteId);
    assert.equal(r3rq?.locationId, null, "#123/I1 rentals/quote/page.tsx never reads a venue — locationId stays null even though one was forwarded");
    assert.deepEqual(r3rq?.contact, { name: "Tom Reyes", role: "", email: "tom@lakefront.k12.mn.us" }, "#123/I1 …but the contact still carries over");

    await upsertDoc<CommThread>("comms", {
      id: "C-r3consult", mailbox: "personal", mailboxUser: "Jeff Chesebro", unread: false, archived: false,
      customerId: null, customer: "", contactName: "Tom Reyes", contactEmail: "tom@lakefront.k12.mn.us",
      subject: "Consulting scope", channel: "email", status: "waiting_us", assignedTo: "", link: null,
      messages: [], createdAt: r3now, updatedAt: r3now, resolution: "unknown",
    });
    const r3consult = await linkThreadToNewQuote("C-r3consult", {
      customerId: "lakefront", customer: "Lakefront ISD", locationId: null,
      contactName: "Tom Reyes", contactEmail: "tom@lakefront.k12.mn.us", quoteType: "consulting", category: "", owner: "Tester",
    });
    assert.ok(r3consult.ok, "#123/I1 consulting mints");
    if (!r3consult.ok) throw new Error("unreachable");
    const r3cq = await getQuoteDoc(r3consult.quoteId);
    const r3consulting = r3cq?.consulting as { venueCustomerId?: string; venueCustomer?: string } | null;
    assert.equal(r3consulting?.venueCustomerId, "lakefront", "#123/I1 design/engagements/quote/page.tsx requires venueCustomerId — seeded to the billed customer absent a distinct venue");
    assert.equal(r3consulting?.venueCustomer, "Lakefront ISD", "#123/I1 …with its display name alongside");
  }

  // I4 follow-up review — threadQuoteLinkStatus is the decision
  // createQuoteIntakeAction now checks BEFORE saveCustomerAction
  // (quotes/new/actions.ts, right after the thread validity check, well
  // before any customer/venue/contact write) instead of only inside
  // linkThreadToNewQuote after the save already ran. createQuoteIntakeAction
  // itself is session-gated (requireUser()) and can't be called from this
  // harness — this pins the extracted decision function directly, which is
  // what the action's early-exit relies on for correctness.
  {
    const { threadQuoteLinkStatus, linkThreadToNewQuote } = await import("@/lib/gmail/linking");
    const r3now = Date.now();

    // No link at all → clear, free to proceed.
    await upsertDoc<CommThread>("comms", {
      id: "C-r3status-clear", mailbox: "personal", mailboxUser: "Jeff Chesebro", unread: false, archived: false,
      customerId: null, customer: "", contactName: "Brenda Gauchel", contactEmail: "brenda.t96@lakefront.k12.mn.us",
      subject: "Fresh thread", channel: "email", status: "waiting_us", assignedTo: "", link: null,
      messages: [], createdAt: r3now, updatedAt: r3now, resolution: "unknown",
    });
    let statusThread = await getDoc<CommThread>("comms", "C-r3status-clear");
    assert.deepEqual(await threadQuoteLinkStatus(statusThread!, "lakefront"), { kind: "clear" }, "threadQuoteLinkStatus: no link → clear");
    assert.deepEqual(await threadQuoteLinkStatus(statusThread!, null), { kind: "clear" }, "threadQuoteLinkStatus: no link, no candidate customer either → still clear");

    // Linked to an inbox draft for a DIFFERENT customer than the candidate → conflict.
    const madeForOther = await linkThreadToNewQuote("C-r3status-clear", {
      customerId: "rose-brand", customer: "Rose Brand", locationId: null, contactName: "", quoteType: "system", category: "", owner: "Tester",
    });
    assert.ok(madeForOther.ok, "fixture: minted a draft for rose-brand");
    statusThread = await getDoc<CommThread>("comms", "C-r3status-clear");
    assert.equal(statusThread?.link?.type, "quote", "fixture: thread now links that draft");
    const conflictStatus = await threadQuoteLinkStatus(statusThread!, "lakefront");
    assert.ok(conflictStatus.kind === "conflict" && conflictStatus.link.id === statusThread!.link!.id, "threadQuoteLinkStatus: an inbox draft for a DIFFERENT customer is a conflict, not a reuse");

    // Same thread, candidate customer MATCHES the draft's own customer → reuse.
    const reuseStatus = await threadQuoteLinkStatus(statusThread!, "rose-brand");
    assert.ok(reuseStatus.kind === "reuse" && reuseStatus.quoteId === statusThread!.link!.id, "threadQuoteLinkStatus: the SAME customer as the linked draft → reuse");

    // "new customer" mode (candidateCustomerId: null) can never reuse — even
    // though a customer-picking retry against rose-brand would have reused.
    assert.equal((await threadQuoteLinkStatus(statusThread!, null)).kind, "conflict", "threadQuoteLinkStatus: no candidate customer (creatingCustomer) never reads as reuse, always conflict when a link exists");

    // A thread linked to a LEAD (never a quote at all) → always conflict,
    // whatever the candidate customer is — this is the exact "linked-elsewhere"
    // shape createQuoteIntakeAction now catches before ever calling
    // saveCustomerAction, so a refusal here strands nothing.
    await upsertDoc<CommThread>("comms", {
      id: "C-r3status-lead", mailbox: "personal", mailboxUser: "Jeff Chesebro", unread: false, archived: false,
      customerId: "lakefront", customer: "Lakefront ISD", contactName: "Brenda Gauchel", contactEmail: "brenda.t96@lakefront.k12.mn.us",
      subject: "Already a lead", channel: "email", status: "waiting_us", assignedTo: "", link: { type: "lead", id: "L-9002", label: "L-9002 · Some Lead" },
      messages: [], createdAt: r3now, updatedAt: r3now, resolution: "linked",
    });
    const leadThread = await getDoc<CommThread>("comms", "C-r3status-lead");
    const leadStatus = await threadQuoteLinkStatus(leadThread!, "lakefront");
    assert.ok(leadStatus.kind === "conflict" && leadStatus.link.type === "lead" && leadStatus.link.id === "L-9002", "threadQuoteLinkStatus: a lead link is always a conflict, matching customer or not");
  }

  // #124 — siteId follows the customer: setThreadSite stamps it, a re-link
  // to the same customer keeps it, a different customer clears it.
  {
    const { setThreadSite } = await import("@/lib/gmail/linking");
    const r3now = Date.now();
    await upsertDoc<CommThread>("comms", {
      id: "C-r3site", mailbox: "personal", mailboxUser: "Jeff Chesebro", unread: false, archived: false,
      customerId: "lakefront", customer: "Lakefront ISD", contactName: "Brenda Gauchel", contactEmail: "brenda.t96@lakefront.k12.mn.us",
      subject: "Venue", channel: "email", status: "waiting_us", assignedTo: "", link: null,
      messages: [], createdAt: r3now, updatedAt: r3now, resolution: "linked",
    });
    await setThreadSite("C-r3site", "loc1");
    assert.equal((await getDoc<CommThread>("comms", "C-r3site"))?.siteId, "loc1", "#124 setThreadSite stamps siteId");
    await linkThread("C-r3site", "lakefront");
    assert.equal((await getDoc<CommThread>("comms", "C-r3site"))?.siteId, "loc1", "#124 re-linking the same customer keeps the venue");
    await linkThread("C-r3site", "rose-brand");
    assert.equal((await getDoc<CommThread>("comms", "C-r3site"))?.siteId, null, "#124 linking a different customer clears the venue");
    await setThreadSite("C-r3site", "loc2");
    await setThreadSite("C-r3site", null);
    assert.equal((await getDoc<CommThread>("comms", "C-r3site"))?.siteId, null, "#124 setThreadSite(null) clears");
  }

  // #125 — identity source: setIdentityMessage re-resolves from the picked
  // message's address, and a re-sweep keeps that pick.
  {
    const { setIdentityMessage } = await import("@/lib/gmail/linking");
    const r3now = Date.now();
    await upsertDoc<CommThread>("comms", {
      id: "C-r3id", mailbox: "personal", mailboxUser: "Jeff Chesebro", unread: true, archived: false,
      customerId: null, customer: "", contactName: "New Person", contactEmail: "np@r3unknown.org",
      subject: "Forwarded quote", channel: "email", status: "waiting_us", assignedTo: "", link: null,
      messages: [
        { id: "m1", at: r3now - 3000, direction: "in", channel: "email", author: "New Person", body: "x", fromEmail: "np@r3unknown.org" },
        { id: "m2", at: r3now - 2000, direction: "out", channel: "email", author: "Jeff Chesebro", body: "y", to: "Someone <someone@rosebrand.example.com>" },
        { id: "m3", at: r3now - 1000, direction: "in", channel: "email", author: "Brenda Gauchel", body: "z", fromEmail: "brenda.t96@lakefront.k12.mn.us" },
      ],
      createdAt: r3now, updatedAt: r3now, resolution: "unknown",
    });
    // inbound → its From; Brenda is a live contact of lakefront → links directly
    await setIdentityMessage("C-r3id", "m3");
    let r3t = await getDoc<CommThread>("comms", "C-r3id");
    assert.equal(r3t?.identityMessageId, "m3", "#125 setIdentityMessage stamps the picked message");
    assert.equal(r3t?.resolution, "linked", "#125 an inbound identity message resolves from its From (contact → linked)");
    assert.equal(r3t?.customerId, "lakefront", "#125 …and links the thread");
    // a re-sweep over the (now irrelevant) domain keeps the picked message and changes nothing
    await resweepThreads({ domain: "r3unknown.org" });
    r3t = await getDoc<CommThread>("comms", "C-r3id");
    assert.equal(r3t?.identityMessageId, "m3", "#125 re-sweep keeps the picked identity message");
    assert.equal(r3t?.customerId, "lakefront", "#125 re-sweep never downgrades an identity-linked thread");
    // back to the thread contact: a linked thread keeps its customer (never downgraded)
    await setIdentityMessage("C-r3id", null);
    r3t = await getDoc<CommThread>("comms", "C-r3id");
    assert.equal(r3t?.identityMessageId, null, "#125 clearing the identity message falls back to the thread contact");
    assert.equal(r3t?.customerId, "lakefront", "#125 clearing never downgrades a linked thread");
    await setIdentityMessage("C-r3id", "no-such-message");
    r3t = await getDoc<CommThread>("comms", "C-r3id");
    assert.equal(r3t?.identityMessageId, null, "#125 an unknown message id is treated as null");
    assert.equal(await setIdentityMessage("C-r3-no-such-thread", "m1"), null, "#125 unknown thread → null");
  }

  // #127 — the signature round-trips through its own blob, one key per user,
  // merged atomically (setBlob) so it never disturbs another user's row.
  {
    const { setSignature, signatureFor } = await import("@/lib/stores/signatures");
    const { withSignature: withSig } = await import("@/lib/inbox-signature");
    const r3sig = await setSignature("  Jeff Chesebro\r\nPeak Systems Group\n(218) 555-0100  \n", "Sig Tester");
    assert.equal(r3sig, "Jeff Chesebro\nPeak Systems Group\n(218) 555-0100", "#127 setSignature normalises line endings and trims");
    assert.equal(await signatureFor("Sig Tester"), r3sig, "#127 signatureFor round-trips");
    assert.ok(withSig("", r3sig, "add").includes("\n-- \n"), "#127 the composer seed carries the -- separator");
    await setSignature("Someone Else's sig", "Other Tester");
    assert.equal(await signatureFor("Sig Tester"), r3sig, "#127 a second user's signature never overwrites the first (per-key merge)");
    assert.equal((await setSignature("x".repeat(2500), "Sig Tester")).length, 2000, "#127 the store caps at 2,000 chars");
    await setSignature("", "Sig Tester");
    assert.equal(await signatureFor("Sig Tester"), "", "#127 an empty signature clears to ''");
    assert.equal(await signatureFor("Other Tester"), "Someone Else's sig", "#127 clearing one user's signature leaves another's alone");
    assert.equal(await signatureFor("Nobody Here"), "", "#127 no row → empty signature");
  }

  // #128 review (I3) — sendDraft threads `me` through to the sent message's
  // author instead of always stamping DEFAULT_USER, and rowName() (pure,
  // already covered by test:specs) reads the result by DIRECTION so a
  // mismatched Gmail display name on the outbound message still reads as me.
  {
    const { sendDraft, get: getThreadDoc, DEFAULT_USER } = await import("@/lib/stores/comms");
    const { rowName } = await import("@/lib/inbox-rows");
    const r3now = Date.now();
    await upsertDoc<CommThread>("comms", {
      id: "C-r3senddraft", mailbox: "personal", mailboxUser: "Sarah Ops", unread: false, archived: false,
      customerId: null, customer: "", contactName: "Brenda Gauchel", contactEmail: "brenda.t96@lakefront.k12.mn.us",
      subject: "Draft to send", channel: "email", status: "draft", assignedTo: "", link: null,
      draft: { to: "brenda.t96@lakefront.k12.mn.us", subject: "Draft to send", body: "Hi Brenda" },
      messages: [{ id: "m1", at: r3now - 1000, direction: "in", channel: "email", author: "Brenda Gauchel", body: "hello", fromEmail: "brenda.t96@lakefront.k12.mn.us" }],
      createdAt: r3now, updatedAt: r3now,
    });
    await sendDraft("C-r3senddraft", "Sarah Ops");
    let r3t = await getThreadDoc("C-r3senddraft");
    const r3sent = (r3t?.messages || []).at(-1);
    assert.equal(r3sent?.author, "Sarah Ops", "#128 review: sendDraft(id, me) stamps the real sender, not the DEFAULT_USER fallback");

    // No `me` passed — still falls back to DEFAULT_USER (existing behaviour,
    // not a regression: every real caller passes the signed-in user's name).
    await upsertDoc<CommThread>("comms", {
      id: "C-r3senddraft2", mailbox: "personal", mailboxUser: DEFAULT_USER, unread: false, archived: false,
      customerId: null, customer: "", contactName: "Brenda Gauchel", contactEmail: "brenda.t96@lakefront.k12.mn.us",
      subject: "Draft to send 2", channel: "email", status: "draft", assignedTo: "", link: null,
      draft: { to: "brenda.t96@lakefront.k12.mn.us", subject: "Draft to send 2", body: "Hi again" },
      messages: [], createdAt: r3now, updatedAt: r3now,
    });
    await sendDraft("C-r3senddraft2");
    r3t = await getThreadDoc("C-r3senddraft2");
    assert.equal((r3t?.messages || []).at(-1)?.author, DEFAULT_USER, "#128 review: sendDraft with no `me` still falls back to DEFAULT_USER");

    // The Gmail bridge can stamp an outbound message's author with whatever
    // display name the account had at send time — rowName must still read it
    // as "me" via direction, not by matching that name against anything.
    r3t = await getThreadDoc("C-r3senddraft");
    const r3row = rowName(r3t!);
    assert.equal(r3row.primary, "Brenda Gauchel", "#128 review: the sent reply (author 'Sarah Ops') doesn't become primary — the inbound message still does, since the outbound one is me by direction");
    assert.equal(r3row.secondary, "Brenda, me (2)", "#128 review: …and collapses into the 'me' chain slot regardless of its stamped author name");
  }

  /* --- part documents (#DOC): stores, links, accessory graph, legacy backfill --- */
  {
    const Docs = await import("@/lib/stores/part-documents");
    const Acc = await import("@/lib/stores/part-accessory-links");
    const { backfillLegacyDatasheets, legacyDocumentId } = await import("@/lib/part-docs/legacy");
    const { loadPartDocsState } = await import("@/lib/part-docs/load");
    const { slotCoverage } = await import("@/lib/part-docs/coverage");
    const { setDocNotNeeded } = await import("@/lib/part-docs/not-needed");
    const { upsert: upsertPart, get: getPart } = await import("@/lib/stores/catalog");
    const { listDocs } = await import("@/db/doc-store");

    const d = await Docs.createDocument({
      kind: "datasheet", fileName: "S4_LED_Datasheet.pdf", contentType: "application/pdf", size: 10,
      blobKey: "part-docs/PD-x/S4_LED_Datasheet.pdf", sourceUrl: null, source: "upload", by: "Jeff",
    });
    assert(d && /^PD-[0-9a-f]{12}$/.test(d.id), "part docs store: createDocument mints a PD- id");
    assert.equal(d!.title, "S4 LED Datasheet", "part docs store: the title defaults from the file name");
    assert.equal(await Docs.createDocument({ id: d!.id, kind: "datasheet", fileName: "x.pdf", contentType: "application/pdf", size: 1, blobKey: null, sourceUrl: null, source: "upload", by: "Jeff" }), null, "part docs store: an existing id is never overwritten");

    assert.equal(await Docs.attachDocument(d!.id, ["DOC-FIX", "DOC-FIX", "DOC-LENS2"], "Jeff"), 2, "part docs store: attach links each part once");
    assert.equal(await Docs.attachDocument(d!.id, ["DOC-FIX"], "Jeff"), 0, "part docs store: attaching again is a no-op");
    assert.equal((await Docs.allDocumentLinks()).filter((l) => l.documentId === d!.id).length, 2, "part docs store: one link row per part↔document");
    assert.equal(await Docs.detachDocument(d!.id, "DOC-LENS2"), true, "part docs store: detach removes a live link");
    assert.equal(await Docs.detachDocument(d!.id, "DOC-LENS2"), false, "part docs store: detaching twice reports nothing removed");
    assert.equal((await Docs.allDocumentLinks()).filter((l) => l.documentId === d!.id).length, 1, "part docs store: a detached link leaves the live list");
    assert.equal(await Docs.attachDocument(d!.id, ["DOC-LENS2"], "Jeff"), 1, "part docs store: re-attaching revives the same row");
    assert.equal(await Docs.ensureLinks([{ partSku: "DOC-OTHER", documentId: d!.id, kind: "datasheet" }], "Jeff"), 1, "part docs store: ensureLinks adds a new pair");
    await Docs.detachDocument(d!.id, "DOC-OTHER");
    assert.equal(await Docs.ensureLinks([{ partSku: "DOC-OTHER", documentId: d!.id, kind: "datasheet" }], "Jeff"), 0, "part docs store: ensureLinks never re-attaches a pair a human detached");

    const replaced = await Docs.replaceDocumentFile(d!.id, { blobKey: "part-docs/PD-x/v2.pdf", fileName: "v2.pdf", contentType: "application/pdf", size: 20 }, "Chris", 5000);
    assert.equal(replaced?.blobKey, "part-docs/PD-x/v2.pdf", "part docs store: replace points at the new file");
    assert.deepEqual(replaced?.history, [{ blobKey: "part-docs/PD-x/S4_LED_Datasheet.pdf", fileName: "S4_LED_Datasheet.pdf", size: 10, replacedAt: 5000, replacedBy: "Chris" }], "part docs store: the replaced file is kept in history");
    await Docs.recordFetchResult(d!.id, { ok: false, error: "HTTP 404" }, 6000);
    assert.deepEqual((await Docs.getDocument(d!.id))?.lastFetch, { at: 6000, ok: false, error: "HTTP 404" }, "part docs store: a fetch failure is remembered with its reason");
    assert.equal(await Docs.getDocument("../etc"), null, "part docs store: a non-id never reaches the table");

    // accessory graph
    const r1 = await Acc.syncAccessoryLinks({ source: "assembly", sourceRef: "fa-doc-1" }, [
      { parentSku: "DOC-FIX", accessorySku: "DOC-LENS" },
      { parentSku: "DOC-FIX", accessorySku: "DOC-CLAMP", included: true },
      { parentSku: "DOC-FIX", accessorySku: "DOC-FIX" },
    ]);
    assert.deepEqual(r1, { written: 2, removed: 0 }, "part docs graph: sync writes each pair once and drops a self-link");
    assert.deepEqual(await Acc.syncAccessoryLinks({ source: "assembly", sourceRef: "fa-doc-1" }, [
      { parentSku: "DOC-FIX", accessorySku: "DOC-LENS" },
      { parentSku: "DOC-FIX", accessorySku: "DOC-CLAMP", included: true },
    ]), { written: 0, removed: 0 }, "part docs graph: an unchanged re-sync writes nothing");
    assert.equal(await Acc.setOwnDatasheet("DOC-FIX", "DOC-CLAMP", true), 1, "part docs graph: the own-datasheet toggle flags the pair");
    const r2 = await Acc.syncAccessoryLinks({ source: "assembly", sourceRef: "fa-doc-1" }, [{ parentSku: "DOC-FIX", accessorySku: "DOC-CLAMP", included: true }]);
    assert.deepEqual(r2, { written: 0, removed: 1 }, "part docs graph: a pair the assembly dropped is removed");
    assert.equal((await Acc.allAccessoryLinks()).find((l) => l.accessorySku === "DOC-CLAMP")?.ownDatasheet, true, "part docs graph: re-saving keeps the own-datasheet flag");
    await Acc.syncAccessoryLinks({ source: "assembly", sourceRef: "fa-doc-2" }, [{ parentSku: "DOC-FIX", accessorySku: "DOC-LENS" }]);
    assert.equal((await Acc.allAccessoryLinks()).filter((l) => l.sourceRef === "fa-doc-1").length, 1, "part docs graph: another assembly's sync never touches this one's links");

    // coverage over the stored graph, via the one-load loader
    await upsertPart({ sku: "DOC-FIX", desc: "Fixture", category: "Lighting", unit: "ea", list: 1, cost: 1 });
    await upsertPart({ sku: "DOC-LENS", desc: "Lens", category: "Lighting", unit: "ea", list: 1, cost: 1 });
    const parts = [(await getPart("DOC-FIX"))!, (await getPart("DOC-LENS"))!];
    const state = await loadPartDocsState(parts);
    assert.equal(slotCoverage(state.index, "DOC-LENS", "datasheet").state, "covered", "part docs graph: an assembly member is covered by the fixture's datasheet");

    // not-needed marks ride on the catalog part through mergeUpsert
    assert.equal(await setDocNotNeeded(["DOC-LENS", "NO-SUCH-PART"], "specsheet", true), 1, "part docs not-needed: marks live parts only");
    const lens = await getPart("DOC-LENS");
    assert.deepEqual(lens?.docNotNeeded, { specsheet: true }, "part docs not-needed: the mark is on the part");
    assert.equal(lens?.desc, "Lens", "part docs not-needed: mergeUpsert leaves the rest of the part alone");
    assert.equal(await getPart("NO-SUCH-PART"), null, "part docs not-needed: never creates a part");
    await setDocNotNeeded(["DOC-LENS"], "specsheet", false);
    assert.equal((await getPart("DOC-LENS"))?.docNotNeeded, undefined, "part docs not-needed: clearing the last mark removes the field");

    // legacy backfill
    await upsertPart({ sku: "DOC-LEGACY", desc: "Legacy", category: "Lighting", unit: "ea", list: 1, cost: 1, datasheetBlobKey: "part-datasheets/DOC-LEGACY/old.pdf", datasheetName: "old.pdf" });
    const legacy = (await getPart("DOC-LEGACY"))!;
    assert.deepEqual(await backfillLegacyDatasheets([legacy]), { created: 1 }, "part docs legacy: a datasheetBlobKey becomes a shared document");
    const ldoc = await Docs.getDocument(legacyDocumentId("DOC-LEGACY"));
    assert(ldoc?.source === "legacy" && ldoc.blobKey === "part-datasheets/DOC-LEGACY/old.pdf" && ldoc.fileName === "old.pdf", "part docs legacy: the document keeps the old blob and name");
    assert.equal((await Docs.allDocumentLinks()).filter((l) => l.partSku === "DOC-LEGACY").length, 1, "part docs legacy: and is linked to its part");
    assert.deepEqual(await backfillLegacyDatasheets([legacy]), { created: 0 }, "part docs legacy: a second run writes nothing");
    await Docs.detachDocument(legacyDocumentId("DOC-LEGACY"), "DOC-LEGACY");
    await backfillLegacyDatasheets([legacy]);
    assert.equal((await Docs.allDocumentLinks()).filter((l) => l.partSku === "DOC-LEGACY").length, 0, "part docs legacy: a detached legacy document stays detached");
    assert.equal((await getPart("DOC-LEGACY"))?.datasheetBlobKey, "part-datasheets/DOC-LEGACY/old.pdf", "part docs legacy: datasheetBlobKey stays readable");
    assert((await listDocs("part_documents")).some((x) => x.id === legacyDocumentId("DOC-LEGACY")), "part docs legacy: the document itself is never deleted");
  }

  /* --- part documents (#DOC): fetch from links, shared per URL --- */
  {
    const { upsert: upsertPart, list: listParts } = await import("@/lib/stores/catalog");
    const { loadPartDocsState } = await import("@/lib/part-docs/load");
    const { buildFetchContext, fetchSlot } = await import("@/lib/part-docs/fetch-links");
    const { slotCoverage } = await import("@/lib/part-docs/coverage");
    const Docs = await import("@/lib/stores/part-documents");
    const U1 = "https://etc.example/s4-datasheet.pdf";
    const U2 = "https://etc.example/broken.pdf";
    await upsertPart({ sku: "FETCH-A", desc: "A", category: "Lighting", unit: "ea", list: 1, cost: 1, docs: [{ kind: "datasheet", label: "DS", url: U1 }] });
    await upsertPart({ sku: "FETCH-B", desc: "B", category: "Lighting", unit: "ea", list: 1, cost: 1, productMetadata: { datasheets: [{ kind: "datasheet", fileName: "ds.pdf", sourceUrl: U1 }] } });
    await upsertPart({ sku: "FETCH-C", desc: "C", category: "Lighting", unit: "ea", list: 1, cost: 1, docs: [{ kind: "datasheet", label: "DS", url: U2 }] });
    await upsertPart({ sku: "FETCH-D", desc: "D", category: "Lighting", unit: "ea", list: 1, cost: 1 });

    const fetched: string[] = [];
    let brokenWorks = false;
    const ALWAYS_BROKEN_URLS = new Set(["https://etc.example/always-broken.pdf"]);
    const deps = {
      fetchDoc: async (url: string) => {
        fetched.push(url);
        if ((url === U2 && !brokenWorks) || ALWAYS_BROKEN_URLS.has(url)) return { ok: true as const, file: { bytes: new TextEncoder().encode("<html>error</html>"), contentDisposition: null, finalUrl: url } };
        return { ok: true as const, file: { bytes: new TextEncoder().encode("%PDF-1.7 x"), contentDisposition: null, finalUrl: url } };
      },
      putFile: async (pathname: string) => ({ pathname: pathname.replace(/\.pdf$/, "-rnd.pdf") }),
    };
    const ctxFor = async () => buildFetchContext(await loadPartDocsState(await listParts()));

    const a = await fetchSlot(await ctxFor(), { sku: "FETCH-A", kind: "datasheet" }, "Jeff", deps);
    assert(a.ok && a.documentId && a.alsoLinked === 2, "part docs fetch: a fetched URL is attached to every part that referenced it");
    const doc = await Docs.getDocument(a.documentId!);
    assert(doc?.source === "fetch" && doc.sourceUrl === U1 && doc.blobKey?.startsWith(`part-docs/${doc.id}/`) && doc.lastFetch?.ok === true, "part docs fetch: the document stores the file privately under part-docs/<id>/ and remembers the URL");
    const state = await loadPartDocsState(await listParts());
    assert.equal(slotCoverage(state.index, "FETCH-B", "datasheet").state, "own", "part docs fetch: the other part is satisfied without a second download");
    const b = await fetchSlot(await ctxFor(), { sku: "FETCH-B", kind: "datasheet" }, "Jeff", deps);
    assert(b.ok && fetched.filter((u) => u === U1).length === 1, "part docs fetch: a URL is downloaded once, ever");

    const c1 = await fetchSlot(await ctxFor(), { sku: "FETCH-C", kind: "datasheet" }, "Jeff", deps);
    assert(!c1.ok && c1.error === "That file is not a PDF.", "part docs fetch: bytes that aren't a PDF are refused with the reason");
    const cState = await loadPartDocsState(await listParts());
    const cSlot = slotCoverage(cState.index, "FETCH-C", "datasheet");
    assert(cSlot.state === "link-only" && cSlot.docs.length === 1, "part docs fetch: the failed URL becomes a link-only document on the part");
    const failedDoc = await Docs.getDocument(cSlot.state === "link-only" ? cSlot.docs[0].id : "");
    assert.deepEqual([failedDoc?.lastFetch?.ok, failedDoc?.lastFetch?.error], [false, "That file is not a PDF."], "part docs fetch: …carrying the failure reason for the page to list");
    brokenWorks = true;
    const c2 = await fetchSlot(await ctxFor(), { sku: "FETCH-C", kind: "datasheet" }, "Jeff", deps);
    assert(c2.ok && c2.documentId === failedDoc?.id, "part docs fetch: a retry that succeeds fills the same document");
    assert.equal((await Docs.getDocument(failedDoc!.id))?.lastFetch?.ok, true, "part docs fetch: …and clears the failure");

    const d = await fetchSlot(await ctxFor(), { sku: "FETCH-D", kind: "datasheet" }, "Jeff", deps);
    assert(!d.ok && d.error === "No link to fetch.", "part docs fetch: a part with no link says so");

    /* --- review fix wave 1, M1: kind-keyed dedupe — a URL fetched as a
       datasheet for one part must never reuse or attach to a spec-sheet
       document for another part referencing the SAME url, and vice versa. --- */
    {
      const U3 = "https://etc.example/shared-doc.pdf";
      await upsertPart({ sku: "FETCH-F", desc: "F", category: "Lighting", unit: "ea", list: 1, cost: 1, docs: [{ kind: "datasheet", label: "DS", url: U3 }] });
      await upsertPart({ sku: "FETCH-G", desc: "G", category: "Lighting", unit: "ea", list: 1, cost: 1, productMetadata: { datasheets: [{ kind: "guide-spec", fileName: "spec.pdf", sourceUrl: U3 }] } });

      const f = await fetchSlot(await ctxFor(), { sku: "FETCH-F", kind: "datasheet" }, "Jeff", deps);
      assert(f.ok && !!f.documentId, "part docs fetch M1: the datasheet slot for a shared URL fetches fine");
      const g = await fetchSlot(await ctxFor(), { sku: "FETCH-G", kind: "specsheet" }, "Jeff", deps);
      assert(g.ok && !!g.documentId && g.documentId !== f.documentId, "part docs fetch M1: the SAME url fetched for a different kind makes its own document, not the other kind's");
      const gDoc = await Docs.getDocument(g.documentId!);
      assert.equal(gDoc?.kind, "specsheet", "part docs fetch M1: the new document carries the kind it was fetched for");

      const links = await Docs.allDocumentLinks();
      assert(!links.some((l) => l.partSku === "FETCH-F" && l.documentId === g.documentId), "part docs fetch M1: the datasheet part is never linked to the spec-sheet document from the same url");
      assert(!links.some((l) => l.partSku === "FETCH-G" && l.documentId === f.documentId), "part docs fetch M1: the spec-sheet part is never linked to the datasheet document from the same url");
    }

    /* --- review fix wave 1, M2: a failed URL is shared with every part
       that referenced it, and never re-downloaded within the SAME call --- */
    {
      const U4 = "https://etc.example/always-broken.pdf";
      await upsertPart({ sku: "FETCH-E1", desc: "E1", category: "Lighting", unit: "ea", list: 1, cost: 1, docs: [{ kind: "datasheet", label: "DS", url: U4 }] });
      await upsertPart({ sku: "FETCH-E2", desc: "E2", category: "Lighting", unit: "ea", list: 1, cost: 1, docs: [{ kind: "datasheet", label: "DS", url: U4 }] });

      const sharedCtx = await ctxFor(); // ONE context reused across both calls — same as one fetchLinksAction batch
      const before = fetched.filter((u) => u === U4).length;
      const e1 = await fetchSlot(sharedCtx, { sku: "FETCH-E1", kind: "datasheet" }, "Jeff", deps);
      assert(!e1.ok && e1.error === "That file is not a PDF.", "part docs fetch M2: the first part sharing a broken url fails normally");
      const e2 = await fetchSlot(sharedCtx, { sku: "FETCH-E2", kind: "datasheet" }, "Jeff", deps);
      assert(!e2.ok && e2.error === "That file is not a PDF.", "part docs fetch M2: the second part sharing the SAME broken url in the same call reports the same failure");
      assert.equal(fetched.filter((u) => u === U4).length, before + 1, "part docs fetch M2: the broken url is downloaded only once across both parts in the same call");

      const eState = await loadPartDocsState(await listParts());
      const e1Slot = slotCoverage(eState.index, "FETCH-E1", "datasheet");
      const e2Slot = slotCoverage(eState.index, "FETCH-E2", "datasheet");
      assert(e1Slot.state === "link-only" && e2Slot.state === "link-only" && e1Slot.docs[0].id === e2Slot.docs[0].id, "part docs fetch M2: both parts sharing the broken url end up pointing at the SAME failed link-only document");
    }

    /* --- review fix wave 1, M3: a thrown store/blob write is caught and
       isolated — the slot reports a fixed refusal, the batch continues --- */
    {
      await upsertPart({ sku: "FETCH-H", desc: "H", category: "Lighting", unit: "ea", list: 1, cost: 1, docs: [{ kind: "datasheet", label: "DS", url: "https://etc.example/throws.pdf" }] });
      await upsertPart({ sku: "FETCH-I", desc: "I", category: "Lighting", unit: "ea", list: 1, cost: 1, docs: [{ kind: "datasheet", label: "DS", url: "https://etc.example/fine.pdf" }] });
      const throwingDeps = { fetchDoc: deps.fetchDoc, putFile: async (): Promise<{ pathname: string }> => { throw new Error("blob store is down"); } };

      const h = await fetchSlot(await ctxFor(), { sku: "FETCH-H", kind: "datasheet" }, "Jeff", throwingDeps);
      assert(!h.ok && h.error === "Could not store the file.", "part docs fetch M3: a thrown putFile is caught and reported, never thrown out of fetchSlot");
      const i = await fetchSlot(await ctxFor(), { sku: "FETCH-I", kind: "datasheet" }, "Jeff", deps);
      assert(i.ok && !!i.documentId, "part docs fetch M3: a later slot in the same batch still succeeds after an isolated throw");
    }

    /* --- review fix wave 1, I1: the per-call wall-clock budget — a target
       past the deadline is never attempted and says so with fixed text --- */
    {
      const { createFetchBudget, NOT_ATTEMPTED_ERROR } = await import("@/lib/part-docs/fetch-links");
      await upsertPart({ sku: "FETCH-J1", desc: "J1", category: "Lighting", unit: "ea", list: 1, cost: 1, docs: [{ kind: "datasheet", label: "DS", url: "https://etc.example/j1.pdf" }] });
      await upsertPart({ sku: "FETCH-J2", desc: "J2", category: "Lighting", unit: "ea", list: 1, cost: 1, docs: [{ kind: "datasheet", label: "DS", url: "https://etc.example/j2.pdf" }] });

      let clock = 0;
      const budget = createFetchBudget(1000, () => clock); // a budget far smaller than one fetch's 30s worst case
      const jCtx = await ctxFor();
      const before = fetched.length;

      const j1 = await fetchSlot(jCtx, { sku: "FETCH-J1", kind: "datasheet" }, "Jeff", deps, budget);
      assert(j1.ok, "part docs fetch I1: the very first fetch of a call always runs, even under a budget smaller than one worst case");
      assert.equal(fetched.length, before + 1, "part docs fetch I1: …and it actually fetched");

      clock += 999; // only 1ms of the 1000ms budget left — nowhere near FETCH_WORST_CASE_MS
      const j2 = await fetchSlot(jCtx, { sku: "FETCH-J2", kind: "datasheet" }, "Jeff", deps, budget);
      assert(!j2.ok && j2.error === NOT_ATTEMPTED_ERROR, "part docs fetch I1: a target past the deadline comes back as not attempted, with the fixed text");
      assert.equal(fetched.length, before + 1, "part docs fetch I1: …and no fetch was made for it");
    }
  }

  /* --- part documents (#DOC): Assembly Builder saves sync the graph in one pass --- */
  {
    const Acc = await import("@/lib/stores/part-accessory-links");
    const first = await Acc.syncAccessoryScopes("assembly", "assembly:", [
      { sourceRef: "assembly:fa-sync-1", pairs: [{ parentSku: "SYNC-FIX", accessorySku: "SYNC-LENS" }] },
      { sourceRef: "assembly:fa-sync-2", pairs: [{ parentSku: "SYNC-FIX2", accessorySku: "SYNC-CLAMP" }] },
    ]);
    assert.deepEqual(first, { written: 2, removed: 0 }, "part docs graph: one save writes every assembly's links");
    await Acc.syncAccessoryLinks({ source: "assembly", sourceRef: "subassembly:SA-sync" }, [{ parentSku: "SYNC-FIX", accessorySku: "SYNC-OPT" }]);
    const second = await Acc.syncAccessoryScopes("assembly", "assembly:", [
      { sourceRef: "assembly:fa-sync-1", pairs: [{ parentSku: "SYNC-FIX", accessorySku: "SYNC-LENS" }] },
    ]);
    assert.deepEqual(second, { written: 0, removed: 1 }, "part docs graph: an assembly deleted from the list loses its links");
    assert((await Acc.allAccessoryLinks()).some((l) => l.sourceRef === "subassembly:SA-sync"), "part docs graph: a subassembly's links are outside the assemblies prefix and survive");
  }

  /* --- part documents (#DOC): DaVinci pre-fill apply is idempotent --- */
  {
    const { applyPrefill, davinciDocumentId } = await import("@/lib/part-docs/davinci-apply");
    const Docs = await import("@/lib/stores/part-documents");
    const Acc = await import("@/lib/stores/part-accessory-links");
    const url = "https://etc.example/prefill-ds.pdf";
    const plan = {
      libraryTimestamp: "t",
      documents: [{ url, label: "CSPAR Datasheet", typeId: "TY-1", skus: ["PF-CSPAR", "PF-CSPAR2"] }],
      accessoryPairs: [{ parentSku: "PF-CSPAR", accessorySku: "PF-LENS", maxQty: 2, sourceRef: "TY-1" }],
      stats: { parts: 3, typesMatched: 2, documents: 1, documentLinks: 2, accessoryPairs: 1, accessoryLinksUnmatched: 0 },
    };
    const first = await applyPrefill(plan, "DaVinci pre-fill");
    assert.deepEqual(first, { documentsCreated: 1, linksCreated: 2, accessoryWritten: 1, accessoryRemoved: 0, complete: true }, "part docs prefill: documents, links and the graph are written");
    const doc = await Docs.getDocument(davinciDocumentId(url));
    assert(doc && doc.source === "davinci" && doc.blobKey === null && doc.sourceUrl === url && doc.language === "en" && doc.title === "CSPAR Datasheet", "part docs prefill: a link-only DaVinci document — nothing downloaded");
    assert.deepEqual(await applyPrefill(plan, "DaVinci pre-fill"), { documentsCreated: 0, linksCreated: 0, accessoryWritten: 0, accessoryRemoved: 0, complete: true }, "part docs prefill: a second run writes nothing");
    await Docs.detachDocument(doc!.id, "PF-CSPAR2");
    await applyPrefill(plan, "DaVinci pre-fill");
    assert(!(await Docs.allDocumentLinks()).some((l) => l.partSku === "PF-CSPAR2"), "part docs prefill: a human's detach survives a re-run");
    const dropped = await applyPrefill({ ...plan, accessoryPairs: [] }, "DaVinci pre-fill");
    assert.equal(dropped.accessoryRemoved, 1, "part docs prefill: a pair ETC dropped from the library is removed");
    assert(!(await Acc.allAccessoryLinks()).some((l) => l.source === "davinci" && l.accessorySku === "PF-LENS"), "part docs prefill: …from the live graph");

    const fetchedUrl = "https://etc.example/already-fetched.pdf";
    const fetched = await Docs.createDocument({ kind: "datasheet", fileName: "f.pdf", contentType: "application/pdf", size: 5, blobKey: "part-docs/x/f.pdf", sourceUrl: fetchedUrl, source: "fetch", by: "Jeff" });
    await applyPrefill({ ...plan, documents: [{ url: fetchedUrl, label: "F", typeId: "TY-2", skus: ["PF-F"] }] }, "DaVinci pre-fill");
    assert.equal(await Docs.getDocument(davinciDocumentId(fetchedUrl)), null, "part docs prefill: a URL someone already fetched gets no second document");
    assert((await Docs.allDocumentLinks()).some((l) => l.partSku === "PF-F" && l.documentId === fetched!.id), "part docs prefill: …the part is linked to the fetched one instead");
  }

  /* --- part documents (#DOC) review fix wave 1: batched doc-store writes
         mean exactly what their single-row versions mean --- */
  {
    const DS = await import("@/db/doc-store");
    const { getDb } = await import("@/db");
    const { DOC_TABLES } = await import("@/db/doc-tables");
    const { inArray } = await import("drizzle-orm");
    const coll = "review_snapshots" as const;
    const t = DOC_TABLES[coll];
    const rowsOf = async (ids: string[]) => {
      const db = await getDb();
      const rows = await db.select().from(t).where(inArray(t.id, ids));
      return new Map(rows.map((r) => [r.id, r]));
    };
    // Twin rows: S-* go through the single-row API, B-* through the batch one.
    const seedBoth = async (suffix: string, doc: Record<string, unknown>) => {
      await DS.upsertDoc(coll, { id: `S-${suffix}`, ...doc });
      await DS.upsertDoc(coll, { id: `B-${suffix}`, ...doc });
    };
    await seedBoth("live", { v: 1 });
    await seedBoth("gone", { v: 1 });
    await DS.softDeleteDoc(coll, "S-gone");
    await DS.softDeleteDoc(coll, "B-gone");
    await DS.setReview(coll, "S-live", { state: "seen" });
    await DS.setReview(coll, "B-live", { state: "seen" });
    const same = async (suffixes: string[], label: string) => {
      const rows = await rowsOf(suffixes.flatMap((x) => [`S-${x}`, `B-${x}`]));
      for (const x of suffixes) {
        const a = rows.get(`S-${x}`);
        const b = rows.get(`B-${x}`);
        assert(a && b, `${label}: both twins exist (${x})`);
        const strip = (d: unknown) => { const { id: _id, ...rest } = d as Record<string, unknown>; void _id; return rest; };
        assert.deepEqual(
          // review.at is setReview's own clock stamp — the twins were triaged a millisecond apart.
          { doc: strip(b!.doc), rev: b!.rev, deleted: b!.deleted, review: { ...(b!.review ?? {}), at: 0 } },
          { doc: strip(a!.doc), rev: a!.rev, deleted: a!.deleted, review: { ...(a!.review ?? {}), at: 0 } },
          `${label}: the batch row matches its single-row twin (${x})`
        );
      }
    };

    // insertDocsIfAbsent ≡ insertDocIfAbsent: new → inserted; live or
    // soft-deleted → untouched; a duplicate inside the batch → first wins.
    const singleIns = [
      await DS.insertDocIfAbsent(coll, { id: "S-new", v: 2 }),
      await DS.insertDocIfAbsent(coll, { id: "S-live", v: 2 }),
      await DS.insertDocIfAbsent(coll, { id: "S-gone", v: 2 }),
      await DS.insertDocIfAbsent(coll, { id: "S-dup", v: "first" }),
      await DS.insertDocIfAbsent(coll, { id: "S-dup", v: "second" }),
    ];
    assert.deepEqual(singleIns, [true, false, false, true, false], "batch writes: the single-row baseline behaves as documented");
    const ins = await DS.insertDocsIfAbsent(coll, [
      { id: "B-new", v: 2 }, { id: "B-live", v: 2 }, { id: "B-gone", v: 2 }, { id: "B-dup", v: "first" }, { id: "B-dup", v: "second" },
    ]);
    assert.deepEqual({ ids: [...ins.ids].sort(), complete: ins.complete }, { ids: ["B-dup", "B-new"], complete: true }, "batch writes: insertDocsIfAbsent reports only the rows it inserted");
    await same(["new", "live", "gone", "dup"], "batch writes: insertDocsIfAbsent");
    assert.equal(await DS.getDoc(coll, "B-gone"), null, "batch writes: insertDocsIfAbsent never revives a soft-deleted row");

    // upsertDocs ≡ upsertDoc: replace the doc, bump rev, revive a soft-deleted
    // row, keep review; a duplicate id inside the batch keeps the LAST doc.
    const seqBefore = await rowsOf(["B-live", "B-gone"]);
    await DS.upsertDoc(coll, { id: "S-live", v: 3 });
    await DS.upsertDoc(coll, { id: "S-gone", v: 3 });
    await DS.upsertDoc(coll, { id: "S-fresh", v: 3 });
    const up = await DS.upsertDocs(coll, [{ id: "B-live", v: 3 }, { id: "B-gone", v: 3 }, { id: "B-fresh", v: 3 }]);
    assert.deepEqual({ n: up.ids.length, complete: up.complete }, { n: 3, complete: true }, "batch writes: upsertDocs reports every row written");
    await same(["live", "gone", "fresh"], "batch writes: upsertDocs");
    const seqAfter = await rowsOf(["B-live", "B-gone"]);
    assert(Number(seqAfter.get("B-live")!.seq) > Number(seqBefore.get("B-live")!.seq) && Number(seqAfter.get("B-gone")!.seq) > Number(seqBefore.get("B-gone")!.seq), "batch writes: the _seq_bump trigger fires per row on a multi-row upsert");
    await DS.upsertDocs(coll, [{ id: "B-last", v: "a" }, { id: "B-last", v: "b" }]);
    assert.equal((await DS.getDoc<{ id: string; v: string }>(coll, "B-last"))?.v, "b", "batch writes: a duplicate id in one upsertDocs keeps the last document");

    // softDeleteDocs ≡ softDeleteDoc, and pull-sync sees every batched change.
    const cursor = Math.max(...[...(await rowsOf(["S-live", "B-live", "S-new", "B-new", "S-fresh", "B-fresh"])).values()].map((r) => Number(r.seq)));
    await DS.softDeleteDoc(coll, "S-live");
    await DS.softDeleteDoc(coll, "S-new");
    await DS.softDeleteDoc(coll, "S-missing");
    const del = await DS.softDeleteDocs(coll, ["B-live", "B-new", "B-missing", "B-live"]);
    assert.deepEqual({ ids: [...del.ids].sort(), complete: del.complete }, { ids: ["B-live", "B-new"], complete: true }, "batch writes: softDeleteDocs reports the rows that matched");
    await same(["live", "new"], "batch writes: softDeleteDocs");
    const pulled = await DS.listSince(coll, cursor, 1000);
    assert(["B-live", "B-new"].every((id) => pulled.changes.some((c) => c.id === id && c.deleted)), "batch writes: pull-sync (listSince) sees batched soft-deletes");
    const pulled2 = await DS.listSince(coll, 0, 5000);
    assert(["B-fresh", "B-dup"].every((id) => pulled2.changes.some((c) => c.id === id)), "batch writes: pull-sync sees batched inserts");

    // Chunking + the between-chunks stop.
    let chunks = 0;
    const many = Array.from({ length: 7 }, (_, i) => ({ id: `B-chunk-${i}`, v: i }));
    const stopped = await DS.insertDocsIfAbsent(coll, many, { chunkSize: 3, shouldStop: () => ++chunks > 1 });
    assert.deepEqual({ n: stopped.ids.length, complete: stopped.complete }, { n: 3, complete: false }, "batch writes: shouldStop halts cleanly between chunks");
    const rest = await DS.insertDocsIfAbsent(coll, many, { chunkSize: 3 });
    assert.deepEqual({ n: rest.ids.length, complete: rest.complete }, { n: 4, complete: true }, "batch writes: a re-run writes exactly the rest");
    assert.deepEqual(await DS.upsertDocs(coll, []), { ids: [], complete: true }, "batch writes: an empty batch is a complete no-op");
  }

  /* --- part documents (#DOC) review fix wave 1: the pre-fill at production
         scale is batched, budgeted, and resumable --- */
  {
    const { applyPrefill, createPrefillStopper } = await import("@/lib/part-docs/davinci-apply");
    const Acc = await import("@/lib/stores/part-accessory-links");
    // Production-sized (spec review: ~362 documents, ~3,959 links, ~6,666
    // pairs): 400 documents × 10 parts, 7,000 pairs — many 500-row chunks.
    const documents = Array.from({ length: 400 }, (_, i) => ({
      url: `https://etc.example/bulk/${i}.pdf`, label: `Bulk ${i} Datasheet`, typeId: `TY-B${i}`,
      skus: Array.from({ length: 10 }, (_, j) => `PFB-${i}-${j}`),
    }));
    const accessoryPairs = Array.from({ length: 7000 }, (_, i) => ({ parentSku: `PFB-${i % 400}-0`, accessorySku: `PFB-ACC-${i}`, maxQty: 1, sourceRef: `TY-B${i % 400}` }));
    const plan = { libraryTimestamp: "t", documents, accessoryPairs, stats: { parts: 4000, typesMatched: 400, documents: 400, documentLinks: 4000, accessoryPairs: 7000, accessoryLinksUnmatched: 0 } };
    const priorDavinci = (await Acc.allAccessoryLinks()).filter((l) => l.source === "davinci").length;

    // A budget that allows 5 chunks: the documents (1) + 4 of the 8 link chunks.
    let allowed = 5;
    const cut = await applyPrefill(plan, "DaVinci pre-fill", { shouldStop: () => allowed-- <= 0 });
    assert.deepEqual(cut, { documentsCreated: 400, linksCreated: 2000, accessoryWritten: 0, accessoryRemoved: 0, complete: false }, "part docs prefill (scale): a run out of budget stops cleanly between chunks and says so");
    let t0 = Date.now();
    const resumed = await applyPrefill(plan, "DaVinci pre-fill");
    const resumeMs = Date.now() - t0;
    assert.deepEqual(resumed, { documentsCreated: 0, linksCreated: 2000, accessoryWritten: 7000, accessoryRemoved: priorDavinci, complete: true }, "part docs prefill (scale): clicking again finishes exactly the rest");
    t0 = Date.now();
    const again = await applyPrefill(plan, "DaVinci pre-fill");
    const rerunMs = Date.now() - t0;
    assert.deepEqual(again, { documentsCreated: 0, linksCreated: 0, accessoryWritten: 0, accessoryRemoved: 0, complete: true }, "part docs prefill (scale): a finished pre-fill re-runs as a no-op");
    console.log(`  part docs prefill (scale): resume 2,000 links + 7,000 pairs ${resumeMs} ms; no-op re-run ${rerunMs} ms`);

    // The action's stopper: the first chunk always runs; later ones only
    // while a worst-case chunk still fits in the budget.
    let clock = 0;
    const stop = createPrefillStopper(10_000, 3_000, () => clock);
    clock = 20_000;
    assert.equal(stop(), false, "part docs prefill: the first chunk runs even past the budget (forward progress)");
    assert.equal(stop(), true, "part docs prefill: a later chunk past the budget does not start");
    clock = 0;
    const stop2 = createPrefillStopper(10_000, 3_000, () => clock);
    assert.equal(stop2(), false, "part docs prefill: stopper — first chunk");
    clock = 6_999;
    assert.equal(stop2(), false, "part docs prefill: stopper — a chunk that fits starts");
    clock = 7_001;
    assert.equal(stop2(), true, "part docs prefill: stopper — a chunk that would overrun does not");
  }

  console.log("review regression checks passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
