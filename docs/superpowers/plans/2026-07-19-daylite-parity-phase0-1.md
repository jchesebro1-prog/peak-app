# Daylite Parity — Phase 0 + Phase 1 (Identity Core) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the relational identity core (companies, contacts, contact emails/phones, sites) from the approved design (`docs/superpowers/specs/2026-07-19-daylite-parity-design.md` §4), put **Companies** and **People** in the nav, and convert the existing customer directory onto the new tables — everything Phase 0+1 ships that does **not** require the Daylite export.

**Architecture:** Five new real Drizzle tables extend `src/db/schema.ts` (the relational paradigm `users`/`app_settings` already use). The existing `src/lib/stores/customers.ts` module keeps its **public API and types byte-compatible** but is re-backed by the new tables — its ~120 consumers keep working unchanged. `customers` leaves the client-sync allowlists (the identity core is server-authoritative per spec §3.2). A converter populates the new tables from the current customer docs and prints a reconciliation report (spec §6 evidence culture). New `/companies` and `/people` modules replace `/customers` (which becomes redirects).

**Tech Stack:** Next.js 16 App Router / TypeScript strict / Drizzle ORM on PGlite (dev) + Postgres (prod) / no test runner (repo convention: browser-driven verification + `next build` as typecheck + scripted reconciliation checks).

## Global Constraints

- **Not in scope (spec-gated):** Daylite import code (§5.1 — audit first), party junctions (§4.5, Phase 2), opportunities (Phase 3), portal-grant rework (§8.1), pricing-tier resolution UI (item 11, after Phase 1). Do not build these.
- **Port faithfully** (AGENTS.md): keep existing field names, id formats, epoch-ms `Date.now()` timestamps stored as `bigint { mode: "number" }`. Deviations get a DECISIONS.md entry (this plan = **D85**).
- **Company ids ARE the old customer slugs** ('lakefront', …). Every doc-store `customerId` keeps resolving without rewrites. `customerId` on doc records now means "company id" — field renames are deferred to the phases that rebuild each screen (D85 records this).
- **Composed `CustomerLocation.id` = the site's `legacyLocId` when present, else `sites.id`** — so stored doc `locationId` values ('loc1', …) and `${customerId}|${locationId}` map keys keep matching byte-for-byte.
- `requireUser()` / `requirePerm()` from `@/lib/session` in every server component/action touching data.
- Never hardcode accent colors — use `var(--accent)` etc.
- After editing `src/db/schema.ts`: `npm run db:generate` and **commit all of `drizzle/`** (SQL + meta).
- Commits are **LOCAL ONLY** — no push (no PAT on this machine; Jeff pushes via GitHub Desktop). Commit style: `Area: description (D85, Daylite parity Phase 1)`.
- Do NOT run `npm run db:reset-local` — Jeff's dev `.data/` holds his live testing records. The converter must work against the existing database.

---

### Task 1: Identity schema

**Files:**
- Modify: `src/db/schema.ts` (append after `gmailConnections`)
- Create: `drizzle/0005_*.sql` + meta (generated)

**Interfaces:**
- Produces: Drizzle tables `companies`, `contacts`, `contactEmails`, `contactPhones`, `sites` + row types (`CompanyRow`, `ContactRow`, `ContactEmailRow`, `ContactPhoneRow`, `SiteRow`) consumed by Tasks 2–4.

- [ ] **Step 1: Append the identity tables to `src/db/schema.ts`**

