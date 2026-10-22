import type { QuoteDocumentProps } from "@/app/(app)/estimator/quote-document";
import type { SpecSection } from "@/app/(app)/estimator/types";
import type { NarrativeBlock } from "@/app/(app)/estimator/narrative";
import type { QuoteRevisionDocFields } from "@/lib/stores/quotes";
import { fmt } from "@/app/(app)/estimator/pricing";
import { PLACEHOLDER_SRC } from "@/lib/part-image-fallback";
import { addOptions, alternatesListView, coverSummaryText, coverTotals, notIncludedItems, outputScopes } from "./scopes";
import type { AlternatesListView } from "./scopes";
import { packageBomRows, type BomCatalogPart, type PackageBomRow } from "./bom";
import { ownerNameFromLine } from "@/lib/parties/addressee";
import { PACKAGE_COPY, packageBanner, type PackageBanner, type VisiblePackageState } from "@/lib/quote-share/package-view";
import { documentApplies } from "@/lib/package-doc/print";
import { photoTagText } from "./photo-models";
import { resolvePackageDoc, type ResolvedPackageDoc } from "@/lib/package-doc/resolve";

/**
 * #301 slice B — the estimate package page's props (spec §5), built from the
 * SENT revision's customer document (QuoteDocumentProps, R20) so prices and
 * totals can't drift from the PDF (R1). Pure and client-safe. Carries only
 * formatted strings and printable blocks: scope prices, the totals lines and
 * add-option prices — never a line or unit price, cost, margin, internal
 * note or room (§10).
 */

/** R12 — the cover fields exactly as the revision froze them. Absent (a
 *  revision cut before #301) → empty, never the live quote. notIncluded null
 *  = the quote never stored one → the Settings default (the cover's rule). */
export function packageFrozenFields(
  df: Partial<QuoteRevisionDocFields> | null | undefined,
  defaultNotIncluded: string
): { coverSummary: string; notIncluded: string } {
  const coverSummary = df && typeof df.coverSummary === "string" ? df.coverSummary : "";
  const notIncluded = df && typeof df.notIncluded === "string" ? df.notIncluded : df && df.notIncluded === null ? defaultNotIncluded : "";
  return { coverSummary, notIncluded };
}

/** The v2 photo set: every system's key products, whatever its presentation
 *  (QuoteDocument prints them for Narrative systems only; the package's
 *  Narrative view is page-wide). Never mutates the input. */
export function packagePhotoSections(sections: SpecSection[]): SpecSection[] {
  return (Array.isArray(sections) ? sections : []).map((s) => (s && (s.presentation || "itemized") !== "narrative" ? { ...s, presentation: "narrative" as const } : s));
}

/** `side` (Jeff 2026-10-15 #20): "left" on every other printed photo — the page alternates right, left, right.
 *  `model` (photo wrap 2026-10-16): the photo's model-number tag; absent when none. */
export type PackageKeyProduct = { sku: string; heading: string; blocks: NarrativeBlock[]; photo: { src: string; alt: string } | null; side?: "left"; model?: string };

export type PackageScopeView = {
  id: string;
  num: number;
  name: string;
  price: string;
  goals: string;
  intro: NarrativeBlock[];
  keyProducts: PackageKeyProduct[];
  /** Shown in Narrative view when the scope has no intro and no key products. */
  fallback: string | null;
  bom: PackageBomRow[];
};

export type PackageViewProps = {
  logo: { src: string; full: boolean };
  companyName: string;
  title: string;
  customer: string;
  /** #348 2b-i — the owner company, present only when the estimate is addressed to a bidder. */
  owner?: string;
  venue: string;
  headerLine: string;
  totalLabel: string;
  total: string;
  banner: PackageBanner | null;
  summary: string;
  view: "narrative" | "bom";
  /** Jeff 2026-10-15 #14 — false when the estimate PDF hides quantities (the revision's pdfOptions): the BOM drops its
   *  Qty column. Absent = shown. */
  showQty?: boolean;
  narrativeHref: string;
  bomHref: string;
  scopes: PackageScopeView[];
  totals: { creditLabel: string | null; creditAmount: string | null; totalLabel: string; total: string; rewardsLine: string; standingLines: string[] };
  options: Array<{ label: string; desc: string; reason: string; price: string }>;
  /** Estimator Phase 2b — the Alternates card (mirrors the cover's list);
   *  present only when the revision has printed alternates. */
  alternates?: AlternatesListView;
  notIncluded: string[];
  /** Estimator Phase 5 — the Build package document, resolved (strings
   *  only: names, system sell prices, quantities, photo links). Present only
   *  when the quote has one; the Narrative view then draws it in place of the
   *  scope cards (the BOM view is unchanged). */
  document?: ResolvedPackageDoc;
  /** Box goods sale (spec 2026-10-21) — the itemized list only; PackageView drops the Overview / Itemized toggle.
   *  Absent on every other estimate (its props stay byte-identical). */
  boxSale?: true;
};

