import { randomBytes } from "node:crypto";
import { getBlob, getDoc, listDocsByField, updateBlob } from "@/db/doc-store";
import { applyShowOp, activeShow, normalizeSlug, sanitizeCards, sanitizeShows, slugProblem, type ContactCards, type Show, type ShowOp, type ShowOpResult } from "@/lib/booth/shows";
import type { BoothCapture } from "@/lib/booth/capture";

/**
 * Trade show booth capture store. Two settings blobs, no table (the
 * narrative_intros idiom), each write ONE op under the blob's row lock:
 *   trade_shows     { shows: Show[] }
 *   contact_cards   { cards: { [slug]: userId } }
 * plus reads of the booth_captures doc collection.
 *
 * updateBlob merges the returned object into the stored row at the TOP level
 * (`data || patch`), so returning the whole `shows` / `cards` value replaces
 * that key — a deleted slug really goes away.
 */

const SHOWS_BLOB = "trade_shows";
const CARDS_BLOB = "contact_cards";

export async function listShows(): Promise<Show[]> {
  const row = await getBlob<Record<string, unknown>>(SHOWS_BLOB, {});
  return sanitizeShows(row.shows);
}

export async function getActiveShow(): Promise<Show | null> {
  return activeShow(await listShows());
}

export async function writeShow(op: ShowOp): Promise<ShowOpResult> {
  const now = Date.now();
  const out: { res?: ShowOpResult } = {};
  await updateBlob(SHOWS_BLOB, (raw) => {
    const res = applyShowOp(sanitizeShows(raw.shows), op, now, () => "sh_" + randomBytes(4).toString("hex"));
    out.res = res;
    return res.ok ? { shows: res.list } : null;
  });
  return out.res!;
}

export async function listCards(): Promise<ContactCards> {
  const row = await getBlob<Record<string, unknown>>(CARDS_BLOB, {});
  return sanitizeCards(row.cards);
}

export async function cardUserId(slug: string): Promise<string | null> {
  return (await listCards())[normalizeSlug(slug)] ?? null;
}

/** userId null removes the slug. One slug → one user; a user may hold one slug (an earlier one is removed). */
export async function setCard(slug: string, userId: string | null): Promise<{ ok: true } | { ok: false; error: string }> {
  const s = normalizeSlug(slug);
  const problem = slugProblem(s);
  if (problem) return { ok: false, error: problem };
  await updateBlob(CARDS_BLOB, (raw) => {
    const cards = sanitizeCards(raw.cards);
    if (userId) for (const [k, v] of Object.entries(cards)) if (v === userId) delete cards[k];
    if (userId) cards[s] = userId;
    else delete cards[s];
    return { cards };
  });
  return { ok: true };
}

export async function getCapture(id: string): Promise<BoothCapture | null> {
  return getDoc<BoothCapture & { id: string }>("booth_captures", id);
}

export async function listCapturesForShow(showId: string): Promise<BoothCapture[]> {
  const rows = await listDocsByField<BoothCapture & { id: string }>("booth_captures", "showId", [showId]);
  return rows.sort((a, b) => (b.capturedAt || 0) - (a.capturedAt || 0));
}
