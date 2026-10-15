"use client";

/* ============================================================
 * Per-section photos (#344 C5). Every editor section's header gets Add photo
 * (camera, or several from the library); each photo can carry a caption and a
 * markup drawn with the InkPad OVER THE ORIGINAL — the original file is never
 * touched (View original / Edit markup / Remove markup). A markup gets a NEW
 * `m_` id (+ its `k_` strokes) every time it is (re)done.
 *
 * The order is always: add the pending ref → save the survey (so the server
 * owns the file id) → THEN hand the bytes to the shared device queue, which
 * uploads them to private Blob (inline data URLs in local dev) and finalizes.
 * The queue's `onDone` folds each finished slot into the draft with the
 * store's own `foldFileSlot`. Files a re-markup / removal / delete leaves
 * behind are discarded from the device queue so they don't retry for 7 days.
 *
 * The editor (controls.tsx) owns the draft and the save path and hands them
 * in; this hook owns the device side (object URLs, the queue, the viewer and
 * the pad). Client-only: no store or server imports.
 * ============================================================ */

import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { InkPad } from "@/components/ink/ink-pad";
import { parseInk, serializeInk, type InkDoc } from "@/lib/ink/model";
import { resizePhoto } from "@/lib/assessments/photo-resize";
import {
  configurePhotoQueue, discardPhoto, enqueuePhoto, failedPhotos, queuedPhotoBlob, retryPhoto, subscribePhotoQueue, type FailedPhotoInfo,
} from "@/lib/assessments/photo-queue";
import { FailedPhotos, PHOTO_CSS, type FailedPhotoRow } from "@/app/(app)/assessments/[id]/photo-button";
import {
  CAPTION_MAX, SURVEY_PHOTO_CAP_MESSAGE, cleanCaption, filesToDiscard, foldFileSlot, newFileId, photoRoom, photoShows, siblingId, slotFinished,
  withCaption, withNewMarkup, withoutMarkup, type FileSlot, type FinishedSlot, type SurveyPhotoRef,
} from "@/lib/field-files/files";
import { ACCENT_BORDER_LT, ACCENT_INK, ACCENT_SOFT } from "./styles";

export type SectionPhotosOptions = {
  recordId: string;
  /** who takes the photo (`by`) */
  me: string;
  blobEnabled: boolean;
  /** draft.photoRefs */
  refs: SurveyPhotoRef[];
  /** mirror a new list into the draft — a photo change is saved on its own, so it never dirties the draft */
  onRefs: (next: SurveyPhotoRef[]) => void;
  /** the editor's photo save: the last-saved survey + the current refs (never the user's unsaved edits) */
  save: () => Promise<void>;
  /** the survey's stored rev after a finalize (adopted for the next outbox save) */
  onRev: (rev: number) => void;
  sectionTitle: (sectionId: string) => string;
  /** #344 C6 — a finished file no photo owns (a sketch's) is handed on: one queue configuration per editor */
  foldOther?: (fileId: string, slot: FinishedSlot) => boolean;
};

export type SectionPhotos = {
  /** the header row's Add photo / Library buttons */
  addButton: (sectionId: string) => ReactNode;
  /** the section's thumbnails (nothing when it has none) */
  strip: (sectionId: string) => ReactNode;
  /** styles, messages, failed uploads, the viewer sheet and the markup pad — render once */
  overlay: ReactNode;
};

type Viewer = { id: string; original: boolean; confirmDelete: boolean; caption: string };
/** A message shown beside the section it is about (null section = the photo list as a whole). */
type Msg = { text: string; section: string | null };
type Ink = { photoId: string; originalUrl: string; w: number; h: number; initial?: InkDoc };

const nowMs = () => Date.now();
const fileUrl = (recordId: string, fileId: string) => `/api/surveys/${encodeURIComponent(recordId)}/files/${encodeURIComponent(fileId)}`;
const errText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

/** A loaded image's natural size (the InkPad draws in the photo's own pixels). */
async function imageSize(url: string): Promise<{ w: number; h: number }> {
  const img = new Image();
  img.decoding = "async";
  img.src = url;
  await img.decode();
  return { w: img.naturalWidth || 1, h: img.naturalHeight || 1 };
}

