import { MAX_INTRO } from "@/app/(app)/estimator/narrative";

/**
 * #293 — the system-intro library's pure rules. The store
 * (src/lib/stores/narrative-intros.ts) holds one settings blob,
 * `narrative_intros` = { intros: SystemIntro[] }, and writes ONE operation at
 * a time through applyIntroOp (never a full-list replace), so two editors
 * don't clobber each other's unrelated intros. Client-safe.
 */

export type SystemIntro = {
  /** "NI-" + 8 base36 chars, minted by the store, stable. */
  id: string;
  /** ≤ MAX_INTRO_TITLE chars, trimmed, unique case-insensitively. */
  title: string;
  /** ≤ MAX_INTRO chars, plain text (D488 rules). */
  text: string;
  updatedAt: number;
  updatedBy: string;
};

export type IntroInput = { id?: string | null; title: string; text: string };
export type IntroOp = { kind: "upsert"; intro: unknown } | { kind: "delete"; id: string };

export const MAX_INTROS = 200;
export const MAX_INTRO_TITLE = 120;
export const INTRO_ID_RE = /^NI-[0-9a-z]{8}$/;

const B36 = "0123456789abcdefghijklmnopqrstuvwxyz";

/** `rand` returns [0, 1) — the store passes a crypto source. */
export function newIntroId(rand: () => number): string {
  let s = "";
  for (let i = 0; i < 8; i++) s += B36[Math.min(35, Math.floor(rand() * 36))];
  return "NI-" + s;
}

const byTitle = (a: SystemIntro, b: SystemIntro) => a.title.localeCompare(b.title, "en", { sensitivity: "base" });

export function sanitizeIntro(
  input: unknown,
  list: readonly SystemIntro[]
): { ok: true; value: { id: string | null; title: string; text: string } } | { ok: false; error: string } {
  const o = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const rawId = o.id == null || o.id === "" ? null : o.id;
  if (rawId !== null && (typeof rawId !== "string" || !INTRO_ID_RE.test(rawId))) return { ok: false, error: "That intro no longer exists." };
  const title = (typeof o.title === "string" ? o.title : "").trim();
  if (!title) return { ok: false, error: "Give the intro a title." };
  if (title.length > MAX_INTRO_TITLE) return { ok: false, error: `Keep the title to ${MAX_INTRO_TITLE} characters.` };
  const text = (typeof o.text === "string" ? o.text : "").replace(/\r\n?/g, "\n").trim();
  if (!text) return { ok: false, error: "The intro has no text to save." };
  if (text.length > MAX_INTRO) return { ok: false, error: `Keep the intro under ${MAX_INTRO.toLocaleString("en-US")} characters.` };
  const lower = title.toLowerCase();
  if (list.some((i) => i.id !== rawId && i.title.toLowerCase() === lower)) return { ok: false, error: `An intro named "${title}" already exists.` };
  return { ok: true, value: { id: rawId as string | null, title, text } };
}

/** The stored blob, shape-cleaned on read (malformed rows dropped). */
export function sanitizeIntroList(raw: unknown): SystemIntro[] {
  if (!Array.isArray(raw)) return [];
  const out: SystemIntro[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    if (typeof o.id !== "string" || !INTRO_ID_RE.test(o.id) || typeof o.title !== "string" || typeof o.text !== "string") continue;
    if (out.some((i) => i.id === o.id)) continue;
    out.push({
      id: o.id,
      title: o.title,
      text: o.text,
      updatedAt: typeof o.updatedAt === "number" ? o.updatedAt : 0,
      updatedBy: typeof o.updatedBy === "string" ? o.updatedBy : "",
    });
  }
  return out.sort(byTitle);
}

/** One write. `mint` is called until it returns an unused id (≤ 5 tries). */
export function applyIntroOp(
  list: readonly SystemIntro[],
  op: IntroOp,
  now: number,
  by: string,
  mint: () => string
): { ok: true; list: SystemIntro[]; id: string | null } | { ok: false; error: string } {
  if (op.kind === "delete") {
    return { ok: true, list: list.filter((i) => i.id !== op.id).sort(byTitle), id: null };
  }
  const s = sanitizeIntro(op.intro, list);
  if (!s.ok) return s;
  const { id, title, text } = s.value;
  if (id) {
    if (!list.some((i) => i.id === id)) return { ok: false, error: "That intro no longer exists." };
    const next = list.map((i) => (i.id === id ? { ...i, title, text, updatedAt: now, updatedBy: by } : i));
    return { ok: true, list: next.sort(byTitle), id };
  }
  if (list.length >= MAX_INTROS) return { ok: false, error: `The intro library is full (${MAX_INTROS}). Delete one first.` };
  let fresh = "";
  for (let t = 0; t < 5 && (!fresh || list.some((i) => i.id === fresh)); t++) fresh = mint();
  if (!INTRO_ID_RE.test(fresh) || list.some((i) => i.id === fresh)) return { ok: false, error: "Could not create the intro. Try again." };
  return { ok: true, list: [...list, { id: fresh, title, text, updatedAt: now, updatedBy: by }].sort(byTitle), id: fresh };
}
