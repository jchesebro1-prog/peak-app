"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import {
  approveReviewAction,
  claimReviewAction,
  requestChangesAction,
  type ReviewKind,
} from "./actions";

/** Serialized review card — metaLine/value prebuilt server-side. */
export type ReviewItem = {
  kind: ReviewKind;
  id: string;
  name: string;
  owner: string;
  ownerFirst: string;
  ownerColor: string;
  ownerInitials: string;
  state: "none" | "in_review" | "approved" | "changes";
  metaLine: string;
  value: string;
  /** Reviewer note — only set when state === 'changes' (hasNote port). */
  note: string;
  openHref: string;
  canClaim: boolean;
  canDecide: boolean;
};

/* ---- prototype token maps (Reviews.dc.html stateMeta / kindMeta) ---- */

const STATE_META: Record<string, { label: string; ink: string; soft: string; bd: string }> = {
  in_review: { label: "In review", ink: "#3155a8", soft: "#e9eefb", bd: "#d4ddf3" },
  approved: { label: "Approved", ink: "#1f7a52", soft: "#eaf6ef", bd: "#cce9da" },
  changes: { label: "Changes requested", ink: "#b4543a", soft: "#f7e9e5", bd: "#f0d6cd" },
  none: { label: "Draft", ink: "#8c919c", soft: "#f1f2f5", bd: "#e4e7ec" },
};

const KIND_META: Record<ReviewKind, { ink: string; soft: string; bd: string; bar: string }> = {
  Quote: { ink: "#5b4b8a", soft: "#f0ecf5", bd: "#e0d6ea", bar: "#7b3f8a" },
  Design: { ink: "#8a6d1f", soft: "#fbf3dd", bd: "#f0e2bd", bar: "#b5683a" },
};

