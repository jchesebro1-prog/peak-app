"use client";

import { useEffect, useRef, useState, useTransition, type CSSProperties } from "react";
import type { SpecSection } from "./types";
import {
  libraryRowCounts,
  libraryRowMeta,
  type LoadedLibrarySystem,
  type SystemLibraryEntry,
  type SystemLibraryHit,
} from "@/lib/narrative/system-library";
import { mergeNarrative, mergeNotice, type MergeOpts } from "@/lib/narrative/merge";
import { getSystemLibraryEntryAction, loadLibrarySystemAction, searchSystemLibraryAction } from "./library-actions";

/**
 * #293 slice 2 — the system library: every sent and won system, computed
 * (never curated). "load": pick a row → Load system (the server re-prices it).
 * "merge": tick rows, choose Intro / Key products, preview, then append into
 * the target system. Only copies text that already exists (D89).
 */
export type SystemLibraryModalProps =
  | { mode: "load"; tierMargin: number | null; onLoaded: (res: LoadedLibrarySystem) => void; onClose: () => void }
  | { mode: "merge"; target: SpecSection; onMerge: (sources: SystemLibraryEntry[], opts: MergeOpts) => void; onClose: () => void };

const BTN: CSSProperties = { fontFamily: "var(--font-ui)", fontSize: 12, fontWeight: 600, color: "#3a3f4a", background: "#f1f2f5", border: "none", borderRadius: 6, padding: "6px 12px", cursor: "pointer" };
const PRIMARY: CSSProperties = { ...BTN, color: "#fff", background: "var(--accent)" };
const FIELD: CSSProperties = { flex: 1, minWidth: 0, fontFamily: "var(--font-ui)", fontSize: 13, color: "#16181d", border: "1px solid #e4e7ec", borderRadius: 7, padding: "7px 10px" };
const HINT: CSSProperties = { fontSize: 12, color: "#8c919c", lineHeight: 1.45, padding: 10 };
const META: CSSProperties = { fontSize: 11.5, color: "#8c919c", marginTop: 2 };
const LABEL: CSSProperties = { fontSize: 10.5, fontWeight: 600, color: "#9aa0ab", letterSpacing: ".06em", textTransform: "uppercase", marginTop: 10 };
const FAILED = "Could not reach the server. Try again.";

