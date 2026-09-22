# Import/Export: Customers / Contacts / Venues Implementation Plan (PUNCHLIST #137, closes #82/#83)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the Import hub's single `customers` importer into three — customers (Category, Zip, Phone, Website), contacts, venues — where contacts and venues link back to the customer by `Customer ID` or normalized name, auto-create the customer when nothing matches, persist zip (company + venue) and a free-text venue category, and export the same columns back out.

**Architecture:** The customer store (`src/lib/stores/customers.ts`) stays the seam: `CustomerLocation`/`CustomerContact`/`CustomerDoc` gain `zip`/`kind`/`mobile`/`phone`/`website`, `writeRecord()` writes them write-when-provided / preserve-when-undefined (backfilled before the D83 change check, like #23's lifecycle/keywords/custom), and every importer writes through `Customers.upsert()`. The pure link-back rules (`resolveCustomerForRow`, contact/venue matching + merging, yes/no, zip) live in a new DB-free `src/app/(app)/import/link.ts` that both the server registry and the client preview import, so "linked / will create" in the preview is the same computation the commit runs. The venue category needs one nullable column (`sites.kind`, hand-written migration 0023, the way 0021/0022 were written) because `sites` has no free-text kind column (`venueKind` is the controlled vocabulary) and locations are relational rows, not documents. Spec: `docs/superpowers/specs/2026-09-21-import-export-people-venues-design.md`.

**Tech Stack:** Next.js 16 App Router, TypeScript, Drizzle on Postgres/PGlite, doc-store JSON documents, server actions, tsx test harnesses

## Global Constraints

- Node at `~/.local/node/bin`: `export PATH=$HOME/.local/node/bin:$PATH` first.
- **PGlite is single-process.** `test:specs` is pure. `test:review:regressions` opens its own scratch DB; run it alone — `ps aux | grep -E 'tsx|next dev'` must be empty first. **Implementers must NOT run `npm run test:smoke`, `next dev` or `next build`** — the controller runs those after the plan lands. Implementers also never run `npm run db:generate` / `db:*` scripts: the one migration here is hand-written (Task 1) exactly like `drizzle/0021_krisp_recordings.sql` and `0022_customer_domains_repair.sql`.
- No schema change beyond the one the spec's venues persistence rule requires: `sites.kind` (nullable text). Nothing else touches `src/db/schema.ts`.
- `requireUser()` / `requirePerm()` already gate every action this plan touches (`importRecords` → `requirePerm("manage_users")`; the export route → `requirePerm("manage_users")`); new code adds no unguarded entry point.
- Timestamps epoch-ms. Ids: customers `c<ms>-<n>` from the importer (existing convention), locations `l<…>` legacy ids (writeRecord keeps them as `legacyLocId`), contacts minted `ct-…` by writeRecord.
- No hardcoded accent — reuse `var(--accent)`, `var(--accent-soft)`, `color-mix(in srgb, var(--accent) 70%, #000)` exactly as `page.tsx`/`controls.tsx` already do. No emoji in UI copy.
- Every new pure helper lives in a DB-free module (`import/link.ts`, `import/parse.ts`, `import/types.ts`, `companies/lib.ts`) and gets a `test:specs` check; DB behaviour gets a `test:review:regressions` check; new routes go into `scripts/smoke-routes.ts`.
- Verification commands: `npx tsc --noEmit -p .`; `npx tsx scripts/test-review-and-spec.ts | grep -E '#137|ALL PASSED'`; `npm run test:review:regressions`; `npx eslint <files>`.
- `git add` only the files each task names. Commit after every task with the trailer `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Decisions taken here are logged as **D159** in Task 8; the executor must first confirm `git show origin/main:DECISIONS.md | grep -c '^## D159'` prints `0` (D-numbers collided today) and renumber if not.

---

## File Structure

- `src/db/schema.ts` — `sites.kind` nullable text column (after `zip`, line 354).
- `drizzle/0023_sites_kind.sql` — hand-written `ALTER TABLE "sites" ADD COLUMN IF NOT EXISTS "kind" text`.
- `drizzle/meta/_journal.json`, `drizzle/meta/0023_snapshot.json` — journal entry + snapshot copy with the column (script in Task 1).
- `src/lib/stores/customers.ts` — seam fields (`zip`/`kind` on locations, `mobile` on contacts, `zip`/`phone`/`website` on the doc), compose/normalize/contentKey, `writeRecord()` write + preserve + backfill, `findCustomerByName()` / `findCustomerById()`.
- `src/app/(app)/companies/types.ts` — `LocationInput.zip?/kind?`, `ContactInput.mobile?`.
- `src/app/(app)/companies/actions.ts` — `saveCustomerAction` carries zip/kind/mobile through.
- `src/app/(app)/companies/lib.ts` — shared pure `toLocationInput()` / `toContactInput()` (keeps `locationName` — the #96 review follow-up).
- `src/app/(app)/companies/[id]/page.tsx` — edit-modal initial uses the shared converters; venue rows show zip + category.
- `src/app/(app)/quotes/new/actions.ts`, `src/app/(app)/inbox/link-actions.ts` — drop the local converter copies, import the shared ones.
- `src/app/(app)/import/parse.ts` — `FieldKind "zip"`, `normalizeZip()`, `FieldDef.requiredUnless` / `.hidden`, `prepareRows` honours `requiredUnless`.
- `src/app/(app)/import/types.ts` — customers template rewritten (Category/Zip/Phone/Website; embedded columns hidden aliases), new `contacts` + `venues` types.
- `src/app/(app)/import/link.ts` — NEW pure module: `resolveCustomerForRow`, `parseYesNo`, `matchContact`, `matchLocation`, `mergeContact`, `mergeLocation`, `venueKindFromCategory`, `previewLinks`.
- `src/app/(app)/import/registry.ts` — `LinkStats`, `ImportResult` link counts, `Writer` signature, `WRITERS.customers` rewrite, new `WRITERS.contacts` / `WRITERS.venues`, hidden-aware `templateCsv`/`exportCsv`.
- `src/app/(app)/import/actions.ts` — encodes the two link counts into `r=`.
- `src/app/(app)/import/page.tsx` — loads the customer index for linkable types, threads it to the preview, `DonePanel` shows linked/created.
- `src/app/(app)/import/controls.tsx` — Customer preview column, "Will create N new customers" box, `requiredUnless`-aware required check, hidden-aware placeholder.
- `scripts/test-review-and-spec.ts` — pure checks (Tasks 2, 3).
- `scripts/test-review-regressions.ts` — scratch-DB checks (Tasks 1, 4, 5, 6).
- `scripts/smoke-routes.ts` — new hub/export routes (Task 8).
- `DECISIONS.md`, `PUNCHLIST.md` — D159; #137/#82/#83 → DONE (Task 8).

---

### Task 1: Store plumbing — `sites.kind` column, zip/kind/mobile/phone/website through the seam, `findCustomerByName` / `findCustomerById`

**Files:**
- Modify: `src/db/schema.ts:354` (sites table, after `zip: text("zip"),`)
- Create: `drizzle/0023_sites_kind.sql`
- Modify: `drizzle/meta/_journal.json` (append entry), Create: `drizzle/meta/0023_snapshot.json` (generated by the script in Step 3)
- Modify: `src/lib/stores/customers.ts:78-102` (location/contact types), `:104-136` (`CustomerDoc`), `:142-179` (input types), `:201-251` (`normalizeRecord`), `:267-298` (`composeLocation`/`composeContact`), `:300-333` (`composeDoc`), `:411-419` (after `byName`, new finders), `:440-460` (`contentKey`), `:469-619` (`writeRecord`)
- Test: `scripts/test-review-regressions.ts` (section "#137 T1")

**Interfaces:**
- Consumes: `getCompany`, `saveCompany` (`src/lib/identity/companies.ts`); `sitesForCompany`, `saveSite`, `softDeleteSite` (`src/lib/identity/sites.ts`); `contactsForCompany`, `phonesFor`, `phonesForContacts`, `setPhones`, `displayName` (`src/lib/identity/contacts.ts`) — all already imported in `customers.ts`.
- Produces (all in `src/lib/stores/customers.ts`):
  - `CustomerLocation.zip?: string; kind?: string`, `CustomerLocationInput.zip?: string; kind?: string`
  - `CustomerContact.mobile?: string`, `CustomerContactInput.mobile?: string`
  - `CustomerDoc.zip?: string; phone?: string; website?: string`, `CustomerRecordInput.zip?: string; phone?: string; website?: string`
  - `findCustomerByName(name: string | null | undefined): Promise<CustomerDoc | null>` — case/punctuation-insensitive exact name match
  - `findCustomerById(id: string | null | undefined): Promise<CustomerDoc | null>`
  - `SiteRow.kind: string | null` (from the schema change)

- [ ] **Step 1: Write the failing regression test** — in `scripts/test-review-regressions.ts`, add to the import block at the top (after line 23 `import { addUser } from "@/lib/users";`):

```ts
import {
  upsert as upsertCustomer,
  get as getCustomer,
  all as allCustomers,
  findCustomerByName,
  findCustomerById,
} from "@/lib/stores/customers";
```

and insert this block inside `main()` immediately before `console.log("review regression checks passed");` (line 738):

```ts
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
  }
```

- [ ] **Step 2: Run it, expect failure** — `npm run test:review:regressions 2>&1 | tail -5` → a TypeScript/tsx error that `findCustomerByName` is not exported (or `zip` is not a known property).

- [ ] **Step 3: Schema + migration** — in `src/db/schema.ts` after line 354 (`zip: text("zip"),` inside `sites`):

```ts
    /** #137 — free-text venue category from the venues import ("theatre",
     *  "school", "church"). `venueKind` stays the controlled vocabulary the
     *  estimator and the Companies modal use. */
    kind: text("kind"),
```

Create `drizzle/0023_sites_kind.sql`:

```sql
-- #137 (D159): free-text venue category from the venues import. The spec's
-- "persist on the site row's existing free-text kind column, else in the
-- location document" has no home — venue_kind is the controlled vocabulary
-- (proscenium/church/flat/blackbox/arena) and sites are relational rows, not
-- documents — so this nullable column is the relational equivalent.
-- Hand-written (drizzle-kit generate needs the single-process dev DB), like
-- 0021/0022; IF NOT EXISTS so every database converges (D141).
ALTER TABLE "sites" ADD COLUMN IF NOT EXISTS "kind" text;
```

Then generate the journal entry + snapshot with plain `node` (no database is opened):

```bash
export PATH=$HOME/.local/node/bin:$PATH
node - <<'EOF'
const fs = require("fs");
const prev = JSON.parse(fs.readFileSync("drizzle/meta/0022_snapshot.json", "utf8"));
const next = { ...prev, id: require("crypto").randomUUID(), prevId: prev.id };
const cols = next.tables["public.sites"].columns;
const rebuilt = {};
for (const [k, v] of Object.entries(cols)) {
  rebuilt[k] = v;
  if (k === "zip") rebuilt.kind = { name: "kind", type: "text", primaryKey: false, notNull: false };
}
next.tables["public.sites"].columns = rebuilt;
fs.writeFileSync("drizzle/meta/0023_snapshot.json", JSON.stringify(next, null, 2));
const j = JSON.parse(fs.readFileSync("drizzle/meta/_journal.json", "utf8"));
j.entries.push({ idx: 23, version: "7", when: Date.now(), tag: "0023_sites_kind", breakpoints: true });
fs.writeFileSync("drizzle/meta/_journal.json", JSON.stringify(j, null, 2));
console.log("ok", next.id, next.prevId);
EOF
git diff --stat drizzle/meta/_journal.json   # exactly one new entry, idx 23, tag 0023_sites_kind
```

(`when` must exceed 0022's `1790050877402`; `Date.now()` does. drizzle-orm's migrator selects work by `created_at < folderMillis`, so the fresh timestamp is what makes production apply it.)

- [ ] **Step 4: Seam types** — in `src/lib/stores/customers.ts` replace lines 78-102 (`CustomerLocation` + `CustomerContact`) with:

```ts
export type CustomerLocation = {
  id?: string;
  locationName?: string;
  label?: string;
  primary: boolean;
  /** Street address (site visits / calendar invites, D76) — city/state stay
   *  the separate fields they always were. */
  address?: string;
  city?: string;
  state?: string;
  /** #137 — venue zip (sites.zip) and the free-text category from the venues
   *  import (sites.kind). Both write-when-provided / preserve-when-undefined
   *  (see writeRecord). */
  zip?: string;
  kind?: string;
  lat?: number | string | null;
  lng?: number | string | null;
  venueKind: string;
  travelMiles: number | null;
  travelMin: number | null;
};

export type CustomerContact = {
  name: string;
  role: string;
  email: string;
  /** Phone number (site visits / calendar invites, D76) — the non-mobile
   *  channel when the contact has one (#137), else the first phone. */
  phone?: string;
  /** #137 — the "mobile"-labelled channel (contacts template `Mobile`). */
  mobile?: string;
  primary: boolean;
};
```

In `CustomerDoc` (lines 104-136) add after `contacts: CustomerContact[];`:

```ts
  /**
   * #137 — company HQ/billing fields off the companies row (zip, main
   * phone, website). Write-when-provided / preserve-when-undefined, same
   * contract as lifecycle/keywords/custom below; pinned in contentKey.
   */
  zip?: string;
  phone?: string;
  website?: string;
```

In `CustomerLocationInput` (lines 142-155) add after `state?: string;`: `zip?: string;` and `kind?: string;`. In `CustomerContactInput` (157-163) add after `phone?: string;`: `mobile?: string;`. In `CustomerRecordInput` (165-179) add after `contacts?: CustomerContactInput[];`:

```ts
  /** #137 — company zip / main phone / website; undefined = preserve. */
  zip?: string;
  phone?: string;
  website?: string;
```

- [ ] **Step 5: normalizeRecord** — replace the `locs` map (lines 202-216) and the `contacts` map (220-231), and add the HQ fields after the `tier` block (243-244):

```ts
  const locs: CustomerLocation[] = (c.locations || []).map((l) => ({
    id: l.id,
    locationName: l.locationName,
    label: l.label,
    primary: !!l.primary,
    address: (l.address || "").trim() || undefined,
    city: l.city,
    state: l.state,
    // #137 — blank and absent both mean "preserve what's stored" (an import
    // cell can't clear a zip); a value writes. Keys stay in the literal so
    // the JSON key order matches composeLocation for the D83 change check.
    zip: (l.zip || "").trim() || undefined,
    kind: (l.kind || "").trim() || undefined,
    lat: l.lat,
    lng: l.lng,
    venueKind: l.venueKind || "proscenium",
    travelMiles:
      l.travelMiles === "" || l.travelMiles == null ? null : Number(l.travelMiles),
    travelMin: l.travelMin === "" || l.travelMin == null ? null : Number(l.travelMin),
  }));
```

```ts
    .map((ct) => ({
      name: ct.name,
      role: ct.role || "",
      email: ct.email || "",
      phone: (ct.phone || "").trim() || undefined,
      mobile: (ct.mobile || "").trim() || undefined,
      primary: !!ct.primary,
    }));
```

```ts
  const tier = (c.pricingTier || "").trim();
  if (tier) doc.pricingTier = tier;
  // #137 — company HQ fields, only when the caller provided a value.
  const zip = (c.zip || "").trim();
  if (zip) doc.zip = zip;
  const phone = (c.phone || "").trim();
  if (phone) doc.phone = phone;
  const website = (c.website || "").trim();
  if (website) doc.website = website;
