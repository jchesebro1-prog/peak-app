/**
 * Server-side import registry — the WRITER + live-count + export layer behind
 * the Import hub. Ported from `importkit.js` commit/count/export, but each type
 * calls the real ported store (read-only for counts/exports; create/upsert for
 * writes). This module is server-only (imports stores) — never import it into a
 * client component; the client preview uses `./types` + `./parse` instead.
 */

import * as Customers from "@/lib/stores/customers";
import * as Leads from "@/lib/stores/leads";
import * as Flame from "@/lib/stores/flame-jobs";
import * as Inspections from "@/lib/stores/inspections";
import * as Surveys from "@/lib/stores/surveys";
import * as Quotes from "@/lib/stores/quotes";
import * as Projects from "@/lib/stores/projects";
import * as Catalog from "@/lib/stores/catalog";
import * as Equipment from "@/lib/stores/equipment-items";
import * as TaskTemplates from "@/lib/stores/task-templates";
import { allUsers, addUser, setRoles, activeUsers } from "@/lib/users";
import type { Role } from "@/lib/team";
import { getSettings, mergedConsultingDisciplines } from "@/lib/settings";
import { mergedConsultingPhases } from "@/lib/stores/engagements";
import { getTypeMeta, IMPORT_TYPE_KEYS, type ImportTypeMeta } from "./types";
import { norm, isoToMs, visibleColumns, type FieldDef, type PreparedRow } from "./parse";
import { baseVenueKind } from "@/lib/identity/venue-defaults";
import {
  matchContact,
  matchLocation,
  mergeContact,
  mergeLocation,
  parseYesNo,
  resolveCustomerForRow,
  type CustomerRef,
} from "./link";

const YEAR = 365 * 86400000;

type Values = Record<string, string | number>;

function str(v: unknown): string {
  return v == null ? "" : String(v).trim();
}
function num(v: unknown): number {
  if (typeof v === "number") return v;
  const n = parseFloat(String(v ?? "").replace(/[^0-9.\-]/g, ""));
  return isNaN(n) ? 0 : n;
}
function ci(a: unknown, b: unknown): boolean {
  return norm(a) === norm(b) && norm(a) !== "";
}
function pick<T extends string>(v: unknown, opts: readonly T[], fb: T): T {
  const s = str(v);
  return (opts as readonly string[]).indexOf(s) >= 0 ? (s as T) : fb;
}

export type ImportMode = "skip" | "update" | "create";

export type ImportResult = {
  created: number;
  updated: number;
  skipped: number;
  errored: number;
  total: number;
  /** The rows behind `created + updated` — what this commit actually wrote.
   *  The catalog commit stamps each manufacturer's book date from these
   *  (D156, final review item 1), so a group nothing was written for is
   *  never confirmed. References to the caller's own rows, no copies. */
  written: PreparedRow[];
  /** The rows behind `errored` (invalid, or the write threw). */
  failed: PreparedRow[];
  /** #137 — contacts/venues link-back: customers auto-created for unmatched
   *  rows, and rows that linked to an existing customer. */
  customersCreated: number;
  customersLinked: number;
  /** #145 D169 — non-blocking per-row notices. Only the task_templates
   *  writer populates this (an unrecognized Phase or Discipline against the
   *  live consulting lists) — the row still commits; nothing here excludes
   *  it. Every other writer leaves this empty. */
  warnings: string[];
};

/** #133 — per-commit context handed to every writer; the catalog writer
 *  reads `effectiveAt` (the price list's effective date for `pricedAt`);
 *  the task_templates writer reads `me` for `createdBy` on a set it mints
 *  (#145 D169) — optional because scripts/regression callers (and the
 *  catalog path, which never creates a set) have no session to hand it. */
export type CommitContext = { effectiveAt: number; me?: { name: string } };

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
 * appends a lightweight marker back into that cache (the customers writer
 * re-reads the written record instead, so later rows merge into it). `ctx` is
 * the commit's context (#133); `link` is its running link-back tally — only
 * the #137 link-back writers touch it.
 */
type Writer = {
  count: () => Promise<number>;
  load: () => Promise<Record<string, unknown>[]>;
  find: (values: Values, cache: Record<string, unknown>[]) => Record<string, unknown> | null;
  /** A writer may return a list of non-blocking warning strings for the row
   *  it just wrote (#145 D169) — `void`/nothing (every writer but
   *  task_templates) means "nothing to report." */
  create: (
    values: Values,
    cache: Record<string, unknown>[],
    ctx: CommitContext,
    link: LinkStats
  ) => Promise<void | string[]>;
  update?: (
    existing: Record<string, unknown>,
    values: Values,
    cache: Record<string, unknown>[],
    ctx: CommitContext,
    link: LinkStats
  ) => Promise<void | string[]>;
  exportObjects: () => Promise<Values[]>;
};

