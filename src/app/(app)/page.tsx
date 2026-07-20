import { requireUser } from "@/lib/session";
import { activeUsers } from "@/lib/users";
import { deriveInitials, fallbackColor, firstName } from "@/lib/team";
import { money } from "@/lib/format";
import {
  getAll as getQuotes,
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
import HomeCalendar from "./home-calendar";
import HomeTabs from "./home-tabs";
import { loadHomeAgenda } from "@/lib/agenda";
import { list as catalogList } from "@/lib/stores/catalog";
import HomeStageSheet, { type SheetQuote } from "./home-stage-sheet";
import HomeGreeting from "./home-greeting";
import HomeStats from "./home-stats";
import HomeCatalog from "./home-catalog";
import HomeInbox from "./home-inbox";
import HomeMyLeads, { type LeadGroup, type LeadRow } from "./home-my-leads";
import HomePipeline from "./home-pipeline";
import HomeFieldSurveys from "./home-field-surveys";
import HomeTeamActivity, { type TeamActivityRow } from "./home-team-activity";
import HomeNeedsAttention, { type AlertRow } from "./home-needs-attention";

/**
 * Home dashboard — faithful port of app/Home.dc.html.
 * Server component: every widget reads the stores per request; pipeline
 * filter + stage sheet state live in the URL (?pipe=…&sheet=…); the only
 * client islands are the stage sheet and the My-designs promote flow.
 */

const DAY = 86400000;

type QuoteX = Quote & { requote?: boolean };

/** Price-book glance (PUNCHLIST #14): derived from the REAL catalog store,
 *  grouped by manufacturer — the prototype shipped a hardcoded list here
 *  that said "529 parts" forever. Age pills dropped: CatalogPart has no
 *  updatedAt to derive them from (decision A on the punch item). */
function priceBooks(parts: { mfr?: string }[]): { mono: string; name: string; count: number }[] {
  const by = new Map<string, number>();
  for (const pt of parts) {
    const name = (pt.mfr || "").trim() || "Unbranded";
    by.set(name, (by.get(name) || 0) + 1);
  }
  return [...by.entries()]
    .map(([name, count]) => ({
      mono: name
        .split(/\s+/)
        .map((w) => w[0] || "")
        .join("")
        .slice(0, 2)
        .toUpperCase(),
      name,
      count,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);
}

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
    catalogParts,
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
    catalogList(),
  ]);
  const books = priceBooks(catalogParts);

  const ident = new Map(roster.map((u) => [u.name, { initials: u.initials, color: u.color }]));
  const initialsOf = (n: string) => ident.get(n)?.initials || deriveInitials(n);
  const colorOf = (n: string) => ident.get(n)?.color || fallbackColor(n);

  /* ---- dashboard calendar (D77) — next 14 days via the shared loader ---- */
  const { gmailOn, calendarOn, items: agenda } = await loadHomeAgenda(user.id, me);


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

  const closeHref = pipe === "all" ? "/" : `/?pipe=${pipe}`;
  const sheetHref = (id: string) =>
    pipe === "all"
      ? `/?sheet=${encodeURIComponent(id)}`
      : `/?pipe=${pipe}&sheet=${encodeURIComponent(id)}`;

  /* ---- needs attention (derived from live pipeline) ---- */

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

  /** My leads row VM — leadChip()/leadSub() closures and the sourceMeta/
   *  stageMeta/shortMoney lookups the JSX used to call inline are all
   *  resolved here; none of those may cross into HomeMyLeads as functions. */
  const toLeadRow = (l: LeadRecord): LeadRow => {
    const src = sourceMeta(l.source);
    const stg = leadStageMeta(l.stage);
    return {
      id: l.id,
      href: `/leads?lead=${encodeURIComponent(l.id)}`,
      org: l.org || "Lead",
      src: { color: src.color, short: src.short },
      stage: { ink: stg.ink, soft: stg.soft, bd: stg.bd, short: stg.short },
      sub: leadSub(l),
      chip: leadChip(l),
      value: shortMoney(l.value),
    };
  };

  const leadGroups: LeadGroup[] = [
    { key: "overdue", label: "Overdue — reach out now", dot: "#c85a3c", ink: "#b4543a", items: overdue.map(toLeadRow) },
    { key: "cold", label: "Going cold", dot: "#c8a53c", ink: "#8a6d1f", items: cold.map(toLeadRow) },
    { key: "awaiting", label: "Awaiting first response", dot: "#3d6fd0", ink: "#3155a8", items: awaiting.map(toLeadRow) },
    { key: "progress", label: "In progress", dot: "#7b5fb0", ink: "#5b4b8a", items: inProgress.map(toLeadRow) },
  ].filter((g) => g.items.length > 0);

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
      openHref: `/design/quick?design=${encodeURIComponent(d.id)}`,
    }));

  /* ---- team activity glance (everyone else's recent work) ---- */

  const teamActivity: TeamActivityRow[] = [
    ...quotesAll
      .filter((q) => q.owner !== me)
      .map((q) => ({ ts: q.updatedAt, who: q.owner, kind: "Quote", verb: "updated", name: q.name })),
    ...designsAll
      .filter((d) => d.owner !== me)
      .map((d) => ({ ts: d.updatedAt, who: d.owner, kind: "Design", verb: "designed", name: d.name })),
  ]
    .sort((a, b) => (b.ts || 0) - (a.ts || 0))
    .slice(0, 5)
    // initialsOf/colorOf are closures over `ident` (the roster map) — resolved
    // here since functions must not cross into HomeTeamActivity as props.
    .map((t) => ({ ...t, initials: initialsOf(t.who), color: colorOf(t.who) }));

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

      <HomeTabs active="dashboard" />

      {/* greeting + quick actions */}
      <HomeGreeting
        greeting={greeting}
        firstName={firstName(me)}
        standfirst={standfirst}
        openReviewCount={openReviewCount}
      />

      {/* stat tiles */}
      <HomeStats stats={stats} />

      {/* ===== Inbox dashboard ===== */}
      <HomeInbox
        inboxNeedsCount={inboxNeedsCount}
        inboxUnread={inboxUnread}
        inboxItems={inboxItems}
        inboxBoxes={inboxBoxes}
      />

      {/* ===== My leads (follow-up worklist) ===== */}
      <HomeMyLeads myFollowCount={myFollowCount} leadGroups={leadGroups} />

      {/* ===== My designs (sandbox) ===== */}
      <HomeMyDesigns cards={designCards} />

      {/* ===== two columns ===== */}
      <div className="pkh-main">
        {/* LEFT: pipeline + catalog */}
        <div style={{ display: "flex", flexDirection: "column", gap: 18, minWidth: 0 }}>
          <HomePipeline
            pipe={pipe}
            filterDefs={filterDefs}
            pipeCounts={pipeCounts}
            filteredQuotes={filteredQuotes}
          />

          {/* catalog (moved under pipeline to balance the grid) */}
          <HomeCatalog books={books} partCount={catalogParts.length} />
        </div>

        {/* RIGHT: calendar + surveys + team activity + needs attention */}
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {/* calendar (D77) */}
          <HomeCalendar items={agenda} calendarOn={calendarOn} gmailOn={gmailOn} />

          {/* field surveys */}
          <HomeFieldSurveys surveyCards={surveyCards} surveyPendingCount={surveyPendingCount} />

          {/* team activity glance */}
          <HomeTeamActivity teamActivity={teamActivity} />

          {/* needs attention */}
          <HomeNeedsAttention alerts={alerts} />
        </div>
      </div>

      {/* ===== stage sheet ===== */}
      {sheetQuote && <HomeStageSheet quote={sheetQuote} closeHref={closeHref} />}
    </div>
  );
}
