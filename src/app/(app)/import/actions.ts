"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePerm } from "@/lib/session";
import { list as listCatalog } from "@/lib/stores/catalog";
import { parseEffectiveDate } from "@/lib/catalog-books";
import {
  checkManufacturerGroups,
  checkSize,
  type GroupCheck,
  type ManufacturerGroup,
} from "@/lib/catalog-import-guard";
import { parseCsv, autoMap, prepareRows } from "./parse";
import { getTypeMeta } from "./types";
import { commitImport, type ImportMode, type ImportResult } from "./registry";
import { commitCatalogImport } from "./catalog-commit";

// #132 — `catalogGroups` (prepared rows → manufacturer groups) lives in
// ./catalog-groups so the client preview and the server commit share ONE
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
 * The `catalog` type additionally: refuses text over 1 MB (#134), then hands
 * off to `commitCatalogImport` (./catalog-commit — session-free so the
 * regression harness can drive it): the wrong-manufacturer guard per
 * manufacturer in the file, normalization to each manufacturer's existing
 * spelling (#132), the form's effective date as `pricedAt` on rows whose
 * price changes, and the manufacturer book date — stamped per manufacturer
 * group that was actually written, never in "skip" mode and never for a
 * file with no price column (#133, D156).
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
  const { rows } = prepareRows(parsed.rows, mapping, type.fields);
  const effectiveAt = parseEffectiveDate(String(formData.get("effectiveDate") || ""), Date.now());

  let res: ImportResult;
  if (key === "catalog") {
    const priced = (mapping.list ?? -1) >= 0 || (mapping.cost ?? -1) >= 0;
    const out = await commitCatalogImport({ rows, mode, effectiveAt, priced });
    if (!out.ok) redirect(`${backTo}&err=${encodeURIComponent(out.error)}`);
    res = out.res;
  } else {
    res = await commitImport(key, rows, mode, { effectiveAt });
  }

  revalidatePath("/", "layout");
  const r = [
    res.created,
    res.updated,
    res.skipped,
    res.errored,
    res.total,
    res.customersCreated,
    res.customersLinked,
    // #145 D169 review (Important 2) — a count only (never the message text
    // itself: warnings can carry a row's own free-text Phase/Discipline
    // value, and this is a URL query param). Absent on every writer but
    // task_templates; DonePanel defaults it to 0 for the pre-#145 URL shape.
    res.warnings.length,
  ].join(".");
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
