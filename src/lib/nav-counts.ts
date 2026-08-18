import { followUps, followUpInfo } from "@/lib/stores/leads";
import { getAll as allQuotes } from "@/lib/stores/quotes";
import { getAllDesigns } from "@/lib/stores/designs";
import { getAllProjects, riskFlags } from "@/lib/stores/projects";
import { renewals, dueLabel } from "@/lib/stores/flame-jobs";
import { getAll as allInspections } from "@/lib/stores/inspections";
import {
  getAll as allRepairs,
  flaggedFromInspections,
  priorityMeta,
} from "@/lib/stores/repair-jobs";
import { getAll as allSurveys } from "@/lib/stores/surveys";
import { allVisits } from "@/lib/stores/site-visits";
import { getAll as allComms, waitHours, unreadCountFrom } from "@/lib/stores/comms";
import { getPrefs } from "@/lib/stores/notif-prefs";
import { allTasks, taskBellItems, isOverdue } from "@/lib/stores/tasks";
import { shortDate } from "@/lib/format";
import type {
  NavCounts,
  BellGroup,
  BellItem,
} from "@/components/nav/nav-data";

/**
 * Server-side aggregation feeding the nav badges + to-do bell — port of
 * Nav.dc.html's badge formulas and notifications() categories
 * (docs/specs/nav-shell.json). The bell list is NotifPrefs-filtered per
 * user, exactly like the prototype.
 */

export type { BellItem, BellGroup };

