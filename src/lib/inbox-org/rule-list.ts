/**
 * Inbox organization §5 "Where you see them" — the sender-rule lists: my own
 * rules (Settings → Account) and the company-wide ones (the Assist pilot
 * card, admin). Pure — no store imports; client files may import the types.
 */
import type { SenderRule } from "./types";

export type SenderRuleRowVM = {
  id: string;
  scope: "user" | "company";
  /** "pat@lincolnhs.org" or "@lincolnhs.org" */
  match: string;
  /** "File under Lincoln HS → EST-1042" · "Treat as noise" · "Never noise" */
  action: string;
  /** who made it (a name when known) */
  createdBy: string;
  createdAt: number;
};

export function ruleMatchLabel(r: Pick<SenderRule, "match">): string {
  return r.match.email ? r.match.email : r.match.domain ? "@" + r.match.domain : "";
}

export function ruleActionLabel(r: Pick<SenderRule, "action">, customerName: (id: string) => string | null): string {
  const a = r.action;
  if (a.type === "noise") return "Treat as noise";
  if (a.type === "never-noise") return "Never noise";
  const who = customerName(a.customerId) || a.customerId;
  return `File under ${who}${a.work ? " → " + (a.work.label || a.work.id) : ""}`;
}

/** The rows for one list, newest first. `mine` = the person's personal rules
 *  only; `company` = the company-wide rules. */
export function senderRuleRows(
  rules: SenderRule[],
  which: { scope: "mine"; userId: string } | { scope: "company" },
  names: { customer: (id: string) => string | null; user: (id: string) => string | null }
): SenderRuleRowVM[] {
  return rules
    .filter((r) => (which.scope === "company" ? r.scope === "company" : r.scope === "user" && !!r.userId && r.userId === which.userId))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .map((r) => ({
      id: r.id,
      scope: r.scope,
      match: ruleMatchLabel(r),
      action: ruleActionLabel(r, names.customer),
      createdBy: names.user(r.createdBy) || r.createdBy,
      createdAt: r.createdAt || 0,
    }));
}
