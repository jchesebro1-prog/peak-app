"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { IconChevronDown } from "./icons";

/**
 * The Grid toolbar's dropdown (#299): a button that toggles an absolutely
 * positioned list. Closes on a pointerdown outside it and on Escape;
 * ArrowUp/Down move focus between items, Enter activates the focused one
 * (native button/link behaviour). `href` items are next/link. A menu may
 * also carry free content (`children`) under its items — the Design menu's
 * option switcher, the Outputs menu's package result. The root is
 * `data-no-nudge`, so arrow keys here never nudge a selected device.
 */

export type MenuItem = {
  label: React.ReactNode;
  onSelect?: () => void;
  href?: string;
  danger?: boolean;
  disabled?: boolean;
  /** A check mark before the label (the active option). */
  checked?: boolean;
  title?: string;
};

const TRIGGER: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  height: 28,
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: "#dfe2e8",
  background: "#fff",
  borderRadius: 7,
  padding: "0 8px 0 10px",
  fontSize: 12,
  fontWeight: 600,
  color: "#3d424e",
  cursor: "pointer",
  fontFamily: "inherit",
  whiteSpace: "nowrap",
};

const ITEM: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 7,
  width: "100%",
  border: "none",
  background: "none",
  borderRadius: 6,
  padding: "6px 9px",
  fontSize: 12.5,
  fontFamily: "inherit",
  color: "#16181d",
  textAlign: "left",
  textDecoration: "none",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

export default function Menu({
  label,
  title,
  items = [],
  children,
  align = "left",
  width,
  disabled,
  triggerStyle,
  chevron = true,
}: {
  label: React.ReactNode;
  title?: string;
  items?: MenuItem[];
  /** Free content under the items; a function gets `close`. */
  children?: React.ReactNode | ((close: () => void) => React.ReactNode);
  align?: "left" | "right";
  width?: number;
  disabled?: boolean;
  triggerStyle?: React.CSSProperties;
  /** false for a bare "⋯" trigger. */
  chevron?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const close = () => setOpen(false);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    // On document, so it runs before the editor's window-level shortcuts —
    // preventDefault tells them this Escape was the menu's.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const t = e.target as HTMLElement | null;
      // A field inside the menu (option name, rename) keeps its own Escape.
      if (t && rootRef.current?.contains(t) && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA")) return;
      e.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const focusables = () =>
    Array.from(listRef.current?.querySelectorAll<HTMLElement>("[data-menu-item]:not([disabled])") ?? []);
  const move = (dir: 1 | -1) => {
    const els = focusables();
    if (!els.length) return;
    const i = els.indexOf(document.activeElement as HTMLElement);
    const next = i < 0 ? (dir === 1 ? 0 : els.length - 1) : (i + dir + els.length) % els.length;
    els[next].focus();
  };

  return (
    <div ref={rootRef} data-no-nudge style={{ position: "relative", display: "inline-flex" }}>
      <button
        ref={triggerRef}
        type="button"
        title={title}
        aria-label={typeof label === "string" ? undefined : title}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            setOpen(true);
            requestAnimationFrame(() => move(1));
          }
        }}
        style={{ ...TRIGGER, ...(open ? { borderColor: "#c4c9d2", background: "#f4f5f7" } : null), ...triggerStyle }}
      >
        {label}
        {chevron && <IconChevronDown size={12} />}
      </button>
      {open && (
        <div
          ref={listRef}
          role="menu"
          onKeyDown={(e) => {
            const tag = (e.target as HTMLElement).tagName;
            if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              move(1);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              move(-1);
            }
          }}
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            ...(align === "right" ? { right: 0 } : { left: 0 }),
            zIndex: 60,
            minWidth: 200,
            width,
            maxHeight: "70vh",
            overflowY: "auto",
            background: "#fff",
            border: "1px solid #dfe2e8",
            borderRadius: 9,
            boxShadow: "0 10px 28px rgba(0,0,0,.16)",
            padding: 5,
            display: "grid",
            gap: 1,
          }}
        >
          {items.map((it, i) => {
            const body = (
              <>
                <span aria-hidden style={{ width: 12, flex: "0 0 auto", color: "#16181d" }}>
                  {it.checked ? "✓" : ""}
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>{it.label}</span>
              </>
            );
            const style = { ...ITEM, color: it.disabled ? "#b6bac2" : it.danger ? "#a0442b" : "#16181d" };
            return it.href && !it.disabled ? (
              <Link key={i} href={it.href} role="menuitem" data-menu-item title={it.title} onClick={close} style={style}>
                {body}
              </Link>
            ) : (
              <button
                key={i}
                type="button"
                role="menuitem"
                data-menu-item
                title={it.title}
                disabled={it.disabled}
                onClick={() => {
                  close();
                  it.onSelect?.();
                }}
                style={{ ...style, cursor: it.disabled ? "default" : "pointer" }}
              >
                {body}
              </button>
            );
          })}
          {children != null && (
            <div style={{ borderTop: items.length ? "1px solid #edeff3" : "none", marginTop: items.length ? 4 : 0, padding: items.length ? "7px 4px 3px" : 4 }}>
              {typeof children === "function" ? children(close) : children}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
