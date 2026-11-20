import { followUps, followUpInfo } from "@/lib/stores/leads";
import { getAll as allQuotes, type Quote } from "@/lib/stores/quotes";
import { listDesignRecords } from "@/lib/stores/designs";
import { getPrefs } from "@/lib/stores/notif-prefs";
import { displayLeadNumber } from "@/lib/estimate-number";
import { quoteBuilderHref } from "@/lib/quote-links";
import { quoteAwaitsApprovalBy, quoteBackFromReview, sameName } from "@/lib/quote-approval-rules";
import { firstName } from "@/lib/team";
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
  const [quotes, designs, leadFollowUps, prefs] = await Promise.all([
    allQuotes(),
    // Fix wave 3 (I3): the badge needs review / owner only — a plain record
    // read, never live Grid pricing (a catalog load per Grid design) on
    // every page navigation.
    listDesignRecords(),
    followUps({ unownedOrMine: true, me }),
    getPrefs(me),
  ]);
  const leadCount = leadFollowUps.length;

  const approvalBell = quoteApprovalBell(quotes, me, canApprove);
  const reviewDesigns = designs.filter(
    (d) =>
      d.review?.state === "in_review" &&
      d.review?.reviewer === me &&
      d.owner !== me
  );
  const counts: NavCounts = {
    leads: leadCount,
    reviews: approvalBell.needs.length + reviewDesigns.length,
  };

  const groups: BellGroup[] = [];
  const push = (key: string, label: string, items: BellItem[]) => {
    if ((prefs as Record<string, boolean>)[key] === false || !items.length)
      return;
    groups.push({ key, label, items });
  };

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

  const bellCount = groups.reduce((n, g) => n + g.items.length, 0);
  return { counts, bell: groups, bellCount };
}
