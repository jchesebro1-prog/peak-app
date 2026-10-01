"use client";

import Link from "next/link";
import type { SettingsScreen } from "../settings-sections";

/**
 * Pieces every Settings group shares (settings cleanup): the shell's `run`
 * wrapper (error banner + router.refresh after a server action), the form
 * label/input styles, the on/off Toggle, and the link-tile row. Moved out of
 * the old 3,100-line settings-client.tsx unchanged.
 */

export type ActionResult = { ok: boolean; error?: string };

/** The shell's server-action runner: clears the error banner, runs `fn`,
 *  shows its error (if any), then refreshes the route. */
export type Run = (fn: () => Promise<ActionResult>) => void;

export const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 11,
  fontWeight: 600,
  color: "#9aa0ab",
  letterSpacing: ".04em",
  textTransform: "uppercase",
  marginBottom: 7,
};

export const inputStyle: React.CSSProperties = {
  width: "100%",
  border: "1px solid #e4e7ec",
  borderRadius: 9,
  padding: "11px 13px",
  fontSize: 14,
  fontFamily: "var(--font-ui)",
  outline: "none",
};

export function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      style={{
        width: 44,
        height: 26,
        borderRadius: 13,
        border: "none",
        cursor: "pointer",
        background: on ? "var(--accent)" : "#cdd1d9",
        position: "relative",
        transition: "background .15s ease",
        flexShrink: 0,
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 3,
          left: on ? 21 : 3,
          width: 20,
          height: 20,
          borderRadius: "50%",
          background: "#fff",
          boxShadow: "0 1px 2px rgba(0,0,0,.3)",
          transition: "left .15s ease",
        }}
      />
    </button>
  );
}

/** One screen link — label, one-line description, →. Same tile the old
 *  Company tools and Admin cards drew. */
export function LinkTile({ screen }: { screen: SettingsScreen }) {
  return (
    <Link
      href={screen.href}
      className="pk-settings-tile"
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 12,
        padding: "12px 14px",
        border: "1px solid #eef0f3",
        borderRadius: 10,
        textDecoration: "none",
        color: "inherit",
        background: "#fff",
      }}
    >
      <span style={{ minWidth: 0 }}>
        <span style={{ fontSize: 13.5, fontWeight: 600 }}>
          {screen.mark && (
            <span aria-hidden style={{ color: "var(--accent)", marginRight: 6 }}>
              {screen.mark}
            </span>
          )}
          {screen.label}
        </span>
        <span style={{ display: "block", fontSize: 12, color: "#8c919c", marginTop: 2 }}>{screen.desc}</span>
      </span>
      <span aria-hidden style={{ color: "#b7bcc6", fontSize: 16 }}>
        →
      </span>
    </Link>
  );
}

/** The shortcut row at the top of a group — one tile per screen. */
export function LinkTiles({ screens }: { screens: readonly SettingsScreen[] }) {
  if (!screens.length) return null;
  return (
    <nav aria-label="Settings shortcuts" className="pk-settings-tiles" style={{ marginBottom: 20 }}>
      {screens.map((s) => (
        <LinkTile key={s.href} screen={s} />
      ))}
    </nav>
  );
}
