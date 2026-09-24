import type { AlertRow } from "@/app/(app)/home-needs-attention";
import { money } from "@/lib/format";
import { firstName } from "@/lib/team";
import type { DesignRecord } from "@/lib/stores/designs";
import type { Quote, QuoteStatus } from "@/lib/stores/quotes";

const DAY = 86_400_000;

/** Abbreviated money to ~3 significant figures: 200 → $200, 200,000 → $200K. */
export function shortMoney(n: number | null | undefined): string {
  let v = Math.round(n || 0);
  const sign = v < 0 ? "-" : "";
  v = Math.abs(v);
  const sig = (x: number) =>
    x >= 100 ? String(Math.round(x)) : x >= 10 ? x.toFixed(1) : x.toFixed(2);
  let body: string;
  if (v < 1000) body = String(v);
  else if (v < 1000000) body = sig(v / 1000) + "K";
  else body = sig(v / 1000000) + "m";
  return "$" + sign + body;
}

export function resolvePipe(v: string | undefined): "all" | QuoteStatus {
  return v === "draft" || v === "sent" || v === "won" || v === "lost" ? v : "all";
}

export function sheetHrefFor(pipe: "all" | QuoteStatus): (id: string) => string {
  return (id) =>
    pipe === "all"
      ? `/?sheet=${encodeURIComponent(id)}`
      : `/?pipe=${pipe}&sheet=${encodeURIComponent(id)}`;
}

export function myQuoteStats(quotesAll: Quote[], me: string) {
  const myQuotes = quotesAll.filter((q) => q.owner === me);
  const openQuotes = myQuotes.filter((q) => q.status === "draft" || q.status === "sent");
  const openValue = openQuotes.reduce((a, q) => a + (q.value || 0), 0);
  const won = myQuotes.filter((q) => q.status === "won");
  const lost = myQuotes.filter((q) => q.status === "lost");
  const decided = won.length + lost.length;
  const winRate = decided > 0 ? Math.round((won.length / decided) * 100) : 0;
  const sentCount = myQuotes.filter((q) => q.status === "sent").length;
  const avg = myQuotes.length
    ? myQuotes.reduce((a, q) => a + (q.value || 0), 0) / myQuotes.length
    : 0;
  const pipeCounts: Record<"all" | QuoteStatus, number> = {
    all: myQuotes.length,
    draft: myQuotes.filter((q) => q.status === "draft").length,
    sent: sentCount,
    won: won.length,
    lost: lost.length,
  };
  return { myQuotes, openQuotes, openValue, won, lost, winRate, sentCount, avg, pipeCounts };
}

function shortTitle(n?: string | null): string {
  return (n || "").split(" — ")[0];
}

export function homeAlerts(
  quotesAll: Quote[],
  designsAll: DesignRecord[],
  me: string,
  now: number,
  sheetHref: (id: string) => string
) {
  const myQuotes = quotesAll.filter((q) => q.owner === me);
  const daysSince = (ts?: number | null) => Math.floor((now - (ts || now)) / DAY);
  const pipelineRaw: Array<{
    id: string;
    urgent: boolean;
    sortVal: number;
    title: string;
    detail: string;
    tag: string;
  }> = [];
  myQuotes.forEach((q) => {
    const d = daysSince(q.updatedAt);
    if (q.status === "sent") {
      pipelineRaw.push({
        id: q.id,
        urgent: d >= 7,
        sortVal: 1000000 + (q.value || 0) + d * 1000,
        title: shortTitle(q.name) + (d >= 7 ? " — overdue follow-up" : " — awaiting response"),
        detail: `${q.id} · ${money(q.value)} · sent ${d <= 0 ? "today" : `${d}d ago`}`,
        tag: d <= 0 ? "new" : `${d}d`,
      });
    } else if (q.status === "draft" && (q.value || 0) > 0 && d >= 3) {
      pipelineRaw.push({
        id: q.id,
        urgent: false,
        sortVal: q.value || 0,
        title: shortTitle(q.name) + " — draft not sent",
        detail: `${q.id} · ${money(q.value)} · edited ${d}d ago`,
        tag: "Draft",
      });
    }
  });
  pipelineRaw.sort((a, b) => Number(b.urgent) - Number(a.urgent) || b.sortVal - a.sortVal);
  const pipelineAlerts: AlertRow[] = pipelineRaw.slice(0, 4).map((a) => ({
    key: `pipe-${a.id}`,
    title: a.title,
    detail: a.detail,
    tag: a.tag,
    dot: a.urgent ? "#b4543a" : "#c98a2b",
    tagColor: a.urgent ? "#b4543a" : "#8a6d1f",
    tagBg: a.urgent ? "#f7e9e5" : "#fbf3dd",
    href: sheetHref(a.id),
    keepScroll: true,
  }));

  const reviewAlerts: AlertRow[] = [];
  quotesAll.forEach((q) => {
    const r = q.review;
    if (r?.state === "in_review" && r.reviewer === me && q.owner !== me) {
      reviewAlerts.push({
        key: `rq-${q.id}`,
        title: shortTitle(q.name) + " — awaiting your review",
        detail: "Quote from " + firstName(r.submittedBy || ""),
        tag: "review",
        dot: "#3155a8",
        tagColor: "#3155a8",
        tagBg: "#e9eefb",
        href: "/reviews",
      });
    } else if (r?.state === "changes" && r.submittedBy === me) {
      reviewAlerts.push({
        key: `rc-${q.id}`,
        title: shortTitle(q.name) + " — changes requested",
        detail: r.note ? `“${r.note}”` : "Reviewer asked for changes",
        tag: "fix",
        dot: "#b4543a",
        tagColor: "#b4543a",
        tagBg: "#f7e9e5",
        href: `/estimator?id=${encodeURIComponent(q.id)}`,
      });
    }
  });
  designsAll.forEach((d) => {
    const r = d.review;
    if (r?.state === "in_review" && r.reviewer === me && d.owner !== me) {
      reviewAlerts.push({
        key: `rd-${d.id}`,
        title: shortTitle(d.name) + " — design to review",
        detail: "Design from " + firstName(r.submittedBy || ""),
        tag: "review",
        dot: "#3155a8",
        tagColor: "#3155a8",
        tagBg: "#e9eefb",
        href: "/reviews",
      });
    }
  });
  const openReviewCount =
    quotesAll.filter((q) => q.review?.state === "in_review" && q.review?.reviewer === me && q.owner !== me).length +
    designsAll.filter((d) => d.review?.state === "in_review" && d.review?.reviewer === me && d.owner !== me).length;

  return {
    alerts: reviewAlerts.concat(pipelineAlerts).slice(0, 5),
    urgentCount: pipelineRaw.filter((a) => a.urgent).length,
    openReviewCount,
  };
}
