# Vendors Module Implementation Plan (PUNCHLIST #122)

> **Executed and shipped 2026-09-21/22** as `punch-round-2-vendors`, merged to `main` at
> `6e5205d`. Two details below were overtaken by execution and are deliberately left as
> written, because this is the record of what was built from: the migration landed as
> **`0024_vendor_profiles`** (the `00NN` placeholders assume index 23, which Import/Export's
> `0023_sites_kind` took first), and the queue's company links **do** deep-link to
> `/vendors/<id>` when the assignment's `source` carries the `auto: vendor ` prefix — the
> out-of-scope note saying otherwise was corrected in D160, not here. Follow-ups from the
> reviews are PUNCHLIST #140 and #141.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give vendors (companies typed `vendor/manufacturer`) a record that claims catalog manufacturers, keeps a price-list ledger checked against the catalog's effective price dates (date rule only), spawns the catalog owner's Home Queue task when the catalog lags or the list is stale, and carries contacts-with-roles, discounts, registration and Inbox-logged activity.

**Architecture:** One new doc collection (`vendor_profiles`, id = company id) beside the existing identity-core company; a pure `src/lib/vendor-status.ts` derives `no-list | newer-list | outdated | current` from the newest ledger entry and the newest `effectivePriceDate` across the vendor's claimed manufacturers; `src/lib/vendor-tasks.ts` turns that into at-most-once Home Queue assignments (keyed by `source`) after a ledger save and inside the existing daily cron route. Screens are `/vendors` (list + unclaimed-manufacturer claims) and `/vendors/[id]` (Overview / Contacts / Price lists / Activity tabs) built on the Companies/Engagements idioms; the Inbox link picker groups Customers/Vendors and the Catalog facet/banner point at the vendor. Spec: `docs/superpowers/specs/2026-09-21-vendors-module-design.md`. **Depends on the catalog plan (#133, `docs/superpowers/specs/2026-09-21-catalog-price-dates-and-assemblies-design.md`) having landed** — it provides `CatalogPart.pricedAt`, `settings.priceListEffective`, and the DB-free helpers `effectivePriceDate(part, settings)`, `mfrKey(name)`, `OUTDATED_AFTER_MS`, `isOutdated(at, now)` in `src/lib/catalog-books.ts` (if `grep -rn "export function effectivePriceDate" src/lib` shows a different module, import from that one everywhere this plan says `@/lib/catalog-books`).

**Tech Stack:** Next.js 16 App Router, TypeScript, Drizzle on Postgres/PGlite, doc-store JSON documents, server actions, tsx test harnesses

## Global Constraints

