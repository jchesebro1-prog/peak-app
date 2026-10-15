# #346 Slice 1 — Parties core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Link many companies, each with a role, to a lead, an estimate and a project; show them on the lead drawer, the Estimator header, the project page and the company page; carry them lead → estimate → project; stop a lead with estimates double-counting on the opportunity board.

**Architecture:** A new doc collection `record_parties` (migration 0041, docTable shape plus two `doc->>` expression indexes) with deterministic ids `pty_<16 hex>` = sha1(recordType, recordId, companyId, role), so one row per (record, company, role) is structural. Pure rules in `src/lib/parties/rules.ts` (browser-safe — no node imports); the store `src/lib/stores/parties.ts` is the only writer; server actions in `src/app/(app)/parties/actions.ts`; one client editor `src/components/parties/parties-editor.tsx` used by every surface.

**Tech Stack:** Next.js 16 App Router, TypeScript, Drizzle on Postgres/PGlite, the repo's doc-store (`src/db/doc-store.ts`), the `test:specs` harness (`scripts/test-review-and-spec.ts`).

**Spec:** `docs/superpowers/specs/2026-10-14-estimate-parties-and-bids-design.md` §3.1, §3.5, §3.6, §4 (lead/estimator/company), §8.

## Global Constraints

- Worktree: `/Users/sm/Downloads/peak-app/.claude/worktrees/parties`, branch `feat/346-estimate-parties`. Run every command from there. **Never `git stash`** (shared across worktrees) — commit instead.
- Node: `export PATH="$HOME/.local/node/bin:$PATH"` if `node` is missing.
- Never open `.data/pglite` from a script while a dev server may be running; `test:specs` uses its own temp datadir (fine).
- Roles (exact keys, in this display order): `owner`, `gc`, `ec`, `architect`, `consultant`, `vendor`, `other`.
- Role labels (exact copy): Owner · General contractor · Electrical contractor · Architect · Theatre / AV consultant · Vendor · Other. Short labels: Owner · GC · EC · Architect · Consultant · Vendor · (the typed label for Other).
- Record types: `lead`, `quote`, `project`.
- Party ids: `pty_` + first 16 hex of sha1 of `[recordType, recordId, companyId, role].join("\u0000")`.
- `roleLabel` is required (1–60 chars after trim) iff role is `other`; otherwise null.
- At most one `owner` row per record.
- Writes need `can("create", user.roles)`; reads need `requireUser()`.
- `bid` is always `null` in this slice (slice 2 writes it).
- Carry-over: lead → estimate copies every role except `gc`/`ec`; estimate → project copies every role; both idempotent; copies get `bid: null`.
- Opportunity board: a lead with ≥ 1 live estimate (`Quote.leadId === lead.id`) is excluded from the board (its estimates carry the value), the same way a converted lead already is.
- Company delete is refused while the company is on any live party row: error text `"<Company> is linked to N record(s) (leads, estimates or projects) — remove it from them first."`
- Client components must never import `src/lib/stores/*` or anything that imports `node:crypto`/`postgres` (it breaks `next build` only).
- Decisions: D1052–D1056 (recompute from `origin/main` right before writing docs; if taken, use the next free numbers). Punch item **#346**. Migration **0041**.
- Gates for every task that touches code: `npx tsc --noEmit` clean; `npm run test:specs` all PASS; final task adds `npm run test:smoke`, `npx eslint` on touched files, and `npm run build`.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/parties/rules.ts` (new) | Pure: roles, labels, types, input validation, grouping, carry filter, lead estimate rollup, board exclusion set. Browser-safe. |
| `src/db/doc-tables.ts` (modify) | Register `recordParties = docTable("record_parties")` and `record_parties` in `DOC_TABLES`. |
| `drizzle/0041_record_parties.sql` + `drizzle/meta/*` (generated, hand-hardened) | Table, seq/deleted indexes, `doc->>'recordId'` and `doc->>'companyId'` indexes, seq trigger. |
| `src/lib/stores/parties.ts` (new) | The only writer: `partyId`, `listFor`, `listForRecords`, `listForCompany`, `addParty`, `setPartyContact`, `removeParty`, `copyParties`. |
| `src/lib/parties/view-server.ts` (new) | Server-only: `partyVMs(parties)` → `PartyVM[]` (company + contact names). |
| `src/app/(app)/parties/actions.ts` (new) | Server actions: list / add / set contact / remove / company contacts. |
| `src/components/parties/company-search.tsx` (new) | Client: debounced company typeahead over `searchLinkTargetsAction(q, "company")`. |
| `src/components/parties/parties-editor.tsx` (new) | Client: grouped list + add form (role, company, contact, label) + remove + contact change. |
| `src/components/parties/parties-card.tsx` (new) | Server card wrapping the editor for lead / project pages. |
| `src/components/parties/lead-estimates.tsx` (new) | Server: the lead's estimates list + total. |
| `src/components/parties/company-roles-card.tsx` (new) | Server: company page "Bids & roles". |
| `src/app/(app)/estimator/parties-chip.tsx` (new) | Client: Estimator header chip + dialog. |
| `src/app/(app)/estimator/estimator-header.tsx` (modify) | Mount the chip. |
| `src/app/(app)/leads/page.tsx` (modify) | Mount PartiesCard + LeadEstimates in the drawer slot. |
| `src/app/(app)/projects/[id]/page.tsx` (modify) | Mount PartiesCard in the slot. |
| `src/app/(app)/companies/[id]/page.tsx` (modify) | Mount CompanyRolesCard. |
| `src/app/(app)/companies/actions.ts` (modify) | Delete guard. |
| `src/lib/opportunities.ts` + `src/app/(app)/opportunities/page.tsx` (modify) | Exclude leads with estimates. |
| `src/app/(app)/estimator/actions.ts` (modify) | Carry lead → estimate on create. |
| `src/lib/stores/leads.ts` (modify) | Carry lead → estimate in `convert`. |
| `src/lib/stores/projects.ts` (modify) | Carry estimate → project in `createProjectFromQuote`. |
| `scripts/test-parties.ts` (new) + `scripts/test-review-and-spec.ts` (modify) | Pure + DB checks, registered in the runner. |
| `scripts/smoke-routes.ts` | No change (existing `/leads?lead=…`, `/companies/lakefront`, `/opportunities` routes cover the new cards). |
| `DECISIONS.md`, `PUNCHLIST.md`, `AGENTS.md` (modify) | Docs. |

---

### Task 1: Pure rules module

**Files:**
- Create: `src/lib/parties/rules.ts`
- Create: `scripts/test-parties.ts`
- Modify: `scripts/test-review-and-spec.ts` (import + chain, next to `assessmentChecks`, ~line 11352 import and ~line 11721 chain)

**Interfaces:**
- Produces (exact exports of `src/lib/parties/rules.ts`):
  - `PARTY_ROLES: readonly ["owner","gc","ec","architect","consultant","vendor","other"]`, `type PartyRole`
  - `PARTY_RECORD_TYPES: readonly ["lead","quote","project"]`, `type PartyRecordType`
  - `ROLE_LABEL: Record<PartyRole,string>`, `ROLE_SHORT: Record<PartyRole,string>`
  - `type BidderState` (spec §3.3, unused in slice 1), `type Party`, `type PartyInput`
  - `partyInputProblem(input: PartyInput): string | null`
  - `normalizePartyInput(input: PartyInput): PartyInput & { contactId: string | null; roleLabel: string | null }`
  - `ownerConflict(existing: readonly Party[], input: Pick<PartyInput,"role"|"companyId">): boolean`
  - `carriesTo(from: PartyRecordType, to: PartyRecordType, p: Pick<Party,"role">): boolean`
  - `partyRoleText(p: Pick<Party,"role"|"roleLabel">): string`
  - `groupPartiesByRole<T extends Pick<Party,"role">>(parties: readonly T[]): Array<{ role: PartyRole; label: string; parties: T[] }>`
  - `sortParties<T extends Pick<Party,"role"|"createdAt"|"id">>(parties: readonly T[]): T[]`
  - `leadEstimatesTotal(quotes: ReadonlyArray<{ status?: string; value?: number }>): number`
  - `leadIdsWithEstimates(quotes: ReadonlyArray<{ leadId?: string | null }>): Set<string>`

- [ ] **Step 1: Write the failing test**

Create `scripts/test-parties.ts`:

```ts
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
```

Register in `scripts/test-review-and-spec.ts`: next to the `import { assessmentChecks, assessmentDbChecks } from "./test-assessments";` line add

```ts
import { partyChecks, partyDbChecks } from "./test-parties";
```

and in the promise chain directly after `.then(() => assessmentDbChecks(ok))` add

```ts
    .then(() => partyChecks(ok)).then(() => partyDbChecks(ok))
```

(Match the surrounding indentation exactly; read ±10 lines around each spot first.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/test-parties.ts`
Expected: FAIL — `Cannot find module '../src/lib/parties/rules'`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/parties/rules.ts`:

```ts
/* #346 — estimate parties: the pure rules. Browser-safe (no node or store imports): client components read the
   roles and labels from here. The store (src/lib/stores/parties.ts) is the only writer and calls these. */

export const PARTY_ROLES = ["owner", "gc", "ec", "architect", "consultant", "vendor", "other"] as const;
export type PartyRole = (typeof PARTY_ROLES)[number];

export const PARTY_RECORD_TYPES = ["lead", "quote", "project"] as const;
export type PartyRecordType = (typeof PARTY_RECORD_TYPES)[number];

