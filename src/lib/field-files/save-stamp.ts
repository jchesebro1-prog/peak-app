/* #344 C-final C — per-editor save order. Every Venue Assessment editor mount draws a random editor id; each save run
   it makes carries `saveStamp: { editor, seq }` (the server action's patch and its outbox copy carry the SAME stamp).
   Under the survey lock the store keeps a server-only `_saveSeqs` map (editor → { seq, fullSeq, at }) on the stored doc.
   `saveStamp` is transport-only and `_saveSeqs` is never shown — readers strip both. Pure: no I/O.

   #344 C-final D — "older ⇒ stale" only holds when the newer save wrote everything the older one did. A photo / sketch
   save sends only the file keys, so `seq` is the newest save applied from that editor and `fullSeq` the newest one that
   carried any field edit (a key outside the file keys and transport fields). For a stamped save with seq s:
   - s > seq: applies as sent; seq = s (and fullSeq = s when it carries field edits).
   - fullSeq < s ≤ seq, carrying field edits: only file-only saves came after it, so its field edits are still the
     newest for those fields — it applies WITHOUT its file keys and seen lists (the newer file saves win those);
     seq stays, fullSeq = s.
   - otherwise (s ≤ fullSeq, or a file-only save no newer than seq): stale — a no-op.
   An entry stored before fullSeq existed reads as fullSeq = seq (the old, conservative rule). */

import { FILE_PATCH_KEYS } from "./files";

export const SAVE_STAMP_FIELD = "saveStamp";
export const SAVE_SEQS_FIELD = "_saveSeqs";
/** The map keeps this many editors — the most recent by when they last saved (then by seq). */
export const SAVE_SEQS_KEEP = 20;

export type SaveStamp = { editor: string; seq: number };
export type SaveSeqEntry = { seq: number; fullSeq: number; at: number };
export type SaveSeqs = Record<string, SaveSeqEntry>;
/** What one stamped write does: `apply` as sent, apply its `fields` only (no file keys), or nothing (`stale`). */
export type SaveVerdict = "apply" | "fields" | "stale";

/** Keys that never count as a field edit: the file lists + their seen ids + the stamp, and the transport / bookkeeping
 *  fields a whole-doc copy carries. */
const NOT_FIELD_EDITS: ReadonlySet<string> = new Set<string>([
  ...FILE_PATCH_KEYS, "_saveSeqs", "id", "rev", "updatedAt", "syncState", "syncedAt", "legacyNotes",
]);
/** The file keys a fields-only write leaves out (the stamp is stripped by the store separately). */
const FILE_KEYS: readonly string[] = FILE_PATCH_KEYS.filter((k) => k !== "saveStamp");

/** True when a save (patch or whole doc) carries any field edit — a defined key outside the file keys, the stamp and
 *  the transport fields. A photo / sketch save's file-only patch carries none; a whole doc always does. */
export function carriesFieldEdits(doc: Record<string, unknown> | null | undefined): boolean {
  if (!doc || typeof doc !== "object") return false;
  for (const [k, v] of Object.entries(doc)) if (v !== undefined && !NOT_FIELD_EDITS.has(k)) return true;
  return false;
}

/** A copy without the file lists and their seen ids — what a `fields` verdict writes. */
export function withoutFileKeys<T extends Record<string, unknown>>(doc: T): T {
  const out = { ...doc } as Record<string, unknown>;
  for (const k of FILE_KEYS) delete out[k];
  return out as T;
}

const EDITOR_RE = /^[a-z0-9]{8,40}$/;

/** A random editor id (16 lowercase hex). */
export function newEditorId(): string {
  const b = new Uint8Array(8);
  globalThis.crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

/** A valid stamp, else null (treated as unstamped). */
export function parseSaveStamp(v: unknown): SaveStamp | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const { editor, seq } = v as Record<string, unknown>;
  if (typeof editor !== "string" || !EDITOR_RE.test(editor)) return null;
  if (typeof seq !== "number" || !Number.isSafeInteger(seq) || seq < 1) return null;
  return { editor, seq };
}

/** The stored map, cleaned (anything malformed is dropped; `__proto__` never becomes a key). */
export function readSaveSeqs(v: unknown): SaveSeqs {
  const out: SaveSeqs = Object.create(null) as SaveSeqs;
  if (!v || typeof v !== "object" || Array.isArray(v)) return out;
  for (const [k, e] of Object.entries(v as Record<string, unknown>)) {
    if (!EDITOR_RE.test(k) || !e || typeof e !== "object") continue;
    const { seq, fullSeq, at } = e as Record<string, unknown>;
    if (typeof seq !== "number" || !Number.isSafeInteger(seq) || seq < 1) continue;
    // #344 C-final D: an entry from before fullSeq (or a malformed one) reads as fullSeq = seq — the old rule
    const full = typeof fullSeq === "number" && Number.isSafeInteger(fullSeq) && fullSeq >= 0 && fullSeq <= seq ? fullSeq : seq;
    out[k] = { seq, fullSeq: full, at: typeof at === "number" && Number.isFinite(at) ? at : 0 };
  }
  return out;
}

