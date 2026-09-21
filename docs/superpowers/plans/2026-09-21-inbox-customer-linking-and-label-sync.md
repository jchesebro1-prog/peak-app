# Inbox Customer Linking + Two-Way Gmail Labels Implementation Plan (PUNCHLIST #96)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Link every inbound/outbound email to a customer on arrival (contact → domain → learned), give the reader a link sidebar with domain-claim prompts and quick-add, and mirror link/status/assign/work-link both ways as `Peak/*` Gmail labels.

**Architecture:** Two waves. **Wave A** (Tasks 1–8) adds a `customer_domains` table, a pure resolver, ingest-time stamping with backfill/re-sweep, server actions, a shared `EntityQuickAdd` component extracted from the quote intake, the reader sidebar, and an Unmatched view. **Wave B** (Tasks 9–12) adds a pure `Peak/*` label vocabulary, lazy label creation, a Peak→Gmail writer hooked to the comms mutations, and a Gmail→Peak interpreter fed by `history.list` label events. Spec: `docs/superpowers/specs/2026-09-21-inbox-customer-linking-and-label-sync-design.md`. Depends on the hardening plan (`2026-09-21-gmail-hardening-and-status-derivation.md`) having landed — it removes `threadStatusFor` and adds `deriveStatus`.

**Tech Stack:** Next.js 16 App Router (server actions), Drizzle on Postgres/PGlite (`db:generate` migrations), doc-store (`listDocs`/`patchDoc`/`insertDocIfAbsent`), Gmail REST via `src/lib/gmail/api.ts` `gapi()`, `tsx` harnesses (`test:specs` pure, `test:review:regressions` scratch DB, `test:smoke` real server).

## Global Constraints

