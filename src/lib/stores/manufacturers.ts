// SERVER ONLY — the manufacturers collection (Manufacturer section Part 1).
import { createHash } from "node:crypto";
import { listDocs, upsertDoc } from "@/db/doc-store";
import { mfrKey } from "@/lib/catalog-books";
import { canonicalKeyMap, planMerge } from "@/lib/manufacturer-aliases";

/**
 * One record per manufacturer key (mfrKey: lowercase, a–z0–9). Created
 * lazily the first time an image is set. The image is an ordinary
 * part_documents image with source "manufacturer" and NO part links, so it
 * never counts as a part photo. Nothing here deletes anything: a replaced
 * or removed image id moves to imageHistory. Parts 2–3 add company/vendor
 * links and cost data to this same record.
 */

export type Manufacturer = {
  id: string;
  key: string;
  name: string;
  imageDocumentId: string | null;
  imageHistory: string[];
  /** Spellings (keys) merged into this one; lookups and rows treat them as this manufacturer. */
  aliasKeys: string[];
  /** Set on a record merged away: the canonical key it now belongs to. */
  mergedInto: string | null;
  /** The manufacturer's company record (customers collection id), if linked. */
  companyId: string | null;
  /** Contacts who work with this manufacturer (contact id + free-text role). */
  people: { contactId: string; role: string }[];
  notes: string;
  createdAt: number;
  updatedAt: number;
  updatedBy: string;
};

const COLL = "manufacturers" as const;
const NOTES_MAX = 4000;
const ROLE_MAX = 120;
/** Derived from the key, so a duplicate first-create race lands on one row. */
const idForKey = (key: string) => "MF-" + createHash("sha1").update(key).digest("hex").slice(0, 10);

function clean(raw: Record<string, unknown>): Manufacturer {
  return {
    id: String(raw.id),
    key: String(raw.key ?? ""),
    name: String(raw.name ?? ""),
    imageDocumentId: typeof raw.imageDocumentId === "string" && raw.imageDocumentId ? raw.imageDocumentId : null,
    imageHistory: Array.isArray(raw.imageHistory) ? raw.imageHistory.filter((s): s is string => typeof s === "string") : [],
    aliasKeys: Array.isArray(raw.aliasKeys) ? raw.aliasKeys.filter((k): k is string => typeof k === "string" && !!k) : [],
    mergedInto: typeof raw.mergedInto === "string" && raw.mergedInto ? raw.mergedInto : null,
    companyId: typeof raw.companyId === "string" && raw.companyId ? raw.companyId : null,
    people: Array.isArray(raw.people)
      ? raw.people
          .filter((p): p is { contactId: string; role?: unknown } => !!p && typeof p === "object" && typeof (p as { contactId?: unknown }).contactId === "string" && !!(p as { contactId: string }).contactId)
          .map((p) => ({ contactId: p.contactId, role: String(p.role ?? "").slice(0, ROLE_MAX) }))
      : [],
    notes: typeof raw.notes === "string" ? raw.notes.slice(0, NOTES_MAX) : "",
    createdAt: Number(raw.createdAt) || 0,
    updatedAt: Number(raw.updatedAt) || 0,
    updatedBy: String(raw.updatedBy ?? ""),
  };
}

export async function listManufacturers(): Promise<Manufacturer[]> {
  return (await listDocs(COLL)).map((d) => clean(d as unknown as Record<string, unknown>));
}

export async function manufacturerByKey(key: string): Promise<Manufacturer | null> {
  const k = mfrKey(key);
  if (!k) return null;
  return (await listManufacturers()).find((m) => m.key === k) ?? null;
}

const blank = () => ({ aliasKeys: [] as string[], mergedInto: null as string | null, companyId: null as string | null, people: [] as { contactId: string; role: string }[], notes: "" });

async function save(m: Manufacturer): Promise<Manufacturer> {
  await upsertDoc(COLL, m);
  return m;
}

/** The canonical record for a spelling's key (a merged-away spelling resolves to its target), or null. */
async function canonicalRecord(rawKey: string): Promise<{ canon: string; cur: Manufacturer | null }> {
  const all = await listManufacturers();
  const canon = canonicalKeyMap(all)(rawKey);
  return { canon, cur: all.find((m) => m.key === canon) ?? null };
}

export async function setManufacturerImage(input: { name: string; documentId: string; by: string; at?: number }): Promise<Manufacturer> {
  const key = mfrKey(input.name);
  if (!key) throw new Error("A manufacturer needs a name.");
  const at = input.at ?? Date.now();
  const { canon, cur } = await canonicalRecord(key);
  if (!cur) {
    return save({ id: idForKey(canon), key: canon, name: canon === key ? input.name.trim() : canon, imageDocumentId: input.documentId, imageHistory: [], ...blank(), createdAt: at, updatedAt: at, updatedBy: input.by });
  }
  const history = cur.imageDocumentId && cur.imageDocumentId !== input.documentId ? [cur.imageDocumentId, ...cur.imageHistory] : cur.imageHistory;
  return save({ ...cur, imageDocumentId: input.documentId, imageHistory: history, updatedAt: at, updatedBy: input.by });
}

export async function removeManufacturerImage(key: string, by: string, at: number = Date.now()): Promise<Manufacturer | null> {
  const k = mfrKey(key);
  if (!k) return null;
  const { cur } = await canonicalRecord(k);
  if (!cur) return null;
  if (!cur.imageDocumentId) return cur;
  return save({ ...cur, imageHistory: [cur.imageDocumentId, ...cur.imageHistory], imageDocumentId: null, updatedAt: at, updatedBy: by });
}

