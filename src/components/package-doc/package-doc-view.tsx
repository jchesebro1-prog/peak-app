import { Fragment, type CSSProperties, type ReactNode } from "react";
import { resolvePackageDoc, type PackageDocCtx, type RBlock, type RInline, type RList, type RParagraph, type RPriceTable, type RProduct, type ResolvedPackageDoc } from "@/lib/package-doc/resolve";
import type { PackageDoc } from "@/lib/package-doc/types";

/**
 * Estimator Phase 5 — the package document as the CLIENT reads it: the
 * customer PDF (QuoteDocument → print route), the online / share / portal
 * estimate (layout="web") and the client package page's Narrative view.
 * Server-safe: no "use client", no hooks, no handlers and NO TipTap /
 * ProseMirror import — it draws the resolved document (package-doc/
 * resolve.ts: live values already read, strings only); React escapes every
 * string.
 *
 * Node mapping:
 *   paragraph → <p> (an empty one keeps its line: <br/>)
 *   heading level 1/2/3 → <h2>/<h3>/<h4> (the page's own title is the
 *     document's top level), sized in em against the host's body text
 *   bulletList / orderedList / listItem → <ul> / <ol> / <li>
 *   text → <strong> (bold) / <em> (italic); hardBreak → <br/>
 *   chip → its resolved value as plain text (a missing one prints nothing)
 *   productBlock → bold heading (the line's name, while in the BOM), the
 *     block's own paragraphs, the photo floated left/right at `width` % of
 *     the column, or ("full") block-level above the text, `width` % wide,
 *     centred; phones (≤ 480px) always put it full width above
 *   priceTable → systems · price rows, tax / Rewards credit rows, Total
 *     (t.grand); alternates listed after it as "priced separately"
 *   pageBreak → break-after: page in print, a thin dashed rule on screen
 */

/** Shared page rules: print page breaks, keep-together, phone photos. */
export const PACKAGE_DOC_CSS = `
.pd-doc .pd-product { display: flow-root; break-inside: avoid; page-break-inside: avoid; }
.pd-doc h2, .pd-doc h3, .pd-doc h4 { break-after: avoid; page-break-after: avoid; }
.pd-doc .pd-price tr { break-inside: avoid; page-break-inside: avoid; }
@media print { .pd-doc .pd-pagebreak { border-top: 0 !important; margin: 0 !important; } }
@media (max-width: 480px) {
  .pd-doc .pd-product img { float: none !important; display: block; width: 100% !important; max-height: 3in !important; margin: 0 0 10px 0 !important; }
}
`;

const INK = "#16181d";
const MONO: CSSProperties = { fontFamily: "var(--font-mono)", textAlign: "right", whiteSpace: "nowrap", paddingLeft: 12 };
const HEAD: Record<1 | 2 | 3, CSSProperties> = {
  1: { fontSize: "1.32em", fontWeight: 700, color: INK, margin: "18px 0 8px", lineHeight: 1.25 },
  2: { fontSize: "1.14em", fontWeight: 700, color: INK, margin: "16px 0 6px", lineHeight: 1.3 },
  3: { fontSize: "1em", fontWeight: 700, color: INK, margin: "12px 0 4px", lineHeight: 1.35 },
};

function Inline({ content }: { content: RInline[] }) {
  return (
    <>
      {content.map((n, i) => {
        if (n.t === "br") return <br key={i} />;
        if (n.t === "chip")
          return (
            <span key={i} className="pd-chip">
              {n.text}
            </span>
          );
        let node: ReactNode = n.text;
        if (n.italic) node = <em>{node}</em>;
        if (n.bold) node = <strong>{node}</strong>;
        return <Fragment key={i}>{node}</Fragment>;
      })}
    </>
  );
}

function Paragraph({ p, style }: { p: RParagraph; style?: CSSProperties }) {
  return <p style={{ margin: "0 0 8px", ...style }}>{p.content.length ? <Inline content={p.content} /> : <br />}</p>;
}

function List({ list }: { list: RList }) {
  const style: CSSProperties = { margin: "0 0 8px", paddingLeft: 20, listStyleType: list.t === "ol" ? "decimal" : "disc" };
  const items = list.items.map((kids, i) => (
    <li key={i}>
      {kids.map((c, j) => (c.t === "p" ? <Paragraph key={j} p={c} style={{ margin: 0 }} /> : <List key={j} list={c} />))}
    </li>
  ));
  return list.t === "ol" ? <ol style={style}>{items}</ol> : <ul style={style}>{items}</ul>;
}