export type PackageViewInput = {
  doc: QuoteDocumentProps;
  photos: Record<string, { src: string; alt: string }>;
  /** Photo wrap — sku → model tag (loadKeyProductModels over packagePhotoSections). */
  models?: Record<string, string>;
  catalog: ReadonlyMap<string, BomCatalogPart>;
  frozen: { coverSummary: string; notIncluded: string };
  state: VisiblePackageState;
  headerLine: string;
  currentHref: string | null;
  view: "narrative" | "bom";
  base: string;
  letterheadSrc: string;
  /** #348 2b-ii — a bidder's v3 link whose bid is no longer live: the banner reads "This bid is closed." */
  bidClosed?: boolean;
  /** Box goods sale (spec 2026-10-21) — the revision's (or live quote's) flag; the page becomes the itemized list. */
  boxSale?: boolean;
};

/** Jeff 2026-10-15 #20 — the page's photos alternate right, left, right across the scopes, in order. Pure. */
function withAlternatingSides(scopes: PackageScopeView[]): PackageScopeView[] {
  let n = 0;
  return scopes.map((s) => ({
    ...s,
    keyProducts: s.keyProducts.map((kp) => (kp.photo ? (n++ % 2 === 1 ? { ...kp, side: "left" as const } : kp) : kp)),
  }));
}

export function packageViewModel(i: PackageViewInput): PackageViewProps {
  const d = i.doc;
  const scopes = outputScopes(d);
  const byId = new Map((d.sections || []).map((s) => [s.id, s] as const));
  const t = coverTotals(d);
  const alternates = alternatesListView(d);
  const owner = ownerNameFromLine(d.ownerLine);
  const model: PackageViewProps = {
    // #331: the package page always prints the full baked Peak letterhead, never the Branding logo.
    logo: { src: i.letterheadSrc, full: true },
    companyName: d.companyName,
    title: (d.projectName || "").trim() || PACKAGE_COPY.titleFallback,
    customer: d.custName,
    ...(owner ? { owner } : {}),
    venue: d.venueLabel,
    headerLine: i.headerLine,
    totalLabel: t.totalLabel,
    total: fmt(t.total),
    banner: packageBanner(i.state, i.currentHref, i.bidClosed === true),
    summary: coverSummaryText(i.frozen.coverSummary, scopes.map((s) => s.name)),
    view: i.view,
    // Only when hidden: a quote showing quantities keeps its props byte-identical.
    ...(d.pdfQty === false ? { showQty: false } : {}),
    narrativeHref: i.base,
    bomHref: i.base + "?view=bom",
    scopes: withAlternatingSides(scopes.map((s) => {
      const keyProducts: PackageKeyProduct[] = s.keyProducts.map((kp) => {
        const own = kp.photo && Object.hasOwn(i.photos, kp.sku) ? i.photos[kp.sku] : undefined;
        const photo = kp.photo ? (own ?? (kp.placeholder ? { src: PLACEHOLDER_SRC[kp.placeholder], alt: "" } : null)) : null;
        const model = photo ? photoTagText({ ownPhoto: !!own, partModel: i.models && Object.hasOwn(i.models, kp.sku) ? i.models[kp.sku] : null, ownModel: kp.ownModel }) : "";
        return { sku: kp.sku, heading: kp.heading, blocks: kp.blocks, photo, ...(model ? { model } : {}) };
      });
      const hasText = s.introBlocks.length > 0 || keyProducts.length > 0;
      const sec = byId.get(s.id);
      return {
        id: s.id,
        num: s.num,
        name: s.name,
        price: fmt(s.price),
        goals: s.clientGoals,
        intro: s.introBlocks,
        keyProducts,
        fallback: hasText ? null : s.cover.source === "missing" ? PACKAGE_COPY.seeBom : s.cover.text,
        // #14: with the PDF's Qty off, the online BOM carries no quantities either.
        bom: sec ? packageBomRows(sec, i.catalog, d.vendorQuotes || []).map((r) => (d.pdfQty === false ? { ...r, qty: null, unit: "" } : r)) : [],
      };
    })),
    totals: {
      creditLabel: t.creditLabel,
      creditAmount: t.credit > 0 ? "−" + fmt(t.credit) : null,
      totalLabel: t.totalLabel,
      total: fmt(t.total),
      rewardsLine: t.rewardsLine,
      standingLines: t.standingLines,
    },
    options: addOptions(d).map((o) => ({ label: o.label, desc: o.desc, reason: o.reason, price: fmt(o.price) })),
    ...(alternates.length ? { alternates } : {}),
    notIncluded: notIncludedItems(i.frozen.notIncluded),
    ...(documentApplies(d.document)
      ? { document: resolvePackageDoc(d.document, { sections: d.sections, t: d.t, quoteId: d.quoteId, taxRatePct: d.taxRatePct, totalLabel: t.totalLabel, photos: i.photos, models: i.models }) }
      : {}),
  };
  return i.boxSale === true ? boxSalePackageView(model) : model;
}

/** Box goods sale (spec 2026-10-21) — the package page is the itemized list only: the BOM view with no summary,
 *  goals, narrative, key products, package document or Not included. Prices, totals, add options and alternates
 *  stay (the client actions are the slots' — package-page.tsx). Pure. */
export function boxSalePackageView(m: PackageViewProps): PackageViewProps {
  const out: PackageViewProps = {
    ...m,
    boxSale: true,
    view: "bom",
    summary: "",
    notIncluded: [],
    scopes: m.scopes.map((s) => ({ ...s, goals: "", intro: [], keyProducts: [], fallback: null })),
  };
  delete out.document;
  return out;
}