/** name → image document id for every manufacturer with an image (pure over `rows`).
 *  A merged-away spelling resolves to its target's image. */
export function manufacturerImageLookup(rows: readonly Manufacturer[]): (mfr: string) => string | null {
  const byKey = new Map<string, string>();
  const canon = canonicalKeyMap(rows);
  for (const m of rows) {
    // A record that isn't its own canonical key (merged away, or an alias rewritten by a rollback) never supplies an image.
    if (!m.imageDocumentId || m.mergedInto || canon(m.key) !== m.key) continue;
    for (const k of [m.key, ...m.aliasKeys]) byKey.set(k, m.imageDocumentId);
  }
  return (mfr) => byKey.get(mfrKey(mfr)) ?? null;
}

/** The record for `name`'s key, created with defaults when missing. */
export async function ensureManufacturer(name: string, by: string, at: number = Date.now()): Promise<Manufacturer> {
  const key = mfrKey(name);
  if (!key) throw new Error("A manufacturer needs a name.");
  const cur = await manufacturerByKey(key);
  if (cur) return cur;
  return save({ id: idForKey(key), key, name: name.trim(), imageDocumentId: null, imageHistory: [], ...blank(), createdAt: at, updatedAt: at, updatedBy: by });
}

/**
 * Merge `sourceKey` (and its aliases) into `targetKey`'s canonical record.
 * Non-destructive: catalog `mfr` text never changes. The target keeps its own
 * image/company/notes and only adopts the source's image or company when it has
 * none; people are unioned by contact. A moved key with no record yet gets one
 * named after the key itself — the page calls `ensureManufacturer` first with a
 * display name when it has one.
 */
export async function mergeManufacturer(sourceKey: string, targetKey: string, by: string, at: number = Date.now()): Promise<{ ok: true } | { ok: false; error: string }> {
  const all = await listManufacturers();
  const plan = planMerge(all, mfrKey(sourceKey), mfrKey(targetKey));
  if (!plan.ok) return plan;
  const byKey = new Map(all.map((m) => [m.key, m] as const));
  const get = async (key: string): Promise<Manufacturer> => byKey.get(key) ?? (await ensureManufacturer(key, by, at));
  const target = await get(plan.target);
  const sourceCanon = await get(plan.moved[0]);
  const moved: Manufacturer[] = [];
  for (const k of plan.moved) moved.push(await get(k));
  const people = [...target.people];
  for (const m of moved) for (const p of m.people) if (!people.some((q) => q.contactId === p.contactId)) people.push({ ...p });
  const aliasKeys = [...new Set([...target.aliasKeys, ...plan.moved])].filter((k) => k !== target.key);
  await save({
    ...target,
    aliasKeys,
    people,
    imageDocumentId: target.imageDocumentId ?? sourceCanon.imageDocumentId,
    companyId: target.companyId ?? sourceCanon.companyId,
    updatedAt: at,
    updatedBy: by,
  });
  for (const m of moved) await save({ ...m, mergedInto: target.key, aliasKeys: [], updatedAt: at, updatedBy: by });
  return { ok: true };
}

/** Undo one spelling's merge: the alias leaves its target and stands alone again. */
export async function unmergeManufacturer(aliasKey: string, by: string, at: number = Date.now()): Promise<{ ok: true } | { ok: false; error: string }> {
  const key = mfrKey(aliasKey);
  const all = await listManufacturers();
  const owner = all.find((m) => m.aliasKeys.includes(key));
  const rec = all.find((m) => m.key === key);
  if (!owner && !rec?.mergedInto) return { ok: false, error: "That spelling isn't merged." };
  if (owner) await save({ ...owner, aliasKeys: owner.aliasKeys.filter((k) => k !== key), updatedAt: at, updatedBy: by });
  if (rec) await save({ ...rec, mergedInto: null, updatedAt: at, updatedBy: by });
  return { ok: true };
}

/** Edits always land on the canonical record, created if it doesn't exist yet. */
async function editCanonical(key: string, by: string, patch: (m: Manufacturer) => Partial<Manufacturer>, at: number = Date.now()): Promise<Manufacturer> {
  const all = await listManufacturers();
  const canon = canonicalKeyMap(all)(mfrKey(key));
  const cur = all.find((m) => m.key === canon) ?? (await ensureManufacturer(canon, by, at));
  return save({ ...cur, ...patch(cur), updatedAt: at, updatedBy: by });
}

export const setManufacturerCompany = (key: string, companyId: string | null, by: string) =>
  editCanonical(key, by, () => ({ companyId: companyId || null }));

export const addManufacturerPerson = (key: string, contactId: string, role: string, by: string) =>
  editCanonical(key, by, (m) => {
    const r = String(role ?? "").trim().slice(0, ROLE_MAX);
    return { people: m.people.some((p) => p.contactId === contactId) ? m.people.map((p) => (p.contactId === contactId ? { contactId, role: r } : p)) : [...m.people, { contactId, role: r }] };
  });

export const removeManufacturerPerson = (key: string, contactId: string, by: string) =>
  editCanonical(key, by, (m) => ({ people: m.people.filter((p) => p.contactId !== contactId) }));

export const setManufacturerNotes = (key: string, notes: string, by: string) =>
  editCanonical(key, by, () => ({ notes: String(notes ?? "").slice(0, NOTES_MAX) }));
