/** Inbox organization checks (#335). Standalone: `npm run test:inbox-org`; also chained into test:specs. */
import { findEstimateNumbers, findRecordIds } from "@/lib/inbox-org/numbers";
import { noiseByRules } from "@/lib/inbox-org/noise";
import { parseForward } from "@/lib/inbox-org/forward";
import { isSignOff } from "@/lib/inbox-org/signoff";
import { makeInternalChecker, ownDomainsFrom } from "@/lib/inbox-org/internal";
import { courtByRules, type CourtMessage } from "@/lib/inbox-org/court";
import { resolveDue } from "@/lib/inbox-org/due";
import { matchSenderRule } from "@/lib/inbox-org/sender-rules";
import { promiseTaskId } from "@/lib/inbox-org/ids";
import type { SenderRule } from "@/lib/inbox-org/types";
import { dueStampForDay } from "@/lib/task-plan/due";
import { chicagoWallMs } from "@/lib/visit-plan/hours";
import { chicagoParts, dayKey } from "@/lib/triage/clock";

export type Ok = (cond: boolean, msg: string) => void;

/* ---------- numbers (§1 step 3) ---------- */

function numberChecks(ok: Ok): void {
  const a = findEstimateNumbers("Re: EST-1042-2 main curtain (was EST-1042) — see also FLM-1002.");
  ok(a.length === 3, "numbers: three distinct estimate numbers found");
  ok(a[0]?.prefix === "EST" && a[0]?.estNo === 1042 && a[0]?.suffix === 2 && a[0]?.raw === "EST-1042-2", "numbers: suffixed EST-1042-2 parsed with suffix 2");
  ok(a[1]?.estNo === 1042 && a[1]?.suffix === null, "numbers: unsuffixed EST-1042 is its own match");
  ok(a[2]?.prefix === "FLM" && a[2]?.estNo === 1002, "numbers: FLM-1002 found");
  ok(findEstimateNumbers("EST-1042 and again EST-1042, est-1042").length === 1, "numbers: duplicates collapse to the first appearance");
  const lowEst = findEstimateNumbers("quote est-1042 attached");
  ok(lowEst.length === 1 && lowEst[0].prefix === "EST", "numbers: lower-case est- is read (EST only), prefix upper-cased");
  ok(findEstimateNumbers("con-2026 rep-2026 rnt-2026 flm-1002 rig-1201 opp-1100 Est-1042x").length === 0, "numbers: other prefixes must be upper-case (con-2026 / rep-2026 are ordinary text)");
  const one = findEstimateNumbers("EST-1042-1 and EST-1042");
  ok(one.length === 1 && one[0].suffix === null && one[0].raw === "EST-1042-1", "numbers: a -1 suffix is the bare number (deduped with EST-1042)");
  ok(findEstimateNumbers("https://x.com/files/REP-1234.pdf ?ref=EST-1042 a=EST-1043 v.EST-1044 est-1045@x.com x@EST-1046").length === 0, "numbers: URL / query / email noise ignored (/ . = ? @ before, @ after)");
  ok(findEstimateNumbers("See EST-1042.pdf and (EST-1043): EST-1044!").length === 3, "numbers: ordinary punctuation around a number still matches");
  const order = findEstimateNumbers("OPP-1100 then RIG-1201 then CON-1300 then REP-1400 then RNT-1500").map((x) => x.prefix);
  ok(order.join(",") === "OPP,RIG,CON,REP,RNT", "numbers: every prefix, in order of appearance");
  ok(findEstimateNumbers("EST-9999999").length === 1 && findEstimateNumbers("EST-9999999")[0].estNo === 9999999, "numbers: a dead (non-existent) number still parses — resolution is the pipeline's job");
  ok(findEstimateNumbers("TEST-1042 XEST-1042 EST-1042X EST_1042").length === 0, "numbers: word-bounded (no TEST-/XEST-/…X/underscore)");
  ok(findEstimateNumbers("ABC-1042 Q-2041 EST-12").length === 0, "numbers: unknown prefix, internal Q- id and a short number are ignored");
  ok(findEstimateNumbers("EST-1042-0").length === 0, "numbers: suffix 0 is invalid → nothing");
  ok(findEstimateNumbers("EST-1042-2026").length === 0, "numbers: a 4-digit tail is not a suffix (no half-match)");
  ok(findEstimateNumbers("Quote EST–1042 attached").length === 1, "numbers: an en dash separator still matches");
  ok(findEstimateNumbers("").length === 0, "numbers: empty text → none");

  const r = findRecordIds("Project P-3001 and order S-4001; lead L-1050. Not REP-4001, FS-1053, RP-4000, P-12 or P-3001x. P-3001 again.");
  ok(r.projects.join(",") === "P-3001,S-4001", "numbers: project ids P-/S- found, deduped, in order");
  ok(r.leads.join(",") === "L-1050", "numbers: lead id L- found");
  ok(findRecordIds("p-3001 l-1050").projects.length === 0, "numbers: record ids are upper-case only");
  const noisy = findRecordIds("/projects/P-3001 ?id=L-1050 P-3002@x.com");
  ok(noisy.projects.length === 0 && noisy.leads.length === 0, "numbers: record ids in URLs / addresses ignored");
}

