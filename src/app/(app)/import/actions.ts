"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePerm } from "@/lib/session";
import { parseCsv, autoMap, prepareRows } from "./parse";
import { getTypeMeta } from "./types";
import { commitImport, type ImportMode } from "./registry";
import { aiEnabled } from "@/lib/ai/config";
import { extractRows } from "@/lib/ai/features";

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

/**
 * AI extraction (Phase 8, D3): turn messy pasted text that ISN'T clean tabular
 * data (a price list, an emailed spec, copied notes) into structured draft rows
 * for the chosen import type. This ONLY drafts (D6 guardrail) — the rows are
 * handed back to the client, which feeds them into the SAME preview →
 * field-mapping → confirm → commit pipeline the pasted-CSV path uses, so a human
 * always reviews and confirms before `importRecords` writes anything.
 * Admin-only, same gate as the commit action; inert unless a key is present.
 */
export async function extractRowsAction(
  type: string,
  rawText: string
): Promise<{ ok: true; rows: Record<string, string>[] } | { ok: false; error: string }> {
  await requirePerm("manage_users");
  if (!aiEnabled()) return { ok: false, error: "AI features are not enabled." };

  const meta = getTypeMeta(type);
  if (!meta) return { ok: false, error: "Unknown import type." };
  if (!rawText.trim()) return { ok: false, error: "Nothing pasted yet." };

  const fields = meta.fields.map((f) => ({
    key: f.key,
    label: f.label,
    kind: f.kind,
    required: f.required,
    options: f.options,
  }));

  try {
    const rows = await extractRows({ rawText, typeLabel: meta.label, fields });
    return { ok: true, rows };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