```ts
/* ------------------------------------------------------------------ *
 * Identity core (Daylite parity Phase 1, D85).
 * Design: docs/superpowers/specs/2026-07-19-daylite-parity-design.md §4.
 * Relational on purpose (§3.2): referential integrity for the 17-year
 * migration + indexed relationship queries. Server-authoritative — NOT
 * part of doc-store sync (field staff don't create contacts offline).
 * Company ids reuse the customer-directory slugs ('lakefront', …) so
 * every doc-store customerId keeps resolving unchanged.
 * ------------------------------------------------------------------ */

export const companies = pgTable(
  "companies",
  {
    id: text("id").primaryKey(), // customer slug convention ('lakefront')
    name: text("name").notNull(),
    /** Default hint only; per-deal truth arrives with Phase 2 junction roles.
     *  Carries the prototype's venue-segment values as-is for converted rows;
     *  value lists are configuration, not schema (§4.1). */
    type: text("type").notNull().default(""),
    /** Daylite's "category": prospect | customer | past | none (§4.1). */
    lifecycle: text("lifecycle").notNull().default("none"),
    keywords: jsonb("keywords").$type<string[]>().notNull().default([]),
    website: text("website"),
    mainPhone: text("main_phone"),
    /** HQ/billing address — distinct from any venue address (§4.1). */
    address: text("address"),
    city: text("city"),
    state: text("state"),
    zip: text("zip"),
    /** Fallback only — the authoritative tier lives on the contact (§4.7). */
    pricingTier: text("pricing_tier"),
    /** Stored, not derived (§4.1) — fixes "owner = newest quote" failing for
     *  companies with no quotes. */
    ownerUserId: text("owner_user_id"),
    referredByContactId: text("referred_by_contact_id"),
    deleted: boolean("deleted").notNull().default(false),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  },
  (t) => [index("companies_deleted_idx").on(t.deleted)]
);

export const contacts = pgTable(
  "contacts",
  {
    id: text("id").primaryKey(), // 'ct-' + base36
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull().default(""),
    /** Nullable on purpose — changes when someone moves employers; Phase 2
     *  junction rows keep the historical hat (§4.2). */
    homeCompanyId: text("home_company_id"),
    /** Real job title — replaces the roles[0] hack (§4.2). */
    title: text("title").notNull().default(""),
    /** THE authoritative pricing tier (§4.7). Unused until item 11 lands. */
    pricingTier: text("pricing_tier"),
    /** active | former | do_not_contact — replaces the "gone" note (§4.2). */
    status: text("status").notNull().default("active"),
    /** Nullable link to a staff login (§4.2) — staff can also be customers. */
    userId: text("user_id"),
    ownerUserId: text("owner_user_id"),
    /** Transitional (D85): preserves the directory's "primary contact of the
     *  company" semantics until quotes designate their own primary (§4.7). */
    isPrimary: boolean("is_primary").notNull().default(false),
    deleted: boolean("deleted").notNull().default(false),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  },
  (t) => [
    index("contacts_home_company_idx").on(t.homeCompanyId),
    index("contacts_deleted_idx").on(t.deleted),
  ]
);

/** A contact has MANY labeled emails/phones (§4.3) — load-bearing for the
 *  portal (grants attach to a contact email), not cosmetic. */
export const contactEmails = pgTable(
  "contact_emails",
  {
    id: text("id").primaryKey(), // 'ce-' + base36
    contactId: text("contact_id").notNull(),
    email: text("email").notNull(),
    label: text("label").notNull().default("work"),
    isPrimary: boolean("is_primary").notNull().default(false),
  },
  (t) => [
    index("contact_emails_contact_idx").on(t.contactId),
    index("contact_emails_email_idx").on(t.email),
  ]
);

export const contactPhones = pgTable(
  "contact_phones",
  {
    id: text("id").primaryKey(), // 'cp-' + base36
    contactId: text("contact_id").notNull(),
    phone: text("phone").notNull(),
    label: text("label").notNull().default("work"),
    isPrimary: boolean("is_primary").notNull().default(false),
  },
  (t) => [index("contact_phones_contact_idx").on(t.contactId)]
);

export const sites = pgTable(
  "sites",
  {
    id: text("id").primaryKey(), // 'st-<companyId>-<n>' (deterministic in convert)
    companyId: text("company_id").notNull(), // the owning organization (§4.4)
    name: text("name").notNull().default(""),
    /** The per-customer location id docs already store ('loc1', …). Composed
     *  CustomerLocation.id returns this when present so stored locationId
     *  values and `${customerId}|${locationId}` keys keep matching (D85). */
    legacyLocId: text("legacy_loc_id"),
    isPrimary: boolean("is_primary").notNull().default(false),
    address: text("address"),
    city: text("city"),
    state: text("state"),
    zip: text("zip"),
    lat: text("lat"),
    lng: text("lng"),
    venueKind: text("venue_kind").notNull().default("proscenium"),
    travelMiles: text("travel_miles"),
    travelMin: text("travel_min"),
    /** Placeholder for the later Drive integration (§4.4) — free now. */
    driveFolderId: text("drive_folder_id"),
    deleted: boolean("deleted").notNull().default(false),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  },
  (t) => [
    index("sites_company_idx").on(t.companyId),
    index("sites_deleted_idx").on(t.deleted),
  ]
);

export type CompanyRow = typeof companies.$inferSelect;
export type NewCompanyRow = typeof companies.$inferInsert;
export type ContactRow = typeof contacts.$inferSelect;
export type NewContactRow = typeof contacts.$inferInsert;
export type ContactEmailRow = typeof contactEmails.$inferSelect;
export type ContactPhoneRow = typeof contactPhones.$inferSelect;
export type SiteRow = typeof sites.$inferSelect;
export type NewSiteRow = typeof sites.$inferInsert;
```