export default function SystemLibraryModal(p: SystemLibraryModalProps) {
  const merge = p.mode === "merge";
  const [query, setQuery] = useState("");
  // Merge needs narrative content, so it starts filtered to it.
  const [hasNarrative, setHasNarrative] = useState(merge);
  const [hits, setHits] = useState<SystemLibraryHit[] | null>(null);
  // A failed search shows Retry in the list (never a stuck "Searching…"); attempt re-runs it.
  const [searchFailed, setSearchFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [, startSearch] = useTransition();
  const seq = useRef(0);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [entries, setEntries] = useState<Record<string, SystemLibraryEntry>>({});
  const [opts, setOpts] = useState<MergeOpts>({ intro: true, products: true });
  const [err, setErr] = useState("");
  const [, startFetch] = useTransition();
  const [pending, start] = useTransition();

  useEffect(() => {
    const my = ++seq.current;
    const t = setTimeout(() => {
      startSearch(async () => {
        try {
          const r = await searchSystemLibraryAction(query.trim(), { hasNarrative });
          if (my === seq.current) {
            setHits(r);
            setSearchFailed(false);
            setErr("");
          }
        } catch {
          if (my === seq.current) {
            setSearchFailed(true);
            setErr(FAILED);
          }
        }
      });
    }, 260);
    return () => clearTimeout(t);
  }, [query, hasNarrative, attempt]);

  const focus = (key: string) => {
    setFocusKey(key);
    if (Object.hasOwn(entries, key)) return;
    startFetch(async () => {
      try {
        const e = await getSystemLibraryEntryAction(key);
        if (e) {
          setEntries((m) => ({ ...m, [key]: e }));
          setErr("");
        } else {
          // A gone entry can't be merged — untick it so it can't hold Merge on "Loading…".
          setPicked((ks) => ks.filter((k) => k !== key));
          setFocusKey((f) => (f === key ? null : f));
          setErr("That system is no longer in the library.");
        }
      } catch {
        // Same as gone: no entry arrived, so the row can't stay ticked or
        // leave the detail pane (and Merge) on "Loading…". Clicking it retries.
        setPicked((ks) => ks.filter((k) => k !== key));
        setFocusKey((f) => (f === key ? null : f));
        setErr(FAILED);
      }
    });
  };
  const toggle = (key: string) => {
    setPicked((ks) => (ks.includes(key) ? ks.filter((k) => k !== key) : [...ks, key]));
    focus(key);
  };

  const load = () => {
    if (p.mode !== "load" || !focusKey) return;
    const key = focusKey;
    const tierMargin = p.tierMargin;
    const onLoaded = p.onLoaded;
    start(async () => {
      setErr("");
      try {
        const res = await loadLibrarySystemAction(key, { tierMargin });
        if (res.ok) onLoaded(res);
        else setErr(res.error);
      } catch {
        setErr(FAILED);
      }
    });
  };

  const sources = picked.map((k) => entries[k]).filter((e): e is SystemLibraryEntry => !!e);
  const allLoaded = sources.length === picked.length;
  const preview = p.mode === "merge" && sources.length ? mergeNarrative(p.target, sources, opts) : null;
  const detail = focusKey ? entries[focusKey] : undefined;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={merge ? "Merge narrative from the library" : "Load a system from the library"}
      onKeyDown={(e) => {
        // While a Load is in flight the modal can't close: a result landing after close would still insert a system.
        if (e.key === "Escape" && !pending) p.onClose();
      }}
      style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(22,24,29,.35)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
    >
      <div style={{ width: "min(880px, 100%)", maxHeight: "90vh", overflowY: "auto", background: "#fff", borderRadius: 12, padding: 18, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600 }}>System library</div>
            <div style={{ fontSize: 12, color: "#8c919c" }}>
              {merge ? "Append intros and key products from sent and won systems into this one." : "Every system on a sent or won estimate, as it was sent."}
            </div>
          </div>
          <button type="button" style={BTN} disabled={pending} onClick={p.onClose}>Close</button>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            aria-label="Search the system library"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by system, customer, EST-#, part or description"
            style={FIELD}
          />
          <button
            type="button"
            aria-pressed={hasNarrative}
            onClick={() => setHasNarrative((v) => !v)}
            style={{ ...BTN, borderRadius: 999, background: hasNarrative ? "#e7f4ee" : "#f1f2f5", color: hasNarrative ? "#1f7a52" : "#5b616e" }}
          >
            Has narrative
          </button>
        </div>

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", minHeight: 0 }}>
          <div aria-label="Library systems" style={{ flex: "1 1 320px", minWidth: 0, maxHeight: "50vh", overflowY: "auto", border: "1px solid #ececf0", borderRadius: 8 }}>
            {searchFailed ? (
              <div style={HINT}>
                Search didn&apos;t go through.{" "}
                <button type="button" style={BTN} onClick={() => { setSearchFailed(false); setAttempt((n) => n + 1); }}>Retry</button>
              </div>
            ) : hits === null ? (
              <div style={HINT}>Searching…</div>
            ) : !hits.length ? (
              <div style={HINT}>No sent or won systems match.</div>
            ) : (
              hits.map((h) => {
                const on = merge ? picked.includes(h.key) : focusKey === h.key;
                return (
                  <button
                    key={h.key}
                    type="button"
                    aria-pressed={on}
                    onClick={() => (merge ? toggle(h.key) : focus(h.key))}
                    style={{
                      display: "flex", gap: 8, width: "100%", textAlign: "left", fontFamily: "var(--font-ui)", cursor: "pointer",
                      background: on ? "#f4f6fb" : "#fff", border: "none", borderBottom: "1px solid #f0f1f4",
                      borderLeft: focusKey === h.key ? "3px solid var(--accent)" : "3px solid transparent", padding: "9px 10px",
                    }}
                  >
                    {merge && <span aria-hidden="true" style={{ fontSize: 14, lineHeight: "18px" }}>{on ? "☑" : "☐"}</span>}
                    <span style={{ minWidth: 0, display: "block" }}>
                      <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#16181d" }}>{h.systemName || "Untitled system"}</span>
                      <span style={{ ...META, display: "block" }}>{libraryRowMeta(h)}</span>
                      <span style={{ ...META, display: "block" }}>{libraryRowCounts(h)}</span>
                      {h.introSnippet && (
                        <span style={{ ...META, display: "block", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{h.introSnippet}</span>
                      )}
                    </span>
                  </button>
                );
              })
            )}
          </div>

          <div aria-label="Selected system" style={{ flex: "1 1 260px", minWidth: 0, maxHeight: "50vh", overflowY: "auto" }}>
            {!focusKey ? (
              <div style={HINT}>Pick a system to see its intro and key products.</div>
            ) : !detail ? (
              <div style={HINT}>Loading…</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{detail.systemName || "Untitled system"}</div>
                <div style={META}>{libraryRowMeta(detail)} · {detail.presentation === "narrative" ? "Narrative" : "Itemized"}</div>
                <div style={LABEL}>Intro</div>
                {detail.intro ? <div style={{ fontSize: 12.5, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{detail.intro}</div> : <div style={META}>No intro.</div>}
                <div style={LABEL}>Key products</div>
                {detail.keyProducts.length ? (
                  detail.keyProducts.map((k) => (
                    <div key={k.sku} style={{ fontSize: 12.5 }}>
                      {k.heading} <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "#8c919c" }}>{k.sku}</span>
                    </div>
                  ))
                ) : (
                  <div style={META}>No key products.</div>
                )}
              </div>
            )}
          </div>
        </div>

        {merge && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, borderTop: "1px solid #f0f1f4", paddingTop: 8 }}>
            <div style={{ display: "flex", gap: 14, fontSize: 12.5 }}>
              <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input type="checkbox" checked={opts.intro} onChange={(e) => { const v = e.target.checked; setOpts((o) => ({ ...o, intro: v })); }} /> Intro
              </label>
              <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input type="checkbox" checked={opts.products} onChange={(e) => { const v = e.target.checked; setOpts((o) => ({ ...o, products: v })); }} /> Key products
              </label>
            </div>
            <div style={{ fontSize: 12, color: "#3a3f4a" }}>
              {!picked.length ? "Tick one or more systems to merge." : !allLoaded || !preview ? "Loading…" : mergeNotice(preview)}
            </div>
          </div>
        )}

        {err && <div style={{ fontSize: 12, color: "#b4543a" }}>{err}</div>}

        <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {p.mode === "load" ? (
            <>
              {/* Copy as a JS string (not JSX text) so the apostrophes need no &apos; — the harness matches it verbatim. */}
              <span style={{ fontSize: 11.5, color: "#8c919c", marginRight: "auto" }}>{"Re-priced at today's catalog and this estimate's tier. Vendor-quote lines are left out."}</span>
              <button type="button" style={BTN} disabled={pending} onClick={p.onClose}>Cancel</button>
              <button type="button" style={{ ...PRIMARY, opacity: focusKey && !pending ? 1 : 0.5 }} disabled={!focusKey || pending} onClick={load}>
                {pending ? "Loading…" : "Load system"}
              </button>
            </>
          ) : (
            <>
              <button type="button" style={BTN} disabled={pending} onClick={p.onClose}>Cancel</button>
              <button
                type="button"
                style={{ ...PRIMARY, opacity: preview?.changed && allLoaded ? 1 : 0.5 }}
                disabled={!preview?.changed || !allLoaded}
                onClick={() => p.onMerge(sources, opts)}
              >Merge</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
