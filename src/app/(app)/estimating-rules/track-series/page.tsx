import Link from "next/link";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/team";
import { getMany } from "@/lib/stores/catalog";
import { listTrackSeries } from "@/lib/stores/track-series";
import TrackSeriesClient, { type PartInfo } from "./track-series-client";

export const metadata = { title: "Track series — Estimating Rules — Quartzite-6" };
export const dynamic = "force-dynamic";

/**
 * Estimating Rules → Track series (#274 §1): the parts map behind the track
 * configurator. Admin-only (manage_users), like the rest of Estimating Rules.
 * Read-only on load — reads the series blob and ONLY the catalog SKUs the
 * series reference (one getMany), so each mapped part shows its live
 * description and cost, and a SKU that has left the catalog shows as missing.
 */
export default async function TrackSeriesPage() {
  const user = await requireUser();
  const back = (
    <Link href="/estimating-rules" style={{ fontSize: 12.5, color: "#8c919c", textDecoration: "none" }}>
      ← Estimating rules
    </Link>
  );
  if (!can("manage_users", user.roles)) {
    return (
      <div className="pk-content" style={{ maxWidth: 960 }}>
        {back}
        <div style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-0.015em", margin: "6px 0 20px" }}>Track series</div>
        <div className="pk-card" style={{ padding: "48px 24px", textAlign: "center" }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>Admin access required</div>
          <div style={{ fontSize: 13, color: "#9aa0ab", marginTop: 6, lineHeight: 1.55 }}>
            Track series decide which catalog parts price a track, so editing them is limited to admins.
          </div>
        </div>
      </div>
    );
  }

  const series = await listTrackSeries();
  const skus = [...new Set(series.flatMap((s) => Object.values(s.parts).map((p) => p!.sku)))];
  const parts: Record<string, PartInfo> = {};
  for (const p of skus.length ? await getMany(skus) : []) {
    parts[p.sku] = { desc: p.desc, cost: p.cost || 0, unit: p.unit || "ea", mfr: p.mfr || "" };
  }

  return (
    <div className="pk-content" style={{ maxWidth: 1000 }}>
      {back}
      <div style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 6 }}>
        <div style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-0.015em" }}>Track series</div>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: ".06em",
            color: "#8a6d1f",
            background: "#fbf3dd",
            border: "1px solid #f0e2bd",
            padding: "3px 9px",
            borderRadius: 6,
          }}
        >
          ADMIN
        </span>
      </div>
      <div style={{ fontSize: 13.5, color: "#8c919c", margin: "4px 0 18px", lineHeight: 1.5 }}>
        The catalog part for each piece of a track system. The track configurator works out the quantities; every price
        comes from these parts in the live catalog.
      </div>
      <TrackSeriesClient series={series} parts={parts} />
    </div>
  );
}
