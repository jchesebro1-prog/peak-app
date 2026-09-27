"use server";

import { requirePerm } from "@/lib/session";
import type { BatchResult, CalendarPreview } from "@/lib/daylite/calendar-batch";
import { importCalendarBatch, previewCalendarImport } from "@/lib/daylite/calendar-import";

/**
 * Daylite calendar import (#219) — admin-only server seam. The TSV text
 * travels on every call (the server re-parses; nothing is cached), capped
 * under next.config's 1200 kb server-action body limit, like the history
 * import. requirePerm stays OUTSIDE the try blocks: it redirects, and a
 * caught redirect would be swallowed into an error message.
 */

const MAX_CHARS = 1_100_000;
const MAX_OWNERS = 100;
const MAX_SKIP = 5_000;
const KEY_RE = /^[0-9a-f]{24}$/;

export type CalendarPreviewResult = { ok: true; preview: CalendarPreview } | { ok: false; error: string };
export type CalendarBatchResult = ({ ok: true } & BatchResult) | { ok: false; error: string };

function checkText(text: unknown): { text: string } | { error: string } {
  const t = typeof text === "string" ? text : "";
  if (!t.trim()) return { error: "Choose Daylite's Calendar Events export (.tsv) first." };
  if (t.length > MAX_CHARS)
    return { error: "That file is too large to send in one piece. Export a shorter date range from Daylite and import each part in turn." };
  return { text: t };
}

export async function previewCalendarAction(text: string, fromToday: boolean): Promise<CalendarPreviewResult> {
  await requirePerm("manage_users");
  const input = checkText(text);
  if ("error" in input) return { ok: false, error: input.error };
  try {
    return { ok: true, preview: await previewCalendarImport(input.text, { fromToday: fromToday === true }) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function importCalendarBatchAction(
  text: string,
  input: { fromToday: boolean; owners: string[]; skipKeys: string[] }
): Promise<CalendarBatchResult> {
  await requirePerm("manage_users");
  const checked = checkText(text);
  if ("error" in checked) return { ok: false, error: checked.error };
  const owners = Array.isArray(input?.owners)
    ? input.owners.filter((o): o is string => typeof o === "string" && o.trim() !== "").slice(0, MAX_OWNERS).map((o) => o.slice(0, 200))
    : [];
  if (!owners.length) return { ok: false, error: "Tick at least one person to import." };
  const skipKeys = Array.isArray(input?.skipKeys)
    ? input.skipKeys.filter((k): k is string => typeof k === "string" && KEY_RE.test(k)).slice(0, MAX_SKIP)
    : [];
  try {
    const res = await importCalendarBatch(checked.text, { fromToday: input?.fromToday === true, owners, skipKeys });
    return { ok: true, ...res };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
