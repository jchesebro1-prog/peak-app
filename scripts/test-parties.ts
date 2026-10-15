/* #346 estimate parties — harness checks. `partyChecks` is pure; `partyDbChecks` needs the test DB.
   Run the pure half alone with `npx tsx scripts/test-parties.ts`. */
import { like, sql } from "drizzle-orm";
import type { Ok } from "./test-inbox-org";
import { getDb, withSavepoint, withTransaction } from "../src/db";
import { companies, contacts as contactsTable } from "../src/db/schema";
import { DOC_TABLES, SYNCABLE_COLLECTIONS } from "../src/db/doc-tables";
import { DEMO_COLLECTIONS } from "../src/db/seed-data";
import { saveCompany } from "../src/lib/identity/companies";
import { saveContact } from "../src/lib/identity/contacts";
import { createFixture, dropFixtures, fixtureId, registerFixture } from "./test-fixtures";
import { buildQuote } from "../src/lib/stores/quotes";
import { createProjectFromQuote } from "../src/lib/stores/projects";
import { autoTaskId } from "../src/lib/stores/tasks";
import { convert } from "../src/lib/stores/leads";
import { buildOpportunities, type OppLeadInput, type OppQuoteInput } from "../src/lib/opportunities";
import { addParty, copyParties, listFor, listForCompany, listForRecords, partyId, removeParty, setPartyContact } from "../src/lib/stores/parties";
import {
  PARTY_ROLES, PARTY_RECORD_TYPES, ROLE_LABEL, ROLE_SHORT, partyInputProblem, normalizePartyInput, ownerConflict, carriesTo,
  partyRoleText, groupPartiesByRole, sortParties, leadEstimatesTotal, leadIdsWithEstimates, type Party,
} from "../src/lib/parties/rules";

const P = (over: Partial<Party>): Party => ({
  id: "pty_x", recordType: "quote", recordId: "Q-1", companyId: "acme", contactId: null, role: "gc", roleLabel: null, bid: null,
  createdAt: 1, createdBy: "u1", updatedAt: 1, ...over,
});

