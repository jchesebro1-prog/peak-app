// SERVER ONLY — the manufacturers collection (Manufacturer section Part 1).
import { randomBytes } from "node:crypto";
import { listDocs, upsertDoc } from "@/db/doc-store";
import { mfrKey } from "@/lib/catalog-books";

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
  createdAt: number;
  updatedAt: number;
  updatedBy: string;
};

const COLL = "manufacturers" as const;
const newId = () => "MF-" + randomBytes(5).toString("hex");

function clean(raw: Record<string, unknown>): Manufacturer {
  return {
    id: String(raw.id),
    key: String(raw.key ?? ""),
    name: String(raw.name ?? ""),
    imageDocumentId: typeof raw.imageDocumentId === "string" && raw.imageDocumentId ? raw.imageDocumentId : null,
    imageHistory: Array.isArray(raw.imageHistory) ? raw.imageHistory.filter((s): s is string => typeof s === "string") : [],
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

async function save(m: Manufacturer): Promise<Manufacturer> {
  await upsertDoc(COLL, m);
  return m;
}

export async function setManufacturerImage(input: { name: string; documentId: string; by: string; at?: number }): Promise<Manufacturer> {
  const key = mfrKey(input.name);
  if (!key) throw new Error("A manufacturer needs a name.");
  const at = input.at ?? Date.now();
  const cur = await manufacturerByKey(key);
  if (!cur) {
    return save({ id: newId(), key, name: input.name.trim(), imageDocumentId: input.documentId, imageHistory: [], createdAt: at, updatedAt: at, updatedBy: input.by });
  }
  const history = cur.imageDocumentId && cur.imageDocumentId !== input.documentId ? [cur.imageDocumentId, ...cur.imageHistory] : cur.imageHistory;
  return save({ ...cur, imageDocumentId: input.documentId, imageHistory: history, updatedAt: at, updatedBy: input.by });
}

export async function removeManufacturerImage(key: string, by: string, at: number = Date.now()): Promise<Manufacturer | null> {
  const cur = await manufacturerByKey(key);
  if (!cur) return null;
  if (!cur.imageDocumentId) return cur;
  return save({ ...cur, imageHistory: [cur.imageDocumentId, ...cur.imageHistory], imageDocumentId: null, updatedAt: at, updatedBy: by });
}

/** name → image document id for every manufacturer with an image (pure over `rows`). */
export function manufacturerImageLookup(rows: readonly Manufacturer[]): (mfr: string) => string | null {
  const byKey = new Map(rows.filter((m) => m.imageDocumentId).map((m) => [m.key, m.imageDocumentId as string] as const));
  return (mfr) => byKey.get(mfrKey(mfr)) ?? null;
}
