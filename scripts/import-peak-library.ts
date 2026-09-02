/** Import the Peak AV Symbol Starter Library into catalog_parts. */
import { readFileSync } from "node:fs";
import { getDb } from "../src/db";
import { get, mergeUpsert, type CatalogPart } from "../src/lib/stores/catalog";
import { resolveDbTarget, requireHostedConfirmation } from "./db-target";

type PeakPart = {
  id: string;
  sku: string;
  manufacturer: string;
  desc: string;
  category: string;
  trade: string;
  unit: string;
  list: number | null;
  cost: number | null;
  pricingStatus?: string;
  symbolProfileId: string;
  symbolStatus: string;
  symbolKind: string;
  ports?: unknown[];
  visual?: { planSvg?: string; riserSvg?: string; source?: string };
  reviewRequired?: string[];
};

const CONNECTION_ALIASES: Record<string, string> = {
  dante: "Dante/AES67 (Cat6)",
  ethernet: "Dante/AES67 (Cat6)",
  "audio-analog": "XLR line/mic",
  speaker: "speakON NL2",
  power: "Edison",
  rf: "fiber",
};

const PEAK_WIRE_PARTS = [
  ["PEAK-WIRE-CAT6", "Cat6 cable", "Dante, Ethernet and sACN runs", ["Dante/AES67 (Cat6)", "sACN/Art-Net (etherCON/Cat6)", "HDBaseT (Cat6a)"]],
  ["PEAK-WIRE-SPEAKER", "Speaker cable", "NL2/NL4 speaker runs", ["speakON NL2", "speakON NL4", "speakON NL8", "70V pair"]],
  ["PEAK-WIRE-XLR", "XLR audio cable", "Analog and AES/EBU audio runs", ["XLR line/mic", "AES/EBU"]],
  ["PEAK-WIRE-POWER", "Edison power cable", "AC power runs", ["Edison", "powerCON/True1", "stage pin", "Socapex", "bare-end"]],
] as const;

function publicVisual(part: PeakPart): CatalogPart["visual"] {
  const plan = part.visual?.planSvg?.split("/").pop();
  const riser = part.visual?.riserSvg?.split("/").pop();
  return {
    ...(plan ? { iconUrl: `/peak-library/symbols/plan/${plan}`, iconSourcePath: part.visual?.planSvg } : {}),
    ...(riser ? { riserUrl: `/peak-library/symbols/riser/${riser}`, riserSourcePath: part.visual?.riserSvg } : {}),
    sourceImageIds: { icon: part.symbolProfileId, riser: part.symbolProfileId },
  };
}

function canonicalPorts(ports: unknown[] | undefined) {
  return (ports || []).map((raw) => {
    const port = raw as Record<string, unknown>;
    const rawType = String(port.connectionType || "");
    return { ...port, connectionType: CONNECTION_ALIASES[rawType.toLowerCase()] || rawType };
  });
}

async function main() {
  const file = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
  if (!file) throw new Error("usage: npm run peak:import -- <catalog-seed.json> --yes");
  const { hosted } = resolveDbTarget("Peak symbol library import");
  requireHostedConfirmation(hosted, process.argv);
  const parts = JSON.parse(readFileSync(file, "utf8")) as PeakPart[];
  await getDb();
  let inserted = 0;
  let updated = 0;
  for (const part of parts) {
    const sku = part.id;
    const existing = await get(sku);
    const patch: Record<string, unknown> = {
      desc: part.desc,
      category: part.category || "AV",
      trade: part.trade || "AV",
      unit: part.unit || "EA",
      mfr: part.manufacturer,
      manufacturer: part.manufacturer,
      source: { peakLibrary: { symbolProfileId: part.symbolProfileId, symbolKind: part.symbolKind, symbolStatus: part.symbolStatus } },
      ports: canonicalPorts(part.ports),
      visual: publicVisual(part),
      pricingStatus: part.pricingStatus || "missing",
      note: part.reviewRequired?.length ? `Peak starter symbol — review required: ${part.reviewRequired.join(", ")}` : undefined,
    };
    for (const key of Object.keys(patch)) if (patch[key] === undefined) delete patch[key];
    // The starter library intentionally has no prices. Never erase a price
    // already entered in Peak's catalog when refreshing its symbols.
    if (!existing) {
      patch.list = part.list;
      patch.cost = part.cost;
    }
    await mergeUpsert(sku, patch as Partial<Omit<CatalogPart, "id" | "sku">>);
    if (existing) updated++; else inserted++;
  }
  for (const [sku, desc, note, wireConnectionTypes] of PEAK_WIRE_PARTS) {
    const existing = await get(sku);
    await mergeUpsert(sku, {
      desc,
      category: "Wire",
      trade: "AV",
      unit: "ft",
      list: existing?.list ?? 0,
      cost: existing?.cost ?? 0,
      mfr: "Peak",
      manufacturer: "Peak",
      wireConnectionTypes: [...wireConnectionTypes],
      note: existing?.note || `${note} — enter current pricing before quoting.`,
      source: { peakLibrary: { starter: true, wire: true } },
    });
  }
  console.log(`Peak library import complete: ${inserted} inserted, ${updated} updated, ${PEAK_WIRE_PARTS.length} wire types ready.`);
}

main().catch((error) => { console.error(error); process.exit(1); });
