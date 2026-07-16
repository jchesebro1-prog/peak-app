import type { CSSProperties } from "react";
import Link from "next/link";
import { PrintButton } from "./print-button";
// Baked letterhead fallback (shared with the flame/inspection/repair letters).
import letterhead from "@/app/(app)/flame-tests/letter/peak-letterhead.jpg";

/**
 * Shared single-page letter renderer (IDEAS — centralized templates, wiring).
 *
 * One reusable layout for the family of one-page documents that follow the
 * same scheme as the inspection/flame proposal letters: letterhead + accent
 * hairline, a header band (title + eyebrow + optional status chip + a meta
 * grid), an optional parties row, accent-underlined body sections, an
 * optional term-definition strip, and a prepared-by footer. Prose comes from
 * the Templates store (resolved by the calling page); this component only
 * lays it out. Prints on the same .pk-doc-page foundation.
 */

const SANS = "var(--font-ui), system-ui, sans-serif";
const MONO = "var(--font-mono), ui-monospace, monospace";

export type LetterMetaRow = { label: string; value: string };
export type LetterSection = {
  heading?: string;
  /** Paragraphs (already resolved). Blank entries are skipped. */
  paragraphs: string[];
};
export type LetterTerm = { term: string; desc: string };
export type LetterParty = { label: string; name: string; lines?: string[] };

const ctrlLabel: CSSProperties = {
  fontFamily: MONO,
  fontSize: "7pt",
  letterSpacing: ".1em",
  textTransform: "uppercase",
  color: "#9aa0ab",
};

