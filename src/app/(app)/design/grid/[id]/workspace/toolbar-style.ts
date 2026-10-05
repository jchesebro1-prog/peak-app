/** Toolbar control styles (#299), shared by the toolbar and the pieces
 *  split out of it (Outputs menu, quote button). */

export const BTN: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  height: 28,
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: "#dfe2e8",
  background: "#fff",
  borderRadius: 7,
  padding: "0 10px",
  fontSize: 12,
  fontWeight: 600,
  color: "#3d424e",
  cursor: "pointer",
  fontFamily: "inherit",
  whiteSpace: "nowrap",
  textDecoration: "none",
};

export const FIELD_LABEL: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: ".06em",
  textTransform: "uppercase",
  color: "#9aa0ab",
  margin: "2px 0 6px",
};
