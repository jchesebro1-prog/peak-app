/**
 * Inbox organization §3 — whose court is a thread in, by rules. "Me" is the
 * thread's mailbox owner. Pure; the AI reading (pilot) and overrides layer
 * on top of this in the pipeline.
 *
 * The last counted message decides (by time):
 *  1. A teammate's forward to me: FYI-only → nobody; otherwise → me (hand-off).
 *  2. From a customer (any non-internal sender): a pure sign-off → nobody;
 *     otherwise → me. A customer's forward is never read as a sign-off.
 *  3. From me → customer.
 *  4. From a teammate (any internal address, a shared one included):
 *     a. To / Cc with no outside address — an internal note on the thread,
 *        the customer never saw it: a pure sign-off or an FYI note → nobody;
 *        otherwise → me (it is addressed to me, asks something, names me,
 *        or is just a note I was sent — never archived on a guess).
 *     b. To the customer, and its own text (quotes stripped) names me
 *        ("Jeff will call you tomorrow") → me (a rule-level hand-off).
 *     c. Otherwise → customer, `teammateId` set (it no longer counts against
 *        me). A message with no recorded To / Cc is read as (b)/(c).
 *     The AI reading (pilot) still catches what the rules can't: a hand-off
 *     to another teammate, or one phrased without my name ("our owner will
 *     call you").
 *  5. Internal-only threads (a teammate and no customer in it) follow the same
 *     rules between teammates: a teammate wrote last → me (sign-off → nobody);
 *     I wrote last → that teammate's court (my sign-off → nobody).
 * My own forwards out (to a vendor, say) are skipped: they don't move the
 * court. Inbound mail from an internal address is a teammate's unless it is
 * one of the owner's own addresses (then it counts as me writing).
 */
import type { Court } from "./types";
import { parseForward } from "./forward";
import { isFyiNote, ownText } from "./forward";
import { mentionsName } from "./names";
import { isSignOff } from "./signoff";

export type CourtMessage = {
  id: string;
  direction: "in" | "out";
  fromEmail: string;
  body: string;
  subject: string;
  at: number;
  /** the message's To / Cc addresses (lower-cased); absent when unknown */
  to?: string[];
  cc?: string[];
};

type CourtCtx = {
  ownerEmails: string[];
  isInternal: (e: string) => boolean;
  teamByEmail: Map<string, string>;
  /** the owner's display name from the team list (first / full name match) */
  ownerName?: string | null;
};
type Role = "owner" | "teammate" | "customer";

const lc = (s: string | null | undefined) => String(s ?? "").trim().toLowerCase();

export function courtByRules(msgs: CourtMessage[], ctx: CourtCtx): Omit<Court, "at" | "source"> {
  if (!msgs.length) return { owner: "nobody", reason: "No messages yet" };
  const owners = new Set(ctx.ownerEmails.map(lc).filter(Boolean));
  const sorted = msgs
    .map((m, i) => ({ m, i }))
    .sort((a, b) => (a.m.at || 0) - (b.m.at || 0) || a.i - b.i)
    .map((x) => x.m);
  const role = (m: CourtMessage): Role => {
    const from = lc(m.fromEmail);
    if (m.direction === "out" || owners.has(from)) return "owner";
    return from && ctx.isInternal(from) ? "teammate" : "customer";
  };
  const teamId = (m: CourtMessage) => ctx.teamByEmail.get(lc(m.fromEmail));
  const who = (m: CourtMessage) => (lc(m.fromEmail) ? ` (${lc(m.fromEmail)})` : "");

  const counted = sorted.filter((m) => !(role(m) === "owner" && parseForward(m.subject, m.body).isForward));
  const last = counted.length ? counted[counted.length - 1] : sorted[sorted.length - 1];
  const roles = sorted.map(role);
  const internalOnly = roles.includes("teammate") && !roles.includes("customer");
  const r = role(last);

  if (r === "teammate") {
    const fwd = parseForward(last.subject, last.body);
    if (fwd.isForward) {
      return fwd.fyi
        ? { owner: "nobody", reason: `A teammate${who(last)} forwarded it FYI — nothing to do` }
        : { owner: "me", reason: `A teammate${who(last)} forwarded it to you — hand-off` };
    }
    if (internalOnly) {
      return isSignOff(last.body)
        ? { owner: "nobody", reason: `A teammate${who(last)} signed off` }
        : { owner: "me", reason: `A teammate${who(last)} wrote to you last` };
    }
    const own = ownText(last.body);
    const namesMe = mentionsName(own, ctx.ownerName);
    const recipients = [...(last.to ?? []), ...(last.cc ?? [])].map(lc).filter((e) => e.includes("@"));
    if (recipients.length && recipients.every((e) => ctx.isInternal(e))) {
      if (isSignOff(last.body)) return { owner: "nobody", reason: `A teammate${who(last)} signed off in an internal note` };
      if (isFyiNote(own)) return { owner: "nobody", reason: `A teammate${who(last)} sent an FYI note — nothing to do` };
      const why = recipients.some((e) => owners.has(e))
        ? "wrote to you"
        : own.includes("?")
          ? "asked something"
          : namesMe
            ? "named you"
            : "left a note";
      return { owner: "me", reason: `A teammate${who(last)} ${why} in an internal note — the customer didn't see it` };
    }
    if (namesMe) return { owner: "me", reason: `A teammate${who(last)} told the customer you'll follow up — hand-off` };
    const teammateId = teamId(last);
    return {
      owner: "customer",
      ...(teammateId ? { teammateId } : {}),
      reason: `A teammate${who(last)} replied — waiting on the customer`,
    };
  }

  if (r === "customer") {
    const fwd = parseForward(last.subject, last.body);
    if (!fwd.isForward && isSignOff(last.body)) return { owner: "nobody", reason: "The customer signed off" };
    return { owner: "me", reason: `The customer${who(last)} wrote last` };
  }

  if (internalOnly) {
    if (isSignOff(last.body)) return { owner: "nobody", reason: "You signed off" };
    const mate = [...sorted].reverse().find((m) => role(m) === "teammate");
    const teammateId = mate ? teamId(mate) : undefined;
    return {
      owner: "teammate",
      ...(teammateId ? { teammateId } : {}),
      reason: `You wrote last — waiting on your teammate${mate ? who(mate) : ""}`,
    };
  }
  return { owner: "customer", reason: "You replied last — waiting on them" };
}
