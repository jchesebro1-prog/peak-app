/**
 * #43 — the Home cards as registry widgets. Presentation stays in the
 * sibling home-*.tsx files (untouched); this module owns the per-widget
 * data shaping that used to live inline in page.tsx. Everything reads
 * through ctx.data so a store loads once per request however many widgets
 * share it.
 */
import { deriveInitials, fallbackColor } from "@/lib/team";
import { timeAgo as designTimeAgo } from "@/lib/stores/designs";
import { stageMeta as surveyStageMeta, timeAgo as surveyTimeAgo } from "@/lib/stores/surveys";
import {
  followUpInfo, sla as leadSla, sourceMeta, stageMeta as leadStageMeta, dueLabel, dateLabel,
  timeAgo as leadTimeAgo, type LeadRecord,
} from "@/lib/stores/leads";
import { boxMeta, waitingSince, waitLabel as commWaitLabel } from "@/lib/stores/comms";
import { priceBooks } from "@/lib/catalog-books";
import { queueCardCounts, queueDueLabel } from "@/lib/queue";
import { recordableParentIds } from "@/app/(app)/recordings/data";
import type { WidgetCtx, WidgetRenderer } from "@/lib/dashboard/context";
import { homeAlerts, myQuoteStats, resolvePipe, sheetHrefFor, shortMoney } from "@/lib/dashboard/home-metrics";
import { tile } from "./tile";
import HomeQueue, { type QueueRow } from "../../home-queue";
import HomeInbox from "../../home-inbox";
import HomeMyLeads, { type LeadGroup, type LeadRow } from "../../home-my-leads";
import HomeMyDesigns, { type DesignCard } from "../../home-my-designs";
import HomePipeline, { type PipelineRow } from "../../home-pipeline";
import HomeCatalog from "../../home-catalog";
import HomeCalendar from "../../home-calendar";
import HomeVenueAssessments, { type SurveyCard } from "../../home-venue-assessments";
import HomeTeamActivity, { type TeamActivityRow } from "../../home-team-activity";
import HomeNeedsAttention from "../../home-needs-attention";

const stats = async (ctx: WidgetCtx) => myQuoteStats(await ctx.data.quotes(), ctx.user.name);

