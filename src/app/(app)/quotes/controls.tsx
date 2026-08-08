"use client";

import Link from "next/link";
import { useState } from "react";
// Nothing here may import from @/lib/stores/quotes — this is a client bundle
// and the store transitively pulls in the db layer (postgres, drizzle), which
// cannot be bundled for the browser. That applies to `import type` too: the
// bundler still walks the edge and errors on node builtins. So the revision
// row is described by a local view-model the server maps into, matching the
// VM pattern the Leads screen uses (leads/types.ts).
import { money, timeAgo } from "@/lib/format";
import { firstName } from "@/lib/team";
import { saveQuoteRevisionAction, restoreQuoteRevisionAction } from "./actions";

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
            <Link
              href="/design/engagements/quote"
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
                  Consulting quote
                </span>
                <span
                  style={{
                    fontSize: 8.5,
                    fontWeight: 700,
                    letterSpacing: ".04em",
                    textTransform: "uppercase",
                    color: "#6b4fa1",
                    background: "#f0ebf9",
                    border: "1px solid #ddd2f0",
                    padding: "2px 6px",
                    borderRadius: 4,
                  }}
                >
                  Fee
                </span>
              </div>
              <div style={{ fontSize: 11.5, color: "#9aa0ab", marginTop: 2 }}>
                Fee-based design &amp; advisory work
              </div>
            </Link>
            <Link
              href="/rentals/quote"
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
                  Rental quote
                </span>
                <span
                  style={{
                    fontSize: 8.5,
                    fontWeight: 700,
                    letterSpacing: ".04em",
                    textTransform: "uppercase",
                    color: "#2f7a52",
                    background: "#e6f4ec",
                    border: "1px solid #cde7d8",
                    padding: "2px 6px",
                    borderRadius: 4,
                  }}
                >
                  Auto
                </span>
              </div>
              <div style={{ fontSize: 11.5, color: "#9aa0ab", marginTop: 2 }}>
                Auto-priced by equipment + duration
              </div>
            </Link>
          </div>
        </>
      )}
    </div>
  );
}

/* #22 — OwnerSelect moved to @/components/owner-select (shared with Leads
 * and Projects); re-exported so quotes/page.tsx's import stays put. */
export { OwnerSelect } from "@/components/owner-select";

/* ---------------- revisions (punch item 24) ---------------- */

const REV_ACCENT_SOFT = "color-mix(in srgb, var(--accent) 12%, #fff)";
const REV_ACCENT_INK = "color-mix(in srgb, var(--accent) 72%, #000)";

/** The fields this list renders — a structural subset of the store's QuoteRevision. */
export type QuoteRevisionVM = {
  rev: number;
  at: number;
  by: string;
  reason: "manual" | "sent";
  note: string;
  value: number;
};

/**
 * Revision history for a quote — the design-revision modal (quick-design) in
 * quote clothing. Rows are newest-first; every mutation is a plain form post to
 * a server action, so the list works the same way the rest of this screen does.
 *
 * `canRestore` is false on won quotes: the project spawned from a won quote
 * copies value/margin once at conversion and never re-reads, so recalling a
 * revision would desync them with no repair path.
 */
