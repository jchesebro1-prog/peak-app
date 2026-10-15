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

import { isSketchKey, type SketchKey } from "../ink/backgrounds";

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

/** #344 C-final: the transport-only fields a client save / push carries — the photo ref ids (`p_…`) and sketch ids
 *  (`s_…`) the client has seen (loaded from the record or created in its session). Never stored. */
export const SURVEY_SEEN_FIELDS = ["photoRefIdsSeen", "sketchIdsSeen"] as const;

/** A seen list as a set; anything but an array is "absent" (null) — an old client or another writer. */
function seenSet(v: unknown): Set<string> | null {
  return Array.isArray(v) ? new Set(v.filter((x): x is string => typeof x === "string")) : null;
}

/**
 * The survey write paths' merge rule: returns `incoming` with, for every photo ref / sketch / markup present in both
 * (same id), each slot that is finished in `stored` kept as stored — so a save made from a copy older than an upload
 * never loses the finished file, and nothing the client sends replaces a finished file. A markup whose incoming id
 * differs (a re-markup) is taken as sent. Callers pass `incoming` through `sanitizeIncomingFileSlots` first, so the
 * client never mints a finished slot. Pure: neither input is mutated.
 *
 * #344 C-final — a client only deletes what it has seen. `incoming.photoRefIdsSeen` / `sketchIdsSeen` list the ids
 * the client saw; both are stripped from the result (transport-only).
 * - A stored photo ref absent from the incoming list is kept unless its id is in `photoRefIdsSeen`; kept refs follow
 *   the incoming order, oldest first. Kept refs are never dropped by SURVEY_PHOTO_CAP — the incoming refs that are
 *   new to the server give way, newest first.
 * - A stored sketch whose pad the incoming copy leaves out, or fills with a different id, wins unless its id is in
 *   `sketchIdsSeen` (the client saw it and re-drew or removed it on purpose).
 * - No seen list (an old client, another writer) means nothing is deleted; a copy with no `photoRefs` / `sketches`
 *   at all keeps the stored ones. `photoRefs: []` with every stored id seen still deletes them all.
 */