```

- [ ] **Step 6: composition** — `composeLocation` (267-282): add after `state: s.state ?? undefined,`:

```ts
    zip: s.zip ?? undefined,
    kind: s.kind ?? undefined,
```

Replace `composeContact` (284-298) with:

```ts
function composeContact(
  c: ContactRow,
  emails: ContactEmailRow[] | undefined,
  phones: ContactPhoneRow[] | undefined
): CustomerContact {
  const email = (emails ?? [])[0]?.email ?? "";
  const list = phones ?? [];
  // #137 — `phone` is the (primary-first) non-mobile number and `mobile` the
  // mobile-labelled one, so a round trip through writeRecord targets the
  // right row each. A contact with only a mobile still shows it as phone.
  const phone = (list.find((p) => p.label !== "mobile") ?? list[0])?.phone;
  const mobile = list.find((p) => p.label === "mobile")?.phone;
  return {
    name: displayName(c),
    role: c.title || "",
    email,
    phone: phone || undefined,
    mobile: mobile || undefined,
    primary: c.isPrimary,
  };
}
```

In `composeDoc` (300-333) add after `if (co.pricingTier) doc.pricingTier = co.pricingTier;`:

```ts
  // #137 — HQ fields straight off the companies row.
  if (co.zip) doc.zip = co.zip;
  if (co.mainPhone) doc.phone = co.mainPhone;
  if (co.website) doc.website = co.website;
```

- [ ] **Step 7: finders** — after `byName` (line 419) add:

```ts
/** Case/punctuation-insensitive name key — the same rule the Import hub's
 *  `norm()` uses to dedupe, kept local so the store never imports a route
 *  module. */
function normName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** #137 — the importers' name match: exact after normalization ("cedar-grove
 *  SCHOOLS" finds "Cedar Grove Schools"). Never a substring match. */
export async function findCustomerByName(
  name: string | null | undefined
): Promise<CustomerDoc | null> {
  const key = normName(String(name ?? ""));
  if (!key) return null;
  const list = await allCompanies();
  const m = list.find((c) => normName(c.name || "") === key);
  return m ? get(m.id) : null;
}