let seqN = 0;
function seq(): number {
  return ++seqN;
}

const EQUIPMENT_CATEGORIES = [
  "speakers",
  "monitors",
  "lighting",
  "consoles",
  "control-io",
  "other",
] as const;

/**
 * The patch the catalog writer hands `Catalog.mergeUpsert`, shared by its
 * create and update paths. Pure — it touches no store — so the merge
 * semantics are unit-testable without a database (scripts/test-review-and-spec.ts).
 *
 * `ex` is the part already in the catalog — null only when the SKU is brand
 * new (the create path looks it up too, since "Create new" on an existing
 * SKU is a merge into that document).
 *
 * Every field falls back to what the part already holds before falling back to
 * a default, because a vendor price sheet is allowed to omit columns: neither
 * `list` nor `cost` is required, and prepareRows coerces an absent column or a
 * blank cell to 0, so `num(v.cost)` alone would silently zero a stored dealer
 * cost on every "Update existing" re-import — and catalog cost feeds tier
 * pricing and the estimator. `num(v.x) || num(ex.x)` is the same shape the
 * leads (`value`) and quotes (`value`) writers use above.
 *
 * `mfr` is omitted entirely when neither side carries one: mergeUpsert spreads
 * the patch over the existing part, so an explicitly-passed `undefined` would
 * CLEAR a stored manufacturer rather than leave it alone.
 *
 * Known limitation: `coerce()` in `./parse` maps an absent column, a blank
 * cell, AND a literal "0" to the same coerced value, 0 — so `num(v.x) ||
 * num(ex.x)` cannot tell "column not in this sheet" apart from "vendor
 * priced this at zero." A row that legitimately zeroes `list` or `cost`
 * will silently keep the part's old price instead. That's the accepted
 * trade: failing toward preserving existing data rather than destroying it
 * on a sparse re-import, the same choice the `leads` and `quotes` writers
 * above make for their own numeric fields. Fixing it isn't possible in this
 * patch shape alone — `prepareRows` would need to carry "column absent" as
 * a distinct value (e.g. `undefined`) instead of collapsing it to 0 before
 * it ever reaches here.
 */
export function catalogPatch(
  v: Values,
  ex: Record<string, unknown> | null,
  sku: string
): Partial<Omit<Catalog.CatalogPart, "id" | "sku">> {
  const e = ex ?? {};
  const mfr = str(v.mfr) || str(e.mfr);
  return {
    desc: str(v.desc) || str(e.desc) || sku,
    category: str(v.category) || str(e.category) || "Uncategorized",
    unit: str(v.unit) || str(e.unit) || "ea",
    list: num(v.list) || num(e.list),
    cost: num(v.cost) || num(e.cost),
    ...(mfr ? { mfr } : {}),
  };
}

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
 * Address/City/State/Zip merge into the customer's UNNAMED mailing venue —
 * the primary venue on a customer that has no named one, i.e. the address
 * the UI, travel and quotes use, as this importer always did — but without
 * replacing the customer's other venues, and never onto a NAMED venue, whose
 * street address nothing else holds (#137 C1b; `mergeLocation` appends a new
 * unnamed venue instead). Zip also stamps the company row; and the legacy
 * embedded Contact Name / Email / Phone columns still land as a contact
 * (D158).
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
      // claimBlank "any": unlike a venues row, this row genuinely IS the
      // customer's address venue, so a legacy file's Venue column may name
      // the unnamed primary venue even once it carries an address (#137 C1).
      { preferPrimary: true, claimBlank: "any", venueKind: baseVenueKind(type, name) ?? "proscenium" }
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

/**
 * Resolve the customer a contacts / venues row belongs to, creating a bare
 * one (`{ name, type: Customer Category column ?? "" }`) when neither the
 * id nor the normalized name matches — and pushing it into the cache so the
 * rest of the file links to the same record (D158). Returns the customer as
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

/** One venues row → the customer's locations, merged by normalized label
 *  (a labelled row claims the unnamed base venue first, but only a TRUE
 *  placeholder — `claimBlank: "unaddressed"`, #137 C1: an unnamed venue that
 *  already carries an address is the customer's mailing address, so the row
 *  appends beside it instead of overwriting it, and that appended venue —
 *  the customer's first named one — takes primary from the placeholder,
 *  #137 I3; a blank-label row — #137 T6 review, a round-tripped export of an
 *  addressed D85 base venue — targets the unnamed primary venue directly via
 *  mergeLocation's preferPrimary). */
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
    { preferPrimary: true, claimBlank: "unaddressed" }
  );
  await Customers.upsert({ ...recordInputOf(cust), locations });
}

/* ---------------- #145 D169 task-templates CSV plumbing ---------------- */

/** #145 D169 — "team" | "role:<Role>" | "person:<Name>". An unresolvable
 *  person falls back to team: a task assigned to nobody is worse than a
 *  task assigned to everybody, because nobody notices it. */
