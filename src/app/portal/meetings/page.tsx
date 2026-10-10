import type { Metadata } from "next";
import Link from "next/link";
import { getSettings } from "@/lib/settings";
import { get as getCustomer } from "@/lib/stores/customers";
import { getCart } from "@/lib/stores/portal-carts";
import { portalMeetings } from "@/lib/meetings/portal";
import { resolvePortalViewer } from "@/lib/portal-viewer";
import { PortalShell } from "../shell";
import { PortalSignedOut } from "../signed-out";
import { portalNav } from "../nav";

export const dynamic = "force-dynamic";

/**
 * Portal MEETING NOTES — `/portal/meetings` (#323 K3, spec "UI → Elsewhere").
 * The meetings Peak explicitly shared with this customer ("Share with
 * customer…" in the meeting reader): title, date and the summary staff edited
 * before sharing — never the transcript, the people in it, its to-dos or its
 * links. Always in the nav, even when nothing is shared yet.
 *
 * SECURITY: the customer comes from the portal session only (portalSession()
 * via resolvePortalViewer, which also serves a team member's ?preview=), and
 * the list is `portalMeetings(customerId)` — shared AND linked to that
 * customer, checked in SQL and again through portalCanSee.
 */

export async function generateMetadata(): Promise<Metadata> {
  const s = await getSettings();
  return { title: `Meeting notes — ${s.companyName || "Peak Systems Group"}` };
}

function one(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] ?? "" : v ?? "";
}

const TZ = "America/Chicago";
const DAY = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric", year: "numeric" });

export default async function PortalMeetingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [sp, settings] = await Promise.all([searchParams, getSettings()]);
  const companyName = settings.companyName || "Peak Systems Group";
  const previewCid = one(sp.preview);
  // portalSession() is the only source of the customer (a team ?preview= resolves through the same helper)
  const { session, preview } = await resolvePortalViewer(previewCid);

  if (!session) {
    return (
      <PortalShell companyName={companyName} logoLight={settings.logoLight || null}>
        <PortalSignedOut companyName={companyName} />
      </PortalShell>
    );
  }

  const cid = session.customerId;
  const [cust, meetings, cart] = await Promise.all([
    getCustomer(cid),
    portalMeetings(cid),
    // The nav's Cart (N) — never read in a team preview.
    preview ? Promise.resolve(null) : getCart(session.grantId, cid),
  ]);
  const custName = cust?.name || "your organization";

  return (
    <PortalShell
      companyName={companyName}
      logoLight={settings.logoLight || null}
      person={{ name: session.name, customer: custName }}
      nav={portalNav("meetings", preview ? { previewCid: cid } : { cartCount: cart?.lines.length ?? 0 })}
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
            Team preview — the meeting notes shared with {custName}, read-only.
          </div>
          <Link href={`/customers/${cid}`} style={{ fontSize: 12, fontWeight: 600, color: "#8a6d1f", textDecoration: "none", whiteSpace: "nowrap" }}>
            ← Back to customer record
          </Link>
        </div>
      )}

      <div style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-.015em" }}>Meeting notes</div>
        <div style={{ fontSize: 13, color: "#5b616e", marginTop: 4 }}>
          Summaries of our meetings with {custName}, shared by the {companyName} team.
        </div>
      </div>

      <div
        style={{
          background: "#fff",
          border: "1px solid #e4e7ec",
          borderRadius: 14,
          boxShadow: "0 1px 2px rgba(0,0,0,.04)",
          overflow: "hidden",
          marginBottom: 18,
        }}
      >
        {meetings.map((m, i) => (
          <article key={m.id} style={{ padding: "16px 20px", borderTop: i ? "1px solid #f0f1f4" : undefined }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>{m.title || "Meeting"}</h2>
              {m.startedAt != null && (
                <span style={{ fontSize: 12, color: "#8c919c", whiteSpace: "nowrap" }}>{DAY.format(m.startedAt)}</span>
              )}
            </div>
            <div style={{ marginTop: 8, fontSize: 13, color: "#3a3f4a", lineHeight: 1.55 }}>
              {m.summary
                .split(/\n{2,}/)
                .map((para) => para.trim())
                .filter(Boolean)
                .map((para, j) => (
                  <p key={j} style={{ margin: j ? "8px 0 0" : 0, whiteSpace: "pre-wrap" }}>
                    {para}
                  </p>
                ))}
            </div>
          </article>
        ))}
        {meetings.length === 0 && (
          <div style={{ padding: "26px 20px", fontSize: 12.5, color: "#9aa0ab", textAlign: "center" }}>
            No meeting notes have been shared with you yet.
          </div>
        )}
      </div>
    </PortalShell>
  );
}