/** #137 — id lookup under the name the importers use (alias of get()). */
export async function findCustomerById(
  id: string | null | undefined
): Promise<CustomerDoc | null> {
  return get(id);
}
```

- [ ] **Step 8: contentKey** — replace lines 451-459 (from `delete rest.lifecycle;` through the `rest.custom = …` statement) with:

```ts
  delete rest.lifecycle;
  delete rest.keywords;
  delete rest.custom;
  // #137 — same pinning for the HQ fields (absent and "" are the same thing).
  delete rest.zip;
  delete rest.phone;
  delete rest.website;
  rest.zip = d.zip ?? "";
  rest.phone = d.phone ?? "";
  rest.website = d.website ?? "";
  rest.lifecycle = d.lifecycle ?? "none";
  rest.keywords = d.keywords ?? [];
  rest.custom = Object.fromEntries(
    Object.entries(d.custom ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  );
```

- [ ] **Step 9: writeRecord** — replace the whole function (lines 469-619) with:

```ts
/**
 * Write one normalized record through to the identity tables.
 * Site matching: incoming location id against legacyLocId THEN site id;
 * unmatched incoming ids are treated as legacy ids so existing doc
 * references keep resolving. Contact matching: exact display name (the same
 * key the composition emits, and the only contact key legacy docs have).
 */
async function writeRecord(rec: CustomerDoc, prev: CustomerDoc | null): Promise<void> {
  const t = Date.now();
  const existingCo = await getCompany(rec.id);

  // Existing sites + contacts are read BEFORE the change check (they used to
  // be read after the company write) because #137's per-site zip/kind and
  // per-contact mobile backfill below needs them first.
  const existingSites = existingCo ? await sitesForCompany(rec.id) : [];
  const bySiteKey = new Map<string, SiteRow>();
  for (const s of existingSites) {
    if (s.legacyLocId) bySiteKey.set(s.legacyLocId, s);
    bySiteKey.set(s.id, s);
  }
  const existingContacts = existingCo ? await contactsForCompany(rec.id) : [];
  const byContactName = new Map(existingContacts.map((c) => [displayName(c), c]));
  const existingPhones = await phonesForContacts(existingContacts.map((c) => c.id));

  // #23 WRITE-WHEN-PROVIDED / PRESERVE-WHEN-UNDEFINED, resolved BEFORE the
  // change check: callers that predate the Details fields (lead convert,
  // the CSV importer, seed/setDirectory) pass none of them — backfilling
  // from the existing row here means those writers neither clear values nor
  // advance updatedAt spuriously (the no-change early-return still fires),
  // while a Details-only edit from the modal compares different and writes.
  if (rec.lifecycle === undefined) rec.lifecycle = existingCo?.lifecycle ?? "none";
  if (rec.keywords === undefined) rec.keywords = existingCo?.keywords ?? [];
  if (rec.custom === undefined) rec.custom = existingCo?.custom ?? {};
  // #137 — company zip/phone/website, per-site zip/kind and per-contact
  // mobile follow the same contract. Backfilled here so a writer that
  // doesn't carry them (the Companies modal, quote intake, inbox quick-add)
  // neither clears them nor registers a spurious change.
  if (rec.zip === undefined && existingCo?.zip) rec.zip = existingCo.zip;
  if (rec.phone === undefined && existingCo?.mainPhone) rec.phone = existingCo.mainPhone;
  if (rec.website === undefined && existingCo?.website) rec.website = existingCo.website;
  for (const loc of rec.locations) {
    const match = loc.id ? bySiteKey.get(loc.id) : undefined;
    if (!match) continue;
    if (loc.zip === undefined && match.zip) loc.zip = match.zip;
    if (loc.kind === undefined && match.kind) loc.kind = match.kind;
  }
  for (const ct of rec.contacts) {
    if (ct.mobile !== undefined) continue;
    const match = byContactName.get(ct.name);
    const mob = match
      ? (existingPhones.get(match.id) ?? []).find((p) => p.label === "mobile")
      : undefined;
    if (mob) ct.mobile = mob.phone;
  }

  // D83 semantics: updatedAt only advances when content actually changed.
  if (prev && existingCo && contentKey(rec) === contentKey(prev)) return;

  const ownerUserId = rec.owner
    ? await userIdForName(rec.owner)
    : (existingCo?.ownerUserId ?? null);

  await saveCompany({
    id: rec.id,
    name: rec.name,
    type: rec.type,
    lifecycle: rec.lifecycle ?? "none",
    keywords: rec.keywords ?? [],
    custom: rec.custom ?? {},
    website: rec.website ?? existingCo?.website ?? null,
    mainPhone: rec.phone ?? existingCo?.mainPhone ?? null,
    address: existingCo?.address ?? null,
    city: existingCo?.city ?? null,
    state: existingCo?.state ?? null,
    zip: rec.zip ?? existingCo?.zip ?? null,
    pricingTier: rec.pricingTier ?? existingCo?.pricingTier ?? null,
    ownerUserId,
    referredByContactId: existingCo?.referredByContactId ?? null,
    createdAt: existingCo?.createdAt ?? t,
    updatedAt: t,
  });

  // ----- sites (full-replace within this record) -----
  const keptSiteIds = new Set<string>();
  for (const loc of rec.locations) {
    const match = loc.id ? bySiteKey.get(loc.id) : undefined;
    const id = match?.id ?? mintId("st");
    keptSiteIds.add(id);
    await saveSite({
      id,
      companyId: rec.id,
      name: loc.label || "",
      locationName: loc.locationName || null,
      // Unmatched incoming ids are legacy ids by definition — preserve them
      // so quotes/projects that stored them keep resolving.
      legacyLocId: match ? match.legacyLocId : (loc.id ?? null),
      isPrimary: !!loc.primary,
      address: loc.address ?? null,
      city: loc.city ?? null,
      state: loc.state ?? null,
      zip: loc.zip ?? null,
      kind: loc.kind ?? null,
      lat: loc.lat == null ? null : String(loc.lat),
      lng: loc.lng == null ? null : String(loc.lng),
      venueKind: loc.venueKind || "proscenium",
      travelMiles: loc.travelMiles == null ? null : String(loc.travelMiles),
      travelMin: loc.travelMin == null ? null : String(loc.travelMin),
      driveFolderId: match?.driveFolderId ?? null,
      createdAt: match?.createdAt ?? t,
      updatedAt: t,
    });
  }
  for (const s of existingSites) {
    if (!keptSiteIds.has(s.id)) await softDeleteSite(s.id);
  }

  // Base venue for a brand-new customer created without a location (Jeff 2026-07-21):
  // partners get none; kind is inferred from the name. Deterministic id → re-run safe.
  if (!existingCo && keptSiteIds.size === 0) {
    const kind = baseVenueKind(rec.type, rec.name);
    if (kind) await saveSite({ id: `st-${rec.id}-1`, companyId: rec.id, name: "", isPrimary: true, venueKind: kind });
  }

  // ----- contacts (full-replace within this record, matched by name) -----
  const keptContactIds = new Set<string>();
  for (const ct of rec.contacts) {
    const match = byContactName.get(ct.name);
    const id = match?.id ?? mintId("ct");
    keptContactIds.add(id);
    const { first, last } = match
      ? { first: match.firstName, last: match.lastName }
      : splitName(ct.name);
    await saveContact({
      id,
      firstName: first,
      lastName: last,
      homeCompanyId: rec.id,
      title: ct.role || "",
      pricingTier: match?.pricingTier ?? null,
      status: match?.status ?? "active",
      userId: match?.userId ?? null,
      ownerUserId: match?.ownerUserId ?? ownerUserId,
      isPrimary: !!ct.primary,
      createdAt: match?.createdAt ?? t,
      updatedAt: t,
    });
    // Email/phone carry the ONE value the legacy shape holds: upsert it as
    // the primary channel without disturbing extra channels added via the
    // People screens; blank means "not provided", never "clear".
    if ((ct.email || "").trim()) {
      const current = await emailsFor(id);
      if (!current.length) {
        await setEmails(id, [{ value: ct.email, label: "work", isPrimary: true }]);
      } else if (current[0].email !== ct.email.trim()) {
        const db = await getDb();
        await db
          .update(contactEmails)
          .set({ email: ct.email.trim() })
          .where(eq(contactEmails.id, current[0].id));
      }
    }
    const phone = (ct.phone || "").trim();
    if (phone) {
      const current = await phonesFor(id);
      // #137 — target the non-mobile row so a work number never overwrites
      // the mobile channel (and the mobile block below never overwrites this).
      const work = current.find((p) => p.label !== "mobile");
      if (!work) {
        if (!current.some((p) => p.phone === phone)) {
          await setPhones(id, [
            ...current.map((p) => ({ value: p.phone, label: p.label, isPrimary: p.isPrimary })),
            { value: phone, label: "work", isPrimary: current.length === 0 },
          ]);
        }
      } else if (work.phone !== phone) {
        const db = await getDb();
        await db
          .update(contactPhones)
          .set({ phone })
          .where(eq(contactPhones.id, work.id));
      }
    }
    // #137 — a mobile number is a second, "mobile"-labelled channel: added
    // when the contact has none, updated in place when it changed, never
    // removed here (blank means "not provided").
    const mobile = (ct.mobile || "").trim();
    if (mobile) {
      const current = await phonesFor(id);
      const mob = current.find((p) => p.label === "mobile");
      if (!mob) {
        if (!current.some((p) => p.phone === mobile)) {
          await setPhones(id, [
            ...current.map((p) => ({ value: p.phone, label: p.label, isPrimary: p.isPrimary })),
            { value: mobile, label: "mobile", isPrimary: current.length === 0 },
          ]);
        }
      } else if (mob.phone !== mobile) {
        const db = await getDb();
        await db
          .update(contactPhones)
          .set({ phone: mobile })
          .where(eq(contactPhones.id, mob.id));
      }
    }
  }
  for (const c of existingContacts) {
    if (!keptContactIds.has(c.id)) await softDeleteContact(c.id);
  }
}
```

- [ ] **Step 10: Run tests, expect pass** — `npx tsc --noEmit -p . | tail -3` → empty; `npm run test:review:regressions 2>&1 | tail -3` → `review regression checks passed` (all `#137 T1` asserts pass). `npx eslint src/lib/stores/customers.ts src/db/schema.ts scripts/test-review-regressions.ts`.

- [ ] **Step 11: Commit**

```bash
git add src/db/schema.ts drizzle/0023_sites_kind.sql drizzle/meta/_journal.json drizzle/meta/0023_snapshot.json src/lib/stores/customers.ts scripts/test-review-regressions.ts
git commit -m "feat(customers): zip/kind/mobile/phone/website through the store seam + sites.kind migration + importer finders (#137 §1)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Callers carry the new fields through — shared `toLocationInput` / `toContactInput` (the #96 follow-up), Companies modal save, customer record shows zips

**Files:**
- Modify: `src/app/(app)/companies/types.ts:6-27`
- Modify: `src/app/(app)/companies/lib.ts:1-5` (imports) + append two functions
- Modify: `src/app/(app)/companies/actions.ts:68-90`
- Modify: `src/app/(app)/companies/[id]/page.tsx:38-50` (imports), `:143-162` (locations view-model), `:192-212` (`editInitial`), `:330-345` (venue row)
- Modify: `src/app/(app)/quotes/new/actions.ts:5-11` (imports), delete `:23-47`
- Modify: `src/app/(app)/inbox/link-actions.ts:15-24` (imports), delete `:32-59`
- Test: `scripts/test-review-and-spec.ts` (section "#137 T2")

**Interfaces:**
- Consumes: `CustomerLocation`, `CustomerContact` (Task 1 shapes, `src/lib/stores/customers.ts`); `LocationInput`, `ContactInput` (`companies/types.ts`).
- Produces (`src/app/(app)/companies/lib.ts`, pure, client-safe): `toLocationInput(l: CustomerLocation): LocationInput`, `toContactInput(c: CustomerContact): ContactInput`. `LocationInput.zip?: string; kind?: string`, `ContactInput.mobile?: string`.

- [ ] **Step 1: Write the failing spec test** — in `scripts/test-review-and-spec.ts` add to the imports (after line 81):

```ts
import { toContactInput, toLocationInput } from "@/app/(app)/companies/lib";
```

and append at the very end of the file (after the `archiveAsyncChecks` function, i.e. after line 4969 — synchronous checks there run before the promise chain reports):

```ts
/* ======================================================================
   #137 T2 — shared CustomerLocation / CustomerContact → input converters
   (companies/lib.ts). Every field carries through so a save that starts
   from a stored record never drops what the record holds.
   ====================================================================== */
{
  const li = toLocationInput({
    id: "lf1", locationName: "Campus", label: "Main Hall", primary: true, address: "1 Main", city: "Milwaukee", state: "WI",
    zip: "53202", kind: "theatre", lat: "43.04", lng: null, venueKind: "proscenium", travelMiles: null, travelMin: 12,
  });
  ok(li.locationName === "Campus", "#137 T2 toLocationInput keeps locationName (the #96 review follow-up)");
  ok(li.zip === "53202" && li.kind === "theatre", "#137 T2 toLocationInput carries zip + kind");
  ok(li.lat === 43.04 && li.lng === null && li.travelMin === 12, "#137 T2 toLocationInput numbers lat, nulls blank lng, keeps travel");
  const li2 = toLocationInput({ primary: false, venueKind: "church", travelMiles: null, travelMin: null });
  ok(li2.zip === undefined && li2.kind === undefined && li2.label === "" && li2.locationName === "" && li2.venueKind === "church", "#137 T2 toLocationInput: absent zip/kind stay undefined (= preserve), text fields blank");
  const ci = toContactInput({ name: "Maria Lopez", role: "TD", email: "m@x.org", phone: "1", mobile: "2", primary: true });
  ok(ci.mobile === "2" && ci.phone === "1" && ci.role === "TD" && ci.primary, "#137 T2 toContactInput carries mobile");
  ok(toContactInput({ name: "S", role: "", email: "", primary: false }).mobile === undefined, "#137 T2 toContactInput: absent mobile stays undefined");
}
```

- [ ] **Step 2: Run it, expect failure** — `npx tsx scripts/test-review-and-spec.ts 2>&1 | head -3` → import error for `toLocationInput`.

- [ ] **Step 3: types.ts** — replace lines 6-27 of `src/app/(app)/companies/types.ts` with:

```ts
export type LocationInput = {
  id?: string;
  locationName?: string;
  label: string;
  primary: boolean;
  address: string;
  city: string;
  state: string;
  /** #137 — carried through so a modal / quick-add save never drops an
   *  imported zip or venue category (absent = preserve, see writeRecord). */
  zip?: string;
  kind?: string;
  lat: number | null;
  lng: number | null;
  venueKind: string;
  travelMiles: number | null;
  travelMin: number | null;
};

export type ContactInput = {
  name: string;
  role: string;
  email: string;
  phone: string;
  /** #137 — mobile channel; absent = preserve. */
  mobile?: string;
  primary: boolean;
};
```

- [ ] **Step 4: lib.ts converters** — change line 5 of `src/app/(app)/companies/lib.ts` to `import type { AddressHitVM, ContactInput, LocationInput } from "./types";` and append at the end of the file:

```ts
/** CustomerLocation → LocationInput with EVERY field carried — locationName
 *  (the #96 review follow-up: the quote-intake copy dropped it and cleared
 *  the campus name on save) and #137's zip/kind included. Absent zip/kind
 *  stay undefined, which writeRecord reads as "preserve". */
export function toLocationInput(l: CustomerLocation): LocationInput {
  return {
    id: l.id,
    locationName: l.locationName || "",
    label: l.label || "",
    primary: !!l.primary,
    address: l.address || "",
    city: l.city || "",
    state: l.state || "",
    zip: l.zip,
    kind: l.kind,
    lat: l.lat == null || l.lat === "" ? null : Number(l.lat),
    lng: l.lng == null || l.lng === "" ? null : Number(l.lng),
    venueKind: l.venueKind || "proscenium",
    travelMiles: l.travelMiles,
    travelMin: l.travelMin,
  };
}

export function toContactInput(c: CustomerContact): ContactInput {
  return {
    name: c.name,
    role: c.role || "",
    email: c.email || "",
    phone: c.phone || "",
    mobile: c.mobile,
    primary: !!c.primary,
  };
}
```

- [ ] **Step 5: saveCustomerAction** — in `src/app/(app)/companies/actions.ts` replace lines 68-90 (the `locations:` and `contacts:` mappings inside `upsert({...})`) with:

```ts
    locations: (input.locations || []).map((l) => ({
      id: l.id,
      locationName: (l.locationName || "").trim(),
      label: (l.label || "").trim() || "Venue",
      primary: !!l.primary,
      address: (l.address || "").trim(),
      city: (l.city || "").trim(),
      state: (l.state || "").trim(),
      // #137 — undefined stays undefined (= preserve); normalizeRecord trims.
      zip: l.zip,
      kind: l.kind,
      lat: l.lat,
      lng: l.lng,
      venueKind: l.venueKind || "proscenium",
      travelMiles: l.travelMiles,
      travelMin: l.travelMin,
    })),
    contacts: (input.contacts || [])
      .filter((c) => (c.name || "").trim())
      .map((c) => ({
        name: (c.name || "").trim(),
        role: (c.role || "").trim(),
        email: (c.email || "").trim(),
        phone: (c.phone || "").trim(),
        mobile: c.mobile,
        primary: !!c.primary,
      })),
```

- [ ] **Step 6: customer record page** — in `src/app/(app)/companies/[id]/page.tsx`: add `toContactInput,` and `toLocationInput,` to the `../lib` import list (lines 38-50, alphabetical order is not enforced — put them after `quoteStatusMeta,`). Replace the locations view-model entry (lines 148-160) with:

```ts
      return {
        key: l.id || l.label || Math.random().toString(36).slice(2),
        label: l.label || "Venue",
        primary: !!l.primary,
        kindLabel: venueKindLabel(l.venueKind),
        // #137 — imported venue category, shown beside the kind when present.
        category: l.kind || "",
        address:
          [l.address, [cityState(l), l.zip].filter(Boolean).join(" ")].filter(Boolean).join(" · ") || "—",
        officeName: est.office ? est.office.name : "nearest office",
        miles: fmtMiles(est.miles),
        time: fmtTime(est.minutes),
        sourceLabel: sm.label,
        sourceInk: sm.ink,
        sourceSoft: sm.soft,
      };
```

Replace the `locations:` / `contacts:` of `editInitial` (lines 192-212) with:

```ts
    locations: (cust.locations || []).map(toLocationInput),
    contacts: (cust.contacts || []).map(toContactInput),
```

In the venue row (lines 333-343), add after the `{l.kindLabel}` pill `</span>` (line 337):

```tsx
                  {l.category && (
                    <span style={{ fontSize: 10, fontWeight: 600, color: "#5b616e", background: "#f1f2f5", border: "1px solid #e4e7ec", padding: "2px 8px", borderRadius: 20 }}>
                      {l.category}
                    </span>
                  )}
```

- [ ] **Step 7: quote intake + inbox** — in `src/app/(app)/quotes/new/actions.ts` replace lines 5-11 with:

```ts
import { get as getCustomer } from "@/lib/stores/customers";
import { saveCustomerAction } from "@/app/(app)/companies/actions";
import { toContactInput, toLocationInput } from "@/app/(app)/companies/lib";
import type { ContactInput, LocationInput } from "@/app/(app)/companies/types";
```

and delete lines 23-47 (the two local converter functions; the usages at 76-77 keep working). In `src/app/(app)/inbox/link-actions.ts` replace lines 15-24 with:

```ts
import { get as getCustomer, contactsForId } from "@/lib/stores/customers";
import { saveCustomerAction } from "@/app/(app)/companies/actions";
import { toContactInput, toLocationInput } from "@/app/(app)/companies/lib";
import type { ContactInput, LocationInput } from "@/app/(app)/companies/types";
```

and delete lines 32-59 (the local `toLocationInput` / `toContactInput` and their comment). Usages at 218 and 233 stay.

- [ ] **Step 8: Run tests, expect pass** — `npx tsx scripts/test-review-and-spec.ts | grep -E '#137 T2|ALL PASSED'` → 6 PASS + `ALL PASSED`; `npx tsc --noEmit -p . | tail -3` → empty; `npx eslint "src/app/(app)/companies" "src/app/(app)/quotes/new/actions.ts" "src/app/(app)/inbox/link-actions.ts"`.

- [ ] **Step 9: Commit**

```bash
git add "src/app/(app)/companies/types.ts" "src/app/(app)/companies/lib.ts" "src/app/(app)/companies/actions.ts" "src/app/(app)/companies/[id]/page.tsx" "src/app/(app)/quotes/new/actions.ts" "src/app/(app)/inbox/link-actions.ts" scripts/test-review-and-spec.ts
git commit -m "fix(companies): one shared toLocationInput keeps locationName; zip/kind/mobile carried through saves; record shows venue zips (#137 §1, #96 follow-up)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Pure import layer — `link.ts` helpers, zip/requiredUnless/hidden in `parse.ts`, the three templates in `types.ts`

**Files:**
- Create: `src/app/(app)/import/link.ts`
- Modify: `src/app/(app)/import/parse.ts:14-25` (kinds + `FieldDef`), `:166-172` (`coerce` + new `normalizeZip`), `:247-251` (required check in `prepareRows`)
- Modify: `src/app/(app)/import/types.ts:29-50` (customers entry; insert contacts + venues after it)
- Test: `scripts/test-review-and-spec.ts` (section "#137 T3")

**Interfaces:**
- Consumes: `norm()` (`import/parse.ts:127`); types `CustomerContact`, `CustomerLocation` (Task 1).
- Produces (`import/parse.ts`): `FieldKind` gains `"zip"`; `FieldDef.requiredUnless?: string`, `FieldDef.hidden?: boolean`; `normalizeZip(v: unknown): string`.
- Produces (`import/link.ts`):
  - `type CustomerRef = { id: string; name: string }`
  - `type CustomerResolution = { how: "id" | "name"; id: string; name: string } | { how: "create"; id: null; name: string } | { how: "missing"; id: null; name: "" }`
  - `resolveCustomerForRow(row: { customerId?: unknown; customer?: unknown }, cache: readonly CustomerRef[]): CustomerResolution`
  - `parseYesNo(v: unknown): boolean`
  - `matchContact(contacts: readonly CustomerContact[], email: unknown, name: unknown): CustomerContact | null`
  - `matchLocation(locations: readonly CustomerLocation[], label: unknown): CustomerLocation | null`
  - `type ContactPatch = { name: string; email?: string; phone?: string; mobile?: string; title?: string; primary?: boolean }`; `mergeContact(contacts, incoming: ContactPatch): { contacts: CustomerContact[]; created: boolean }`
  - `type LocationPatch = { label: string; address?: string; city?: string; state?: string; zip?: string; kind?: string }`; `type MergeLocationOpts = { preferPrimary: boolean; venueKind?: string }`; `mergeLocation(locations, incoming: LocationPatch, newId: string, opts: MergeLocationOpts): { locations: CustomerLocation[]; created: boolean }`
  - `venueKindFromCategory(category: unknown): string`
  - `type RowLink = { how: "id" | "name" | "create" | "missing" | "skip"; name: string }`; `previewLinks(rows: ReadonlyArray<{ values: Record<string, string | number>; valid: boolean }>, index: readonly CustomerRef[]): { links: RowLink[]; willCreate: string[] }`
- Produces (`import/types.ts`): `IMPORT_TYPES` entries `customers` (rewritten), `contacts`, `venues` — field keys listed in Step 5.

- [ ] **Step 1: Write the failing spec tests** — in `scripts/test-review-and-spec.ts` change line 74 to `import { getTypeMeta, type ImportTypeMeta } from "@/app/(app)/import/types";`, change the parse import (75-79) to:

```ts
import {
  autoMap,
  normalizeZip,
  parseCsv as parseImportCsv,
  prepareRows,
} from "@/app/(app)/import/parse";
```

add after it:

```ts
import {
  matchContact,
  matchLocation,
  mergeContact,
  mergeLocation,
  parseYesNo,
  previewLinks,
  resolveCustomerForRow,
  venueKindFromCategory,
} from "@/app/(app)/import/link";
import type { CustomerContact, CustomerLocation } from "@/lib/stores/customers";
```

and append at the end of the file:

```ts
/* ======================================================================
   #137 T3 — three import types: template columns, alias resolution, hidden
   legacy columns, Customer* OR Customer ID, zip cells, and the pure
   link-back helpers (import/link.ts).
   ====================================================================== */
{
  const cu = getTypeMeta("customers");
  const ct = getTypeMeta("contacts");
  const vn = getTypeMeta("venues");
  ok(!!cu && !!ct && !!vn, "#137 T3 customers / contacts / venues types are registered");
  if (cu && ct && vn) {
    const visible = (t: ImportTypeMeta) => t.fields.filter((f) => !f.hidden).map((f) => f.header).join(",");
    ok(visible(cu) === "Customer Name,Category,Address,City,State,Zip,Phone,Website,Notes", "#137 T3 customers template columns (embedded contact/venue columns gone)");
    ok(visible(ct) === "Customer,Customer ID,Name,Email,Phone,Mobile,Title,Role,Primary,Notes", "#137 T3 contacts template columns");
    ok(visible(vn) === "Customer,Customer ID,Venue Name,Address,City,State,Zip,Category,Notes", "#137 T3 venues template columns");

    const legacy = parseImportCsv("Customer Name,Type,Contact Name,Email,Phone,Venue,Address,City,State,Notes\nRiverside Playhouse,Performing arts,Maria Lopez,maria@riverside.org,(608) 555-0110,Main Stage,215 W Main St,Madison,WI,");
    const lm = autoMap(legacy.headers, cu.fields);
    ok(lm.name === 0 && lm.type === 1 && lm.contactName === 2 && lm.email === 3 && lm.phone === 4 && lm.venue === 5 && lm.address === 6 && lm.notes === 9, "#137 T3 a pre-#137 customers file maps every column, embedded ones via hidden aliases");
    const nm = autoMap(["Customer Name", "Category", "Address", "City", "State", "Zip", "Phone", "Website"], cu.fields);
    ok(nm.type === 1 && nm.zip === 5 && nm.phone === 6 && nm.website === 7, "#137 T3 Category / Zip / Phone / Website map on the new customers template");
    const cm = autoMap(["Company", "Customer ID", "Full Name", "E-mail", "Cell", "Job Title", "Primary Contact"], ct.fields);
    ok(cm.customer === 0 && cm.customerId === 1 && cm.name === 2 && cm.email === 3 && cm.mobile === 4 && cm.title === 5 && cm.primary === 6, "#137 T3 contacts aliases: Company / Customer ID / Full Name / E-mail / Cell / Job Title / Primary Contact");
    const vm = autoMap(["Customer", "Venue", "Street", "City", "State", "Zip Code", "Type"], vn.fields);
    ok(vm.customer === 0 && vm.venue === 1 && vm.address === 2 && vm.zip === 5 && vm.kind === 6, "#137 T3 venues aliases: Venue / Street / Zip Code / Type");

    const onlyId = prepareRows([["c-1", "Pat Doe"]], autoMap(["Customer ID", "Name"], ct.fields), ct.fields);
    ok(onlyId.rows[0].valid, "#137 T3 a contacts row with only a Customer ID is valid (requiredUnless)");
    const neither = prepareRows([["", "", "Pat Doe"]], autoMap(["Customer", "Customer ID", "Name"], ct.fields), ct.fields);
    ok(!neither.rows[0].valid && neither.rows[0].errors.includes("Missing Customer"), "#137 T3 a row with neither Customer nor Customer ID fails validation");
    const z = prepareRows([["A", "V", " 53703 "], ["B", "W", "53703-1234"], ["C", "X", "2134"]], autoMap(["Customer", "Venue Name", "Zip"], vn.fields), vn.fields);
    ok(z.rows[0].values.zip === "53703" && z.rows[1].values.zip === "53703-1234" && z.rows[2].values.zip === "02134", "#137 T3 zip cells: trimmed, ZIP+4 kept as typed, Excel-stripped leading zero restored");
  }
}
ok(normalizeZip(" 53703 ") === "53703" && normalizeZip("53703-1234") === "53703-1234" && normalizeZip(2134) === "02134" && normalizeZip("") === "" && normalizeZip(null) === "", "#137 T3 normalizeZip");
ok(parseYesNo("Yes") && parseYesNo(" y ") && parseYesNo("TRUE") && parseYesNo("1") && parseYesNo("x") && !parseYesNo("no") && !parseYesNo("") && !parseYesNo("0") && !parseYesNo(undefined), "#137 T3 parseYesNo");
{
  const cache = [{ id: "lakefront", name: "Lakefront Performing Arts Center" }, { id: "c-2", name: "Cedar Grove Schools" }];
  const r1 = resolveCustomerForRow({ customerId: "c-2", customer: "Something Else" }, cache);
  ok(r1.how === "id" && r1.id === "c-2", "#137 T3 resolve: Customer ID wins over the name");
  const r2 = resolveCustomerForRow({ customer: "cedar-grove SCHOOLS" }, cache);
  ok(r2.how === "name" && r2.id === "c-2" && r2.name === "Cedar Grove Schools", "#137 T3 resolve: normalized-name match returns the stored name");
  const r3 = resolveCustomerForRow({ customerId: "nope", customer: "Brand New Org" }, cache);
  ok(r3.how === "create" && r3.id === null && r3.name === "Brand New Org", "#137 T3 resolve: unknown id + unknown name → create");
  const r4 = resolveCustomerForRow({ customerId: "", customer: "  " }, cache);
  ok(r4.how === "missing" && r4.id === null, "#137 T3 resolve: neither → missing");
  const rows = [
    { values: { customer: "Brand New Org", name: "A" }, valid: true },
    { values: { customer: "brand new org!", name: "B" }, valid: true },
    { values: { customer: "Cedar Grove Schools", name: "C" }, valid: true },
    { values: { customer: "", name: "" }, valid: false },
  ];
  const pv = previewLinks(rows, cache);
  ok(pv.links.map((l) => l.how).join(",") === "create,create,name,skip", "#137 T3 previewLinks: the second row reuses the first row's pending create; invalid rows are skipped");
  ok(pv.willCreate.length === 1 && pv.willCreate[0] === "Brand New Org", "#137 T3 previewLinks: one customer to create, counted once");
}
{
  const contacts: CustomerContact[] = [
    { name: "Maria Lopez", role: "TD", email: "maria@r.org", phone: "1", primary: true },
    { name: "Sam Ortiz", role: "", email: "", primary: false },
  ];
  ok(matchContact(contacts, "MARIA@R.ORG", "Somebody")?.name === "Maria Lopez", "#137 T3 matchContact: email first, case-insensitive");
  ok(matchContact(contacts, "", "sam ORTIZ")?.name === "Sam Ortiz", "#137 T3 matchContact: normalized name when no email");
  ok(matchContact(contacts, "new@r.org", "New Person") === null && matchContact(contacts, "", "") === null, "#137 T3 matchContact: no hit / nothing to match");
  const m1 = mergeContact(contacts, { name: "maria lopez", email: "maria@r.org", mobile: "9", primary: false });
  ok(!m1.created && m1.contacts[0].name === "Maria Lopez" && m1.contacts[0].mobile === "9" && m1.contacts[0].role === "TD" && m1.contacts[0].phone === "1" && m1.contacts[0].primary, "#137 T3 mergeContact: a hit keeps the stored name/title/phone/primary and gains the mobile");
  const m2 = mergeContact(contacts, { name: "Sam Ortiz", email: "sam@r.org", primary: true });
  ok(!m2.created && m2.contacts[1].email === "sam@r.org" && m2.contacts[1].primary && !m2.contacts[0].primary, "#137 T3 mergeContact: primary:true promotes the hit and demotes the previous primary");
  const m3 = mergeContact([], { name: "First Person", primary: false });
  ok(m3.created && m3.contacts[0].primary, "#137 T3 mergeContact: the first contact on a record is primary even when the file says no");
  const m4 = mergeContact(contacts, { name: "Third Person", title: "Billing", primary: false });
  ok(m4.created && m4.contacts.length === 3 && m4.contacts[2].role === "Billing" && !m4.contacts[2].primary && m4.contacts[0].primary, "#137 T3 mergeContact: a new non-primary contact appends without touching the primary");
  ok(contacts[0].mobile === undefined && contacts.length === 2 && contacts[1].email === "", "#137 T3 mergeContact never mutates its input");

  const locs: CustomerLocation[] = [
    { id: "l1", label: "", primary: true, venueKind: "proscenium", travelMiles: null, travelMin: null },
  ];
  const v1 = mergeLocation(locs, { label: "Main Stage", address: "215 W Main St", city: "Madison", state: "WI", zip: "53703", kind: "theatre" }, "l-new", { preferPrimary: false });
  ok(!v1.created && v1.locations.length === 1 && v1.locations[0].id === "l1" && v1.locations[0].label === "Main Stage" && v1.locations[0].zip === "53703" && v1.locations[0].kind === "theatre" && v1.locations[0].primary, "#137 T3 mergeLocation claims the unnamed D85 base venue instead of adding a second venue");
  ok(matchLocation(v1.locations, "main-stage")?.id === "l1" && matchLocation(v1.locations, "") === null, "#137 T3 matchLocation: normalized label; blank never matches");
  const v2 = mergeLocation(v1.locations, { label: "MAIN stage", zip: "53704" }, "l-new2", { preferPrimary: false });
  ok(!v2.created && v2.locations[0].zip === "53704" && v2.locations[0].address === "215 W Main St" && v2.locations[0].label === "MAIN stage", "#137 T3 mergeLocation: a normalized-label hit updates zip, keeps fields the row omits, takes the row's label spelling");
  const v3 = mergeLocation(v1.locations, { label: "Black Box", kind: "black box" }, "l-new3", { preferPrimary: false });
  ok(v3.created && v3.locations.length === 2 && v3.locations[1].id === "l-new3" && !v3.locations[1].primary && v3.locations[1].venueKind === "blackbox" && v3.locations[1].kind === "black box", "#137 T3 mergeLocation appends a non-primary venue whose venueKind derives from Category");
  const v4 = mergeLocation(v1.locations, { label: "", address: "1 HQ Way", zip: "53705" }, "l-new4", { preferPrimary: true });
  ok(!v4.created && v4.locations[0].label === "Main Stage" && v4.locations[0].address === "1 HQ Way" && v4.locations[0].zip === "53705", "#137 T3 mergeLocation preferPrimary: a customers row without a Venue column updates the primary venue's address without renaming it");
  const v5 = mergeLocation([], { label: "", address: "1 HQ Way" }, "l-new5", { preferPrimary: true, venueKind: "church" });
  ok(v5.created && v5.locations[0].primary && v5.locations[0].label === "" && v5.locations[0].venueKind === "church" && v5.locations[0].id === "l-new5", "#137 T3 mergeLocation: the first venue on a new customer is primary and takes the caller's venueKind");
  ok(locs[0].label === "" && locs.length === 1, "#137 T3 mergeLocation never mutates its input");
  ok(venueKindFromCategory("Church") === "church" && venueKindFromCategory("Black Box") === "blackbox" && venueKindFromCategory("Arena") === "arena" && venueKindFromCategory("Gym") === "flat" && venueKindFromCategory("theatre") === "proscenium" && venueKindFromCategory("") === "proscenium" && venueKindFromCategory("flat") === "flat", "#137 T3 venueKindFromCategory");
}
```

- [ ] **Step 2: Run it, expect failure** — `npx tsx scripts/test-review-and-spec.ts 2>&1 | head -3` → import error (`normalizeZip` / `./link`).

- [ ] **Step 3: parse.ts** — replace lines 14-25 with:

```ts
export type FieldKind = "text" | "number" | "date" | "email" | "enum" | "zip";

export type FieldDef = {
  key: string;
  header: string;
  label: string;
  required?: boolean;
  /** #137 — a required field that another field may satisfy instead
   *  (contacts / venues: `Customer` OR `Customer ID`). */
  requiredUnless?: string;
  /** #137 — accepted on import (auto-mapped by alias) but not a template or
   *  export column: legacy embedded columns kept for one release, and the
   *  optional Customer ID match on the customers type. */
  hidden?: boolean;
  kind?: FieldKind;
  aliases: string[];
  example?: string;
  options?: string[];
};
```

Replace `coerce` (lines 166-172) with:

```ts
/** #137 — zip cells: trimmed, 5-digit and ZIP+4 kept as typed; a 4-digit
 *  value gets its Excel-stripped leading zero back ("2134" → "02134"). */
export function normalizeZip(v: unknown): string {
  const s = v == null ? "" : String(v).trim();
  return /^\d{4}$/.test(s) ? "0" + s : s;
}

export function coerce(field: FieldDef, v: unknown): string | number {
  const s = v == null ? "" : String(v).trim();
  if (field.kind === "number") return toNum(s);
  if (field.kind === "date") return toISO(s);
  if (field.kind === "email") return s.toLowerCase();
  if (field.kind === "zip") return normalizeZip(s);
  return s;
}
```

Replace the required check inside `prepareRows` (lines 247-251) with:

```ts
    const errors: string[] = [];
    const has = (k: string) => String(values[k] == null ? "" : values[k]).trim() !== "";
    fields.forEach((f) => {
      if (!f.required || has(f.key)) return;
      // #137 — `Customer` is satisfied by a `Customer ID` (and vice versa).
      if (f.requiredUnless && has(f.requiredUnless)) return;
      errors.push("Missing " + f.label);
    });
```

- [ ] **Step 4: link.ts** — create `src/app/(app)/import/link.ts`:

```ts
/**
 * #137 — pure link-back helpers shared by the contacts / venues importers,
 * the customers writer's legacy embedded columns, and the client preview.
 * No runtime store imports (the CustomerContact / CustomerLocation imports
 * are type-only and erased at compile time), so controls.tsx can run the
 * same resolution the server commit runs: the preview's "linked / will
 * create" column and the result banner agree by construction.
 */
import type { CustomerContact, CustomerLocation } from "@/lib/stores/customers";
import { norm } from "./parse";

export type CustomerRef = { id: string; name: string };

export type CustomerResolution =
  | { how: "id"; id: string; name: string }
  | { how: "name"; id: string; name: string }
  | { how: "create"; id: null; name: string }
  | { how: "missing"; id: null; name: "" };

function txt(v: unknown): string {
  return v == null ? "" : String(v).trim();
}

/**
 * Which customer a contacts / venues row belongs to: `Customer ID` exact
 * match → normalized-name match (case/punctuation-insensitive, the same
 * `norm` the dedupe uses) → create a customer from the name → missing when
 * the row carries neither. `cache` is whatever list the caller keeps for one
 * file — the server pushes newly created customers into it so later rows
 * link to the same record (D159).
 */
export function resolveCustomerForRow(
  row: { customerId?: unknown; customer?: unknown },
  cache: readonly CustomerRef[]
): CustomerResolution {
  const id = txt(row.customerId);
  if (id) {
    const hit = cache.find((c) => c.id === id);
    if (hit) return { how: "id", id: hit.id, name: hit.name };
  }
  const name = txt(row.customer);
  const key = norm(name);
  if (key) {
    const hit = cache.find((c) => norm(c.name) === key);
    if (hit) return { how: "name", id: hit.id, name: hit.name };
    return { how: "create", id: null, name };
  }
  return { how: "missing", id: null, name: "" };
}

/** The contacts template's `Primary` column. Anything else is "no". */
export function parseYesNo(v: unknown): boolean {
  const t = txt(v).toLowerCase();
  return t === "yes" || t === "y" || t === "true" || t === "1" || t === "x" || t === "primary";
}

/** Same rule the contacts dedupe uses: primary email first, then name. */
export function matchContact(
  contacts: readonly CustomerContact[],
  email: unknown,
  name: unknown
): CustomerContact | null {
  const e = txt(email).toLowerCase();
  if (e) {
    const hit = contacts.find((c) => (c.email || "").trim().toLowerCase() === e);
    if (hit) return hit;
  }
  const key = norm(name);
  if (!key) return null;
  return contacts.find((c) => norm(c.name) === key) ?? null;
}

/** Venue dedupe: normalized label. A blank label never matches anything. */
export function matchLocation(
  locations: readonly CustomerLocation[],
  label: unknown
): CustomerLocation | null {
  const key = norm(label);
  if (!key) return null;
  return locations.find((l) => norm(l.label) === key) ?? null;
}

export type ContactPatch = {
  name: string;
  email?: string;
  phone?: string;
  mobile?: string;
  title?: string;
  /** true → becomes the record's primary (others demoted); false/undefined
   *  → flags are left alone, except that the first contact on a record is
   *  always primary. */
  primary?: boolean;
};

/**
 * Upsert one contact into a record's contacts (returns a new array; the
 * input is never mutated). A hit keeps its STORED name: writeRecord matches
 * contacts by display name, so renaming here would mint a second row.
 * Blank incoming fields never clear stored ones.
 */
export function mergeContact(
  contacts: readonly CustomerContact[],
  incoming: ContactPatch
): { contacts: CustomerContact[]; created: boolean } {
  const list = contacts.map((c) => ({ ...c }));
  const hit = matchContact(list, incoming.email, incoming.name);
  const or = (next: string | undefined, prev: string | undefined) => txt(next) || prev || "";
  const makePrimary = incoming.primary === true || (!hit && list.length === 0);
  if (makePrimary) for (const c of list) c.primary = false;
  if (hit) {
    hit.role = or(incoming.title, hit.role);
    hit.email = or(incoming.email, hit.email);
    hit.phone = or(incoming.phone, hit.phone) || undefined;
    hit.mobile = or(incoming.mobile, hit.mobile) || undefined;
    if (makePrimary) hit.primary = true;
    return { contacts: list, created: false };
  }
  list.push({
    name: txt(incoming.name),
    role: txt(incoming.title),
    email: txt(incoming.email),
    phone: txt(incoming.phone) || undefined,
    mobile: txt(incoming.mobile) || undefined,
    primary: makePrimary,
  });
  return { contacts: list, created: true };
}

export type LocationPatch = {
  label: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  kind?: string;
};

export type MergeLocationOpts = {
  /** customers file: a row with no Venue column addresses the primary venue
   *  (or the first one) instead of appending. */
  preferPrimary: boolean;
  /** venueKind for a venue this merge CREATES; default derives from `kind`. */
  venueKind?: string;
};

/**
 * Upsert one venue into a record's locations (new array, input untouched):
 * normalized-label match → a labelled row claims the unnamed D85 base venue
 * (so the first imported venue fills it instead of leaving an empty twin) →
 * a `preferPrimary` row without a label merges into the primary venue →
 * append. Blank incoming fields never clear stored ones; an existing venue
 * keeps its venueKind, lat/lng and travel figures.
 */
export function mergeLocation(
  locations: readonly CustomerLocation[],
  incoming: LocationPatch,
  newId: string,
  opts: MergeLocationOpts
): { locations: CustomerLocation[]; created: boolean } {
  const list = locations.map((l) => ({ ...l }));
  const label = txt(incoming.label);
  let hit: CustomerLocation | null = matchLocation(list, label);
  if (!hit && label) hit = list.find((l) => !norm(l.label)) ?? null;
  if (!hit && !label && opts.preferPrimary) hit = list.find((l) => l.primary) ?? list[0] ?? null;
  const or = (next: string | undefined, prev: string | undefined) => txt(next) || prev;
  if (hit) {
    if (label) hit.label = label;
    hit.address = or(incoming.address, hit.address);
    hit.city = or(incoming.city, hit.city);
    hit.state = or(incoming.state, hit.state);
    hit.zip = or(incoming.zip, hit.zip);
    hit.kind = or(incoming.kind, hit.kind);
    return { locations: list, created: false };
  }
  list.push({
    id: newId,
    label,
    primary: list.length === 0,
    address: txt(incoming.address) || undefined,
    city: txt(incoming.city) || undefined,
    state: txt(incoming.state) || undefined,
    zip: txt(incoming.zip) || undefined,
    kind: txt(incoming.kind) || undefined,
    venueKind: txt(opts.venueKind) || venueKindFromCategory(incoming.kind),
    travelMiles: null,
    travelMin: null,
  });
  return { locations: list, created: true };
}

/** The controlled venueKind (companies/lib.ts VENUE_KINDS) a free-text
 *  venue Category implies — used only for venues the import CREATES. */
export function venueKindFromCategory(category: unknown): string {
  const c = txt(category).toLowerCase();
  if (!c) return "proscenium";
  if (/church|worship|sanctuary|chapel|parish|cathedral|temple|synagogue/.test(c)) return "church";
  if (/black\s*box|studio/.test(c)) return "blackbox";
  if (/arena|stadium|field\s*house|open\s*floor/.test(c)) return "arena";
  if (/flat|conference|ballroom|cafeteria|gym|commons|multi/.test(c)) return "flat";
  return "proscenium";
}

export type RowLink = { how: "id" | "name" | "create" | "missing" | "skip"; name: string };

/**
 * The preview's Customer column + "will create N customers" list, computed
 * the way the commit will resolve them: rows that create a customer are
 * remembered for the rest of the file, so a second row for the same new
 * name shows "will create" but is counted once. Invalid rows are skipped.
 */
export function previewLinks(
  rows: ReadonlyArray<{ values: Record<string, string | number>; valid: boolean }>,
  index: readonly CustomerRef[]
): { links: RowLink[]; willCreate: string[] } {
  const pending: CustomerRef[] = [];
  const willCreate: string[] = [];
  const links = rows.map((r): RowLink => {
    if (!r.valid) return { how: "skip", name: "" };
    const res = resolveCustomerForRow(
      { customerId: r.values.customerId, customer: r.values.customer },
      [...index, ...pending]
    );
    if (res.how === "create") {
      pending.push({ id: "", name: res.name });
      willCreate.push(res.name);
      return { how: "create", name: res.name };
    }
    if (res.how === "name" && res.id === "") return { how: "create", name: res.name };
    return { how: res.how, name: res.name };
  });
  return { links, willCreate };
}
```

- [ ] **Step 5: types.ts** — replace the `customers` entry (lines 29-50) with the three entries below (contacts and venues follow customers, so the hub shows the three cards together):

```ts
  {
    key: "customers",
    label: "Customers",
    mono: "CU",
    color: "#7b3f8a",
    blurb: "Accounts — name, category, address with zip, phone and website. People and venues import separately.",
    dedupeLabel: "customer name",
    viewHref: "/companies",
    viewLabel: "View in Customers",
    fields: [
      { key: "name", header: "Customer Name", label: "Customer name", required: true, aliases: ["customer", "company", "organization", "org", "account", "client", "name", "venue name"], example: "Riverside Playhouse" },
      { key: "type", header: "Category", label: "Category", aliases: ["category", "type", "segment", "industry", "kind"], example: "Performing arts" },
      { key: "address", header: "Address", label: "Street address", aliases: ["address", "street", "street address", "addr", "address1"], example: "215 W Main St" },
      { key: "city", header: "City", label: "City", aliases: ["city", "town"], example: "Madison" },
      { key: "state", header: "State", label: "State", aliases: ["state", "province", "st"], example: "WI" },
      { key: "zip", header: "Zip", label: "Zip", kind: "zip", aliases: ["zip", "zip code", "zipcode", "postal", "postal code", "postcode"], example: "53703" },
      { key: "phone", header: "Phone", label: "Phone", aliases: ["phone", "telephone", "tel", "main phone", "phonenumber", "company phone"], example: "(608) 555-0110" },
      { key: "website", header: "Website", label: "Website", aliases: ["website", "web", "url", "homepage", "www"], example: "riversideplayhouse.org" },
      { key: "notes", header: "Notes", label: "Notes", aliases: ["notes", "note", "comments", "remarks"], example: "Referred by North Ridge HS" },
      // #137 — legacy embedded columns: accepted for one more release so
      // pre-#137 files keep working, but no longer template/export columns.
      { key: "contactName", header: "Contact Name", label: "Contact name", hidden: true, aliases: ["contact", "contact name", "primary contact", "attn", "contactperson"] },
      { key: "email", header: "Email", label: "Email", kind: "email", hidden: true, aliases: ["email", "e-mail", "contact email", "emailaddress"] },
      { key: "venue", header: "Venue", label: "Primary venue", hidden: true, aliases: ["venue", "venue name", "room", "hall", "space"] },
      // Optional exact match on an existing record's id — wins over the
      // name match when a file carries one (customers exports don't).
      { key: "customerId", header: "Customer ID", label: "Customer ID", hidden: true, aliases: ["customer id", "customerid", "customer_id", "company id", "account id", "id"] },
    ],
  },
  {
    key: "contacts",
    label: "Contacts",
    mono: "CT",
    color: "#8a3f5f",
    blurb: "People at a customer — linked to the account by customer name or id; unmatched customers are created.",
    dedupeLabel: "customer + email or name",
    viewHref: "/people",
    viewLabel: "View in People",
    fields: [
      { key: "customer", header: "Customer", label: "Customer", required: true, requiredUnless: "customerId", aliases: ["customer", "customer name", "company", "organization", "org", "account", "client"], example: "Riverside Playhouse" },
      { key: "customerId", header: "Customer ID", label: "Customer ID", aliases: ["customer id", "customerid", "customer_id", "company id", "account id"], example: "" },
      { key: "name", header: "Name", label: "Name", required: true, aliases: ["name", "full name", "contact", "contact name", "person"], example: "Maria Lopez" },
      { key: "email", header: "Email", label: "Email", kind: "email", aliases: ["email", "e-mail", "emailaddress", "work email"], example: "maria@riverside.org" },
      { key: "phone", header: "Phone", label: "Phone", aliases: ["phone", "telephone", "tel", "work phone", "office phone", "phonenumber"], example: "(608) 555-0110" },
      { key: "mobile", header: "Mobile", label: "Mobile", aliases: ["mobile", "cell", "cell phone", "mobile phone", "cellphone"], example: "(608) 555-0111" },
      { key: "title", header: "Title", label: "Title", aliases: ["title", "job title", "position"], example: "Technical Director" },
      { key: "role", header: "Role", label: "Role", aliases: ["role", "function"], example: "billing" },
      { key: "primary", header: "Primary", label: "Primary", aliases: ["primary", "is primary", "primary contact", "main contact"], example: "yes" },
      { key: "notes", header: "Notes", label: "Notes", aliases: ["notes", "note", "comments", "remarks"], example: "" },
      // #137 — category for a customer this file has to CREATE (D159);
      // never a template column.
      { key: "customerType", header: "Customer Category", label: "Customer category", hidden: true, aliases: ["customer category", "customer type", "company type", "company category", "account type"] },
    ],
  },
  {
    key: "venues",
    label: "Venues",
    mono: "VN",
    color: "#1f7a6f",
    blurb: "Performance spaces and sites — linked to the customer, with address, zip and category.",
    dedupeLabel: "customer + venue name",
    viewHref: "/venues",
    viewLabel: "View in Venues",
    fields: [
      { key: "customer", header: "Customer", label: "Customer", required: true, requiredUnless: "customerId", aliases: ["customer", "customer name", "company", "organization", "org", "account", "client"], example: "Riverside Playhouse" },
      { key: "customerId", header: "Customer ID", label: "Customer ID", aliases: ["customer id", "customerid", "customer_id", "company id", "account id"], example: "" },
      { key: "venue", header: "Venue Name", label: "Venue name", required: true, aliases: ["venue", "venue name", "name", "location", "site", "space", "room", "hall", "building"], example: "Main Stage" },
      { key: "address", header: "Address", label: "Address", aliases: ["address", "street", "street address", "addr", "address1"], example: "215 W Main St" },
      { key: "city", header: "City", label: "City", aliases: ["city", "town"], example: "Madison" },
      { key: "state", header: "State", label: "State", aliases: ["state", "province", "st"], example: "WI" },
      { key: "zip", header: "Zip", label: "Zip", kind: "zip", aliases: ["zip", "zip code", "zipcode", "postal", "postal code", "postcode"], example: "53703" },
      { key: "kind", header: "Category", label: "Category", aliases: ["category", "venue type", "venuetype", "type", "kind", "venue kind"], example: "theatre" },
      { key: "notes", header: "Notes", label: "Notes", aliases: ["notes", "note", "comments", "remarks"], example: "" },
      { key: "customerType", header: "Customer Category", label: "Customer category", hidden: true, aliases: ["customer category", "customer type", "company type", "company category", "account type"] },
    ],
  },
```

- [ ] **Step 6: Run tests, expect pass** — `npx tsx scripts/test-review-and-spec.ts | grep -E '#137 T3|ALL PASSED'` → 35 PASS + `ALL PASSED` (no FAIL lines); `npx tsc --noEmit -p . | tail -3` → empty; `npx eslint "src/app/(app)/import"`.

- [ ] **Step 7: Commit**

```bash
git add "src/app/(app)/import/link.ts" "src/app/(app)/import/parse.ts" "src/app/(app)/import/types.ts" scripts/test-review-and-spec.ts
git commit -m "feat(import): contacts + venues import types, customers Category/Zip/Phone/Website template, pure link-back helpers (#137 §2)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: `WRITERS.customers` — Category/Zip/Phone/Website, embedded columns as aliases, non-destructive update, link-stat plumbing, hidden-aware template/export

**Files:**
- Modify: `src/app/(app)/import/registry.ts:19-20` (imports), `:42-64` (`ImportResult`, `Writer`), `:129-210` (`WRITERS.customers`), `:607-639` (`commitImport`), `:659-676` (`templateCsv`/`exportCsv`)
- Test: `scripts/test-review-regressions.ts` (section "#137 T4")

**Interfaces:**
- Consumes: `mergeContact`, `mergeLocation`, `resolveCustomerForRow`, `CustomerRef` (Task 3, `import/link.ts`); `baseVenueKind` (`src/lib/identity/venue-defaults.ts`); `Customers.upsert/get/all`, `CustomerDoc`, `CustomerRecordInput`, `CustomerLocation`, `CustomerContact` (Task 1).
- Produces (`import/registry.ts`): `ImportResult` gains `customersCreated: number; customersLinked: number`; `export type LinkStats = { customersCreated: number; customersLinked: number; createdIds: Set<string> }`; `Writer.create(values, cache, link: LinkStats)` and `Writer.update?(existing, values, cache, link: LinkStats)`; module-private `recordInputOf(c: CustomerDoc): CustomerRecordInput`, `refreshCache(cache, id): Promise<void>`, `customerRecordFor(id, v, prev): CustomerRecordInput`; `commitImport()` copies the two counters into its result.

- [ ] **Step 1: Write the failing regression test** — add to the imports of `scripts/test-review-regressions.ts`:

```ts
import { commitImport, exportCsv } from "@/app/(app)/import/registry";
import { getTypeMeta } from "@/app/(app)/import/types";
import { autoMap, norm, parseCsv, prepareRows } from "@/app/(app)/import/parse";
```

add this module-level helper right after the imports (before `async function main()`):

```ts
/** #137 — CSV text → the prepared rows commitImport takes, through the same
 *  parse / autoMap / prepareRows path the import action runs. */
function prepImport(key: string, csv: string) {
  const type = getTypeMeta(key);
  if (!type) throw new Error(`unknown import type ${key}`);
  const p = parseCsv(csv);
  if (!p.ok) throw new Error(`CSV did not parse: ${p.error}`);
  return prepareRows(p.rows, autoMap(p.headers, type.fields), type.fields).rows;
}
```

and insert inside `main()` after the `#137 T1` block:

```ts
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
    assert.equal(exp.headers.join(","), "Customer Name,Category,Address,City,State,Zip,Phone,Website,Notes", "#137 T4 customers export columns = template columns (hidden aliases excluded)");
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
```

- [ ] **Step 2: Run it, expect failure** — `npm run test:review:regressions 2>&1 | tail -5` → `#137 T4 Zip → company zip` (or `exactly one venue`) assertion fails / `customersCreated` type errors.

- [ ] **Step 3: registry imports + types** — in `src/app/(app)/import/registry.ts` replace lines 19-20 with:

```ts
import { getTypeMeta, IMPORT_TYPE_KEYS, type ImportTypeMeta } from "./types";
import { norm, isoToMs, type FieldDef, type PreparedRow } from "./parse";
import { baseVenueKind } from "@/lib/identity/venue-defaults";
import { mergeContact, mergeLocation, resolveCustomerForRow, type CustomerRef } from "./link";
```

Replace lines 42-64 (`ImportMode` through the `Writer` type) with:

```ts
export type ImportMode = "skip" | "update" | "create";

export type ImportResult = {
  created: number;
  updated: number;
  skipped: number;
  errored: number;
  total: number;
  /** #137 — contacts/venues link-back: customers auto-created for unmatched
   *  rows, and rows that linked to an existing customer. */
  customersCreated: number;
  customersLinked: number;
};

/** The link-back tally a contacts/venues writer keeps for one commit.
 *  `createdIds` remembers the customers THIS file created, so a later row
 *  that lands on one of them is neither "linked to an existing customer"
 *  nor a second create. */
export type LinkStats = {
  customersCreated: number;
  customersLinked: number;
  createdIds: Set<string>;
};

/**
 * One writer per type. `find` dedupes against `cache` (a mutable array loaded
 * once per commit so rows created earlier in the same file are seen); `create`
 * appends a lightweight marker back into that cache. `link` is the commit's
 * running result — only the #137 link-back writers touch it.
 */
type Writer = {
  count: () => Promise<number>;
  load: () => Promise<Record<string, unknown>[]>;
  find: (values: Values, cache: Record<string, unknown>[]) => Record<string, unknown> | null;
  create: (values: Values, cache: Record<string, unknown>[], link: LinkStats) => Promise<void>;
  update?: (
    existing: Record<string, unknown>,
    values: Values,
    cache: Record<string, unknown>[],
    link: LinkStats
  ) => Promise<void>;
  exportObjects: () => Promise<Values[]>;
};
```

- [ ] **Step 4: helpers + customers writer** — insert immediately before `const WRITERS: Record<string, Writer> = {` (line 128):

```ts
/* ---------------- #137 customers / contacts / venues plumbing ---------------- */

/** The record input that re-saves a customer exactly as it is: every field
 *  the seam composes goes back in, so writeRecord's change check sees "no
 *  change" unless the caller overrides something. lifecycle / keywords /
 *  custom are omitted on purpose — undefined = preserve. */
function recordInputOf(c: Customers.CustomerDoc): Customers.CustomerRecordInput {
  return {
    id: c.id,
    name: c.name,
    type: c.type,
    location: c.location,
    owner: c.owner,
    pricingTier: c.pricingTier ?? null,
    zip: c.zip,
    phone: c.phone,
    website: c.website,
    locations: c.locations,
    contacts: c.contacts,
  };
}

/** Re-read one customer into the commit cache so later rows in the same
 *  file dedupe against what this row just wrote. */
async function refreshCache(cache: Record<string, unknown>[], id: string): Promise<void> {
  const fresh = await Customers.get(id);
  if (!fresh) return;
  const row = fresh as unknown as Record<string, unknown>;
  const i = cache.findIndex((c) => c.id === id);
  if (i >= 0) cache[i] = row;
  else cache.push(row);
}

/** True when a customers row carries anything for its address venue. */
function hasVenueColumns(v: Values): boolean {
  return !!(str(v.venue) || str(v.address) || str(v.city) || str(v.state) || str(v.zip));
}

/**
 * The record one customers row writes. `prev` is the customer as stored
 * (null on the create path). Company fields come from the row; the row's
 * Address/City/State/Zip merge into the PRIMARY venue — the only address the
 * UI, travel and quotes use, as this importer always did, but without
 * replacing the customer's other venues; Zip also stamps the company row;
 * and the legacy embedded Contact Name / Email / Phone columns still land as
 * a contact (D159).
 */
function customerRecordFor(
  id: string,
  v: Values,
  prev: Customers.CustomerDoc | null
): Customers.CustomerRecordInput {
  const name = str(v.name) || prev?.name || "";
  const type = str(v.type) || prev?.type || "";
  const contactName = str(v.contactName);
  let locations: Customers.CustomerLocation[] = prev?.locations ?? [];
  if (hasVenueColumns(v)) {
    locations = mergeLocation(
      locations,
      { label: str(v.venue), address: str(v.address), city: str(v.city), state: str(v.state), zip: str(v.zip) },
      "l" + id + "-" + seq(),
      { preferPrimary: true, venueKind: baseVenueKind(type, name) ?? "proscenium" }
    ).locations;
  }
  let contacts: Customers.CustomerContact[] = prev?.contacts ?? [];
  if (contactName) {
    contacts = mergeContact(contacts, {
      name: contactName,
      email: str(v.email),
      phone: str(v.phone),
      primary: true,
    }).contacts;
  }
  return {
    ...(prev ? recordInputOf(prev) : {}),
    id,
    name,
    type,
    // Company HQ fields: the row's value, else what's stored, else absent
    // (= preserve, which writeRecord also guarantees).
    zip: str(v.zip) || prev?.zip || undefined,
    // A legacy row's Phone is the embedded contact's; otherwise it's the
    // company's main line.
    phone: contactName ? prev?.phone || undefined : str(v.phone) || prev?.phone || undefined,
    website: str(v.website) || prev?.website || undefined,
    locations,
    contacts,
  };
}
```

Replace the `customers` writer (lines 129-210) with:

```ts
  customers: {
    count: async () => (await Customers.all()).length,
    load: async () => (await Customers.all()) as unknown as Record<string, unknown>[],
    // #137 — Customer ID when the file carries one, else normalized name
    // (the dedupe label stays "customer name").
    find: (v, cache) => {
      const r = resolveCustomerForRow(
        { customerId: v.customerId, customer: v.name },
        cache as unknown as CustomerRef[]
      );
      return r.id ? (cache.find((c) => c.id === r.id) ?? null) : null;
    },
    create: async (v, cache) => {
      const id = "c" + Date.now() + "-" + seq();
      await Customers.upsert(customerRecordFor(id, v, null));
      await refreshCache(cache, id);
    },
    update: async (ex, v, cache) => {
      const id = str(ex.id);
      const prev = await Customers.get(id);
      if (!prev) throw new Error(`Customer ${id} no longer exists`);
      await Customers.upsert(customerRecordFor(id, v, prev));
      await refreshCache(cache, id);
    },
    exportObjects: async () => {
      const list = await Customers.all();
      return list.map((rec) => {
        const loc =
          (rec.locations || []).find((l) => l.primary) || (rec.locations || [])[0] || null;
        return {
          name: rec.name || "",
          type: rec.type || "",
          address: loc?.address || "",
          city: loc?.city || "",
          state: loc?.state || "",
          zip: rec.zip || loc?.zip || "",
          phone: rec.phone || "",
          website: rec.website || "",
          notes: "",
        };
      });
    },
  },
```

- [ ] **Step 5: commitImport + CSV columns** — replace `commitImport` (lines 607-639) with:

```ts
export async function commitImport(
  key: string,
  rows: PreparedRow[],
  mode: ImportMode
): Promise<ImportResult> {
  const w = WRITERS[key];
  const res: ImportResult = {
    created: 0,
    updated: 0,
    skipped: 0,
    errored: 0,
    total: rows.length,
    customersCreated: 0,
    customersLinked: 0,
  };
  if (!w) return res;
  const cache = await w.load();
  const link: LinkStats = { customersCreated: 0, customersLinked: 0, createdIds: new Set<string>() };
  for (const r of rows) {
    if (!r.valid) {
      res.errored++;
      continue;
    }
    try {
      const existing = w.find(r.values, cache);
      if (existing && mode === "skip") {
        res.skipped++;
        continue;
      }
      if (existing && mode === "update" && w.update) {
        await w.update(existing, r.values, cache, link);
        res.updated++;
        continue;
      }
      await w.create(r.values, cache, link);
      res.created++;
    } catch {
      res.errored++;
    }
  }
  res.customersCreated = link.customersCreated;
  res.customersLinked = link.customersLinked;
  return res;
}
```

Replace `templateCsv` + `exportCsv` (lines 659-676) with:

```ts
/** The template / export columns: every field that isn't a hidden alias (#137). */
function columnsOf(type: ImportTypeMeta): FieldDef[] {
  return type.fields.filter((f) => !f.hidden);
}

/** Blank template: header row + one example row (importkit.templateCSV). */
export function templateCsv(key: string): string {
  const type = getTypeMeta(key);
  if (!type) return "";
  const cols = columnsOf(type);
  const header = cols.map((f) => csvCell(f.header)).join(",");
  const example = cols.map((f) => csvCell(f.example || "")).join(",");
  return header + "\n" + example + "\n";
}

/** Export CSV: same columns as the template so export → edit → re-import works. */
export async function exportCsv(key: string): Promise<string> {
  const type = getTypeMeta(key);
  if (!type) return "";
  const objs = await exportObjectsFor(key);
  const cols = columnsOf(type);
  const header = cols.map((f) => csvCell(f.header)).join(",");
  const lines = objs.map((o) => cols.map((f) => csvCell(o[f.key] ?? "")).join(","));
  return header + "\n" + lines.join("\n") + (lines.length ? "\n" : "");
}
```

- [ ] **Step 6: Run tests, expect pass** — `npx tsc --noEmit -p . | tail -3` → empty; `npm run test:review:regressions 2>&1 | tail -3` → `review regression checks passed`; `npx tsx scripts/test-review-and-spec.ts | grep -E 'FAIL|ALL PASSED'` → only `ALL PASSED` (the #81 catalogPatch checks still import from registry); `npx eslint "src/app/(app)/import/registry.ts" scripts/test-review-regressions.ts`.

- [ ] **Step 7: Commit**

```bash
git add "src/app/(app)/import/registry.ts" scripts/test-review-regressions.ts
git commit -m "feat(import): customers writer — Category/Zip/Phone/Website, embedded columns as aliases, merge instead of replace; link-stat plumbing; hidden-aware CSV columns (#137 §2)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: `WRITERS.contacts` — link by name or id, auto-create once per file, primary demotion, idempotent re-import, export

**Files:**
- Modify: `src/app/(app)/import/registry.ts` (imports from `./link`; helpers after `customerRecordFor`; new `contacts` entry after `customers` in `WRITERS`)
- Test: `scripts/test-review-regressions.ts` (section "#137 T5")

**Interfaces:**
- Consumes: `recordInputOf`, `refreshCache`, `LinkStats`, `Writer` (Task 4); `matchContact`, `mergeContact`, `parseYesNo`, `resolveCustomerForRow` (Task 3); `Customers.upsert/get/all` (Task 1).
- Produces (module-private in `registry.ts`): `linkCustomer(v: Values, cache, link: LinkStats): Promise<Customers.CustomerDoc>` (resolve-or-create, pushes a created customer into the cache), `writeContactRow(cust: Customers.CustomerDoc, v: Values): Promise<void>`; `WRITERS.contacts`.

- [ ] **Step 1: Write the failing regression test** — insert inside `main()` after the `#137 T4` block:

```ts
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
    const r3 = await commitImport("contacts", prepImport("contacts", csv1), "update");
    assert.equal(r3.updated, 4, "#137 T5 update mode re-imports without duplicating");
    assert.equal((await getCustomer("c-t137-ct"))!.contacts.length, 3, "#137 T5 still three contacts after two re-imports");
    assert.equal((await allCustomers()).filter((c) => norm(c.name) === norm("T137 Brand New Org")).length, 1, "#137 T5 still one auto-created customer");

    const csv = await exportCsv("contacts");
    const exp = parseCsv(csv);
    assert.equal(exp.headers.join(","), "Customer,Customer ID,Name,Email,Phone,Mobile,Title,Role,Primary,Notes", "#137 T5 contacts export columns = template columns");
    const m = exp.objects.find((o) => o.Email === "maria@t137ct.example");
    assert.ok(m, "#137 T5 exported contact present");
    assert.ok(m!.Customer === "T137 Contacts Co" && m!["Customer ID"] === "c-t137-ct" && m!.Mobile === "(608) 555-0111" && m!.Phone === "(608) 555-0110" && m!.Title === "Technical Director" && m!.Primary === "yes", "#137 T5 exported contact carries the customer's name + id and its fields");
    const back = await commitImport("contacts", prepImport("contacts", csv).filter((r) => String(r.values.customer).startsWith("T137")), "skip");
    assert.equal(back.created, 0, "#137 T5 export → re-import creates nothing (round-trip)");
    assert.equal(back.errored, 0, "#137 T5 export → re-import errors nothing");
  }
```

- [ ] **Step 2: Run it, expect failure** — `npm run test:review:regressions 2>&1 | tail -5` → `#137 T5 four contacts created` fails (`commitImport("contacts")` returns zeros — no writer yet).

- [ ] **Step 3: Implement** — in `registry.ts` change the `./link` import to:

```ts
import {
  matchContact,
  mergeContact,
  mergeLocation,
  parseYesNo,
  resolveCustomerForRow,
  type CustomerRef,
} from "./link";
```

Add after `customerRecordFor` (before `const WRITERS`):

```ts
/**
 * Resolve the customer a contacts / venues row belongs to, creating a bare
 * one (`{ name, type: Customer Category column ?? "" }`) when neither the
 * id nor the normalized name matches — and pushing it into the cache so the
 * rest of the file links to the same record (D159). Returns the customer as
 * stored right now. Throws (→ the row counts as errored) when the row has
 * neither a Customer nor a Customer ID.
 */
async function linkCustomer(
  v: Values,
  cache: Record<string, unknown>[],
  link: LinkStats
): Promise<Customers.CustomerDoc> {
  const docs = cache as unknown as Customers.CustomerDoc[];
  const r = resolveCustomerForRow({ customerId: v.customerId, customer: v.customer }, docs);
  if (r.how === "missing") throw new Error("Row has neither a Customer nor a Customer ID");
  if (r.id) {
    const fresh = await Customers.get(r.id);
    if (!fresh) throw new Error(`Customer ${r.id} no longer exists`);
    // A customer THIS file created a few rows ago is neither "linked to an
    // existing customer" nor a second create — it was counted when created.
    if (!link.createdIds.has(r.id)) link.customersLinked++;
    return fresh;
  }
  const id = "c" + Date.now() + "-" + seq();
  await Customers.upsert({ id, name: r.name, type: str(v.customerType), locations: [], contacts: [] });
  const created = await Customers.get(id);
  if (!created) throw new Error(`Customer ${id} could not be created`);
  docs.push(created);
  link.createdIds.add(id);
  link.customersCreated++;
  return created;
}

/** One contacts row → the customer's contacts, merged by email then name. */
async function writeContactRow(cust: Customers.CustomerDoc, v: Values): Promise<void> {
  const { contacts } = mergeContact(cust.contacts || [], {
    name: str(v.name),
    email: str(v.email),
    phone: str(v.phone),
    mobile: str(v.mobile),
    // One free-text slot on the contact row (contacts.title): Title, else Role.
    title: str(v.title) || str(v.role),
    primary: parseYesNo(v.primary),
  });
  await Customers.upsert({ ...recordInputOf(cust), contacts });
}
```

Add the `contacts` entry to `WRITERS` immediately after the `customers` entry:

```ts
  contacts: {
    count: async () =>
      (await Customers.all()).reduce((n, c) => n + (c.contacts || []).length, 0),
    load: async () => (await Customers.all()) as unknown as Record<string, unknown>[],
    // Dedupe key: customer (id → normalized name) + email, else name.
    find: (v, cache) => {
      const docs = cache as unknown as Customers.CustomerDoc[];
      const r = resolveCustomerForRow({ customerId: v.customerId, customer: v.customer }, docs);
      if (!r.id) return null;
      const cust = docs.find((c) => c.id === r.id);
      const hit = cust ? matchContact(cust.contacts || [], v.email, v.name) : null;
      return hit ? { customerId: r.id, name: hit.name } : null;
    },
    create: async (v, cache, link) => {
      const cust = await linkCustomer(v, cache, link);
      await writeContactRow(cust, v);
      await refreshCache(cache, cust.id);
    },
    update: async (ex, v, cache, link) => {
      const id = str(ex.customerId);
      const cust = await Customers.get(id);
      if (!cust) throw new Error(`Customer ${id} no longer exists`);
      if (!link.createdIds.has(id)) link.customersLinked++;
      await writeContactRow(cust, v);
      await refreshCache(cache, id);
    },
    exportObjects: async () => {
      const list = await Customers.all();
      return list.flatMap((rec) =>
        (rec.contacts || []).map((c) => ({
          customer: rec.name || "",
          customerId: rec.id,
          name: c.name || "",
          email: c.email || "",
          phone: c.phone || "",
          mobile: c.mobile || "",
          title: c.role || "",
          role: "",
          primary: c.primary ? "yes" : "no",
          notes: "",
        }))
      );
    },
  },
```

- [ ] **Step 4: Run tests, expect pass** — `npx tsc --noEmit -p . | tail -3` → empty; `npm run test:review:regressions 2>&1 | tail -3` → `review regression checks passed`; `npx eslint "src/app/(app)/import/registry.ts" scripts/test-review-regressions.ts`.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/import/registry.ts" scripts/test-review-regressions.ts
git commit -m "feat(import): contacts importer — link by customer id/name, auto-create once per file, primary demotion, idempotent, export (#137 §2, closes #82)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: `WRITERS.venues` — link, zip + category, claims the unnamed base venue, export

**Files:**
- Modify: `src/app/(app)/import/registry.ts` (import `matchLocation`; `writeVenueRow` after `writeContactRow`; new `venues` entry after `contacts` in `WRITERS`)
- Test: `scripts/test-review-regressions.ts` (section "#137 T6")

**Interfaces:**
- Consumes: `linkCustomer`, `recordInputOf`, `refreshCache` (Tasks 4-5); `matchLocation`, `mergeLocation`, `resolveCustomerForRow` (Task 3).
- Produces (module-private): `writeVenueRow(cust: Customers.CustomerDoc, v: Values): Promise<void>`; `WRITERS.venues`.

- [ ] **Step 1: Write the failing regression test** — insert inside `main()` after the `#137 T5` block:

```ts
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
    const r3 = await commitImport("venues", prepImport("venues", csv1), "update");
    assert.equal(r3.updated, 3, "#137 T6 update mode re-imports without duplicating");
    assert.equal((await getCustomer("c-t137-vn"))!.locations.length, 2, "#137 T6 no duplicate venues after re-imports");

    const csv = await exportCsv("venues");
    const exp = parseCsv(csv);
    assert.equal(exp.headers.join(","), "Customer,Customer ID,Venue Name,Address,City,State,Zip,Category,Notes", "#137 T6 venues export columns = template columns");
    const row = exp.objects.find((o) => o["Customer ID"] === "c-t137-vn" && o["Venue Name"] === "Black Box");
    assert.ok(row, "#137 T6 exported venue present");
    assert.ok(row!.Zip === "54913-1234" && row!.Category === "black box" && row!.Customer === "T137 Venues District" && row!.Address === "5000 N Ballard Rd", "#137 T6 exported venue carries the customer's name + id and its fields");
    const back = await commitImport("venues", prepImport("venues", csv).filter((r) => String(r.values.customer).startsWith("T137")), "skip");
    assert.equal(back.created, 0, "#137 T6 export → re-import creates nothing (round-trip)");
    assert.equal(back.errored, 0, "#137 T6 export → re-import errors nothing");
  }
```

- [ ] **Step 2: Run it, expect failure** — `npm run test:review:regressions 2>&1 | tail -5` → `#137 T6 three venues created` fails.

- [ ] **Step 3: Implement** — add `matchLocation,` to the `./link` import list in `registry.ts` (alphabetical: after `matchContact,`). Add after `writeContactRow`:

```ts
/** One venues row → the customer's locations, merged by normalized label
 *  (a labelled row claims the unnamed base venue first, see mergeLocation). */
async function writeVenueRow(cust: Customers.CustomerDoc, v: Values): Promise<void> {
  const { locations } = mergeLocation(
    cust.locations || [],
    {
      label: str(v.venue),
      address: str(v.address),
      city: str(v.city),
      state: str(v.state),
      zip: str(v.zip),
      kind: str(v.kind),
    },
    "l" + cust.id + "-" + seq(),
    { preferPrimary: false }
  );
  await Customers.upsert({ ...recordInputOf(cust), locations });
}
```

Add the `venues` entry to `WRITERS` immediately after `contacts`:

```ts
  venues: {
    count: async () =>
      (await Customers.all()).reduce((n, c) => n + (c.locations || []).length, 0),
    load: async () => (await Customers.all()) as unknown as Record<string, unknown>[],
    // Dedupe key: customer (id → normalized name) + normalized venue name.
    find: (v, cache) => {
      const docs = cache as unknown as Customers.CustomerDoc[];
      const r = resolveCustomerForRow({ customerId: v.customerId, customer: v.customer }, docs);
      if (!r.id) return null;
      const cust = docs.find((c) => c.id === r.id);
      const hit = cust ? matchLocation(cust.locations || [], v.venue) : null;
      return hit ? { customerId: r.id, locationId: hit.id ?? "" } : null;
    },
    create: async (v, cache, link) => {
      const cust = await linkCustomer(v, cache, link);
      await writeVenueRow(cust, v);
      await refreshCache(cache, cust.id);
    },
    update: async (ex, v, cache, link) => {
      const id = str(ex.customerId);
      const cust = await Customers.get(id);
      if (!cust) throw new Error(`Customer ${id} no longer exists`);
      if (!link.createdIds.has(id)) link.customersLinked++;
      await writeVenueRow(cust, v);
      await refreshCache(cache, id);
    },
    exportObjects: async () => {
      const list = await Customers.all();
      return list.flatMap((rec) =>
        (rec.locations || [])
          // An unnamed, address-less D85 placeholder is an app artifact, not
          // data — exporting it would only produce a row that fails re-import.
          .filter((l) => (l.label || "").trim() || (l.address || "").trim())
          .map((l) => ({
            customer: rec.name || "",
            customerId: rec.id,
            venue: l.label || "",
            address: l.address || "",
            city: l.city || "",
            state: l.state || "",
            zip: l.zip || "",
            kind: l.kind || "",
            notes: "",
          }))
      );
    },
  },
```

- [ ] **Step 4: Run tests, expect pass** — `npx tsc --noEmit -p . | tail -3` → empty; `npm run test:review:regressions 2>&1 | tail -3` → `review regression checks passed`; `npx eslint "src/app/(app)/import/registry.ts" scripts/test-review-regressions.ts`.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/import/registry.ts" scripts/test-review-regressions.ts
git commit -m "feat(import): venues importer — link by customer id/name, zip + category, claims the base venue, export (#137 §2, closes #83)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Hub UI — "Customer" preview column, "Will create N new customers", linked/created result counts

**Files:**
- Modify: `src/app/(app)/import/actions.ts:46-48`
- Modify: `src/app/(app)/import/page.tsx:1-6` (imports), `:129-135` (`AdminBody` data), `:521-529` (`ImportFlowModal` call), `:534-546` (props), `:697-702` (`PastePreview` call), `:767-774` (`DoneResult`/`parseResult`), `:776-848` (`DonePanel`)
- Modify: `src/app/(app)/import/controls.tsx:3-25` (imports/props), `:37-46` (derived values), `:151` (placeholder), `:267-358` (preview table), `:360` (before the submit row)
- Test: none new — the pure computation (`previewLinks`) is covered by Task 3; `npx tsc` + `npx eslint` here; the controller's browser pass + `test:smoke` (Task 8) cover rendering.

**Interfaces:**
- Consumes: `previewLinks`, `CustomerRef`, `RowLink` (Task 3); `ImportResult.customersCreated/customersLinked` (Task 4); `FieldDef.hidden/requiredUnless` (Task 3); `Customers.all()`.
- Produces: `PastePreview` prop `customerIndex: CustomerRef[]`; `ImportFlowModal` prop `customerIndex`; `DoneResult` gains `customersCreated`, `customersLinked`; the `r=` param becomes `created.updated.skipped.errored.total.customersCreated.customersLinked` (5-part values from old links still parse).

- [ ] **Step 1: actions.ts** — replace lines 46-48 with:

```ts
  revalidatePath("/", "layout");
  const r = [
    res.created,
    res.updated,
    res.skipped,
    res.errored,
    res.total,
    res.customersCreated,
    res.customersLinked,
  ].join(".");
  redirect(`/import?tab=import&type=${encodeURIComponent(key)}&r=${r}`);
```

- [ ] **Step 2: page.tsx** — add to the imports (after line 6):

```ts
import { all as allCustomers } from "@/lib/stores/customers";
import type { CustomerRef } from "./link";
```

In `AdminBody`, after `const counts = await allCounts();` (line 135) add:

```ts
  // #137 — contacts/venues previews resolve each row's customer client-side
  // against this index, with the same rule the commit uses (./link).
  const customerIndex: CustomerRef[] =
    openType && openType.fields.some((f) => f.key === "customer")
      ? (await allCustomers()).map((c) => ({ id: c.id, name: c.name }))
      : [];
```

Replace the `ImportFlowModal` call (lines 521-529) with:

```tsx
      {openType && (
        <ImportFlowModal
          type={openType}
          resultRaw={resultRaw}
          errRaw={errRaw}
          closeHref={hrefFor({ type: null, r: null })}
          anotherHref={hrefFor({ type: openType.key, r: null })}
          customerIndex={customerIndex}
        />
      )}
```

Replace the `ImportFlowModal` signature (lines 534-546) with:

```tsx
function ImportFlowModal({
  type,
  resultRaw,
  errRaw,
  closeHref,
  anotherHref,
  customerIndex,
}: {
  type: NonNullable<ReturnType<typeof getTypeMeta>>;
  resultRaw: string;
  errRaw: string;
  closeHref: string;
  anotherHref: string;
  customerIndex: CustomerRef[];
}) {
```

Replace the `PastePreview` call (lines 697-702) with:

```tsx
                <PastePreview
                  typeKey={type.key}
                  fields={type.fields}
                  dedupeLabel={type.dedupeLabel}
                  accent="var(--accent)"
                  customerIndex={customerIndex}
                />
```

Replace `DoneResult` + `parseResult` (lines 767-774) with:

```ts
type DoneResult = {
  created: number;
  updated: number;
  skipped: number;
  errored: number;
  total: number;
  customersCreated: number;
  customersLinked: number;
};

function parseResult(raw: string): DoneResult | null {
  if (!raw) return null;
  const p = raw.split(".").map((n) => parseInt(n, 10));
  if (p.length < 5 || p.some((n) => isNaN(n))) return null;
  return {
    created: p[0],
    updated: p[1],
    skipped: p[2],
    errored: p[3],
    total: p[4],
    // #137 — absent on links minted before the link-back counts existed.
    customersCreated: p[5] ?? 0,
    customersLinked: p[6] ?? 0,
  };
}
```

In `DonePanel`, add after `const hasErrors = r.errored > 0;` (line 784):

```ts
  // #137 — contacts/venues carry a Customer column; report how the rows linked.
  const linkable = type.fields.some((f) => f.key === "customer");
```

and insert after the stats grid's closing `</div>` (line 848, before `{r.errored > 0 && (`):

```tsx
      {linkable && r.customersLinked + r.customersCreated > 0 && (
        <div style={{ marginTop: 12, textAlign: "center", fontSize: 12, color: "#5b616e", lineHeight: 1.5 }}>
          {r.customersLinked} row{r.customersLinked === 1 ? "" : "s"} linked to existing customers ·{" "}
          {r.customersCreated} new customer{r.customersCreated === 1 ? "" : "s"} created
        </div>
      )}
```

- [ ] **Step 3: controls.tsx** — replace lines 3-25 with:

```tsx
import { useState } from "react";
import { autoMap, parseCsv, prepareRows, type FieldDef } from "./parse";
import { previewLinks, type CustomerRef, type RowLink } from "./link";
import { importRecords } from "./actions";

/**
 * Paste → live preview → confirm, the client leaf of the import flow. It parses
 * the pasted text locally only to render the preview + stats; the authoritative
 * write re-parses the same text server-side in `importRecords`. An `.xlsx` file
 * picker posts to `/api/import/xlsx`, which converts the file to CSV server-side,
 * and the result lands in the same `text` state the textarea binds to — so it
 * funnels through this same paste flow unchanged.
 *
 * #137: for types with a `Customer` column (contacts, venues) the preview also
 * resolves each row against `customerIndex` — the same rule the commit runs —
 * and lists the customers the import will create.
 */
export function PastePreview({
  typeKey,
  fields,
  dedupeLabel,
  accent,
  customerIndex,
}: {
  typeKey: string;
  fields: FieldDef[];
  dedupeLabel: string;
  accent: string;
  customerIndex: CustomerRef[];
}) {
```

Replace lines 37-46 (from `const mappedFields` through `const canImport`) with:

```ts
  const mappedFields = mapping
    ? fields.filter((f) => mapping[f.key] != null && mapping[f.key] >= 0)
    : [];
  const reqMissing = mapping
    ? fields
        .filter(
          (f) =>
            f.required &&
            !(mapping[f.key] >= 0) &&
            // #137 — `Customer` is satisfied by a `Customer ID` column.
            !(f.requiredUnless && mapping[f.requiredUnless] >= 0)
        )
        .map((f) => f.label)
    : [];
  const previewFields = (mappedFields.length ? mappedFields : fields.slice(0, 3)).slice(0, 4);
  const previewRows = (prep?.rows || []).slice(0, 5);

  // #137 — link-back preview for contacts / venues.
  const linkable = fields.some((f) => f.key === "customer");
  const links = linkable && prep ? previewLinks(prep.rows, customerIndex) : null;
  const willCreate = links?.willCreate ?? [];
  const linkText = (l: RowLink | undefined): { text: string; color: string } => {
    if (!l || l.how === "skip") return { text: "—", color: "#aab0bb" };
    if (l.how === "create") return { text: "will create", color: "color-mix(in srgb, var(--accent) 70%, #000)" };
    if (l.how === "missing") return { text: "no customer", color: "#b4543a" };
    return { text: "linked", color: "#5b616e" };
  };
  const previewCols = previewFields.length + (linkable ? 1 : 0);

  const canImport = !!prep && prep.stats.valid > 0 && reqMissing.length === 0;
```

Replace line 151 (the textarea `placeholder`) with:

```tsx
        placeholder={fields.filter((f) => !f.hidden).map((f) => f.header).join(",")}
```

Replace the preview block (lines 267-358, from `{/* preview */}` through the closing `)}` of `{previewRows.length > 0 && (`) with:

```tsx
      {/* preview */}
      {previewRows.length > 0 && (
        <>
          <div
            style={{
              marginTop: 16,
              fontSize: 11,
              fontWeight: 600,
              color: "#9aa0ab",
              letterSpacing: ".05em",
              textTransform: "uppercase",
              marginBottom: 8,
            }}
          >
            Preview
          </div>
          <div
            style={{
              border: "1px solid #eef0f3",
              borderRadius: 10,
              overflowX: "auto",
            }}
          >
            <div style={{ minWidth: Math.max(320, previewCols * 130) }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: gridCols(previewCols),
                  gap: 10,
                  padding: "8px 12px",
                  fontSize: 10,
                  fontWeight: 600,
                  color: "#aab0bb",
                  textTransform: "uppercase",
                  letterSpacing: ".04em",
                  background: "#fbfbfc",
                  borderBottom: "1px solid #f0f1f4",
                }}
              >
                {previewFields.map((f) => (
                  <span
                    key={f.key}
                    style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                  >
                    {f.label}
                  </span>
                ))}
                {linkable && (
                  <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    Customer
                  </span>
                )}
              </div>
              {previewRows.map((r) => {
                const link = linkText(links?.links[r.i]);
                return (
                  <div
                    key={r.i}
                    style={{
                      display: "grid",
                      gridTemplateColumns: gridCols(previewCols),
                      gap: 10,
                      padding: "9px 12px",
                      fontSize: 12,
                      alignItems: "center",
                      borderBottom: "1px solid #f5f6f8",
                    }}
                  >
                    {previewFields.map((f, ci) => {
                      const raw = r.values[f.key];
                      const txt = raw === "" || raw == null ? "—" : String(raw);
                      const mono = f.kind === "number" || f.kind === "date" || f.kind === "zip";
                      return (
                        <span
                          key={f.key}
                          style={{
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            fontFamily: mono ? "var(--font-mono)" : undefined,
                            fontWeight: ci === 0 ? 600 : 400,
                            color: ci === 0 ? (r.valid ? "#16181d" : "#b4543a") : "#5b616e",
                          }}
                        >
                          {txt}
                        </span>
                      );
                    })}
                    {linkable && (
                      <span
                        style={{
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          fontSize: 11,
                          fontWeight: 600,
                          color: link.color,
                        }}
                      >
                        {link.text}
                      </span>
                    )}
                  </div>
                );
              })}
              {prep && prep.stats.total > previewRows.length && (
                <div style={{ padding: "8px 12px", fontSize: 11, color: "#aab0bb" }}>
                  + {prep.stats.total - previewRows.length} more rows
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* #137 — customers this file will create (listed before commit) */}
      {willCreate.length > 0 && (
        <div
          style={{
            marginTop: 12,
            background: "var(--accent-soft)",
            border: "1px solid color-mix(in srgb, var(--accent) 30%, #fff)",
            borderRadius: 9,
            padding: "10px 12px",
            fontSize: 12,
            color: "color-mix(in srgb, var(--accent) 70%, #000)",
            lineHeight: 1.45,
          }}
        >
          Will create {willCreate.length} new customer{willCreate.length === 1 ? "" : "s"}:{" "}
          {willCreate.slice(0, 6).join(", ")}
          {willCreate.length > 6 ? ` and ${willCreate.length - 6} more` : ""}
          . Rows whose customer isn’t in Peak yet link to these; fix the spelling in your source
          first if one of them should be an existing customer.
        </div>
      )}
```

- [ ] **Step 4: Verify** — `npx tsc --noEmit -p . | tail -3` → empty; `npx eslint "src/app/(app)/import"` → clean; `npx tsx scripts/test-review-and-spec.ts | grep -E 'FAIL|ALL PASSED'` → `ALL PASSED`.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/import/actions.ts" "src/app/(app)/import/page.tsx" "src/app/(app)/import/controls.tsx"
git commit -m "feat(import): Customer preview column, 'will create N customers' before commit, linked/created counts on the result (#137 §3)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Smoke routes + docs (D159, PUNCHLIST #137 / #82 / #83)

**Files:**
- Modify: `scripts/smoke-routes.ts:59` (after `"/import",`)
- Modify: `DECISIONS.md` (append after `## D153`, the current last entry)
- Modify: `PUNCHLIST.md:4906` (#82 heading + status line), `:4938` (#83 heading + append status), `:6187` (#137 heading + append Shipped)
- Test: the controller runs `npm run test:smoke` after this task lands (implementers do not).

**Interfaces:** none.

- [ ] **Step 1: Check the D-number is free** — `git fetch -q origin main && git show origin/main:DECISIONS.md | grep -c '^## D159'` must print `0` and `grep -c '^## D159' DECISIONS.md` must print `0`. If either is non-zero, use the next free number everywhere below (the D-number appears in the DECISIONS heading, three PUNCHLIST headings/paragraphs, and Task 1's migration comment — update that comment too).

- [ ] **Step 2: smoke routes** — in `scripts/smoke-routes.ts` replace line 59 (`  "/import",`) with:

```ts
  "/import",
  // #137 — the three people/venue importers + every CSV the hub serves.
  "/import?type=customers",
  "/import?type=contacts",
  "/import?type=venues",
  "/import?tab=export",
  "/import/export?type=customers",
  "/import/export?type=customers&kind=template",
  "/import/export?type=contacts",
  "/import/export?type=contacts&kind=template",
  "/import/export?type=venues",
  "/import/export?type=venues&kind=template",
```

- [ ] **Step 3: DECISIONS.md** — append after the D153 entry (end of file):

```markdown
## D159. Import hub — customers / contacts / venues as three importers, unmatched customers auto-created (#137, closes #82 + #83, 2026-09-21)

Jeff's decision (brainstorm 2026-09-21): a contacts or venues row whose customer isn't in Peak
**creates** the customer rather than failing. Spec:
`docs/superpowers/specs/2026-09-21-import-export-people-venues-design.md`. Defaults taken while
implementing it:

- **Link-back order** is `Customer ID` exact match → normalized-name match (the hub's `norm`:
  lowercase, alphanumerics only) → create `{ name, type: hidden "Customer Category" column ?? "" }`.
  A created customer is pushed into the commit cache, so every later row in the same file links to
  it — one file, one new record per distinct name. The preview lists "Will create N new customers"
  from the same pure resolver (`import/link.ts`), so what it shows is what commits.
- **`Customer` OR `Customer ID`** — `FieldDef.requiredUnless` lets either column satisfy the
  requirement; a row with neither fails validation before commit.
- **Embedded columns stay as hidden aliases** (`FieldDef.hidden`: auto-mapped on import, absent from
  template and export) so pre-#137 customers files keep working for one release. On such a row,
  `Phone` is the embedded contact's; on a new-format row it is the company's main phone.
- **Where a customers row's address goes:** Address/City/State/Zip merge into the customer's
  **primary venue** — the only address the record page, travel estimates and quotes use, and what
  this importer always did — but now as a merge (`mergeLocation`), never the old replace-all-venues.
  Zip also stamps `companies.zip` (the spec's "company HQ/billing" zip); Phone/Website stamp
  `companies.main_phone` / `website`. The companies row's own address/city/state columns are left
  for the Daylite import. A blank Category writes `""` (the old importer invented "Performing arts").
- **Venue category is a new nullable `sites.kind`** (hand-written migration `0023_sites_kind`): the
  spec allowed "the site row's existing free-text kind column, else the location document", but
  `venue_kind` is the controlled vocabulary the estimator and Companies modal switch on, and sites
  are relational rows, not documents. `kind` is stored as typed and shown as a pill on the customer
  record; a venue the import **creates** derives `venueKind` from it (`venueKindFromCategory`:
  church/blackbox/arena/flat, default proscenium); an existing venue keeps its `venueKind`.
- **The first imported venue claims the unnamed D85 base venue** instead of leaving an empty twin
  (any labelled row with no name match takes the first blank-label location); a customers row with
  no Venue column addresses the primary venue without renaming it.
- **Contacts:** matched by primary email, else normalized name; a hit **keeps its stored name**
  (writeRecord matches contacts by display name — renaming would mint a second row). `Title`, else
  `Role`, fills the one free-text slot (`contacts.title`, the Daylite precedent). `Mobile` is a
  second, "mobile"-labelled phone channel; `CustomerContact.phone` now composes as the non-mobile
  number (falling back to the first phone) and `mobile` as the mobile one, so a round trip through
  writeRecord targets the right row each. `Primary` = yes/y/true/1/x promotes and demotes the others;
  anything else leaves flags alone, except that the first contact on a record is always primary.
- **"Create new" never duplicates** a contact or venue — the writers are upserts; the mode only
  matters for the customers type.
- **Store seam:** `zip`/`kind` (locations), `mobile` (contacts) and `zip`/`phone`/`website` (doc)
  are write-when-provided / preserve-when-undefined, backfilled before the D83 change check exactly
  like #23's lifecycle/keywords/custom, so the Companies modal, quote intake and inbox quick-add —
  which don't carry them — neither clear them nor bump `updatedAt`. `LocationInput`/`ContactInput`
  and `saveCustomerAction` carry them anyway, and the quote-intake / inbox `toLocationInput` copies
  are replaced by one shared converter in `companies/lib.ts` that keeps `locationName` (the #96
  review follow-up: the intake copy was clearing the campus name on every save).
- **Zip cells** are trimmed; 5-digit and ZIP+4 kept as typed; a 4-digit value gets its
  Excel-stripped leading zero back.
- **Exports:** contacts and venues export one row per record with the customer's name and id (so
  export → edit → re-import links by id even after a rename); customers export gains Category + Zip
  and drops the embedded contact/venue columns; an unnamed, address-less placeholder venue is not
  exported (it would only produce a row that fails re-import). `Notes` columns are accepted and
  ignored on all three types, as the customers importer always did.
```

- [ ] **Step 4: PUNCHLIST.md** — change the #82 heading (line 4906) to:

```markdown
## 82. People need to import as first-class records, not riding along on Customers — DONE 2026-09-21 (#137, D159)
```

and replace its last line `**Status:** OPEN — logged only, no code.` with:

```markdown
**Status:** DONE 2026-09-21 — shipped as the `contacts` importer under #137 (D159): one row per
person, linked to exactly one customer by name or id, unmatched customers auto-created (the
narrower option in question 1; #20's multi-link model is unchanged).
```

Change the #83 heading (line 4938) to:

```markdown
## 83. Venues need a bulk import — data model / cleanup TBD — DONE 2026-09-21 (#137, D159)
```

and append after its last paragraph (`**Open question for Jeff:** …`):

```markdown
**Status:** DONE 2026-09-21 — shipped as the `venues` importer under #137 (D159): Customer /
Customer ID, Venue Name, Address, City, State, Zip, Category (free text, new `sites.kind`), one
row per venue, linked or auto-created. The data-quality walk-through of existing venue records
(duplicates, conflated site-vs-performance-space) is still a conversation with Jeff, not a punch
item.
```

Change the #137 heading (line 6187) to:

```markdown
## 137. Import/Export: separate customers / contacts / venues imports, category column, zip, link-back — DONE 2026-09-21 (D159) (absorbs #82, #83)
```

and append after its `**Ask:**` paragraph:

```markdown
**Shipped:** three cards on the Import hub. **Customers** — `Customer Name*, Category, Address,
City, State, Zip, Phone, Website, Notes`; Category → `type`, the address merges into the primary
venue (non-destructively — the old writer replaced every venue on "Update existing"), Zip also on
the company row, Phone/Website on the company row; the old `Contact Name / Email / Venue` columns
still import as hidden aliases. **Contacts** — `Customer* | Customer ID, Name*, Email, Phone,
Mobile, Title, Role, Primary, Notes`, matched by customer + email-or-name, `Primary=yes` demotes the
others, re-importing the same file is a no-op. **Venues** — `Customer* | Customer ID, Venue Name*,
Address, City, State, Zip, Category, Notes`, matched by customer + venue name; the first imported
venue fills the customer's unnamed base venue. Both link-back types match `Customer ID` → normalized
name → **create the customer** (Jeff's call), once per name per file; the preview shows a Customer
column (linked / will create) and "Will create N new customers: …" before commit, and the result
reports rows linked vs customers created. Exports for all three (customers gains Category + Zip;
contacts/venues carry the customer's name + id). Store seam: `zip`/`kind` on locations, `mobile` on
contacts, `zip`/`phone`/`website` on the record, all preserve-when-omitted; new `sites.kind` column
(migration 0023); one shared `toLocationInput` that keeps `locationName` (the #96 review
follow-up). Files: `src/app/(app)/import/{types,parse,link,registry,actions,page,controls}.ts(x)`,
`src/lib/stores/customers.ts`, `src/db/schema.ts` + `drizzle/0023_sites_kind.sql`,
`src/app/(app)/companies/{types,lib,actions}.ts` + `[id]/page.tsx`, `quotes/new/actions.ts`,
`inbox/link-actions.ts`. Tests: `test:specs` (#137 T2/T3), `test:review:regressions` (#137
T1/T4/T5/T6), `test:smoke` (hub + export routes). Decisions: D159.
```

- [ ] **Step 5: Verify** — `npx tsc --noEmit -p . | tail -3` → empty; `npx tsx scripts/test-review-and-spec.ts | grep -E 'FAIL|ALL PASSED'` → `ALL PASSED`; `npm run test:review:regressions 2>&1 | tail -2` → passed; `npx eslint scripts/smoke-routes.ts`. Do **not** run `test:smoke` — report to the controller that the routes were added.

- [ ] **Step 6: Commit**

```bash
git add scripts/smoke-routes.ts DECISIONS.md PUNCHLIST.md
git commit -m "docs(punchlist): #137 done — D159 import link-back defaults; #82/#83 closed; smoke routes for the hub + CSV exports

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Self-review

**1. Spec coverage — each spec section → task**

| Spec | Where |
|---|---|
| §1 `CustomerLocation.zip` / `CustomerRecordInput.zip`, `writeRecord()` writes both | Task 1 (types, `normalizeRecord`, `composeLocation`/`composeDoc`, `writeRecord` writes `sites.zip` + `companies.zip`) |
| §1 `toLocationInput` keeps `locationName` (#96 follow-up) | Task 2 (`companies/lib.ts` shared converter; quotes/new + inbox switch to it) |
| §1 `category` → existing `type`, free values as-is | Task 3 (`type` field header "Category", alias `Type`), Task 4 (`customerRecordFor` writes `str(v.type)`) |
| §1 `findCustomerByName` / `findCustomerById` | Task 1 |
| §2 customers columns, embedded columns removed from template but accepted as aliases, match by Customer ID else name, dedupe label unchanged | Task 3 (fields + `hidden`), Task 4 (`find`, `columnsOf`) |
| §2 contacts columns, writer (resolve → upsert by email else name; primary demotes), dedupe key | Task 3 (fields, `mergeContact`, `matchContact`, `parseYesNo`), Task 5 (writer) |
| §2 venues columns, `CustomerLocation.kind` persisted, upsert by (customer, venue name), zip via the new plumbing | Task 1 (`sites.kind` + seam), Task 3 (fields, `mergeLocation`, `matchLocation`), Task 6 (writer) |
| §2 link-back with auto-create; cache reuse within a file; preview "will create N customers"; result banner created vs linked; rows with neither fail validation | Task 3 (`resolveCustomerForRow`, `previewLinks`, `requiredUnless`), Task 5 (`linkCustomer`), Task 4 (`LinkStats`), Task 7 (UI) |
| §2 exports: contacts + venues rows with customer name + id; customers gains Category + Zip | Tasks 4, 5, 6 (`exportObjects`), `export/route.ts` needs no change (`getTypeMeta` + `exportCsv` already generic) |
| §3 UI: three cards, preview "Customer" column linked / will create, nothing else changes | cards come from `IMPORT_TYPES` (Task 3); column + create list + counts (Task 7) |
| §4 `test:specs`: alias resolution ×3, resolve order + cache reuse, yes/no, zip normalization | Task 3 tests (+ Task 2 for the converters) |
| §4 `test:review:regressions`: zip + category persist; contacts link by name and by id, demote, idempotent; venues zip + link; unmatched creates exactly one customer for several rows; export round-trips | Tasks 1, 4, 5, 6 tests |
| §4 `test:smoke`: `/import`, `?type=contacts`, `?type=venues`, export URLs | Task 8 |
| §4 browser pass (customer record shows venues with zips) | Task 2 (zip on the venue address line, category pill); the controller performs the pass |
| Out of scope (typo-merge, custom fields, people UI) | untouched |

**2. Placeholder scan** — no "TBD", "TODO", "similar to", "add validation" or "handle edge cases" anywhere; every step shows the full code. The only "generated" artefact (`drizzle/meta/0023_snapshot.json`) is produced by the exact node script in Task 1.

**3. Type/name consistency across tasks**
- `CustomerRef` / `resolveCustomerForRow` / `previewLinks` / `RowLink` are defined in Task 3 `link.ts` and consumed by Tasks 4-7 with the same signatures.
- `LinkStats = { customersCreated; customersLinked; createdIds: Set<string> }` (Task 4); `commitImport` builds one per commit, passes it to every writer call and copies the two counters into `ImportResult` at the end; Task 5's `linkCustomer` adds to `createdIds` on create and both Task 5/6 `update` paths consult it, so the T5/T6 assertions of `customersLinked === 2` hold (the second row for a just-created customer counts as neither).
- `Writer.create(values, cache, link)` / `update(existing, values, cache, link)` (Task 4) — existing writers keep their two-argument lambdas (fewer parameters remain assignable); Task 4's `customers.update` takes `(ex, v, cache)`, Tasks 5/6 take all four.
- `recordInputOf`, `refreshCache`, `customerRecordFor` (Task 4), `linkCustomer`, `writeContactRow` (Task 5), `writeVenueRow` (Task 6) are module-private in `registry.ts`; each is defined before use in the task order and is referenced only after its own task, so no task leaves an unused function behind for eslint.
- `mergeLocation`'s third argument is the new location's id string and its fourth is `MergeLocationOpts { preferPrimary; venueKind? }` — Task 4 passes `{ preferPrimary: true, venueKind: baseVenueKind(type, name) ?? "proscenium" }`, Task 6 passes `{ preferPrimary: false }`, and the Task 3 tests use the same shapes.
- `CustomerContact.mobile`, `CustomerLocation.zip/kind`, `CustomerDoc.zip/phone/website` (Task 1) are the fields `toContactInput`/`toLocationInput` (Task 2), `mergeContact`/`mergeLocation` (Task 3) and the exports (Tasks 4-6) read; `ContactInput.mobile?` / `LocationInput.zip?/kind?` (Task 2) are what `saveCustomerAction` forwards.
- Field keys used by the writers (`customerId`, `customer`, `customerType`, `name`, `email`, `phone`, `mobile`, `title`, `role`, `primary`, `venue`, `address`, `city`, `state`, `zip`, `kind`, `website`, `type`, `contactName`) all exist on the Task 3 templates; the regression CSV headers map to them through the aliases the Task 3 spec tests assert.
- The `r=` parameter has 7 parts (Task 7 `actions.ts`) and `parseResult` accepts 5 or more, so older links still render.
