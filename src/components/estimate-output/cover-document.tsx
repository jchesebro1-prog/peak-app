import type { CSSProperties } from "react";
import { COVER_LINK_LEAD, type CoverDocumentProps } from "@/lib/estimate-output/cover";

/**
 * #301 slice A — the cover PDF (spec §4): standalone, letterhead + footer,
 * Arial, an underlined centered title, a paragraph and a bold price line per
 * scope, the summary, the total, add options, Not included, the link line and
 * the signature block. A server component with pure props (no hooks, no
 * handlers, no image import — the print page passes the letterhead src), so
 * the harness renders it in Node. Printed by /print/cover/[id].
 *
 * The footer repeats on every page: a fixed-position footer over a repeating
 * <tfoot> spacer of the same height (Chrome repeats both when printing).
 */

export const COVER_PRINT_CSS = `
@page { size: letter; margin: 0.75in 0.75in 0.5in; }
html, body { background: #fff !important; margin: 0; height: auto !important; }
nextjs-portal { display: none !important; }
.cov { font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 10.5pt; line-height: 1.45; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.cov-page { width: 100%; border-collapse: collapse; }
.cov-page td { padding: 0; vertical-align: top; }
.cov-foot-space { height: 0.45in; }
.cov-foot { position: fixed; left: 0; right: 0; bottom: 0; height: 0.35in; box-sizing: border-box; padding-top: 5pt; border-top: 1px solid #bbb; text-align: center; font-size: 8pt; color: #555; background: #fff; }
.cov-scope, .cov-totals, .cov-opt, .cov-sig { break-inside: avoid; page-break-inside: avoid; }
@media screen { .cov { max-width: 7in; margin: 24px auto; } .cov-foot { position: static; margin-top: 24px; } .cov-foot-space { display: none; } }
`;

const row: CSSProperties = { display: "flex", justifyContent: "space-between", gap: 12 };
const label: CSSProperties = { color: "#555", width: 90, flexShrink: 0 };

export default function CoverDocument(p: CoverDocumentProps) {
  const project: Array<[string, string]> = [
    ["Customer", p.project.customer],
    ["Attn", p.project.attn],
    ["Venue", p.project.venue],
    ["Project", p.project.project],
    ["Estimate", p.project.number],
    ["Date", p.project.date],
  ].filter(([, v]) => !!(v || "").trim()) as Array<[string, string]>;
  return (
    <div className="cov">
      <table className="cov-page" role="presentation">
        <tbody>
          <tr>
            <td>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={p.letterhead.src}
                alt={p.companyName}
                style={p.letterhead.full ? { display: "block", width: "100%", height: "auto" } : { display: "block", maxHeight: 70, maxWidth: "100%", objectFit: "contain" }}
              />
              <h1 style={{ textAlign: "center", textDecoration: "underline", fontSize: "15pt", fontWeight: 700, margin: "18pt 0 12pt" }}>{p.title}</h1>

              <div style={{ marginBottom: "14pt" }}>
                {project.map(([k, v]) => (
                  <div key={k} style={{ display: "flex", gap: 8 }}>
                    <span style={label}>{k}</span>
                    <span>{v}</span>
                  </div>
                ))}
              </div>

              {p.scopes.map((s) => (
                <div key={s.id} className="cov-scope" style={{ marginBottom: "10pt" }}>
                  <p style={{ margin: 0, whiteSpace: "pre-line", ...(s.missing ? { color: "#888", fontStyle: "italic" } : {}) }}>{s.text}</p>
                  <div style={{ textAlign: "right", fontWeight: 700, marginTop: "3pt" }}>{s.priceLabel}</div>
                </div>
              ))}

              {p.summary && <p style={{ margin: "12pt 0", whiteSpace: "pre-line" }}>{p.summary}</p>}

              <div className="cov-totals" style={{ borderTop: "1px solid #111", paddingTop: "6pt", marginTop: "6pt" }}>
                {p.totals.creditLabel && (
                  <div style={row}>
                    <span>{p.totals.creditLabel}</span>
                    <span>{p.totals.creditAmount}</span>
                  </div>
                )}
                <div style={{ ...row, fontWeight: 700, fontSize: "12pt" }}>
                  <span>{p.totals.totalLabel}</span>
                  <span>{p.totals.total}</span>
                </div>
                {p.totals.rewardsLine && <div style={{ textAlign: "right", fontSize: "9pt", color: "#333" }}>{p.totals.rewardsLine}</div>}
                {p.totals.standingLines.map((l) => (
                  <div key={l} style={{ textAlign: "right", fontSize: "9pt", color: "#333" }}>
                    {l}
                  </div>
                ))}
              </div>

              {p.options.length > 0 && (
                <div style={{ marginTop: "12pt" }}>
                  {p.options.map((o) => (
                    <div key={o.label} className="cov-opt" style={{ marginBottom: "6pt" }}>
                      <div style={row}>
                        <span>
                          <strong>{o.label}</strong> — {o.desc}
                        </span>
                        <strong>{o.price}</strong>
                      </div>
                      {o.reason && <div style={{ color: "#333", fontSize: "9.5pt" }}>{o.reason}</div>}
                    </div>
                  ))}
                </div>
              )}

              {p.notIncluded && <p style={{ margin: "12pt 0 0" }}>{p.notIncluded}</p>}

              {p.shareUrl && (
                <p style={{ margin: "12pt 0 0" }}>
                  {COVER_LINK_LEAD} <span style={{ wordBreak: "break-all" }}>{p.shareUrl}</span>
                </p>
              )}

              <div className="cov-sig" style={{ display: "flex", justifyContent: "space-between", gap: 24, marginTop: "22pt" }}>
                <div>
                  {p.signer ? (
                    <>
                      <div style={{ fontWeight: 700 }}>{p.signer.name}</div>
                      {p.signer.title && <div>{p.signer.title}</div>}
                      <div>{p.companyName}</div>
                      {p.signer.phone && <div>{p.signer.phone}</div>}
                      {p.signer.email && <div>{p.signer.email}</div>}
                    </>
                  ) : (
                    <div style={{ fontWeight: 700 }}>{p.companyName}</div>
                  )}
                </div>
                <div style={{ minWidth: "2.8in" }}>
                  <div style={{ borderBottom: "1px solid #111", height: "22pt" }} />
                  <div style={{ fontSize: "9pt", color: "#333" }}>Accepted by (name, title)</div>
                  <div style={{ borderBottom: "1px solid #111", height: "22pt" }} />
                  <div style={{ fontSize: "9pt", color: "#333" }}>Date</div>
                </div>
              </div>
            </td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <td>
              <div className="cov-foot-space" />
            </td>
          </tr>
        </tfoot>
      </table>
      <div className="cov-foot">{p.footerLine}</div>
    </div>
  );
}