/* ---------- noise (§1 step 4) ---------- */

function noiseChecks(ok: Ok): void {
  const ctx = { knownContact: false, internalOnly: false };
  const base = { fromEmail: "news@vendor.com", subject: "October deals" };
  ok(noiseByRules({ ...base, labelIds: ["INBOX", "CATEGORY_PROMOTIONS"] }, ctx) !== null, "noise: Gmail Promotions");
  ok(noiseByRules({ ...base, labelIds: ["CATEGORY_SOCIAL"] }, ctx) !== null, "noise: Gmail Social");
  ok(noiseByRules({ ...base, labelIds: ["CATEGORY_FORUMS"] }, ctx) !== null, "noise: Gmail Forums");
  ok(noiseByRules({ ...base, labelIds: ["INBOX", "CATEGORY_UPDATES", "IMPORTANT"] }, ctx) === null, "noise: Updates / Important alone are not noise");
  ok(noiseByRules({ ...base, bulk: true }, ctx) !== null, "noise: List-Unsubscribe / Precedence bulk");
  for (const from of ["noreply@x.com", "no-reply@x.com", "notification@x.com", "notifications@x.com", "MAILER-DAEMON@x.com", "bounce+abc@x.com", "info-noreply@x.com", "donotreply@x.com", "do-not-reply@x.com", "do-notreply@x.com"]) {
    ok(noiseByRules({ fromEmail: from, subject: "Hello" }, ctx) !== null, `noise: local part ${from}`);
  }
  ok(noiseByRules({ fromEmail: "pat@noreply.com", subject: "Hello" }, ctx) === null, "noise: only the local part is checked, not the domain");
  ok(noiseByRules({ fromEmail: "pat@lincolnhs.org", subject: "Hello", autoSubmitted: true }, ctx) !== null, "noise: Auto-Submitted");
  for (const s of ["Automatic reply: Main curtain", "Out of Office: back Monday", "Out of the office", "Auto-Reply: Re: quote", "Autoreply: hi"]) {
    ok(noiseByRules({ fromEmail: "pat@lincolnhs.org", subject: s }, ctx) !== null, `noise: out-of-office subject "${s}"`);
  }
  ok(noiseByRules({ fromEmail: "pat@lincolnhs.org", subject: "Office hours for the stage crew" }, ctx) === null, "noise: an ordinary subject is not noise");
  const all = { fromEmail: "noreply@x.com", subject: "Automatic reply", bulk: true, autoSubmitted: true, labelIds: ["CATEGORY_PROMOTIONS"] };
  ok(noiseByRules(all, { knownContact: true, internalOnly: false }) === null, "noise: never for a known customer contact");
  ok(noiseByRules(all, { knownContact: false, internalOnly: true }) === null, "noise: never for an internal-only thread");
  const why = noiseByRules({ ...base, labelIds: ["CATEGORY_PROMOTIONS"] }, ctx);
  ok(!!why && why.reason.length > 0, "noise: carries a reason line");
}

/* ---------- forwards (§3 Forwards) ---------- */

const GMAIL_FWD = [
  "Can you take this one? They want a quote for the main curtain.",
  "",
  "---------- Forwarded message ---------",
  "From: Pat Lee <pat.lee@lincolnhs.org>",
  "Date: Mon, Oct 12, 2026 at 9:14 AM",
  "Subject: Main curtain replacement",
  "To: Mike Smith <mike@peaksystemsgroup.com>",
  "",
  "Hi Mike, our main curtain is torn. EST-1042?",
].join("\n");

