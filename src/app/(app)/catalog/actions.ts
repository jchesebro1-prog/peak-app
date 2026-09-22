"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser, requirePerm } from "@/lib/session";
import { clearCatalogPriceList, get as getPart, upsert, mergeUpsert } from "@/lib/stores/catalog";
import { mfrKey, parseEffectiveDate } from "@/lib/catalog-books";
import { checkSize } from "@/lib/catalog-import-guard";
import { setPriceListEffective, setSettings } from "@/lib/settings";
import { GROUPS, TRADES, type CategoryMap } from "@/lib/catalog-taxonomy";
import { blobEnabled, dataUrlToBytes, putBlob, safeName } from "@/lib/blob";
import { runCatalogImport } from "./import";

type Result = { ok: true } | { ok: false; error: string };

export async function deleteCatalogPriceListAction(formData: FormData): Promise<void> {
  await requirePerm("manage_users");
  if (String(formData.get("confirmation") || "") !== "DELETE") return;
  await clearCatalogPriceList();
  revalidatePath("/catalog");
  redirect("/catalog?reset=1");
}

/**
 * Catalog mutations. FormData-shaped so forms work without client JS; the SKU
 * is the natural key (catalog.upsert uses it as the document id), so an upsert
 * with an existing SKU edits that part. Invalid input is a silent no-op.
 */

/**
 * Add or edit a single part. The edit form only owns sku/desc/category/unit/
 * list/cost/mfr/note (see the fields in page.tsx's edit modal) — it never
 * shows ports, trade, datasheet, discipline/role, costPerSqft, etc., so a
 * save here must not wipe those. mergeUpsert (lib/stores/catalog) loads the
 * existing part and overlays just the form-owned fields; a blanked mfr/note
 * still clears intentionally (undefined wins over whatever was stored).
 */
export async function upsertPart(formData: FormData): Promise<void> {
  await requireUser();
  const sku = String(formData.get("sku") || "").trim();
  const desc = String(formData.get("desc") || "").trim();
  if (!sku || !desc) return;

  await mergeUpsert(sku, {
    desc,
    category: String(formData.get("category") || "").trim() || "Uncategorized",
    unit: String(formData.get("unit") || "").trim() || "ea",
    list: num(formData.get("list")),
    cost: num(formData.get("cost")),
    mfr: String(formData.get("mfr") || "").trim() || undefined,
    note: String(formData.get("note") || "").trim() || undefined,
  });
  revalidatePath("/", "layout");
  redirect("/catalog");
}

/**
 * Bulk import a price book (upload or paste) → `runCatalogImport` (./import):
 * size cap (#134), parse, the wrong-manufacturer guard (#132), upserts that
 * stamp `pricedAt` with the form's effective date on rows whose price moved
 * (#133), and the manufacturer's book date. Redirects back filtered to that
 * manufacturer with a count so the freshly-added rows are visible.
 */
export async function importCatalog(formData: FormData): Promise<void> {
  await requireUser();
  const mfr = String(formData.get("mfr") || "").trim();
  const defaultCategory = String(formData.get("category") || "").trim();
  const effectiveAt = parseEffectiveDate(String(formData.get("effectiveDate") || ""), Date.now());
  let text = String(formData.get("text") || "");
  let bytes = Buffer.byteLength(text, "utf8");
  const file = formData.get("file");

  // Every failure path redirects with a human message (punch #111) — a silent
  // return left the upload form looking frozen. redirect() throws, so these
  // stay outside any try/catch.
  const fail = (message: string): never => {
    const qs = new URLSearchParams();
    if (mfr) qs.set("mfr", mfr);
    qs.set("importError", message);
    redirect("/catalog?" + qs.toString());
  };

  if (file instanceof File && file.size > 0) {
    // #134 — refuse before reading a big file into memory.
    const size = checkSize(file.size);
    if (!size.ok) return fail(size.error);
    bytes = file.size;
    text = await file.text();
  }

  const res = await runCatalogImport({
    mfr,
    text,
    bytes,
    effectiveAt,
    defaultCategory: defaultCategory || (String(formData.get("prebuilt") || "") === "1" ? "Prebuilt system" : ""),
  });
  if (!res.ok) return fail(res.error);

  revalidatePath("/", "layout");
  const qs = new URLSearchParams();
  qs.set("mfr", res.mfr);
  qs.set("imported", String(res.imported));
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
 *
 * Fabric/Labor are stripped before validation/persistence regardless of what
 * the client sends — they're excluded domains (curtain configurator / labor
 * engine; see catalog-taxonomy.ts), and the editor's disabled rows are a UI
 * nicety, not the enforcement: the "Fabric is EXCLUDED" constraint has to
 * hold even against a tampered client that POSTs those keys directly.
 */
