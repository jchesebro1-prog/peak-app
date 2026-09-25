"use server";

import { revalidatePath } from "next/cache";
import { requirePerm } from "@/lib/session";
import {
  commitHistory,
  finalizeHistory,
  previewHistory,
  type CommitResult,
  type FinalizeResult,
  type Preview,
} from "@/lib/daylite/history-commit";

/**
 * Daylite history import (Task 12) — the Import hub's server seam over
 * lib/daylite/history-commit. Both files travel as text on every call (the
 * server re-plans from them; the preview is advisory), so the combined size
 * is capped under next.config's 1200 kb server-action body limit.
 *
 * requirePerm stays OUTSIDE the try blocks: it redirects (to /login or /),
 * and a caught redirect would be swallowed into an error message.
 */

/** Combined character cap for the two files — the client enforces it too. */
const MAX_CHARS = 1_100_000;
/** Largest range one commit call may process (the client sends 150). */
const MAX_CHUNK = 500;

export type DaylitePreview = Omit<Preview, "rows">;
export type PreviewResult = { ok: true; preview: DaylitePreview } | { ok: false; error: string };
export type ChunkResult = ({ ok: true } & CommitResult) | { ok: false; error: string };
export type FinalizeActionResult = ({ ok: true } & FinalizeResult) | { ok: false; error: string };

function checkInput(projectsTsv: unknown, oppsTsv: unknown): { p: string; o: string } | string {
  const p = typeof projectsTsv === "string" ? projectsTsv : "";
  const o = typeof oppsTsv === "string" ? oppsTsv : "";
  if (!p.trim() && !o.trim()) return "Choose the Projects export, the Opportunities export, or both.";
  if (p.length + o.length > MAX_CHARS)
    return "Those two files are too large to send together. Export them from Daylite in two parts and import each part in turn.";
  return { p, o };
}

export async function previewDayliteAction(projectsTsv: string, oppsTsv: string): Promise<PreviewResult> {
  await requirePerm("manage_users");
  const input = checkInput(projectsTsv, oppsTsv);
  if (typeof input === "string") return { ok: false, error: input };
  try {
    // `rows` (every planned row) never goes to the browser — the page shows
    // counts, the pick rows and the live rows only.
    const full = await previewHistory(input.p, input.o);
    return {
      ok: true,
      preview: { counts: full.counts, needsPick: full.needsPick, live: full.live, julyEdited: full.julyEdited, stats: full.stats },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function commitDayliteChunkAction(
  projectsTsv: string,
  oppsTsv: string,
  picks: Record<string, string>,
  range: { start: number; end: number }
): Promise<ChunkResult> {
  const user = await requirePerm("manage_users");
  const input = checkInput(projectsTsv, oppsTsv);
  if (typeof input === "string") return { ok: false, error: input };
  const start = Math.max(0, Math.floor(Number(range?.start)) || 0);
  const end = Math.min(start + MAX_CHUNK, Math.max(start, Math.floor(Number(range?.end)) || 0));
  const cleanPicks: Record<string, string> = {};
  if (picks && typeof picks === "object")
    for (const [k, v] of Object.entries(picks).slice(0, 5000))
      if (typeof v === "string") cleanPicks[String(k).slice(0, 100)] = v.slice(0, 300);
  try {
    const res = await commitHistory(input.p, input.o, cleanPicks, user.name || user.email || "Daylite import", { start, end });
    revalidatePath("/", "layout");
    return { ok: true, ...res };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Task 12b — runs ONCE after the last chunk succeeds: retires the July leads
 * (when the Opportunities file was imported) and then the combined-name
 * company stubs nothing references any more. Idempotent, so the client's
 * "Retry finalize" just calls it again.
 */
export async function finalizeDayliteAction(oppsIncluded: boolean): Promise<FinalizeActionResult> {
  const user = await requirePerm("manage_users");
  try {
    const res = await finalizeHistory(oppsIncluded === true, user.name || user.email || "Daylite import");
    revalidatePath("/", "layout");
    return { ok: true, ...res };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
