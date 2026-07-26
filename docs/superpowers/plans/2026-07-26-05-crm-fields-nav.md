# CRM Plan 05 — Customer Custom Fields + Mine/All Nav Scoping Implementation Plan (#23/#22)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the two remaining wave-① items. **#23:** customer records get **admin-defined custom fields** (typed definitions in settings, per-venue-type applicability, values in a new `companies.custom` jsonb column), plus the long-stored-but-never-surfaced **lifecycle** and **keywords** finally get an authoring UI (edit-modal "Details" section) and display (customer page pills/chips + a Details card), plus the **"New (7d)"** added-last-7-days view on the Companies list. **#22:** Mine/All scoping lands on **Leads** (`?who=`, the quotes idiom, strict owner match) and **Projects** (`?who=` threaded through every href), the leads **"closed" segment splits into "Won" and "Lost"**, and the nav gains **My Quotes / My Leads / My Projects** children — turning the three already-working `?who=mine` views into one-click destinations. Spec authority: `docs/superpowers/specs/2026-07-25-remaining-items-decisions-design.md` §3 (#23 "custom fields get built… decided without waiting for the export audit"; #22 "Mine/All scoped nav entries first… split won from lost… per-person saved views deferred").

**Architecture:** The custom-field system copies the **catalogCategoryMap tier-3 precedent** end to end: typed entries in an optional `AppSettingsData` key (`customerFieldDefs`, FULL-REPLACEMENT semantics), a pure resolve helper (`resolveFieldDefs(stored) = stored ?? []`, no code defaults), an admin-gated whole-value save action that validates server-side and throws (the TaxonomyCard inline-error idiom), and a dedicated client editor card (Settings → Admin). All field logic is **pure and spec-covered** in `src/lib/customer-fields.ts` (ZERO imports of any kind — slugify/defsForType/validate). Values ride a new `custom` jsonb column on the **relational** companies table (drizzle migration **0011** — no doc-collection changes at all this plan; the sync allowlists are untouched by construction). The customers store gains **WRITE-WHEN-PROVIDED / PRESERVE-WHEN-UNDEFINED** plumbing for `lifecycle`/`keywords`/`custom`: the three become CustomerDoc content fields (inside `contentKey`, so a custom-only edit registers as a change and isn't dropped by the early-return), while every pre-existing writer (lead convert, CSV importer, seed) passes none of them and behaves byte-identically. Mine/All scoping **mirrors `/quotes?who=` exactly** (canonicalize against me, strip-default, server-prebuilt hrefs into the now-shared `OwnerSelect`); leads counts are re-derived locally over the scoped array because `metrics()` has no owner opt. Nav children are plain `NavChild` rows — `href` renders verbatim into `Link`, so querystrings just work; `activeKeyFor` stays pathname-only (known cosmetic limitation, logged).

**Tech Stack:** Next.js 16 (App Router, server actions), Drizzle + PGlite/Postgres (relational identity core + jsonb doc-store), hand-rolled `tsx` test harness.

## Global Constraints

- **Branch:** `crm-05-fields-nav` off `main` (plans 01–04 merged at `ef68059`).
- **Relational-write idiom:** the identity core (companies/sites/contacts) is server-authoritative — writes only through `requireUser()`-checked server actions → `CustomerStore.upsert` → `writeRecord` → `saveCompany`. `SYNCABLE_COLLECTIONS` / `FIELD_COLLECTIONS` are untouched (this plan adds **no doc-collection**); the sync mirror never sees companies.
- **Migration discipline:** `npm run db:generate` emits drizzle **0011** for the `companies.custom` column. Dev PGlite applies migrations **on boot** — the dev server MUST be restarted after generate, BEFORE any live write that saves a custom value (Task 2 Step 4). Prod applies at build via `scripts/migrate.mjs` (`npm run build` runs it).
- **Settings idiom:** `setSettings` is a SHALLOW top-level merge — nested values are written whole. `customerFieldDefs` is a FULL-REPLACEMENT key (the wireTypes precedent, NOT the per-key catalogCategoryMap merge): `resolveFieldDefs(stored) = stored ?? []`, there are no code defaults. Per-writer size caps are mandatory (30 defs, label ≤60, ≤20 options ≤40 chars, text values ≤500). `getSettingsPatch` swallows errors → readers tolerate `undefined`.
- **URL-as-state:** every new param is allowlisted and strip-default: `?who=` (absent = everyone; `mine` | teammate name — the quotes canonicalization), `?added=7d` (only value), leads `?seg=won|lost` (allowlist replaces `closed`; legacy `seg=closed` deep links fall through the allowlist to `"all"` — grep confirmed NO hardcoded `seg=closed` links exist anywhere in `src/`).
- **Client-bundle rule:** `"use client"` files may only `import type` from any module that reaches `src/db/doc-store.ts` or the db layer. `customer-fields.ts` and `lib/identity/config.ts` are dependency-free pure modules — VALUE imports from client files are safe and used deliberately (defsForType/LIFECYCLES in the edit modal). Client controls take VMs / server-prebuilt hrefs (the quotes/controls.tsx:6-11 contract).
- **Epoch-ms everywhere:** custom `date` values are epoch-ms numbers (local-midnight, converted at the `<input type="date">` boundary), `createdAt` comparisons are ms arithmetic.
- **Never run `npm run build` while a dev server is running** (PGlite is single-process; D106). The dev server on :3000 stays up (restarted once in Task 2 for migration 0011) for live checks in Tasks 2–5; Task 6 kills it before the build and restarts after.
- **Tests:** append `ok(cond, "msg")` assertions to `scripts/test-review-and-spec.ts` (single-file harness, **510 PASS baseline** — verified by running it). New sections insert immediately BEFORE the final two lines (`console.log(fail ? …)` / `process.exit(…)`). **TZ house rule** (the `queueDueLabel` comment, ~line 508): never assert locale/TZ-dependent literals from raw epoch numbers — build test timestamps from LOCAL Date parts. Exact-literal, no DB access (importing pure modules is free; `@/app/(app)/…` imports have precedent: `home-tabs-keys`, `settings-sections`). **NOTE:** Task 5's nav change also EDITS five existing exact-children assertions (EST/CRM/PM) — see Task 5 Step 1; the suite count goes UP, never down. Run: `npm run test:specs`. Typecheck: `npx tsc --noEmit`. Both gates per task. `npm run lint` baseline is **71 errors** (+ ~1618 warnings — verified by running it) — net-zero goal.
- **NOT in scope** (other waves/sessions): team calendar (spec §7), Learn→Knowledge fold (wave ④), per-person saved views (deferred by spec §3 #22), per-record permissions, referred-by as a person LINK (a custom text field covers it for now — noted in the PUNCHLIST close-out).

---

### Task 1: Pure `src/lib/customer-fields.ts` + `AppSettingsData.customerFieldDefs` + the #23 spec block (TDD)

**Files:**
- Create: `src/lib/customer-fields.ts`
- Modify: `src/lib/settings.ts` (one optional key on `AppSettingsData`)
- Test: `scripts/test-review-and-spec.ts` (append the `CUSTOMER FIELDS + MINE/ALL (#23/#22)` section)

**Interfaces:**
- Produces (later tasks rely on these exact names): `type CustomFieldDef`, `type FieldKind`, `type CustomFieldValues`, `FIELD_KINDS`, `MAX_FIELD_DEFS`, `resolveFieldDefs(stored)`, `slugifyFieldId(label, taken)`, `defsForType(defs, type)`, `validateFieldValues(defs, input)`, `validateFieldDefs(defs)`.

- [ ] **Step 1: Write the failing tests**

Append to `scripts/test-review-and-spec.ts`, immediately before the final two lines (`console.log(fail ? …)` / `process.exit(…)`):

```ts
/* ============ CUSTOMER FIELDS + MINE/ALL (#23/#22) ============ */
/* #23 — pure custom-field helpers. Dependency-free module, exact literals.
   The only timestamp is an epoch-ms passthrough built from LOCAL Date parts
   (TZ house rule, see the queueDueLabel note above). */
import {
  defsForType,
  resolveFieldDefs,
  slugifyFieldId,
  validateFieldDefs,
  validateFieldValues,
  type CustomFieldDef,
} from "@/lib/customer-fields";

{
  ok(
    resolveFieldDefs(undefined).length === 0 && resolveFieldDefs(null).length === 0,
    "#23: resolveFieldDefs(stored) = stored ?? [] — there are NO code defaults"
  );

  // slugifyFieldId — stable ids from labels, collision-suffixed
  ok(slugifyFieldId("Referred By", new Set()) === "referred-by", "#23: slug lowercases and dashes the label");
  ok(
    slugifyFieldId("Referred By", new Set(["referred-by"])) === "referred-by-2",
    "#23: a taken slug suffixes -2"
  );
  ok(
    slugifyFieldId("Referred By", new Set(["referred-by", "referred-by-2"])) === "referred-by-3",
    "#23: suffixes keep counting"
  );
  ok(slugifyFieldId("!!!", new Set()) === "field", "#23: an all-symbol label falls back to 'field'");

  const DEFS: CustomFieldDef[] = [
    { id: "referred-by", label: "Referred by", kind: "text", appliesTo: [] },
    { id: "annual-budget", label: "Annual budget", kind: "number", appliesTo: ["Education"] },
    { id: "last-inspection", label: "Last inspection", kind: "date", appliesTo: [] },
    { id: "region", label: "Region", kind: "select", options: ["North", "South"], appliesTo: [] },
    { id: "tax-exempt", label: "Tax exempt", kind: "checkbox", appliesTo: ["Education", "Worship"] },
  ];

  // defsForType — empty appliesTo means EVERY type
  ok(
    defsForType(DEFS, "Performing arts").map((d) => d.id).join(",") === "referred-by,last-inspection,region",
    "#23: empty appliesTo applies to every type; typed defs stay out"
  );
  ok(defsForType(DEFS, "Education").length === 5, "#23: a listed type gets its typed defs too");
  ok(
    defsForType(DEFS, "Worship").map((d) => d.id).join(",") === "referred-by,last-inspection,region,tax-exempt",
    "#23: appliesTo is a per-def allowlist, order preserved"
  );

  // validateFieldValues — kind-checked, unknown ids stripped, null clears
  const T = new Date(2026, 6, 20).getTime();
  const vals = validateFieldValues(DEFS, {
    "referred-by": "  Patrick Strain  ",
    "annual-budget": "125000",
    "last-inspection": T,
    region: "North",
    "tax-exempt": true,
    ghost: "dropped",
  });
  ok(vals["referred-by"] === "Patrick Strain", "#23: text values trim");
  ok(vals["annual-budget"] === 125000, "#23: numeric strings coerce to numbers");
  ok(vals["last-inspection"] === T, "#23: dates are epoch-ms numbers, passed through untouched");
  ok(vals["region"] === "North" && vals["tax-exempt"] === true, "#23: select/checkbox values pass when valid");
  ok(!("ghost" in vals), "#23: ids with no matching def are stripped");

  const bad = validateFieldValues(DEFS, {
    "annual-budget": "a lot",
    region: "West",
    "tax-exempt": "yes",
    "last-inspection": "2026-07-20",
    "referred-by": null,
  });
  ok(!("annual-budget" in bad), "#23: uncoercible numbers are dropped");
  ok(!("region" in bad), "#23: a select value outside options is dropped");
  ok(!("tax-exempt" in bad), "#23: non-boolean checkbox values are dropped");
  ok(!("last-inspection" in bad), "#23: ISO date strings are dropped — dates are epoch-ms ONLY");
  ok(bad["referred-by"] === null, "#23: null clears a value");
  ok(
    validateFieldValues(DEFS, { "referred-by": "   " })["referred-by"] === null,
    "#23: whitespace-only text clears like null"
  );

  // validateFieldDefs — dup ids, caps, select-without-options
  ok(validateFieldDefs(DEFS).ok === true, "#23: the sample defs validate");
  ok(
    validateFieldDefs([...DEFS, { id: "region", label: "Region 2", kind: "text", appliesTo: [] }]).ok === false,
    "#23: duplicate ids fail validation"
  );
  ok(
    validateFieldDefs([{ id: "s", label: "S", kind: "select", appliesTo: [] }]).ok === false,
    "#23: a select def with no options fails"
  );
  ok(
    validateFieldDefs(
      Array.from({ length: 31 }, (_, i) => ({ id: "f" + i, label: "F" + i, kind: "text" as const, appliesTo: [] }))
    ).ok === false,
    "#23: the 30-def cap holds"
  );
  ok(
    validateFieldDefs([{ id: "x", label: "x".repeat(61), kind: "text", appliesTo: [] }]).ok === false,
    "#23: labels cap at 60 chars"
  );
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:specs`
Expected: the run errors (module `@/lib/customer-fields` does not exist yet).

- [ ] **Step 3: Write the module + the settings key**

Create `src/lib/customer-fields.ts`:

```ts
/**
 * Customer custom fields (#23) — PURE definition + value helpers. ZERO
 * imports of any kind: this module is spec-tested, client-bundled (the edit
 * modal calls defsForType live) and server-trusted (the save actions call
 * the validators), so it must never reach a store, the db layer, or even a
 * value list that does.
 *
 * The system copies the catalogCategoryMap tier-3 precedent: definitions
 * live in AppSettingsData.customerFieldDefs (FULL REPLACEMENT on save —
 * resolveFieldDefs(stored) = stored ?? [], no code defaults), values live
 * per-company in the relational companies.custom jsonb column keyed by
 * CustomFieldDef.id. Ids are minted from the label at create time
 * (slugifyFieldId, server-side) and are IMMUTABLE after — they key stored
 * values, so renaming a label never re-keys data.
 *
 * appliesTo holds venue-type names (the CUSTOMER_TYPES vocabulary in
 * companies/lib.ts); [] means "all types". Deliberately NOT validated
 * against the type list here — value lists are configuration, not schema
 * (the identity/config.ts philosophy): an unknown type simply never
 * matches, harmlessly.
 */

export const FIELD_KINDS = ["text", "number", "date", "select", "checkbox"] as const;
export type FieldKind = (typeof FIELD_KINDS)[number];

export type CustomFieldDef = {
  /** Stable slug, minted from the label at create; immutable after. */
  id: string;
  label: string; // ≤ MAX_LABEL
  kind: FieldKind;
  /** select only: 1..MAX_OPTIONS entries, each ≤ MAX_OPTION_LEN. */
  options?: string[];
  /** Venue types this field shows for; [] = all types. */
  appliesTo: string[];
};

/** The value shape stored in companies.custom (date = epoch-ms number). */
export type CustomFieldValues = Record<string, string | number | boolean | null>;

export const MAX_FIELD_DEFS = 30;
export const MAX_LABEL = 60;
export const MAX_OPTIONS = 20;
export const MAX_OPTION_LEN = 40;
export const MAX_TEXT_LEN = 500;

/** stored ?? [] — there are no code defaults (the wireTypes idiom). */
export function resolveFieldDefs(
  stored: CustomFieldDef[] | null | undefined
): CustomFieldDef[] {
  return Array.isArray(stored) ? stored : [];
}

/** Mint a stable id from a label, suffixing past taken ids. */
export function slugifyFieldId(label: string, taken: Set<string> | string[]): string {
  const t = taken instanceof Set ? taken : new Set(taken);
  const base =
    (label || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "field";
  let id = base;
  let i = 2;
  while (t.has(id)) {
    id = `${base}-${i}`;
    i++;
  }
  return id;
}

/** The defs that apply to a venue type — empty appliesTo = all types. */
export function defsForType(defs: CustomFieldDef[], type: string): CustomFieldDef[] {
  return defs.filter((d) => !d.appliesTo?.length || d.appliesTo.includes(type));
}

/**
 * Server-side value gate (never trust the client): unknown ids stripped,
 * kind-checked per def — text trimmed (≤ MAX_TEXT_LEN; whitespace-only →
 * null), number coerced-or-dropped, date must be an epoch-ms number,
 * select must be one of the def's options, checkbox must be boolean.
 * null always clears.
 */
export function validateFieldValues(
  defs: CustomFieldDef[],
  input: Record<string, unknown> | null | undefined
): CustomFieldValues {
  const out: CustomFieldValues = {};
  if (!input || typeof input !== "object") return out;
  for (const d of defs) {
    if (!(d.id in input)) continue;
    const v = (input as Record<string, unknown>)[d.id];
    if (v === null) {
      out[d.id] = null;
      continue;
    }
    switch (d.kind) {
      case "text": {
        if (typeof v === "string") out[d.id] = v.trim().slice(0, MAX_TEXT_LEN) || null;
        break;
      }
      case "number": {
        const n =
          typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
        if (Number.isFinite(n)) out[d.id] = n;
        break;
      }
      case "date": {
        if (typeof v === "number" && Number.isFinite(v)) out[d.id] = v;
        break;
      }
      case "select": {
        if (typeof v === "string" && (d.options ?? []).includes(v)) out[d.id] = v;
        break;
      }
      case "checkbox": {
        if (typeof v === "boolean") out[d.id] = v;
        break;
      }
    }
  }
  return out;
}

/** Whole-list validation for the admin save — first failure wins. */
export function validateFieldDefs(
  defs: CustomFieldDef[]
): { ok: true } | { ok: false; error: string } {
  if (defs.length > MAX_FIELD_DEFS)
    return { ok: false, error: `At most ${MAX_FIELD_DEFS} custom fields.` };
  const seen = new Set<string>();
  for (const d of defs) {
    if (!d.id || !/^[a-z0-9-]+$/.test(d.id))
      return { ok: false, error: `"${d.label || d.id}" has an invalid id.` };
    if (seen.has(d.id)) return { ok: false, error: `Duplicate field id "${d.id}".` };
    seen.add(d.id);
    if (!(d.label || "").trim()) return { ok: false, error: `Field "${d.id}" needs a label.` };
    if (d.label.length > MAX_LABEL)
      return { ok: false, error: `"${d.label.slice(0, 20)}…" — labels cap at ${MAX_LABEL} chars.` };
    if (!(FIELD_KINDS as readonly string[]).includes(d.kind))
      return { ok: false, error: `"${d.label}" has an unknown kind.` };
    if (d.kind === "select") {
      const opts = d.options ?? [];
      if (!opts.length)
        return { ok: false, error: `"${d.label}" is a dropdown but has no options.` };
      if (opts.length > MAX_OPTIONS)
        return { ok: false, error: `"${d.label}" — at most ${MAX_OPTIONS} options.` };
      for (const o of opts)
        if (!o.trim() || o.length > MAX_OPTION_LEN)
          return { ok: false, error: `"${d.label}" has an empty or over-${MAX_OPTION_LEN}-char option.` };
    }
  }
  return { ok: true };
}
```

In `src/lib/settings.ts`, add to `AppSettingsData` directly after the `wireTypes?:` entry (before the closing `};`):

```ts
  /** Customer custom-field DEFINITIONS (#23) — FULL REPLACEMENT on save
   *  (the wireTypes idiom, never a per-key merge): resolveFieldDefs in
   *  lib/customer-fields resolves `stored ?? []` and there are NO code
   *  defaults. ≤30 defs; edited in Settings → Admin → Customer fields.
   *  VALUES live per-company in the relational companies.custom column,
   *  keyed by CustomFieldDef.id. */
  customerFieldDefs?: import("@/lib/customer-fields").CustomFieldDef[];
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:specs` — all new `#23:` lines PASS; suite ends `ALL PASSED`.
Run: `npx tsc --noEmit` — clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/customer-fields.ts src/lib/settings.ts scripts/test-review-and-spec.ts
git commit -m "feat: pure customer-field defs module + customerFieldDefs settings key, spec-covered (#23)"
```

---

### Task 2: `companies.custom` migration 0011 + customers-store plumbing (write-when-provided)

**Files:**
- Modify: `src/db/schema.ts` (one column on `companies`)
- Generate: `drizzle/0011_*.sql` (+ `drizzle/meta` journal) via `npm run db:generate`
- Modify: `src/lib/stores/customers.ts` (CustomerDoc/CustomerRecordInput/normalizeRecord/composeDoc/contentKey/writeRecord/companyFacts)

**Interfaces:**
- Produces: `CustomerDoc.lifecycle?/keywords?/custom?` (composed on every read), `CustomerRecordInput.lifecycle?/keywords?/custom?` (write-when-provided), `companyFacts()` value gains `lifecycle`.
- Behavior contract (self-review anchors): **contentKey participation** — the three new fields are content fields, so a lifecycle/keywords/custom-only edit is NOT dropped by the early-return at writeRecord's top; **legacy-writer safety** — `leads.convert()` (customers.upsert via `src/lib/stores/leads.ts:692`), the CSV importer (`import/registry.ts:76/:104`), `setDirectory`/seed and `saveCustomerAction` (until Task 4) all pass NONE of the new fields → values preserved AND no spurious `updatedAt` advance (the D83 no-change early-return still fires). NOTE: `src/lib/identity/convert.ts` (the D85 one-time bootstrap) does NOT go through `upsert()` at all — it writes `saveCompany` directly with its own lifecycle heuristic and is untouched; the insert takes the column default and its `onConflictDoUpdate` set spreads only its own row fields, so `custom` is never clobbered.

- [ ] **Step 1: The schema column**

In `src/db/schema.ts`, in the `companies` table, directly after the `referredByContactId` line (`referredByContactId: text("referred_by_contact_id"),`), add:

```ts
    /** #23 custom-field VALUES, keyed by CustomFieldDef.id (definitions live
     *  in AppSettingsData.customerFieldDefs). Whole-map replacement when a
     *  writer provides it; string | number (epoch-ms for dates) | boolean |
     *  null per value. */
    custom: jsonb("custom")
      .$type<Record<string, string | number | boolean | null>>()
      .notNull()
      .default({}),
```

- [ ] **Step 2: Generate migration 0011**

```bash
npm run db:generate
```

Expected: drizzle-kit emits `drizzle/0011_<name>.sql` containing exactly one statement — `ALTER TABLE "companies" ADD COLUMN "custom" jsonb DEFAULT '{}'::jsonb NOT NULL;` (default backfills every existing row). Inspect the SQL to confirm nothing else changed.

- [ ] **Step 3: Store plumbing — `src/lib/stores/customers.ts`**

Five anchored edits:

**(a) `CustomerDoc` (:93-115)** — after the `pricingTier?: string;` member (before the closing `};`), add:

```ts
  /**
   * #23 — lifecycle stage, keyword tags and custom-field values, composed
   * straight off the relational company row. CONTENT fields (inside
   * contentKey — see its #23 note), so an edit to any of them registers as
   * a change; write-when-provided / preserve-when-undefined on the way in
   * (see writeRecord).
   */
  lifecycle?: string;
  keywords?: string[];
  custom?: Record<string, string | number | boolean | null>;
```

(`META_KEYS` at :118 stays exactly `["createdAt", "updatedAt"]` — the new fields are content, not metadata.)

**(b) `CustomerRecordInput` (:143-152)** — after `pricingTier?: string | null;`, add:

```ts
  /** #23 — optional; undefined = preserve what's stored (legacy writers —
   *  lead convert, the CSV importer, seed — pass none of these). */
  lifecycle?: string;
  keywords?: string[];
  custom?: Record<string, string | number | boolean | null>;
```

**(c) `normalizeRecord` (:174-218)** — directly after the `if (tier) doc.pricingTier = tier;` line (before `return doc;`), add:

```ts
  // #23 — carry the Details fields through ONLY when the caller provided
  // them (write-when-provided; validation happened in the server action).
  if (c.lifecycle !== undefined) doc.lifecycle = c.lifecycle;
  if (c.keywords !== undefined) doc.keywords = c.keywords;
  if (c.custom !== undefined) doc.custom = c.custom;
```

**(d) `composeDoc` (:266-295)** — directly after the `if (co.pricingTier) doc.pricingTier = co.pricingTier;` line (before `return doc;`), add:

```ts
  // #23 — always composed (the columns are notNull with defaults).
  doc.lifecycle = co.lifecycle || "none";
  doc.keywords = Array.isArray(co.keywords) ? co.keywords : [];
  doc.custom = co.custom ?? {};
  return doc;
```

…and delete the old trailing `return doc;` it replaces (net: the three assignments slot in before the existing return).

**(e) `contentKey` (:402-406)** — replace the whole function:

```ts
function contentKey(d: CustomerDoc): string {
  const rest: Partial<CustomerDoc> = { ...d };
  for (const k of META_KEYS) delete rest[k];
  // #23: give the three new content fields a CANONICAL serialization slot.
  // The composed side (composeDoc) always sets them; the normalized side
  // (normalizeRecord) sets only what the caller provided and writeRecord
  // backfills the rest — so JSON key INSERTION ORDER could differ between
  // the two sides of the D83 no-change comparison, and custom's key order
  // additionally survives a jsonb round-trip differently than an object
  // literal. Pin position, defaults and sorted custom keys so equality
  // means equality.
  delete rest.lifecycle;
  delete rest.keywords;
  delete rest.custom;
  rest.lifecycle = d.lifecycle ?? "none";
  rest.keywords = d.keywords ?? [];
  rest.custom = Object.fromEntries(
    Object.entries(d.custom ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  );
  return JSON.stringify(rest);
}
```

**(f) `writeRecord` (:422-450)** — two edits. First, between the `const existingCo = await getCompany(rec.id);` line and the D83 early-return comment, insert:

```ts
  // #23 WRITE-WHEN-PROVIDED / PRESERVE-WHEN-UNDEFINED, resolved BEFORE the
  // change check: callers that predate the Details fields (lead convert,
  // the CSV importer, seed/setDirectory) pass none of them — backfilling
  // from the existing row here means those writers neither clear values nor
  // advance updatedAt spuriously (the no-change early-return still fires),
  // while a Details-only edit from the modal compares different and writes.
  if (rec.lifecycle === undefined) rec.lifecycle = existingCo?.lifecycle ?? "none";
  if (rec.keywords === undefined) rec.keywords = existingCo?.keywords ?? [];
  if (rec.custom === undefined) rec.custom = existingCo?.custom ?? {};
```

Second, in the `saveCompany({ … })` call, replace the two hard-preserve lines

```ts
    lifecycle: existingCo?.lifecycle ?? "none",
    keywords: existingCo?.keywords ?? [],
```

with

```ts
    lifecycle: rec.lifecycle ?? "none",
    keywords: rec.keywords ?? [],
    custom: rec.custom ?? {},
```

(The `website`/`mainPhone`/`address`/`city`/`state`/`zip`/`referredByContactId` hard-preserve lines and the sites/contacts full-replace blocks below are NOT touched.)

**(g) `companyFacts` (:726-734)** — replace the function (and extend its doc comment's first line to mention lifecycle):

```ts
export async function companyFacts(): Promise<
  Map<string, { type: string; keywords: string[]; lifecycle: string }>
> {
  const rows = await allCompanies();
  return new Map(
    rows.map((c) => [
      c.id,
      {
        type: c.type || "",
        keywords: Array.isArray(c.keywords) ? c.keywords : [],
        lifecycle: c.lifecycle || "none",
      },
    ])
  );
}
```

(The opportunities board's `CompanyFacts` type in `src/lib/opportunities.ts:219` is `Map<string, { type; keywords }>` — the widened value is structurally assignable; the board doesn't consume `lifecycle` yet, harmless by design.)

- [ ] **Step 4: Restart the dev server (PGlite migrates on boot)**

```bash
lsof -ti tcp:3000 | xargs -r kill
npm run dev
```

(Background it / new terminal. This MUST happen before any live check that writes a custom value — dev PGlite only applies 0011 at boot.)

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit` — clean.
Run: `npm run test:specs` — `ALL PASSED` (no new specs — writeRecord is store glue over live tables; its pure inputs were spec'd in Task 1, and the no-DB rule keeps writeRecord itself out of the harness).
Live sanity: open `/companies/<any>` → page renders (composeDoc now emits the three fields); save an unrelated edit in the modal → succeeds (write path compiles through the backfill).

- [ ] **Step 6: Commit**

```bash
git add src/db/schema.ts drizzle src/lib/stores/customers.ts
git commit -m "feat: companies.custom column (migration 0011) + write-when-provided lifecycle/keywords/custom plumbing (#23)"
```

---

### Task 3: `saveCustomerFieldDefsAction` + Settings → Admin "Customer fields" card

**Files:**
- Modify: `src/app/(app)/settings/actions.ts` (new action)
- Create: `src/app/(app)/settings/customer-fields-card.tsx` (client editor)
- Modify: `src/app/(app)/settings/settings-client.tsx` (prop + render in the Admin section)
- Modify: `src/app/(app)/settings/page.tsx` (pass resolved defs)

**Interfaces:**
- Consumes: Task 1's `slugifyFieldId`/`validateFieldDefs`/`resolveFieldDefs`, `requirePerm("manage_users")`, `setSettings`.
- Produces: `saveCustomerFieldDefsAction(input)` (throws on invalid — the TaxonomyCard idiom), `CustomerFieldsCard`.

- [ ] **Step 1: The action**

In `src/app/(app)/settings/actions.ts`, add to the imports:

```ts
import {
  slugifyFieldId,
  validateFieldDefs,
  type CustomFieldDef,
} from "@/lib/customer-fields";
```

and append at the end of the file:

```ts
/* ---- customer custom fields (#23) ---- */

export type CustomerFieldDefInput = {
  /** absent on a freshly-added row — the id is minted here, from the label,
   *  and is immutable after (it keys stored values on companies.custom). */
  id?: string;
  label: string;
  kind: string;
  options?: string[];
  appliesTo?: string[];
};

/**
 * #23 — whole-list replacement (the wireTypes idiom; setSettings is a
 * shallow top-level merge, so the array is written whole). Admin-gated;
 * validates server-side and THROWS on bad input — the TaxonomyCard
 * inline-error idiom (the card catches and displays the message).
 */
export async function saveCustomerFieldDefsAction(
  input: CustomerFieldDefInput[]
): Promise<void> {
  await requirePerm("manage_users");
  const rows = (Array.isArray(input) ? input : []).filter(
    (r) => (r.label || "").trim() || (r.id || "").trim()
  );
  const taken = new Set(rows.map((r) => (r.id || "").trim()).filter(Boolean));
  const defs: CustomFieldDef[] = rows.map((r) => {
    const label = (r.label || "").trim();
    let id = (r.id || "").trim();
    if (!id) {
      id = slugifyFieldId(label, taken);
      taken.add(id);
    }
    return {
      id,
      label,
      kind: r.kind as CustomFieldDef["kind"],
      ...(r.kind === "select"
        ? { options: (r.options ?? []).map((o) => o.trim()).filter(Boolean) }
        : {}),
      appliesTo: (r.appliesTo ?? []).filter(Boolean),
    };
  });
  const res = validateFieldDefs(defs);
  if (!res.ok) throw new Error(res.error);
  await setSettings({ customerFieldDefs: defs });
  revalidatePath("/", "layout");
}
```

- [ ] **Step 2: The card**

Create `src/app/(app)/settings/customer-fields-card.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  FIELD_KINDS,
  MAX_FIELD_DEFS,
  type CustomFieldDef,
  type FieldKind,
} from "@/lib/customer-fields";
import { CUSTOMER_TYPES } from "../companies/lib";
import { saveCustomerFieldDefsAction } from "./actions";

/**
 * Admin "Customer fields" editor (#23) — the TaxonomyCard idiom: seeded from
 * the server-resolved defs, whole-list save, server validates + throws →
 * inline error here. Rows are sorted ONCE on mount (the TaxonomyCard
 * no-resort rule — no live re-sort under the cursor). Ids are minted
 * server-side from the label on FIRST save and shown read-only after; the
 * parent keys this card by the saved id set, so a save-then-refresh remounts
 * it with the minted ids in place (a second save can never re-mint).
 */

const KIND_LABEL: Record<FieldKind, string> = {
  text: "Text",
  number: "Number",
  date: "Date",
  select: "Dropdown",
  checkbox: "Checkbox",
};

type Row = {
  id: string; // "" until first save
  label: string;
  kind: FieldKind;
  optionsText: string; // dropdown only, one option per line
  appliesTo: string[];
};

const rowOf = (d: CustomFieldDef): Row => ({
  id: d.id,
  label: d.label,
  kind: d.kind,
  optionsText: (d.options ?? []).join("\n"),
  appliesTo: d.appliesTo ?? [],
});

const inS: React.CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 12.5,
  color: "#16181d",
  border: "1px solid #e4e7ec",
  borderRadius: 8,
  padding: "7px 10px",
  background: "#fff",
  outline: "none",
  width: "100%",
};

export function CustomerFieldsCard({ defs }: { defs: CustomFieldDef[] }) {
  const router = useRouter();
  const seed = () => defs.slice().sort((a, b) => a.label.localeCompare(b.label)).map(rowOf);
  const [saved, setSaved] = useState<Row[]>(seed);
  const [rows, setRows] = useState<Row[]>(seed);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  const dirty = JSON.stringify(rows) !== JSON.stringify(saved);

  const patch = (i: number, p: Partial<Row>) => {
    setJustSaved(false);
    setError(null);
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...p } : r)));
  };
  const toggleType = (i: number, t: string) =>
    patch(i, {
      appliesTo: rows[i].appliesTo.includes(t)
        ? rows[i].appliesTo.filter((x) => x !== t)
        : [...rows[i].appliesTo, t],
    });
  const addRow = () => {
    setJustSaved(false);
    setRows((rs) => [...rs, { id: "", label: "", kind: "text", optionsText: "", appliesTo: [] }]);
  };
  const removeRow = (i: number) => {
    setJustSaved(false);
    setRows((rs) => rs.filter((_, idx) => idx !== i));
  };

  const onSave = () => {
    setError(null);
    startTransition(async () => {
      try {
        await saveCustomerFieldDefsAction(
          rows.map((r) => ({
            id: r.id || undefined,
            label: r.label,
            kind: r.kind,
            options:
              r.kind === "select"
                ? r.optionsText.split("\n").map((s) => s.trim()).filter(Boolean)
                : undefined,
            appliesTo: r.appliesTo,
          }))
        );
        setSaved(rows);
        setJustSaved(true);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Save failed — please try again.");
      }
    });
  };

  return (
    <div className="pk-card" style={{ overflow: "hidden", marginBottom: 18 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", rowGap: 10, padding: "14px 18px", borderBottom: "1px solid #ececf0" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <span style={{ fontSize: 14.5, fontWeight: 600 }}>Customer fields</span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 600, letterSpacing: ".06em", color: "#8a6d1f", background: "#fbf3dd", border: "1px solid #f0e2bd", padding: "3px 9px", borderRadius: 6 }}>
              ADMIN
            </span>
          </div>
          <div style={{ fontSize: 12, color: "#8c919c", marginTop: 4, lineHeight: 1.45 }}>
            Custom fields shown in the company edit form. Leave the venue types unchecked to show a field on every company.
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, fontWeight: 600, color: "#8c919c", background: "#f1f2f5", border: "1px solid #e4e7ec", padding: "4px 10px", borderRadius: 20, whiteSpace: "nowrap" }}>
            {rows.length} of {MAX_FIELD_DEFS}
          </span>
          <button
            type="button"
            disabled={!dirty || pending}
            onClick={onSave}
            style={{ fontSize: 13, fontWeight: 600, border: "none", borderRadius: 9, padding: "9px 16px", cursor: dirty && !pending ? "pointer" : "not-allowed", color: dirty && !pending ? "#fff" : "#aab0bb", background: dirty && !pending ? "var(--accent)" : "#eef0f3", whiteSpace: "nowrap" }}
          >
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ margin: "12px 18px 0", fontSize: 12, color: "#b4543a", background: "#f9ece8", border: "1px solid #f0d6cd", borderRadius: 8, padding: "9px 12px" }}>
          {error}
        </div>
      )}
      {justSaved && !dirty && (
        <div style={{ margin: "12px 18px 0", fontSize: 11.5, color: "#1f7a52", fontWeight: 600 }}>✓ Saved</div>
      )}

      <div style={{ padding: "12px 18px 16px" }}>
        {rows.map((r, i) => (
          <div key={r.id || "new-" + i} style={{ border: "1px solid #eef0f3", borderRadius: 10, padding: 12, marginBottom: 10, background: "#fafbfc" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 9 }}>
              <input
                value={r.label}
                onChange={(e) => patch(i, { label: e.target.value })}
                placeholder="Field label (e.g. Referred by)"
                style={{ ...inS, flex: 1, minWidth: 0, fontWeight: 600 }}
              />
              <select
                value={r.kind}
                onChange={(e) => patch(i, { kind: e.target.value as FieldKind })}
                disabled={!!r.id}
                title={r.id ? "The kind is fixed once a field has stored values." : undefined}
                style={{ ...inS, width: 122, cursor: r.id ? "not-allowed" : "pointer", background: r.id ? "#f1f2f5" : "#fff" }}
              >
                {FIELD_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABEL[k]}
                  </option>
                ))}
              </select>
              <button
                onClick={() => removeRow(i)}
                title="Remove field (stored values for it stop rendering)"
                style={{ width: 30, height: 30, border: "1px solid #e4e7ec", background: "#fff", borderRadius: 8, color: "#c4c9d2", fontSize: 15, cursor: "pointer", flexShrink: 0 }}
              >
                ×
              </button>
            </div>
            {r.kind === "select" && (
              <textarea
                value={r.optionsText}
                onChange={(e) => patch(i, { optionsText: e.target.value })}
                placeholder={"One option per line"}
                rows={3}
                style={{ ...inS, resize: "vertical", marginBottom: 9, fontFamily: "var(--font-mono)", fontSize: 12 }}
              />
            )}
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              {CUSTOMER_TYPES.map((t) => (
                <label key={t} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11.5, color: "#5b616e", cursor: "pointer" }}>
                  <input type="checkbox" checked={r.appliesTo.includes(t)} onChange={() => toggleType(i, t)} />
                  {t}
                </label>
              ))}
              <span style={{ marginLeft: "auto", fontFamily: "var(--font-mono)", fontSize: 10.5, color: "#aab0bb" }}>
                {r.id || "id auto on save"}
              </span>
            </div>
          </div>
        ))}
        {rows.length === 0 && (
          <div style={{ padding: "18px 0 8px", textAlign: "center", color: "#9aa0ab", fontSize: 12.5 }}>
            No custom fields yet.
          </div>
        )}
        <button
          onClick={addRow}
          disabled={rows.length >= MAX_FIELD_DEFS}
          style={{ fontSize: 12.5, fontWeight: 600, color: "var(--accent)", background: "transparent", border: "none", cursor: "pointer", padding: 0 }}
        >
          + Add field
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Wire it into Settings**

In `src/app/(app)/settings/page.tsx`:

1. Add `import { resolveFieldDefs } from "@/lib/customer-fields";` to the imports.
2. In the `<SettingsClient …>` element, after the `consultingPhases={…}` prop, add:

```tsx
          customerFieldDefs={resolveFieldDefs(settings.customerFieldDefs)}
```

In `src/app/(app)/settings/settings-client.tsx`:

1. Add to the imports:

```ts
import type { CustomFieldDef } from "@/lib/customer-fields";
import { CustomerFieldsCard } from "./customer-fields-card";
```

2. In the component's destructured props add `customerFieldDefs,` (after `consultingPhases,`), and in the props type add `customerFieldDefs: CustomFieldDef[];` (after `consultingPhases: string[];`).
3. In the `{section === "admin" && ( <section …>…</section> )}` block, wrap the existing `<section>` in a fragment and mount the card after it — keyed by the saved id set so a post-save refresh remounts with minted ids:

```tsx
      {section === "admin" && (
        <>
          <section className="pk-card" style={{ padding: "17px 18px", marginBottom: 20 }}>
            {/* …existing Admin links card, byte-identical… */}
          </section>
          <CustomerFieldsCard
            key={customerFieldDefs.map((d) => d.id).join("|")}
            defs={customerFieldDefs}
          />
        </>
      )}
```

(Only the wrapper fragment and the card mount are new — the `<section>` contents are not touched.)

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit` — clean. `npm run test:specs` — `ALL PASSED`.
Live check (dev server on :3000): Settings → Admin (as an admin) → "Customer fields" card renders; add "Referred by" (Text, no types) + "Region" (Dropdown, options North/South) → Save → ✓ Saved, ids `referred-by`/`region` appear read-only after the refresh-remount. Add a Dropdown with no options → Save → inline error from the server throw, nothing stored. Non-admin: Settings shows the lock screen (page-level), and a forged direct call redirects via `requirePerm`.

- [ ] **Step 5: Commit**

```bash
git add src/app/\(app\)/settings
git commit -m "feat: Settings admin Customer fields editor + whole-list save action (#23)"
```

---

### Task 4: Edit-modal Details section + save validation + customer-page display + "New (7d)"

**Files:**
- Modify: `src/app/(app)/companies/types.ts` (SaveCustomerInput)
- Modify: `src/app/(app)/companies/edit-modal.tsx` (Details section + fieldDefs prop)
- Modify: `src/app/(app)/companies/actions.ts` (saveCustomerAction validation)
- Modify: `src/app/(app)/companies/[id]/page.tsx` (pills/chips + Details card + fieldDefs into the modal)
- Modify: `src/app/(app)/companies/page.tsx` (+`?added=7d` + fieldDefs into the modal)
- Modify: `src/app/(app)/companies/controls.tsx` (FilterBar "New (7d)" chip)

**Interfaces:**
- Consumes: Task 1 helpers, Task 2 store fields, Task 3 defs; `LIFECYCLES`/`LIFECYCLE_LABEL` from `src/lib/identity/config.ts` (verified literals: `prospect|customer|past|none`, labels `Prospect/Customer/Past/—`; both exported and previously unused).
- Produces: `SaveCustomerInput.lifecycle?/keywords?/custom?`; `EditCustomerModal` prop `fieldDefs?: CustomFieldDef[]`; `FilterBar` props `added`/`addedCount`.

- [ ] **Step 1: `types.ts`**

After `pricingTier?: string | null;` in `SaveCustomerInput`, add:

```ts
  /** #23 Details section. lifecycle ∈ LIFECYCLES (unknown → server ignores
   *  the field); keywords trimmed/deduped/capped server-side; custom keyed
   *  by CustomFieldDef.id and re-validated server-side against the live
   *  defs. All optional — absent means preserve. */
  lifecycle?: string;
  keywords?: string[];
  custom?: Record<string, string | number | boolean | null>;
```

- [ ] **Step 2: `edit-modal.tsx` — the Details section**

1. Add imports (after the `./types` import):

```ts
import { defsForType, type CustomFieldDef } from "@/lib/customer-fields";
import { LIFECYCLES, LIFECYCLE_LABEL } from "@/lib/identity/config";
```

(Both modules are dependency-free pure value modules — client-bundle safe.)

2. Below the `newLoc` helper, add the date-input bridge (the lead-drawer idiom, but a generic date field stores **local midnight**, not the follow-up 9:00 convention):

```ts
/** #23 — <input type="date"> ⇄ epoch-ms bridge (local Date parts, TZ-safe).
 *  Generic date VALUES store local midnight (unlike the lead drawer's
 *  follow-up 9:00 convention — that is a scheduling default, this is data). */
function toDateInput(ts: number | null): string {
  if (!ts) return "";
  const d = new Date(ts);
  const p = (x: number) => String(x).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}
function fromDateInput(s: string): number | null {
  if (!s) return null;
  const p = s.split("-");
  if (p.length !== 3) return null;
  return new Date(+p[0], +p[1] - 1, +p[2]).getTime();
}
```

3. Extend the component signature — `fieldDefs` arrives serialized from the server page:

```tsx
export default function EditCustomerModal({
  mode,
  initial,
  closeHref,
  fieldDefs = [],
}: {
  mode: "new" | "edit";
  initial: SaveCustomerInput | null;
  closeHref: string;
  fieldDefs?: CustomFieldDef[];
}) {
```

4. After the `const [pricingTier, setPricingTier] = useState(…)` line, add the Details state:

```ts
  // #23 Details — lifecycle / keywords / custom values (client-local state,
  // no new deps; the server action re-validates everything).
  const [lifecycle, setLifecycle] = useState(initial?.lifecycle || "none");
  const [keywords, setKeywords] = useState<string[]>(initial?.keywords || []);
  const [kwDraft, setKwDraft] = useState("");
  const [custom, setCustom] = useState<Record<string, string | number | boolean | null>>(
    initial?.custom || {}
  );
```

5. After the `removeContact` helper, add:

```ts
  const addKeyword = () => {
    const k = kwDraft.trim();
    if (!k) return;
    setKeywords((ks) =>
      ks.some((x) => x.toLowerCase() === k.toLowerCase()) ? ks : [...ks, k]
    );
    setKwDraft("");
  };
  const removeKeyword = (k: string) => setKeywords((ks) => ks.filter((x) => x !== k));
  const setCustomVal = (id: string, v: string | number | boolean | null) =>
    setCustom((m) => ({ ...m, [id]: v }));
  // Re-derived every render, so switching the Type live-swaps which custom
  // fields show (values for hidden fields stay in state; the server strips
  // nothing — validateFieldValues keys off ALL defs, and display filters by
  // type at read time).
  const typeDefs = defsForType(fieldDefs, type);
```

6. In `save()`, add the three fields to the `saveCustomerAction({ … })` payload, after `pricingTier: pricingTier || null,`:

```ts
        lifecycle,
        keywords,
        custom,
```

7. Insert the Details section between the pricing-tier `</div>` and the `{/* locations */}` header block:

```tsx
          {/* ---- details (#23): lifecycle · keywords · custom fields ---- */}
          <div style={{ margin: "22px 0 9px" }}>
            <span style={{ ...microLbl, marginBottom: 0 }}>Details</span>
          </div>
          <div style={cardStyle}>
            <label style={{ ...microLbl, fontSize: 9.5, marginBottom: 5 }}>Lifecycle</label>
            <select
              className="cu-m-in"
              value={lifecycle}
              onChange={(e) => setLifecycle(e.target.value)}
              style={{ ...selStyle, fontSize: 12.5, padding: "8px 10px", borderRadius: 8, marginBottom: 10 }}
            >
              {LIFECYCLES.map((l) => (
                <option key={l} value={l}>
                  {l === "none" ? "— None —" : LIFECYCLE_LABEL[l]}
                </option>
              ))}
            </select>

            <label style={{ ...microLbl, fontSize: 9.5, marginBottom: 5 }}>Keywords</label>
            {keywords.length > 0 && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                {keywords.map((k) => (
                  <span
                    key={k}
                    style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, fontWeight: 600, color: ACCENT_INK, background: ACCENT_SOFT, padding: "3px 9px", borderRadius: 20 }}
                  >
                    {k}
                    <button
                      onClick={() => removeKeyword(k)}
                      title="Remove keyword"
                      style={{ border: "none", background: "transparent", color: "inherit", cursor: "pointer", fontSize: 12, lineHeight: 1, padding: 0 }}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div style={{ display: "flex", gap: 8, marginBottom: 4 }}>
              <input
                className="cu-m-in"
                value={kwDraft}
                onChange={(e) => setKwDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addKeyword();
                  }
                }}
                placeholder="Add a keyword (e.g. Non-profit)"
                style={{ ...inStyle, flex: 1, minWidth: 0, fontSize: 12.5, padding: "8px 11px", borderRadius: 8 }}
              />
              <button
                onClick={addKeyword}
                style={{ fontSize: 12, fontWeight: 600, color: ACCENT_INK, background: ACCENT_SOFT, border: "none", borderRadius: 8, padding: "8px 13px", cursor: "pointer", flexShrink: 0 }}
              >
                Add
              </button>
            </div>

            {typeDefs.map((d) => {
              const v = custom[d.id];
              const small = { ...inStyle, fontSize: 12.5, padding: "8px 11px", borderRadius: 8 };
              return (
                <div key={d.id} style={{ marginTop: 10 }}>
                  <label style={{ ...microLbl, fontSize: 9.5, marginBottom: 5 }}>{d.label}</label>
                  {d.kind === "text" && (
                    <input
                      className="cu-m-in"
                      value={typeof v === "string" ? v : ""}
                      onChange={(e) => setCustomVal(d.id, e.target.value || null)}
                      style={small}
                    />
                  )}
                  {d.kind === "number" && (
                    <input
                      className="cu-m-in"
                      type="number"
                      value={typeof v === "number" ? v : ""}
                      onChange={(e) =>
                        setCustomVal(d.id, e.target.value === "" ? null : Number(e.target.value))
                      }
                      style={{ ...small, fontFamily: "var(--font-mono)" }}
                    />
                  )}
                  {d.kind === "date" && (
                    <input
                      className="cu-m-in"
                      type="date"
                      value={toDateInput(typeof v === "number" ? v : null)}
                      onChange={(e) => setCustomVal(d.id, fromDateInput(e.target.value))}
                      style={small}
                    />
                  )}
                  {d.kind === "select" && (
                    <select
                      className="cu-m-in"
                      value={typeof v === "string" ? v : ""}
                      onChange={(e) => setCustomVal(d.id, e.target.value || null)}
                      style={{ ...small, cursor: "pointer" }}
                    >
                      <option value="">—</option>
                      {(d.options ?? []).map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  )}
                  {d.kind === "checkbox" && (
                    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "#3a3f4a", cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={v === true}
                        onChange={(e) => setCustomVal(d.id, e.target.checked)}
                      />
                      Yes
                    </label>
                  )}
                </div>
              );
            })}
          </div>
```

- [ ] **Step 3: `actions.ts` — server-side validation in `saveCustomerAction`**

1. Add imports:

```ts
import { LIFECYCLES } from "@/lib/identity/config";
import { resolveFieldDefs, validateFieldValues } from "@/lib/customer-fields";
import { getSettings } from "@/lib/settings";
```

2. In `saveCustomerAction`, between `const id = input.id || "c" + Date.now();` and the `await upsert({` call, add:

```ts
  // #23 Details — validated server-side, never trusted from the client.
  // Absent field = absent from the upsert input = PRESERVE (write-when-
  // provided, see stores/customers.ts writeRecord).
  const extras: {
    lifecycle?: string;
    keywords?: string[];
    custom?: Record<string, string | number | boolean | null>;
  } = {};
  if (
    input.lifecycle !== undefined &&
    (LIFECYCLES as readonly string[]).includes(input.lifecycle)
  ) {
    extras.lifecycle = input.lifecycle; // unknown value → field ignored (preserve)
  }
  if (input.keywords !== undefined) {
    const seen = new Set<string>();
    extras.keywords = input.keywords
      .map((k) => (k || "").trim().slice(0, 40))
      .filter((k) => {
        if (!k) return false;
        const lc = k.toLowerCase();
        if (seen.has(lc)) return false; // case-insensitive dedupe
        seen.add(lc);
        return true;
      })
      .slice(0, 20);
  }
  if (input.custom !== undefined) {
    const defs = resolveFieldDefs((await getSettings()).customerFieldDefs);
    extras.custom = validateFieldValues(defs, input.custom);
  }
```

3. In the `upsert({ … })` call, after `pricingTier: (input.pricingTier || "").trim() || null,`, add:

```ts
    ...extras,
```

- [ ] **Step 4: `[id]/page.tsx` — display + defs into the modal**

1. Imports — add `dateYear` to the format import (`import { dateYear, shortDate, timeAgo } from "@/lib/format";`) and add:

```ts
import { getSettings } from "@/lib/settings";
import { defsForType, resolveFieldDefs } from "@/lib/customer-fields";
import { LIFECYCLE_LABEL, type Lifecycle } from "@/lib/identity/config";
```

2. Extend the data batch (the plan-04 Promise.all at :85-93):

```ts
  const [quotes, projects, surveys, threads, offices, users, feedRows, settings] = await Promise.all([
    getAllQuotes(),
    getAllProjects(),
    getAllSurveys(),
    commsByCustomer(id),
    officesFromSettings(),
    activeUsers(),
    loadCustomerFeed({ id: cust.id, name: cust.name }),
    getSettings(),
  ]);
```

3. After the `const feedGroups = groupRows(feedRows, Date.now());` line, add:

```ts
  /* ---- #23 lifecycle pill + custom-field detail rows ---- */
  const LIFE_TONE: Record<string, { ink: string; soft: string }> = {
    prospect: { ink: "#8a6d1f", soft: "#fbf3dd" },
    customer: { ink: "#1f7a52", soft: "#eaf6ef" },
    past: { ink: "#8c919c", soft: "#f1f2f5" },
  };
  const lifeTone = LIFE_TONE[cust.lifecycle || ""] || { ink: "#5b616e", soft: "#f1f2f5" };
  const lifeLabel = LIFECYCLE_LABEL[cust.lifecycle as Lifecycle] ?? cust.lifecycle ?? "";
  const fieldDefs = resolveFieldDefs(settings.customerFieldDefs);
  const detailRows = defsForType(fieldDefs, cust.type)
    .map((d) => ({ d, v: (cust.custom || {})[d.id] }))
    .filter((x) => x.v !== undefined && x.v !== null && x.v !== "")
    .map(({ d, v }) => ({
      id: d.id,
      label: d.label,
      value:
        d.kind === "date"
          ? dateYear(v as number)
          : d.kind === "checkbox"
            ? v
              ? "Yes"
              : "No"
            : String(v),
    }));
```

4. In the header, directly after the type pill's closing `)}` (inside the same flex-wrap row as the name), add:

```tsx
              {cust.lifecycle && cust.lifecycle !== "none" && (
                <span style={{ fontSize: 11, fontWeight: 600, color: lifeTone.ink, background: lifeTone.soft, padding: "3px 10px", borderRadius: 20 }}>
                  {lifeLabel}
                </span>
              )}
              {(cust.keywords || []).map((k) => (
                <span key={k} style={{ fontSize: 10.5, fontWeight: 600, color: "#5b616e", background: "#f1f2f5", border: "1px solid #e4e7ec", padding: "2px 9px", borderRadius: 20 }}>
                  {k}
                </span>
              ))}
```

5. In the right column stack, between the Site surveys card's closing `</div>` and the Contacts card (`<div style={{ background: "#fff", …, padding: "15px 16px" }}>` with the `Contacts` micro-header), insert the Details card — hidden when nothing to show:

```tsx
            {/* ---- details (#23) — populated custom fields ---- */}
            {detailRows.length > 0 && (
              <div style={{ background: "#fff", border: "1px solid #ececf0", borderRadius: 12, boxShadow: "0 1px 2px rgba(0,0,0,.04)", padding: "15px 16px" }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "#9aa0ab", letterSpacing: ".05em", textTransform: "uppercase", marginBottom: 10 }}>
                  Details
                </div>
                {detailRows.map((r) => (
                  <div key={r.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "7px 0", borderTop: "1px solid #f3f4f7" }}>
                    <span style={{ fontSize: 12, color: "#8c919c", flexShrink: 0 }}>{r.label}</span>
                    <span style={{ fontSize: 12.5, fontWeight: 600, textAlign: "right", minWidth: 0, overflowWrap: "anywhere" }}>
                      {r.value}
                    </span>
                  </div>
                ))}
              </div>
            )}
```

6. `editInitial` gains the three fields (after `pricingTier: cust.pricingTier || null,`):

```ts
    lifecycle: cust.lifecycle || "none",
    keywords: cust.keywords || [],
    custom: cust.custom || {},
```

7. The modal mount at the bottom gains the defs:

```tsx
      {edit === "1" && (
        <EditCustomerModal mode="edit" initial={editInitial} fieldDefs={fieldDefs} closeHref={`/companies/${encodeURIComponent(cust.id)}`} />
      )}
```

- [ ] **Step 5: Companies list — `?added=7d` + defs into the `edit=new` modal**

In `src/app/(app)/companies/page.tsx`:

1. Imports: add

```ts
import { getSettings } from "@/lib/settings";
import { resolveFieldDefs } from "@/lib/customer-fields";
```

2. The data batch gains settings:

```ts
  const [me, sp, customers, quotes, projects, users, settings] = await Promise.all([
    requireUser(),
    searchParams,
    allCustomers(),
    getAllQuotes(),
    getAllProjects(),
    activeUsers(),
    getSettings(),
  ]);
  const fieldDefs = resolveFieldDefs(settings.customerFieldDefs);
```

3. After `const edit = one(sp.edit);` add the allowlisted param:

```ts
  // #22/#23 "Added in last 7 days" — one allowlisted value, strip-default.
  const added = one(sp.added) === "7d" ? "7d" : "";
```

4. Replace the filter block (:84-98) — split so the chip count excludes only its own filter:

```ts
  /* ---- filters ---- */
  const ql = q.trim().toLowerCase();
  const preAdded = rows.filter(({ c, owner }) => {
    if (scope === "mine" && owner !== me.name) return false;
    if (scope !== "all" && scope !== "mine" && owner !== scope) return false;
    if (typeParam !== "all" && c.type !== typeParam) return false;
    if (ql) {
      const hay = (
        c.name +
        " " +
        (c.locations || []).map((l) => [l.label, l.city, l.state].filter(Boolean).join(" ")).join(" ")
      ).toLowerCase();
      if (!hay.includes(ql)) return false;
    }
    return true;
  });
  // createdAt is typed optional on CustomerDoc, but post-D85 every row has
  // one: composeDoc (customers.ts:288) always copies the notNull
  // companies.created_at, and the D85 converter stamped legacy pre-D83 rows
  // with the CONVERSION run time (`doc.createdAt ?? t`) — reseeds rerun it
  // (seed-data.ts). So legacy/seeded rows read as "new" for 7 days after any
  // reseed or the prod first-boot; the `?? 0` is a type guard, not a
  // never-match path.
  const since7 = Date.now() - 7 * 86_400_000;
  const isRecent = ({ c }: (typeof preAdded)[number]) => (c.createdAt ?? 0) >= since7;
  const addedCount = preAdded.filter(isRecent).length;
  const filtered = added ? preAdded.filter(isRecent) : preAdded;
```

5. The `FilterBar` mount gains the two props:

```tsx
            <FilterBar q={q} type={typeParam} scope={scope} added={added} addedCount={addedCount} types={types} ownerOptions={ownerOptions} meName={me.name} />
```

6. The modal mount gains the defs:

```tsx
      {edit === "new" && <EditCustomerModal mode="new" initial={null} fieldDefs={fieldDefs} closeHref="/companies" />}
```

In `src/app/(app)/companies/controls.tsx` (`FilterBar`):

7. Props: add `added: string; addedCount: number;` to the signature (destructure `added, addedCount,` alongside `scope,`).
8. `pushWith` learns the param (omit-defaults, matching q/type/scope):

```ts
  const pushWith = (patch: { q?: string; type?: string; scope?: string; added?: string }) => {
    const p = new URLSearchParams();
    const nq = patch.q !== undefined ? patch.q : text;
    const nt = patch.type !== undefined ? patch.type : type;
    const ns = patch.scope !== undefined ? patch.scope : scope;
    const na = patch.added !== undefined ? patch.added : added;
    if (nq.trim()) p.set("q", nq.trim());
    if (nt && nt !== "all") p.set("type", nt);
    if (ns && ns !== "all") p.set("scope", ns);
    if (na === "7d") p.set("added", "7d");
    const s = p.toString();
    router.push("/companies" + (s ? "?" + s : ""));
  };
```

9. In the scope row, after the owner `<select>`, add the toggle chip:

```tsx
        <button
          onClick={() => pushWith({ added: added === "7d" ? "" : "7d" })}
          title="Companies added in the last 7 days"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 11.5,
            fontWeight: added === "7d" ? 600 : 500,
            padding: "7px 11px",
            borderRadius: 20,
            border: `1px solid ${added === "7d" ? "var(--accent)" : "#e4e7ec"}`,
            cursor: "pointer",
            background: added === "7d" ? ACCENT_SOFT : "#fff",
            color: added === "7d" ? ACCENT_INK : "#5b616e",
            flexShrink: 0,
            whiteSpace: "nowrap",
          }}
        >
          New (7d)
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 600 }}>{addedCount}</span>
        </button>
```

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit` — clean. `npm run test:specs` — `ALL PASSED`.
Live check (dev on :3000, migration 0011 applied in Task 2):
- Edit a company → Details section shows Lifecycle, Keywords and the Task-3 fields; switch Type → typed fields appear/disappear live.
- Set lifecycle Prospect, add keyword `Non-profit`, fill "Referred by", pick a Region, save → detail page shows the lifecycle pill + keyword chip in the header and a Details card above Contacts (date fields render `dateYear`, checkboxes Yes/No); reopen Edit → values round-trip.
- **The plan-02 `kw` filter goes LIVE right now:** open `/opportunities` → the keyword input appears (it was latent until a company had keywords — `kwAvailable`, opportunities/page.tsx:208); type `Non-profit` → the board scopes to that company's cards.
- Companies list → "New (7d)" chip shows a count; create a company via + New → it appears under the toggle. EXPECT legacy/seeded companies to also appear for up to 7 days after a reseed or bootstrap (their `createdAt` is the D85 conversion timestamp, not the true creation date — the dev DB was reseeded 2026-07-19, so within a week of that ALL seeded companies count); verify the chip count drops as rows age out rather than expecting legacy rows to be excluded.
- Regression: save a company WITHOUT touching Details (or convert a lead) → lifecycle/keywords/custom survive untouched (write-when-provided). For the Modified-time check, use a record where the D83 early-return actually holds TODAY: create a FRESH company via + New (no stored owner), then save it untouched → Modified unchanged (the contentKey canonicalization check). Do NOT run this check against a typical seeded/owned company — two PRE-EXISTING asymmetries (unrelated to plan 05) already defeat the early-return there: composeDoc puts `owner` into the doc whenever `ownerUserId` resolves to a teammate, but saveCustomerAction never sends `owner` (so `contentKey(rec)` lacks it while `contentKey(prev)` has it), and empty-named sites compose `label: undefined` while the action coerces label to `"Venue"`. If an owned company bumps Modified on an untouched re-save, that is inherited behavior, NOT a plan-05 contentKey regression — do not "fix" it here (e.g. by backfilling owner before the compare, which would change owner-write semantics).

- [ ] **Step 7: Commit**

```bash
git add src/app/\(app\)/companies
git commit -m "feat: company Details authoring (lifecycle/keywords/custom) + display + added-7d view (#23)"
```

---

### Task 5: Mine/All — leads `?who=` + won/lost split, projects `?who=`, nav My-X children (TDD)

**Files:**
- Create: `src/app/(app)/leads/segs.ts` (dependency-free seg allowlist)
- Create: `src/components/owner-select.tsx` (OwnerSelect moves here)
- Modify: `src/app/(app)/quotes/controls.tsx` (re-export shim)
- Modify: `src/app/(app)/leads/page.tsx` (who scoping + seg split + toolbar)
- Modify: `src/app/(app)/projects/page.tsx`, `src/app/(app)/projects/[id]/page.tsx`, `src/app/(app)/projects/view.tsx` (who scoping + threading)
- Modify: `src/components/nav/nav-data.ts` (three children)
- Test: `scripts/test-review-and-spec.ts` (#22 block + FIVE existing exact-children assertions updated)

- [ ] **Step 1: Write the failing tests (and update the stale exact-children assertions)**

**(a)** Append INSIDE the `CUSTOMER FIELDS + MINE/ALL (#23/#22)` region (after Task 1's closing `}`, still before the final two lines). `NAV`/`activeKeyFor`/`parentGroupOf` are ALREADY module-scope imports from the D98/D117 sections — reuse them, do NOT re-import:

```ts
/* #22 — Mine/All literals. NAV / activeKeyFor / parentGroupOf are already
   imported by the D98/D117 nav sections above — reuse, never re-import. */
import { SEG_KEYS } from "@/app/(app)/leads/segs";

{
  ok(
    SEG_KEYS.join("|") === "all|follow|unassigned|new|open|won|lost",
    "#22: leads segments — the closed bundle is split into won|lost"
  );
  ok(
    !(SEG_KEYS as string[]).includes("closed"),
    "#22: legacy ?seg=closed is off the allowlist — deep links fall back to 'all'"
  );

  const childPairs = (key: string): string[] => {
    const g = NAV.find((e) => e.kind === "group" && e.key === key);
    return g && g.kind === "group" ? g.children.map((c) => `${c.key}:${c.href}`) : [];
  };
  ok(childPairs("est").includes("myquotes:/quotes?who=mine"), "#22: EST carries My Quotes → /quotes?who=mine");
  ok(childPairs("crm").includes("myleads:/leads?who=mine"), "#22: CRM carries My Leads → /leads?who=mine");
  ok(childPairs("pm").includes("myprojects:/projects?who=mine"), "#22: PM carries My Projects → /projects?who=mine");
  ok(
    activeKeyFor("/leads") === "leads" && parentGroupOf("myleads") === "crm",
    "#22: activeKeyFor stays pathname-only — a My-X child never lights its own key (known cosmetic limitation, base child lights for both)"
  );
}
```

**(b)** Update the FIVE existing assertions the nav change makes stale (exact edits — messages updated so failures stay self-explaining):

1. ~:323-324 — `d99Sales.children.length === 6` → `=== 7`; message → `"CRM has seven children — Quotes and Reviews moved to EST (D117), Opportunities added (#18), My Leads added (#22)"`.
2. ~:330-333 — the order string `"opportunities,leads,companies,people,venues,field"` → `"opportunities,leads,myleads,companies,people,venues,field"`; message → `"CRM children are opportunities, leads, myleads, companies, people, venues, field in order"`.
3. ~:393-395 — `d100Ops.children.length === 6` → `=== 7`; message → `"PM has seven children (My Projects added, #22)"`.
4. ~:399-405 — `"projects,schedule,fieldwork,flametests,inspections,repairs"` → `"projects,myprojects,schedule,fieldwork,flametests,inspections,repairs"`; message → `"PM children are projects, myprojects, schedule, fieldwork, flametests, inspections, repairs in order"`.
5. ~:1141-1146 — `"quotes,estimator,reviews"` → `"quotes,myquotes,estimator,reviews"`; message → `"EST = Quotes, My Quotes, Estimator, Reviews in order (#22)"`.

Run: `npm run test:specs` — expected: the run errors on the missing `./segs` module (and, once it exists mid-task, the five updated assertions FAIL until the nav change lands — red before green in both directions).

- [ ] **Step 2: `src/app/(app)/leads/segs.ts`**

```ts
/**
 * Leads table segments (#22) — dependency-free VALUE module (the
 * settings-sections / home-tabs-keys precedent): imported by the server
 * page AND the spec harness, so it must not reach a store. #22 splits the
 * old "closed" bundle into "won" and "lost"; a legacy `?seg=closed` deep
 * link falls off this allowlist and lands on "all" via the page's
 * SEG_KEYS.includes check.
 */
export type SegKey = "all" | "follow" | "unassigned" | "new" | "open" | "won" | "lost";
export const SEG_KEYS: SegKey[] = ["all", "follow", "unassigned", "new", "open", "won", "lost"];
```

- [ ] **Step 3: `src/components/owner-select.tsx` + the quotes shim**

Create `src/components/owner-select.tsx` — the quotes `OwnerSelect` moves here VERBATIM (body unchanged) so leads and projects reuse it:

```tsx
"use client";

import { useRouter } from "next/navigation";

/**
 * Owner scope dropdown (#22) — moved verbatim from quotes/controls.tsx so
 * Leads and Projects reuse the exact quotes idiom: a dumb client control
 * over SERVER-PREBUILT hrefs (value/label/href VMs — no store imports, no
 * URL construction on the client).
 */
export function OwnerSelect({
  value,
  options,
}: {
  value: string;
  options: Array<{ value: string; label: string; href: string }>;
}) {
  const router = useRouter();
  return (
    <select
      className="qt-sel"
      value={value}
      onChange={(e) => {
        const opt = options.find((o) => o.value === e.target.value);
        if (opt) router.push(opt.href);
      }}
      style={{
        fontFamily: "var(--font-ui)",
        fontSize: 12.5,
        fontWeight: 600,
        color: "#3a3f4a",
        background: "#fff",
        border: "1px solid #e4e7ec",
        borderRadius: 9,
        padding: "9px 30px 9px 12px",
        cursor: "pointer",
      }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
```

In `src/app/(app)/quotes/controls.tsx`, delete the whole local `export function OwnerSelect({ … })` definition (:238-274) and put in its place:

```ts
/* #22 — OwnerSelect moved to @/components/owner-select (shared with Leads
 * and Projects); re-exported so quotes/page.tsx's import stays put. */
export { OwnerSelect } from "@/components/owner-select";
```

Also delete the now-unused `import { useRouter } from "next/navigation";` line at quotes/controls.tsx:4 — `useRouter` was only ever referenced inside the `OwnerSelect` body being deleted, so once that body is gone the import has no remaining call site in the file and must go with it.

- [ ] **Step 4: Leads — `?who=` scoping + won/lost split**

All edits in `src/app/(app)/leads/page.tsx`:

1. **Imports.** In the `@/lib/stores/leads` import, replace `metrics,` with `needsFollowUp,` (keep alphabetical order: …`isOpen`, `needsFollowUp`, `sla`…). Add:

```ts
import { OwnerSelect } from "@/components/owner-select";
import { SEG_KEYS, type SegKey } from "./segs";
```

2. **Local seg decls.** Delete the local `type SegKey = …` line (:50) and the `const SEG_KEYS: SegKey[] = […]` line (:58) — both now come from `./segs`. (`type ViewKey` stays.)

3. **`hrefFor`** (:62-69) — `who` rides every view (scope applies to board/worklist/table alike), strip-default:

```ts
function hrefFor(view: ViewKey, seg: SegKey, lead?: string, who?: string): string {
  const p = new URLSearchParams();
  if (view !== "table") p.set("view", view);
  if (view === "table" && seg !== "all") p.set("seg", seg);
  if (who) p.set("who", who);
  if (lead) p.set("lead", lead);
  const s = p.toString();
  return "/leads" + (s ? `?${s}` : "");
}
```

4. **Scope toolbar plumbing.** After the `newBtn` const, add:

```ts
/* ---- #22 owner-scope toolbar (the quotes My work / Everyone idiom) ---- */
const scopeSegOn: CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: "#16181d",
  background: "#fff",
  borderRadius: 7,
  padding: "7px 12px",
  textDecoration: "none",
  boxShadow: "0 1px 2px rgba(0,0,0,.08)",
};
const scopeSegOff: CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: "#787d87",
  background: "transparent",
  borderRadius: 7,
  padding: "7px 12px",
  textDecoration: "none",
};

type ScopeVM = {
  who: string; // "" (everyone) | "mine" | teammate name
  mineHref: string;
  allHref: string;
  ownerValue: string;
  ownerOptions: Array<{ value: string; label: string; href: string }>;
};
```

5. **Heading** gains the toolbar — signature adds `scope: ScopeVM`, and the right-hand controls block becomes:

```tsx
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0, flexWrap: "wrap" }}>
        <div style={{ display: "flex", background: "#eceef1", borderRadius: 9, padding: 3, flexShrink: 0 }}>
          <Link href={scope.mineHref} style={scope.who === "mine" ? scopeSegOn : scopeSegOff}>
            My work
          </Link>
          <Link href={scope.allHref} style={scope.who === "" ? scopeSegOn : scopeSegOff}>
            Everyone
          </Link>
        </div>
        <OwnerSelect value={scope.ownerValue} options={scope.ownerOptions} />
        <SegmentedToggle options={VIEW_OPTIONS} active={view} hrefFor={(k) => hrefFor(k, "all", undefined, scope.who)} />
        <a href="/lead-intake" target="_blank" style={formLink}>
          Public form ↗
        </a>
        <Link href={newHref} style={newBtn}>
          <span style={{ fontSize: 15, lineHeight: 1 }}>+</span> New lead
        </Link>
      </div>
```

`OwnerSelect` renders a `select.qt-sel` (owner-select.tsx:12) but leads/page.tsx's `styleBlock` (:71-88) has no rule for that class — without one the dropdown falls back to the browser's default arrow instead of the app's. Add the same rule opportunities/page.tsx already carries for its own `OwnerSelect` mount (~:46-47), copied verbatim, to the end of the leads `styleBlock` template literal:

```css
/* copied from quotes/page.tsx — select.qt-sel's dropdown-arrow rule, so OwnerSelect renders identically here */
select.qt-sel { -webkit-appearance: none; appearance: none; background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'><path d='M1 1l4 4 4-4' fill='none' stroke='%238c919c' stroke-width='1.5'/></svg>"); background-repeat: no-repeat; background-position: right 11px center; }
```

(The view toggle still resets seg to `"all"` — the existing behavior — and now carries `who`.)

6. **Param parsing.** After `const leadParam = one(sp.lead);` add:

```ts
  // #22 — mirror the quotes ?who= idiom exactly: absent/all = everyone,
  // me-by-name canonicalizes to "mine", anything else is a teammate name.
  const whoRaw = one(sp.who);
  const who = !whoRaw || whoRaw === "all" ? "" : whoRaw === "mine" || whoRaw === me.name ? "mine" : whoRaw;
  const scopeName = who === "mine" ? me.name : who; // "" = unscoped
```

7. **Data fetch + scope.** Replace the batch (:193-200) and the roster line's surroundings:

```ts
  const [allLeads, users, fuList, unassignedAll, settings] = await Promise.all([
    getAll(),
    activeUsers(),
    followUps(scopeName ? { owner: scopeName } : {}),
    unassigned(),
    getSettings(),
  ]);
  const roster: Ident[] = users.map((u) => ({ name: u.name, initials: u.initials, color: u.color }));

  // #22 STRICT owner scope, applied to the full set BEFORE any view/seg
  // logic (board, worklist, table, urgency ordering all derive from `all`).
  // Deliberately l.owner === name, NOT unownedOrMine: unassigned leads keep
  // their own segment + the claim flow instead of leaking into "My work" —
  // which also means the Unassigned segment reads 0 under any owner scope.
  const all = scopeName ? allLeads.filter((l) => l.owner === scopeName) : allLeads;
  const unassignedList = scopeName ? [] : unassignedAll;

  // #22 — metrics() is unscoped (no owner opt); recompute the same numbers
  // over the scoped set so tiles, standfirst and segment counts agree with
  // the view. fuList is already owner-scoped via followUps({ owner }).
  const DAY = 86_400_000;
  const openList = all.filter(isOpen);
  const wonList = all.filter((l) => l.stage === "won");
  const lostList = all.filter((l) => l.stage === "lost");
  const decided = wonList.length + lostList.length;
  const m = {
    open: openList.length,
    openValue: openList.reduce((a, l) => a + (l.value || 0), 0),
    needFollowUp: openList.filter((l) => needsFollowUp(l)).length,
    slaBreached: openList.filter((l) => sla(l).state === "breached").length,
    unassigned: openList.filter((l) => !l.owner).length,
    newThisWeek: all.filter((l) => (l.createdAt || 0) >= Date.now() - 7 * DAY).length,
    won: wonList.length,
    lost: lostList.length,
    conversion: decided ? Math.round((wonList.length / decided) * 100) : 0,
    counts: { new: all.filter((l) => l.stage === "new").length },
  };
```

(Everything downstream — `standfirst`, `urgOf`, board `stats`, worklist groups — keeps reading `all` / `m` unchanged and is therefore scoped for free.)

8. **hrefs carry who.** Update every `hrefFor` call site:
   - `const closeHref = hrefFor(view, seg);` → `hrefFor(view, seg, undefined, who);`
   - `const newHref = hrefFor(view, seg, "new");` → `hrefFor(view, seg, "new", who);`
   - board card `href: hrefFor("board", "all", l.id),` → `hrefFor("board", "all", l.id, who),`
   - worklist `href: hrefFor("worklist", "all", l.id),` → `hrefFor("worklist", "all", l.id, who),`
   - table row `href: hrefFor("table", seg, l.id),` → `hrefFor("table", seg, l.id, who),`
   - seg chips `href={hrefFor("table", s.key)}` → `href={hrefFor("table", s.key, undefined, who)}`

9. **Drawer resolves UNSCOPED.** The drawer lookup must not fall through to the "new" form when a deep-linked lead is outside the current scope — change:

```ts
  const leadRec =
    leadParam && leadParam !== "new" ? allLeads.find((l) => l.id === leadParam) || null : null;
```

10. **Scope VM + Heading mounts.** After `newHref`, add:

```ts
  const scopeVM: ScopeVM = {
    who,
    mineHref: hrefFor(view, seg, undefined, "mine"),
    allHref: hrefFor(view, seg, undefined, ""),
    ownerValue: who === "" ? "all" : who,
    ownerOptions: [
      { value: "all", label: "All teammates", href: hrefFor(view, seg, undefined, "") },
      ...roster.map((r) => ({
        value: r.name === me.name ? "mine" : r.name,
        label: r.name === me.name ? r.name + " (me)" : r.name,
        href: hrefFor(view, seg, undefined, r.name === me.name ? "mine" : r.name),
      })),
    ],
  };
```

…and all three `<Heading … />` mounts gain `scope={scopeVM}`.

11. **Seg split.** Replace segDefs + the filter chain (:341-356):

```ts
  const segDefs: Array<{ key: SegKey; label: string; count: number }> = [
    { key: "all", label: "All", count: all.length },
    { key: "follow", label: "Needs follow-up", count: m.needFollowUp },
    { key: "unassigned", label: "Unassigned", count: m.unassigned },
    { key: "new", label: "New", count: m.counts.new },
    { key: "open", label: "Open", count: m.open },
    { key: "won", label: "Won", count: m.won },
    { key: "lost", label: "Lost", count: m.lost },
  ];
  let filtered: LeadRecord[];
  if (seg === "follow") filtered = fuList.slice();
  else if (seg === "unassigned") filtered = unassignedList.slice();
  else if (seg === "new") filtered = all.filter((l) => l.stage === "new");
  else if (seg === "open") filtered = all.filter(isOpen);
  else if (seg === "won") filtered = all.filter((l) => l.stage === "won");
  else if (seg === "lost") filtered = all.filter((l) => l.stage === "lost");
  else filtered = all.slice();
  if (seg !== "follow") filtered = filtered.sort(byUrg);
```

(The existing `seg` validation line `SEG_KEYS.includes(segParam) ? segParam : "all"` is untouched — with `closed` off the new allowlist, legacy deep links land on "all" for free.)

- [ ] **Step 5: Projects — `?who=` scoping + threading**

**`src/app/(app)/projects/page.tsx`** — full replacement of the component body's head (the file is small; shown whole from the signature down):

```ts
export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [user, sp, data] = await Promise.all([requireUser(), searchParams, loadProjectsData()]);
  // Legacy/cross-screen deep links use /projects?id=<id>; the detail lives at
  // /projects/[id]. Redirect so both link shapes resolve to the detail view.
  const idParam = one(sp.id);
  if (idParam) redirect(`/projects/${encodeURIComponent(idParam)}`);
  const filter = normFilter(one(sp.filter));
  // #19: list (default, stripped from URLs) | board — allowlisted like the
  // leads view param.
  const view = one(sp.view) === "board" ? ("board" as const) : ("list" as const);
  // #22 — the quotes ?who= idiom; STRICT owner match applied to the full
  // book BEFORE ProjectsView (stats, counts, list and board all derive from
  // the scoped array). The won-ready strip scopes too — someone else's won
  // quotes don't belong under "My projects".
  const whoRaw = one(sp.who);
  const who = !whoRaw || whoRaw === "all" ? "" : whoRaw === "mine" || whoRaw === user.name ? "mine" : whoRaw;
  const ownerName = who === "mine" ? user.name : who;
  const projects = ownerName ? data.projects.filter((p) => p.owner === ownerName) : data.projects;
  const pending = ownerName ? data.pending.filter((q) => (q.owner || "") === ownerName) : data.pending;

  return (
    <ProjectsView
      projects={projects}
      pending={pending}
      sel={null}
      filter={filter}
      tab="overview"
      view={view}
      who={who}
      meName={user.name}
      custById={data.custById}
      identity={data.identity}
      roster={data.roster}
      taskRows={data.taskRows}
      people={data.people}
    />
  );
}
```

**`src/app/(app)/projects/[id]/page.tsx`** — same parsing; `sel` still resolves against the FULL book (a deep link to an out-of-scope project must not 404 the detail), only the passed list/pending scope:

```ts
  const sel = data.projects.find((p) => p.id === id);
  if (!sel) notFound();

  const filter = normFilter(one(sp.filter));
  const tab = one(sp.tab) || "overview";
  // #19: list (default, stripped from URLs) | board — allowlisted like the
  // leads view param.
  const view = one(sp.view) === "board" ? ("board" as const) : ("list" as const);
  // #22 — see projects/page.tsx; sel resolves UNSCOPED on purpose.
  const whoRaw = one(sp.who);
  const who = !whoRaw || whoRaw === "all" ? "" : whoRaw === "mine" || whoRaw === user.name ? "mine" : whoRaw;
  const ownerName = who === "mine" ? user.name : who;
  const projects = ownerName ? data.projects.filter((p) => p.owner === ownerName) : data.projects;
  const pending = ownerName ? data.pending.filter((q) => (q.owner || "") === ownerName) : data.pending;

  return (
    <ProjectsView
      projects={projects}
      pending={pending}
      sel={sel}
      filter={filter}
      tab={tab}
      view={view}
      who={who}
      meName={user.name}
      custById={data.custById}
      identity={data.identity}
      roster={data.roster}
      taskRows={data.taskRows}
      people={data.people}
    />
  );
}
```

(Both files change `const [, { id }, sp, data]` / `const [, sp, data]` to bind the user: `const [user, { id }, sp, data]` / `const [user, sp, data]`.)

**`src/app/(app)/projects/view.tsx`** — six anchored edits:

1. Import the shared control: `import { OwnerSelect } from "@/components/owner-select";`
2. `ProjectsView` signature gains `who: string; meName: string;` (props destructure adds `who, meName,`).
3. Href builders thread who — inside `ProjectsView`, right before `filterHref`, add `const whoQ = who || undefined;`, then:

```ts
  const filterHref = (key: string) =>
    curPath +
    qs({
      filter: key === "active" ? undefined : key,
      tab: sel && tab !== "overview" ? tab : undefined,
      view: view === "board" ? "board" : undefined,
      who: whoQ,
    });
  const cardHref = (id: string) =>
    "/projects/" +
    encodeURIComponent(id) +
    qs({
      filter: filter === "active" ? undefined : filter,
      view: view === "board" ? "board" : undefined,
      who: whoQ,
    });
```

…the board card href becomes:

```ts
    href: "/projects/" + encodeURIComponent(p.id) + qs({ view: "board", who: whoQ }),
```

…and the list/board `SegmentedToggle` (the `!sel` block at ~:548-560) becomes:

```tsx
        {!sel && (
          <SegmentedToggle
            options={[
              { key: "list", label: "List" },
              { key: "board", label: "Board" },
            ]}
            active={view}
            hrefFor={(k) =>
              k === "board"
                ? "/projects" + qs({ view: "board", who: whoQ })
                : "/projects" + qs({ filter: filter === "active" ? undefined : filter, who: whoQ })
            }
          />
        )}
```

4. Owner toolbar — in the same controls row, directly BEFORE that `{!sel && (<SegmentedToggle …/>)}` block, add (index view only; the detail's back-link returns to the scoped list):

```tsx
        {!sel && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            <div style={{ display: "flex", background: "#eceef1", borderRadius: 9, padding: 3 }}>
              <Link
                href={"/projects" + qs({ filter: filter === "active" ? undefined : filter, view: view === "board" ? "board" : undefined, who: "mine" })}
                style={{ fontSize: 12, fontWeight: 600, borderRadius: 7, padding: "7px 12px", textDecoration: "none", ...(who === "mine" ? { color: "#16181d", background: "#fff", boxShadow: "0 1px 2px rgba(0,0,0,.08)" } : { color: "#787d87" }) }}
              >
                My work
              </Link>
              <Link
                href={"/projects" + qs({ filter: filter === "active" ? undefined : filter, view: view === "board" ? "board" : undefined })}
                style={{ fontSize: 12, fontWeight: 600, borderRadius: 7, padding: "7px 12px", textDecoration: "none", ...(who === "" ? { color: "#16181d", background: "#fff", boxShadow: "0 1px 2px rgba(0,0,0,.08)" } : { color: "#787d87" }) }}
              >
                Everyone
              </Link>
            </div>
            <OwnerSelect
              value={who === "" ? "all" : who}
              options={[
                {
                  value: "all",
                  label: "All teammates",
                  href: "/projects" + qs({ filter: filter === "active" ? undefined : filter, view: view === "board" ? "board" : undefined }),
                },
                ...roster.map((name) => ({
                  value: name === meName ? "mine" : name,
                  label: name === meName ? name + " (me)" : name,
                  href:
                    "/projects" +
                    qs({
                      filter: filter === "active" ? undefined : filter,
                      view: view === "board" ? "board" : undefined,
                      who: name === meName ? "mine" : name,
                    }),
                })),
              ]}
            />
          </div>
        )}
```

Same `select.qt-sel` gap as leads: `OwnerSelect` renders that class (owner-select.tsx:12) but `PROJECTS_CSS` (view.tsx:50-68) has no rule for it yet. Add the same rule opportunities/page.tsx already carries for its own `OwnerSelect` mount (~:46-47), copied verbatim, to the end of the `PROJECTS_CSS` template literal:

```css
/* copied from quotes/page.tsx — select.qt-sel's dropdown-arrow rule, so OwnerSelect renders identically here */
select.qt-sel { -webkit-appearance: none; appearance: none; background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'><path d='M1 1l4 4 4-4' fill='none' stroke='%238c919c' stroke-width='1.5'/></svg>"); background-repeat: no-repeat; background-position: right 11px center; }
```

5. `ProjectDetail` gains `who` — the mount adds `who={who}`, the signature adds `who: string;`, and inside it (`const whoQ = who || undefined;` before `tabHref`):

```ts
  const tabHref = (key: string) =>
    detailBase +
    qs({
      filter: filter === "active" ? undefined : filter,
      tab: key === "overview" ? undefined : key,
      view: view === "board" ? "board" : undefined,
      who: whoQ,
    });
  const backHref =
    view === "board"
      ? "/projects" + qs({ view: "board", who: whoQ })
      : "/projects" + qs({ filter: filter === "active" ? undefined : filter, who: whoQ });
```

6. KNOWN product wrinkle — flag, do not "fix": non-quote-derived projects default `owner` to `DEFAULT_ACTOR` ("Jeff Chesebro", projects.ts:48/:349) and quote-derived ones take the quote's owner; there is NO owner-editing UI on a project yet, so "My projects" for anyone but Jeff will be sparse until one exists. Logged for Jeff in the Task 6 PUNCHLIST block.

- [ ] **Step 6: Nav children — `src/components/nav/nav-data.ts`**

Three one-line insertions (hrefs render verbatim into `Link`, in both the desktop dropdown and the mobile drawer; no `activeKeyFor` change, no nav-counts keys — absent key = no badge):

After `{ key: "quotes", label: "Quotes", href: "/quotes" },`:

```ts
      /* #22 Mine/All nav children — querystring hrefs render verbatim.
       * KNOWN cosmetic limitations (accepted, logged in PUNCHLIST #22):
       * activeKeyFor is pathname-only, so a My-X child never lights its own
       * key (the base child lights for both); and Nav's overlay-close
       * effect keys on [pathname] alone, so clicking My Quotes while
       * already on /quotes doesn't auto-close the dropdown. Wiring
       * useSearchParams into Nav would force dynamic rendering of the
       * layout — deliberately NOT done. */
      { key: "myquotes", label: "My Quotes", href: "/quotes?who=mine" },
```

After `{ key: "leads", label: "Leads", href: "/leads" },`:

```ts
      { key: "myleads", label: "My Leads", href: "/leads?who=mine" }, // #22 — see the EST note
```

After `{ key: "projects", label: "Projects", href: "/projects" },`:

```ts
      { key: "myprojects", label: "My Projects", href: "/projects?who=mine" }, // #22 — see the EST note
```

- [ ] **Step 7: Verify**

Run: `npm run test:specs` — all `#22:` lines PASS, the five edited assertions PASS with their new literals, suite ends `ALL PASSED`.
Run: `npx tsc --noEmit` — clean.
Live spot-check (full drive is Task 6): `/leads?who=mine` scopes all three views + counts; `/leads?seg=won` and `?seg=lost` split; `/leads?seg=closed` lands on All; `/projects?who=mine` scopes list AND board + stats; nav dropdowns show the three My-X entries and navigate.

- [ ] **Step 8: Commit**

```bash
git add src/app/\(app\)/leads src/app/\(app\)/projects src/app/\(app\)/quotes/controls.tsx src/components/owner-select.tsx src/components/nav/nav-data.ts scripts/test-review-and-spec.ts
git commit -m "feat: leads/projects ?who= scoping + won/lost seg split + My-X nav children (#22)"
```

---

### Task 6: Full verification, live drive, punchlist/decisions/roadmap, wrap up

**Files:**
- Modify: `PUNCHLIST.md` (items 23 + 22)
- Modify: `DECISIONS.md` (D122)
- Modify: `docs/superpowers/plans/2026-07-25-00-crm-wave-roadmap.md` (plan 05 row)

- [ ] **Step 1: Static gates**

Run: `npx tsc --noEmit` → clean. `npm run lint` → baseline **71 errors**, net-zero (warnings may drift; errors may not). `npm run test:specs` → `ALL PASSED`.

- [ ] **Step 2: Production build — KILL THE DEV SERVER FIRST (D106)**

```bash
lsof -ti tcp:3000 | xargs -r kill
npm run build
```

Expected: green — `scripts/migrate.mjs` applies 0011, and no PGlite-in-client-bundle error (new client surfaces import only pure modules — `customer-fields.ts`, `identity/config.ts`, `companies/lib.ts` — plus server-action stubs). Restart `npm run dev` afterwards for the live drive.

- [ ] **Step 3: Live acceptance drive**

- **Defs authoring:** Settings → Admin → Customer fields: add Text/Number/Date/Dropdown/Checkbox defs, mixed appliesTo; invalid saves (dropdown without options, 31st field) show the inline error; ids mint once and never change on relabel.
- **Values end-to-end:** company edit modal shows exactly the defs for the selected type (live-swaps when Type changes); values of every kind persist, round-trip the modal, and render on the detail page (Details card above Contacts; dates as `dateYear`, checkbox Yes/No; card hidden when empty).
- **Lifecycle + keywords:** pill + chips render in the customer header; add the keyword `Non-profit` → `/opportunities` now shows the keyword filter (plan-02 `kw` goes live) and it scopes the board.
- **Write-when-provided regression:** convert a lead (`/leads` drawer) → the created/updated company keeps lifecycle heuristics intact and loses nothing; re-saving a FRESH `+ New` company (no stored owner) untouched does not bump Modified (D83 early-return). Owned/seeded companies bump Modified on untouched re-saves TODAY — the pre-existing owner and empty-label contentKey asymmetries (see Task 4 Step 6) — inherited behavior, not a plan-05 regression.
- **New (7d):** chip counts and filters; a freshly-created company appears, and legacy/seeded companies ALSO appear for up to 7 days after a reseed/bootstrap (their `createdAt` is the D85 conversion timestamp) — expect the chip count to shrink as rows age out, not for legacy rows to be excluded.
- **Leads mine/all:** `?who=mine` from nav — table/board/worklist all scoped, stat tiles + seg counts recomputed, Unassigned reads 0 under a scope (deliberate), toolbar + OwnerSelect switch scopes, `who` survives view/seg/drawer navigation, deep-linking another owner's `?lead=` still opens the detail drawer.
- **Won/lost:** segments show separately with correct counts; `?seg=closed` deep link lands on All.
- **Projects mine/all:** list, stats, won-ready strip and board all scoped; who survives filter/tab/card/back-link navigation incl. `?view=board`; "My projects" as a non-Jeff user is sparse (DEFAULT_ACTOR wrinkle — flagged, not fixed).
- **Nav:** My Quotes / My Leads / My Projects appear in EST/CRM/PM (desktop dropdown + mobile drawer) and navigate; base child lights for both (accepted); no badges on the My-X rows.
- **Regressions:** `/quotes?who=…` unchanged (OwnerSelect shim), plan-02 boards drag/filters, plan-03 lead thread, plan-04 Activity feed + composer all still work; `/companies` map + search + scope untouched.

- [ ] **Step 4: PUNCHLIST.md**

Item 23 — heading becomes:

```md
## 23. Customer / company record field parity — DONE (custom fields + lifecycle/keywords UI + added-7d, 2026-07-26, plan 05)
```

Insert directly under it:

```md
**DONE 2026-07-26 (plan 05, D122).** Custom fields are REAL: admin-defined
typed definitions (text / number / date / dropdown / checkbox, per-venue-type
`appliesTo`, ≤30) live in Settings → Admin → Customer fields
(`AppSettingsData.customerFieldDefs`, full-replacement save, server-validated);
values live in a new `companies.custom` jsonb column (migration 0011) and are
authored in the company edit modal's new **Details** section — which also
finally surfaces the D85-stored **lifecycle** (Prospect/Customer/Past) and
**keywords** (chip editor). The customer page shows a lifecycle pill +
keyword chips in the header and a compact Details card of populated custom
fields. Keywords authoring makes the opportunity board's keyword filter
(item 18) live. The Companies list gained the **"New (7d)"** added-last-7-days
toggle (`?added=7d`). Caveat: legacy rows show as new for a week after any
reseed or the prod bootstrap — their `createdAt` is the D85 conversion time,
not the true creation date (every row has one; no way to backfill the real
dates).
Store semantics: lifecycle/keywords/custom are write-when-provided /
preserve-when-undefined, so the lead converter, CSV importer and seed remain
byte-identical writers (D122). Pre-existing residual (predates plan 05, not
touched): untouched modal re-saves of an OWNED company still bump Modified —
composeDoc includes `owner` in the doc (so in contentKey) but
saveCustomerAction never sends it, and empty-named sites compose
`label: undefined` while the action coerces `"Venue"` — so the D83
early-return only holds for ownerless records; a future contentKey
canonicalization pass could close it. Remaining from the original ask: **F —
referred-by as a linked person** (a custom text field holds it today; a real
contact link waits on Phase-2 junctions), per-record permissions (never
requested since), and the PO-box address line.
```

…and the item's end-of-section `**Status:** LARGELY LANDED via D85 — …` line becomes:

```md
**Status:** DONE (plan 05) — custom fields + lifecycle/keywords UI + added-7d shipped; F (referred-by as a person link), per-record permissions and the PO-box line remain open.
```

Item 22 — heading becomes:

```md
## 22. Navigation / module parity with Daylite's sidebar — MINE/ALL SHIPPED (2026-07-26, plan 05); saved views still open
```

Insert directly under it:

```md
**PARTIAL DONE 2026-07-26 (plan 05, D122) — the spec-§3 slice: Mine/All
scoped views + nav entries.** Leads and Projects gained the quotes `?who=`
idiom (mine | teammate | all; STRICT `owner === name` — unassigned leads
deliberately keep their own segment + claim flow and read 0 under any owner
scope), with every count/tile/board/worklist re-derived over the scoped set
and `who` threaded through all hrefs. The leads **closed segment split into
Won and Lost** (legacy `?seg=closed` deep links fall back to All). Nav
gained **My Quotes / My Leads / My Projects** children (EST/CRM/PM). Known
accepted wrinkles for Jeff: (a) `activeKeyFor` is pathname-only, so a My-X
entry lights its base child, not itself; (b) the nav overlay-close effect
keys on pathname, so clicking My Quotes while on /quotes leaves the dropdown
open (fixing either means useSearchParams in Nav → dynamic layout — declined);
(c) non-quote-derived projects default owner to "Jeff Chesebro"
(DEFAULT_ACTOR) and projects have no owner-editing UI, so "My projects" is
sparse for everyone else — needs an owner field on the project detail.
Still open from this item: per-person saved views (B — deferred by spec),
Learn (folds into Knowledge, wave ④), shared/team calendars (§7), tasks
views (item 17 shipped its own).
```

…and the `**Status:** OPEN — needs A–D. …` line becomes:

```md
**Status:** MINE/ALL SHIPPED (plan 05) — A answered by spec §3 (scoped nav entries, in-page filters stay); B per-person saved views deferred; C Learn → Knowledge tab (wave ④); D team calendar wanted (§7). Residual wrinkles logged above.
```

- [ ] **Step 5: DECISIONS.md**

Verify the next free number first (`grep -o "D1[0-9][0-9]" DECISIONS.md | sort -u | tail` — last known is **D121**; if something landed since, take the next). Append:

```md
## D122 — Customer custom fields + Mine/All scoping: shapes and seams (2026-07-26)

Controller calls made to unblock plan 05 (#23/#22) — **flagged for Jeff's
review**; spec §3 is followed (custom fields built without waiting for the
export audit; Mine/All scoped nav entries first, per-person saved views
deferred), these are the seams:

- **Definitions vs values split:** `CustomFieldDef[]` lives in
  `AppSettingsData.customerFieldDefs` (FULL-REPLACEMENT save, the wireTypes
  idiom; `resolveFieldDefs(stored) = stored ?? []`, no code defaults, ≤30
  defs); VALUES live in `companies.custom` jsonb (migration 0011), keyed by
  def id. Ids are slugs minted server-side from the label at create and
  IMMUTABLE after (they key stored values); the kind locks once created.
  Field logic is pure + spec-covered (`lib/customer-fields.ts`, zero
  imports). Dates are epoch-ms (local midnight); text ≤500 chars; select
  values must match the def's options; unknown ids stripped server-side.
- **Write-when-provided / preserve-when-undefined** on the customers store:
  `lifecycle`/`keywords`/`custom` joined `CustomerDoc` as CONTENT fields.
  `writeRecord` backfills absent fields from the existing row BEFORE the
  D83 no-change check, and `contentKey` gives the three a canonical
  serialization slot (position + defaults + sorted custom keys) — so a
  Details-only edit registers as a change, while legacy writers (lead
  convert, CSV importer, seed) neither clear values nor advance updatedAt.
  `lib/identity/convert.ts` (D85 bootstrap) bypasses upsert entirely and is
  untouched.
- **Removing a def orphans its values silently** (they stay in the jsonb,
  stop rendering, and are stripped on the next modal save) — accepted for
  v1; an admin "purge orphaned values" pass can come later if wanted.
- **Strict owner scoping** (`?who=`, the quotes canonicalization) on leads
  and projects: `owner === name`, NOT unownedOrMine — unassigned leads keep
  their own segment + claim flow and read 0 under any owner scope. Leads
  counts are re-derived locally (metrics() stays unscoped/global);
  followUps({owner}) reuses the store's existing opt. The drawer and the
  project detail resolve deep links UNSCOPED on purpose.
- **Leads segments:** `closed` → `won` | `lost` (`leads/segs.ts`, a
  dependency-free allowlist module the spec harness pins); legacy
  `?seg=closed` falls back to "all". No hardcoded closed links existed.
- **OwnerSelect extracted** to `components/owner-select.tsx` (verbatim move;
  quotes/controls re-exports so /quotes is untouched).
- **Nav My-X children** are plain querystring hrefs; `activeKeyFor` stays
  pathname-only and the overlay-close effect stays [pathname]-keyed — both
  cosmetic limitations accepted rather than forcing useSearchParams (and
  dynamic rendering) into the layout's Nav.
- **"New (7d)"** (`?added=7d`) filters on `createdAt`, which post-D85 EVERY
  company row has (composeDoc copies the notNull column; the converter
  stamped legacy rows with the conversion run time) — legacy rows read as
  new for a week after any reseed or the prod bootstrap (documented; real
  creation dates are unrecoverable).
- **DEFAULT_ACTOR wrinkle** (flagged, not fixed): non-quote projects default
  owner "Jeff Chesebro" and no owner-editing UI exists on projects — "My
  projects" is sparse for other users until one lands.
```

- [ ] **Step 6: Roadmap**

In `docs/superpowers/plans/2026-07-25-00-crm-wave-roadmap.md`, change the plan-05 row to:

```md
| 05 | Customer custom fields + Mine/All nav scoping (`2026-07-26-05-crm-fields-nav.md`) | #23, #22 | **BUILT** (2026-07-26) — customer-fields defs (Settings) + companies.custom (migration 0011) + Details authoring/display + added-7d; leads/projects `?who=` + won/lost split + My-X nav children (D122). **WAVE ① COMPLETE.** |
```

- [ ] **Step 7: Commit**

```bash
git add PUNCHLIST.md DECISIONS.md docs/superpowers/plans
git commit -m "docs: punchlist #23 done + #22 mine/all shipped, D122, roadmap plan-05 built — wave 1 complete"
```

---

## Self-Review (done at authoring time)

- **Spec coverage (§3 #23/#22 + brief + PUNCHLIST 23/22):** #23 — `CustomFieldDef` exact shape (stable slug id auto-from-label immutable-after, label ≤60, five kinds, select options ≤20×≤40, appliesTo subset with []=all) ✓ (Task 1); optional `customerFieldDefs` key with FULL-REPLACEMENT semantics documented on the field comment, `resolveFieldDefs = stored ?? []`, cap 30, pure zero-import module with `slugifyFieldId`/`defsForType`/`validateFieldValues` (unknown-stripped, number coerce-or-drop, date epoch-ms, select-in-options, checkbox boolean, null clears)/`validateFieldDefs` (dup ids, caps, select-without-options) — all spec-pinned ✓ (Task 1); `companies.custom` jsonb migration 0011 via `npm run db:generate` + dev-restart-before-live-writes ✓ (Task 2); store plumbing — CustomerDoc/CustomerRecordInput gain the three fields, composeDoc surfaces all three, writeRecord WRITE-WHEN-PROVIDED / PRESERVE-WHEN-UNDEFINED with the :437-438 hard-preserve lines replaced, companyFacts gains lifecycle (harmless to the board) ✓ (Task 2); `saveCustomerFieldDefsAction` requirePerm("manage_users") + server validate-and-throw + setSettings + revalidatePath, Settings admin card seeded from resolved defs with add/remove/edit rows (label, kind select, options textarea, appliesTo checkboxes), sort-ONCE-on-mount, id read-only once created ✓ (Task 3); SaveCustomerInput + modal Details section (lifecycle select from verified `LIFECYCLES`/`LIFECYCLE_LABEL`, keywords chip editor client-local, `defsForType` re-derived on type change, all five input kinds, date via the toDateInput/fromDateInput idiom), defs as serializable props from BOTH mounts (companies edit=new + [id] edit=1), saveCustomerAction server-side validation (lifecycle allowlist unknown→ignore, keywords trim/dedupe-ci/cap 20/each ≤40, custom via validateFieldValues against live defs) ✓ (Task 4); display — lifecycle pill + keyword chips by the type pill, Details card right-column above Contacts (dateYear dates, Yes/No checkboxes, hidden when empty), the plan-02 `kw` filter going live called out in the drive ✓ (Task 4); `?added=7d` allowlisted strip-default + FilterBar "New (7d)" chip with count over the scoped set ✓ (Task 4). #22 — leads `?who=` mirroring quotes (canonicalization, strip-default, hrefFor carries who across view/seg/lead, toolbar My work/Everyone + OwnerSelect with server-prebuilt hrefs), STRICT owner match with unassigned deliberately excluded, scope applied to the full set BEFORE view/seg logic, all counts re-derived locally (metrics() has no owner opt — verified; the local `m` mirrors its formulas field-for-field incl. sla/needsFollowUp/conversion) ✓ (Task 5); won/lost split via a new dependency-free `segs.ts` (SEG_KEYS spec-pinned; legacy seg=closed → "all"; grep confirmed zero hardcoded closed links) ✓; projects `?who=` + strip-default + scoped array into ProjectsView (view.tsx:249-253 filtering then operates on scoped input), threading through qs/filterHref/cardHref/tabHref + plan-02 board toggle + board card hrefs + [id] back-link, boardProjects receives the scoped array, DEFAULT_ACTOR wrinkle flagged-not-fixed ✓; nav children exactly `myquotes/myleads/myprojects` after their base entries, NO activeKeyFor changes, no nav-counts keys, overlay-close limitation logged and useSearchParams explicitly declined (Nav is a client component in the layout — dynamic-rendering risk the brief warned about) ✓; specs — customer-fields pure fns + SEG_KEYS exact list + nav-child hrefs, no `scopeByOwner` extraction (a one-line filter didn't earn a module; the brief's "only if it helps testing" test) ✓ (Tasks 1/5); gates 510-PASS/71-error baselines (both verified by RUNNING them), D106 build ordering, live drive incl. regression sweep of plans 02–04 surfaces, PUNCHLIST #23/#22 + D122 + roadmap wave-① flip ✓ (Task 6).
- **contentKey participation check (brief-mandated):** the three new fields are NOT in META_KEYS, so they serialize into `contentKey` — a custom/keywords/lifecycle-only edit compares different from `prev` and passes the early-return at writeRecord's top (:427). Beyond mere participation, the plan had to CANONICALIZE: composeDoc always emits the three while normalizeRecord emits only what was provided, so key insertion order (and jsonb key-order round-trips for `custom`) would otherwise make equal content compare unequal, silently breaking the D83 "updatedAt only moves on real change" contract for every legacy writer. Fix: writeRecord backfills undefined fields from the existing row BEFORE the compare, and contentKey pins position/defaults/sorted-custom-keys.
- **convert.ts-behavior-unchanged check (brief-mandated):** the brief's "convert.ts" is really TWO writers, both verified safe: (1) `src/lib/identity/convert.ts` (D85 bootstrap) never calls `upsert()` — it writes `saveCompany` directly with its own lifecycle heuristic and `keywords: []`; it is untouched, its insert takes the new column's `{}` default, and its `onConflictDoUpdate` spreads only its own row fields so `custom` is never clobbered. (2) `leads.convert()` (`stores/leads.ts:692`) goes through `upsertCustomer` passing NO new fields → undefined → backfilled-preserve path → byte-identical company writes AND a still-firing no-change early-return. Same holds for `import/registry.ts:76/:104` and `setDirectory`/seed.
- **Deviations from the brief (all deliberate):**
  - **contentKey canonicalization + pre-compare backfill** (above) — the brief asked only that new fields "participate in contentKey" and that preserve lines become write-when-provided ternaries; done literally, every legacy save would have compared unequal (spurious updatedAt advances) — the backfill happens once before the compare, and the saveCompany lines then read `rec.* ?? default`.
  - **`lib/identity/convert.ts` needs no edit at all** — the brief implied it was an upsert caller; it is not (see the check above).
  - **`saveCustomerFieldDefsAction` lives in `settings/actions.ts`** (not companies/actions.ts) — the card is a Settings surface and that file already owns the requirePerm+setSettings pattern; ids are minted IN the action (slugifyFieldId against taken ids) because "auto from label at create" must be server-authoritative.
  - **Card placement:** the settings page renders ONE `SettingsClient` with client-side `?section=` switching — the card mounts inside the Admin section via a new prop (the brief just said "Settings page gets a card"); it is `key`-ed by the saved id set so the post-save refresh remounts it with minted ids (otherwise a relabel-then-resave could re-mint and orphan values).
  - **Field kind locks after create** (select disabled once id exists) — not in the brief; changing a kind under stored values would corrupt typed reads.
  - **Custom date values store local MIDNIGHT** — the lead-drawer's `fromDateInput` 9:00 is a follow-up-scheduling default, wrong for generic data fields; helpers are local to the modal (the drawer's are unexported).
  - **`validateFieldValues` also trims/caps text (≤500) and treats whitespace-only text as null** — the mandatory per-writer size-cap rule; empty-after-trim behaving like a clear matches the modal's `value || null` inputs.
  - **OwnerSelect extracted to `components/owner-select.tsx` with a quotes re-export shim** — the brief said "the quotes idiom" without reuse mechanics; a verbatim move + re-export keeps /quotes byte-compatible with one source of truth.
  - **Leads: metrics() import dropped entirely; a local `m` object with the same field names replaces it** — so all downstream render code (tiles, standfirst, segDefs) is untouched; `openLeads` naming collision with the worklist section avoided via `openList`.
  - **Leads drawer + projects detail resolve deep links UNSCOPED** — not in the brief: with a scoped `all`, `?lead=<other-owner>` would have fallen into the "new lead" form and an out-of-scope project 404'd.
  - **Leads owner toolbar lives in the shared `Heading`** (renders on board/worklist/table alike) — the scope applies to all three views, so the control must too.
  - **Projects: the won-ready `pending` strip is also who-scoped** — unscoped it would show other people's won quotes under "My projects".
  - **Projects owner toolbar renders on the index only** (`!sel`) — the detail keeps its scoped back-link; adding the toolbar to the split detail header wasn't worth the layout churn.
  - **`unassignedList` under a scope is literally `[]`** (owner "" can never equal a name) — written as the honest constant with a comment, not a dead filter.
  - **FIVE existing harness assertions edited** (EST/CRM/PM exact-children lists at ~:323/:330/:393/:401/:1144) — the brief didn't flag that the D99/D117 sections pin children exactly; without these edits the suite goes red on the nav change.
  - **"New (7d)" count is computed over the q/type/scope-filtered set excluding its own filter** (`preAdded`) — a toggle whose count changed to its own result would be useless.
  - **appliesTo is NOT validated against CUSTOMER_TYPES** in the pure module (config-not-schema philosophy; keeps customer-fields.ts zero-import) — the ACTION filters falsy entries only; unknown types never match, harmlessly.
- **PUNCHLIST overrides applied (Jeff-answered sub-decisions supersede brief defaults):** item 23 **D (stored owner) and E (createdAt/updatedAt) are Jeff-answered DONE (2026-07-19, D83)** — this plan BUILDS ON them (added-7d filters the D83 `createdAt`; no re-implementation; the D+E write-up's "only sees customers created from here forward" caveat is CORRECTED — not carried — in the live drive and the close-out: post-D85 the converter stamps legacy rows with the conversion run time and composeDoc always copies the notNull column, so legacy rows read as new for a week after any reseed/bootstrap) — and **A (lifecycle) + B (keywords) reduced to UI-only work because D85 already landed the columns** (the plan composes/authors them, adds no schema). Item 23's status line "C (custom fields) still waits on the export audit" is **superseded by spec §3** ("decided without waiting for the export audit — the Daylite CSV stays wanted as an audit input, homework") — the spec is the stated authority and the brief follows it; noted in the close-out. Item 22's A–D carry no Jeff-answered PUNCHLIST overrides — the spec answers them (A: scoped nav entries first; B: per-person deferred; C: Learn→Knowledge wave ④; D: team calendar §7 — both out of scope here), so no brief default was displaced.
- **Repo facts that contradicted the brief (plan cites actual code):** PUNCHLIST item **22 heading is at :1644 and item 23 at :1714** (brief said ~1564+/~1634+); `lib/identity/convert.ts` is **not an upsert() caller** (see the dedicated check) — the real legacy upsert callers are leads.convert (:692), import/registry (:76/:104), saveCustomerAction and setDirectory/seed; the harness **pins EST/CRM/PM children exactly** (five assertions to edit — brief unflagged); `LIFECYCLE_LABEL.none` is `"—"` (the modal shows "— None —" instead); the companies Mine/All segmented control sits at controls.tsx:153-161 (brief said :155-164) and quotes `hrefFor` starts at page.tsx:138 (brief said :143) — both cosmetic drift; everything else verified exact: customers.ts anchors (CustomerDoc :93-115, META_KEYS :118, CustomerRecordInput :143-152, composeDoc :266-295, contentKey :402-406, writeRecord :422-553 w/ early-return :427 + preserve lines :437-447, upsert :576-582, companyFacts :726-734), LIFECYCLES literals `prospect/customer/past/none` (exported, previously unused), leads SegKey :50 / seg filter :349-356 / view-toggle-resets-seg :148 / followUps owner opt :391 / metrics unscoped :431, projects FILTERS data.ts:51 / view.tsx filtering :249-253 / qs :173 / board hrefs :291/:556 / tabHref :794 / backHref :801, quotes who idiom + OwnerSelect controls.tsx:238, nav children rendered verbatim w/ counts by child key (Nav.tsx:224-232, drawer :729), overlay-close [pathname] effect Nav.tsx:128-134, opportunities kw latency note page.tsx:207-208, drizzle latest 0010 (0011 free), D121 last (D122 free), **510 PASS and 71 lint errors verified by running both**, `dateYear` exists in lib/format.ts:30, settings admin section at settings-client.tsx:1382, `custom` column absent from schema (companies :84-114 ends at referredByContactId/deleted/timestamps).
- **Name/type consistency:** `CustomFieldDef`/`FieldKind`/`CustomFieldValues`/`FIELD_KINDS`/`MAX_FIELD_DEFS`/`resolveFieldDefs`/`slugifyFieldId`/`defsForType`/`validateFieldValues`/`validateFieldDefs` match across Tasks 1/3/4 and the specs; `CustomerFieldDefInput` → action → `CustomFieldDef` mapping typed end-to-end; `SaveCustomerInput.lifecycle/keywords/custom` → `saveCustomerAction` extras → `CustomerRecordInput` → `writeRecord` → `saveCompany.custom` all structurally aligned with the schema's `$type`; `SegKey`/`SEG_KEYS` single-sourced from `segs.ts` (page + harness); `OwnerSelect` value/options contract identical at all three call sites; `ProjectsView`/`ProjectDetail` `who: string` + `meName: string` threaded from both routes; `companyFacts` widened value remains assignable to `opportunities.CompanyFacts` (method-bivariant Map).
- **Placeholder scan:** the only ellipsis inside a code block is the explicitly-labeled `{/* …existing Admin links card, byte-identical… */}` marker in Task 3 Step 3 — an anchored DO-NOT-TOUCH region, not an omission; every other code step carries complete code or an exact old→new edit.
- **Client-bundle audit:** new/modified client files import only pure modules + server-action stubs: `customer-fields-card.tsx` → customer-fields (pure) + companies/lib (client-safe per its header) + settings actions stub; `edit-modal.tsx` adds customer-fields + identity/config (both dependency-free); `owner-select.tsx` → next/navigation only; `controls.tsx` (companies) unchanged imports. Server-only reads (`getSettings`, stores) stay in server pages/actions. `segs.ts` is import-free.
- **TZ-safe spec check:** every new timestamp literal is built from local Date parts (`new Date(2026, 6, 20).getTime()` passthrough); no locale-formatted string is asserted anywhere in the new sections; SEG/nav assertions are pure string literals.