export const ROLE_LABEL: Record<PartyRole, string> = {
  owner: "Owner",
  gc: "General contractor",
  ec: "Electrical contractor",
  architect: "Architect",
  consultant: "Theatre / AV consultant",
  vendor: "Vendor",
  other: "Other",
};

export const ROLE_SHORT: Record<PartyRole, string> = {
  owner: "Owner",
  gc: "GC",
  ec: "EC",
  architect: "Architect",
  consultant: "Consultant",
  vendor: "Vendor",
  other: "Other",
};

/** Spec §3.3 — a bidder row's state (quote rows with role gc/ec only). Slice 2 writes it; slice 1 always stores null. */
export type BidderState = {
  result: "pending" | "awarded" | "lost" | "withdrew" | "no_bid";
  submitVia: "email" | "website";
  bidSiteUrl?: string;
  gcBidNo?: string;
  revSent?: number | null;
  sentAt?: number | null;
  sentBy?: string | null;
  confirmation?: string;
  threadId?: string | null;
  failed?: { at: number; error: string } | null;
  lostByAward?: boolean;
};

export type Party = {
  id: string;
  recordType: PartyRecordType;
  recordId: string;
  companyId: string;
  contactId: string | null;
  role: PartyRole;
  roleLabel: string | null;
  bid: BidderState | null;
  createdAt: number;
  createdBy: string;
  updatedAt: number;
};

export type PartyInput = {
  recordType: PartyRecordType;
  recordId: string;
  companyId: string;
  contactId?: string | null;
  role: PartyRole;
  roleLabel?: string | null;
};

const ID_MAX = 120;
const LABEL_MAX = 60;
const ROLE_SET: ReadonlySet<string> = new Set(PARTY_ROLES);
const TYPE_SET: ReadonlySet<string> = new Set(PARTY_RECORD_TYPES);

/** The first problem with a party input, or null. Messages are user-facing. */
export function partyInputProblem(input: PartyInput): string | null {
  if (!TYPE_SET.has(input.recordType)) return "Unknown record type.";
  if (!ROLE_SET.has(input.role)) return "Unknown role.";
  const rec = (input.recordId || "").trim();
  const co = (input.companyId || "").trim();
  if (!rec || rec.length > ID_MAX || co.length > ID_MAX) return "Missing record.";
  if (!co) return "Pick a company.";
  if (input.role === "other") {
    const label = (input.roleLabel || "").trim();
    if (!label) return "Name the role.";
    if (label.length > LABEL_MAX) return "Keep the role under 60 characters.";
  }
  return null;
}

export function normalizePartyInput(input: PartyInput): PartyInput & { contactId: string | null; roleLabel: string | null } {
  const contact = (input.contactId || "").trim();
  return {
    recordType: input.recordType,
    recordId: input.recordId.trim(),
    companyId: input.companyId.trim(),
    role: input.role,
    contactId: contact || null,
    roleLabel: input.role === "other" ? (input.roleLabel || "").trim() || null : null,
  };
}

/** At most one owner company per record. */
export function ownerConflict(existing: readonly Party[], input: Pick<PartyInput, "role" | "companyId">): boolean {
  if (input.role !== "owner") return false;
  return existing.some((p) => p.role === "owner" && p.companyId !== input.companyId);
}

/** Carry-over (spec §3.5): lead → estimate copies everyone but GC/EC (bidders are ticked per estimate);
 *  estimate → project copies everyone. Nothing else carries. */
export function carriesTo(from: PartyRecordType, to: PartyRecordType, p: Pick<Party, "role">): boolean {
  if (from === "lead" && to === "quote") return p.role !== "gc" && p.role !== "ec";
  if (from === "quote" && to === "project") return true;
  return false;
}

export function partyRoleText(p: Pick<Party, "role" | "roleLabel">): string {
  return p.role === "other" ? p.roleLabel || ROLE_SHORT.other : ROLE_SHORT[p.role];
}

const ROLE_ORDER = new Map<string, number>(PARTY_ROLES.map((r, i) => [r, i]));

export function sortParties<T extends Pick<Party, "role" | "createdAt" | "id">>(parties: readonly T[]): T[] {
  return [...parties].sort(
    (a, b) => (ROLE_ORDER.get(a.role) ?? 99) - (ROLE_ORDER.get(b.role) ?? 99) || a.createdAt - b.createdAt || a.id.localeCompare(b.id)
  );
}

export function groupPartiesByRole<T extends Pick<Party, "role">>(parties: readonly T[]): Array<{ role: PartyRole; label: string; parties: T[] }> {
  return PARTY_ROLES.map((role) => ({ role, label: ROLE_LABEL[role], parties: parties.filter((p) => p.role === role) })).filter((g) => g.parties.length > 0);
}

/** A lead's estimates total (spec §3.6): draft + sent + won values, lost excluded, whole dollars. */
export function leadEstimatesTotal(quotes: ReadonlyArray<{ status?: string; value?: number }>): number {
  let sum = 0;
  for (const q of quotes) if (q.status !== "lost") sum += Number(q.value) || 0;
  return Math.round(sum);
}

