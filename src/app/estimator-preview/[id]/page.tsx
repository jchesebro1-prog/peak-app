import type { Metadata } from "next";
import { notFound } from "next/navigation";
import letterhead from "@/app/(app)/estimator/peak-letterhead.jpg";
import QuoteDocument, { QUOTE_WEB_CSS } from "@/app/(app)/estimator/quote-document";
import { bomViewProps } from "@/app/(app)/estimator/quote-document-view";
import { CutSheetPages } from "@/components/cutsheets/cut-sheet-pages";
import { DatasheetLink, PackagePlans, PKG_LINK } from "@/components/estimate-output/package-extras";
import PackageView, { type PackageSlots } from "@/components/estimate-output/package-view";
import { loadCutSheets } from "@/lib/curtain-cut-sheets/load";
import { liveQuoteDocumentProps, loadLivePackagePreview } from "@/lib/estimate-output/package-live-loader";
import { PREVIEW_COPY, previewTab, type StaffPackageExtras } from "@/lib/estimate-output/package-preview";
import { estimatorShouldRedirect } from "@/lib/quote-links";
import { onlineView } from "@/lib/quote-share/view";
import { requireUser } from "@/lib/session";
import { get as getQuote } from "@/lib/stores/quotes";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Customer preview", robots: { index: false, follow: false } };

const COLUMN = { maxWidth: 820, margin: "0 auto", padding: "24px 16px 40px" } as const;
const CARD = "pkg-card";
/** No PackageView (so no pkg-card CSS) on this tab — the card's look inline. */
const EMPTY_CARD = { background: "#fff", border: "1px solid #e4e7ec", borderRadius: 12, padding: "40px 24px", textAlign: "center", fontSize: 15, fontWeight: 600 } as const;

/**
 * Estimator Phase 4 (spec §11.1) — `/estimator-preview/[id]?tab=package|bom|cutsheets`:
 * the SAVED system estimate as the client gets it, framed by the Customer
 * review step (a SAMEORIGIN frame exception in next.config.ts, this path
 * only). Staff-only (requireUser); a missing quote or one the Estimator
 * doesn't build is a 404. The package page comes from the live quote through
 * the pure package model — no token, no open beacon, no client actions (an
 * inert note stands in for them), datasheet / plan links to staff routes and
 * no zip. BOM = the online estimate's BOM view; Cut sheets = the Client style.
 */
export default async function EstimatorPreviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireUser();
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const q = await getQuote(id);
  if (!q || estimatorShouldRedirect(q)) notFound();
  const tab = previewTab(sp.tab);

  if (tab === "cutsheets") {
    const loaded = await loadCutSheets(q.id, { images: "url" });
    const models = loaded.ok ? loaded.models.client : [];
    if (!loaded.ok || !models.length) {
      return (
        <div style={COLUMN}>
          <div style={EMPTY_CARD}>
            {PREVIEW_COPY.noCurtains}
          </div>
        </div>
      );
    }
    return (
      <div style={{ overflowX: "auto", padding: "24px 16px 40px" }}>
        <div style={{ width: "max-content", margin: "0 auto" }}>
          <CutSheetPages models={models} style="client" photos={loaded.photos} />
        </div>
      </div>
    );
  }

  if (tab === "bom") {
    const doc = await liveQuoteDocumentProps(q);
    return (
      <div style={COLUMN}>
        <style>{QUOTE_WEB_CSS}</style>
        <QuoteDocument {...bomViewProps(doc)} layout="web" />
      </div>
    );
  }

  const { model, extras } = await loadLivePackagePreview(q, { view: onlineView(sp.view), letterheadSrc: letterhead.src });
  return (
    <div style={COLUMN}>
      <PackageView model={model} slots={previewSlots(extras)} />
    </div>
  );
}

/** The share page's slot rules with staff links, no zip, and an inert note for the client actions. */
function previewSlots(x: StaffPackageExtras): PackageSlots {
  const keyProductExtra: PackageSlots["keyProductExtra"] = {};
  for (const [sku, link] of Object.entries(x.datasheets)) keyProductExtra[sku] = <DatasheetLink link={link} />;
  return {
    keyProductExtra,
    ...(x.plans.length ? { plans: <PackagePlans plans={x.plans} /> } : {}),
    ...(x.downloads ? { downloads: <PreviewDownloads files={x.downloads.files} specifications={x.downloads.specifications} /> } : {}),
    actions: (
      <div className={CARD}>
        <p className="pkg-p pkg-muted" style={{ margin: 0 }}>
          {PREVIEW_COPY.actionsNote}
        </p>
      </div>
    ),
  };
}

/** The client's Downloads card without its "Download all (.zip)" link. */
function PreviewDownloads({ files, specifications }: StaffPackageExtras["downloads"] & object) {
  return (
    <div className={CARD}>
      <h2>Downloads</h2>
      {specifications && <p className="pkg-muted" style={{ margin: "0 0 8px" }}>Specifications (Word)</p>}
      {files.length > 0 && (
        <ul className="pkg-ul" style={{ margin: 0 }}>
          {files.map((f) => (
            <li key={f.href}>
              <a href={f.href} target="_blank" rel="noopener noreferrer" style={PKG_LINK}>
                {f.name}
              </a>{" "}
              <span className="pkg-muted">{f.kindLabel}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