function Product({ b, extra }: { b: RProduct; extra?: ReactNode }) {
  const ph = b.photo;
  const imgStyle: CSSProperties | null = !ph
    ? null
    : ph.align === "full"
      ? { display: "block", width: `${ph.width}%`, maxHeight: "4in", objectFit: "contain", margin: "0 auto 10px" }
      : ph.align === "left"
        ? { float: "left", width: `${ph.width}%`, maxHeight: "2.4in", objectFit: "contain", margin: "0 14px 8px 0" }
        : { float: "right", width: `${ph.width}%`, maxHeight: "2.4in", objectFit: "contain", margin: "0 0 8px 14px" };
  return (
    <div className="pd-product" data-sku={b.sku} style={{ display: "flow-root", margin: "12px 0" }}>
      {ph && imgStyle ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={ph.src} alt={ph.alt} style={imgStyle} />
      ) : null}
      {b.heading ? <div style={{ fontWeight: 600, color: INK, marginBottom: 3 }}>{b.heading}</div> : null}
      {b.paras.map((p, i) => (
        <Paragraph key={i} p={p} style={i === b.paras.length - 1 ? { margin: 0 } : undefined} />
      ))}
      {extra}
    </div>
  );
}

function PriceTable({ b }: { b: RPriceTable }) {
  const cell: CSSProperties = { borderBottom: "1px solid #eef0f3", padding: "6px 0" };
  const total: CSSProperties = { padding: "8px 0 4px", fontWeight: 700, color: INK, borderTop: `1.5px solid ${INK}` };
  return (
    <div className="pd-pricewrap" style={{ margin: "10px 0 14px" }}>
      <table className="pd-price" style={{ width: "100%", borderCollapse: "collapse", fontSize: "1em" }}>
        <tbody>
          {[...b.rows, ...b.extra].map((r, i) => (
            <tr key={i}>
              <td style={cell}>{r.name}</td>
              <td style={{ ...cell, ...MONO }}>{r.price}</td>
            </tr>
          ))}
          <tr className="pd-price-total">
            <td style={total}>{b.totalLabel}</td>
            <td style={{ ...total, ...MONO }}>{b.total}</td>
          </tr>
        </tbody>
      </table>
      {b.alternates.length > 0 && (
        <table className="pd-price pd-price-alts" style={{ width: "100%", borderCollapse: "collapse", fontSize: "1em", marginTop: 10 }}>
          <tbody>
            {b.alternates.map((r, i) => (
              <tr key={i}>
                <td style={cell}>
                  {r.name}
                  <span style={{ color: "#8c919c", fontSize: "0.88em" }}> — priced separately</span>
                </td>
                <td style={{ ...cell, ...MONO }}>{r.price}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Block({ b, extra }: { b: RBlock; extra?: Record<string, ReactNode> }) {
  switch (b.t) {
    case "p":
      return <Paragraph p={b} />;
    case "h": {
      const H = b.level === 1 ? "h2" : b.level === 2 ? "h3" : "h4";
      return (
        <H style={HEAD[b.level]}>
          <Inline content={b.content} />
        </H>
      );
    }
    case "ul":
    case "ol":
      return <List list={b} />;
    case "product":
      return <Product b={b} extra={extra && Object.hasOwn(extra, b.sku) ? extra[b.sku] : undefined} />;
    case "price":
      return <PriceTable b={b} />;
    case "pagebreak":
      return <div className="pd-pagebreak" aria-hidden="true" style={{ breakAfter: "page", pageBreakAfter: "always", height: 0, borderTop: "1px dashed #d5d8de", margin: "16px 0" }} />;
    default:
      return null;
  }
}

/** A resolved document (the package page's model carries this). */
export function ResolvedPackageDocView({ resolved, productExtra }: { resolved: ResolvedPackageDoc; productExtra?: Record<string, ReactNode> }) {
  return (
    <div className="pd-doc">
      <style>{PACKAGE_DOC_CSS}</style>
      {resolved.blocks.map((b, i) => (
        <Block key={i} b={b} extra={productExtra} />
      ))}
    </div>
  );
}

/** A sanitized document + the values it reads (QuoteDocument's own props). */
export default function PackageDocView({ doc, ctx }: { doc: PackageDoc; ctx: PackageDocCtx }) {
  return <ResolvedPackageDocView resolved={resolvePackageDoc(doc, ctx)} />;
}
