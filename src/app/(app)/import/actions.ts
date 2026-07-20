"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePerm } from "@/lib/session";
import { parseCsv, autoMap, prepareRows } from "./parse";
import { getTypeMeta } from "./types";
import { commitImport, type ImportMode } from "./registry";

/**
 * Import a pasted CSV/TSV block into a type's store. FormData-shaped so the
 * paste form works without client JS; the server RE-PARSES the raw text (the
 * client preview is advisory only) and writes via the ported stores, then
 * redirects back into the flow's "done" step with the result counts encoded
 * in the URL. Importing is admin-only (prototype gated on canManageUsers);
 * anything invalid is a silent no-op.
 */
export async function importRecords(formData: FormData): Promise<void> {
  await requirePerm("manage_users");
  const key = String(formData.get("type") || "");
  const text = String(formData.get("text") || "");
  const modeRaw = String(formData.get("mode") || "skip");
  const mode: ImportMode = modeRaw === "update" || modeRaw === "create" ? modeRaw : "skip";

  const type = getTypeMeta(key);
  if (!type || !text.trim()) return;

  const parsed = parseCsv(text);
  if (!parsed.ok) return;

  const mapping = autoMap(parsed.headers, type.fields);
  const prepared = prepareRows(parsed.rows, mapping, type.fields);
  const res = await commitImport(key, prepared.rows, mode);

  revalidatePath("/", "layout");
  const r = [res.created, res.updated, res.skipped, res.errored, res.total].join(".");
  redirect(`/import?tab=import&type=${encodeURIComponent(key)}&r=${r}`);
}