export const HOME_RENDERERS = {
  /* ---- stat tiles (page.tsx 213-218) ---- */
  "my-open-pipeline": async (ctx) => {
    const s = await stats(ctx);
    return tile("Open pipeline", shortMoney(s.openValue), `${s.openQuotes.length} active quotes`);
  },
  "my-win-rate": async (ctx) => {
    const s = await stats(ctx);
    return tile("Win rate", `${s.winRate}%`, `${s.won.length} won · ${s.lost.length} lost`);
  },
  "my-out-for-signature": async (ctx) => {
    const s = await stats(ctx);
    return tile("Out for signature", String(s.sentCount), "quotes sent");
  },
  "my-avg-quote": async (ctx) => {
    const s = await stats(ctx);
    return tile("Avg quote", shortMoney(s.avg), `${s.myQuotes.length} total`);
  },

  /* ---- my queue (page.tsx 186-197) — `now` is the host's single read ---- */
  "my-queue": async (ctx) => {
    const items = await ctx.data.queueItems();
    const { open, overdue } = queueCardCounts(items, ctx.now);
    const rows: QueueRow[] = items.slice(0, 5).map((it) => ({
      key: it.key, title: it.title, context: it.context, dueLabel: queueDueLabel(it.due, ctx.now).text, href: it.href,
    }));
    return <HomeQueue open={open} overdue={overdue} rows={rows} />;
  },

  /* ---- inbox (page.tsx 476-501) ---- */
  inbox: async (ctx) => {
    const [needsThreads, inboxUnread, boxCountsArr] = await Promise.all([
      ctx.data.needsThreads(), ctx.data.inboxUnread(), ctx.data.boxCounts(),
    ]);
    const inboxItems = needsThreads.slice(0, 4).map((t) => {
      const bm = boxMeta(t.mailbox || "info", t.mailboxUser || undefined, { userColor: ctx.user.color });
      return {
        id: t.id, href: `/inbox?thread=${encodeURIComponent(t.id)}`,
        customer: t.customer || t.contactName || "Customer", subject: t.subject || "(no subject)",
        wait: commWaitLabel(waitingSince(t)), unread: !!t.unread, channel: t.channel,
        boxTag: bm?.label || "", boxColor: bm?.color || "#8c919c",
      };
    });
    const inboxBoxes = ctx.data.boxes.map((b, i) => ({
      id: b.id, label: b.kind === "personal" ? "My inbox" : b.label, color: b.color,
      href: `/inbox?box=${b.id}`, waiting: boxCountsArr[i]?.waiting || 0,
    }));
    return <HomeInbox inboxNeedsCount={needsThreads.length} inboxUnread={inboxUnread} inboxItems={inboxItems} inboxBoxes={inboxBoxes} />;
  },

  /* ---- my leads (page.tsx 363-425) — leadChip/leadSub resolved into rows ---- */
  "my-leads": async (ctx) => {
    const me = ctx.user.name;
    const [allOpenLeads, myFollowUps] = await Promise.all([ctx.data.openLeads(), ctx.data.myFollowUps()]);
    const myLeads = allOpenLeads.filter((l) => l.owner === me);
    const fuIds = new Set(myFollowUps.map((l) => l.id));
    const overdue = myFollowUps.filter((l) => followUpInfo(l).urgency >= 2);
    const cold = myFollowUps.filter((l) => followUpInfo(l).urgency === 1);
    const awaiting = myLeads.filter((l) => l.stage === "new" && !fuIds.has(l.id)).sort((a, b) => leadSla(a).ms - leadSla(b).ms);
    const inProgress = myLeads.filter((l) => l.stage !== "new" && !fuIds.has(l.id)).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    const leadChip = (l: LeadRecord): LeadRow["chip"] => {
      const info = followUpInfo(l);
      const s = leadSla(l);
      if (info.need) {
        if (info.reason === "sla") return { label: dueLabel(s.ms), ink: "#b4543a", soft: "#f8ece7", bd: "#eccfc4" };
        if (info.reason === "nextaction") return { label: "Follow-up due", ink: "#b4543a", soft: "#f8ece7", bd: "#eccfc4" };
        return { label: "Going cold", ink: "#8a6d1f", soft: "#fbf3dd", bd: "#f0e2bd" };
      }
      if (s.state === "pending") return { label: dueLabel(s.ms), ink: "#3155a8", soft: "#e9eefb", bd: "#d4ddf3" };
      if (l.nextActionAt) return { label: dateLabel(l.nextActionAt), ink: "#1f7a52", soft: "#eaf6ef", bd: "#cce9da" };
      return { label: "On track", ink: "#5b7a6a", soft: "#eef3f0", bd: "#d8e6de" };
    };
    const leadSub = (l: LeadRecord): string => {
      if (l.nextActionAt && l.stage !== "new") return `${l.nextActionNote || "Follow-up"} · ${dateLabel(l.nextActionAt)}`;
      if (l.stage === "new" && !l.firstContactAt) return `${sourceMeta(l.source).verb} · ${leadTimeAgo(l.createdAt)}`;
      return `${l.interest || "Open lead"} · last touch ${leadTimeAgo(l.lastActivityAt)}`;
    };
    const toLeadRow = (l: LeadRecord): LeadRow => {
      const src = sourceMeta(l.source);
      const stg = leadStageMeta(l.stage);
      return {
        id: l.id, href: `/leads?lead=${encodeURIComponent(l.id)}`, org: l.org || "Lead",
        src: { color: src.color, short: src.short }, stage: { ink: stg.ink, soft: stg.soft, bd: stg.bd, short: stg.short },
        sub: leadSub(l), chip: leadChip(l), value: shortMoney(l.value),
      };
    };
    const leadGroups: LeadGroup[] = [
      { key: "overdue", label: "Overdue — reach out now", dot: "#c85a3c", ink: "#b4543a", items: overdue.map(toLeadRow) },
      { key: "cold", label: "Going cold", dot: "#c8a53c", ink: "#8a6d1f", items: cold.map(toLeadRow) },
      { key: "awaiting", label: "Awaiting first response", dot: "#3d6fd0", ink: "#3155a8", items: awaiting.map(toLeadRow) },
      { key: "progress", label: "In progress", dot: "#7b5fb0", ink: "#5b4b8a", items: inProgress.map(toLeadRow) },
    ].filter((g) => g.items.length > 0);
    return <HomeMyLeads myFollowCount={myFollowUps.length} leadGroups={leadGroups} />;
  },

  /* ---- my designs (page.tsx 427-441) ---- */
  "my-designs": async (ctx) => {
    const designsAll = await ctx.data.designs();
    const cards: DesignCard[] = designsAll.filter((d) => d.owner === ctx.user.name).map((d) => ({
      id: d.id, venue: d.venue || "—", name: d.name,
      tier: (d.tier || "better").replace(/^./, (c) => c.toUpperCase()), budget: shortMoney(d.budget || 0),
      meta: `${d.id} · ${d.width || "?"}' × ${d.depth || "?"}' × ${d.grid || "?"}'`,
      systemsLabel: `${(d.systems || []).length} systems`, edited: designTimeAgo(d.updatedAt),
      openHref: `/design/quick?design=${encodeURIComponent(d.id)}`,
    }));
    return <HomeMyDesigns cards={cards} />;
  },

  /* ---- my pipeline (page.tsx 220-244) — ?pipe stays URL state ---- */
  "my-pipeline": async (ctx) => {
    const s = await stats(ctx);
    const pipe = resolvePipe(ctx.sp.pipe);
    const sheetHref = sheetHrefFor(pipe);
    const filterDefs: Array<["all" | "draft" | "sent" | "won" | "lost", string]> = [
      ["all", "All"], ["draft", "Draft"], ["sent", "Sent"], ["won", "Won"], ["lost", "Lost"],
    ];
    const filteredQuotes: PipelineRow[] = s.myQuotes.filter((q) => pipe === "all" || q.status === pipe).map((q) => ({ ...q, href: sheetHref(q.id) }));
    return <HomePipeline pipe={pipe} filterDefs={filterDefs} pipeCounts={s.pipeCounts} filteredQuotes={filteredQuotes} />;
  },

  /* ---- catalog (page.tsx 177, 567) ---- */
  catalog: async (ctx) => {
    const parts = await ctx.data.catalogParts();
    return <HomeCatalog books={priceBooks(parts, await ctx.data.settings())} partCount={parts.length} />;
  },

  /* ---- calendar (D77) ---- */
  calendar: async (ctx) => {
    const { gmailOn, calendarOn, items } = await ctx.data.agenda();
    let recordVisitIds: string[] = [];
    try {
      recordVisitIds = await recordableParentIds("site_visit", items.filter((item) => item.source === "visit").map((item) => item.id));
    } catch {
      recordVisitIds = [];
    }
    return <HomeCalendar items={items} calendarOn={calendarOn} gmailOn={gmailOn} recordVisitIds={recordVisitIds} />;
  },

  /* ---- venue assessments (page.tsx 459-474) ---- */
  "venue-assessments": async (ctx) => {
    const surveysAll = await ctx.data.surveys();
    const surveyCards: SurveyCard[] = surveysAll.slice(0, 3).map((s) => ({
      id: s.id, mono: (s.customer || "FS").replace(/[^A-Za-z]/g, "").slice(0, 2).toUpperCase() || "FS",
      customer: s.customer || "Untitled survey", sub: `${s.id} · ${s.venueType || "—"} · ${surveyTimeAgo(s.updatedAt)}`,
      href: `/venue-assessments?id=${encodeURIComponent(s.id)}`, stage: surveyStageMeta(s.stage || "requested"),
    }));
    const surveyPendingCount = surveysAll.filter((s) => s.syncState === "pending" || s.syncState === "syncing").length;
    return <HomeVenueAssessments surveyCards={surveyCards} surveyPendingCount={surveyPendingCount} />;
  },

  /* ---- team activity (page.tsx 179-181, 443-457) ---- */
  "team-activity": async (ctx) => {
    const me = ctx.user.name;
    const [quotesAll, designsAll, roster] = await Promise.all([ctx.data.quotes(), ctx.data.designs(), ctx.data.roster()]);
    const ident = new Map(roster.map((u) => [u.name, { initials: u.initials, color: u.color }]));
    const rows: TeamActivityRow[] = [
      ...quotesAll.filter((q) => q.owner !== me).map((q) => ({ ts: q.updatedAt, who: q.owner, kind: "Quote", verb: "updated", name: q.name })),
      ...designsAll.filter((d) => d.owner !== me).map((d) => ({ ts: d.updatedAt, who: d.owner, kind: "Design", verb: "designed", name: d.name })),
    ]
      .sort((a, b) => (b.ts || 0) - (a.ts || 0))
      .slice(0, 5)
      .map((t) => ({ ...t, initials: ident.get(t.who)?.initials || deriveInitials(t.who), color: ident.get(t.who)?.color || fallbackColor(t.who) }));
    return <HomeTeamActivity teamActivity={rows} />;
  },

  /* ---- needs attention (page.tsx 246-335) ---- */
  "needs-attention": async (ctx) => {
    const [quotesAll, designsAll] = await Promise.all([ctx.data.quotes(), ctx.data.designs()]);
    const { alerts } = homeAlerts(quotesAll, designsAll, ctx.user.name, ctx.now, sheetHrefFor(resolvePipe(ctx.sp.pipe)));
    return <HomeNeedsAttention alerts={alerts} />;
  },
} satisfies Record<string, WidgetRenderer>;
