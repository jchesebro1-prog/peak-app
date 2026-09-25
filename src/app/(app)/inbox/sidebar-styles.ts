/** Shared inline styles for the reader's link sidebar cards (#96 §2 / round 3). */
import type { CSSProperties } from "react";
import { INPUT } from "@/components/entity-quick-add";

export const ACCENT_SOFT = "color-mix(in srgb, var(--accent) 12%, #fff)";
export const ACCENT_INK = "color-mix(in srgb, var(--accent) 68%, #000)";

export const CARD: CSSProperties = {
  border: "1px solid #e4e7ec",
  borderRadius: 10,
  padding: "12px 13px",
  background: "#fff",
};
export const H: CSSProperties = {
  fontSize: 10.5,
  fontWeight: 600,
  letterSpacing: ".06em",
  textTransform: "uppercase",
  color: "#aab0bb",
  marginBottom: 8,
};
export const MUTED: CSSProperties = { fontSize: 11.5, color: "#8c919c", marginTop: 3, lineHeight: 1.45 };
export const BODY: CSSProperties = { fontSize: 12.5, lineHeight: 1.5, color: "#3a3f4a" };
export const MONO: CSSProperties = { fontFamily: "var(--font-mono)", fontSize: 11.5 };
/** matches the reader's ghost action buttons */
export const BTN: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 11.5,
  fontWeight: 600,
  color: "#3a3f4a",
  background: "#fff",
  border: "1px solid #e4e7ec",
  borderRadius: 8,
  padding: "6px 10px",
  cursor: "pointer",
};
/** matches the reader's accent-tinted "+ Link to work" button */
export const ACCENT_BTN: CSSProperties = {
  ...BTN,
  color: ACCENT_INK,
  background: ACCENT_SOFT,
  border: `1px solid ${ACCENT_SOFT}`,
};
export const PRIMARY: CSSProperties = {
  ...BTN,
  color: "#fff",
  background: "var(--accent)",
  border: "1px solid transparent",
};
export const SELECT: CSSProperties = { ...INPUT, padding: "8px 10px", fontSize: 12.5, cursor: "pointer" };
export const CHECK_ROW: CSSProperties = {
  display: "flex",
  gap: 7,
  alignItems: "flex-start",
  fontSize: 12,
  color: "#3a3f4a",
  marginTop: 10,
  lineHeight: 1.4,
  cursor: "pointer",
};
