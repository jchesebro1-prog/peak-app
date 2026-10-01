import type { IndexedFixture } from "@/lib/portal-catalog-index";
import { includedLines, type TileVM } from "@/lib/portal-catalog-view";

/**
 * Portal part sidebar — pure, client-safe shapes + helpers (#245 Task 11,
 * spec §3.2 / §8.3). Imports only pure modules (no stores, no server code),
 * so the sidebar components use it directly.
 *
 * `PartDetail` is SELL-ONLY: the builders below copy an explicit whitelist,
 * so an `IndexedPart` handed in (which carries cost, list, note and the
 * priced-at stamp) can never leak cost, list, margin or a tier name.
 */

/** `pdf` — the only kind the sidebar opens in an inline viewer; anything
 *  else (a .doc/.docx spec sheet) would download inside an iframe, so it
 *  gets "Open in new tab" only. */
export type PartDocVM = { id: string; kind: "datasheet" | "specsheet"; title: string; pdf: boolean };

export type PartDetailPart = {
  kind: "part";
  key: string;
  sku: string;
  title: string;
  mfr: string;
  mpn: string;
  unit: string;
  unitPrice: number | null;
  por: boolean;
  images: string[];
  docs: PartDocVM[];
  specText: string | null;
  goesWith: TileVM[];
};

export type FixtureAddOnVM = { key: string; sku: string; label: string; unitPrice: number | null; por: boolean };

export type PartDetailFixture = {
  kind: "fixture";
  key: string;
  id: string;
  title: string;
  description: string;
  mfr: string;
  unitPrice: number | null;
  por: boolean;
  unavailable: boolean;
  fixed: Array<{ sku: string; label: string; qty: number }>;
  addOns: FixtureAddOnVM[];
  images: string[];
  docs: PartDocVM[];
};

export type PartDetail = PartDetailPart | PartDetailFixture;

/** Shown for a hidden, labor, deleted or unknown `?part=` key — the same
 *  words either way, so the sidebar never confirms that a SKU exists. */
export const PART_UNAVAILABLE_COPY = "This item isn't available.";
export const FIXTURE_UNAVAILABLE_COPY = "This fixture can't be quoted online right now — ask us about it.";
export const PREVIEW_ADD_HINT = "Preview — customers can add to their quote here.";
/** "Goes with" shows at most this many accessories. */
export const GOES_WITH_MAX = 12;

const MAX_OPTION_QTY = 10000;

/** A fixture add-on's option key — the same `slot:sku` a cart line's
 *  `fixtureOptions` and `priceFixtureLine` use. */
export function fixtureOptionKey(line: { slot: string; sku: string }): string {
  return `${line.slot}:${line.sku}`;
}

/**
 * Untrusted add-on quantities → the options this fixture actually offers:
 * only keys naming one of its optional (qty 0) lines, only whole numbers
 * 1..10,000. Anything else — a required line, another fixture's key, a
 * negative, fractional or non-numeric qty — is dropped.
 */
export function cleanFixtureOptions(
  fx: Pick<IndexedFixture, "lines">,
  raw: unknown
): Record<string, number> {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const offered = new Set(fx.lines.filter((l) => !l.required).map(fixtureOptionKey));
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(r)) {
    if (!offered.has(k)) continue;
    if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > MAX_OPTION_QTY) continue;
    out[k] = v;
  }
  return out;
}

function docVM(d: PartDocVM): PartDocVM {
  return { id: String(d.id), kind: d.kind === "specsheet" ? "specsheet" : "datasheet", title: String(d.title || ""), pdf: d.pdf === true };
}

type Price = { unitPrice: number | null; por: boolean } | null | undefined;

function sell(price: Price): { unitPrice: number | null; por: boolean } {
  const unitPrice = price && !price.por && typeof price.unitPrice === "number" ? price.unitPrice : null;
  return { unitPrice, por: unitPrice == null };
}

type PartSource = {
  sku: string;
  desc?: string;
  mfr?: string;
  mpn?: string;
  unit?: string;
  imageIds?: readonly string[];
  specText?: string | null;
};

/** The part sidebar's view of one part — an explicit whitelist, sell only. */
export function toPartDetailVM(p: PartSource, price: Price, docs: readonly PartDocVM[], goesWith: readonly TileVM[]): PartDetailPart {
  const s = sell(price);
  return {
    kind: "part",
    key: String(p.sku),
    sku: String(p.sku),
    title: String(p.desc || p.sku),
    mfr: String(p.mfr || ""),
    mpn: String(p.mpn || ""),
    unit: String(p.unit || "ea"),
    unitPrice: s.unitPrice,
    por: s.por,
    images: [...(p.imageIds ?? [])].map(String),
    docs: docs.map(docVM),
    specText: typeof p.specText === "string" && p.specText.trim() ? p.specText : null,
    goesWith: goesWith.slice(0, GOES_WITH_MAX),
  };
}

/**
 * The configurator's view of one fixture (spec §8.3): the light engine,
 * lens and included (qty > 0) lines are fixed; each optional (qty 0) line
 * the customer can quote is an add-on with its own unit sell. `price` is
 * the fixture with no add-ons (null = can't be priced → `unavailable`).
 */
export function toFixtureDetailVM(
  fx: IndexedFixture,
  mfr: string,
  price: Price,
  addOnPrice: (sku: string) => Price,
  media: { images: readonly string[]; docs: readonly PartDocVM[] }
): PartDetailFixture {
  const s = sell(price);
  return {
    kind: "fixture",
    key: "fixture:" + fx.id,
    id: String(fx.id),
    title: String(fx.label || ""),
    description: String(fx.description || ""),
    mfr: String(mfr || ""),
    unitPrice: s.unitPrice,
    por: price ? s.por : false,
    unavailable: !price,
    fixed: includedLines(fx.lines).map((l) => ({ sku: String(l.sku), label: String(l.label || l.sku), qty: Number(l.qty) || 1 })),
    addOns: fx.lines
      .filter((l) => !l.required)
      .map((l) => {
        const a = sell(addOnPrice(l.sku));
        return { key: fixtureOptionKey(l), sku: String(l.sku), label: String(l.label || l.sku), unitPrice: a.unitPrice, por: a.por };
      }),
    images: [...media.images].map(String),
    docs: media.docs.map(docVM),
  };
}
