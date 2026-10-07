import type { CSSProperties } from "react";

export const CSS = `
.est-input { font-family: var(--font-mono); }
.est-scroll::-webkit-scrollbar { width: 10px; }
.est-scroll::-webkit-scrollbar-thumb { background: #d6d9e0; border-radius: 8px; border: 3px solid #f7f8fa; }
.est-qd::-webkit-scrollbar-thumb { background: #3a3e46; border-color: #23262d; }
.est-qd-done:hover { color: #fff !important; border-color: #4a4e56 !important; }
.est-qd-chip:hover { color: #fff !important; border-color: #4a4e56 !important; }
.est-qd-col + .est-qd-col { border-left: 1px solid #2b2e35; }
.est-side-toggle:hover { color: #16181d !important; border-color: #c4c9d2 !important; }
.est-side-tab:hover { color: #16181d !important; background: #f7f8fa !important; }
.est-field:focus { border-color: #c4c9d2 !important; outline: none; }
.est-warm:focus { border-color: #e3cf94 !important; outline: none; }
.est-secname:hover { border-color: #e4e7ec !important; }
.est-title:hover { border-color: #4a4e56 !important; }
.est-secname:focus { border-color: #c4c9d2 !important; background: #fff !important; outline: none; }
.est-notefield:focus { border-color: #4a4e56 !important; outline: none; }
.est-row:hover { background: #fafbff; }
.est-actions { opacity: .4; transition: opacity .12s; }
.est-row:hover .est-actions, .est-actions:focus-within { opacity: 1; }
.est-row-kp .est-actions { opacity: 1; }
.est-action-btn:hover { background: #eef0f3 !important; }
.est-x:hover { color: #d6584a !important; }
.est-delsys:hover { color: #d6584a !important; }
.est-sug:hover { background: #fff !important; }
.est-close:hover { background: #e7e9ee !important; }
.est-addsys:hover { border-color: var(--accent) !important; color: var(--accent) !important; }
.est-preset:hover { filter: brightness(.97); }
@media (max-width: 860px) {
  .est-root, .est-screen { height: auto !important; min-height: 100% !important; overflow: visible !important; }
  .est-topbar { flex-direction: column !important; align-items: stretch !important; gap: 12px !important; height: auto !important; }
  .est-topright { width: 100% !important; flex-wrap: wrap !important; gap: 10px !important; justify-content: flex-start !important; }
  .est-body { flex-direction: column !important; }
  .est-side { width: 100% !important; border-right: none !important; border-bottom: 1px solid #ececf0 !important; }
  .est-qd-grid { grid-template-columns: minmax(0, 1fr) !important; }
  .est-qd-col + .est-qd-col { border-left: none !important; border-top: 1px solid #2b2e35 !important; }
  .est-side-collapsed .est-side-tab { flex-direction: row !important; justify-content: center !important; padding: 8px 12px !important; }
  .est-side-vlabel { writing-mode: horizontal-tb !important; }
  .est-main { overflow: visible !important; padding: 16px 16px 48px !important; }
  .est-docwrap { padding: 16px !important; }
  .est-doc { width: 100% !important; padding: 26px 20px !important; }
  .est-prevhead { flex-wrap: wrap !important; row-gap: 10px !important; }
  .est-previewbody { flex-direction: column !important; }
  .est-prevhead { width: 100% !important; border-right: none !important; border-bottom: 1px solid #ececf0 !important; }
  .est-modalwrap { align-items: flex-end !important; padding: 0 !important; }
  .est-modal { width: 100% !important; max-width: 100% !important; border-radius: 16px 16px 0 0 !important; max-height: 92vh !important; }
  .est-modal input, .est-modal select, .est-modal textarea { font-size: 16px !important; }
}
`;

export const STATUS_DOT: Record<string, string> = {
  draft: "#c98a2b",
  sent: "#3155a8",
  won: "#1f8a5b",
  lost: "#8c919c",
};
/** #305 — the header's read-only status label (the select lives on Send & track). */
export const STATUS_LABEL: Record<string, string> = { draft: "Draft", sent: "Sent", won: "Won", lost: "Lost" };

/** Overlapping-chevron breadcrumb shape (Daylite stage bar, Task 6). Every
 *  segment gets the same clip-path and a negative left margin so the next
 *  segment's notch sits over the previous segment's point, and a rising
 *  z-index (left → right) so that notch actually shows through. */
export const CHEVRON_CLIP = "polygon(0 0, calc(100% - 12px) 0, 100% 50%, calc(100% - 12px) 100%, 0 100%, 10px 50%)";

export const DARK_SELECT: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 12.5,
  fontWeight: 600,
  color: "#fff",
  background: "#2b2e35",
  border: "1px solid #3a3e46",
  borderRadius: 7,
  padding: "7px 10px",
  cursor: "pointer",
};

export const CTX_LABEL: CSSProperties = {
  fontSize: 10,
  color: "#9aa0ab",
  textTransform: "uppercase",
  letterSpacing: ".06em",
  flexShrink: 0,
};

export const META_SECTION: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 7,
  padding: "14px 16px",
  borderBottom: "1px solid #2b2e35",
};
export const META_SUB: CSSProperties = { fontSize: 11, color: "#6b7079", marginTop: 2 };
export const META_HINT: CSSProperties = { fontSize: 10.5, color: "#6b7079", lineHeight: 1.35 };
export const META_HEAD: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  padding: "10px 12px 10px 16px",
  borderBottom: "1px solid #2b2e35",
};
export const META_TOGGLE: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 11,
  fontWeight: 600,
  color: "#9aa0ab",
  background: "transparent",
  border: "1px solid #3a3e46",
  borderRadius: 6,
  padding: "4px 8px",
  cursor: "pointer",
  whiteSpace: "nowrap",
};
export const SIDE_OPEN_KEY = "quartzite.estimator.sideOpen";
export const SIDE_TOGGLE: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 11,
  fontWeight: 600,
  color: "#9aa0ab",
  background: "transparent",
  border: "1px solid #e4e7ec",
  borderRadius: 6,
  padding: "3px 7px",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