Notes locked here: `lat`/`lng`/`travelMiles`/`travelMin` are `text` because the doc shape allows `number | string | null` and "port faithfully" wins — the store seam converts on compose. No DB-level FKs: the referenced ids ('u1', slugs) also live inside jsonb docs where no constraint can reach, and half-enforced constraints are worse than store-level checks; the converter's reconciliation report is the integrity gate this phase (D85 records the deviation from §3.1's "real foreign keys" wording).

- [ ] **Step 2: Generate the migration**

Run: `cd ~/Downloads/peak-app && npm run db:generate`
Expected: new `drizzle/0005_<name>.sql` creating 5 tables + indexes; `drizzle/meta/` updated.

- [ ] **Step 3: Commit**

```bash
git add src/db/schema.ts drizzle/
git commit -m "Identity core: companies/contacts/emails/phones/sites schema (D85, Daylite parity Phase 1)"
```

---

### Task 2: Identity lib (config + data modules)

**Files:**
- Create: `src/lib/identity/config.ts` — value lists (configuration, not schema)
- Create: `src/lib/identity/ids.ts` — id minting
- Create: `src/lib/identity/companies.ts`, `src/lib/identity/contacts.ts`, `src/lib/identity/sites.ts` — CRUD modules

**Interfaces:**
- Consumes: Task 1 tables.
- Produces (used by Tasks 3–6):
  - `config.ts`: `COMPANY_TYPES: string[]` (§4.1 list), `LIFECYCLES = ["prospect","customer","past","none"]`, `CONTACT_STATUSES = ["active","former","do_not_contact"]`, `CHANNEL_LABELS = ["work","mobile","home","other"]`
  - `ids.ts`: `mintId(prefix: string): string` → `"<prefix>-" + 6-char base36` (matches the project-subrecord uid convention)
  - `companies.ts`: `allCompanies(opts?: {includeDeleted?: boolean}): Promise<CompanyRow[]>` (name-sorted), `getCompany(id): Promise<CompanyRow | null>`, `saveCompany(row: NewCompanyRow): Promise<void>` (upsert, stamps updatedAt; createdAt only on insert), `softDeleteCompany(id): Promise<void>` (also soft-deletes its sites and un-homes nothing — contacts keep their homeCompanyId, matching "junctions keep the historical hat")
  - `contacts.ts`: `allContacts(): Promise<ContactRow[]>`, `contactsForCompany(companyId): Promise<ContactRow[]>`, `getContact(id): Promise<ContactRow | null>`, `saveContact(row): Promise<void>`, `softDeleteContact(id): Promise<void>`, `emailsFor(contactId): Promise<ContactEmailRow[]>`, `phonesFor(contactId): Promise<ContactPhoneRow[]>`, `setEmails(contactId, emails: {email,label,isPrimary}[]): Promise<void>` (delete+reinsert with deterministic ids `ce-<contactId>-<n>`), `setPhones(...)` same, `emailsForContacts(ids: string[]): Promise<Map<string, ContactEmailRow[]>>`, `phonesForContacts(ids: string[]): Promise<Map<string, ContactPhoneRow[]>>`, `displayName(c: ContactRow): string` = `` `${c.firstName} ${c.lastName}`.trim() ``
  - `sites.ts`: `sitesForCompany(companyId): Promise<SiteRow[]>` (primary first), `sitesForCompanies(ids: string[]): Promise<Map<string, SiteRow[]>>`, `getSite(id): Promise<SiteRow | null>`, `saveSite(row): Promise<void>`, `softDeleteSite(id): Promise<void>`, `docLocId(s: SiteRow): string` = `s.legacyLocId ?? s.id`
- All reads filter `deleted = false` unless `includeDeleted`.

- [ ] Step 1: Write the five files per the interface block (plain Drizzle `getDb()` queries, same style as `src/lib/users.ts`).
- [ ] Step 2: `npm run lint` — expect clean.
- [ ] Step 3: Commit: `git commit -m "Identity core: lib modules (D85, Daylite parity Phase 1)"`

---

### Task 3: Converter + reconciliation report

