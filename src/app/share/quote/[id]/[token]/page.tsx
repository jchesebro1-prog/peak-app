import type { Metadata } from "next";
import { headers } from "next/headers";
import { clientIpFromHeaders, rateLimit } from "@/lib/rate-limit";
import { resolveSharedQuote, SHARE_VIEW_PER_MIN } from "@/lib/quote-share/links";
import { loadQuoteDocumentProps } from "@/lib/quote-pdf/document-loader";
import { ONLINE_COPY, onlineHeaderLine, onlineView, sharePath } from "@/lib/quote-share/view";
import { OnlineEstimateCard, OnlineEstimateView } from "@/components/online-estimate/online-estimate";
import { isShareTokenV2 } from "@/lib/quote-share/token";
import { SharedPackagePage } from "./package-page";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Estimate", robots: { index: false, follow: false }, referrer: "no-referrer" };

/**
 * The client share page — `/share/quote/[id]/[token]` (#293 slice 3, spec
 * §5.3, §7). No login: the middleware exempts share/, and the page never
 * reads or sets a session. Order: per-IP rate limit (no client IP = one
 * fixed "unknown" key) → resolveSharedQuote (shape check with no read → get →
 * HMAC verify → online state). Valid + ok: the latest SENT version, pinned
 * by revision, layout="web", the Narrative / BOM links, the closed banner
 * when lost, and no PDF link. Valid + revising: the being-revised card.
 * Anything else — bad, expired, revoked or tampered token, unknown id, never
 * sent, or a loader that fails closed — the ONE "isn't active" card, 200.
 * Read-only: no view tracking here (#301 slice B: a v2 package page records opens through its client beacon only).
 */
export default async function SharedQuotePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id, token }, sp] = await Promise.all([params, searchParams]);
  const ip = clientIpFromHeaders(await headers()) || "unknown";
  if (!rateLimit("share-view:" + ip, SHARE_VIEW_PER_MIN, 60_000).ok) return <OnlineEstimateCard title={ONLINE_COPY.tooMany} />;
  // #301 slice B — a v2 (rev-pinned) token opens the estimate package; a v1
  // token keeps #293's page below, unchanged.
  if (isShareTokenV2(token)) return <SharedPackagePage id={id} token={token} view={onlineView(sp.view)} />;
  const hit = await resolveSharedQuote(id, token);
  if (hit?.state.kind === "revising") return <OnlineEstimateCard title={ONLINE_COPY.revising} />;
  const ok = hit && hit.state.kind === "ok" ? { q: hit.q, rev: hit.state.rev, closed: hit.state.closed } : null;
  const base = ok ? sharePath(ok.q.id, token) : "";
  // The loader fails closed (null) unless given this quote's own sent revision.
  const docProps = ok
    ? await loadQuoteDocumentProps(ok.q, {
        revision: ok.rev,
        photos: { href: (docId) => `${base}/photo/${encodeURIComponent(docId)}` },
      })
    : null;
  if (!ok || !docProps) return <OnlineEstimateCard title={ONLINE_COPY.shareInactive} />;
  return (
    <OnlineEstimateView
      docProps={docProps}
      view={onlineView(sp.view)}
      headerLine={onlineHeaderLine(ok.q, ok.rev)}
      closed={ok.closed}
      narrativeHref={base}
      bomHref={base + "?view=bom"}
      pdfHref={null}
      backHref={null}
    />
  );
}
