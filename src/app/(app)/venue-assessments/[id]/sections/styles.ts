/* ============================================================
 * Shared field styles + accent tints for the assessment editor and its
 * section components.
 * ============================================================ */

import type { CSSProperties } from "react";

/* ---------- accent tints ---------- */
export const ACCENT = "var(--accent)";
export const ACCENT_SOFT = "color-mix(in srgb, var(--accent) 13%, #fff)";
export const ACCENT_INK = "color-mix(in srgb, var(--accent) 70%, #000)";
export const ACCENT_BORDER_LT = "color-mix(in srgb, var(--accent) 30%, #fff)";

/* ---------- shared field styles ---------- */
export const labelStyle: CSSProperties = {
  fontSize: 10.5,
  fontWeight: 600,
  color: "#9aa0ab",
  letterSpacing: ".04em",
  textTransform: "uppercase",
  marginBottom: 6,
  display: "block",
};
export const inpStyle: CSSProperties = {
  width: "100%",
  fontFamily: "var(--font-ui)",
  fontSize: 16,
  color: "#16181d",
  border: "1px solid #e4e7ec",
  borderRadius: 10,
  padding: "12px 13px",
  outline: "none",
  background: "#fff",
};
export const selStyle: CSSProperties = { ...inpStyle, cursor: "pointer" };
export const measStyle: CSSProperties = { ...inpStyle, fontFamily: "var(--font-mono)", padding: "11px 12px" };
export const taStyle: CSSProperties = { ...inpStyle, minHeight: 88, resize: "vertical", lineHeight: 1.5 };