export function SinglePageLetter({
  accent,
  companyName,
  logoDark,
  eyebrow,
  title,
  subtitle,
  statusLabel,
  meta,
  parties,
  sections,
  terms,
  footer,
  backHref,
  backLabel = "← Back",
}: {
  accent: string;
  companyName: string;
  logoDark?: string | null;
  /** Small category line above the title (e.g. "RIGGING INSPECTION · OSHA / ANSI E1"). */
  eyebrow?: string;
  title: string;
  subtitle?: string;
  /** Optional status chip (e.g. overall condition). */
  statusLabel?: string;
  meta: LetterMetaRow[];
  /** Optional "prepared for / prepared by" row. */
  parties?: [LetterParty, LetterParty];
  sections: LetterSection[];
  /** Optional term-definition strip (e.g. Urgent / Necessary / Basic). */
  terms?: { heading?: string; items: LetterTerm[] };
  /** Prepared-by footer line. */
  footer: string;
  backHref: string;
  backLabel?: string;
}) {
  const accentInk = `color-mix(in srgb, ${accent} 72%, #000)`;
  const metaBorder = "1px solid #e4e7ec";

  return (
    <div style={{ minHeight: "100vh", fontFamily: SANS, color: "#111" }}>
      {/* print-hidden toolbar */}
      <div
        className="pk-doc-toolbar pk-no-print"
        style={{ padding: "18px 16px 0" }}
      >
        <Link
          href={backHref}
          style={{
            fontSize: 12.5,
            fontWeight: 600,
            color: "#8c919c",
            textDecoration: "none",
            marginRight: "auto",
          }}
        >
          {backLabel}
        </Link>
        <PrintButton accent={accent} />
      </div>

      <div style={{ padding: "8px 16px 60px" }}>
        <div className="pk-doc-page">
          <div style={{ fontFamily: SANS, fontSize: "11pt", lineHeight: 1.5, color: "#111" }}>
            {/* letterhead + accent hairline */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={logoDark || letterhead.src}
              alt={companyName}
              style={
                logoDark
                  ? { display: "block", maxHeight: 64, maxWidth: "100%", objectFit: "contain" }
                  : { display: "block", width: "100%", height: "auto" }
              }
            />
            <div style={{ height: 1, background: accent, marginTop: 12, marginBottom: 18 }} />

            {/* header band: title/eyebrow (+ status) | meta grid */}
            <div style={{ display: "flex", border: "1px solid #cfcfcf" }}>
              <div
                style={{
                  flex: "0 0 56%",
                  padding: 16,
                  display: "flex",
                  flexDirection: "column",
                  gap: 14,
                  borderRight: "1px solid #cfcfcf",
                }}
              >
                <div>
                  {eyebrow && (
                    <div
                      style={{
                        fontFamily: MONO,
                        fontSize: "7.5pt",
                        letterSpacing: ".1em",
                        textTransform: "uppercase",
                        color: accentInk,
                        marginBottom: 7,
                      }}
                    >
                      {eyebrow}
                    </div>
                  )}
                  <div style={{ fontSize: "22pt", fontWeight: 600, letterSpacing: "-.01em", lineHeight: 1.06 }}>
                    {title}
                  </div>
                  {subtitle && (
                    <div
                      style={{
                        fontFamily: MONO,
                        fontSize: "8pt",
                        letterSpacing: ".1em",
                        textTransform: "uppercase",
                        color: "#8c919c",
                        marginTop: 7,
                      }}
                    >
                      {subtitle}
                    </div>
                  )}
                </div>
                {statusLabel && (
                  <div style={{ marginTop: "auto" }}>
                    <span
                      style={{
                        display: "inline-block",
                        fontFamily: MONO,
                        fontSize: "8.5pt",
                        fontWeight: 600,
                        letterSpacing: ".06em",
                        textTransform: "uppercase",
                        color: accentInk,
                        border: `1px solid ${accent}`,
                        borderRadius: 6,
                        padding: "4px 10px",
                      }}
                    >
                      {statusLabel}
                    </span>
                  </div>
                )}
              </div>
              <div style={{ flex: "1 1 44%", display: "grid", gridTemplateColumns: "1fr 1fr", alignContent: "start" }}>
                {meta.slice(0, 8).map((f, i, arr) => (
                  <div
                    key={f.label + i}
                    style={{
                      padding: "9px 12px",
                      borderBottom: i < arr.length - 2 ? metaBorder : "none",
                      borderLeft: i % 2 ? metaBorder : "none",
                    }}
                  >
                    <div style={{ ...ctrlLabel, marginBottom: 3 }}>{f.label}</div>
                    <div style={{ fontFamily: MONO, fontSize: "9.5pt", color: "#111" }}>{f.value || "—"}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* parties row */}
            {parties && (
              <div style={{ display: "flex", border: "1px solid #cfcfcf", borderTop: "none" }}>
                {parties.map((p, i) => (
                  <div
                    key={p.label}
                    style={{
                      flex: "1 1 50%",
                      padding: "13px 16px",
                      borderRight: i === 0 ? "1px solid #cfcfcf" : "none",
                    }}
                  >
                    <div style={ctrlLabel}>{p.label}</div>
                    <div style={{ fontWeight: 600, marginTop: 5 }}>{p.name}</div>
                    {(p.lines || []).filter(Boolean).map((l, j) => (
                      <div key={j} style={{ color: "#5b616e", fontSize: "9.5pt", marginTop: 2 }}>
                        {l}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}

            {/* body sections */}
            <div style={{ marginTop: 24 }}>
              {sections.map((s, i) => {
                const paras = (s.paragraphs || []).filter((p) => p && p.trim());
                if (!paras.length && !s.heading) return null;
                return (
                  <div key={i} style={{ marginBottom: 18 }}>
                    {s.heading && (
                      <div
                        style={{
                          display: "inline-block",
                          fontSize: "9.5pt",
                          fontWeight: 700,
                          letterSpacing: ".1em",
                          textTransform: "uppercase",
                          color: accentInk,
                          borderBottom: `1px solid ${accent}`,
                          paddingBottom: 3,
                          marginBottom: 9,
                        }}
                      >
                        {s.heading}
                      </div>
                    )}
                    {paras.map((p, j) => (
                      <p key={j} style={{ margin: "0 0 9px", fontSize: "10.5pt", lineHeight: 1.55 }}>
                        {p}
                      </p>
                    ))}
                  </div>
                );
              })}
            </div>

            {/* term-definition strip */}
            {terms && terms.items.length > 0 && (
              <div style={{ border: "1px solid #e4e7ec", borderRadius: 8, padding: "13px 16px", background: "#fafbfc", marginTop: 6 }}>
                {terms.heading && (
                  <div style={{ ...ctrlLabel, color: accentInk, marginBottom: 9 }}>{terms.heading}</div>
                )}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: `repeat(${Math.min(3, terms.items.length)}, 1fr)`,
                    gap: 16,
                  }}
                >
                  {terms.items.map((t, i) => (
                    <div key={i}>
                      <div style={{ fontSize: "9.5pt", fontWeight: 700, marginBottom: 2 }}>{t.term}</div>
                      <div style={{ fontSize: "8.5pt", color: "#40454e", lineHeight: 1.45 }}>{t.desc}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* footer */}
            <div style={{ borderTop: "1px solid #e4e7ec", marginTop: 26, paddingTop: 12, fontSize: "8.5pt", color: "#8c919c", lineHeight: 1.5 }}>
              {footer}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
