"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePerm } from "@/lib/session";
import { list as listCatalog } from "@/lib/stores/catalog";
import { setPriceListEffective } from "@/lib/settings";
import { mfrKey, parseEffectiveDate } from "@/lib/catalog-books";
import {
  checkManufacturerGroups,
  checkSize,
  type GroupCheck,
  type ManufacturerGroup,
} from "@/lib/catalog-import-guard";
import { parseCsv, autoMap, prepareRows } from "./parse";
import { catalogGroups } from "./catalog-groups";
import { getTypeMeta } from "./types";
import { commitImport, type ImportMode } from "./registry";

/** #132 — a failing group's message, prefixed with the manufacturer it checked. */
function guardMessage(c: GroupCheck): string {
  return c.result.ok ? "" : (c.mfr ? `${c.mfr}: ` : "") + c.result.detail;
}

// #132 — `catalogGroups` (prepared rows → manufacturer groups) lives in
// ./catalog-groups so the client preview and this server commit share ONE
// implementation (pre-flight finding: the block was duplicated).

/**
 * Import a pasted CSV/TSV block into a type's store. FormData-shaped so the
 * paste form works without client JS; the server RE-PARSES the raw text (the
 * client preview is advisory only) and writes via the ported stores, then
 * redirects back into the flow's "done" step with the result counts encoded
 * in the URL. Importing is admin-only (prototype gated on canManageUsers).
 * Anything invalid redirects back with an `err=` param (same query-param
 * idiom as the success path's `r=`) so the page can render the failure
 * instead of silently doing nothing.
 *
 * The `catalog` type additionally: refuses text over 1 MB (#134), runs the
 * wrong-manufacturer guard per manufacturer in the file and normalizes each
 * group to its existing spelling (#132), stamps the form's effective date on
 * rows whose price changes and records it as each manufacturer's price-list
 * date once rows were written (#133, D156).
 */
export async function importRecords(formData: FormData): Promise<void> {
  await requirePerm("manage_users");
  const key = String(formData.get("type") || "");
  const text = String(formData.get("text") || "");
  const modeRaw = String(formData.get("mode") || "skip");
  const mode: ImportMode = modeRaw === "update" || modeRaw === "create" ? modeRaw : "skip";

  const type = getTypeMeta(key);
  const backTo = type ? `/import?tab=import&type=${encodeURIComponent(key)}` : `/import?tab=import`;

  if (!type) {
    redirect(`${backTo}&err=${encodeURIComponent("Unknown import type.")}`);
  }
  if (!text.trim()) {
    redirect(`${backTo}&err=${encodeURIComponent("Paste rows before importing.")}`);
  }
  if (key === "catalog") {
    const size = checkSize(Buffer.byteLength(text, "utf8"));
    if (!size.ok) redirect(`${backTo}&err=${encodeURIComponent(size.error)}`);
  }

  const parsed = parseCsv(text);
  if (!parsed.ok) {
    redirect(`${backTo}&err=${encodeURIComponent(parsed.error || "Couldn’t read that as a CSV.")}`);
  }

  const mapping = autoMap(parsed.headers, type.fields);
  const prepared = prepareRows(parsed.rows, mapping, type.fields);
  let rows = prepared.rows;
  let checks: GroupCheck[] = [];
  const effectiveAt = parseEffectiveDate(String(formData.get("effectiveDate") || ""), Date.now());

  if (key === "catalog") {
    checks = checkManufacturerGroups(catalogGroups(rows), await listCatalog());
    const bad = checks.find((c) => !c.result.ok);
    if (bad) redirect(`${backTo}&err=${encodeURIComponent(guardMessage(bad))}`);
    const spelling = new Map(checks.map((c) => [mfrKey(c.mfr), c.result.ok ? c.result.normalizedMfr : c.mfr]));
    rows = rows.map((r) => {
      if (!r.valid) return r;
      const mfr = String(r.values.mfr ?? "");
      return { ...r, values: { ...r.values, mfr: spelling.get(mfrKey(mfr)) ?? mfr } };
    });
  }

  const res = await commitImport(key, rows, mode, { effectiveAt });

  // "skip" never compares prices, so it confirms nothing; update/create do
  // once at least one row was written.
  if (key === "catalog" && res.created + res.updated > 0) {
    for (const c of checks) {
      if (c.result.ok) await setPriceListEffective(mfrKey(c.result.normalizedMfr), effectiveAt);
    }
  }

  revalidatePath("/", "layout");
  const r = [res.created, res.updated, res.skipped, res.errored, res.total].join(".");
  redirect(`/import?tab=import&type=${encodeURIComponent(key)}&r=${r}`);
}

/**
 * #132 — the preview's guard: the client sends one {mfr, skus} group per
 * manufacturer in the pasted table and shows the failures before commit
 * (the catalog is ~10k rows, too big to ship to the browser for a local
 * check). importRecords re-runs the same guard authoritatively.
 */
export async function checkCatalogImportAction(groups: ManufacturerGroup[]): Promise<GroupCheck[]> {
  await requirePerm("manage_users");
  const clean: ManufacturerGroup[] = (Array.isArray(groups) ? groups : []).slice(0, 100).map((g) => ({
    mfr: String(g?.mfr ?? "").slice(0, 200),
    skus: (Array.isArray(g?.skus) ? g.skus : []).slice(0, 20000).map((s) => String(s ?? "").slice(0, 200)),
  }));
  if (!clean.length) return [];
  return checkManufacturerGroups(clean, await listCatalog());
}
