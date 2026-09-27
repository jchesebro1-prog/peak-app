import type { Metadata } from "next";
import Link from "next/link";
import { getSettings } from "@/lib/settings";
import { resolvePortalViewer } from "@/lib/portal-viewer";
import { get as getCustomer } from "@/lib/stores/customers";
import { getCart } from "@/lib/stores/portal-carts";
import { priceCart, pricingContextFor, sellView } from "@/lib/portal-pricing";
import { portalBrowseAllowed, PORTAL_BROWSE_RATE_COPY } from "@/lib/portal-catalog-browse";
import { GENERATE_EMPTY_COPY, GENERATE_NO_VENUE_COPY, GENERATE_UNAVAILABLE_COPY } from "@/lib/portal-quotes";
import { PortalShell } from "../../shell";
import { PortalSignedOut } from "../../signed-out";
import { portalNav } from "../../nav";
import { CartClient, type CartVenue } from "./cart-client";

export const dynamic = "force-dynamic";
/** #222: Generate schedules the quote's saved PDF, which renders in after() —
 *  a page's maxDuration is its Server Actions' budget. */
export const maxDuration = 120;

/**
 * Portal CART — `/portal/catalog/quote` (#245 Task 12, spec §3.4). The
 * customer picks the venue (it drives freight), edits quantities, sees the
 * server-priced subtotal · freight · total and whether Generate makes a firm
 * quote or one Peak reviews first, then generates it.
 *
 * SECURITY: the customer comes from `resolvePortalViewer` only; the client
 * gets `sellView(priced)` — never the staff sections (cost), the freight %
 * or the at-cap flag. A team preview renders read-only (a preview has no
 * cart of its own and never writes).
 */

export async function generateMetadata(): Promise<Metadata> {
  const s = await getSettings();
  return { title: `Your quote — ${s.companyName || "Peak Systems Group"}` };
}

function one(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] ?? "" : v ?? "";
}

export default async function PortalCartPage({
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
      <PortalShell companyName={companyName} logoLight={settings.logoLight || null}>
        <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 12, padding: "34px 24px", textAlign: "center" }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>{PORTAL_BROWSE_RATE_COPY}</div>
        </div>
      </PortalShell>
    );
  }

  const [cust, cart, ctx] = await Promise.all([getCustomer(cid), getCart(session.grantId, cid), pricingContextFor(session)]);
  const custName = cust?.name || "your organization";
  const venues: CartVenue[] = (cust?.locations || []).flatMap((l) =>
    l.id ? [{ id: l.id, label: [l.label || l.locationName || "Venue", [l.city, l.state].filter(Boolean).join(", ")].filter(Boolean).join(" — ") }] : []
  );
  // A venue that's no longer the customer's reads as none picked.
  const locationId = cart.locationId && venues.some((v) => v.id === cart.locationId) ? cart.locationId : "";
  const view = sellView(await priceCart({ ...cart, locationId: locationId || null }, ctx));

  const blocked = preview
    ? "Preview — customers generate their quote here."
    : !view.lines.length
    ? GENERATE_EMPTY_COPY
    : !locationId
    ? GENERATE_NO_VENUE_COPY
    : !view.lines.some((l) => !l.unavailable)
    ? GENERATE_UNAVAILABLE_COPY
    : null;

  return (
    <PortalShell
      companyName={companyName}
      logoLight={settings.logoLight || null}
      person={{ name: session.name, customer: custName }}
      nav={portalNav("quote", preview ? { previewCid: cid } : { cartCount: cart.lines.length })}
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
            Team preview — {custName}&rsquo;s quote page, read-only. Each customer login keeps its own quote.
          </div>
          <Link href={`/customers/${cid}`} style={{ fontSize: 12, fontWeight: 600, color: "#8a6d1f", textDecoration: "none", whiteSpace: "nowrap" }}>
            ← Back to customer record
          </Link>
        </div>
      )}
      <CartClient
        view={view}
        venues={venues}
        locationId={locationId}
        readOnly={preview}
        blocked={blocked}
        catalogHref={preview ? `/portal/catalog?preview=${encodeURIComponent(cid)}` : "/portal/catalog"}
      />
    </PortalShell>
  );
}