const SP_CSS = `
  .sp-add { display: inline-flex; align-items: center; gap: 6px; }
  .sp-add label.sp-btn { position: relative; }
  .sp-add label.sp-btn:focus-within { outline: 2px solid var(--accent); outline-offset: 2px; }
  .sp-file { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap; border: 0; opacity: 0; }
  .sp-btn { display: inline-flex; align-items: center; gap: 5px; font: inherit; font-size: 12px; font-weight: 600; color: ${ACCENT_INK}; background: ${ACCENT_SOFT}; border: 1px solid ${ACCENT_BORDER_LT}; border-radius: 8px; padding: 5px 10px; cursor: pointer; min-height: 32px; white-space: nowrap; }
  .sp-btn.quiet { color: #5b616e; background: #fff; border-color: #e4e7ec; }
  .sp-btn[aria-disabled="true"] { opacity: .55; cursor: default; }
  .sp-strip { display: flex; flex-wrap: wrap; gap: 7px; padding: 0 18px 12px; }
  .sp-thumb { position: relative; width: 72px; height: 72px; border-radius: 8px; overflow: hidden; border: 1px solid #e4e7ec; background: #f1f2f5; padding: 0; cursor: pointer; }
  .sp-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .sp-thumb-empty { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; font-size: 10.5px; color: #8c919c; }
  .sp-tag { position: absolute; left: 3px; bottom: 3px; font-size: 9.5px; font-weight: 600; background: rgba(22,24,27,.72); color: #fff; border-radius: 4px; padding: 1px 4px; }
  .sp-tag.mk { left: auto; right: 3px; background: rgba(192,57,43,.85); }
  .sp-strip-msg { padding: 0 18px 12px; }
  .sp-msg { border: 1px solid #f0d6cd; background: #fbeeea; color: #8c3b26; border-radius: 9px; padding: 9px 12px; font-size: 12.5px; display: flex; gap: 10px; align-items: flex-start; }
  .sp-sheet-bg { position: fixed; inset: 0; z-index: 80; background: rgba(16,18,22,.55); display: flex; align-items: center; justify-content: center; padding: 16px; }
  .sp-sheet { background: #fff; border-radius: 14px; width: min(760px, 100%); max-height: calc(100vh - 32px); overflow: auto; box-shadow: 0 20px 60px rgba(0,0,0,.35); }
  .sp-sheet-img { background: #16181d; display: flex; align-items: center; justify-content: center; min-height: 200px; }
  .sp-sheet-img img { max-width: 100%; max-height: 58vh; display: block; }
  .sp-sheet-body { padding: 14px 16px 16px; display: grid; gap: 12px; }
  .sp-row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  .sp-cap { width: 100%; box-sizing: border-box; font: inherit; font-size: 16px; border: 1px solid #e4e7ec; border-radius: 9px; padding: 9px 11px; min-height: 64px; resize: vertical; }
  .sp-danger { color: #b4543a; background: #f9ece8; border-color: #f0d6cd; }
`;

