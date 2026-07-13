import type { Metadata } from "next";
import Link from "next/link";
import { getSettings } from "@/lib/settings";
import { portalSession } from "@/lib/portal";
import { get as getCustomer } from "@/lib/stores/customers";
import { PortalShell } from "../shell";
import { RequestForm } from "./request-form";

export const dynamic = "force-dynamic";

/**
 * Portal QUOTE REQUEST (IDEAS #47) — the signed-in counterpart of the public
 * lead-intake form. Because the requester is a known contact at a known
 * customer, the request lands in the Leads pipeline already linked to the
 * customer record (source "existing", unassigned → the SLA response queue)
 * instead of arriving as a stranger.
 */

export async function generateMetadata(): Promise<Metadata> {
  const s = await getSettings();
  return { title: `Request a quote — ${s.companyName || "Peak Systems Group"}` };
}

function one(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] ?? "" : v ?? "";
}

export default async function PortalRequestPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [sp, settings, session] = await Promise.all([
    searchParams,
    getSettings(),
    portalSession(),
  ]);
  const companyName = settings.companyName || "Peak Systems Group";

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
            Open the personal access link {companyName} sent you, then request a quote from your
            dashboard.
          </div>
        </div>
      </PortalShell>
    );
  }

  const cust = await getCustomer(session.customerId);
  const venues = (cust?.locations || []).map((l) => ({
    id: l.id || "",
    label: l.label || "Venue",
    place: [l.city, l.state].filter(Boolean).join(", "),
  }));
  const err = one(sp.err);

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
          Request a quote
        </div>
        <div style={{ fontSize: 13, color: "#5b616e", marginTop: 4, lineHeight: 1.6 }}>
          Tell us what you need and the {companyName} team will follow up — requests from the
          portal skip the front desk and go straight into our response queue.
        </div>
      </div>
      <RequestForm
        venues={venues}
        requester={{ name: session.name, email: session.email }}
        showDetailsError={err === "details"}
      />
    </PortalShell>
  );
}
