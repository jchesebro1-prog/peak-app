import type { Metadata } from "next";
import Link from "next/link";
import { getSettings } from "@/lib/settings";
import { resolvePortalViewer } from "@/lib/portal-viewer";
import { get as getCustomer } from "@/lib/stores/customers";
import { getCart } from "@/lib/stores/portal-carts";
import { pricingContextFor } from "@/lib/portal-pricing";
import { browseCatalog, portalBrowseAllowed, PORTAL_BROWSE_RATE_COPY, quotedBeforeShelf } from "@/lib/portal-catalog-browse";
import { portalIndex } from "@/lib/portal-catalog-index";
import { partDetailFor } from "@/lib/portal-part-detail";
import { CATALOG_PAGE_SIZE, parseCatalogParams } from "@/lib/portal-catalog-view";
import { PortalShell } from "../shell";
import { PortalSignedOut } from "../signed-out";
import { portalNav } from "../nav";
import { CatalogClient } from "./catalog-client";

export const dynamic = "force-dynamic";

/**
 * Portal CATALOG (#245 Task 10, spec §3.1) — search, Manufacturer and
 * Category facets (counted over the current results, so either narrows the
 * other), 48 tiles per page with numbered paging, and a "Parts you've quoted
 * before" shelf when nothing is searched. All URL state
 * (`?q=&mfr=&cat=&page=&part=`), so a search is linkable and survives
 * refresh; the client navigates by URL and this page renders each result.
 *
 * SECURITY: the customer comes from `resolvePortalViewer` only (their grant,
 * or a signed-in team member's `?preview=`). Tiles are sell-only `TileVM`s —
 * the catalog index (which carries cost) never leaves the server.
 *
 * #245 Task 11: an open `?part=` sidebar is rendered here from the resolved
 * viewer (so a team preview shows it fully, adds disabled); every render
 * counts against a 240-a-minute limit per grant (or previewed customer).
 */

export async function generateMetadata(): Promise<Metadata> {
  const s = await getSettings();
  return { title: `Catalog — ${s.companyName || "Peak Systems Group"}` };
}

function one(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] ?? "" : v ?? "";
}

export default async function PortalCatalogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [sp, settings] = await Promise.all([searchParams, getSettings()]);
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
  if (!portalBrowseAllowed(session, preview)) {
    return (
      <PortalShell companyName={companyName} logoLight={settings.logoLight || null} wide>
        <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 12, padding: "34px 24px", textAlign: "center" }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>{PORTAL_BROWSE_RATE_COPY}</div>
        </div>
      </PortalShell>
    );
  }
  const params = parseCatalogParams(sp);
  const ctx = await pricingContextFor(session);
  const browsing = !params.q && !params.mfr.length && !params.cat.length;
  const [cust, result, shelf, cart, detail, ix] = await Promise.all([
    getCustomer(cid),
    browseCatalog({ ...params, pageSize: CATALOG_PAGE_SIZE }, ctx),
    browsing && params.page === 1 ? quotedBeforeShelf(ctx) : Promise.resolve([]),
    preview ? Promise.resolve(null) : getCart(session.grantId, cid),
    params.part ? partDetailFor(ctx, params.part) : Promise.resolve(null),
    portalIndex(),
  ]);
  const custName = cust?.name || "your organization";

  return (
    <PortalShell
      companyName={companyName}
      logoLight={settings.logoLight || null}
      person={{ name: session.name, customer: custName }}
      nav={portalNav("catalog", preview ? { previewCid: cid } : { cartCount: cart?.lines.length ?? 0 })}
      wide
    >
      {preview && (
        <div
          style={{
            marginBottom: 18,
            padding: "11px 16px",
            background: "#fbf3dd",
            border: "1px solid #f0e2bd",
            borderRadius: 10,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div style={{ fontSize: 12.5, color: "#8a6d1f", fontWeight: 600 }}>
            Team preview — {custName}&rsquo;s catalog at their prices. Adding to their quote is disabled.
          </div>
          <Link
            href={`/customers/${cid}`}
            style={{ fontSize: 12, fontWeight: 600, color: "#8a6d1f", textDecoration: "none", whiteSpace: "nowrap" }}
          >
            ← Back to customer record
          </Link>
        </div>
      )}
      <CatalogClient
        params={params}
        previewCid={preview ? cid : ""}
        result={result}
        shelf={shelf}
        companyName={companyName}
        detail={detail}
        viewer={{ name: session.name, email: session.email }}
        fabrics={ix.fabrics}
        dept={result.dept}
        tiles={result.tiles}
      />
    </PortalShell>
  );
}
