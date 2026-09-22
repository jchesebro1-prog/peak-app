# Vendors module: catalog-linked vendor records, price-list ledger, owner tasks, contacts, terms, Inbox activity

Status: approved by Jeff (brainstorming 2026-09-21; decision: **date rule only** — no file diff).
Punch #122. Branch `punch-2026-09-21-round-2`. Depends on the catalog price dates from
`2026-09-21-catalog-price-dates-and-assemblies-design.md` (#133).

## Context

Vendor identity is free text everywhere: `CatalogPart.mfr` (`src/lib/stores/catalog.ts:32`),
`ProcurementLine.vendor` / `ProjectDelivery.vendor` (`src/lib/stores/projects.ts:122,137`), a
static `VENDORS` map (`projects.ts:106-112`). There is no vendors table and no price-list history.
The company model already has a type value `"vendor/manufacturer"` (`src/lib/identity/config.ts:17`)
and `PARTNER_TYPES` checks a literal `"Vendor"` (`src/lib/identity/venue-defaults.ts:16-24`) —
a casing mismatch, so vendor companies get a base venue today. Companies carry contacts, an
activity feed (`src/lib/customer-feed.ts:37-49`, `byCustomer()` `comms.ts:604`) and Inbox linking
(`inbox/link-actions.ts:64`) that all work for any company. Teammate tasks are Home Queue
assignments (`src/lib/stores/assignments.ts:67-90`; `link.kind` already includes `"company"`).

Jeff's ask (2026-09-21): a vendor portion of the app that mostly references the catalog's vendors;
tracks when we last received a price list and whether the catalog matches it — if not, a task for
Jena; contacts and what to contact them for; discounts and project-registration info; interactions
logged via the Inbox.

## 1. Model

- **A vendor is a company** with `type === "vendor/manufacturer"`. `PARTNER_TYPES` gains that exact
  string (keeping `"Vendor"` for legacy rows) so no base venue is minted for vendors.
- **`vendor_profiles`** — a new doc collection (`docTable("vendor_profiles")`, `_seq_bump` trigger,
  one migration generated with `drizzle-kit generate` and then hand-edited to be idempotent per
  D141 — `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` / `CREATE OR REPLACE TRIGGER`,
  the #120 shape), one document per vendor company, id = the company id:
  ```ts
  type VendorProfile = {
    id: string;                       // company id
    manufacturers: string[];          // catalog `mfr` spellings this vendor supplies (aliases)
    priceLists: { id: string; receivedAt: number; effectiveAt: number; note: string;
                  loggedBy: string }[];          // newest first
    discounts: { note: string; percentOffList: number | null; terms: string };
    registration: { program: string; url: string; accountNumber: string; notes: string };
    contactRoles: Record<string, string>;        // contactId → "what to contact them for"
    createdAt: number; updatedAt: number;
  };
  ```
- **Catalog match** is by `mfrKey()` (from the catalog spec) over `manufacturers[]`; the list page
  offers "Claim manufacturer" for any catalog manufacturer not yet claimed by a vendor. A
  manufacturer belongs to at most one vendor (claiming moves it).
- **Settings:** `catalogOwner: { userId } | null` (Settings → Catalog), default the user named
  "Jena Tolksdorf" if present, else the first Admin. Assignments are addressed by display name
  (`Assignment.assignee`), resolved from the user record at creation time.

## 2. Status and the owner task (`src/lib/vendor-status.ts`, pure)

For each vendor: `catalogEffectiveAt` = newest `effectivePriceDate` across parts whose `mfrKey` is
in `manufacturers`; `lastList` = newest `priceLists[]` entry by `effectiveAt`.

`vendorStatus({ lastList, catalogEffectiveAt, now })` →
- `"no-list"` — no ledger entry;
- `"newer-list"` — `lastList.effectiveAt > (catalogEffectiveAt ?? 0)` (a list arrived, catalog not
  updated from it);
- `"outdated"` — `now - max(lastList.effectiveAt, catalogEffectiveAt) > OUTDATED_AFTER_MS`;
- `"current"` otherwise.

`vendorTasks(status, vendor)` → zero or one assignment spec:
- `newer-list` → `"Update catalog: ‹vendor› price list effective ‹date›"`;
- `outdated` → `"Request updated price list from ‹vendor›"`;
keyed by `source = "auto: vendor ‹id› ‹status› ‹effectiveAt›"` so `ensureVendorAssignments()`
creates each at most once (skips when an open assignment with that `source` exists; a done one is
not re-opened). Runs after a ledger save and inside the existing daily cron route.

## 3. Screens (`src/app/(app)/vendors/*`, nav under CRM next to Companies)

- **`/vendors`** — table: vendor · manufacturers (chips) · parts · catalog price date · last list
  received / effective · status chip (Current / Newer list received / Outdated / No list logged) ·
  owner task (link when one is open). Filters: status, search. "+ New vendor" = the Companies
  quick-add with type preset; "Unclaimed manufacturers" panel lists catalog `mfr` values with no
  vendor and a one-click claim (creates the vendor company named after the manufacturer if none
  matches by normalized name).
- **`/vendors/[id]`** — header (name, type, status chip, owner task) and tabs:
  - **Overview** — discounts (note, % off list, terms) and project registration (program, URL,
    account #, notes), inline-editable; manufacturers claimed (add/remove).
  - **Contacts** — the company's contacts (existing components) with an editable "Contact for…"
    role per contact (`contactRoles`), quick-add contact reuses `EntityQuickAdd kind="contact"`.
  - **Price lists** — the ledger (received, effective, note, logged by) + "Log price list" form
    (received date default today, effective date, note). Saving re-evaluates the status and the
    owner task immediately.
  - **Activity** — `loadCustomerFeed()` for the company (notes, threads via `byCustomer`, site
    visits — the feed as it exists; no vendor-specific rows are added) + "Log call" / "New email"
    that open the Inbox composer with the company pre-linked (extend the existing `/inbox?draft=`
    entry point from #36 with a `customer=<id>` variant), so vendor interactions live in the Inbox
    like customer ones.
- **Inbox sidebar:** the customer picker groups companies as "Customers" / "Vendors" so a vendor
  thread can be linked without hunting; nothing else changes (`linkThreadToCustomerAction` already
  accepts any company).
- **Catalog page:** the manufacturer facet shows the vendor name in a tooltip when claimed; the
  outdated banner links to the vendor.

Actions (`vendors/actions.ts`, all `requireUser`; edits `requirePerm("create")`):
`saveVendorProfileAction(id, patch)`, `claimManufacturerAction(vendorId, mfr)`,
`logPriceListAction(vendorId, { receivedAt, effectiveAt, note })`, `setContactRoleAction`,
`setCatalogOwnerAction(userId)`.

## 4. Data flow

Import (#132/#133) → `pricedAt` on parts → `priceBooks()` / `effectivePriceDate` → vendor status.
Ledger save → `ensureVendorAssignments(vendorId)` → Home Queue. Daily cron → `ensureVendorAssignments()`
for all vendors (bounded: one catalog read, one profiles read). Inbox → `customerId` = vendor
company → Activity tab.

## 5. Testing

- `test:specs`: `vendorStatus` for all four states incl. boundaries; `vendorTasks` titles/keys;
  `mfrKey` claim matching; `PARTNER_TYPES` includes the exact type string.
- `test:review:regressions` (scratch DB): profile CRUD; claim moves a manufacturer between vendors;
  logging a newer list creates exactly one open assignment for the catalog owner and a second save
  doesn't duplicate it; a later import that stamps `pricedAt ≥ effectiveAt` flips the status to
  current and does not reopen a done assignment; the cron path runs with zero vendors.
- `test:smoke`: `/vendors`, `/vendors/<seeded id>` 200.
- Seed: one vendor profile (e.g. the manufacturer with the most seeded parts) so the pages have
  content in dev.
- Browser pass: claim a manufacturer, log a price list, see the status chip + Jena's task on Home;
  set the contact role; link an Inbox thread to the vendor and see it under Activity.

## Out of scope

- Uploading/diffing the price-list file (decided against 2026-09-21 — date rule only).
- Purchase orders / procurement linking `ProcurementLine.vendor` to vendor records (log as a
  follow-up once vendors exist).
- Multi-vendor manufacturers (one owner per manufacturer).