export function QuoteRevisions({
  id,
  revisions,
  canRestore,
}: {
  id: string;
  revisions: QuoteRevisionVM[];
  canRestore: boolean;
}) {
  const [open, setOpen] = useState(false);
  const list = revisions.slice().reverse();

  return (
    <>
      <form action={saveQuoteRevisionAction} style={{ display: "inline-flex" }}>
        <input type="hidden" name="id" value={id} />
        <button
          type="submit"
          title="Snapshot this quote's current pricing"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            fontSize: 12.5,
            fontWeight: 600,
            color: REV_ACCENT_INK,
            background: REV_ACCENT_SOFT,
            border: `1px solid ${REV_ACCENT_SOFT}`,
            borderRadius: 8,
            padding: "9px 13px",
            cursor: "pointer",
          }}
        >
          <span style={{ fontSize: 14, lineHeight: 1 }}>⎘</span> Save revision
        </button>
      </form>

      {revisions.length > 0 && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          style={{
            fontSize: 12.5,
            fontWeight: 600,
            color: "#5b616e",
            background: "transparent",
            border: "none",
            borderRadius: 8,
            padding: "9px 6px",
            cursor: "pointer",
          }}
        >
          Revisions · {revisions.length}
        </button>
      )}

      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(16,22,30,.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 28,
            zIndex: 90,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 620,
              maxWidth: "100%",
              maxHeight: "80vh",
              display: "flex",
              flexDirection: "column",
              background: "#fff",
              borderRadius: 15,
              boxShadow: "0 24px 70px rgba(0,0,0,.34)",
              overflow: "hidden",
              color: "#16181d",
              textAlign: "left",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 12,
                padding: "17px 22px",
                borderBottom: "1px solid #f0f1f4",
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 16, fontWeight: 600 }}>Revision history</div>
                <div style={{ fontSize: 12, color: "#9aa0ab", marginTop: 2 }}>
                  Priced snapshots of {id}. Recalling one keeps the current version — it is
                  saved as a new revision first.
                </div>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close revision history"
                style={{
                  width: 28,
                  height: 28,
                  flexShrink: 0,
                  border: "1px solid #e4e7ec",
                  borderRadius: 8,
                  background: "#fff",
                  color: "#5b616e",
                  cursor: "pointer",
                  lineHeight: 1,
                }}
              >
                ×
              </button>
            </div>

            <div style={{ overflowY: "auto", padding: "6px 0" }}>
              {!canRestore && (
                <div
                  style={{
                    margin: "10px 22px 4px",
                    padding: "10px 13px",
                    borderRadius: 9,
                    background: "#fbf3dd",
                    border: "1px solid #f0e2bd",
                    color: "#8a6d1f",
                    fontSize: 12,
                    lineHeight: 1.5,
                  }}
                >
                  This quote is won — a project was built from these numbers, so revisions are
                  read-only. Recalling one would leave the project out of step with the quote.
                </div>
              )}
              {list.map((r) => (
                <div
                  key={"v" + r.rev}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 13,
                    padding: "12px 22px",
                    borderBottom: "1px solid #f5f6f8",
                  }}
                >
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 12,
                      fontWeight: 600,
                      color: "#fff",
                      background: r.reason === "sent" ? "#1f7a52" : "#16181d",
                      borderRadius: 6,
                      padding: "4px 8px",
                      flexShrink: 0,
                    }}
                  >
                    v{r.rev}
                  </span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div
                      style={{
                        fontSize: 13.5,
                        fontWeight: 600,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {r.reason === "sent" ? "Sent to customer" : r.note || "Manual snapshot"}
                    </div>
                    <div style={{ fontSize: 11.5, color: "#9aa0ab" }}>
                      {timeAgo(r.at)} · {firstName(r.by || "") || "—"}
                    </div>
                  </div>
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 13,
                      fontWeight: 600,
                      flexShrink: 0,
                    }}
                  >
                    {money(r.value || 0)}
                  </span>
                  {canRestore && (
                    <form action={restoreQuoteRevisionAction} style={{ flexShrink: 0 }}>
                      <input type="hidden" name="id" value={id} />
                      <input type="hidden" name="rev" value={r.rev} />
                      <button
                        type="submit"
                        onClick={() => setOpen(false)}
                        style={{
                          fontSize: 12.5,
                          fontWeight: 600,
                          color: REV_ACCENT_INK,
                          background: REV_ACCENT_SOFT,
                          border: "none",
                          borderRadius: 8,
                          padding: "8px 13px",
                          cursor: "pointer",
                        }}
                      >
                        Recall
                      </button>
                    </form>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