export async function partyChecks(ok: Ok) {
  ok(PARTY_ROLES.join() === "owner,gc,ec,architect,consultant,vendor,other", "parties: role keys + order");
  ok(PARTY_RECORD_TYPES.join() === "lead,quote,project", "parties: record types");
  ok(ROLE_LABEL.consultant === "Theatre / AV consultant" && ROLE_LABEL.gc === "General contractor" && ROLE_LABEL.ec === "Electrical contractor", "parties: role labels copy");
  ok(ROLE_SHORT.gc === "GC" && ROLE_SHORT.ec === "EC", "parties: short labels");

  const base = { recordType: "lead" as const, recordId: "L-1050", companyId: "acme", role: "gc" as const };
  ok(partyInputProblem(base) === null, "parties: a plain GC row is valid");
  ok(partyInputProblem({ ...base, recordType: "invoice" as never }) === "Unknown record type.", "parties: bad record type refused");
  ok(partyInputProblem({ ...base, role: "plumber" as never }) === "Unknown role.", "parties: bad role refused");
  ok(partyInputProblem({ ...base, companyId: "  " }) === "Pick a company.", "parties: company required");
  ok(partyInputProblem({ ...base, recordId: "" }) === "Missing record.", "parties: record id required");
  ok(partyInputProblem({ ...base, role: "other" }) === "Name the role.", "parties: other needs a label");
  ok(partyInputProblem({ ...base, role: "other", roleLabel: "x".repeat(61) }) === "Keep the role under 60 characters.", "parties: other label ≤ 60");
  ok(partyInputProblem({ ...base, role: "other", roleLabel: " CM " }) === null, "parties: other with a label is valid");
  ok(partyInputProblem({ ...base, companyId: "x".repeat(121) }) === "Missing record.", "parties: over-long ids refused");

  const n = normalizePartyInput({ ...base, roleLabel: "ignored", contactId: "" });
  ok(n.roleLabel === null && n.contactId === null, "parties: normalize drops label for non-other, blank contact → null");
  const n2 = normalizePartyInput({ ...base, role: "other", roleLabel: "  Construction manager  ", contactId: " ct-1 " });
  ok(n2.roleLabel === "Construction manager" && n2.contactId === "ct-1" && n2.companyId === "acme", "parties: normalize trims");

  const rows = [P({ role: "owner", companyId: "mpsd" }), P({ role: "gc", companyId: "acme" })];
  ok(ownerConflict(rows, { role: "owner", companyId: "other-co" }), "parties: a second owner company conflicts");
  ok(!ownerConflict(rows, { role: "owner", companyId: "mpsd" }), "parties: same owner company is not a conflict");
  ok(!ownerConflict(rows, { role: "gc", companyId: "x" }), "parties: non-owner never conflicts");

  ok(!carriesTo("lead", "quote", { role: "gc" }) && !carriesTo("lead", "quote", { role: "ec" }), "parties: lead→quote skips GC/EC");
  ok(["owner", "architect", "consultant", "vendor", "other"].every((r) => carriesTo("lead", "quote", { role: r as never })), "parties: lead→quote carries the rest");
  ok(PARTY_ROLES.every((r) => carriesTo("quote", "project", { role: r })), "parties: quote→project carries every role");
  ok(!carriesTo("project", "quote", { role: "owner" }), "parties: no other direction carries");

  ok(partyRoleText({ role: "other", roleLabel: "CM" }) === "CM" && partyRoleText({ role: "gc", roleLabel: null }) === "GC", "parties: role text");

  const g = groupPartiesByRole([P({ role: "vendor", id: "a" }), P({ role: "owner", id: "b" }), P({ role: "vendor", id: "c" })]);
  ok(g.map((x) => x.role).join() === "owner,vendor" && g[1].parties.length === 2 && g[0].label === "Owner", "parties: grouped in role order, empty groups omitted");

  const s = sortParties([P({ id: "b", role: "gc", createdAt: 2 }), P({ id: "a", role: "gc", createdAt: 2 }), P({ id: "c", role: "owner", createdAt: 9 })]);
  ok(s.map((x) => x.id).join() === "c,a,b", "parties: sort = role order, then createdAt, then id");

  ok(leadEstimatesTotal([{ status: "draft", value: 100.4 }, { status: "sent", value: 200 }, { status: "won", value: 50 }, { status: "lost", value: 999 }, {}]) === 350, "parties: estimates total sums draft/sent/won, rounds, skips lost");
  const w = leadIdsWithEstimates([{ leadId: "L-1" }, { leadId: null }, {}, { leadId: "L-2" }, { leadId: "L-1" }]);
  ok(w.size === 2 && w.has("L-1") && w.has("L-2"), "parties: lead ids with estimates");
  const leadIn = (id: string, extra: Partial<OppLeadInput> = {}): OppLeadInput => ({
    id, org: "Org", interest: "x", stage: "new", owner: "", value: 1000, createdAt: 1, updatedAt: 1, customerId: null, convertedCustomerId: null, convertedQuoteId: null, forecastAt: null, ...extra,
  });
  const board = buildOpportunities([leadIn("L-1"), leadIn("L-2", { hasEstimates: true })], []);
  ok(board.some((r) => r.id === "L-1") && !board.some((r) => r.id === "L-2"), "parties: board skips a lead whose estimates carry it");
  const quoteIn = (id: string, extra: Partial<OppQuoteInput> = {}): OppQuoteInput => ({
    id, name: "Q", customer: "C", status: "draft", owner: "", value: 500, createdAt: 1, updatedAt: 1, customerId: null, poReceivedAt: null, ...extra,
  });
  const fb = buildOpportunities(
    [leadIn("L-3", { hasEstimates: true, forecastAt: 1234 }), leadIn("L-4", { forecastAt: 5678 })],
    [quoteIn("Q-1", { leadId: "L-3" }), quoteIn("Q-2", { leadId: "L-4" })]
  );
  ok(fb.find((r) => r.id === "Q-1")?.forecastAt === 1234, "parties: an estimate inherits its skipped lead's forecast date");
  ok(fb.find((r) => r.id === "Q-2")?.forecastAt === null && fb.some((r) => r.id === "L-4"), "parties: a lead still on the board does not feed its forecast into its estimate");
}

