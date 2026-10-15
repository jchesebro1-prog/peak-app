import type { CSSProperties } from "react";
import { VENDOR_COPY } from "@/lib/vendor-quotes/rules";
import type { VendorCardGroup } from "@/lib/vendor-quotes/vm";
import { money, shortDate, timeAgo } from "@/lib/format";

const ROW: CSSProperties = { display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "2px 10px", fontSize: 12, color: "#3a3f4a", lineHeight: 1.45, padding: "3px 0" };
const MUTED: CSSProperties = { color: "#7a808c" };
const LINK: CSSProperties = { color: "var(--accent)", fontWeight: 600, textDecoration: "none" };
const CHIP: CSSProperties = { fontSize: 10.5, fontWeight: 600, borderRadius: 20, padding: "2px 8px", background: "#f1f2f5", color: "#5b616e", whiteSpace: "nowrap" };
const DOT: CSSProperties = { width: 7, height: 7, borderRadius: "50%", background: "var(--accent)", display: "inline-block", flexShrink: 0, alignSelf: "center" };

/**
 * #348 slice 4 — vendors grouped by company: their quotes on the estimate and the emails filed to it. Presentational.
 * Links open in a new tab so leaving the Estimator never drops unsaved edits. Dates render in the viewer's timezone when
 * used client-side and in server UTC when server-rendered.
 */
export function VendorGroupsList({ groups, emptyText }: { groups: VendorCardGroup[]; emptyText: string }) {
  if (!groups.length) return <div style={{ fontSize: 11.5, color: "#aab0bb" }}>{emptyText}</div>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {groups.map((g) => (
        <div key={g.key}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 12.5, fontWeight: 600, color: "#16181d" }}>
            {g.href ? (
              <a href={g.href} target="_blank" rel="noopener noreferrer" style={LINK}>
                {g.name}
              </a>
            ) : (
              <span>{g.name}</span>
            )}
            {g.companyId === null && <span style={CHIP}>{VENDOR_COPY.unlinked}</span>}
          </div>
          {g.quotes.map((q) => (
            <div key={q.id} style={ROW}>
              <span style={{ fontFamily: "var(--font-mono)" }}>{q.quoteNumber || "—"}</span>
              <span>{q.description}</span>
              <span style={{ fontWeight: 600 }}>{money(q.total, { cents: true })}</span>
              {q.addedAt != null && <span style={MUTED}>{shortDate(q.addedAt)}</span>}
              {q.hasFile && (
                <span role="img" aria-label="File attached" title="File attached">
                  📎
                </span>
              )}
              {q.fromThreadId && (
                <a href={`/inbox?thread=${encodeURIComponent(q.fromThreadId)}`} target="_blank" rel="noopener noreferrer" style={LINK}>
                  {VENDOR_COPY.fromEmail}
                </a>
              )}
            </div>
          ))}
          {g.threads.map((t) => (
            <div key={t.id} style={ROW}>
              {t.unread && <span style={DOT} role="img" aria-label="Unread" title="Unread" />}
              <a href={t.href} target="_blank" rel="noopener noreferrer" style={LINK}>
                {t.subject || "(no subject)"}
              </a>
              <span style={MUTED}>{t.lastFrom}</span>
              <span style={MUTED}>{timeAgo(t.lastAt)}</span>
            </div>
          ))}
          {!g.quotes.length && !g.threads.length && <div style={{ ...ROW, ...MUTED }}>{VENDOR_COPY.noneYet}</div>}
        </div>
      ))}
    </div>
  );
}
