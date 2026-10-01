import { followUps, followUpInfo } from "@/lib/stores/leads";
import { isDone } from "@/lib/pipelines";
import { getAll as allQuotes, type Quote } from "@/lib/stores/quotes";
import { listDesignRecords } from "@/lib/stores/designs";
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
import { unseenCustomerDocuments } from "@/lib/stores/documents";
import { nameFor as customerNameFor } from "@/lib/stores/customers";
import { customerUploadBell } from "@/lib/document-rules";
import { shortDate } from "@/lib/format";
import { displayLeadNumber } from "@/lib/estimate-number";
import { portalBellGroups } from "@/lib/portal-bell";
import { quoteBuilderHref } from "@/lib/quote-links";
import { quoteAwaitsApprovalBy, quoteBackFromReview, sameName } from "@/lib/quote-approval-rules";
import { firstName } from "@/lib/team";
import { perksToFulfil } from "@/lib/stores/reward-perks";
import { perkBellItems } from "@/lib/rewards/perk-bell";
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

/**
 * #284 — the quote half of the approval bell. Approvers see EVERY in-review
 * quote that isn't theirs (shared queue and assigned alike — the reviewer
 * field is advisory), assigned-to-me first; anyone also sees a quote assigned
 * to them by name. Owners see their drafts that came back: approved and still
 * holding (in-app/attested — self and auto approvals happen at send), or sent
 * back for changes. Every item opens the quote itself.
 */
export function quoteApprovalBell(quotes: Quote[], me: string, canApprove: boolean): { needs: BellItem[]; back: BellItem[] } {
  const needs = quotes
    .filter((q) => quoteAwaitsApprovalBy(q, me, canApprove))
    .sort((a, b) => Number(sameName(b.review?.reviewer, me)) - Number(sameName(a.review?.reviewer, me)) || (a.review?.submittedAt || 0) - (b.review?.submittedAt || 0))
    .map((q) => ({
      id: q.id,
      title: q.name,
      sub: `${q.customer || ""} · from ${firstName(q.review?.submittedBy || q.owner || "")}${sameName(q.review?.reviewer, me) ? " · assigned to you" : ""}`,
      href: quoteBuilderHref(q),
      letter: "Q",
      color: "var(--accent)",
    }));
  const back = quotes.flatMap((q) => {
    const kind = quoteBackFromReview(q, me);
    if (!kind) return [];
    const note = (q.review?.note || "").trim();
    const shown = note.length > 80 ? note.slice(0, 79).trimEnd() + "…" : note;
    return [{
      id: q.id,
      title: q.name,
      sub: kind === "changes"
        ? `Sent back by ${firstName(q.review?.decidedBy || "")}${shown ? ` — “${shown}”` : ""}`
        : `Approved — ready to send · ${firstName(q.review?.decidedBy || "")}`,
      href: quoteBuilderHref(q),
      letter: kind === "changes" ? "!" : "✓",
      color: kind === "changes" ? "#b4543a" : "#1f7a52",
    }];
  });
  return { needs, back };
}

export async function navData(me: string, canApprove = false): Promise<{
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
    unseenDocs,
    perkRedemptions,
  ] = await Promise.all([
    allQuotes(),
    // Fix wave 3 (I3): the badge needs review / owner only — a plain record
    // read, never live Grid pricing (a catalog load per Grid design) on
    // every page navigation.
    listDesignRecords(),
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
    // #218 — one SQL-filtered read (source = customer AND seenByTeamAt IS NULL), usually empty.
    unseenCustomerDocuments(),
    // #282 perks+points — one SQL-filtered read of perk ledger entries (usually few).
    perksToFulfil(),
  ]);
  // Everything below is derived from the arrays already fetched above — no
  // extra table scans. Previously these re-fetched inspections+repairs
  // (flagged), leads (leadCount), and comms (unread) a second time, plus a
  // serial round-trip for unread after the parallel batch. navData runs on
  // every app page, so this is per-navigation overhead removed.
  const flagged = await flaggedFromInspections({ jobs: repairs, inspections });
  const leadCount = leadFollowUps.length;
  const inboxUnread = unreadCountFrom(comms, me);

  const approvalBell = quoteApprovalBell(quotes, me, canApprove);
  const reviewDesigns = designs.filter(
    (d) =>
      d.review?.state === "in_review" &&
      d.review?.reviewer === me &&
      d.owner !== me
  );
  const riskProjects = projects.filter(
    (p) => !isDone(p) && riskFlags(p).length > 0
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
    reviews: approvalBell.needs.length + reviewDesigns.length,
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
  push("reviews", "Needs your approval", [
    ...approvalBell.needs,
    ...reviewDesigns.map((d) => ({
      id: d.id,
      title: d.name,
      sub: `${d.customer || ""} · design`,
      href: "/design/designs",
      letter: "D",
      color: "#3155a8",
    })),
  ]);
  push("reviewBack", "Back from review", approvalBell.back);
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
  // #245 (spec §8.2) — derived groups over the same quotes already fetched
  // above; no extra table scan, no writer, no Leads-queue record. #288: all
  // three link the staff Portal quotes queue (/quotes/portal?focus=<id>).
  const {
    review: portalReviewItems,
    generated: portalNewItems,
    accepted: portalAcceptedItems,
  } = portalBellGroups(quotes, me, Date.now());
  push("portal", "Portal acceptances to confirm", portalAcceptedItems);
  push("portalReview", "Portal quotes to review", portalReviewItems);
  push("portalNew", "New portal quotes", portalNewItems);
  push(
    "leads",
    "Leads needing follow-up",
    leadFollowUps.map((l) => {
      const info = followUpInfo(l);
      return {
        id: l.id,
        title: l.org || l.contact || displayLeadNumber(l),
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

  // #218 — one item per company with customer uploads nobody has opened;
  // downloading one (or "Mark seen" on the card) clears it.
  const docBell = customerUploadBell(unseenDocs);
  // A company that no longer resolves has no page to clear it from, so its
  // item is dropped rather than left sitting in the bell for good.
  const docNames = await Promise.all(docBell.map((b) => customerNameFor(b.customerId)));
  push("documents", "New documents from customers", docBell.flatMap((b, i) => (docNames[i] ? [{
    id: "docs-" + b.customerId,
    title: docNames[i],
    sub: b.count === 1 ? "1 new document" : `${b.count} new documents`,
    href: `/companies/${encodeURIComponent(b.customerId)}#documents`,
    letter: "D",
    color: "#3155a8",
  }] : [])));

  // #282 perks+points — redemptions (portal or staff Redeem) nobody has marked
  // fulfilled yet; Mark fulfilled (or an admin Undo) on the company card clears one.
  const perkNames = await Promise.all(perkRedemptions.map((r) => customerNameFor(r.companyId)));
  push("perks", "Perks to fulfil", perkBellItems(perkRedemptions, perkNames));

  const bellCount = groups.reduce((n, g) => n + g.items.length, 0);
  return { counts, bell: groups, bellCount };
}