export default function ReviewList({
  items,
  emptyTitle,
  emptySub,
}: {
  items: ReviewItem[];
  emptyTitle: string;
  emptySub: string;
}) {
  const router = useRouter();
  const [rc, setRc] = useState<{ kind: ReviewKind; id: string; ownerFirst: string } | null>(null);
  const [rcNote, setRcNote] = useState("");
  const [toast, setToast] = useState("");
  const [pending, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flash = (msg: string) => {
    setToast(msg);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(""), 2600);
  };

  const run = (
    fn: () => Promise<{ ok: boolean; error?: string }>,
    msg: string
  ) => {
    if (pending) return;
    startTransition(async () => {
      const res = await fn();
      if (res.ok) {
        flash(msg);
        router.refresh();
      } else if (res.error) {
        flash(res.error);
      }
    });
  };

  const submitRc = () => {
    const target = rc;
    if (!target) return;
    const note = rcNote.trim();
    if (!note) return;
    setRc(null);
    setRcNote("");
    run(
      () => requestChangesAction(target.kind, target.id, note),
      "Sent back for changes."
    );
  };

  return (
    <>
      {items.length === 0 && (
        <div
          style={{
            background: "#fff",
            border: "1px solid #ececf0",
            borderRadius: 13,
            padding: "50px 22px",
            textAlign: "center",
            boxShadow: "0 1px 2px rgba(0,0,0,.04)",
          }}
        >
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              background: "#eaf6ef",
              color: "#1f7a52",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 22,
              margin: "0 auto 14px",
            }}
          >
            ✓
          </div>
          <div style={{ fontSize: 15, fontWeight: 600 }}>{emptyTitle}</div>
          <div style={{ fontSize: 13, color: "#9aa0ab", marginTop: 6 }}>{emptySub}</div>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {items.map((it) => {
          const km = KIND_META[it.kind];
          const sm = STATE_META[it.state] || STATE_META.none;
          return (
            <div
              key={it.kind + "-" + it.id}
              className="rv-item"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 16,
                background: "#fff",
                border: "1px solid #ececf0",
                borderLeft: `3px solid ${km.bar}`,
                borderRadius: 12,
                boxShadow: "0 1px 2px rgba(0,0,0,.04)",
                padding: "15px 17px",
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: ".06em",
                      color: km.ink,
                      background: km.soft,
                      border: `1px solid ${km.bd}`,
                      padding: "2px 8px",
                      borderRadius: 5,
                    }}
                  >
                    {it.kind}
                  </span>
                  <span
                    style={{
                      display: "inline-block",
                      fontSize: 10,
                      fontWeight: 600,
                      color: sm.ink,
                      background: sm.soft,
                      border: `1px solid ${sm.bd}`,
                      padding: "2px 8px",
                      borderRadius: 20,
                    }}
                  >
                    {sm.label}
                  </span>
                  <span
                    style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "#aab0bb" }}
                  >
                    {it.id}
                  </span>
                </div>
                <div
                  style={{
                    fontSize: 14.5,
                    fontWeight: 600,
                    lineHeight: 1.3,
                    marginTop: 9,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {it.name}
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    marginTop: 8,
                    flexWrap: "wrap",
                  }}
                >
                  <span
                    title={it.owner}
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: "50%",
                      background: it.ownerColor,
                      color: "#fff",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 9,
                      fontWeight: 600,
                      flexShrink: 0,
                    }}
                  >
                    {it.ownerInitials}
                  </span>
                  <span style={{ fontSize: 12, color: "#5b616e" }}>{it.metaLine}</span>
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 12.5,
                      fontWeight: 600,
                      color: "#16181d",
                      marginLeft: "auto",
                    }}
                  >
                    {it.value}
                  </span>
                </div>
                {it.note && (
                  <div
                    style={{
                      fontSize: 12,
                      color: "#8a5a2b",
                      background: "#fcf4e8",
                      border: "1px solid #f0e2c8",
                      borderRadius: 8,
                      padding: "8px 11px",
                      marginTop: 10,
                      lineHeight: 1.45,
                    }}
                  >
                    “{it.note}”
                  </div>
                )}
              </div>
              <div
                className="rv-actions"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  flexShrink: 0,
                  flexWrap: "wrap",
                  justifyContent: "flex-end",
                }}
              >
                <Link
                  href={it.openHref}
                  className="rv-open"
                  style={{
                    fontSize: 12.5,
                    fontWeight: 600,
                    color: "#5b616e",
                    textDecoration: "none",
                    padding: "9px 13px",
                    borderRadius: 8,
                    border: "1px solid #e4e7ec",
                    background: "#fff",
                  }}
                >
                  Open
                </Link>
                {it.canClaim && (
                  <button
                    type="button"
                    onClick={() =>
                      run(
                        () => claimReviewAction(it.kind, it.id),
                        "Claimed — it’s in your queue."
                      )
                    }
                    style={{
                      fontFamily: "var(--font-ui)",
                      fontSize: 12.5,
                      fontWeight: 600,
                      color: "#3155a8",
                      background: "#e9eefb",
                      border: "1px solid #d4ddf3",
                      borderRadius: 8,
                      padding: "9px 13px",
                      cursor: "pointer",
                    }}
                  >
                    Claim
                  </button>
                )}
                {it.canDecide && (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        setRc({ kind: it.kind, id: it.id, ownerFirst: it.ownerFirst })
                      }
                      style={{
                        fontFamily: "var(--font-ui)",
                        fontSize: 12.5,
                        fontWeight: 600,
                        color: "#b4543a",
                        background: "#f9ece8",
                        border: "1px solid #f0d6cd",
                        borderRadius: 8,
                        padding: "9px 13px",
                        cursor: "pointer",
                      }}
                    >
                      Request changes
                    </button>
                    <button
                      type="button"
                      className="rv-approve"
                      onClick={() =>
                        run(
                          () => approveReviewAction(it.kind, it.id),
                          "Approved — owner can now send to customer."
                        )
                      }
                      style={{
                        fontFamily: "var(--font-ui)",
                        fontSize: 12.5,
                        fontWeight: 600,
                        color: "#fff",
                        background: "#1f7a52",
                        border: "none",
                        borderRadius: 8,
                        padding: "10px 15px",
                        cursor: "pointer",
                      }}
                    >
                      Approve
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* request-changes modal */}
      {rc && (
        <div
          onClick={() => {
            setRc(null);
            setRcNote("");
          }}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(16,22,30,.46)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 28,
            zIndex: 60,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 460,
              maxWidth: "100%",
              background: "#fff",
              borderRadius: 15,
              boxShadow: "0 24px 70px rgba(0,0,0,.32)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                padding: "17px 22px",
                borderBottom: "1px solid #f0f1f4",
                fontSize: 16,
                fontWeight: 600,
              }}
            >
              Request changes
            </div>
            <div style={{ padding: "20px 22px" }}>
              <div
                style={{ fontSize: 12.5, color: "#5b616e", marginBottom: 11, lineHeight: 1.5 }}
              >
                Tell {rc.ownerFirst} what needs to change before this can be approved.
              </div>
              <textarea
                value={rcNote}
                onChange={(e) => setRcNote(e.target.value)}
                placeholder="e.g. Re-check the rigging load math and add the pit filler line."
                className="rv-ta"
                style={{
                  width: "100%",
                  minHeight: 96,
                  border: "1px solid #e4e7ec",
                  borderRadius: 9,
                  padding: "11px 13px",
                  fontSize: 13.5,
                  fontFamily: "var(--font-ui)",
                  resize: "vertical",
                  outline: "none",
                }}
              />
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "flex-end",
                gap: 9,
                padding: "14px 22px",
                borderTop: "1px solid #f0f1f4",
              }}
            >
              <button
                type="button"
                onClick={() => {
                  setRc(null);
                  setRcNote("");
                }}
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: 13,
                  fontWeight: 600,
                  color: "#5b616e",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  padding: "10px 12px",
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitRc}
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: 13,
                  fontWeight: 600,
                  color: "#fff",
                  background: "#b4543a",
                  border: "none",
                  borderRadius: 9,
                  padding: "10px 18px",
                  cursor: "pointer",
                }}
              >
                Send back for changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* toast */}
      {toast && (
        <div
          style={{
            position: "fixed",
            left: "50%",
            bottom: 26,
            transform: "translateX(-50%)",
            display: "flex",
            alignItems: "center",
            gap: 11,
            background: "#16181d",
            color: "#fff",
            padding: "13px 16px",
            borderRadius: 12,
            boxShadow: "0 8px 28px rgba(0,0,0,.22)",
            zIndex: 70,
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "#5fd29a",
              flexShrink: 0,
            }}
          />
          <span style={{ fontSize: 13 }}>{toast}</span>
        </div>
      )}
    </>
  );
}