- Node at `~/.local/node/bin`: `export PATH=$HOME/.local/node/bin:$PATH` first.
- **Schema change is limited to what the spec names:** one `docTable("vendor_profiles")` + one idempotent migration (D141 / #120 shape). No other table changes.
- **Never run migrations, seeds or the dev DB locally:** no `npm run db:migrate`, `db:seed`, `db:reset-local`, `next dev`, `next build`, `npm run test:smoke` — the controller runs those. `npx drizzle-kit generate` is offline (schema vs snapshot) and allowed. `test:review:regressions` opens its own scratch PGlite (`PGLITE_PATH=$(mktemp -d)`); run it alone, never alongside another `tsx` script (`ps aux | grep -E 'tsx|next dev'` must be empty first).
- `requireUser()` on every page; every action `requireUser()`; vendor edits `requirePerm("create")` (spec §3); the catalog-owner setting `requirePerm("manage_users")` like every other Settings write.
- Timestamps are epoch-ms numbers. Company ids stay the identity-core slugs; new vendor companies mint `v-<mfrKey>`.
- No hardcoded accent colour — `var(--accent)` / `ACCENT_INK` / `ACCENT_SOFT` from `src/app/(app)/companies/lib.ts`. No emoji in UI copy.
- Every new pure helper lives in a DB-free module (`src/lib/vendor-status.ts`, `src/app/(app)/vendors/tabs.ts`, `src/app/(app)/vendors/dates.ts`); client components import only types + pure modules + `"use server"` action stubs (the #120 lesson).
- Action result shape: `{ ok: true } | { ok: false; error: string }` (ids added as `{ ok: true; id }`); mutations end with `revalidatePath("/", "layout")`; clients `router.refresh()`.
- Spec harness helper: `ok(cond, msg)` in `scripts/test-review-and-spec.ts` (synchronous section, DB-free imports only). Regression harness: `assert` inside `main()` of `scripts/test-review-regressions.ts`. New routes go into `scripts/smoke-routes.ts`.
- `git add` only the files each task names. Commit after every task with the trailer shown.
- Verification available to implementers: `npx tsc --noEmit -p .`, `npx tsx scripts/test-review-and-spec.ts`, `npm run test:review:regressions`, `npx eslint <files>`.

---

## File Structure

- `src/db/doc-tables.ts` — register `vendorProfiles = docTable("vendor_profiles")` (Task 1)
- `drizzle/00NN_vendor_profiles.sql` + `drizzle/meta/00NN_snapshot.json` + `drizzle/meta/_journal.json` — idempotent table/index/trigger migration, generated with `--custom` (Task 1)
- `src/lib/identity/config.ts` — `VENDOR_COMPANY_TYPE`, `isVendorType()` (Task 1)
- `src/lib/identity/venue-defaults.ts` — `PARTNER_TYPES` gains the exact vendor type (Task 1)
- `src/lib/stores/vendors.ts` — `VendorProfile` store: normalize, CRUD, ledger, contact roles, claim/release, vendor company creation (Task 1)
- `src/lib/vendor-status.ts` — pure: types, status keys/meta, `vendorStatus`, `vendorTasks`, `catalogEffectiveAtFor`, `manufacturerDirectory`, `resolveCatalogOwner` (Task 2)
- `src/lib/settings.ts` — `AppSettingsData.catalogOwner` (Task 3)
- `src/lib/vendor-tasks.ts` — DB: `loadVendors()` (one catalog read, one profiles read) + `ensureVendorAssignments()` (Task 3)
- `src/app/(app)/vendors/actions.ts` — `setCatalogOwnerAction` (Task 3), `createVendorAction` + `claimManufacturerAction` (Task 4), `saveVendorProfileAction` + `logPriceListAction` + `setContactRoleAction` + `releaseManufacturerAction` (Task 5)
- `src/app/(app)/catalog/catalog-owner-card.tsx` — admin "Catalog owner" picker (Settings → Admin → Catalog) (Task 3)
- `src/app/(app)/catalog/page.tsx` — owner card (Task 3); manufacturer-facet tooltip + banner vendor link (Task 6)
- `src/app/api/gmail/sync/route.ts` — daily cron step `ensureVendorAssignments()` (Task 3)
- `src/app/(app)/vendors/page.tsx` — list table, filters, unclaimed panel, new-vendor form (Task 4)
- `src/app/(app)/vendors/controls.tsx` — client: `VendorFilterBar`, `UnclaimedPanel`, `NewVendorForm` (Task 4)
- `src/app/(app)/vendors/tabs.ts`, `src/app/(app)/vendors/dates.ts` — pure tab keys, date-input bridge (Task 5)
- `src/app/(app)/vendors/[id]/page.tsx` — header + tab strip + Activity tab (Task 5)
- `src/app/(app)/vendors/[id]/overview-tab.tsx`, `contacts-tab.tsx`, `price-lists-tab.tsx` — client tabs (Task 5)
- `src/app/(app)/companies/edit-modal.tsx` — type select shows a non-listed stored type (Task 5)
- `src/app/(app)/inbox/types.ts`, `page.tsx`, `link-sidebar.tsx`, `inbox-shell.tsx`, `log-modal.tsx` — Customers/Vendors optgroups; `?customer=<id>` (+ `&log=1`) entry point (Task 6)
- `src/components/nav/nav-data.ts` — CRM › Vendors (Task 7)
- `src/db/seeds/customers.ts`, `src/db/seeds/vendors.ts`, `src/db/seed-data.ts` — seeded vendor company + profile (Task 7)
- `scripts/test-review-and-spec.ts`, `scripts/test-review-regressions.ts`, `scripts/smoke-routes.ts` — tests (Tasks 1–7)
- `DECISIONS.md` (D160), `PUNCHLIST.md` (#122 DONE) (Task 7)

---

### Task 1: `vendor_profiles` collection, migration, store, vendor company type

**Files:**
- Modify: `src/db/doc-tables.ts:90` (after the `recordings` line) and `:120` (`DOC_TABLES` entry after `recordings,`)
- Create: `drizzle/00NN_vendor_profiles.sql` (+ generated `drizzle/meta/00NN_snapshot.json`, `drizzle/meta/_journal.json` entry)
- Modify: `src/lib/identity/config.ts` (append after `COMPANY_TYPES`, line 21)
- Modify: `src/lib/identity/venue-defaults.ts:16-24` (`PARTNER_TYPES`)
- Create: `src/lib/stores/vendors.ts`
- Test: `scripts/test-review-and-spec.ts` (section "#122 §1 — vendor type"), `scripts/test-review-regressions.ts` (section "#122 — vendor profiles")

**Interfaces:**
- Consumes: `docTable()`/`DOC_TABLES` (`src/db/doc-tables.ts:36,92`); `listDocs/getDoc/upsertDoc` (`src/db/doc-store.ts`); `allCompanies/getCompany` (`src/lib/identity/companies.ts`); `upsert` (`src/lib/stores/customers.ts:642`); `mfrKey` (`@/lib/catalog-books`, from the catalog plan); `baseVenueKind`/`PARTNER_TYPES` (`src/lib/identity/venue-defaults.ts`).
- Produces (`src/lib/identity/config.ts`): `VENDOR_COMPANY_TYPE = "vendor/manufacturer"`, `isVendorType(type: string | null | undefined): boolean`.
- Produces (`src/lib/stores/vendors.ts`):
```ts
export type PriceListEntry = { id: string; receivedAt: number; effectiveAt: number; note: string; loggedBy: string };
export type VendorDiscounts = { note: string; percentOffList: number | null; terms: string };
export type VendorRegistration = { program: string; url: string; accountNumber: string; notes: string };
export type VendorProfile = { id: string; manufacturers: string[]; priceLists: PriceListEntry[]; discounts: VendorDiscounts; registration: VendorRegistration; contactRoles: Record<string, string>; createdAt: number; updatedAt: number };
export function blankProfile(id: string, at?: number): VendorProfile;
export function normalizeProfile(raw: Partial<VendorProfile> & { id: string }): VendorProfile;
export async function allVendorProfiles(): Promise<VendorProfile[]>;
export async function getVendorProfile(id: string): Promise<VendorProfile | null>;   // stored only
export async function vendorProfileFor(id: string): Promise<VendorProfile>;           // stored or unsaved blank
export async function vendorCompanies(): Promise<CompanyRow[]>;                        // type === VENDOR_COMPANY_TYPE
export async function vendorForManufacturer(mfr: string): Promise<string | null>;      // vendor id by mfrKey
export async function saveVendorProfile(id, patch: Partial<Pick<VendorProfile, "discounts" | "registration" | "manufacturers" | "contactRoles">>): Promise<VendorProfile>;
export async function logPriceList(id, entry: { receivedAt: number; effectiveAt: number; note: string }, loggedBy: string): Promise<VendorProfile>;
export async function setContactRole(id, contactId, role): Promise<VendorProfile>;
export async function claimManufacturer(vendorId, mfr): Promise<VendorProfile>;        // moves the key off any other vendor
export async function releaseManufacturer(vendorId, mfr): Promise<VendorProfile>;
export async function createVendorCompany(name): Promise<CompanyRow>;                  // company (type preset) + blank profile
export async function vendorCompanyNamed(mfr): Promise<CompanyRow>;                    // existing vendor by normalized name, else create
```
(`PriceListEntry`, `VendorDiscounts`, `VendorRegistration` are *defined* in `src/lib/vendor-status.ts` by Task 2 and re-exported here; in this task define them in the store and Task 2 moves them — see Task 2 Step 3.)

- [ ] **Step 1: Failing spec test** — in `scripts/test-review-and-spec.ts`, add to the top import block (after line 34):

```ts
import { PARTNER_TYPES, baseVenueKind } from "@/lib/identity/venue-defaults";
import { VENDOR_COMPANY_TYPE, isVendorType } from "@/lib/identity/config";
```
and after the `#14 priceBooks` block (PRE-FLIGHT CORRECTION: that block's closing `}` is line **3070**, not 2979 — 2979 is mid-statement inside it — and `#95` is at 3200 with ~130 lines of #132/#134 tests in between; insert after line 3070, locating it by content):

```ts
/* ---- #122 §1 — a vendor is a company of the exact type; partners get no base venue ---- */
ok(VENDOR_COMPANY_TYPE === "vendor/manufacturer" && isVendorType(" vendor/manufacturer ") && !isVendorType("Vendor"), "#122 isVendorType: exact COMPANY_TYPES string (trimmed), not the legacy 'Vendor'");
ok(PARTNER_TYPES.has(VENDOR_COMPANY_TYPE), "#122 PARTNER_TYPES carries the exact vendor type string");
ok(PARTNER_TYPES.has("Vendor"), "#122 PARTNER_TYPES keeps the legacy 'Vendor' spelling");
ok(baseVenueKind(VENDOR_COMPANY_TYPE, "Rose Brand Church Supply") === null, "#122 a vendor company is never minted a base venue, whatever its name says");
```

- [ ] **Step 2: Run it, expect failure** — `npx tsx scripts/test-review-and-spec.ts 2>&1 | head -5` → `SyntaxError: ... does not provide an export named 'VENDOR_COMPANY_TYPE'`.

- [ ] **Step 3: `src/lib/identity/config.ts`** — append after the `COMPANY_TYPES` array (line 21):

```ts
/** #122 — the COMPANY_TYPES value that makes a company a VENDOR (Vendors
 *  module, docs/superpowers/specs/2026-09-21-vendors-module-design.md §1).
 *  Exact-string match everywhere: PARTNER_TYPES (venue-defaults.ts) carries
 *  it so vendors never get a base venue, and /vendors lists only these. */
export const VENDOR_COMPANY_TYPE = "vendor/manufacturer";

export function isVendorType(type: string | null | undefined): boolean {
  return (type || "").trim() === VENDOR_COMPANY_TYPE;
}
```

- [ ] **Step 4: `src/lib/identity/venue-defaults.ts`** — replace lines 16-24 with:

```ts
import { VENDOR_COMPANY_TYPE } from "./config";

/** Company `type` values that are partners, not install venues → no base venue. */
export const PARTNER_TYPES = new Set([
  "Architect",
  "Electrical Contractor",
  "General Contractor",
  "Engineer",
  "Vendor", // legacy spelling on rows that predate #122 — still a partner
  VENDOR_COMPANY_TYPE, // #122 — the COMPANY_TYPES value the Vendors module keys on
  "Competitor",
  "Consultant",
]);
```
(The `import` line goes above the doc comment that precedes `PARTNER_TYPES`; keep the file's existing header comment.)

- [ ] **Step 5: `src/db/doc-tables.ts`** — after line 90 add:

```ts
export const vendorProfiles = docTable("vendor_profiles"); // Vendors module (#122) — one profile per vendor company, id = company id; migration 00NN_vendor_profiles
```
and in `DOC_TABLES` after `recordings,` (line 120) add:

```ts
  vendor_profiles: vendorProfiles,
```
(Not added to `SYNCABLE_COLLECTIONS` — vendor profiles are edited only through permission-checked server actions.)

- [ ] **Step 6: Generate the migration (offline) and paste the idempotent SQL.**

```bash
export PATH=$HOME/.local/node/bin:$PATH
npx drizzle-kit generate --custom --name=vendor_profiles
```
This writes an empty `drizzle/00NN_vendor_profiles.sql` (NN = next index after the last `_journal.json` entry, 23 at the time of writing), a `drizzle/meta/00NN_snapshot.json` that now contains `"public.vendor_profiles"`, and a journal entry. Confirm: `grep -c '"public.vendor_profiles"' drizzle/meta/00NN_snapshot.json` → `1`. Then replace the empty SQL file's contents with exactly this (column-for-column the `recordings` block in `drizzle/0021_krisp_recordings.sql`, written idempotently per D141 / the #120 shape):

```sql
-- Vendors module (#122, docs/superpowers/specs/2026-09-21-vendors-module-design.md §1):
-- `vendor_profiles` — one JSON document per vendor company, id = the company id.
-- Custom migration (drizzle-kit generate --custom) so the DDL is idempotent per
-- D141: it converges on the shared Neon database whether or not a preview
-- build already applied it. The block is column-for-column docTable() —
-- compare drizzle/0021_krisp_recordings.sql.
CREATE TABLE IF NOT EXISTS "vendor_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"doc" jsonb NOT NULL,
	"rev" integer DEFAULT 1 NOT NULL,
	"seq" bigserial NOT NULL,
	"updated_at" bigint NOT NULL,
	"received_at" bigint NOT NULL,
	"review" jsonb,
	"deleted" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vendor_profiles_seq_idx" ON "vendor_profiles" USING btree ("seq");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vendor_profiles_deleted_idx" ON "vendor_profiles" USING btree ("deleted");--> statement-breakpoint
-- Per the NOTE in 0012_seq_bump_trigger.sql: a new doc table needs its own
-- BEFORE UPDATE trigger or pull-sync's `WHERE seq > cursor` stops seeing updates.
CREATE OR REPLACE TRIGGER vendor_profiles_seq_bump BEFORE UPDATE ON "vendor_profiles" FOR EACH ROW EXECUTE FUNCTION bump_doc_seq();
```
Then `npx drizzle-kit generate` (no flags) must print `No schema changes, nothing to migrate` and create nothing — that proves the snapshot already carries the table. Fallback if it instead reports a diff (meaning `--custom` did not snapshot the new schema): delete the three things the custom run created (`drizzle/00NN_vendor_profiles.sql`, `drizzle/meta/00NN_snapshot.json`, and the last element of `entries` in `drizzle/meta/_journal.json`), run `npx drizzle-kit generate --name=vendor_profiles` (plain — it writes the `CREATE TABLE`/`CREATE INDEX` SQL plus a correct snapshot), and replace that generated SQL file's contents with the block above (same DDL, made idempotent + the trigger) — exactly how `0020`/`0021` were rewritten for #120. Either way, do **not** run any migration locally; the regression harness applies it to its scratch DB.

- [ ] **Step 7: `src/lib/stores/vendors.ts`**

```ts
import { getDoc, listDocs, upsertDoc } from "@/db/doc-store";
import type { CompanyRow } from "@/db/schema";
import { allCompanies, getCompany } from "@/lib/identity/companies";
import { VENDOR_COMPANY_TYPE, isVendorType } from "@/lib/identity/config";
import { upsert as upsertCustomer } from "@/lib/stores/customers";
import { mfrKey } from "@/lib/catalog-books";

/* ============================================================
   Vendor profiles (#122) — docs/superpowers/specs/2026-09-21-vendors-module-design.md §1.
   A vendor IS a company (identity core, type === VENDOR_COMPANY_TYPE); this
   collection holds what the company row has no home for: the catalog
   manufacturer spellings the vendor supplies (aliases matched by mfrKey —
   one owner per manufacturer key), the price-list ledger (newest first),
   discount + project-registration notes, and a "contact for…" role per
   contact id. Document id = company id, so there is at most one profile
   per vendor and a vendor company with no profile yet reads as a blank.
   ============================================================ */

export type PriceListEntry = {
  id: string;
  receivedAt: number;
  effectiveAt: number;
  note: string;
  loggedBy: string;
};
export type VendorDiscounts = { note: string; percentOffList: number | null; terms: string };
export type VendorRegistration = { program: string; url: string; accountNumber: string; notes: string };

export type VendorProfile = {
  id: string; // company id
  manufacturers: string[]; // catalog `mfr` spellings this vendor supplies (aliases)
  priceLists: PriceListEntry[]; // newest first (by effectiveAt)
  discounts: VendorDiscounts;
  registration: VendorRegistration;
  contactRoles: Record<string, string>; // contactId → "what to contact them for"
  createdAt: number;
  updatedAt: number;
};

const now = () => Date.now();

function uid(p: string): string {
  return p + Math.random().toString(36).slice(2, 10);
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function blankProfile(id: string, at: number = now()): VendorProfile {
  return {
    id,
    manufacturers: [],
    priceLists: [],
    discounts: { note: "", percentOffList: null, terms: "" },
    registration: { program: "", url: "", accountNumber: "", notes: "" },
    contactRoles: {},
    createdAt: at,
    updatedAt: at,
  };
}

function normalizeEntry(raw: unknown): PriceListEntry | null {
  const e = (raw && typeof raw === "object" ? raw : {}) as Partial<PriceListEntry>;
  const effectiveAt = numOrNull(e.effectiveAt);
  if (effectiveAt == null) return null;
  return {
    id: str(e.id) || uid("pl-"),
    receivedAt: numOrNull(e.receivedAt) ?? effectiveAt,
    effectiveAt,
    note: str(e.note),
    loggedBy: str(e.loggedBy),
  };
}

export function normalizeProfile(raw: Partial<VendorProfile> & { id: string }): VendorProfile {
  const base = blankProfile(raw.id, raw.createdAt ?? now());
  const d = (raw.discounts || {}) as Partial<VendorDiscounts>;
  const r = (raw.registration || {}) as Partial<VendorRegistration>;
  const priceLists = (Array.isArray(raw.priceLists) ? raw.priceLists : [])
    .map(normalizeEntry)
    .filter((e): e is PriceListEntry => !!e)
    .sort((a, b) => b.effectiveAt - a.effectiveAt || b.receivedAt - a.receivedAt);
  const seen = new Set<string>();
  const manufacturers = (Array.isArray(raw.manufacturers) ? raw.manufacturers : [])
    .map((m) => str(m).trim())
    .filter((m) => {
      const k = mfrKey(m);
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  const contactRoles: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw.contactRoles || {})) {
    if (str(v).trim()) contactRoles[k] = str(v).trim();
  }
  return {
    ...base,
    manufacturers,
    priceLists,
    discounts: { note: str(d.note), percentOffList: numOrNull(d.percentOffList), terms: str(d.terms) },
    registration: {
      program: str(r.program),
      url: str(r.url),
      accountNumber: str(r.accountNumber),
      notes: str(r.notes),
    },
    contactRoles,
    createdAt: base.createdAt,
    updatedAt: raw.updatedAt ?? base.createdAt,
  };
}

/* ---------- reads ---------- */

export async function allVendorProfiles(): Promise<VendorProfile[]> {
  const rows = await listDocs<VendorProfile>("vendor_profiles");
  return rows.map(normalizeProfile);
}

/** The stored profile, or null — never mints a blank. */
export async function getVendorProfile(id: string): Promise<VendorProfile | null> {
  const doc = await getDoc<VendorProfile>("vendor_profiles", id);
  return doc ? normalizeProfile(doc) : null;
}

/** Stored profile, or an UNSAVED blank for a vendor company that has none yet. */
export async function vendorProfileFor(id: string): Promise<VendorProfile> {
  return (await getVendorProfile(id)) ?? blankProfile(id);
}

/** Companies of the vendor type (spec §1) — allCompanies() is name-sorted. */
export async function vendorCompanies(): Promise<CompanyRow[]> {
  return (await allCompanies()).filter((c) => isVendorType(c.type));
}

/** Which vendor owns a manufacturer (by mfrKey), or null. */
export async function vendorForManufacturer(mfr: string): Promise<string | null> {
  const key = mfrKey(mfr);
  if (!key) return null;
  const hit = (await allVendorProfiles()).find((p) => p.manufacturers.some((m) => mfrKey(m) === key));
  return hit ? hit.id : null;
}

/* ---------- writes ---------- */

async function writeProfile(next: VendorProfile): Promise<VendorProfile> {
  const doc = normalizeProfile({ ...next, updatedAt: now() });
  await upsertDoc<VendorProfile>("vendor_profiles", doc);
  return doc;
}

export async function saveVendorProfile(
  id: string,
  patch: Partial<Pick<VendorProfile, "discounts" | "registration" | "manufacturers" | "contactRoles">>
): Promise<VendorProfile> {
  const cur = await vendorProfileFor(id);
  return writeProfile({ ...cur, ...patch });
}

/** Append a ledger entry (spec §3 "Log price list"). Newest-first ordering is
 *  re-applied by normalizeProfile. */
export async function logPriceList(
  id: string,
  entry: { receivedAt: number; effectiveAt: number; note: string },
  loggedBy: string
): Promise<VendorProfile> {
  const cur = await vendorProfileFor(id);
  const rec: PriceListEntry = {
    id: uid("pl-"),
    receivedAt: entry.receivedAt,
    effectiveAt: entry.effectiveAt,
    note: (entry.note || "").trim(),
    loggedBy,
  };
  return writeProfile({ ...cur, priceLists: [rec, ...cur.priceLists] });
}

/** "Contact for…" per contact id; an empty role removes the entry. */
export async function setContactRole(id: string, contactId: string, role: string): Promise<VendorProfile> {
  const cur = await vendorProfileFor(id);
  const contactRoles = { ...cur.contactRoles };
  const r = (role || "").trim();
  if (r) contactRoles[contactId] = r;
  else delete contactRoles[contactId];
  return writeProfile({ ...cur, contactRoles });
}

/** A manufacturer belongs to at most one vendor — claiming MOVES it (spec §1).
 *  The spelling stored is the one claimed; matching is always by mfrKey. */
export async function claimManufacturer(vendorId: string, mfr: string): Promise<VendorProfile> {
  const spelling = (mfr || "").trim();
  const key = mfrKey(spelling);
  if (!key) throw new Error("Manufacturer name is empty.");
  const profiles = await allVendorProfiles();
  for (const p of profiles) {
    if (p.id === vendorId) continue;
    if (p.manufacturers.some((m) => mfrKey(m) === key)) {
      await writeProfile({ ...p, manufacturers: p.manufacturers.filter((m) => mfrKey(m) !== key) });
    }
  }
  const cur = profiles.find((p) => p.id === vendorId) ?? blankProfile(vendorId);
  if (cur.manufacturers.some((m) => mfrKey(m) === key)) return cur;
  return writeProfile({ ...cur, manufacturers: [...cur.manufacturers, spelling] });
}

export async function releaseManufacturer(vendorId: string, mfr: string): Promise<VendorProfile> {
  const key = mfrKey(mfr);
  const cur = await vendorProfileFor(vendorId);
  return writeProfile({ ...cur, manufacturers: cur.manufacturers.filter((m) => mfrKey(m) !== key) });
}

/**
 * New vendor company + its blank profile, through the customers seam (the
 * D85 write path: saveCompany, and — because PARTNER_TYPES carries the
 * vendor type — no base venue). Id = "v-" + mfrKey(name), suffixed only on
 * collision, so the seeded/claimed vendors get readable slugs.
 */
export async function createVendorCompany(name: string): Promise<CompanyRow> {
  const clean = (name || "").trim();
  if (!clean) throw new Error("Vendor name is empty.");
  const base = mfrKey(clean) || "vendor";
  let id = "v-" + base;
  if (await getCompany(id)) id = "v-" + base + "-" + Date.now().toString(36);
  await upsertCustomer({ id, name: clean, type: VENDOR_COMPANY_TYPE, locations: [], contacts: [] });
  const co = await getCompany(id);
  if (!co) throw new Error("Vendor company was not created.");
  await writeProfile(blankProfile(id));
  return co;
}

/** The vendor company for a manufacturer name: an existing VENDOR whose
 *  name normalizes the same (mfrKey), else a new one named after it. */
export async function vendorCompanyNamed(mfr: string): Promise<CompanyRow> {
  const key = mfrKey(mfr);
  const hit = (await vendorCompanies()).find((c) => mfrKey(c.name) === key);
  return hit ?? createVendorCompany(mfr);
}
```

- [ ] **Step 8: Regression test** — in `scripts/test-review-regressions.ts` add to the top imports (PRE-FLIGHT CORRECTION: insert after line **30**, the last import statement, immediately before `async function main()` at line 32 — line 23 is a bare identifier INSIDE the multi-line `import { … } from "@/lib/gmail/label-sync"` spanning 19-24, so inserting there is a syntax error):

```ts
import { saveCompany } from "@/lib/identity/companies";
import { sitesForCompany } from "@/lib/identity/sites";
import { VENDOR_COMPANY_TYPE } from "@/lib/identity/config";
import {
  claimManufacturer, createVendorCompany, getVendorProfile, logPriceList, saveVendorProfile,
  setContactRole, vendorForManufacturer,
} from "@/lib/stores/vendors";
```
and inside `main()`, immediately before `console.log("review regression checks passed");` (PRE-FLIGHT CORRECTION: that call is at line **1051**, not 738 — 738 lands inside an unrelated #96 test block):

```ts
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
```

- [ ] **Step 9: Run tests, expect pass** — `npx tsx scripts/test-review-and-spec.ts | grep -E '#122|ALL PASSED'` → 4 PASS + `ALL PASSED`; `npm run test:review:regressions 2>&1 | tail -3` → `review regression checks passed`; `npx tsc --noEmit -p . | tail -3` → empty; `npx eslint src/lib/stores/vendors.ts src/lib/identity/config.ts src/lib/identity/venue-defaults.ts src/db/doc-tables.ts` → clean.

- [ ] **Step 10: Commit**

```bash
git add src/db/doc-tables.ts drizzle/ src/lib/identity/config.ts src/lib/identity/venue-defaults.ts src/lib/stores/vendors.ts scripts/test-review-and-spec.ts scripts/test-review-regressions.ts
git commit -m "feat(vendors): vendor_profiles collection + idempotent migration, vendor store, exact vendor company type in PARTNER_TYPES (#122 §1)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Pure `vendor-status.ts` — status, owner tasks, catalog dating, manufacturer directory, owner resolution

**Files:**
- Create: `src/lib/vendor-status.ts`
- Modify: `src/lib/stores/vendors.ts` (replace the three type definitions with re-exports — Step 3)
- Test: `scripts/test-review-and-spec.ts` (section "#122 §2 — vendor status + owner tasks")

**Interfaces:**
- Consumes: `OUTDATED_AFTER_MS`, `effectivePriceDate(part, settings)`, `mfrKey(name)` from `@/lib/catalog-books` (catalog plan); `dateYear` (`src/lib/format.ts:30`).
- Produces (all pure):
```ts
export type PriceListEntry / VendorDiscounts / VendorRegistration            // moved here from the store
export type ManufacturerEntry = { name: string; count: number; vendorId: string | null };
export const VENDOR_STATUS_KEYS = ["no-list", "newer-list", "outdated", "current"] as const;
export type VendorStatusKey = (typeof VENDOR_STATUS_KEYS)[number];
export const VENDOR_STATUS_META: Record<VendorStatusKey, { label: string; ink: string; soft: string; bd: string }>;
export const DEFAULT_CATALOG_OWNER_NAME = "Jena Tolksdorf";
export function newestList(lists: PriceListEntry[] | undefined): PriceListEntry | null;
export function manufacturerKeySet(manufacturers: string[]): Set<string>;
export function catalogEffectiveAtFor(parts, manufacturers: string[], settings): number | null;   // NEWEST effectivePriceDate
export function partCountFor(parts: Array<{ mfr?: string }>, manufacturers: string[]): number;
export function vendorStatus(input: { lastList: PriceListEntry | null; catalogEffectiveAt: number | null; now: number }): VendorStatusKey;
export type VendorTaskSpec = { title: string; source: string };
export function vendorTaskSource(vendorId: string, status: VendorStatusKey, at: number): string;   // "auto: vendor <id> <status> <at>"
export function vendorTasks(status: VendorStatusKey, vendor: { id: string; name: string; lastList: PriceListEntry | null; catalogEffectiveAt: number | null }): VendorTaskSpec | null;
export function resolveCatalogOwner<U extends { id: string; name: string; roles: string[]; status?: string }>(catalogOwner: { userId: string } | null | undefined, users: U[]): U | null;
export function claimOwnerByKey(profiles: Array<{ id: string; manufacturers: string[] }>): Map<string, string>;  // mfrKey → vendorId
export function manufacturerDirectory(parts: Array<{ mfr?: string }>, profiles): ManufacturerEntry[];             // count-desc, first spelling wins
export function unclaimedManufacturers(parts, profiles): ManufacturerEntry[];
```

- [ ] **Step 1: Failing spec tests** — add to the top import block of `scripts/test-review-and-spec.ts`:

```ts
import { OUTDATED_AFTER_MS } from "@/lib/catalog-books";
import {
  catalogEffectiveAtFor, manufacturerDirectory, partCountFor, resolveCatalogOwner, unclaimedManufacturers,
  vendorStatus, vendorTasks, type PriceListEntry as VendorPriceListEntry,
} from "@/lib/vendor-status";
```
(If `OUTDATED_AFTER_MS` is already imported by the catalog plan's tests, keep that import and drop this one.) Then directly after the `#122 §1` block from Task 1:

```ts
/* ---- #122 §2 — vendor status + owner tasks ---- */
{
  const DAY = 86_400_000;
  const now = Date.UTC(2026, 8, 21, 12);
  const list = (effectiveAt: number): VendorPriceListEntry => ({ id: "pl-x", receivedAt: effectiveAt, effectiveAt, note: "", loggedBy: "t" });
  ok(vendorStatus({ lastList: null, catalogEffectiveAt: now, now }) === "no-list", "#122 vendorStatus: no ledger entry → no-list (even with a fresh catalog)");
  ok(vendorStatus({ lastList: list(now - DAY), catalogEffectiveAt: null, now }) === "newer-list", "#122 vendorStatus: a list but an undated catalog → newer-list");
  ok(vendorStatus({ lastList: list(now - DAY), catalogEffectiveAt: now - 2 * DAY, now }) === "newer-list", "#122 vendorStatus: list newer than the catalog → newer-list");
  ok(vendorStatus({ lastList: list(now - 2 * DAY), catalogEffectiveAt: now - DAY, now }) === "current", "#122 vendorStatus: catalog dated after the list → current");
  ok(vendorStatus({ lastList: list(now - DAY), catalogEffectiveAt: now - DAY, now }) === "current", "#122 vendorStatus: equal dates → current, not newer (strict >)");
  const edge = now - OUTDATED_AFTER_MS;
  ok(vendorStatus({ lastList: list(edge), catalogEffectiveAt: edge, now }) === "current", "#122 vendorStatus: exactly OUTDATED_AFTER_MS old is still current (boundary is strict >)");
  ok(vendorStatus({ lastList: list(edge - 1), catalogEffectiveAt: edge - 1, now }) === "outdated", "#122 vendorStatus: one ms past the threshold → outdated");
  ok(vendorStatus({ lastList: list(edge - 1), catalogEffectiveAt: now - DAY, now }) === "current", "#122 vendorStatus: a fresh catalog keeps an old list current (max of the two dates)");
  ok(vendorStatus({ lastList: list(edge - 1), catalogEffectiveAt: null, now }) === "newer-list", "#122 vendorStatus: newer-list wins over outdated when the catalog is undated");

  const t1 = vendorTasks("newer-list", { id: "v1", name: "Rose Brand", lastList: list(now - DAY), catalogEffectiveAt: null });
  ok(!!t1 && t1.title.startsWith("Update catalog: Rose Brand price list effective ") && t1.source === `auto: vendor v1 newer-list ${now - DAY}`, "#122 vendorTasks: newer-list → 'Update catalog' keyed by the list's effectiveAt");
  const t2 = vendorTasks("outdated", { id: "v1", name: "Rose Brand", lastList: list(edge - 1), catalogEffectiveAt: edge - 5 });
  ok(!!t2 && t2.title === "Request updated price list from Rose Brand" && t2.source === `auto: vendor v1 outdated ${edge - 1}`, "#122 vendorTasks: outdated → 'Request updated price list' keyed by the newer of list/catalog");
  ok(vendorTasks("current", { id: "v1", name: "X", lastList: list(now), catalogEffectiveAt: now }) === null && vendorTasks("no-list", { id: "v1", name: "X", lastList: null, catalogEffectiveAt: null }) === null, "#122 vendorTasks: current / no-list → no task");

  // `as unknown as` — the catalog plan may type this parameter as the full AppSettingsData.
  const settings0 = { priceListEffective: {} } as unknown as Parameters<typeof catalogEffectiveAtFor>[2];
  const parts = [
    { mfr: "Rose Brand", pricedAt: now - 3 * DAY },
    { mfr: "rose-brand", pricedAt: now - DAY },
    { mfr: "Other", pricedAt: now },
    { mfr: "Rose Brand" },
  ];
  ok(catalogEffectiveAtFor(parts, ["Rose Brand"], settings0) === now - DAY, "#122 catalogEffectiveAtFor: the NEWEST effective date across the vendor's manufacturers, aliases matched by mfrKey, undated parts ignored");
  ok(catalogEffectiveAtFor(parts, ["Nobody"], settings0) === null && catalogEffectiveAtFor(parts, [], settings0) === null, "#122 catalogEffectiveAtFor: no matching parts → null");
  ok(partCountFor(parts, ["ROSE BRAND"]) === 3 && partCountFor(parts, []) === 0, "#122 partCountFor counts parts by manufacturer key");

  const users = [
    { id: "u1", name: "Jeff Chesebro", roles: ["Admin", "Estimator"], status: "active" },
    { id: "u3", name: "Jena Tolksdorf", roles: ["Estimator"], status: "active" },
    { id: "u9", name: "Gone Admin", roles: ["Admin"], status: "archived" },
  ];
  ok(resolveCatalogOwner(null, users)?.id === "u3", "#122 resolveCatalogOwner: defaults to the user named Jena Tolksdorf");
  ok(resolveCatalogOwner({ userId: "u1" }, users)?.id === "u1", "#122 resolveCatalogOwner: the Settings pick wins");
  ok(resolveCatalogOwner({ userId: "u9" }, users)?.id === "u3", "#122 resolveCatalogOwner: an archived pick falls through to the default");
  ok(resolveCatalogOwner(null, users.filter((u) => u.id !== "u3"))?.id === "u1", "#122 resolveCatalogOwner: no Jena → the first active Admin");
  ok(resolveCatalogOwner(null, []) === null, "#122 resolveCatalogOwner: nobody active → null (no task is created)");

  const dir = manufacturerDirectory(parts, [{ id: "v1", manufacturers: ["rose-brand"] }]);
  ok(dir.length === 2 && dir[0].name === "Rose Brand" && dir[0].count === 3 && dir[0].vendorId === "v1" && dir[1].name === "Other" && dir[1].vendorId === null, "#122 manufacturerDirectory: grouped by mfrKey, first spelling wins, count-desc, claim owner attached");
  ok(unclaimedManufacturers(parts, [{ id: "v1", manufacturers: ["rose-brand"] }]).map((m) => m.name).join(",") === "Other", "#122 unclaimedManufacturers: only keys no vendor claims");
  ok(manufacturerDirectory([{ mfr: "" }, { mfr: "  " }, {}], []).length === 0, "#122 manufacturerDirectory: unbranded parts are not a manufacturer");
}
```

- [ ] **Step 2: Run** `npx tsx scripts/test-review-and-spec.ts 2>&1 | head -3` → `Cannot find module '@/lib/vendor-status'`.

- [ ] **Step 3: `src/lib/vendor-status.ts`**

```ts
/**
 * #122 — vendor freshness, PURE and DB-free
 * (docs/superpowers/specs/2026-09-21-vendors-module-design.md §2).
 * Imported by the store, the server pages, the daily cron AND the client tab
 * components (types + status meta), so nothing here may reach a store, the
 * DB, or a "use client" module. Dates are epoch-ms.
 *
 * Catalog dating comes from the catalog spec (#133): `effectivePriceDate`,
 * `mfrKey`, `OUTDATED_AFTER_MS` in src/lib/catalog-books.ts.
 */
import { OUTDATED_AFTER_MS, effectivePriceDate, mfrKey } from "@/lib/catalog-books";
import { dateYear } from "@/lib/format";

export type PriceListEntry = {
  id: string;
  receivedAt: number;
  effectiveAt: number;
  note: string;
  loggedBy: string;
};
export type VendorDiscounts = { note: string; percentOffList: number | null; terms: string };
export type VendorRegistration = { program: string; url: string; accountNumber: string; notes: string };

/** One catalog manufacturer (grouped by mfrKey) and which vendor claims it. */
export type ManufacturerEntry = { name: string; count: number; vendorId: string | null };

export const VENDOR_STATUS_KEYS = ["no-list", "newer-list", "outdated", "current"] as const;
export type VendorStatusKey = (typeof VENDOR_STATUS_KEYS)[number];

/** Chip colours follow the app's status-chip families (comms statusMeta). */
export const VENDOR_STATUS_META: Record<VendorStatusKey, { label: string; ink: string; soft: string; bd: string }> = {
  current: { label: "Current", ink: "#1f7a52", soft: "#eaf6ef", bd: "#cce9da" },
  "newer-list": { label: "Newer list received", ink: "#3155a8", soft: "#e9eefb", bd: "#d4ddf3" },
  outdated: { label: "Outdated", ink: "#b4543a", soft: "#f8ece7", bd: "#eccfc4" },
  "no-list": { label: "No list logged", ink: "#8c919c", soft: "#f1f2f5", bd: "#e4e7ec" },
};

/** Spec §1: the default catalog owner, by display name, when Settings has none. */
export const DEFAULT_CATALOG_OWNER_NAME = "Jena Tolksdorf";

/** The two fields this module reads off a part. Callers pass CatalogPart[]
 *  (assignable); fixtures pass literals. The cast at the effectivePriceDate
 *  call keeps this independent of how the catalog plan typed its parameter. */
export type DatedPart = { mfr?: string; pricedAt?: number };
type CatalogPartArg = Parameters<typeof effectivePriceDate>[0];
type SettingsLike = Parameters<typeof effectivePriceDate>[1];

export function newestList(lists: PriceListEntry[] | undefined): PriceListEntry | null {
  let best: PriceListEntry | null = null;
  for (const l of lists || []) if (!best || l.effectiveAt > best.effectiveAt) best = l;
  return best;
}

export function manufacturerKeySet(manufacturers: string[]): Set<string> {
  const keys = new Set<string>();
  for (const m of manufacturers) {
    const k = mfrKey(m);
    if (k) keys.add(k);
  }
  return keys;
}

/** Spec §2: `catalogEffectiveAt` = the NEWEST effectivePriceDate across parts
 *  whose mfrKey is one of the vendor's manufacturers (priceBooks() uses the
 *  oldest for the banner — different question). Null when nothing is dated. */
export function catalogEffectiveAtFor(parts: DatedPart[], manufacturers: string[], settings: SettingsLike): number | null {
  const keys = manufacturerKeySet(manufacturers);
  if (!keys.size) return null;
  let newest: number | null = null;
  for (const p of parts) {
    if (!keys.has(mfrKey(p.mfr || ""))) continue;
    const at = effectivePriceDate(p as CatalogPartArg, settings);
    if (at != null && (newest == null || at > newest)) newest = at;
  }
  return newest;
}

export function partCountFor(parts: Array<{ mfr?: string }>, manufacturers: string[]): number {
  const keys = manufacturerKeySet(manufacturers);
  if (!keys.size) return 0;
  let n = 0;
  for (const p of parts) if (keys.has(mfrKey(p.mfr || ""))) n++;
  return n;
}

export function vendorStatus(input: {
  lastList: PriceListEntry | null;
  catalogEffectiveAt: number | null;
  now: number;
}): VendorStatusKey {
  const { lastList, catalogEffectiveAt, now } = input;
  if (!lastList) return "no-list";
  if (lastList.effectiveAt > (catalogEffectiveAt ?? 0)) return "newer-list";
  if (now - Math.max(lastList.effectiveAt, catalogEffectiveAt ?? 0) > OUTDATED_AFTER_MS) return "outdated";
  return "current";
}

export type VendorTaskSpec = { title: string; source: string };

/** The dedupe key ensureVendorAssignments() matches on (spec §2). */
export function vendorTaskSource(vendorId: string, status: VendorStatusKey, at: number): string {
  return `auto: vendor ${vendorId} ${status} ${at}`;
}

export function vendorTasks(
  status: VendorStatusKey,
  vendor: { id: string; name: string; lastList: PriceListEntry | null; catalogEffectiveAt: number | null }
): VendorTaskSpec | null {
  if (status === "newer-list" && vendor.lastList) {
    return {
      title: `Update catalog: ${vendor.name} price list effective ${dateYear(vendor.lastList.effectiveAt)}`,
      source: vendorTaskSource(vendor.id, status, vendor.lastList.effectiveAt),
    };
  }
  if (status === "outdated") {
    const at = Math.max(vendor.lastList?.effectiveAt ?? 0, vendor.catalogEffectiveAt ?? 0);
    return {
      title: `Request updated price list from ${vendor.name}`,
      source: vendorTaskSource(vendor.id, status, at),
    };
  }
  return null;
}

/** Spec §1: Settings pick if still active, else "Jena Tolksdorf", else the
 *  first active Admin, else null. Generic so UserRow and test fixtures both fit. */
export function resolveCatalogOwner<U extends { id: string; name: string; roles: string[]; status?: string }>(
  catalogOwner: { userId: string } | null | undefined,
  users: U[]
): U | null {
  const active = users.filter((u) => (u.status ?? "active") === "active");
  if (catalogOwner?.userId) {
    const hit = active.find((u) => u.id === catalogOwner.userId);
    if (hit) return hit;
  }
  const named = active.find((u) => u.name === DEFAULT_CATALOG_OWNER_NAME);
  if (named) return named;
  return active.find((u) => (u.roles || []).includes("Admin")) ?? null;
}

/** mfrKey → vendor id, over every profile's aliases. */
export function claimOwnerByKey(profiles: Array<{ id: string; manufacturers: string[] }>): Map<string, string> {
  const out = new Map<string, string>();
  for (const p of profiles) {
    for (const m of p.manufacturers) {
      const k = mfrKey(m);
      if (k && !out.has(k)) out.set(k, p.id);
    }
  }
  return out;
}

/** Every catalog manufacturer (grouped by mfrKey, first spelling seen wins),
 *  with its claim owner; count-desc then name. Unbranded parts are skipped. */
export function manufacturerDirectory(
  parts: Array<{ mfr?: string }>,
  profiles: Array<{ id: string; manufacturers: string[] }>
): ManufacturerEntry[] {
  const owner = claimOwnerByKey(profiles);
  const by = new Map<string, { name: string; count: number }>();
  for (const p of parts) {
    const name = (p.mfr || "").trim();
    const key = mfrKey(name);
    if (!key) continue;
    const e = by.get(key);
    if (e) e.count += 1;
    else by.set(key, { name, count: 1 });
  }
  return [...by.entries()]
    .map(([key, e]) => ({ name: e.name, count: e.count, vendorId: owner.get(key) ?? null }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export function unclaimedManufacturers(
  parts: Array<{ mfr?: string }>,
  profiles: Array<{ id: string; manufacturers: string[] }>
): ManufacturerEntry[] {
  return manufacturerDirectory(parts, profiles).filter((m) => !m.vendorId);
}
```

Then in `src/lib/stores/vendors.ts` delete the three local type definitions (`PriceListEntry`, `VendorDiscounts`, `VendorRegistration`) and put, right after the `mfrKey` import:

```ts
import type { PriceListEntry, VendorDiscounts, VendorRegistration } from "@/lib/vendor-status";
export type { PriceListEntry, VendorDiscounts, VendorRegistration };
```

- [ ] **Step 4: Run tests, expect pass** — `npx tsx scripts/test-review-and-spec.ts | grep -E '#122|ALL PASSED'` → all `#122` lines PASS + `ALL PASSED`; `npx tsc --noEmit -p . | tail -3` → empty; `npx eslint src/lib/vendor-status.ts src/lib/stores/vendors.ts` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/vendor-status.ts src/lib/stores/vendors.ts scripts/test-review-and-spec.ts
git commit -m "feat(vendors): pure vendor status/owner-task derivation over catalog effective dates (#122 §2)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: `ensureVendorAssignments()`, `settings.catalogOwner`, the owner picker, the daily cron step

**Files:**
- Modify: `src/lib/settings.ts:103` (append a field to `AppSettingsData`)
- Create: `src/lib/vendor-tasks.ts`
- Create: `src/app/(app)/vendors/actions.ts` (`setCatalogOwnerAction`; later tasks append)
- Create: `src/app/(app)/catalog/catalog-owner-card.tsx`
- Modify: `src/app/(app)/catalog/page.tsx:1-11` (imports), `:39-44` (loads), `:417-422` (admin cards)
- Modify: `src/app/api/gmail/sync/route.ts:60-67`
- Test: `scripts/test-review-regressions.ts` (section "#122 — owner tasks are exactly-once")

**Interfaces:**
- Consumes: `list` (`src/lib/stores/catalog.ts:78`), `getSettings/setSettings` (`src/lib/settings.ts:142,148`), `activeUsers/getUser` (`src/lib/users.ts:16,20`), `allAssignments/createAssignment` (`src/lib/stores/assignments.ts:51,67`), Task 1 store, Task 2 helpers, `requirePerm` (`src/lib/session.ts:40`), `can` (`src/lib/team.ts`).
- Produces (`src/lib/vendor-tasks.ts`):
```ts
export type VendorRow = { id: string; name: string; type: string; profile: VendorProfile; partCount: number; catalogEffectiveAt: number | null; lastList: PriceListEntry | null; status: VendorStatusKey; openTask: { id: string; title: string; assignee: string } | null };
export type VendorsData = { rows: VendorRow[]; directory: Array<ManufacturerEntry & { vendorName: string }>; ownerName: string | null };
export async function loadVendors(onlyId?: string): Promise<VendorsData>;
export async function ensureVendorAssignments(vendorId?: string, by?: string): Promise<{ checked: number; created: number; owner: string | null }>;
```
- Produces (`vendors/actions.ts`): `setCatalogOwnerAction(userId: string): Promise<{ ok: true } | { ok: false; error: string }>` (`""` clears the setting).
- Produces (`settings.ts`): `AppSettingsData.catalogOwner?: { userId: string } | null`.

- [ ] **Step 1: Failing regression test** — add to the top imports of `scripts/test-review-regressions.ts`:

```ts
import { setSettings } from "@/lib/settings";
import { allAssignments, setAssignmentDone } from "@/lib/stores/assignments";
import { ensureVendorAssignments, loadVendors } from "@/lib/vendor-tasks";
```
and inside `main()`, after the Task 1 `#122` block:

```ts
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
```

- [ ] **Step 2: Run** `npm run test:review:regressions 2>&1 | tail -3` → `Cannot find module '@/lib/vendor-tasks'`.

- [ ] **Step 3: `src/lib/settings.ts`** — after line 103 (`recordingsArchiveLastRun?: …;`) add:

```ts
  /** #122 — Settings → Catalog: who receives the vendor price-list tasks
   *  (spec §1). null/absent = the default rule in resolveCatalogOwner()
   *  (the user named "Jena Tolksdorf" if present, else the first Admin). */
  catalogOwner?: { userId: string } | null;
```

- [ ] **Step 4: `src/lib/vendor-tasks.ts`**

```ts
/**
 * #122 — vendor rows + the owner's Home Queue tasks (spec §2, §4). DB-backed:
 * ONE catalog read, ONE profiles read, one assignments read per call, so the
 * daily cron over every vendor is bounded. The derivation itself is pure
 * (lib/vendor-status.ts).
 */
import { list as listParts } from "@/lib/stores/catalog";
import { getSettings } from "@/lib/settings";
import { activeUsers } from "@/lib/users";
import { allAssignments, createAssignment, type Assignment } from "@/lib/stores/assignments";
import { allVendorProfiles, blankProfile, vendorCompanies, type VendorProfile } from "@/lib/stores/vendors";
import {
  catalogEffectiveAtFor,
  manufacturerDirectory,
  newestList,
  partCountFor,
  resolveCatalogOwner,
  vendorStatus,
  vendorTasks,
  type ManufacturerEntry,
  type PriceListEntry,
  type VendorStatusKey,
} from "@/lib/vendor-status";

export type VendorRow = {
  id: string;
  name: string;
  type: string;
  profile: VendorProfile;
  partCount: number;
  catalogEffectiveAt: number | null;
  lastList: PriceListEntry | null;
  status: VendorStatusKey;
  /** Newest OPEN auto task for this vendor (any status key) — the list's
   *  "owner task" column and the detail header. */
  openTask: { id: string; title: string; assignee: string } | null;
};

export type VendorsData = {
  rows: VendorRow[];
  /** Every catalog manufacturer with its claim owner (name resolved). */
  directory: Array<ManufacturerEntry & { vendorName: string }>;
  /** Display name of the resolved catalog owner, null when nobody is active. */
  ownerName: string | null;
};

type Context = VendorsData & { assignments: Assignment[] };

const autoPrefix = (vendorId: string) => `auto: vendor ${vendorId} `;

async function loadContext(onlyId?: string): Promise<Context> {
  const [companies, profiles, parts, settings, assignments, users] = await Promise.all([
    vendorCompanies(),
    allVendorProfiles(),
    listParts(),
    getSettings(),
    allAssignments(),
    activeUsers(),
  ]);
  const now = Date.now();
  const profileById = new Map(profiles.map((p) => [p.id, p]));
  const nameById = new Map(companies.map((c) => [c.id, c.name]));
  const rows: VendorRow[] = companies
    .filter((c) => !onlyId || c.id === onlyId)
    .map((c) => {
      const profile = profileById.get(c.id) ?? blankProfile(c.id);
      const lastList = newestList(profile.priceLists);
      const catalogEffectiveAt = catalogEffectiveAtFor(parts, profile.manufacturers, settings);
      const status = vendorStatus({ lastList, catalogEffectiveAt, now });
      const open = assignments
        .filter((a) => !a.done && a.source.startsWith(autoPrefix(c.id)))
        .sort((a, b) => b.createdAt - a.createdAt)[0];
      return {
        id: c.id,
        name: c.name,
        type: c.type,
        profile,
        partCount: partCountFor(parts, profile.manufacturers),
        catalogEffectiveAt,
        lastList,
        status,
        openTask: open ? { id: open.id, title: open.title, assignee: open.assignee } : null,
      };
    });
  const directory = manufacturerDirectory(parts, profiles).map((m) => ({
    ...m,
    vendorName: m.vendorId ? (nameById.get(m.vendorId) ?? m.vendorId) : "",
  }));
  const owner = resolveCatalogOwner(settings.catalogOwner, users);
  return { rows, directory, ownerName: owner?.name ?? null, assignments };
}

export async function loadVendors(onlyId?: string): Promise<VendorsData> {
  const { rows, directory, ownerName } = await loadContext(onlyId);
  return { rows, directory, ownerName };
}

/**
 * Spec §2: zero or one task per vendor, created AT MOST ONCE per
 * `source` key ("auto: vendor <id> <status> <effectiveAt>") — skipped when
 * any assignment with that key exists, open OR done, so a completed task is
 * never re-opened and a second save never duplicates. Runs after a ledger
 * save (logPriceListAction) and inside the daily cron route.
 */
export async function ensureVendorAssignments(
  vendorId?: string,
  by = "Quartzite"
): Promise<{ checked: number; created: number; owner: string | null }> {
  const ctx = await loadContext(vendorId);
  const seen = new Set(ctx.assignments.map((a) => a.source));
  let created = 0;
  for (const r of ctx.rows) {
    const spec = vendorTasks(r.status, r);
    if (!spec || seen.has(spec.source) || !ctx.ownerName) continue;
    await createAssignment({
      title: spec.title,
      assignee: ctx.ownerName,
      createdBy: by,
      link: { kind: "company", id: r.id, label: r.name },
      source: spec.source,
    });
    seen.add(spec.source);
    created++;
  }
  return { checked: ctx.rows.length, created, owner: ctx.ownerName };
}
```

- [ ] **Step 5: `src/app/(app)/vendors/actions.ts`**

```ts
"use server";

/**
 * #122 — Vendors module server actions
 * (docs/superpowers/specs/2026-09-21-vendors-module-design.md §3). Every
 * action requires a session; vendor edits require the "create" permission;
 * the catalog-owner setting is an admin write like every other Settings
 * action (settings/actions.ts saveSettingsAction).
 */
import { revalidatePath } from "next/cache";
import { requirePerm } from "@/lib/session";
import { getUser } from "@/lib/users";
import { setSettings } from "@/lib/settings";

type R = { ok: true } | { ok: false; error: string };
const revalidate = () => revalidatePath("/", "layout");

/** Settings → Catalog: who receives the vendor price-list tasks. "" clears
 *  the pick (back to the default rule — resolveCatalogOwner). */
export async function setCatalogOwnerAction(userId: string): Promise<R> {
  await requirePerm("manage_users");
  const id = (userId || "").trim();
  if (!id) {
    await setSettings({ catalogOwner: null });
    revalidate();
    return { ok: true };
  }
  const u = await getUser(id);
  if (!u || u.status !== "active") return { ok: false, error: "Pick an active team member." };
  await setSettings({ catalogOwner: { userId: u.id } });
  revalidate();
  return { ok: true };
}
```

- [ ] **Step 6: `src/app/(app)/catalog/catalog-owner-card.tsx`** (client; the Settings → Admin → Catalog surface — Settings' Admin section only links to `/catalog`, `settings-sections.ts:22-28`)

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setCatalogOwnerAction } from "@/app/(app)/vendors/actions";

/**
 * #122 — admin picker for the catalog owner: the teammate whose Home Queue
 * receives "Update catalog" / "Request updated price list" tasks (spec §1).
 * Sits with the other admin cards on /catalog (Settings → Admin → Catalog).
 */
export function CatalogOwnerCard({
  value,
  options,
  effectiveName,
}: {
  /** stored settings.catalogOwner.userId, "" when unset */
  value: string;
  options: Array<{ value: string; label: string }>;
  /** who the rule resolves to today (the pick, else Jena Tolksdorf, else the first Admin) */
  effectiveName: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const change = (v: string) =>
    start(async () => {
      setErr("");
      const res = await setCatalogOwnerAction(v);
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      router.refresh();
    });
  return (
    <div style={{ marginTop: 18, border: "1px solid #ececf0", borderRadius: 12, background: "#fff", padding: "15px 18px", boxShadow: "0 1px 2px rgba(0,0,0,.04)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 13.5, fontWeight: 700 }}>Catalog owner</div>
          <div style={{ marginTop: 3, color: "#8c919c", fontSize: 11.5 }}>
            Gets the Home Queue task when a vendor sends a newer price list or a list goes stale. Currently: <b style={{ color: "#3a3f4a" }}>{effectiveName || "nobody (no active team member)"}</b>.
          </div>
        </div>
        <select
          value={value}
          disabled={pending}
          onChange={(e) => change(e.target.value)}
          style={{ fontFamily: "var(--font-ui)", fontSize: 12.5, fontWeight: 500, color: "#16181d", border: "1px solid #e4e7ec", borderRadius: 8, padding: "7px 26px 7px 10px", background: "#fff", cursor: "pointer", minWidth: 200 }}
        >
          <option value="">Default (Jena Tolksdorf, else first Admin)</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>
      {err && <div style={{ marginTop: 8, fontSize: 12, color: "#b4543a" }}>{err}</div>}
    </div>
  );
}
```

- [ ] **Step 7: `src/app/(app)/catalog/page.tsx`** — add imports after line 11:

```ts
import { activeUsers } from "@/lib/users";
import { resolveCatalogOwner } from "@/lib/vendor-status";
import { CatalogOwnerCard } from "./catalog-owner-card";
```
Change the load (lines 39-44) to:

```ts
  const [user, sp, parts, settings, users] = await Promise.all([
    requireUser(),
    searchParams,
    list(),
    getSettings(),
    activeUsers(),
  ]);
  const isAdmin = can("manage_users", user.roles);
  const catalogOwner = resolveCatalogOwner(settings.catalogOwner, users);
```
and the admin block (lines 417-422) to:

```tsx
      {isAdmin && (
        <>
          <TaxonomyCard categories={categories} initialMap={resolveCategoryMap(settings.catalogCategoryMap)} />
          <CatalogOwnerCard
            value={settings.catalogOwner?.userId || ""}
            options={users.map((u) => ({ value: u.id, label: u.name }))}
            effectiveName={catalogOwner?.name || ""}
          />
          <CatalogDangerZone count={parts.length} />
        </>
      )}
```

- [ ] **Step 8: `src/app/api/gmail/sync/route.ts`** — add the import after line 6:

```ts
import { ensureVendorAssignments } from "@/lib/vendor-tasks";
```
and replace lines 60-67 with:

```ts
  let recordingsArchive: Awaited<ReturnType<typeof archiveRecordings>> | { error: string };
  try {
    recordingsArchive = await archiveRecordings();
  } catch (err) {
    recordingsArchive = { error: (err as Error).message };
  }

  // #122 — vendor price-list freshness (spec §4): one catalog read, one
  // profiles read, at most one new Home Queue task per (vendor, status,
  // date) key. Own try/catch like the other riders on this daily trigger.
  let vendors: Awaited<ReturnType<typeof ensureVendorAssignments>> | { error: string };
  try {
    vendors = await ensureVendorAssignments(undefined, "Quartzite (daily check)");
  } catch (err) {
    vendors = { error: (err as Error).message };
  }

  return NextResponse.json({ ...r, googleTasks, recordings, recordingsArchive, vendors });
```
Also extend the route's doc comment (after the Recordings paragraph, line 34): `* #122 adds ensureVendorAssignments() the same way — the vendor spec's "daily cron" is this route.`

- [ ] **Step 9: Run tests, expect pass** — `npm run test:review:regressions 2>&1 | tail -3` → `review regression checks passed`; `npx tsc --noEmit -p . | tail -3` → empty; `npx eslint src/lib/vendor-tasks.ts "src/app/(app)/vendors/actions.ts" "src/app/(app)/catalog/catalog-owner-card.tsx" "src/app/(app)/catalog/page.tsx" src/app/api/gmail/sync/route.ts` → clean.

- [ ] **Step 10: Commit**

```bash
git add src/lib/settings.ts src/lib/vendor-tasks.ts "src/app/(app)/vendors/actions.ts" "src/app/(app)/catalog/catalog-owner-card.tsx" "src/app/(app)/catalog/page.tsx" src/app/api/gmail/sync/route.ts scripts/test-review-regressions.ts
git commit -m "feat(vendors): exactly-once owner tasks from vendor status, catalog-owner setting + picker, daily cron step (#122 §2, §4)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: `/vendors` list — table, status/search filters, unclaimed-manufacturer claims, "+ New vendor"

**Files:**
- Modify: `src/app/(app)/vendors/actions.ts` (append `createVendorAction`, `claimManufacturerAction`)
- Create: `src/app/(app)/vendors/page.tsx`
- Create: `src/app/(app)/vendors/controls.tsx`
- Test: `scripts/test-review-regressions.ts` (section "#122 — claim from the unclaimed panel") — the page itself is covered by `test:smoke` in Task 7

**Interfaces:**
- Consumes: `loadVendors` (Task 3), `VENDOR_STATUS_KEYS/META` (Task 2), `claimManufacturer/vendorCompanyNamed/createVendorCompany` (Task 1), `getCompany` (`src/lib/identity/companies.ts`), `isVendorType`, `dateYear` (`src/lib/format.ts`).
- Produces (`vendors/actions.ts`):
```ts
createVendorAction(name: string): Promise<{ ok: true; id: string } | { ok: false; error: string }>
claimManufacturerAction(vendorId: string | null, mfr: string): Promise<{ ok: true; id: string } | { ok: false; error: string }>  // null → the vendor named after the manufacturer (created if none)
```
- URL contract: `/vendors?q=<text>&status=<no-list|newer-list|outdated|current>&new=1`.

- [ ] **Step 1: Failing regression test** — add `vendorCompanyNamed` to the `@/lib/stores/vendors` import in `scripts/test-review-regressions.ts` and append inside `main()` after the Task 3 block:

```ts
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
```

- [ ] **Step 2: Run** `npm run test:review:regressions 2>&1 | tail -3` → passes already (store-level; the action is a thin wrapper). Keep the test — it pins the panel's contract.

- [ ] **Step 3: Append to `src/app/(app)/vendors/actions.ts`** (add these imports at the top, below the existing ones):

```ts
import { getCompany } from "@/lib/identity/companies";
import { isVendorType } from "@/lib/identity/config";
import { claimManufacturer, createVendorCompany, vendorCompanyNamed } from "@/lib/stores/vendors";
```
and the actions:

```ts
/** "+ New vendor" — the Companies quick-add path (customers-store upsert)
 *  with the vendor type preset; lands on the new vendor's page. */
export async function createVendorAction(
  name: string
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  await requirePerm("create");
  const clean = (name || "").trim();
  if (!clean) return { ok: false, error: "Enter the vendor's name." };
  try {
    const co = await createVendorCompany(clean);
    revalidate();
    return { ok: true, id: co.id };
  } catch (err) {
    console.error("createVendorAction", err);
    return { ok: false, error: "Couldn't create that vendor — please try again." };
  }
}

/** Claim a catalog manufacturer for a vendor (spec §1: one owner per
 *  manufacturer — claiming moves it). `vendorId === null` = the unclaimed
 *  panel's one-click claim: the vendor named after the manufacturer, created
 *  when no vendor's name normalizes to it. */
export async function claimManufacturerAction(
  vendorId: string | null,
  mfr: string
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  await requirePerm("create");
  const name = (mfr || "").trim();
  if (!name) return { ok: false, error: "Pick a manufacturer." };
  try {
    const co = vendorId ? await getCompany(vendorId) : await vendorCompanyNamed(name);
    if (!co || !isVendorType(co.type)) return { ok: false, error: "That company isn't a vendor." };
    await claimManufacturer(co.id, name);
    revalidate();
    return { ok: true, id: co.id };
  } catch (err) {
    console.error("claimManufacturerAction", err);
    return { ok: false, error: "Couldn't claim that manufacturer — please try again." };
  }
}
```

- [ ] **Step 4: `src/app/(app)/vendors/controls.tsx`** (client)

```tsx
"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { VENDOR_STATUS_KEYS, VENDOR_STATUS_META, type VendorStatusKey } from "@/lib/vendor-status";
import { claimManufacturerAction, createVendorAction } from "./actions";

/**
 * #122 — client bits for /vendors: the search + status filter bar
 * (URL-as-state, debounced — the Companies FilterBar idiom), the "+ New
 * vendor" quick-add, and the "Unclaimed manufacturers" panel's one-click
 * claims. Display + server-action calls only: no store imports.
 */

const INPUT: React.CSSProperties = {
  flex: 1,
  border: "none",
  background: "transparent",
  fontSize: 13.5,
  fontFamily: "var(--font-ui)",
  color: "#16181d",
  outline: "none",
};
const BTN: React.CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 12,
  fontWeight: 600,
  color: "#3a3f4a",
  background: "#fff",
  border: "1px solid #e4e7ec",
  borderRadius: 8,
  padding: "7px 11px",
  cursor: "pointer",
};
const SELECT: React.CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 12,
  color: "#16181d",
  border: "1px solid #e4e7ec",
  borderRadius: 8,
  padding: "6px 8px",
  background: "#fff",
  maxWidth: 220,
};

export function VendorFilterBar({
  q,
  status,
  counts,
  total,
}: {
  q: string;
  status: VendorStatusKey | "all";
  counts: Record<VendorStatusKey, number>;
  total: number;
}) {
  const router = useRouter();
  const [text, setText] = useState(q);
  const [prevQ, setPrevQ] = useState(q);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Derived-state reset during render (companies/controls.tsx idiom) — no effect.
  if (prevQ !== q) {
    setPrevQ(q);
    setText(q);
  }
  const pushWith = (patch: { q?: string; status?: string }) => {
    const p = new URLSearchParams();
    const nq = patch.q !== undefined ? patch.q : text;
    const ns = patch.status !== undefined ? patch.status : status;
    if (nq.trim()) p.set("q", nq.trim());
    if (ns && ns !== "all") p.set("status", ns);
    const s = p.toString();
    router.push("/vendors" + (s ? "?" + s : ""));
  };
  const onSearch = (v: string) => {
    setText(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => pushWith({ q: v }), 300);
  };
  const chips: Array<{ key: VendorStatusKey | "all"; label: string; n: number }> = [
    { key: "all", label: "All", n: total },
    ...VENDOR_STATUS_KEYS.map((k) => ({ key: k, label: VENDOR_STATUS_META[k].label, n: counts[k] })),
  ];
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9, background: "#fff", border: "1px solid #e4e7ec", borderRadius: 9, padding: "9px 12px" }}>
        <input value={text} onChange={(e) => onSearch(e.target.value)} placeholder="Search vendors and manufacturers…" style={INPUT} />
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 11, flexWrap: "wrap" }}>
        {chips.map((c) => {
          const on = status === c.key;
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => pushWith({ status: c.key })}
              style={{
                fontSize: 12,
                fontWeight: 600,
                borderRadius: 20,
                padding: "6px 12px",
                cursor: "pointer",
                border: on ? "1px solid var(--accent)" : "1px solid #e4e7ec",
                background: on ? "color-mix(in srgb, var(--accent) 12%, #fff)" : "#fff",
                color: on ? "color-mix(in srgb, var(--accent) 68%, #000)" : "#5b616e",
              }}
            >
              {c.label} <span style={{ fontFamily: "var(--font-mono)", fontWeight: 500, color: "#9aa0ab" }}>{c.n}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function NewVendorForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();
  const submit = () => {
    const n = name.trim();
    if (!n) {
      setErr("Enter the vendor's name.");
      return;
    }
    start(async () => {
      setErr("");
      const res = await createVendorAction(n);
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      router.push(`/vendors/${encodeURIComponent(res.id)}`);
      router.refresh();
    });
  };
  return (
    <div className="pk-card" style={{ padding: "14px 18px", marginBottom: 14 }}>
      <div style={{ fontSize: 13.5, fontWeight: 600 }}>New vendor</div>
      <div style={{ fontSize: 11.5, color: "#8c919c", marginTop: 2 }}>
        Creates a company typed vendor/manufacturer. Claim its manufacturers and add contacts on the vendor page.
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          placeholder="e.g. Rose Brand"
          autoFocus
          style={{ ...INPUT, flex: "1 1 260px", border: "1px solid #e4e7ec", borderRadius: 9, padding: "9px 11px", background: "#fff" }}
        />
        <button type="button" className="pk-btn-accent" disabled={pending} onClick={submit}>
          {pending ? "Creating…" : "Create vendor"}
        </button>
        <Link href="/vendors" style={{ ...BTN, textDecoration: "none", display: "inline-flex", alignItems: "center" }}>
          Cancel
        </Link>
      </div>
      {err && <div style={{ marginTop: 8, fontSize: 12, color: "#b4543a" }}>{err}</div>}
    </div>
  );
}

export function UnclaimedPanel({
  items,
  vendors,
}: {
  items: Array<{ name: string; count: number }>;
  vendors: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  /** per-manufacturer target: "" = a vendor named after the manufacturer */
  const [target, setTarget] = useState<Record<string, string>>({});
  const claim = (name: string) =>
    start(async () => {
      setErr("");
      const res = await claimManufacturerAction(target[name] || null, name);
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      router.push(`/vendors/${encodeURIComponent(res.id)}`);
      router.refresh();
    });
  return (
    <div className="pk-card" style={{ padding: 0, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px 12px", borderBottom: "1px solid #f0f1f4" }}>
        <div style={{ fontSize: 14.5, fontWeight: 600 }}>Unclaimed manufacturers</div>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "#9aa0ab" }}>{items.length}</span>
      </div>
      {items.map((m) => (
        <div key={m.name} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 18px", borderBottom: "1px solid #f5f6f8", flexWrap: "wrap" }}>
          <span style={{ flex: "1 1 160px", minWidth: 0, fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.name}</span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "#9aa0ab" }}>{m.count} part{m.count === 1 ? "" : "s"}</span>
          <select value={target[m.name] || ""} onChange={(e) => setTarget((t) => ({ ...t, [m.name]: e.target.value }))} style={SELECT}>
            <option value="">New vendor “{m.name}”</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>{v.name}</option>
            ))}
          </select>
          <button type="button" style={BTN} disabled={pending} onClick={() => claim(m.name)}>
            Claim
          </button>
        </div>
      ))}
      {items.length === 0 && (
        <div style={{ padding: "22px 18px", textAlign: "center", color: "#9aa0ab", fontSize: 12.5 }}>
          Every catalog manufacturer is claimed by a vendor.
        </div>
      )}
      {err && <div style={{ padding: "8px 18px 12px", fontSize: 12, color: "#b4543a" }}>{err}</div>}
    </div>
  );
}
```

- [ ] **Step 5: `src/app/(app)/vendors/page.tsx`** (server)

```tsx
import Link from "next/link";
import { requireUser } from "@/lib/session";
import { loadVendors } from "@/lib/vendor-tasks";
import { VENDOR_STATUS_KEYS, VENDOR_STATUS_META, type VendorStatusKey } from "@/lib/vendor-status";
import { dateYear } from "@/lib/format";
import { mono } from "@/app/(app)/companies/lib";
import { NewVendorForm, UnclaimedPanel, VendorFilterBar } from "./controls";

export const metadata = { title: "Vendors — Quartzite-6" };

function one(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] ?? "" : v ?? "";
}

const CSS = `
  .vn-row:hover { background: #fafbff; }
  .vn-grid { display: grid; grid-template-columns: minmax(0,1.3fr) minmax(0,1.4fr) 52px 108px 150px 132px minmax(0,1fr); gap: 10px; align-items: center; }
  @media (max-width: 900px) {
    .vn-grid { grid-template-columns: minmax(0,1.3fr) 108px 132px; }
    .vn-wide { display: none !important; }
  }
`;

export default async function VendorsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [, sp, data] = await Promise.all([requireUser(), searchParams, loadVendors()]);
  const q = one(sp.q).trim();
  const statusParam = one(sp.status);
  const status: VendorStatusKey | "all" = (VENDOR_STATUS_KEYS as readonly string[]).includes(statusParam)
    ? (statusParam as VendorStatusKey)
    : "all";
  const isNew = one(sp.new) === "1";

  const ql = q.toLowerCase();
  const rows = data.rows.filter((r) => {
    if (status !== "all" && r.status !== status) return false;
    if (ql && !(r.name + " " + r.profile.manufacturers.join(" ")).toLowerCase().includes(ql)) return false;
    return true;
  });
  const counts = Object.fromEntries(
    VENDOR_STATUS_KEYS.map((k) => [k, data.rows.filter((r) => r.status === k).length])
  ) as Record<VendorStatusKey, number>;
  const unclaimed = data.directory.filter((m) => !m.vendorId).map((m) => ({ name: m.name, count: m.count }));

  const th: React.CSSProperties = { fontSize: 10, fontWeight: 600, color: "#aab0bb", textTransform: "uppercase", letterSpacing: ".04em" };
  const cell: React.CSSProperties = { fontSize: 12.5, color: "#3a3f4a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };

  return (
    <div className="pk-content" style={{ maxWidth: 1080, margin: "0 auto" }}>
      <style>{CSS}</style>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 9 }}>
          <span style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-.015em" }}>Vendors</span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "#9aa0ab" }}>{data.rows.length}</span>
          <span style={{ fontSize: 12, color: "#8c919c" }}>
            Catalog owner: <b style={{ color: "#3a3f4a" }}>{data.ownerName || "nobody"}</b>
            {" · "}
            <Link href="/catalog" style={{ color: "var(--accent)", textDecoration: "none" }}>change in Catalog</Link>
          </span>
        </div>
        <Link
          href="/vendors?new=1"
          style={{ fontSize: 12.5, fontWeight: 600, color: "#fff", background: "var(--accent)", borderRadius: 8, padding: "9px 14px", textDecoration: "none" }}
        >
          + New vendor
        </Link>
      </div>

      {isNew && <NewVendorForm />}

      <VendorFilterBar q={q} status={status} counts={counts} total={data.rows.length} />

      <div className="pk-card" style={{ padding: 0, overflow: "hidden", marginBottom: 18 }}>
        <div className="vn-grid" style={{ padding: "9px 18px", background: "#fafbfc", borderBottom: "1px solid #f0f1f4" }}>
          <span style={th}>Vendor</span>
          <span className="vn-wide" style={th}>Manufacturers</span>
          <span className="vn-wide" style={{ ...th, textAlign: "right" }}>Parts</span>
          <span style={th}>Catalog priced</span>
          <span className="vn-wide" style={th}>Last list rec’d / eff.</span>
          <span style={th}>Status</span>
          <span className="vn-wide" style={th}>Owner task</span>
        </div>
        {rows.map((r) => {
          const sm = VENDOR_STATUS_META[r.status];
          return (
            <div key={r.id} className="vn-row vn-grid" style={{ padding: "12px 18px", borderBottom: "1px solid #f5f6f8" }}>
              <Link href={`/vendors/${encodeURIComponent(r.id)}`} style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, textDecoration: "none", color: "inherit" }}>
                <span style={{ width: 32, height: 32, borderRadius: 8, background: "#f1f2f5", color: "#5b616e", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 11.5, fontFamily: "var(--font-mono)", flexShrink: 0 }}>
                  {mono(r.name)}
                </span>
                <span style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.name}</span>
              </Link>
              <span className="vn-wide" style={{ display: "flex", gap: 4, flexWrap: "wrap", minWidth: 0 }}>
                {r.profile.manufacturers.map((m) => (
                  <span key={m} style={{ fontSize: 10.5, fontWeight: 600, color: "#5b616e", background: "#f1f2f5", border: "1px solid #e4e7ec", padding: "2px 8px", borderRadius: 20, whiteSpace: "nowrap" }}>
                    {m}
                  </span>
                ))}
                {r.profile.manufacturers.length === 0 && <span style={{ fontSize: 12, color: "#aab0bb" }}>none claimed</span>}
              </span>
              <span className="vn-wide" style={{ ...cell, fontFamily: "var(--font-mono)", textAlign: "right" }}>{r.partCount}</span>
              <span style={cell}>{dateYear(r.catalogEffectiveAt)}</span>
              <span className="vn-wide" style={cell}>
                {r.lastList ? `${dateYear(r.lastList.receivedAt)} / ${dateYear(r.lastList.effectiveAt)}` : "—"}
              </span>
              <span>
                <span style={{ display: "inline-block", fontSize: 10.5, fontWeight: 600, color: sm.ink, background: sm.soft, border: `1px solid ${sm.bd}`, padding: "3px 9px", borderRadius: 20, whiteSpace: "nowrap" }}>
                  {sm.label}
                </span>
              </span>
              <span className="vn-wide" style={{ minWidth: 0 }}>
                {r.openTask ? (
                  <Link
                    href={`/queue?who=${encodeURIComponent(r.openTask.assignee)}`}
                    title={`${r.openTask.title} — ${r.openTask.assignee}`}
                    style={{ ...cell, display: "block", color: "var(--accent)", textDecoration: "none", fontWeight: 600 }}
                  >
                    {r.openTask.title}
                  </Link>
                ) : (
                  <span style={{ fontSize: 12, color: "#aab0bb" }}>—</span>
                )}
              </span>
            </div>
          );
        })}
        {rows.length === 0 && (
          <div style={{ padding: "44px 22px", textAlign: "center", color: "#9aa0ab", fontSize: 13 }}>
            {data.rows.length === 0
              ? "No vendors yet — claim a manufacturer below or add one with + New vendor."
              : ql
                ? `No vendors match “${q}”.`
                : "No vendors in this status."}
          </div>
        )}
      </div>

      <UnclaimedPanel items={unclaimed} vendors={data.rows.map((r) => ({ id: r.id, name: r.name }))} />
    </div>
  );
}
```

- [ ] **Step 6: Verify** — `npx tsc --noEmit -p . | tail -3` → empty; `npx eslint "src/app/(app)/vendors/"` → clean; `npm run test:review:regressions 2>&1 | tail -3` → passed. (The controller smokes `/vendors` after Task 7 adds it to the route list.)

- [ ] **Step 7: Commit**

```bash
git add "src/app/(app)/vendors/actions.ts" "src/app/(app)/vendors/page.tsx" "src/app/(app)/vendors/controls.tsx" scripts/test-review-regressions.ts
git commit -m "feat(vendors): /vendors list with status + search filters, unclaimed-manufacturer claims, + New vendor (#122 §3)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: `/vendors/[id]` — header, Overview / Contacts / Price lists / Activity tabs, edit actions