export function mergeSurveyFileRefs(stored: Record<string, unknown>, incoming: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...incoming };
  const seenP = seenSet(incoming.photoRefIdsSeen);
  const seenS = seenSet(incoming.sketchIdsSeen);
  for (const f of SURVEY_SEEN_FIELDS) delete out[f];
  if (Array.isArray(stored?.photoRefs)) {
    const byId = new Map<string, Record<string, unknown>>();
    for (const r of stored.photoRefs) if (isObj(r) && typeof r.id === "string") byId.set(r.id, r);
    const inRefs: unknown[] = Array.isArray(incoming.photoRefs) ? incoming.photoRefs : [];
    const mapped = inRefs.map((r: unknown) => {
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
    const inIds = new Set(mapped.map((r) => (isObj(r) && typeof r.id === "string" ? r.id : "")));
    const kept = [...byId.values()].filter((r) => !inIds.has(r.id as string) && !seenP?.has(r.id as string));
    let list = mapped;
    let over = mapped.length + kept.length - SURVEY_PHOTO_CAP;
    if (kept.length && over > 0) {
      // the incoming refs the server doesn't hold yet give way, newest (last) first; a stored ref is never dropped
      list = [...mapped];
      for (let i = list.length - 1; i >= 0 && over > 0; i--) {
        const r = list[i];
        if (!(isObj(r) && typeof r.id === "string" && byId.has(r.id))) {
          list.splice(i, 1);
          over--;
        }
      }
    }
    out.photoRefs = kept.length ? [...list, ...kept] : list;
  }
  if (isObj(stored?.sketches)) {
    const storedSk = stored.sketches as Record<string, unknown>;
    const inSk: Record<string, unknown> = isObj(incoming.sketches) ? incoming.sketches : {};
    const unseen = (s: unknown): boolean => isObj(s) && typeof s.id === "string" && !seenS?.has(s.id);
    const sk: Record<string, unknown> = {};
    for (const [key, r] of Object.entries(inSk)) {
      const s = storedSk[key];
      if (isObj(r) && isObj(s) && typeof r.id === "string" && r.id === s.id) {
        sk[key] = { ...r, image: keepFinished(s.image, r.image), strokes: keepFinished(s.strokes, r.strokes) };
      } else sk[key] = unseen(s) ? s : r; // a stored sketch the client never saw wins over its different one
    }
    for (const [key, s] of Object.entries(storedSk)) if (!(key in sk) && unseen(s)) sk[key] = s; // a pad it never saw stays
    out.sketches = sk;
  }
  return out;
}

/**
 * #344 C-final — the editor's side of the rule: a refreshed record's photo refs and sketches the editor has never seen
 * (another device added them) are unioned into its current state by id — refs appended in the record's order, a sketch
 * set on its pad. Ids in `seen` (including ones this editor deleted) are never brought back. Returns null when there is
 * nothing new; `added` lists the ids to mark as seen. Pure: no input is mutated.
 */
export function unionUnseenFileRefs(
  cur: { photoRefs: SurveyPhotoRef[]; sketches: Record<string, SketchRef> },
  fresh: { photoRefs?: unknown; sketches?: unknown },
  seen: { photos: ReadonlySet<string>; sketches: ReadonlySet<string> },
): { photoRefs: SurveyPhotoRef[]; sketches: Record<string, SketchRef>; added: { photos: string[]; sketches: string[] } } | null {
  const have = new Set(cur.photoRefs.map((r) => r.id));
  const newRefs: SurveyPhotoRef[] = [];
  for (const r of Array.isArray(fresh.photoRefs) ? fresh.photoRefs : []) {
    if (isObj(r) && typeof r.id === "string" && !seen.photos.has(r.id) && !have.has(r.id)) {
      have.add(r.id);
      newRefs.push(r as unknown as SurveyPhotoRef);
    }
  }
  const sketches = { ...cur.sketches };
  const addedSk: string[] = [];
  if (isObj(fresh.sketches)) {
    for (const [key, s] of Object.entries(fresh.sketches)) {
      if (!isObj(s) || typeof s.id !== "string" || seen.sketches.has(s.id) || sketches[key]?.id === s.id) continue;
      sketches[key] = s as unknown as SketchRef;
      addedSk.push(s.id);
    }
  }
  if (!newRefs.length && !addedSk.length) return null;
  return { photoRefs: [...cur.photoRefs, ...newRefs], sketches, added: { photos: newRefs.map((r) => r.id), sketches: addedSk } };
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
/** A plain string field as stored: a string as is, a number / boolean as text, anything else "". */
const asText = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : "");

/**
 * Before any client copy (an editor save, a sync push) is merged: every finished slot it carries is downgraded to
 * `{ pending: true }` unless it is that slot's own file — `filePathMatches(path, surveyId, <the slot's file id>)`, or an
 * inline file of the right kind when `blobEnabled` is false. Owning ids: a photo's `file` → its `p_` id; its markup's
 * `image` → `markup.id` (`m_`), `strokes` → `k_` + the markup's hex; a sketch's `image` → its `s_` id, `strokes` →
 * `k_` + its hex. A bad or wrong-letter owning id downgrades its slots. Only the finalize creates finished slots.
 * A non-list `photoRefs` / non-object `sketches` falls back to `opts.stored`'s value (dropped when none is stored).
 * Photo refs are also shaped (#344 C5): a ref without a valid `p_` id is dropped, the list keeps the oldest
 * SURVEY_PHOTO_CAP, `section` / `by` are strings, `takenAt` a finite number, and a caption goes through `cleanCaption`.
 * Pure: the input is not mutated; everything else is returned as sent.
 */
export function sanitizeIncomingFileSlots<T extends Record<string, unknown>>(
  doc: T,
  surveyId: string,
  opts: { blobEnabled: boolean; stored?: Record<string, unknown> | null },
): T {
  const blob = opts.blobEnabled;
  const out: Record<string, unknown> = { ...doc };
  const stored = isObj(opts.stored) ? opts.stored : null;
  if ("photoRefs" in doc && doc.photoRefs !== undefined && !Array.isArray(doc.photoRefs)) {
    // #344 C6 fix: anything but a list keeps the stored refs (never wipes them); with none stored it is dropped
    if (stored && Array.isArray(stored.photoRefs)) out.photoRefs = stored.photoRefs;
    else delete out.photoRefs;
  }
  if (Array.isArray(doc.photoRefs)) {
    // #344 C5: a ref without a valid p_ id is dropped; the list is capped at SURVEY_PHOTO_CAP, keeping the oldest (new
    // refs append at the end); section / by are strings, takenAt a finite number, a caption is cleanCaption'd
    out.photoRefs = doc.photoRefs.filter((r: unknown) => isObj(r) && !!idWith(r.id, "p")).slice(0, SURVEY_PHOTO_CAP).map((r: Record<string, unknown>) => {
      const next: Record<string, unknown> = {
        ...r,
        section: asText(r.section),
        by: asText(r.by),
        takenAt: Number.isFinite(Number(r.takenAt)) && r.takenAt !== null && r.takenAt !== "" ? Number(r.takenAt) : 0,
        file: sanitizeSlot(r.file, surveyId, idWith(r.id, "p"), blob),
      };
      const caption = cleanCaption(r.caption);
      if (caption) next.caption = caption;
      else delete next.caption;
      if (isObj(r.markup)) {
        const m = idWith(r.markup.id, "m");
        next.markup = { ...r.markup, image: sanitizeSlot(r.markup.image, surveyId, m, blob), strokes: sanitizeSlot(r.markup.strokes, surveyId, strokesOf(m), blob) };
      }
      return next;
    });
  }
  if (isObj(doc.sketches)) {
    // #344 C6: only a registered pad's key (isSketchKey) holding a ref with a valid s_ id is kept, at most
    // SURVEY_SKETCH_CAP of them; by is a string and updatedAt a finite number
    const sk: Record<string, unknown> = {};
    let n = 0;
    for (const [key, r] of Object.entries(doc.sketches)) {
      if (!isSketchKey(key) || !isObj(r)) continue;
      const id = idWith(r.id, "s");
      if (!id) continue;
      if (n >= SURVEY_SKETCH_CAP) break;
      n++;
      sk[key] = {
        ...r,
        by: asText(r.by),
        updatedAt: Number.isFinite(Number(r.updatedAt)) && r.updatedAt !== null && r.updatedAt !== "" ? Number(r.updatedAt) : 0,
        image: sanitizeSlot(r.image, surveyId, id, blob),
        strokes: sanitizeSlot(r.strokes, surveyId, strokesOf(id), blob),
      };
    }
    out.sketches = sk;
  } else if ("sketches" in doc && doc.sketches !== undefined) {
    // #344 C6: anything but a keyed object keeps the stored sketches (never wipes them); with none stored it is dropped
    if (stored && isObj(stored.sketches)) out.sketches = stored.sketches;
    else delete out.sketches;
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

/* ------------------------------------------------------------------ */
/* the survey editor's per-section photos (#344 C5)                     */
/* ------------------------------------------------------------------ */

/** The most photo refs one survey holds. */
export const SURVEY_PHOTO_CAP = 200;
export const SURVEY_PHOTO_CAP_MESSAGE = `This survey already has ${SURVEY_PHOTO_CAP} photos — the most it can hold. Delete one to add another.`;
/** A photo caption's length cap, in characters. */
export const CAPTION_MAX = 500;

/** How many more photos fit in a survey that already holds `count`. */
export function photoRoom(count: number): number {
  const n = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : SURVEY_PHOTO_CAP;
  return Math.max(0, SURVEY_PHOTO_CAP - n);
}

/** Every file a photo ref owns: its original (`p_`), and its current markup's image (`m_`) + strokes (`k_`). */
export function photoFileIds(ref: SurveyPhotoRef | null | undefined): string[] {
  if (!isObj(ref)) return [];
  const out: string[] = [];
  if (typeof ref.id === "string" && FILE_ID_RE.test(ref.id)) out.push(ref.id);
  const m = isObj(ref.markup) ? idWith(ref.markup.id, "m") : "";
  if (m) out.push(m, strokesOf(m));
  return out;
}

/** The files a device should stop uploading when a photo ref is replaced by `after` (a re-markup, a removed markup)
 *  or removed (`after` absent): every file `before` owned that `after` no longer owns. A superseded markup's `m_` +
 *  `k_`; all of a deleted photo's files. Their queued device copies would otherwise retry for 7 days. */
export function filesToDiscard(before: SurveyPhotoRef | null | undefined, after?: SurveyPhotoRef | null): string[] {
  const keep = new Set(photoFileIds(after));
  return photoFileIds(before).filter((id) => !keep.has(id));
}

/** Photo refs per editor section id (the rail's photo badge). */
export function photoCountsBySection(refs: readonly SurveyPhotoRef[] | null | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of Array.isArray(refs) ? refs : []) {
    if (isObj(r) && typeof r.section === "string" && r.section) out[r.section] = (out[r.section] || 0) + 1;
  }
  return out;
}

/** A caption as stored: ends trimmed, at most CAPTION_MAX characters; blank = no caption (undefined). */
export function cleanCaption(text: unknown): string | undefined {
  if (typeof text !== "string") return undefined;
  const t = text.trim().slice(0, CAPTION_MAX).trim();
  return t ? t : undefined;
}

/** The ref with this caption (a blank one removes the key). Pure. */
export function withCaption(ref: SurveyPhotoRef, text: unknown): SurveyPhotoRef {
  const caption = cleanCaption(text);
  const next: SurveyPhotoRef = { ...ref };
  if (caption) next.caption = caption;
  else delete next.caption;
  return next;
}

/** The ref with a NEW markup (`markupId`, a fresh `m_` id from `newFileId("m")`): both slots pending until the device
 *  queue uploads its image and strokes. The original `file` is untouched. Pure; throws on a non-`m_` id. */
export function withNewMarkup(ref: SurveyPhotoRef, markupId: string, at: number): SurveyPhotoRef {
  if (!idWith(markupId, "m")) throw new Error("A markup needs its own m_ id");
  return { ...ref, markup: { id: markupId, image: { pending: true }, strokes: { pending: true }, updatedAt: at } };
}

/** The ref with its markup removed (the original stays). Pure. */
export function withoutMarkup(ref: SurveyPhotoRef): SurveyPhotoRef {
  const next: SurveyPhotoRef = { ...ref };
  delete next.markup;
  return next;
}

/** What a thumbnail / the viewer shows, in order of preference: the markup's image (unless `original`), then the
 *  original. The caller takes the first one it has a source for (a finished slot, or this device's queued copy). */
export function photoShows(ref: SurveyPhotoRef, original = false): Array<{ fileId: string; slot: FileSlot }> {
  const out: Array<{ fileId: string; slot: FileSlot }> = [];
  if (!original && isObj(ref.markup) && idWith(ref.markup.id, "m") && isObj(ref.markup.image)) out.push({ fileId: ref.markup.id, slot: ref.markup.image });
  if (isObj(ref.file)) out.push({ fileId: ref.id, slot: ref.file });
  return out;
}

/* ------------------------------------------------------------------ */
/* the survey editor's sketch pads (#344 C6)                            */
/* ------------------------------------------------------------------ */

/** The most sketches one survey holds (every pad + every line set page fits well under it). */
export const SURVEY_SKETCH_CAP = 40;

/** Every file a sketch owns: its flattened image (`s_`) and its strokes (`k_`, same hex). */
export function sketchFileIds(ref: SketchRef | null | undefined): string[] {
  if (!isObj(ref)) return [];
  const id = idWith(ref.id, "s");
  return id ? [id, strokesOf(id)] : [];
}

/** The files a device should stop uploading when a sketch is re-drawn (`after`, a new s_ id) or removed: every file
 *  `before` owned that `after` doesn't. Their queued copies would otherwise retry for 7 days. */
export function sketchFilesToDiscard(before: SketchRef | null | undefined, after?: SketchRef | null): string[] {
  const keep = new Set(sketchFileIds(after));
  return sketchFileIds(before).filter((id) => !keep.has(id));
}

/** The sketches with `key` (re)drawn as a NEW sketch (`sketchId`, a fresh `s_` id from `newFileId("s")`): image and
 *  strokes pending until the device queue uploads them. Pure; throws on a non-`s_` id or an unknown pad key. */
export function withNewSketch(
  sketches: Record<string, SketchRef> | null | undefined,
  key: SketchKey,
  sketchId: string,
  by: string,
  at: number,
): Record<string, SketchRef> {
  if (!idWith(sketchId, "s")) throw new Error("A sketch needs its own s_ id");
  if (!isSketchKey(key)) throw new Error("That sketch pad isn't known");
  return { ...(isObj(sketches) ? sketches : {}), [key]: { id: sketchId, image: { pending: true }, strokes: { pending: true }, updatedAt: at, by } };
}

/** Discarding a failed upload of `fileId` (a sketch's `s_` image or `k_` strokes) when that sketch's image never
 *  finished: the sketch is removed (its tile goes back to Draw) and both its files are dropped from the device.
 *  Null when no sketch owns the file or its image is finished (only that one queued file goes). Pure. */
export function sketchAfterDiscard(
  sketches: Record<string, SketchRef> | null | undefined,
  fileId: string,
): { key: string; sketches: Record<string, SketchRef>; drop: string[] } | null {
  if (!isObj(sketches) || typeof fileId !== "string" || !/^[sk]_/.test(fileId)) return null;
  const sid = `s_${fileId.slice(2)}`;
  const key = Object.keys(sketches).find((k) => isObj(sketches[k]) && sketches[k].id === sid);
  if (!key || slotFinished(sketches[key].image)) return null;
  const rest = { ...sketches };
  const ref = rest[key];
  delete rest[key];
  return { key, sketches: rest, drop: sketchFileIds(ref) };
}

/** Undo a re-draw that never reached the device queue: `key` goes back to `prev` (removed when there was none) —
 *  only while it still holds `newId` (a newer drawing is left alone, same object back). Pure. */
export function withSketchRestored(
  sketches: Record<string, SketchRef>,
  key: string,
  newId: string,
  prev: SketchRef | null | undefined,
): Record<string, SketchRef> {
  if (!isObj(sketches) || sketches[key]?.id !== newId) return sketches;
  const next = { ...sketches };
  if (prev) next[key] = prev;
  else delete next[key];
  return next;
}
