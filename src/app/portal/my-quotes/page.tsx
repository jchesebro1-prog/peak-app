import type { Metadata } from "next";
import Link from "next/link";
import type { CSSProperties } from "react";
import { getSettings } from "@/lib/settings";
import { displayQuoteNumber } from "@/lib/estimate-number";
import { get as getCustomer } from "@/lib/stores/customers";
import { getAll as allQuotes, portalListsQuote } from "@/lib/stores/quotes";
import { getCart } from "@/lib/stores/portal-carts";
import { activeDocumentCategories, resolveDocumentCategories } from "@/lib/document-categories";
import { isCustomerBuiltQuote } from "@/lib/portal-quote-names";
import { myQuotesView, parseMyQuotesFilter, type MyQuotesFilter } from "@/lib/portal-my-quotes";
import { resolvePortalViewer } from "@/lib/portal-viewer";
import { PortalShell } from "../shell";
import { PortalSignedOut } from "../signed-out";
import { portalNav } from "../nav";
import { PortalQuoteRow } from "../quote-row";

export const dynamic = "force-dynamic";
/** #222/#245: Refresh pricing and Rename (#288) schedule the quote's saved
 *  PDF, which renders in after() — a page's maxDuration is its Server
 *  Actions' budget. */
export const maxDuration = 120;

/**
 * Portal MY QUOTES — `/portal/my-quotes` (#288, spec §1.5). The quotes the
 * customer built here (catalog cart, service intake, the legacy estimate
 * builder): Open (default) · Accepted · Closed, newest first, each the same
 * row Home uses plus its type and a ✎ Rename while renamable. Generate lands
 * here (`?generated=firm|review&q=<id>`) with the banner Home used to show.
 *
 * SECURITY: the customer comes from `resolvePortalViewer` only; the list is
 * `myQuotesView` (portalListsQuote ∩ isCustomerBuiltQuote). A team preview
 * renders read-only — no Rename, no row actions.
 */

export async function generateMetadata(): Promise<Metadata> {
  const s = await getSettings();
  return { title: `My quotes — ${s.companyName || "Peak Systems Group"}` };
}

function one(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] ?? "" : v ?? "";
}

const FILTER_LABEL: Record<MyQuotesFilter, string> = { open: "Open", accepted: "Accepted", closed: "Closed" };

const BANNER_OK: CSSProperties = {
  marginBottom: 18,
  padding: "14px 16px",
  background: "#eaf6ef",
  border: "1px solid #cce9da",
  borderRadius: 10,
  fontSize: 13,
  color: "#1f7a52",
  fontWeight: 600,
};

const LINK: CSSProperties = { fontWeight: 600, color: "var(--accent)", textDecoration: "none" };