**Files:**
- Modify: `src/app/(app)/vendors/actions.ts` (append `saveVendorProfileAction`, `logPriceListAction`, `setContactRoleAction`, `releaseManufacturerAction`)
- Create: `src/app/(app)/vendors/tabs.ts`, `src/app/(app)/vendors/dates.ts`
- Create: `src/app/(app)/vendors/[id]/page.tsx`
- Create: `src/app/(app)/vendors/[id]/overview-tab.tsx`, `contacts-tab.tsx`, `price-lists-tab.tsx`
- Modify: `src/app/(app)/companies/edit-modal.tsx:433-444` (type select keeps a stored type that isn't in `CUSTOMER_TYPES`)
- Test: `scripts/test-review-and-spec.ts` (section "#122 §3 — tab keys + date bridge"); routes smoked in Task 7

**Interfaces:**
- Consumes: `loadVendors` (Task 3), store writes (Task 1), `ensureVendorAssignments` (Task 3), `get as getCustomer` (`src/lib/stores/customers.ts:368`), `contactsForCompany/emailsForContacts/phonesForContacts/displayName/getContact` (`src/lib/identity/contacts.ts`), `loadCustomerFeed` (`src/lib/customer-feed.ts:37`), `groupRows` (`src/lib/feed-buckets.ts:43`), `ActivityComposer` (`src/app/(app)/companies/[id]/activity-composer.tsx`), `EntityQuickAdd` (`src/components/entity-quick-add.tsx`), `quickAddContactAction` (`src/app/(app)/inbox/link-actions.ts:173`), `ACCENT_INK/ACCENT_SOFT/mono/typeColor` (`src/app/(app)/companies/lib.ts`).
- Produces (`vendors/actions.ts`):
```ts
saveVendorProfileAction(id: string, patch: { discounts?: VendorDiscounts; registration?: VendorRegistration }): Promise<R>
logPriceListAction(vendorId: string, input: { receivedAt: number; effectiveAt: number; note: string }): Promise<R>   // then ensureVendorAssignments(vendorId, me.name)
setContactRoleAction(vendorId: string, contactId: string, role: string): Promise<R>
releaseManufacturerAction(vendorId: string, mfr: string): Promise<R>
```
- Produces (`tabs.ts`): `VENDOR_TABS = ["overview","contacts","prices","activity"] as const`, `VendorTab`, `VENDOR_TAB_LABEL`, `resolveVendorTab(param: string): VendorTab`.
- Produces (`dates.ts`): `toDateInput(ts: number | null): string`, `fromDateInput(s: string): number | null` (the `companies/edit-modal.tsx:114-125` bridge, exported).
- Produces (`contacts-tab.tsx`): `export type VendorContactVM = { id: string; name: string; title: string; email: string; phone: string; primary: boolean; role: string }`.
- URL contract: `/vendors/<id>?tab=overview|contacts|prices|activity`; "New email" → `/inbox?customer=<id>`, "Log call" → `/inbox?customer=<id>&log=1` (Task 6 wires the Inbox side).

- [ ] **Step 1: Failing spec test** — add to the top imports of `scripts/test-review-and-spec.ts`:

```ts
import { VENDOR_TABS, resolveVendorTab } from "@/app/(app)/vendors/tabs";
import { fromDateInput as vendorFromDateInput, toDateInput as vendorToDateInput } from "@/app/(app)/vendors/dates";
```
and after the `#122 §2` block:

```ts
/* ---- #122 §3 — tab keys + date bridge ---- */
ok(VENDOR_TABS.join(",") === "overview,contacts,prices,activity", "#122 vendor tabs are the spec's four");
ok(resolveVendorTab("prices") === "prices" && resolveVendorTab("") === "overview" && resolveVendorTab("nope") === "overview", "#122 resolveVendorTab validates ?tab= (default overview)");
ok(vendorToDateInput(new Date(2026, 8, 21, 15).getTime()) === "2026-09-21", "#122 toDateInput renders local Y-M-D");
ok(vendorFromDateInput("2026-09-21") === new Date(2026, 8, 21).getTime() && vendorFromDateInput("") === null && vendorFromDateInput("2026-09") === null, "#122 fromDateInput → local midnight, null on blank/malformed");
```

- [ ] **Step 2: Run** → `Cannot find module '@/app/(app)/vendors/tabs'`.

- [ ] **Step 3: pure helpers**

`src/app/(app)/vendors/tabs.ts`:
```ts
/**
 * #122 — vendor detail tab keys. Dependency-free VALUE module so both the
 * server route (validates ?tab=) and client components can import it (the
 * engagements/tabs.ts idiom — never export these from a "use client" file).
 */
export const VENDOR_TABS = ["overview", "contacts", "prices", "activity"] as const;
export type VendorTab = (typeof VENDOR_TABS)[number];

export const VENDOR_TAB_LABEL: Record<VendorTab, string> = {
  overview: "Overview",
  contacts: "Contacts",
  prices: "Price lists",
  activity: "Activity",
};

export function resolveVendorTab(param: string): VendorTab {
  return (VENDOR_TABS as readonly string[]).includes(param) ? (param as VendorTab) : "overview";
}
```

`src/app/(app)/vendors/dates.ts`:
```ts
/** <input type="date"> ⇄ epoch-ms bridge (local Date parts, TZ-safe) — the
 *  companies/edit-modal.tsx #23 helpers, exported so the price-list form and
 *  the server page share one implementation. Generic date VALUES store local
 *  midnight. */
export function toDateInput(ts: number | null): string {
  if (!ts) return "";
  const d = new Date(ts);
  const p = (x: number) => String(x).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}

export function fromDateInput(s: string): number | null {
  if (!s) return null;
  const p = s.split("-");
  if (p.length !== 3) return null;
  return new Date(+p[0], +p[1] - 1, +p[2]).getTime();
}
```

- [ ] **Step 4: Append to `src/app/(app)/vendors/actions.ts`** — imports (add to the existing import lines):

```ts
import { getContact } from "@/lib/identity/contacts";
import { logPriceList, releaseManufacturer, saveVendorProfile, setContactRole } from "@/lib/stores/vendors";
import type { VendorDiscounts, VendorRegistration } from "@/lib/vendor-status";
import { ensureVendorAssignments } from "@/lib/vendor-tasks";
```
(merge with the existing `@/lib/stores/vendors` import so each module is imported once; `requirePerm` — which calls `requireUser` — is already imported from Task 3), then:

```ts
const TEXT_MAX = 2000;
const clip = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, TEXT_MAX) : "");

async function vendorOr(id: string): Promise<{ ok: false; error: string } | null> {
  const co = await getCompany(id);
  if (!co || !isVendorType(co.type)) return { ok: false, error: "Vendor not found." };
  return null;
}

/** Overview tab — discounts + project registration (spec §3). */
export async function saveVendorProfileAction(
  id: string,
  patch: { discounts?: VendorDiscounts; registration?: VendorRegistration }
): Promise<R> {
  await requirePerm("create");
  const missing = await vendorOr(id);
  if (missing) return missing;
  const clean: { discounts?: VendorDiscounts; registration?: VendorRegistration } = {};
  if (patch.discounts) {
    const pct = patch.discounts.percentOffList;
    if (pct != null && (!Number.isFinite(pct) || pct < 0 || pct > 100)) {
      return { ok: false, error: "% off list must be between 0 and 100." };
    }
    clean.discounts = { note: clip(patch.discounts.note), percentOffList: pct == null ? null : pct, terms: clip(patch.discounts.terms) };
  }
  if (patch.registration) {
    clean.registration = {
      program: clip(patch.registration.program),
      url: clip(patch.registration.url),
      accountNumber: clip(patch.registration.accountNumber),
      notes: clip(patch.registration.notes),
    };
  }
  await saveVendorProfile(id, clean);
  revalidate();
  return { ok: true };
}

/** Price lists tab — log a ledger entry, then re-evaluate the status and
 *  the owner task immediately (spec §3, §4). */
export async function logPriceListAction(
  vendorId: string,
  input: { receivedAt: number; effectiveAt: number; note: string }
): Promise<R> {
  const me = await requirePerm("create");
  const missing = await vendorOr(vendorId);
  if (missing) return missing;
  const receivedAt = Number(input.receivedAt);
  const effectiveAt = Number(input.effectiveAt);
  if (!Number.isFinite(receivedAt) || receivedAt <= 0 || !Number.isFinite(effectiveAt) || effectiveAt <= 0) {
    return { ok: false, error: "Both dates are required." };
  }
  await logPriceList(vendorId, { receivedAt, effectiveAt, note: clip(input.note) }, me.name);
  await ensureVendorAssignments(vendorId, me.name);
  revalidate();
  return { ok: true };
}

/** Contacts tab — "Contact for…" per contact; blank clears. */
export async function setContactRoleAction(vendorId: string, contactId: string, role: string): Promise<R> {
  await requirePerm("create");
  const missing = await vendorOr(vendorId);
  if (missing) return missing;
  const ct = await getContact(contactId);
  if (!ct || ct.homeCompanyId !== vendorId) return { ok: false, error: "That contact isn't on this vendor." };
  await setContactRole(vendorId, contactId, clip(role).slice(0, 200));
  revalidate();
  return { ok: true };
}

/** Overview tab — drop a claimed manufacturer. */
export async function releaseManufacturerAction(vendorId: string, mfr: string): Promise<R> {
  await requirePerm("create");
  const missing = await vendorOr(vendorId);
  if (missing) return missing;
  await releaseManufacturer(vendorId, mfr);
  revalidate();
  return { ok: true };
}
```
- [ ] **Step 5: `src/app/(app)/companies/edit-modal.tsx`** — the vendor header's Edit button opens this modal, whose type `<select>` only lists `CUSTOMER_TYPES` (the five prototype venue segments, `companies/lib.ts:26-32`); a stored `vendor/manufacturer` (or any Daylite-imported type) would render as a blank select. Replace lines 439-443 with:

```tsx
              {!(CUSTOMER_TYPES as readonly string[]).includes(type) && type && (
                <option value={type}>{type}</option>
              )}
              {CUSTOMER_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
```

- [ ] **Step 6: `src/app/(app)/vendors/[id]/page.tsx`** (server)

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import type { CSSProperties } from "react";
import { requireUser } from "@/lib/session";
import { get as getCustomer } from "@/lib/stores/customers";
import { contactsForCompany, displayName, emailsForContacts, phonesForContacts } from "@/lib/identity/contacts";
import { loadVendors } from "@/lib/vendor-tasks";
import { VENDOR_STATUS_META } from "@/lib/vendor-status";
import { loadCustomerFeed } from "@/lib/customer-feed";
import { groupRows } from "@/lib/feed-buckets";
import { dateYear, timeAgo } from "@/lib/format";
import ActivityComposer from "@/app/(app)/companies/[id]/activity-composer";
import { ACCENT_INK, ACCENT_SOFT, mono, typeColor } from "@/app/(app)/companies/lib";
import { VENDOR_TABS, VENDOR_TAB_LABEL, resolveVendorTab, type VendorTab } from "../tabs";
import { toDateInput } from "../dates";
import OverviewTab from "./overview-tab";
import ContactsTab, { type VendorContactVM } from "./contacts-tab";
import PriceListsTab from "./price-lists-tab";

export const metadata = { title: "Vendor — Quartzite-6" };

function one(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] ?? "" : v ?? "";
}

