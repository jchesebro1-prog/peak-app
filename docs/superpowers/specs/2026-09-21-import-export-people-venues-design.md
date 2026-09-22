# Import/Export: separate customers / contacts / venues imports with link-back, category, and zip

Status: approved by Jeff (brainstorming 2026-09-21; decision: **unmatched customers are
auto-created**). Punch #137 — closes #82 (people import) and #83 (venue import).
Branch `punch-2026-09-21-round-2`.

## Context

The Import hub has one `customers` type (`src/app/(app)/import/registry.ts:129-186`; template
columns `import/types.ts:38-49`: Customer Name*, Type, Contact Name, Email, Phone, Venue, Address,
City, State, Notes). One contact and one venue ride along per row, embedded (`registry.ts:139-158`);
matching is by normalized name only (`registry.ts:132`, `norm()` `import/parse.ts:127-131`). `zip`
exists on `companies` (`schema.ts:210`) and `sites` (`schema.ts:308`) but `CustomerLocation` /
`CustomerDoc` (`customers.ts:78-136`) don't expose it and `writeRecord()` (`customers.ts:497-515`)
only preserves an existing value. `CustomerDoc.type` is the closest thing to a category
(`lifecycle` and `keywords` also exist, never set by the importer). No `people` or `venues` types.

Jeff's asks (2026-09-21): customers, contacts and venues as separate import options with a
category column; a zip for the company address; imported contacts and venues link back to the
customer account.

## 1. Store plumbing (`src/lib/stores/customers.ts`, `src/lib/identity/*`)

- `CustomerLocation.zip?: string` and `CustomerRecordInput.zip?: string` (company HQ/billing);
  `writeRecord()` writes both instead of only preserving. `toLocationInput` keeps `locationName`
  (the #96 review follow-up).
- `category` maps to the existing `type` field (the Companies type picker values,
  `identity/config.ts:10-21`); free values are accepted as-is (the picker is "default hint only").
- `findCustomerByName(name)` / `findCustomerById(id)` helpers exposed for the importers.

## 2. Import types (`import/types.ts`, `import/registry.ts`)

**customers** — columns: `Customer Name*`, `Category` (alias `Type`), `Address`, `City`, `State`,
`Zip`, `Phone`, `Website`, `Notes`. Embedded contact/venue columns are **removed from the
template** but still accepted as aliases for one release (old files keep working). Match: `Customer
ID` if present, else normalized name. Dedupe label unchanged.

**contacts** — `Customer*` (name) or `Customer ID`, `Name*`, `Email`, `Phone`, `Mobile`, `Title`,
`Role` (free text, e.g. "billing"), `Primary` (yes/no), `Notes`. Writer: resolve the customer →
upsert the contact by (customer, normalized email) else (customer, normalized name); `primary:true`
demotes the others. Dedupe key: customer + email|name.

**venues** — `Customer*` or `Customer ID`, `Venue Name*`, `Address`, `City`, `State`, `Zip`,
`Category` (venue kind, e.g. theatre/school/church — stored as a new optional
`CustomerLocation.kind` string, persisted on the site row's existing free-text kind/type column if
one exists, else inside the location document),
`Notes`. Writer: resolve the customer → upsert the location by (customer, normalized venue name).
Dedupe key: customer + venue name. Venue `zip` persists via the new plumbing.

**Link-back with auto-create:** `resolveCustomerForRow(row, cache)`: `Customer ID` match →
normalized-name match → **create** a bare customer `{ name, type: row.Category-for-customer ?? "" }`
and add it to the cache so later rows in the same file link to the same new record. The preview
step lists "will create N customers: …" before commit; the result banner reports created vs linked
counts. Rows with neither `Customer` nor `Customer ID` fail validation.

**Exports:** `contacts` and `venues` join the export list (`registry.ts:660-676`, `export/route.ts`),
one row per contact / venue with the customer's name and id; `customers` gains Category + Zip.

## 3. UI (`import/page.tsx`, `import/controls.tsx`)

The type picker shows the three as separate cards ("Customers", "Contacts", "Venues") with template
downloads; the preview table gets a "Customer" column showing *linked* / *will create*; nothing
else changes.

## 4. Testing

- `test:specs`: header alias resolution for all three templates; `resolveCustomerForRow` order (id →
  name → create) and cache reuse within one file; yes/no parsing for `Primary`; zip normalization
  (5-digit and ZIP+4 kept as typed, whitespace trimmed).
- `test:review:regressions` (scratch DB): customers import persists zip + category; contacts
  import links to an existing customer by name and by id, demotes the previous primary, and
  re-importing the same file is idempotent; venues import creates the location with zip and links
  it; an unmatched customer name creates exactly one customer for several rows; export round-trips
  (import → export → same rows).
- `test:smoke`: `/import`, `/import?type=contacts`, `/import?type=venues`, export URLs 200.
- Browser pass: import the three sample files in order; check the customer record shows the
  contacts and venues with zips; confirm the "will create" preview.

## Out of scope

- Merging duplicate customers created by typos (the preview shows what will be created; cleanup
  stays manual).
- Custom fields / keywords columns.
- The people-as-first-class UI beyond what #20 already shipped.