export function parseAssignTarget(
  raw: string,
  users: ReadonlyArray<{ id: string; name: string }>
): TaskTemplates.TemplateAssignTarget {
  const v = String(raw || "").trim();
  if (!v || v.toLowerCase() === "team") return { kind: "team" };
  const [head, ...rest] = v.split(":");
  const tail = rest.join(":").trim();
  if (head.trim().toLowerCase() === "role" && tail) return { kind: "role", role: tail as Role };
  if (head.trim().toLowerCase() === "person" && tail) {
    const u = users.find((u) => u.name.trim().toLowerCase() === tail.toLowerCase());
    return u ? { kind: "person", userId: u.id } : { kind: "team" };
  }
  return { kind: "team" };
}

/** The reverse of `parseAssignTarget`, for `exportObjects` (round-trip). */
function assignTargetToCell(
  target: TaskTemplates.TemplateAssignTarget,
  nameById: Map<string, string>
): string {
  if (target.kind === "role") return "role:" + target.role;
  if (target.kind === "person") return "person:" + (nameById.get(target.userId) || "");
  return "team";
}

/** "Applies To" is one cell but the store wants `TemplateRecordKind[]` —
 *  same join/split idiom as the `team` writer's Roles column. Unrecognized
 *  tokens are dropped rather than rejected (#145 D169 decision 3: match the
 *  registry's existing leniency for enum-ish free text rather than invent
 *  stricter handling). */
