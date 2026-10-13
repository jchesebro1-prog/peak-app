/**
 * Inbox organization §1 step 4 — noise by rules. Never applied to a known
 * customer contact or an internal-only thread. Pure.
 */

const CATEGORY_REASON: Record<string, string> = {
  CATEGORY_PROMOTIONS: "Gmail filed it under Promotions",
  CATEGORY_SOCIAL: "Gmail filed it under Social",
  CATEGORY_FORUMS: "Gmail filed it under Forums",
};

const ROBOT_LOCAL = /no-?reply|notifications?|mailer-daemon|bounce/i;
const OUT_OF_OFFICE = /\b(?:out of (?:the )?office|automatic reply|auto[- ]?reply|autoreply)\b/i;

export function noiseByRules(
  m: { labelIds?: string[]; bulk?: boolean; autoSubmitted?: boolean; fromEmail: string; subject: string },
  ctx: { knownContact: boolean; internalOnly: boolean }
): { reason: string } | null {
  if (ctx.knownContact || ctx.internalOnly) return null;
  for (const id of m.labelIds ?? []) {
    const why = CATEGORY_REASON[id];
    if (why) return { reason: why };
  }
  if (m.bulk) return { reason: "Mailing-list mail (unsubscribe / bulk header)" };
  const email = String(m.fromEmail ?? "").trim().toLowerCase();
  const at = email.lastIndexOf("@");
  const local = at > 0 ? email.slice(0, at) : email;
  if (local && ROBOT_LOCAL.test(local)) return { reason: `Sent from an automated address (${email})` };
  if (m.autoSubmitted) return { reason: "Automatic message (Auto-Submitted header)" };
  if (OUT_OF_OFFICE.test(String(m.subject ?? ""))) return { reason: "Out-of-office / automatic reply" };
  return null;
}
