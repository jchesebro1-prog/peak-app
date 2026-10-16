import Link from "next/link";
import type { CSSProperties } from "react";
import { PORTAL_BID_COPY } from "@/lib/parties/portal-bid";
import type { OwnerBom } from "@/lib/parties/portal-owner-bom";
import type { PackageBomRow } from "@/lib/estimate-output/bom";
import { PACKAGE_COPY } from "@/lib/quote-share/package-view";
import { ONLINE_COPY } from "@/lib/quote-share/view";

/**
 * #348 slice 6 Task 3 (Jeff 2026-10-15) — the owner's portal on a bid estimate: "just a BOM without a price on
 * anything". A server component over `OwnerBom` (portalOwnerBom → the pure ownerBom, rows from the #301 package BOM's
 * packageBomRows — PackageBomRow carries no money field). The header (name, number, Rev, sent date, "Prepared for"),
 * one muted line, then one block per printed system: Qty · Manufacturer · Model · Description. No totals, prices,
 * options, alternates, Rewards line, Accept, download link, cut sheets or datasheets — and no client component.
 */

const plainLink: CSSProperties = { fontSize: 13, fontWeight: 600, color: "var(--accent)", textDecoration: "none" };
const card: CSSProperties = { background: "#fff", border: "1px solid #e4e7ec", borderRadius: 12, padding: "16px 18px", marginBottom: 14 };
const th: CSSProperties = {
  whiteSpace: "nowrap",
  textAlign: "left",
  fontSize: 11,
  fontWeight: 700,
  color: "#5b616e",
  textTransform: "uppercase",
  letterSpacing: ".04em",
  borderBottom: "1px solid #e4e7ec",
  padding: "6px 8px",
};
const td: CSSProperties = { borderBottom: "1px solid #f0f1f4", padding: "6px 8px", verticalAlign: "top", overflowWrap: "break-word", fontSize: 13 };

const qtyText = (r: PackageBomRow) => (r.qty == null ? "" : `${r.qty}${r.unit ? " " + r.unit : ""}`);

export function BomView({ bom, closed, backHref }: { bom: OwnerBom; closed: boolean; backHref: string | null }) {
  const showQty = bom.showQty;
  const head = PACKAGE_COPY.bomHead.filter((_, i) => showQty || i > 0);
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", marginBottom: 14 }}>
        {backHref && (
          <Link href={backHref} prefetch={false} style={plainLink}>
            ← Back
          </Link>
        )}
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "#5b616e" }}>{bom.headerLine}</span>
      </div>
      {closed && (
        <div role="status" style={{ marginBottom: 14, padding: "11px 16px", background: "#fbf3dd", border: "1px solid #f0e2bd", borderRadius: 10, fontSize: 13, fontWeight: 600, color: "#8a6d1f" }}>
          {ONLINE_COPY.closed}
        </div>
      )}
      <div style={card}>
        <h1 style={{ fontSize: 18, fontWeight: 600, margin: 0, overflowWrap: "anywhere" }}>{bom.title}</h1>
        {bom.preparedFor && <div style={{ fontSize: 13, color: "#5b616e", marginTop: 4 }}>Prepared for {bom.preparedFor}</div>}
        <div style={{ fontSize: 12.5, color: "#8c919c", marginTop: 8 }}>{PORTAL_BID_COPY.ownerBomNote}</div>
      </div>
      {bom.systems.map((s) => (
        <section key={s.id} style={card}>
          <h2 style={{ fontSize: 14.5, fontWeight: 600, margin: "0 0 8px" }}>{s.name}</h2>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {head.map((h) => (
                    <th key={h} style={th}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {s.rows.map((r) => (
                  <tr key={r.key}>
                    {showQty && <td style={{ ...td, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{qtyText(r)}</td>}
                    <td style={td}>{r.manufacturer}</td>
                    <td style={td}>{r.part}</td>
                    <td style={td}>{r.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
