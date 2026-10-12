"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/team";
import { saveProductParagraph } from "@/lib/stores/catalog";
import { deleteIntro, upsertIntro } from "@/lib/stores/narrative-intros";
import { keyProductLibrary } from "@/lib/narrative/library";
import { MAX_LIBRARY_SKUS, type KeyProductLibraryRow, type ParagraphSaveResponse } from "./narrative";
import type { SystemIntro } from "@/lib/narrative/intros";

/**
 * #293 — the narrative column's server actions. Reads need a session; every
 * library write needs Create (the Spec panel's audience, #205) and answers
 * with a message rather than requirePerm's redirect, so the column can say
 * "Needs the Create permission". Editing a quote never writes the library:
 * these are the only paths in.
 */

export type IntroWriteResponse = { ok: true; intros: SystemIntro[]; id: string | null } | { ok: false; error: string };

const NEEDS_CREATE = "Needs the Create permission.";

/** Per-sku library rows for the active system (≤ 200 skus). */
export async function keyProductLibraryAction(skus: string[], aliases?: Record<string, string> | null): Promise<Record<string, KeyProductLibraryRow>> {
  await requireUser();
  // #332: aliases are untrusted client input — only string → string entries reach the read (it caps them again).
  const clean: Record<string, string> = {};
  if (aliases && typeof aliases === "object" && !Array.isArray(aliases)) {
    for (const [k, v] of Object.entries(aliases).slice(0, MAX_LIBRARY_SKUS)) if (typeof k === "string" && typeof v === "string") clean[k] = v;
  }
  return keyProductLibrary(Array.isArray(skus) ? skus.slice(0, MAX_LIBRARY_SKUS) : [], clean);
}

/** "Save to library" / the part editor's Narrative paragraph. */
export async function saveProductParagraphAction(sku: string, text: string, expectUpdatedAt?: number | null): Promise<ParagraphSaveResponse> {
  const user = await requireUser();
  if (!can("create", user.roles)) return { ok: false, error: NEEDS_CREATE };
  const res = await saveProductParagraph(String(sku || ""), String(text ?? ""), user.name, {
    expectUpdatedAt: expectUpdatedAt === undefined ? undefined : typeof expectUpdatedAt === "number" ? expectUpdatedAt : null,
  });
  if (!res.ok) return res;
  revalidatePath("/catalog");
  const rows = await keyProductLibrary([res.part.sku]);
  return { ok: true, row: rows[res.part.sku] };
}

export async function upsertSystemIntroAction(input: { id?: string | null; title: string; text: string }): Promise<IntroWriteResponse> {
  const user = await requireUser();
  if (!can("create", user.roles)) return { ok: false, error: NEEDS_CREATE };
  const res = await upsertIntro(input, user.name);
  return res.ok ? { ok: true, intros: res.list, id: res.id } : { ok: false, error: res.error };
}

export async function deleteSystemIntroAction(id: string): Promise<IntroWriteResponse> {
  const user = await requireUser();
  if (!can("create", user.roles)) return { ok: false, error: NEEDS_CREATE };
  const res = await deleteIntro(String(id || ""), user.name);
  return res.ok ? { ok: true, intros: res.list, id: null } : { ok: false, error: res.error };
}
