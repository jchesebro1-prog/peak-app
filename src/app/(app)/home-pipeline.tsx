import Link from "next/link";
import { money } from "@/lib/format";
import { timeAgo as quoteTimeAgo, type Quote, type QuoteStatus } from "@/lib/stores/quotes";
import { StatusPill, QUOTE_STATUS_TONE } from "@/components/ui";
import { CardHeadTitle } from "./home-shared";

/**
 * My pipeline card — the filter strip + quote rows, port of Home.dc.html's
 * pipeline widget. `pipeHref`/`sheetHref` are recomputed here from the
 * `pipe` prop (mirroring the identical helpers still kept in page.tsx for
 * building the Needs-attention alerts) rather than crossing as functions.
 */

const ACCENT_SOFT = "var(--accent-soft)";
const ACCENT_INK = "color-mix(in srgb, var(--accent) 70%, #000)";

type QuoteX = Quote & { requote?: boolean };

/** Quote status pill colors (Home.dc.html statusMeta). Sole consumer: this card. */
export const STATUS_META: Record<
  QuoteStatus,
  { label: string; ink: string; soft: string; bd: string }
> = {
  draft: { label: "Draft", ink: "#8a6d1f", soft: "#fbf3dd", bd: "#f0e2bd" },
  sent: { label: "Sent", ink: "#3155a8", soft: "#e9eefb", bd: "#d4ddf3" },
  won: { label: "Won", ink: "#1f7a52", soft: "#eaf6ef", bd: "#cce9da" },
  lost: { label: "Lost", ink: "#8c919c", soft: "#f1f2f5", bd: "#e4e7ec" },
};

export default function HomePipeline({
  pipe,
  filterDefs,
  pipeCounts,
  filteredQuotes,
}: {
  pipe: "all" | QuoteStatus;
  filterDefs: Array<["all" | QuoteStatus, string]>;
  pipeCounts: Record<"all" | QuoteStatus, number>;
  filteredQuotes: QuoteX[];
}) {
  const pipeHref = (key: "all" | QuoteStatus) => (key === "all" ? "/" : `/?pipe=${key}`);
  const sheetHref = (id: string) =>
    pipe === "all"
      ? `/?sheet=${encodeURIComponent(id)}`
      : `/?pipe=${pipe}&sheet=${encodeURIComponent(id)}`;

  return (
    <div className="pk-card" style={{ overflow: "hidden" }}>
      <div
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
        <CardHeadTitle>My pipeline</CardHeadTitle>
        <div
          className="pkh-rowscroll"
          style={{
            display: "flex",
            background: "#f1f2f5",
            borderRadius: 8,
            padding: 2,
            maxWidth: "100%",
            overflowX: "auto",
          }}
        >
          {filterDefs.map(([key, label]) => {
            const active = pipe === key;
            return (
              <Link
                key={key}
                href={pipeHref(key)}
                scroll={false}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 12,
                  fontWeight: active ? 600 : 500,
                  padding: "5px 11px",
                  borderRadius: 6,
                  whiteSpace: "nowrap",
                  textDecoration: "none",
                  background: active ? "#fff" : "transparent",
                  color: active ? "#16181d" : "#9aa0ab",
                  boxShadow: active ? "0 1px 2px rgba(0,0,0,.1)" : undefined,
                }}
              >
                {label}
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 10,
                    fontWeight: 600,
                    color: active ? ACCENT_INK : "#aab0bb",
                    background: active ? ACCENT_SOFT : "#e9ebef",
                    padding: "0 5px",
                    borderRadius: 10,
                  }}
                >
                  {pipeCounts[key]}
                </span>
              </Link>
            );
          })}
        </div>
      </div>

      {filteredQuotes.map((q) => {
        const m = STATUS_META[q.status] || STATUS_META.draft;
        const meta = `${q.id} · ${q.customer || "—"} · ${quoteTimeAgo(q.updatedAt)}${
          q.requote ? " · needs requote" : ""
        }`;
        return (
          <Link
            key={q.id}
            href={sheetHref(q.id)}
            scroll={false}
            className="pkh-hover"
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "14px 18px",
              borderBottom: "1px solid #f5f6f8",
              textDecoration: "none",
              color: "inherit",
              textAlign: "left",
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 13.5,
                  fontWeight: 600,
                  lineHeight: 1.3,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  color: "#16181d",
                }}
              >
                {q.name}
              </div>
              <div
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 10.5,
                  color: "#aab0bb",
                  marginTop: 3,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {meta}
              </div>
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-end",
                gap: 5,
                flexShrink: 0,
              }}
            >
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 13,
                  fontWeight: 600,
                  color: "#16181d",
                }}
              >
                {money(q.value)}
              </span>
              <StatusPill tone={QUOTE_STATUS_TONE[q.status] || "gray"} minWidth={64}>
                {m.label}
              </StatusPill>
            </div>
            <span style={{ color: "#c4c9d2", fontSize: 18, flexShrink: 0 }}>›</span>
          </Link>
        );
      })}

      {filteredQuotes.length === 0 && (
        <div
          style={{
            padding: "34px 18px",
            textAlign: "center",
            color: "#9aa0ab",
            fontSize: 13,
            lineHeight: 1.6,
          }}
        >
          No quotes in this stage.
          <br />
          <Link
            href="/design/quick"
            style={{ color: "var(--accent)", fontWeight: 600, textDecoration: "none" }}
          >
            Start a rough estimate →
          </Link>
        </div>
      )}

      <div style={{ padding: "13px 18px" }}>
        <Link
          href="/design/quick"
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "var(--accent)",
            textDecoration: "none",
          }}
        >
          + New rough estimate
        </Link>
      </div>
    </div>
  );
}