const OUTLOOK_FWD = [
  "FYI for your records.",
  "",
  "________________________________",
  "From: Pat Lee <pat.lee@lincolnhs.org>",
  "Sent: Monday, October 12, 2026 9:14 AM",
  "To: Mike Smith <mike@peaksystemsgroup.com>",
  "Subject: RE: Invoice 4471",
  "",
  "Paid today, thanks.",
].join("\n");

function forwardChecks(ok: Ok): void {
  const g = parseForward("Fwd: Main curtain replacement", GMAIL_FWD);
  ok(g.isForward, "forward: Gmail block detected");
  ok(g.original?.fromEmail === "pat.lee@lincolnhs.org" && g.original?.fromName === "Pat Lee", "forward: Gmail original From parsed");
  ok(g.original?.subject === "Main curtain replacement" && g.original?.date === "Mon, Oct 12, 2026 at 9:14 AM", "forward: Gmail original Subject/Date parsed");
  ok(g.note === "Can you take this one? They want a quote for the main curtain.", "forward: Gmail note is the text above the block");
  ok(!g.fyi, "forward: a question note is not FYI");

  const o = parseForward("FW: Invoice 4471", OUTLOOK_FWD);
  ok(o.isForward && o.original?.fromEmail === "pat.lee@lincolnhs.org" && o.original?.fromName === "Pat Lee", "forward: Outlook From/Sent block parsed");
  ok(o.original?.date === "Monday, October 12, 2026 9:14 AM" && o.original?.subject === "RE: Invoice 4471", "forward: Outlook Sent stands in for Date; Subject kept");
  ok(o.fyi && o.note === "FYI for your records.", "forward: Outlook FYI note → fyi");

  const om = parseForward("FW: Rigging inspection", [
    "",
    "-----Original Message-----",
    "*From:* Pat Lee [mailto:Pat.Lee@LincolnHS.org]",
    "*Sent:* Monday, October 12, 2026 9:14 AM",
    "*To:* Mike Smith",
    "*Subject:* Rigging inspection",
    "",
    "Body",
  ].join("\n"));
  ok(om.isForward && om.original?.fromEmail === "pat.lee@lincolnhs.org" && om.original?.fromName === "Pat Lee", "forward: Outlook Original Message + [mailto:] + bold labels");
  ok(!om.fyi && om.note === "", "forward: a bare forward (no note) is a hand-off, not FYI");

  const ap = parseForward("Fwd: Seats", "No action needed.\n\nBegin forwarded message:\n\nFrom: Pat Lee <pat.lee@lincolnhs.org>\nSubject: Seats\nDate: October 12, 2026 at 9:14:00 AM CDT\nTo: mike@peaksystemsgroup.com\n\nHi");
  ok(ap.isForward && ap.original?.fromEmail === "pat.lee@lincolnhs.org" && ap.original?.subject === "Seats", "forward: Apple Mail 'Begin forwarded message:'");
  ok(ap.fyi, "forward: 'No action needed.' → fyi");

  const app = parseForward("Fwd: Hello", "Over to you.\n\n---------- Forwarded ----------\nFrom: Pat Lee\n\n> Hello there");
  ok(app.isForward && app.original?.fromName === "Pat Lee" && app.original?.fromEmail === "", "forward: Peak's own Forward block (name only)");
  ok(app.original?.subject === "Hello", "forward: subject falls back to the Fwd: subject without its prefix");

  const bodyOnly = parseForward("Main curtain replacement", GMAIL_FWD);
  ok(bodyOnly.isForward && bodyOnly.original?.fromEmail === "pat.lee@lincolnhs.org", "forward: a Gmail forwarded-message block alone (no Fwd: subject) is a forward");
  const subjOnly = parseForward("Fwd: Lunch", "see below");
  ok(subjOnly.isForward && subjOnly.original === null, "forward: Fwd: subject with no header block → forward, original unknown");

  const reply = parseForward("RE: Invoice 4471", OUTLOOK_FWD.replace("FYI for your records.", "Got it, will check."));
  ok(!reply.isForward, "forward: an Outlook REPLY (RE: + From/Sent block) is not a forward");
  const quoted = parseForward("Re: Fwd: Main curtain replacement", "Thanks!\n\nOn Mon, Oct 12, 2026 at 9:20 AM Mike <mike@peaksystemsgroup.com> wrote:\n> ---------- Forwarded message ---------\n> From: Pat Lee <pat.lee@lincolnhs.org>");
  ok(!quoted.isForward, "forward: a reply quoting a forward is not a forward");
  const plain = parseForward("Main curtain", "Hi, can you quote this?");
  ok(!plain.isForward && plain.original === null && !plain.fyi, "forward: ordinary mail is not a forward");

  const fyiAsk = parseForward("Fwd: Seats", "FYI — please call them today.\n\n" + GMAIL_FWD.split("\n").slice(2).join("\n"));
  ok(fyiAsk.isForward && !fyiAsk.fyi, "forward: 'FYI — please call…' is an ask, not FYI-only");
  const fyiQ = parseForward("Fwd: Seats", "FYI, did you see this?\n\n" + GMAIL_FWD.split("\n").slice(2).join("\n"));
  ok(!fyiQ.fyi, "forward: FYI with a question is not FYI-only");
  const fyiSig = parseForward("Fwd: Seats", "FYI\n-- \nMike Smith\nPeak Systems Group\n\n" + GMAIL_FWD.split("\n").slice(2).join("\n"));
  ok(fyiSig.fyi && fyiSig.note === "FYI", "forward: the note drops the -- signature");

  // Pat → Ann → Bob → owner: two nested Gmail blocks, then an Outlook one inside.
  const nested = [
    "Over to you.",
    "",
    "---------- Forwarded message ---------",
    "From: Ann Bell <ann@peaksystemsgroup.com>",
    "Date: Tue, Oct 13, 2026 at 8:00 AM",
    "Subject: Fwd: Main curtain replacement",
    "To: Bob <bob@peaksystemsgroup.com>",
    "",
    "Bob, can you pass this on?",
    "",
    "---------- Forwarded message ---------",
    "From: Pat Lee <pat.lee@lincolnhs.org>",
    "Date: Mon, Oct 12, 2026 at 9:14 AM",
    "Subject: Main curtain replacement",
    "To: Ann Bell <ann@peaksystemsgroup.com>",
    "",
    "Hi Ann, see the thread below.",
    "",
    "From: Sam Ruiz <sam@peaksystemsgroup.com>",
    "Sent: Friday, October 9, 2026 3:00 PM",
    "To: Pat Lee <pat.lee@lincolnhs.org>",
    "Subject: Main curtain",
    "",
    "Pat, we'll get you a number.",
  ].join("\n");
  const internal = (e: string) => e.endsWith("@peaksystemsgroup.com");
  ok(parseForward("Fwd: Fwd: Main curtain replacement", nested).original?.fromEmail === "ann@peaksystemsgroup.com", "forward: nested — without isInternal the first block is reported");
  const deep = parseForward("Fwd: Fwd: Main curtain replacement", nested, internal);
  ok(deep.original?.fromEmail === "pat.lee@lincolnhs.org" && deep.original?.subject === "Main curtain replacement", "forward: nested — the deepest external sender (Pat) is reported, past an internal one below it");
  const allInt = parseForward("Fwd: Fwd: x", nested.replace(/pat\.lee@lincolnhs\.org/g, "pat@peaksystemsgroup.com"), internal);
  ok(allInt.original?.fromEmail === "sam@peaksystemsgroup.com", "forward: nested — all internal → the innermost block");
  const quotedNested = parseForward("Fwd: x", "Take a look.\n\n---------- Forwarded ----------\nFrom: Ann Bell <ann@peaksystemsgroup.com>\n\n> ---------- Forwarded message ---------\n> From: Pat Lee <pat.lee@lincolnhs.org>\n> Subject: Seats\n>\n> Hi", internal);
  ok(quotedNested.original?.fromEmail === "pat.lee@lincolnhs.org" && quotedNested.original?.subject === "Seats", "forward: nested — a block quoted under Peak's own Forward is found");
  ok(parseForward("Fwd: Main curtain replacement", GMAIL_FWD, internal).original?.fromEmail === "pat.lee@lincolnhs.org", "forward: isInternal leaves an external first block alone");
}