- Node at `~/.local/node/bin`: `export PATH=$HOME/.local/node/bin:$PATH` first.
- **PGlite is single-process.** `test:specs` is pure. `test:review:regressions` and `test:smoke` each open their own throwaway DB — run them one at a time, never alongside `next dev` or any other `tsx` script; `ps aux | grep -E 'tsx|next dev'` must be empty first.
- After editing `src/db/schema.ts`: `npm run db:generate`, commit the new `drizzle/00NN_*.sql` + `drizzle/meta/*`. Every new `docTable()` needs a `_seq_bump` trigger in a migration (see `drizzle/0012_seq_bump_trigger.sql`); `customer_domains` is a plain table, not a docTable, so no trigger.
- Timestamps epoch-ms. Ids: customers are slugs (`lakefront`), contacts `ct-…`, comms `C-####`, leads `L-####`. Keep prototype field names.
- No emoji in UI copy (#3). No hardcoded accent colour; reuse the inline style constants the Inbox already uses.
- Label namespace is exactly `Peak/` (capital P, forward slash); Gmail nests on `/`.
- Public webmail domains never claim or suggest.
- `git add` only the files each task names.
- Spec harness helper: `ok(cond, msg)` in `scripts/test-review-and-spec.ts`; pure modules only in the synchronous section. Regression harness: `assert` in `scripts/test-review-regressions.ts` (`main()`), runs against `PGLITE_PATH` scratch DB.

---

## Wave A — resolver, sidebar, unmatched view

### Task 1: `customer_domains` table + domains module

**Files:**
- Modify: `src/db/schema.ts` (after `contactPhones`, ~line 234)
- Create: `drizzle/0018_*.sql` (generated)
- Create: `src/lib/gmail/domains.ts`
- Modify: `src/lib/gmail/config.ts` (append `PUBLIC_EMAIL_DOMAINS`, `domainOf`, `isPublicDomain`)
- Test: `scripts/test-review-and-spec.ts`

**Interfaces:**
- Produces (config.ts, pure): `PUBLIC_EMAIL_DOMAINS: ReadonlySet<string>`, `domainOf(email: string): string` (lowercased part after `@`, `""` if none), `isPublicDomain(domain: string): boolean`.
- Produces (domains.ts, DB): `claimDomain(domain, customerId, source: "learned"|"manual", addedBy: string): Promise<void>` (upsert; `manual` overwrites, `learned` never overwrites an existing row), `customersForDomain(domain): Promise<Array<{ customerId: string; source: string }>>`, `releaseDomain(domain, customerId): Promise<void>`.

- [ ] **Step 1: Failing spec tests** (synchronous section; add `import { domainOf, isPublicDomain } from "@/lib/gmail/config";`)

```ts
/* ---- #96 §1 — domain helpers ---- */
ok(domainOf("Brenda.Gauchel@Lakefront.K12.MN.US") === "lakefront.k12.mn.us", "domainOf lowercases");
ok(domainOf("no-at-sign") === "", "domainOf: no @ → empty");
ok(isPublicDomain("gmail.com") && isPublicDomain("Yahoo.com") && isPublicDomain("icloud.com"), "isPublicDomain: webmail");
ok(!isPublicDomain("lakefront.k12.mn.us"), "isPublicDomain: district is claimable");
```

- [ ] **Step 2: Run** `npx tsx scripts/test-review-and-spec.ts 2>&1 | head -3` → import error for `domainOf`.

- [ ] **Step 3: config.ts additions** (append at end of file)

```ts
/* ---- #96 — sender domains ---------------------------------------------- */

/** Webmail/ISP domains that can never identify a customer. */
export const PUBLIC_EMAIL_DOMAINS: ReadonlySet<string> = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "ymail.com", "outlook.com", "hotmail.com",
  "live.com", "msn.com", "icloud.com", "me.com", "mac.com", "aol.com", "comcast.net",
  "att.net", "sbcglobal.net", "verizon.net", "charter.net", "protonmail.com", "proton.me",
  "mail.com", "zoho.com", "gmx.com", "yandex.com",
]);

export function domainOf(email: string): string {
  const s = (email || "").trim().toLowerCase();
  const i = s.lastIndexOf("@");
  return i < 0 ? "" : s.slice(i + 1);
}

export function isPublicDomain(domain: string): boolean {
  return PUBLIC_EMAIL_DOMAINS.has((domain || "").toLowerCase());
}
```

- [ ] **Step 4: schema.ts** — after `contactPhones`:

```ts
/** #96 — which customer an email DOMAIN belongs to. `manual` rows come from
 *  the reader's "link this domain" prompt; `learned` rows from "remember this
 *  address" when the domain wasn't public and wasn't yet claimed. */
export const customerDomains = pgTable(
  "customer_domains",
  {
    domain: text("domain").notNull(), // lowercased, no @
    customerId: text("customer_id").notNull(),
    source: text("source", { enum: ["learned", "manual"] }).notNull(),
    addedBy: text("added_by").notNull(),
    at: bigint("at", { mode: "number" }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.domain, t.customerId] }),
    index("customer_domains_domain_idx").on(t.domain),
  ]
);
export type CustomerDomainRow = typeof customerDomains.$inferSelect;
```
(`primaryKey` and `index` are already imported from `drizzle-orm/pg-core` at the top of schema.ts — confirm; add if not.)

Run: `npm run db:generate` → creates `drizzle/0018_<name>.sql`. Open it and confirm it contains only `CREATE TABLE "customer_domains"` + the index.

- [ ] **Step 5: domains.ts**

```ts
/**
 * #96 — customer ↔ email-domain claims. Backs the resolver's domain step and
 * the reader's "link this domain" prompt. A domain may be claimed by more
 * than one customer (two schools sharing a district domain); the resolver
 * treats that as ambiguous and never guesses.
 */
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { customerDomains } from "@/db/schema";
import { isPublicDomain } from "./config";

export async function customersForDomain(
  domain: string
): Promise<Array<{ customerId: string; source: string }>> {
  const d = (domain || "").toLowerCase();
  if (!d || isPublicDomain(d)) return [];
  const db = await getDb();
  const rows = await db
    .select({ customerId: customerDomains.customerId, source: customerDomains.source })
    .from(customerDomains)
    .where(eq(customerDomains.domain, d));
  return rows;
}

/** manual: replaces every other claim on the domain (single owner).
 *  learned: adds a claim only if the domain has none yet. */
export async function claimDomain(
  domain: string,
  customerId: string,
  source: "learned" | "manual",
  addedBy: string
): Promise<void> {
  const d = (domain || "").toLowerCase();
  if (!d || isPublicDomain(d) || !customerId) return;
  const db = await getDb();
  if (source === "manual") {
    await db.delete(customerDomains).where(eq(customerDomains.domain, d));
  } else {
    const existing = await customersForDomain(d);
    if (existing.length) return;
  }
  await db
    .insert(customerDomains)
    .values({ domain: d, customerId, source, addedBy, at: Date.now() })
    .onConflictDoNothing();
}

export async function releaseDomain(domain: string, customerId: string): Promise<void> {
  const db = await getDb();
  await db
    .delete(customerDomains)
    .where(and(eq(customerDomains.domain, (domain || "").toLowerCase()), eq(customerDomains.customerId, customerId)));
}
```

- [ ] **Step 6: Verify** `npx tsx scripts/test-review-and-spec.ts | grep -E 'domainOf|isPublicDomain|ALL PASSED'` → 4 PASS + ALL PASSED; `npx tsc --noEmit -p . | tail -3` → empty.

- [ ] **Step 7: Commit**

```bash
git add src/db/schema.ts drizzle/ src/lib/gmail/domains.ts src/lib/gmail/config.ts scripts/test-review-and-spec.ts
git commit -m "feat(inbox): customer_domains table + domain helpers (#96 §1, §4)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Pure resolver

**Files:**
- Create: `src/lib/gmail/resolve.ts`
- Test: `scripts/test-review-and-spec.ts`

**Interfaces:**
- Produces:
```ts
export type Resolution =
  | { kind: "linked"; customerId: string; contactId?: string; via: "contact" | "domain" }
  | { kind: "ambiguous"; candidates: Array<{ customerId: string }> }
  | { kind: "unknown" };
export type ResolveLookups = {
  contactByEmail: (email: string) => Promise<{ contactId: string; customerId: string } | null>;
  customersByDomain: (domain: string) => Promise<string[]>;
};
export async function resolveSender(email: string, lookups: ResolveLookups): Promise<Resolution>;
```

- [ ] **Step 1: Failing tests** — inside `asyncChecks()` (this is async), add `import { resolveSender } from "@/lib/gmail/resolve";` at the top:

```ts
/* ---- #96 §1 — resolver precedence ---- */
{
  const L = {
    contactByEmail: async (e: string) =>
      e === "brenda@lakefront.k12.mn.us" ? { contactId: "ct-b", customerId: "lakefront" } : null,
    customersByDomain: async (d: string) =>
      d === "lakefront.k12.mn.us" ? ["lakefront"] : d === "shared.org" ? ["a", "b"] : [],
  };
  const r1 = await resolveSender("Brenda@Lakefront.K12.MN.US", L);
  ok(r1.kind === "linked" && r1.via === "contact" && r1.customerId === "lakefront", "resolve: exact contact wins");
  const r2 = await resolveSender("new.person@lakefront.k12.mn.us", L);
  ok(r2.kind === "linked" && r2.via === "domain", "resolve: domain fallback");
  const r3 = await resolveSender("x@shared.org", L);
  ok(r3.kind === "ambiguous" && r3.candidates.length === 2, "resolve: shared domain → ambiguous");
  const r4 = await resolveSender("someone@gmail.com", { ...L, customersByDomain: async () => ["oops"] });
  ok(r4.kind === "unknown", "resolve: public domain never uses the domain step");
  const r5 = await resolveSender("", L);
  ok(r5.kind === "unknown", "resolve: empty → unknown");
}
```

- [ ] **Step 2: Run** → import error.

- [ ] **Step 3: Implement** `src/lib/gmail/resolve.ts`

```ts
/**
 * #96 §1 — who a sender is. Pure over injected lookups so it's spec-testable;
 * bridge.ts and linking.ts supply the real ones (contact_emails / customer_domains).
 */
import { domainOf, isPublicDomain } from "./config";

export type Resolution =
  | { kind: "linked"; customerId: string; contactId?: string; via: "contact" | "domain" }
  | { kind: "ambiguous"; candidates: Array<{ customerId: string }> }
  | { kind: "unknown" };

export type ResolveLookups = {
  contactByEmail: (email: string) => Promise<{ contactId: string; customerId: string } | null>;
  customersByDomain: (domain: string) => Promise<string[]>;
};

export async function resolveSender(email: string, lookups: ResolveLookups): Promise<Resolution> {
  const e = (email || "").trim().toLowerCase();
  if (!e) return { kind: "unknown" };
  const hit = await lookups.contactByEmail(e);
  if (hit) return { kind: "linked", customerId: hit.customerId, contactId: hit.contactId, via: "contact" };
  const d = domainOf(e);
  if (!d || isPublicDomain(d)) return { kind: "unknown" };
  const owners = Array.from(new Set(await lookups.customersByDomain(d)));
  if (owners.length === 1) return { kind: "linked", customerId: owners[0], via: "domain" };
  if (owners.length > 1) return { kind: "ambiguous", candidates: owners.map((customerId) => ({ customerId })) };
  return { kind: "unknown" };
}
```

- [ ] **Step 4: Verify** 5 PASS + ALL PASSED; tsc clean.

- [ ] **Step 5: Commit**
```bash
git add src/lib/gmail/resolve.ts scripts/test-review-and-spec.ts
git commit -m "feat(inbox): pure sender resolver — contact, then domain, ambiguous never guesses (#96 §1)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Real lookups, thread fields, ingest-time stamping

**Files:**
- Create: `src/lib/identity/lookup.ts`
- Create: `src/lib/gmail/linking.ts` (resolver wiring; backfill/re-sweep come in Task 4)
- Modify: `src/lib/stores/comms.ts` (`CommThread` type ~line 230; `resolveCustomerId` ~line 1553)
- Modify: `src/lib/gmail/bridge.ts` (`recordMessage` new-thread record ~line 214)
- Test: `scripts/test-review-regressions.ts`

**Interfaces:**
- `lookup.ts`: `contactByEmail(email): Promise<{ contactId: string; customerId: string } | null>` — `contact_emails` join `contacts.homeCompanyId`.
- `linking.ts`: `resolveForThread(email): Promise<Resolution>` (real lookups), `applyResolution(t: CommThread, r: Resolution, customerName: (id) => Promise<string>): Promise<void>` — mutates the passed doc in place (used inside `patchDoc` callbacks and on the new-record literal).
- `CommThread` gains: `resolution?: "linked" | "suggested" | "ambiguous" | "unknown"`, `suggestedCustomerId?: string | null`, `candidates?: Array<{ customerId: string; name: string }>`, `resolvedContactId?: string | null`, `suggestionDismissed?: boolean`.

Note on "suggested" vs "linked (domain)": the spec's sidebar shows a domain match as **Suggested** until adopted. So a `via: "domain"` resolution stamps `resolution: "suggested"` + `suggestedCustomerId` and leaves `customerId` null; `via: "contact"` stamps `resolution: "linked"` + `customerId`. Manual link or "Link" on the suggestion promotes it.

- [ ] **Step 1: lookup.ts**

```ts
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { contactEmails, contacts } from "@/db/schema";

/** #96 — exact-address → contact + home company, via the indexed
 *  contact_emails table (never a customer-doc scan). */
export async function contactByEmail(
  email: string
): Promise<{ contactId: string; customerId: string } | null> {
  const e = (email || "").trim().toLowerCase();
  if (!e) return null;
  const db = await getDb();
  const rows = await db
    .select({ contactId: contactEmails.contactId, customerId: contacts.homeCompanyId })
    .from(contactEmails)
    .innerJoin(contacts, eq(contacts.id, contactEmails.contactId))
    .where(eq(contactEmails.email, e))
    .limit(5);
  const withCompany = rows.find((r) => !!r.customerId);
  return withCompany ? { contactId: withCompany.contactId, customerId: withCompany.customerId! } : null;
}
```
Check how `contact_emails.email` is stored (lowercase?) — `src/lib/identity/contacts.ts setEmails`. If it's stored as typed, change the where to `sql\`lower(${contactEmails.email}) = ${e}\`` (import `sql` from drizzle-orm).

- [ ] **Step 2: CommThread fields** — in `src/lib/stores/comms.ts` after `gmailInboxed?: boolean;`:

```ts
  /** #96 — how the sender was matched at ingest. `suggested` = a single
   *  domain owner exists but the thread hasn't adopted it yet. */
  resolution?: "linked" | "suggested" | "ambiguous" | "unknown";
  suggestedCustomerId?: string | null;
  candidates?: Array<{ customerId: string; name: string }>;
  resolvedContactId?: string | null;
  /** "Not them" on a suggestion — stop offering it for this thread. */
  suggestionDismissed?: boolean;
```

Replace the body of `resolveCustomerId` so it uses the index:

```ts
export async function resolveCustomerId(
  t: CommThread | null | undefined
): Promise<string | null> {
  if (!t) return null;
  if (t.customerId) return t.customerId;
  const email = (t.contactEmail || "").trim().toLowerCase();
  if (!email) return null;
  const { contactByEmail } = await import("@/lib/identity/lookup");
  return (await contactByEmail(email))?.customerId ?? null;
}
```

- [ ] **Step 3: linking.ts (part 1)**

```ts
/**
 * #96 — wires the pure resolver to real data and stamps threads. Backfill and
 * re-sweep live here too (Task 4).
 */
import { contactByEmail } from "@/lib/identity/lookup";
import { nameFor as customerNameFor } from "@/lib/stores/customers";
import type { CommThread } from "@/lib/stores/comms";
import { customersForDomain } from "./domains";
import { resolveSender, type Resolution } from "./resolve";

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
```

- [ ] **Step 4: bridge.ts — stamp on thread creation.** In `recordMessage`, the new-thread branch: after `const contactEmail = dir === "in" ? p.from.email : "";` add

```ts
  // #96: link on arrival. Outbound first-message threads resolve by the
  // recipient (the "to" header's first address).
  const senderForResolve = dir === "in" ? p.from.email : parseAddress(p.to.split(",")[0] || "").email;
  const resolution = await resolveForThread(senderForResolve);
```
and after the `const rec: CommThread = { … }` literal, before `insertDocIfAbsent`:
```ts
  await applyResolution(rec, resolution);
```
Import `parseAddress` from `./mime` (it's exported) and `applyResolution, resolveForThread` from `./linking`.

- [ ] **Step 5: Regression test** — in `scripts/test-review-regressions.ts` `main()`, append (imports at top: `import { contactByEmail } from "@/lib/identity/lookup"; import { saveContact, setEmails } from "@/lib/identity/contacts"; import { claimDomain, customersForDomain } from "@/lib/gmail/domains"; import { resolveForThread } from "@/lib/gmail/linking";`):

```ts
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
  await claimDomain("t96district.org", "lakefront", "manual", "test");
  await claimDomain("t96district.org", "other", "learned", "test"); // learned never overwrites
  assert.equal((await customersForDomain("t96district.org")).length, 1, "#96 learned claim doesn't add a second owner");
  const r2 = await resolveForThread("someone@t96district.org");
  assert.equal(r2.kind === "linked" && r2.via, "domain", "#96 domain claim resolves");
```
(`saveContact`'s exact parameter shape: check `src/lib/identity/contacts.ts:101` and match it.)

- [ ] **Step 6: Run** `npm run test:review:regressions 2>&1 | tail -5` → passes (no output besides the quote-email script's own summary). `npx tsc --noEmit -p . | tail -3` → empty.

- [ ] **Step 7: Commit**
```bash
git add src/lib/identity/lookup.ts src/lib/gmail/linking.ts src/lib/stores/comms.ts src/lib/gmail/bridge.ts scripts/test-review-regressions.ts
git commit -m "feat(inbox): resolve the sender on ingest and stamp resolution/suggestion on the thread (#96 §1)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Backfill + re-sweep

**Files:**
- Modify: `src/lib/gmail/linking.ts`
- Modify: `src/lib/gmail/bridge.ts` (`syncMailbox`)
- Test: `scripts/test-review-regressions.ts`

**Interfaces:**
- Produces: `resweepThreads(filter?: { email?: string; domain?: string }): Promise<number>` — re-resolves every thread whose `resolution !== "linked"` (or is undefined) and, when a filter is given, whose `contactEmail` matches the address / domain. Returns count changed. `backfillMailbox(key: MailboxKey): Promise<number>` = `resweepThreads()` restricted to `gmailAccountKey === key`.

- [ ] **Step 1: Add to linking.ts**

```ts
import { listDocs, patchDoc } from "@/db/doc-store";
import { domainOf } from "./config";

function matchesFilter(t: CommThread, f?: { email?: string; domain?: string }): boolean {
  if (!f) return true;
  const e = (t.contactEmail || "").toLowerCase();
  if (f.email && e !== f.email.toLowerCase()) return false;
  if (f.domain && domainOf(e) !== f.domain.toLowerCase()) return false;
  return true;
}

/** Re-run the resolver over unlinked threads. Idempotent; patches only when
 *  something changes. */
export async function resweepThreads(
  filter?: { email?: string; domain?: string },
  onlyAccountKey?: string
): Promise<number> {
  const all = await listDocs<CommThread>("comms");
  let changed = 0;
  for (const t of all) {
    if (t.deleted) continue;
    if (t.customerId && t.resolution === "linked") continue;
    if (onlyAccountKey && t.gmailAccountKey !== onlyAccountKey) continue;
    if (!matchesFilter(t, filter)) continue;
    if (!t.contactEmail) continue;
    const r = await resolveForThread(t.contactEmail);
    const before = JSON.stringify([t.customerId, t.resolution, t.suggestedCustomerId, t.candidates]);
    const next = { ...t };
    await applyResolution(next, r);
    const after = JSON.stringify([next.customerId, next.resolution, next.suggestedCustomerId, next.candidates]);
    if (before === after) continue;
    await patchDoc<CommThread>("comms", t.id, (d) => {
      d.customerId = next.customerId;
      d.customer = next.customer;
      d.resolvedContactId = next.resolvedContactId ?? null;
      d.resolution = next.resolution;
      d.suggestedCustomerId = next.suggestedCustomerId ?? null;
      d.candidates = next.candidates ?? [];
    });
    changed++;
  }
  return changed;
}

export async function backfillMailbox(key: string): Promise<number> {
  return resweepThreads(undefined, key);
}
```

- [ ] **Step 2: bridge.ts** — in `syncMailbox` after the status re-derive try/catch:

```ts
  try {
    flips += await backfillMailbox(key);
  } catch (err) {
    console.error("[gmail] link backfill failed for", key, err);
  }
```
Import `backfillMailbox` from `./linking`.

- [ ] **Step 3: Regression test** — append to `main()` (imports: `upsertDoc` already imported; `resweepThreads` from linking):

```ts
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
```

- [ ] **Step 4: Run** regressions → pass; tsc clean.

- [ ] **Step 5: Commit**
```bash
git add src/lib/gmail/linking.ts src/lib/gmail/bridge.ts scripts/test-review-regressions.ts
git commit -m "feat(inbox): backfill unlinked threads on sync and re-sweep on domain/address changes (#96 §1)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Server actions — link, claim domain, dismiss, remember address, quick-add

**Files:**
- Create: `src/app/(app)/inbox/link-actions.ts`
- Test: `scripts/test-review-regressions.ts` (through the store-level helpers, not the actions — actions need a session)

**Interfaces (all `"use server"`, all `requireUser()`):**
```ts
linkThreadToCustomerAction(threadId, customerId, opts: { remember: boolean; contactId?: string | null; claimDomain?: boolean })
  → { ok: true } | { ok: false; error: string }
claimDomainAction(domain, customerId) → same
dismissSuggestionAction(threadId) → same
quickAddCustomerAction({ name, type, senderName, senderEmail, remember }) → { ok: true; id } | { ok: false; error }
quickAddContactAction({ customerId, name, role, email, phone }) → { ok: true; id } | …
quickAddVenueAction({ customerId, label, city, state }) → { ok: true } | …
```
- Produces in `linking.ts`: `rememberAddress(customerId, email, displayName, contactId?: string | null, addedBy: string)` — if `contactId`, appends the email to that contact via `setEmails` (existing + new); else creates a contact on the customer (via `saveContact` + `setEmails`, split `displayName` on the last space). Then, if the domain is not public and unclaimed, `claimDomain(domain, customerId, "learned", addedBy)`; then `resweepThreads({ email })`.

- [ ] **Step 1: linking.ts — `rememberAddress` and `linkThread`**

```ts
import { emailsFor, saveContact, setEmails } from "@/lib/identity/contacts";
import { mintId } from "@/lib/identity/ids";
import { claimDomain, customersForDomain } from "./domains";
import { isPublicDomain } from "./config";

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
      homeCompanyId: customerId, title: "", pricingTier: null, status: "active",
      userId: null, ownerUserId: addedBy.id, isPrimary: false, createdAt: Date.now(),
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

/** Stamp a thread as linked to `customerId` (the sidebar's Link / pick). */
export async function linkThread(threadId: string, customerId: string, contactId?: string | null): Promise<void> {
  const name = await customerNameFor(customerId);
  await patchDoc<CommThread>("comms", threadId, (d) => {
    d.customerId = customerId;
    d.customer = name;
    d.resolvedContactId = contactId ?? d.resolvedContactId ?? null;
    d.resolution = "linked";
    d.suggestedCustomerId = null;
    d.candidates = [];
  });
}
```
(`saveContact`'s parameter type: match `src/lib/identity/contacts.ts:101`. `mintId` from `src/lib/identity/ids.ts`.)

- [ ] **Step 2: link-actions.ts**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { get as getThread } from "@/lib/stores/comms";
import { get as getCustomer, setLocations, locationsForId } from "@/lib/stores/customers";
import { saveCustomerAction } from "@/app/(app)/companies/actions";
import { savePersonAction } from "@/app/(app)/people/actions";
import { claimDomain } from "@/lib/gmail/domains";
import { domainOf, isPublicDomain } from "@/lib/gmail/config";
import { linkThread, rememberAddress, resweepThreads } from "@/lib/gmail/linking";
import { patchDoc } from "@/db/doc-store";
import type { CommThread } from "@/lib/stores/comms";

type R = { ok: true } | { ok: false; error: string };
const revalidate = () => revalidatePath("/", "layout");

export async function linkThreadToCustomerAction(
  threadId: string,
  customerId: string,
  opts: { remember: boolean; contactId?: string | null; claimDomain?: boolean }
): Promise<R> {
  const me = await requireUser();
  const t = await getThread(threadId);
  if (!t) return { ok: false, error: "Thread not found." };
  if (!(await getCustomer(customerId))) return { ok: false, error: "Customer not found." };
  let contactId = opts.contactId ?? null;
  if (opts.remember && t.contactEmail) {
    contactId = await rememberAddress(customerId, t.contactEmail, t.contactName, contactId, { id: me.id, name: me.name });
  }
  if (opts.claimDomain && t.contactEmail) {
    const d = domainOf(t.contactEmail);
    if (d && !isPublicDomain(d)) {
      await claimDomain(d, customerId, "manual", me.name);
      await resweepThreads({ domain: d });
    }
  }
  await linkThread(threadId, customerId, contactId);
  revalidate();
  return { ok: true };
}

export async function claimDomainAction(domain: string, customerId: string): Promise<R> {
  const me = await requireUser();
  const d = (domain || "").toLowerCase();
  if (!d || isPublicDomain(d)) return { ok: false, error: "That domain can't identify a customer." };
  if (!(await getCustomer(customerId))) return { ok: false, error: "Customer not found." };
  await claimDomain(d, customerId, "manual", me.name);
  await resweepThreads({ domain: d });
  revalidate();
  return { ok: true };
}

export async function dismissSuggestionAction(threadId: string): Promise<R> {
  await requireUser();
  await patchDoc<CommThread>("comms", threadId, (d) => {
    d.suggestionDismissed = true;
    if (d.resolution === "suggested") d.resolution = "unknown";
  });
  revalidate();
  return { ok: true };
}

export async function quickAddCustomerAction(input: {
  name: string; type: string; senderName: string; senderEmail: string; remember: boolean; threadId: string;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const me = await requireUser();
  const res = await saveCustomerAction({ name: input.name, type: input.type || "", locations: [], contacts: [] });
  if (!res.ok) return { ok: false, error: "Couldn't create that customer." };
  let contactId: string | null = null;
  if (input.remember && input.senderEmail) {
    contactId = await rememberAddress(res.id, input.senderEmail, input.senderName, null, { id: me.id, name: me.name });
  }
  await linkThread(input.threadId, res.id, contactId);
  revalidate();
  return { ok: true, id: res.id };
}

export async function quickAddContactAction(input: {
  customerId: string; name: string; role: string; email: string; phone: string;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  await requireUser();
  const nm = input.name.trim();
  const sp = nm.lastIndexOf(" ");
  const res = await savePersonAction({
    firstName: sp > 0 ? nm.slice(0, sp) : nm,
    lastName: sp > 0 ? nm.slice(sp + 1) : "",
    homeCompanyId: input.customerId,
    title: input.role || "",
    status: "active",
    emails: input.email ? [{ value: input.email.trim(), label: "work", isPrimary: true }] : [],
    phones: input.phone ? [{ value: input.phone.trim(), label: "work", isPrimary: true }] : [],
  } as Parameters<typeof savePersonAction>[0]);
  if (!res.ok) return res;
  if (input.email) await resweepThreads({ email: input.email });
  revalidate();
  return res;
}

export async function quickAddVenueAction(input: {
  customerId: string; label: string; city: string; state: string;
}): Promise<R> {
  await requireUser();
  const existing = await locationsForId(input.customerId);
  await setLocations(input.customerId, [
    ...existing,
    {
      id: "loc" + Date.now(), label: input.label.trim() || "Venue", primary: existing.length === 0,
      address: "", city: input.city.trim(), state: input.state.trim(), lat: null, lng: null,
      venueKind: "proscenium", travelMiles: null, travelMin: null,
    },
  ] as Parameters<typeof setLocations>[1]);
  revalidate();
  return { ok: true };
}
```
Match `SavePersonInput` (`src/app/(app)/people/types.ts`) and `setLocations`' element type (`src/lib/stores/customers.ts:731`) exactly; adjust field names to what those declare.

- [ ] **Step 3: Regression test for `rememberAddress` + `linkThread`** — append to `main()`:

```ts
  // #96 — remember address creates the contact, learns the domain, links the thread
  const { rememberAddress, linkThread } = await import("@/lib/gmail/linking");
  const cid = await rememberAddress("lakefront", "ap.clerk@t96learn.org", "AP Clerk", null, { id: "u1", name: "Test" });
  assert.ok(cid.startsWith("ct-"), "#96 rememberAddress mints a contact");
  assert.equal((await customersForDomain("t96learn.org"))[0]?.source, "learned", "#96 unclaimed domain is learned");
  await linkThread("C-t96", "lakefront", cid);
  const linked = await getDoc<any>("comms", "C-t96");
  assert.equal(linked?.resolution, "linked", "#96 linkThread stamps linked");
```

- [ ] **Step 4: Run** regressions → pass; tsc clean.

- [ ] **Step 5: Commit**
```bash
git add "src/app/(app)/inbox/link-actions.ts" src/lib/gmail/linking.ts scripts/test-review-regressions.ts
git commit -m "feat(inbox): link/claim/dismiss/remember/quick-add server actions for the link sidebar (#96 §2)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Extract `EntityQuickAdd` from the quote intake

**Files:**
- Create: `src/components/entity-quick-add.tsx`
- Modify: `src/app/(app)/quotes/new/intake-form.tsx` (replace its three inline "new" forms with the component)

**Interfaces:**
```tsx
export type QuickAddKind = "customer" | "contact" | "venue";
export type QuickAddValues = {
  customer: { name: string; type: string };
  contact: { name: string; role: string; email: string; phone: string };
  venue: { label: string; city: string; state: string };
};
export default function EntityQuickAdd<K extends QuickAddKind>(props: {
  kind: K;
  value: QuickAddValues[K];
  onChange: (v: QuickAddValues[K]) => void;
  onCancel?: () => void;
  /** optional submit row — the quote intake omits it (submits with the form); the sidebar uses it */
  onSubmit?: () => void;
  submitting?: boolean;
  error?: string | null;
}): JSX.Element;
```
The component is **presentational only** — fields + optional submit/cancel row, using the `INPUT`, label and hint styles currently inlined in `intake-form.tsx` (move those style constants into the new file and export them: `export const INPUT`, `export const LABEL`). Customer type options come from the same list the intake uses (`CUSTOMER_TYPES` — find its source in intake-form.tsx and import from there or `src/lib/stores/customers.ts`).

- [ ] **Step 1: Read `intake-form.tsx` lines 240–380** and copy the three inline blocks (`customerMode === "new"`, `locationMode === "new"`, `contactMode === "new"`) into the component as `kind`-switched JSX, replacing the individual `useState` setters with `onChange({ ...value, field })`.

- [ ] **Step 2: Refactor intake-form.tsx** to hold `newCustomer: QuickAddValues["customer"]`, `newLocation: QuickAddValues["venue"]`, `newContact: QuickAddValues["contact"]` state objects and render `<EntityQuickAdd kind="…" value=… onChange=… />` in the three places. Build the `payload` for `createQuoteIntakeAction` from those objects with the same keys it uses today (`newCustomerName`, `newCustomerType`, `newLocationLabel`, `newLocationCity`, `newLocationState`, `newContactName`, `newContactRole`, `newContactEmail`, `newContactPhone`) so `actions.ts` is untouched.

- [ ] **Step 3: Verify no behaviour change**: `npx tsc --noEmit -p . | tail -3` → empty; `npm run test:smoke 2>&1 | grep -E 'quotes/new|ALL PASSED'` → `/quotes/new` 200 + ALL PASSED. Then run the dev server via `preview_start` and, on `/quotes/new`, pick "+ Add new customer…" and confirm the same three fields render.

- [ ] **Step 4: Commit**
```bash
git add src/components/entity-quick-add.tsx "src/app/(app)/quotes/new/intake-form.tsx"
git commit -m "refactor(quotes): extract EntityQuickAdd from the guided intake so the Inbox sidebar can share it (#96 §2)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Link sidebar in the reader

**Files:**
- Create: `src/app/(app)/inbox/link-sidebar.tsx`
- Modify: `src/app/(app)/inbox/types.ts` (`ReaderVM`)
- Modify: `src/app/(app)/inbox/page.tsx` (~lines 600–660, reader VM build; add customer picker options)
- Modify: `src/app/(app)/inbox/thread-reader.tsx` (render the sidebar; move the "+ Link to work" block into it)
- Modify: `src/app/(app)/inbox/inbox-shell.tsx:942` (reader pane becomes a two-column flex: reader `flex: 1`, sidebar `width: 300`)

**Interfaces — `ReaderVM` additions:**
```ts
  resolution: "linked" | "suggested" | "ambiguous" | "unknown";
  senderDomain: string;          // "" for public webmail / no email
  senderIsPublicDomain: boolean;
  suggested: { customerId: string; name: string; contactsAtDomain: number } | null;
  candidates: Array<{ customerId: string; name: string }>;
  customerCard: { id: string; name: string; tier: string; openQuotes: number; openProjects: number; contactName: string } | null;
  customerOptions: Opt[];        // every customer, for the pickers
  contactOptions: Opt[];         // contacts of the linked/suggested customer (value = contactId)
```

- [ ] **Step 1: page.tsx — compute the fields.** Where `resolvedCid` is computed, add:

```ts
    const resolution = sel.resolution ?? (sel.customerId ? "linked" : resolvedCid ? "linked" : "unknown");
    const senderDomain = domainOf(sel.contactEmail || "");
    const senderIsPublicDomain = !senderDomain || isPublicDomain(senderDomain);
    const suggestedId = sel.suggestedCustomerId || null;
    const suggestedCustomer = suggestedId ? customers.find((c) => c.id === suggestedId) : null;
    const contactsAtDomain = suggestedCustomer
      ? (suggestedCustomer.contacts || []).filter((ct) => domainOf(ct.email || "") === senderDomain).length
      : 0;
    const linkedCustomer = (sel.customerId || resolvedCid)
      ? customers.find((c) => c.id === (sel.customerId || resolvedCid))
      : null;
```
and in the VM literal:
```ts
      resolution,
      senderDomain,
      senderIsPublicDomain,
      suggested: suggestedCustomer ? { customerId: suggestedCustomer.id, name: suggestedCustomer.name, contactsAtDomain } : null,
      candidates: sel.candidates || [],
      customerCard: linkedCustomer
        ? {
            id: linkedCustomer.id, name: linkedCustomer.name, tier: linkedCustomer.pricingTier || "Base",
            openQuotes: quotes.filter((q) => q.customerId === linkedCustomer.id && q.status !== "closed").length,
            openProjects: projects.filter((p) => p.customerId === linkedCustomer.id && p.stage !== "complete").length,
            contactName: (linkedCustomer.contacts || []).find((ct) => (ct.email || "").toLowerCase() === (sel.contactEmail || "").toLowerCase())?.name || "",
          }
        : null,
      customerOptions: customers.map((c) => ({ value: c.id, label: c.name })),
      contactOptions: ((linkedCustomer || suggestedCustomer)?.contacts || []).map((ct) => ({ value: ct.id || ct.name, label: ct.name })),
```
`quotes` and `projects` are already loaded on this page for `linkOptions` — reuse those arrays; check their status/stage field names against `src/lib/stores/quotes.ts` and `projects.ts` (`ORDER_STAGES`) and use the real "open" predicates from those modules if they export one.

- [ ] **Step 2: link-sidebar.tsx** — client component:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import EntityQuickAdd, { INPUT, type QuickAddValues } from "@/components/entity-quick-add";
import type { ReaderVM } from "./types";
import {
  claimDomainAction, dismissSuggestionAction, linkThreadToCustomerAction,
  quickAddContactAction, quickAddCustomerAction, quickAddVenueAction,
} from "./link-actions";

const CARD: React.CSSProperties = { border: "1px solid #e4e7ec", borderRadius: 10, padding: "12px 13px", background: "#fff" };
const H: React.CSSProperties = { fontSize: 10.5, fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase", color: "#aab0bb", marginBottom: 8 };
const BTN: React.CSSProperties = { fontFamily: "var(--font-ui)", fontSize: 12.5, borderRadius: 8, padding: "7px 11px", cursor: "pointer", border: "1px solid #e4e7ec", background: "#fff" };
const PRIMARY: React.CSSProperties = { ...BTN, background: "var(--accent)", color: "#fff", border: "1px solid transparent" };

export default function LinkSidebar({ vm, children }: { vm: ReaderVM; children?: React.ReactNode }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<"customer" | "contact" | "venue" | null>(null);
  const [changing, setChanging] = useState(false); // "Wrong customer?" re-pick
  const [pickId, setPickId] = useState("");
  const [remember, setRemember] = useState(true);
  const [newCustomer, setNewCustomer] = useState<QuickAddValues["customer"]>({ name: "", type: "" });
  const [newContact, setNewContact] = useState<QuickAddValues["contact"]>({ name: vm.contactName, role: "", email: vm.contactEmail, phone: "" });
  const [newVenue, setNewVenue] = useState<QuickAddValues["venue"]>({ label: "", city: "", state: "" });

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (!r.ok) setError(r.error || "Something went wrong.");
      else { setAdding(null); router.refresh(); }
    });

  const linkTo = (customerId: string, claim: boolean) =>
    run(() => linkThreadToCustomerAction(vm.id, customerId, { remember, claimDomain: claim }));

  return (
    <aside style={{ width: 300, flexShrink: 0, borderLeft: "1px solid #ececf0", padding: 14, overflowY: "auto", background: "#fafbfc", display: "flex", flexDirection: "column", gap: 12 }}>
      {/* ---- state card ---- */}
      {vm.resolution === "linked" && vm.customerCard && (
        <div style={CARD}>
          <div style={H}>Customer</div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{vm.customerCard.name}</div>
          <div style={{ fontSize: 11.5, color: "#8c919c", marginTop: 3 }}>
            {vm.customerCard.tier} tier · {vm.customerCard.openQuotes} open quotes · {vm.customerCard.openProjects} open projects
          </div>
          {vm.customerCard.contactName && (
            <div style={{ fontSize: 12, marginTop: 8 }}>Contact: <b>{vm.customerCard.contactName}</b></div>
          )}
          <button style={{ ...BTN, marginTop: 10 }} onClick={() => setChanging((v) => !v)}>Wrong customer?</button>
          {changing && (
            <select value={pickId} onChange={(e) => { setPickId(e.target.value); if (e.target.value) linkTo(e.target.value, false); }} style={{ ...INPUT, marginTop: 8 }}>
              <option value="">Re-link to…</option>
              {vm.customerOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          )}
          {children /* the existing Link-to-work picker, moved here by Task 7 step 3 */}
        </div>
      )}

      {vm.resolution === "suggested" && vm.suggested && (
        <div style={CARD}>
          <div style={H}>Looks like</div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{vm.suggested.name}</div>
          <div style={{ fontSize: 11.5, color: "#8c919c", marginTop: 3 }}>
            {vm.suggested.contactsAtDomain} contact{vm.suggested.contactsAtDomain === 1 ? "" : "s"} at @{vm.senderDomain}
          </div>
          <label style={{ display: "flex", gap: 6, fontSize: 12, marginTop: 10, alignItems: "center" }}>
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            Remember {vm.contactEmail} on a contact
          </label>
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button style={PRIMARY} disabled={pending} onClick={() => linkTo(vm.suggested!.customerId, false)}>Link</button>
            <button style={BTN} disabled={pending} onClick={() => run(() => dismissSuggestionAction(vm.id))}>Not them</button>
          </div>
        </div>
      )}

      {vm.resolution === "ambiguous" && (
        <div style={CARD}>
          <div style={H}>Which customer?</div>
          <div style={{ fontSize: 11.5, color: "#8c919c" }}>@{vm.senderDomain} is shared by {vm.candidates.length} customers.</div>
          {vm.candidates.map((c) => (
            <div key={c.customerId} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
              <span style={{ fontSize: 13 }}>{c.name}</span>
              <span style={{ display: "flex", gap: 6 }}>
                <button style={BTN} disabled={pending} onClick={() => linkTo(c.customerId, false)}>This thread</button>
                <button style={BTN} disabled={pending} onClick={() => linkTo(c.customerId, true)}>Always</button>
              </span>
            </div>
          ))}
        </div>
      )}

      {vm.resolution === "unknown" && (
        <div style={CARD}>
          <div style={H}>Not linked</div>
          {!vm.senderIsPublicDomain ? (
            <div style={{ fontSize: 12.5, lineHeight: 1.5 }}>
              <span style={{ fontFamily: "var(--font-mono)" }}>@{vm.senderDomain}</span> isn’t linked to a customer yet. Link this domain to…
            </div>
          ) : (
            <div style={{ fontSize: 12.5, lineHeight: 1.5 }}>
              Personal address — link this thread to a customer and remember <span style={{ fontFamily: "var(--font-mono)" }}>{vm.contactEmail}</span> on a contact.
            </div>
          )}
          <select value={pickId} onChange={(e) => setPickId(e.target.value)} style={{ ...INPUT, marginTop: 10 }}>
            <option value="">Pick a customer…</option>
            {vm.customerOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            <option value="__new">+ New customer…</option>
          </select>
          {pickId && pickId !== "__new" && (
            <label style={{ display: "flex", gap: 6, fontSize: 12, marginTop: 8, alignItems: "center" }}>
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              Remember this address
            </label>
          )}
          {pickId && pickId !== "__new" && (
            <button style={{ ...PRIMARY, marginTop: 10 }} disabled={pending} onClick={() => linkTo(pickId, !vm.senderIsPublicDomain)}>
              {vm.senderIsPublicDomain ? "Link thread" : "Link domain + thread"}
            </button>
          )}
          {pickId === "__new" && (
            <div style={{ marginTop: 10 }}>
              <EntityQuickAdd kind="customer" value={newCustomer} onChange={setNewCustomer} submitting={pending} error={error}
                onCancel={() => setPickId("")}
                onSubmit={() => run(() => quickAddCustomerAction({ ...newCustomer, senderName: vm.contactName, senderEmail: vm.contactEmail, remember, threadId: vm.id }))} />
            </div>
          )}
        </div>
      )}

      {/* ---- quick add ---- */}
      {(vm.resolution === "linked" || vm.resolution === "suggested") && (
        <div style={CARD}>
          <div style={H}>Quick add</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button style={BTN} onClick={() => setAdding("contact")}>+ Contact</button>
            <button style={BTN} onClick={() => setAdding("venue")}>+ Venue</button>
          </div>
          {adding === "contact" && (
            <div style={{ marginTop: 10 }}>
              <EntityQuickAdd kind="contact" value={newContact} onChange={setNewContact} submitting={pending} error={error}
                onCancel={() => setAdding(null)}
                onSubmit={() => run(() => quickAddContactAction({ customerId: (vm.customerCard?.id || vm.suggested?.customerId)!, ...newContact }))} />
            </div>
          )}
          {adding === "venue" && (
            <div style={{ marginTop: 10 }}>
              <EntityQuickAdd kind="venue" value={newVenue} onChange={setNewVenue} submitting={pending} error={error}
                onCancel={() => setAdding(null)}
                onSubmit={() => run(() => quickAddVenueAction({ customerId: (vm.customerCard?.id || vm.suggested?.customerId)!, ...newVenue }))} />
            </div>
          )}
        </div>
      )}

      {error && !adding && <div style={{ fontSize: 12, color: "#b4543a" }}>{error}</div>}
    </aside>
  );
}
```

- [ ] **Step 3: thread-reader.tsx** — wrap the reader body: the existing outer `<div>` that the shell places in `.ib-pane` becomes `display: flex`, with the current content in `flex: 1; min-width: 0` and `<LinkSidebar vm={vm}>…</LinkSidebar>` as a sibling. Move the whole `+ Link to work` block (the `linkPickerOpen` button + picker, ~lines 700–860) into the `children` slot of `LinkSidebar` (it stays in thread-reader.tsx as JSX passed down, so its state hooks are untouched). Delete the yellow "isn't linked to a client yet" notice — the sidebar's Unknown card replaces it.

- [ ] **Step 4: inbox-shell.tsx** — no change if the reader owns its own flex row; if the reader pane clips at 300px, set the `.ib-pane` reader container to `minWidth: 640`.

- [ ] **Step 5: Verify in the browser** (`preview_start` the dev server; open `/inbox`, select threads with each resolution — seed data has customers with contact emails so at least `linked` and `unknown` appear). Check: sidebar renders per state; Link on an unknown domain claims it and the list re-renders; quick-add contact appears on the customer record. `npx tsc --noEmit -p . | tail -3` → empty. `npm run test:smoke | tail -2` → ALL PASSED.

- [ ] **Step 6: Commit**
```bash
git add "src/app/(app)/inbox/link-sidebar.tsx" "src/app/(app)/inbox/types.ts" "src/app/(app)/inbox/page.tsx" "src/app/(app)/inbox/thread-reader.tsx" "src/app/(app)/inbox/inbox-shell.tsx"
git commit -m "feat(inbox): link sidebar — suggestions, domain claims, ambiguity picks, quick-add (#96 §2)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Unmatched view

**Files:**
- Modify: `src/app/(app)/inbox/page.tsx` (`views` array ~line 358; `view === "…"` branches ~lines 464–500; the filter that builds `threads` for a view)
- Modify: `src/app/(app)/inbox/inbox-shell.tsx:54,537` (view option + router push)
- Modify: `scripts/smoke-routes.ts` (add `/inbox?view=unmatched`)

- [ ] **Step 1: page.tsx** — add to `views`:

```ts
      {
        key: "unmatched",
        label: "Unmatched",
        active: view === "unmatched",
        count: unmatchedCnt,
        badge: "plain",
        href: viewHref("unmatched"),
        icon: "needs",
      },
```
with `const unmatchedCnt = all.filter((t) => !t.deleted && !t.customerId && (t.resolution === "unknown" || t.resolution === "ambiguous" || t.resolution === "suggested")).length;` computed next to `needsCount`. Add the list branch:
```ts
  } else if (view === "unmatched") {
    listTitle = "Unmatched";
    listSub = "Email not yet linked to a customer — link it once and the rest follows";
```
and in the thread filter for views, `view === "unmatched"` → the same predicate as `unmatchedCnt`. Add `"unmatched"` to `emptyKind` handling with copy "Everything is linked."

- [ ] **Step 2: inbox-shell.tsx** — add `{ value: "unmatched", label: "Unmatched" }` to the view options at line 54 and include it in the `router.push` condition at line 537.

- [ ] **Step 3: smoke** — add `"/inbox?view=unmatched",` next to `"/inbox",` in `scripts/smoke-routes.ts`.

- [ ] **Step 4: Verify** `npm run test:smoke | grep -E 'unmatched|ALL PASSED'` → 200 + ALL PASSED. tsc clean.

- [ ] **Step 5: Commit**
```bash
git add "src/app/(app)/inbox/page.tsx" "src/app/(app)/inbox/inbox-shell.tsx" scripts/smoke-routes.ts
git commit -m "feat(inbox): Unmatched view for threads with no customer link (#96 §5)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

**Wave A checkpoint:** run the full gate (`tsc`, `eslint`, `test:specs`, `test:review:regressions`, `test:smoke` — one at a time), push, and let production sync once. Log **D140** in DECISIONS.md (resolver precedence, suggested-vs-linked distinction, learned-domain rule) before starting Wave B.

---

## Wave B — two-way `Peak/*` labels

### Task 9: Pure label vocabulary

**Files:**
- Create: `src/lib/gmail/peak-labels.ts`
- Test: `scripts/test-review-and-spec.ts`

**Interfaces:**
```ts
export const PEAK_PREFIX = "Peak/";
export type PeakCommand =
  | { kind: "customer"; name: string }
  | { kind: "status"; status: "waiting_us" | "waiting_them" | "closed" }
  | { kind: "assign"; firstName: string }
  | { kind: "newLead" }
  | { kind: "work"; type: "project" | "lead" | "quote"; id: string };
export function parsePeakLabel(name: string): PeakCommand | null;
export function labelForStatus(status: string): string | null;         // "Peak/Status/Needs reply" | …
export function desiredPeakLabels(t: Pick<CommThread,"customer"|"status"|"assignedTo"|"link">): string[];
export function diffLabels(desired: string[], current: string[]): { add: string[]; remove: string[] }; // only Peak/* names in `current` are considered for removal
```

- [ ] **Step 1: Failing tests** (synchronous section; `import { parsePeakLabel, desiredPeakLabels, diffLabels, labelForStatus } from "@/lib/gmail/peak-labels";`)

```ts
/* ---- #96 §3 — Peak/* label vocabulary ---- */
ok(JSON.stringify(parsePeakLabel("Peak/Customers/Lakefront ISD")) === JSON.stringify({ kind: "customer", name: "Lakefront ISD" }), "parse customer label");
ok(parsePeakLabel("Peak/Status/Needs reply")?.kind === "status", "parse status label");
ok(JSON.stringify(parsePeakLabel("Peak/Assign/Nic")) === JSON.stringify({ kind: "assign", firstName: "Nic" }), "parse assign label");
ok(parsePeakLabel("Peak/New lead")?.kind === "newLead", "parse new-lead label");
ok(JSON.stringify(parsePeakLabel("Peak/Projects/P-3001")) === JSON.stringify({ kind: "work", type: "project", id: "P-3001" }), "parse project label");
ok(parsePeakLabel("Follow up") === null && parsePeakLabel("Peak/Nonsense/x") === null, "non-Peak / unknown → null");
ok(labelForStatus("waiting_us") === "Peak/Status/Needs reply" && labelForStatus("replied") === null, "status → label");
const want = desiredPeakLabels({ customer: "Lakefront ISD", status: "waiting_them", assignedTo: "Nic Trapani", link: { type: "project", id: "P-3001" } });
ok(want.includes("Peak/Customers/Lakefront ISD") && want.includes("Peak/Status/Waiting") && want.includes("Peak/Assign/Nic") && want.includes("Peak/Projects/P-3001") && want.length === 4, "desired set");
const d = diffLabels(want, ["INBOX", "Peak/Status/Needs reply", "Peak/Customers/Lakefront ISD", "Follow up"]);
ok(d.add.length === 3 && d.remove.length === 1 && d.remove[0] === "Peak/Status/Needs reply", "diff adds missing, removes only stale Peak/* labels");
```

- [ ] **Step 2: Run** → import error.

- [ ] **Step 3: Implement**

```ts
/**
 * #96 §3 — the app-owned Gmail label namespace. Pure: names in, commands out.
 * Everything under Peak/ is ours; nothing else is ever read or written.
 */
import type { CommThread } from "@/lib/stores/comms";

export const PEAK_PREFIX = "Peak/";
const STATUS_LABEL: Record<string, string> = {
  waiting_us: "Peak/Status/Needs reply",
  waiting_them: "Peak/Status/Waiting",
  closed: "Peak/Status/Done",
};
const LABEL_STATUS: Record<string, "waiting_us" | "waiting_them" | "closed"> = {
  "Peak/Status/Needs reply": "waiting_us",
  "Peak/Status/Waiting": "waiting_them",
  "Peak/Status/Done": "closed",
};
const WORK_FOLDER: Record<string, "project" | "lead" | "quote"> = { Projects: "project", Leads: "lead", Quotes: "quote" };
const FOLDER_FOR_WORK: Record<string, string> = { project: "Projects", lead: "Leads", quote: "Quotes" };

export type PeakCommand =
  | { kind: "customer"; name: string }
  | { kind: "status"; status: "waiting_us" | "waiting_them" | "closed" }
  | { kind: "assign"; firstName: string }
  | { kind: "newLead" }
  | { kind: "work"; type: "project" | "lead" | "quote"; id: string };

export function parsePeakLabel(name: string): PeakCommand | null {
  if (!name.startsWith(PEAK_PREFIX)) return null;
  if (name === "Peak/New lead") return { kind: "newLead" };
  if (LABEL_STATUS[name]) return { kind: "status", status: LABEL_STATUS[name] };
  const rest = name.slice(PEAK_PREFIX.length);
  const slash = rest.indexOf("/");
  if (slash < 0) return null;
  const folder = rest.slice(0, slash);
  const leaf = rest.slice(slash + 1).trim();
  if (!leaf) return null;
  if (folder === "Customers") return { kind: "customer", name: leaf };
  if (folder === "Assign") return { kind: "assign", firstName: leaf };
  if (WORK_FOLDER[folder]) return { kind: "work", type: WORK_FOLDER[folder], id: leaf };
  return null;
}

export function labelForStatus(status: string): string | null {
  return STATUS_LABEL[status] || null;
}

export function desiredPeakLabels(
  t: Pick<CommThread, "customer" | "status" | "assignedTo" | "link">
): string[] {
  const out: string[] = [];
  if (t.customer) out.push("Peak/Customers/" + t.customer.replace(/\//g, "-"));
  const s = labelForStatus(t.status);
  if (s) out.push(s);
  if (t.assignedTo) out.push("Peak/Assign/" + t.assignedTo.split(" ")[0]);
  if (t.link && FOLDER_FOR_WORK[t.link.type]) out.push("Peak/" + FOLDER_FOR_WORK[t.link.type] + "/" + t.link.id);
  return out;
}

export function diffLabels(desired: string[], current: string[]): { add: string[]; remove: string[] } {
  const want = new Set(desired);
  const have = new Set(current);
  return {
    add: desired.filter((n) => !have.has(n)),
    remove: current.filter((n) => n.startsWith(PEAK_PREFIX) && !want.has(n)),
  };
}
```

- [ ] **Step 4: Verify** 9 PASS + ALL PASSED; tsc clean.

- [ ] **Step 5: Commit**
```bash
git add src/lib/gmail/peak-labels.ts scripts/test-review-and-spec.ts
git commit -m "feat(inbox): pure Peak/* label vocabulary — parse, desired set, diff (#96 §3)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: Lazy label creation + Peak → Gmail writer

**Files:**
- Modify: `src/lib/gmail/api.ts` (add `createLabel`, `modifyMessage`)
- Create: `src/lib/gmail/label-sync.ts`
- Modify: `src/lib/gmail/bridge.ts` (export a hook the store can call; call `syncPeakLabels` after `applyResolution` links a new thread)
- Modify: `src/app/(app)/inbox/actions.ts` (`setStatusAction`, `assignAction`, `setLinkAction`) and `src/app/(app)/inbox/link-actions.ts` (after every link) — fire-and-forget `syncPeakLabels(threadId)`
- Modify: `src/lib/stores/comms.ts` (`CommThread` gains `peakLabelsAppliedAt?: number`)

**Interfaces:**
- `api.ts`: `createLabel(mailboxKey, name): Promise<{ id: string; name: string }>` (POST `/labels` `{ name, labelListVisibility: "labelShow", messageListVisibility: "show" }`), `modifyMessage(mailboxKey, messageId, change)` (POST `/messages/{id}/modify`).
- `label-sync.ts`: `ensureLabelId(key, name): Promise<string>` (cache via `listCachedLabels`; on miss → `createLabel` then `replaceLabels(key, await listLabels(key))`), `syncPeakLabels(threadId): Promise<void>` — loads the thread, skips unless `gmailEnabled()` and `gmailThreadId` and `gmailAccountKey`, and that connection's scope includes `GMAIL_MODIFY_SCOPE`; computes `desiredPeakLabels`, resolves current Peak/* names from the newest message's `gmailLabelIds` via the label cache, `diffLabels`, one `modifyThread` call, then patches the thread's messages' `gmailLabelIds` to the new set and stamps `peakLabelsAppliedAt = Date.now()`. Errors are logged, never thrown.

- [ ] **Step 1: api.ts additions**

```ts
/** #96 §3 — create a user label (nesting on "/"). Returns Gmail's id. */
export async function createLabel(
  mailboxKey: string,
  name: string
): Promise<{ id: string; name: string }> {
  return gapi(mailboxKey, "/labels", {
    method: "POST",
    body: JSON.stringify({ name, labelListVisibility: "labelShow", messageListVisibility: "show" }),
  });
}
```

- [ ] **Step 2: label-sync.ts**

```ts
/**
 * #96 §3 — Peak → Gmail. Mirrors a thread's link/status/assign/work-link as
 * Peak/* labels on its Gmail thread. Never blocks the Peak write: every
 * failure is logged and the next sync pass reconciles.
 */
import { getDoc, patchDoc } from "@/db/doc-store";
import type { CommThread } from "@/lib/stores/comms";
import { GMAIL_MODIFY_SCOPE, gmailEnabled } from "./config";
import { createLabel, listLabels, modifyThread } from "./api";
import { getConnectionInfo, listCachedLabels, replaceLabels } from "./connections";
import { desiredPeakLabels, diffLabels, PEAK_PREFIX } from "./peak-labels";

export async function ensureLabelId(key: string, name: string): Promise<string> {
  const cached = (await listCachedLabels(key)).find((l) => l.name === name);
  if (cached) return cached.labelId;
  const created = await createLabel(key, name);
  await replaceLabels(key, await listLabels(key));
  return created.id;
}

export async function syncPeakLabels(threadId: string): Promise<void> {
  if (!gmailEnabled()) return;
  try {
    const t = await getDoc<CommThread>("comms", threadId);
    if (!t || !t.gmailThreadId || !t.gmailAccountKey) return;
    const key = t.gmailAccountKey;
    const conn = await getConnectionInfo(key);
    if (!conn || !(conn.scope || "").includes(GMAIL_MODIFY_SCOPE)) return;
    const cache = await listCachedLabels(key);
    const idToName = new Map(cache.map((l) => [l.labelId, l.name]));
    const newest = [...(t.messages || [])].sort((a, b) => (b.at || 0) - (a.at || 0))[0];
    const currentNames = (newest?.gmailLabelIds || []).map((id) => idToName.get(id) || id);
    const { add, remove } = diffLabels(desiredPeakLabels(t), currentNames);
    if (!add.length && !remove.length) return;
    const addIds = await Promise.all(add.map((n) => ensureLabelId(key, n)));
    const nameToId = new Map((await listCachedLabels(key)).map((l) => [l.name, l.labelId]));
    const removeIds = remove.map((n) => nameToId.get(n)).filter((x): x is string => !!x);
    await modifyThread(key, t.gmailThreadId, { addLabelIds: addIds, removeLabelIds: removeIds });
    await patchDoc<CommThread>("comms", t.id, (d) => {
      const keep = (ids: string[] | undefined) =>
        Array.from(new Set([...(ids || []).filter((id) => !removeIds.includes(id)), ...addIds]));
      d.messages = (d.messages || []).map((m) => ({ ...m, gmailLabelIds: keep(m.gmailLabelIds) }));
      d.peakLabelsAppliedAt = Date.now();
    });
  } catch (err) {
    console.error("[gmail] peak label sync failed for", threadId, err);
  }
}

export { PEAK_PREFIX };
```
Check `getConnectionInfo`'s return includes `scope` (it's read in settings/page.tsx as `c.scope`, so yes).

- [ ] **Step 3: Hook the writers.** In `src/app/(app)/inbox/actions.ts` add `import { syncPeakLabels } from "@/lib/gmail/label-sync";` and after the store call in `setStatusAction`, `assignAction`, `setLinkAction`, add `void syncPeakLabels(id);`. In `link-actions.ts`, after each `linkThread(...)` add `void syncPeakLabels(threadId)` (and `input.threadId` in quick-add-customer). In `linking.ts` `resweepThreads`, after a patch that sets `resolution === "linked"`, `void syncPeakLabels(t.id)` — import lazily (`const { syncPeakLabels } = await import("./label-sync")`) to avoid a bridge↔label-sync import cycle. In `bridge.ts` `recordMessage`, after a successful `insertDocIfAbsent` when `rec.resolution === "linked"`, `void syncPeakLabels(id)`.

- [ ] **Step 4: Verify** tsc clean; `npm run test:specs | tail -1` ALL PASSED. Manual: with the dev server + a connected mailbox (production only — dev has no Gmail), skip; the regression harness can't reach Gmail. Verify on production after push: change a thread's status in Peak → within a minute Gmail shows `Peak/Status/…` on that thread.

- [ ] **Step 5: Commit**
```bash
git add src/lib/gmail/api.ts src/lib/gmail/label-sync.ts src/lib/gmail/bridge.ts src/lib/gmail/linking.ts src/lib/stores/comms.ts "src/app/(app)/inbox/actions.ts" "src/app/(app)/inbox/link-actions.ts"
git commit -m "feat(inbox): write Peak/* labels to Gmail on link, status, assign and work-link changes (#96 §3)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11: Gmail → Peak interpreter

**Files:**
- Modify: `src/lib/gmail/api.ts` (`listHistory` requests label events too and returns them)
- Create: `src/lib/gmail/label-interpret.ts`
- Modify: `src/lib/gmail/bridge.ts` (`syncMailboxMessages` feeds label events to the interpreter)
- Test: `scripts/test-review-and-spec.ts` (pure `planLabelCommands`) + `scripts/test-review-regressions.ts` (New-lead swap)

**Interfaces:**
- `api.ts` `listHistory` returns additionally `labelEvents: Array<{ messageId: string; threadId: string; added: string[]; removed: string[]; at?: number }>` (label ids). Request `historyTypes=messageAdded&historyTypes=labelAdded&historyTypes=labelRemoved`; parse `labelsAdded[]` / `labelsRemoved[]` records (`{ message: { id, threadId }, labelIds: [] }`).
- `label-interpret.ts`:
  - pure `planLabelCommands(addedNames: string[]): PeakCommand[]` (parse, drop nulls, last status/assign/customer wins).
  - `interpretLabelEvents(key: MailboxKey, events): Promise<number>` — for each event: map label ids → names via cache; ignore if `t.peakLabelsAppliedAt` is within 2 min of now **and** every added name is in `desiredPeakLabels(t)` (that's our own echo); otherwise apply commands through the store: `customer` → find customer by name (`byName`) → `linkThread` + `rememberAddress`; `status` → `setStatus`; `assign` → `assign` with the roster member whose first name matches (`activeUsers`); `work` → `setLink({ type, id })`; `newLead` → `leads.create({ org: t.customer, contact: t.contactName, email: t.contactEmail, source: "manual", message: t.subject, customerId: t.customerId })`, then `setLink({type:"lead", id})` and `modifyThread` to remove `Peak/New lead` + add `Peak/Leads/<id>`. Removal events for status/assign labels are ignored (the app re-asserts on next write); removal of a customer label clears `customerId` only if the label matched the current customer.

- [ ] **Step 1: Failing pure test** (synchronous; `import { planLabelCommands } from "@/lib/gmail/label-interpret";`):

```ts
/* ---- #96 §3 — Gmail → Peak command planning ---- */
const plan = planLabelCommands(["INBOX", "Peak/Status/Waiting", "Peak/Status/Done", "Peak/Assign/Nic", "Peak/New lead", "Follow up"]);
ok(plan.filter((c) => c.kind === "status").length === 1 && (plan.find((c) => c.kind === "status") as any).status === "closed", "plan: last status wins");
ok(plan.some((c) => c.kind === "assign") && plan.some((c) => c.kind === "newLead") && plan.length === 3, "plan: ignores non-Peak labels");
```

- [ ] **Step 2: api.ts** — replace `listHistory`:

```ts
export type GmailLabelEvent = { messageId: string; threadId: string; added: string[]; removed: string[] };
export type GmailHistoryRecord = {
  messagesAdded?: GmailHistoryMessageAdded[];
  labelsAdded?: Array<{ message: { id: string; threadId: string }; labelIds: string[] }>;
  labelsRemoved?: Array<{ message: { id: string; threadId: string }; labelIds: string[] }>;
};

export async function listHistory(
  mailboxKey: string,
  startHistoryId: string,
  pageToken?: string
): Promise<{ added: GmailMessageMeta[]; labelEvents: GmailLabelEvent[]; historyId?: string; nextPageToken?: string }> {
  const params = new URLSearchParams({ startHistoryId });
  for (const t of ["messageAdded", "labelAdded", "labelRemoved"]) params.append("historyTypes", t);
  if (pageToken) params.set("pageToken", pageToken);
  const r = await gapi<{ history?: GmailHistoryRecord[]; historyId?: string; nextPageToken?: string }>(
    mailboxKey, "/history?" + params.toString()
  );
  const added: GmailMessageMeta[] = [];
  const labelEvents: GmailLabelEvent[] = [];
  for (const h of r.history || []) {
    for (const m of h.messagesAdded || []) added.push(m.message);
    for (const e of h.labelsAdded || []) labelEvents.push({ messageId: e.message.id, threadId: e.message.threadId, added: e.labelIds, removed: [] });
    for (const e of h.labelsRemoved || []) labelEvents.push({ messageId: e.message.id, threadId: e.message.threadId, added: [], removed: e.labelIds });
  }
  return { added, labelEvents, historyId: r.historyId, nextPageToken: r.nextPageToken };
}
```

- [ ] **Step 3: label-interpret.ts**

```ts
/**
 * #96 §3 — Gmail → Peak. Labels applied in Gmail under Peak/ are commands.
 * Fed by the history replay in bridge.ts; applies through the same store
 * functions the UI uses so feeds, badges and the bell fire.
 */
import { listDocs, patchDoc } from "@/db/doc-store";
import { assign, setLink, setStatus, type CommThread } from "@/lib/stores/comms";
import { byName as customerByName } from "@/lib/stores/customers";
import { create as createLead } from "@/lib/stores/leads";
import { activeUsers } from "@/lib/users";
import type { GmailLabelEvent } from "./api";
import { modifyThread } from "./api";
import { listCachedLabels } from "./connections";
import { userIdOfKey } from "./config";
import { linkThread, rememberAddress } from "./linking";
import { desiredPeakLabels, parsePeakLabel, type PeakCommand } from "./peak-labels";
import { ensureLabelId } from "./label-sync";

const ECHO_WINDOW_MS = 2 * 60_000;

export function planLabelCommands(addedNames: string[]): PeakCommand[] {
  const byKind = new Map<string, PeakCommand>();
  const out: PeakCommand[] = [];
  for (const n of addedNames) {
    const c = parsePeakLabel(n);
    if (!c) continue;
    if (c.kind === "status" || c.kind === "assign" || c.kind === "customer") byKind.set(c.kind, c);
    else out.push(c);
  }
  return [...byKind.values(), ...out];
}

export async function interpretLabelEvents(key: string, events: GmailLabelEvent[]): Promise<number> {
  if (!events.length) return 0;
  const cache = await listCachedLabels(key);
  const idToName = new Map(cache.map((l) => [l.labelId, l.name]));
  const all = await listDocs<CommThread>("comms");
  const byGmailThread = new Map(all.filter((t) => t.gmailAccountKey === key && t.gmailThreadId).map((t) => [t.gmailThreadId!, t]));
  let applied = 0;
  for (const ev of events) {
    const t = byGmailThread.get(ev.threadId);
    if (!t) continue;
    const addedNames = ev.added.map((id) => idToName.get(id) || "").filter((n) => n.startsWith("Peak/"));
    const removedNames = ev.removed.map((id) => idToName.get(id) || "").filter((n) => n.startsWith("Peak/"));
    if (!addedNames.length && !removedNames.length) continue;
    // our own echo: we just wrote exactly these
    const want = new Set(desiredPeakLabels(t));
    const recent = (t.peakLabelsAppliedAt || 0) > Date.now() - ECHO_WINDOW_MS;
    if (recent && addedNames.every((n) => want.has(n)) && removedNames.every((n) => !want.has(n))) continue;

    for (const cmd of planLabelCommands(addedNames)) {
      if (cmd.kind === "status") await setStatus(t.id, cmd.status);
      else if (cmd.kind === "assign") {
        const u = (await activeUsers()).find((x) => x.name.split(" ")[0].toLowerCase() === cmd.firstName.toLowerCase());
        if (u) await assign(t.id, u.name);
      } else if (cmd.kind === "customer") {
        const c = await customerByName(cmd.name);
        if (c) {
          await linkThread(t.id, c.id);
          if (t.contactEmail) await rememberAddress(c.id, t.contactEmail, t.contactName, null, { id: userIdOfKey(key) || "u1", name: "Gmail label" });
        }
      } else if (cmd.kind === "work") await setLink(t.id, { type: cmd.type, id: cmd.id, label: cmd.id });
      else if (cmd.kind === "newLead") {
        const lead = await createLead({ org: t.customer || t.contactName, contact: t.contactName, email: t.contactEmail, source: "manual", message: t.subject, customerId: t.customerId }, "Gmail label");
        await setLink(t.id, { type: "lead", id: lead.id, label: lead.id });
        const newLeadId = cache.find((l) => l.name === "Peak/New lead")?.labelId;
        const leadLabelId = await ensureLabelId(key, "Peak/Leads/" + lead.id);
        await modifyThread(key, ev.threadId, { addLabelIds: [leadLabelId], removeLabelIds: newLeadId ? [newLeadId] : [] });
      }
      applied++;
    }
    for (const n of removedNames) {
      const c = parsePeakLabel(n);
      if (c?.kind === "customer" && t.customer === c.name) {
        await patchDoc<CommThread>("comms", t.id, (d) => { d.customerId = null; d.customer = ""; d.resolution = "unknown"; });
        applied++;
      }
    }
    // record what Gmail now holds so the writer doesn't echo it back
    await patchDoc<CommThread>("comms", t.id, (d) => {
      d.messages = (d.messages || []).map((m) =>
        m.gmailId === ev.messageId
          ? { ...m, gmailLabelIds: Array.from(new Set([...(m.gmailLabelIds || []).filter((id) => !ev.removed.includes(id)), ...ev.added])) }
          : m
      );
      d.peakLabelsAppliedAt = Date.now();
    });
  }
  return applied;
}
```
`customerByName` — confirm `byName` in `src/lib/stores/customers.ts:407` returns a doc or null and takes a plain string; `createLead`'s signature is `(partial, me)`.

- [ ] **Step 4: bridge.ts** — in `syncMailboxMessages`' incremental loop, collect `page.labelEvents` into an array; after the `do/while`, `const applied = await interpretLabelEvents(key, events); if (applied) last = last || "labels";` (so `changed` is true). Wrap in try/catch that logs.

- [ ] **Step 5: Regression test** — `New lead` path through the store (no Gmail): append to `main()`:

```ts
  // #96 — planLabelCommands is pure; the newLead branch's store side
  const { planLabelCommands } = await import("@/lib/gmail/label-interpret");
  assert.equal(planLabelCommands(["Peak/New lead"])[0]?.kind, "newLead", "#96 New lead parses");
```
(The Gmail round-trip is verified manually in production: label a thread `Peak/New lead` in Gmail → within a sync the Leads queue has a new lead and Gmail shows `Peak/Leads/L-…` instead.)

- [ ] **Step 6: Verify** specs + regressions + tsc.

- [ ] **Step 7: Commit**
```bash
git add src/lib/gmail/api.ts src/lib/gmail/label-interpret.ts src/lib/gmail/bridge.ts scripts/test-review-and-spec.ts scripts/test-review-regressions.ts
git commit -m "feat(inbox): interpret Peak/* labels applied in Gmail — customer, status, assign, work, new lead (#96 §3)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 12: Docs, decisions, close-out

**Files:**
- Modify: `DECISIONS.md` (append D141), `PUNCHLIST.md` (#96 → DONE), `MASTER-HOWTO.md` §5 (one paragraph: the `Peak/` labels and what each does), `DEPLOY.md` (note `gmail.modify` is now load-bearing for labels)
- Modify: `docs/superpowers/specs/2026-09-21-inbox-customer-linking-and-label-sync-design.md` — correct §3's claim that history replay "already sees" label events (it only requested `messageAdded` until Task 11) and §4's `labelMap` (the existing `gmail_labels` cache is used instead).

- [ ] **Step 1: Full gate**, one at a time: `tsc`, `eslint` (0 errors), `test:specs`, `test:review:regressions`, `test:smoke`.
- [ ] **Step 2: Write D141** — namespace, both-way table, echo window, conflict rule, learned-domain rule, suggested-vs-linked. Mark #96 DONE with commit hashes.
- [ ] **Step 3: Commit + push**, then in production: open the Inbox once, confirm Curt/Brenda threads are linked to their customers, label one thread `Peak/Status/Done` in Gmail and watch it close in Peak on the next sync.

```bash
git add DECISIONS.md PUNCHLIST.md MASTER-HOWTO.md DEPLOY.md docs/superpowers/specs/2026-09-21-inbox-customer-linking-and-label-sync-design.md
git commit -m "docs: D141 two-way Peak/* labels + linking; close #96

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git push origin main
```