export async function partyDbChecks(ok: Ok) {
  ok("record_parties" in DOC_TABLES, "parties db: record_parties is a registered doc collection");
  ok(!(SYNCABLE_COLLECTIONS as string[]).includes("record_parties"), "parties db: not syncable (server actions only)");
  ok(DEMO_COLLECTIONS.includes("record_parties" as never), "parties db: wiped by the go-live reset with its records");
  const db = await getDb();
  const idx = await db.execute(sql`select indexname from pg_indexes where tablename = 'record_parties' and indexname in ('record_parties_record_id_idx','record_parties_company_id_idx')`);
  ok(idx.rows.length === 2, "parties db: recordId + companyId expression indexes exist");
  const trg = await db.execute(sql`select tgname from pg_trigger where tgname = 'record_parties_seq_bump'`);
  ok(trg.rows.length === 1, "parties db: seq-bump trigger installed");
  try {
    await partyIdentityFixtures();
    const { co1, co2, ct1, ct2 } = PARTY_FIX;
    const lead = fixtureId(346, "lead"), quote = fixtureId(346, "quote"), project = fixtureId(346, "project");

    const id = partyId("lead", lead, co1, "owner");
    ok(/^pty_[0-9a-f]{16}$/.test(id) && id === partyId("lead", lead, co1, "owner") && id !== partyId("lead", lead, co1, "gc"), "parties db: deterministic id per (record, company, role)");

    const a = await addParty({ recordType: "lead", recordId: lead, companyId: co1, role: "owner", contactId: ct1 }, "u-test");
    ok(a.ok && !a.existed && a.party.contactId === ct1 && a.party.bid === null, "parties db: add owner with contact");
    if (a.ok) registerFixture("record_parties", a.party.id);
    const again = await addParty({ recordType: "lead", recordId: lead, companyId: co1, role: "owner" }, "u-test");
    ok(again.ok && again.existed, "parties db: re-adding the same (record, company, role) reports existed");
    const own2 = await addParty({ recordType: "lead", recordId: lead, companyId: co2, role: "owner" }, "u-test");
    ok(!own2.ok && own2.error === "This record already has an owner.", "parties db: second owner refused");
    const badCt = await addParty({ recordType: "lead", recordId: lead, companyId: co2, role: "gc", contactId: ct1 }, "u-test");
    ok(!badCt.ok && badCt.error === "That person isn't at this company.", "parties db: contact must belong to the company");
    const noCo = await addParty({ recordType: "lead", recordId: lead, companyId: fixtureId(346, "nope"), role: "gc" }, "u-test");
    ok(!noCo.ok && noCo.error === "That company doesn't exist.", "parties db: unknown company refused");
    let nonString: Awaited<ReturnType<typeof addParty>> | null = null;
    try {
      nonString = await addParty({ recordType: "lead", recordId: 5 as never, companyId: co2, role: "gc" }, "u-test");
    } catch {
      nonString = null;
    }
    ok(!!nonString && !nonString.ok && nonString.error === "Missing record.", "parties db: a non-string id from a server action is refused, not thrown");

    for (const [role, co, label] of [["gc", co2, null], ["architect", co2, null], ["other", co1, "CM"]] as const) {
      const r = await addParty({ recordType: "lead", recordId: lead, companyId: co, role, roleLabel: label }, "u-test");
      ok(r.ok, `parties db: add ${role}`);
      if (r.ok) registerFixture("record_parties", r.party.id);
    }
    const onLead = await listFor("lead", lead);
    ok(onLead.map((p) => p.role).join() === "owner,gc,architect,other", "parties db: listFor sorted by role");
    ok((await listFor("quote", lead)).length === 0, "parties db: listFor filters by record type");

    const gcRow = onLead.find((p) => p.role === "gc")!;
    const sc = await setPartyContact(gcRow.id, ct2);
    ok(sc.ok && sc.party.contactId === ct2, "parties db: set contact");
    const scBad = await setPartyContact(gcRow.id, ct1);
    ok(!scBad.ok && scBad.error === "That person isn't at this company.", "parties db: set contact checks company");
    ok((await setPartyContact(gcRow.id, null)).ok, "parties db: clear contact");

    const copied = await copyParties({ type: "lead", id: lead }, { type: "quote", id: quote }, "u-test");
    const onQuote = await listFor("quote", quote);
    for (const p of onQuote) registerFixture("record_parties", p.id);
    ok(copied === 3 && onQuote.map((p) => p.role).join() === "owner,architect,other", "parties db: lead→quote copies all but GC/EC");
    ok(onQuote.every((p) => p.bid === null && p.recordId === quote), "parties db: copies are fresh rows on the target");
    ok((await copyParties({ type: "lead", id: lead }, { type: "quote", id: quote }, "u-test")) === 0, "parties db: copy is idempotent");
    const toProj = await copyParties({ type: "quote", id: quote }, { type: "project", id: project }, "u-test");
    for (const p of await listFor("project", project)) registerFixture("record_parties", p.id);
    ok(toProj === 3, "parties db: quote→project copies every row");

    const quote2 = fixtureId(346, "quote2");
    const o2 = await addParty({ recordType: "quote", recordId: quote2, companyId: co2, role: "owner" }, "u-test");
    ok(o2.ok, "parties db: owner on the one-owner copy target");
    if (o2.ok) registerFixture("record_parties", o2.party.id);
    const into2 = await copyParties({ type: "lead", id: lead }, { type: "quote", id: quote2 }, "u-test");
    const onQuote2 = await listFor("quote", quote2);
    for (const p of onQuote2) registerFixture("record_parties", p.id);
    const owners2 = onQuote2.filter((p) => p.role === "owner");
    ok(owners2.length === 1 && owners2[0].companyId === co2, "parties db: copy never gives the target a second owner");
    ok(into2 === 2 && onQuote2.map((p) => p.role).join() === "owner,architect,other", "parties db: non-owner rows still copied past the owner conflict");

    const forCo1 = await listForCompany(co1);
    ok(forCo1.filter((p) => p.recordId === lead).length === 2 && forCo1.some((p) => p.recordType === "project"), "parties db: listForCompany spans records");
    const many = await listForRecords("lead", [lead, fixtureId(346, "empty")]);
    ok(many.get(lead)?.length === 4 && (many.get(fixtureId(346, "empty")) ?? []).length === 0, "parties db: listForRecords groups by record");

    ok(await removeParty(gcRow.id), "parties db: remove");
    ok(!(await listFor("lead", lead)).some((p) => p.id === gcRow.id), "parties db: removed row gone from lists");
    const revived = await addParty({ recordType: "lead", recordId: lead, companyId: co2, role: "gc" }, "u-test");
    ok(revived.ok && !revived.existed && revived.party.id === gcRow.id && revived.party.contactId === null, "parties db: re-adding a removed row revives it fresh");
    ok(!(await removeParty(fixtureId(346, "missing"))), "parties db: removing an unknown id is false");

    // carry estimate → project through createProjectFromQuote
    const wonQ = fixtureId(346, "won");
    await createFixture("quotes", { ...buildQuote(wonQ, { name: "Party won", customer: "Party Co One", customerId: co1, value: 1000 }, "system", null, Date.now()), status: "won" } as never);
    const ownerOnWon = await addParty({ recordType: "quote", recordId: wonQ, companyId: co1, role: "owner" }, "u-test");
    if (ownerOnWon.ok) registerFixture("record_parties", ownerOnWon.party.id);
    const proj = await createProjectFromQuote(wonQ);
    ok(!!proj, "parties db: fixture won quote spawns a project");
    if (proj) {
      registerFixture("projects", proj.id);
      registerFixture("tasks", autoTaskId(`item16:sold:${proj.id}`)); // the kickoff auto-task the spawn creates
      const onProj = await listFor("project", proj.id);
      for (const p of onProj) registerFixture("record_parties", p.id);
      ok(onProj.length === 1 && onProj[0].role === "owner" && onProj[0].companyId === co1, "parties db: project inherits the estimate's parties");
    }

    // lead → quote through leads.convert: owner carries, GC does not
    const convLead = fixtureId(346, "convlead");
    const NOW = Date.now();
    await createFixture("leads", { id: convLead, org: "Party Co One", contact: "Pat One", stage: "new", source: "web", customerId: co1, value: 0, activities: [], createdAt: NOW, updatedAt: NOW, lastActivityAt: NOW } as never);
    for (const [co, role] of [[co1, "owner"], [co2, "gc"]] as const) {
      const r = await addParty({ recordType: "lead", recordId: convLead, companyId: co, role }, "u-test");
      ok(r.ok, `parties db: ${role} on the lead to convert`);
      if (r.ok) registerFixture("record_parties", r.party.id);
    }
    const conv = await convert(convLead);
    ok(!!conv?.quoteId, "parties db: fixture lead converts to a quote");
    if (conv?.quoteId) {
      registerFixture("quotes", conv.quoteId);
      const onConv = await listFor("quote", conv.quoteId);
      for (const p of onConv) registerFixture("record_parties", p.id);
      ok(onConv.length === 1 && onConv[0].role === "owner" && onConv[0].companyId === co1, "parties db: converted quote has the lead's owner and no GC");
    }

    // withSavepoint contains a SQL error so the outer transaction survives
    ok((await withSavepoint(async () => 7)) === 7, "parties db: withSavepoint outside a transaction just runs fn");
    let survived = false, threw = false;
    await withTransaction(async () => {
      try {
        await withSavepoint(async () => { await (await getDb()).execute(sql`select * from no_such_table_346`); });
      } catch {
        threw = true;
      }
      await (await getDb()).execute(sql`select 1`); // would throw "current transaction is aborted" without the savepoint
      survived = true;
    });
    ok(threw && survived, "parties db: a SQL error inside withSavepoint rolls back to the savepoint, the outer transaction survives");
  } finally {
    await dropFixtures(346);
    await dropPartyIdentityFixtures();
  }
}