/* ---------- sign-offs (§3 rules) ---------- */

function signOffChecks(ok: Ok): void {
  ok(isSignOff("Thanks!"), "signoff: 'Thanks!'");
  ok(!isSignOff("Thanks, can you resend?"), "signoff: 'Thanks, can you resend?' is a question");
  for (const s of ["Thank you", "thank you so much!", "Got it, thanks.", "Sounds good", "Perfect!", "Will do.", "Thanks Jeff!", "Thank you for the quote.", "Perfect, thanks again 👍"]) {
    ok(isSignOff(s), `signoff: '${s}'`);
  }
  for (const s of ["Thanks, I'll send the PO tomorrow.", "Sounds good. Please send the revised quote to our business office.", "Can you resend the invoice", "Hi Mike, here are the measurements", "", "Yes"]) {
    ok(!isSignOff(s), `signoff: not '${s}'`);
  }
  ok(isSignOff("Thanks!\n\nPat Lee\nTheater Director\nLincoln High School\n(608) 555-0101"), "signoff: a trailing signature block doesn't count toward the words");
  ok(isSignOff("Thanks!\nPat"), "signoff: a name line right under it");
  ok(isSignOff("Got it, thank you.\n\nOn Mon, Oct 12, 2026 at 9:20 AM Mike <mike@peaksystemsgroup.com> wrote:\n> Can you send the measurements? When works?"), "signoff: quoted text (and its ?) is stripped first");
  ok(isSignOff("Sounds good!\n-- \nPat Lee\nDid you know? We have a new number."), "signoff: the -- signature is stripped first");
  ok(!isSignOff("Thanks!\nI will check with the principal and get back to you next week."), "signoff: a real second sentence is not a signature");
  ok(!isSignOff("Thank you thank you thank you thank you thank you so much"), "signoff: more than ~8 words is not a sign-off");
  ok(!isSignOff("Thanks!\nSend Invoice"), "signoff: a capitalised imperative line ('Send Invoice') is not a signature");
  ok(!isSignOff("Thanks!\nDeclined"), "signoff: a capitalised status line ('Declined') is not a signature");
  ok(!isSignOff("Thanks Declined"), "signoff: an action word is never a name");
  ok(isSignOff("Thanks!\n- Pat"), "signoff: a dashed name line is still a signature");
}

