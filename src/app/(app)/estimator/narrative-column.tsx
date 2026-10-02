"use client";

import { useState, useTransition, type CSSProperties, type RefObject } from "react";
import type { SpecItem, SpecSection } from "./types";
import {
  KEY_PRODUCT_CHIP_LABEL,
  MAX_PARAGRAPH,
  draftNarrative,
  draftOverwrites,
  keyProductChip,
  markKeyProduct,
  moveKeyProduct,
  patchKeyProduct,
  reanchorKeyProduct,
  removeKeyProduct,
  resolveKeyProducts,
  unmarkedEligibleLines,
  type KeyProductChip,
  type KeyProductResolution,
} from "./narrative";
import { saveProductParagraphAction, upsertSystemIntroAction } from "./narrative-actions";
import type { KeyProductLibrary } from "./use-key-product-library";
import { MAX_INTRO_TITLE, type SystemIntro } from "@/lib/narrative/intros";
import NarrativeIntrosModal from "./narrative-intros-modal";
import SystemLibraryModal from "./system-library-modal";
import { mergeNarrative, mergeNotice, type MergeOpts } from "@/lib/narrative/merge";
import type { SystemLibraryEntry } from "@/lib/narrative/system-library";

/**
 * #293 — the narrative column's body (the #281 aside keeps its header and
 * Hide button): presentation, the system Intro, and the key-product cards.
 * Every edit goes through `onChange(fn)` → the Estimator's setSections, so
 * the #254 re-price banner rule holds. Library writes happen ONLY on an
 * explicit Save to library, confirmed inline (the browser's confirm dialog
 * is a silent "no" in the Capacitor shells).
 */

export type NarrativeColumnProps = {
  sec: SpecSection;
  narrRef: RefObject<HTMLTextAreaElement | null>;
  onChange: (fn: (s: SpecSection) => SpecSection) => void;
  library: KeyProductLibrary;
  canWriteLibrary: boolean;
  /** #293: the system-intro library (loaded server-side, updated by the actions). */
  intros: SystemIntro[];
  onIntros: (list: SystemIntro[]) => void;
};

const LABEL: CSSProperties = { fontSize: 10.5, fontWeight: 600, color: "#9aa0ab", letterSpacing: ".06em", textTransform: "uppercase" };
const HINT: CSSProperties = { fontSize: 11, color: "#8c919c", lineHeight: 1.4 };
const BTN: CSSProperties = { fontFamily: "var(--font-ui)", fontSize: 11.5, fontWeight: 600, color: "#3a3f4a", background: "#f1f2f5", border: "none", borderRadius: 6, padding: "4px 8px", cursor: "pointer" };
const CHIP_TONE: Record<KeyProductChip, CSSProperties> = {
  needs: { background: "#fbf3dd", color: "#8a6d1f" },
  library: { background: "#e7f4ee", color: "#1f7a52" },
  edited: { background: "#eef0f3", color: "#3a3f4a" },
  custom: { background: "#f1f2f5", color: "#8c919c" },
};
const STRIP: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, fontSize: 11.5, fontWeight: 600, color: "#b4543a", background: "#fbecea", borderRadius: 6, padding: "6px 8px" };
const FAILED = "Could not reach the server. Try again.";
const NO_LIBRARY = "Could not load the library";
const ASK: CSSProperties = { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, fontSize: 11.5, color: "#3a3f4a", background: "#fbf3dd", borderRadius: 6, padding: "6px 8px" };