/** Leads that have at least one estimate — excluded from the opportunity board (their estimates carry the value). */
export function leadIdsWithEstimates(quotes: ReadonlyArray<{ leadId?: string | null }>): Set<string> {
  const out = new Set<string>();
  for (const q of quotes) if (q.leadId) out.add(q.leadId);
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx scripts/test-parties.ts`
Expected: `30 PASS, 0 FAIL` (the count is whatever the file asserts; 0 FAIL is the requirement).

Then: `npx tsc --noEmit` — expected: no output.

- [ ] **Step 5: Commit**

```bash
git add src/lib/parties/rules.ts scripts/test-parties.ts scripts/test-review-and-spec.ts
git commit -m "feat(346): parties rules — roles, validation, carry filter, lead estimate rollup

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Collection, migration 0041 and the store

**Files:**
- Modify: `src/db/doc-tables.ts` (after the `venueProfiles` line ~112; inside `DOC_TABLES` after `venue_profiles: venueProfiles,`)
- Create: `drizzle/0041_record_parties.sql`, `drizzle/meta/0041_snapshot.json`, modify `drizzle/meta/_journal.json` (all via `npm run db:generate`, then hardened by hand)
- Create: `src/lib/stores/parties.ts`
- Modify: `scripts/test-parties.ts` (fill `partyDbChecks`)

**Interfaces:**
- Consumes: Task 1 exports.
- Produces (`src/lib/stores/parties.ts`):
  - `partyId(recordType: PartyRecordType, recordId: string, companyId: string, role: PartyRole): string`
  - `listFor(recordType: PartyRecordType, recordId: string): Promise<Party[]>` (sorted by `sortParties`)
  - `listForRecords(recordType: PartyRecordType, recordIds: readonly string[]): Promise<Map<string, Party[]>>`
  - `listForCompany(companyId: string): Promise<Party[]>`
  - `addParty(input: PartyInput, by: string): Promise<{ ok: true; party: Party; existed: boolean } | { ok: false; error: string }>`
  - `setPartyContact(id: string, contactId: string | null): Promise<{ ok: true; party: Party } | { ok: false; error: string }>`
  - `removeParty(id: string): Promise<boolean>`
  - `copyParties(from: { type: PartyRecordType; id: string }, to: { type: PartyRecordType; id: string }, by: string): Promise<number>`

- [ ] **Step 1: Register the collection**

In `src/db/doc-tables.ts`, after the `export const venueProfiles = …` line add:

```ts
export const recordParties = docTable("record_parties"); // Estimate parties (#346) — one company in one role on a lead / quote / project, id pty_<16 hex> = sha1(recordType, recordId, companyId, role); migration 0041_record_parties
```

and inside `DOC_TABLES`, after `venue_profiles: venueProfiles,`:

```ts
  record_parties: recordParties,
```

Do **not** add it to `SYNCABLE_COLLECTIONS` (server-action only; also keeps the `assessments,findings` tail pin in `scripts/test-assessments.ts:679` true). Do **not** add it to `CONFIG_COLLECTIONS` (parties are wiped with their records by the go-live reset).

- [ ] **Step 2: Generate and harden the migration**

Run: `npm run db:generate`
Expected: a new `drizzle/0041_<random_name>.sql`, `drizzle/meta/0041_snapshot.json`, and a journal entry `idx: 41`.

Rename the SQL file to `drizzle/0041_record_parties.sql` and change the journal entry's `"tag"` to `"0041_record_parties"`. Replace the SQL file's contents with:

```sql
-- Estimate parties (#346, slice 1) — one doc collection: record_parties.
--
--  - One row per company in one role on a lead / quote / project; id pty_<16 hex> =
--    sha1(recordType, recordId, companyId, role), so (record, company, role) is unique by id.
--  - Two expression indexes serve the only two lookups: a record's parties (doc->>'recordId')
--    and a company's parties (doc->>'companyId'). Same shape as 0030's quotes_lead_id_idx.
--
-- Generated by drizzle-kit, then hardened so it is idempotent per D141 (the shared Neon
-- database is migrated by more than one branch's build).
CREATE TABLE IF NOT EXISTS "record_parties" (
	"id" text PRIMARY KEY NOT NULL,
	"doc" jsonb NOT NULL,
	"rev" integer DEFAULT 1 NOT NULL,
	"seq" bigserial NOT NULL,
	"updated_at" bigint NOT NULL,
	"received_at" bigint NOT NULL,
	"review" jsonb,
	"deleted" boolean DEFAULT false NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "record_parties_seq_idx" ON "record_parties" USING btree ("seq");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "record_parties_deleted_idx" ON "record_parties" USING btree ("deleted");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "record_parties_record_id_idx" ON "record_parties" USING btree (("doc"->>'recordId'));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "record_parties_company_id_idx" ON "record_parties" USING btree (("doc"->>'companyId'));--> statement-breakpoint
CREATE OR REPLACE TRIGGER record_parties_seq_bump BEFORE UPDATE ON "record_parties" FOR EACH ROW EXECUTE FUNCTION bump_doc_seq();
```

Compare with the generated statements before replacing: if drizzle-kit emitted anything beyond the `record_parties` table and its two indexes (i.e. it detected drift elsewhere in the schema), STOP and report it — do not ship unrelated DDL.

- [ ] **Step 3: Write the failing DB checks**

Replace the `partyDbChecks` stub in `scripts/test-parties.ts` with:

```ts
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

    const forCo1 = await listForCompany(co1);
    ok(forCo1.filter((p) => p.recordId === lead).length === 2 && forCo1.some((p) => p.recordType === "project"), "parties db: listForCompany spans records");
    const many = await listForRecords("lead", [lead, fixtureId(346, "empty")]);
    ok(many.get(lead)?.length === 4 && (many.get(fixtureId(346, "empty")) ?? []).length === 0, "parties db: listForRecords groups by record");

    ok(await removeParty(gcRow.id), "parties db: remove");
    ok(!(await listFor("lead", lead)).some((p) => p.id === gcRow.id), "parties db: removed row gone from lists");
    const revived = await addParty({ recordType: "lead", recordId: lead, companyId: co2, role: "gc" }, "u-test");
    ok(revived.ok && !revived.existed && revived.party.id === gcRow.id && revived.party.contactId === null, "parties db: re-adding a removed row revives it fresh");
    ok(!(await removeParty(fixtureId(346, "missing"))), "parties db: removing an unknown id is false");
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
```

Add these imports at the top of `scripts/test-parties.ts`:

```ts
import { like, sql } from "drizzle-orm";
import { getDb } from "../src/db";
import { companies, contacts as contactsTable } from "../src/db/schema";
import { DOC_TABLES, SYNCABLE_COLLECTIONS } from "../src/db/doc-tables";
import { DEMO_COLLECTIONS } from "../src/db/seed-data";
import { saveCompany } from "../src/lib/identity/companies";
import { saveContact } from "../src/lib/identity/contacts";
import { dropFixtures, fixtureId, registerFixture } from "./test-fixtures";
import { addParty, copyParties, listFor, listForCompany, listForRecords, partyId, removeParty, setPartyContact } from "../src/lib/stores/parties";
```

Before running, read `saveContact`'s signature in `src/lib/identity/contacts.ts:101` and pass whatever required fields it needs (e.g. `title`, `isPrimary`); keep the ids/names/companies above. Read `dropFixtures`' signature in `scripts/test-fixtures.ts` (it takes `(scope?, mode?)`).

- [ ] **Step 4: Run to verify it fails**

Run: `npm run test:specs 2>&1 | grep -E "parties|PASS,|FAIL" | tail -20`
Expected: fails to compile/import — `src/lib/stores/parties` does not exist.

- [ ] **Step 5: Write the store**

Create `src/lib/stores/parties.ts`:

```ts
import { createHash } from "node:crypto";
import { getDoc, listDocsByField, patchDoc, softDeleteDoc, upsertDoc } from "@/db/doc-store";
import { getCompany } from "@/lib/identity/companies";
import { getContact } from "@/lib/identity/contacts";
import {
  carriesTo, normalizePartyInput, ownerConflict, partyInputProblem, sortParties,
  type Party, type PartyInput, type PartyRecordType, type PartyRole,
} from "@/lib/parties/rules";

/**
 * #346 — estimate parties (`record_parties`): the ONLY writer. One row per company in one role on a lead,
 * quote or project. The id is derived from (recordType, recordId, companyId, role), so a second add of the same
 * row lands on the same id — uniqueness without a unique index. Removing soft-deletes; adding again revives the
 * row fresh (upsertDoc replaces the doc and clears `deleted`).
 */

export function partyId(recordType: PartyRecordType, recordId: string, companyId: string, role: PartyRole): string {
  return `pty_${createHash("sha1").update([recordType, recordId, companyId, role].join("\u0000")).digest("hex").slice(0, 16)}`;
}

export async function listFor(recordType: PartyRecordType, recordId: string): Promise<Party[]> {
  if (!recordId) return [];
  const rows = await listDocsByField<Party>("record_parties", "recordId", [recordId]);
  return sortParties(rows.filter((p) => p.recordType === recordType));
}

export async function listForRecords(recordType: PartyRecordType, recordIds: readonly string[]): Promise<Map<string, Party[]>> {
  const out = new Map<string, Party[]>();
  const ids = [...new Set(recordIds.filter(Boolean))];
  if (!ids.length) return out;
  const rows = await listDocsByField<Party>("record_parties", "recordId", ids);
  for (const p of sortParties(rows)) {
    if (p.recordType !== recordType) continue;
    const list = out.get(p.recordId) ?? [];
    list.push(p);
    out.set(p.recordId, list);
  }
  return out;
}

export async function listForCompany(companyId: string): Promise<Party[]> {
  if (!companyId) return [];
  return sortParties(await listDocsByField<Party>("record_parties", "companyId", [companyId]));
}

async function contactProblem(companyId: string, contactId: string | null): Promise<string | null> {
  if (!contactId) return null;
  const c = await getContact(contactId);
  return c && c.homeCompanyId === companyId ? null : "That person isn't at this company.";
}

export async function addParty(
  raw: PartyInput,
  by: string
): Promise<{ ok: true; party: Party; existed: boolean } | { ok: false; error: string }> {
  const problem = partyInputProblem(raw);
  if (problem) return { ok: false, error: problem };
  const input = normalizePartyInput(raw);
  if (!(await getCompany(input.companyId))) return { ok: false, error: "That company doesn't exist." };
  const cp = await contactProblem(input.companyId, input.contactId);
  if (cp) return { ok: false, error: cp };
  const id = partyId(input.recordType, input.recordId, input.companyId, input.role);
  const existing = await getDoc<Party>("record_parties", id);
  if (existing) return { ok: true, party: existing, existed: true };
  if (ownerConflict(await listFor(input.recordType, input.recordId), input)) return { ok: false, error: "This record already has an owner." };
  const t = Date.now();
  const party: Party = {
    id,
    recordType: input.recordType,
    recordId: input.recordId,
    companyId: input.companyId,
    contactId: input.contactId,
    role: input.role,
    roleLabel: input.roleLabel,
    bid: null,
    createdAt: t,
    createdBy: by,
    updatedAt: t,
  };
  return { ok: true, party: await upsertDoc<Party>("record_parties", party), existed: false };
}

export async function setPartyContact(
  id: string,
  contactId: string | null
): Promise<{ ok: true; party: Party } | { ok: false; error: string }> {
  const cur = await getDoc<Party>("record_parties", id);
  if (!cur) return { ok: false, error: "That link no longer exists." };
  const next = (contactId || "").trim() || null;
  const cp = await contactProblem(cur.companyId, next);
  if (cp) return { ok: false, error: cp };
  const saved = await patchDoc<Party>("record_parties", id, (d) => {
    d.contactId = next;
    d.updatedAt = Date.now();
  });
  return saved ? { ok: true, party: saved } : { ok: false, error: "That link no longer exists." };
}

export async function removeParty(id: string): Promise<boolean> {
  if (!id || !(await getDoc<Party>("record_parties", id))) return false;
  await softDeleteDoc("record_parties", id);
  return true;
}

/**
 * Copy a record's parties onto another record once (spec §3.5), by the carry rule. Idempotent: a row already live
 * on the target is skipped. Copies start with `bid: null`. Returns how many rows were written.
 */
export async function copyParties(
  from: { type: PartyRecordType; id: string },
  to: { type: PartyRecordType; id: string },
  by: string
): Promise<number> {
  const src = (await listFor(from.type, from.id)).filter((p) => carriesTo(from.type, to.type, p));
  let n = 0;
  const t = Date.now();
  for (const p of src) {
    const id = partyId(to.type, to.id, p.companyId, p.role);
    if (await getDoc<Party>("record_parties", id)) continue;
    await upsertDoc<Party>("record_parties", {
      id,
      recordType: to.type,
      recordId: to.id,
      companyId: p.companyId,
      contactId: p.contactId,
      role: p.role,
      roleLabel: p.roleLabel,
      bid: null,
      createdAt: t,
      createdBy: by,
      updatedAt: t,
    });
    n++;
  }
  return n;
}
```

Check `patchDoc`'s mutate contract in `src/db/doc-store.ts:660` (`(doc: T) => T | void`) — mutating in place and returning nothing is supported. If `upsertDoc`'s generic requires `T extends Doc` and `Party` is not assignable, change the `Party` declaration in rules.ts to stay a `type` alias (it already is) — type aliases are assignable to `Record<string, unknown>`.

- [ ] **Step 6: Run to verify it passes**

Run: `npm run test:specs 2>&1 | tail -5`
Expected: final summary with `0 FAIL`; `grep -c "parties db"` in the output of any failure list is 0. Then `npx tsc --noEmit` — no output.

- [ ] **Step 7: Commit**

```bash
git add src/db/doc-tables.ts drizzle/0041_record_parties.sql drizzle/meta/_journal.json drizzle/meta/0041_snapshot.json src/lib/stores/parties.ts scripts/test-parties.ts
git commit -m "feat(346): record_parties collection (migration 0041) + store

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Server actions, view model and the shared editor

**Files:**
- Create: `src/lib/parties/view-server.ts`
- Create: `src/app/(app)/parties/actions.ts`
- Create: `src/components/parties/company-search.tsx`
- Create: `src/components/parties/parties-editor.tsx`

**Interfaces:**
- Consumes: Task 1 (`ROLE_LABEL`, `PARTY_ROLES`, `partyRoleText`, `groupPartiesByRole`, types), Task 2 store.
- Produces:
  - `src/lib/parties/view-server.ts`: `type PartyVM = { id: string; role: PartyRole; roleText: string; companyId: string; companyName: string; contactId: string | null; contactName: string; href: string }` (exported from rules? no — export the type from `src/lib/parties/vm.ts`, see below) and `partyVMs(parties: Party[]): Promise<PartyVM[]>`.
  - `src/lib/parties/vm.ts` (pure, browser-safe): `export type PartyVM` (above) and `export type ContactOption = { id: string; name: string; title: string }`.
  - `src/app/(app)/parties/actions.ts`: `listPartiesAction(recordType, recordId): Promise<PartyVM[]>`, `addPartyAction(input: PartyInput): Promise<PartyActionResult>`, `setPartyContactAction(id: string, contactId: string | null): Promise<PartyActionResult>`, `removePartyAction(id: string): Promise<PartyActionResult>`, `companyContactsAction(companyId: string): Promise<ContactOption[]>`, with `type PartyActionResult = { ok: true; parties: PartyVM[]; note?: string } | { ok: false; error: string }`.
  - `src/components/parties/parties-editor.tsx`: `export default function PartiesEditor(props: { recordType: PartyRecordType; recordId: string; initial: PartyVM[]; canEdit: boolean; roles?: readonly PartyRole[]; onChange?: (parties: PartyVM[]) => void })`.
  - `src/components/parties/company-search.tsx`: `export default function CompanySearch(props: { placeholder: string; disabled?: boolean; onPick: (c: { id: string; name: string }) => void })`.

- [ ] **Step 1: Pure VM types**

Create `src/lib/parties/vm.ts`:

```ts
/* #346 — the browser-facing party view model (pure types; client components import these). */
import type { PartyRole } from "./rules";

export type PartyVM = {
  id: string;
  role: PartyRole;
  roleText: string;
  companyId: string;
  companyName: string;
  contactId: string | null;
  contactName: string;
  href: string;
};

export type ContactOption = { id: string; name: string; title: string };
```

- [ ] **Step 2: Server VM builder**

Create `src/lib/parties/view-server.ts`:

```ts
import "server-only";
import { getCompanies } from "@/lib/identity/companies";
import { contactsForCompanies, displayName } from "@/lib/identity/contacts";
import { partyRoleText, type Party } from "./rules";
import type { PartyVM } from "./vm";

/** Company + contact names for a list of parties, in the list's order. A company deleted since keeps its id as the name. */
export async function partyVMs(parties: Party[]): Promise<PartyVM[]> {
  const companyIds = [...new Set(parties.map((p) => p.companyId))];
  const [cos, contacts] = await Promise.all([getCompanies(companyIds), contactsForCompanies(companyIds)]);
  return parties.map((p) => {
    const ct = p.contactId ? (contacts.get(p.companyId) ?? []).find((c) => c.id === p.contactId) : undefined;
    return {
      id: p.id,
      role: p.role,
      roleText: partyRoleText(p),
      companyId: p.companyId,
      companyName: cos.get(p.companyId)?.name ?? p.companyId,
      contactId: p.contactId,
      contactName: ct ? displayName(ct) : "",
      href: `/companies/${encodeURIComponent(p.companyId)}`,
    };
  });
}
```

If `server-only` is not a dependency (check `grep -rn '"server-only"' src | head -3`), drop that import line.

- [ ] **Step 3: Server actions**

Create `src/app/(app)/parties/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { getDoc } from "@/db/doc-store";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/team";
import { contactsForCompany, displayName } from "@/lib/identity/contacts";
import { PARTY_RECORD_TYPES, type PartyInput, type PartyRecordType } from "@/lib/parties/rules";
import type { ContactOption, PartyVM } from "@/lib/parties/vm";
import { partyVMs } from "@/lib/parties/view-server";
import { addParty, listFor, removeParty, setPartyContact } from "@/lib/stores/parties";

export type PartyActionResult = { ok: true; parties: PartyVM[]; note?: string } | { ok: false; error: string };

const COLL: Record<PartyRecordType, "leads" | "quotes" | "projects"> = { lead: "leads", quote: "quotes", project: "projects" };
const PAGE: Record<PartyRecordType, string> = { lead: "/leads", quote: "/estimator", project: "/projects" };

function isRecordType(t: unknown): t is PartyRecordType {
  return typeof t === "string" && (PARTY_RECORD_TYPES as readonly string[]).includes(t);
}

async function recordExists(t: PartyRecordType, id: string): Promise<boolean> {
  return !!id && !!(await getDoc(COLL[t], id));
}

async function fresh(t: PartyRecordType, id: string): Promise<PartyVM[]> {
  return partyVMs(await listFor(t, id));
}

function touch(t: PartyRecordType) {
  revalidatePath(PAGE[t]);
  revalidatePath("/companies", "layout");
}

export async function listPartiesAction(recordType: PartyRecordType, recordId: string): Promise<PartyVM[]> {
  await requireUser();
  if (!isRecordType(recordType) || !recordId) return [];
  return fresh(recordType, recordId);
}

export async function addPartyAction(input: PartyInput): Promise<PartyActionResult> {
  const user = await requireUser();
  if (!can("create", user.roles)) return { ok: false, error: "You can't change who's linked here." };
  if (!input || !isRecordType(input.recordType)) return { ok: false, error: "Unknown record type." };
  if (!(await recordExists(input.recordType, input.recordId))) return { ok: false, error: "Save this record first." };
  const r = await addParty(input, user.id);
  if (!r.ok) return r;
  touch(input.recordType);
  return { ok: true, parties: await fresh(input.recordType, input.recordId), ...(r.existed ? { note: "Already linked in that role." } : {}) };
}

export async function setPartyContactAction(id: string, contactId: string | null): Promise<PartyActionResult> {
  const user = await requireUser();
  if (!can("create", user.roles)) return { ok: false, error: "You can't change who's linked here." };
  const r = await setPartyContact(id, contactId);
  if (!r.ok) return r;
  touch(r.party.recordType);
  return { ok: true, parties: await fresh(r.party.recordType, r.party.recordId) };
}

export async function removePartyAction(id: string): Promise<PartyActionResult> {
  const user = await requireUser();
  if (!can("create", user.roles)) return { ok: false, error: "You can't change who's linked here." };
  const cur = await getDoc<{ recordType: PartyRecordType; recordId: string }>("record_parties", id);
  if (!cur) return { ok: false, error: "That link no longer exists." };
  await removeParty(id);
  touch(cur.recordType);
  return { ok: true, parties: await fresh(cur.recordType, cur.recordId) };
}

export async function companyContactsAction(companyId: string): Promise<ContactOption[]> {
  await requireUser();
  return (await contactsForCompany(companyId)).map((c) => ({ id: c.id, name: displayName(c), title: c.title || "" }));
}
```

- [ ] **Step 4: Company search (client)**

Create `src/components/parties/company-search.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { Typeahead } from "@/components/search/typeahead";
import { searchLinkTargetsAction } from "@/app/(app)/inbox/link-popup-actions";
import type { LinkTargetHit } from "@/lib/inbox-link-targets";

/** #346 — debounced company search (the Inbox link sidebar's #121 pattern, companies only). */
const keyOf = (h: LinkTargetHit) => h.id;
const passAll = () => true;
const stable = () => 0;

export default function CompanySearch({
  placeholder,
  disabled,
  onPick,
}: {
  placeholder: string;
  disabled?: boolean;
  onPick: (c: { id: string; name: string }) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<LinkTargetHit[]>([]);
  const [resultQuery, setResultQuery] = useState("");
  const [failed, setFailed] = useState(false);
  const seq = useRef(0);
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    const my = ++seq.current;
    const t = setTimeout(() => {
      setFailed(false);
      searchLinkTargetsAction(q, "company")
        .then((g) => {
          if (my !== seq.current) return;
          setResults(g.companies);
          setResultQuery(q);
        })
        .catch(() => {
          if (my === seq.current) setFailed(true);
        });
    }, 220);
    return () => clearTimeout(t);
  }, [query]);
  const trimmed = query.trim();
  const fresh = trimmed.length >= 2 && resultQuery === trimmed;
  return (
    <Typeahead
      items={fresh ? results : []}
      keyOf={keyOf}
      filter={passAll}
      rank={stable}
      render={(h) => (
        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <span style={{ fontSize: 12.5, fontWeight: 600 }}>{h.label}</span>
          {h.sub ? <span style={{ fontSize: 11, color: "#8c919c" }}>{h.sub}</span> : null}
        </div>
      )}
      onPick={(h) => onPick({ id: h.id, name: h.label })}
      placeholder={placeholder}
      ariaLabel={placeholder}
      inputStyle={{ width: "100%", padding: "7px 9px", fontSize: 12.5, border: "1px solid #dfe2e8", borderRadius: 7 }}
      emptyText={failed ? "Search failed — try again." : trimmed.length < 2 ? "Type at least 2 letters." : fresh ? "Nothing matches." : "Searching…"}
      onQueryChange={setQuery}
      disabled={disabled}
    />
  );
}
```

Verify against the real types before committing: `LinkTargetGroups` has a `companies: LinkTargetHit[]` field and `LinkTargetHit` has `id`, `label`, `sub` (`src/lib/inbox-link-targets.ts:10-27`). If `Typeahead`'s import is a default export, adjust the import line.

- [ ] **Step 5: The editor (client)**

Create `src/components/parties/parties-editor.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PARTY_ROLES, ROLE_LABEL, groupPartiesByRole, type PartyRecordType, type PartyRole } from "@/lib/parties/rules";
import type { ContactOption, PartyVM } from "@/lib/parties/vm";
import { addPartyAction, companyContactsAction, removePartyAction, setPartyContactAction, type PartyActionResult } from "@/app/(app)/parties/actions";
import CompanySearch from "./company-search";

