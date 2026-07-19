import type { Metadata } from "next";
import Link from "next/link";
import { getSettings } from "@/lib/settings";
import { portalSession, type PortalSession } from "@/lib/portal";
import { getOptionalUser } from "@/lib/session";
import { get as getCustomer } from "@/lib/stores/customers";
import { getAll as allQuotes } from "@/lib/stores/quotes";
import { getAll as allLeads, OPEN_STAGES, type LeadStage } from "@/lib/stores/leads";
import {
  renewals as flameRenewals,
  renewalMeta as flameRenewalMeta,
  dueLabel as flameDueLabel,
  fmtShort as fmtShortMs,
} from "@/lib/stores/flame-jobs";
import {
  renewals as inspectionRenewals,
  renewalMeta as inspRenewalMeta,
  dueLabel as inspDueLabel,
  levelMeta,
  fmtShort as fmtShortIso,
} from "@/lib/stores/inspections";
import { PortalShell } from "./shell";
import { acceptPortalQuote } from "./actions";

export const dynamic = "force-dynamic";

/**
 * Customer PORTAL dashboard (IDEAS #47 phase 1 + the quote-request slice of
 * phase 2) — the signed-in self-serve side of Peak. Everything on this page
 * is scoped to the grant's customerId via portalSession(); customers see
 * PUBLISHED quotes only (sent / accepted / declined — never drafts, and
 * never internal pricing internals), their venues, their compliance clocks
 * (flame annual · inspection L1/L2), and their open requests.
 */

export async function generateMetadata(): Promise<Metadata> {
  const s = await getSettings();
  return { title: `Customer portal — ${s.companyName || "Peak Systems Group"}` };
}

function one(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] ?? "" : v ?? "";
}

function money(n: number | null | undefined): string {
  return "$" + Math.round(n || 0).toLocaleString("en-US");
}

function fmtDate(ms: number | null | undefined): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Customer-facing quote status (published pipeline states only). */
const QUOTE_CHIP: Record<string, { label: string; ink: string; soft: string; bd: string }> = {
  sent: { label: "Awaiting your review", ink: "#3155a8", soft: "#e9eefb", bd: "#d4ddf3" },
  won: { label: "Accepted", ink: "#1f7a52", soft: "#eaf6ef", bd: "#cce9da" },
  lost: { label: "Declined", ink: "#8c919c", soft: "#f1f2f5", bd: "#e4e7ec" },
};

const CARD: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #e4e7ec",
  borderRadius: 14,
  boxShadow: "0 1px 2px rgba(0,0,0,.04)",
  overflow: "hidden",
  marginBottom: 18,
};

const CARD_HEAD: React.CSSProperties = {
  padding: "15px 20px 12px",
  borderBottom: "1px solid #f0f1f4",
  display: "flex",
  alignItems: "baseline",
  justifyContent: "space-between",
  gap: 12,
};

const CTA_PRIMARY: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 7,
  fontSize: 13.5,
  fontWeight: 600,
  color: "#fff",
  background: "var(--accent)",
  borderRadius: 10,
  padding: "12px 18px",
  textDecoration: "none",
};

const CTA_SECONDARY: React.CSSProperties = {
  ...CTA_PRIMARY,
  color: "var(--accent)",
  background: "#fff",
  border: "1px solid var(--accent)",
};

function Chip({ c }: { c: { label: string; ink: string; soft: string; bd: string } }) {
  return (
    <span
      style={{
        display: "inline-block",
        fontSize: 9.5,
        fontWeight: 700,
        letterSpacing: ".04em",
        textTransform: "uppercase",
        color: c.ink,
        background: c.soft,
        border: `1px solid ${c.bd}`,
        padding: "2px 8px",
        borderRadius: 5,
        whiteSpace: "nowrap",
      }}
    >
      {c.label}
    </span>
  );
}

