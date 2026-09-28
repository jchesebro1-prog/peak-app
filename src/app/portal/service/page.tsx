import type { Metadata } from "next";
import Link from "next/link";
import { getSettings } from "@/lib/settings";
import { resolvePortalViewer } from "@/lib/portal-viewer";
import { get as getCustomer } from "@/lib/stores/customers";
import { serviceScopeFor, type PortalService } from "@/lib/portal-service-scope";
import { priceServiceRequest, type ServiceRequest } from "@/lib/portal-service-pricing";
import { serviceRequestFromQuoteId } from "@/lib/portal-service-quotes";
import { parseServiceParams } from "@/lib/portal-service-view";
import { PortalShell } from "../shell";
import { PortalSignedOut } from "../signed-out";
import { portalNav } from "../nav";
import { ServiceForm, type ServiceFormVenue } from "./service-form";

export const dynamic = "force-dynamic";
/** #222/#245 pattern: Generate schedules the quote's saved PDF, which
 *  renders in after() — a page's maxDuration is its Server Actions' budget. */
export const maxDuration = 120;

/**
 * Portal SERVICE — `/portal/service` (#248 Task 3, spec §2). The self-serve
 * flame-test / rigging-inspection intake: pick a service, tick venues (each
 * pre-filled from history), see the builder-identical live price, Generate a
 * firm, numbered quote. Entry points (spec §1) land here via
 * `?type=&level=&venue=` (per-chip "Quote it", the compliance card's header
 * button) or `?from=<quoteId>` ("Quote again" on a portal quote row).
 *
 * SECURITY: the customer comes from `resolvePortalViewer` only. A team
 * preview renders read-only — its price is computed once, server-side, at
 * render time (this page calling `priceServiceRequest` directly, the same
 * pattern the catalog cart page uses for `priceCart`); the client form never
 * calls the live-price/generate server actions while previewing.
 */

export async function generateMetadata(): Promise<Metadata> {
  const s = await getSettings();
  return { title: `Request a service quote — ${s.companyName || "Peak Systems Group"}` };
}

function one(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] ?? "" : v ?? "";
}

export default async function PortalServicePage({
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
  const parsed = parseServiceParams(sp);

  // "Quote again" (?from=) wins over ?type=/&venue= when it resolves to a
  // real, listed flame/inspection quote of this customer (spec §1, §3);
  // otherwise it's silently ignored and the ordinary URL/default path runs.
  const fromReq = parsed.fromQuoteId ? await serviceRequestFromQuoteId(cid, parsed.fromQuoteId) : null;
  const service: PortalService = fromReq?.service ?? parsed.service ?? { kind: "flame" };

  const [cust, scope] = await Promise.all([getCustomer(cid), serviceScopeFor(cid, service)]);
  const custName = cust?.name || "your organization";

  const presetCounts = new Map((fromReq?.venues ?? []).map((v) => [v.venueId, v.count]));
  const presetVenueIds = fromReq ? new Set(presetCounts.keys()) : new Set(parsed.venueIds);

  const formVenues: ServiceFormVenue[] = scope.map((v) => ({
    venueId: v.venueId,
    label: v.label,
    source: v.source,
    sourceYear: v.sourceYear,
    selected: presetVenueIds.has(v.venueId),
    count: presetCounts.get(v.venueId) ?? v.count,
  }));

  // The page's own initial price, computed exactly like the client will for
  // any LATER change (same priceServiceRequest, same shape) — so first paint
  // never waits on a round trip. A venue that's ticked but has no usable
  // count yet (no history, nothing typed) is left out here; the client fires
  // its own re-price the moment the customer edits anything, which then
  // surfaces the real range-copy refusal for that venue.
  const initialReq: ServiceRequest = {
    service,
    venues: formVenues
      .filter((v): v is ServiceFormVenue & { count: number } => v.selected && typeof v.count === "number")
      .map((v) => ({ venueId: v.venueId, count: v.count })),
  };
  const initialPriced = initialReq.venues.length ? await priceServiceRequest(session, initialReq) : null;

  return (
    <PortalShell
      companyName={companyName}
      logoLight={settings.logoLight || null}
      person={{ name: session.name, customer: custName }}
      nav={portalNav("service", preview ? { previewCid: cid } : {})}
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
            Team preview — {custName}&rsquo;s service pricing at their rates. Generating a quote is disabled.
          </div>
          <Link
            href={`/customers/${cid}`}
            style={{ fontSize: 12, fontWeight: 600, color: "#8a6d1f", textDecoration: "none", whiteSpace: "nowrap" }}
          >
            ← Back to customer record
          </Link>
        </div>
      )}
      <ServiceForm
        service={service}
        venues={formVenues}
        initialView={initialPriced?.ok ? initialPriced.view : null}
        initialError={initialPriced && !initialPriced.ok ? initialPriced.error : null}
        preview={preview}
        previewCid={preview ? cid : ""}
      />
    </PortalShell>
  );
}