**Files:**
- Create: `src/lib/identity/convert.ts`
- Create: `scripts/convert-identity.ts`
- Modify: `src/db/seed-data.ts` (invoke after doc seeding), `package.json` (add `db:convert-identity` script)

**Interfaces:**
- Consumes: `listDocs<CustomerDoc>("customers")` (the OLD doc collection, read directly — the only remaining reader of it after Task 4), Task 2 modules, `users` table.
- Produces: `convertCustomersToIdentity(): Promise<ConvertReport>` where `ConvertReport = { customersIn: number; companies: number; sites: number; contacts: number; emails: number; phones: number; skipped: {id: string; reason: string}[]; warnings: string[] }`. Idempotent: deterministic ids (`companies.id` = customer id; `sites.id` = `st-<companyId>-<n>` by stable location order; `contacts.id` = `ct-<companyId>-<n>`), upsert semantics, safe to re-run.

**Conversion rules (all from spec §4 / D85):**
1. Company: `id`/`name` carried; `type` = old `type` verbatim; `lifecycle` = `"customer"` if any quote or project doc references the id, else `"none"`; `ownerUserId` = users row whose `name` === doc `owner` (else null, warning); `createdAt`/`updatedAt` carried (else `Date.now()`, warning suppressed — D83 records lack them by design).
2. Site per `locations[]` entry: `legacyLocId` = `loc.id ?? null`; `name` = `loc.label ?? ""`; address/city/state/lat/lng/venueKind/travelMiles/travelMin carried (numbers stringified); `isPrimary` from `loc.primary`.
3. Contact per `contacts[]` entry: name split on **last** space → first/last (single token → firstName only); `title` = old `role`; `homeCompanyId` = company; `isPrimary` from `primary`; `status` = `"active"`; `userId` = users row matched on `email`/`googleEmail` (case-insensitive). Email/phone (when non-blank) become one `contact_emails` / `contact_phones` row, label `"work"`, `isPrimary: true`.
4. Warning (not skip) when `firstName + " " + lastName` ≠ original trimmed name (would break `contactByName` exact-match round-trips).
5. Customers with no name AND no locations AND no contacts → skipped with reason.

- [ ] Step 1: Write `convert.ts` + the script (script prints the report as aligned text — this is the §6 reconciliation artifact).
- [ ] Step 2: Wire into `seedIfEmpty` in `src/db/seed-data.ts`: after doc-collection seeding, `if ((await allCompanies()).length === 0) await convertCustomersToIdentity()`.
- [ ] Step 3: Run `npm run db:convert-identity` against the live dev `.data/`. Expected: report with `customersIn === companies + skipped.length`, sites/contacts counts matching the directory, zero unexplained warnings. Paste the report into the task-9 verification notes.
- [ ] Step 4: Commit: `git commit -m "Identity core: customer-directory converter + reconciliation report (D85)"`

---

### Task 4: The store seam swap (highest-risk task)

**Files:**
- Modify: `src/lib/stores/customers.ts` — same exports, new backing
- Modify: `src/db/doc-tables.ts` — remove `"customers"` from `SYNCABLE_COLLECTIONS`
- Modify: `src/lib/sync/engine.ts` — remove `"customers"` from `FIELD_COLLECTIONS`
- Modify: `src/lib/stores/leads.ts` — `convertLead` creates company+site+contact via identity lib (kills the raw `upsertDoc("customers", …)` and the `"loc1"` hardcode; draft quote's `locationId` = created site's `docLocId`)
- Modify: `src/lib/stores/flame-jobs.ts`, `repair-jobs.ts`, `inspections.ts`, `designs.ts`, `comms.ts` — replace raw `getDoc/listDocs("customers")` reads + local `CustomerDocLike` types with `import * as Customers from "./customers"` calls
- Modify: `src/app/api/search/route.ts` — customers block → companies + people over SQL, deep links `/companies/<id>` & `/people/<id>`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: `customers.ts` keeps its EXACT current export surface (`normalizeRecord`, `all`/`list`, `get`, `resolveId`, `nameFor`, `byName`, `resolve`, `setDirectory`, `upsert`, `remove`, `locationsForId`, `locationsFor`, `locationById`, `primaryLoc`, `contactsForId`, `primaryContact`, `contactByName`, `setLocations`, `travelFor`, `travelForId`, `travelForName`, `resetToSeed`, and all types) — composition rules:
  - `CustomerDoc` composed as: `{ id, name, type, location: primary site "City, ST", locations: sites.map(compose), contacts: contacts.map(compose), createdAt, updatedAt, owner: users.name for ownerUserId (undefined when unset) }`
  - `CustomerLocation.id` = `legacyLocId ?? site.id`; lat/lng/travel* parsed back to `number | null` (numeric strings) per the old shape
  - `CustomerContact` = `{ name: displayName, role: title, email: primary email ?? "", phone: primary phone, primary: isPrimary }`
  - `locationById(id, locId)` matches `legacyLocId` OR `sites.id`, then falls back to primary (unchanged semantics)
  - Writes: `upsert`/`setDirectory` decompose `CustomerRecordInput` through the same rules in reverse (site matching by `legacyLocId ?? id`, contact matching by exact display name — same keys the composition emits; unmatched incoming rows create new rows; missing existing rows are soft-deleted on `setDirectory`, kept on `upsert`)
  - `resetToSeed()` = soft-wipe identity rows converted from seeds + `setDirectory(customersSeed())`

