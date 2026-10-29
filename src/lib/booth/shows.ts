/**
 * Trade show booth capture — the Shows list and the contact-card slug map.
 * Pure: the store (`src/lib/stores/booth.ts`) applies one op under the blob's
 * row lock. At most one show is active; an archived show is never active.
 */

export type Show = {
  id: string; // sh_<8 hex>
  name: string;
  startAt: number | null;
  endAt: number | null;
  active: boolean;
  archived: boolean;
  createdAt: number;
};

const SHOW_ID = /^sh_[0-9a-f]{8}$/;
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const text = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

export function sanitizeShows(raw: unknown): Show[] {
  if (!Array.isArray(raw)) return [];
  const out: Show[] = [];
  let seenActive = false;
  for (const r of raw) {
    const o = (r || {}) as Record<string, unknown>;
    const id = typeof o.id === "string" ? o.id : "";
    const name = text(o.name, 120);
    if (!SHOW_ID.test(id) || !name || out.some((s) => s.id === id)) continue;
    const archived = o.archived === true;
    const active = o.active === true && !archived && !seenActive;
    if (active) seenActive = true;
    out.push({ id, name, startAt: num(o.startAt), endAt: num(o.endAt), active, archived, createdAt: num(o.createdAt) ?? 0 });
  }
  return out;
}

export function activeShow(list: Show[]): Show | null {
  return list.find((s) => s.active && !s.archived) || null;
}

export type ShowOp =
  | { kind: "upsert"; show: unknown }
  | { kind: "activate"; id: string }
  | { kind: "deactivate" }
  | { kind: "archive"; id: string }
  | { kind: "unarchive"; id: string };

export type ShowOpResult = { ok: true; list: Show[]; id?: string } | { ok: false; error: string };

export function applyShowOp(list: Show[], op: ShowOp, now: number, mintId: () => string): ShowOpResult {
  if (op.kind === "deactivate") return { ok: true, list: list.map((s) => ({ ...s, active: false })) };
  if (op.kind === "activate" || op.kind === "archive" || op.kind === "unarchive") {
    if (!list.some((s) => s.id === op.id)) return { ok: false, error: "That show no longer exists." };
    if (op.kind === "activate") {
      if (list.find((s) => s.id === op.id)?.archived) return { ok: false, error: "Unarchive the show first." };
      return { ok: true, list: list.map((s) => ({ ...s, active: s.id === op.id })) };
    }
    const archived = op.kind === "archive";
    return { ok: true, list: list.map((s) => (s.id === op.id ? { ...s, archived, active: false } : s)) };
  }
  const o = (op.show || {}) as Record<string, unknown>;
  const name = text(o.name, 120);
  if (!name) return { ok: false, error: "Give the show a name." };
  const startAt = num(o.startAt);
  const endAt = num(o.endAt);
  if (startAt != null && endAt != null && endAt < startAt) return { ok: false, error: "The show ends before it starts." };
  const id = typeof o.id === "string" ? o.id : "";
  const existing = id ? list.find((s) => s.id === id) : undefined;
  if (id && !existing) return { ok: false, error: "That show no longer exists." };
  if (existing) return { ok: true, id, list: list.map((s) => (s.id === id ? { ...s, name, startAt, endAt } : s)) };
  const show: Show = { id: mintId(), name, startAt, endAt, active: false, archived: false, createdAt: now };
  return { ok: true, id: show.id, list: [...list, show] };
}

/* ---- contact cards: public slug → user id ---- */

export type ContactCards = Record<string, string>;

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;

export function normalizeSlug(s: string): string {
  return String(s || "").trim().toLowerCase();
}

export function slugProblem(slug: string): string | null {
  return SLUG.test(slug) ? null : "Use 1–32 lowercase letters, numbers or dashes (not at the ends).";
}

export function sanitizeCards(raw: unknown): ContactCards {
  const out: ContactCards = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (slugProblem(k) === null && typeof v === "string" && v.trim()) out[k] = v.trim();
  }
  return out;
}