export function useSectionPhotos(o: SectionPhotosOptions): SectionPhotos {
  const { recordId, blobEnabled } = o;
  // The latest refs and callbacks, for handlers that run after an await (the draft may have moved on meanwhile).
  const refsRef = useRef<SurveyPhotoRef[]>(o.refs);
  const optsRef = useRef(o);
  useEffect(() => {
    refsRef.current = o.refs;
  }, [o.refs]);
  useEffect(() => {
    optsRef.current = o;
  });

  const [msg, setMsgState] = useState<Msg | null>(null);
  const setMsg = (text: string | null, section: string | null = null) => setMsgState(text ? { text, section } : null);
  const [confirmDiscard, setConfirmDiscard] = useState<string | null>(null);
  const [busySec, setBusySec] = useState<string | null>(null);
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [ink, setInk] = useState<Ink | null>(null);
  const inkFileRef = useRef<string | null>(null); // the original the open pad draws over — its object URL is kept
  const [opening, setOpening] = useState(false);
  const [failed, setFailed] = useState<FailedPhotoInfo[]>([]);
  const [failBusy, setFailBusy] = useState<string | null>(null);

  /* ---------- the draft + save ---------- */
  function commit(next: SurveyPhotoRef[]) {
    refsRef.current = next;
    optsRef.current.onRefs(next);
  }
  // Saves run one at a time, each carrying the newest refs.
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  function persist(section: string | null): Promise<boolean> {
    const run = chain.current.then(async () => {
      try {
        await optsRef.current.save();
        return true;
      } catch {
        setMsg("Couldn't save the photo to the survey — it is kept on this device. Press Save changes to try again.", section);
        return false;
      }
    });
    chain.current = run;
    return run;
  }

  /* ---------- device copies (object URLs) of files still uploading ---------- */
  const urlsRef = useRef<Record<string, string>>({});
  const [localUrls, setLocalUrls] = useState<Record<string, string>>({});
  function addLocalUrl(fileId: string, blob: Blob) {
    if (urlsRef.current[fileId]) return;
    urlsRef.current = { ...urlsRef.current, [fileId]: URL.createObjectURL(blob) };
    setLocalUrls(urlsRef.current);
  }
  // On every refs change: revoke the URLs of files no longer pending (finished, removed); load device copies for
  // pending images this tab has no URL for yet (taken before a reload).
  useEffect(() => {
    let alive = true;
    void (async () => {
      const pending = new Set<string>();
      for (const r of refsRef.current) {
        if (!slotFinished(r.file)) pending.add(r.id);
        if (r.markup && !slotFinished(r.markup.image)) pending.add(r.markup.id);
      }
      const kept: Record<string, string> = {};
      let changed = false;
      for (const [id, url] of Object.entries(urlsRef.current)) {
        if (pending.has(id) || inkFileRef.current === id) kept[id] = url;
        else {
          URL.revokeObjectURL(url);
          changed = true;
        }
      }
      if (changed) {
        urlsRef.current = kept;
        setLocalUrls(kept);
      }
      for (const id of pending) {
        if (urlsRef.current[id]) continue;
        const blob = await queuedPhotoBlob(recordId, id);
        if (!alive) return;
        if (!blob || urlsRef.current[id]) continue;
        // assigned at once, so a URL is never created without being tracked (and revoked later)
        urlsRef.current = { ...urlsRef.current, [id]: URL.createObjectURL(blob) };
        setLocalUrls(urlsRef.current);
      }
    })();
    return () => {
      alive = false;
    };
  }, [o.refs, recordId]);
  useEffect(
    () => () => {
      for (const u of Object.values(urlsRef.current)) URL.revokeObjectURL(u);
      urlsRef.current = {};
    },
    [],
  );

  /* ---------- the device queue ---------- */
  useEffect(
    () =>
      configurePhotoQueue({
        blobEnabled,
        onDone: async (rid, fileId, ref, rev) => {
          if (rid !== recordId) return; // another record's file: the server has it already
          const slot: FinishedSlot | null = ref.blobPath ? { blobPath: ref.blobPath } : ref.inline ? { inline: ref.inline } : null;
          if (slot) {
            const folded = foldFileSlot({ photoRefs: refsRef.current }, fileId, slot);
            if (folded.status === "set" && folded.doc.photoRefs) commit(folded.doc.photoRefs);
            else if (folded.status === "missing") optsRef.current.foldOther?.(fileId, slot);
          }
          if (typeof rev === "number") optsRef.current.onRev(rev);
        },
      }),
    [recordId, blobEnabled],
  );
  useEffect(() => {
    let alive = true;
    const load = () => {
      void failedPhotos()
        .then((list) => {
          if (alive) setFailed(list.filter((f) => f.assessmentId === recordId));
        })
        .catch(() => undefined);
    };
    const off = subscribePhotoQueue(load);
    return () => {
      alive = false;
      off();
    };
  }, [recordId]);

  /** Stop uploading files nothing owns any more (best effort; a survey discard only drops the device copy). */
  async function dropQueued(fileIds: string[]) {
    for (const id of fileIds) {
      try {
        await discardPhoto(recordId, id);
      } catch {
        /* nothing queued for it */
      }
    }
  }

  /* ---------- capture ---------- */
  async function addPhotos(sectionId: string, files: File[]) {
    setMsg(null);
    if (!files.length) return;
    if (photoRoom(refsRef.current.length) <= 0) {
      setMsg(SURVEY_PHOTO_CAP_MESSAGE, sectionId);
      return;
    }
    setBusySec(sectionId);
    const problems: string[] = [];
    try {
      const shots: Array<{ blob: Blob; takenAt: number }> = [];
      for (const f of files) {
        if (shots.length >= photoRoom(refsRef.current.length)) {
          problems.push(SURVEY_PHOTO_CAP_MESSAGE);
          break;
        }
        try {
          shots.push(await resizePhoto(f));
        } catch (e) {
          problems.push(errText(e, "That photo couldn't be used."));
        }
      }
      const taking = shots.slice(0, photoRoom(refsRef.current.length));
      if (taking.length < shots.length && !problems.includes(SURVEY_PHOTO_CAP_MESSAGE)) problems.push(SURVEY_PHOTO_CAP_MESSAGE);
      if (!taking.length) return;
      const me = optsRef.current.me;
      const added = taking.map((s) => ({
        ref: { id: newFileId("p"), section: sectionId, takenAt: s.takenAt, by: me, file: { pending: true as const } } satisfies SurveyPhotoRef,
        blob: s.blob,
      }));
      for (const a of added) addLocalUrl(a.ref.id, a.blob);
      commit([...refsRef.current, ...added.map((a) => a.ref)]);
      await persist(sectionId); // the server must own the ids before a finalize can land (a failed save still queues: retryable)
      for (const a of added) {
        try {
          await enqueuePhoto(recordId, a.ref.id, a.blob);
        } catch (e) {
          problems.push(`A photo couldn't be kept on this device: ${errText(e, "storage refused it")}`);
        }
      }
    } finally {
      setBusySec(null);
      if (problems.length) setMsg([...new Set(problems)].join(" "), sectionId);
    }
  }

  /* ---------- viewer actions ---------- */
  const findRef = (id: string) => refsRef.current.find((r) => r.id === id);
  function replaceRef(next: SurveyPhotoRef) {
    commit(refsRef.current.map((r) => (r.id === next.id ? next : r)));
  }

  function saveCaption(photoId: string, text: string) {
    const cur = findRef(photoId);
    if (!cur || cleanCaption(text) === cur.caption) return;
    replaceRef(withCaption(cur, text));
    void persist(cur.section);
  }

  async function removeMarkup(photoId: string) {
    const cur = findRef(photoId);
    if (!cur?.markup) return;
    const next = withoutMarkup(cur);
    const stale = filesToDiscard(cur, next);
    replaceRef(next);
    await dropQueued(stale);
    // Uploaded files of a removed markup stay in Blob as orphans (harmless; nothing refers to them).
    console.info("[venue-assessments] markup removed; any uploaded files stay as orphans", recordId, stale.join(", "));
    await persist(cur.section);
  }

  async function deletePhoto(photoId: string) {
    const cur = findRef(photoId);
    if (!cur) return;
    commit(refsRef.current.filter((r) => r.id !== photoId));
    setViewer((v) => (v?.id === photoId ? null : v));
    await dropQueued(filesToDiscard(cur));
    await persist(cur.section);
  }

  /** The saved strokes of a markup: this device's queued copy while pending, else the stored file. */
  async function loadStrokes(markup: NonNullable<SurveyPhotoRef["markup"]>): Promise<InkDoc | undefined> {
    try {
      const k = siblingId(markup.id, "k");
      const slot: FileSlot = markup.strokes ?? {};
      let text: string | null = null;
      if (slot.inline) text = await (await fetch(slot.inline)).text();
      else if (slot.blobPath) {
        const res = await fetch(fileUrl(recordId, k), { cache: "no-store" });
        text = res.ok ? await res.text() : null;
      } else {
        const blob = await queuedPhotoBlob(recordId, k);
        text = blob ? await blob.text() : null;
      }
      return (text && parseInk(text)) || undefined;
    } catch {
      return undefined; // an empty pad over the original
    }
  }

  async function openMarkup(photoId: string) {
    const cur = findRef(photoId);
    if (!cur || opening) return;
    const originalUrl = srcOf(cur.id, cur.file);
    if (!originalUrl) {
      setMsg("The original photo isn't on this device — mark it up once it has uploaded.", cur.section);
      return;
    }
    setOpening(true);
    try {
      const { w, h } = await imageSize(originalUrl);
      const initial = cur.markup ? await loadStrokes(cur.markup) : undefined;
      inkFileRef.current = cur.id;
      setInk({ photoId, originalUrl, w, h, initial });
    } catch {
      setMsg("That photo couldn't be opened for markup.", cur.section);
    } finally {
      setOpening(false);
    }
  }

  function closeInk() {
    inkFileRef.current = null;
    setInk(null);
  }

  /** Done in the pad: a NEW m_ id + its k_, the ref saved with both slots pending, THEN both files queued; the
   *  superseded markup's queued files are dropped. Returned to the pad, so Done stays "Saving…" until it settles. */
  async function saveMarkup(photoId: string, result: { doc: InkDoc; jpeg: Blob }) {
    const cur = findRef(photoId);
    if (!cur) {
      closeInk();
      return;
    }
    const m = newFileId("m");
    const k = siblingId(m, "k");
    const next = withNewMarkup(cur, m, nowMs());
    const stale = filesToDiscard(cur, next);
    addLocalUrl(m, result.jpeg);
    replaceRef(next);
    await persist(cur.section);
    try {
      await enqueuePhoto(recordId, m, result.jpeg);
      await enqueuePhoto(recordId, k, new Blob([serializeInk(result.doc)], { type: "application/json" }));
    } catch (e) {
      setMsg(`The markup couldn't be kept on this device: ${errText(e, "storage refused it")}`, cur.section);
    }
    await dropQueued(stale);
    setViewer((v) => (v && v.id === photoId ? { ...v, original: false } : v));
    closeInk();
  }

  /* ---------- failed uploads ---------- */
  function describe(fileId: string): string {
    const title = (r: SurveyPhotoRef) => o.sectionTitle(r.section);
    const hex = fileId.slice(2);
    if (fileId.startsWith("p_")) {
      const r = o.refs.find((x) => x.id === fileId);
      return r ? `Photo in ${title(r)}` : "A removed photo";
    }
    if (fileId.startsWith("m_") || fileId.startsWith("k_")) {
      const r = o.refs.find((x) => x.markup?.id === `m_${hex}`);
      if (r) return `Markup on a photo in ${title(r)}`;
      return fileId.startsWith("m_") ? "An earlier markup" : "Drawing strokes";
    }
    return fileId.startsWith("s_") ? "Sketch" : "File";
  }
  async function onRetry(fileId: string) {
    setFailBusy(fileId);
    try {
      await retryPhoto(recordId, fileId);
    } finally {
      setFailBusy(null);
    }
  }
  /** Discard on a failed ORIGINAL deletes the photo, so it asks first; anything else discards at once. */
  function askDiscard(fileId: string) {
    if (refsRef.current.some((r) => r.id === fileId)) setConfirmDiscard(fileId);
    else void onDiscard(fileId);
  }
  async function onDiscard(fileId: string) {
    setConfirmDiscard(null);
    setFailBusy(fileId);
    try {
      const hex = fileId.slice(2);
      const owner = refsRef.current.find((r) => r.id === fileId);
      const marked = refsRef.current.find((r) => r.markup?.id === `m_${hex}`);
      if (owner) await deletePhoto(owner.id);
      else if (marked && (fileId.startsWith("m_") || fileId.startsWith("k_"))) await removeMarkup(marked.id);
      else await dropQueued([fileId]);
    } finally {
      setFailBusy(null);
    }
  }

  /* ---------- rendering ---------- */
  function srcOf(fileId: string, slot: FileSlot | undefined): string | null {
    if (!slot) return null;
    if (slot.inline) return slot.inline;
    if (slot.blobPath) return fileUrl(recordId, fileId);
    return localUrls[fileId] ?? null;
  }
  function shown(ref: SurveyPhotoRef, original = false): { src: string; pending: boolean } | null {
    for (const c of photoShows(ref, original)) {
      const src = srcOf(c.fileId, c.slot);
      if (src) return { src, pending: !slotFinished(c.slot) };
    }
    return null;
  }

  /** Close the viewer, keeping a caption typed but not yet blurred. */
  function closeViewer() {
    if (viewer) saveCaption(viewer.id, viewer.caption);
    setViewer(null);
  }
  // Esc closes the viewer (the pad handles its own keys).
  const viewerOpen = !!viewer && !ink;
  const closeRef = useRef(closeViewer);
  useEffect(() => {
    closeRef.current = closeViewer;
  });
  useEffect(() => {
    if (!viewerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewerOpen]);

  function addButton(sectionId: string): ReactNode {
    const busy = busySec === sectionId;
    const pick = (e: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []);
      e.target.value = ""; // the same file can be picked again
      void addPhotos(sectionId, files);
    };
    return (
      <span className="sp-add" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
        {/* visually hidden (not display:none) so Tab reaches the input; the label shows its focus ring */}
        <label className="sp-btn" aria-disabled={busy || !!busySec} title="Take a photo">
          {busy ? "Adding…" : "Add photo"}
          <input type="file" accept="image/*" capture="environment" className="sp-file" disabled={!!busySec} onChange={pick} />
        </label>
        <label className="sp-btn quiet" aria-disabled={!!busySec} title="Choose photos from the library">
          Library
          <input type="file" accept="image/*" multiple className="sp-file" disabled={!!busySec} onChange={pick} />
        </label>
      </span>
    );
  }

  function msgBox(m: Msg): ReactNode {
    return (
      <div className="sp-msg" role="status">
        <span style={{ flex: 1 }}>{m.text}</span>
        <button type="button" className="sp-btn quiet" onClick={() => setMsg(null)}>Dismiss</button>
      </div>
    );
  }

  function strip(sectionId: string): ReactNode {
    const mine = o.refs.filter((r) => r.section === sectionId);
    const here = msg && msg.section === sectionId ? <div className="sp-strip-msg">{msgBox(msg)}</div> : null;
    if (!mine.length) return here;
    return (
      <>
      {here}
      <div className="sp-strip">
        {mine.map((r) => {
          const s = shown(r);
          return (
            <button
              key={r.id}
              type="button"
              className="sp-thumb"
              title={r.caption || "Open photo"}
              onClick={() => setViewer({ id: r.id, original: false, confirmDelete: false, caption: r.caption ?? "" })}
            >
              {s ? (
                // eslint-disable-next-line @next/next/no-img-element -- a private, session-gated route, a data URL or a local object URL
                <img src={s.src} alt={r.caption || "Site photo"} loading="lazy" />
              ) : (
                <span className="sp-thumb-empty">Uploading</span>
              )}
              {s?.pending && <span className="sp-tag">Uploading</span>}
              {r.markup && <span className="sp-tag mk">Marked up</span>}
            </button>
          );
        })}
      </div>
      </>
    );
  }

  const vRef = viewer ? o.refs.find((r) => r.id === viewer.id) : undefined;
  const vShown = vRef && viewer ? shown(vRef, viewer.original) : null;
  const failedRows: FailedPhotoRow[] = failed.map((f) => ({ photoId: f.photoId, lastError: f.lastError, label: describe(f.photoId) }));
  const originalUrl = ink?.originalUrl ?? "";

  const overlay = (
    <>
      <style>{PHOTO_CSS + SP_CSS}</style>
      {msg && msg.section === null && msgBox(msg)}
      <FailedPhotos rows={failedRows} busy={failBusy} note={null} onRetry={(id) => void onRetry(id)} onDiscard={askDiscard} />
      {confirmDiscard && failed.some((f) => f.photoId === confirmDiscard) && (
        <div className="sp-msg" role="alertdialog" aria-label="Discard photo">
          <span style={{ flex: 1 }}>This deletes the photo ({describe(confirmDiscard)}) from the survey. It never finished uploading.</span>
          <button type="button" className="sp-btn sp-danger" disabled={failBusy === confirmDiscard} onClick={() => void onDiscard(confirmDiscard)}>Delete photo</button>
          <button type="button" className="sp-btn quiet" onClick={() => setConfirmDiscard(null)}>Cancel</button>
        </div>
      )}
      {viewer && vRef && !ink && (
        <div className="sp-sheet-bg" onClick={closeViewer}>
          <div className="sp-sheet" role="dialog" aria-modal="true" aria-label="Photo" onClick={(e) => e.stopPropagation()}>
            <div className="sp-sheet-img">
              {vShown ? (
                // eslint-disable-next-line @next/next/no-img-element -- a private, session-gated route, a data URL or a local object URL
                <img src={vShown.src} alt={vRef.caption || "Site photo"} />
              ) : (
                <span style={{ color: "#aab0bb", fontSize: 13 }}>Still uploading from another device</span>
              )}
            </div>
            <div className="sp-sheet-body">
              <div className="sp-row" style={{ justifyContent: "space-between" }}>
                <span style={{ fontSize: 12, color: "#8c919c" }}>
                  {o.sectionTitle(vRef.section)}
                  {vShown?.pending ? " · uploading" : ""}
                  {vRef.markup ? (viewer.original ? " · original" : " · marked up") : ""}
                </span>
                <button type="button" className="sp-btn quiet" onClick={closeViewer}>Close</button>
              </div>
              {msg && msg.section === vRef.section && msgBox(msg)}
              <label style={{ display: "grid", gap: 5, fontSize: 12, fontWeight: 600, color: "#5b616e" }}>
                Caption
                <textarea
                  className="sp-cap"
                  maxLength={CAPTION_MAX}
                  value={viewer.caption}
                  placeholder="What this shows"
                  onChange={(e) => setViewer({ ...viewer, caption: e.target.value })}
                  onBlur={(e) => saveCaption(vRef.id, e.target.value)}
                />
              </label>
              <div className="sp-row">
                {vRef.markup && (
                  <button type="button" className="sp-btn quiet" aria-pressed={viewer.original} onClick={() => setViewer({ ...viewer, original: !viewer.original })}>
                    {viewer.original ? "View markup" : "View original"}
                  </button>
                )}
                <button type="button" className="sp-btn" aria-disabled={opening} disabled={opening} onClick={() => void openMarkup(vRef.id)}>
                  {opening ? "Opening…" : vRef.markup ? "Edit markup" : "Mark up"}
                </button>
                {vRef.markup && (
                  <button type="button" className="sp-btn quiet" onClick={() => void removeMarkup(vRef.id)}>Remove markup</button>
                )}
                <span style={{ flex: 1 }} />
                {viewer.confirmDelete ? (
                  <>
                    <span style={{ fontSize: 12.5, color: "#b4543a" }}>Delete this photo?</span>
                    <button type="button" className="sp-btn sp-danger" onClick={() => void deletePhoto(vRef.id)}>Yes, delete</button>
                    <button type="button" className="sp-btn quiet" onClick={() => setViewer({ ...viewer, confirmDelete: false })}>Cancel</button>
                  </>
                ) : (
                  <button type="button" className="sp-btn sp-danger" onClick={() => setViewer({ ...viewer, confirmDelete: true })}>Delete photo</button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      {ink && (
        <InkPad
          open
          title="Mark up photo"
          background={{ kind: "image", url: originalUrl, w: ink.w, h: ink.h }}
          initial={ink.initial}
          onCancel={closeInk}
          onDone={(result) => saveMarkup(ink.photoId, result)}
        />
      )}
    </>
  );

  return { addButton, strip, overlay };
}
