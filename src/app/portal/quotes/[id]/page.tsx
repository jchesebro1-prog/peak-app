import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getSettings } from "@/lib/settings";
import { get as getCustomer } from "@/lib/stores/customers";
import { get as getQuote } from "@/lib/stores/quotes";
import { getCart } from "@/lib/stores/portal-carts";
import { resolvePortalViewer } from "@/lib/portal-viewer";
import { portalOnlineEstimateState, portalQuotePdfSource } from "@/lib/quote-pdf/portal-access";
import { loadQuoteDocumentProps } from "@/lib/quote-pdf/document-loader";
import { ONLINE_COPY, onlineHeaderLine, onlineView } from "@/lib/quote-share/view";
import { OnlineEstimateCard, OnlineEstimateView } from "@/components/online-estimate/online-estimate";
import { PortalShell } from "../../shell";
import { PortalSignedOut } from "../../signed-out";
import { portalNav } from "../../nav";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const s = await getSettings();
  return { title: `Estimate — ${s.companyName || "Peak Systems Group"}`, robots: { index: false, follow: false } };
}

function one(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] ?? "" : v ?? "";
}

/**
 * Portal estimate page — `/portal/quotes/[id]` (#293 slice 3, spec §5.2). The
 * latest SENT revision as a web page with a Narrative / BOM toggle. The
 * viewer comes from resolvePortalViewer only (a portal grant, or a team
 * preview on ?preview=<cid>); then portalOnlineEstimateState decides: the
 * document (lost = closed banner), the being-revised card, or one 200 card
 * for everything else (unknown, another customer's, never sent, service) —
 * nothing hints whether the quote exists. Read-only.
 */
export default async function PortalQuotePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, sp, settings] = await Promise.all([params, searchParams, getSettings()]);
  const companyName = settings.companyName || "Peak Systems Group";
  const { session, preview } = await resolvePortalViewer(one(sp.preview));
  if (!session) {
    return (
      <PortalShell companyName={companyName} logoLight={settings.logoLight || null}>
        <PortalSignedOut companyName={companyName} />
      </PortalShell>
    );
  }
  const cid = session.customerId;
  const [q, cust, cart] = await Promise.all([
    getQuote(id),
    getCustomer(cid),
    // The nav's Cart (N) — never read in a team preview.
    preview ? Promise.resolve(null) : getCart(session.grantId, cid),
  ]);
  const state = q ? portalOnlineEstimateState(q, cid) : ({ kind: "unavailable" } as const);
  const pv = preview ? `preview=${encodeURIComponent(cid)}` : "";
  const withQs = (path: string, extra = "") => {
    const qs = [extra, pv].filter(Boolean).join("&");
    return path + (qs ? "?" + qs : "");
  };
  const base = `/portal/quotes/${encodeURIComponent(id)}`;
  const backHref = withQs("/portal");
  const shell = (children: ReactNode) => (
    <PortalShell
      companyName={companyName}
      logoLight={settings.logoLight || null}
      person={{ name: session.name, customer: cust?.name || "your organization" }}
      nav={portalNav("home", preview ? { previewCid: cid } : { cartCount: cart?.lines.length ?? 0 })}
    >
      {children}
    </PortalShell>
  );

  if (!q || state.kind === "unavailable") {
    const pdfHref = q && portalQuotePdfSource(q, cid) ? withQs(base + "/pdf") : null;
    return shell(<OnlineEstimateCard title={ONLINE_COPY.portalUnavailable} pdfHref={pdfHref} backHref={backHref} />);
  }
  if (state.kind === "revising") return shell(<OnlineEstimateCard title={ONLINE_COPY.revising} backHref={backHref} />);

  const docProps = await loadQuoteDocumentProps(q, {
    revision: state.rev,
    photos: { href: (docId) => withQs(`${base}/photo/${encodeURIComponent(docId)}`) },
  });
  // The loader fails closed (null) unless given this quote's own sent revision.
  if (!docProps) return shell(<OnlineEstimateCard title={ONLINE_COPY.portalUnavailable} backHref={backHref} />);
  return shell(
    <OnlineEstimateView
      docProps={docProps}
      view={onlineView(sp.view)}
      headerLine={onlineHeaderLine(q, state.rev)}
      closed={state.closed}
      narrativeHref={withQs(base)}
      bomHref={withQs(base, "view=bom")}
      pdfHref={portalQuotePdfSource(q, cid) ? withQs(base + "/pdf") : null}
      backHref={backHref}
    />
  );
}
