"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { removeQuoteAction, setQuoteStatusAction } from "./home-actions";

/**
 * Stage sheet — port of Home.dc.html's quote sheet (open a pipeline row →
 * move it through Draft/Sent/Won/Lost, jump to the Estimator, or delete).
 * Open/close state lives in the URL (?sheet=Q-####); mutations are server
 * actions followed by router.refresh().
 */

export type SheetQuote = {
  id: string;
  name: string;
  meta: string;
  value: string;
  marginLabel: string;
  status: string;
};

const STATUS_META: Record<string, { ink: string; soft: string }> = {
  draft: { ink: "#8a6d1f", soft: "#fbf3dd" },
  sent: { ink: "#3155a8", soft: "#e9eefb" },
  won: { ink: "#1f7a52", soft: "#eaf6ef" },
  lost: { ink: "#8c919c", soft: "#f1f2f5" },
};

const STAGE_DEFS: Array<[string, string]> = [
  ["draft", "Draft"],
  ["sent", "Sent"],
  ["won", "Won"],
  ["lost", "Lost"],
];

export default function HomeStageSheet({
  quote,
  closeHref,
}: {
  quote: SheetQuote;
  closeHref: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const close = () => router.replace(closeHref, { scroll: false });

  const move = (status: string) =>
    startTransition(async () => {
      await setQuoteStatusAction(quote.id, status);
      router.replace(closeHref, { scroll: false });
      router.refresh();
    });

  const del = () =>
    startTransition(async () => {
      await removeQuoteAction(quote.id);
      router.replace(closeHref, { scroll: false });
      router.refresh();
    });

  return (
    <div
      className="pkh-sheetwrap"
      onClick={close}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(16,18,22,.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 60,
        padding: 24,
      }}
    >
      <div
        className="pkh-sheet"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 430,
          maxWidth: "100%",
          background: "#fff",
          borderRadius: 16,
          boxShadow: "0 24px 70px rgba(0,0,0,.34)",
          overflow: "hidden",
          opacity: pending ? 0.7 : 1,
        }}
      >
        <div style={{ padding: "18px 20px 14px", borderBottom: "1px solid #f0f1f4" }}>
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: 12,
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.3 }}>{quote.name}</div>
              <div
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  color: "#aab0bb",
                  marginTop: 3,
                }}
              >
                {quote.meta}
              </div>
            </div>
            <button
              onClick={close}
              className="pkh-closebtn"
              style={{
                width: 30,
                height: 30,
                border: "none",
                background: "#f1f2f5",
                borderRadius: 8,
                color: "#5b616e",
                fontSize: 17,
                cursor: "pointer",
                flexShrink: 0,
              }}
            >
              ×
            </button>
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 12 }}>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 22, fontWeight: 600 }}>
              {quote.value}
            </span>
            <span style={{ fontSize: 12, color: "#9aa0ab" }}>{quote.marginLabel}</span>
          </div>
        </div>

        <div style={{ padding: "16px 20px" }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: "#9aa0ab",
              letterSpacing: ".05em",
              textTransform: "uppercase",
              marginBottom: 10,
            }}
          >
            Move to stage
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {STAGE_DEFS.map(([key, label]) => {
              const current = quote.status === key;
              const m = STATUS_META[key];
              return (
                <button
                  key={key}
                  onClick={() => move(key)}
                  disabled={pending}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontFamily: "var(--font-ui)",
                    fontSize: 13,
                    fontWeight: 600,
                    padding: "13px 10px",
                    borderRadius: 10,
                    cursor: "pointer",
                    border: `1.5px solid ${current ? m.ink : "#e4e7ec"}`,
                    background: current ? m.soft : "#fff",
                    color: current ? m.ink : "#5b616e",
                  }}
                >
                  {label}
                  {current && <span style={{ marginLeft: 6, fontSize: 11 }}>✓</span>}
                </button>
              );
            })}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "14px 20px",
            borderTop: "1px solid #f0f1f4",
            background: "#fbfbfc",
          }}
        >
          <Link
            href={`/estimator?id=${encodeURIComponent(quote.id)}`}
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 7,
              fontSize: 13,
              fontWeight: 600,
              color: "#fff",
              background: "var(--accent)",
              padding: "11px 14px",
              borderRadius: 9,
              textDecoration: "none",
            }}
          >
            Open in Estimator →
          </Link>
          <button
            onClick={del}
            disabled={pending}
            title="Delete quote"
            className="pkh-delbtn"
            style={{
              fontSize: 12.5,
              fontWeight: 600,
              color: "#b4543a",
              background: "#f9ece8",
              border: "1px solid #f0d6cd",
              borderRadius: 9,
              padding: "11px 15px",
              cursor: "pointer",
              fontFamily: "var(--font-ui)",
            }}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
