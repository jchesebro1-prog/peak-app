/**
 * #335 Inbox organization — pure helpers shared by the Organize loader
 * (server) and the box / reader (client): tab parsing, links, labels. No
 * imports with side effects — safe in the client bundle.
 */
import type { CourtOwner, Filing } from "@/lib/inbox-org/types";

export type OrganizeTab = "to-file" | "noise" | "filed";

export const ORGANIZE_TABS: OrganizeTab[] = ["to-file", "noise", "filed"];

/** Where the Organize view lives today; a pop-out passes its own base (spec §9). */
export const ORGANIZE_BASE_HREF = "/inbox?view=organize";

/** The Filed tab: the last 14 days, at most 200 rows. */
export const FILED_DAYS = 14;
export const FILED_CAP = 200;

export function organizeTabOf(v: string | null | undefined): OrganizeTab {
  return v === "noise" || v === "filed" ? v : "to-file";
}

/** `base` may already carry a query (`/inbox?view=organize`) or not. A row
 *  opens the ordinary thread reader beside the list (`thread=`). */
export function organizeHref(base: string, tab: OrganizeTab, threadId?: string | null): string {
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}tab=${tab}${threadId ? `&thread=${encodeURIComponent(threadId)}` : ""}`;
}

/** "approved" / "on reply" / "sender rule" / "teammate reply" (spec §2 Filed). */
export function filedByLabel(by: Filing["filedBy"] | null | undefined): string {
  switch (by) {
    case "reply":
      return "on reply";
    case "rule":
      return "sender rule";
    case "teammate-reply":
      return "teammate reply";
    default:
      return "approved";
  }
}

/** The suggestion line: "Lincoln HS → EST-1042 Main curtain", "Noise", or
 *  null when there is nothing to file under yet. */
export function suggestionLabel(
  f: Pick<Filing, "noise" | "customerId" | "work">,
  customerName: string | null
): string | null {
  if (f.noise) return "Noise";
  const work = f.work ? f.work.label || f.work.id : "";
  const parts = [customerName || (f.customerId && !work ? f.customerId : ""), work].filter(Boolean);
  return parts.length ? parts.join(" → ") : null;
}

/** The reader's court chip (spec §3): "On you: …" / "On Dana" / "Waiting on
 *  customer" / "Done". */
export function courtChipLabel(owner: CourtOwner, reason: string, teammateName: string | null): string {
  switch (owner) {
    case "me": {
      const r = (reason || "").trim();
      return r ? `On you: ${r}` : "On you";
    }
    case "teammate":
      return teammateName ? `On ${teammateName}` : "On a teammate";
    case "customer":
      return "Waiting on customer";
    default:
      return "Done";
  }
}

/** The text a "Mark '…' done?" checkbox quotes — one line, ≤ 60 chars. */
export function shortTaskTitle(title: string, max = 60): string {
  const t = (title || "").replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

/** "Organize my inbox" progress — "212 of 480 checked". */
export function cleanupProgressText(checked: number, total: number): string {
  return `${Math.min(checked, total)} of ${total} checked`;
}

/** The finished run's line — "Done: 120 suggested · 80 noise · 30 skipped"
 *  (plus "· 12 still with AI" while the AI step works through the rest). */
export function cleanupSummaryText(s: { suggested: number; noise: number; skipped: number; waitingAi: number }): string {
  return `Done: ${s.suggested} suggested · ${s.noise} noise · ${s.skipped} skipped${s.waitingAi ? ` · ${s.waitingAi} still with AI` : ""}`;
}
