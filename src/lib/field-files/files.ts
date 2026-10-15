/*
 * Files of a record (#344 C4) — the id, path and merge rules shared by the device photo queue, the survey store and
 * the survey upload / bytes routes. Pure and client-safe: no server imports.
 *
 * A record's kind is read from its id prefix (`AS-` assessment, `FS-` survey); its files live under that kind's Blob
 * prefix (`assessments/<AS-…>/`, `surveys/<FS-…>/`). An assessment photo's path is exactly the engine's
 * `photoBlobPath` (#340), so the engine is unchanged.
 *
 * | File                              | Id                       | Path            | Type             |
 * | photo original                    | `p_<hex>`                | `<id>.jpg`      | image/jpeg       |
 * | photo markup (flattened)          | `m_<its own hex>`        | `<id>.jpg`      | image/jpeg       |
 * | strokes (photo markup or sketch)  | `k_<markup/sketch hex>`  | `<id>.json`     | application/json |
 * | sketch (flattened)                | `s_<hex>`                | `<id>.jpg`      | image/jpeg       |
 *
 * Blob may add `-<suffix>` before the extension; ids never contain `-`, so one file can't alias another's blob.
 *
 * A photo markup gets a NEW `m_` id every time it is (re)done, stored on `ref.markup.id`, so a late upload of a
 * superseded markup can never land in the new markup's slots (its id no longer owns anything).
 */

export type RecordKind = "assessment" | "survey";

/** A file slot: a private Blob path once uploaded, a small data URL (local dev without Blob), or still `pending`. */
export type FileSlot = { blobPath?: string; inline?: string; pending?: true };
/** A finished slot as the server hands it back. */
export type FinishedSlot = { blobPath: string; inline?: undefined } | { inline: string; blobPath?: undefined };

export type SurveyPhotoRef = {
  id: string; // p_<hex>
  section: string;
  takenAt: number;
  by: string;
  caption?: string;
  file: FileSlot;
  markup?: { id: string /* m_<hex> */; image: FileSlot; strokes: FileSlot; updatedAt: number };
};
export type SketchRef = { id: string; image: FileSlot; strokes: FileSlot; updatedAt: number; by: string };

/** A file id: kind letter + `_` + 8–32 lowercase letters/digits. No `-` (Blob's suffix separator). */
export const FILE_ID_RE = /^[pmks]_[a-z0-9]{8,32}$/;

/** Inline (dev / no-Blob) caps, in data-URL characters. */
export const INLINE_CAPS = { jpeg: 400_000, json: 200_000, totalPerSurvey: 1_500_000 } as const;
/** Upload caps the survey broker grants, in bytes. */
export const UPLOAD_CAPS = { jpeg: 5 * 1024 * 1024, json: 2 * 1024 * 1024 } as const;

const RECORD_RE: Record<RecordKind, RegExp> = { assessment: /^AS-\d+$/, survey: /^FS-\d+$/ };