function parseAppliesTo(raw: unknown): TaskTemplates.TemplateRecordKind[] {
  const picked = String(raw ?? "")
    .split(/[,;/|]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .filter((s): s is TaskTemplates.TemplateRecordKind =>
      (TaskTemplates.TEMPLATE_RECORD_KINDS as readonly string[]).includes(s)
    );
  return Array.from(new Set(picked));
}

/** One CSV row -> one template line. `normalizeLine` clamps the percents,
 *  lowercases the discipline, and mints the line's stable `key` — the same
 *  helper the admin editor and the spec harness use (Task 3). */
function taskTemplateLineFromRow(
  v: Values,
  users: ReadonlyArray<{ id: string; name: string }>
): TaskTemplates.TaskTemplateLine {
  return TaskTemplates.normalizeLine({
    title: str(v.task),
    section: str(v.section),
    target: parseAssignTarget(str(v.assignTo), users),
    phase: str(v.phase),
    discipline: str(v.discipline),
    startPct: num(v.startPct),
    lengthPct: num(v.lengthPct),
  });
}

/** Per-commit scratch state stashed directly on the `cache` array the
 *  generic `commitImport` loop already threads through every `find` /
 *  `create` / `update` call for this writer — the same idiom `refreshCache`
 *  and `LinkStats.createdIds` use elsewhere in this file, just local to this
 *  writer instead of shared through the generic `Writer` signature. */
type TaskTemplateBag = TaskTemplates.TaskTemplateSetRecord[] & {
  __ttTouched?: Set<string>;
  __ttCreatedThisCommit?: Set<string>;
  __ttUsers?: Array<{ id: string; name: string }>;
  __ttLive?: { phases: string[]; disciplines: string[] };
};

/** Sets whose `lines`/`appliesTo` this commit has already started rebuilding
 *  from scratch — the first row for a set (new OR pre-existing) wipes; every
 *  later row for the same set in the same file appends. */
function ttTouched(cache: Record<string, unknown>[]): Set<string> {
  const c = cache as TaskTemplateBag;
  if (!c.__ttTouched) c.__ttTouched = new Set<string>();
  return c.__ttTouched;
}

/** Sets minted DURING this commit. `find` hides these from the generic
 *  skip/update dispatch (below) so "skip" mode skips only a set that
 *  existed before the file was opened — never a multi-line set this same
 *  file is still in the middle of creating (which `find` would otherwise
 *  also match on row 2+, since the fresh record is already sitting in
 *  `cache`). */
function ttCreatedThisCommit(cache: Record<string, unknown>[]): Set<string> {
  const c = cache as TaskTemplateBag;
  if (!c.__ttCreatedThisCommit) c.__ttCreatedThisCommit = new Set<string>();
  return c.__ttCreatedThisCommit;
}

async function ttActiveUsers(cache: Record<string, unknown>[]): Promise<Array<{ id: string; name: string }>> {
  const c = cache as TaskTemplateBag;
  if (!c.__ttUsers) c.__ttUsers = (await activeUsers()).map((u) => ({ id: u.id, name: u.name }));
  return c.__ttUsers;
}

/** #145 D169 decision 3 — the live phase (engagements settings) and
 *  discipline (app settings) lists, fetched once per commit. Used only to
 *  produce a non-blocking warning; nothing here can fail a row. */
async function ttLiveLists(cache: Record<string, unknown>[]): Promise<{ phases: string[]; disciplines: string[] }> {
  const c = cache as TaskTemplateBag;
  if (!c.__ttLive) {
    const settings = await getSettings();
    c.__ttLive = {
      phases: mergedConsultingPhases(settings.consultingPhases).map((p) => p.toLowerCase()),
      disciplines: mergedConsultingDisciplines(settings.consultingDisciplines).map((d) => d.toLowerCase()),
    };
  }
  return c.__ttLive;
}

/** Non-blocking notices for one row: an unrecognized Phase or Discipline
 *  against the live lists. Blank is never unknown — blank Discipline means
 *  "every discipline" and blank Phase means the line just doesn't expand
 *  into a schedule; neither is a typo to flag. The row is written either
 *  way (#145 D169 decision 3). */
function ttRowWarnings(v: Values, live: { phases: string[]; disciplines: string[] }): string[] {
  const warnings: string[] = [];
  const phase = str(v.phase);
  if (phase && !live.phases.includes(phase.toLowerCase())) {
    warnings.push(`unknown phase "${phase}" — not in the current consulting phase list`);
  }
  const discipline = str(v.discipline);
  if (discipline && !live.disciplines.includes(discipline.toLowerCase())) {
    warnings.push(`unknown discipline "${discipline}" — not in the current consulting discipline list`);
  }
  return warnings;
}

/** Wipe-on-first-touch, append-after, for both `lines` and `appliesTo` — the
 *  shared body of `create` and `update` below (#145 D169 decision 1: import
 *  is replace-by-set, so a set's DB-stored lines that aren't in this file
 *  must not survive the commit). Mutates `rec` in place (same idiom as
 *  `refreshCache`) so the NEXT row for the same set sees the accumulated
 *  result via the shared `cache` array, and persists the whole accumulated
 *  array on every row — the last row for a set leaves the DB holding
 *  exactly the file's lines for it, no more, no less. */
async function ttApplyRow(
  rec: TaskTemplates.TaskTemplateSetRecord,
  v: Values,
  cache: Record<string, unknown>[]
): Promise<string[]> {
  const users = await ttActiveUsers(cache);
  const line = taskTemplateLineFromRow(v, users);
  const rowApplies = parseAppliesTo(v.appliesTo);
  const touched = ttTouched(cache);
  if (!touched.has(rec.id)) {
    touched.add(rec.id);
    rec.lines = [line];
    rec.appliesTo = rowApplies;
  } else {
    rec.lines = [...rec.lines, line];
    rec.appliesTo = Array.from(new Set([...rec.appliesTo, ...rowApplies]));
  }
  const saved = await TaskTemplates.updateTaskTemplateSet(rec.id, {
    lines: rec.lines,
    appliesTo: rec.appliesTo,
  });
  if (saved) Object.assign(rec, saved);
  return ttRowWarnings(v, await ttLiveLists(cache));
}

const WRITERS: Record<string, Writer> = {
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
        };
      });
    },
  },

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
    create: async (v, cache, _ctx, link) => {
      const cust = await linkCustomer(v, cache, link);
      await writeContactRow(cust, v);
      await refreshCache(cache, cust.id);
    },
    update: async (ex, v, cache, _ctx, link) => {
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
        }))
      );
    },
  },

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
    create: async (v, cache, _ctx, link) => {
      const cust = await linkCustomer(v, cache, link);
      await writeVenueRow(cust, v);
      await refreshCache(cache, cust.id);
    },
    update: async (ex, v, cache, _ctx, link) => {
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
          }))
      );
    },
  },

  leads: {
    count: async () => (await Leads.getAll()).length,
    load: async () => (await Leads.getAll()) as unknown as Record<string, unknown>[],
    find: (v, cache) =>
      cache.find((l) => ci(l.org, v.org) && (!v.email || ci(l.email, v.email))) || null,
    create: async (v, cache) => {
      const rec = await Leads.create({
        org: str(v.org),
        contact: str(v.contact),
        email: str(v.email),
        phone: str(v.phone),
        city: str(v.city),
        state: str(v.state) || "WI",
        source: pick(v.source, ["website", "referral", "phone", "manual", "event", "existing"] as const, "manual"),
        interest: str(v.interest),
        value: num(v.value),
      });
      const stage = pick(v.stage, ["new", "contacted", "qualified", "quoted", "won", "lost"] as const, "new");
      if (stage !== "new") await Leads.update(rec.id, { stage });
      cache.push({ id: rec.id, org: str(v.org), email: str(v.email) });
    },
    update: async (ex, v) => {
      const stage = pick(v.stage, ["new", "contacted", "qualified", "quoted", "won", "lost"] as const, "new");
      await Leads.update(str(ex.id), {
        contact: str(v.contact) || str(ex.contact),
        email: str(v.email) || str(ex.email),
        phone: str(v.phone) || str(ex.phone),
        interest: str(v.interest) || str(ex.interest),
        value: num(v.value) || num(ex.value),
        ...(str(v.stage) ? { stage } : {}),
      });
    },
    exportObjects: async () => {
      const list = await Leads.getAll();
      return list.map((l) => ({
        org: l.org || "",
        contact: l.contact || "",
        email: l.email || "",
        phone: l.phone || "",
        city: l.city || "",
        state: l.state || "",
        source: l.source || "",
        interest: l.interest || "",
        value: l.value || 0,
        stage: l.stage || "",
      }));
    },
  },

  flametests: {
    count: async () => (await Flame.getAll()).length,
    load: async () => (await Flame.getAll()) as unknown as Record<string, unknown>[],
    find: (v, cache) =>
      cache.find((j) => ci(j.customer, v.customer) && ci(j.venue || "", v.venue || "")) || null,
    create: async (v, cache) => {
      const completedAt = isoToMs(str(v.completedDate)) ?? Date.now();
      await Flame.create({
        customer: str(v.customer),
        venue: str(v.venue),
        curtainsTotal: num(v.curtains),
        contact: v.contact ? { name: str(v.contact), email: str(v.email) } : null,
        stage: "completed",
        completedAt,
        dueAt: completedAt + YEAR,
        results: {
          overall: "pass",
          cert: str(v.certNo),
          performedBy: "",
          method: "",
          venues: [],
          notes: str(v.notes),
        },
      });
      cache.push({ customer: str(v.customer), venue: str(v.venue) });
    },
    exportObjects: async () => {
      const list = await Flame.getAll();
      return list.map((j) => {
        const r = j.results;
        return {
          customer: j.customer || "",
          venue: j.venue || "",
          contact: j.contact?.name || "",
          email: j.contact?.email || "",
          curtains: j.curtainsTotal || 0,
          passed: "",
          completedDate: j.completedAt ? isoOf(j.completedAt) : "",
          certNo: r?.cert || "",
          notes: r?.notes || "",
        };
      });
    },
  },

  inspections: {
    count: async () => (await Inspections.getAll()).length,
    load: async () => (await Inspections.getAll()) as unknown as Record<string, unknown>[],
    find: (v, cache) =>
      cache.find(
        (s) =>
          ci(s.customer, v.customer) &&
          ci(s.venue || "", v.venue || "") &&
          (!v.surveyDate || str(s.surveyDate) === str(v.surveyDate))
      ) || null,
    create: async (v, cache) => {
      await Inspections.create({
        customer: str(v.customer),
        venue: str(v.venue),
        venueType: str(v.venueType) || "Proscenium theater",
        address: str(v.address),
        contact: str(v.contact),
        contactEmail: str(v.email),
        inspector: str(v.inspector),
        surveyDate: str(v.surveyDate),
        stage: pick(v.stage, ["requested", "scheduled", "onsite", "completed"] as const, str(v.surveyDate) ? "completed" : "requested"),
      });
      cache.push({ customer: str(v.customer), venue: str(v.venue), surveyDate: str(v.surveyDate) });
    },
    exportObjects: async () => {
      const list = await Inspections.getAll();
      return list.map((s) => ({
        customer: s.customer || "",
        venue: s.venue || "",
        venueType: s.venueType || "",
        address: s.address || "",
        contact: s.contact || "",
        email: s.contactEmail || "",
        inspector: s.inspector || "",
        surveyDate: s.surveyDate || "",
        stage: s.stage || "",
      }));
    },
  },

  surveys: {
    count: async () => (await Surveys.getAll()).length,
    load: async () => (await Surveys.getAll()) as unknown as Record<string, unknown>[],
    find: (v, cache) =>
      cache.find((s) => ci(s.customer, v.customer) && ci(s.venue || "", v.venue || "")) || null,
    create: async (v, cache) => {
      await Surveys.create({
        customer: str(v.customer),
        venue: str(v.venue),
        venueType: str(v.venueType) || "Proscenium theater",
        address: str(v.address),
        contact: str(v.contact),
        contactEmail: str(v.email),
        visitType: str(v.visitType),
        reason: str(v.reason),
        stage: pick(v.stage, ["requested", "scheduled", "onsite", "completed"] as const, "requested"),
      });
      cache.push({ customer: str(v.customer), venue: str(v.venue) });
    },
    exportObjects: async () => {
      const list = await Surveys.getAll();
      return list.map((s) => ({
        customer: s.customer || "",
        venue: s.venue || "",
        venueType: s.venueType || "",
        address: s.address || "",
        contact: s.contact || "",
        email: s.contactEmail || "",
        visitType: s.visitType || "",
        reason: s.reason || "",
        stage: s.stage || "",
      }));
    },
  },

  team: {
    count: async () => (await allUsers()).length,
    load: async () => (await allUsers()) as unknown as Record<string, unknown>[],
    find: (v, cache) =>
      cache.find((u) => (v.email && ci(u.email, v.email)) || ci(u.name, v.name)) || null,
    create: async (v, cache) => {
      const roles = rolesFrom(str(v.roles));
      await addUser({
        name: str(v.name),
        email: str(v.email),
        googleEmail: str(v.googleEmail),
        roles,
      });
      cache.push({ name: str(v.name), email: str(v.email) });
    },
    update: async (ex, v) => {
      await setRoles(str(ex.id), rolesFrom(str(v.roles)));
    },
    exportObjects: async () => {
      const list = await allUsers();
      return list.map((u) => ({
        name: u.name || "",
        email: u.email || "",
        roles: (u.roles || []).join(", "),
      }));
    },
  },

  quotes: {
    count: async () => (await Quotes.getAll()).length,
    load: async () => (await Quotes.getAll()) as unknown as Record<string, unknown>[],
    find: (v, cache) =>
      cache.find((q) => ci(q.name, v.name) && (!v.customer || ci(q.customer || "", v.customer))) ||
      null,
    create: async (v, cache) => {
      const rec = await Quotes.create({
        name: str(v.name),
        customer: str(v.customer),
        value: num(v.value),
        quoteType: pick(v.quoteType, ["system", "flame_test", "inspection", "service"] as const, "system"),
      });
      const status = pick(v.status, ["draft", "sent", "won", "lost"] as const, "draft");
      // Punch #60: an imported row records a status the quote already reached
      // in the system it came from — there is no approval record here to check
      // and none to demand. Without the bypass the gate throws on the first
      // won/sent row of a history import.
      if (status !== "draft")
        await Quotes.setStatus(rec.id, status, undefined, {
          bypassApprovalGate: "historical-import",
        });
      cache.push({ id: rec.id, name: str(v.name), customer: str(v.customer) });
    },
    update: async (ex, v) => {
      await Quotes.update(str(ex.id), {
        value: num(v.value) || num(ex.value),
        customer: str(v.customer) || str(ex.customer),
      });
      const status = pick(v.status, ["draft", "sent", "won", "lost"] as const, "draft");
      // Same as the create path above (punch #60): imported history, not an
      // approval decision made in this app.
      if (str(v.status))
        await Quotes.setStatus(str(ex.id), status, undefined, {
          bypassApprovalGate: "historical-import",
        });
    },
    exportObjects: async () => {
      const list = await Quotes.getAll();
      return list.map((q) => ({
        name: q.name || "",
        customer: q.customer || "",
        value: q.value || 0,
        status: q.status || "",
        quoteType: q.quoteType || "",
      }));
    },
  },

  projects: {
    count: async () => (await Projects.getAllProjects()).length,
    load: async () => (await Projects.getAllProjects()) as unknown as Record<string, unknown>[],
    find: (v, cache) => cache.find((p) => ci(p.name, v.name)) || null,
    create: async (v, cache) => {
      const targetMs = isoToMs(str(v.targetDate));
      await Projects.createProject({
        name: str(v.name),
        customer: str(v.customer),
        kind: pick(v.kind, ["project", "order"] as const, "project"),
        value: num(v.value),
        stage: pick(v.stage, ["procurement", "delivery", "scheduled", "install", "training", "signoff", "complete"] as const, "procurement"),
        ...(targetMs ? { targetDate: targetMs } : {}),
      });
      cache.push({ name: str(v.name) });
    },
    exportObjects: async () => {
      const list = await Projects.getAllProjects();
      return list.map((p) => ({
        name: p.name || "",
        customer: p.customer || "",
        kind: p.kind || "",
        value: p.value || 0,
        stage: p.stage || "",
        targetDate: p.targetDate ? isoOf(p.targetDate) : "",
      }));
    },
  },

  catalog: {
    count: async () => (await Catalog.list()).length,
    load: async () => (await Catalog.list()) as unknown as Record<string, unknown>[],
    find: (v, cache) => cache.find((p) => ci(p.sku, v.sku)) || null,
    create: async (v, cache, ctx) => {
      // "Create new" on a SKU that already exists cannot create a second
      // part — the SKU is the document id — so it is a merge like update,
      // and it must preserve prices exactly like update does: with
      // `catalogPatch(v, null, …)` an absent List/Cost column zeroed every
      // overlapping part (final review item 3). The existing record comes
      // from the same cache `find` reads, so an in-file duplicate sees the
      // row written just before it.
      const ex = cache.find((p) => ci(p.sku, v.sku)) || null;
      const sku = ex ? str(ex.sku) : str(v.sku);
      const patch = catalogPatch(v, ex, sku);
      // mergeUpsert is the same entry point scripts/import-catalog.ts uses —
      // it preserves fields a price sheet doesn't carry (ports, trade, spec
      // text, datasheet attachments) when a SKU is re-imported. pricedAt
      // (#133) lands only when the price actually changes.
      await Catalog.mergeUpsert(sku, patch, { pricedAt: ctx.effectiveAt });
      if (ex) Object.assign(ex, patch);
      else cache.push({ id: sku, sku, ...patch });
    },
    // `_cache` is the #137 link-back cache slot every writer now carries —
    // the catalog update path dedupes through `find` alone and reads only ctx.
    update: async (ex, v, _cache, ctx) => {
      const sku = str(ex.sku);
      await Catalog.mergeUpsert(sku, catalogPatch(v, ex, sku), { pricedAt: ctx.effectiveAt });
    },
    exportObjects: async () => {
      const list = await Catalog.list();
      return list.map((p) => ({
        sku: p.sku || "",
        desc: p.desc || "",
        category: p.category || "",
        unit: p.unit || "",
        list: p.list ?? 0,
        cost: p.cost ?? 0,
        mfr: p.mfr || "",
      }));
    },
  },

  equipment: {
    count: async () => (await Equipment.list()).length,
    load: async () => (await Equipment.list()) as unknown as Record<string, unknown>[],
    find: (v, cache) => cache.find((i) => ci(i.sku, v.sku)) || null,
    create: async (v, cache) => {
      const sku = str(v.sku);
      const rec = await Equipment.upsert({
        sku,
        name: str(v.name) || sku,
        category: pick(v.category, EQUIPMENT_CATEGORIES, "other"),
        manufacturer: str(v.manufacturer) || undefined,
        dayRate: num(v.dayRate),
        weekRate: num(v.weekRate),
        monthRate: num(v.monthRate),
        active: true,
        stock: [],
      });
      cache.push({ id: rec.id, sku });
    },
    update: async (ex, v) => {
      const patch: Partial<Omit<Equipment.EquipmentItem, "id">> = {
        name: str(v.name) || str(ex.name),
        manufacturer: str(v.manufacturer) || (str(ex.manufacturer) || undefined),
        dayRate: num(v.dayRate) || num(ex.dayRate),
        weekRate: num(v.weekRate) || num(ex.weekRate),
        monthRate: num(v.monthRate) || num(ex.monthRate),
      };
      // Only overwrite category when the row actually carries one — an
      // absent/blank column would otherwise fall through pick()'s "other"
      // default and silently reclassify the existing item (same reasoning
      // as catalogPatch above for mfr).
      if (str(v.category)) patch.category = pick(v.category, EQUIPMENT_CATEGORIES, "other");
      await Equipment.mergeUpsert(str(ex.id), patch);
    },
    exportObjects: async () => {
      const list = await Equipment.list();
      return list.map((i) => ({
        sku: i.sku || "",
        name: i.name || "",
        category: i.category || "",
        manufacturer: i.manufacturer || "",
        dayRate: i.dayRate ?? 0,
        weekRate: i.weekRate ?? 0,
        monthRate: i.monthRate ?? 0,
      }));
    },
  },

  // #145 D169 — dedupe/write granularity is the SET (by normalized name),
  // not the row: many rows make one set, and every writer above dedupes at
  // the same grain it writes at. `find` only ever matches a set that
  // existed before this commit opened the file (see `ttCreatedThisCommit`
  // in `find` below) — a set this same file is still building stays hidden
  // from it, so "skip" mode's "found → skip, continue" can't truncate a
  // brand-new multi-line set after its first row.
  task_templates: {
    count: async () =>
      (await TaskTemplates.allTaskTemplateSets()).reduce((n, s) => n + s.lines.length, 0),
    load: async () => (await TaskTemplates.allTaskTemplateSets()) as unknown as Record<string, unknown>[],
    find: (v, cache) => {
      const key = norm(str(v.set));
      if (!key) return null;
      const created = ttCreatedThisCommit(cache);
      const sets = cache as unknown as TaskTemplates.TaskTemplateSetRecord[];
      return sets.find((s) => norm(s.name) === key && !created.has(s.id)) ?? null;
    },
    // Reached for a genuinely new set name AND (matching the catalog writer's
    // "Create new on an existing SKU is a merge" precedent) for mode="create"
    // against a name `find` deliberately hid or that already existed —
    // either way this file's rows for that name replace its lines wholesale.
    create: async (v, cache, ctx) => {
      const key = norm(str(v.set));
      const sets = cache as unknown as TaskTemplates.TaskTemplateSetRecord[];
      const match = key ? sets.find((s) => norm(s.name) === key) : undefined;
      if (match) return ttApplyRow(match, v, cache);

      const users = await ttActiveUsers(cache);
      const line = taskTemplateLineFromRow(v, users);
      const appliesTo = parseAppliesTo(v.appliesTo);
      const created = await TaskTemplates.createTaskTemplateSet(
        { name: str(v.set), appliesTo, lines: [line] },
        ctx.me ?? { name: "Import" }
      );
      ttTouched(cache).add(created.id);
      ttCreatedThisCommit(cache).add(created.id);
      sets.push(created);
      return ttRowWarnings(v, await ttLiveLists(cache));
    },
    update: async (existing, v, cache) => ttApplyRow(existing as TaskTemplates.TaskTemplateSetRecord, v, cache),
    exportObjects: async () => {
      const sets = await TaskTemplates.allTaskTemplateSets();
      const users = await allUsers();
      const nameById = new Map(users.map((u) => [u.id, u.name] as const));
      return sets.flatMap((s) =>
        s.lines.map((l) => ({
          set: s.name,
          appliesTo: s.appliesTo.join(", "),
          phase: l.phase,
          discipline: l.discipline,
          task: l.title,
          section: l.section,
          assignTo: assignTargetToCell(l.target, nameById),
          startPct: l.startPct,
          lengthPct: l.lengthPct,
        }))
      );
    },
  },
};

