/**
 * Inbox organization §5 — which saved sender rule applies to a sender.
 * Precedence: personal (user) rules beat company-wide ones; within a scope an
 * exact address beats a domain; the newest rule breaks a remaining tie.
 * Domains match exactly (no subdomains). A personal rule only applies to its
 * own user (`userId` = the mailbox owner). Pure.
 */
import type { SenderRule } from "./types";

const lc = (s: string | null | undefined) => String(s ?? "").trim().toLowerCase();

/** 0 = my email rule … 3 = company domain rule; null = doesn't apply. */
function tier(rule: SenderRule, email: string, domain: string, userId: string): number | null {
  let base: number;
  if (rule.scope === "user") {
    if (!rule.userId || rule.userId !== userId) return null;
    base = 0;
  } else if (rule.scope === "company") base = 2;
  else return null;
  const ruleEmail = lc(rule.match?.email);
  if (ruleEmail) return ruleEmail === email ? base : null;
  const ruleDomain = lc(rule.match?.domain).replace(/^@+/, "");
  if (ruleDomain) return ruleDomain === domain ? base + 1 : null;
  return null;
}

export function matchSenderRule(rules: SenderRule[], sender: { email: string; userId: string }): SenderRule | null {
  const email = lc(sender.email);
  const at = email.lastIndexOf("@");
  if (at <= 0) return null;
  const domain = email.slice(at + 1);
  let best: { rule: SenderRule; tier: number } | null = null;
  for (const rule of rules) {
    const t = tier(rule, email, domain, sender.userId);
    if (t === null) continue;
    if (!best || t < best.tier || (t === best.tier && (rule.createdAt || 0) > (best.rule.createdAt || 0))) best = { rule, tier: t };
  }
  return best?.rule ?? null;
}