/** The SAVE_SEQS_KEEP most recent editors (by `at`, then `seq`), as a plain object. */
export function pruneSaveSeqs(seqs: SaveSeqs): SaveSeqs {
  const kept = Object.entries(seqs)
    .sort((a, b) => b[1].at - a[1].at || b[1].seq - a[1].seq)
    .slice(0, SAVE_SEQS_KEEP);
  return Object.fromEntries(kept);
}

/**
 * The order check for one write (#344 C-final D rules in the header). `carriesFields` — the write carries a field edit
 * (`carriesFieldEdits`); a whole doc always does. Returns the verdict, `stale` (= verdict "stale"), and `seqs`: the map
 * to store — the stored one unchanged for an unstamped write (undefined when there is none), else with this editor's
 * entry updated at `at`, pruned; undefined for a stale write (nothing is written).
 */
export function checkSaveStamp(
  storedSeqs: unknown,
  stamp: SaveStamp | null,
  at: number,
  carriesFields = true,
): { stale: boolean; verdict: SaveVerdict; seqs: SaveSeqs | undefined } {
  const cur = readSaveSeqs(storedSeqs);
  if (!stamp) return { stale: false, verdict: "apply", seqs: Object.keys(cur).length ? pruneSaveSeqs(cur) : undefined };
  const prev = cur[stamp.editor];
  if (!prev || stamp.seq > prev.seq) {
    cur[stamp.editor] = { seq: stamp.seq, fullSeq: carriesFields ? stamp.seq : (prev?.fullSeq ?? 0), at };
    return { stale: false, verdict: "apply", seqs: pruneSaveSeqs(cur) };
  }
  if (carriesFields && stamp.seq > prev.fullSeq) {
    // only file-only saves came after this one: its field edits are still the newest for those fields
    cur[stamp.editor] = { seq: prev.seq, fullSeq: stamp.seq, at: Math.max(prev.at, at) };
    return { stale: false, verdict: "fields", seqs: pruneSaveSeqs(cur) };
  }
  return { stale: true, verdict: "stale", seqs: undefined };
}

/** A copy without the stamp and the seq map — for anything a reader, a print or the client sees. */
export function withoutSaveFields<T extends object>(doc: T): T {
  const out = { ...doc } as Record<string, unknown>;
  delete out[SAVE_STAMP_FIELD];
  delete out[SAVE_SEQS_FIELD];
  return out as T;
}

/** #344 C-final E — the survey stages in lifecycle order (the store's STAGES; a test pins the two together). Kept here so
 *  the client editor can order stages without importing the store. */
export const SURVEY_STAGE_ORDER = ["requested", "scheduled", "onsite", "completed"] as const;

/**
 * #344 C-final E — a stage move from this editor (`pending`, made when the server stage was `from`) no longer needs
 * re-carrying once the server shows `server`: it is settled when the server holds the moved-to stage (confirmed), or
 * when the server has moved on past it — a stage other than the one the move started from AND later in the lifecycle
 * (a move made elsewhere after ours; re-sending ours would move it backwards). A server still at `from`, or at an
 * earlier stage than `pending` (an earlier move of ours landing late), leaves it pending. Pure.
 */
export function pendingStageSettled(pending: string | null, from: string | null, server: string | null | undefined): boolean {
  if (pending === null) return false;
  const srv = server || "requested";
  if (srv === pending) return true;
  if (srv === (from || "requested")) return false;
  const order: readonly string[] = SURVEY_STAGE_ORDER;
  const i = order.indexOf(srv);
  const j = order.indexOf(pending);
  return i >= 0 && j >= 0 && i > j;
}

/**
 * #344 C-final E — after a file-only save lands online, keep this record's queued outbox entry only when it is the one
 * holding this editor's unsent field edits: stamped by this editor mount with the seq of the newest field save (or a
 * later save whose whole-doc copy re-carried it) that went to the outbox. Anything else — a timed-out photo save's
 * copy of already-saved fields, an unstamped entry, another mount's entry — is cleared as before #344 C-final D, so a
 * stale whole-doc copy never replays old fields over another device's write.
 */
export function holdsUnsentFieldEdits(entryDoc: Record<string, unknown> | null | undefined, editor: string, unsentSeq: number | null): boolean {
  if (unsentSeq === null || !entryDoc) return false;
  const st = parseSaveStamp(entryDoc[SAVE_STAMP_FIELD]);
  return !!st && st.editor === editor && st.seq === unsentSeq;
}