/* ---------- internal addresses (§3 Internal sender) ---------- */

function internalChecks(ok: Ok): void {
  const team = ["Jeff@PeakSystemsGroup.com", "mike@peaksystemsgroup.com", "jchesebro1@gmail.com", ""];
  const own = ownDomainsFrom(team);
  ok(own.length === 1 && own[0] === "peaksystemsgroup.com", "internal: own domain derived from the team, freemail (gmail.com) excluded");
  const isInt = makeInternalChecker(team, own);
  ok(isInt("someone.new@peaksystemsgroup.com"), "internal: anyone on the own domain");
  ok(isInt("JCHESEBRO1@gmail.com"), "internal: a team member's personal address (case-insensitive)");
  ok(!isInt("friend@gmail.com"), "internal: other gmail addresses are external");
  ok(!isInt("pat@lincolnhs.org") && !isInt("") && !isInt("not-an-address"), "internal: customers / blanks are external");
  ok(!isInt("x@evilpeaksystemsgroup.com"), "internal: a look-alike domain is external");
  ok(isInt("ops@mail.peaksystemsgroup.com"), "internal: a subdomain of the own domain");

  const ov = ownDomainsFrom(team, " @peak-av.com, PeakSystems.co ");
  ok(ov.join(",") === "peak-av.com,peaksystems.co", "internal: the admin override replaces the derived domains (list, @ and case tolerant)");
  const isOv = makeInternalChecker(team, ov);
  ok(isOv("bob@peak-av.com") && isOv("ann@peaksystems.co"), "internal: override domains are internal");
  ok(!isOv("someone.new@peaksystemsgroup.com") && isOv("mike@peaksystemsgroup.com"), "internal: with an override, team addresses stay internal but the old domain alone does not");
  ok(ownDomainsFrom(team, "gmail.com").length === 0, "internal: a freemail override is refused");
  ok(ownDomainsFrom(team, "  ").join(",") === "peaksystemsgroup.com", "internal: a blank override falls back to the derived domains");
}

/* ---------- court (§3 Rules, Forwards, Internal-only) ---------- */

const OWNER = "jeff@peaksystemsgroup.com";
const MIKE = "mike@peaksystemsgroup.com";
const PAT = "pat.lee@lincolnhs.org";
let mid = 0;
function msg(direction: "in" | "out", fromEmail: string, body: string, subject = "Main curtain"): CourtMessage {
  mid++;
  return { id: "m" + mid, direction, fromEmail, body, subject, at: 1_000_000 + mid * 1000 };
}