const card: CSSProperties = {
  background: "#fff",
  border: "1px solid #ececf0",
  borderRadius: 12,
  boxShadow: "0 1px 2px rgba(0,0,0,.04)",
  marginBottom: 24,
  overflow: "hidden",
};
const cardHead: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  padding: "14px 18px 12px",
  borderBottom: "1px solid #f0f1f4",
};
const CSS = `.vn-d-row:hover { background: #fafbff; }`;

export default async function VendorDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [, { id }, sp] = await Promise.all([requireUser(), params, searchParams]);
  const cust = await getCustomer(id);
  if (!cust) notFound();
  const [data, contactRows, feedRows] = await Promise.all([
    loadVendors(cust.id),
    contactsForCompany(cust.id),
    loadCustomerFeed({ id: cust.id, name: cust.name }),
  ]);
  // loadVendors only returns companies typed vendor/manufacturer — any other
  // company has no vendor page (it has /companies/[id]).
  const row = data.rows[0];
  if (!row) notFound();

  const ids = contactRows.map((c) => c.id);
  const [emailsBy, phonesBy] = await Promise.all([emailsForContacts(ids), phonesForContacts(ids)]);
  const contacts: VendorContactVM[] = contactRows.map((c) => ({
    id: c.id,
    name: displayName(c),
    title: c.title || "",
    email: emailsBy.get(c.id)?.[0]?.email || "",
    phone: phonesBy.get(c.id)?.[0]?.phone || "",
    primary: c.isPrimary,
    role: row.profile.contactRoles[c.id] || "",
  }));

  const tab = resolveVendorTab(one(sp.tab));
  const sm = VENDOR_STATUS_META[row.status];
  const tc = typeColor(row.type);
  const tabHref = (t: VendorTab) => `/vendors/${encodeURIComponent(row.id)}?tab=${t}`;
  const counts: Partial<Record<VendorTab, number>> = {
    contacts: contacts.length,
    prices: row.profile.priceLists.length,
    activity: feedRows.length,
  };
  const feedGroups = groupRows(feedRows, Date.now());
  const todayInput = toDateInput(Date.now());

  return (
    <>
      <style>{CSS}</style>
      <div className="pk-content" style={{ maxWidth: 880 }}>
        <Link href="/vendors" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 600, color: "#8c919c", textDecoration: "none", marginBottom: 16 }}>
          ‹ All vendors
        </Link>

        {/* header */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 16, marginBottom: 18, flexWrap: "wrap" }}>
          <span style={{ width: 54, height: 54, borderRadius: 13, background: "var(--accent)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 18, fontFamily: "var(--font-mono)", flexShrink: 0 }}>
            {mono(row.name)}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-.015em" }}>{row.name}</span>
              <span style={{ fontSize: 11, fontWeight: 600, color: tc, background: `color-mix(in srgb, ${tc} 12%, #fff)`, padding: "3px 10px", borderRadius: 20 }}>
                {row.type}
              </span>
              <span style={{ fontSize: 11, fontWeight: 600, color: sm.ink, background: sm.soft, border: `1px solid ${sm.bd}`, padding: "3px 10px", borderRadius: 20 }}>
                {sm.label}
              </span>
            </div>
            <div style={{ fontSize: 12.5, color: "#8c919c", marginTop: 5, display: "flex", gap: 12, flexWrap: "wrap" }}>
              <span>Catalog priced {dateYear(row.catalogEffectiveAt)}</span>
              <span>Last list {row.lastList ? `received ${dateYear(row.lastList.receivedAt)}, effective ${dateYear(row.lastList.effectiveAt)}` : "—"}</span>
              <span>{row.partCount} part{row.partCount === 1 ? "" : "s"}</span>
            </div>
            {row.openTask && (
              <div style={{ marginTop: 8, fontSize: 12.5 }}>
                <span style={{ color: "#8c919c" }}>Owner task · </span>
                <Link href={`/queue?who=${encodeURIComponent(row.openTask.assignee)}`} style={{ color: "var(--accent)", fontWeight: 600, textDecoration: "none" }}>
                  {row.openTask.title}
                </Link>
                <span style={{ color: "#8c919c" }}> — {row.openTask.assignee}</span>
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: 9, flexShrink: 0 }}>
            <Link href={`/companies/${encodeURIComponent(row.id)}?edit=1`} style={{ fontSize: 12.5, fontWeight: 600, color: "#3a3f4a", background: "#fff", border: "1px solid #e4e7ec", borderRadius: 8, padding: "9px 14px", textDecoration: "none" }}>
              Edit
            </Link>
            <Link href={`/inbox?customer=${encodeURIComponent(row.id)}`} style={{ fontSize: 12.5, fontWeight: 600, color: "#fff", background: "var(--accent)", borderRadius: 8, padding: "10px 15px", textDecoration: "none" }}>
              New email
            </Link>
          </div>
        </div>

        {/* tab strip — the engagements/view.tsx idiom */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", borderBottom: "1px solid #eef0f3", paddingBottom: 10, marginBottom: 18 }}>
          {VENDOR_TABS.map((t) => (
            <Link
              key={t}
              href={tabHref(t)}
              style={{
                textDecoration: "none", fontSize: 12.5, fontWeight: 600, padding: "7px 12px", borderRadius: 8,
                color: tab === t ? "color-mix(in srgb, var(--accent) 70%, #000)" : "#8c919c",
                background: tab === t ? "color-mix(in srgb, var(--accent) 10%, #fff)" : "transparent",
                border: tab === t ? "1px solid color-mix(in srgb, var(--accent) 30%, #fff)" : "1px solid transparent",
              }}
            >
              {VENDOR_TAB_LABEL[t]}
              {counts[t] ? <span style={{ marginLeft: 6, color: "#9aa0ab", fontWeight: 500 }}>{counts[t]}</span> : null}
            </Link>
          ))}
        </div>

        {tab === "overview" && (
          <OverviewTab
            vendorId={row.id}
            discounts={row.profile.discounts}
            registration={row.profile.registration}
            manufacturers={row.profile.manufacturers}
            directory={data.directory}
          />
        )}
        {tab === "contacts" && <ContactsTab vendorId={row.id} contacts={contacts} />}
        {tab === "prices" && (
          <PriceListsTab
            vendorId={row.id}
            priceLists={row.profile.priceLists}
            status={row.status}
            catalogEffectiveAt={row.catalogEffectiveAt}
            todayInput={todayInput}
          />
        )}
        {tab === "activity" && (
          <div style={card}>
            <div style={cardHead}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ fontSize: 14.5, fontWeight: 600 }}>Activity</div>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "#9aa0ab" }}>{feedRows.length}</span>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <Link href={`/inbox?customer=${encodeURIComponent(row.id)}&log=1`} style={{ fontSize: 12, fontWeight: 600, color: ACCENT_INK, background: ACCENT_SOFT, border: `1px solid ${ACCENT_SOFT}`, borderRadius: 8, padding: "8px 12px", textDecoration: "none" }}>
                  Log call
                </Link>
                <Link href={`/inbox?customer=${encodeURIComponent(row.id)}`} style={{ fontSize: 12, fontWeight: 600, color: ACCENT_INK, background: ACCENT_SOFT, border: `1px solid ${ACCENT_SOFT}`, borderRadius: 8, padding: "8px 12px", textDecoration: "none" }}>
                  New email
                </Link>
              </div>
            </div>
            <ActivityComposer customerId={row.id} />
            {feedGroups.map((g) => (
              <div key={g.bucket}>
                <div style={{ padding: "9px 18px 7px", fontSize: 10, fontWeight: 600, color: "#aab0bb", letterSpacing: ".05em", textTransform: "uppercase", background: "#fafbfc", borderBottom: "1px solid #f0f1f4" }}>
                  {g.bucket}
                </div>
                {g.rows.map((r) => {
                  const rowStyle: CSSProperties = { display: "flex", alignItems: "flex-start", gap: 11, padding: "10px 18px", borderBottom: "1px solid #f5f6f8", textDecoration: "none", color: "inherit" };
                  const inner = (
                    <>
                      <span style={{ width: 26, height: 26, borderRadius: "50%", background: r.soft, color: r.ink, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10.5, fontWeight: 700, flexShrink: 0 }}>
                        {r.letter}
                      </span>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ fontSize: 12.5, fontWeight: 600, lineHeight: 1.35, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical" }}>
                          {r.title}
                        </span>
                        <span style={{ display: "block", fontSize: 11, color: "#aab0bb", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {[r.sub, r.by, timeAgo(r.ts)].filter(Boolean).join(" · ")}
                        </span>
                      </span>
                    </>
                  );
                  return r.href ? (
                    <Link key={r.id} href={r.href} className="vn-d-row" style={rowStyle}>
                      {inner}
                    </Link>
                  ) : (
                    <div key={r.id} style={rowStyle}>
                      {inner}
                    </div>
                  );
                })}
              </div>
            ))}
            {feedRows.length === 0 && (
              <div style={{ padding: "26px 18px", textAlign: "center", color: "#9aa0ab", fontSize: 12.5 }}>
                No activity yet — emails, calls and notes linked to this vendor land here.
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
```

- [ ] **Step 7: `src/app/(app)/vendors/[id]/overview-tab.tsx`** (client)

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { CSSProperties } from "react";
import type { ManufacturerEntry, VendorDiscounts, VendorRegistration } from "@/lib/vendor-status";
import { claimManufacturerAction, releaseManufacturerAction, saveVendorProfileAction } from "../actions";

/**
 * #122 — Overview: discounts + project registration (inline-editable, one
 * Save) and the claimed manufacturers (add = claim, which moves the
 * manufacturer off any other vendor; × = release). Types come from the pure
 * vendor-status module, never the store (client-bundle rule).
 */

const CARD: CSSProperties = { background: "#fff", border: "1px solid #ececf0", borderRadius: 12, boxShadow: "0 1px 2px rgba(0,0,0,.04)", padding: "16px 18px", marginBottom: 18 };
const H: CSSProperties = { fontSize: 14.5, fontWeight: 600, marginBottom: 12 };
const LBL: CSSProperties = { display: "block", fontSize: 10.5, fontWeight: 600, color: "#9aa0ab", letterSpacing: ".05em", textTransform: "uppercase", marginBottom: 5 };
const IN: CSSProperties = { width: "100%", fontFamily: "var(--font-ui)", fontSize: 13, color: "#16181d", border: "1px solid #e4e7ec", borderRadius: 9, padding: "9px 11px", outline: "none", background: "#fff", boxSizing: "border-box" };
const BTN: CSSProperties = { fontFamily: "var(--font-ui)", fontSize: 12, fontWeight: 600, color: "#3a3f4a", background: "#fff", border: "1px solid #e4e7ec", borderRadius: 8, padding: "7px 11px", cursor: "pointer" };

export default function OverviewTab({
  vendorId,
  discounts,
  registration,
  manufacturers,
  directory,
}: {
  vendorId: string;
  discounts: VendorDiscounts;
  registration: VendorRegistration;
  manufacturers: string[];
  directory: Array<ManufacturerEntry & { vendorName: string }>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const [saved, setSaved] = useState(false);
  const pctText = discounts.percentOffList == null ? "" : String(discounts.percentOffList);
  const [d, setD] = useState({ note: discounts.note, pct: pctText, terms: discounts.terms });
  const [r, setR] = useState<VendorRegistration>({ ...registration });
  const [pick, setPick] = useState("");

  const dirty =
    d.note !== discounts.note || d.terms !== discounts.terms || d.pct !== pctText ||
    r.program !== registration.program || r.url !== registration.url ||
    r.accountNumber !== registration.accountNumber || r.notes !== registration.notes;

  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>, after?: () => void) =>
    start(async () => {
      setErr("");
      const res = await fn();
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      after?.();
      router.refresh();
    });

  const save = () => {
    const pct = d.pct.trim() === "" ? null : Number(d.pct);
    if (pct != null && (!Number.isFinite(pct) || pct < 0 || pct > 100)) {
      setErr("% off list must be between 0 and 100.");
      return;
    }
    run(
      () => saveVendorProfileAction(vendorId, { discounts: { note: d.note, percentOffList: pct, terms: d.terms }, registration: r }),
      () => setSaved(true)
    );
  };

  const claimable = directory.filter((m) => m.vendorId !== vendorId);

  return (
    <>
      <div style={CARD}>
        <div style={H}>Manufacturers claimed</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
          {manufacturers.map((m) => (
            <span key={m} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 600, color: "#3a3f4a", background: "#f1f2f5", border: "1px solid #e4e7ec", padding: "4px 6px 4px 10px", borderRadius: 20 }}>
              {m}
              <button type="button" title={`Release ${m}`} disabled={pending} onClick={() => run(() => releaseManufacturerAction(vendorId, m))} style={{ border: "none", background: "transparent", color: "#8c919c", cursor: "pointer", fontSize: 13, lineHeight: 1, padding: 0 }}>
                ×
              </button>
            </span>
          ))}
          {manufacturers.length === 0 && <span style={{ fontSize: 12.5, color: "#9aa0ab" }}>No manufacturers claimed yet — the catalog can’t be matched to this vendor until one is.</span>}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <select value={pick} onChange={(e) => setPick(e.target.value)} style={{ ...IN, width: "auto", minWidth: 240, cursor: "pointer" }}>
            <option value="">Add a catalog manufacturer…</option>
            {claimable.map((m) => (
              <option key={m.name} value={m.name}>
                {m.name} · {m.count} part{m.count === 1 ? "" : "s"}{m.vendorName ? ` · claimed by ${m.vendorName}` : ""}
              </option>
            ))}
          </select>
          <button type="button" style={BTN} disabled={pending || !pick} onClick={() => run(() => claimManufacturerAction(vendorId, pick), () => setPick(""))}>
            Claim
          </button>
          <span style={{ fontSize: 11.5, color: "#9aa0ab" }}>Claiming a manufacturer another vendor holds moves it here.</span>
        </div>
      </div>

      <div style={CARD}>
        <div style={H}>Discounts</div>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 140px", gap: 12 }}>
          <div>
            <label style={LBL}>Note</label>
            <input value={d.note} onChange={(e) => { setSaved(false); setD({ ...d, note: e.target.value }); }} placeholder="e.g. dealer program, tiered by annual volume" style={IN} />
          </div>
          <div>
            <label style={LBL}>% off list</label>
            <input value={d.pct} inputMode="decimal" onChange={(e) => { setSaved(false); setD({ ...d, pct: e.target.value }); }} placeholder="e.g. 35" style={{ ...IN, fontFamily: "var(--font-mono)" }} />
          </div>
        </div>
        <div style={{ marginTop: 12 }}>
          <label style={LBL}>Terms</label>
          <input value={d.terms} onChange={(e) => { setSaved(false); setD({ ...d, terms: e.target.value }); }} placeholder="e.g. Net 30, freight prepaid over $2,500" style={IN} />
        </div>
      </div>

      <div style={CARD}>
        <div style={H}>Project registration</div>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 12 }}>
          <div>
            <label style={LBL}>Program</label>
            <input value={r.program} onChange={(e) => { setSaved(false); setR({ ...r, program: e.target.value }); }} placeholder="e.g. Partner project registration" style={IN} />
          </div>
          <div>
            <label style={LBL}>Account #</label>
            <input value={r.accountNumber} onChange={(e) => { setSaved(false); setR({ ...r, accountNumber: e.target.value }); }} style={{ ...IN, fontFamily: "var(--font-mono)" }} />
          </div>
        </div>
        <div style={{ marginTop: 12 }}>
          <label style={LBL}>URL</label>
          <input value={r.url} onChange={(e) => { setSaved(false); setR({ ...r, url: e.target.value }); }} placeholder="https://…" style={{ ...IN, fontFamily: "var(--font-mono)" }} />
        </div>
        <div style={{ marginTop: 12 }}>
          <label style={LBL}>Notes</label>
          <textarea value={r.notes} onChange={(e) => { setSaved(false); setR({ ...r, notes: e.target.value }); }} rows={3} placeholder="Who registers, lead time, what it protects" style={{ ...IN, resize: "vertical" }} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14 }}>
          <button type="button" className="pk-btn-accent" disabled={pending || !dirty} onClick={save} style={{ opacity: pending || !dirty ? 0.55 : 1 }}>
            {pending ? "Saving…" : "Save"}
          </button>
          {saved && !dirty && <span style={{ fontSize: 12, color: "#1f7a52", fontWeight: 600 }}>Saved</span>}
          {err && <span style={{ fontSize: 12, color: "#b4543a" }}>{err}</span>}
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 8: `src/app/(app)/vendors/[id]/contacts-tab.tsx`** (client)

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { CSSProperties } from "react";
import EntityQuickAdd, { type QuickAddValues } from "@/components/entity-quick-add";
import { quickAddContactAction } from "@/app/(app)/inbox/link-actions";
import { ACCENT_INK, ACCENT_SOFT, mono } from "@/app/(app)/companies/lib";
import { setContactRoleAction } from "../actions";

/**
 * #122 — Contacts: the company's contacts (identity core rows, so each has
 * an id) with an editable "Contact for…" role per contact (VendorProfile.
 * contactRoles), and a quick-add that reuses EntityQuickAdd kind="contact"
 * + the Inbox sidebar's quickAddContactAction (savePersonAction underneath).
 */

export type VendorContactVM = {
  id: string;
  name: string;
  title: string;
  email: string;
  phone: string;
  primary: boolean;
  role: string;
};

const CARD: CSSProperties = { background: "#fff", border: "1px solid #ececf0", borderRadius: 12, boxShadow: "0 1px 2px rgba(0,0,0,.04)", marginBottom: 18, overflow: "hidden" };
const IN: CSSProperties = { width: "100%", fontFamily: "var(--font-ui)", fontSize: 12.5, color: "#16181d", border: "1px solid #e4e7ec", borderRadius: 8, padding: "7px 10px", outline: "none", background: "#fff", boxSizing: "border-box" };

function RoleField({ vendorId, contact }: { vendorId: string; contact: VendorContactVM }) {
  const router = useRouter();
  const [v, setV] = useState(contact.role);
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const commit = () => {
    if (v.trim() === contact.role) return;
    start(async () => {
      setErr("");
      const res = await setContactRoleAction(vendorId, contact.id, v);
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      router.refresh();
    });
  };
  return (
    <div style={{ minWidth: 0 }}>
      <input
        value={v}
        disabled={pending}
        onChange={(e) => setV(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        placeholder="Contact for… (e.g. price lists, RMAs, project registration)"
        style={IN}
      />
      {err && <div style={{ fontSize: 11.5, color: "#b4543a", marginTop: 4 }}>{err}</div>}
    </div>
  );
}

export default function ContactsTab({ vendorId, contacts }: { vendorId: string; contacts: VendorContactVM[] }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<QuickAddValues["contact"]>({ name: "", role: "", email: "", phone: "" });
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const submit = () =>
    start(async () => {
      setErr(null);
      const res = await quickAddContactAction({ customerId: vendorId, ...draft });
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      setAdding(false);
      setDraft({ name: "", role: "", email: "", phone: "" });
      router.refresh();
    });

  return (
    <div style={CARD}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "14px 18px 12px", borderBottom: "1px solid #f0f1f4" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 14.5, fontWeight: 600 }}>Contacts</span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "#9aa0ab" }}>{contacts.length}</span>
        </div>
        <button type="button" onClick={() => setAdding((a) => !a)} style={{ fontSize: 12, fontWeight: 700, color: ACCENT_INK, background: ACCENT_SOFT, border: "none", borderRadius: 8, padding: "7px 10px", cursor: "pointer", fontFamily: "var(--font-ui)" }}>
          {adding ? "Cancel" : "+ Add contact"}
        </button>
      </div>
      {adding && (
        <div style={{ padding: "4px 18px 16px", borderBottom: "1px solid #f0f1f4", background: "#fafbfc" }}>
          <EntityQuickAdd
            kind="contact"
            value={draft}
            onChange={setDraft}
            submitting={pending}
            error={err}
            onCancel={() => {
              setAdding(false);
              setErr(null);
            }}
            onSubmit={submit}
          />
        </div>
      )}
      {contacts.map((ct) => (
        <div key={ct.id} style={{ display: "grid", gridTemplateColumns: "minmax(0,1.2fr) minmax(0,1.4fr)", gap: 14, padding: "12px 18px", borderBottom: "1px solid #f5f6f8", alignItems: "start" }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10, minWidth: 0 }}>
            <span style={{ width: 30, height: 30, borderRadius: "50%", background: "#f1f2f5", color: "#5b616e", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 600, flexShrink: 0 }}>
              {mono(ct.name)}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, lineHeight: 1.3 }}>
                <Link href={`/people/${encodeURIComponent(ct.id)}`} style={{ color: "inherit", textDecoration: "none" }}>{ct.name}</Link>
                {ct.primary && (
                  <span style={{ fontSize: 9, fontWeight: 700, color: ACCENT_INK, background: ACCENT_SOFT, padding: "1px 5px", borderRadius: 4, marginLeft: 5, letterSpacing: ".03em" }}>
                    PRIMARY
                  </span>
                )}
              </div>
              {ct.title && <div style={{ fontSize: 11, color: "#8c919c", marginTop: 1 }}>{ct.title}</div>}
              {ct.email && <div style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "#aab0bb", marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{ct.email}</div>}
              {ct.phone && <div style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "#aab0bb", marginTop: 2 }}>{ct.phone}</div>}
            </div>
          </div>
          <RoleField vendorId={vendorId} contact={ct} />
        </div>
      ))}
      {contacts.length === 0 && (
        <div style={{ padding: "26px 18px", textAlign: "center", color: "#9aa0ab", fontSize: 12.5 }}>
          No contacts yet — add the rep you email for price lists.
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 9: `src/app/(app)/vendors/[id]/price-lists-tab.tsx`** (client)

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { CSSProperties } from "react";
import { VENDOR_STATUS_META, type PriceListEntry, type VendorStatusKey } from "@/lib/vendor-status";
import { dateYear } from "@/lib/format";
import { fromDateInput } from "../dates";
import { logPriceListAction } from "../actions";

/**
 * #122 — Price lists: the ledger (received, effective, note, logged by) and
 * the "Log price list" form. Saving re-evaluates the status and the owner
 * task server-side (logPriceListAction → ensureVendorAssignments) and
 * router.refresh() re-renders the header chip. Date rule only — no file.
 */

const CARD: CSSProperties = { background: "#fff", border: "1px solid #ececf0", borderRadius: 12, boxShadow: "0 1px 2px rgba(0,0,0,.04)", marginBottom: 18, overflow: "hidden" };
const LBL: CSSProperties = { display: "block", fontSize: 10.5, fontWeight: 600, color: "#9aa0ab", letterSpacing: ".05em", textTransform: "uppercase", marginBottom: 5 };
const IN: CSSProperties = { width: "100%", fontFamily: "var(--font-ui)", fontSize: 13, color: "#16181d", border: "1px solid #e4e7ec", borderRadius: 9, padding: "9px 11px", outline: "none", background: "#fff", boxSizing: "border-box" };
const GRID: CSSProperties = { display: "grid", gridTemplateColumns: "110px 110px minmax(0,1fr) 140px", gap: 10, alignItems: "center" };

export default function PriceListsTab({
  vendorId,
  priceLists,
  status,
  catalogEffectiveAt,
  todayInput,
}: {
  vendorId: string;
  priceLists: PriceListEntry[];
  status: VendorStatusKey;
  catalogEffectiveAt: number | null;
  /** server-rendered "today" as YYYY-MM-DD (the received-date default) */
  todayInput: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [received, setReceived] = useState(todayInput);
  const [effective, setEffective] = useState(todayInput);
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const sm = VENDOR_STATUS_META[status];

  const submit = () =>
    start(async () => {
      setErr("");
      const receivedAt = fromDateInput(received);
      const effectiveAt = fromDateInput(effective);
      if (receivedAt == null || effectiveAt == null) {
        setErr("Both dates are required.");
        return;
      }
      const res = await logPriceListAction(vendorId, { receivedAt, effectiveAt, note });
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      setNote("");
      router.refresh();
    });

  return (
    <>
      <div style={{ ...CARD, padding: "16px 18px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
          <span style={{ fontSize: 14.5, fontWeight: 600 }}>Log price list</span>
          <span style={{ fontSize: 11, fontWeight: 600, color: sm.ink, background: sm.soft, border: `1px solid ${sm.bd}`, padding: "3px 10px", borderRadius: 20 }}>{sm.label}</span>
          <span style={{ fontSize: 12, color: "#8c919c" }}>Catalog priced {dateYear(catalogEffectiveAt)}</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "160px 160px minmax(0,1fr)", gap: 12 }}>
          <div>
            <label style={LBL}>Received</label>
            <input type="date" value={received} onChange={(e) => setReceived(e.target.value)} style={IN} />
          </div>
          <div>
            <label style={LBL}>Effective</label>
            <input type="date" value={effective} onChange={(e) => setEffective(e.target.value)} style={IN} />
          </div>
          <div>
            <label style={LBL}>Note</label>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. 2027 dealer list, +4% across velours" style={IN} />
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12 }}>
          <button type="button" className="pk-btn-accent" disabled={pending} onClick={submit} style={{ opacity: pending ? 0.55 : 1 }}>
            {pending ? "Logging…" : "Log price list"}
          </button>
          <span style={{ fontSize: 11.5, color: "#9aa0ab" }}>Logging a list newer than the catalog creates the catalog owner’s task right away.</span>
          {err && <span style={{ fontSize: 12, color: "#b4543a" }}>{err}</span>}
        </div>
      </div>

      <div style={CARD}>
        <div style={{ ...GRID, padding: "9px 18px", fontSize: 10, fontWeight: 600, color: "#aab0bb", textTransform: "uppercase", letterSpacing: ".04em", background: "#fafbfc", borderBottom: "1px solid #f0f1f4" }}>
          <span>Received</span>
          <span>Effective</span>
          <span>Note</span>
          <span>Logged by</span>
        </div>
        {priceLists.map((e) => (
          <div key={e.id} style={{ ...GRID, padding: "11px 18px", borderBottom: "1px solid #f5f6f8", fontSize: 12.5 }}>
            <span style={{ fontFamily: "var(--font-mono)" }}>{dateYear(e.receivedAt)}</span>
            <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600 }}>{dateYear(e.effectiveAt)}</span>
            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.note || "—"}</span>
            <span style={{ color: "#8c919c" }}>{e.loggedBy || "—"}</span>
          </div>
        ))}
        {priceLists.length === 0 && (
          <div style={{ padding: "26px 18px", textAlign: "center", color: "#9aa0ab", fontSize: 12.5 }}>
            No price list logged yet.
          </div>
        )}
      </div>
    </>
  );
}
```

- [ ] **Step 10: Verify** — `npx tsx scripts/test-review-and-spec.ts | grep -E '#122|ALL PASSED'` → all PASS; `npx tsc --noEmit -p . | tail -3` → empty; `npx eslint "src/app/(app)/vendors/" "src/app/(app)/companies/edit-modal.tsx"` → clean; `npm run test:review:regressions 2>&1 | tail -3` → passed.

- [ ] **Step 11: Commit**

```bash
git add "src/app/(app)/vendors/" "src/app/(app)/companies/edit-modal.tsx" scripts/test-review-and-spec.ts
git commit -m "feat(vendors): /vendors/[id] with Overview, Contacts, Price lists and Activity tabs + edit actions (#122 §3)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Inbox picker groups Customers / Vendors, `/inbox?customer=<id>` (+ `&log=1`), Catalog facet tooltip + banner link

**Files:**
- Modify: `src/app/(app)/inbox/types.ts:220-224` (`ReaderVM`)
- Modify: `src/app/(app)/inbox/page.tsx:801-810` (VM), `:851-897` (`initialCompose`), `:941-957` (`InboxShell` props)
- Modify: `src/app/(app)/inbox/link-sidebar.tsx:207-217` (`customerPicker`)
- Modify: `src/app/(app)/inbox/inbox-shell.tsx:86-110` (props), `:146` (`logging` state), `:1023-1035` (`LogModal`)
- Modify: `src/app/(app)/inbox/log-modal.tsx:41-61` (`initialCustomerId`)
- Modify: `src/app/(app)/catalog/page.tsx` (imports; loads; manufacturer `FilterGroup` options `:224-236`; `FilterGroup` `:445-524`; the outdated banner rows the catalog plan added)
- Test: `scripts/test-review-and-spec.ts` (section "#122 §3 — inbox option groups") — pure grouping helper; the routes are smoked in Task 7

**Interfaces:**
- Consumes: `isVendorType` (Task 1), `claimOwnerByKey` (Task 2), `allVendorProfiles/vendorCompanies` (Task 1), `mfrKey` (`@/lib/catalog-books`), `CustomerDoc.type` (`src/lib/stores/customers.ts:107`), `Opt` (`inbox/types.ts:7`).
- Produces (`src/lib/vendor-status.ts`, appended): `groupCompanyOptions(companies: Array<{ id: string; name: string; type: string }>): Array<{ label: "Customers" | "Vendors"; options: Array<{ value: string; label: string }> }>` — name-sorted, empty groups dropped.
- Produces (`ReaderVM`): `customerOptionGroups: Array<{ label: string; options: Opt[] }>`.
- Produces (`InboxShell`): prop `initialLog: { customerId: string } | null`; (`LogModal`): prop `initialCustomerId?: string`.
- URL contract: `/inbox?customer=<companyId>` opens the composer pre-linked to that company (the existing `?new=<id>` behaviour, `page.tsx:872-884`); `/inbox?customer=<companyId>&log=1` opens the Log call / meeting modal with the company preset.

- [ ] **Step 1: Failing spec test** — add `groupCompanyOptions` to the `@/lib/vendor-status` import in `scripts/test-review-and-spec.ts` and, after the `#122 §3 — tab keys` block:

```ts
/* ---- #122 §3 — inbox option groups ---- */
{
  const groups = groupCompanyOptions([
    { id: "rose-brand", name: "Rose Brand", type: "vendor/manufacturer" },
    { id: "lakefront", name: "Lakefront PAC", type: "Performing arts" },
    { id: "badger", name: "Badger Ballet", type: "" },
  ]);
  ok(groups.length === 2 && groups[0].label === "Customers" && groups[1].label === "Vendors", "#122 groupCompanyOptions: Customers first, then Vendors");
  ok(groups[0].options.map((o) => o.value).join(",") === "badger,lakefront" && groups[1].options[0].value === "rose-brand", "#122 groupCompanyOptions: name-sorted within a group, vendors by exact type");
  ok(groupCompanyOptions([{ id: "x", name: "X", type: "Civic" }]).length === 1, "#122 groupCompanyOptions: an empty group is dropped");
}
```

- [ ] **Step 2: Run** → `does not provide an export named 'groupCompanyOptions'`.

- [ ] **Step 3: append to `src/lib/vendor-status.ts`**

```ts
import { isVendorType } from "@/lib/identity/config";

/** Inbox link sidebar (spec §3): the customer picker's optgroups. */
export function groupCompanyOptions(
  companies: Array<{ id: string; name: string; type: string }>
): Array<{ label: "Customers" | "Vendors"; options: Array<{ value: string; label: string }> }> {
  const sorted = companies
    .map((c) => ({ value: c.id, label: c.name, vendor: isVendorType(c.type) }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const pick = (vendor: boolean) => sorted.filter((o) => o.vendor === vendor).map(({ value, label }) => ({ value, label }));
  return (
    [
      { label: "Customers" as const, options: pick(false) },
      { label: "Vendors" as const, options: pick(true) },
    ] as Array<{ label: "Customers" | "Vendors"; options: Array<{ value: string; label: string }> }>
  ).filter((g) => g.options.length > 0);
}
```
(the `import` goes with the other imports at the top of the file; `identity/config.ts` is DB-free.)

- [ ] **Step 4: Inbox VM + sidebar**

`src/app/(app)/inbox/types.ts` — after line 221 (`customerOptions: Opt[];`):
```ts
  /** #122 — the same companies split into "Customers" / "Vendors" optgroups
   *  (vendor = type "vendor/manufacturer"); empty groups are omitted. */
  customerOptionGroups: Array<{ label: string; options: Opt[] }>;
```

`src/app/(app)/inbox/page.tsx` — add `import { groupCompanyOptions } from "@/lib/vendor-status";` to the imports, and in the reader VM literal, right after the `customerOptions:` entry (lines 801-803):
```ts
      customerOptionGroups: groupCompanyOptions(customers.map((c) => ({ id: c.id, name: c.name, type: c.type || "" }))),
```

`src/app/(app)/inbox/link-sidebar.tsx` — replace `customerPicker` (lines 207-217) with:
```tsx
  const customerPicker = (value: string, onChange: (v: string) => void, withNew: boolean) => (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={SELECT}>
      <option value="">Pick a customer…</option>
      {vm.customerOptionGroups.map((g) => (
        <optgroup key={g.label} label={g.label}>
          {g.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </optgroup>
      ))}
      {withNew && <option value="__new">+ New customer…</option>}
    </select>
  );
```

- [ ] **Step 5: `?customer=` (+ `&log=1`)**

`src/app/(app)/inbox/page.tsx` — replace lines 851-854 (the comment + `const newCust = str(params.new);`) with:
```ts
  // ?draft=<id> opens a saved draft in the composer (IDEAS #36 outreach);
  // ?compose=1 opens a blank sheet; ?new=<customerId> pre-fills the customer.
  // #122: ?customer=<companyId> is the same pre-filled composer (vendor pages
  // link here), and ?customer=<companyId>&log=1 opens the Log call / meeting
  // modal with that company preset instead.
  const customerParam = str(params.customer);
  const logCust = str(params.log) === "1" ? customerParam : "";
  const newCust = logCust ? "" : str(params.new) || customerParam;
  const initialLog = logCust && customerVMs.some((c) => c.id === logCust) ? { customerId: logCust } : null;
```
and pass it to the shell (after `initialCompose={initialCompose}`, line 954):
```tsx
            initialLog={initialLog}
```

`src/app/(app)/inbox/inbox-shell.tsx` — add `initialLog,` after `initialCompose,` in the destructure (line 86) and `initialLog: { customerId: string } | null;` after `initialCompose: ComposeInit | null;` in the prop type (line 106); change line 146 to:
```ts
  const [logging, setLogging] = useState(!!initialLog);
```
and the `LogModal` render (lines 1024-1034) to:
```tsx
      {logging && (
        <LogModal
          customers={customers}
          rosterOptions={rosterOptions}
          initialCustomerId={initialLog?.customerId || ""}
          onClose={() => setLogging(false)}
          onLogged={(id) => {
            setLogging(false);
            router.push(`/inbox?view=calls${id ? `&thread=${encodeURIComponent(id)}` : ""}`);
          }}
        />
      )}
```

`src/app/(app)/inbox/log-modal.tsx` — add the prop and use it as the initial customer (lines 41-61):
```tsx
export default function LogModal({
  customers,
  rosterOptions,
  initialCustomerId = "",
  onClose,
  onLogged,
}: {
  customers: CustomerVM[];
  rosterOptions: Opt[];
  /** #122 — /inbox?customer=<id>&log=1 opens this modal with the company preset */
  initialCustomerId?: string;
  onClose: () => void;
  onLogged: (id: string | null) => void;
}) {
  const [ld, setLd] = useState<LogDraft>({
    channel: "call",
    direction: "in",
    customerId: initialCustomerId,
    contactName: "",
    contactEmail: "",
    subject: "",
    body: "",
    assignedTo: "",
  });
```

- [ ] **Step 6: Catalog page — facet tooltip + banner link.** In `src/app/(app)/catalog/page.tsx` add imports:

```ts
import { allVendorProfiles, vendorCompanies } from "@/lib/stores/vendors";
import { claimOwnerByKey } from "@/lib/vendor-status";
import { mfrKey } from "@/lib/catalog-books";
```
extend the load (the Task 3 shape):
```ts
  const [user, sp, parts, settings, users, profiles, vendorCos] = await Promise.all([
    requireUser(),
    searchParams,
    list(),
    getSettings(),
    activeUsers(),
    allVendorProfiles(),
    vendorCompanies(),
  ]);
  const vendorNameById = new Map(vendorCos.map((c) => [c.id, c.name]));
  const vendorByKey = claimOwnerByKey(profiles);
  /** #122 — the vendor that claims a manufacturer spelling, or null. */
  const vendorFor = (m: string): { id: string; name: string } | null => {
    const id = vendorByKey.get(mfrKey(m));
    return id ? { id, name: vendorNameById.get(id) ?? id } : null;
  };
```
Manufacturer facet (lines 224-236): add a `title` per option:
```tsx
            options={manufacturers.map((m) => ({
              key: m,
              label: m,
              href: hrefFor({ mfr: m }),
              count: parts.filter((p) => mfrOf(p) === m).length,
              title: vendorFor(m) ? `Supplied by ${vendorFor(m)!.name} — open the vendor from the price banner or /vendors` : undefined,
            }))}
```
`FilterGroup` (line 458): widen the option type to `Array<{ key: string; label: string; href: string; count: number; title?: string }>` and render it on the `Link` (after `className="ct-filter"`, line 483): `title={o.title}`.

Banner link: the catalog plan's outdated/unknown banner lists one row per manufacturer with a "Price list effective …" date input (grep `setPriceListEffectiveAction` under `src/app/(app)/catalog/` to find the row component and where `page.tsx` builds its rows). Give each banner row an optional `vendor?: { id: string; name: string } | null` (pass `vendor: vendorFor(name)` where the rows are built in `page.tsx`), and render, immediately after the manufacturer's name in the row:
```tsx
{row.vendor && (
  <Link href={`/vendors/${encodeURIComponent(row.vendor.id)}`} style={{ marginLeft: 8, fontSize: 11.5, fontWeight: 600, color: "var(--accent)", textDecoration: "none" }}>
    {row.vendor.name} ›
  </Link>
)}
```
(If the banner row component is a client component, `Link` from `next/link` is fine there; the `vendor` field is plain data. If the catalog plan named the row field differently — e.g. `mfr` — key `vendorFor()` off that field.)

- [ ] **Step 7: Verify** — `npx tsx scripts/test-review-and-spec.ts | grep -E '#122|ALL PASSED'` → all PASS; `npx tsc --noEmit -p . | tail -3` → empty; `npx eslint "src/app/(app)/inbox/" "src/app/(app)/catalog/page.tsx" src/lib/vendor-status.ts` → clean.

- [ ] **Step 8: Commit**

```bash
git add src/lib/vendor-status.ts "src/app/(app)/inbox/types.ts" "src/app/(app)/inbox/page.tsx" "src/app/(app)/inbox/link-sidebar.tsx" "src/app/(app)/inbox/inbox-shell.tsx" "src/app/(app)/inbox/log-modal.tsx" "src/app/(app)/catalog/page.tsx" scripts/test-review-and-spec.ts
git commit -m "feat(vendors): Inbox picker groups Customers/Vendors, ?customer= composer + log-call entry, catalog facet tooltip + banner vendor link (#122 §3)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```
(add the banner row file the catalog plan created to the `git add` list.)

---

### Task 7: Nav entry, seeded vendor, smoke routes, docs (D160 + PUNCHLIST #122)

**Files:**
- Modify: `src/components/nav/nav-data.ts:72-74` (CRM children), `:127-130` (`activeKeyFor` map)
- Modify: `src/db/seeds/customers.ts:1,86-89` (one vendor company doc)
- Create: `src/db/seeds/vendors.ts`
- Modify: `src/db/seed-data.ts:18` (import), `:120-121` (`DEMO_SEEDS`)
- Modify: `scripts/smoke-routes.ts:67-68` (static routes), `:144-147` (dynamic routes)
- Modify: `scripts/test-review-and-spec.ts` (section "#122 §3 — nav + seed")
- Modify: `DECISIONS.md` (append `## D160`), `PUNCHLIST.md:5972-5996` (#122 → DONE)

**Interfaces:**
- Consumes: `NAV`/`activeKeyFor` (`nav-data.ts:14,102`), `customersSeed` (`seeds/customers.ts:10`), `DEMO_SEEDS` (`seed-data.ts:106`), the `VendorProfile` type (Task 1, type-only), `VENDOR_COMPANY_TYPE` (Task 1). The identity converter (`src/lib/identity/convert.ts:118-131`) turns the seeded customer doc into the `rose-brand` company (contact id `ct-rose-brand-1`, no sites because the doc has no locations).
- Produces: `vendorProfilesSeed(): VendorProfile[]`; routes `/vendors`, `/vendors?status=no-list`, `/vendors/rose-brand` (+ `?tab=contacts|prices|activity`), `/inbox?customer=rose-brand&log=1` in the smoke list.

- [ ] **Step 1: Failing spec test** — add `vendorProfilesSeed` to the imports of `scripts/test-review-and-spec.ts` (`import { vendorProfilesSeed } from "@/db/seeds/vendors";`) and `customersSeed` (`import { customersSeed } from "@/db/seeds/customers";`, unless already imported) and after the `#122 §3 — inbox option groups` block:

```ts
/* ---- #122 §3 — nav + seed ---- */
ok(activeKeyFor("/vendors") === "vendors" && activeKeyFor("/vendors/rose-brand") === "vendors" && parentGroupOf("vendors") === "crm", "#122 /vendors lights CRM › Vendors");
ok(NAV.some((e) => e.kind === "group" && e.key === "crm" && e.children.some((c) => c.key === "vendors" && c.href === "/vendors")), "#122 Vendors sits in the CRM group");
{
  const vendorDocs = customersSeed().filter((c) => c.type === VENDOR_COMPANY_TYPE);
  const seededProfiles = vendorProfilesSeed();
  ok(vendorDocs.length === 1 && vendorDocs[0].id === "rose-brand" && vendorDocs[0].locations.length === 0, "#122 seed: one vendor company, no venues");
  ok(seededProfiles.length === 1 && seededProfiles[0].id === "rose-brand" && seededProfiles[0].manufacturers.includes("Rose Brand"), "#122 seed: the profile claims the seeded catalog's manufacturer");
  ok(seededProfiles[0].priceLists.length === 1 && seededProfiles[0].priceLists[0].effectiveAt <= Date.now(), "#122 seed: one ledger entry in the past so the pages have content");
}
```
(`activeKeyFor`, `NAV`, `parentGroupOf` are already imported at line 460 of the harness.)

- [ ] **Step 2: Run** → `Cannot find module '@/db/seeds/vendors'`.

- [ ] **Step 3: Nav** — in `src/components/nav/nav-data.ts` insert after the `companies` child (line 72):

```ts
      { key: "vendors", label: "Vendors", href: "/vendors" }, // #122 — vendor companies + price-list ledger
```
and in `activeKeyFor`'s map after `"/companies": "companies",` (line 127):
```ts
    "/vendors": "vendors",
```

- [ ] **Step 4: Seed** — in `src/db/seeds/customers.ts` add `import { VENDOR_COMPANY_TYPE } from "@/lib/identity/config";` under the existing import and, as the last element of the returned array (after the `bayfront` record, before `  ];`):

```ts
    // #122 — one seeded VENDOR so /vendors has content in dev: the
    // manufacturer with the most seeded catalog parts (catalog.ts "Rose
    // Brand"). No locations → the identity converter mints no venue.
    {
      id: "rose-brand",
      name: "Rose Brand",
      type: VENDOR_COMPANY_TYPE,
      location: "Secaucus, NJ",
      locations: [],
      contacts: [
        { name: "Marisol Vega", role: "Inside Sales, Midwest", email: "mvega@rosebrand.example", primary: true },
      ],
    },
```

Create `src/db/seeds/vendors.ts` (type-only import from the store — the spec harness imports this seed, and a runtime store import would drag doc-store/db into a DB-free check):
```ts
import type { VendorProfile } from "@/lib/stores/vendors";

/**
 * #122 — vendor profile seed (dev demo data). One profile for the seeded
 * vendor company "rose-brand" (seeds/customers.ts), claiming the seeded
 * catalog's manufacturer. Relative dates, so a function like every seed.
 * The ledger entry is 3 weeks old and the seeded parts carry no pricedAt,
 * so the vendor reads "Newer list received" and the daily cron creates the
 * catalog owner's task — the flow Jeff asked for, visible on first boot.
 * Contact id follows the converter's deterministic `ct-${docId}-${n}`.
 * Already in normalized shape (newest-first ledger, trimmed strings).
 */
export function vendorProfilesSeed(): VendorProfile[] {
  const day = 86_400_000;
  const now = Date.now();
  return [
    {
      id: "rose-brand",
      manufacturers: ["Rose Brand"],
      priceLists: [
        { id: "pl-seed-rb-1", receivedAt: now - 21 * day, effectiveAt: now - 21 * day, note: "Dealer price list (seed)", loggedBy: "Jena Tolksdorf" },
      ],
      discounts: { note: "Dealer program", percentOffList: 35, terms: "Net 30, freight prepaid over $2,500" },
      registration: { program: "Project registration by email", url: "", accountNumber: "PSG-2041", notes: "Register before the bid date; 30-day protection." },
      contactRoles: { "ct-rose-brand-1": "Price lists, quotes, project registration" },
      createdAt: now - 21 * day,
      updatedAt: now - 21 * day,
    },
  ];
}
```
In `src/db/seed-data.ts` add `import { vendorProfilesSeed } from "./seeds/vendors";` after line 18 and, in `DEMO_SEEDS` after the `equipment_items` entry (line 120):
```ts
  ["vendor_profiles", vendorProfilesSeed as unknown as () => Doc[]],
```
(`DEMO_COLLECTIONS` is derived from `DOC_TABLES`, so the go-live reset already clears `vendor_profiles`.)

- [ ] **Step 5: Smoke routes** — in `scripts/smoke-routes.ts` after `"/venues",` (line 68):
```ts
  "/vendors", // #122 Vendors module
  "/vendors?status=no-list&q=rose",
```
and after the `/people/ct-lakefront-1` entry (line 147):
```ts
  // #122 Vendors: the seeded vendor (seeds/customers.ts rose-brand → identity convert) and its tabs
  { route: "/vendors/rose-brand" },
  { route: "/vendors/rose-brand?tab=contacts" },
  { route: "/vendors/rose-brand?tab=prices" },
  { route: "/vendors/rose-brand?tab=activity" },
  { route: "/inbox?customer=rose-brand" },
  { route: "/inbox?customer=rose-brand&log=1" },
```

- [ ] **Step 6: Docs.** First confirm the decision number is still free on `main` and in the working tree: `git fetch origin && git show origin/main:DECISIONS.md | grep -c '^## D160' ; grep -c '^## D160' DECISIONS.md` → both `0` (if not, take the next free number and use it everywhere below and in the PUNCHLIST heading). Append to `DECISIONS.md`:

```markdown
## D160. Vendors are companies; price-list freshness is a date rule; owner tasks are exactly-once (#122, 2026-09-21)

Spec: `docs/superpowers/specs/2026-09-21-vendors-module-design.md`. Jeff's decision in the
brainstorm was **date rule only** — no price-list file upload or diff. Defaults taken while
building:

- **A vendor is a company with `type === "vendor/manufacturer"`** (the `COMPANY_TYPES` value,
  `lib/identity/config.ts` `VENDOR_COMPANY_TYPE`). `PARTNER_TYPES` now carries that exact string
  (the legacy `"Vendor"` spelling stays), so vendor companies no longer get a base venue. Rows
  typed the legacy way do NOT appear on `/vendors` — retype them in the Companies edit modal, whose
  type select now keeps a stored type that isn't one of the five prototype venue segments (it used
  to render blank for any Daylite-imported type).
- **One doc per vendor, id = company id** (`vendor_profiles`, migration `00NN_vendor_profiles`,
  written idempotently per D141). Manufacturer claims are `mfr` spellings matched by `mfrKey()`;
  one owner per key — claiming moves it. Not sync-pushable.
- **Status** (`lib/vendor-status.ts`, pure): `no-list` beats everything; `newer-list` when the
  newest ledger `effectiveAt` is strictly after the NEWEST `effectivePriceDate` of the claimed
  parts; `outdated` when `now − max(list, catalog) > OUTDATED_AFTER_MS` (boundary inclusive =
  current); else `current`. `catalogEffectiveAt` is the newest date (the banner's `priceBooks()`
  uses the oldest — a different question).
- **Owner tasks** are Home Queue assignments keyed by
  `source = "auto: vendor <id> <status> <at>"`; `ensureVendorAssignments()` skips when ANY
  assignment with that key exists, open or done — exactly once per (vendor, status, date), never
  re-opened. Runs after a ledger save and inside the daily `/api/gmail/sync` cron (own try/catch,
  reported as `vendors` in the JSON). Assignee = `settings.catalogOwner.userId` if active, else the
  user named Jena Tolksdorf, else the first active Admin; nobody → no task. `link.kind` stays
  `"company"` (the Krisp write-back precedent: `AssignmentLink` kinds are not extended), so the
  queue row lands on `/queue`; a `/vendors/<id>` deep link from the queue is a follow-up.
- **Settings → Catalog** is the admin card on `/catalog` (Settings' Admin section only links
  there); `setCatalogOwnerAction` is gated on `manage_users` like every other Settings write.
- **"+ New vendor" is a name-only quick-add** through the customers-store upsert with the type
  preset (the same seam the Inbox quick-add uses), not the full Companies modal: its type list is
  the five venue segments and its default blank venue row would give a vendor a "Venue" site. The
  unclaimed-manufacturer claim reuses a vendor whose name normalizes to the manufacturer, else
  creates `v-<mfrKey>`; a non-vendor company with the same name is left alone.
- **Inbox:** `/inbox?customer=<id>` is an alias of the pre-existing `?new=<id>` composer entry
  (the spec's "extend `?draft=`"), and `&log=1` opens the Log call / meeting modal preset — so
  "Log call" from a vendor really logs a call. The link sidebar's picker groups Customers /
  Vendors; the compose/log modals' pickers are unchanged.
- **Claiming a manufacturer does not re-run the task check** — only a ledger save and the cron do
  (spec §2); the next daily run picks up a claim's effect on status.
- Seed: `rose-brand` (the manufacturer with the most seeded parts) with a 3-week-old ledger entry,
  so dev shows "Newer list received" and the first cron creates the owner's task.

Out of scope, logged as follow-ups: procurement lines linking to vendor records
(`ProcurementLine.vendor` stays free text); queue → vendor deep link; multi-vendor manufacturers.
```

In `PUNCHLIST.md` change the heading at line 5972 to
`## 122. Vendors module — DONE 2026-09-21 (D160)` and append after the **Ask** paragraph (line 5996):

```markdown
**Shipped:** spec `docs/superpowers/specs/2026-09-21-vendors-module-design.md`, plan
`docs/superpowers/plans/2026-09-21-vendors-module.md`. `vendor_profiles` doc collection (id = company
id; migration `00NN_vendor_profiles`, idempotent) + `lib/stores/vendors.ts`; pure
`lib/vendor-status.ts` (status, owner-task specs, catalog effective date over `mfrKey` aliases,
manufacturer directory, owner resolution) and `lib/vendor-tasks.ts` (one catalog read + one
profiles read; exactly-once assignments by `source` key; daily cron step); `/vendors` (table,
status/search filters, unclaimed-manufacturer claims, + New vendor) and `/vendors/[id]`
(Overview / Contacts / Price lists / Activity); `settings.catalogOwner` + the Catalog owner card on
`/catalog`; Inbox picker Customers/Vendors optgroups and `/inbox?customer=<id>` (+`&log=1`);
catalog facet tooltip + banner vendor link; CRM › Vendors nav; seeded `rose-brand`. Gates: tsc,
test:specs, test:review:regressions, test:smoke (`/vendors`, `/vendors/rose-brand` + tabs), eslint
on touched files. Decision D160.
```

- [ ] **Step 7: Verify** — `npx tsx scripts/test-review-and-spec.ts | grep -E '#122|ALL PASSED'` → all PASS; `npx tsc --noEmit -p . | tail -3` → empty; `npx eslint src/components/nav/nav-data.ts src/db/seeds/vendors.ts src/db/seeds/customers.ts src/db/seed-data.ts scripts/smoke-routes.ts` → clean; `npm run test:review:regressions 2>&1 | tail -3` → passed. The controller then runs `npm run test:smoke` (expects the new `/vendors*` and `/inbox?customer=…` entries 200) and the browser pass from spec §5 (claim a manufacturer, log a price list, see the status chip + Jena's task on Home, set a contact role, link an Inbox thread to the vendor and see it under Activity).

- [ ] **Step 8: Commit**

```bash
git add src/components/nav/nav-data.ts src/db/seeds/customers.ts src/db/seeds/vendors.ts src/db/seed-data.ts scripts/smoke-routes.ts scripts/test-review-and-spec.ts DECISIONS.md PUNCHLIST.md
git commit -m "feat(vendors): CRM nav entry, seeded vendor, smoke routes; docs D160 + #122 DONE

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Self-review

**1. Spec coverage — each spec section → task**

| Spec | Where |
| --- | --- |
| §1 vendor = company `type === "vendor/manufacturer"`; `PARTNER_TYPES` gains the exact string, keeps `"Vendor"` | Task 1 Steps 3-4 (+ spec test) |
| §1 `vendor_profiles` docTable, `_seq_bump` trigger, one migration hand-edited idempotent (D141/#120 shape) | Task 1 Steps 5-6 |
| §1 `VendorProfile` shape (manufacturers, priceLists newest-first, discounts, registration, contactRoles, createdAt/updatedAt) | Task 1 Step 7 (`normalizeProfile` sorts newest-first) |
| §1 catalog match by `mfrKey()`; one vendor per manufacturer, claiming moves it; "Claim manufacturer" for unclaimed | Task 1 (`claimManufacturer`), Task 2 (`manufacturerDirectory`/`unclaimedManufacturers`), Task 4 (`UnclaimedPanel`, `claimManufacturerAction`) |
| §1 `settings.catalogOwner`, default Jena Tolksdorf else first Admin, assignee by display name | Task 2 (`resolveCatalogOwner`), Task 3 (settings field, `setCatalogOwnerAction`, card, `ensureVendorAssignments` uses `owner.name`) |
| §2 `catalogEffectiveAt` newest `effectivePriceDate`; `lastList` newest by `effectiveAt`; the four statuses + boundaries | Task 2 (`catalogEffectiveAtFor`, `newestList`, `vendorStatus` + boundary tests) |
| §2 `vendorTasks` titles + `source` key; exactly-once, done not re-opened; after ledger save + daily cron | Task 2 (`vendorTasks`), Task 3 (`ensureVendorAssignments`, cron step, `logPriceListAction` in Task 5 calls it) |
| §3 `/vendors` table columns, status/search filters, "+ New vendor", unclaimed panel (creates the vendor named after the manufacturer if none matches by normalized name) | Task 4 (`vendorCompanyNamed` from Task 1) |
| §3 `/vendors/[id]` header (name, type, status chip, owner task) + Overview / Contacts (roles, `EntityQuickAdd kind="contact"`) / Price lists (ledger + form, immediate re-evaluation) / Activity (`loadCustomerFeed`, Log call / New email via `customer=<id>`) | Task 5 (+ Task 6 for the Inbox side of `customer=`) |
| §3 Inbox sidebar picker grouped Customers / Vendors; `linkThreadToCustomerAction` unchanged | Task 6 Steps 3-4 |
| §3 Catalog facet tooltip with the vendor name; outdated banner links to the vendor | Task 6 Step 6 |
| §3 actions `saveVendorProfileAction`, `claimManufacturerAction`, `logPriceListAction`, `setContactRoleAction`, `setCatalogOwnerAction`; all sessions required, edits `requirePerm("create")` | Tasks 3-5 (`setCatalogOwnerAction` is `manage_users` — logged in D160) |
| §4 data flow (import → `pricedAt` → status; ledger save → ensure → Home Queue; cron bounded to one catalog + one profiles read; Inbox `customerId` → Activity) | Task 3 (`loadContext` reads each once), Task 5, Task 6 |
| §5 tests: `vendorStatus` all four + boundaries, `vendorTasks`, `mfrKey` claim matching, `PARTNER_TYPES`; regressions: profile CRUD, claim moves, exactly-one open task + no duplicate on second save, later import flips to current + no reopen, cron with zero vendors; smoke `/vendors`, `/vendors/<seeded id>`; seed one vendor profile | Task 1 (spec + regression), Task 2 (spec), Task 3 (regression), Task 7 (smoke + seed); browser pass listed for the controller in Task 7 Step 7 |
| Out of scope (file diff, procurement linking, multi-vendor manufacturers) | untouched; follow-ups named in D160 |

**2. Placeholder scan** — no "TBD/TODO/similar to/handle edge cases"; every step shows the code. The only conditional instructions are (a) the catalog plan's module location (`grep effectivePriceDate`, `grep setPriceListEffectiveAction` for the banner row — files that plan creates, cited by the function names its spec fixes) and (b) the migration-index `NN` / decision number `D160`, both read from the repo at execution time with the exact command given.

**3. Type/name consistency across tasks**
- `PriceListEntry`, `VendorDiscounts`, `VendorRegistration` are defined in the store in Task 1 and moved to `src/lib/vendor-status.ts` in Task 2 Step 3 with re-exports from the store — every later import uses `@/lib/vendor-status` for types (client files) and `@/lib/stores/vendors` for functions (server files).
- `ManufacturerEntry` (Task 2) is what `loadVendors().directory` extends with `vendorName` (Task 3) and what `OverviewTab`/`UnclaimedPanel` consume (Tasks 4-5).
- `ensureVendorAssignments(vendorId?, by?)` — same signature in Task 3 (definition, cron `("Quartzite (daily check)")`, regression tests) and Task 5 (`logPriceListAction` passes `me.name`).
- `claimManufacturerAction(vendorId | null, mfr)` — Task 4 definition; `UnclaimedPanel` passes `target[name] || null`; `OverviewTab` passes the vendor id.
- `VendorContactVM` is exported from `contacts-tab.tsx` and imported type-only by the server page.
- `ReaderVM.customerOptionGroups` (Task 6) is built with `groupCompanyOptions` (Task 6, `vendor-status.ts`) — its `{ value, label }` options are the harness's `Opt` shape.
- `InboxShell.initialLog` / `LogModal.initialCustomerId` — Task 6 threads the same value through page → shell → modal.
- `activeKeyFor("/vendors/rose-brand")` maps by first path segment (`nav-data.ts:109`), so the dynamic route lights the tab without a second map entry.
- `catalogEffectiveAtFor` takes `DatedPart[]` (`{ mfr?, pricedAt? }`) and casts at the `effectivePriceDate` call, so `CatalogPart[]` from `loadContext` and the literal fixtures in the spec test both type-check regardless of how the catalog plan typed that parameter; the spec test's `settings0` is `as unknown as` for the same reason.
- `seeds/vendors.ts` imports the `VendorProfile` type only (no runtime store import) so the spec harness stays DB-free when it imports the seed.
