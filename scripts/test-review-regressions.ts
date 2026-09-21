import assert from "node:assert/strict";
import { setRates as setFlameRates, getRates as getFlameRates } from "@/lib/flametest-engine";
import { setRates as setRepairRates, getRates as getRepairRates } from "@/lib/repair-engine";
import { setRates as setInspectionRates, getRates as getInspectionRates } from "@/lib/inspection-engine";
import { ensureEngagementForQuote } from "@/lib/stores/engagements";
import { upsertDoc, patchDoc } from "@/db/doc-store";
import type { Quote } from "@/lib/stores/quotes";
import { contactByEmail } from "@/lib/identity/lookup";
import { saveContact, setEmails } from "@/lib/identity/contacts";
import { claimDomain, customersForDomain } from "@/lib/gmail/domains";
import { applyResolution, applyResweepPatch, resolveForThread, resweepThreads } from "@/lib/gmail/linking";
import type { CommThread } from "@/lib/stores/comms";

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
  assert.equal(hit?.customerId, "lakefront", "#96 contactByEmail joins to the home company");
  const r1 = await resolveForThread("brenda.t96@lakefront.k12.mn.us");
  assert.equal(r1.kind, "linked", "#96 exact contact links");
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

  console.log("review regression checks passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
