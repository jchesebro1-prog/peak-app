import Link from "next/link";
import { requireUser } from "@/lib/session";
import { activeUsers } from "@/lib/users";
import { deriveInitials, fallbackColor, firstName } from "@/lib/team";
import { money } from "@/lib/format";
import {
  getAll as getQuotes,
  timeAgo as quoteTimeAgo,
  type Quote,
  type QuoteStatus,
} from "@/lib/stores/quotes";
import { getAllDesigns, timeAgo as designTimeAgo } from "@/lib/stores/designs";
import {
  getAll as getSurveys,
  stageMeta as surveyStageMeta,
  timeAgo as surveyTimeAgo,
} from "@/lib/stores/surveys";
import {
  open as openLeads,
  followUps,
  followUpInfo,
  sla as leadSla,
  sourceMeta,
  stageMeta as leadStageMeta,
  dueLabel,
  dateLabel,
  timeAgo as leadTimeAgo,
  type LeadRecord,
} from "@/lib/stores/leads";
import {
  threadsIn,
  unreadCount,
  folderCounts,
  mailboxes as commMailboxes,
  boxMeta,
  waitingSince,
  waitLabel as commWaitLabel,
} from "@/lib/stores/comms";
import HomeMyDesigns, { type DesignCard } from "./home-my-designs";
import HomeStageSheet, { type SheetQuote } from "./home-stage-sheet";

/**
 * Home dashboard — faithful port of app/Home.dc.html.
 * Server component: every widget reads the stores per request; pipeline
 * filter + stage sheet state live in the URL (?pipe=…&sheet=…); the only
 * client islands are the stage sheet and the My-designs promote flow.
 */

const DAY = 86400000;

const ACCENT_SOFT = "var(--accent-soft)";
const ACCENT_INK = "color-mix(in srgb, var(--accent) 70%, #000)";
const ACCENT_BORDER_LT = "color-mix(in srgb, var(--accent) 30%, #fff)";

type QuoteX = Quote & { requote?: boolean };

/** Quote status pill colors (Home.dc.html statusMeta). */
const STATUS_META: Record<
  QuoteStatus,
  { label: string; ink: string; soft: string; bd: string }
> = {
  draft: { label: "Draft", ink: "#8a6d1f", soft: "#fbf3dd", bd: "#f0e2bd" },
  sent: { label: "Sent", ink: "#3155a8", soft: "#e9eefb", bd: "#d4ddf3" },
  won: { label: "Won", ink: "#1f7a52", soft: "#eaf6ef", bd: "#cce9da" },
  lost: { label: "Lost", ink: "#8c919c", soft: "#f1f2f5", bd: "#e4e7ec" },
};

/** Price-book glance — the prototype Home's component-local book list. */
const BOOKS = [
  { mono: "JC", name: "JR Clancy", count: 214, ageDays: 92 },
  { mono: "RB", name: "Rose Brand", count: 168, ageDays: 21 },
  { mono: "ET", name: "ETC", count: 63, ageDays: 12 },
  { mono: "WN", name: "Wenger", count: 84, ageDays: 40 },
];

/* ---- helpers (ports of the prototype component's) ---- */