/**
 * #346 — the one parties editor: grouped by role, add (role → company → optional person → label for Other),
 * change person, remove. Used by the lead drawer, the project page and the Estimator's Parties dialog.
 */
export default function PartiesEditor({
  recordType,
  recordId,
  initial,
  canEdit,
  roles = PARTY_ROLES,
  onChange,
}: {
  recordType: PartyRecordType;
  recordId: string;
  initial: PartyVM[];
  canEdit: boolean;
  roles?: readonly PartyRole[];
  onChange?: (parties: PartyVM[]) => void;
}) {
  const router = useRouter();
  const [parties, setParties] = useState(initial);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const [adding, setAdding] = useState(false);
  const [role, setRole] = useState<PartyRole>(roles[0]);
  const [company, setCompany] = useState<{ id: string; name: string } | null>(null);
  const [contacts, setContacts] = useState<ContactOption[]>([]);
  const [contactId, setContactId] = useState("");
  const [label, setLabel] = useState("");
  const [contactsFor, setContactsFor] = useState<Record<string, ContactOption[]>>({});

  const apply = (r: PartyActionResult) => {
    if (!r.ok) {
      setError(r.error);
      return false;
    }
    setError("");
    setNote(r.note ?? "");
    setParties(r.parties);
    onChange?.(r.parties);
    router.refresh();
    return true;
  };

  const pickCompany = (c: { id: string; name: string }) => {
    setCompany(c);
    setContactId("");
    setContacts([]);
    companyContactsAction(c.id).then(setContacts).catch(() => setContacts([]));
  };

  const resetAdd = () => {
    setAdding(false);
    setCompany(null);
    setContacts([]);
    setContactId("");
    setLabel("");
  };

  const submit = () => {
    if (!company) return setError("Pick a company.");
    start(async () => {
      const ok = apply(await addPartyAction({ recordType, recordId, companyId: company.id, role, contactId: contactId || null, roleLabel: role === "other" ? label : null }));
      if (ok) resetAdd();
    });
  };

  const loadContacts = (companyId: string) => {
    if (contactsFor[companyId]) return;
    companyContactsAction(companyId).then((list) => setContactsFor((m) => ({ ...m, [companyId]: list }))).catch(() => {});
  };

  const groups = groupPartiesByRole(parties);
  const small = { fontSize: 11.5, color: "#8c919c" } as const;
  const btn = { fontSize: 12, fontWeight: 600, border: "1px solid #dfe2e8", background: "#fff", borderRadius: 7, padding: "5px 10px", cursor: "pointer" } as const;

  return (
    <div>
      {groups.length === 0 && <div style={{ ...small, padding: "6px 0" }}>No companies linked yet.</div>}
      {groups.map((g) => (
        <div key={g.role} style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: "#9aa0ab", letterSpacing: ".05em", textTransform: "uppercase", marginBottom: 4 }}>{g.label}</div>
          {g.parties.map((p) => (
            <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", borderTop: "1px solid #f3f4f7", flexWrap: "wrap" }}>
              <Link href={p.href} style={{ fontSize: 13, fontWeight: 600, color: "inherit", textDecoration: "none", minWidth: 0, overflowWrap: "anywhere" }}>
                {p.companyName}
              </Link>
              {p.role === "other" && <span style={small}>{p.roleText}</span>}
              <span style={{ flex: 1 }} />
              {canEdit ? (
                <select
                  aria-label={`Person at ${p.companyName}`}
                  value={p.contactId ?? ""}
                  onFocus={() => loadContacts(p.companyId)}
                  onChange={(e) => start(async () => void apply(await setPartyContactAction(p.id, e.target.value || null)))}
                  disabled={pending}
                  style={{ fontSize: 12, maxWidth: 180 }}
                >
                  <option value="">— no person —</option>
                  {p.contactId && !(contactsFor[p.companyId] ?? []).some((c) => c.id === p.contactId) && <option value={p.contactId}>{p.contactName || p.contactId}</option>}
                  {(contactsFor[p.companyId] ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {c.title ? ` · ${c.title}` : ""}
                    </option>
                  ))}
                </select>
              ) : (
                p.contactName && <span style={small}>{p.contactName}</span>
              )}
              {canEdit && (
                <button
                  type="button"
                  aria-label={`Remove ${p.companyName} (${p.roleText})`}
                  onClick={() => start(async () => void apply(await removePartyAction(p.id)))}
                  disabled={pending}
                  style={{ ...btn, padding: "2px 7px", color: "#8a2f22" }}
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
      ))}

      {canEdit && !adding && (
        <button type="button" onClick={() => setAdding(true)} style={btn}>
          + Link a company
        </button>
      )}
      {canEdit && adding && (
        <div style={{ display: "grid", gap: 8, padding: 10, border: "1px solid #ececf0", borderRadius: 10, background: "#fafbfc" }}>
          <label style={{ display: "grid", gap: 4, fontSize: 11.5, fontWeight: 600 }}>
            Role
            <select value={role} onChange={(e) => setRole(e.target.value as PartyRole)} style={{ fontSize: 12.5 }}>
              {roles.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
          </label>
          {role === "other" && (
            <label style={{ display: "grid", gap: 4, fontSize: 11.5, fontWeight: 600 }}>
              Role name
              <input value={label} maxLength={60} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Construction manager" style={{ fontSize: 12.5, padding: "6px 8px" }} />
            </label>
          )}
          <div style={{ display: "grid", gap: 4, fontSize: 11.5, fontWeight: 600 }}>
            Company
            {company ? (
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ fontSize: 13 }}>{company.name}</span>
                <button type="button" onClick={() => setCompany(null)} style={{ ...btn, padding: "2px 8px" }}>
                  Change
                </button>
              </div>
            ) : (
              <CompanySearch placeholder="Search companies…" onPick={pickCompany} disabled={pending} />
            )}
          </div>
          {company && (
            <label style={{ display: "grid", gap: 4, fontSize: 11.5, fontWeight: 600 }}>
              Person (optional)
              <select value={contactId} onChange={(e) => setContactId(e.target.value)} style={{ fontSize: 12.5 }}>
                <option value="">— no person —</option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.title ? ` · ${c.title}` : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" onClick={submit} disabled={pending || !company} style={{ ...btn, background: "var(--accent)", color: "#fff", borderColor: "var(--accent)" }}>
              {pending ? "Linking…" : "Link"}
            </button>
            <button type="button" onClick={resetAdd} disabled={pending} style={btn}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {error && <div role="alert" style={{ marginTop: 8, fontSize: 12, color: "#8a2f22" }}>{error}</div>}
      {note && !error && <div style={{ marginTop: 8, ...small }}>{note}</div>}
    </div>
  );
}
```

- [ ] **Step 6: Type-check and build-gate the client graph**

Run: `npx tsc --noEmit` — expected: no output.
Run: `grep -n "stores/\|node:crypto\|view-server" src/components/parties/*.tsx src/lib/parties/vm.ts src/lib/parties/rules.ts` — expected: no matches (client graph stays store-free; `actions.ts` is a server-action module, which is allowed).

- [ ] **Step 7: Commit**

```bash
git add src/lib/parties/vm.ts src/lib/parties/view-server.ts "src/app/(app)/parties/actions.ts" src/components/parties/company-search.tsx src/components/parties/parties-editor.tsx
git commit -m "feat(346): parties actions + shared editor (company search, person, roles)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Lead drawer Job card, estimates list, board double-count fix

**Files:**
- Create: `src/components/parties/parties-card.tsx`
- Create: `src/components/parties/lead-estimates.tsx`
- Modify: `src/app/(app)/leads/page.tsx` (the `meetingsSlot` at ~lines 869–875)
- Modify: `src/lib/opportunities.ts` (`OppLeadInput` type + `buildOpportunities` ~line 135)
- Modify: `src/app/(app)/opportunities/page.tsx` (~line 133 lead mapping)
- Modify: `scripts/test-parties.ts` (board check)

**Interfaces:**
- Consumes: `PartiesEditor`, `partyVMs`, `listFor`, `leadEstimatesTotal`, `leadIdsWithEstimates`.
- Produces: `PartiesCard({ recordType, recordId, title?, roles? })` (async server component), `LeadEstimates({ leadId })` (async server component), `OppLeadInput.hasEstimates?: boolean`.

- [ ] **Step 1: Failing board test**

Append to `partyChecks` in `scripts/test-parties.ts`:

```ts
  const leadIn = (id: string, extra: Partial<OppLeadInput> = {}): OppLeadInput => ({
    id, org: "Org", interest: "x", stage: "new", owner: "", value: 1000, createdAt: 1, updatedAt: 1, customerId: null, convertedCustomerId: null, convertedQuoteId: null, forecastAt: null, ...extra,
  });
  const board = buildOpportunities([leadIn("L-1"), leadIn("L-2", { hasEstimates: true })], []);
  ok(board.some((r) => r.id === "L-1") && !board.some((r) => r.id === "L-2"), "parties: board skips a lead whose estimates carry it");
```

and add `import { buildOpportunities, type OppLeadInput } from "../src/lib/opportunities";` at the top. Before writing, read `OppLeadInput` in `src/lib/opportunities.ts` and match its exact required fields in `leadIn` (adjust the object above if the type differs; keep `hasEstimates`).

Run: `npx tsx scripts/test-parties.ts` — expected: a type error / FAIL on `hasEstimates`.

- [ ] **Step 2: Board fix**

In `src/lib/opportunities.ts`, add to `OppLeadInput`:

```ts
  /** #346 — the lead has ≥ 1 estimate (Quote.leadId). Its estimates ride the board instead, like a converted lead. */
  hasEstimates?: boolean;
```

and in `buildOpportunities`, change `if (l.convertedQuoteId) continue;` (the one in the rows loop) to:

```ts
    if (l.convertedQuoteId || l.hasEstimates) continue;
```

Update the function's doc comment's first sentence to: `A converted lead (non-null convertedQuoteId) or a lead with estimates (#346) is EXCLUDED — its quotes carry the opportunity from there — …`.

In `src/app/(app)/opportunities/page.tsx`, just before `const rows = buildOpportunities(`, add:

```ts
  // #346 — a lead whose estimates are on the board is not counted twice.
  const withEstimates = leadIdsWithEstimates(quotes);
```

add `hasEstimates: withEstimates.has(l.id),` to the lead mapping object, and import `leadIdsWithEstimates` from `@/lib/parties/rules`. Confirm `quotes` there are full quote docs carrying `leadId` (read where `quotes` is loaded in that file); if they are a projected shape without `leadId`, add `leadId` to the projection.

Run: `npx tsx scripts/test-parties.ts` — expected: `0 FAIL`.

- [ ] **Step 3: PartiesCard (server)**

Create `src/components/parties/parties-card.tsx`:

```tsx
import type { CSSProperties } from "react";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/team";
import { listFor } from "@/lib/stores/parties";
import { partyVMs } from "@/lib/parties/view-server";
import { PARTY_ROLES, type PartyRecordType, type PartyRole } from "@/lib/parties/rules";
import PartiesEditor from "./parties-editor";

/** #346 — the "Job" / "Companies" card on the lead drawer and the project page. */
export async function PartiesCard({
  recordType,
  recordId,
  title = "Companies on this job",
  roles = PARTY_ROLES,
  style,
}: {
  recordType: PartyRecordType;
  recordId: string;
  title?: string;
  roles?: readonly PartyRole[];
  style?: CSSProperties;
}) {
  const user = await requireUser();
  const initial = await partyVMs(await listFor(recordType, recordId));
  return (
    <div style={{ marginTop: 18, ...style }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: "#9aa0ab", letterSpacing: ".05em", textTransform: "uppercase", marginBottom: 8 }}>{title}</div>
      <PartiesEditor key={`${recordType}:${recordId}`} recordType={recordType} recordId={recordId} initial={initial} canEdit={can("create", user.roles)} roles={roles} />
    </div>
  );
}
```

- [ ] **Step 4: LeadEstimates (server)**

Create `src/components/parties/lead-estimates.tsx`:

```tsx
import Link from "next/link";
import { listDocsByField } from "@/db/doc-store";
import type { Quote } from "@/lib/stores/quotes";
import { displayQuoteNumber } from "@/lib/estimate-number";
import { quoteBuilderHref } from "@/lib/quote-links";
import { leadEstimatesTotal } from "@/lib/parties/rules";

const money = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
const STATUS: Record<string, string> = { draft: "Draft", sent: "Sent", won: "Won", lost: "Lost" };

/** #346 — every estimate on this lead/opportunity with the estimates total (draft + sent + won). Nothing when none. */
export async function LeadEstimates({ leadId }: { leadId: string }) {
  const quotes = (await listDocsByField<Quote>("quotes", "leadId", [leadId])).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  if (!quotes.length) return null;
  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: "#9aa0ab", letterSpacing: ".05em", textTransform: "uppercase" }}>Estimates</span>
        <span style={{ fontSize: 12, fontWeight: 700 }}>{money(leadEstimatesTotal(quotes))}</span>
      </div>
      {quotes.map((q) => (
        <Link key={q.id} href={quoteBuilderHref(q)} style={{ display: "flex", gap: 8, alignItems: "baseline", padding: "6px 0", borderTop: "1px solid #f3f4f7", color: "inherit", textDecoration: "none" }}>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "#8c919c", flexShrink: 0 }}>{displayQuoteNumber(q)}</span>
          <span style={{ fontSize: 13, fontWeight: 600, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{q.name}</span>
          <span style={{ fontSize: 11.5, color: q.status === "lost" ? "#9aa0ab" : "#5b616e" }}>{STATUS[q.status] ?? q.status}</span>
          <span style={{ fontSize: 12, fontWeight: 600, textDecoration: q.status === "lost" ? "line-through" : "none" }}>{money(q.value || 0)}</span>
        </Link>
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Mount on the lead drawer**

In `src/app/(app)/leads/page.tsx`, inside the `meetingsSlot` fragment, after the `<AssessmentsCard … />` line add:

```tsx
                <PartiesCard recordType="lead" recordId={leadRec.id} />
                <LeadEstimates leadId={leadRec.id} />
```

and import `{ PartiesCard }` from `@/components/parties/parties-card` and `{ LeadEstimates }` from `@/components/parties/lead-estimates`.

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit` — no output. Run: `npx tsx scripts/test-parties.ts` — `0 FAIL`.

- [ ] **Step 7: Commit**

```bash
git add src/components/parties/parties-card.tsx src/components/parties/lead-estimates.tsx "src/app/(app)/leads/page.tsx" src/lib/opportunities.ts "src/app/(app)/opportunities/page.tsx" scripts/test-parties.ts
git commit -m "feat(346): lead Job card + estimates total; board skips leads whose estimates carry them

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Estimator Parties chip + dialog

**Files:**
- Create: `src/app/(app)/estimator/parties-chip.tsx`
- Modify: `src/app/(app)/estimator/estimator-header.tsx` (after the Quote details chip `</button>` at ~line 206, inside the same flex row)

**Interfaces:**
- Consumes: `listPartiesAction`, `PartiesEditor`, `PartyVM`, `EstimatorState` (`s.loadedId: string | null`).
- Produces: `export default function PartiesChip({ quoteId }: { quoteId: string | null })`.

- [ ] **Step 1: The chip**

Create `src/app/(app)/estimator/parties-chip.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import PartiesEditor from "@/components/parties/parties-editor";
import { listPartiesAction } from "@/app/(app)/parties/actions";
import type { PartyVM } from "@/lib/parties/vm";

/** #346 — the Estimator header's Parties chip: "Parties · 3" opens a dialog with the shared editor. Disabled until saved. */
export default function PartiesChip({ quoteId, canEdit }: { quoteId: string | null; canEdit: boolean }) {
  const [parties, setParties] = useState<PartyVM[] | null>(null);
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (!quoteId) return;
    let live = true;
    listPartiesAction("quote", quoteId).then((p) => live && setParties(p)).catch(() => live && setParties([]));
    return () => {
      live = false;
    };
  }, [quoteId]);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const n = parties?.length ?? 0;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={!quoteId}
        title={quoteId ? "Owner, GCs, ECs, architect, consultant, vendors on this estimate" : "Save the estimate first"}
        style={{
          fontFamily: "var(--font-ui)", fontSize: 11, fontWeight: 600, color: "#cfd3da", background: "transparent",
          border: "1px solid #3a3e46", borderRadius: 6, padding: "2px 8px", cursor: quoteId ? "pointer" : "not-allowed", whiteSpace: "nowrap", flexShrink: 0,
        }}
      >
        Parties{n ? ` · ${n}` : ""}
      </button>
      <dialog
        ref={dialog}
        onClose={() => setOpen(false)}
        aria-label="Companies on this estimate"
        style={{ width: "min(520px, calc(100vw - 32px))", border: "1px solid #e4e7ec", borderRadius: 12, padding: 0 }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 18px", borderBottom: "1px solid #f0f1f4" }}>
          <span style={{ fontSize: 14.5, fontWeight: 600 }}>Companies on this estimate</span>
          <button type="button" onClick={() => setOpen(false)} aria-label="Close" style={{ border: 0, background: "transparent", fontSize: 16, cursor: "pointer" }}>
            ✕
          </button>
        </div>
        <div style={{ padding: "14px 18px 18px" }}>
          {open && quoteId && parties && <PartiesEditor recordType="quote" recordId={quoteId} initial={parties} canEdit={canEdit} onChange={setParties} />}
          {open && quoteId && !parties && <div style={{ fontSize: 12, color: "#8c919c" }}>Loading…</div>}
        </div>
      </dialog>
    </>
  );
}
```

- [ ] **Step 2: Mount it**

In `src/app/(app)/estimator/estimator-header.tsx`, directly after the Quote details chip's closing `</button>` (inside the `<div style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 2, minWidth: 0 }}>` row) add:

```tsx
              <PartiesChip quoteId={s.loadedId} canEdit={s.canCreate} />
```

and `import PartiesChip from "./parties-chip";`. Find the right boolean for edit rights: run `grep -n "can(\"create\"\|canCreate\|canEdit" "src/app/(app)/estimator/use-estimator-state.ts" "src/app/(app)/estimator/page.tsx" | head`. If the state exposes no such flag, pass `canEdit` from wherever the page computes the user's `create` permission (thread it through `initial` → state the same way existing permission flags are threaded); if nothing exists at all, pass `canEdit={true}` and rely on the server action's `can("create")` refusal (the editor shows the action's error). Record which you did in the commit message.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit` — no output.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/estimator/parties-chip.tsx" "src/app/(app)/estimator/estimator-header.tsx"
git commit -m "feat(346): Estimator header Parties chip + dialog

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Carry-over (lead → estimate → project) + project card

**Files:**
- Modify: `src/app/(app)/estimator/actions.ts` (create branch, right after `created = await create(...)` succeeds, ~line 621–640)
- Modify: `src/lib/stores/leads.ts` (`convert`, right after the quote is inserted)
- Modify: `src/lib/stores/projects.ts` (`createProjectFromQuote`, right after `const p = await createProject(...)`)
- Modify: `src/app/(app)/projects/[id]/page.tsx` (the `meetingsSlot` fragment ~line 62)
- Modify: `scripts/test-parties.ts` (DB checks for the project hook)

**Interfaces:**
- Consumes: `copyParties`.
- Produces: no new exports. Carry-over never throws into its caller.

- [ ] **Step 1: Failing DB check for the project hook**

Append inside the `try` block of `partyDbChecks` (before `} finally {`):

```ts
    // carry estimate → project through createProjectFromQuote
    const wonQ = fixtureId(346, "won");
    await createFixture("quotes", buildQuote({ id: wonQ, name: "Party won", customer: "Party Co One", customerId: co1, status: "won", value: 1000, quoteType: "system" } as never) as never);
    const ownerOnWon = await addParty({ recordType: "quote", recordId: wonQ, companyId: co1, role: "owner" }, "u-test");
    if (ownerOnWon.ok) registerFixture("record_parties", ownerOnWon.party.id);
    const proj = await createProjectFromQuote(wonQ);
    ok(!!proj, "parties db: fixture won quote spawns a project");
    if (proj) {
      registerFixture("projects", proj.id);
      const onProj = await listFor("project", proj.id);
      for (const p of onProj) registerFixture("record_parties", p.id);
      ok(onProj.length === 1 && onProj[0].role === "owner" && onProj[0].companyId === co1, "parties db: project inherits the estimate's parties");
    }
```

Add imports: `import { buildQuote } from "../src/lib/stores/quotes";`, `import { createProjectFromQuote } from "../src/lib/stores/projects";`, and `createFixture` to the `./test-fixtures` import. Read `buildQuote`'s signature (`src/lib/stores/quotes.ts`, exported, used by `scripts/test-assessments.ts`) and mirror how `test-assessments.ts` builds a fixture quote; keep the fields above.

Run: `npm run test:specs 2>&1 | grep -E "parties db: project inherits|0 FAIL|FAIL" | head` — expected: FAIL on "project inherits".

- [ ] **Step 2: Project hook**

In `src/lib/stores/projects.ts`, inside `createProjectFromQuote`, directly after `const p = await createProject(fromQuote(q, await loadPipelines()));` add:

```ts
    // #346 — the estimate's companies carry to the project once. Never allowed to undo the win:
    // this runs inside setStatus's transaction (see quote-spawn.ts), so a failure is logged, not thrown.
    try {
      const { copyParties } = await import("@/lib/stores/parties");
      await copyParties({ type: "quote", id: quoteId }, { type: "project", id: p.id }, q.owner || DEFAULT_ACTOR);
    } catch (e) {
      console.error("projects.createProjectFromQuote: copying parties failed", quoteId, e);
    }
```

- [ ] **Step 3: Estimate hooks**

In `src/app/(app)/estimator/actions.ts` create branch, after the `try { created = await create(...) } catch { … }` block and before `storedVendorQuotes = await storeVendorQuotes(...)`, add:

```ts
    // #346 — a new estimate on a lead starts with the lead's companies (not its GCs/ECs — bidders are ticked per estimate).
    if (leadId) {
      try {
        const { copyParties } = await import("@/lib/stores/parties");
        await copyParties({ type: "lead", id: leadId }, { type: "quote", id: created.id }, user.id);
      } catch (e) {
        console.error("saveQuoteAction: copying lead parties failed", created.id, e);
      }
    }
```

In `src/lib/stores/leads.ts` `convert`, directly after the `const quote = await insertWithPrefixedId("quotes", …)` statement completes, add:

```ts
  // #346 — the converted quote starts with the lead's companies (not its GCs/ECs).
  try {
    const { copyParties } = await import("./parties");
    await copyParties({ type: "lead", id }, { type: "quote", id: quote.id }, me);
  } catch (e) {
    console.error("leads.convert: copying parties failed", id, e);
  }
```

(Read `convert` to confirm the inserted quote variable is named `quote` and exposes `.id`; adapt the name if not.)

- [ ] **Step 4: Project card**

In `src/app/(app)/projects/[id]/page.tsx`, inside the `meetingsSlot` fragment after `<AssessmentsCard … />` add:

```tsx
            <PartiesCard recordType="project" recordId={sel.id} title="Companies on this project" />
```

and `import { PartiesCard } from "@/components/parties/parties-card";`.

- [ ] **Step 5: Verify**

Run: `npm run test:specs 2>&1 | tail -3` — `0 FAIL`. Run: `npx tsc --noEmit` — no output.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/estimator/actions.ts" src/lib/stores/leads.ts src/lib/stores/projects.ts "src/app/(app)/projects/[id]/page.tsx" scripts/test-parties.ts
git commit -m "feat(346): carry parties lead → estimate → project; project Companies card

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Company page "Bids & roles" + delete guard

**Files:**
- Create: `src/components/parties/company-roles-card.tsx`
- Modify: `src/app/(app)/companies/[id]/page.tsx` (after the `<FindingsCard … />` line ~790)
- Modify: `src/app/(app)/companies/actions.ts` (`deleteCustomerAction` ~line 141)
- Modify: `src/lib/parties/rules.ts` + `scripts/test-parties.ts` (pure `deleteRefusal` message)

**Interfaces:**
- Produces: `CompanyRolesCard({ companyId, style?, headStyle? })`; `deleteRefusal(companyName: string, n: number): string | null` in rules.ts.

- [ ] **Step 1: Failing pure test**

Append to `partyChecks`:

```ts
  ok(deleteRefusal("Acme", 0) === null, "parties: no refusal when unlinked");
  ok(deleteRefusal("Acme", 1) === "Acme is linked to 1 record (leads, estimates or projects) — remove it from them first.", "parties: refusal copy, singular");
  ok(deleteRefusal("Acme", 3) === "Acme is linked to 3 records (leads, estimates or projects) — remove it from them first.", "parties: refusal copy, plural");
```

(import `deleteRefusal`). Run `npx tsx scripts/test-parties.ts` — FAIL.

- [ ] **Step 2: Implement**

Append to `src/lib/parties/rules.ts`:

```ts
/** Company delete guard copy (spec §8): null when the company is on no live party row. */
export function deleteRefusal(companyName: string, n: number): string | null {
  if (n <= 0) return null;
  return `${companyName} is linked to ${n} record${n === 1 ? "" : "s"} (leads, estimates or projects) — remove it from them first.`;
}
```

In `src/app/(app)/companies/actions.ts` `deleteCustomerAction`, after the `if (!id) …` line add:

```ts
  // #346 — a company that is an owner / GC / EC / architect / vendor somewhere can't silently vanish from those records.
  const linked = await listForCompany(id);
  const refusal = deleteRefusal((await getCompany(id))?.name || id, new Set(linked.map((p) => `${p.recordType}:${p.recordId}`)).size);
  if (refusal) return { ok: false as const, error: refusal };
```

with imports `import { listForCompany } from "@/lib/stores/parties";`, `import { deleteRefusal } from "@/lib/parties/rules";`, and `getCompany` from `@/lib/identity/companies` (skip if already imported). Check the delete button / edit modal already show `error` from this action (`delete-company-button.tsx`, `edit-modal.tsx:426`); if either swallows `ok:false`, make it display the error the same way it displays other errors in that file.

- [ ] **Step 3: The card**

Create `src/components/parties/company-roles-card.tsx`:

```tsx
import type { CSSProperties } from "react";
import Link from "next/link";
import { getDoc } from "@/db/doc-store";
import { listForCompany } from "@/lib/stores/parties";
import { getMany as getQuotes } from "@/lib/stores/quotes";
import { displayLeadNumber, displayQuoteNumber } from "@/lib/estimate-number";
import { quoteBuilderHref } from "@/lib/quote-links";
import { partyRoleText, type Party } from "@/lib/parties/rules";
import type { LeadRecord } from "@/lib/stores/leads";
import type { ProjectRecord } from "@/lib/stores/projects";
import { ShortList } from "@/components/short-list";

const CARD: CSSProperties = { background: "#fff", border: "1px solid #ececf0", borderRadius: 12, boxShadow: "0 1px 2px rgba(0,0,0,.04)", marginBottom: 24, overflow: "hidden" };
const HEAD: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "14px 18px 12px", borderBottom: "1px solid #f0f1f4" };
const KIND: Record<Party["recordType"], string> = { lead: "Opportunity", quote: "Estimate", project: "Project" };

type Row = { key: string; kind: string; number: string; name: string; roles: string; href: string; sort: number };

/** #346 — every lead / estimate / project this company is on, and in what role. Nothing when none. */
export async function CompanyRolesCard({ companyId, style, headStyle }: { companyId: string; style?: CSSProperties; headStyle?: CSSProperties }) {
  const parties = await listForCompany(companyId);
  if (!parties.length) return null;
  const byRecord = new Map<string, Party[]>();
  for (const p of parties) {
    const k = `${p.recordType}:${p.recordId}`;
    byRecord.set(k, [...(byRecord.get(k) ?? []), p]);
  }
  const quoteIds = parties.filter((p) => p.recordType === "quote").map((p) => p.recordId);
  const quotes = await getQuotes([...new Set(quoteIds)]);
  const rows: Row[] = [];
  for (const [key, list] of byRecord) {
    const { recordType, recordId } = list[0];
    const roles = list.map(partyRoleText).join(", ");
    if (recordType === "quote") {
      const q = quotes.find((x) => x.id === recordId);
      if (!q) continue;
      rows.push({ key, kind: KIND.quote, number: displayQuoteNumber(q), name: q.name, roles, href: quoteBuilderHref(q), sort: q.updatedAt || 0 });
    } else if (recordType === "lead") {
      const l = await getDoc<LeadRecord>("leads", recordId);
      if (!l) continue;
      rows.push({ key, kind: KIND.lead, number: displayLeadNumber(l), name: l.org + (l.interest ? ` — ${l.interest}` : ""), roles, href: `/leads?lead=${encodeURIComponent(l.id)}`, sort: l.updatedAt || 0 });
    } else {
      const pr = await getDoc<ProjectRecord>("projects", recordId);
      if (!pr) continue;
      rows.push({ key, kind: KIND.project, number: pr.id, name: pr.name, roles, href: `/projects/${encodeURIComponent(pr.id)}`, sort: pr.updatedAt || 0 });
    }
  }
  if (!rows.length) return null;
  rows.sort((a, b) => b.sort - a.sort);
  return (
    <div style={{ ...CARD, ...style }}>
      <div style={{ ...HEAD, ...headStyle }}>
        <span style={{ fontSize: 14.5, fontWeight: 600 }}>Bids &amp; roles</span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "#9aa0ab" }}>{rows.length}</span>
      </div>
      <ShortList
        initial={8}
        searchPlaceholder="Search jobs…"
        searchText={rows.map((r) => `${r.number} ${r.name} ${r.roles}`)}
        items={rows.map((r) => (
          <Link key={r.key} href={r.href} style={{ display: "flex", gap: 10, alignItems: "baseline", padding: "10px 18px", borderBottom: "1px solid #f5f6f8", color: "inherit", textDecoration: "none" }}>
            <span style={{ fontSize: 11, color: "#9aa0ab", width: 76, flexShrink: 0 }}>{r.kind}</span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "#8c919c", flexShrink: 0 }}>{r.number}</span>
            <span style={{ fontSize: 13, fontWeight: 600, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</span>
            <span style={{ fontSize: 11.5, color: "#5b616e", flexShrink: 0 }}>{r.roles}</span>
          </Link>
        ))}
      />
    </div>
  );
}
```

Check `getMany` in `src/lib/stores/quotes.ts` returns `Promise<Quote[]>` (if it returns a Map, use `.get`). Check `ShortList`'s props match `src/components/short-list` (`initial`, `searchPlaceholder`, `searchText`, `items` — as used by `assessment-cards.tsx`).

- [ ] **Step 4: Mount**

In `src/app/(app)/companies/[id]/page.tsx`, after `<FindingsCard customerId={cust.id} … />` add:

```tsx
            {/* #346 — leads / estimates / projects this company is on (owner, GC, EC, architect, vendor…) */}
            <CompanyRolesCard companyId={cust.id} style={{ ...card, marginBottom: 0 }} headStyle={cardHead} />
```

and `import { CompanyRolesCard } from "@/components/parties/company-roles-card";`.

- [ ] **Step 5: Verify**

Run: `npx tsx scripts/test-parties.ts` — `0 FAIL`. `npx tsc --noEmit` — no output.

- [ ] **Step 6: Commit**

```bash
git add src/components/parties/company-roles-card.tsx "src/app/(app)/companies/[id]/page.tsx" "src/app/(app)/companies/actions.ts" src/lib/parties/rules.ts scripts/test-parties.ts
git commit -m "feat(346): company Bids & roles card; refuse deleting a linked company

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Docs, full gates, browser check

**Files:**
- Modify: `DECISIONS.md` (append D1052–D1056), `PUNCHLIST.md` (add #346), `AGENTS.md` (phase 60 entry after phase 59)

- [ ] **Step 1: Recompute numbers**

Run: `git fetch -q origin && git show origin/main:DECISIONS.md | grep -oE "^## D[0-9]+" | sort -t D -k2 -n | tail -1` and `git show origin/main:PUNCHLIST.md | grep -oE "#3[0-9]{2}" | sort -u | tail -3`. If D1052 or #346 is taken, use the next free numbers everywhere below (and in the spec header).

- [ ] **Step 2: Decisions**

Append to `DECISIONS.md` (match the file's existing heading/bullet style — read the last entry first):

```markdown
## D1052: Estimate parties are one junction collection (#346 slice 1) (2026-10-14)

`record_parties` (migration 0041) — one doc per company in one role on a lead, estimate or project; roles
owner · gc · ec · architect · consultant · vendor · other (typed label). Chosen over a JSONB list on the quote
(no company-side lookups, no project carry) and over per-GC estimate copies (edits would have to sync). The id is
sha1(recordType, recordId, companyId, role), so one row per (record, company, role) needs no unique index; remove
soft-deletes and a re-add revives the row fresh. Not syncable; wiped by the go-live reset with its records.

## D1053: Carry-over is a one-time copy (#346) (2026-10-14)

Lead → estimate on the estimate's first save (and on lead convert) copies every role but GC/EC — bidders are
ticked per estimate in slice 2. Estimate → project copies every row when the project is created. After that each
list is its own. A copy failure is logged and never undoes the save or the win.

## D1054: A lead with estimates leaves the opportunity board (#346) (2026-10-14)

Spec §3.6 said "lead value = sum of its estimates". The board already lists every estimate as its own card, so
summing into the lead card too would count the job twice; instead a lead with ≥ 1 estimate is excluded from the
board exactly like a converted lead, and the lead drawer shows an Estimates list with the total (draft + sent +
won, lost excluded). Before this, a lead with non-converted estimates was already double-counted.

## D1055: Parties edits need `create` (#346) (2026-10-14)

Same bar as the other record edits (companies, leads, findings). Reading parties needs only a session.

## D1056: A linked company can't be deleted (#346) (2026-10-14)

Company delete is refused while the company is on any live party row, naming how many records. Before, a delete
left quotes pointing at a soft-deleted company silently; parties make the links visible, so the guard is cheap.
```

- [ ] **Step 3: Punch item + phase entry**

Add `#346` to `PUNCHLIST.md` following the newest entry's format: title "Estimate parties, bids & vendor links", reported 2026-10-14 by Jeff, link the spec, status "Slice 1 (parties core) built; slices 2–6 queued (bids, split systems, vendors, Read the PDF, portal + reports)".

Add phase **60** to `AGENTS.md` after phase 59, one paragraph in the same voice: what slice 1 shipped (collection, roles, the editor on lead / estimate / project, company Bids & roles, carry-over, board fix, delete guard), decisions D1052–D1056, migration 0041, "Remaining: slices 2–6 (spec §10)".

- [ ] **Step 4: Full gates**

Run each and record the numbers:

```bash
npx tsc --noEmit
npm run test:specs 2>&1 | tail -3
npx eslint src/lib/parties src/lib/stores/parties.ts src/components/parties "src/app/(app)/parties" "src/app/(app)/estimator/parties-chip.tsx" "src/app/(app)/estimator/estimator-header.tsx" "src/app/(app)/leads/page.tsx" "src/app/(app)/projects/[id]/page.tsx" "src/app/(app)/companies/[id]/page.tsx" "src/app/(app)/companies/actions.ts" src/lib/opportunities.ts "src/app/(app)/opportunities/page.tsx" scripts/test-parties.ts
npm run build 2>&1 | tail -5
npm run test:smoke 2>&1 | tail -5
```

Expected: tsc no output; test:specs `0 FAIL`; eslint 0 errors; build succeeds; smoke all OK. (`test:smoke` needs no dev server holding `.data/pglite`: `lsof -ti:3000` and `ps aux | grep -c "[t]sx "` first. Check `df -h /tmp` before — temp PGlite dirs fill the disk.)

- [ ] **Step 5: Browser check on a scratch datadir**

Follow the memory recipe "Exercising POST routes safely" / "Worktree dev-server browser traps": boot `next dev` on a scratch `PGLITE_PATH`, sign in with the dev picker, then: open a lead → link an Owner, a GC and an Architect; create an estimate from that lead → Parties chip shows 2 (owner + architect); mark it Won → the project page shows the same companies; the owner company's page shows Bids & roles; trying to delete that company shows the refusal. Screenshot each.

- [ ] **Step 6: Commit**

```bash
git add DECISIONS.md PUNCHLIST.md AGENTS.md
git commit -m "docs(346): slice 1 — D1052–D1056, punch #346, phase 60

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Later slices (each gets its own plan before it is built)

2. **Bids** — spec §3.2–§3.4, §5: `Quote.bid`, bidder rows (`bid` state), Bidders card, per-bidder PDFs (print token id `<quoteId>:<partyId>`, header override in `quoteDocumentDataFor`), v3 share tokens, send-to-all walking one bidder per call, website submissions, `awardBid`/`undoAward` via a `patchQuote` writer that leaves the tier alone, due-date surfacing (triage fact `bid_due`, Quotes hub badge/filter, ⌘K bidder names).
3. **Split systems into a new estimate.**
4. **Vendors** — `VendorQuote.vendorCompanyId`, File to estimate/project, Add as vendor quote, Vendors card, Procurement read-through.
5. **Read the PDF** — Assist feature `vendorpdf`.
6. **Portal** read-only bidder view + **Reports** Bids by GC/EC.
