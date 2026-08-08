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
import { allUsers, addUser, setRoles } from "@/lib/users";
import { getTypeMeta, IMPORT_TYPE_KEYS } from "./types";
import { norm, isoToMs, type PreparedRow } from "./parse";

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
};

/**
 * One writer per type. `find` dedupes against `cache` (a mutable array loaded
 * once per commit so rows created earlier in the same file are seen); `create`
 * appends a lightweight marker back into that cache.
 */
type Writer = {
  count: () => Promise<number>;
  load: () => Promise<Record<string, unknown>[]>;
  find: (values: Values, cache: Record<string, unknown>[]) => Record<string, unknown> | null;
  create: (values: Values, cache: Record<string, unknown>[]) => Promise<void>;
  update?: (existing: Record<string, unknown>, values: Values) => Promise<void>;
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
 * `ex` is the part already in the catalog (null on the create path).
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

const WRITERS: Record<string, Writer> = {
  customers: {
    count: async () => (await Customers.all()).length,
    load: async () => (await Customers.all()) as unknown as Record<string, unknown>[],
    find: (v, cache) => cache.find((c) => ci(c.name, v.name)) || null,
    create: async (v, cache) => {
      const id = "c" + Date.now() + "-" + seq();
      await Customers.upsert({
        id,
        name: str(v.name),
        type: str(v.type) || "Performing arts",
        locations: [
          {
            id: "l" + id,
            label: str(v.venue) || "Main Venue",
            primary: true,
            address: str(v.address),
            city: str(v.city),
            state: str(v.state),
          },
        ],
        contacts: v.contactName
          ? [
              {
                name: str(v.contactName),
                email: str(v.email),
                phone: str(v.phone),
                primary: true,
              },
            ]
          : [],
      });
      cache.push({ id, name: str(v.name) });
    },
    update: async (ex, v) => {
      await Customers.upsert({
        id: str(ex.id),
        name: str(v.name) || str(ex.name),
        type: str(v.type) || str(ex.type),
        locations: [
          {
            id: "l" + str(ex.id),
            label: str(v.venue) || "Main Venue",
            primary: true,
            address: str(v.address),
            city: str(v.city),
            state: str(v.state),
          },
        ],
        contacts: v.contactName
          ? [
              {
                name: str(v.contactName),
                email: str(v.email),
                phone: str(v.phone),
                primary: true,
              },
            ]
          : [],
      });
    },
    exportObjects: async () => {
      const list = await Customers.all();
      return list.map((rec) => {
        const loc =
          (rec.locations || []).find((l) => l.primary) || (rec.locations || [])[0] || null;
        const c =
          (rec.contacts || []).find((x) => x.primary) || (rec.contacts || [])[0] || null;
        return {
          name: rec.name || "",
          type: rec.type || "",
          contactName: c?.name || "",
          email: c?.email || "",
          phone: c?.phone || "",
          venue: loc?.label || "",
          address: loc?.address || "",
          city: loc?.city || "",
          state: loc?.state || "",
          notes: "",
        };
      });
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
    create: async (v, cache) => {
      const sku = str(v.sku);
      // mergeUpsert is the same entry point scripts/import-catalog.ts uses —
      // it preserves fields a price sheet doesn't carry (ports, trade, spec
      // text, datasheet attachments) when a SKU is re-imported.
      await Catalog.mergeUpsert(sku, catalogPatch(v, null, sku));
      cache.push({ id: sku, sku });
    },
    update: async (ex, v) => {
      const sku = str(ex.sku);
      await Catalog.mergeUpsert(sku, catalogPatch(v, ex, sku));
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
 * counted as errored (never written). Mirrors importkit.commit.
 */
export async function commitImport(
  key: string,
  rows: PreparedRow[],
  mode: ImportMode
): Promise<ImportResult> {
  const w = WRITERS[key];
  const res: ImportResult = { created: 0, updated: 0, skipped: 0, errored: 0, total: rows.length };
  if (!w) return res;
  const cache = await w.load();
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
        await w.update(existing, r.values);
        res.updated++;
        continue;
      }
      await w.create(r.values, cache);
      res.created++;
    } catch {
      res.errored++;
    }
  }
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

/** Blank template: header row + one example row (importkit.templateCSV). */
export function templateCsv(key: string): string {
  const type = getTypeMeta(key);
  if (!type) return "";
  const header = type.fields.map((f) => csvCell(f.header)).join(",");
  const example = type.fields.map((f) => csvCell(f.example || "")).join(",");
  return header + "\n" + example + "\n";
}

/** Export CSV: same columns as the template so export → edit → re-import works. */
export async function exportCsv(key: string): Promise<string> {
  const type = getTypeMeta(key);
  if (!type) return "";
  const objs = await exportObjectsFor(key);
  const header = type.fields.map((f) => csvCell(f.header)).join(",");
  const lines = objs.map((o) => type.fields.map((f) => csvCell(o[f.key] ?? "")).join(","));
  return header + "\n" + lines.join("\n") + (lines.length ? "\n" : "");
}