export default function NarrativeColumn(p: NarrativeColumnProps) {
  const { sec, narrRef } = p;
  const res = resolveKeyProducts(sec);
  const hasKps = res.length > 0;
  const pickable = unmarkedEligibleLines(sec);
  const [introId, setIntroId] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [saveAsTitle, setSaveAsTitle] = useState<string | null>(null);
  const [manageOpen, setManageOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [draftAsk, setDraftAsk] = useState(false);
  const [notice, setNotice] = useState("");
  const [busy, startBusy] = useTransition();
  const chosen = p.intros.find((i) => i.id === introId) || null;
  const NEEDS_CREATE = "Needs the Create permission";
  const hasIntroText = !!(sec.narrative || "").trim();

  /** Draft narrative: copies saved text only — never generates (D89).
   *  Every server await is caught: a throw inside startTransition reaches
   *  the error boundary and would unmount the Estimator. */
  const draft = (mode: "replace" | "blanks" | null) =>
    startBusy(async () => {
      setNotice("");
      try {
        const okSkus = resolveKeyProducts(sec).filter((r) => r.status === "ok").map((r) => r.kp.sku);
        // Force-refresh (bypass the cache) so Draft copies the CURRENT
        // library paragraph. Any sku still without a row means the library
        // didn't load: abort with no write — a missing row would otherwise
        // read as "no paragraph" and replace written text with the
        // description.
        let rows = p.library.rows;
        if (okSkus.length) {
          try {
            rows = await p.library.refresh(okSkus);
          } catch {
            setNotice(NO_LIBRARY);
            return;
          }
          if (okSkus.some((s) => !Object.hasOwn(rows, s))) {
            setNotice(NO_LIBRARY);
            return;
          }
        }
        const lib = new Map(Object.entries(rows));
        const introText = chosen ? chosen.text : null;
        if (mode == null && draftOverwrites(sec, introText, lib)) {
          setDraftAsk(true);
          return;
        }
        setDraftAsk(false);
        const m = mode ?? "replace";
        const r = draftNarrative(sec, introText, lib, m);
        if (r.changed) p.onChange((s) => draftNarrative(s, introText, lib, m).section);
        const parts: string[] = [];
        if ((sec.presentation || "itemized") !== "narrative") parts.push("Switched to Narrative");
        const n = r.needsParagraph.length;
        if (n) parts.push(`${n} ${n === 1 ? "product still needs" : "products still need"} a paragraph`);
        if (!r.changed) parts.push("Nothing to change");
        setNotice(parts.join(" · "));
      } catch {
        setNotice(FAILED);
      }
    });

  const saveAsIntro = () => {
    const title = (saveAsTitle || "").trim();
    const text = sec.narrative || "";
    startBusy(async () => {
      setNotice("");
      try {
        const r = await upsertSystemIntroAction({ title, text });
        if (!r.ok) return setNotice(r.error);
        p.onIntros(r.intros);
        if (r.id) setIntroId(r.id);
        setSaveAsTitle(null);
        setNotice("Saved as intro");
      } catch {
        setNotice(FAILED);
      }
    });
  };

  /** #293 slice 2: Merge narrative — append-only; never invents a line.
   *  Applied through onChange (setSections) on the live section. */
  const applyMerge = (sources: SystemLibraryEntry[], opts: MergeOpts) => {
    const r = mergeNarrative(sec, sources, opts);
    if (r.changed) p.onChange((s) => mergeNarrative(s, sources, opts).section);
    setMergeOpen(false);
    setNotice(mergeNotice(r));
  };

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <select
          aria-label="System intro"
          value={introId}
          onChange={(e) => {
            setIntroId(e.target.value);
            setDraftAsk(false); // the Replace / Fill blanks strip asked about the previous intro
          }}
          style={{ flex: "1 1 140px", minWidth: 0, border: "1px solid #e4e7ec", borderRadius: 6, padding: "4px 6px", fontSize: 11.5, color: "#5b616e", background: "#fff" }}
        >
          <option value="">— none —</option>
          {p.intros.map((i) => (
            <option key={i.id} value={i.id}>{i.title}</option>
          ))}
        </select>
        <button type="button" style={BTN} disabled={busy} onClick={() => draft(null)} title="Copy the chosen intro and each key product's saved paragraph onto this system">
          Draft narrative
        </button>
        <div style={{ position: "relative" }}>
          <button type="button" style={BTN} aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((v) => !v)} title="Narrative library">⋯</button>
          {menuOpen && (
            <div role="menu" style={{ position: "absolute", right: 0, top: "110%", zIndex: 20, background: "#fff", border: "1px solid #ececf0", borderRadius: 8, boxShadow: "0 6px 20px rgba(0,0,0,.1)", padding: 4, display: "flex", flexDirection: "column", minWidth: 160 }}>
              <button
                type="button"
                role="menuitem"
                style={{ ...BTN, background: "transparent", textAlign: "left", opacity: p.canWriteLibrary && hasIntroText ? 1 : 0.5 }}
                disabled={!p.canWriteLibrary || !hasIntroText}
                title={!p.canWriteLibrary ? NEEDS_CREATE : !hasIntroText ? "Write an intro first" : ""}
                onClick={() => { setMenuOpen(false); setSaveAsTitle(""); }}
              >
                Save as intro…
              </button>
              <button
                type="button"
                role="menuitem"
                style={{ ...BTN, background: "transparent", textAlign: "left", opacity: p.canWriteLibrary ? 1 : 0.5 }}
                disabled={!p.canWriteLibrary}
                title={p.canWriteLibrary ? "" : NEEDS_CREATE}
                onClick={() => { setMenuOpen(false); setManageOpen(true); }}
              >
                Manage intros…
              </button>
              <button
                type="button"
                role="menuitem"
                style={{ ...BTN, background: "transparent", textAlign: "left" }}
                onClick={() => { setMenuOpen(false); setMergeOpen(true); }}
              >
                Merge narrative from library…
              </button>
            </div>
          )}
        </div>
      </div>
      {saveAsTitle !== null && (
        <div style={ASK}>
          <input aria-label="Intro title" autoFocus value={saveAsTitle} maxLength={MAX_INTRO_TITLE} placeholder="Intro title" onChange={(e) => setSaveAsTitle(e.target.value)}
            style={{ flex: 1, minWidth: 120, border: "1px solid #e4e7ec", borderRadius: 6, padding: "4px 6px", fontSize: 12 }} />
          <button type="button" style={BTN} disabled={busy || !saveAsTitle.trim()} onClick={saveAsIntro}>Save</button>
          <button type="button" style={BTN} onClick={() => setSaveAsTitle(null)}>Cancel</button>
        </div>
      )}
      {draftAsk && (
        <div style={ASK}>
          <span>This system already has written text.</span>
          <button type="button" style={BTN} disabled={busy} onClick={() => draft("replace")}>Replace what&apos;s written</button>
          <button type="button" style={BTN} disabled={busy} onClick={() => draft("blanks")}>Fill blanks only</button>
          <button type="button" style={BTN} onClick={() => setDraftAsk(false)}>Cancel</button>
        </div>
      )}
      {notice && <div style={{ ...HINT, color: "#3a3f4a" }}>{notice}</div>}
      {manageOpen && (
        <NarrativeIntrosModal intros={p.intros} canWrite={p.canWriteLibrary} onIntros={p.onIntros} onClose={() => setManageOpen(false)} />
      )}
      {mergeOpen && (
        <SystemLibraryModal mode="merge" target={sec} onMerge={applyMerge} onClose={() => setMergeOpen(false)} />
      )}
      <select
        value={sec.presentation || "itemized"}
        onChange={(e) => {
          const v = e.target.value as "itemized" | "narrative";
          p.onChange((s) => ({ ...s, presentation: v }));
        }}
        aria-label="Customer presentation"
        style={{ alignSelf: "flex-start", border: "1px solid #e4e7ec", borderRadius: 6, padding: "4px 6px", fontSize: 11.5, color: "#5b616e", background: "#fff" }}
      >
        <option value="itemized">Customer: itemized</option>
        <option value="narrative">Customer: narrative</option>
      </select>
      {(sec.presentation || "itemized") === "itemized" && <div style={HINT}>Prints on the quote only in Narrative mode.</div>}
      <div style={LABEL}>Intro</div>
      <textarea
        ref={narrRef}
        className="est-field"
        aria-label={"Narrative for " + (sec.name || "this system")}
        value={sec.narrative || ""}
        onChange={(e) => {
          const v = e.target.value;
          p.onChange((s) => ({ ...s, narrative: v }));
        }}
        placeholder="Explain this system for the customer — what it is, what it does, what's included…"
        style={{
          flex: hasKps ? "none" : 1,
          minHeight: hasKps ? 140 : 240,
          width: "100%",
          resize: hasKps ? "vertical" : "none",
          fontFamily: "var(--font-ui)",
          fontSize: 13,
          lineHeight: 1.55,
          color: "#16181d",
          background: "#fff",
          border: "1px solid #e4e7ec",
          borderRadius: 8,
          padding: "10px 12px",
        }}
      />
      <div style={HINT}>Blank line = new paragraph · start a line with “- ” for a bullet</div>
      {hasKps && <div style={{ ...LABEL, marginTop: 4 }}>Key products</div>}
      {res.map((r, i) => (
        <KeyProductCard
          key={r.kp.lineKey + "|" + r.kp.sku}
          r={r}
          index={i}
          count={res.length}
          onChange={p.onChange}
          library={p.library}
          canWriteLibrary={p.canWriteLibrary}
        />
      ))}
      {pickable.length > 0 && (
        <select
          aria-label="Add a key product"
          value=""
          onChange={(e) => {
            const id = Number(e.target.value);
            const it = sec.items.find((x) => x.id === id);
            if (!it) return;
            const text = p.library.rows[it.sku.trim()]?.paragraph || "";
            p.onChange((s) => markKeyProduct(s, id, text));
          }}
          style={{ alignSelf: "flex-start", border: "1px dashed #d6d9e0", borderRadius: 6, padding: "4px 6px", fontSize: 11.5, color: "#5b616e", background: "#fff" }}
        >
          <option value="">+ Key product…</option>
          {pickable.map((it) => (
            <option key={it.id} value={it.id}>
              {it.desc} · {it.sku}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

/** The card gets no `narrRef` (React's refs rule: a ref must not ride in a spread of props). */
type KeyProductCardProps = Pick<NarrativeColumnProps, "onChange" | "library" | "canWriteLibrary"> & { r: KeyProductResolution; index: number; count: number };

function KeyProductCard(props: KeyProductCardProps) {
  const { r, index, count, onChange, library, canWriteLibrary } = props;
  const kp = r.kp;
  const item: SpecItem | undefined = r.status === "missing" ? undefined : r.item;
  const row = library.rows[kp.sku];
  const chip = keyProductChip(kp, row);
  const [ask, setAsk] = useState<null | "replace" | "stale">(null);
  const [stale, setStale] = useState<{ paragraph: string | null; updatedAt: number | null } | null>(null);
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();

  /** Every server await is caught: a throw inside startTransition reaches
   *  the error boundary and would unmount the Estimator (unsaved work lost). */
  const doSave = (expect: number | null) =>
    start(async () => {
      setMsg("");
      try {
        const out = await saveProductParagraphAction(kp.sku, kp.text, expect);
        if (out.ok) {
          library.setRow(kp.sku, out.row);
          setAsk(null);
          setMsg("Saved to the library.");
        } else if (out.stale) {
          // The library moved on: refresh the cached row so the chip and
          // "Use library text" show the paragraph that's there now.
          if (row) library.setRow(kp.sku, { ...row, paragraph: out.stale.paragraph, paragraphUpdatedAt: out.stale.updatedAt });
          setStale(out.stale);
          setAsk("stale");
        } else {
          setAsk(null);
          setMsg(out.error);
        }
      } catch {
        setMsg(FAILED);
      }
    });
  const onSave = () => {
    if (row?.paragraph != null && row.paragraph.trim() !== kp.text.trim()) setAsk("replace");
    else doSave(row?.paragraphUpdatedAt ?? null);
  };
  const saveTitle = !canWriteLibrary
    ? "Needs the Create permission"
    : row && !row.inCatalog
    ? "Only catalog parts have a library paragraph"
    : !kp.text.trim()
    ? "Write the paragraph first"
    : "Save this paragraph to the part — future quotes start from it";
  const canSave = canWriteLibrary && !!row?.inCatalog && !!kp.text.trim() && r.status === "ok";

  return (
    <div style={{ border: "1px solid #ececf0", borderRadius: 8, padding: 10, display: "flex", flexDirection: "column", gap: 7, background: "#fff" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: "#16181d" }}>{item?.desc || kp.sku}</div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "#8c919c" }}>{kp.sku}</div>
        </div>
        {chip && (
          <span style={{ ...CHIP_TONE[chip], fontSize: 10.5, fontWeight: 600, borderRadius: 999, padding: "2px 8px", whiteSpace: "nowrap" }}>{KEY_PRODUCT_CHIP_LABEL[chip]}</span>
        )}
      </div>

      {/* Copy as JS strings (not JSX text) so the apostrophe needs no &apos; — the harness matches it verbatim. */}
      {r.status === "missing" && (
        <div style={STRIP}>
          <span>{"Line removed — this block won't print"}</span>
          <button type="button" style={BTN} onClick={() => onChange((s) => removeKeyProduct(s, index))}>Remove</button>
        </div>
      )}
      {r.status === "changed" && (
        <div style={STRIP}>
          <span>{`Line changed to ${r.item.sku} — this block won't print`}</span>
          <button type="button" style={BTN} onClick={() => onChange((s) => reanchorKeyProduct(s, index))}>Re-anchor</button>
        </div>
      )}
      {r.status === "ineligible" && <div style={STRIP}><span>{"Optional/labor line — won't print"}</span></div>}

      {row?.photoDocId ? (
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11.5, color: "#5b616e" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={"/api/part-documents/" + encodeURIComponent(row.photoDocId)}
            alt=""
            style={{ width: 52, height: 52, objectFit: "contain", borderRadius: 6, border: "1px solid #eef0f3", background: "#fff", opacity: kp.photo ? 1 : 0.4 }}
          />
          <input type="checkbox" checked={kp.photo} onChange={(e) => { const v = e.target.checked; onChange((s) => patchKeyProduct(s, index, { photo: v })); }} />
          Photo
        </label>
      ) : row ? (
        <div style={HINT}>No photo — prints full width</div>
      ) : null}

      <textarea
        className="est-field"
        aria-label={"Paragraph for " + (item?.desc || kp.sku)}
        value={kp.text}
        maxLength={MAX_PARAGRAPH}
        placeholder={row?.desc || item?.desc || ""}
        onChange={(e) => {
          const v = e.target.value;
          onChange((s) => patchKeyProduct(s, index, { text: v }));
        }}
        style={{ minHeight: 90, width: "100%", resize: "vertical", fontFamily: "var(--font-ui)", fontSize: 12.5, lineHeight: 1.5, color: "#16181d", border: "1px solid #e4e7ec", borderRadius: 7, padding: "8px 10px" }}
      />

      {ask === "replace" && (
        <div style={ASK}>
          <span>Replace the library paragraph for {kp.sku}?</span>
          <button type="button" style={BTN} disabled={pending} onClick={() => doSave(row?.paragraphUpdatedAt ?? null)}>Replace</button>
          <button type="button" style={BTN} onClick={() => setAsk(null)}>Cancel</button>
        </div>
      )}
      {ask === "stale" && (
        <div style={ASK}>
          <span>The library paragraph changed since you loaded it — replace it anyway?</span>
          <button type="button" style={BTN} disabled={pending} onClick={() => doSave(stale?.updatedAt ?? null)}>Replace anyway</button>
          <button type="button" style={BTN} onClick={() => setAsk(null)}>Cancel</button>
        </div>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
        <button type="button" style={BTN} disabled={index === 0} onClick={() => onChange((s) => moveKeyProduct(s, index, -1))} aria-label="Move up">↑</button>
        <button type="button" style={BTN} disabled={index === count - 1} onClick={() => onChange((s) => moveKeyProduct(s, index, 1))} aria-label="Move down">↓</button>
        <button type="button" style={{ ...BTN, opacity: canSave ? 1 : 0.5, cursor: canSave ? "pointer" : "not-allowed" }} disabled={!canSave || pending} title={saveTitle} onClick={onSave}>
          {pending ? "Saving…" : "Save to library"}
        </button>
        {chip === "edited" && row?.paragraph != null && (
          <button type="button" style={BTN} onClick={() => { const t = row.paragraph as string; onChange((s) => patchKeyProduct(s, index, { text: t })); }}>Use library text</button>
        )}
        <button type="button" style={{ ...BTN, color: "#b4543a" }} onClick={() => onChange((s) => removeKeyProduct(s, index))}>Remove</button>
      </div>
      {msg && <div style={{ ...HINT, color: msg.startsWith("Saved") ? "#1f7a52" : "#b4543a" }}>{msg}</div>}
    </div>
  );
}
