/* #344 C-final C — per-editor save order. Every Venue Assessment editor mount draws a random editor id; each save run
   it makes carries `saveStamp: { editor, seq }` (the server action's patch and its outbox copy carry the SAME stamp).
   Under the survey lock the store keeps a server-only `_saveSeqs` map (editor → highest seq + when) on the stored doc:
   a stamped write whose seq is not newer than that editor's stored seq is a no-op (a timed-out save landing after a
   newer one from the same editor, or the action + its outbox copy both arriving). Unstamped writes apply as before.
   `saveStamp` is transport-only and `_saveSeqs` is never shown — readers strip both. Pure: no I/O. */

export const SAVE_STAMP_FIELD = "saveStamp";
export const SAVE_SEQS_FIELD = "_saveSeqs";
/** The map keeps this many editors — the most recent by when they last saved (then by seq). */
export const SAVE_SEQS_KEEP = 20;

export type SaveStamp = { editor: string; seq: number };
export type SaveSeqs = Record<string, { seq: number; at: number }>;

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
    const { seq, at } = e as Record<string, unknown>;
    if (typeof seq !== "number" || !Number.isSafeInteger(seq) || seq < 1) continue;
    out[k] = { seq, at: typeof at === "number" && Number.isFinite(at) ? at : 0 };
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
 * The order check for one write. `stale` — the stamp's seq is not newer than its editor's stored seq (the write must
 * not apply). Otherwise `seqs` is the map to store: the stored one unchanged for an unstamped write (undefined when
 * there is none), or with this editor's seq recorded at `at`, pruned.
 */
export function checkSaveStamp(storedSeqs: unknown, stamp: SaveStamp | null, at: number): { stale: boolean; seqs: SaveSeqs | undefined } {
  const cur = readSaveSeqs(storedSeqs);
  if (!stamp) return { stale: false, seqs: Object.keys(cur).length ? pruneSaveSeqs(cur) : undefined };
  const prev = cur[stamp.editor];
  if (prev && stamp.seq <= prev.seq) return { stale: true, seqs: undefined };
  cur[stamp.editor] = { seq: stamp.seq, at };
  return { stale: false, seqs: pruneSaveSeqs(cur) };
}

/** A copy without the stamp and the seq map — for anything a reader, a print or the client sees. */
export function withoutSaveFields<T extends object>(doc: T): T {
  const out = { ...doc } as Record<string, unknown>;
  delete out[SAVE_STAMP_FIELD];
  delete out[SAVE_SEQS_FIELD];
  return out as T;
}
