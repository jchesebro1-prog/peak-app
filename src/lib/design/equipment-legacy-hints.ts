/**
 * The dollars that used to live in quick/engine.ts (#211, D304) — TIER_SKUS,
 * the rigging/controls/audio/video/shell/pit `cost:` literals, the video screen
 * `width × 260`, the scenery-track $3/ft and the curtain seed fabric rates —
 * kept ONLY as "was $X" hints on the Equipment map so Jeff can see what the
 * old equations assumed while he maps each row to a real catalog part.
 * Never read by any total. Server-only: the Equipment map page renders these
 * to strings; no client component imports this module.
 *
 * Rigging had no TIER_SKUS row: its tier figure was the base cost × the old
 * tier cost multiplier (0.8 / 1.0 / 1.3). Curtains priced per sq ft of the
 * old per-tier fabric SKU (goods.ts FABRIC_BY_TYPE_TIER) plus making labor.
 */
import type { TierKey } from "@/app/(app)/design/quick/engine";

if (typeof window !== "undefined") throw new Error("equipment-legacy-hints is server-only");

export type LegacyHint = {
  perTier?: Record<TierKey, number>;
  per?: string;
  note?: string;
  skus?: Partial<Record<TierKey, string>>;
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const T = (good: number, better: number, best: number): Record<TierKey, number> => ({ good, better, best });
/** Rigging: the old base cost × the old tier cost multipliers. */
const mul = (base: number): Record<TierKey, number> => T(round2(base * 0.8), base, round2(base * 1.3));

const VELOUR = { good: "RB-EN-22", better: "RB-CHAR-25", best: "RB-MV-MN" };
const VELOUR_NOTE = "RB-EN-22 / RB-CHAR-25 / RB-MV-MN at $2.84 / $3.64 / $4.37 per sq ft, plus making";

export const LEGACY_HINTS: Record<string, LegacyHint> = {
  "rigging:electricHoist": { perTier: mul(60000) },
  "rigging:lowCapHoist": { perTier: mul(15000) },
  "rigging:highCapHoist": { perTier: mul(40000) },
  "rigging:varSpeedHoist": { perTier: mul(60000) },
  "rigging:riggingPoint": { perTier: mul(20) },
  "rigging:headblock": { perTier: mul(550) },
  "rigging:footblock": { perTier: mul(350) },
  "rigging:arbor": { perTier: mul(700) },
  "rigging:tbarTrack": { perTier: mul(100) },
  "rigging:lockRail": { perTier: mul(30) },
  "rigging:handline": { perTier: mul(3), per: "ft" },
  "rigging:loftblock": { perTier: mul(250) },
  "rigging:pipe": { perTier: mul(8), per: "ft" },
  "rigging:aircraftCable": { perTier: mul(0.02), per: "ft" },
  "rigging:chainWrap": { perTier: mul(1) },
  "rigging:terminationKit": { perTier: mul(1) },
  "curtains:draw": { note: VELOUR_NOTE, skus: VELOUR },
  "curtains:legs": {
    note: "RB-EN-16 / RB-EN-22 / RB-CHAR-25 at $2.10 / $2.84 / $3.64 per sq ft, plus making",
    skus: { good: "RB-EN-16", better: "RB-EN-22", best: "RB-CHAR-25" },
  },
  "curtains:border": { note: VELOUR_NOTE, skus: VELOUR },
  "curtains:fullstage": { note: VELOUR_NOTE, skus: VELOUR },
  "curtains:scenerytrack": { perTier: T(3, 3, 3), per: "ft" },
  "lighting:par": { perTier: T(500, 750, 1150) },
  "lighting:front": { perTier: T(1600, 2250, 3400) },
  "lighting:cyc": { perTier: T(1200, 1750, 2600) },
  "lighting:side": { perTier: T(1250, 1800, 2700) },
  "lighting:automated": { perTier: T(2100, 3000, 4600) },
  "controls:console": { perTier: T(4800, 7000, 10500) },
  "controls:consoleTouch": { perTier: T(1400, 2000, 3000) },
  "controls:batteryBackup": { perTier: T(20, 30, 45) },
  "controls:processor": { perTier: T(7000, 10000, 15000) },
  "controls:button": { perTier: T(180, 250, 380) },
  "controls:archTouch": { perTier: T(1400, 2000, 3000) },
  "controls:inputStation": { perTier: T(70, 100, 150) },
  "controls:outputStation": { perTier: T(90, 125, 190) },
  "controls:distro": { perTier: T(2100, 3000, 4500) },
  "audio:lineArray": { perTier: T(1000, 1450, 2200) },
  "audio:subwoofer": { perTier: T(1300, 1850, 2800) },
  "audio:mixerDsp": { perTier: T(9900, 14200, 21500) },
  "video:projector": { perTier: T(13000, 18500, 28000) },
  "video:screen": { note: "$208 / $260 / $338 per ft of room width" },
  "video:processor": { perTier: T(6800, 9800, 14800) },
  "acoustical:tower": { perTier: T(7000, 10000, 15000) },
  "acoustical:ceiling": { perTier: T(14000, 20000, 30000) },
  "acoustical:transport": { perTier: T(700, 1000, 1500) },
  "pit:legged": { perTier: T(100, 125, 165), per: "sq ft" },
  "pit:clearspan": { perTier: T(120, 150, 200), per: "sq ft" },
};

const money = (n: number) => "$" + n.toLocaleString("en-US", { maximumFractionDigits: 2 });

/** "was $500 / $750 / $1,150" · "was $3 per ft" · "was RB-EN-22 / … plus making". "" for no hint. */
export function legacyHintText(h: LegacyHint | undefined): string {
  if (!h) return "";
  if (h.note) return `was ${h.note}`;
  const t = h.perTier;
  if (!t) return "";
  const figures = t.good === t.better && t.better === t.best ? money(t.better) : `${money(t.good)} / ${money(t.better)} / ${money(t.best)}`;
  return `was ${figures}${h.per ? ` per ${h.per}` : ""}`;
}

/** The old per-tier fabric SKUs (Good, Better, Best order, de-duplicated) — offered as suggestions. */
export function legacyHintSkus(h: LegacyHint | undefined): string[] {
  if (!h?.skus) return [];
  return [...new Set([h.skus.good, h.skus.better, h.skus.best].filter((s): s is string => !!s))];
}
