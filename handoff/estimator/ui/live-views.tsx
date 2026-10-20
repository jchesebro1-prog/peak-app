/**
 * Estimator handoff — the customer-facing views, rendered live from the browser store. In the app these are
 * server pages the Estimator frames or links to (the saved PDF, /estimator-preview/[id]?tab=package|bom|
 * cutsheets, /estimator/cut-sheets); here each one is the same app component fed by a browser port of its
 * server loader (runtime/loaders/*):
 *
 *   LiveDocument    QuoteDocument (sheet layout — the PDF's look) ← loadQuoteDocumentPropsLocal
 *   LivePackagePage PackageView (+ the staff preview's slots)     ← loadPackagePreviewLocal
 *   LiveBom         QuoteDocument (bomViewProps, web layout)      ← loadQuoteDocumentPropsLocal
 *   LiveCutSheets   CutSheetPages (Client or Submittal style)     ← loadCutSheetsLocal
 *
 * Each reads the SAVED quote (what the client would get), and re-reads after every router.refresh() —
 * a Save or a status change — as the framed page reloaded on a new save.
 * Plan: PR 2 Task 5.
 */
import { useEffect, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import letterhead from "@/app/(app)/estimator/peak-letterhead.jpg";
import QuoteDocument, { QUOTE_WEB_EMBED_CSS, type QuoteDocumentProps } from "@/app/(app)/estimator/quote-document";
import { bomViewProps } from "@/app/(app)/estimator/quote-document-view";
import { CLIENT_PRINT_CSS, CutSheetPages, SUBMITTAL_PRINT_CSS } from "@/components/cutsheets/cut-sheet-pages";
import { DatasheetLink, PackagePlans } from "@/components/estimate-output/package-extras";
import PackageView, { type PackageSlots } from "@/components/estimate-output/package-view";
import { CUT_SHEETS_NONE, type CutSheetStyle } from "@/lib/curtain-cut-sheets/model";
import { PREVIEW_COPY, type StaffPackageExtras } from "@/lib/estimate-output/package-preview";
import { onRefresh } from "../runtime/router";
import { configuredStore } from "../runtime/ports";
import { loadQuoteDocumentPropsLocal } from "../runtime/loaders/document";
import { loadPackagePreviewLocal, type LocalPackagePreview } from "../runtime/loaders/package";
import { loadCutSheetsLocal, type LocalCutSheets } from "../runtime/loaders/cut-sheets";

/** What a live view loads: the kind, the quote, and the package page's Narrative / BOM view. */
type LoadSpec = { kind: "document"; quoteId: string } | { kind: "package"; quoteId: string; view: "narrative" | "bom" } | { kind: "cutsheets"; quoteId: string };
type Loaded = { kind: "document"; doc: QuoteDocumentProps | null } | { kind: "package"; pkg: LocalPackagePreview | null } | { kind: "cutsheets"; sheets: LocalCutSheets | { ok: false; error: string } };

async function loadSpec(spec: LoadSpec): Promise<Loaded> {
  const store = configuredStore();
  if (!store) throw new Error("the store is not open yet");
  if (spec.kind === "document") return { kind: "document", doc: await loadQuoteDocumentPropsLocal(store, spec.quoteId) };
  if (spec.kind === "package") return { kind: "package", pkg: await loadPackagePreviewLocal(store, spec.quoteId, spec.view, letterhead.src) };
  return { kind: "cutsheets", sheets: await loadCutSheetsLocal(store, spec.quoteId) };
}

/** Loads `spec` from the store; re-loads when it changes and after every router.refresh(). `data` is null while loading. */
function useLive(spec: LoadSpec): { data: Loaded | null; error: string | null } {
  const key = JSON.stringify(spec);
  const [tick, setTick] = useState(0);
  useEffect(() => onRefresh(() => setTick((t) => t + 1)), []);
  const [state, setState] = useState<{ key: string; data: Loaded | null; error: string | null }>({ key: "", data: null, error: null });
  useEffect(() => {
    let live = true;
    loadSpec(JSON.parse(key) as LoadSpec).then(
      (data) => {
        if (live) setState({ key, data, error: null });
      },
      (e: unknown) => {
        console.error("[handoff] live view failed to load", e);
        if (live) setState({ key, data: null, error: e instanceof Error ? e.message : String(e) });
      },
    );
    return () => {
      live = false;
    };
  }, [key, tick]);
  // A different spec shows "loading" until its own data lands (a refresh keeps the last render meanwhile).
  return state.key === key ? { data: state.data, error: state.error } : { data: null, error: null };
}

const NOTE: CSSProperties = { margin: "40px auto", maxWidth: 420, textAlign: "center", fontSize: 13, color: "#5b616e" };
const COLUMN: CSSProperties = { maxWidth: 820, margin: "0 auto", padding: "24px 16px 40px" };
const EMPTY_CARD: CSSProperties = { background: "#fff", border: "1px solid #e4e7ec", borderRadius: 12, padding: "40px 24px", textAlign: "center", fontSize: 15, fontWeight: 600 };

export const LIVE_COPY = {
  loading: "Loading…",
  gone: "This estimate isn't in the store any more.",
  failed: "Couldn't draw this view.",
  notIncluded: "Not included in the prototype.",
} as const;

function Status({ error }: { error: string | null }) {
  return <p style={NOTE}>{error ? `${LIVE_COPY.failed} (${error})` : LIVE_COPY.loading}</p>;
}

/** The saved quote's customer document → `render(doc)`; loading / missing states in between. */
export function LiveDocument({ quoteId, render }: { quoteId: string; render: (doc: QuoteDocumentProps) => ReactNode }) {
  const { data, error } = useLive({ kind: "document", quoteId });
  if (!data || data.kind !== "document") return <Status error={error} />;
  if (!data.doc) return <p style={NOTE}>{LIVE_COPY.gone}</p>;
  return <>{render(data.doc)}</>;
}

/** Customer review → BOM (the staff preview's `?tab=bom`): the online estimate's BOM view of the saved quote. */
export function LiveBom({ quoteId }: { quoteId: string }) {
  return (
    <LiveDocument
      quoteId={quoteId}
      render={(doc) => (
        <div style={COLUMN}>
          <style>{QUOTE_WEB_EMBED_CSS}</style>
          <QuoteDocument {...bomViewProps(doc)} layout="web" />
        </div>
      )}
    />
  );
}

/** estimator-preview/[id]/page.tsx previewSlots: staff datasheet links, plans, and an inert note for the client actions. */
function previewSlots(x: StaffPackageExtras): PackageSlots {
  const keyProductExtra: PackageSlots["keyProductExtra"] = {};
  for (const [sku, link] of Object.entries(x.datasheets)) keyProductExtra[sku] = <DatasheetLink link={link} />;
  return {
    keyProductExtra,
    ...(x.plans.length ? { plans: <PackagePlans plans={x.plans} /> } : {}),
    actions: (
      <div className="pkg-card">
        <p className="pkg-p pkg-muted" style={{ margin: 0 }}>
          {PREVIEW_COPY.actionsNote}
        </p>
      </div>
    ),
  };
}

/** The package page's Narrative / BOM toggle links point at the staff preview route — switch the view in place. */
function previewViewOf(e: MouseEvent<HTMLElement>): "narrative" | "bom" | null {
  const a = (e.target as Element | null)?.closest?.("a");
  const href = a?.getAttribute("href") || "";
  if (!href.startsWith("/estimator-preview/")) return null;
  const params = new URLSearchParams(href.split("?")[1] || "");
  return params.get("view") === "bom" ? "bom" : "narrative";
}

/** Customer review → Package page (the staff preview's `?tab=package`): the client's package page for the saved quote. */
export function LivePackagePage({ quoteId, initialView = "narrative" }: { quoteId: string; initialView?: "narrative" | "bom" }) {
  const [view, setView] = useState<"narrative" | "bom">(initialView);
  const { data, error } = useLive({ kind: "package", quoteId, view });
  const onClickCapture = (e: MouseEvent<HTMLElement>) => {
    const to = previewViewOf(e);
    if (!to) return;
    e.preventDefault();
    e.stopPropagation();
    setView(to);
  };
  if (!data || data.kind !== "package") return <Status error={error} />;
  if (!data.pkg) return <p style={NOTE}>{LIVE_COPY.gone}</p>;
  return (
    <div style={COLUMN} onClickCapture={onClickCapture} data-handoff-live="package">
      <PackageView model={data.pkg.model} slots={previewSlots(data.pkg.extras)} />
    </div>
  );
}

/** Customer review → Cut sheets (Client style), and the ⋯ menu's Cut sheets (`style` from its link). */
export function LiveCutSheets({ quoteId, style = "client", withPrintCss = false }: { quoteId: string; style?: CutSheetStyle; withPrintCss?: boolean }) {
  const { data, error } = useLive({ kind: "cutsheets", quoteId });
  if (!data || data.kind !== "cutsheets") return <Status error={error} />;
  const loaded = data.sheets;
  const models = loaded.ok ? loaded.models[style] : [];
  if (!loaded.ok || !models.length) {
    return (
      <div style={COLUMN}>
        <div style={EMPTY_CARD}>{!loaded.ok ? loaded.error : style === "client" ? PREVIEW_COPY.noCurtains : CUT_SHEETS_NONE}</div>
      </div>
    );
  }
  return (
    <div style={{ overflowX: "auto", padding: "24px 16px 40px" }} data-handoff-live="cutsheets">
      {withPrintCss && <style>{style === "submittal" ? SUBMITTAL_PRINT_CSS : CLIENT_PRINT_CSS}</style>}
      <div style={{ width: "max-content", margin: "0 auto" }}>
        <CutSheetPages models={models} style={style} photos={loaded.photos} letterheadSrc={letterhead.src} />
      </div>
    </div>
  );
}