function hex12(): string {
  const b = new Uint8Array(6);
  globalThis.crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

/** A fresh photo (`p_`), markup (`m_`, new for every (re)markup) or sketch (`s_`) id: 12 random lowercase hex. */
export function newFileId(kind: "p" | "m" | "s"): string {
  return `${kind}_${hex12()}`;
}

/** The strokes (`k_`) id that belongs to a markup / sketch: same hex. */
export function siblingId(id: string, kind: "k"): string {
  if (typeof id !== "string" || !FILE_ID_RE.test(id)) throw new Error("That file id isn't valid");
  return `${kind}_${id.slice(2)}`;
}

export function recordKind(recordId: unknown): RecordKind | null {
  if (typeof recordId !== "string") return null;
  if (RECORD_RE.assessment.test(recordId)) return "assessment";
  if (RECORD_RE.survey.test(recordId)) return "survey";
  return null;
}

/** Which broker + finalize the device queue uses for a file: the record's kind when the file id is valid for it (an
 *  assessment takes `p_` photos only), else null — terminal, so a bad id is never retried for a week. */
export function fileRouteKind(recordId: unknown, fileId: unknown): RecordKind | null {
  if (typeof fileId !== "string" || !FILE_ID_RE.test(fileId)) return null;
  const kind = recordKind(recordId);
  if (kind === "assessment") return fileId.startsWith("p_") ? kind : null;
  return kind;
}

export function filePrefix(kind: RecordKind): string {
  return kind === "assessment" ? "assessments/" : "surveys/";
}

function extOf(fileId: string): "jpg" | "json" {
  return fileId.startsWith("k_") ? "json" : "jpg";
}

export function fileContentType(fileId: string): "image/jpeg" | "application/json" {
  return extOf(fileId) === "json" ? "application/json" : "image/jpeg";
}

/** The one path a record's file is uploaded to (before Blob's random suffix). Throws on a bad record or file id. */
export function fileBlobPath(recordId: string, fileId: string): string {
  const kind = recordKind(recordId);
  if (!kind) throw new Error("That record id isn't valid");
  if (typeof fileId !== "string" || !FILE_ID_RE.test(fileId)) throw new Error("That file id isn't valid");
  return `${filePrefix(kind)}${recordId}/${fileId}.${extOf(fileId)}`;
}

/** A client-supplied path is trusted only inside its own record folder: one safe `.jpg` / `.json` segment, no "..". */
export function filePathInScope(path: unknown, recordId: string): boolean {
  const kind = recordKind(recordId);
  if (typeof path !== "string" || !kind) return false;
  const prefix = `${filePrefix(kind)}${recordId}/`;
  if (!path.startsWith(prefix)) return false;
  const rest = path.slice(prefix.length);
  return !/^\.+$/.test(rest) && !rest.includes("..") && /^[A-Za-z0-9_-][A-Za-z0-9._-]*\.(jpg|json)$/.test(rest);
}

/** The one Blob path an upload for `fileId` may land at: `<fileId>.<ext>` or `<fileId>-<alnum suffix>.<ext>` in the
 *  record's own folder (the engine's `photoPathMatches` rule, with the extension by file kind). */
export function filePathMatches(path: unknown, recordId: string, fileId: string): boolean {
  if (typeof fileId !== "string" || !FILE_ID_RE.test(fileId) || !filePathInScope(path, recordId)) return false;
  const kind = recordKind(recordId)!;
  const file = (path as string).slice(`${filePrefix(kind)}${recordId}/`.length);
  const ext = `.${extOf(fileId)}`;
  if (!file.endsWith(ext)) return false;
  if (file === `${fileId}${ext}`) return true;
  return file.startsWith(`${fileId}-`) && /^[A-Za-z0-9]+$/.test(file.slice(fileId.length + 1, file.length - ext.length));
}

export const INLINE_JPEG_PREFIX = "data:image/jpeg;base64,";
export const INLINE_JSON_PREFIX = "data:application/json;base64,";

export function inlinePrefix(fileId: string): string {
  return extOf(fileId) === "json" ? INLINE_JSON_PREFIX : INLINE_JPEG_PREFIX;
}

function b64Bytes(body: string): Uint8Array {
  const bin = atob(body);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Why a data URL isn't an acceptable inline file for `fileId`, or null. A JPEG id needs a JPEG data URL whose bytes
 *  start FF D8 FF (≤ INLINE_CAPS.jpeg characters); a `k_` id needs a JSON data URL that parses to an object or array
 *  (≤ INLINE_CAPS.json). The label alone is never trusted. */
export function inlineFileProblem(fileId: string, dataUrl: unknown): string | null {
  const json = extOf(fileId) === "json";
  const prefix = json ? INLINE_JSON_PREFIX : INLINE_JPEG_PREFIX;
  const cap = json ? INLINE_CAPS.json : INLINE_CAPS.jpeg;
  const msg = json ? `Inline strokes must be a JSON data URL up to ${cap.toLocaleString("en-US")} characters` : `An inline image must be a JPEG data URL up to ${cap.toLocaleString("en-US")} characters`;
  if (typeof dataUrl !== "string" || !dataUrl.startsWith(prefix) || dataUrl.length > cap) return msg;
  const body = dataUrl.slice(prefix.length);
  if (body.length < 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(body)) return msg;
  try {
    if (json) {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(b64Bytes(body));
      if (text[0] !== "{" && text[0] !== "[") return msg;
      JSON.parse(text);
      return null;
    }
    const head = atob(body.slice(0, 4));
    return head.charCodeAt(0) === 0xff && head.charCodeAt(1) === 0xd8 && head.charCodeAt(2) === 0xff ? null : msg;
  } catch {
    return msg;
  }
}

/* ------------------------------------------------------------------ */
/* refs                                                                 */
/* ------------------------------------------------------------------ */

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

export function slotFinished(slot: unknown): boolean {
  return isObj(slot) && ((typeof slot.blobPath === "string" && !!slot.blobPath) || (typeof slot.inline === "string" && !!slot.inline));
}

/** A stored finished slot always wins (only the finalize writes one, and it is never replaced); else the incoming. */
function keepFinished(stored: unknown, incoming: unknown): unknown {
  return slotFinished(stored) ? stored : incoming;
}

/** The sketch rule: the same markup id keeps finished slots per slot; a different id (a re-markup) is taken wholesale. */
function mergeMarkup(stored: unknown, incoming: unknown): unknown {
  if (!isObj(incoming) || !isObj(stored)) return incoming; // removed markup stays removed; a first markup is the incoming one
  if (typeof incoming.id !== "string" || incoming.id !== stored.id) return incoming;
  return { ...incoming, image: keepFinished(stored.image, incoming.image), strokes: keepFinished(stored.strokes, incoming.strokes) };
}

/**
 * The survey write paths' merge rule: returns `incoming` with, for every photo ref / sketch / markup present in both
 * (same id), each slot that is finished in `stored` kept as stored — so a save made from a copy older than an upload
 * never loses the finished file, and nothing the client sends replaces a finished file. A sketch or markup whose
 * incoming id differs (a re-draw / re-markup) is taken as sent; refs absent from `incoming` stay absent (deleted).
 * Callers pass `incoming` through `sanitizeIncomingFileSlots` first, so the client never mints a finished slot.
 * Pure: neither input is mutated.
 */
export function mergeSurveyFileRefs(stored: Record<string, unknown>, incoming: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...incoming };
  if (Array.isArray(incoming.photoRefs) && Array.isArray(stored?.photoRefs)) {
    const byId = new Map<string, Record<string, unknown>>();
    for (const r of stored.photoRefs) if (isObj(r) && typeof r.id === "string") byId.set(r.id, r);
    out.photoRefs = incoming.photoRefs.map((r: unknown) => {
      if (!isObj(r) || typeof r.id !== "string") return r;
      const s = byId.get(r.id);
      if (!s) return r;
      const next: Record<string, unknown> = { ...r, file: keepFinished(s.file, r.file) };
      if ("markup" in r) {
        const m = mergeMarkup(s.markup, r.markup);
        if (m === undefined) delete next.markup;
        else next.markup = m;
      }
      return next;
    });
  }
  if (isObj(incoming.sketches) && isObj(stored?.sketches)) {
    const sk: Record<string, unknown> = {};
    for (const [key, r] of Object.entries(incoming.sketches)) {
      const s = (stored.sketches as Record<string, unknown>)[key];
      sk[key] = isObj(r) && isObj(s) && typeof r.id === "string" && r.id === s.id
        ? { ...r, image: keepFinished(s.image, r.image), strokes: keepFinished(s.strokes, r.strokes) }
        : r;
    }
    out.sketches = sk;
  }
  return out;
}

/** An incoming finished slot, kept only when it is this file's own: a Blob path in this survey under `fileId`
 *  (Blob's `-suffix` allowed), or — without Blob — a real inline file of its kind. Anything else is `{ pending }`. */
function sanitizeSlot(slot: unknown, surveyId: string, fileId: string, blob: boolean): unknown {
  if (!slotFinished(slot)) return slot;
  const s = slot as Record<string, unknown>;
  const valid = FILE_ID_RE.test(fileId);
  if (typeof s.blobPath === "string" && s.blobPath) {
    return valid && filePathMatches(s.blobPath, surveyId, fileId) ? { blobPath: s.blobPath } : { pending: true };
  }
  return valid && !blob && inlineFileProblem(fileId, s.inline) === null ? { inline: s.inline } : { pending: true };
}

const idWith = (id: unknown, letter: string): string => (typeof id === "string" && id.startsWith(`${letter}_`) && FILE_ID_RE.test(id) ? id : "");
const strokesOf = (id: string): string => (id ? `k_${id.slice(2)}` : "");

/**
 * Before any client copy (an editor save, a sync push) is merged: every finished slot it carries is downgraded to
 * `{ pending: true }` unless it is that slot's own file — `filePathMatches(path, surveyId, <the slot's file id>)`, or an
 * inline file of the right kind when `blobEnabled` is false. Owning ids: a photo's `file` → its `p_` id; its markup's
 * `image` → `markup.id` (`m_`), `strokes` → `k_` + the markup's hex; a sketch's `image` → its `s_` id, `strokes` →
 * `k_` + its hex. A bad or wrong-letter owning id downgrades its slots. Only the finalize creates finished slots.
 * Pure: the input is not mutated; everything but the slots is returned as sent.
 */
export function sanitizeIncomingFileSlots<T extends Record<string, unknown>>(doc: T, surveyId: string, opts: { blobEnabled: boolean }): T {
  const blob = opts.blobEnabled;
  const out: Record<string, unknown> = { ...doc };
  if (Array.isArray(doc.photoRefs)) {
    out.photoRefs = doc.photoRefs.map((r: unknown) => {
      if (!isObj(r)) return r;
      const next: Record<string, unknown> = { ...r, file: sanitizeSlot(r.file, surveyId, idWith(r.id, "p"), blob) };
      if (isObj(r.markup)) {
        const m = idWith(r.markup.id, "m");
        next.markup = { ...r.markup, image: sanitizeSlot(r.markup.image, surveyId, m, blob), strokes: sanitizeSlot(r.markup.strokes, surveyId, strokesOf(m), blob) };
      }
      return next;
    });
  }
  if (isObj(doc.sketches)) {
    const sk: Record<string, unknown> = {};
    for (const [key, r] of Object.entries(doc.sketches)) {
      if (!isObj(r)) {
        sk[key] = r;
        continue;
      }
      const id = idWith(r.id, "s");
      sk[key] = { ...r, image: sanitizeSlot(r.image, surveyId, id, blob), strokes: sanitizeSlot(r.strokes, surveyId, strokesOf(id), blob) };
    }
    out.sketches = sk;
  }
  return out as T;
}

type RefsDoc = { photoRefs?: SurveyPhotoRef[]; sketches?: Record<string, SketchRef> };

/** Where a file's slot lives in a survey: `[kind, index or key, field]`, or null when no ref owns it (yet). */
type Owner = { at: "photo"; i: number; field: "file" | "markupImage" | "markupStrokes" } | { at: "sketch"; key: string; field: "image" | "strokes" };

function ownerOf(doc: RefsDoc, fileId: string): Owner | null {
  if (typeof fileId !== "string" || !FILE_ID_RE.test(fileId)) return null;
  const hex = fileId.slice(2);
  const refs = Array.isArray(doc?.photoRefs) ? doc.photoRefs : [];
  const sketches = isObj(doc?.sketches) ? (doc.sketches as Record<string, SketchRef>) : {};
  const photoAt = (id: string) => refs.findIndex((r) => isObj(r) && r.id === id);
  const markupAt = (id: string) => refs.findIndex((r) => isObj(r) && isObj(r.markup) && r.markup.id === id);
  const sketchKey = Object.keys(sketches).find((k) => isObj(sketches[k]) && sketches[k].id === `s_${hex}`);
  switch (fileId[0]) {
    case "p": {
      const i = photoAt(fileId);
      return i >= 0 ? { at: "photo", i, field: "file" } : null;
    }
    case "m": {
      const i = markupAt(fileId);
      return i >= 0 ? { at: "photo", i, field: "markupImage" } : null;
    }
    case "k": {
      const i = markupAt(`m_${hex}`);
      if (i >= 0) return { at: "photo", i, field: "markupStrokes" };
      return sketchKey !== undefined ? { at: "sketch", key: sketchKey, field: "strokes" } : null;
    }
    case "s":
      return sketchKey !== undefined ? { at: "sketch", key: sketchKey, field: "image" } : null;
  }
  return null;
}

function slotAt(doc: RefsDoc, o: Owner): FileSlot | undefined {
  if (o.at === "sketch") return doc.sketches![o.key][o.field];
  const r = doc.photoRefs![o.i];
  return o.field === "file" ? r.file : o.field === "markupImage" ? r.markup!.image : r.markup!.strokes;
}

/** The slot a file id resolves to in a survey, or null when no ref owns it. */
export function fileSlotOf(doc: RefsDoc, fileId: string): FileSlot | null {
  const o = ownerOf(doc, fileId);
  return o ? slotAt(doc, o) ?? null : null;
}

/**
 * Fold one finished file into a survey's refs (the store's finalize and the editor's queue `onDone` share it):
 * `set` with a new doc (the slot replaced by exactly `{ blobPath }` or `{ inline }`, so `pending` is dropped),
 * `already` with the stored slot when it is finished (never replaced), or `missing` when no ref owns the file yet.
 * Pure: `doc` is not mutated.
 */
export function foldFileSlot<T extends RefsDoc>(
  doc: T,
  fileId: string,
  slot: FinishedSlot,
): { status: "set"; doc: T } | { status: "already"; slot: FinishedSlot } | { status: "missing" } {
  const o = ownerOf(doc, fileId);
  if (!o) return { status: "missing" };
  const cur = slotAt(doc, o);
  if (slotFinished(cur)) {
    return { status: "already", slot: cur!.blobPath ? { blobPath: cur!.blobPath } : { inline: cur!.inline! } };
  }
  const fresh: FileSlot = slot.blobPath ? { blobPath: slot.blobPath } : { inline: slot.inline! };
  if (o.at === "sketch") {
    const sketches = { ...doc.sketches!, [o.key]: { ...doc.sketches![o.key], [o.field]: fresh } };
    return { status: "set", doc: { ...doc, sketches } };
  }
  const refs = [...doc.photoRefs!];
  const r = refs[o.i];
  refs[o.i] =
    o.field === "file"
      ? { ...r, file: fresh }
      : { ...r, markup: { ...r.markup!, ...(o.field === "markupImage" ? { image: fresh } : { strokes: fresh }) } };
  return { status: "set", doc: { ...doc, photoRefs: refs } };
}

/** All inline data-URL characters a survey's file refs hold (photo files, markups, sketches). */
export function surveyInlineTotal(doc: RefsDoc): number {
  let n = 0;
  const add = (s: unknown) => {
    if (isObj(s) && typeof s.inline === "string") n += s.inline.length;
  };
  for (const r of Array.isArray(doc?.photoRefs) ? doc.photoRefs : []) {
    if (!isObj(r)) continue;
    add(r.file);
    if (isObj(r.markup)) {
      add(r.markup.image);
      add(r.markup.strokes);
    }
  }
  for (const s of Object.values(isObj(doc?.sketches) ? (doc.sketches as Record<string, SketchRef>) : {})) {
    if (!isObj(s)) continue;
    add(s.image);
    add(s.strokes);
  }
  return n;
}