/** Abbreviated money to ~3 significant figures: 200 → $200, 200,000 → $200K. */
function shortMoney(n: number | null | undefined): string {
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

function daysSince(ts?: number | null): number {
  return Math.floor((Date.now() - (ts || Date.now())) / DAY);
}

function shortTitle(n?: string | null): string {
  return (n || "").split(" — ")[0];
}

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/* ---- responsive + hover rules (prototype hm-* classes, pkh- prefixed) ---- */

const HOME_CSS = `
.pkh-rowscroll::-webkit-scrollbar{display:none}
.pkh-rowscroll{-ms-overflow-style:none;scrollbar-width:none}
.pkh-hover:hover{background:#fafbff}
.pkh-hoverbox:hover{background:#f1f2f5}
.pkh-openbtn:hover{border-color:#c4c9d2}
.pkh-newdesign:hover{border-color:var(--accent);color:color-mix(in srgb,var(--accent) 70%,#000);background:var(--accent-soft)}
.pkh-softbtn:hover{filter:brightness(.98)}
.pkh-accbtn:hover{filter:brightness(1.06)}
.pkh-outbtn:hover{border-color:#c4c9d2;box-shadow:0 1px 3px rgba(0,0,0,.06)}
.pkh-closebtn:hover{background:#e7e9ee}
.pkh-delbtn:hover{background:#f4ddd5}
.pkh-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:22px}
.pkh-main{display:grid;grid-template-columns:minmax(0,1fr) 348px;gap:18px;align-items:start}
.pkh-inbox{display:grid;grid-template-columns:minmax(0,1fr) 296px}
.pkh-inbox-aside{border-left:1px solid #f0f1f4;background:#fbfbfc;padding:14px 16px}
@media (max-width:860px){
  .pkh-content{padding-left:16px !important;padding-right:16px !important}
  .pkh-greet{flex-direction:column !important;align-items:stretch !important}
  .pkh-actions{width:100%}
  .pkh-actions a{flex:1;justify-content:center}
  .pkh-stats{grid-template-columns:1fr 1fr}
  .pkh-main{grid-template-columns:1fr}
  .pkh-inbox{grid-template-columns:1fr}
  .pkh-inbox-aside{border-left:none;border-top:1px solid #f0f1f4}
  .pkh-sheetwrap{align-items:flex-end !important;padding:0 !important}
  .pkh-sheet{width:100% !important;max-width:100% !important;border-radius:18px 18px 0 0 !important}
}
`;

/* ---- small presentational bits ---- */

function ChanIcon({ channel }: { channel: string }) {
  const common = {
    width: 13,
    height: 13,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "#b4543a",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  if (channel === "call")
    return (
      <svg {...common}>
        <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3.1-8.7A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.3 1.8.6 2.6a2 2 0 0 1-.5 2.1L8 9.6a16 16 0 0 0 6 6l1.2-1.2a2 2 0 0 1 2.1-.5c.8.3 1.7.5 2.6.6a2 2 0 0 1 1.7 2Z" />
      </svg>
    );
  if (channel === "meeting")
    return (
      <svg {...common}>
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <path d="M16 2v4M8 2v4M3 10h18" />
      </svg>
    );
  return (
    <svg {...common}>
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m2 7 10 6 10-6" />
    </svg>
  );
}

function CardHeadTitle({ children }: { children: React.ReactNode }) {
  return <span style={{ fontSize: 15, fontWeight: 600 }}>{children}</span>;
}

/* ======================================================================= */

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const me = user.name;
  const sp = await searchParams;

  const pipeParam = first(sp.pipe);
  const pipe: "all" | QuoteStatus =
    pipeParam === "draft" ||
    pipeParam === "sent" ||
    pipeParam === "won" ||
    pipeParam === "lost"
      ? pipeParam
      : "all";
  const sheetId = first(sp.sheet);

  const boxes = commMailboxes(me, { userColor: user.color });
  const [
    quotesAll,
    designsAll,
    surveysAll,
    allOpenLeads,
    myFollowUps,
    needsThreads,
    inboxUnread,
    roster,
    boxCountsArr,
  ] = await Promise.all([
    getQuotes(),
    getAllDesigns(),
    getSurveys(),
    openLeads(),
    followUps({ owner: me }),
    threadsIn("needs", null, me),
    unreadCount(me),
    activeUsers(),
    Promise.all(boxes.map((b) => folderCounts(b.id, me))),
  ]);

  const ident = new Map(roster.map((u) => [u.name, { initials: u.initials, color: u.color }]));
  const initialsOf = (n: string) => ident.get(n)?.initials || deriveInitials(n);
  const colorOf = (n: string) => ident.get(n)?.color || fallbackColor(n);

  /* ---- my pipeline + stat tiles ---- */

  const myQuotes: QuoteX[] = quotesAll.filter((q) => q.owner === me);
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

  const stats = [
    { label: "Open pipeline", value: shortMoney(openValue), sub: `${openQuotes.length} active quotes` },
    { label: "Win rate", value: `${winRate}%`, sub: `${won.length} won · ${lost.length} lost` },
    { label: "Out for signature", value: String(sentCount), sub: "quotes sent" },
    { label: "Avg quote", value: shortMoney(avg), sub: `${myQuotes.length} total` },
  ];

  const pipeCounts: Record<"all" | QuoteStatus, number> = {
    all: myQuotes.length,
    draft: myQuotes.filter((q) => q.status === "draft").length,
    sent: sentCount,
    won: won.length,
    lost: lost.length,
  };
  const filterDefs: Array<["all" | QuoteStatus, string]> = [
    ["all", "All"],
    ["draft", "Draft"],
    ["sent", "Sent"],
    ["won", "Won"],
    ["lost", "Lost"],
  ];
  const filteredQuotes = myQuotes.filter((q) => pipe === "all" || q.status === pipe);

  const pipeHref = (key: "all" | QuoteStatus) => (key === "all" ? "/" : `/?pipe=${key}`);
  const closeHref = pipe === "all" ? "/" : `/?pipe=${pipe}`;
  const sheetHref = (id: string) =>
    pipe === "all"
      ? `/?sheet=${encodeURIComponent(id)}`
      : `/?pipe=${pipe}&sheet=${encodeURIComponent(id)}`;

  /* ---- needs attention (derived from live pipeline) ---- */

  type AlertRow = {
    key: string;
    title: string;
    detail: string;
    tag: string;
    dot: string;
    tagColor: string;
    tagBg: string;
    href: string;
    keepScroll?: boolean;
  };

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
  pipelineRaw.sort(
    (a, b) => Number(b.urgent) - Number(a.urgent) || b.sortVal - a.sortVal
  );
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
  const alerts = reviewAlerts.concat(pipelineAlerts).slice(0, 5);

  const openReviewCount =
    quotesAll.filter(
      (q) => q.review?.state === "in_review" && q.review?.reviewer === me && q.owner !== me
    ).length +
    designsAll.filter(
      (d) => d.review?.state === "in_review" && d.review?.reviewer === me && d.owner !== me
    ).length;

  /* ---- greeting ---- */

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const urgentCount = pipelineRaw.filter((a) => a.urgent).length;
  const standfirst = `${openQuotes.length} open quotes worth ${money(openValue)} · ${urgentCount} need attention`;

  /* ---- my leads (follow-up worklist scoped to me) ---- */

  const myLeads = allOpenLeads.filter((l) => l.owner === me);
  const fuIds = new Set(myFollowUps.map((l) => l.id));
  const overdue = myFollowUps.filter((l) => followUpInfo(l).urgency >= 2);
  const cold = myFollowUps.filter((l) => followUpInfo(l).urgency === 1);
  const awaiting = myLeads
    .filter((l) => l.stage === "new" && !fuIds.has(l.id))
    .sort((a, b) => leadSla(a).ms - leadSla(b).ms);
  const inProgress = myLeads
    .filter((l) => l.stage !== "new" && !fuIds.has(l.id))
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const myFollowCount = myFollowUps.length;

  const leadGroups = [
    { key: "overdue", label: "Overdue — reach out now", dot: "#c85a3c", ink: "#b4543a", items: overdue },
    { key: "cold", label: "Going cold", dot: "#c8a53c", ink: "#8a6d1f", items: cold },
    { key: "awaiting", label: "Awaiting first response", dot: "#3d6fd0", ink: "#3155a8", items: awaiting },
    { key: "progress", label: "In progress", dot: "#7b5fb0", ink: "#5b4b8a", items: inProgress },
  ].filter((g) => g.items.length > 0);

  const leadChip = (l: LeadRecord): { label: string; ink: string; soft: string; bd: string } => {
    const info = followUpInfo(l);
    const s = leadSla(l);
    if (info.need) {
      if (info.reason === "sla")
        return { label: dueLabel(s.ms), ink: "#b4543a", soft: "#f8ece7", bd: "#eccfc4" };
      if (info.reason === "nextaction")
        return { label: "Follow-up due", ink: "#b4543a", soft: "#f8ece7", bd: "#eccfc4" };
      return { label: "Going cold", ink: "#8a6d1f", soft: "#fbf3dd", bd: "#f0e2bd" };
    }
    if (s.state === "pending")
      return { label: dueLabel(s.ms), ink: "#3155a8", soft: "#e9eefb", bd: "#d4ddf3" };
    if (l.nextActionAt)
      return { label: dateLabel(l.nextActionAt), ink: "#1f7a52", soft: "#eaf6ef", bd: "#cce9da" };
    return { label: "On track", ink: "#5b7a6a", soft: "#eef3f0", bd: "#d8e6de" };
  };

  const leadSub = (l: LeadRecord): string => {
    if (l.nextActionAt && l.stage !== "new")
      return `${l.nextActionNote || "Follow-up"} · ${dateLabel(l.nextActionAt)}`;
    if (l.stage === "new" && !l.firstContactAt)
      return `${sourceMeta(l.source).verb} · ${leadTimeAgo(l.createdAt)}`;
    return `${l.interest || "Open lead"} · last touch ${leadTimeAgo(l.lastActivityAt)}`;
  };

  /* ---- my designs (sandbox) ---- */

  const designCards: DesignCard[] = designsAll
    .filter((d) => d.owner === me)
    .map((d) => ({
      id: d.id,
      venue: d.venue || "—",
      name: d.name,
      tier: (d.tier || "better").replace(/^./, (c) => c.toUpperCase()),
      budget: shortMoney(d.budget || 0),
      meta: `${d.id} · ${d.width || "?"}' × ${d.depth || "?"}' × ${d.grid || "?"}'`,
      systemsLabel: `${(d.systems || []).length} systems`,
      edited: designTimeAgo(d.updatedAt),
      openHref: `/quick-design?design=${encodeURIComponent(d.id)}`,
    }));

  /* ---- team activity glance (everyone else's recent work) ---- */

  const teamActivity = [
    ...quotesAll
      .filter((q) => q.owner !== me)
      .map((q) => ({ ts: q.updatedAt, who: q.owner, kind: "Quote", verb: "updated", name: q.name })),
    ...designsAll
      .filter((d) => d.owner !== me)
      .map((d) => ({ ts: d.updatedAt, who: d.owner, kind: "Design", verb: "designed", name: d.name })),
  ]
    .sort((a, b) => (b.ts || 0) - (a.ts || 0))
    .slice(0, 5);

  /* ---- field surveys ---- */

  const surveyCards = surveysAll.slice(0, 3).map((s) => {
    const m = surveyStageMeta(s.stage || "requested");
    return {
      id: s.id,
      mono: (s.customer || "FS").replace(/[^A-Za-z]/g, "").slice(0, 2).toUpperCase() || "FS",
      customer: s.customer || "Untitled survey",
      sub: `${s.id} · ${s.venueType || "—"} · ${surveyTimeAgo(s.updatedAt)}`,
      href: `/field-survey?id=${encodeURIComponent(s.id)}`,
      stage: m,
    };
  });
  const surveyPendingCount = surveysAll.filter(
    (s) => s.syncState === "pending" || s.syncState === "syncing"
  ).length;

  /* ---- inbox dashboard ---- */

  const inboxNeedsCount = needsThreads.length;
  const inboxItems = needsThreads.slice(0, 4).map((t) => {
    const bm = boxMeta(t.mailbox || "info", t.mailboxUser || undefined, {
      userColor: user.color,
    });
    return {
      id: t.id,
      href: `/inbox?thread=${encodeURIComponent(t.id)}`,
      customer: t.customer || t.contactName || "Customer",
      subject: t.subject || "(no subject)",
      wait: commWaitLabel(waitingSince(t)),
      unread: !!t.unread,
      channel: t.channel,
      boxTag: bm?.label || "",
      boxColor: bm?.color || "#8c919c",
    };
  });
  const inboxBoxes = boxes.map((b, i) => ({
    id: b.id,
    label: b.kind === "personal" ? "My inbox" : b.label,
    color: b.color,
    href: `/inbox?box=${b.id}`,
    waiting: boxCountsArr[i]?.waiting || 0,
  }));

  /* ---- stage sheet ---- */

  const sheetQ = sheetId ? myQuotes.find((q) => q.id === sheetId) : undefined;
  const sheetQuote: SheetQuote | null = sheetQ
    ? {
        id: sheetQ.id,
        name: sheetQ.name,
        meta: `${sheetQ.id} · ${sheetQ.customer || "—"}`,
        value: money(sheetQ.value),
        marginLabel: sheetQ.margin ? `${Math.round(sheetQ.margin * 100)}% margin` : "",
        status: sheetQ.status,
      }
    : null;

  /* ===================================================================== */

  return (
    <div className="pk-content pkh-content">
      <style dangerouslySetInnerHTML={{ __html: HOME_CSS }} />

      {/* greeting + quick actions */}
      <div
        className="pkh-greet"
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
          rowGap: 14,
          marginBottom: 20,
        }}
      >
        <div>
          <div style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-.015em" }}>
            {greeting}, {firstName(me)}
          </div>
          <div style={{ fontSize: 13.5, color: "#8c919c", marginTop: 4 }}>{standfirst}</div>
        </div>
        <div className="pkh-actions" style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Link
            href="/reviews"
            className="pkh-outbtn"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 13,
              fontWeight: 600,
              color: "#3a3f4a",
              background: "#fff",
              border: "1px solid #e4e7ec",
              padding: "11px 16px",
              borderRadius: 9,
              textDecoration: "none",
            }}
          >
            Open Reviews
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                minWidth: 18,
                height: 18,
                padding: "0 5px",
                borderRadius: 9,
                fontFamily: "var(--font-mono)",
                fontSize: 10.5,
                fontWeight: 700,
                color: "#fff",
                background: openReviewCount > 0 ? "var(--accent)" : "#c4c9d2",
              }}
            >
              {openReviewCount}
            </span>
          </Link>
          <Link
            href="/quick-design"
            className="pkh-accbtn"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 13,
              fontWeight: 600,
              color: "#fff",
              background: "var(--accent)",
              padding: "12px 17px",
              borderRadius: 9,
              textDecoration: "none",
              boxShadow: `0 1px 3px ${ACCENT_SOFT}`,
            }}
          >
            <span style={{ fontSize: 15, lineHeight: 1 }}>+</span>
            New estimate
          </Link>
        </div>
      </div>

      {/* stat tiles */}
      <div className="pkh-stats">
        {stats.map((s) => (
          <div
            key={s.label}
            style={{
              background: "#fff",
              border: "1px solid #ececf0",
              borderRadius: 12,
              padding: "16px 17px",
              boxShadow: "0 1px 2px rgba(0,0,0,.04)",
            }}
          >
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: "#9aa0ab",
                letterSpacing: ".05em",
                textTransform: "uppercase",
              }}
            >
              {s.label}
            </div>
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 24,
                fontWeight: 600,
                letterSpacing: "-.01em",
                marginTop: 10,
              }}
            >
              {s.value}
            </div>
            <div style={{ fontSize: 11.5, color: "#9aa0ab", marginTop: 7 }}>{s.sub}</div>
          </div>
        ))}
      </div>

      {/* ===== Inbox dashboard ===== */}
      <div className="pk-card" style={{ overflow: "hidden", marginBottom: 22 }}>
        <div
          className="pkh-greet"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            padding: "15px 18px 13px",
            borderBottom: "1px solid #f0f1f4",
            flexWrap: "wrap",
            rowGap: 10,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 11, minWidth: 0 }}>
            <CardHeadTitle>Inbox</CardHeadTitle>
            {inboxNeedsCount > 0 && (
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 10,
                  fontWeight: 600,
                  color: "#b4543a",
                  background: "#f8ece7",
                  border: "1px solid #eccfc4",
                  padding: "2px 8px",
                  borderRadius: 20,
                }}
              >
                {inboxNeedsCount} need reply
              </span>
            )}
            <span style={{ fontSize: 12.5, color: "#9aa0ab" }}>
              Customer messages waiting on a reply
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 9, flexShrink: 0 }}>
            <Link
              href="/inbox?compose=1"
              className="pkh-softbtn"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                fontSize: 12.5,
                fontWeight: 600,
                color: ACCENT_INK,
                background: ACCENT_SOFT,
                border: `1px solid ${ACCENT_BORDER_LT}`,
                padding: "8px 13px",
                borderRadius: 8,
                textDecoration: "none",
              }}
            >
              <span style={{ fontSize: 14, lineHeight: 1 }}>+</span> Compose
            </Link>
            <Link
              href="/inbox"
              style={{
                fontSize: 12.5,
                fontWeight: 600,
                color: "var(--accent)",
                textDecoration: "none",
                whiteSpace: "nowrap",
              }}
            >
              Open inbox →
            </Link>
          </div>
        </div>

        <div className="pkh-inbox">
          <div style={{ minWidth: 0 }}>
            {inboxItems.map((m) => (
              <Link
                key={m.id}
                href={m.href}
                className="pkh-hover"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "12px 18px",
                  borderBottom: "1px solid #f5f6f8",
                  textDecoration: "none",
                  color: "inherit",
                  position: "relative",
                }}
              >
                {m.unread && (
                  <span
                    style={{
                      position: "absolute",
                      left: 6,
                      top: "50%",
                      transform: "translateY(-50%)",
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: "var(--accent)",
                    }}
                  />
                )}
                <span
                  style={{
                    width: 30,
                    height: 30,
                    flexShrink: 0,
                    borderRadius: 9,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: "#f8ece7",
                  }}
                >
                  <ChanIcon channel={m.channel} />
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        color: "#16181d",
                      }}
                    >
                      {m.customer}
                    </span>
                    <span
                      style={{
                        fontSize: 9.5,
                        fontWeight: 600,
                        color: m.boxColor,
                        background: `color-mix(in srgb, ${m.boxColor} 12%, #fff)`,
                        border: `1px solid color-mix(in srgb, ${m.boxColor} 24%, #fff)`,
                        padding: "1px 7px",
                        borderRadius: 20,
                        flexShrink: 0,
                      }}
                    >
                      {m.boxTag}
                    </span>
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: "#5b616e",
                      marginTop: 2,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {m.subject}
                  </div>
                </div>
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 10.5,
                    fontWeight: 600,
                    color: "#b4543a",
                    flexShrink: 0,
                    whiteSpace: "nowrap",
                  }}
                >
                  {m.wait} waiting
                </span>
                <span style={{ color: "#c4c9d2", fontSize: 18, flexShrink: 0 }}>›</span>
              </Link>
            ))}
            {inboxItems.length === 0 && (
              <div
                style={{
                  padding: "30px 18px",
                  textAlign: "center",
                  color: "#9aa0ab",
                  fontSize: 13,
                  lineHeight: 1.6,
                }}
              >
                Inbox zero — no customers are waiting on a reply.
              </div>
            )}
          </div>

          <div className="pkh-inbox-aside">
            <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
              <div
                style={{
                  flex: 1,
                  background: "#fff",
                  border: "1px solid #ececf0",
                  borderRadius: 10,
                  padding: "9px 11px",
                }}
              >
                <div
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 20,
                    fontWeight: 600,
                    color: "#b4543a",
                    letterSpacing: "-.01em",
                  }}
                >
                  {inboxNeedsCount}
                </div>
                <div style={{ fontSize: 10.5, color: "#8c919c", marginTop: 2 }}>Need reply</div>
              </div>
              <div
                style={{
                  flex: 1,
                  background: "#fff",
                  border: "1px solid #ececf0",
                  borderRadius: 10,
                  padding: "9px 11px",
                }}
              >
                <div
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 20,
                    fontWeight: 600,
                    letterSpacing: "-.01em",
                  }}
                >
                  {inboxUnread}
                </div>
                <div style={{ fontSize: 10.5, color: "#8c919c", marginTop: 2 }}>Unread</div>
              </div>
            </div>
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: ".06em",
                textTransform: "uppercase",
                color: "#aab0bb",
                marginBottom: 6,
              }}
            >
              By mailbox
            </div>
            {inboxBoxes.map((b) => (
              <Link
                key={b.id}
                href={b.href}
                className="pkh-hoverbox"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 9,
                  padding: "7px 6px",
                  borderRadius: 8,
                  textDecoration: "none",
                  color: "inherit",
                }}
              >
                <span
                  style={{
                    width: 9,
                    height: 9,
                    borderRadius: "50%",
                    flexShrink: 0,
                    background: b.color,
                  }}
                />
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    fontSize: 12.5,
                    fontWeight: 500,
                    color: "#3a3f4a",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {b.label}
                </span>
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    fontWeight: 700,
                    flexShrink: 0,
                    color: b.waiting > 0 ? "#b4543a" : "#c4c9d2",
                  }}
                >
                  {b.waiting}
                </span>
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* ===== My leads (follow-up worklist) ===== */}
      <div className="pk-card" style={{ overflow: "hidden", marginBottom: 22 }}>
        <div
          className="pkh-greet"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            padding: "15px 18px 13px",
            borderBottom: "1px solid #f0f1f4",
            flexWrap: "wrap",
            rowGap: 10,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            <CardHeadTitle>My leads</CardHeadTitle>
            {myFollowCount > 0 && (
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 10,
                  fontWeight: 600,
                  color: "#b4543a",
                  background: "#f8ece7",
                  border: "1px solid #eccfc4",
                  padding: "2px 8px",
                  borderRadius: 20,
                }}
              >
                {myFollowCount} to chase
              </span>
            )}
            <span style={{ fontSize: 12.5, color: "#9aa0ab" }}>assigned to you</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14, flexShrink: 0 }}>
            <Link
              href="/lead-intake"
              target="_blank"
              style={{ fontSize: 12.5, fontWeight: 600, color: "#8c919c", textDecoration: "none" }}
            >
              Public form ↗
            </Link>
            <Link
              href="/leads"
              style={{
                fontSize: 12.5,
                fontWeight: 600,
                color: "var(--accent)",
                textDecoration: "none",
              }}
            >
              Open Leads →
            </Link>
          </div>
        </div>
        <div style={{ padding: "14px 18px 6px" }}>
          {leadGroups.map((g) => (
            <div key={g.key} style={{ marginBottom: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 8 }}>
                <span
                  style={{
                    width: 9,
                    height: 9,
                    borderRadius: "50%",
                    background: g.dot,
                    flexShrink: 0,
                  }}
                />
                <span
                  style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".01em", color: g.ink }}
                >
                  {g.label}
                </span>
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 10.5,
                    fontWeight: 600,
                    color: "#fff",
                    background: g.dot,
                    padding: "1px 8px",
                    borderRadius: 20,
                  }}
                >
                  {g.items.length}
                </span>
              </div>
              <div style={{ border: "1px solid #ececf0", borderRadius: 11, overflow: "hidden" }}>
                {g.items.slice(0, 4).map((l) => {
                  const c = leadChip(l);
                  const src = sourceMeta(l.source);
                  const stg = leadStageMeta(l.stage);
                  return (
                    <Link
                      key={l.id}
                      href={`/leads?lead=${encodeURIComponent(l.id)}`}
                      className="pkh-hover"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        padding: "11px 14px",
                        borderBottom: "1px solid #f4f5f8",
                        textDecoration: "none",
                        color: "inherit",
                      }}
                    >
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div
                          style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}
                        >
                          <span
                            style={{
                              fontSize: 13,
                              fontWeight: 600,
                              color: "#16181d",
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                            }}
                          >
                            {l.org || "Lead"}
                          </span>
                          <span
                            style={{
                              fontSize: 9.5,
                              fontWeight: 600,
                              color: src.color,
                              background: `color-mix(in srgb, ${src.color} 12%, #fff)`,
                              border: `1px solid color-mix(in srgb, ${src.color} 24%, #fff)`,
                              padding: "1px 7px",
                              borderRadius: 20,
                              whiteSpace: "nowrap",
                              flexShrink: 0,
                            }}
                          >
                            {src.short}
                          </span>
                          <span
                            style={{
                              fontSize: 9.5,
                              fontWeight: 600,
                              color: stg.ink,
                              background: stg.soft,
                              border: `1px solid ${stg.bd}`,
                              padding: "2px 8px",
                              borderRadius: 20,
                              whiteSpace: "nowrap",
                              flexShrink: 0,
                            }}
                          >
                            {stg.short}
                          </span>
                        </div>
                        <div
                          style={{
                            fontSize: 11.5,
                            color: "#8c919c",
                            marginTop: 2,
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {leadSub(l)}
                        </div>
                      </div>
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 600,
                          color: c.ink,
                          background: c.soft,
                          border: `1px solid ${c.bd}`,
                          padding: "2px 8px",
                          borderRadius: 20,
                          whiteSpace: "nowrap",
                          flexShrink: 0,
                        }}
                      >
                        {c.label}
                      </span>
                      <span
                        style={{
                          fontFamily: "var(--font-mono)",
                          fontSize: 12,
                          fontWeight: 600,
                          color: "#3a3f4a",
                          flexShrink: 0,
                          width: 58,
                          textAlign: "right",
                        }}
                      >
                        {shortMoney(l.value)}
                      </span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
          {leadGroups.length === 0 && (
            <div
              style={{
                padding: "20px 14px 26px",
                textAlign: "center",
                color: "#9aa0ab",
                fontSize: 13,
              }}
            >
              Nothing needs chasing — your assigned leads are all on track.
            </div>
          )}
        </div>
      </div>

      {/* ===== My designs (sandbox) ===== */}
      <HomeMyDesigns cards={designCards} />

      {/* ===== two columns ===== */}
      <div className="pkh-main">
        {/* LEFT: pipeline + catalog */}
        <div style={{ display: "flex", flexDirection: "column", gap: 18, minWidth: 0 }}>
          <div className="pk-card" style={{ overflow: "hidden" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                padding: "15px 18px 13px",
                borderBottom: "1px solid #f0f1f4",
                flexWrap: "wrap",
                rowGap: 10,
              }}
            >
              <CardHeadTitle>My pipeline</CardHeadTitle>
              <div
                className="pkh-rowscroll"
                style={{
                  display: "flex",
                  background: "#f1f2f5",
                  borderRadius: 8,
                  padding: 2,
                  maxWidth: "100%",
                  overflowX: "auto",
                }}
              >
                {filterDefs.map(([key, label]) => {
                  const active = pipe === key;
                  return (
                    <Link
                      key={key}
                      href={pipeHref(key)}
                      scroll={false}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        fontSize: 12,
                        fontWeight: active ? 600 : 500,
                        padding: "5px 11px",
                        borderRadius: 6,
                        whiteSpace: "nowrap",
                        textDecoration: "none",
                        background: active ? "#fff" : "transparent",
                        color: active ? "#16181d" : "#9aa0ab",
                        boxShadow: active ? "0 1px 2px rgba(0,0,0,.1)" : undefined,
                      }}
                    >
                      {label}
                      <span
                        style={{
                          fontFamily: "var(--font-mono)",
                          fontSize: 10,
                          fontWeight: 600,
                          color: active ? ACCENT_INK : "#aab0bb",
                          background: active ? ACCENT_SOFT : "#e9ebef",
                          padding: "0 5px",
                          borderRadius: 10,
                        }}
                      >
                        {pipeCounts[key]}
                      </span>
                    </Link>
                  );
                })}
              </div>
            </div>

            {filteredQuotes.map((q) => {
              const m = STATUS_META[q.status] || STATUS_META.draft;
              const meta = `${q.id} · ${q.customer || "—"} · ${quoteTimeAgo(q.updatedAt)}${
                q.requote ? " · needs requote" : ""
              }`;
              return (
                <Link
                  key={q.id}
                  href={sheetHref(q.id)}
                  scroll={false}
                  className="pkh-hover"
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "14px 18px",
                    borderBottom: "1px solid #f5f6f8",
                    textDecoration: "none",
                    color: "inherit",
                    textAlign: "left",
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 13.5,
                        fontWeight: 600,
                        lineHeight: 1.3,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        color: "#16181d",
                      }}
                    >
                      {q.name}
                    </div>
                    <div
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 10.5,
                        color: "#aab0bb",
                        marginTop: 3,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {meta}
                    </div>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "flex-end",
                      gap: 5,
                      flexShrink: 0,
                    }}
                  >
                    <span
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 13,
                        fontWeight: 600,
                        color: "#16181d",
                      }}
                    >
                      {money(q.value)}
                    </span>
                    <span
                      style={{
                        display: "inline-block",
                        fontSize: 10.5,
                        fontWeight: 600,
                        color: m.ink,
                        background: m.soft,
                        border: `1px solid ${m.bd}`,
                        padding: "2px 9px",
                        borderRadius: 20,
                      }}
                    >
                      {m.label}
                    </span>
                  </div>
                  <span style={{ color: "#c4c9d2", fontSize: 18, flexShrink: 0 }}>›</span>
                </Link>
              );
            })}

            {filteredQuotes.length === 0 && (
              <div
                style={{
                  padding: "34px 18px",
                  textAlign: "center",
                  color: "#9aa0ab",
                  fontSize: 13,
                  lineHeight: 1.6,
                }}
              >
                No quotes in this stage.
                <br />
                <Link
                  href="/quick-design"
                  style={{ color: "var(--accent)", fontWeight: 600, textDecoration: "none" }}
                >
                  Start a rough estimate →
                </Link>
              </div>
            )}

            <div style={{ padding: "13px 18px" }}>
              <Link
                href="/quick-design"
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: "var(--accent)",
                  textDecoration: "none",
                }}
              >
                + New rough estimate
              </Link>
            </div>
          </div>

          {/* catalog (moved under pipeline to balance the grid) */}
          <div className="pk-card" style={{ padding: "16px 17px" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 13,
              }}
            >
              <CardHeadTitle>Catalog</CardHeadTitle>
              <Link
                href="/catalog"
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: "var(--accent)",
                  textDecoration: "none",
                }}
              >
                Manage →
              </Link>
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 14 }}>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 23, fontWeight: 600 }}>
                {BOOKS.reduce((a, b) => a + b.count, 0)}
              </span>
              <span style={{ fontSize: 12.5, color: "#8c919c" }}>
                parts · {BOOKS.length} price books
              </span>
            </div>
            {BOOKS.map((b) => {
              const stale = b.ageDays >= 90;
              const warn = b.ageDays >= 45;
              return (
                <div
                  key={b.mono}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "8px 0",
                    borderTop: "1px solid #f3f4f7",
                  }}
                >
                  <span
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 7,
                      background: "#f1f2f5",
                      color: "#3a3f4a",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontWeight: 700,
                      fontSize: 11,
                      fontFamily: "var(--font-mono)",
                      flexShrink: 0,
                    }}
                  >
                    {b.mono}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600 }}>{b.name}</div>
                    <div
                      style={{ fontSize: 11, color: "#9aa0ab", fontFamily: "var(--font-mono)" }}
                    >
                      {b.count} parts
                    </div>
                  </div>
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 10.5,
                      fontWeight: 600,
                      color: stale ? "#b4543a" : warn ? "#9a7d1f" : "#1f8a5b",
                      background: stale ? "#f7e9e5" : warn ? "#fbf3dd" : "#eaf6ef",
                      padding: "3px 8px",
                      borderRadius: 6,
                      flexShrink: 0,
                    }}
                  >
                    {b.ageDays}d ago
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* RIGHT: surveys + team activity + needs attention */}
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {/* field surveys */}
          <div className="pk-card" style={{ overflow: "hidden" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
                padding: "15px 17px 12px",
                borderBottom: "1px solid #f0f1f4",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
                <CardHeadTitle>Field surveys</CardHeadTitle>
                {surveyPendingCount > 0 && (
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 10,
                      fontWeight: 600,
                      color: "#9a6a1f",
                      background: "#fbf3dd",
                      border: "1px solid #f0e2bd",
                      padding: "2px 8px",
                      borderRadius: 20,
                    }}
                  >
                    {surveyPendingCount} to sync
                  </span>
                )}
              </div>
              <Link
                href="/field-survey"
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: "var(--accent)",
                  textDecoration: "none",
                }}
              >
                Open →
              </Link>
            </div>
            {surveyCards.map((s) => (
              <Link
                key={s.id}
                href={s.href}
                className="pkh-hover"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 11,
                  padding: "12px 17px",
                  borderBottom: "1px solid #f5f6f8",
                  textDecoration: "none",
                  color: "inherit",
                }}
              >
                <span
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: 8,
                    background: "#eef3f0",
                    color: "#1f7a52",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 11,
                    fontWeight: 700,
                    fontFamily: "var(--font-mono)",
                    flexShrink: 0,
                  }}
                >
                  {s.mono}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 12.5,
                      fontWeight: 600,
                      lineHeight: 1.3,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {s.customer}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: "#9aa0ab",
                      marginTop: 2,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {s.sub}
                  </div>
                </div>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    color: s.stage.ink,
                    background: s.stage.soft,
                    border: `1px solid ${s.stage.bd}`,
                    padding: "2px 9px",
                    borderRadius: 20,
                    flexShrink: 0,
                    whiteSpace: "nowrap",
                  }}
                >
                  {s.stage.label}
                </span>
              </Link>
            ))}
            {surveyCards.length === 0 && (
              <div
                style={{
                  padding: "20px 17px",
                  textAlign: "center",
                  color: "#9aa0ab",
                  fontSize: 12.5,
                }}
              >
                No field surveys yet.
              </div>
            )}
            <div style={{ padding: "11px 17px" }}>
              <Link
                href="/field-survey?new=1"
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: "var(--accent)",
                  textDecoration: "none",
                }}
              >
                + Request survey
              </Link>
            </div>
          </div>

          {/* team activity glance */}
          <div className="pk-card" style={{ overflow: "hidden" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "15px 17px 12px",
                borderBottom: "1px solid #f0f1f4",
              }}
            >
              <CardHeadTitle>Team activity</CardHeadTitle>
              <Link
                href="/quotes"
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: "var(--accent)",
                  textDecoration: "none",
                }}
              >
                View all →
              </Link>
            </div>
            {teamActivity.map((t, i) => (
              <div
                key={`${t.kind}-${i}`}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 11,
                  padding: "11px 17px",
                  borderBottom: "1px solid #f5f6f8",
                }}
              >
                <span
                  title={t.who}
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: "50%",
                    background: colorOf(t.who),
                    color: "#fff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 11,
                    fontWeight: 600,
                    flexShrink: 0,
                  }}
                >
                  {initialsOf(t.who)}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, lineHeight: 1.35 }}>
                    <b style={{ fontWeight: 600, color: "#16181d" }}>{t.who}</b>{" "}
                    <span style={{ color: "#5b616e" }}>
                      {t.verb} {t.name}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: "#aab0bb", marginTop: 2 }}>
                    {t.kind} · {quoteTimeAgo(t.ts)}
                  </div>
                </div>
              </div>
            ))}
            {teamActivity.length === 0 && (
              <div
                style={{
                  padding: "22px 17px",
                  textAlign: "center",
                  color: "#9aa0ab",
                  fontSize: 12.5,
                }}
              >
                No recent team activity.
              </div>
            )}
          </div>

          {/* needs attention */}
          <div className="pk-card" style={{ overflow: "hidden" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "15px 17px 12px",
                borderBottom: "1px solid #f0f1f4",
              }}
            >
              <CardHeadTitle>Needs attention</CardHeadTitle>
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  fontWeight: 600,
                  color: "#b4543a",
                  background: "#f7e9e5",
                  padding: "2px 8px",
                  borderRadius: 20,
                }}
              >
                {alerts.length}
              </span>
            </div>
            {alerts.map((a) => (
              <Link
                key={a.key}
                href={a.href}
                scroll={a.keepScroll ? false : undefined}
                className="pkh-hover"
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 11,
                  padding: "13px 17px",
                  borderBottom: "1px solid #f5f6f8",
                  textDecoration: "none",
                  color: "inherit",
                  textAlign: "left",
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: a.dot,
                    marginTop: 5,
                    flexShrink: 0,
                  }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 12.5,
                      fontWeight: 600,
                      lineHeight: 1.35,
                      color: "#16181d",
                    }}
                  >
                    {a.title}
                  </div>
                  <div
                    style={{ fontSize: 11.5, color: "#8c919c", marginTop: 2, lineHeight: 1.4 }}
                  >
                    {a.detail}
                  </div>
                </div>
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 10.5,
                    fontWeight: 600,
                    color: a.tagColor,
                    background: a.tagBg,
                    padding: "3px 8px",
                    borderRadius: 6,
                    flexShrink: 0,
                    whiteSpace: "nowrap",
                  }}
                >
                  {a.tag}
                </span>
              </Link>
            ))}
            {alerts.length === 0 && (
              <div
                style={{
                  padding: "22px 17px",
                  textAlign: "center",
                  color: "#9aa0ab",
                  fontSize: 12.5,
                }}
              >
                All clear — nothing needs chasing.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ===== stage sheet ===== */}
      {sheetQuote && <HomeStageSheet quote={sheetQuote} closeHref={closeHref} />}
    </div>
  );
}
