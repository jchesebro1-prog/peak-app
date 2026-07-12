"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

/** The "+ New quote" split menu from Quotes.dc.html (local open state only). */
export function NewQuoteMenu() {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: "relative", flexShrink: 0 }}>
      <button
        type="button"
        className="qt-newbtn"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontSize: 13,
          fontWeight: 600,
          color: "#fff",
          background: "var(--accent)",
          padding: "12px 17px",
          borderRadius: 9,
          border: "none",
          cursor: "pointer",
          boxShadow: "0 1px 3px var(--accent-soft)",
          fontFamily: "var(--font-ui)",
        }}
      >
        <span style={{ fontSize: 15, lineHeight: 1 }}>+</span> New quote
        <span
          style={{
            fontSize: 10,
            transition: "transform .15s ease",
            transform: open ? "rotate(180deg)" : "none",
          }}
        >
          ▾
        </span>
      </button>
      {open && (
        <>
          <div
            onClick={() => setOpen(false)}
            style={{ position: "fixed", inset: 0, zIndex: 15 }}
          />
          <div
            style={{
              position: "absolute",
              top: "calc(100% + 6px)",
              right: 0,
              zIndex: 20,
              background: "#fff",
              border: "1px solid #e4e7ec",
              borderRadius: 12,
              boxShadow: "0 10px 30px rgba(0,0,0,.14)",
              padding: 6,
              minWidth: 246,
            }}
          >
            <Link
              href="/estimator"
              className="qt-menuitem"
              style={{
                display: "block",
                textDecoration: "none",
                color: "#16181d",
                borderRadius: 8,
                padding: "10px 12px",
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 600 }}>
                System / equipment quote
              </div>
              <div style={{ fontSize: 11.5, color: "#9aa0ab", marginTop: 2 }}>
                Full line-item estimator
              </div>
            </Link>
            <Link
              href="/flame-tests"
              className="qt-menuitem"
              style={{
                display: "block",
                textDecoration: "none",
                color: "#16181d",
                borderRadius: 8,
                padding: "10px 12px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>
                  Flame test quote
                </span>
                <span
                  style={{
                    fontSize: 8.5,
                    fontWeight: 700,
                    letterSpacing: ".04em",
                    textTransform: "uppercase",
                    color: "#b4543a",
                    background: "#f7e9e5",
                    border: "1px solid #f0d6cd",
                    padding: "2px 6px",
                    borderRadius: 4,
                  }}
                >
                  Auto
                </span>
              </div>
              <div style={{ fontSize: 11.5, color: "#9aa0ab", marginTop: 2 }}>
                Auto-priced by travel + curtain count
              </div>
            </Link>
            <Link
              href="/repairs/quote"
              className="qt-menuitem"
              style={{
                display: "block",
                textDecoration: "none",
                color: "#16181d",
                borderRadius: 8,
                padding: "10px 12px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>
                  Repair quote
                </span>
                <span
                  style={{
                    fontSize: 8.5,
                    fontWeight: 700,
                    letterSpacing: ".04em",
                    textTransform: "uppercase",
                    color: "#9a6a1f",
                    background: "#fbf3dd",
                    border: "1px solid #f0e2bd",
                    padding: "2px 6px",
                    borderRadius: 4,
                  }}
                >
                  Auto
                </span>
              </div>
              <div style={{ fontSize: 11.5, color: "#9aa0ab", marginTop: 2 }}>
                Auto-priced by labor + travel + parts
              </div>
            </Link>
            <Link
              href="/inspections/quote"
              className="qt-menuitem"
              style={{
                display: "block",
                textDecoration: "none",
                color: "#16181d",
                borderRadius: 8,
                padding: "10px 12px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>
                  Inspection quote
                </span>
                <span
                  style={{
                    fontSize: 8.5,
                    fontWeight: 700,
                    letterSpacing: ".04em",
                    textTransform: "uppercase",
                    color: "#3155a8",
                    background: "#e9eefb",
                    border: "1px solid #d4ddf3",
                    padding: "2px 6px",
                    borderRadius: 4,
                  }}
                >
                  Auto
                </span>
              </div>
              <div style={{ fontSize: 11.5, color: "#9aa0ab", marginTop: 2 }}>
                Auto-priced by line sets + level + travel
              </div>
            </Link>
          </div>
        </>
      )}
    </div>
  );
}

/** Teammate scope <select> — navigates via prebuilt hrefs from the server. */
export function OwnerSelect({
  value,
  options,
}: {
  value: string;
  options: Array<{ value: string; label: string; href: string }>;
}) {
  const router = useRouter();
  return (
    <select
      className="qt-sel"
      value={value}
      onChange={(e) => {
        const opt = options.find((o) => o.value === e.target.value);
        if (opt) router.push(opt.href);
      }}
      style={{
        fontFamily: "var(--font-ui)",
        fontSize: 12.5,
        fontWeight: 600,
        color: "#3a3f4a",
        background: "#fff",
        border: "1px solid #e4e7ec",
        borderRadius: 9,
        padding: "9px 30px 9px 12px",
        cursor: "pointer",
      }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
