"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser, requirePerm } from "@/lib/session";
import { upsert, type CatalogPart } from "@/lib/stores/catalog";
import { parseCatalog } from "./parse";
import { setSettings } from "@/lib/settings";
import { GROUPS, TRADES, type CategoryMap } from "@/lib/catalog-taxonomy";

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
    note: String(formData.get("note") || "").trim() || undefined,
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

/**
 * Save the admin-edited category -> group/trade mapping (punch #39, Task 2).
 * Admin-gated on manage_users (like Settings / Estimating Rules — the
 * codebase's standard admin gate), unlike the other actions in this file
 * which only require a signed-in session.
 *
 * `entries` becomes the ENTIRE stored `catalogCategoryMap` — not a delta.
 * That's intentional: resolveCategoryMap does `{ ...DEFAULT_CATEGORY_MAP,
 * ...stored }`, so whatever is stored wins per key. The editor seeds its
 * state from resolveCategoryMap(stored), so a save legitimately writes the
 * default entries back out alongside any edits; that's expected, not a bug.
 *
 * Every group/trade value is validated against the live GROUPS/TRADES lists
 * before anything is persisted — one bad entry rejects the whole save so a
 * stale client can never wedge a garbage value into settings.
 */
export async function saveCategoryMapAction(entries: CategoryMap): Promise<void> {
  await requirePerm("manage_users");

  for (const [category, entry] of Object.entries(entries)) {
    if (entry.group !== undefined && !(GROUPS as readonly string[]).includes(entry.group)) {
      throw new Error(`"${entry.group}" is not a valid group (category "${category}").`);
    }
    if (entry.trade !== undefined && !(TRADES as readonly string[]).includes(entry.trade)) {
      throw new Error(`"${entry.trade}" is not a valid trade (category "${category}").`);
    }
  }

  await setSettings({ catalogCategoryMap: entries });
  revalidatePath("/catalog");
}
