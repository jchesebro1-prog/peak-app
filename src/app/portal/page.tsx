import type { Metadata } from "next";
import Link from "next/link";
import { getSettings } from "@/lib/settings";
import { displayQuoteNumber } from "@/lib/estimate-number";
import { get as getCustomer } from "@/lib/stores/customers";
import { getAll as allQuotes, portalListsQuote, type Quote } from "@/lib/stores/quotes";
import { canAcceptPortal } from "@/lib/portal-quote-mode";
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
import { PortalSignedOut } from "./signed-out";
import { portalNav } from "./nav";
import { getCart } from "@/lib/stores/portal-carts";
import { copyQuoteToCart } from "./actions";
import { AcceptDialog } from "./accept-dialog";
import { RefreshPricingButton } from "./refresh-pricing-button";
import { documentsForCustomer } from "@/lib/stores/documents";
import { activeDocumentCategories, resolveDocumentCategories } from "@/lib/document-categories";
import { groupForPortal } from "@/lib/document-rules";
import { PortalDocumentsSection } from "./documents-section";
import { resolvePortalViewer } from "@/lib/portal-viewer";
import { portalQuotePdfPreparing, portalQuotePdfSource } from "@/lib/quote-pdf/portal-access";
import { latestSentRevision, pdfView } from "@/lib/quote-pdf/state";
import { groupPortalProjects, groupPortalQuotes, isAppEraProject, portalProjectView } from "@/lib/portal-projects";
import { getAllProjects } from "@/lib/stores/projects";

export const dynamic = "force-dynamic";
/** #222/#245: Refresh pricing → refreshPortalQuote → scheduleQuotePdf renders
 *  in after() — a page's maxDuration is its Server Actions' budget. */
export const maxDuration = 120;

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

const GROUP_HEAD: React.CSSProperties = {
  padding: "9px 20px 5px",
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: ".06em",
  textTransform: "uppercase",
  color: "#9aa0ab",
  background: "#fafbfc",
  borderBottom: "1px solid #f0f1f4",
};

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

/**
 * #222: whether a row with no PDF to open says "Document being prepared" —
 * only while a copy can still arrive: a sent revision awaiting its copy
 * (portalQuotePdfPreparing, the same predicate the PDF route uses), or a
 * never-sent estimate whose render is still in flight (not stale). Anything
 * else reads "PDF not available — contact your rep".
 */
function pdfPreparing(q: Quote, cid: string): boolean {
  if (portalQuotePdfPreparing(q, cid)) return true;
  return !latestSentRevision(q.revisions) && pdfView(q.pdf, Date.now())?.status === "pending";
}

/** #245: a firm portal quote's validity date while it lasts (sent, not yet
 *  accepted, not past `validUntil`); null otherwise. */