function isoOf(ms: number): string {
  const d = new Date(ms);
  if (isNaN(d.getTime())) return "";
  const p = (n: number) => (n < 10 ? "0" + n : "" + n);
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}

function rolesFrom(rolesStr: string): string[] {
  const ROLES = ["Admin", "Manager", "Estimator", "Reviewer"];
  const picked = String(rolesStr || "")
    .split(/[,;/|]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((r) => ROLES.find((R) => norm(R) === norm(r)) || ROLES.find((R) => norm(R).indexOf(norm(r)) === 0))
    .filter((x): x is string => !!x);
  return picked.length ? Array.from(new Set(picked)) : ["Estimator"];
}

/** Live "how many are in Peak" count for a type's card. */
export async function countFor(key: string): Promise<number> {
  const w = WRITERS[key];
  if (!w) return 0;
  try {
    return await w.count();
  } catch {
    return 0;
  }
}

/** Counts for every type, resolved in parallel (for the hub cards). */
export async function allCounts(): Promise<Record<string, number>> {
  const entries = await Promise.all(
    IMPORT_TYPE_KEYS.map(async (k) => [k, await countFor(k)] as const)
  );
  return Object.fromEntries(entries);
}

/**
 * Write prepared rows into the type's store per `mode`. Invalid rows are
 * counted as errored (never written). Mirrors importkit.commit. `ctx`
 * carries the price list's effective date for the catalog writer (#133);
 * every other writer ignores it.
 */
export async function commitImport(
  key: string,
  rows: PreparedRow[],
  mode: ImportMode,
  ctx: CommitContext = { effectiveAt: Date.now() }
): Promise<ImportResult> {
  const w = WRITERS[key];
  const res: ImportResult = {
    created: 0,
    updated: 0,
    skipped: 0,
    errored: 0,
    total: rows.length,
    written: [],
    failed: [],
    customersCreated: 0,
    customersLinked: 0,
    warnings: [],
  };
  if (!w) return res;
  const cache = await w.load();
  const link: LinkStats = { customersCreated: 0, customersLinked: 0, createdIds: new Set<string>() };
  const noteWarnings = (rowIndex: number, warn: void | string[]) => {
    if (warn?.length) res.warnings.push(...warn.map((m) => `Row ${rowIndex + 1}: ${m}`));
  };
  for (const r of rows) {
    if (!r.valid) {
      res.errored++;
      res.failed.push(r);
      continue;
    }
    try {
      const existing = w.find(r.values, cache);
      if (existing && mode === "skip") {
        res.skipped++;
        continue;
      }
      if (existing && mode === "update" && w.update) {
        noteWarnings(r.i, await w.update(existing, r.values, cache, ctx, link));
        res.updated++;
        res.written.push(r);
        continue;
      }
      noteWarnings(r.i, await w.create(r.values, cache, ctx, link));
      res.created++;
      res.written.push(r);
    } catch {
      res.errored++;
      res.failed.push(r);
    }
  }
  res.customersCreated = link.customersCreated;
  res.customersLinked = link.customersLinked;
  return res;
}

/** Records → export objects keyed by field.key (read-only). */
export async function exportObjectsFor(key: string): Promise<Values[]> {
  const w = WRITERS[key];
  if (!w) return [];
  try {
    return await w.exportObjects();
  } catch {
    return [];
  }
}

/* ---------------- CSV building for downloads ---------------- */

function csvCell(s: unknown): string {
  const str2 = s == null ? "" : String(s);
  return /[",\n]/.test(str2) ? '"' + str2.replace(/"/g, '""') + '"' : str2;
}

/** The template / export columns: every field that isn't a hidden alias (#137).
 *  Hidden fields stay accepted on import (autoMap still maps them) — they are
 *  simply not advertised as columns to fill in or to export. Shares ONE
 *  definition with the client paste box's placeholder (parse.visibleColumns),
 *  so template, export header and placeholder can never drift apart. */
function columnsOf(type: ImportTypeMeta): FieldDef[] {
  return visibleColumns(type.fields);
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