export default async function PortalMyQuotesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [sp, settings] = await Promise.all([searchParams, getSettings()]);
  const companyName = settings.companyName || "Peak Systems Group";
  const previewCid = one(sp.preview);
  const { session, preview } = await resolvePortalViewer(previewCid);

  if (!session) {
    return (
      <PortalShell companyName={companyName} logoLight={settings.logoLight || null}>
        <PortalSignedOut companyName={companyName} />
      </PortalShell>
    );
  }

  const cid = session.customerId;
  const filter = parseMyQuotesFilter(one(sp.show));
  const accepted = one(sp.accepted) === "1";
  const fileWarn = one(sp.filewarn) === "1";
  const copyErr = one(sp.copyerr) === "1";
  // #245 → #288: Generate lands here — ?generated=firm|review&q=<quote id>.
  const generatedRaw = one(sp.generated);
  const generated = generatedRaw === "firm" || generatedRaw === "review" ? generatedRaw : null;
  const generatedId = one(sp.q);

  const [cust, quotes, cart] = await Promise.all([
    getCustomer(cid),
    allQuotes(),
    // The nav's Cart (N) — never read in a team preview.
    preview ? Promise.resolve(null) : getCart(session.grantId, cid),
  ]);
  const custName = cust?.name || "your organization";
  const view = myQuotesView(quotes, cid, filter);
  // The banner names the generated quote's estimate number — looked up among
  // THIS customer's listed, customer-built quotes only, so a hand-edited ?q=
  // shows nothing.
  const generatedQuote =
    generated && generatedId ? quotes.find((q) => q.id === generatedId && isCustomerBuiltQuote(q) && portalListsQuote(q, cid)) ?? null : null;
  const generatedNo = generatedQuote ? displayQuoteNumber(generatedQuote) : "";

  const acceptCategories = activeDocumentCategories(resolveDocumentCategories(settings.documentCategories)).map((c) => ({
    key: c.key,
    label: c.label,
  }));
  const pv = preview ? `preview=${encodeURIComponent(cid)}` : "";
  const filterHref = (f: MyQuotesFilter) => {
    const qs = [f === "open" ? "" : `show=${f}`, pv].filter(Boolean).join("&");
    return "/portal/my-quotes" + (qs ? "?" + qs : "");
  };
  const catalogHref = "/portal/catalog" + (pv ? "?" + pv : "");
  const serviceHref = "/portal/service" + (pv ? "?" + pv : "");

  return (
    <PortalShell
      companyName={companyName}
      logoLight={settings.logoLight || null}
      person={{ name: session.name, customer: custName }}
      nav={portalNav("my-quotes", preview ? { previewCid: cid } : { cartCount: cart?.lines.length ?? 0 })}
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
            Team preview — {custName}&rsquo;s own quotes, read-only.
          </div>
          <Link href={`/customers/${cid}`} style={{ fontSize: 12, fontWeight: 600, color: "#8a6d1f", textDecoration: "none", whiteSpace: "nowrap" }}>
            ← Back to customer record
          </Link>
        </div>
      )}

      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 14, flexWrap: "wrap", marginBottom: 18 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-.015em" }}>My quotes</div>
          <div style={{ fontSize: 13, color: "#5b616e", marginTop: 4 }}>
            Quotes you&rsquo;ve built here — from the{" "}
            <Link href={catalogHref} style={LINK}>
              Catalog
            </Link>{" "}
            or{" "}
            <Link href={serviceHref} style={LINK}>
              Service
            </Link>
            .
          </div>
        </div>
      </div>

      {generated && (
        <div style={BANNER_OK}>
          {generated === "firm"
            ? `Your quote ${generatedNo ? generatedNo + " " : ""}is ready — open the PDF or accept it below.`
            : `Thanks — Peak will confirm pricing on ${generatedNo || "your quote"} and let you know.`}
        </div>
      )}
      {accepted && (
        <div style={BANNER_OK}>
          Thanks — we&rsquo;ve flagged your acceptance for the {companyName} team. They&rsquo;ll confirm and get scheduling underway;
          nothing is final until they do.
          {fileWarn && (
            <div style={{ marginTop: 6, fontWeight: 500 }}>Your file didn&rsquo;t attach — you can email it to us, or try again from the quote.</div>
          )}
        </div>
      )}
      {copyErr && (
        <div style={{ ...BANNER_OK, background: "#fdf0ee", border: "1px solid #f3d2cc", color: "#a33a2b" }}>
          Couldn&rsquo;t copy that quote — try again, or call us.
        </div>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }} role="tablist" aria-label="Filter quotes">
        {(["open", "accepted", "closed"] as const).map((f) => {
          const on = f === view.filter;
          return (
            <Link
              key={f}
              href={filterHref(f)}
              role="tab"
              aria-selected={on}
              style={{
                font: "600 12.5px var(--font-ui)",
                padding: "8px 14px",
                borderRadius: 20,
                border: on ? "1px solid var(--accent)" : "1px solid #e4e7ec",
                background: on ? "var(--accent)" : "#fff",
                color: on ? "#fff" : "#5b616e",
                textDecoration: "none",
              }}
            >
              {FILTER_LABEL[f]} <span style={{ fontFamily: "var(--font-mono)", opacity: 0.8 }}>{view.counts[f]}</span>
            </Link>
          );
        })}
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
        {view.rows.map((r) => (
          <PortalQuoteRow key={r.q.id} q={r.q} cid={cid} preview={preview} acceptCategories={acceptCategories} mine={{ renamable: r.renamable }} />
        ))}
        {view.rows.length === 0 && (
          <div style={{ padding: "26px 20px", fontSize: 12.5, color: "#9aa0ab", textAlign: "center" }}>
            {view.filter === "open" ? (
              <>
                No open quotes — build one from the{" "}
                <Link href={catalogHref} style={LINK}>
                  Catalog
                </Link>{" "}
                or{" "}
                <Link href={serviceHref} style={LINK}>
                  Service
                </Link>
                .
              </>
            ) : view.filter === "accepted" ? (
              "No accepted quotes yet."
            ) : (
              "No closed quotes."
            )}
          </div>
        )}
      </div>
    </PortalShell>
  );
}
