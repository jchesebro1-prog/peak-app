"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { promoteDesignAction } from "./home-actions";

/**
 * "My designs" sandbox strip — port of Home.dc.html's Design Dashboard card.
 * Client component because of the promote flow: Add to Quotes → creates a
 * real draft quote flagged for requote, removes the design, and shows the
 * promote toast (with "Requote now" → Estimator) for 6 seconds.
 */

export type DesignCard = {
  id: string;
  venue: string;
  name: string;
  meta: string;
  budget: string;
  tier: string;
  systemsLabel: string;
  edited: string;
  openHref: string;
};

const ACCENT_SOFT = "var(--accent-soft)";
const ACCENT_INK = "color-mix(in srgb, var(--accent) 70%, #000)";
const ACCENT_BORDER_LT = "color-mix(in srgb, var(--accent) 30%, #fff)";

export default function HomeMyDesigns({ cards }: { cards: DesignCard[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [promoted, setPromoted] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  const promote = (id: string) => {
    setPendingId(id);
    startTransition(async () => {
      const res = await promoteDesignAction(id);
      setPendingId(null);
      if (res.ok) {
        setPromoted(res.id);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setPromoted(null), 6000);
        router.refresh();
      }
    });
  };

  return (
    <div className="pk-card" style={{ overflow: "hidden", marginBottom: 22 }}>
      <div
        className="pkh-greet"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          padding: "15px 18px 13px",
          borderBottom: "1px solid #f0f1f4",
          flexWrap: "wrap",
          rowGap: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 11, minWidth: 0 }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>My designs</span>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 9.5,
              fontWeight: 600,
              letterSpacing: ".08em",
              color: ACCENT_INK,
              border: `1px solid ${ACCENT_BORDER_LT}`,
              background: ACCENT_SOFT,
              padding: "2px 7px",
              borderRadius: 5,
            }}
          >
            SANDBOX
          </span>
          <span style={{ fontSize: 12.5, color: "#9aa0ab" }}>
            Budgetary only — separate from Quotes until you add them
          </span>
        </div>
        <Link
          href="/quick-design"
          className="pkh-actions pkh-softbtn"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 7,
            fontSize: 12.5,
            fontWeight: 600,
            color: ACCENT_INK,
            background: ACCENT_SOFT,
            border: `1px solid ${ACCENT_BORDER_LT}`,
            padding: "8px 13px",
            borderRadius: 8,
            textDecoration: "none",
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: 14, lineHeight: 1 }}>+</span> New design
        </Link>
      </div>

      <div
        className="pkh-rowscroll"
        style={{ display: "flex", gap: 13, padding: "16px 18px", overflowX: "auto" }}
      >
        {cards.map((d) => (
          <div
            key={d.id}
            style={{
              flex: "0 0 268px",
              display: "flex",
              flexDirection: "column",
              background: "#fbfafc",
              border: "1px solid #ececf0",
              borderTop: "3px solid var(--accent)",
              borderRadius: 11,
              overflow: "hidden",
              opacity: pendingId === d.id ? 0.6 : 1,
            }}
          >
            <div style={{ padding: "13px 14px 0" }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                }}
              >
                <span
                  style={{
                    fontSize: 10.5,
                    fontWeight: 600,
                    color: "#5b616e",
                    background: "#fff",
                    border: "1px solid #e8eaee",
                    padding: "2px 8px",
                    borderRadius: 20,
                  }}
                >
                  {d.venue}
                </span>
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 9,
                    fontWeight: 600,
                    letterSpacing: ".07em",
                    color: ACCENT_INK,
                    background: ACCENT_SOFT,
                    border: `1px solid ${ACCENT_BORDER_LT}`,
                    padding: "2px 7px",
                    borderRadius: 5,
                  }}
                >
                  BUDGETARY
                </span>
              </div>
              <div
                style={{
                  fontSize: 13.5,
                  fontWeight: 600,
                  lineHeight: 1.3,
                  marginTop: 11,
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                  minHeight: 35,
                }}
              >
                {d.name}
              </div>
              <div
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 10.5,
                  color: "#aab0bb",
                  marginTop: 4,
                }}
              >
                {d.meta}
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 7, marginTop: 13 }}>
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 20,
                    fontWeight: 600,
                    letterSpacing: "-.01em",
                  }}
                >
                  {d.budget}
                </span>
                <span style={{ fontSize: 11, color: "#9aa0ab" }}>est. · {d.tier}</span>
              </div>
              <div style={{ fontSize: 11, color: "#aab0bb", marginTop: 6 }}>
                {d.systemsLabel} · {d.edited}
              </div>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "13px 14px",
                marginTop: "auto",
              }}
            >
              <Link
                href={d.openHref}
                className="pkh-openbtn"
                style={{
                  fontSize: 12.5,
                  fontWeight: 600,
                  color: "#5b616e",
                  textDecoration: "none",
                  padding: "8px 12px",
                  borderRadius: 8,
                  border: "1px solid #e4e7ec",
                  background: "#fff",
                }}
              >
                Open
              </Link>
              <button
                onClick={() => promote(d.id)}
                disabled={pendingId !== null}
                className="pkh-accbtn"
                style={{
                  flex: 1,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  fontFamily: "var(--font-ui)",
                  fontSize: 12.5,
                  fontWeight: 600,
                  color: "#fff",
                  background: "var(--accent)",
                  border: "none",
                  padding: "9px 12px",
                  borderRadius: 8,
                  cursor: "pointer",
                }}
              >
                Add to Quotes →
              </button>
            </div>
          </div>
        ))}

        <Link
          href="/quick-design"
          className="pkh-newdesign"
          style={{
            flex: "0 0 188px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            background: "transparent",
            border: "1.5px dashed #d6d9e0",
            borderRadius: 11,
            textDecoration: "none",
            color: "#9aa0ab",
            minHeight: 175,
          }}
        >
          <span
            style={{
              width: 34,
              height: 34,
              borderRadius: 9,
              background: "#f1f2f5",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 19,
              lineHeight: 1,
            }}
          >
            +
          </span>
          <span style={{ fontSize: 13, fontWeight: 600 }}>New design</span>
          <span
            style={{ fontSize: 11, textAlign: "center", lineHeight: 1.4, maxWidth: 140 }}
          >
            Build &amp; price freely
            <br />
            in the sandbox
          </span>
        </Link>
      </div>

      {promoted && (
        <div
          style={{
            position: "fixed",
            left: "50%",
            bottom: 20,
            transform: "translateX(-50%)",
            zIndex: 80,
            display: "flex",
            alignItems: "center",
            gap: 13,
            background: "#16181d",
            color: "#fff",
            borderRadius: 12,
            padding: "13px 16px",
            boxShadow: "0 12px 40px rgba(0,0,0,.3)",
            maxWidth: "92vw",
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
          <span style={{ fontSize: 13, lineHeight: 1.4 }}>
            Added to Quotes as{" "}
            <b style={{ fontFamily: "var(--font-mono)" }}>{promoted}</b> — flagged for
            requote
          </span>
          <Link
            href={`/estimator?id=${encodeURIComponent(promoted)}`}
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "#fff",
              textDecoration: "underline",
              whiteSpace: "nowrap",
            }}
          >
            Requote now
          </Link>
          <button
            onClick={() => setPromoted(null)}
            style={{
              width: 24,
              height: 24,
              border: "none",
              background: "#2b2e35",
              borderRadius: 6,
              color: "#cfd3da",
              fontSize: 14,
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}
