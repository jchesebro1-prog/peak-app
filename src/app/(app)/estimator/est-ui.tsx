"use client";

import type { CSSProperties, MouseEvent, ReactNode } from "react";

/**
 * Shared estimator UI atoms — the prototype's accent derivations, segmented
 * buttons, field labels, and the configurator modal shell. Exact values from
 * Estimator.dc.html.
 */

export const ACCENT = "var(--accent)";
export const ACCENT_SOFT = "color-mix(in srgb, var(--accent) 12%, #fff)";
export const ACCENT_INK = "color-mix(in srgb, var(--accent) 72%, #000)";

/** 10px uppercase field label (modal + portal fields). */
export const LBL: CSSProperties = {
  display: "block",
  fontSize: 10,
  fontWeight: 600,
  color: "#aab0bb",
  textTransform: "uppercase",
  letterSpacing: ".04em",
  marginBottom: 6,
};

/** Same label at the tighter 5px margin used inside grids/portals. */
export const LBL5: CSSProperties = { ...LBL, marginBottom: 5 };

/** Segmented option button (hang type / fullness / scope / trip type…). */
export function segBtn(on: boolean): CSSProperties {
  return {
    flex: 1,
    fontFamily: "var(--font-ui)",
    fontSize: 12.5,
    fontWeight: 600,
    padding: "8px 6px",
    borderRadius: 8,
    cursor: "pointer",
    border: "1px solid " + (on ? "var(--accent)" : "#e4e7ec"),
    background: on ? ACCENT_SOFT : "#fff",
    color: on ? ACCENT_INK : "#5b616e",
  };
}

/** Non-stretching toggle chip (fixture accessories / power & data). */
export function chipBtn(on: boolean): CSSProperties {
  return {
    fontFamily: "var(--font-ui)",
    fontSize: 12,
    fontWeight: 600,
    padding: "7px 11px",
    borderRadius: 8,
    cursor: "pointer",
    border: "1px solid " + (on ? "var(--accent)" : "#e4e7ec"),
    background: on ? ACCENT_SOFT : "#fff",
    color: on ? ACCENT_INK : "#5b616e",
  };
}

/** Accent CTA in modal footers; grey/disabled when invalid. */
export function addBtnStyle(valid: boolean): CSSProperties {
  return {
    fontFamily: "var(--font-ui)",
    fontSize: 13,
    fontWeight: 600,
    border: "none",
    borderRadius: 9,
    padding: "10px 20px",
    ...(valid
      ? { background: "var(--accent)", color: "#fff", cursor: "pointer" }
      : { background: "#e7e9ee", color: "#aab0bb", cursor: "not-allowed" }),
  };
}

/** Modal footer stat block (Cost / ea · Price · ext …). */
export function Stat({
  label,
  value,
  color,
  size = 13,
  weight = 600,
}: {
  label: ReactNode;
  value: ReactNode;
  color?: string;
  size?: number;
  weight?: number;
}) {
  return (
    <div>
      <span
        style={{
          fontSize: 10,
          color: "#aab0bb",
          textTransform: "uppercase",
          letterSpacing: ".04em",
        }}
      >
        {label}
      </span>
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: size,
          fontWeight: weight,
          color: color || "#16181d",
        }}
      >
        {value}
      </div>
    </div>
  );
}

/** Configurator modal shell — scrim, sticky header, body, sticky pricing footer. */
export function ConfigModal({
  width,
  icon,
  iconSize = 16,
  title,
  sub,
  onClose,
  children,
  footerLeft,
  footerRight,
}: {
  width: number;
  icon: ReactNode;
  iconSize?: number;
  title: ReactNode;
  sub: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footerLeft: ReactNode;
  footerRight: ReactNode;
}) {
  const stop = (e: MouseEvent) => e.stopPropagation();
  return (
    <div
      className="est-modalwrap"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(16,18,22,.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
        padding: 24,
      }}
    >
      <div
        className="est-modal"
        onClick={stop}
        style={{
          width,
          maxWidth: "100%",
          maxHeight: "92vh",
          overflowY: "auto",
          background: "#fff",
          borderRadius: 14,
          boxShadow: "0 24px 70px rgba(0,0,0,.34)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            padding: "18px 22px",
            borderBottom: "1px solid #ececf0",
            position: "sticky",
            top: 0,
            background: "#fff",
            borderRadius: "14px 14px 0 0",
            zIndex: 2,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
            <span
              style={{
                width: 30,
                height: 30,
                borderRadius: 8,
                background: ACCENT_SOFT,
                color: ACCENT_INK,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: iconSize,
              }}
            >
              {icon}
            </span>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700 }}>{title}</div>
              <div style={{ fontSize: 11.5, color: "#8c919c" }}>{sub}</div>
            </div>
          </div>
          <button
            type="button"
            className="est-close"
            onClick={onClose}
            style={{
              width: 30,
              height: 30,
              border: "none",
              background: "#f1f2f5",
              borderRadius: 8,
              color: "#5b616e",
              fontSize: 17,
              cursor: "pointer",
            }}
          >
            ×
          </button>
        </div>

        <div style={{ padding: "20px 22px" }}>{children}</div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
            padding: "16px 22px",
            borderTop: "1px solid #ececf0",
            background: "#fafbfc",
            borderRadius: "0 0 14px 14px",
            position: "sticky",
            bottom: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 20 }}>{footerLeft}</div>
          {footerRight}
        </div>
      </div>
    </div>
  );
}

/** Bordered text field used across the modals (focus ring via .est-field). */
export const FIELD: CSSProperties = {
  width: "100%",
  fontFamily: "var(--font-ui)",
  fontSize: 13.5,
  color: "#16181d",
  border: "1px solid #e4e7ec",
  borderRadius: 8,
  padding: "9px 11px",
};

/** Right-aligned mono numeric field (est-input). */
export const NUMFIELD: CSSProperties = {
  width: "100%",
  textAlign: "right",
  fontSize: 13,
  border: "1px solid #e4e7ec",
  borderRadius: 8,
  padding: "9px 11px",
};