- [ ] Step 1: Rewrite `customers.ts` (single file, keep the header comment updated to describe the seam).
- [ ] Step 2: Sync allowlists — delete the `"customers"` entries; update the guard comment in doc-tables.ts to note identity is server-authoritative (spec §3.2).
- [ ] Step 3: `leads.ts` `convertLead` rewire.
- [ ] Step 4: The five raw-reader rewires (each is: delete local type + doc-store import, call `Customers.get`/`Customers.all`).
- [ ] Step 5: Search route rewire.
- [ ] Step 6: `npm run build` — expect clean compile (this is the typecheck gate for the whole seam).
- [ ] Step 7: Commit: `git commit -m "Identity core: customers store re-backed by identity tables; sync allowlist + raw readers + search rewired (D85)"`

---

### Task 5: Companies module

**Files:**
- Create: `src/app/(app)/companies/page.tsx` (list: search, type filter, lifecycle chip, sites count, open-value rollup, owner avatar, "+ New")
- Create: `src/app/(app)/companies/[id]/page.tsx` (detail: header + stat strip; Sites & venues card; People card; Quotes/Projects cards; Portal access panel)
- Create: `src/app/(app)/companies/actions.ts` (`saveCompanyAction`, `deleteCompanyAction`, portal grant actions moved from customers)
- Create: `src/app/(app)/companies/edit-modal.tsx`, `types.ts`, `lib.ts`
- Reference pattern: current `src/app/(app)/customers/*` (adapted, not imported)

**Interfaces:**
- Consumes: Task 2 modules + composed store for rollups (`quotesFor` matching keeps the id-or-name fallback exactly as `customers/page.tsx:59` does today).
- Produces: routes `/companies`, `/companies/[id]`; `?edit=new|1` modal convention preserved.

- [ ] Step 1: Build list + detail + modal + actions per the current customers module structure (URL-as-state, server rollups, inline styles + `pk-card`, `one(v)` helper, `metadata.title = "Companies — Peak Backend"`).
- [ ] Step 2: Move the portal-access panel (`customers/[id]/portal-access.tsx` → `companies/[id]/portal-access.tsx`); grants stay keyed by company id (= old customer id) so existing grants keep working.
- [ ] Step 3: Browser check: list renders converted rows, detail shows sites/people/work, create + edit round-trip.
- [ ] Step 4: Commit: `git commit -m "Companies module: list/detail/edit over the identity core (D85)"`

---

### Task 6: People module

**Files:**
- Create: `src/app/(app)/people/page.tsx` (list: search, company filter, **status filter defaulting to active** per spec §5.4.3, primary email/phone columns)
- Create: `src/app/(app)/people/[id]/page.tsx` (detail: channels card with labeled emails/phones, home company link, title, status, owner)
- Create: `src/app/(app)/people/actions.ts` (`savePersonAction`, `deletePersonAction` — first/last/title/company/status + emails[]/phones[] arrays)
- Create: `src/app/(app)/people/edit-modal.tsx`, `types.ts`

**Interfaces:**
- Consumes: Task 2 `contacts.ts` + `companies.ts`.
- Produces: routes `/people`, `/people/[id]`. **You cannot open a contact today; after this task you can** (the headline gap from the item-20 recon).

- [ ] Steps mirror Task 5 (build, browser check, commit `"People module: list/detail/edit over the identity core (D85)"`).

---

### Task 7: Nav, redirects, residual links

