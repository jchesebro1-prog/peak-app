"use client";

/* ============================================================
 * Sketch pads in sections (#344 C6). Beams, CW elevation, Brick drawing,
 * Stage plan, Stage section, House section, House plan and the hand-filled
 * Line set schedule sheet each get a tile in their section (which pads show is
 * `visibleSketchPads` — the section's scope and the counterweight / line-set
 * gates). A tile is the flattened sketch (this device's queued copy while it
 * uploads, else the survey's bytes route, or an inline data URL in local dev),
 * or a "Draw" tile. Tapping opens the InkPad over the pad's generated
 * background, starting from the saved strokes.
 *
 * Done always makes a NEW sketch: a fresh `s_` id + its `k_` strokes. The
 * order is the photos' order — the pending ref is saved first (so the server
 * owns the ids), THEN both files go to the shared device queue. The superseded
 * sketch's still-queued files are discarded; its uploaded files stay in Blob as
 * orphans (nothing refers to them). The queue's `onDone` is the photos hook's
 * (one configuration per editor); it hands files no photo owns to `fold` here.
 *
 * Client-only: no store or server imports.
 * ============================================================ */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { InkPad, type InkBackground } from "@/components/ink/ink-pad";
import { fitInkTo, parseInk, serializeInk, type InkDoc } from "@/lib/ink/model";
import { SKETCH_PADS, backgroundFor, linesetSheetPage, type SketchKey } from "@/lib/ink/backgrounds";
import { visibleSketchPads, type FlowSlice, type SketchPadView } from "@/lib/survey-flow";
import { discardPhoto, enqueuePhoto, queuedPhotoBlob } from "@/lib/assessments/photo-queue";
import {
  foldFileSlot, newFileId, siblingId, sketchFilesToDiscard, slotFinished, withNewSketch, type FinishedSlot, type SketchRef,
} from "@/lib/field-files/files";
import type { HandSheet } from "./linesets";
import { ACCENT_BORDER_LT, ACCENT_INK, ACCENT_SOFT } from "./styles";

/** The on-file checks a pad sits beside (Beams & rigging): the check's measurement key → the pad. */
const SKETCH_BESIDE: Record<string, SketchKey> = { cwElevationOnFile: "cwElevation", brickDrawingOnFile: "brick" };

export type SectionSketchesOptions = {
  recordId: string;
  /** who drew it (`by`) */
  me: string;
  /** draft.sketches */
  sketches: Record<string, SketchRef>;
  /** the draft: the gates read its scope / rigging / line set quantity, the backgrounds its measurements */
  survey: FlowSlice & { linesetQty?: number; measurements: Record<string, string | boolean>; sketches?: unknown };
  /** mirror new sketches into the draft — a sketch change is saved on its own, so it never dirties the draft */
  onSketches: (next: Record<string, SketchRef>) => void;
  /** the editor's file save: the last-saved survey + the current photos + the current sketches (never unsaved edits) */
  save: () => Promise<void>;
};

export type SectionSketches = {
  /** a section's sketch tiles + its sketch message (pads shown beside a field in `fieldKeys` and line set sheets —
   *  the Line set schedule's Fill in by hand — are left out) */
  tiles: (sectionId: string, fieldKeys?: string[]) => ReactNode;
  /** the pad beside an on-file check (CW elevation, Brick drawing), or null */
  aside: (fieldKey: string) => ReactNode;
  /** the Line set schedule's Fill in by hand props, or undefined when the sheet doesn't show */
  linesetSheet: () => HandSheet | undefined;
  /** fold a finished file into a sketch (the queue's onDone, for files no photo owns); true when one owned it */
  fold: (fileId: string, slot: FinishedSlot) => boolean;
  /** styles + the pad — render once */
  overlay: ReactNode;
};

type Ink = { key: SketchKey; title: string; background: InkBackground; initial?: InkDoc };
type Msg = { text: string; section: string };

const nowMs = () => Date.now();
const fileUrl = (recordId: string, fileId: string) => `/api/surveys/${encodeURIComponent(recordId)}/files/${encodeURIComponent(fileId)}`;
const errText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);
const sectionOf = (key: string) => (linesetSheetPage(key) != null ? "linesets" : SKETCH_PADS.find((p) => p.key === key)?.section ?? "");