export default async function PortalPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [sp, settings] = await Promise.all([searchParams, getSettings()]);
  const companyName = settings.companyName || "Peak Systems Group";
  const denied = one(sp.denied) === "1";
  const sent = one(sp.sent) === "1";
  const accepted = one(sp.accepted) === "1";
  const estimate = one(sp.estimate) === "1";

  // Team-gated PREVIEW: a signed-in team member can view a customer's portal as
  // that customer would see it (from the customer record's "Preview portal"
  // button, ?preview=<customerId>). Takes precedence over any stale portal
  // cookie so the team member always previews the requested customer. A real
  // customer has no team session, so ?preview never grants them anyone's portal.
  const previewCid = one(sp.preview);
  let preview = false;
  let session: PortalSession | null = null;
  if (previewCid) {
    const teamUser = await getOptionalUser();
    if (teamUser) {
      const pc = await getCustomer(previewCid);
      if (pc) {
        const primary = (pc.contacts || []).find((c) => c.primary) || (pc.contacts || [])[0];
        session = {
          grantId: "preview",
          customerId: previewCid,
          name: primary?.name || teamUser.name,
          email: primary?.email || "",
        };
        preview = true;
      }
    }
  }
  if (!session) session = await portalSession();

  /* -------- signed out / invalid link -------- */
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
          <div style={{ fontSize: 17, fontWeight: 600 }}>
            {denied ? "That access link didn’t work" : "Sign in with your access link"}
          </div>
          <div style={{ fontSize: 13, color: "#5b616e", lineHeight: 1.65, marginTop: 10 }}>
            {denied
              ? "The link may have expired or been replaced. Ask your " +
                companyName +
                " contact to send you a fresh one — it only takes them a moment."
              : "This portal uses personal access links instead of passwords. Open the link " +
                companyName +
                " sent you and you’ll land right here, signed in. Don’t have one? Ask your " +
                companyName +
                " contact."}
          </div>
        </div>
      </PortalShell>
    );
  }

  /* -------- tenant-scoped data (customerId comes from the grant ONLY) -------- */
  const cid = session.customerId;
  const [cust, quotes, leads, fRenewals, iRenewals] = await Promise.all([
    getCustomer(cid),
    allQuotes(),
    allLeads(),
    flameRenewals({}),
    inspectionRenewals({}),
  ]);
  const custName = cust?.name || "your organization";
  const venues = cust?.locations || [];

  // Published quotes the team sent, PLUS the customer's own self-serve estimates
  // still in draft (source "portal-self-serve") so they can see what they
  // submitted. Internal drafts stay hidden — only the customer's own drafts.
  const published = quotes
    .filter(
      (q) =>
        q.customerId === cid &&
        (q.status !== "draft" || q.source === "portal-self-serve")
    )
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  const requests = leads
    .filter(
      (l) =>
        l.customerId === cid &&
        (OPEN_STAGES as readonly LeadStage[]).includes(l.stage as LeadStage)
    )
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  const flameByVenue = new Map(
    fRenewals.filter((r) => r.customerId === cid).map((r) => [r.locationId || r.venue, r])
  );
  const inspByVenueLevel = new Map(
    iRenewals
      .filter((r) => r.customerId === cid)
      .map((r) => [(r.locationId || r.venue) + "|" + levelMeta(r.level).key, r])
  );

  return (
    <PortalShell
      companyName={companyName}
      logoLight={settings.logoLight || null}
      person={{ name: session.name, customer: custName }}
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
            Team preview — this is exactly what {custName} sees in their portal. Actions here
            still affect real data.
          </div>
          <Link
            href={`/customers/${cid}`}
            style={{ fontSize: 12, fontWeight: 600, color: "#8a6d1f", textDecoration: "none", whiteSpace: "nowrap" }}
          >
            ← Back to customer record
          </Link>
        </div>
      )}

      {/* header + request CTA */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 14,
          flexWrap: "wrap",
          marginBottom: 20,
        }}
      >
        <div>
          <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-.015em" }}>
            Welcome, {session.name.split(" ")[0]}
          </div>
          <div style={{ fontSize: 13, color: "#5b616e", marginTop: 4 }}>
            Everything {companyName} tracks for {custName} — and a fast lane to request new work.
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", flexShrink: 0 }}>
          {preview ? (
            <>
              <span title="Disabled in preview" style={{ ...CTA_SECONDARY, opacity: 0.45, cursor: "not-allowed" }}>
                Build your own estimate
              </span>
              <span title="Disabled in preview" style={{ ...CTA_PRIMARY, opacity: 0.45, cursor: "not-allowed" }}>
                + Request a quote
              </span>
            </>
          ) : (
            <>
              <Link href="/portal/estimate" style={CTA_SECONDARY}>
                Build your own estimate
              </Link>
              <Link href="/portal/request" style={CTA_PRIMARY}>
                + Request a quote
              </Link>
            </>
          )}
        </div>
      </div>

      {sent && (
        <div
          style={{
            marginBottom: 18,
            padding: "14px 16px",
            background: "#eaf6ef",
            border: "1px solid #cce9da",
            borderRadius: 10,
            fontSize: 13,
            color: "#1f7a52",
            fontWeight: 600,
          }}
        >
          Request received — the {companyName} team has it in their queue and will follow up
          shortly. It also appears under “Your open requests” below.
        </div>
      )}
      {estimate && (
        <div
          style={{
            marginBottom: 18,
            padding: "14px 16px",
            background: "#eaf6ef",
            border: "1px solid #cce9da",
            borderRadius: 10,
            fontSize: 13,
            color: "#1f7a52",
            fontWeight: 600,
          }}
        >
          Estimate received — the {companyName} team will review the numbers and follow up with a
          confirmed quote. It appears under “Your quotes &amp; estimates” below. Nothing is binding
          until they do.
        </div>
      )}
      {accepted && (
        <div
          style={{
            marginBottom: 18,
            padding: "14px 16px",
            background: "#eaf6ef",
            border: "1px solid #cce9da",
            borderRadius: 10,
            fontSize: 13,
            color: "#1f7a52",
            fontWeight: 600,
          }}
        >
          Thanks — we’ve flagged your acceptance for the {companyName} team. They’ll confirm and
          get scheduling underway; nothing is final until they do.
        </div>
      )}

      {/* open requests */}
      <div style={CARD}>
        <div style={CARD_HEAD}>
          <div style={{ fontSize: 14.5, fontWeight: 600 }}>Your open requests</div>
          <div style={{ fontSize: 11.5, color: "#9aa0ab" }}>
            {requests.length ? requests.length + " with our team" : "nothing waiting"}
          </div>
        </div>
        {requests.map((l) => (
          <div
            key={l.id}
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0,1fr) auto",
              gap: 12,
              alignItems: "center",
              padding: "13px 20px",
              borderBottom: "1px solid #f5f6f8",
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>
                {l.interest || "Quote request"}
              </div>
              <div style={{ fontSize: 11.5, color: "#9aa0ab", marginTop: 2 }}>
                {"Sent " + fmtDate(l.createdAt) + (l.contact ? " · " + l.contact : "")}
              </div>
            </div>
            <Chip
              c={
                l.stage === "quoted"
                  ? { label: "Quote on its way", ink: "#1f7a52", soft: "#eaf6ef", bd: "#cce9da" }
                  : { label: "With our team", ink: "#3155a8", soft: "#e9eefb", bd: "#d4ddf3" }
              }
            />
          </div>
        ))}
        {requests.length === 0 && (
          <div style={{ padding: "22px 20px", fontSize: 12.5, color: "#9aa0ab", textAlign: "center" }}>
            No open requests — use “Request a quote” any time you need us.
          </div>
        )}
      </div>

      {/* quotes */}
      <div style={CARD}>
        <div style={CARD_HEAD}>
          <div style={{ fontSize: 14.5, fontWeight: 600 }}>Your quotes &amp; estimates</div>
          <div style={{ fontSize: 11.5, color: "#9aa0ab" }}>
            estimates you&#39;ve submitted and quotes from {companyName}
          </div>
        </div>
        {published.map((q) => {
          const isDraft = q.status === "draft"; // only the customer's own self-serve drafts reach here
          const pendingAccept = q.status === "sent" && !!q.portalAcceptance;
          const canAccept = q.status === "sent" && !q.portalAcceptance && !preview;
          const chip = isDraft
            ? { label: "In review with our team", ink: "#8a6d1f", soft: "#fbf3dd", bd: "#f0e2bd" }
            : pendingAccept
            ? { label: "Accepted — awaiting confirmation", ink: "#8a6d1f", soft: "#fbf3dd", bd: "#f0e2bd" }
            : QUOTE_CHIP[q.status] || QUOTE_CHIP.sent;
          return (
            <div
              key={q.id}
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0,1fr) 96px auto",
                gap: 12,
                alignItems: "center",
                padding: "13px 20px",
                borderBottom: "1px solid #f5f6f8",
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 13.5,
                    fontWeight: 600,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {q.name}
                </div>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "#aab0bb", marginTop: 2 }}>
                  {q.id + " · " + fmtDate(q.updatedAt)}
                </div>
              </div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 600, textAlign: "right" }}>
                {money(q.value)}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "flex-end" }}>
                <Chip c={chip} />
                {canAccept && (
                  <form action={acceptPortalQuote}>
                    <input type="hidden" name="quote" value={q.id} />
                    <button
                      type="submit"
                      title="Accepting lets our team know to move ahead — nothing is final until they confirm."
                      style={{
                        fontFamily: "var(--font-ui)",
                        fontSize: 12,
                        fontWeight: 600,
                        color: "#fff",
                        background: "#1f7a52",
                        border: "none",
                        borderRadius: 8,
                        padding: "8px 12px",
                        cursor: "pointer",
                        whiteSpace: "nowrap",
                      }}
                    >
                      Accept quote
                    </button>
                  </form>
                )}
              </div>
            </div>
          );
        })}
        {published.length === 0 && (
          <div style={{ padding: "22px 20px", fontSize: 12.5, color: "#9aa0ab", textAlign: "center" }}>
            Nothing here yet — build an estimate or anything we send you will appear here.
          </div>
        )}
      </div>

      {/* venues + compliance */}
      <div style={CARD}>
        <div style={CARD_HEAD}>
          <div style={{ fontSize: 14.5, fontWeight: 600 }}>Your venues &amp; compliance</div>
          <div style={{ fontSize: 11.5, color: "#9aa0ab" }}>
            flame tests annual · inspections L1 annual / L2 five-year
          </div>
        </div>
        {venues.map((v) => {
          const vid = v.id || v.label || "";
          const f = flameByVenue.get(vid);
          const i1 = inspByVenueLevel.get(vid + "|1");
          const i2 = inspByVenueLevel.get(vid + "|2");
          return (
            <div key={vid} style={{ padding: "13px 20px", borderBottom: "1px solid #f5f6f8" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <span style={{ fontSize: 13.5, fontWeight: 600 }}>{v.label || "Venue"}</span>
                <span style={{ fontSize: 11.5, color: "#9aa0ab" }}>
                  {[v.city, v.state].filter(Boolean).join(", ")}
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap", marginTop: 8 }}>
                {f ? (
                  <Chip
                    c={{
                      ...flameRenewalMeta(f._renewal.state),
                      label:
                        "Flame test " +
                        (f._renewal.state === "ok" || f._renewal.state === "upcoming"
                          ? "current — last " + fmtShortMs(f.completedAt)
                          : flameDueLabel(f._renewal.days, f._renewal.state)),
                    }}
                  />
                ) : (
                  <Chip c={{ label: "Flame test — no record", ink: "#8c919c", soft: "#f1f2f5", bd: "#e4e7ec" }} />
                )}
                {i1 ? (
                  <Chip
                    c={{
                      ...inspRenewalMeta(i1._renewal.state),
                      label:
                        "Inspection L1 " +
                        (i1._renewal.state === "ok" || i1._renewal.state === "upcoming"
                          ? "current — last " + fmtShortIso(i1.surveyDate)
                          : inspDueLabel(i1._renewal.days, i1._renewal.state)),
                    }}
                  />
                ) : (
                  <Chip c={{ label: "Inspection L1 — no record", ink: "#8c919c", soft: "#f1f2f5", bd: "#e4e7ec" }} />
                )}
                {i2 && (
                  <Chip
                    c={{
                      ...inspRenewalMeta(i2._renewal.state),
                      label:
                        "Inspection L2 " +
                        (i2._renewal.state === "ok" || i2._renewal.state === "upcoming"
                          ? "current — last " + fmtShortIso(i2.surveyDate)
                          : inspDueLabel(i2._renewal.days, i2._renewal.state)),
                    }}
                  />
                )}
              </div>
            </div>
          );
        })}
        {venues.length === 0 && (
          <div style={{ padding: "22px 20px", fontSize: 12.5, color: "#9aa0ab", textAlign: "center" }}>
            No venues on file yet — mention your venue in a quote request and we’ll add it.
          </div>
        )}
      </div>
    </PortalShell>
  );
}
