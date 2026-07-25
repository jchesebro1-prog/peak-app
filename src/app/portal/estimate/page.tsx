import type { Metadata } from "next";
import Link from "next/link";
import { getSettings } from "@/lib/settings";
import { portalSession } from "@/lib/portal";
import { get as getCustomer } from "@/lib/stores/customers";
import { byCategory } from "@/lib/stores/catalog";
import { fabricSellPerSqft, sellCoeffs } from "@/lib/curtain-pricing";
import { SEED_FABRIC_RATES } from "@/lib/design/curtain-pricing";
import type { FabricSell } from "@/lib/curtain-geom";
import { customerCatalog } from "@/lib/portal-catalog";
import { resolveTier } from "@/lib/pricing-tiers";
import { PortalShell } from "../shell";
import { EstimateBuilder } from "./estimate-builder";

export const dynamic = "force-dynamic";

/**
 * Portal SELF-SERVE ESTIMATE (IDEAS #48, drapery slice) — a signed-in customer
 * configures drapery / soft goods and gets a live budgetary total, then submits
 * it. Submitting lands a DRAFT quote in the team pipeline (source
 * "portal-self-serve") for an estimator to finalize and publish; the customer
 * never self-publishes a binding quote.
 *
 * PRICING SAFETY: fabrics reach the browser as a SELL price/sq ft only
 * (costPerSqft ÷ (1 − margin)). Peak's cost basis and margin never leave the
 * server. The submit action recomputes authoritatively — see ../actions.ts.
 */

export async function generateMetadata(): Promise<Metadata> {
  const s = await getSettings();
  return { title: `Build an estimate — ${s.companyName || "Peak Systems Group"}` };
}

export default async function PortalEstimatePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [sp, settings, session] = await Promise.all([searchParams, getSettings(), portalSession()]);
  // Tier pricing (item 11 D, D88): the grant's customer sets the margin the
  // preview AND the authoritative recompute both use. Contact-level tier is
  // resolved by the grant name so a person's own tier follows them here too.
  const tier = await resolveTier(session?.customerId ?? null, session?.name ?? null);
  const companyName = settings.companyName || "Peak Systems Group";
  const tabParam = Array.isArray(sp.tab) ? sp.tab[0] : sp.tab;
  const initialTab: "drapery" | "equipment" = tabParam === "equipment" ? "equipment" : "drapery";

  if (!session) {
    return (
      <PortalShell companyName={companyName} logoLight={settings.logoLight || null}>
        <div
          style={{
            maxWidth: 460,
            margin: "48px auto 0",
            background: "#fff",
            border: "1px solid #e4e7ec",
            borderRadius: 14,
            padding: "30px 28px",
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: 17, fontWeight: 600 }}>Sign in with your access link</div>
          <div style={{ fontSize: 13, color: "#5b616e", lineHeight: 1.65, marginTop: 10 }}>
            Open the personal access link {companyName} sent you, then build an estimate from your
            dashboard.
          </div>
        </div>
      </PortalShell>
    );
  }

  const [cust, fabricRows, equipment] = await Promise.all([
    getCustomer(session.customerId),
    byCategory("Fabric"),
    customerCatalog(tier.margin),
  ]);

  const venues = (cust?.locations || []).map((l) => ({
    id: l.id || "",
    label: l.label || "Venue",
    place: [l.city, l.state].filter(Boolean).join(", "),
  }));

  // Cost basis → customer sell price/sq ft. costPerSqft NEVER leaves the server;
  // sell numbers ship at full precision so the preview equals the stored quote.
  // Only fabrics with a real per-sq-ft basis are offered — imported vendor
  // fabric rows (per-unit pricing, no costPerSqft) are excluded so the customer
  // never sees a $0/sq ft option.
  const fabrics: FabricSell[] = fabricRows
    .filter((p) => (p.costPerSqft ?? 0) > 0)
    .map((p) => ({
      sku: p.sku,
      name: p.desc,
      pricePerSqft: fabricSellPerSqft(p.curtainAreaRate ?? SEED_FABRIC_RATES[p.sku] ?? p.costPerSqft ?? 0, tier.margin),
    }));
  const coeffs = sellCoeffs(tier.margin);

  return (
    <PortalShell
      companyName={companyName}
      logoLight={settings.logoLight || null}
      person={{ name: session.name, customer: cust?.name || "" }}
    >
      <Link
        href="/portal"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          fontSize: 12.5,
          fontWeight: 600,
          color: "#8c919c",
          textDecoration: "none",
          marginBottom: 14,
        }}
      >
        ← Your dashboard
      </Link>
      <div style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-.015em" }}>
          Build an estimate
        </div>
        <div style={{ fontSize: 13, color: "#5b616e", marginTop: 4, lineHeight: 1.6 }}>
          Configure drapery and add equipment or supplies for a live budgetary estimate. When you
          submit it, the {companyName} team reviews and confirms the final numbers — nothing here is
          binding.
        </div>
      </div>
      <EstimateBuilder
        companyName={companyName}
        venues={venues}
        fabrics={fabrics}
        coeffs={coeffs}
        equipment={equipment}
        initialTab={initialTab}
      />
    </PortalShell>
  );
}