/** A JSON data URL's text (inline strokes in local dev). */
function dataUrlText(url: string): string {
  const comma = url.indexOf(",");
  const bin = atob(url.slice(comma + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

const SK_CSS = `
  .sk-row { display: flex; flex-wrap: wrap; gap: 10px; margin: 2px 0 16px; }
  .sk-tile { position: relative; display: flex; flex-direction: column; width: 150px; padding: 0; border: 1px solid #e4e7ec; border-radius: 10px; background: #fff; overflow: hidden; cursor: pointer; font: inherit; text-align: left; }
  .sk-tile:disabled { cursor: default; opacity: .7; }
  .sk-tile:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .sk-img { height: 96px; background: #f6f7f9; display: flex; align-items: center; justify-content: center; border-bottom: 1px solid #eef0f3; }
  .sk-img img { width: 100%; height: 100%; object-fit: contain; background: #fff; display: block; }
  .sk-empty { font-size: 11px; color: #8c919c; }
  .sk-draw { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; font-weight: 600; color: ${ACCENT_INK}; background: ${ACCENT_SOFT}; border: 1px solid ${ACCENT_BORDER_LT}; border-radius: 8px; padding: 6px 12px; }
  .sk-title { font-size: 11.5px; font-weight: 600; color: #5b616e; padding: 7px 9px 8px; line-height: 1.3; }
  .sk-tag { position: absolute; left: 5px; top: 5px; font-size: 9.5px; font-weight: 600; background: rgba(22,24,27,.72); color: #fff; border-radius: 4px; padding: 1px 4px; }
  .sk-tile.compact { width: 112px; }
  .sk-tile.compact .sk-img { height: 64px; }
  .sk-aside { flex-shrink: 0; display: flex; }
  .sk-msg { border: 1px solid #f0d6cd; background: #fbeeea; color: #8c3b26; border-radius: 9px; padding: 9px 12px; font-size: 12.5px; display: flex; gap: 10px; align-items: flex-start; margin: 2px 0 12px; }
  .sk-msg button { font: inherit; font-size: 12px; font-weight: 600; color: #5b616e; background: #fff; border: 1px solid #e4e7ec; border-radius: 8px; padding: 4px 10px; cursor: pointer; }
`;

export function useSectionSketches(o: SectionSketchesOptions): SectionSketches {
  const { recordId } = o;
  // The latest sketches and callbacks, for handlers that run after an await.
  const sketchesRef = useRef<Record<string, SketchRef>>(o.sketches);
  const optsRef = useRef(o);
  useEffect(() => {
    sketchesRef.current = o.sketches;
  }, [o.sketches]);
  useEffect(() => {
    optsRef.current = o;
  });

  const [msg, setMsgState] = useState<Msg | null>(null);
  const setMsg = (text: string | null, section = "") => setMsgState(text ? { text, section } : null);
  const [ink, setInk] = useState<Ink | null>(null);
  const [opening, setOpening] = useState<string | null>(null);

  /* ---------- the draft + save ---------- */
  function commit(next: Record<string, SketchRef>) {
    sketchesRef.current = next;
    optsRef.current.onSketches(next);
  }
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  function persist(section: string): Promise<boolean> {
    const run = chain.current.then(async () => {
      try {
        await optsRef.current.save();
        return true;
      } catch {
        setMsg("Couldn't save the sketch to the survey — it is kept on this device. Press Save changes to try again.", section);
        return false;
      }
    });
    chain.current = run;
    return run;
  }

  /* ---------- device copies (object URLs) of sketches still uploading ---------- */
  const urlsRef = useRef<Record<string, string>>({});
  const [localUrls, setLocalUrls] = useState<Record<string, string>>({});
  function addLocalUrl(fileId: string, blob: Blob) {
    if (urlsRef.current[fileId]) return;
    urlsRef.current = { ...urlsRef.current, [fileId]: URL.createObjectURL(blob) };
    setLocalUrls(urlsRef.current);
  }
  // On every sketches change: revoke URLs of images no longer pending (finished, re-drawn); load device copies for
  // pending images this tab has no URL for yet (drawn before a reload).
  useEffect(() => {
    let alive = true;
    void (async () => {
      const pending = new Set<string>();
      for (const r of Object.values(sketchesRef.current)) {
        if (r && typeof r.id === "string" && !slotFinished(r.image)) pending.add(r.id);
      }
      const kept: Record<string, string> = {};
      let changed = false;
      for (const [id, url] of Object.entries(urlsRef.current)) {
        if (pending.has(id)) kept[id] = url;
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
        urlsRef.current = { ...urlsRef.current, [id]: URL.createObjectURL(blob) };
        setLocalUrls(urlsRef.current);
      }
    })();
    return () => {
      alive = false;
    };
  }, [o.sketches, recordId]);
  useEffect(
    () => () => {
      for (const u of Object.values(urlsRef.current)) URL.revokeObjectURL(u);
      urlsRef.current = {};
    },
    [],
  );

  /** The queue finished a file no photo owns: land it on its sketch (the store's own fold rule). */
  function fold(fileId: string, slot: FinishedSlot): boolean {
    const f = foldFileSlot({ sketches: sketchesRef.current }, fileId, slot);
    if (f.status !== "set" || !f.doc.sketches) return false;
    commit(f.doc.sketches);
    return true;
  }

  /** Stop uploading files nothing owns any more (best effort: only the device copy goes). */
  async function dropQueued(fileIds: string[]) {
    for (const id of fileIds) {
      try {
        await discardPhoto(recordId, id);
      } catch {
        /* nothing queued for it */
      }
    }
  }

  /** The saved strokes of a sketch: this device's queued copy while pending, the bytes route once uploaded, the
   *  data URL inline. Null when they can't be read (the pad then starts empty, and says so). */
  async function loadStrokes(ref: SketchRef): Promise<InkDoc | null> {
    try {
      const k = siblingId(ref.id, "k");
      const slot = ref.strokes ?? {};
      let text: string | null = null;
      if (slot.inline) text = dataUrlText(slot.inline);
      else if (slot.blobPath) {
        const res = await fetch(fileUrl(recordId, k), { cache: "no-store" });
        text = res.ok ? await res.text() : null;
      } else {
        const blob = await queuedPhotoBlob(recordId, k);
        text = blob ? await blob.text() : null;
      }
      return text ? parseInk(text) : null;
    } catch {
      return null;
    }
  }

  async function openPad(view: SketchPadView) {
    if (opening || ink) return;
    setOpening(view.key);
    const section = sectionOf(view.key);
    try {
      const bg = backgroundFor(view.key, optsRef.current.survey.measurements, { linesetRows: view.rows, page: view.page });
      const cur = sketchesRef.current[view.key];
      let initial: InkDoc | undefined;
      let title = view.title;
      if (cur) {
        const doc = await loadStrokes(cur);
        if (doc) initial = fitInkTo(doc, bg.w, bg.h);
        else {
          title = `${view.title} — the earlier strokes couldn't load; Done replaces the drawing`;
          setMsg("The earlier strokes of this sketch couldn't load here (still uploading from another device, or offline) — the pad started empty.", section);
        }
      }
      setInk({ key: view.key, title, background: { kind: "svg", svg: bg.svg, w: bg.w, h: bg.h }, initial });
    } catch {
      setMsg("That sketch pad couldn't be opened.", section);
    } finally {
      setOpening(null);
    }
  }

  /** Done in the pad: a NEW s_ id + its k_, the sketch saved with both slots pending, THEN both files queued; the
   *  superseded sketch's queued files are dropped. Returned to the pad, so Done stays "Saving…" until it settles. */
  async function saveSketch(key: SketchKey, result: { doc: InkDoc; jpeg: Blob }) {
    const section = sectionOf(key);
    const cur = sketchesRef.current[key];
    const s = newFileId("s");
    const k = siblingId(s, "k");
    const next = withNewSketch(sketchesRef.current, key, s, optsRef.current.me, nowMs());
    const stale = sketchFilesToDiscard(cur, next[key]);
    addLocalUrl(s, result.jpeg);
    commit(next);
    await persist(section); // the server must own the ids before a finalize can land (a failed save still queues: retryable)
    try {
      await enqueuePhoto(recordId, s, result.jpeg);
      await enqueuePhoto(recordId, k, new Blob([serializeInk(result.doc)], { type: "application/json" }));
    } catch (e) {
      setMsg(`The sketch couldn't be kept on this device: ${errText(e, "storage refused it")}`, section);
    }
    await dropQueued(stale);
    // Uploaded files of a re-drawn sketch stay in Blob as orphans (harmless; nothing refers to them).
    if (stale.length) console.info("[venue-assessments] sketch re-drawn; any uploaded files of the old one stay as orphans", recordId, stale.join(", "));
    setInk(null);
  }

  /* ---------- rendering ---------- */
  function srcOf(ref: SketchRef): string | null {
    if (ref.image?.inline) return ref.image.inline;
    if (ref.image?.blobPath) return fileUrl(recordId, ref.id);
    return localUrls[ref.id] ?? null;
  }

  function tile(view: SketchPadView, compact = false): ReactNode {
    const ref = o.sketches[view.key];
    const src = ref ? srcOf(ref) : null;
    const busy = opening === view.key;
    return (
      <button
        key={view.key}
        type="button"
        className={compact ? "sk-tile compact" : "sk-tile"}
        disabled={!!opening}
        aria-label={`${ref ? "Edit" : "Draw"} ${view.title}`}
        title={ref ? `Edit ${view.title}` : `Draw ${view.title}`}
        onClick={(e) => {
          e.stopPropagation();
          void openPad(view);
        }}
      >
        <span className="sk-img">
          {busy ? (
            <span className="sk-empty">Opening…</span>
          ) : ref ? (
            src ? (
              // eslint-disable-next-line @next/next/no-img-element -- a private, session-gated route, a data URL or a local object URL
              <img src={src} alt={view.title} loading="lazy" />
            ) : (
              <span className="sk-empty">Uploading</span>
            )
          ) : (
            <span className="sk-draw"><span aria-hidden="true">✎</span><span className="sk-draw-label">Draw</span></span>
          )}
        </span>
        {ref && src && !slotFinished(ref.image) && <span className="sk-tag">Uploading</span>}
        <span className="sk-title">{view.title}</span>
      </button>
    );
  }

  function msgBox(section: string): ReactNode {
    if (!msg || msg.section !== section) return null;
    return (
      <div className="sk-msg" role="status">
        <span style={{ flex: 1 }}>{msg.text}</span>
        <button type="button" onClick={() => setMsg(null)}>Dismiss</button>
      </div>
    );
  }

  function tiles(sectionId: string, fieldKeys?: string[]): ReactNode {
    const beside = new Set(Object.entries(SKETCH_BESIDE).filter(([f]) => fieldKeys?.includes(f)).map(([, k]) => k));
    const views = visibleSketchPads(o.survey, sectionId).filter((v) => !beside.has(v.key) && linesetSheetPage(v.key) == null);
    const here = msgBox(sectionId);
    if (!views.length) return here;
    return (
      <>
        {here}
        <div className="sk-row">{views.map((v) => tile(v))}</div>
      </>
    );
  }

  function aside(fieldKey: string): ReactNode {
    const key = SKETCH_BESIDE[fieldKey];
    if (!key) return null;
    const view = visibleSketchPads(o.survey, sectionOf(key)).find((v) => v.key === key);
    return view ? <span className="sk-aside" onClick={(e) => e.stopPropagation()}>{tile(view, true)}</span> : null;
  }

  function linesetSheet(): HandSheet | undefined {
    const views = visibleSketchPads(o.survey, "linesets").filter((v) => linesetSheetPage(v.key) != null);
    if (!views.length) return undefined;
    const byKey = (key: string) => views.find((v) => v.key === key);
    return {
      pages: views.map((v) => ({ key: v.key, title: v.title, page: v.page ?? 1 })),
      busy: !!opening,
      onDraw: (key) => {
        const v = byKey(key);
        if (v) void openPad(v);
      },
      tile: (key) => {
        const v = byKey(key);
        return v ? tile(v) : null;
      },
    };
  }

  const overlay = (
    <>
      <style>{SK_CSS}</style>
      {ink && (
        <InkPad
          open
          title={ink.title}
          background={ink.background}
          initial={ink.initial}
          onCancel={() => setInk(null)}
          onDone={(result) => saveSketch(ink.key, result)}
        />
      )}
    </>
  );

  return { tiles, aside, linesetSheet, fold, overlay };
}