const PARTY_FIX = { co1: fixtureId(346, "co1"), co2: fixtureId(346, "co2"), ct1: fixtureId(346, "ct1"), ct2: fixtureId(346, "ct2") };
async function partyIdentityFixtures() {
  await dropPartyIdentityFixtures();
  await saveCompany({ id: PARTY_FIX.co1, name: "Party Co One", type: "customer", lifecycle: "active", deleted: false });
  await saveCompany({ id: PARTY_FIX.co2, name: "Party Co Two", type: "customer", lifecycle: "active", deleted: false });
  await saveContact({ id: PARTY_FIX.ct1, firstName: "Pat", lastName: "One", homeCompanyId: PARTY_FIX.co1 });
  await saveContact({ id: PARTY_FIX.ct2, firstName: "Sam", lastName: "Two", homeCompanyId: PARTY_FIX.co2 });
}
async function dropPartyIdentityFixtures() {
  const db = await getDb();
  await db.delete(contactsTable).where(like(contactsTable.id, "TEST346:%"));
  await db.delete(companies).where(like(companies.id, "TEST346:%"));
}

if (process.argv[1]?.endsWith("test-parties.ts")) {
  let pass = 0, fail = 0;
  partyChecks((c, m) => { if (c) pass++; else { fail++; console.log("FAIL", m); } }).then(() => { console.log(`${pass} PASS, ${fail} FAIL`); process.exit(fail ? 1 : 0); });
}
