/* Assessments engine (#337) — admin-added pick-list values (Settings → Assessments → Pick lists). The definition's
   own values live in code (defs/picklists.ts) and never change; additions live in one settings blob keyed by list
   id. A value is never removed, only retired: retired values stay valid for stored answers but aren't offered. */
import { ASSESSMENT_LOCK_NAMESPACE, withAdvisoryLock } from "@/db";
import { getBlob, setBlob } from "@/db/doc-store";
import { ASSESSMENT_DEF } from "@/lib/assessments/defs";

export const ASSESSMENT_PICKLISTS_BLOB = "assessment_picklists";

export type PicklistExtra = { value: string; label: string; retired?: boolean };
export type PicklistExtras = Record<string, PicklistExtra[]>;

const LABEL_MAX = 80;
const VALUE_MAX = 40;
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** "Arena Bowl" → "arena_bowl": lowercase, runs of anything else → "_", trimmed, ≤ 40 characters. */
export function slugValue(label: string): string {
  return label
    .normalize("NFD").replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, VALUE_MAX)
    .replace(/_+$/g, "");
}

function sanitize(raw: Record<string, unknown>): PicklistExtras {
  const out: PicklistExtras = {};
  for (const [listId, list] of Object.entries(raw)) {
    if (UNSAFE_KEYS.has(listId) || !Array.isArray(list)) continue;
    const items: PicklistExtra[] = [];
    for (const x of list) {
      if (!x || typeof x !== "object") continue;
      const { value, label, retired } = x as { value?: unknown; label?: unknown; retired?: unknown };
      if (typeof value !== "string" || !value || typeof label !== "string") continue;
      items.push(retired === true ? { value, label, retired: true } : { value, label });
    }
    if (items.length) out[listId] = items;
  }
  return out;
}

export async function getPicklistExtras(): Promise<PicklistExtras> {
  return sanitize(await getBlob<Record<string, unknown>>(ASSESSMENT_PICKLISTS_BLOB, {}));
}

/** Adds `label` to list `listId` as value slug(label). Refuses an unknown list, a blank label, or a value that
 *  collides with the definition's codes or an earlier addition (retired ones included). */
export async function addPicklistValue(listId: string, label: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (UNSAFE_KEYS.has(listId) || !Object.hasOwn(ASSESSMENT_DEF.pickLists, listId)) return { ok: false, error: "Unknown pick list" };
  const clean = String(label ?? "").trim().replace(/\s+/g, " ");
  if (!clean) return { ok: false, error: "Enter a label" };
  if (clean.length > LABEL_MAX) return { ok: false, error: `A label can be at most ${LABEL_MAX} characters` };
  const value = slugValue(clean);
  if (!value) return { ok: false, error: "A label needs at least one letter or digit" };
  return withAdvisoryLock(ASSESSMENT_LOCK_NAMESPACE, `picklist:${listId}`, async () => {
    const extras = await getPicklistExtras();
    const cur = extras[listId] ?? [];
    const taken = new Set([...ASSESSMENT_DEF.pickLists[listId].map((o) => o.value), ...cur.map((o) => o.value)]);
    if (taken.has(value)) return { ok: false as const, error: `"${clean}" is already on this list` };
    await setBlob(ASSESSMENT_PICKLISTS_BLOB, { [listId]: [...cur, { value, label: clean }] });
    return { ok: true as const };
  });
}

/** Retires (or restores) an added value. Definition values can't be retired; an unknown value is a no-op. */
export async function setPicklistRetired(listId: string, value: string, retired: boolean): Promise<void> {
  if (UNSAFE_KEYS.has(listId)) return;
  await withAdvisoryLock(ASSESSMENT_LOCK_NAMESPACE, `picklist:${listId}`, async () => {
    const cur = (await getPicklistExtras())[listId];
    if (!cur || !cur.some((o) => o.value === value)) return;
    await setBlob(ASSESSMENT_PICKLISTS_BLOB, {
      [listId]: cur.map((o) => (o.value !== value ? o : retired ? { ...o, retired: true } : { value: o.value, label: o.label })),
    });
  });
}

/** listId → every added value, retired ones included, so stored answers stay valid (validateAnswer's extraOptions). */
export function extrasForValidation(x: PicklistExtras): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [listId, list] of Object.entries(x)) out[listId] = list.map((o) => o.value);
  return out;
}