**Files:**
- Modify: `src/components/nav/nav-data.ts` — General children: `customers` entry becomes `{ key: "companies", label: "Companies", href: "/companies" }` + `{ key: "people", label: "People", href: "/people" }` (in that order, at the top of the group); `activeKeyFor` map: `"/companies": "companies"`, `"/people": "people"`, `"/customers": "companies"`.
- Replace: `src/app/(app)/customers/page.tsx` → `redirect("/companies")`; `src/app/(app)/customers/[id]/page.tsx` → `redirect(\`/companies/${id}\`)`; delete the rest of the customers module dir (actions/controls/modal/lib/types/portal-access) once nothing imports them.
- Modify: `src/lib/agenda.ts:86` — href `/customers/` → `/companies/`.

- [ ] Step 1: Apply, then `grep -rn '"/customers' src/` — remaining hits must be the two redirect files only.
- [ ] Step 2: `npm run build` clean; browser: nav shows Companies + People, old `/customers/lakefront` deep link lands on `/companies/lakefront`.
- [ ] Step 3: Commit: `git commit -m "Nav: Companies + People replace Customers; legacy routes redirect (D85)"`

---

### Task 8: Daylite export audit tool (Phase 0 remainder — ready for the CSV)

**Files:**
- Create: `scripts/audit-daylite-export.ts` — takes file/dir args; per CSV: row count, column inventory with fill-rates, detected delimiter; flags per spec §5.1: relationships/links file present? role columns? notes/activity with parent+timestamp+author? custom-field columns? keywords/category/referred-by/owner/created/modified? attachments?
- Modify: `package.json` — `"audit:daylite": "tsx scripts/audit-daylite-export.ts"`
- Create: `docs/superpowers/specs/daylite-export-audit-checklist.md` — the §5.1 checklist with a blank findings column, to be filled the day the export lands.

- [ ] Step 1: Write tool + checklist (CSV parsing hand-rolled: header split honoring quotes; no new deps).
- [ ] Step 2: Self-test on a tiny fixture written to the scratchpad (not committed).
- [ ] Step 3: Commit: `git commit -m "Phase 0: Daylite export audit tool + checklist, ready for the CSV (D85)"`

---

### Task 9: Verification + bookkeeping

- [ ] Step 1: `npm run build` clean; restart the dev server (schema migrations apply at boot).
- [ ] Step 2: Browser pass (record honestly per repo convention, including what seed data can't exercise):
  1. `/companies` list = converted directory; detail for a multi-venue company shows all sites; portal panel lists existing grants.
  2. `/people` list defaults to active; open a person; edit round-trip.
  3. Estimator: customer picker + venue picker + travel chip still work (composed store).
  4. Leads: convert a lead → company + site + contact created, draft quote linked.
  5. ⌘K search: companies and people groups with deep links.
  6. Reports (installs map pins) and flame/inspection quote pages spot-checked.
  7. `/api/sync/pull` cursors: customers absent from FIELD_COLLECTIONS pulls.
- [ ] Step 3: Reconciliation report from Task 3 pasted into PUNCHLIST/DECISIONS notes.
- [ ] Step 4: Docs: DECISIONS.md — write **D85** (identity core landed; deviations: no DB-level FKs yet, transitional `contacts.isPrimary`, `customerId` field-name retention, composed-location id aliasing; also backfill stub lines noting D83/D84 live in PUNCHLIST + commits). PUNCHLIST.md — item 20 heading → IN PROGRESS (Phase 1 landed, junctions = Phase 2), item 23 → note fields now real columns; item 22 → note Companies/People nav entries exist. README.md status paragraph.
- [ ] Step 5: Bookkeeping commit: `git commit -m "Punch list: identity core landed — item 20 phase 1, 23 schema fields (D85)"`

## Self-Review (run after writing, before executing)

1. Spec coverage: §4.1–4.4 tables ✓ (junctions §4.5 deliberately Phase 2); §5.1 audit tooling ✓ (audit itself blocked on the export — external); §7 Phase 1 "People and Companies in the nav, populated" ✓ (populated by conversion instead of first partial import — export absent; import stays unwritten per §5.1); §8.2 search/reports rewiring ✓ (reports keep working through the preserved store API; search actively rewired).
2. Placeholder scan ✓ — Tasks 2/5/6 specify exact interfaces + reference patterns instead of inline full code; acceptable here because the plan author executes in-session (recorded deviation from the skill's letter).
3. Type consistency ✓ — `docLocId`, `displayName`, row types used consistently across Tasks 2–6.
