"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { upsert, type CatalogPart } from "@/lib/stores/catalog";
import { parseCatalog } from "./parse";

/**
 * Catalog mutations. FormData-shaped so forms work without client JS; the SKU
 * is the natural key (catalog.upsert uses it as the document id), so an upsert
 * with an existing SKU edits that part. Invalid input is a silent no-op.
 */

/** Add or edit a single part. */
export async function upsertPart(formData: FormData): Promise<void> {
  await requireUser();
  const sku = String(formData.get("sku") || "").trim();
  const desc = String(formData.get("desc") || "").trim();
  if (!sku || !desc) return;

  const part: Omit<CatalogPart, "id"> & { id?: string } = {
    sku,
    desc,
    category: String(formData.get("category") || "").trim() || "Uncategorized",
    unit: String(formData.get("unit") || "").trim() || "ea",
    list: num(formData.get("list")),
    cost: num(formData.get("cost")),
    mfr: String(formData.get("mfr") || "").trim() || undefined,
  };
  await upsert(part);
  revalidatePath("/", "layout");
  redirect("/catalog");
}

/**
 * Bulk import a pasted price book → parse → upsert each valid part. Every row
 * gets the manufacturer chosen in the sidebar (and its default category when a
 * row leaves category blank). Redirects back filtered to that manufacturer with
 * a count so the freshly-added rows are visible.
 */
export async function importCatalog(formData: FormData): Promise<void> {
  await requireUser();
  const mfr = String(formData.get("mfr") || "").trim();
  const defaultCategory = String(formData.get("category") || "").trim();
  const text = String(formData.get("text") || "");
  if (!text.trim()) return;

  const parsed = parseCatalog(text, defaultCategory);
  if (!parsed.ok) return;

  let n = 0;
  for (const r of parsed.rows) {
    if (!r.valid) continue;
    await upsert({
      sku: r.sku,
      desc: r.desc,
      category: r.category || "Uncategorized",
      unit: r.unit,
      list: r.list,
      cost: r.cost,
      mfr: mfr || undefined,
    });
    n++;
  }

  revalidatePath("/", "layout");
  const qs = new URLSearchParams();
  if (mfr) qs.set("mfr", mfr);
  qs.set("imported", String(n));
  redirect("/catalog?" + qs.toString());
}

function num(v: FormDataEntryValue | null): number {
  const n = parseFloat(String(v ?? "").replace(/[^0-9.\-]/g, ""));
  return isNaN(n) ? 0 : n;
}