function courtChecks(ok: Ok): void {
  const team = [OWNER, MIKE];
  const ctx = {
    ownerEmails: [OWNER],
    isInternal: makeInternalChecker(team, ownDomainsFrom(team)),
    teamByEmail: new Map([[OWNER, "u1"], [MIKE, "u2"]]),
  };
  const ask = msg("in", PAT, "Can you quote a new main curtain?");
  ok(courtByRules([ask], ctx).owner === "me", "court: customer wrote last → me");
  ok(courtByRules([ask, msg("out", OWNER, "Yes, I'll send it Thursday.")], ctx).owner === "customer", "court: I wrote last → customer");
  const tm = courtByRules([ask, msg("in", MIKE, "Pat, quote attached.")], ctx);
  ok(tm.owner === "customer" && tm.teammateId === "u2", "court: a teammate replied last → customer, teammateId set");
  ok(courtByRules([ask, msg("in", "new.hire@peaksystemsgroup.com", "On it.")], ctx).owner === "customer", "court: an own-domain address not on the team list still counts as a teammate");
  ok(courtByRules([ask, msg("out", OWNER, "Attached."), msg("in", PAT, "Thanks!")], ctx).owner === "nobody", "court: a customer sign-off → nobody");
  ok(courtByRules([ask, msg("out", OWNER, "Attached."), msg("in", PAT, "Thanks, can you resend?")], ctx).owner === "me", "court: a sign-off with a question → me");
  ok(courtByRules([msg("in", OWNER, "Note to self")], ctx).owner === "customer", "court: inbound from the owner's own address counts as me writing");

  const hand = courtByRules([ask, msg("in", MIKE, GMAIL_FWD, "Fwd: Main curtain replacement")], ctx);
  ok(hand.owner === "me", "court: a teammate's forward to me → me (hand-off)");
  const fyi = courtByRules([ask, msg("in", MIKE, OUTLOOK_FWD, "FW: Invoice 4471")], ctx);
  ok(fyi.owner === "nobody", "court: a teammate's FYI forward → nobody");
  ok(courtByRules([ask, msg("out", OWNER, GMAIL_FWD.replace("Can you take this one?", "Can you price this?"), "Fwd: Main curtain replacement")], ctx).owner === "me", "court: my forward out to a vendor doesn't move the court");
  ok(courtByRules([msg("out", OWNER, "Can you price this?\n\n" + GMAIL_FWD, "Fwd: x")], ctx).owner === "customer", "court: a thread that is only my forward out → waiting on them");
  ok(courtByRules([ask, msg("in", PAT, "Thanks!\n\n" + GMAIL_FWD.split("\n").slice(2).join("\n"), "Fwd: x")], ctx).owner === "me", "court: a customer's forward is never a sign-off → me");

  const intQ = courtByRules([msg("out", OWNER, "Mike, status?", "Lincoln"), msg("in", MIKE, "Can you approve the Lincoln quote?", "Re: Lincoln")], ctx);
  ok(intQ.owner === "me", "court: internal-only — a teammate's question to me → me");
  const intMine = courtByRules([msg("in", MIKE, "Can you approve?", "Lincoln"), msg("out", OWNER, "Approved — send it.", "Re: Lincoln")], ctx);
  ok(intMine.owner === "teammate" && intMine.teammateId === "u2", "court: internal-only — I wrote last → that teammate's court");
  ok(courtByRules([msg("out", OWNER, "Done?", "Lincoln"), msg("in", MIKE, "Got it, thanks.", "Re: Lincoln")], ctx).owner === "nobody", "court: internal-only — a teammate's sign-off → nobody");
  ok(courtByRules([msg("in", MIKE, OUTLOOK_FWD, "FW: Invoice")], ctx).owner === "nobody", "court: internal-only — an FYI forward → nobody");
  const intDone = courtByRules([msg("out", OWNER, "Mike, what's the Lincoln PO number?", "Lincoln"), msg("in", MIKE, "It's 4471.", "Re: Lincoln"), msg("out", OWNER, "Thanks, got it", "Re: Lincoln")], ctx);
  ok(intDone.owner === "nobody", "court: internal-only — my sign-off after a teammate's answer → nobody");
  ok(courtByRules([ask, msg("out", OWNER, "Thanks!")], ctx).owner === "customer", "court: in a customer thread my own sign-off still waits on them");

  const unordered = [msg("out", OWNER, "Attached."), ask];
  unordered[1] = { ...unordered[1], at: 0 };
  ok(courtByRules(unordered, ctx).owner === "customer", "court: the last message is chosen by time, not array order");
  ok(courtByRules([], ctx).owner === "nobody", "court: no messages → nobody");
  ok(courtByRules([ask], ctx).reason.length > 0, "court: carries a reason line");
}

