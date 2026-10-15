/* #346 estimate parties — harness checks. `partyChecks` is pure; `partyDbChecks` needs the test DB.
   Run the pure half alone with `npx tsx scripts/test-parties.ts`. */
import type { Ok } from "./test-inbox-org";
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
}

export async function partyDbChecks(ok: Ok) {
  void ok; // Task 2 fills this in.
}

if (process.argv[1]?.endsWith("test-parties.ts")) {
  let pass = 0, fail = 0;
  partyChecks((c, m) => { if (c) pass++; else { fail++; console.log("FAIL", m); } }).then(() => { console.log(`${pass} PASS, ${fail} FAIL`); process.exit(fail ? 1 : 0); });
}