export async function navData(me: string): Promise<{
  counts: NavCounts;
  bell: BellGroup[];
  bellCount: number;
}> {
  const [
    quotes,
    designs,
    projects,
    inspections,
    repairs,
    surveys,
    comms,
    visits,
    leadFollowUps,
    renewalRows,
    taskRows,
    prefs,
  ] = await Promise.all([
    allQuotes(),
    getAllDesigns(),
    getAllProjects(),
    allInspections(),
    allRepairs(),
    allSurveys(),
    allComms(),
    allVisits(),
    followUps({ unownedOrMine: true, me }),
    renewals({ dueOnly: true }),
    allTasks(),
    getPrefs(me),
  ]);
  // Everything below is derived from the arrays already fetched above — no
  // extra table scans. Previously these re-fetched inspections+repairs
  // (flagged), leads (leadCount), and comms (unread) a second time, plus a
  // serial round-trip for unread after the parallel batch. navData runs on
  // every app page, so this is per-navigation overhead removed.
  const flagged = await flaggedFromInspections({ jobs: repairs, inspections });
  const leadCount = leadFollowUps.length;
  const inboxUnread = unreadCountFrom(comms, me);

  const reviewQuotes = quotes.filter(
    (q) =>
      q.review?.state === "in_review" &&
      q.review?.reviewer === me &&
      q.owner !== me
  );
  const portalAccepted = quotes.filter(
    (q) => q.portalAcceptance && q.status === "sent"
  );
  const reviewDesigns = designs.filter(
    (d) =>
      d.review?.state === "in_review" &&
      d.review?.reviewer === me &&
      d.owner !== me
  );
  const riskProjects = projects.filter(
    (p) => p.stage !== "complete" && riskFlags(p).length > 0
  );
  const requestedInspections = inspections.filter(
    (r) => (r.stage || "requested") === "requested"
  );
  const approvedRepairs = repairs.filter((r) => r.stage === "approved");
  const requestedSurveys = surveys.filter(
    (s) => (s.stage || "requested") === "requested"
  );
  const openVisits = visits.filter((v) => v.stage === "requested" || v.stage === "open");
  const myVisitsToSchedule = visits.filter((v) => v.stage === "claimed" && v.assignedTo === me);
  const waitingComms = comms
    // archived (Peak or Gmail side) stops nagging the bell too (S14)
    .filter(
      (t) =>
        t.status === "waiting_us" &&
        t.assignedTo === me &&
        !t.archived &&
        t.gmailInboxed !== false
    )
    .sort((a, b) => waitHours(b) - waitHours(a));

  const counts: NavCounts = {
    inbox: inboxUnread,
    leads: leadCount,
    reviews: reviewQuotes.length + reviewDesigns.length,
    projects: riskProjects.length,
    flametests: renewalRows.length,
    inspections: requestedInspections.length,
    repairs: approvedRepairs.length + flagged.length,
    field: requestedSurveys.length,
  };

  const groups: BellGroup[] = [];
  const push = (key: string, label: string, items: BellItem[]) => {
    if ((prefs as Record<string, boolean>)[key] === false || !items.length)
      return;
    groups.push({ key, label, items });
  };

  push(
    "comms",
    "Customers waiting on a reply",
    waitingComms.map((t) => ({
      id: t.id,
      title: t.customer || t.contactName || t.contactEmail || t.subject,
      sub: `${t.subject} · waiting ${Math.round(waitHours(t))}h`,
      href: "/inbox",
      letter: "@",
      color: "#b4543a",
    }))
  );
  push("reviews", "Needs your review", [
    ...reviewQuotes.map((q) => ({
      id: q.id,
      title: q.name,
      sub: `${q.customer || ""} · quote`,
      href: "/quotes",
      letter: "Q",
      color: "var(--accent)",
    })),
    ...reviewDesigns.map((d) => ({
      id: d.id,
      title: d.name,
      sub: `${d.customer || ""} · design`,
      href: "/design/designs",
      letter: "D",
      color: "#3155a8",
    })),
  ]);
  push(
    "surveys",
    "Survey requests to schedule",
    requestedSurveys.map((s) => ({
      id: s.id,
      title: (s.customer as string) || s.id,
      sub: (s.venue as string) || "Site survey",
      href: "/venue-assessments",
      letter: "S",
      color: "#1f7a52",
    }))
  );
  push(
    "visits",
    "Site visit requests",
    [...openVisits, ...myVisitsToSchedule].map((v) => ({
      id: v.id,
      title: v.customer || v.id,
      sub:
        v.stage === "claimed"
          ? `${v.reason} · claimed — pick a time`
          : `${v.reason} · open — claim it`,
      href: "/venue-assessments",
      letter: "V",
      color: "#7b3f8a",
    }))
  );
  push(
    "inspections",
    "Inspections to schedule",
    requestedInspections.map((r) => ({
      id: r.id,
      title: (r.customer as string) || r.id,
      sub: (r.venue as string) || "Rigging inspection",
      href: "/inspections",
      letter: "I",
      color: "#7b3f8a",
    }))
  );
  push(
    "projects",
    "Projects need attention",
    riskProjects.map((p) => ({
      id: p.id,
      title: p.name,
      sub: riskFlags(p)[0]?.label || "",
      href: "/projects",
      letter: "P",
      color: "#b4543a",
    }))
  );
  push(
    "flame",
    "Flame tests due for renewal",
    renewalRows.map((r) => ({
      id: r.id,
      title: `${r.customer}${r.venues?.[0]?.label ? " — " + r.venues[0].label : ""}`,
      sub: dueLabel(r._renewal.days, r._renewal.state),
      href: "/flame-tests",
      letter: "F",
      color: "#b4543a",
    }))
  );
  push(
    "repairs",
    "Repairs awaiting scheduling",
    approvedRepairs.map((r) => ({
      id: r.id,
      title: (r.customer as string) || r.id,
      sub: `${priorityMeta(r.priority).label} · awaiting scheduling`,
      href: "/repairs",
      letter: "R",
      color: r.priority === "emergency" ? "#8a2f22" : "#b4543a",
    }))
  );
  push(
    "portal",
    "Portal acceptances to confirm",
    portalAccepted.map((q) => ({
      id: q.id,
      title: q.name,
      sub: `${q.customer || ""} · accepted by ${q.portalAcceptance?.by || "customer"} — confirm by marking Won`,
      href: "/quotes?id=" + encodeURIComponent(q.id),
      letter: "✓",
      color: "#1f7a52",
    }))
  );
  push(
    "leads",
    "Leads needing follow-up",
    leadFollowUps.map((l) => {
      const info = followUpInfo(l);
      return {
        id: l.id,
        title: l.org || l.contact || l.id,
        sub: `${info?.label || ""}${l.owner ? "" : " · unassigned"}`,
        href: "/leads",
        letter: "L",
        color: "#b4543a",
      };
    })
  );
  const nowMs = Date.now();
  const taskItems = taskBellItems(taskRows, me, nowMs);
  push("tasks", "Tasks needing attention", taskItems.map((t) => ({
    id: t.id,
    title: t.title,
    sub: t.dueAt
      ? (isOverdue(t, nowMs) ? "Overdue" : "Due " + shortDate(t.dueAt))
      : (t.assigneeName || "Unassigned"),
    href: t.projectId ? `/projects/${t.projectId}` : "/field-work",
    letter: "T",
    color: "#b45309",
  })));

  const bellCount = groups.reduce((n, g) => n + g.items.length, 0);
  return { counts, bell: groups, bellCount };
}