/* ---------- due dates (§7 Due date) ---------- */

const MON = "2026-10-12";
const FRI = "2026-10-16";
const SAT = "2026-10-17";
const at10 = (day: string) => chicagoWallMs(day, 10 * 60);

function dueChecks(ok: Ok): void {
  const cases: Array<[string, string, string]> = [
    // [phrase, anchor, expected day]
    ["", MON, "2026-10-14"], ["", FRI, "2026-10-20"], ["", SAT, "2026-10-20"],
    ["sometime soon", MON, "2026-10-14"],
    ["today", MON, MON], ["today", FRI, FRI], ["today", SAT, SAT],
    ["by EOD", MON, MON],
    ["tomorrow", MON, "2026-10-13"], ["tomorrow", FRI, "2026-10-17"], ["tomorrow morning", SAT, "2026-10-18"],
    ["Thursday", MON, "2026-10-15"], ["by Thursday", FRI, "2026-10-22"], ["thurs", SAT, "2026-10-22"],
    ["Monday", MON, "2026-10-19"], ["Friday", FRI, "2026-10-23"], ["Saturday", SAT, "2026-10-24"],
    ["end of the week", MON, FRI], ["end of week", FRI, FRI], ["by the end of the week", SAT, "2026-10-23"],
    ["next week", MON, "2026-10-19"], ["next week", FRI, "2026-10-19"], ["early next week", SAT, "2026-10-19"],
    ["end of month", MON, "2026-10-31"], ["by the end of the month", FRI, "2026-10-31"], ["end of the month", SAT, "2026-10-31"],
    ["10/22", MON, "2026-10-22"], ["by 10/22/2026", FRI, "2026-10-22"], ["Oct 22", SAT, "2026-10-22"],
    ["October 22nd", MON, "2026-10-22"], ["2026-10-22", MON, "2026-10-22"], ["22 October", MON, "2026-10-22"],
    // a recently passed date → the default; one > ~180 days back rolls to next year
    ["10/1", MON, "2026-10-14"], ["Sep 1", FRI, "2026-10-20"], ["10/1/2026", MON, "2026-10-14"],
    ["Jan 5", MON, "2027-01-05"], ["April 1", MON, "2027-04-01"],
    ["13/45", MON, "2026-10-14"],
    // a month name only counts as a whole word
    ["2 marketing calls", MON, "2026-10-14"], ["3 decks", FRI, "2026-10-20"],
    // compound phrases resolve to their most specific part
    ["by EOD Friday", MON, FRI], ["Friday EOD", MON, FRI], ["COB Thursday", MON, "2026-10-15"],
    ["by EOD Friday", SAT, "2026-10-23"], ["COB Thursday", FRI, "2026-10-22"],
    ["end of next week", MON, "2026-10-23"], ["end of next week", FRI, "2026-10-23"], ["end of next week", SAT, "2026-10-23"],
    ["Wednesday of next week", MON, "2026-10-21"], ["Wednesday of next week", FRI, "2026-10-21"], ["next week Wednesday", SAT, "2026-10-21"],
    ["tomorrow EOD", FRI, "2026-10-17"],
  ];
  for (const [phrase, anchor, want] of cases) {
    const got = resolveDue(phrase, at10(anchor));
    ok(got === dueStampForDay(want), `due: "${phrase}" on ${anchor} → ${want} (got ${dayKey(got)})`);
  }
  const p = chicagoParts(resolveDue("", at10(FRI)));
  ok(p.hour === 17 && p.minute === 0, "due: stamped 5:00 pm Chicago");
  const dst = resolveDue("", at10("2026-10-30"));
  ok(dst === dueStampForDay("2026-11-03") && chicagoParts(dst).hour === 17, "due: default across the DST change (Fri Oct 30 → Tue Nov 3, still 5 pm)");
  ok(resolveDue("today", chicagoWallMs(MON, 23 * 60 + 30)) === dueStampForDay(MON), "due: the anchor is the message's Chicago day (11:30 pm Mon)");
}

/* ---------- sender rules (§5) ---------- */