function firmValidUntil(q: Quote): number | null {
  if (q.status !== "sent" || q.portalAcceptance || !q.portalFirm) return null;
  return Date.now() <= q.portalFirm.validUntil ? q.portalFirm.validUntil : null;
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
  // #245 Task 13: the Accept dialog's PO file failed to attach — the
  // acceptance itself still went through (controller decision 5).
  const fileWarn = one(sp.filewarn) === "1";
  // #245 Task 13: Copy to new quote refused (expired grant, rate limit, or
  // the quote wasn't found for this session) — a plain form, so it redirects
  // with a query param rather than returning a value to display inline.
  const copyErr = one(sp.copyerr) === "1";
  // #245: Generate lands here — ?generated=firm|review&q=<quote id>.
  const generatedRaw = one(sp.generated);
  const generated = generatedRaw === "firm" || generatedRaw === "review" ? generatedRaw : null;
  const generatedId = one(sp.q);

  // Team-gated PREVIEW (?preview=<customerId>): resolvePortalViewer is the one
  // rule, shared with the portal PDF route (#222) so a preview opens PDFs too.
  const previewCid = one(sp.preview);
  const { session, preview } = await resolvePortalViewer(previewCid);

  /* -------- signed out / invalid link -------- */
  if (!session) {
    return (
      <PortalShell companyName={companyName} logoLight={settings.logoLight || null}>
        <PortalSignedOut companyName={companyName} denied={denied} />
      </PortalShell>
    );
  }

  /* -------- tenant-scoped data (customerId comes from the grant ONLY) -------- */
  const cid = session.customerId;
  const [cust, quotes, leads, fRenewals, iRenewals, projects, cart] = await Promise.all([
    getCustomer(cid),
    allQuotes(),
    allLeads(),
    flameRenewals({}),
    inspectionRenewals({}),
    getAllProjects(),
    // #245: the nav's Quote (N) — never read in a team preview.
    preview ? Promise.resolve(null) : getCart(session.grantId, cid),
  ]);
  const custName = cust?.name || "your organization";
  const venues = cust?.locations || [];

  // #218 — documents: the viewer's company only (portal session, or the team
  // preview's customer via resolvePortalViewer), and only what the portal may
  // show (portalCanSee inside documentsForCustomer's portal filter).
  const docCategories = resolveDocumentCategories(settings.documentCategories);
  const docVenues = venues.flatMap((v) => (v.id ? [{ id: v.id, label: v.label || "Venue" }] : []));
  const docGroups = groupForPortal(
    await documentsForCustomer(cid, { portal: true }),
    cid,
    docCategories,
    docVenues
  );

  // Published quotes the team sent, PLUS the customer's own portal quotes still
  // in draft (#245 "portal-catalog" review quotes, and older "portal-self-serve"
  // estimates) so they can see what they submitted. Internal drafts stay
  // hidden — only the customer's own drafts — and so does imported Daylite
  // history (portalListsQuote, stores/quotes).
  const published = quotes
    .filter((q) => portalListsQuote(q, cid))
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const quoteGroups = groupPortalQuotes(published);
  // #245: the banner names the generated quote's estimate number — looked up
  // among THIS customer's listed quotes only, so a hand-edited ?q= shows nothing.
  const generatedQuote = generated && generatedId ? published.find((q) => q.id === generatedId) ?? null : null;
  const generatedNo = generatedQuote ? displayQuoteNumber(generatedQuote) : "";

  // #220: project history, app-era only (never Daylite imports), through the
  // portalProjectView whitelist — value only when known and the quote is won.
  // Only this customer's quotes (#222 final wave B): a project's quoteId is
  // never trusted to point inside the tenant.
  const quoteStatusById = new Map(quotes.filter((q) => q.customerId === cid).map((q) => [q.id, q.status]));
  const venueNameOf = (locationId: string | null) => {
    const l = locationId ? venues.find((v) => v.id === locationId) : undefined;
    return l ? l.label || l.locationName || "" : "";
  };
  const projectGroups = groupPortalProjects(
    projects
      .filter((p) => p.customerId === cid && isAppEraProject(p))
      .map((p) =>
        portalProjectView(p, {
          venueName: venueNameOf(p.locationId),
          quoteStatus: p.quoteId ? quoteStatusById.get(p.quoteId) ?? null : null,
        })
      )
  );

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

  const acceptCategories = activeDocumentCategories(docCategories).map((c) => ({ key: c.key, label: c.label }));

  const quoteRow = (q: (typeof published)[number]) => {
    const isDraft = q.status === "draft"; // only the customer's own self-serve drafts reach here
    const pendingAccept = q.status === "sent" && !!q.portalAcceptance;
    const acceptGate = canAcceptPortal(q, Date.now());
    const isExpired = q.status === "sent" && !q.portalAcceptance && acceptGate.reason === "expired";
    const canAccept = acceptGate.ok && !preview;
    const firmUntil = firmValidUntil(q);
    const chip = isDraft
      ? q.source === "portal-catalog" && q.portalReview
        ? { label: "In review — Peak will confirm pricing", ink: "#8a6d1f", soft: "#fbf3dd", bd: "#f0e2bd" }
        : { label: "In review with our team", ink: "#8a6d1f", soft: "#fbf3dd", bd: "#f0e2bd" }
      : isExpired
      ? { label: "Pricing expired", ink: "#a33a2b", soft: "#fdf0ee", bd: "#f3d2cc" }
      : firmUntil != null
      ? { label: "Valid until " + fmtDate(firmUntil), ink: "#3155a8", soft: "#e9eefb", bd: "#d4ddf3" }
      : pendingAccept
      ? { label: "Accepted — awaiting confirmation", ink: "#8a6d1f", soft: "#fbf3dd", bd: "#f0e2bd" }
      : QUOTE_CHIP[q.status] || QUOTE_CHIP.sent;
    // #222: the saved PDF (latest sent revision's copy, else the ready file).
    const pdfHref = portalQuotePdfSource(q, cid)
      ? `/portal/quotes/${encodeURIComponent(q.id)}/pdf` + (preview ? `?preview=${encodeURIComponent(cid)}` : "")
      : null;
    return (
      <div key={q.id} style={{ borderBottom: "1px solid #f5f6f8" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0,1fr) 96px auto",
            gap: 12,
            alignItems: "center",
            padding: "13px 20px 8px",
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {pdfHref ? (
                <a href={pdfHref} target="_blank" rel="noopener noreferrer" style={{ color: "inherit", textDecoration: "none" }}>
                  {q.name}
                </a>
              ) : (
                q.name
              )}
            </div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "#aab0bb", marginTop: 2 }}>
              {displayQuoteNumber(q) + " · " + fmtDate(q.updatedAt)}
            </div>
            <div style={{ fontSize: 11.5, marginTop: 3 }}>
              {pdfHref ? (
                <a href={pdfHref} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)", fontWeight: 600, textDecoration: "none" }}>
                  Open PDF ↗
                </a>
              ) : pdfPreparing(q, cid) ? (
                <span style={{ color: "#9aa0ab" }}>Document being prepared</span>
              ) : (
                <span style={{ color: "#9aa0ab" }}>PDF not available — contact your rep</span>
              )}
            </div>
          </div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 600, textAlign: "right" }}>{money(q.value)}</div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "flex-end" }}>
              <Chip c={chip} />
              {canAccept && (
                <AcceptDialog quoteId={q.id} customerId={cid} categories={acceptCategories} disabled={preview} />
              )}
            </div>
            {isExpired && !preview && <RefreshPricingButton quoteId={q.id} />}
          </div>
        </div>
        {(q.portalDecline || q.source === "portal-catalog") && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              padding: "0 20px 12px",
              flexWrap: "wrap",
            }}
          >
            <div style={{ fontSize: 12, color: "#8c919c" }}>
              {q.portalDecline ? "Peak: " + q.portalDecline.note : ""}
            </div>
            {q.source === "portal-catalog" && !preview && (
              <form action={copyQuoteToCart.bind(null, q.id)}>
                <button
                  type="submit"
                  style={{
                    fontFamily: "var(--font-ui)",
                    fontSize: 11.5,
                    fontWeight: 600,
                    color: "var(--accent)",
                    background: "none",
                    border: "none",
                    padding: 0,
                    cursor: "pointer",
                    textDecoration: "underline",
                  }}
                >
                  Copy to new quote
                </button>
              </form>
            )}
          </div>
        )}
      </div>
    );
  };

  const projectRow = (v: (typeof projectGroups.active)[number]) => {
    const when =
      v.start || v.end
        ? [v.start ? fmtDate(v.start) : "", v.end ? fmtDate(v.end) : ""].filter(Boolean).join(" – ")
        : v.target
        ? "Target " + fmtDate(v.target)
        : "";
    return (
      <div
        key={v.id}
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
          <div style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{v.name}</div>
          <div style={{ fontSize: 11.5, color: "#9aa0ab", marginTop: 2 }}>{[v.venue, v.type, when].filter(Boolean).join(" · ")}</div>
        </div>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 600, textAlign: "right" }}>
          {v.value != null ? money(v.value) : ""}
        </div>
        <Chip
          c={
            v.done
              ? { label: v.stage || "Complete", ink: "#1f7a52", soft: "#eaf6ef", bd: "#cce9da" }
              : { label: v.stage || "In progress", ink: "#3155a8", soft: "#e9eefb", bd: "#d4ddf3" }
          }
        />
      </div>
    );
  };

  return (
    <PortalShell
      companyName={companyName}
      logoLight={settings.logoLight || null}
      person={{ name: session.name, customer: custName }}
      nav={portalNav("home", preview ? { previewCid: cid } : { cartCount: cart?.lines.length ?? 0 })}
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
              <Link href={`/portal/catalog?preview=${encodeURIComponent(cid)}`} style={CTA_SECONDARY}>
                Shop the catalog
              </Link>
              <span title="Disabled in preview" style={{ ...CTA_PRIMARY, opacity: 0.45, cursor: "not-allowed" }}>
                + Request a quote
              </span>
            </>
          ) : (
            <>
              <Link href="/portal/catalog" style={CTA_SECONDARY}>
                Shop the catalog
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
      {generated && (
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
          {generated === "firm"
            ? `Your quote ${generatedNo ? generatedNo + " " : ""}is ready — open the PDF or accept it below.`
            : `Thanks — Peak will confirm pricing on ${generatedNo || "your quote"} and let you know.`}
        </div>
      )}
      {copyErr && (
        <div
          style={{
            marginBottom: 18,
            padding: "14px 16px",
            background: "#fdf0ee",
            border: "1px solid #f3d2cc",
            borderRadius: 10,
            fontSize: 13,
            color: "#a33a2b",
            fontWeight: 600,
          }}
        >
          Couldn’t copy that quote — try again, or call us.
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
          {fileWarn && (
            <div style={{ marginTop: 6, fontWeight: 500 }}>
              Your file didn’t attach — you can email it to us, or try again from the quote.
            </div>
          )}
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

      {/* quotes — #220: Open (sent, your own drafts) + History (won, lost); each opens its saved PDF (#222) */}
      <div style={CARD}>
        <div style={CARD_HEAD}>
          <div style={{ fontSize: 14.5, fontWeight: 600 }}>Your quotes &amp; estimates</div>
          <div style={{ fontSize: 11.5, color: "#9aa0ab" }}>estimates you&#39;ve submitted and quotes from {companyName}</div>
        </div>
        {quoteGroups.open.length > 0 && (
          <div>
            <div style={GROUP_HEAD}>Open</div>
            {quoteGroups.open.map(quoteRow)}
          </div>
        )}
        {quoteGroups.history.length > 0 && (
          <div>
            <div style={GROUP_HEAD}>History</div>
            {quoteGroups.history.map(quoteRow)}
          </div>
        )}
        {published.length === 0 && (
          <div style={{ padding: "22px 20px", fontSize: 12.5, color: "#9aa0ab", textAlign: "center" }}>
            Nothing here yet — quotes you generate from the catalog, and anything we send you, will appear here.
          </div>
        )}
      </div>

      {/* projects — #220: app-era only, Active + History */}
      <div style={CARD}>
        <div style={CARD_HEAD}>
          <div style={{ fontSize: 14.5, fontWeight: 600 }}>Your projects</div>
          <div style={{ fontSize: 11.5, color: "#9aa0ab" }}>
            {projectGroups.active.length ? projectGroups.active.length + " active" : "none active"}
          </div>
        </div>
        {projectGroups.active.length > 0 && (
          <div>
            <div style={GROUP_HEAD}>Active</div>
            {projectGroups.active.map(projectRow)}
          </div>
        )}
        {projectGroups.history.length > 0 && (
          <div>
            <div style={GROUP_HEAD}>History</div>
            {projectGroups.history.map(projectRow)}
          </div>
        )}
        {projectGroups.active.length + projectGroups.history.length === 0 && (
          <div style={{ padding: "22px 20px", fontSize: 12.5, color: "#9aa0ab", textAlign: "center" }}>
            No projects yet — work we take on for you will appear here.
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

      {/* documents (#218) — shared files + the customer's own uploads, both ways;
          the team preview downloads through the team route and can't upload */}
      <PortalDocumentsSection
        groups={docGroups}
        preview={preview}
        customerId={cid}
        venues={docVenues}
        categories={activeDocumentCategories(docCategories).map((c) => ({ key: c.key, label: c.label }))}
        companyName={companyName}
      />
    </PortalShell>
  );
}
