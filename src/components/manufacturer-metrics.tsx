import type { CSSProperties, ReactNode } from "react";
import { money } from "@/lib/format";
import type { MoneyPair } from "@/lib/manufacturer-analytics";

/**
 * Presentational tiles shared by the manufacturer page (server) and the
 * vendor overview card (client) — no hooks, no data access. Cost is the large
 * figure; sell sits beneath it, smaller.
 */

const tile: CSSProperties = { flex: "1 1 130px", minWidth: 130, border: "1px solid #ececf0", borderRadius: 10, padding: "10px 12px", background: "#fff" };
const tileLabel: CSSProperties = { fontSize: 10, fontWeight: 600, color: "#9aa0ab", textTransform: "uppercase", letterSpacing: ".05em" };
const tileSub: CSSProperties = { fontSize: 11, color: "#8c919c", marginTop: 2 };

export const pctText = (r: number | null): string => (r === null ? "—" : `${Math.round(r * 100)}%`);

export function TileRow({ children }: { children: ReactNode }) {
  return <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>{children}</div>;
}

export function MoneyTile({ label, value, caption, emphasis }: { label: string; value: MoneyPair; caption?: string; emphasis?: boolean }) {
  return (
    <div style={{ ...tile, ...(emphasis ? { borderColor: "color-mix(in srgb, var(--accent) 35%, #fff)", background: "color-mix(in srgb, var(--accent) 5%, #fff)" } : null) }}>
      <div style={tileLabel}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-.01em", marginTop: 3 }}>{money(value.cost)}</div>
      <div style={{ fontSize: 11.5, color: "#8c919c", marginTop: 1 }}>sell {money(value.sell)}</div>
      {caption && <div style={tileSub}>{caption}</div>}
    </div>
  );
}

export function RateTile({ label, rate, caption, shopRate }: { label: string; rate: number | null; caption?: string; shopRate?: boolean }) {
  return (
    <div style={tile}>
      <div style={tileLabel}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-.01em", marginTop: 3 }}>
        {pctText(rate)}
        {shopRate && rate !== null && <span style={{ fontSize: 11.5, fontWeight: 500, color: "#8c919c", marginLeft: 6 }}>(shop rate)</span>}
      </div>
      {caption && <div style={tileSub}>{caption}</div>}
    </div>
  );
}