function senderRuleChecks(ok: Ok): void {
  const rule = (id: string, scope: "user" | "company", match: SenderRule["match"], userId?: string, createdAt = 1): SenderRule => ({
    id, scope, userId, match, action: { type: "noise" }, createdBy: "u1", createdAt,
  });
  const rules = [
    rule("cd", "company", { domain: "lincolnhs.org" }),
    rule("ce", "company", { email: "pat@lincolnhs.org" }),
    rule("ud", "user", { domain: "@LincolnHS.org" }, "u1"),
    rule("ue", "user", { email: "PAT@lincolnhs.org" }, "u1"),
    rule("ue2", "user", { email: "pat@lincolnhs.org" }, "u2"),
  ];
  const pick = (rs: SenderRule[], email: string, userId: string) => matchSenderRule(rs, { email, userId })?.id ?? null;
  ok(pick(rules, "Pat@LincolnHS.org", "u1") === "ue", "sender rules: my email rule wins over everything");
  ok(pick(rules, "sam@lincolnhs.org", "u1") === "ud", "sender rules: my domain rule beats company rules");
  ok(pick(rules.filter((r) => r.scope === "company"), "pat@lincolnhs.org", "u1") === "ce", "sender rules: company email beats company domain");
  ok(pick(rules, "pat@lincolnhs.org", "u3") === "ce", "sender rules: someone else's personal rules never apply to me");
  ok(pick(rules, "sam@lincolnhs.org", "u3") === "cd", "sender rules: company domain as the fallback");
  ok(pick(rules, "pat@other.org", "u1") === null, "sender rules: no match → null");
  ok(pick(rules, "pat@sub.lincolnhs.org", "u3") === null, "sender rules: a domain rule is exact (no subdomains)");
  ok(pick([rule("old", "company", { domain: "x.org" }, undefined, 1), rule("new", "company", { domain: "x.org" }, undefined, 5)], "a@x.org", "u1") === "new", "sender rules: the newest rule wins a tie");
  ok(pick([rule("bad", "user", { email: "a@x.org" })], "a@x.org", "u1") === null, "sender rules: a personal rule with no userId never matches");
  ok(pick([rule("none", "company", {})], "a@x.org", "u1") === null, "sender rules: a rule with no match fields never matches");
  ok(pick(rules, "", "u1") === null, "sender rules: a blank sender never matches");
}

/* ---------- ids (§7 Creation) ---------- */

function idChecks(ok: Ok): void {
  const a = promiseTaskId("C-1032", "m1-abcd", "Send the revised quote");
  ok(/^T-prm-[0-9a-f]{10}$/.test(a), "ids: T-prm-<10 hex>");
  ok(promiseTaskId("C-1032", "m1-abcd", "Send the revised quote") === a, "ids: stable across calls");
  ok(promiseTaskId("C-1032", "m1-abcd", "  send the   revised quote ") === a, "ids: whitespace / case of the promise text don't change the id");
  ok(promiseTaskId("C-1032", "m2-abcd", "Send the revised quote") !== a, "ids: another message → another id");
  ok(promiseTaskId("C-1033", "m1-abcd", "Send the revised quote") !== a, "ids: another thread → another id");
  ok(promiseTaskId("C-1032", "m1-abcd", "Call Pat") !== a, "ids: another promise → another id");
  ok(promiseTaskId("C-1|0", "m", "x") !== promiseTaskId("C-1", "0|m", "x"), "ids: the separator can't be forged by shifting text between fields");
}

export async function inboxOrgPureChecks(ok: Ok): Promise<void> {
  numberChecks(ok);
  noiseChecks(ok);
  forwardChecks(ok);
  signOffChecks(ok);
  internalChecks(ok);
  courtChecks(ok);
  dueChecks(ok);
  senderRuleChecks(ok);
  idChecks(ok);
}

if (process.argv[1] && /test-inbox-org\.ts$/.test(process.argv[1])) {
  let fail = 0;
  const ok: Ok = (c, m) => {
    console.log((c ? "PASS " : "FAIL ") + m);
    if (!c) fail++;
  };
  if (process.env.DATABASE_URL) {
    console.error("Refusing to run: DATABASE_URL is set; unset it (this suite writes to the DB).");
    process.exit(1);
  }
  (async () => {
    await inboxOrgPureChecks(ok);
    // later tasks append: await inboxOrgXChecks(ok);
    console.log(fail ? `\n${fail} FAILED` : "\nall inbox-org checks passed");
    process.exit(fail ? 1 : 0);
  })().catch((err) => {
    console.log("FAIL " + (err instanceof Error ? err.stack || err.message : String(err)));
    process.exit(1);
  });
}