export async function saveCategoryMapAction(entries: CategoryMap): Promise<void> {
  await requirePerm("manage_users");

  const { Fabric: _fabric, Labor: _labor, ...clean } = entries;

  for (const [category, entry] of Object.entries(clean)) {
    if (entry.group !== undefined && !(GROUPS as readonly string[]).includes(entry.group)) {
      throw new Error(`"${entry.group}" is not a valid group (category "${category}").`);
    }
    if (entry.trade !== undefined && !(TRADES as readonly string[]).includes(entry.trade)) {
      throw new Error(`"${entry.trade}" is not a valid trade (category "${category}").`);
    }
  }

  await setSettings({ catalogCategoryMap: clean });
  revalidatePath("/catalog");
}

/** ~8 MB data-URL cap on the upload transport (mirrors the Grid sheet
 *  upload's MAX_SHEET_BYTES) — comfortably above any real datasheet PDF. */
const MAX_DATASHEET_BYTES = 8 * 1024 * 1024;

/**
 * Attach (or replace) a part's datasheet PDF (punch #39, Task 5, D116 blob
 * pattern). Admin-gated like saveCategoryMapAction — a catalog-wide asset
 * edit, not a per-quote upload. PDF only, 8 MB cap (mirrors the Grid sheet
 * upload action's checks).
 *
 * Storage always goes to Blob, never the part doc: with 10.7k parts, an
 * MB-scale PDF landing in jsonb per row is exactly the anti-pattern D116
 * exists to avoid, so when Blob isn't configured this refuses outright
 * rather than falling back to an in-doc dataUrl.
 */
export async function uploadPartDatasheetAction(
  sku: string,
  name: string,
  dataUrl: string
): Promise<Result> {
  await requirePerm("manage_users");
  const part = await getPart(sku);
  if (!part) return { ok: false, error: "That part no longer exists." };
  if (!blobEnabled())
    return {
      ok: false,
      error: "File storage isn't configured (no BLOB_READ_WRITE_TOKEN) — datasheets can't be attached on this deployment.",
    };
  if (!dataUrl.startsWith("data:")) return { ok: false, error: "Not a readable file." };
  if (dataUrl.length > MAX_DATASHEET_BYTES)
    return { ok: false, error: "That file is over 8 MB — compress the PDF and try again." };

  let bytes: Buffer;
  let mime: string;
  try {
    ({ bytes, mime } = dataUrlToBytes(dataUrl));
  } catch {
    return { ok: false, error: "Not a readable file." };
  }
  if (mime !== "application/pdf") return { ok: false, error: "PDF files only." };

  try {
    const up = await putBlob(`part-datasheets/${safeName(sku)}/${safeName(name)}`, bytes, mime);
    await upsert({ ...part, datasheetBlobKey: up.pathname, datasheetName: name });
  } catch (e) {
    console.error("[catalog] datasheet upload failed:", e);
    return { ok: false, error: "Upload to file storage failed — check the Blob token, or try again." };
  }
  revalidatePath("/catalog");
  return { ok: true };
}

/**
 * Clear a part's datasheet fields. Does NOT delete the underlying blob —
 * parity with the Grid sheet's Blob backfill, which likewise never deletes
 * storage on removal: Blob is cheap, and an accidental remove shouldn't
 * need a from-scratch re-upload to undo. A future cleanup job can sweep
 * orphaned blobs if that ever matters.
 */
export async function removePartDatasheetAction(sku: string): Promise<Result> {
  await requirePerm("manage_users");
  const part = await getPart(sku);
  if (!part) return { ok: false, error: "That part no longer exists." };
  const { datasheetBlobKey: _key, datasheetName: _name, ...rest } = part;
  await upsert(rest);
  revalidatePath("/catalog");
  return { ok: true };
}

/**
 * #133 — the Catalog banner's inline date input: record (or clear) the date
 * a manufacturer's price list is effective. `mfr` is the display name; it is
 * keyed through mfrKey so every spelling of the manufacturer shares one date.
 */
export async function setPriceListEffectiveAction(mfr: string, at: number | null): Promise<Result> {
  await requireUser();
  const key = mfrKey(mfr);
  if (!key) return { ok: false, error: "Pick a manufacturer." };
  if (at != null && (!Number.isFinite(at) || at <= 0)) return { ok: false, error: "Enter a valid date." };
  await setPriceListEffective(key, at);
  revalidatePath("/", "layout");
  return { ok: true };
}
