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
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { blobs, companies, contactEmails, contacts, notifPrefs, sites, users } from "@/db/schema";
import { comms as commsTable } from "@/db/doc-tables";
import { getDoc, patchDoc, setBlob, softDeleteDoc } from "@/db/doc-store";
import { parseInbound } from "@/lib/gmail/mime";
import type { GmailFullMessage } from "@/lib/gmail/api";
import { addMessage, archive, flushOutbox, reinboxFromGmail, reply, replyLeft, runPostReply, setOrg, setStatus, threadsIn, unarchive, type CommMessage, type CommThread } from "@/lib/stores/comms";
import { inboxOrgDisabled } from "@/lib/inbox-org/kill-switch";
import { COURT_STATUS, buildOrgContext, invalidateOrgContext, isOrgPilot, loadOrgContext, organizeThread } from "@/lib/inbox-org/pipeline";
import { onMyCourt, selectEmail } from "@/lib/triage/feeds/email";
import { courtIsCurrent } from "@/lib/inbox-org/court-current";
import { organizeAfterImport, recordMessage } from "@/lib/gmail/bridge";
import { saveContact, setEmails } from "@/lib/identity/contacts";
import { INTERNAL_DOMAIN as INBOX_IDENTITY_INTERNAL_DOMAIN, firstRecipient } from "@/lib/inbox-identity";
import {
  FILING_LOG_BLOB, MAX_FILING_LOG, MAX_SENDER_RULES, ORG_SETTINGS_BLOB, SENDER_RULES_BLOB,
  addSenderRule, appendFilingLog, appendFilingLogs, getFilingLog, getOwnDomainOverride, getSenderRules,
  keepInInbox, removeSenderRule, setKeepInInbox, setOwnDomainOverride, type FilingLogEntry,
} from "@/lib/stores/inbox-org";
import { crmModeOn, setCrmMode } from "@/lib/stores/notif-prefs";
import type { Court, Filing, NoiseFlag } from "@/lib/inbox-org/types";
import { createFixture, dropFixtures, fixtureId, registerFixture } from "./test-fixtures";
import { buildFilingUserText, candidateLine, customerRecordCandidates, filingFromPick, FILING_SYSTEM, sanitizeFiling, type FilingCandidate } from "@/lib/inbox-org/ai-filing";
import { buildOrganizeVM, buildReaderOrg, dueLabel, isNoiseRow } from "@/app/(app)/inbox/organize/load";
import { cleanupProgressText, cleanupSummaryText, courtChipLabel, filedByLabel, ORGANIZE_BASE_HREF, organizeHref, organizeTabOf, suggestionLabel } from "@/app/(app)/inbox/organize/format";
import { assistReport, filingReport } from "@/lib/assist/report";
import type { AssistRun } from "@/lib/stores/assist-runs";
import { senderRuleRows } from "@/lib/inbox-org/rule-list";
import { CLEANUP_BLOB_PREFIX, cleanupRuleSuggestions, cleanupVMOf, getCleanupState, runCleanupBatch } from "@/lib/inbox-org/cleanup";
import { aiCourtOverride, applyPromises, COURT_SYSTEM, PROMISE_MAX_AGE_MS, sanitizeCourt } from "@/lib/inbox-org/ai-court";
import { callWorstCaseMs, MAX_AI_ATTEMPTS, passHasFallback, resetAiPassSweep, runAiPass } from "@/lib/inbox-org/ai-pass";
import type { AssistProvider, ProviderRequest } from "@/lib/assist/types";
import { listDocsByField, upsertDoc, upsertDocs } from "@/db/doc-store";
import type { TaskRecord } from "@/lib/stores/tasks";
import { listRunsByMonth } from "@/lib/stores/assist-runs";
import { monthKeyChicago } from "@/lib/assist/config";
import { getRun } from "@/lib/stores/assist-runs";
import { getSettingsPatch, setSettings } from "@/lib/settings";
import { saveCompany } from "@/lib/identity/companies";
import { saveSite } from "@/lib/identity/sites";
import { desiredPeakLabels } from "@/lib/gmail/peak-labels";
import { personalKey } from "@/lib/gmail/config";
import {
  acceptRuleOffer, approveAllStrong, approveFiling, archiveAfterReply, changeFiling, markNoise, notNoise,
  overrideCourt, skipFiling, toFileThreads, undoFiling, undoPromiseTask,
} from "@/lib/inbox-org/apply";

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
  ok(deep.original?.fromEmail === "pat.lee@lincolnhs.org" && deep.original?.subject === "Main curtain replacement", "forward: nested — the external sender (Pat) is reported, past the internal forwarder above and the internal reply below");
  const allInt = parseForward("Fwd: Fwd: x", nested.replace(/pat\.lee@lincolnhs\.org/g, "pat@peaksystemsgroup.com"), internal);
  ok(allInt.original?.fromEmail === "sam@peaksystemsgroup.com", "forward: nested — all internal → the innermost block");
  const quotedNested = parseForward("Fwd: x", "Take a look.\n\n---------- Forwarded ----------\nFrom: Ann Bell <ann@peaksystemsgroup.com>\n\n> ---------- Forwarded message ---------\n> From: Pat Lee <pat.lee@lincolnhs.org>\n> Subject: Seats\n>\n> Hi", internal);
  ok(quotedNested.original?.fromEmail === "pat.lee@lincolnhs.org" && quotedNested.original?.subject === "Seats", "forward: nested — a block quoted under Peak's own Forward is found");
  ok(parseForward("Fwd: Main curtain replacement", GMAIL_FWD, internal).original?.fromEmail === "pat.lee@lincolnhs.org", "forward: isInternal leaves an external first block alone");
  // two external senders: the customer is outermost, a vendor sits deeper — walking inward, the first external one wins
  const twoExt = nested.replace("From: Sam Ruiz <sam@peaksystemsgroup.com>", "From: Dee Vendor <dee@vendor.com>");
  const outer = parseForward("Fwd: Fwd: Main curtain replacement", twoExt, internal);
  ok(outer.original?.fromEmail === "pat.lee@lincolnhs.org", "forward: nested — with two external senders the OUTERMOST (the customer, Pat) wins over a deeper vendor");
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
  ok(ov.join(",") === "peaksystemsgroup.com,peak-av.com,peaksystems.co", "internal: the admin override's domains follow Peak's own (list, @ and case tolerant)");
  const mixedTeam = ["jeff@peaksystemsgroup.com", "ann@peak-old.com"];
  ok(ownDomainsFrom(mixedTeam).join(",") === "peaksystemsgroup.com,peak-old.com", "internal: with no override, Peak's own + every derived team domain");
  const repl = ownDomainsFrom(mixedTeam, "peak-av.com");
  ok(repl.join(",") === "peaksystemsgroup.com,peak-av.com", "internal: an override REPLACES the team-derived domains (Peak's own stays)");
  const isRepl = makeInternalChecker(mixedTeam, repl);
  ok(!isRepl("bob@peak-old.com") && isRepl("ann@peak-old.com") && isRepl("x@peak-av.com"), "internal: with an override, a derived-only domain is external (team addresses stay internal)");
  ok(ownDomainsFrom(mixedTeam, "gmail.com, not a domain").join(",") === "peaksystemsgroup.com,peak-old.com", "internal: an override with no valid domain falls back to the derived ones");
  const isOv = makeInternalChecker(team, ov);
  ok(isOv("bob@peak-av.com") && isOv("ann@peaksystems.co"), "internal: override domains are internal");
  ok(isOv("someone.new@peaksystemsgroup.com") && isOv("mike@peaksystemsgroup.com"), "internal: with an override, Peak's own domain stays internal");
  ok(ownDomainsFrom(team, "gmail.com").join(",") === "peaksystemsgroup.com", "internal: a freemail override is refused");
  ok(ownDomainsFrom([]).join(",") === "peaksystemsgroup.com" && ownDomainsFrom(["a@gmail.com"], null).join(",") === "peaksystemsgroup.com", "internal: Peak's own domain is always an own domain, even with no team addresses");
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

  /* D894 — a teammate's internal note on a customer thread, and a by-name hand-off */
  const nctx = { ...ctx, ownerName: "Jeff Chesebro" };
  const to = (m: CourtMessage, toList: string[], cc: string[] = []): CourtMessage => ({ ...m, to: toList, cc });
  const SHARED = "sales@peaksystemsgroup.com";
  const note = courtByRules([ask, to(msg("in", MIKE, "Jeff, can you take this, they want pricing Friday"), [OWNER])], nctx);
  ok(note.owner === "me", "court: a teammate's note to the owner only, on a customer thread → me (not the customer's court)");
  ok(courtByRules([ask, to(msg("in", MIKE, "Can you take this one? They want pricing Friday."), [OWNER])], ctx).owner === "me", "court: …even with no owner name on file (a question to me)");
  ok(courtByRules([ask, to(msg("in", MIKE, "Taking this one, I'll quote them Friday."), ["dana@peaksystemsgroup.com"], [OWNER])], nctx).owner === "me", "court: an internal note cc'ing me (no outside address) → me, never archived on a guess");
  ok(courtByRules([ask, to(msg("in", MIKE, "Thanks Jeff!"), [OWNER])], nctx).owner === "nobody", "court: a teammate's internal sign-off → nobody");
  ok(courtByRules([ask, to(msg("in", MIKE, "FYI — they signed the PO, for your records."), [OWNER])], nctx).owner === "nobody", "court: a teammate's internal FYI note → nobody");
  const byName = courtByRules([ask, to(msg("in", MIKE, "Hi Pat, Jeff will be in touch tomorrow about the curtain."), [PAT], [OWNER])], nctx);
  ok(byName.owner === "me" && /hand-off/.test(byName.reason), "court: a teammate's reply to the customer naming the owner ('Jeff will be in touch') → me (rule hand-off)");
  ok(courtByRules([ask, to(msg("in", MIKE, "Hi Pat, Jeff Chesebro will call you."), [PAT])], nctx).owner === "me", "court: the owner's full name counts too");
  ok(courtByRules([ask, to(msg("in", MIKE, "Hi Pat, quote attached.\n\nOn Mon, Oct 12, 2026 at 9:00 AM Jeff <jeff@peaksystemsgroup.com> wrote:\n> Jeff here, can you send it?"), [PAT])], nctx).owner === "customer", "court: the owner's name only in the quoted text doesn't count");
  const plain = courtByRules([ask, to(msg("in", MIKE, "Pat, quote attached."), [PAT], [OWNER])], nctx);
  ok(plain.owner === "customer" && plain.teammateId === "u2", "court: a plain teammate reply to the customer (owner cc'd) → customer, unchanged");
  ok(courtByRules([ask, to(msg("in", MIKE, "Hi Pat, I will call you."), [PAT])], { ...ctx, ownerName: "Will Turner" }).owner === "customer", "court: an everyday-word first name ('will') only counts capitalised");
  ok(courtByRules([ask, to(msg("in", MIKE, "Hi Pat, Will will call you."), [PAT])], { ...ctx, ownerName: "Will Turner" }).owner === "me", "court: …and a capitalised Will is a hand-off");
  ok(courtByRules([ask, to(msg("in", SHARED, "Jeff, can you call them back?"), [OWNER])], nctx).owner === "me", "court: a shared Peak address's internal note to the owner behaves like a teammate's → me");
  const sharedOut = courtByRules([ask, to(msg("in", SHARED, "Hi Pat, thanks for your order."), [PAT])], nctx);
  ok(sharedOut.owner === "customer" && !sharedOut.teammateId, "court: a shared address's reply to the customer → customer (no teammate id)");
  ok(courtByRules([ask, to(msg("in", SHARED, "Hi Pat, Jeff will follow up."), [PAT])], nctx).owner === "me", "court: a shared address naming the owner to the customer → me");
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
    // several weekdays named: the one written first wins, not the first in the week
    ["Friday or Monday", MON, FRI], ["Monday or Friday", MON, "2026-10-19"], ["Thursday or Tuesday", MON, "2026-10-15"],
    ["by Wednesday, otherwise Tuesday", MON, "2026-10-14"],
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

/* ---------- data fields, headers, stores (Task 2) ---------- */

function fakeGmail(headers: Array<[string, string]>): GmailFullMessage {
  const base: Array<[string, string]> = [["From", "News <news@vendor.com>"], ["To", "mike@peaksystemsgroup.com"], ["Subject", "Hello"], ["Message-ID", "<m1@vendor.com>"]];
  return {
    id: "g1", threadId: "t1", labelIds: ["INBOX"], internalDate: "1760000000000",
    payload: { mimeType: "text/plain", headers: [...base, ...headers].map(([name, value]) => ({ name, value })), body: { data: Buffer.from("Hi there").toString("base64url") } },
  } as GmailFullMessage;
}

const RULE_BASE = { scope: "user" as const, userId: "u-org", createdBy: "u-org", action: { type: "noise" as const } };

export async function inboxOrgDbChecks(ok: Ok): Promise<void> {
  /* header fields */
  const plain = parseInbound(fakeGmail([]));
  ok(plain.bulk === false && plain.autoSubmitted === false, "org headers: an ordinary message is neither bulk nor automatic");
  ok(parseInbound(fakeGmail([["List-Unsubscribe", "<mailto:u@vendor.com>"]])).bulk === true, "org headers: List-Unsubscribe → bulk");
  ok(parseInbound(fakeGmail([["list-unsubscribe", "<https://v.com/u>"]])).bulk === true, "org headers: header names are case-insensitive");
  for (const v of ["bulk", "list", "junk", " Bulk "]) ok(parseInbound(fakeGmail([["Precedence", v]])).bulk === true, `org headers: Precedence ${JSON.stringify(v)} → bulk`);
  ok(parseInbound(fakeGmail([["Precedence", "first-class"]])).bulk === false, "org headers: another Precedence value is not bulk");
  ok(parseInbound(fakeGmail([["List-Unsubscribe", "  "]])).bulk === false, "org headers: a blank List-Unsubscribe is not bulk");
  ok(parseInbound(fakeGmail([["Auto-Submitted", "auto-replied"]])).autoSubmitted === true, "org headers: Auto-Submitted: auto-replied → automatic");
  ok(parseInbound(fakeGmail([["Auto-Submitted", "auto-generated"]])).autoSubmitted === true, "org headers: Auto-Submitted: auto-generated → automatic");
  ok(parseInbound(fakeGmail([["Auto-Submitted", "no"]])).autoSubmitted === false && parseInbound(fakeGmail([["Auto-Submitted", " No "]])).autoSubmitted === false, "org headers: Auto-Submitted: no → not automatic");
  const both = parseInbound(fakeGmail([["Precedence", "bulk"], ["Auto-Submitted", "auto-generated"]]));
  ok(both.bulk && both.autoSubmitted && both.from.email === "news@vendor.com" && both.subject === "Hello", "org headers: both flags together; the rest of the parse is unchanged");
  const bridgeSrc = readFileSync("src/lib/gmail/bridge.ts", "utf8");
  const msgLit = bridgeSrc.slice(bridgeSrc.indexOf("const msg: CommMessage = {"), bridgeSrc.indexOf("// attach to an existing thread"));
  ok(msgLit.includes("bulk: p.bulk || undefined") && msgLit.includes("autoSubmitted: p.autoSubmitted || undefined"), "org headers: recordMessage stamps both flags on the one message that feeds both record paths");
  ok(bridgeSrc.split("const msg: CommMessage = {").length === 2 && bridgeSrc.includes("d.messages = (d.messages || []).concat([msg])") && bridgeSrc.includes("messages: [msg]"), "org headers: the existing-thread patch and the new-thread insert both use that one message object");

  /* snapshot every blob / pref row this block writes; restore in finally */
  const db = await getDb();
  const BLOBS = [SENDER_RULES_BLOB, FILING_LOG_BLOB, ORG_SETTINGS_BLOB];
  const before = new Map<string, typeof blobs.$inferSelect | undefined>();
  for (const id of BLOBS) before.set(id, (await db.select().from(blobs).where(eq(blobs.id, id)).limit(1))[0]);
  const PREF_USER = "TEST335 Pref User";
  try {
    for (const id of BLOBS) await db.delete(blobs).where(eq(blobs.id, id));

    /* sender rules */
    ok((await getSenderRules()).length === 0, "org rules: none to start");
    const a = await addSenderRule({ ...RULE_BASE, match: { email: "  Pat@Lincoln.ORG " } });
    ok(a !== null && a.match.email === "pat@lincoln.org" && a.id.startsWith("SR-") && a.createdAt > 0, "org rules: add normalizes the match and fills id + createdAt");
    ok(a !== null && (await getSenderRules()).length === 1 && (await getSenderRules())[0].id === a.id, "org rules: stored in the blob");
    const dom = await addSenderRule({ ...RULE_BASE, match: { domain: "@Lincoln.org" } });
    ok(dom?.match.domain === "lincoln.org" && (await getSenderRules()).length === 2, "org rules: a domain rule is separate from an email rule; leading @ stripped");
    const again = await addSenderRule({ ...RULE_BASE, match: { email: "pat@lincoln.org" }, action: { type: "never-noise" } });
    const afterDup = await getSenderRules();
    ok(afterDup.length === 2 && afterDup.filter((r) => r.match.email === "pat@lincoln.org").length === 1, "org rules: the same match + scope + user dedupes");
    ok(afterDup.find((r) => r.match.email === "pat@lincoln.org")?.action.type === "never-noise" && again !== null && again.id !== a?.id, "org rules: the newer rule replaces the older one");
    await addSenderRule({ ...RULE_BASE, userId: "u-other", createdBy: "u-other", match: { email: "pat@lincoln.org" } });
    await addSenderRule({ ...RULE_BASE, scope: "company", userId: undefined, createdBy: "u-admin", match: { email: "pat@lincoln.org" } });
    ok((await getSenderRules()).length === 4, "org rules: another user's, and a company rule, for the same address are distinct");
    ok((await addSenderRule({ ...RULE_BASE, match: {} })) === null && (await addSenderRule({ ...RULE_BASE, match: { email: "nope" } })) === null, "org rules: no usable match → refused");
    ok((await addSenderRule({ ...RULE_BASE, userId: undefined, match: { domain: "x.com" } })) === null, "org rules: a personal rule needs a user");
    ok((await getSenderRules()).length === 4, "org rules: refused rules store nothing");
    const co = (await getSenderRules()).find((r) => r.scope === "company");
    ok(co !== undefined && !(await removeSenderRule(co.id, { userId: "u-org", admin: false })), "org rules: a non-admin can't delete a company rule");
    const theirs = (await getSenderRules()).find((r) => r.userId === "u-other");
    ok(theirs !== undefined && !(await removeSenderRule(theirs.id, { userId: "u-org", admin: false })), "org rules: you can't delete another user's personal rule");
    ok(theirs !== undefined && (await removeSenderRule(theirs.id, { userId: "u-admin", admin: true })) && (await getSenderRules()).length === 3, "org rules: an admin can delete any rule");
    ok(again !== null && (await removeSenderRule(again.id, { userId: "u-org", admin: false })) && (await getSenderRules()).length === 2, "org rules: you can delete your own personal rule");
    ok(!(await removeSenderRule("SR-missing", { userId: "u-admin", admin: true })), "org rules: deleting an unknown id is false");
    ok(co !== undefined && (await removeSenderRule(co.id, { userId: "u-admin", admin: true })), "org rules: an admin deletes the company rule");
    // parallel adds don't lose each other
    await Promise.all([1, 2, 3, 4, 5].map((n) => addSenderRule({ ...RULE_BASE, match: { email: `p${n}@par.com` } })));
    ok((await getSenderRules()).filter((r) => r.match.email?.endsWith("@par.com")).length === 5, "org rules: five parallel adds all land");
    // the cap: seed the blob one under, then add past it — the oldest drops
    const seed = Array.from({ length: MAX_SENDER_RULES - 1 }, (_, i) => ({ id: `SR-seed${i}`, scope: "company", match: { email: `s${i}@seed.com` }, action: { type: "noise" }, createdBy: "t", createdAt: 1000 + i }));
    await setBlob(SENDER_RULES_BLOB, { rules: seed });
    await addSenderRule({ ...RULE_BASE, match: { email: "last-fits@cap.com" } });
    ok((await getSenderRules()).length === MAX_SENDER_RULES && (await getSenderRules())[0].id === "SR-seed0", "org rules: exactly at the cap nothing drops");
    await addSenderRule({ ...RULE_BASE, match: { email: "over@cap.com" } });
    const capped = await getSenderRules();
    ok(capped.length === MAX_SENDER_RULES && capped[0].id === "SR-seed1" && capped[capped.length - 1].match.email === "over@cap.com", "org rules: past the cap the oldest rule drops, the newest is kept");

    /* filing log */
    const entry = (n: number): FilingLogEntry => ({ at: n, threadId: `C-${n}`, source: "rule", strength: "strong", outcome: "suggested" });
    ok((await getFilingLog()).length === 0, "org log: empty to start");
    await appendFilingLog(entry(1));
    await appendFilingLogs([entry(2), entry(3)]);
    await appendFilingLogs([]);
    ok((await getFilingLog()).map((e) => e.at).join(",") === "1,2,3", "org log: appended newest last");
    await setBlob(FILING_LOG_BLOB, { entries: Array.from({ length: MAX_FILING_LOG - 1 }, (_, i) => entry(100 + i)) });
    await appendFilingLog(entry(9001));
    ok((await getFilingLog()).length === MAX_FILING_LOG && (await getFilingLog())[0].at === 100, "org log: exactly at the cap nothing drops");
    await appendFilingLogs([entry(9002), entry(9003)]);
    const log = await getFilingLog();
    ok(log.length === MAX_FILING_LOG && log[0].at === 102 && log[log.length - 1].at === 9003 && log[log.length - 2].at === 9002, "org log: past the cap the oldest entries drop, newest last");

    /* own domain override */
    ok((await getOwnDomainOverride()) === null, "org settings: no override by default");
    await setOwnDomainOverride("  peaksystemsgroup.com, peak.example  ");
    ok((await getOwnDomainOverride()) === "peaksystemsgroup.com, peak.example", "org settings: override saved trimmed");
    await setOwnDomainOverride("   ");
    ok((await getOwnDomainOverride()) === null, "org settings: a blank value clears the override");

    /* keepInInbox: same notif_prefs row as the bell flags */
    ok((await keepInInbox(PREF_USER)) === false, "org prefs: keepInInbox defaults to false (archive-on-reply on)");
    await setKeepInInbox(PREF_USER, true);
    ok((await keepInInbox(PREF_USER)) === true, "org prefs: keepInInbox round trip → true");
    ok((await keepInInbox(PREF_USER + " other")) === false, "org prefs: it is per user");
    await setKeepInInbox(PREF_USER, false);
    ok((await keepInInbox(PREF_USER)) === false, "org prefs: keepInInbox round trip → false");
    await setKeepInInbox(PREF_USER, true);
    await setCrmMode(true, PREF_USER);
    ok((await keepInInbox(PREF_USER)) && (await crmModeOn(PREF_USER)), "org prefs: keepInInbox and CRM mode share one row without clobbering each other");

    /* setOrg */
    const id = fixtureId(335, "org-thread");
    const base = {
      id, mailbox: "personal", mailboxUser: "Mike", unread: true, archived: false, customerId: "cust-1", customer: "Lincoln HS",
      contactName: "Pat", contactEmail: "pat@lincoln.org", cc: "", subject: "Curtains", channel: "email", status: "waiting_us",
      assignedTo: "Mike", link: { type: "quote", id: "Q-2041" }, messages: [{ id: "m1", at: 1000, direction: "in", channel: "email", author: "Pat", body: "Hi", gmailId: "g1" }],
      createdAt: 1000, updatedAt: 5000, syncState: "synced", syncedAt: 6000, rev: 7, siteId: "loc-1",
    } as unknown as CommThread;
    await createFixture("comms", base);
    const filing: Filing = { customerId: "cust-1", work: null, noise: false, source: "rule", reason: "known sender", strength: "strong", needsReply: true, state: "suggested", at: 111 };
    const court: Court = { owner: "me", reason: "customer asked", source: "rule", at: 112 };
    const noise: NoiseFlag = { flagged: false, reason: "", moved: false };
    const written = await setOrg(id, { filing, court });
    ok(written !== null && written.filing?.reason === "known sender" && written.court?.owner === "me", "org setOrg: writes filing and court");
    const got = (await getDoc<CommThread>("comms", id))!;
    // jsonb round trips reorder keys, so compare with sorted keys
    const sorted = (v: unknown): unknown => (Array.isArray(v) ? v.map(sorted) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).sort(([x], [y]) => (x < y ? -1 : 1)).map(([k, x]) => [k, sorted(x)])) : v);
    const rest = (t: CommThread) => JSON.stringify(sorted({ ...t, filing: undefined, court: undefined, noise: undefined }));
    ok(rest(got) === rest({ ...base, id }), "org setOrg: every other field is untouched");
    ok(got.updatedAt === 5000 && got.rev === 7 && got.syncedAt === 6000, "org setOrg: no touch() — updatedAt, rev and syncedAt keep their values");
    await setOrg(id, { noise });
    const got2 = (await getDoc<CommThread>("comms", id))!;
    ok(got2.noise?.flagged === false && got2.filing?.at === 111 && got2.court?.at === 112, "org setOrg: a patch with one key leaves the other two");
    await setOrg(id, { filing: { ...filing, state: "filed", at: 200 } });
    ok((await getDoc<CommThread>("comms", id))?.filing?.state === "filed", "org setOrg: a key present replaces that key");
    await setOrg(id, { court: null });
    const got3 = (await getDoc<CommThread>("comms", id))!;
    ok(got3.court === undefined && !("court" in got3) && got3.filing?.at === 200, "org setOrg: null clears one key");
    await setOrg(id, {});
    ok(JSON.stringify(await getDoc<CommThread>("comms", id)) === JSON.stringify(got3), "org setOrg: an empty patch changes nothing");
    await setOrg(id, { subject: "hacked", archived: true, link: null } as never);
    const got4 = (await getDoc<CommThread>("comms", id))!;
    ok(got4.subject === "Curtains" && got4.archived === false && got4.link?.id === "Q-2041", "org setOrg: only filing / court / noise are ever written");
    ok((await setOrg("TEST335:missing", { filing })) === null, "org setOrg: a missing thread → null");

    /* key-level atomicity: setOrg never writes back a stale whole doc */
    const id2 = fixtureId(335, "org-thread-race");
    await createFixture("comms", { ...base, id: id2 });
    // the same shape recordMessage's existing-thread path uses: patchDoc appending to `messages`
    const appendMsg = (mid: string) =>
      patchDoc<CommThread>("comms", id2, (d) => {
        d.messages = (d.messages || []).concat([{ id: mid, at: 2000, direction: "in", channel: "email", author: "Pat", body: "More", gmailId: mid }]);
        d.updatedAt = Math.max(d.updatedAt || 0, 2000);
      });
    // setOrg's UPDATE is one SQL statement issued before the append's read-then-write lands; the old
    // patchDoc-based setOrg read the doc, then wrote it all back and lost the append (or the filing).
    await Promise.all([setOrg(id2, { filing }), appendMsg("gm-race1")]);
    const race1 = (await getDoc<CommThread>("comms", id2))!;
    ok(race1.filing?.reason === "known sender" && race1.messages.some((m) => m.id === "gm-race1") && race1.messages.length === 2, "org setOrg: a concurrent message append and a filing write both survive");
    await Promise.all([setOrg(id2, { court }), setOrg(id2, { noise }), setOrg(id2, { filing: { ...filing, state: "filed", at: 300 } })]);
    const race2 = (await getDoc<CommThread>("comms", id2))!;
    ok(race2.court?.owner === "me" && race2.noise?.flagged === false && race2.filing?.state === "filed" && race2.messages.length === 2, "org setOrg: three concurrent org writes to different keys all survive");
    await softDeleteDoc("comms", id2);
    ok((await setOrg(id2, { court: null })) === null, "org setOrg: a soft-deleted thread → null, and is not revived");
    ok((await getDoc<CommThread>("comms", id2)) === null, "org setOrg: the soft-deleted thread stays deleted");

    /* addSenderRule stores known fields only and needs a createdBy */
    const clean = await addSenderRule({ ...RULE_BASE, match: { email: "clean@x.com" }, evil: "x", action: { type: "noise", extra: 1 } } as never);
    const cleanStored = (await getSenderRules()).find((r) => r.match.email === "clean@x.com");
    ok(clean !== null && cleanStored !== undefined && Object.keys(cleanStored).sort().join(",") === "action,createdAt,createdBy,id,match,scope,userId" && JSON.stringify(cleanStored.action) === '{"type":"noise"}', "org rules: only known fields reach the blob");
    ok((await addSenderRule({ ...RULE_BASE, createdBy: "  ", match: { email: "nob@x.com" } })) === null && (await addSenderRule({ ...RULE_BASE, createdBy: undefined as never, match: { email: "nob@x.com" } })) === null, "org rules: a blank or missing createdBy is refused");
    ok((await addSenderRule({ ...RULE_BASE, match: { email: "nob@x.com" }, action: { type: "bogus" } as never })) === null && (await addSenderRule({ ...RULE_BASE, match: { email: "nob@x.com" }, action: { type: "file", customerId: "" } })) === null, "org rules: an unknown action, or a file action without a customer, is refused");
    const fileRule = await addSenderRule({ ...RULE_BASE, match: { email: "file@x.com" }, action: { type: "file", customerId: "cust-1", work: { type: "quote", id: "Q-2041" } } });
    ok(fileRule?.action.type === "file" && fileRule.action.work?.id === "Q-2041", "org rules: a file action keeps its customer and work");
  } finally {
    for (const id of BLOBS) {
      const row = before.get(id);
      if (row) await db.update(blobs).set({ data: row.data, updatedAt: row.updatedAt }).where(eq(blobs.id, id));
      else await db.delete(blobs).where(eq(blobs.id, id));
    }
    await db.delete(notifPrefs).where(eq(notifPrefs.userName, PREF_USER));
    await db.delete(notifPrefs).where(eq(notifPrefs.userName, PREF_USER + " other"));
  }
}

/** The inbox identity picker's internal rule, read through its public
 *  surface: firstRecipient skips internal addresses. */
const INBOX_IDENTITY_INTERNAL = (email: string) => firstRecipient(email) === null;
const sortedJson = (v: unknown): string => {
  const s = (x: unknown): unknown => (Array.isArray(x) ? x.map(s) : x && typeof x === "object" ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, y]) => [k, s(y)])) : x);
  return JSON.stringify(s(v));
};

/* ---------- Task 3: the rule pipeline, the import hook, court-driven status + triage ---------- */

export async function inboxOrgPipelineChecks(ok: Ok): Promise<void> {
  const MIKE = "TEST335 Mike";
  const MIKE_ID = "TEST335-u-mike";
  const DANA_ID = "TEST335-u-dana";
  const users = [
    { id: MIKE_ID, name: MIKE, email: "mike@peaksystemsgroup.com", googleEmail: null },
    { id: DANA_ID, name: "TEST335 Dana", email: "dana@peaksystemsgroup.com", googleEmail: null },
  ];
  const ctx = buildOrgContext({ users });
  const pilotAssist = { users: [MIKE_ID], features: { tasks: true, reply: true, estimate: true, file: true, promise: true, brief: true, ask: true }, capUsd: 200 };
  const pilot = buildOrgContext({ users, assist: pilotAssist, env: { ANTHROPIC_API_KEY: "sk-test-not-real" } });

  /* context + pilot gate (pure) */
  ok(ctx.ownDomains.includes("peaksystemsgroup.com") && ctx.isInternal("dana@peaksystemsgroup.com") && !ctx.isInternal("pat@school.test"), "org pipeline ctx: Peak's own domain is internal, a customer's isn't");
  ok(ctx.teamByEmail.get("dana@peaksystemsgroup.com") === DANA_ID, "org pipeline ctx: team address → user id");
  const withConn = buildOrgContext({ users, connections: [{ address: "Mike.Personal@gmail.com", userId: MIKE_ID }] });
  ok(withConn.users[0].emails.includes("mike.personal@gmail.com") && withConn.isInternal("mike.personal@gmail.com") && !withConn.isInternal("someone@gmail.com") && !withConn.ownDomains.includes("gmail.com"), "org pipeline ctx: a connected personal Gmail is internal; gmail.com never an own domain");
  const over = buildOrgContext({ users, ownDomainOverride: "peak.example" });
  ok(over.ownDomains.join(",") === "peaksystemsgroup.com,peak.example" && over.isInternal("x@peak.example") && over.isInternal("new.hire@peaksystemsgroup.com"), "org pipeline ctx: an admin override adds to Peak's own domain");
  ok(over.isInternal("ops@peaksystemsgroup.com") === INBOX_IDENTITY_INTERNAL("ops@peaksystemsgroup.com") && INBOX_IDENTITY_INTERNAL_DOMAIN === "peaksystemsgroup.com", "org pipeline ctx: the pipeline and inbox-identity agree on Peak's own domain");
  ok(!isOrgPilot(MIKE_ID, "file", ctx) && isOrgPilot(MIKE_ID, "file", pilot) && isOrgPilot(MIKE_ID, "promise", pilot) && !isOrgPilot(DANA_ID, "file", pilot) && !isOrgPilot(null, "file", pilot), "org pipeline: isOrgPilot — pilot user + Assist configured only");
  ok(!isOrgPilot(MIKE_ID, "file", { assist: pilotAssist, env: {} }), "org pipeline: isOrgPilot — no key → not pilot");
  const fileOff = { assist: { ...pilotAssist, features: { ...pilotAssist.features, file: false } }, env: { ANTHROPIC_API_KEY: "sk-test-not-real" } };
  ok(!isOrgPilot(MIKE_ID, "file", fileOff) && isOrgPilot(MIKE_ID, "promise", fileOff), "org pipeline: isOrgPilot reads the real file / promise switches (file off, promise on)");
  ok(COURT_STATUS.me === "waiting_us" && COURT_STATUS.customer === "waiting_them" && COURT_STATUS.teammate === "waiting_them" && COURT_STATUS.nobody === "closed", "org pipeline: court → status mapping");

  /* fixtures */
  const T0 = 1_760_000_000_000;
  let n = 0;
  const msg = (o: Partial<CommMessage>): CommMessage => ({ id: `pm${++n}`, at: T0 + n * 60_000, direction: "in", channel: "email", author: "Pat", body: "Hello there, can you help?", ...o }) as CommMessage;
  const mk = async (slug: string, o: Partial<CommThread>): Promise<string> => {
    const id = fixtureId(335, "pipe-" + slug);
    await createFixture("comms", {
      id, mailbox: "personal", mailboxUser: MIKE, unread: true, archived: false, customerId: null, customer: "", contactName: "Pat",
      contactEmail: "pat@school.test", cc: "", subject: "Hello", channel: "email", status: "waiting_us", assignedTo: "", link: null,
      messages: [msg({ fromEmail: "pat@school.test" })], createdAt: T0, updatedAt: T0 + 5, resolution: "unknown", ...o,
    } as unknown as CommThread);
    return id;
  };
  const read = async (id: string) => (await getDoc<CommThread>("comms", id))!;
  const QUOTE = fixtureId(335, "pipe-quote");
  const CUST = fixtureId(335, "pipe-cust");
  await createFixture("quotes", { id: QUOTE, name: "Main curtain", customer: "Lincoln HS", customerId: CUST, estNo: 987654, quoteType: "system", status: "sent" });
  const PEAK_CONTACT = fixtureId(335, "pipe-contact");
  const db = await getDb();
  try {
    /* 1. a number in the subject links the quote (strong) */
    const log: FilingLogEntry[] = [];
    const numId = await mk("number", { subject: "Re: EST-987654 curtain question" });
    const r1 = await organizeThread(numId, { ctx, log });
    const t1 = await read(numId);
    ok(!r1.skipped && t1.filing?.work?.type === "quote" && t1.filing.work.id === QUOTE && t1.filing.customerId === CUST, "org pipeline: a number in the subject files the thread under that quote and its customer");
    ok(t1.filing?.source === "number" && t1.filing.strength === "strong" && t1.filing.state === "suggested" && t1.filing.reason.includes("EST-987654") && t1.filing.reason.includes("subject"), "org pipeline: number filing is strong, suggested, and says where the number was");
    ok(t1.filing?.work?.label === "EST-987654 Main curtain", "org pipeline: the work label is the quote's number + name");
    ok(t1.filing?.needsReply === true && t1.court?.owner === "me" && !t1.filing.pendingAi, "org pipeline: a customer's question → needsReply, court me; non-pilot → no pendingAi");
    ok(log.length === 1 && log[0].threadId === numId && log[0].source === "number" && log[0].outcome === "suggested" && log[0].customerId === CUST && log[0].workType === "quote", "org pipeline: a rule-sourced suggestion lands in the filing log (collected by the caller)");
    await organizeThread(numId, { ctx, log });
    ok(log.length === 1 && JSON.stringify((await read(numId)).filing) === JSON.stringify(t1.filing), "org pipeline: re-organizing an unchanged thread writes and logs nothing new");
    const deadId = await mk("dead-number", { subject: "EST-987999 question" });
    await organizeThread(deadId, { ctx });
    const tDead = await read(deadId);
    ok(tDead.filing?.work === null && tDead.filing.customerId === null && tDead.filing.state === "suggested" && !tDead.filing.noise, "org pipeline: a dead number is ignored → unresolved suggestion");
    const deadPilot = await mk("dead-pilot", { subject: "EST-987999 question" });
    await organizeThread(deadPilot, { ctx: pilot });
    ok((await read(deadPilot)).filing?.pendingAi === true, "org pipeline: an unresolved filing for a pilot owner is marked pendingAi");
    const bodyNum = await mk("body-number", { messages: [msg({ fromEmail: "pat@school.test", body: "Following up on est-987654 please" })] });
    await organizeThread(bodyNum, { ctx });
    ok((await read(bodyNum)).filing?.work?.id === QUOTE && (await read(bodyNum)).filing!.reason.includes("message"), "org pipeline: a number in the body is found too");

    /* 2. a sender rule wins */
    const ruled = buildOrgContext({
      users,
      senderRules: [{ id: "SR-t1", scope: "user", userId: MIKE_ID, match: { email: "pat@school.test" }, action: { type: "file", customerId: "TEST335:other-cust" }, createdBy: MIKE_ID, createdAt: 1 }],
    });
    const ruleId = await mk("rule", { subject: "EST-987654 again", customerId: CUST, resolution: "linked" });
    await organizeThread(ruleId, { ctx: ruled });
    const tRule = await read(ruleId);
    ok(tRule.filing?.source === "rule" && tRule.filing.customerId === "TEST335:other-cust" && tRule.filing.strength === "strong" && tRule.filing.reason.startsWith("Your sender rule"), "org pipeline: a sender rule beats identity and numbers");
    const noiseRule = buildOrgContext({ users, senderRules: [{ id: "SR-t2", scope: "company", match: { domain: "school.test" }, action: { type: "noise" }, createdBy: MIKE_ID, createdAt: 1 }] });
    const nrId = await mk("rule-noise", {});
    await organizeThread(nrId, { ctx: noiseRule });
    ok((await read(nrId)).filing?.noise === true && (await read(nrId)).noise?.flagged === true && (await read(nrId)).noise?.moved === false, "org pipeline: a company noise rule flags noise (non-pilot: tag only)");

    /* 3. identity */
    const linkedId = await mk("linked", { customerId: CUST, customer: "Lincoln HS", resolution: "linked", resolvedContactId: "ct-x" });
    await organizeThread(linkedId, { ctx });
    const tLinked = await read(linkedId);
    ok(tLinked.filing?.source === "identity" && tLinked.filing.strength === "strong" && tLinked.filing.customerId === CUST && tLinked.filing.reason.includes("known contact"), "org pipeline: a contact-matched thread is a strong identity filing");
    const suggId = await mk("suggested", { resolution: "suggested", suggestedCustomerId: CUST });
    await organizeThread(suggId, { ctx });
    ok((await read(suggId)).filing?.strength === "weak" && (await read(suggId)).filing?.customerId === CUST, "org pipeline: a domain suggestion is a weak identity filing");
    const suggNum = await mk("suggested-number", { resolution: "suggested", suggestedCustomerId: "TEST335:dom-cust", subject: "EST-987654" });
    await organizeThread(suggNum, { ctx });
    ok((await read(suggNum)).filing?.source === "number" && (await read(suggNum)).filing?.customerId === CUST, "org pipeline: a number beats a weak domain guess");

    /* 4. noise: a known contact is never noise; pilot moved + archived; non-pilot tagged */
    await saveContact({ id: PEAK_CONTACT, firstName: "Known", lastName: "Sender", homeCompanyId: fixtureId(335, "pipe-co"), title: "" });
    await setEmails(PEAK_CONTACT, [{ value: "known@vendor-news.test", label: "work", isPrimary: true }]);
    const knownId = await mk("known", { contactEmail: "known@vendor-news.test", messages: [msg({ fromEmail: "known@vendor-news.test", bulk: true, gmailLabelIds: ["CATEGORY_PROMOTIONS"] })] });
    await organizeThread(knownId, { ctx: pilot });
    const tKnown = await read(knownId);
    ok(!tKnown.filing?.noise && !tKnown.noise && !tKnown.archived, "org pipeline: a known contact is never noise, even with promo/bulk signals");
    const promo = () => ({ contactEmail: "deals@shop.test", messages: [msg({ fromEmail: "deals@shop.test", gmailLabelIds: ["INBOX", "CATEGORY_PROMOTIONS"] })] });
    const pNoise = await mk("noise-pilot", promo());
    const rP = await organizeThread(pNoise, { ctx: pilot });
    const tP = await read(pNoise);
    ok(tP.noise?.flagged === true && tP.noise.moved === true && tP.archived === true && tP.filing?.noise === true && tP.filing.source === "noise-rule", "org pipeline: a pilot owner's noise is moved — flagged, moved, archived");
    ok(tP.updatedAt === T0 + 5 && !rP.skipped && rP.archived === true, "org pipeline: the noise move is quiet (the list order keeps the message time)");
    const noiseList = await threadsIn("personal", "noise", { id: MIKE_ID, name: MIKE, nameUnique: true });
    ok(noiseList.some((t) => t.id === pNoise) && !noiseList.some((t) => t.id === knownId), "org pipeline: threadsIn(…, 'noise') lists moved noise only");
    ok(!(await threadsIn("personal", "inbox", { id: MIKE_ID, name: MIKE, nameUnique: true })).some((t) => t.id === pNoise), "org pipeline: moved noise has left the inbox folder");
    const nNoise = await mk("noise-plain", promo());
    await organizeThread(nNoise, { ctx });
    const tN = await read(nNoise);
    ok(tN.noise?.flagged === true && tN.noise.moved === false && tN.archived === false, "org pipeline: a non-pilot owner's noise is only tagged (stays in the inbox)");
    ok(!(await threadsIn("personal", "noise", { id: MIKE_ID, name: MIKE, nameUnique: true })).some((t) => t.id === nNoise), "org pipeline: tagged-only noise isn't in the Noise tab");
    const rescued = await mk("noise-rescued", { ...promo(), noise: { flagged: false, reason: "", moved: false, rescued: true } });
    await organizeThread(rescued, { ctx: pilot });
    ok(!(await read(rescued)).noise?.flagged && (await read(rescued)).noise?.rescued === true && !(await read(rescued)).archived, "org pipeline: a rescued thread is never flagged again");
    const replied = await mk("noise-owner-wrote", { messages: [msg({ direction: "out", fromEmail: "mike@peaksystemsgroup.com", to: "deals@shop.test" }), msg({ fromEmail: "deals@shop.test", gmailLabelIds: ["CATEGORY_PROMOTIONS"] })], contactEmail: "deals@shop.test" });
    await organizeThread(replied, { ctx: pilot });
    ok(!(await read(replied)).noise && !(await read(replied)).archived, "org pipeline: a thread the owner wrote in is never noise");
    const ownerFromGmail = await mk("noise-owner-inbound", {
      contactEmail: "deals@shop.test",
      messages: [msg({ direction: "in", fromEmail: "mike@peaksystemsgroup.com", to: "deals@shop.test" }), msg({ fromEmail: "deals@shop.test", gmailLabelIds: ["CATEGORY_PROMOTIONS"] })],
    });
    await organizeThread(ownerFromGmail, { ctx: pilot });
    ok(!(await read(ownerFromGmail)).noise, "org pipeline: the owner writing from their own address (imported as inbound) still blocks noise");
    const weakNoise = await mk("noise-weak-domain", {
      resolution: "suggested",
      suggestedCustomerId: CUST,
      contactEmail: "rfp-notify@district.test",
      messages: [msg({ fromEmail: "rfp-notify@district.test", bulk: true })],
    });
    await organizeThread(weakNoise, { ctx: pilot });
    const tWeak = await read(weakNoise);
    ok(tWeak.noise?.flagged === true && tWeak.noise.moved === false && tWeak.archived === false && tWeak.filing?.noise === true, "org pipeline: rule noise on a weak-domain thread is tag-only, even for a pilot owner");
    ok(!(await threadsIn("personal", "noise", { id: MIKE_ID, name: MIKE, nameUnique: true })).some((t) => t.id === weakNoise), "org pipeline: tag-only weak-domain noise stays out of the Noise tab");
    ok(tWeak.filing?.customerId === CUST && tWeak.filing.pendingAi === true, "org pipeline: tag-only weak-domain noise keeps the guessed customer and is pendingAi for a pilot owner (the AI decides)");
    const weakNoisePlain = await mk("noise-weak-domain-plain", { resolution: "suggested", suggestedCustomerId: CUST, contactEmail: "rfp-notify@district.test", messages: [msg({ fromEmail: "rfp-notify@district.test", bulk: true })] });
    await organizeThread(weakNoisePlain, { ctx });
    ok((await read(weakNoisePlain)).filing?.customerId === CUST && !(await read(weakNoisePlain)).filing?.pendingAi, "org pipeline: a non-pilot owner's tag-only noise keeps the guess, no pendingAi");
    /* (a) moved noise that becomes tag-only comes back to the inbox */
    const movedThenTag = await mk("noise-moved-then-tag", promo());
    await organizeThread(movedThenTag, { ctx: pilot });
    ok((await read(movedThenTag)).noise?.moved === true && (await read(movedThenTag)).archived === true, "org pipeline: (setup) pilot noise moved + archived");
    await patchDoc<CommThread>("comms", movedThenTag, (d) => {
      d.resolution = "suggested";
      d.suggestedCustomerId = CUST;
    });
    const rMtt = await organizeThread(movedThenTag, { ctx: pilot });
    const tMtt = await read(movedThenTag);
    ok(tMtt.noise?.flagged === true && tMtt.noise.moved === false && tMtt.archived === false && !rMtt.skipped && rMtt.unarchived === true, "org pipeline: moved noise that is now only a tag (a weak domain guess appeared, no new mail) is un-archived");
    ok(tMtt.filing?.pendingAi === true && tMtt.filing.customerId === CUST, "org pipeline: …and the AI step gets to decide it");
    const mixed = await mk("noise-internal-sender", {
      messages: [msg({ fromEmail: "pat@school.test" }), msg({ fromEmail: "noreply@peaksystemsgroup.com", author: "Peak App", bulk: true, autoSubmitted: true, gmailLabelIds: ["CATEGORY_FORUMS"] })],
    });
    await organizeThread(mixed, { ctx: pilot });
    ok(!(await read(mixed)).noise && !(await read(mixed)).archived && (await read(mixed)).filing?.noise === false, "org pipeline: an internal sender (noreply@peaksystemsgroup.com) is never noise, even in a mixed thread");

    /* 5. court: a teammate's last message → customer, status waiting_them */
    const mateId = await mk("teammate", {
      messages: [msg({ fromEmail: "pat@school.test" }), msg({ fromEmail: "dana@peaksystemsgroup.com", author: "Dana", body: "Hi Pat, I'll get you a price Friday.", to: "pat@school.test", cc: "mike@peaksystemsgroup.com" })],
    });
    const rMate = await organizeThread(mateId, { ctx });
    const tMate = await read(mateId);
    ok(tMate.court?.owner === "customer" && tMate.court.teammateId === DANA_ID && tMate.court.source === "rule" && tMate.status === "waiting_them", "org pipeline: a teammate's last message → court customer (teammate named), status waiting_them");
    ok(!rMate.skipped && rMate.lastAuthor === "teammate" && rMate.newMail === true, "org pipeline: the result names a teammate as the last author (Task 5's teammate-reply archive)");
    ok(tMate.updatedAt === T0 + 5 && tMate.filing?.needsReply === false, "org pipeline: the status sync is quiet; needsReply false when the court isn't me");
    const myReply = await mk("my-reply", { messages: [msg({ fromEmail: "pat@school.test" }), msg({ direction: "out", fromEmail: "mike@peaksystemsgroup.com", to: "pat@school.test" })], status: "waiting_them" });
    await organizeThread(myReply, { ctx });
    ok((await read(myReply)).court?.owner === "customer" && (await read(myReply)).status === "waiting_them", "org pipeline: my reply → court customer");
    const thanks = await mk("signoff", { messages: [msg({ direction: "out", fromEmail: "mike@peaksystemsgroup.com", to: "pat@school.test" }), msg({ fromEmail: "pat@school.test", body: "Thanks so much!" })] });
    await organizeThread(thanks, { ctx });
    ok((await read(thanks)).court?.owner === "nobody" && (await read(thanks)).status === "closed", "org pipeline: a customer's sign-off → nobody, status closed");

    /* 6. forwards: from a teammate → me (filed on the original sender); FYI → nobody */
    const fwdBody = (note: string) =>
      `${note}\n\n---------- Forwarded message ---------\nFrom: Pat Doe <pat@lincoln-fwd.test>\nDate: Mon, Oct 12, 2026 at 9:00 AM\nSubject: Bleachers\nTo: Dana <dana@peaksystemsgroup.com>\n\nWe need a bleacher curtain quote.`;
    const fwdRule = buildOrgContext({
      users,
      senderRules: [{ id: "SR-t3", scope: "company", match: { email: "pat@lincoln-fwd.test" }, action: { type: "file", customerId: CUST }, createdBy: MIKE_ID, createdAt: 1 }],
    });
    const fwdId = await mk("forward", { subject: "Fwd: Bleachers", contactEmail: "dana@peaksystemsgroup.com", messages: [msg({ fromEmail: "dana@peaksystemsgroup.com", author: "Dana", to: "mike@peaksystemsgroup.com", body: fwdBody("Mike, can you take this one?") })] });
    await organizeThread(fwdId, { ctx: fwdRule });
    const tFwd = await read(fwdId);
    ok(tFwd.court?.owner === "me" && tFwd.status === "waiting_us", "org pipeline: a teammate's forward to me → court me (hand-off)");
    ok(tFwd.filing?.source === "rule" && tFwd.filing.customerId === CUST && !tFwd.noise, "org pipeline: the forward is filed on the original (external) sender — the sender rule for Pat applies");
    const fyiId = await mk("forward-fyi", { subject: "Fwd: Bleachers", contactEmail: "dana@peaksystemsgroup.com", messages: [msg({ fromEmail: "dana@peaksystemsgroup.com", author: "Dana", to: "mike@peaksystemsgroup.com", body: fwdBody("FYI — for your records.") })] });
    await organizeThread(fyiId, { ctx });
    ok((await read(fyiId)).court?.owner === "nobody" && (await read(fyiId)).status === "closed", "org pipeline: an FYI forward → court nobody, status closed");
    const custFwd = await mk("customer-forward", {
      subject: "Fwd: Bleachers",
      customerId: "TEST335:fwd-owner",
      customer: "Pat's school",
      resolution: "linked",
      messages: [msg({ fromEmail: "pat@school.test", body: fwdBody("Can you price this?") })],
    });
    await organizeThread(custFwd, { ctx: fwdRule });
    ok((await read(custFwd)).filing?.customerId === "TEST335:fwd-owner" && (await read(custFwd)).filing?.source === "identity", "org pipeline: a customer's own forward stays filed under the customer (not the forwarded sender's rule)");
    const fwdReply = await mk("forward-then-reply", {
      subject: "Fwd: Bleachers",
      contactEmail: "dana@peaksystemsgroup.com",
      messages: [msg({ fromEmail: "dana@peaksystemsgroup.com", to: "mike@peaksystemsgroup.com", body: fwdBody("Can you take this?") }), msg({ direction: "out", fromEmail: "mike@peaksystemsgroup.com", to: "dana@peaksystemsgroup.com", body: "On it." })],
    });
    await organizeThread(fwdReply, { ctx });
    ok((await read(fwdReply)).court?.owner === "teammate", "org pipeline: my reply in a thread that began as a forward is a reply, not 'my forward out'");

    /* internal-only threads: never noise, no nagging suggestion */
    const internal = await mk("internal", { contactEmail: "dana@peaksystemsgroup.com", subject: "Lunch?", messages: [msg({ fromEmail: "dana@peaksystemsgroup.com", to: "mike@peaksystemsgroup.com", body: "Lunch at noon?", bulk: true })] });
    await organizeThread(internal, { ctx });
    const tInt = await read(internal);
    ok(tInt.filing?.state === "skipped" && !tInt.noise && tInt.court?.owner === "me", "org pipeline: an internal-only thread with no number → skipped filing, never noise, court me");
    const internalNum = await mk("internal-number", { contactEmail: "dana@peaksystemsgroup.com", subject: "EST-987654 pricing", messages: [msg({ fromEmail: "dana@peaksystemsgroup.com", to: "mike@peaksystemsgroup.com" })] });
    await organizeThread(internalNum, { ctx });
    ok((await read(internalNum)).filing?.work?.id === QUOTE && (await read(internalNum)).filing?.state === "suggested", "org pipeline: an internal-only thread is filed by a number");

    /* preservation: filed / skipped / override */
    const filedFiling: Filing = { customerId: "TEST335:kept", work: null, noise: false, source: "identity", reason: "kept", strength: "strong", needsReply: false, state: "filed", at: 1, filedBy: "approved", filedAt: 1 };
    const filedId = await mk("filed", { subject: "EST-987654", filing: filedFiling });
    await organizeThread(filedId, { ctx });
    ok((await read(filedId)).filing?.customerId === "TEST335:kept" && (await read(filedId)).filing?.state === "filed" && (await read(filedId)).court?.owner === "me", "org pipeline: a filed thread keeps its filing; the court still updates");
    const { needsReply: nr, ...filedRest } = (await read(filedId)).filing!;
    const { needsReply: _was, ...origRest } = filedFiling;
    void _was;
    ok(nr === true && sortedJson(filedRest) === sortedJson(origRest), "org pipeline: a filed filing refreshes needsReply from the court and nothing else");
    const dismissedId = await mk("dismissed", { messages: [msg({ direction: "out", fromEmail: "mike@peaksystemsgroup.com", to: "pat@school.test" })], filing: { ...filedFiling, state: "dismissed", needsReply: true } });
    await organizeThread(dismissedId, { ctx });
    ok((await read(dismissedId)).filing?.state === "dismissed" && (await read(dismissedId)).filing?.needsReply === false, "org pipeline: a dismissed filing's needsReply clears once the court leaves me");
    /* court.promise: kept while the newest message is the same, dropped on a newer one */
    const pm = msg({ fromEmail: "pat@school.test" });
    const promise = { text: "I'll send it Friday", ownerUserId: MIKE_ID, due: null, messageId: pm.id };
    const promId = await mk("promise", { messages: [pm], court: { owner: "me", reason: "x", source: "rule", at: pm.at + 1, basis: pm.id, promise } });
    await organizeThread(promId, { ctx });
    ok((await read(promId)).court?.promise?.text === promise.text, "org pipeline: court.promise kept while no newer message arrived");
    await patchDoc<CommThread>("comms", promId, (d) => {
      d.messages = [...d.messages, msg({ fromEmail: "pat@school.test", body: "Also, the stage depth?" })];
    });
    await organizeThread(promId, { ctx });
    ok(!(await read(promId)).court?.promise, "org pipeline: a newer message drops court.promise (the AI reading re-derives it)");
    const lastMsg = msg({ fromEmail: "pat@school.test", body: "Can you call me?" });
    const overrideId = await mk("override", { messages: [lastMsg], court: { owner: "nobody", reason: "Not on me", source: "override", at: lastMsg.at + 1, basis: lastMsg.id }, status: "closed" });
    await organizeThread(overrideId, { ctx });
    ok((await read(overrideId)).court?.source === "override" && (await read(overrideId)).court?.owner === "nobody" && (await read(overrideId)).status === "closed", "org pipeline: an override sticks while no new message has arrived");
    await patchDoc<CommThread>("comms", overrideId, (d) => {
      d.messages = [...d.messages, msg({ fromEmail: "pat@school.test", body: "Any update on this?" })];
    });
    await organizeThread(overrideId, { ctx });
    ok((await read(overrideId)).court?.source === "rule" && (await read(overrideId)).court?.owner === "me" && (await read(overrideId)).status === "waiting_us", "org pipeline: a newer message ends the override and reopens the thread");
    const manualClosed = await mk("manual-closed", { status: "closed" });
    await organizeThread(manualClosed, { ctx, backlog: true });
    ok((await read(manualClosed)).status === "closed" && (await read(manualClosed)).court?.owner === "me", "org pipeline: backlog never reopens a manually closed thread (court computed, status kept)");
    const closedMine = await mk("closed-mine", { status: "closed", messages: [msg({ fromEmail: "pat@school.test" }), msg({ direction: "out", fromEmail: "mike@peaksystemsgroup.com", to: "pat@school.test" })] });
    await organizeThread(closedMine, { ctx });
    ok((await read(closedMine)).status === "closed", "org pipeline: closed stays closed after the owner's own message (deriveStatus's rule)");

    /* pendingAi on the court (pilot, not backlog, not a sign-off) */
    const cp = await mk("court-pilot", {});
    await organizeThread(cp, { ctx: pilot });
    ok((await read(cp)).court?.pendingAi === true, "org pipeline: a pilot owner's court is marked pendingAi for the AI reading");
    const cpb = await mk("court-pilot-backlog", {});
    await organizeThread(cpb, { ctx: pilot, backlog: true });
    ok(!(await read(cpb)).court?.pendingAi, "org pipeline: backlog → no court pendingAi (no promise-tasks from old mail)");
    const cps = await mk("court-pilot-signoff", { messages: [msg({ direction: "out", fromEmail: "mike@peaksystemsgroup.com", to: "pat@school.test" }), msg({ fromEmail: "pat@school.test", body: "Got it, thanks!" })] });
    await organizeThread(cps, { ctx: pilot });
    ok(!(await read(cps)).court?.pendingAi, "org pipeline: a sign-off isn't sent to the AI reading");

    /* un-archive: archived, court becomes me through new mail */
    const arch = await mk("unarchive", { archived: true, status: "waiting_them", messages: [msg({ direction: "out", fromEmail: "mike@peaksystemsgroup.com", to: "pat@school.test" })] });
    await organizeThread(arch, { ctx });
    ok((await read(arch)).archived === true && (await read(arch)).court?.owner === "customer", "org pipeline: my last message leaves an archived thread archived");
    await patchDoc<CommThread>("comms", arch, (d) => {
      d.messages = [...d.messages, msg({ fromEmail: "pat@school.test", body: "One more question?" })];
    });
    const rArch = await organizeThread(arch, { ctx });
    ok((await read(arch)).archived === false && !rArch.skipped && rArch.unarchived === true, "org pipeline: new customer mail making the court 'me' un-archives");
    const stillArch = await mk("stays-archived", { archived: true });
    await organizeThread(stillArch, { ctx, backlog: true });
    ok((await read(stillArch)).archived === true, "org pipeline: a first organize (no earlier court) never un-archives a thread someone archived");

    /* skips */
    const draft = await mk("draft", { status: "draft" });
    ok((await organizeThread(draft, { ctx })).skipped === "draft" && !(await read(draft)).court, "org pipeline: drafts are skipped untouched");
    const del = await mk("deleted", { deleted: true });
    ok((await organizeThread(del, { ctx })).skipped === "deleted" && !(await read(del)).court, "org pipeline: deleted-folder threads are skipped untouched");
    ok((await organizeThread("TEST335:nope", { ctx })).skipped === "missing", "org pipeline: a missing thread is skipped");

    /* 7. the triage email feed respects the court */
    const tri = (id: string, extra: Record<string, unknown>) =>
      ({ id, mailbox: "personal", mailboxUser: MIKE, unread: true, customerId: null, customer: "Acme", contactName: "Pat", contactEmail: "pat@acme.test", subject: "Q", channel: "email", status: "waiting_us", assignedTo: MIKE, link: null, messages: [{ id: "m1", at: T0, direction: "in", channel: "email", author: "Pat", body: "Hi" }], createdAt: T0, updatedAt: T0, ...extra }) as unknown as CommThread;
    const court = (owner: Court["owner"]): Court => ({ owner, reason: "", source: "rule", at: T0 });
    const picked = selectEmail(
      [
        tri("C-a", { court: court("me") }),
        tri("C-b", { court: court("customer") }),
        tri("C-c", {}),
        tri("C-d", { status: "waiting_them" }),
        tri("C-e", { court: court("me"), status: "waiting_them" }),
        tri("C-f", { court: court("nobody") }),
        tri("C-g", { court: court("me"), noise: { flagged: true, reason: "promo", moved: false } }),
        tri("C-h", { noise: { flagged: false, reason: "", moved: false, rescued: true } }),
      ],
      { quotes: new Map(), leads: new Map() },
      { viewer: { id: MIKE_ID, name: MIKE, nameUnique: true }, now: T0 + 3 * 86_400_000 }
    );
    ok(picked.map((c) => c.key).join(",") === "email:C-a,email:C-c,email:C-h", "org triage: waiting_us AND court 'me' (or no court); a customer / nobody court doesn't count; a rescued thread does");
    ok(!picked.some((c) => c.key === "email:C-e"), "org triage: court 'me' but status waiting_them (an in-app reply / Mark replied moved on) → not picked");
    ok(!picked.some((c) => c.key === "email:C-g"), "org triage: a flagged-noise thread is never picked");
    ok(picked[0]?.since === T0, "org triage: the row dates from the last inbound");
    ok(onMyCourt({ court: undefined, status: "waiting_us" }) && !onMyCourt({ court: court("teammate"), status: "waiting_us" }) && !onMyCourt({ court: court("me"), status: "replied" }), "org triage: onMyCourt");
    /* D901 — a stale court (new mail never organized) doesn't hide that mail; the kill switch reads status only */
    const newMsgs = [
      { id: "m1", at: T0, direction: "in", channel: "email", author: "Pat", body: "Hi" },
      { id: "m2", at: T0 + 60_000, direction: "out", channel: "email", author: "Mike", body: "On it" },
      { id: "m3", at: T0 + 120_000, direction: "in", channel: "email", author: "Pat", body: "Any news?" },
    ];
    const staleCust: Court = { owner: "customer", reason: "", source: "rule", at: T0 + 60_000, basis: "m2" };
    const fresh = selectEmail(
      [
        tri("S-stale", { court: staleCust, messages: newMsgs }),
        tri("S-current", { court: { ...staleCust, basis: "m3" }, messages: newMsgs }),
        tri("S-nobasis", { court: { owner: "customer", reason: "", source: "rule", at: T0 + 60_000 }, messages: newMsgs }),
      ],
      { quotes: new Map(), leads: new Map() },
      { viewer: { id: MIKE_ID, name: MIKE, nameUnique: true }, now: T0 + 3 * 86_400_000 }
    );
    ok(fresh.map((c) => c.key).join(",") === "email:S-stale,email:S-nobasis", "org triage: a stale customer court plus new inbound mail → picked (status decides); a current customer court still hides it");
    ok(courtIsCurrent({ court: { basis: "m3", at: 0 }, messages: newMsgs }) && !courtIsCurrent({ court: { basis: "m2", at: 0 }, messages: newMsgs }) && !courtIsCurrent({ court: null, messages: newMsgs }) && courtIsCurrent({ court: { basis: "x", at: 0 }, messages: [] }), "org triage: courtIsCurrent follows the newest email message's id");
    ok(courtIsCurrent({ court: { at: T0 }, messages: [{ id: "c", at: T0 + 5, channel: "call" }, { id: "e", at: T0, channel: "email" }] }), "org triage: a newer call / meeting doesn't make the court stale");
    const KILL = { INBOX_ORG_DISABLED: "true" };
    ok(onMyCourt({ court: court("customer"), status: "waiting_us" }, KILL) && onMyCourt({ court: court("me"), status: "waiting_us", noise: { flagged: true, reason: "promo", moved: false } }, KILL) && !onMyCourt({ court: court("me"), status: "waiting_them" }, KILL), "org triage: kill switch on → status only (court and noise tag ignored)");
    ok(!onMyCourt({ court: court("customer"), status: "waiting_us" }, {}), "org triage: kill switch off → a current customer court still hides it");

    /* 8. the import hook: organize errors never break recordMessage */
    let threw = false;
    try {
      await organizeAfterImport("TEST335:any", {}, async () => {
        throw new Error("boom");
      });
    } catch {
      threw = true;
    }
    ok(!threw, "org hook: a throwing organizer never escapes organizeAfterImport");
    const bridgeSrc = readFileSync("src/lib/gmail/bridge.ts", "utf8");
    const recBody = bridgeSrc.slice(bridgeSrc.indexOf("export async function recordMessage("), bridgeSrc.indexOf("async function userNameOfKey("));
    ok((recBody.match(/await organizeAfterImport\((existing\.id|id), org(, undefined, \{ wasArchived \})?\)/g) || []).length === 2, "org hook: recordMessage organizes on both the existing-thread and the new-thread path");
    ok(recBody.indexOf("await organizeAfterImport(existing.id, org, undefined, { wasArchived })") > recBody.indexOf("await patchDoc<CommThread>(\"comms\", existing.id") && recBody.indexOf("await organizeAfterImport(id, org)") > recBody.indexOf("insertDocIfAbsent"), "org hook: organizing runs after the write resolves");
    ok(bridgeSrc.includes("const next = courtIsCurrent({ court: t.court, messages: sorted }) ? t.status : deriveStatus(") && bridgeSrc.includes("if (!courtIsCurrent(d) && (d.status ==="), "org hook: rederiveStatuses leaves a current court's status alone and re-derives under a stale one (D901)");
    ok(bridgeSrc.includes("backlog: !info.initialImportDone") && bridgeSrc.includes("appendFilingLogs(org.log.splice(0))"), "org hook: the 90-day import is backlog; the filing log is appended once per sync");
    // a real import: the hook organizes the new thread; a failing organize still returns the id
    invalidateOrgContext();
    const gm = (id: string, from: string, body: string, to = "mike@peaksystemsgroup.com"): GmailFullMessage =>
      ({
        id, threadId: "TEST335-gthread", labelIds: ["INBOX"], internalDate: String(T0 + 9_000_000),
        payload: { mimeType: "text/plain", headers: [["From", from], ["To", to], ["Subject", "Re: EST-987654"], ["Message-ID", `<${id}@x.test>`]].map(([name, value]) => ({ name, value })), body: { data: Buffer.from(body).toString("base64url") } },
      }) as GmailFullMessage;
    const created = await recordMessage("personal:TEST335-nobody", parseInbound(gm("TEST335-g1", "Pat <pat@school.test>", "Any news?")));
    const imported = created ? await read(created) : null;
    ok(!!created && imported?.court?.owner === "me" && imported.filing?.work?.id === QUOTE, "org hook: a real recordMessage organizes the new thread (court + number filing)");
    const again = await recordMessage("personal:TEST335-nobody", parseInbound(gm("TEST335-g2", "Dana <dana@peaksystemsgroup.com>", "I'll handle it, Pat.", "pat@school.test")));
    ok(again === created && (await read(created!)).court?.owner === "customer" && (await read(created!)).status === "waiting_them", "org hook: the next message on the thread re-organizes it (a teammate's reply → customer)");
    if (created) await db.delete(commsTable).where(eq(commsTable.id, created));
  } finally {
    await db.delete(contactEmails).where(eq(contactEmails.contactId, PEAK_CONTACT));
    await db.delete(contacts).where(eq(contacts.id, PEAK_CONTACT));
    invalidateOrgContext();
  }
}

/* ---------- Task 4: Haiku filing + court/promise reading, the time-boxed AI pass ---------- */

/** A fake provider that answers the filing and the court prompts separately. */
function routedProvider(answers: { file?: string; promise?: string }, opts: { calls?: ProviderRequest[]; onCall?: () => void } = {}): AssistProvider {
  return {
    name: "fake",
    async complete(req) {
      opts.calls?.push(req);
      opts.onCall?.();
      const text = req.system === FILING_SYSTEM ? answers.file : answers.promise;
      if (text === undefined) return { ok: false, error: "no answer", model: req.model, usage: null, stopReason: null };
      return { ok: true, text, model: req.model, usage: { inputTokens: 500, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0 }, stopReason: "end_turn" };
    },
  };
}

function aiPureChecks(ok: Ok): void {
  const CUST = "co-match";
  const cands: FilingCandidate[] = [
    { id: CUST, type: "customer", label: "Lincoln HS", customerId: CUST, customerName: "Lincoln HS" },
    { id: "Q-1", type: "quote", label: "EST-1042 Main | curtain", customerId: CUST, customerName: "Lincoln HS" },
    { id: "co-other", type: "customer", label: "Lincoln Theatre", customerId: "co-other", customerName: "Lincoln Theatre" },
  ];
  ok(candidateLine(cands[1]) === "Q-1 | quote | EST-1042 Main / curtain | Lincoln HS", "ai filing: a candidate line is id | type | label | customer (no stray separator)");
  const strong = sanitizeFiling({ target: "Q-1", confidence: "strong", reason: " Asks about\nthe curtain ", needsReply: true }, cands, CUST);
  ok(strong.kind === "record" && strong.candidate.id === "Q-1" && strong.strength === "strong" && strong.reason === "Asks about the curtain" && strong.needsReply, "ai filing: a strong pick inside the candidates on the matched customer stays strong");
  ok(sanitizeFiling({ target: CUST, confidence: "strong", reason: "", needsReply: false }, cands, CUST).kind === "record", "ai filing: the matched customer itself is a valid target");
  const off = sanitizeFiling({ target: "co-other", confidence: "strong", reason: "x", needsReply: false }, cands, CUST);
  ok(off.kind === "record" && off.strength === "weak", "ai filing: strong is downgraded to weak when the target isn't the matched customer's");
  const noMatch = sanitizeFiling({ target: "Q-1", confidence: "strong", reason: "x", needsReply: false }, cands, null);
  ok(noMatch.kind === "record" && noMatch.strength === "weak", "ai filing: no matched customer → never strong");
  const out = sanitizeFiling({ target: "Q-999", confidence: "strong", reason: "made up", needsReply: true }, cands, CUST);
  ok(out.kind === "none" && out.dropped === true, "ai filing: an id outside the candidate list is dropped (→ none)");
  ok(sanitizeFiling({ target: "NOISE", confidence: "strong", reason: "promo", needsReply: true }, cands, CUST).kind === "noise" && sanitizeFiling({ target: "none", confidence: "weak", reason: "", needsReply: false }, cands, CUST).kind === "none", "ai filing: noise / none words accepted");
  const prev = { customerId: CUST, work: null, noise: false, source: "identity" as const, reason: "domain", strength: "weak" as const, needsReply: true, state: "suggested" as const, at: 1, pendingAi: true, aiAttempts: 1, basis: "m1" };
  const rec = filingFromPick(strong, prev, { now: 5, runId: "AR-1", courtOwnerIsMe: true, prevNoise: { flagged: true, reason: "bulk", moved: false } });
  ok(rec.filing.source === "ai" && rec.filing.work?.id === "Q-1" && rec.filing.customerId === CUST && rec.filing.runId === "AR-1" && rec.filing.needsReply && !rec.filing.pendingAi && rec.filing.aiAttempts === undefined && rec.filing.basis === "m1" && rec.noise === null, "ai filing: a record pick → ai filing (work + customer + runId), pending cleared, the rules' noise tag dropped");
  const nz = filingFromPick({ kind: "noise", strength: "weak", reason: "promo", needsReply: false }, prev, { now: 5, runId: "AR-2", courtOwnerIsMe: true, prevNoise: null });
  ok(nz.filing.noise && nz.noise?.flagged === true && nz.noise.moved === false, "ai filing: weak AI noise is a tag, not moved");
  const none = filingFromPick({ kind: "none", reason: "", needsReply: false }, prev, { now: 5, runId: "AR-3", courtOwnerIsMe: true, prevNoise: null });
  ok(none.filing.source === "identity" && none.filing.customerId === CUST && !none.filing.pendingAi && none.noise === undefined, "ai filing: none keeps the rule filing, clears pending");
  const ut = buildFilingUserText({ thread: "<email_thread></email_thread>", today: "2026-10-13", weekday: "Tuesday", candidates: [], matchedCustomerName: "" });
  ok(ut.includes("- (none)") && ut.includes("No customer matched"), "ai filing: an empty candidate list is said plainly");

  const teamIds = new Set(["u-ari", "u-dana"]);
  const c1 = sanitizeCourt({ owner: "teammate", teammateId: "u-ari", reason: "Dana handed it to Ari", promises: [] }, { teamIds, ownerId: "u-ari" });
  ok(c1.owner === "me" && c1.teammateId === "", "ai court: a hand-off to the thread owner (named as a teammate) reads as me");
  const c2 = sanitizeCourt({ owner: "teammate", teammateId: "u-ghost", reason: "x", promises: [{ text: "Call Pat", ownerUserId: "u-ghost", dueText: "" }] }, { teamIds, ownerId: "u-ari" });
  ok(c2.owner === "teammate" && c2.teammateId === "" && c2.promises[0].ownerUserId === "", "ai court: an unknown teammate / promise owner id is dropped");
  ok(!aiCourtOverride({ owner: "customer" }, c2), "ai court: a teammate with no real id never overrides the rules");
  ok(aiCourtOverride({ owner: "customer" }, c1) && !aiCourtOverride({ owner: "me" }, c1), "ai court: 'me' overrides a non-me rule court only");
  ok(!aiCourtOverride({ owner: "me" }, { owner: "customer", teammateId: "", reason: "", promises: [] }) && !aiCourtOverride({ owner: "customer" }, { owner: "nobody", teammateId: "", reason: "", promises: [] }), "ai court: customer / nobody readings never override");
  ok(aiCourtOverride({ owner: "customer" }, { owner: "teammate", teammateId: "u-dana", reason: "", promises: [] }), "ai court: a named real teammate overrides");
  const many = sanitizeCourt(
    {
      owner: "me",
      teammateId: "",
      reason: "r",
      promises: [1, 2, 3, 4, 5].map((i) => ({ text: `  promise\n${i} `, ownerUserId: "u-dana", dueText: " Friday " })),
    },
    { teamIds, ownerId: "u-ari" }
  );
  ok(many.promises.length === 3 && many.promises[0].text === "promise 1" && many.promises[0].dueText === "Friday" && many.promises[0].ownerUserId === "u-dana", "ai court: at most 3 promises, text/due trimmed, real owner ids kept");
  ok(sanitizeCourt({ owner: "me", teammateId: "", reason: "", promises: [{ text: "   ", ownerUserId: "", dueText: "" }] }, { teamIds, ownerId: "u-ari" }).promises.length === 0, "ai court: an empty promise is dropped");
}

export async function inboxOrgAiChecks(ok: Ok): Promise<void> {
  aiPureChecks(ok);
  const ARI = "TEST335 Ari";
  const ARI_ID = "TEST335-u-ari";
  const DANA_ID = "TEST335-u-dana";
  const users = [
    { id: ARI_ID, name: ARI, email: "ari@peaksystemsgroup.com", googleEmail: null },
    { id: DANA_ID, name: "TEST335 Dana", email: "dana@peaksystemsgroup.com", googleEmail: null },
  ];
  const env = { ANTHROPIC_API_KEY: "sk-test-not-real" };
  const allOn = { tasks: true, reply: true, estimate: true, file: true, promise: true, brief: true, ask: true };
  const pilot = buildOrgContext({ users, assist: { users: [ARI_ID], features: allOn, capUsd: 200 }, env });
  const offCtx = buildOrgContext({ users, assist: { users: [], features: allOn, capUsd: 200 }, env });
  const T0 = Date.UTC(2026, 9, 12, 15, 0); // Mon 12 Oct 2026, 10:00 Chicago
  const NOW = T0 + 3_600_000;
  let n = 0;
  const msg = (o: Partial<CommMessage>): CommMessage =>
    ({ id: `ai${++n}`, at: T0 + n * 60_000, direction: "in", channel: "email", author: "Pat", body: "Hello there, can you help?", fromEmail: "pat@ai-school.test", ...o }) as CommMessage;
  const mk = async (slug: string, o: Partial<CommThread>): Promise<string> => {
    const id = fixtureId(335, "ai-" + slug);
    await createFixture("comms", {
      id, mailbox: "personal", mailboxUser: ARI, unread: true, archived: false, customerId: null, customer: "", contactName: "Pat",
      contactEmail: "pat@ai-school.test", cc: "", subject: "Hello", channel: "email", status: "waiting_us", assignedTo: "", link: null,
      messages: [msg({})], createdAt: T0, updatedAt: T0 + 5, resolution: "unknown", ...o,
    } as unknown as CommThread);
    return id;
  };
  const read = async (id: string) => (await getDoc<CommThread>("comms", id))!;
  const CUST = fixtureId(335, "ai-cust");
  const QUOTE = fixtureId(335, "ai-quote");
  await createFixture("quotes", { id: QUOTE, name: "Stage curtain", customer: "AI School", customerId: CUST, quoteType: "system", status: "sent", updatedAt: T0 });
  const run = (provider: AssistProvider, o: { budgetMs?: number; deadlineMs?: number; ctx?: typeof pilot; clock?: () => number; fallback?: AssistProvider; ownerIds?: string[] } = {}) =>
    runAiPass(
      { ownerIds: o.ownerIds ?? [ARI_ID], budgetMs: o.budgetMs, deadlineMs: o.deadlineMs },
      { ctx: o.ctx ?? pilot, run: { provider, ...(o.fallback ? { fallback: o.fallback } : {}) }, now: NOW, clock: o.clock }
    );
  const tasksOn = async (threadId: string) => {
    const rows = await listDocsByField<TaskRecord>("tasks", "threadId", [threadId]);
    rows.forEach((t) => registerFixture("tasks", t.id));
    return rows;
  };
  const fileAns = (target: string, confidence = "strong", needsReply = true) => JSON.stringify({ target, confidence, reason: "Asks about the stage curtain", needsReply });
  const courtAns = (o: { owner: string; teammateId?: string; promises?: Array<{ text: string; ownerUserId: string; dueText: string }> }) =>
    JSON.stringify({ owner: o.owner, teammateId: o.teammateId ?? "", reason: "read by the fake", promises: o.promises ?? [] });
  const team = users.map((u) => ({ id: u.id, name: u.name }));

  /* 1. a strong pick inside the candidates */
  const pick = await mk("pick", { resolution: "suggested", suggestedCustomerId: CUST });
  await organizeThread(pick, { ctx: pilot, backlog: true });
  ok((await read(pick)).filing?.pendingAi === true && !(await read(pick)).court?.pendingAi, "ai pass: (setup) a weak domain guess is pendingAi; backlog → no court reading");
  const calls1: ProviderRequest[] = [];
  const r1 = await run(routedProvider({ file: fileAns(QUOTE) }, { calls: calls1 }));
  const t1 = await read(pick);
  ok(r1.calls === 1 && calls1.length === 1 && calls1[0].model === "claude-haiku-5-5" && calls1[0].maxTokens === 2000 && calls1[0].effort === "low" && calls1[0].maxRetries === 0, "ai pass: one Haiku call (low effort, 2000 max tokens, no retries) for the filing");
  ok(calls1[0].user.includes(`${QUOTE} | quote | `) && calls1[0].user.includes(`${CUST} | customer | `) && calls1[0].user.includes("<email_thread"), "ai pass: the prompt carries the candidate list and the wrapped thread");
  ok(t1.filing?.source === "ai" && t1.filing.work?.id === QUOTE && t1.filing.customerId === CUST && t1.filing.strength === "strong" && !t1.filing.pendingAi && !!t1.filing.runId && t1.filing.state === "suggested", "ai pass: a strong pick inside the candidates is stored as a strong AI suggestion, pending cleared");
  ok(r1.filed === 1 && r1.changed, "ai pass: the result counts the filing");
  ok((await run(routedProvider({ file: fileAns(QUOTE) }))).calls === 0, "ai pass: a re-run finds nothing pending (no second call)");
  await organizeThread(pick, { ctx: pilot });
  ok((await read(pick)).filing?.source === "ai", "ai pass: re-organizing with no new mail keeps the AI filing");

  /* 2. an out-of-list id is dropped */
  const bogus = await mk("bogus", { resolution: "suggested", suggestedCustomerId: CUST });
  await organizeThread(bogus, { ctx: pilot, backlog: true });
  await run(routedProvider({ file: fileAns("Q-NOT-A-CANDIDATE") }));
  const tB = await read(bogus);
  ok(tB.filing?.source === "identity" && tB.filing.customerId === CUST && tB.filing.strength === "weak" && !tB.filing.pendingAi, "ai pass: an out-of-list id is dropped — the rule suggestion stays, pending cleared");

  /* 3. "noise" moves the thread for a pilot owner — only with no customer guessed */
  const nz = await mk("noise", { contactEmail: "news@ai-letters.test", messages: [msg({ fromEmail: "news@ai-letters.test", body: "Our October newsletter" })] });
  await organizeThread(nz, { ctx: pilot, backlog: true });
  await run(routedProvider({ file: fileAns("noise") }));
  const tN = await read(nz);
  ok(tN.filing?.noise === true && tN.filing.source === "ai" && tN.noise?.flagged === true && tN.noise.moved === true && tN.archived === true, "ai pass: strong AI noise moves a pilot owner's thread with no customer guess (flagged, moved, archived)");
  ok((await threadsIn("personal", "noise", { id: ARI_ID, name: ARI, nameUnique: true })).some((t) => t.id === nz), "ai pass: …and it lists in the Noise tab");
  const nzGuess = await mk("noise-guessed", { resolution: "suggested", suggestedCustomerId: CUST, contactEmail: "news@ai-school.test", messages: [msg({ fromEmail: "news@ai-school.test", body: "Our October newsletter" })] });
  await organizeThread(nzGuess, { ctx: pilot, backlog: true });
  await run(routedProvider({ file: fileAns("noise") }));
  const tNg = await read(nzGuess);
  ok(tNg.filing?.noise === true && tNg.noise?.flagged === true && tNg.noise.moved === false && !tNg.archived && tNg.filing.customerId === CUST, "ai pass: strong AI noise on a thread with a guessed customer is tag-only (stays in the inbox, guess kept)");

  /* 3b. tag-only rule noise on a weak guess: the AI says it's the customer's */
  const tagged = await mk("tagged", { resolution: "suggested", suggestedCustomerId: CUST, contactEmail: "rfp@ai-school.test", messages: [msg({ fromEmail: "rfp@ai-school.test", bulk: true, body: "New RFP posted" })] });
  await organizeThread(tagged, { ctx: pilot, backlog: true });
  ok((await read(tagged)).noise?.flagged === true && (await read(tagged)).filing?.pendingAi === true, "ai pass: (setup) tag-only noise on a weak guess is pending");
  await run(routedProvider({ file: fileAns(CUST, "weak", false) }));
  const tT = await read(tagged);
  ok(tT.filing?.noise === false && tT.filing.customerId === CUST && tT.filing.source === "ai" && !tT.noise && !tT.archived, "ai pass: the AI picking the customer clears the rules' noise tag");

  /* 4. gated-off owner → no call, pending cleared */
  const gated = await mk("gated", { resolution: "suggested", suggestedCustomerId: CUST });
  await organizeThread(gated, { ctx: pilot });
  ok((await read(gated)).filing?.pendingAi === true && (await read(gated)).court?.pendingAi === true, "ai pass: (setup) live mail → filing and court both pending");
  const callsG: ProviderRequest[] = [];
  /* D895 — no pilot among the owners → the pass returns at once: no call, no query, nothing cleared */
  const rOff = await run(routedProvider({ file: fileAns(QUOTE), promise: courtAns({ owner: "me" }) }, { calls: callsG }), { ctx: offCtx });
  ok(callsG.length === 0 && rOff.looked === 0 && rOff.cleared === 0 && (await read(gated)).filing?.pendingAi === true, "ai pass: no owner in the list is a pilot → returns early (no call, nothing read or cleared)");
  const offFeatures = buildOrgContext({ users, assist: { users: [ARI_ID], features: { ...allOn, file: false, promise: false }, capUsd: 200 }, env });
  ok((await run(routedProvider({ file: fileAns(QUOTE) }, { calls: callsG }), { ctx: offFeatures })).looked === 0 && callsG.length === 0, "ai pass: a pilot user with file + promise both off counts as no pilot");
  const danaPilot = buildOrgContext({ users, assist: { users: [DANA_ID], features: allOn, capUsd: 200 }, env });
  const rG = await run(routedProvider({ file: fileAns(QUOTE), promise: courtAns({ owner: "me" }) }, { calls: callsG }), { ctx: danaPilot, ownerIds: [ARI_ID, DANA_ID] });
  ok(callsG.length === 0 && rG.cleared === 2 &&!(await read(gated)).filing?.pendingAi && !(await read(gated)).court?.pendingAi, "ai pass: an owner the gate refuses gets pendingAi cleared without a call");

  /* 5. court: a teammate hands the thread to me (named) → me, with a promise-task */
  const handoff = await mk("handoff", {
    customerId: CUST,
    customer: "AI School",
    resolution: "linked",
    resolvedContactId: "ct-ai",
    messages: [
      msg({ body: "Can we get pricing on the stage curtain?" }),
      msg({ fromEmail: "dana@peaksystemsgroup.com", author: "Dana", to: "pat@ai-school.test", cc: "ari@peaksystemsgroup.com", body: "Hi Pat, Ari will send you pricing by Friday." }),
    ],
  });
  await organizeThread(handoff, { ctx: pilot });
  const h0 = await read(handoff);
  ok(h0.court?.owner === "me" && h0.court.source === "rule" && h0.court.pendingAi === true && !h0.filing?.pendingAi && h0.status === "waiting_us", "ai pass: (setup) a teammate's reply naming the owner → rule court me (D894 hand-off), court still pending for the promise reading");
  const lastH = h0.messages[h0.messages.length - 1];
  const callsH: ProviderRequest[] = [];
  const rH = await run(
    routedProvider(
      { promise: courtAns({ owner: "teammate", teammateId: ARI_ID, promises: [{ text: "Send Pat pricing on the stage curtain", ownerUserId: ARI_ID, dueText: "by Friday" }] }) },
      { calls: callsH }
    )
  );
  const h1 = await read(handoff);
  ok(callsH.length === 1 && callsH[0].user.includes(`Thread owner ("me"): ${ARI_ID}`) && callsH[0].user.includes(`Peak teammate ${DANA_ID}`) && callsH[0].user.includes(`${DANA_ID} — TEST335 Dana`), "ai pass: the court prompt names the owner, the team, and who wrote each message");
  ok(h1.court?.owner === "me" && h1.court.source === "rule" && !h1.court.pendingAi && h1.court.basis === lastH.id && h1.status === "waiting_us" && rH.courts === 0, "ai pass: the AI agreeing with a rule hand-off (me) leaves the rule court, pending cleared, status waiting_us");
  const hTasks = await tasksOn(handoff);
  const due = resolveDue("by Friday", lastH.at);
  ok(
    hTasks.length === 1 &&
      hTasks[0].id === promiseTaskId(handoff, lastH.id, "Send Pat pricing on the stage curtain") &&
      hTasks[0].assigneeUserId === ARI_ID &&
      hTasks[0].dueAt === due &&
      hTasks[0].section === "Email" &&
      hTasks[0].customerId === CUST &&
      hTasks[0].notes.startsWith("From email: "),
    "ai pass: the promise becomes one Email task for the named owner, due Friday 5 pm, linked to the thread's customer"
  );
  ok(h1.court?.promise?.taskId === hTasks[0]?.id && h1.court.promise.due === due && h1.court.promise.messageId === lastH.id && rH.tasks === 1, "ai pass: court.promise records the task");
  ok(dayKey(due) === "2026-10-16" && chicagoParts(due).hour === 17, "ai pass: 'by Friday' from a Monday message is Fri 16 Oct, 5 pm Chicago");
  /* idempotent: the same promise again makes no second task */
  const again = await applyPromises(h1, lastH, [{ text: "send pat pricing on the stage   curtain", ownerUserId: ARI_ID, dueText: "Friday" }], NOW, { owner: { id: ARI_ID, name: ARI }, authorUserId: DANA_ID, users: team });
  ok(again.length === 1 && again[0].taskId === hTasks[0]?.id && (await tasksOn(handoff)).length === 1, "ai pass: a promise-task is created once (a re-run is idempotent)");
  /* backlog / old mail → no task */
  ok((await applyPromises(h1, lastH, [{ text: "Another thing", ownerUserId: "", dueText: "" }], NOW, { owner: { id: ARI_ID, name: ARI }, authorUserId: DANA_ID, users: team, backlog: true })).length === 0, "ai pass: backlog → no promise-task");
  ok(
    (await applyPromises(h1, lastH, [{ text: "Another thing", ownerUserId: "", dueText: "" }], lastH.at + PROMISE_MAX_AGE_MS + 1, { owner: { id: ARI_ID, name: ARI }, authorUserId: DANA_ID, users: team })).length === 0 &&
      (await tasksOn(handoff)).length === 1,
    "ai pass: mail older than a week → no promise-task"
  );

  /* 5b. a hand-off the rules can't see (no name) — only the AI reading catches it */
  const unnamed = await mk("handoff-unnamed", {
    customerId: CUST,
    customer: "AI School",
    resolution: "linked",
    resolvedContactId: "ct-ai",
    messages: [
      msg({ body: "Can we get pricing on the stage curtain?" }),
      msg({ fromEmail: "dana@peaksystemsgroup.com", author: "Dana", to: "pat@ai-school.test", body: "Hi Pat, I'm passing this to our account lead, who will send pricing by Friday." }),
    ],
  });
  await organizeThread(unnamed, { ctx: pilot });
  ok((await read(unnamed)).court?.owner === "customer" && (await read(unnamed)).court?.pendingAi === true, "ai pass: (setup) an unnamed hand-off → rule court customer, pending");
  const rU = await run(
    routedProvider({ promise: courtAns({ owner: "teammate", teammateId: ARI_ID, promises: [{ text: "Send Pat pricing", ownerUserId: ARI_ID, dueText: "by Friday" }] }) })
  );
  const u1 = await read(unnamed);
  ok(u1.court?.owner === "me" && u1.court.source === "ai" && u1.status === "waiting_us" && rU.courts === 1, "ai pass: a hand-off to a named teammate who is me → court me (AI), status waiting_us");
  const uTasks = await tasksOn(unnamed);
  ok(uTasks.length === 1 && uTasks[0].assigneeUserId === DANA_ID, "ai pass: a promise owner the newest message doesn't name falls back to the internal author (D899)");

  /* 5c. D899 — a quoted customer text naming a teammate can't route the task to them */
  const quotedName = await mk("promise-quoted-name", {
    messages: [
      msg({ body: "Can Ari send the drawings?" }),
      msg({
        fromEmail: "dana@peaksystemsgroup.com",
        author: "Dana",
        to: "pat@ai-school.test",
        body: "Hi Pat, we'll send the drawings Monday.\n\nOn Mon, Oct 12, 2026 at 9:00 AM Pat <pat@ai-school.test> wrote:\n> Can Ari send the drawings?",
      }),
    ],
  });
  const qT = await read(quotedName);
  const qLast = qT.messages[qT.messages.length - 1];
  const qMade = await applyPromises(qT, qLast, [{ text: "Send Pat the drawings", ownerUserId: ARI_ID, dueText: "Monday" }], NOW, { owner: { id: ARI_ID, name: ARI }, authorUserId: DANA_ID, users: team });
  ok(qMade.length === 1 && qMade[0].ownerUserId === DANA_ID && (await tasksOn(quotedName))[0]?.assigneeUserId === DANA_ID, "ai pass: a model owner named only in the quoted customer text is refused — the task goes to the internal author");
  const qNoAuthor = await applyPromises(qT, { ...qLast, id: qLast.id + "-x" }, [{ text: "Send Pat the drawings", ownerUserId: DANA_ID, dueText: "" }], NOW, { owner: { id: ARI_ID, name: ARI }, authorUserId: null, users: team });
  ok(qNoAuthor.length === 1 && qNoAuthor[0].ownerUserId === ARI_ID && (await tasksOn(quotedName)).length === 2, "ai pass: …and with no internal author it goes to the thread owner");

  /* 6. "someone will be in touch" → a promise owned by the internal author */
  const vague = await mk("vague", {
    messages: [msg({ body: "Is anyone looking at this?" }), msg({ fromEmail: "dana@peaksystemsgroup.com", author: "Dana", to: "pat@ai-school.test", body: "Someone from our team will be in touch next week." })],
  });
  await organizeThread(vague, { ctx: pilot });
  await run(routedProvider({ file: fileAns("none", "weak", false), promise: courtAns({ owner: "customer", promises: [{ text: "Get in touch with Pat", ownerUserId: "", dueText: "next week" }] }) }));
  const v1 = await read(vague);
  const vLast = v1.messages[v1.messages.length - 1];
  const vTasks = await tasksOn(vague);
  ok(vTasks.length === 1 && vTasks[0].assigneeUserId === DANA_ID && vTasks[0].dueAt === resolveDue("next week", vLast.at), "ai pass: 'someone will be in touch' → a task owned by the internal author (Dana), due next Monday");
  ok(v1.court?.source === "rule" && v1.court.owner === "customer" && !v1.court.pendingAi && v1.court.promise?.ownerUserId === DANA_ID, "ai pass: a 'customer' reading never overrides the rules; the promise is still recorded");

  /* 7. an unknown name is dropped */
  const ghost = await mk("ghost", {
    messages: [msg({ body: "Who handles rigging?" }), msg({ fromEmail: "dana@peaksystemsgroup.com", author: "Dana", to: "pat@ai-school.test", body: "Bob will call you." })],
  });
  await organizeThread(ghost, { ctx: pilot });
  await run(
    routedProvider({
      file: fileAns("none", "weak", false),
      promise: courtAns({ owner: "teammate", teammateId: "u-bob-not-real", promises: [{ text: "Call Pat about rigging", ownerUserId: "u-bob-not-real", dueText: "" }] }),
    })
  );
  const g1 = await read(ghost);
  const gLast = g1.messages[g1.messages.length - 1];
  const gTasks = await tasksOn(ghost);
  ok(g1.court?.source === "rule" && g1.court.owner === "customer" && g1.court.teammateId === DANA_ID && !g1.court.pendingAi, "ai pass: an unknown teammate id is dropped — the rule court stands");
  ok(gTasks.length === 1 && gTasks[0].assigneeUserId === DANA_ID && gTasks[0].dueAt === resolveDue("", gLast.at), "ai pass: an unknown promise owner falls back to the internal author; no due words → 2 business days");

  /* 8. a customer's own message makes no promise-tasks */
  const custMsg = await mk("customer-promise", { messages: [msg({ body: "We will send the PO Friday." })] });
  await organizeThread(custMsg, { ctx: pilot });
  await run(routedProvider({ file: fileAns("none", "weak", false), promise: courtAns({ owner: "me", promises: [{ text: "Send the PO", ownerUserId: "", dueText: "Friday" }] }) }));
  ok((await tasksOn(custMsg)).length === 0 && !(await read(custMsg)).court?.pendingAi, "ai pass: promises in a customer's message never become tasks");

  /* 9. backlog threads never get a court reading */
  const bl = await mk("backlog-court", { messages: [msg({ body: "Can you call?" }), msg({ fromEmail: "dana@peaksystemsgroup.com", to: "pat@ai-school.test", body: "I'll call you Friday." })] });
  await organizeThread(bl, { ctx: pilot, backlog: true });
  const callsBl: ProviderRequest[] = [];
  await run(routedProvider({ file: fileAns("none", "weak", false), promise: courtAns({ owner: "me", promises: [{ text: "Call Pat", ownerUserId: DANA_ID, dueText: "Friday" }] }) }, { calls: callsBl }));
  ok(!callsBl.some((c) => c.system !== FILING_SYSTEM) && (await tasksOn(bl)).length === 0, "ai pass: backlog → no court call, no task");

  /* 10. errors: attempts counted, gives up at MAX_AI_ATTEMPTS */
  const flaky = await mk("flaky", { resolution: "suggested", suggestedCustomerId: CUST });
  await organizeThread(flaky, { ctx: pilot, backlog: true });
  await run(routedProvider({ file: "not json" }));
  ok((await read(flaky)).filing?.pendingAi === true && (await read(flaky)).filing?.aiAttempts === 1, "ai pass: an unreadable answer stays pending with one attempt counted");
  for (let i = 1; i < MAX_AI_ATTEMPTS; i++) await run(routedProvider({ file: "not json" }));
  const tF = await read(flaky);
  ok(!tF.filing?.pendingAi && tF.filing?.aiAttempts === MAX_AI_ATTEMPTS && tF.filing?.source === "identity", "ai pass: after MAX_AI_ATTEMPTS failures it gives up, the rule suggestion stays");

  /* 11. time: budget window, the caller's deadline, oldest first, resume */
  const b: string[] = [];
  for (const slug of ["time-a", "time-b", "time-c", "time-d"]) b.push(await mk(slug, { resolution: "suggested", suggestedCustomerId: CUST }));
  for (const id of b) await organizeThread(id, { ctx: pilot, backlog: true });
  ok(callWorstCaseMs("file", false) === 30_000 && callWorstCaseMs("file", true) === 60_000, "ai pass: a call's worst case is 30 s, doubled when a local provider can fall back");
  ok(passHasFallback({ ASSIST_PROVIDER: "local", ASSIST_LOCAL_URL: "http://mini", ANTHROPIC_API_KEY: "k" }) && !passHasFallback({ ANTHROPIC_API_KEY: "k" }) && !passHasFallback({ ASSIST_PROVIDER: "local", ASSIST_LOCAL_URL: "http://mini" }), "ai pass: fallback only for the local provider with a Claude key");
  let fake = 0;
  const callsT: ProviderRequest[] = [];
  const tick = (ms: number) => routedProvider({ file: fileAns(QUOTE) }, { calls: callsT, onCall: () => (fake += ms) });
  const rT0 = await run(tick(10_000), { deadlineMs: 30_000, clock: () => fake });
  ok(rT0.calls === 0 && rT0.stoppedByBudget && b.every(Boolean) && (await read(b[0])).filing?.pendingAi === true, "ai pass: no call starts when the time left before the deadline is under the call timeout (+5 s)");
  const rTf = await run(tick(10_000), { deadlineMs: 50_000, clock: () => fake, fallback: routedProvider({}) });
  ok(rTf.calls === 0, "ai pass: with a fallback provider a call needs twice the timeout before the deadline");
  fake = 0;
  const rT1 = await run(tick(10_000), { deadlineMs: 50_000, budgetMs: 100_000, clock: () => fake });
  ok(rT1.calls === 2 && rT1.stoppedByBudget && fake === 20_000, "ai pass: the deadline is honoured — calls stop once under 35 s is left");
  ok((await read(b[0])).filing?.source === "ai" && (await read(b[1])).filing?.source === "ai" && (await read(b[2])).filing?.pendingAi === true, "ai pass: oldest threads first; the rest stay pending");
  fake = 0;
  const rT2 = await run(tick(25_000), { budgetMs: 20_000, clock: () => fake });
  ok(rT2.calls === 1 && rT2.stoppedByBudget && (await read(b[2])).filing?.source === "ai" && (await read(b[3])).filing?.pendingAi === true, "ai pass: no new call once the ~20 s budget has passed");
  const rT3 = await run(routedProvider({ file: fileAns(QUOTE) }));
  ok(!rT3.stoppedByBudget && rT3.calls === 1 && !(await read(b[3])).filing?.pendingAi, "ai pass: the next pass resumes the rest");

  /* 13. leases + the promisesFor marker: concurrent passes make tasks once */
  const dup = await mk("dup", {
    customerId: CUST,
    customer: "AI School",
    resolution: "linked",
    resolvedContactId: "ct-ai",
    messages: [msg({ body: "When can we expect pricing?" }), msg({ fromEmail: "dana@peaksystemsgroup.com", author: "Dana", to: "pat@ai-school.test", body: "I'll get it to you Thursday." })],
  });
  await organizeThread(dup, { ctx: pilot });
  ok((await read(dup)).court?.pendingAi === true, "ai lease: (setup) court pending");
  const callsD: ProviderRequest[] = [];
  const say = (text: string) => routedProvider({ promise: courtAns({ owner: "customer", promises: [{ text, ownerUserId: DANA_ID, dueText: "Thursday" }] }) }, { calls: callsD });
  const [rd1, rd2] = await Promise.all([run(say("Send Pat the pricing")), run(say("Get pricing over to Pat"))]);
  const dTasks = await tasksOn(dup);
  const dLast = (await read(dup)).messages.slice(-1)[0];
  ok(dTasks.length === 1 && callsD.length === 1 && rd1.tasks + rd2.tasks === 1, "ai lease: two passes at once on one thread (different wording) → one call, one task");
  ok((await read(dup)).court?.promisesFor === dLast.id && !(await read(dup)).court?.aiLeaseUntil && !(await read(dup)).court?.pendingAi, "ai lease: the court records promisesFor the message; the lease is released");
  await patchDoc<CommThread>("comms", dup, (d) => {
    d.court = { ...d.court!, pendingAi: true };
  });
  await run(say("Email Pat the price list"));
  ok((await tasksOn(dup)).length === 1 && !(await read(dup)).court?.pendingAi, "ai lease: a re-run after the marker creates nothing");
  const held = await mk("leased", { resolution: "suggested", suggestedCustomerId: CUST });
  await organizeThread(held, { ctx: pilot, backlog: true });
  await patchDoc<CommThread>("comms", held, (d) => {
    d.filing = { ...d.filing!, aiLeaseUntil: NOW + 60_000 };
  });
  const callsL: ProviderRequest[] = [];
  await run(routedProvider({ file: fileAns(QUOTE) }, { calls: callsL }));
  ok(callsL.length === 0 && (await read(held)).filing?.pendingAi === true, "ai lease: a live lease is skipped (no call)");
  await patchDoc<CommThread>("comms", held, (d) => {
    d.filing = { ...d.filing!, aiLeaseUntil: NOW - 1 };
  });
  await run(routedProvider({ file: fileAns(QUOTE) }, { calls: callsL }));
  ok(callsL.length === 1 && (await read(held)).filing?.source === "ai" && !(await read(held)).filing?.aiLeaseUntil, "ai lease: an expired lease is taken over");

  /* 14. an exception during / after the call counts as an attempt */
  const boom = await mk("boom", { resolution: "suggested", suggestedCustomerId: CUST });
  await organizeThread(boom, { ctx: pilot, backlog: true });
  const thrower: AssistProvider = {
    name: "fake",
    async complete() {
      throw new Error("socket hang up");
    },
  };
  const rBoom = await run(thrower);
  const tBoom = await read(boom);
  ok(rBoom.failed === 1 && tBoom.filing?.pendingAi === true && tBoom.filing.aiAttempts === 1 && !tBoom.filing.aiLeaseUntil, "ai pass: an exception around the call counts an attempt and releases the lease");

  /* 15. stuck rows are cleared */
  const orphan = await mk("orphan", { mailboxUser: "TEST335 Nobody", resolution: "suggested", suggestedCustomerId: CUST });
  await patchDoc<CommThread>("comms", orphan, (d) => {
    d.filing = { customerId: CUST, work: null, noise: false, source: "identity", reason: "x", strength: "weak", needsReply: false, state: "suggested", at: T0, pendingAi: true };
  });
  resetAiPassSweep();
  await run(routedProvider({ file: fileAns(QUOTE) }));
  ok(!(await read(orphan)).filing?.pendingAi, "ai stuck: a pending row nobody can own is cleared");
  /* D895 — the sweep runs at most once an hour per process */
  const orphan2 = await mk("orphan-2", { mailboxUser: "TEST335 Nobody", resolution: "suggested", suggestedCustomerId: CUST });
  await patchDoc<CommThread>("comms", orphan2, (d) => {
    d.filing = { customerId: CUST, work: null, noise: false, source: "identity", reason: "x", strength: "weak", needsReply: false, state: "suggested", at: T0, pendingAi: true };
  });
  await run(routedProvider({ file: fileAns(QUOTE) }));
  ok((await read(orphan2)).filing?.pendingAi === true, "ai stuck: a second pass within the hour doesn't sweep again");
  await run(routedProvider({ file: fileAns(QUOTE) }), { clock: () => Date.now() + 3_600_001 });
  ok(!(await read(orphan2)).filing?.pendingAi, "ai stuck: …an hour later it does");
  const stale = await mk("stale-basis", {});
  await patchDoc<CommThread>("comms", stale, (d) => {
    d.filing = { customerId: null, work: null, noise: false, source: "identity", reason: "x", strength: "weak", needsReply: false, state: "filed", at: T0, pendingAi: true, basis: "gone" };
  });
  const staleOpen = await mk("stale-open", {});
  await patchDoc<CommThread>("comms", staleOpen, (d) => {
    d.filing = { customerId: null, work: null, noise: false, source: "identity", reason: "x", strength: "weak", needsReply: false, state: "suggested", at: T0, pendingAi: true, basis: "gone" };
  });
  await run(routedProvider({ file: fileAns("none", "weak", false), promise: courtAns({ owner: "customer" }) }));
  const tStale = await read(stale);
  const tStaleOpen = await read(staleOpen);
  ok(!tStale.filing?.pendingAi && tStale.filing?.state === "filed", "ai stuck: a stale-basis row the pipeline can't refresh (filed) is cleared");
  ok(tStaleOpen.filing?.basis === tStaleOpen.messages.slice(-1)[0].id && !tStaleOpen.filing?.pendingAi, "ai stuck: a stale-basis row is re-organized onto the newest message, then read");
  const staleOld = await mk("stale-old", {
    messages: [msg({ at: T0 - 30 * 86_400_000, body: "Can you call?" }), msg({ at: T0 - 30 * 86_400_000 + 1, fromEmail: "dana@peaksystemsgroup.com", to: "pat@ai-school.test", body: "I'll call you Friday." })],
  });
  await patchDoc<CommThread>("comms", staleOld, (d) => {
    d.filing = { customerId: CUST, work: null, noise: false, source: "identity", reason: "x", strength: "weak", needsReply: false, state: "filed", at: T0, pendingAi: true, basis: "gone" };
  });
  const callsOld: ProviderRequest[] = [];
  await run(routedProvider({ file: fileAns("none", "weak", false), promise: courtAns({ owner: "me", promises: [{ text: "Call Pat", ownerUserId: DANA_ID, dueText: "Friday" }] }) }, { calls: callsOld }));
  const tOld = await read(staleOld);
  ok(callsOld.length === 0 && !tOld.court?.pendingAi && !tOld.filing?.pendingAi && (await tasksOn(staleOld)).length === 0, "ai stuck: stale mail older than a week is re-organized as backlog — no model call, no task");

  /* 16. one user's backlog doesn't starve another */
  const ANN = "TEST335 Ann";
  const ANN_ID = "TEST335-u-ann";
  const both = buildOrgContext({ users: [...users, { id: ANN_ID, name: ANN, email: "ann@peaksystemsgroup.com", googleEmail: null }], assist: { users: [ARI_ID, ANN_ID], features: allOn, capUsd: 200 }, env });
  // drain Ari's queue so the only thing of Ari's left is the one below
  await run(routedProvider({ file: fileAns("none", "weak", false), promise: courtAns({ owner: "customer" }) }));
  const backlog: CommThread[] = [];
  for (let i = 0; i < 400; i++) {
    const id = fixtureId(335, "ai-ann-" + i);
    registerFixture("comms", id);
    const m = { id: "ann-m" + i, at: T0 - 30 * 86_400_000 + i, direction: "in", channel: "email", author: "Pat", body: "old", fromEmail: "pat@ai-school.test" } as CommMessage;
    backlog.push({
      id, mailbox: "personal", mailboxUser: ANN, unread: false, archived: false, customerId: null, customer: "", contactName: "Pat", contactEmail: "pat@ai-school.test",
      subject: "Old", channel: "email", status: "waiting_us", assignedTo: "", link: null, messages: [m], createdAt: T0 - 40 * 86_400_000, updatedAt: T0 - 40 * 86_400_000 + i,
      filing: { customerId: CUST, work: null, noise: false, source: "identity", reason: "x", strength: "weak", needsReply: false, state: "suggested", at: T0, pendingAi: true, basis: m.id },
    } as unknown as CommThread);
  }
  await upsertDocs("comms", backlog);
  const bThread = await mk("not-starved", { resolution: "suggested", suggestedCustomerId: CUST });
  await organizeThread(bThread, { ctx: both, backlog: true });
  fake = 0;
  await run(routedProvider({ file: fileAns(QUOTE) }, { onCall: () => (fake += 10_000) }), { ctx: both, ownerIds: [ANN_ID, ARI_ID], clock: () => fake });
  ok((await read(bThread)).filing?.source === "ai", "ai queue: user A's 400 backlog rows don't block user B's pending thread");
  const annLive = await mk("ann-live", {
    mailboxUser: ANN,
    customerId: CUST,
    customer: "AI School",
    resolution: "linked",
    resolvedContactId: "ct-ai",
    messages: [msg({ body: "Is the install still on for Monday?" })],
  });
  await organizeThread(annLive, { ctx: both });
  ok((await read(annLive)).court?.pendingAi === true, "ai queue: (setup) a new live court read for the user with the backlog");
  fake = 0;
  const callsAnn: ProviderRequest[] = [];
  await run(routedProvider({ file: fileAns(QUOTE), promise: courtAns({ owner: "me" }) }, { calls: callsAnn, onCall: () => (fake += 25_000) }), { ctx: both, ownerIds: [ANN_ID], clock: () => fake });
  ok(callsAnn.length === 1 && callsAnn[0].system === COURT_SYSTEM && !(await read(annLive)).court?.pendingAi, "ai queue: past 100 backlog filing rows, a new live court row is read in the first pass, first");

  /* 17. the Inbox actions never run the pass inline */
  const actionsSrc = readFileSync("src/app/(app)/inbox/actions.ts", "utf8");
  const sched = actionsSrc.slice(actionsSrc.indexOf("function scheduleAiPass("), actionsSrc.indexOf("export async function autoSyncAction("));
  ok(
    actionsSrc.includes("checkMailFor({ aiPass: false })") &&
      actionsSrc.includes("checkMailIfStale(AUTO_SYNC_MIN_AGE_MS, { aiPass: false })") &&
      actionsSrc.includes("scheduleAiPass(owners, started, user.id)") &&
      actionsSrc.includes("scheduleAiPass(r.owners, started, user.id)") &&
      (actionsSrc.match(/runAiPass\(/g) || []).length === 1 &&
      /after\(async \(\) => \{[\s\S]*runAiPass\(\{ ownerIds, deadlineMs: startedAt \+ POLL_AI_DEADLINE_MS \}\)/.test(sched),
    "ai hook: Send/Receive and auto-sync poll with aiPass:false and run the pass only in after(), deadline from the action's start"
  );
  ok(/const ownerIds = \[\.\.\.new Set\(\[meId, \.\.\.owners\]/.test(sched), "ai hook: the signed-in user is always in the pass's owner list");
  ok(readFileSync("src/instrumentation.ts", "utf8").includes("checkMailIfStale(AUTO_SYNC_MIN_AGE_MS, { aiPass: !process.env.VERCEL })"), "ai hook: the server timer runs no inline pass on Vercel");

  // every assist_runs row this section made goes with the fixtures
  for (const r of await listRunsByMonth(monthKeyChicago(NOW))) if (r.contextRef.startsWith("thread:" + fixtureId(335, "ai-"))) registerFixture("assist_runs" as never, r.id);

  /* 12. the sync hook: one pass per poll, after every mailbox, deadline-bound */
  const bridgeSrc = readFileSync("src/lib/gmail/bridge.ts", "utf8");
  const syncBody = bridgeSrc.slice(bridgeSrc.indexOf("async function syncMailbox("), bridgeSrc.indexOf("async function currentHistoryId("));
  const pollBody = bridgeSrc.slice(bridgeSrc.indexOf("export async function pollInbound("));
  ok(!syncBody.includes("runAiPass"), "ai hook: no AI pass per mailbox");
  ok(
    pollBody.indexOf("runAiPass({ ownerIds: [...owners], deadlineMs: opts.deadlineMs ?? started + POLL_AI_DEADLINE_MS })") > pollBody.indexOf("for (const key of keys)") &&
      /opts\.aiPass !== false && owners\.size/.test(pollBody) &&
      /try \{\s*const \{ runAiPass \}/.test(pollBody),
    "ai hook: pollInbound runs ONE pass after all mailboxes, for the owners it synced, inside the caller's deadline, in its own try"
  );
  ok(readFileSync("src/app/api/gmail/sync/route.ts", "utf8").includes("checkMailIfStale(AUTO_SYNC_MIN_AGE_MS, { aiPass: false })"), "ai hook: the 60 s cron route runs no AI pass");
  ok(readFileSync("src/lib/stores/comms.ts", "utf8").includes("await pollInbound(eligible, maxAgeMs, opts)"), "ai hook: checkMailIfStale passes the options through");
}

/* ---------- Task 5: apply actions + archive-on-reply ---------- */

export async function inboxOrgApplyChecks(ok: Ok): Promise<void> {
  const ANN = "TEST335 Ann Apply";
  const ANN_ID = "TEST335-u-ann";
  const BEN_ID = "TEST335-u-ben";
  const BOSS_ID = "TEST335-u-boss";
  const ann = { id: ANN_ID, name: ANN, roles: ["Estimator"] };
  const boss = { id: BOSS_ID, name: "TEST335 Boss Apply", roles: ["Admin"] };
  const db = await getDb();
  const CUST = fixtureId(335, "apply-cust");
  const QUOTE = fixtureId(335, "apply-quote");
  const SITE = fixtureId(335, "apply-site");
  const CUST_A = fixtureId(335, "apply-cust-a");
  const QUOTE_A = fixtureId(335, "apply-quote-a");
  const QUOTE_B = fixtureId(335, "apply-quote-b");
  const T0 = Date.now() - 3 * 3_600_000;
  let n = 0;
  const msg = (o: Partial<CommMessage>): CommMessage =>
    ({ id: `ap${++n}`, at: T0 + n * 60_000, direction: "in", channel: "email", author: "Pat", body: "Can you send the price?", fromEmail: "pat@apply-school.test", ...o }) as CommMessage;
  const mk = async (slug: string, o: Partial<CommThread>): Promise<string> => {
    const id = fixtureId(335, "apply-" + slug);
    await createFixture("comms", {
      id, mailbox: "personal", mailboxUser: ANN, unread: true, archived: false, customerId: null, customer: "", contactName: "Pat",
      contactEmail: "pat@apply-school.test", cc: "", subject: "Hello", channel: "email", status: "waiting_us", assignedTo: "", link: null,
      messages: [msg({})], createdAt: T0, updatedAt: T0 + 5, resolution: "unknown", ...o,
    } as unknown as CommThread);
    await organizeThread(id);
    return id;
  };
  const read = async (id: string) => (await getDoc<CommThread>("comms", id))!;
  const BLOBS = [SENDER_RULES_BLOB, FILING_LOG_BLOB];
  const before = new Map<string, typeof blobs.$inferSelect | undefined>();
  for (const id of BLOBS) before.set(id, (await db.select().from(blobs).where(eq(blobs.id, id)).limit(1))[0]);
  const imported: string[] = [];
  try {
    const nowMs = Date.now();
    for (const [id, name, email, roles] of [
      [ANN_ID, ANN, "ann.t335@peaksystemsgroup.com", ["Estimator"]],
      [BEN_ID, "TEST335 Ben Apply", "ben.t335@peaksystemsgroup.com", ["Estimator"]],
      [BOSS_ID, boss.name, "boss.t335@peaksystemsgroup.com", ["Admin"]],
    ] as const) {
      await db.insert(users).values({ id, name, email, roles: [...roles], color: "#333333", initials: "TT", status: "active", createdAt: nowMs }).onConflictDoNothing();
    }
    await saveCompany({ id: CUST, name: "TEST335 Apply School", type: "school" });
    await saveSite({ id: SITE, companyId: CUST, name: "Main gym", isPrimary: true, venueKind: "proscenium" });
    await createFixture("quotes", { id: QUOTE, name: "Gym curtain", customer: "TEST335 Apply School", customerId: CUST, estNo: 987700, quoteType: "system", status: "sent" });
    await saveCompany({ id: CUST_A, name: "TEST335 Other Co", type: "school" });
    await createFixture("quotes", { id: QUOTE_B, name: "Second job", customer: "TEST335 Apply School", customerId: CUST, estNo: 987702, quoteType: "system", status: "sent" });
    await createFixture("quotes", { id: QUOTE_A, name: "Other job", customer: "TEST335 Other Co", customerId: CUST_A, estNo: 987701, quoteType: "system", status: "sent" });
    invalidateOrgContext();
    const labels = (t: CommThread) => desiredPeakLabels(t).filter((l) => l.startsWith("Peak/Customers/") || l.includes(QUOTE));

    /* approve: links + labels + archives only when no reply is owed */
    const quiet = await mk("approve-quiet", { subject: "Re: EST-987700", messages: [msg({}), msg({ direction: "out", fromEmail: "ann.t335@peaksystemsgroup.com", to: "pat@apply-school.test", body: "Here it is." })], status: "waiting_them" });
    const q0 = await read(quiet);
    ok(q0.filing?.source === "number" && q0.filing.state === "suggested" && q0.court?.owner === "customer", "apply: (setup) a strong number suggestion, court customer");
    const ra = await approveFiling(quiet, ann);
    const q1 = await read(quiet);
    ok(ra.ok && q1.customerId === CUST && q1.customer === "TEST335 Apply School" && q1.link?.type === "quote" && q1.link.id === QUOTE, "apply approve: links the customer (linkThread) and the quote (setLink)");
    ok(labels(q1).length === 2, "apply approve: the Peak label mirror now wants the customer + quote labels");
    ok(q1.filing?.state === "filed" && q1.filing.filedBy === "approved" && !!q1.filing.applied?.customer && !!q1.filing.applied?.link && q1.archived === true, "apply approve: filed, records what it changed, and archives (no reply owed)");
    const log1 = await getFilingLog();
    ok(log1.some((e) => e.threadId === quiet && e.action === "approved" && e.outcome === "filed" && e.userId === ANN_ID), "apply approve: a rule suggestion's approval lands in the filing log");
    ok((await approveFiling(quiet, ann)).ok && ((await approveFiling(quiet, ann)) as { already?: boolean }).already === true, "apply approve: approving again is a no-op");
    const owes = await mk("approve-owes", { subject: "EST-987700 question" });
    await approveFiling(owes, ann);
    ok((await read(owes)).filing?.state === "filed" && (await read(owes)).archived === false && (await read(owes)).court?.owner === "me", "apply approve: a thread still owed a reply is filed but stays in the inbox");
    const others = await mk("approve-others", { mailboxUser: "TEST335 Ben Apply", subject: "EST-987700" });
    const ro = await approveFiling(others, ann);
    ok(!ro.ok && ro.error === "not-found" && !(await read(others)).customerId, "apply approve: someone else's thread is refused (visibleTo)");

    /* undo restores */
    const ru = await undoFiling(quiet, ann);
    const q2 = await read(quiet);
    ok(ru.ok && q2.customerId === null && q2.customer === "" && q2.link === null && q2.resolution === "unknown", "apply undo: unlinks the customer and the quote it set, identity fields restored");
    ok(labels(q2).length === 0, "apply undo: the label mirror no longer wants the Peak labels (syncPeakLabels removes them)");
    ok(q2.archived === false && q2.filing?.state === "suggested" && !q2.filing.applied && !q2.filing.filedBy, "apply undo: un-archived, back to To file");
    ok((await getFilingLog()).some((e) => e.threadId === quiet && e.action === "undone"), "apply undo: logged");
    const kept = await mk("undo-keeps-link", { customerId: CUST, customer: "TEST335 Apply School", resolution: "linked", link: { type: "quote", id: QUOTE }, subject: "EST-987700" });
    await approveFiling(kept, ann);
    await undoFiling(kept, ann);
    ok((await read(kept)).customerId === CUST && (await read(kept)).link?.id === QUOTE, "apply undo: a link the thread already had before filing is left alone");
    ok(!(await undoFiling(owes + "x", ann)).ok && !(await undoFiling(kept, ann)).ok, "apply undo: refused for a missing or unfiled thread");

    /* reply archives; the per-user setting keeps it */
    const replyId = await mk("reply", { customerId: CUST, customer: "TEST335 Apply School", resolution: "linked" });
    ok((await read(replyId)).court?.owner === "me" && (await read(replyId)).filing?.strength === "strong", "apply reply: (setup) linked thread, court me");
    await reply(replyId, { body: "Price attached.", me: ANN });
    const r1 = await read(replyId);
    ok(r1.archived === true && r1.court?.owner === "customer" && r1.status === "waiting_them", "apply reply: my reply recomputes the court (customer) and archives the thread");
    ok(r1.filing?.state === "filed" && r1.filing.filedBy === "reply" && r1.filing.customerId === CUST, "apply reply: the linked thread is filed on reply");
    await setKeepInInbox(ANN, true);
    const keepId = await mk("reply-keep", { customerId: CUST, customer: "TEST335 Apply School", resolution: "linked" });
    await reply(keepId, { body: "On it.", me: ANN });
    ok((await read(keepId)).archived === false && (await read(keepId)).filing?.state === "suggested" && (await read(keepId)).court?.owner === "customer", "apply reply: with 'Keep threads in my inbox' on, it stays (and isn't filed)");
    const archKeep = await mk("reply-archived-keep", { archived: true, customerId: CUST, customer: "TEST335 Apply School", resolution: "linked" });
    await reply(archKeep, { body: "Following up.", me: ANN });
    ok((await read(archKeep)).archived === true, "apply addMessage: my outbound message never un-archives a thread");
    await addMessage(archKeep, { direction: "in", body: "Thanks — one more question?" });
    ok((await read(archKeep)).archived === false, "apply addMessage: new inbound mail still un-archives");
    await setKeepInInbox(ANN, false);
    const weakId = await mk("reply-weak", { resolution: "suggested", suggestedCustomerId: CUST });
    await reply(weakId, { body: "Sure.", me: ANN });
    ok((await read(weakId)).archived === true && (await read(weakId)).filing?.state === "suggested" && !(await read(weakId)).customerId, "apply reply: a weak suggestion waits in To file (archived, not filed)");
    const draftRes = await archiveAfterReply(fixtureId(335, "apply-nope"), "reply");
    ok(draftRes.ok && draftRes.archived === false, "apply reply: a missing thread is a no-op, never a throw");

    /* Mark replied / Close (manual) archive whatever the court says */
    const manual = await mk("manual", { customerId: CUST, customer: "TEST335 Apply School", resolution: "linked" });
    const rm = await archiveAfterReply(manual, "reply", ann, { manual: true });
    ok(rm.ok && rm.archived && (await read(manual)).archived === true && (await read(manual)).filing?.filedBy === "reply", "apply manual: Mark replied / Close archives (and files) even with the court on me");
    const actionsSrc = readFileSync("src/app/(app)/inbox/actions.ts", "utf8");
    const setStatusBody = actionsSrc.slice(actionsSrc.indexOf("export async function setStatusAction("), actionsSrc.indexOf("export async function reopenAction("));
    ok(/status === "replied" \|\| status === "closed"/.test(setStatusBody) && setStatusBody.includes('archiveAfterReply(id, "reply", { id: user.id, name: user.name }, { manual: true })'), "apply manual: setStatusAction runs archiveAfterReply on replied / closed");
    const commsSrc = readFileSync("src/lib/stores/comms.ts", "utf8");
    const replyBody = commsSrc.slice(commsSrc.indexOf("export async function reply("), commsSrc.indexOf("export async function replyAll("));
    const postBody = commsSrc.slice(commsSrc.indexOf("export async function runPostReply("), commsSrc.indexOf("export function replyLeft("));
    ok(replyBody.includes("await runPostReply(threadId)") && postBody.includes("afterOwnReply(threadId)") && /catch \(err\)/.test(postBody) && commsSrc.includes("return reply(threadId, opts);"), "apply reply: comms.reply (and replyAll / forward through it) runs the post-send step best-effort");

    /* teammate reply (import) archives; a hand-off un-archives */
    const gm = (gid: string, gthread: string, from: string, to: string, body: string, subject = "Re: EST-987700"): GmailFullMessage =>
      ({
        id: gid, threadId: gthread, labelIds: ["INBOX"], internalDate: String(Date.now() - 60_000 + (++n)),
        payload: { mimeType: "text/plain", headers: [["From", from], ["To", to], ["Subject", subject], ["Message-ID", `<${gid}@x.test>`]].map(([name, value]) => ({ name, value })), body: { data: Buffer.from(body).toString("base64url") } },
      }) as GmailFullMessage;
    const key = personalKey(ANN_ID);
    const tid = await recordMessage(key, parseInbound(gm("TEST335-ap-g1", "TEST335-ap-thread", "Pat <pat@apply-school.test>", "ann.t335@peaksystemsgroup.com", "Any news on the curtain?")));
    if (tid) imported.push(tid);
    ok(!!tid && (await read(tid!)).mailboxUser === ANN && (await read(tid!)).court?.owner === "me" && (await read(tid!)).archived === false, "apply teammate: (setup) imported customer mail, court me");
    const upd0 = (await read(tid!)).updatedAt;
    await recordMessage(key, parseInbound(gm("TEST335-ap-g2", "TEST335-ap-thread", "Ben <ben.t335@peaksystemsgroup.com>", "pat@apply-school.test", "Hi Pat, I'll get you the price Friday.")));
    const tm = await read(tid!);
    ok(tm.court?.owner === "customer" && tm.court.teammateId === BEN_ID && tm.archived === true, "apply teammate: a teammate's reply makes the court customer and archives the thread");
    ok(tm.filing?.state === "filed" && tm.filing.filedBy === "teammate-reply" && tm.filing.work?.id === QUOTE, "apply teammate: its strong suggestion is filed as teammate-reply");
    ok(tm.updatedAt === Math.max(upd0, tm.messages[tm.messages.length - 1].at), "apply teammate: the archive is quiet (the list order keeps the message time)");
    const fwd = `Ann, can you take this one?\n\n---------- Forwarded message ---------\nFrom: Pat <pat@apply-school.test>\nDate: Mon, Oct 12, 2026 at 9:00 AM\nSubject: Curtain\nTo: Ben <ben.t335@peaksystemsgroup.com>\n\nWe need a price.`;
    await recordMessage(key, parseInbound(gm("TEST335-ap-g3", "TEST335-ap-thread", "Ben <ben.t335@peaksystemsgroup.com>", "ann.t335@peaksystemsgroup.com", fwd)));
    const th = await read(tid!);
    ok(th.court?.owner === "me" && th.archived === false, "apply teammate: a hand-off (a teammate's forward to me) un-archives and puts the court on me");
    /* D894 — a teammate's internal note to me on the customer thread never archives it */
    await recordMessage(key, parseInbound(gm("TEST335-ap-g3b", "TEST335-ap-thread", "Ben <ben.t335@peaksystemsgroup.com>", "ann.t335@peaksystemsgroup.com", "Ann, can you take this, they want pricing Friday")));
    const tNote = await read(tid!);
    ok(tNote.court?.owner === "me" && tNote.court.source === "rule" && tNote.archived === false && tNote.status === "waiting_us", "apply teammate: a teammate's note to me only on a customer thread → court me, not archived (app or Gmail)");
    await archive(tid!, { quiet: true });
    await recordMessage(key, parseInbound(gm("TEST335-ap-g3c", "TEST335-ap-thread", "Ben <ben.t335@peaksystemsgroup.com>", "ann.t335@peaksystemsgroup.com", "Heads up — they're asking for the install date too.")));
    ok((await read(tid!)).court?.owner === "me" && (await read(tid!)).archived === false, "apply teammate: …and an internal note to me brings an archived customer thread back");
    await recordMessage(key, parseInbound(gm("TEST335-ap-g3d", "TEST335-ap-thread", "Ben <ben.t335@peaksystemsgroup.com>", "pat@apply-school.test", "Hi Pat, Ann will be in touch tomorrow with the price.")));
    const tName = await read(tid!);
    ok(tName.court?.owner === "me" && tName.court.source === "rule" && tName.archived === false, "apply teammate: a teammate's reply to the customer saying 'Ann will be in touch' → me by rule (non-pilot), not archived");
    await setKeepInInbox(ANN, true);
    await archive(tid!, { quiet: true });
    await recordMessage(key, parseInbound(gm("TEST335-ap-g4", "TEST335-ap-thread", "Ben <ben.t335@peaksystemsgroup.com>", "pat@apply-school.test", "Pat — scratch that, Friday works too.")));
    ok((await read(tid!)).archived === true, "apply teammate: with 'Keep threads in my inbox' on, a teammate's reply still never brings back a thread I archived");
    await setKeepInInbox(ANN, false);

    /* D896 — the pipeline's quiet archive / unarchive / setStatus are key-level: a message appended meanwhile survives */
    const nBefore = (await read(tid!)).messages.length;
    // one mailbox's imports run one after another (a sync is claimed per
    // mailbox); the pipeline / apply writes race them
    const imports = (async () => {
      await recordMessage(key, parseInbound(gm("TEST335-ap-c1", "TEST335-ap-thread", "Pat <pat@apply-school.test>", "ann.t335@peaksystemsgroup.com", "Concurrent one?")));
      await recordMessage(key, parseInbound(gm("TEST335-ap-c2", "TEST335-ap-thread", "Pat <pat@apply-school.test>", "ann.t335@peaksystemsgroup.com", "Concurrent two?")));
    })();
    const quietWrites = async () => {
      for (let i = 0; i < 6; i++) {
        await Promise.all([archive(tid!, { quiet: true }), setStatus(tid!, i % 2 ? "waiting_us" : "waiting_them", { quiet: true }), unarchive(tid!, { quiet: true })]);
      }
    };
    await Promise.all([imports, quietWrites(), quietWrites()]);
    const tc = await read(tid!);
    ok(tc.messages.length === nBefore + 2 && tc.messages.some((m) => m.gmailId === "TEST335-ap-c1") && tc.messages.some((m) => m.gmailId === "TEST335-ap-c2"), "apply concurrency: messages imported while quiet archive / unarchive / setStatus run all survive");
    const commsSrc2 = readFileSync("src/lib/stores/comms.ts", "utf8");
    const archBody = commsSrc2.slice(commsSrc2.indexOf("export async function archive("), commsSrc2.indexOf("/** The Gmail bridge's record of whether"));
    const statusBody = commsSrc2.slice(commsSrc2.indexOf("export async function setStatus("), commsSrc2.indexOf("export async function reopen("));
    ok((archBody.match(/quietKeyWrite\(id, "archived", (true|false)\)/g) || []).length === 2 && statusBody.includes('quietKeyWrite(threadId, "status", status)') && commsSrc2.includes('patchDocKey("comms", [id], key, value)'), "apply concurrency: quiet archive / unarchive / setStatus write one key (patchDocKey), never the whole doc");
    const hb = await read(tid!);
    await archive(tid!, { quiet: true });
    await setOrg(tid!, { filing: { ...(await read(tid!)).filing!, archivedOnReply: true } });
    await unarchive(tid!, { quiet: true });
    const ua = await read(tid!);
    ok(ua.archived === false && !ua.filing?.archivedOnReply && ua.updatedAt === hb.updatedAt && ua.messages.length === hb.messages.length, "apply concurrency: a quiet unarchive clears archivedOnReply key-level, no updatedAt bump");
    await setStatus(tid!, "not-a-status", { quiet: true });
    ok((await read(tid!)).status === ua.status, "apply concurrency: a quiet setStatus with an unknown status changes nothing");

    /* D898 — re-inboxed in Gmail → back in the app (archived off, archivedOnReply cleared) */
    const reinb = await mk("gmail-reinbox", { customerId: CUST, customer: "TEST335 Apply School", resolution: "linked" });
    await patchDoc<CommThread>("comms", reinb, (d) => {
      d.archived = true;
      d.gmailInboxed = false;
      d.filing = { ...d.filing!, archivedOnReply: true };
    });
    const rb0 = await read(reinb);
    await reinboxFromGmail(reinb);
    const rb1 = await read(reinb);
    ok(rb1.gmailInboxed === true && rb1.archived === false && !rb1.filing?.archivedOnReply && rb1.messages.length === rb0.messages.length && rb1.updatedAt === rb0.updatedAt, "gmail re-inbox: a thread moved back to the Gmail inbox comes back in the app (archived off, archivedOnReply cleared, quiet)");
    const nzRe = await mk("gmail-reinbox-noise", {});
    await patchDoc<CommThread>("comms", nzRe, (d) => {
      d.archived = true;
      d.gmailInboxed = false;
      d.noise = { flagged: true, reason: "Bulk mail", moved: true };
    });
    await reinboxFromGmail(nzRe);
    ok((await read(nzRe)).noise?.rescued === true && (await read(nzRe)).noise?.moved === false && (await read(nzRe)).archived === false, "gmail re-inbox: moved noise brought back from Gmail counts as rescued (not moved out again)");
    const bridgeSrc2 = readFileSync("src/lib/gmail/bridge.ts", "utf8");
    const recon = bridgeSrc2.slice(bridgeSrc2.indexOf("async function reconcileInboxState("), bridgeSrc2.indexOf("/* ---- status re-derive"));
    ok(recon.includes("if (desired && t.gmailInboxed === false) await reinboxFromGmail(t.id);") && recon.includes("else await setGmailInboxed(t.id, desired);") && !recon.includes("patchDoc<CommThread>"), "gmail re-inbox: reconcileInboxState brings an explicit false → true flip back in the app, key-level");

    /* D900 — INBOX_ORG_DISABLED=true turns off the import hook, the post-reply step, the Mark replied / Close archive and the AI pass */
    ok(inboxOrgDisabled({ INBOX_ORG_DISABLED: "true" }) && inboxOrgDisabled({ INBOX_ORG_DISABLED: " TRUE " }) && !inboxOrgDisabled({}) && !inboxOrgDisabled({ INBOX_ORG_DISABLED: "1" }), "kill switch: INBOX_ORG_DISABLED=true only");
    const prevKill = process.env.INBOX_ORG_DISABLED;
    process.env.INBOX_ORG_DISABLED = "true";
    try {
      let organized = 0;
      await organizeAfterImport(tid!, {}, async () => {
        organized++;
        return null as never;
      });
      ok(organized === 0, "kill switch: the import hook doesn't organize");
      const killT = await mk("kill-reply", { customerId: CUST, customer: "TEST335 Apply School", resolution: "linked" });
      await patchDoc<CommThread>("comms", killT, (d) => {
        d.messages = [...d.messages, msg({ direction: "out", fromEmail: "ann.t335@peaksystemsgroup.com", to: "pat@apply-school.test", body: "Here you go." })];
      });
      const kr = await archiveAfterReply(killT, "reply", ann, { manual: true });
      ok(kr.ok && kr.archived === false && kr.skipped === "disabled" && (await read(killT)).archived === false, "kill switch: archiveAfterReply (Mark replied / Close / reply) archives nothing");
      await runPostReply(killT);
      ok((await read(killT)).archived === false, "kill switch: the post-reply step archives nothing");
      const killCtx = buildOrgContext({ users: [{ id: ANN_ID, name: ANN, email: "ann.t335@peaksystemsgroup.com" }], assist: { users: [ANN_ID], features: { tasks: true, reply: true, estimate: true, file: true, promise: true, brief: true, ask: true }, capUsd: 200 }, env: { ANTHROPIC_API_KEY: "sk-test-not-real" } });
      const kp = await runAiPass({ ownerIds: [ANN_ID] }, { ctx: killCtx });
      ok(kp.looked === 0 && kp.calls === 0 && kp.cleared === 0, "kill switch: the AI pass does nothing");
    } finally {
      if (prevKill === undefined) delete process.env.INBOX_ORG_DISABLED;
      else process.env.INBOX_ORG_DISABLED = prevKill;
    }
    const actSrc = readFileSync("src/app/(app)/inbox/actions.ts", "utf8");
    const schedBody = actSrc.slice(actSrc.indexOf("function scheduleAiPass("), actSrc.indexOf("export async function autoSyncAction("));
    ok(actSrc.includes('if ((status === "replied" || status === "closed") && !inboxOrgDisabled()) {') && schedBody.includes("if (!ownerIds.length || inboxOrgDisabled()) return;"), "kill switch: setStatusAction skips the archive and scheduleAiPass schedules nothing");
    ok(readFileSync(".env.example", "utf8").includes("INBOX_ORG_DISABLED="), "kill switch: documented in .env.example");

    /* change → rule offer → rule → re-sweep files a second thread from the same sender */
    const s1 = await mk("rule-1", { contactEmail: "buyer@newco-apply.test", messages: [msg({ fromEmail: "buyer@newco-apply.test", body: "Do you sell drapes?" })] });
    const s2 = await mk("rule-2", { contactEmail: "buyer@newco-apply.test", messages: [msg({ fromEmail: "buyer@newco-apply.test" }), msg({ direction: "out", fromEmail: "ann.t335@peaksystemsgroup.com", to: "buyer@newco-apply.test", body: "Yes." })] });
    const rc = await changeFiling(s1, { customerId: CUST, siteId: SITE }, ann);
    ok(rc.ok && (await read(s1)).customerId === CUST && (await read(s1)).siteId === SITE && (await read(s1)).filing?.state === "filed", "apply change: files under the picked customer + venue");
    ok(rc.ok && rc.ruleOffer?.email === "buyer@newco-apply.test" && rc.ruleOffer.domain === "newco-apply.test" && typeof rc.ruleOffer.target === "object" && rc.ruleOffer.target.customerId === CUST, "apply change: returns the sender's rule offer (email + domain → the customer)");
    ok(!(await changeFiling(s2, { customerId: fixtureId(335, "apply-no-such") }, ann)).ok && !(await changeFiling(s2, { customerId: CUST, siteId: "no-such-site" }, ann)).ok, "apply change: an unknown customer or a venue not on it is refused");
    ok(!(await changeFiling(s2, { work: { type: "quote", id: QUOTE }, customerId: fixtureId(335, "apply-other-cust") }, ann)).ok, "apply change: a quote that isn't the customer's is refused");
    const buyerMsgs = () => [msg({ fromEmail: "buyer@newco-apply.test" }), msg({ direction: "out", fromEmail: "ann.t335@peaksystemsgroup.com", to: "buyer@newco-apply.test", body: "Yes." })];
    const s3 = await mk("rule-handlinked", { contactEmail: "buyer@newco-apply.test", customerId: CUST_A, customer: "TEST335 Other Co", resolution: "linked", link: { type: "quote", id: QUOTE_A }, messages: buyerMsgs(), status: "waiting_them" });
    const s4 = await mk("rule-same-cust", { contactEmail: "buyer@newco-apply.test", customerId: CUST, customer: "TEST335 Apply School", resolution: "linked", link: { type: "quote", id: QUOTE_A }, messages: buyerMsgs(), status: "waiting_them" });
    const s5 = await mk("rule-archived-skipped", { contactEmail: "buyer@newco-apply.test", archived: true, messages: buyerMsgs(), status: "waiting_them" });
    await setOrg(s5, { filing: { ...(await read(s5)).filing!, state: "skipped" } });
    const s6 = await mk("rule-archived-tofile", { contactEmail: "buyer@newco-apply.test", archived: true, messages: buyerMsgs(), status: "waiting_them" });
    await setOrg(s6, { filing: { ...(await read(s6)).filing!, archivedOnReply: true } }); // archived on reply, still To file
    ok((await read(s3)).filing?.customerId === CUST_A && (await read(s6)).filing?.state === "suggested", "apply rule: (setup) a hand-linked thread and an archived To file thread");
    const co = await acceptRuleOffer(rc.ok ? rc.ruleOffer! : ({} as never), { match: "email", scope: "company" }, ann);
    ok(!co.ok && co.error === "forbidden" && !(await getSenderRules()).some((r) => r.match.email === "buyer@newco-apply.test"), "apply rule: a company-wide rule needs an admin");
    const rr = await acceptRuleOffer(rc.ok ? rc.ruleOffer! : ({} as never), { match: "email", scope: "user" }, ann);
    const t2 = await read(s2);
    ok(rr.ok && rr.rule.scope === "user" && rr.rule.userId === ANN_ID && rr.rule.action.type === "file", "apply rule: a personal rule is saved");
    ok(rr.ok && rr.filed >= 1 && t2.filing?.source === "rule" && t2.filing.state === "filed" && t2.filing.filedBy === "rule" && t2.customerId === CUST, "apply rule: the re-sweep files the sender's other thread (filedBy rule)");
    ok(t2.archived === true, "apply rule: …and archives it (no reply owed there)");
    const t3 = await read(s3);
    ok(t3.customerId === CUST_A && t3.link?.id === QUOTE_A && t3.filing?.state === "suggested" && t3.filing.source === "rule" && t3.filing.customerId === CUST && t3.filing.strength === "strong" && !t3.archived, "apply rule: a thread hand-linked to another customer is NOT relinked — it only gets the rule as a strong suggestion");
    const t4 = await read(s4);
    ok(t4.customerId === CUST && t4.filing?.state === "filed" && t4.filing.filedBy === "rule" && t4.link === null, "apply rule: a thread already on the rule's customer is auto-filed, and its stale link to another customer's quote is cleared");
    await undoFiling(s4, ann);
    ok((await read(s4)).link?.id === QUOTE_A && (await read(s4)).customerId === CUST, "apply rule: undo puts the cleared link back");
    ok((await read(s5)).filing?.state === "skipped" && !(await read(s5)).customerId, "apply rule: an archived thread that isn't in To file is not swept");
    ok((await read(s6)).filing?.state === "filed" && (await read(s6)).customerId === CUST, "apply rule: an archived thread still in To file is swept and filed");
    // a rule WITH work never replaces a hand-picked link on the same customer
    const ordersMsgs = () => [msg({ fromEmail: "orders@newco2-apply.test" }), msg({ direction: "out", fromEmail: "ann.t335@peaksystemsgroup.com", to: "orders@newco2-apply.test", body: "Got it." })];
    const s7 = await mk("rule-work-handpicked", { contactEmail: "orders@newco2-apply.test", customerId: CUST, customer: "TEST335 Apply School", resolution: "linked", link: { type: "quote", id: QUOTE_B }, messages: ordersMsgs(), status: "waiting_them" });
    const s8 = await mk("rule-work-nolink", { contactEmail: "orders@newco2-apply.test", messages: ordersMsgs(), status: "waiting_them" });
    const rw = await acceptRuleOffer({ email: "orders@newco2-apply.test", domain: "newco2-apply.test", target: { customerId: CUST, work: { type: "quote", id: QUOTE } } }, { match: "email", scope: "user" }, ann);
    ok(rw.ok && (await read(s7)).filing?.state === "filed" && (await read(s7)).link?.id === QUOTE_B, "apply fix 3: a rule with work files a same-customer thread but keeps its hand-picked quote link");
    ok((await read(s8)).filing?.state === "filed" && (await read(s8)).link?.id === QUOTE && (await read(s8)).customerId === CUST, "apply fix 3: …and sets the rule's work on a thread with no link");
    const cr = await acceptRuleOffer({ email: "x@admin-apply.test", domain: "admin-apply.test", target: "noise" }, { match: "domain", scope: "company" }, boss);
    ok(cr.ok && cr.rule.scope === "company" && cr.rule.match.domain === "admin-apply.test", "apply rule: an admin saves a company-wide domain rule");
    ok(!(await acceptRuleOffer({ email: "x@gmail.com", domain: "gmail.com", target: "noise" }, { match: "domain", scope: "user" }, ann)).ok && !(await acceptRuleOffer({ email: "ben.t335@peaksystemsgroup.com", domain: null, target: "noise" }, { match: "email", scope: "user" }, ann)).ok, "apply rule: no rule for a public mail domain or a teammate's address");

    /* approve all strong only touches strong rows */
    const strongA = await mk("all-strong", { subject: "EST-987700", messages: [msg({}), msg({ direction: "out", fromEmail: "ann.t335@peaksystemsgroup.com", to: "pat@apply-school.test" })], status: "waiting_them" });
    const weakA = await mk("all-weak", { resolution: "suggested", suggestedCustomerId: CUST });
    const noiseA = await mk("all-noise", { contactEmail: "deals@shop-apply.test", messages: [msg({ fromEmail: "deals@shop-apply.test", gmailLabelIds: ["CATEGORY_PROMOTIONS"] })] });
    ok((await read(weakA)).filing?.strength === "weak" && (await read(noiseA)).filing?.noise === true, "apply all: (setup) a weak row and a noise row");
    const rAll = await approveAllStrong([strongA, weakA, noiseA, others], ann);
    ok(rAll.approved === 1 && rAll.skipped === 3 && (await read(strongA)).filing?.state === "filed", "apply all: only the strong row is approved");
    ok((await read(weakA)).filing?.state === "suggested" && !(await read(weakA)).customerId && (await read(noiseA)).filing?.state === "suggested" && (await read(others)).filing?.state === "suggested", "apply all: weak, noise and other people's rows are untouched");

    /* noise / not noise / skip */
    const rn = await markNoise(noiseA, ann);
    ok(rn.ok && (await read(noiseA)).noise?.flagged === true && (await read(noiseA)).noise?.moved === true && (await read(noiseA)).archived === true && (await read(noiseA)).filing?.state === "dismissed", "apply noise: marked noise moves it to the Noise tab");
    const rnn = await notNoise(noiseA, ann);
    const nn = await read(noiseA);
    ok(rnn.ok && nn.noise?.rescued === true && !nn.noise.flagged && nn.archived === false && nn.filing?.state === "suggested" && !nn.filing.noise, "apply not noise: back in the inbox and To file, never flagged again");
    ok(rnn.ok && rnn.ruleOffer?.email === "deals@shop-apply.test" && rnn.ruleOffer.target === "never-noise", "apply not noise: offers 'never treat as noise'");
    await organizeThread(noiseA);
    ok(!(await read(noiseA)).noise?.flagged && !(await read(noiseA)).archived, "apply not noise: the pipeline keeps it rescued");
    const sk = await skipFiling(weakA, ann);
    ok(sk.ok && (await read(weakA)).filing?.state === "skipped", "apply skip: the suggestion is skipped");
    ok((await getFilingLog()).some((e) => e.threadId === weakA && e.action === "skipped") && (await getFilingLog()).some((e) => e.threadId === noiseA && e.action === "rescued"), "apply: skip and rescue are logged");
    const rescuedPick = filingFromPick(
      { kind: "noise", strength: "strong", reason: "promo", needsReply: false } as never,
      (await read(noiseA)).filing!,
      { now: Date.now(), runId: "R-x", courtOwnerIsMe: true, prevNoise: { flagged: false, reason: "", moved: false, rescued: true } }
    );
    ok(rescuedPick.noise === undefined && !rescuedPick.filing.noise && rescuedPick.filing.source !== "ai", "apply not noise: the AI filing never makes a rescued thread noise again");

    /* court override */
    const ov = await mk("override", {});
    const rov = await overrideCourt(ov, "nobody", ann);
    ok(rov.ok && (await read(ov)).court?.source === "override" && (await read(ov)).court?.owner === "nobody" && (await read(ov)).status === "closed" && (await read(ov)).filing?.needsReply === false, "apply override: Not on me sets an override court, status follows");
    await organizeThread(ov);
    ok((await read(ov)).court?.source === "override", "apply override: it sticks until the next message");
    ok(!(await overrideCourt(ov, "teammate", ann, { teammateId: "nobody-real" })).ok, "apply override: a teammate court needs a real teammate");

    /* AI outcomes: approve → accepted, undo → noted */
    const runRow = (id: string, feature: "file" | "promise", contextRef: string) =>
      ({ id, feature, step: null, userId: ANN_ID, userName: ANN, provider: "fake", model: "m", requestedModel: "m", fellBack: false, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0, latencyMs: 0, inputHash: "h", output: "", ok: true, error: null, stopReason: null, contextRef, monthKey: "2026-10", outcome: null, outcomeDetail: null, outcomeAt: null, createdAt: Date.now() - 1000 });
    const aiId = await mk("ai", {});
    const RUN = fixtureId(335, "apply-run");
    await upsertDoc("assist_runs" as never, runRow(RUN, "file", "thread:" + aiId) as never);
    registerFixture("assist_runs" as never, RUN);
    const aiFiling: Filing = { customerId: CUST, work: { type: "quote", id: QUOTE, label: "EST-987700 Gym curtain" }, noise: false, source: "ai", reason: "Looks like the gym curtain", strength: "strong", needsReply: false, state: "suggested", at: Date.now(), runId: RUN };
    await setOrg(aiId, { filing: aiFiling });
    await approveFiling(aiId, ann);
    ok((await getRun(RUN))?.outcome === "accepted", "apply AI: approving an AI suggestion sets its run outcome 'accepted'");
    await undoFiling(aiId, ann);
    ok((await getRun(RUN))?.outcome === "accepted" && (await getRun(RUN))?.outcomeDetail?.undone === true, "apply AI: undo notes it on the run (first outcome kept)");

    /* promise-task Undo */
    const pt = await mk("promise", {});
    const TASK = fixtureId(335, "apply-task");
    await createFixture("tasks", { id: TASK, title: "Send the price", section: "Email", threadId: pt, assigneeUserId: ANN_ID, assigneeName: ANN, createdAt: Date.now() - 500, updatedAt: Date.now() - 500, doneAt: null } as never);
    const PRUN = fixtureId(335, "apply-prun");
    await upsertDoc("assist_runs" as never, runRow(PRUN, "promise", "thread:" + pt) as never);
    registerFixture("assist_runs" as never, PRUN);
    const ptc = (await read(pt)).court!;
    await setOrg(pt, { court: { ...ptc, promise: { text: "Send the price", ownerUserId: ANN_ID, due: null, taskId: TASK, messageId: "m" } } });
    const rpt = await undoPromiseTask(pt, TASK, ann);
    ok(rpt.ok && (await getDoc("tasks", TASK)) === null && !(await read(pt)).court?.promise, "apply promise undo: the task is soft-deleted and dropped from the court");
    ok((await getRun(PRUN))?.outcome === "discarded", "apply promise undo: the reading's run is logged 'discarded'");

    /* review fixes */
    const conflict = await mk("reply-conflict", { customerId: CUST_A, customer: "TEST335 Other Co", resolution: "linked" });
    await setOrg(conflict, { filing: { customerId: CUST, work: null, noise: false, source: "rule", reason: "rule", strength: "strong", needsReply: true, state: "suggested", at: Date.now() } });
    await archiveAfterReply(conflict, "reply", ann, { manual: true });
    const cf = await read(conflict);
    ok(cf.customerId === CUST_A && cf.filing?.customerId === CUST_A && cf.filing.filedBy === "reply" && cf.archived === true, "apply fix: on reply, a strong suggestion for another customer never overrides the hand link (the hand link is filed)");
    const foreign = await mk("reply-foreign-link", { customerId: CUST, customer: "TEST335 Apply School", resolution: "linked", link: { type: "quote", id: QUOTE_A } });
    await archiveAfterReply(foreign, "reply", ann, { manual: true });
    ok((await read(foreign)).filing?.filedBy === "reply" && (await read(foreign)).link === null && (await read(foreign)).customerId === CUST, "apply fix 3: archive-on-reply filing clears a link to another customer's record");
    await undoFiling(foreign, ann);
    ok((await read(foreign)).link?.id === QUOTE_A && (await read(foreign)).archived === false, "apply fix 3: …and Undo puts that link back (and un-archives)");
    const sendRecv = actionsSrc.slice(actionsSrc.indexOf("export async function sendReceiveAction("), actionsSrc.indexOf("function scheduleAiPass("));
    ok(sendRecv.includes("await flushOutbox({ defer: (run) => after(run) })"), "apply fix 3: Send/Receive defers delivered queued replies' post-reply step to after()");
    // a pilot owner's strong AI suggestion survives their own reply and is
    // filed by archive-on-reply (the real comms.reply + post-reply path)
    const autoId = await mk("ai-auto", {});
    const ARUN = fixtureId(335, "apply-arun");
    await upsertDoc("assist_runs" as never, runRow(ARUN, "file", "thread:" + autoId) as never);
    registerFixture("assist_runs" as never, ARUN);
    const settingsBefore = await getSettingsPatch();
    const keyBefore = process.env.ANTHROPIC_API_KEY;
    try {
      await setSettings({ assistUsers: [ANN_ID], assistFeatures: { file: true, promise: true } });
      process.env.ANTHROPIC_API_KEY = "sk-test-not-real";
      invalidateOrgContext();
      ok(isOrgPilot(ANN_ID, "file", await loadOrgContext()), "apply fix 2: (setup) Ann is an Assist pilot user");
      const custMsg = (await read(autoId)).messages[0];
      await setOrg(autoId, { filing: { ...aiFiling, runId: ARUN, basis: custMsg.id, needsReply: true } });
      await reply(autoId, { body: "Here's the price.", me: ANN });
      const af = await read(autoId);
      const autoRun = await getRun(ARUN);
      ok(af.filing?.state === "filed" && af.filing.filedBy === "reply" && af.filing.source === "ai" && af.customerId === CUST && af.link?.id === QUOTE, "apply fix 2: my reply doesn't reset the AI suggestion — archive-on-reply files the thread under it (filedBy reply)");
      ok(autoRun?.outcome === null && autoRun?.outcomeDetail?.autoFiled === "reply", "apply fix 2: the run's outcome stays null; its detail notes autoFiled 'reply'");
      ok(af.archived === true && af.court?.owner === "customer", "apply fix 2: …and the thread is archived (court customer)");
    } finally {
      await setSettings({ assistUsers: settingsBefore.assistUsers ?? [], assistFeatures: settingsBefore.assistFeatures ?? {} });
      if (keyBefore === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = keyBefore;
      invalidateOrgContext();
    }
    // only outside mail resets a skipped filing; the court follows every message
    const sk2 = await mk("skip-own-reply", {});
    await skipFiling(sk2, ann);
    await addMessage(sk2, { direction: "out", body: "Will check.", me: ANN });
    await organizeThread(sk2);
    ok((await read(sk2)).filing?.state === "skipped" && (await read(sk2)).court?.owner === "customer", "apply fix 2: my own message leaves a skipped filing skipped (the court still moves)");
    await addMessage(sk2, { direction: "in", body: "Any update?" });
    await organizeThread(sk2);
    ok((await read(sk2)).filing?.state === "suggested" && (await read(sk2)).court?.owner === "me", "apply fix 2: new outside mail brings it back to To file");
    ok((await read(weakId)).filing?.archivedOnReply === true && (await toFileThreads(ann)).some((t) => t.id === weakId) && (await read(weakId)).archived === true, "apply fix 3: an archived-on-reply weak suggestion is stamped and IS in To file");
    const sent = [msg({}), msg({ direction: "out", fromEmail: "ann.t335@peaksystemsgroup.com", to: "pat@apply-school.test" })];
    const archStrong = await mk("all-archived-strong", { archived: true, subject: "EST-987700", messages: sent, status: "waiting_them" });
    const gmailArch = await mk("all-gmail-archived", { gmailInboxed: false, subject: "EST-987700", messages: [msg({}), msg({ direction: "out", fromEmail: "ann.t335@peaksystemsgroup.com", to: "pat@apply-school.test" })], status: "waiting_them" });
    const inboxStrong = await mk("all-inbox-strong", { subject: "EST-987700", messages: [msg({}), msg({ direction: "out", fromEmail: "ann.t335@peaksystemsgroup.com", to: "pat@apply-school.test" })], status: "waiting_them" });
    const toFile = (await toFileThreads(ann)).map((t) => t.id);
    ok(!toFile.includes(gmailArch) && !toFile.includes(archStrong) && toFile.includes(inboxStrong), "apply fix 3: To file is the inbox (+ archived-on-reply) — mail archived in Gmail or archived by hand isn't in it");
    const rAll2 = await approveAllStrong("all-visible", ann);
    ok(rAll2.approved >= 1 && (await read(inboxStrong)).filing?.state === "filed" && (await read(gmailArch)).filing?.state === "suggested" && !(await read(gmailArch)).customerId && (await read(archStrong)).filing?.state === "suggested", "apply fix 3: approve-all ('all-visible') takes inbox rows only — the Gmail-archived one is untouched");
    const rIds = await approveAllStrong([gmailArch], ann);
    ok(rIds.approved === 0 && rIds.skipped === 1 && (await read(gmailArch)).filing?.state === "suggested" && (await read(gmailArch)).filing?.strength === "strong" && !(await read(gmailArch)).customerId, "polish: approve-all with ids skips my own strong suggestion that's archived in Gmail (not a To file row)");
    await approveFiling(archStrong, ann);
    ok((await read(archStrong)).filing?.state === "filed" && !(await read(archStrong)).filing?.applied?.archived, "apply fix: (setup) a thread archived before filing, approved directly");
    await undoFiling(archStrong, ann);
    ok((await read(archStrong)).archived === true && (await read(archStrong)).filing?.state === "suggested", "apply fix: undo keeps a thread archived that was archived before filing");
    await changeFiling(weakId, { customerId: CUST }, ann);
    ok((await read(weakId)).filing?.state === "filed" && !(await read(weakId)).filing?.archivedOnReply && (await read(weakId)).filing?.applied?.archivedOnReply === true, "apply fix 3: filing clears the stamp (and remembers it)");
    await undoFiling(weakId, ann);
    ok((await read(weakId)).filing?.archivedOnReply === true && (await toFileThreads(ann)).some((t) => t.id === weakId), "apply fix 3: undo puts an archived-on-reply row back in To file");
    await addMessage(weakId, { direction: "in", body: "One more thing?" });
    ok((await read(weakId)).archived === false && !(await read(weakId)).filing?.archivedOnReply, "apply fix 3: un-archiving clears the stamp");

    /* internal threads: a later number re-files; a teammate's second forward re-files */
    const intl = await mk("internal-number-later", { contactEmail: "ben.t335@peaksystemsgroup.com", subject: "Lunch?", messages: [msg({ fromEmail: "ben.t335@peaksystemsgroup.com", to: "ann.t335@peaksystemsgroup.com", body: "Lunch at noon?" })] });
    ok((await read(intl)).filing?.state === "skipped", "apply fix 3: (setup) an internal thread with no number is skipped");
    await patchDoc<CommThread>("comms", intl, (d) => {
      d.messages = [...d.messages, msg({ fromEmail: "ben.t335@peaksystemsgroup.com", to: "ann.t335@peaksystemsgroup.com", body: "Also — can you look at EST-987700 today?" })];
    });
    await organizeThread(intl);
    ok((await read(intl)).filing?.state === "suggested" && (await read(intl)).filing?.work?.id === QUOTE && (await read(intl)).filing?.source === "number", "apply fix 3: a later teammate message naming an estimate re-files a skipped internal thread");
    const fwdOf = (from: string, subject: string, body: string) =>
      `Ann, can you take this?\n\n---------- Forwarded message ---------\nFrom: Someone <${from}>\nDate: Mon, Oct 12, 2026 at 9:00 AM\nSubject: ${subject}\nTo: Ben <ben.t335@peaksystemsgroup.com>\n\n${body}`;
    const fw = await mk("teammate-forwards", {
      contactEmail: "outside@fwd-apply.test",
      subject: "Fwd: Drapes",
      messages: [msg({ fromEmail: "ben.t335@peaksystemsgroup.com", to: "ann.t335@peaksystemsgroup.com", cc: "outside@fwd-apply.test", body: fwdOf("buyer@fwd-apply.test", "Drapes", "Do you sell drapes?") })],
    });
    await skipFiling(fw, ann);
    await patchDoc<CommThread>("comms", fw, (d) => {
      d.messages = [...d.messages, msg({ fromEmail: "ben.t335@peaksystemsgroup.com", to: "ann.t335@peaksystemsgroup.com", body: fwdOf("pat@apply-school.test", "EST-987700 follow-up", "Any update on EST-987700?") })];
    });
    await organizeThread(fw);
    ok((await read(fw)).filing?.state === "suggested" && (await read(fw)).filing?.work?.id === QUOTE, "apply fix 3: a teammate's second forward of outside mail re-files the thread");
    const queuedId = await mk("queued", { customerId: CUST, customer: "TEST335 Apply School", resolution: "linked" });
    await patchDoc<CommThread>("comms", queuedId, (d) => {
      d.messages = [...d.messages, msg({ direction: "out", fromEmail: "ann.t335@peaksystemsgroup.com", to: "pat@apply-school.test", body: "Queued reply", queued: true })];
    });
    ok(!replyLeft(await read(queuedId)) && replyLeft({ ...(await read(queuedId)), messages: [msg({ direction: "out" })] }), "apply fix: replyLeft is about the just-written message only");
    ok((await read(queuedId)).archived === false, "apply fix: (setup) a queued reply hasn't archived the thread");
    await flushOutbox();
    ok((await read(queuedId)).archived === true && (await read(queuedId)).court?.owner === "customer", "apply fix: when flushOutbox delivers a queued reply, the post-reply step runs (court + archive)");
    const mn = await mk("moved-noise", { contactEmail: "deals@shop-apply.test", messages: [msg({ fromEmail: "deals@shop-apply.test", body: "Can you quote this?", gmailLabelIds: ["CATEGORY_PROMOTIONS"] })] });
    await markNoise(mn, ann);
    ok((await read(mn)).archived === true && (await read(mn)).court?.owner === "me", "apply fix: (setup) moved noise, court me");
    await changeFiling(mn, { customerId: CUST }, ann);
    ok((await read(mn)).archived === false && (await read(mn)).filing?.state === "filed" && (await read(mn)).noise?.rescued === true, "apply fix: Change… on moved noise still owed a reply brings it back to the inbox");
    const replySrc = actionsSrc.slice(actionsSrc.indexOf("export async function replyAction("), actionsSrc.indexOf("export async function logNoteAction("));
    ok(replySrc.includes('postReply: "caller"') && replySrc.includes("if (replyLeft(sent)) after(() => runPostReply(id));"), "apply fix: replyAction schedules the post-reply step with after(), off the send path");
  } finally {
    for (const id of imported) await db.delete(commsTable).where(eq(commsTable.id, id));
    for (const id of BLOBS) {
      const row = before.get(id);
      if (row) await db.update(blobs).set({ data: row.data, updatedAt: row.updatedAt }).where(eq(blobs.id, id));
      else await db.delete(blobs).where(eq(blobs.id, id));
    }
    await db.delete(notifPrefs).where(eq(notifPrefs.userName, ANN));
    await db.delete(sites).where(eq(sites.id, SITE));
    await db.delete(companies).where(eq(companies.id, CUST));
    await db.delete(companies).where(eq(companies.id, CUST_A));
    for (const id of [ANN_ID, BEN_ID, BOSS_ID]) await db.delete(users).where(eq(users.id, id));
    invalidateOrgContext();
  }
}

/* ---------- Task 6: the Organize view + reader UI (spec §2, §3, §7, §9) ---------- */

/** Non-type imports of a source file (`import type …` lines skipped). */
function valueImports(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/^import\s+(?!type\s)([\s\S]*?)\s+from\s+"([^"]+)";?/gm)) out.push(m[2]);
  for (const m of src.matchAll(/^import\s+"([^"]+)";?/gm)) out.push(m[1]);
  return out;
}

export async function inboxOrgUiChecks(ok: Ok): Promise<void> {
  const { existsSync } = await import("node:fs");
  const read = (p: string) => readFileSync(p, "utf8");
  const DIR = "src/app/(app)/inbox/organize";

  /* the route + files */
  for (const f of ["format.ts", "load.ts", "organize-box.tsx", "change-filing.tsx", "rule-offer.tsx", "reader-org.tsx"])
    ok(existsSync(`${DIR}/${f}`), `ui: organize/${f} exists`);
  const page = read("src/app/(app)/inbox/page.tsx");
  ok(page.includes('const isOrganize = viewParam === "organize";') && page.includes("<OrganizeBox") && page.includes("loadOrganize(user, organizeTab"), "ui: /inbox?view=organize renders the Organize box from loadOrganize");
  ok(page.includes('key: "organize"') && page.includes("count: organizeCounts.toFile") && page.includes('href: viewHref("organize")'), "ui: the Inbox nav carries an Organize row with the To file count");
  ok(page.includes("view === \"unmatched\" || isMeetings || isOrganize") && page.includes("const isView = !!view || isMeetings || isOrganize;"), "ui: Organize is a view and skips the thread-list query");
  ok(page.includes("explicitThread && visibleTo(explicitThread, viewer)"), "ui: Organize opens only my own thread in the reader (#349: by identity)");
  ok(page.includes("org,") && page.includes("buildReaderOrg(sel,"), "ui: the reader VM carries the organization strip");
  const shell = read("src/app/(app)/inbox/inbox-shell.tsx");
  ok(shell.includes("meetings || organize ?") && shell.includes("organize?.list") && shell.includes('{ value: "organize", label: "Organize" }'), "ui: the shell swaps the list column for the Organize box (and the narrow picker knows it)");
  ok(shell.includes("(organize ? `&tab=${organizeTab}` : \"\")"), "ui: an open thread keeps the Organize tab on the URL");

  /* client-bundle rule: client files import only actions, pure modules and types */
  const clientFiles = [
    `${DIR}/organize-box.tsx`,
    `${DIR}/change-filing.tsx`,
    `${DIR}/rule-offer.tsx`,
    `${DIR}/reader-org.tsx`,
    "src/app/(app)/inbox/thread-reader.tsx",
    "src/app/(app)/inbox/inbox-shell.tsx",
    "src/app/(app)/inbox/thread-list.tsx",
    "src/components/popout/live-sync.tsx",
  ];
  const banned = /^@\/(db\b|lib\/stores\/|lib\/inbox-org\/(apply|pipeline|ai-|court|due|noise|forward|numbers|sender-rules|internal|ids|signoff)\b)|(^|\/)load$/;
  for (const f of clientFiles) {
    const src = read(f);
    ok(src.startsWith('"use client";'), `ui: ${f.split("/").pop()} is a client component`);
    const bad = valueImports(src).filter((p) => banned.test(p));
    ok(bad.length === 0, `ui: ${f.split("/").pop()} imports no store, db or server module${bad.length ? ` (found ${bad.join(", ")})` : ""}`);
  }
  const fmt = read(`${DIR}/format.ts`);
  ok(valueImports(fmt).length === 0, "ui: organize/format.ts (shared with the client) has no value imports");
  const bc = read("src/lib/popout/channel.ts");
  ok(valueImports(bc).length === 0, "ui: popout/channel.ts has no imports (client-safe)");
  const oa = read("src/app/(app)/inbox/organize-actions.ts");
  ok(oa.startsWith('"use server";') && !/^export (const|let|function|class|type\b)/m.test(oa.replace(/^export type [^\n]*$/gm, "")) && oa.includes("export async function filingRecordsAction("), "ui: organize-actions.ts exports only async server actions (filingRecordsAction added)");

  /* BroadcastChannel (spec §9) */
  ok(bc.includes('export const PEAK_CHANNEL = "peak";') && bc.includes("new BroadcastChannel(PEAK_CHANNEL)") && bc.includes("ch.postMessage(msg);"), "ui: postChanged posts a {type:\"changed\"} message on BroadcastChannel(\"peak\")");
  ok(/function post\(msg: PeakMessage\): boolean \{\s*try \{[\s\S]*?\} catch/.test(bc), "ui: the post is wrapped in try/catch");
  ok(bc.includes('d.type === "inbox-changed"'), "ui: onMessage still maps the legacy inbox-changed message");
  for (const f of [`${DIR}/organize-box.tsx`, `${DIR}/change-filing.tsx`, `${DIR}/rule-offer.tsx`, `${DIR}/reader-org.tsx`, "src/app/(app)/inbox/thread-reader.tsx"])
    ok(/postChanged\("(thread|inbox)"/.test(read(f)), `ui: ${f.split("/").pop()} posts changed after a change`);
  const liveSync = read("src/components/popout/live-sync.tsx");
  ok(/onMessage\(/.test(liveSync) && liveSync.includes("router.refresh()") && liveSync.includes("const CHANGED_DEBOUNCE_MS = 1000;"), "ui: LiveSync (pop-out spec §5) refreshes the router on a changed message, debounced 1 s");
  ok(!shell.includes("InboxChangedListener") && !read("src/app/(app)/page.tsx").includes("InboxChangedListener") && read("src/app/(app)/layout.tsx").includes("<LiveSync />"), "ui: the Inbox shell and Home no longer mount their own listener — LiveSync in the (app) layout covers them");

  /* reader: promise-task checkbox, unticked, completes through the task status action */
  const tr = read("src/app/(app)/inbox/thread-reader.tsx");
  ok(tr.includes("const [markPromiseDone, setMarkPromiseDone] = useState(false);") && tr.includes("Mark ‘{shortTaskTitle(openPromise.title)}’ done?"), "ui: the composer shows an unticked “Mark ‘…’ done?” while a promise-task is open");
  ok(tr.includes("if (res.ok && markPromiseDone && openPromise)") && tr.includes("await completeThreadTaskAction(openPromise.taskId);"), "ui: a ticked box completes the task via completeThreadTaskAction after a successful send");
  ok(tr.includes("const done = await completeThreadTaskAction(openPromise.taskId);") && tr.includes("if (!done.ok) setPromiseNote("), "polish: a failed “Mark done” shows a note (the reply still went out)");
  ok(page.includes("<OrganizeBox\n          key={`organize-list-${vm.tab}`}"), "polish: the Organize box is keyed by tab (no confirm / offer / note carry-over)");
  ok(tr.includes("{vm.org && <ReaderOrgStrip threadId={vm.id} org={vm.org} />}"), "ui: the reader shows the organization strip");
  const ro = read(`${DIR}/reader-org.tsx`);
  ok(ro.includes('overrideCourtAction(threadId, "nobody")') && ro.includes('overrideCourtAction(threadId, "me")') && ro.includes("Not on me") && ro.includes("On me"), "ui: Not on me / On me override the court");
  ok(ro.includes("undoPromiseTaskAction(threadId, promise.taskId)") && ro.includes("Task created:"), "ui: Task created … Undo calls undoPromiseTask");
  ok(/\{promise\.open && \([\s\S]{0,500}?undoPromiseTaskAction/.test(ro), "polish: Undo shows only while the promise-task is open");
  ok(ro.includes('"Looks like noise"') && ro.includes("notNoiseAction(threadId)"), "ui: the Looks like noise tag offers Not noise");
  ok(ro.includes('filing.state === "suggested"') && ro.includes("approveFilingAction(threadId)"), "ui: a suggested filing line has Approve");
  const ob = read(`${DIR}/organize-box.tsx`);
  ok(ob.includes("<CleanupButton cleanup={cleanup.state} prompt={cleanupPrompt} />") && ob.includes("cleanup?: { state: CleanupVM | null } | null;"), "ui: the Organize my inbox button renders only when the page passes it (pilot users, Task 7)");
  ok(ob.includes("approveAllStrongAction(vm.strongIds)") && ob.includes("Approve {vm.strongIds.length} strong suggestion"), "ui: Approve all strong asks for a confirm that shows the count");
  const cf = read(`${DIR}/change-filing.tsx`);
  ok(cf.includes("searchLinkTargetsAction(query)") && cf.includes("filingRecordsAction(threadId, pickedCustomer || null)") && cf.includes("changeFilingAction(threadId, target)"), "ui: Change… reuses the link search plus the customer's quotes/projects/leads");
  const rof = read(`${DIR}/rule-offer.tsx`);
  ok(rof.includes("Just this sender") && rof.includes("Whole domain") && rof.includes("No thanks") && rof.includes("{isAdmin && ("), "ui: the rule offer has Just this sender / Whole domain / No thanks, company scope admin-only");

  /* pure: format */
  ok(organizeTabOf("noise") === "noise" && organizeTabOf("filed") === "filed" && organizeTabOf("x") === "to-file" && organizeTabOf(null) === "to-file", "ui: organizeTabOf defaults to To file");
  ok(organizeHref(ORGANIZE_BASE_HREF, "filed", "C 1") === "/inbox?view=organize&tab=filed&thread=C%201" && organizeHref("/organize", "noise") === "/organize?tab=noise", "ui: organizeHref builds tab + thread links on any base");
  ok(courtChipLabel("me", "Customer wrote last", null) === "On you: Customer wrote last" && courtChipLabel("teammate", "", "Dana") === "On Dana" && courtChipLabel("customer", "x", null) === "Waiting on customer" && courtChipLabel("nobody", "x", null) === "Done", "ui: court chip labels");
  ok(suggestionLabel({ noise: false, customerId: "c1", work: { type: "quote", id: "Q-1", label: "EST-1042 Main curtain" } }, "Lincoln HS") === "Lincoln HS → EST-1042 Main curtain" && suggestionLabel({ noise: true, customerId: null, work: null }, null) === "Noise" && suggestionLabel({ noise: false, customerId: null, work: null }, null) === null, "ui: suggestion label");
  ok(filedByLabel("approved") === "approved" && filedByLabel("reply") === "on reply" && filedByLabel("rule") === "sender rule" && filedByLabel("teammate-reply") === "teammate reply", "ui: filed-by labels");

  /* pure: the Organize VM over fake threads */
  const NOW = Date.UTC(2026, 9, 13, 17, 0); // Tue 13 Oct 2026, noon Chicago
  const DAY = 86_400_000;
  const ME = "TEST335 Ui";
  const fil = (o: Partial<Filing>): Filing => ({ customerId: "c1", work: null, noise: false, source: "rule", reason: "Sender rule", strength: "strong", needsReply: false, state: "suggested", at: NOW, ...o });
  const th = (id: string, o: Partial<CommThread>): CommThread =>
    ({ id, mailbox: "personal", mailboxUser: ME, status: "waiting_us", archived: false, deleted: false, subject: `Subj ${id}`, contactName: `Sender ${id}`, contactEmail: `${id}@x.test`, updatedAt: NOW - 1000, messages: [], ...o }) as unknown as CommThread;
  const threads: CommThread[] = [
    th("a", { filing: fil({ work: { type: "quote", id: "Q-1", label: "EST-1042 Main curtain" } }), updatedAt: NOW - 5000 }),
    th("b", { filing: fil({ strength: "weak", needsReply: true }), updatedAt: NOW - 2000 }),
    th("c", { filing: fil({ archivedOnReply: true, strength: "weak" }), archived: true }),
    th("d", { filing: fil({ customerId: null }) }), // strong but unresolved: not strong-approvable
    th("e", { filing: fil({ noise: true }), noise: { flagged: true, reason: "Promotions", moved: true }, archived: true, updatedAt: NOW - 100 }),
    th("f", { noise: { flagged: true, reason: "No-reply sender", moved: true }, updatedAt: NOW - 50 }), // moved but still in the inbox
    th("g", { filing: fil({ state: "filed", filedBy: "reply", filedAt: NOW - 3 * DAY }), archived: true }),
    th("h", { filing: fil({ state: "filed", filedBy: "rule", filedAt: NOW - 20 * DAY }), archived: true }), // older than 14 days
    th("i", { filing: fil({ state: "filed", filedBy: "approved", filedAt: NOW - DAY }), archived: true }),
    th("j", { filing: fil({}), archived: true }), // archived, not on reply: no To file row
    th("k", { filing: fil({}), deleted: true }),
    th("l", { filing: fil({ state: "skipped" }) }),
    th("n", { filing: fil({ noise: true }), noise: { flagged: true, reason: "Newsletter", moved: false }, updatedAt: NOW - 20 }), // tagged only (non-pilot), still in the inbox
    th("o", { noise: { flagged: false, reason: "", moved: false, rescued: true }, updatedAt: NOW - 10 }), // rescued: not noise
  ];
  const names = (id: string) => (id === "c1" ? "Lincoln HS" : null);
  const vmT = buildOrganizeVM(threads, { tab: "to-file", now: NOW, customerName: names, isAdmin: true });
  ok(vmT.rows.map((r) => r.id).join(",") === "c,d,b,a", "ui vm: To file lists the toFileThreads rows newest first (skipped, archived-not-on-reply, deleted, noise and filed left out)");
  ok(vmT.counts.toFile === 4 && vmT.counts.noise === 3 && vmT.counts.filed === 2, "ui vm: counts — To file 4, Noise 3, Filed 2 (the 20-day-old filing left out)");
  ok(vmT.strongIds.join(",") === "a", "ui vm: Approve all strong takes only strong, resolved rows");
  const ra = vmT.rows.find((r) => r.id === "a")!;
  ok(ra.suggestion === "Lincoln HS → EST-1042 Main curtain" && ra.strength === "strong" && ra.canApprove && ra.href === "/inbox?view=organize&tab=to-file&thread=a", "ui vm: a row carries its suggestion, strength and reader link");
  ok(vmT.rows.find((r) => r.id === "b")!.needsReply && vmT.rows.find((r) => r.id === "c")!.archived && !vmT.rows.find((r) => r.id === "b")!.archived, "ui vm: the needs-reply dot and the Archived chip (archived-on-reply only)");
  ok(!vmT.rows.find((r) => r.id === "d")!.canApprove && vmT.rows.find((r) => r.id === "d")!.suggestion === null, "ui vm: a suggestion with nothing to file under can't be approved");
  ok(vmT.isAdmin && vmT.noiseShownIds.length === 0, "ui vm: admin flag passes through; no Noise ids on To file");
  const vmN = buildOrganizeVM(threads, { tab: "noise", now: NOW, customerName: names });
  ok(vmN.rows.map((r) => r.id).join(",") === "n,f,e" && vmN.rows[0].reason === "Newsletter" && vmN.rows[1].reason === "No-reply sender" && vmN.rows[2].reason === "Promotions", "polish: Noise lists everything flagged as noise (moved and tagged-only), newest first, each with its reason; rescued left out");
  ok(vmN.noiseShownIds.join(",") === "n,f,e" && vmN.strongIds.length === 0 && !vmN.isAdmin, "Jeff 10-15 #29: Archive all shown takes every Noise row shown — still in the inbox or already archived");
  const vmF = buildOrganizeVM(threads, { tab: "filed", now: NOW, customerName: names });
  ok(vmF.rows.map((r) => r.id).join(",") === "i,g" && vmF.rows[0].filedBy === "approved" && vmF.rows[1].filedBy === "on reply" && !!vmF.rows[0].filedWhen, "ui vm: Filed lists the last 14 days, newest filing first, with how it was filed");
  const many = Array.from({ length: 205 }, (_, i) => th(`m${i}`, { filing: fil({ state: "filed", filedAt: NOW - i * 1000 }) }));
  const vmCap = buildOrganizeVM(many, { tab: "filed", now: NOW, customerName: names });
  ok(vmCap.rows.length === 200 && vmCap.counts.filed === 205, "ui vm: Filed is capped at 200 rows (the count stays true)");

  /* pure: the reader strip */
  const org = (o: Partial<CommThread>, task: { id: string; title: string; dueAt: number | null; status: string } | null = null, isAdmin = false) =>
    buildReaderOrg(th("r", o), { now: NOW, customerName: names, teammateName: (id) => (id === "u-dana" ? "Dana" : null), task, isAdmin });
  ok(org({}) === null, "ui reader: a thread the pipeline never touched has no strip");
  const c1 = org({ court: { owner: "me", reason: "Customer wrote last", source: "rule", at: NOW } })!;
  ok(c1.court?.label === "On you: Customer wrote last" && !c1.court.override && c1.filing === null && c1.noise === null && c1.promise === null, "ui reader: court me → On you: <reason>");
  ok(org({ court: { owner: "teammate", teammateId: "u-dana", reason: "x", source: "ai", at: NOW } })!.court?.label === "On Dana", "ui reader: a teammate court names the teammate");
  const ov = org({ court: { owner: "me", reason: "On you — set by Ann", source: "override", at: NOW } })!;
  ok(ov.court?.label === "On you" && ov.court.override, "ui reader: an override court reads plainly On you");
  ok(org({ noise: { flagged: true, reason: "Newsletter", moved: false } })!.noise?.moved === false && org({ noise: { flagged: false, reason: "", moved: false, rescued: true } }) === null, "ui reader: the Looks like noise tag (not moved); a rescued thread has none");
  const due = Date.UTC(2026, 9, 15, 22, 0); // Thu 15 Oct, 5 pm Chicago
  const pr = org({ court: { owner: "customer", reason: "x", source: "rule", at: NOW, promise: { text: "send the drawings", ownerUserId: "u1", due, taskId: "T-prm-1", messageId: "m1" } } }, { id: "T-prm-1", title: "Send the drawings", dueAt: due, status: "todo" })!;
  ok(pr.promise?.title === "Send the drawings" && pr.promise.due === "due Thu" && pr.promise.open, "ui reader: Task created … · due Thu for the court's open promise-task");
  ok(org({ court: { owner: "customer", reason: "x", source: "rule", at: NOW, promise: { text: "t", ownerUserId: "u1", due, taskId: "T-prm-1", messageId: "m1" } } }, null)!.promise === null, "ui reader: a removed promise-task shows no line");
  ok(org({ court: { owner: "customer", reason: "x", source: "rule", at: NOW, promise: { text: "t", ownerUserId: "u1", due, taskId: "T-prm-1", messageId: "m1" } } }, { id: "T-prm-1", title: "t", dueAt: due, status: "done" })!.promise?.open === false, "ui reader: a done promise-task is not open (no composer checkbox)");
  const fs = org({ filing: fil({ work: { type: "quote", id: "Q-1", label: "EST-1042 Main curtain" } }) }, null, true)!;
  ok(fs.filing?.state === "suggested" && fs.filing.suggestion === "Lincoln HS → EST-1042 Main curtain" && fs.filing.canApprove && fs.isAdmin, "ui reader: a suggested filing line can be approved");
  ok(org({ filing: fil({ state: "filed", filedBy: "teammate-reply" }) })!.filing?.filedBy === "teammate reply", "ui reader: a filed line says how it was filed");
  ok(dueLabel(NOW - DAY, NOW)?.startsWith("overdue ") === true && dueLabel(NOW + 20 * DAY, NOW) === "due Nov 2" && dueLabel(null, NOW) === null, "ui reader: due labels — overdue, a date beyond the week, none");

  /* db: Change…'s customer records (the AI candidate reads) */
  const CUST = fixtureId(335, "ui-cust");
  await createFixture("quotes", { id: fixtureId(335, "ui-q-sent"), name: "Main curtain", customer: "UI School", customerId: CUST, quoteType: "system", status: "sent", updatedAt: NOW - 10 });
  await createFixture("quotes", { id: fixtureId(335, "ui-q-draft"), name: "Rigging", customer: "UI School", customerId: CUST, quoteType: "system", status: "draft", updatedAt: NOW - 5 });
  await createFixture("quotes", { id: fixtureId(335, "ui-q-won"), name: "Old job", customer: "UI School", customerId: CUST, quoteType: "system", status: "won", updatedAt: NOW });
  const recs = await customerRecordCandidates(CUST, "UI School");
  ok(recs.length === 2 && recs[0].id === fixtureId(335, "ui-q-draft") && recs.every((r) => r.type === "quote" && r.customerId === CUST && r.customerName === "UI School"), "ui db: customerRecordCandidates lists the customer's open quotes newest first (won left out)");
  ok((await customerRecordCandidates(CUST, "UI School", 1)).length === 1, "ui db: the record list honours its limit");
}

/* ---------- Task 7: 90-day cleanup, settings, report (spec §4, §5, §6, §8) ---------- */

function reportMathChecks(ok: Ok): void {
  const run = (o: Partial<AssistRun>): AssistRun =>
    ({ id: "r" + Math.random().toString(36).slice(2), feature: "file", step: null, ok: true, outcome: null, outcomeDetail: null, costUsd: 0.001, userId: "u", userName: "U", model: "claude-haiku-5-5", ...o }) as AssistRun;
  const runs: AssistRun[] = [
    run({ outcome: "accepted", outcomeDetail: { action: "approved" } }),
    run({ outcome: "accepted", outcomeDetail: { action: "noise" } }),
    run({ outcome: "edited", outcomeDetail: { action: "changed" } }),
    run({ outcome: "edited", outcomeDetail: { action: "rescued" } }),
    run({ outcome: "discarded", outcomeDetail: { action: "skipped" } }),
    run({ outcome: null, outcomeDetail: { autoFiled: "reply" } }), // auto-filed: outcome stays null
    run({ outcome: "accepted", outcomeDetail: { action: "approved", undone: true } }),
    run({ outcome: null }), // still waiting
    run({ ok: false }), // a failed call is no suggestion
    run({ feature: "promise", outcome: "discarded" }), // not a filing
  ];
  const e = (o: Partial<FilingLogEntry>): FilingLogEntry => ({ at: 1, threadId: "t", source: "number", strength: "strong", outcome: "suggested", ...o });
  const log: FilingLogEntry[] = [
    e({}), e({}), e({}), e({}), // 4 number suggestions
    e({ action: "approved", outcome: "filed" }),
    e({ action: "approved", outcome: "filed" }),
    e({ action: "changed", outcome: "filed" }),
    e({ action: "reply", outcome: "filed" }),
    e({ source: "noise-rule", noise: true }),
    e({ source: "noise-rule", noise: true }),
    e({ source: "noise-rule", noise: true, action: "noise", outcome: "dismissed" }), // approved as suggested
    e({ source: "noise-rule", noise: true, action: "rescued" }),
    e({ source: "identity", strength: "weak" }),
    e({ source: "identity", action: "noise", noise: false, outcome: "dismissed" }), // a filing marked noise = corrected
    e({ source: "identity", action: "skipped", outcome: "skipped" }),
    e({ source: "identity", action: "undone" }),
    e({ source: "rule", action: "rule", outcome: "filed" }),
    e({ source: "rule", action: "teammate-reply", outcome: "filed" }),
    e({ action: "court-override" }),
    e({ action: "court-override" }),
    e({ source: "ai", action: "approved" }), // AI is counted from its runs, never the log
  ];
  const tasks = [
    { id: "T-prm-a", createdAt: 1, deleted: false },
    { id: "T-prm-b", createdAt: 2, deleted: true },
    { id: "T-prm-c", createdAt: 3, deleted: false },
  ];
  const r = filingReport(runs, log, tasks);
  const by = (s: string) => r.bySource.find((x) => x.source === s)!;
  ok(r.bySource.map((x) => x.source).join(",") === "rule,identity,number,noise-rule,ai", "report: one row per filing source, in pipeline order");
  const ai = by("ai");
  ok(ai.suggested === 8 && ai.approved === 3 && ai.corrected === 1 && ai.rescued === 1 && ai.skipped === 1 && ai.undone === 1 && ai.autoFiled === 1, "report: AI rows from the file runs — ok runs only, outcomes mapped, rescue split from corrections, auto-filed apart (outcome null)");
  ok(ai.approvedPct === 50, "report: AI % approved as suggested = 3 ÷ (3 + 1 + 1 + 1) = 50%");
  const num = by("number");
  ok(num.suggested === 4 && num.approved === 2 && num.corrected === 1 && num.autoFiled === 1 && num.approvedPct === 66.7, "report: number rows from the log — 2 approved of 3 decided (66.7%); the reply filing is auto, not approved");
  const nz = by("noise-rule");
  ok(nz.suggested === 2 && nz.approved === 1 && nz.rescued === 1 && nz.approvedPct === 50, "report: Noise on a noise suggestion counts as approved; Not noise as a rescue");
  const id = by("identity");
  ok(id.suggested === 1 && id.corrected === 1 && id.skipped === 1 && id.undone === 1 && id.approved === 0 && id.approvedPct === 0, "report: Noise on a filing is a correction; skip and undo are counted");
  const rule = by("rule");
  ok(rule.autoFiled === 2 && rule.approvedPct === null, "report: sender-rule and teammate-reply filings are auto-filed; no decisions → no %");
  ok(r.totals.suggested === 15 && r.totals.approved === 6 && r.totals.corrected === 3 && r.totals.rescued === 2 && r.totals.skipped === 2 && r.totals.autoFiled === 4 && r.totals.undone === 2, "report: totals add the sources");
  ok(r.totals.approvedPct === 46.2, "report: overall % approved = 6 ÷ 13 = 46.2%");
  ok(r.courtOverrides === 2 && r.promiseTasks.created === 3 && r.promiseTasks.undone === 1, "report: court overrides from the log; promise-tasks created / undone (deleted)");
  const empty = filingReport([], [], []);
  ok(empty.totals.suggested === 0 && empty.totals.approvedPct === null && empty.promiseTasks.created === 0, "report: an empty month is all zeros, no %");
  // the existing per-feature / person / model tables keep working beside it
  const old = assistReport(runs, new Map());
  ok(old.runs === runs.length && old.byFeature.some((x) => x.key === "file (filing)") && old.byModel.length === 1, "report: the per-feature / person / model tables are unchanged");
}

function ruleListChecks(ok: Ok): void {
  const rules: SenderRule[] = [
    { id: "SR-1", scope: "user", userId: "u-a", match: { email: "pat@school.org" }, action: { type: "file", customerId: "co-1", work: { type: "quote", id: "Q-1", label: "EST-1042" } }, createdBy: "u-a", createdAt: 10 },
    { id: "SR-2", scope: "user", userId: "u-b", match: { domain: "vendor.com" }, action: { type: "noise" }, createdBy: "u-b", createdAt: 20 },
    { id: "SR-3", scope: "company", match: { domain: "news.com" }, action: { type: "noise" }, createdBy: "u-boss", createdAt: 30 },
    { id: "SR-4", scope: "user", userId: "u-a", match: { domain: "school.org" }, action: { type: "never-noise" }, createdBy: "u-a", createdAt: 40 },
  ];
  const names = { customer: (id: string) => (id === "co-1" ? "Lincoln HS" : null), user: (id: string) => (id === "u-boss" ? "Boss" : null) };
  const mine = senderRuleRows(rules, { scope: "mine", userId: "u-a" }, names);
  ok(mine.map((r) => r.id).join(",") === "SR-4,SR-1", "rules list: My sender rules are only my personal rules, newest first");
  ok(mine[1].match === "pat@school.org" && mine[1].action === "File under Lincoln HS → EST-1042" && mine[0].match === "@school.org" && mine[0].action === "Never noise", "rules list: match + action labels");
  const co = senderRuleRows(rules, { scope: "company" }, names);
  ok(co.length === 1 && co[0].id === "SR-3" && co[0].action === "Treat as noise" && co[0].createdBy === "Boss", "rules list: the company list holds only company-wide rules, with who made it");
}

export async function inboxOrgCleanupChecks(ok: Ok): Promise<void> {
  reportMathChecks(ok);
  ruleListChecks(ok);
  const read = (p: string) => readFileSync(p, "utf8");

  const CLEO = "TEST335 Cleo Cleanup";
  const CLEO_ID = "TEST335-u-cleo";
  const NOP = "TEST335 Nopa Cleanup";
  const NOP_ID = "TEST335-u-nopa";
  const users = [
    { id: CLEO_ID, name: CLEO, email: "cleo.t335@peaksystemsgroup.com", googleEmail: null },
    { id: NOP_ID, name: NOP, email: "nopa.t335@peaksystemsgroup.com", googleEmail: null },
  ];
  const env = { ANTHROPIC_API_KEY: "sk-test-not-real" };
  const allOn = { tasks: true, reply: true, estimate: true, file: true, promise: true, brief: true, ask: true };
  const pilot = buildOrgContext({ users, assist: { users: [CLEO_ID], features: allOn, capUsd: 200 }, env });
  const NOW = Date.UTC(2026, 9, 13, 15, 0); // Tue 13 Oct 2026, 10:00 Chicago
  const DAY = 86_400_000;
  const db = await getDb();
  const CUST = fixtureId(335, "cl-cust");
  const QUOTE = fixtureId(335, "cl-quote");
  let n = 0;
  const msg = (at: number, o: Partial<CommMessage> = {}): CommMessage =>
    ({ id: `cl${++n}`, at, direction: "in", channel: "email", author: "Pat", body: "Can you send the price?", fromEmail: "pat@cl-school.test", ...o }) as CommMessage;
  const mk = async (slug: string, o: Partial<CommThread>, user = CLEO): Promise<string> => {
    const id = fixtureId(335, "cl-" + slug);
    await createFixture("comms", {
      id, mailbox: "personal", mailboxUser: user, unread: true, archived: false, customerId: null, customer: "", contactName: "Pat",
      contactEmail: "pat@cl-school.test", cc: "", subject: "Hello", channel: "email", status: "waiting_us", assignedTo: "", link: null,
      messages: [msg(NOW - DAY)], createdAt: NOW - 200 * DAY, updatedAt: NOW - DAY, resolution: "unknown", ...o,
    } as unknown as CommThread);
    return id;
  };
  const get = async (id: string) => (await getDoc<CommThread>("comms", id))!;
  const tasksOn = async (threadId: string) => {
    const rows = await listDocsByField<TaskRecord>("tasks", "threadId", [threadId]);
    rows.forEach((t) => registerFixture("tasks", t.id));
    return rows;
  };
  const LIV = "TEST335 Liv Cleanup";
  const LIV_ID = "TEST335-u-liv";
  const BLOBS = [SENDER_RULES_BLOB, FILING_LOG_BLOB, CLEANUP_BLOB_PREFIX + CLEO_ID, CLEANUP_BLOB_PREFIX + NOP_ID, CLEANUP_BLOB_PREFIX + LIV_ID];
  const before = new Map<string, typeof blobs.$inferSelect | undefined>();
  for (const id of BLOBS) before.set(id, (await db.select().from(blobs).where(eq(blobs.id, id)).limit(1))[0]);
  try {
    await saveCompany({ id: CUST, name: "TEST335 Cleanup School", type: "school" });
    await createFixture("quotes", { id: QUOTE, name: "Stage curtain", customer: "TEST335 Cleanup School", customerId: CUST, estNo: 987750, quoteType: "system", status: "sent", updatedAt: NOW - DAY });
    invalidateOrgContext();

    // newest first: a (number), b (noise), g (a promise of mine), c (weak identity → AI)
    const a = await mk("number", { subject: "Re: EST-987750 pricing", messages: [msg(NOW - 1 * DAY)] });
    const b = await mk("noise", { contactEmail: "noreply@cl-letters.test", messages: [msg(NOW - 2 * DAY, { fromEmail: "noreply@cl-letters.test", author: "Letters", body: "Our October newsletter" })] });
    const g = await mk("promise", {
      contactEmail: "sam@cl-unknown.test",
      messages: [
        msg(NOW - 3 * DAY - 3_600_000, { fromEmail: "sam@cl-unknown.test", body: "Can you send the drawings?" }),
        msg(NOW - 3 * DAY, { direction: "out", fromEmail: "cleo.t335@peaksystemsgroup.com", to: "sam@cl-unknown.test", body: "I will send the drawings by Friday." }),
      ],
      status: "waiting_them",
    });
    const c = await mk("weak", { resolution: "suggested", suggestedCustomerId: CUST, messages: [msg(NOW - 4 * DAY)] });
    // not in the run
    const filed = await mk("filed", { messages: [msg(NOW - DAY / 2)] });
    await setOrg(filed, { filing: { customerId: CUST, work: null, noise: false, source: "identity", reason: "x", strength: "strong", needsReply: false, state: "filed", at: NOW - DAY, filedBy: "approved", filedAt: NOW - DAY } as Filing });
    const old = await mk("old", { messages: [msg(NOW - 120 * DAY)], updatedAt: NOW - 120 * DAY });
    const archived = await mk("archived", { archived: true, messages: [msg(NOW - DAY / 3)] });
    const other = await mk("other", { messages: [msg(NOW - DAY / 4)] }, NOP);

    const provider = routedProvider({
      file: JSON.stringify({ target: QUOTE, confidence: "strong", reason: "Asks about the stage curtain", needsReply: true }),
      promise: JSON.stringify({ owner: "customer", teammateId: "", reason: "fake", promises: [{ text: "send the drawings", ownerUserId: CLEO_ID, dueText: "Friday" }] }),
    });
    const me = { id: CLEO_ID, name: CLEO };

    /* pilot only */
    const refused = await runCleanupBatch({ id: NOP_ID, name: NOP }, 40_000, { ctx: pilot, now: NOW, run: { provider } });
    ok(!refused.ok && /pilot/i.test(refused.error), "cleanup: a non-pilot user is refused (pilot only)");
    ok((await getCleanupState(NOP_ID)) === null, "cleanup: a refused run writes no state");

    /* batch 1: two threads, then stop */
    const r1 = await runCleanupBatch(me, 40_000, { ctx: pilot, now: NOW, run: { provider }, batchSize: 2 });
    const s1 = await getCleanupState(CLEO_ID);
    ok(s1?.ruleSuggestions?.number === 1 && s1.ruleSuggestions["noise-rule"] === 1, "fix: the cleanup counts its rule suggestions in the state, by source");
    const cs = await cleanupRuleSuggestions((t) => t === NOW);
    ok(cs.number === 1 && cs["noise-rule"] === 1 && Object.keys(await cleanupRuleSuggestions(() => false)).length === 0, "report: cleanupRuleSuggestions sums the state blobs of runs started in the window, by source");
    ok(!(await getFilingLog()).some((e) => (e.threadId === a || e.threadId === b) && !e.action), "fix: … and writes no mass \"suggested\" entries to the capped filing log");
    ok(r1.ok && r1.checked === 2 && r1.total === 4 && !r1.done && r1.summary === null, "cleanup: batch 1 checks 2 of 4 and is not done");
    ok(!!s1 && s1.cursor === 2 && s1.checked === 2 && s1.total === 4 && !s1.done && s1.startedAt === NOW && !s1.runningUntil, "cleanup: the cursor and counts are saved in inbox_cleanup:<userId> (lease released)");
    ok(s1!.ids.join(",") === [a, b, g, c].join(","), "cleanup: the run covers my inbox threads from the last 90 days, newest first — filed, older, archived and other people's threads left out");
    ok(cleanupProgressText(s1!.checked, s1!.total) === "2 of 4 checked", "cleanup: progress reads \"2 of 4 checked\"");
    const a1 = await get(a);
    ok(a1.filing?.source === "number" && a1.filing.state === "suggested" && a1.filing.strength === "strong" && a1.filing.work?.id === QUOTE, "cleanup: a record number becomes a strong suggestion");
    ok(!a1.customerId && !a1.link && !a1.archived, "cleanup: … only a suggestion — nothing linked, not archived");
    const b1 = await get(b);
    ok(b1.noise?.flagged === true && b1.noise.moved === true && b1.archived === true, "cleanup: a pilot user's noise moves to the Noise tab (the only archive)");
    ok(!(await get(c)).filing && !(await get(g)).filing, "cleanup: threads past the cursor are untouched after batch 1");

    /* batch 2: resumes at the cursor and finishes; the AI filing step runs in the budget */
    const r2 = await runCleanupBatch(me, 40_000, { ctx: pilot, now: NOW, run: { provider } });
    const s2 = await getCleanupState(CLEO_ID);
    ok(r2.ok && r2.done && r2.checked === 4 && r2.total === 4 && s2!.cursor === 4 && s2!.done && s2!.startedAt === NOW, "cleanup: batch 2 resumes at the cursor and finishes the same run (4 of 4)");
    const c2 = await get(c);
    ok(r2.ok && r2.aiCalls >= 1 && c2.filing?.source === "ai" && c2.filing.state === "suggested" && c2.filing.work?.id === QUOTE && !c2.filing.pendingAi, "cleanup: the weak guess goes to the AI filing step inside the batch — still only suggested");
    ok(!c2.customerId && !c2.link && !c2.archived, "cleanup: the AI suggestion links and archives nothing");
    const g2 = await get(g);
    ok(!g2.court?.pendingAi && !g2.court?.promise && !g2.court?.promisesFor && g2.court?.owner === "customer", "cleanup: backlog runs the court rules only — no AI court reading, no promise");
    let taskCount = 0;
    for (const id of [a, b, c, g]) taskCount += (await tasksOn(id)).length;
    ok(taskCount === 0, "cleanup: no tasks are made (even with a promise in the mail and a model that reads one)");
    ok(r2.ok && !!r2.summary && r2.summary.suggested === 2 && r2.summary.noise === 1 && r2.summary.skipped === 1 && r2.summary.waitingAi === 0, "cleanup: the final summary — 2 suggested · 1 noise · 1 skipped");
    ok(r2.ok && cleanupSummaryText(r2.summary!) === "Done: 2 suggested · 1 noise · 1 skipped" && cleanupSummaryText({ suggested: 1, noise: 0, skipped: 0, waitingAi: 3 }).endsWith("· 3 still with AI"), "cleanup: the summary line");
    const vm = cleanupVMOf(s2);
    ok(!!vm && vm.done && vm.checked === 4 && !!vm.summary && !("ids" in vm), "cleanup: the header VM carries progress + summary, not the id list");
    ok((await get(filed)).filing?.state === "filed" && !(await get(old)).filing && !(await get(archived)).filing && !(await get(other)).filing, "cleanup: threads outside the run are untouched");

    /* re-runnable: a finished run starts over; filed / already-suggested stay as they were */
    const r3 = await runCleanupBatch(me, 40_000, { ctx: pilot, now: NOW + 60_000, run: { provider } });
    const s3 = await getCleanupState(CLEO_ID);
    ok(r3.ok && r3.done && r3.total === 3 && s3!.startedAt === NOW + 60_000, "cleanup: pressing it again starts a new run (the moved noise is out of the inbox now)");
    ok((await get(a)).filing?.state === "suggested" && (await get(c)).filing?.source === "ai" && r3.ok && r3.summary?.suggested === 2, "cleanup: a re-run keeps the earlier suggestions");
    taskCount = 0;
    for (const id of [a, b, c, g]) taskCount += (await tasksOn(id)).length;
    ok(taskCount === 0, "cleanup: a re-run makes no tasks either");

    /* a batch already running is refused (double click / a second tab) */
    await setBlob(CLEANUP_BLOB_PREFIX + CLEO_ID, { done: false, runningUntil: Date.now() + 60_000 });
    const busy = await runCleanupBatch(me, 40_000, { ctx: pilot, now: NOW + 120_000, run: { provider } });
    ok(!busy.ok && /already running/.test(busy.error), "cleanup: a second batch while one runs is refused");

    /* fix: a live court still waiting for its AI reading survives a cleanup batch */
    const livCtx = buildOrgContext({
      users: [...users, { id: LIV_ID, name: LIV, email: "liv.t335@peaksystemsgroup.com", googleEmail: null }],
      assist: { users: [CLEO_ID, LIV_ID], features: allOn, capUsd: 200 },
      env,
    });
    const live = await mk(
      "live-court",
      {
        contactEmail: "sam@cl-liv.test",
        messages: [
          msg(NOW - DAY - 3_600_000, { fromEmail: "sam@cl-liv.test", body: "Can you send the drawings?" }),
          msg(NOW - DAY, { direction: "out", fromEmail: "liv.t335@peaksystemsgroup.com", to: "sam@cl-liv.test", body: "I will send the drawings by Friday." }),
        ],
        status: "waiting_them",
      },
      LIV
    );
    await organizeThread(live, { ctx: livCtx, now: NOW }); // the live sync
    const pendingBefore = (await get(live)).court;
    ok(pendingBefore?.pendingAi === true, "fix: (setup) the live sync left the court pendingAi");
    const livProvider = routedProvider({
      file: JSON.stringify({ target: "none", confidence: "weak", reason: "x", needsReply: false }),
      promise: JSON.stringify({ owner: "customer", teammateId: "", reason: "fake", promises: [{ text: "send the drawings", ownerUserId: LIV_ID, dueText: "Friday" }] }),
    });
    const rl = await runCleanupBatch({ id: LIV_ID, name: LIV }, 40_000, { ctx: livCtx, now: NOW, run: { provider: livProvider } });
    const afterCleanup = (await get(live)).court;
    ok(rl.ok && rl.done && afterCleanup?.pendingAi === true && afterCleanup.basis === pendingBefore!.basis && sortedJson(afterCleanup) === sortedJson(pendingBefore), "fix: a cleanup batch keeps a live court exactly as it was — still pendingAi");
    ok((await tasksOn(live)).length === 0, "fix: … and the cleanup itself makes no task");
    const livePass = await runAiPass({ ownerIds: [LIV_ID] }, { ctx: livCtx, run: { provider: livProvider }, now: NOW });
    const liveTasks = await tasksOn(live);
    const afterPass = (await get(live)).court;
    ok(livePass.tasks === 1 && liveTasks.length === 1 && liveTasks[0].id.startsWith("T-prm-") && afterPass?.promise?.taskId === liveTasks[0].id && !afterPass.pendingAi, "fix: the next normal pass reads the court and makes the promise-task");

    /* fix: filing a thread clears its noise flag (not in Filed AND Noise) */
    const noisy = await mk("noisy-filed", { messages: [msg(NOW - DAY / 5)] });
    await setOrg(noisy, {
      filing: { customerId: CUST, work: null, noise: false, source: "identity", reason: "Known contact", strength: "strong", needsReply: false, state: "suggested", at: NOW } as Filing,
      noise: { flagged: true, reason: "Newsletter", moved: false },
    });
    const ap = await approveFiling(noisy, { id: CLEO_ID, name: CLEO, roles: ["Estimator"] }, NOW);
    const nf = await get(noisy);
    ok(ap.ok && nf.filing?.state === "filed" && !nf.noise?.flagged && !isNoiseRow(nf), "fix: filing a noise-tagged thread clears the noise flag — it leaves the Noise tab");

    /* the AI pass's filing-only mode */
    const pass = read("src/lib/inbox-org/ai-pass.ts");
    ok(pass.includes("const courtRows = opts.filingOnly ? [] :") && pass.includes("&& !st.filingOnly) {"), "cleanup: runAiPass({ filingOnly }) reads no court (no promise-tasks)");
    const cl = read("src/lib/inbox-org/cleanup.ts");
    ok(cl.includes("organizeThread(id, { ctx, backlog: true, log, now })") && cl.includes("filingOnly: true") && cl.includes("deadlineMs: started + budgetMs"), "cleanup: organizes as backlog and calls the deadline-aware AI pass, filing only");

    /* the Organize header button (pilot only) + the action */
    const oa = read("src/app/(app)/inbox/organize-actions.ts");
    ok(oa.includes("export async function organizeInboxAction()") && oa.includes("runCleanupBatch({ id: me.id, name: me.name })"), "cleanup: organizeInboxAction runs one batch for the signed-in user");
    const page = read("src/app/(app)/inbox/page.tsx");
    ok(page.includes("const cleanup = assistAll.file ?") && page.includes("cleanup={cleanup}"), "cleanup: the button is passed only for Assist pilot users (feature file)");
    const box = read("src/app/(app)/inbox/organize/organize-box.tsx");
    ok(box.includes("<CleanupButton cleanup={cleanup.state} prompt={cleanupPrompt} />"), "cleanup: Organize my inbox sits in the Organize header");
    const btn = read("src/app/(app)/inbox/organize/cleanup-button.tsx");
    ok(btn.includes("await organizeInboxAction()") && btn.includes("if (r.done)") && btn.includes("r.checked === lastChecked") && btn.includes("cleanupProgressText("), "cleanup: the button loops the batch until done (stops when a batch makes no progress)");
  } finally {
    for (const id of BLOBS) {
      const row = before.get(id);
      if (row) await db.update(blobs).set({ data: row.data, updatedAt: row.updatedAt }).where(eq(blobs.id, id));
      else await db.delete(blobs).where(eq(blobs.id, id));
    }
    await db.delete(companies).where(eq(companies.id, CUST));
    invalidateOrgContext();
  }

  /* account: keep-in-inbox toggle persists */
  const KEEP_USER = "TEST335 Keeper";
  try {
    ok((await keepInInbox(KEEP_USER)) === false, "account: Keep threads in my inbox is off by default");
    await setKeepInInbox(KEEP_USER, true);
    ok((await keepInInbox(KEEP_USER)) === true, "account: turning it on persists");
    await setKeepInInbox(KEEP_USER, false);
    ok((await keepInInbox(KEEP_USER)) === false, "account: turning it off persists");
  } finally {
    await db.delete(notifPrefs).where(eq(notifPrefs.userName, KEEP_USER));
  }
  const acts = read("src/app/(app)/account/actions.ts");
  ok(/export async function setKeepInInboxAction\(on: boolean\)[\s\S]*?requireUser\(\)[\s\S]*?setKeepInInbox\(me\.name, on === true\)/.test(acts), "account: setKeepInInboxAction writes the signed-in user's own flag");
  const acct = read("src/app/(app)/account/page.tsx");
  ok(acct.includes("<InboxOrgCard keepInInbox={keepInbox} rules={mySenderRules} />") && acct.includes('loadSenderRuleRows({ scope: "mine", userId: user.id })'), "account: the page shows the toggle and My sender rules");

  /* rules list delete is authorized */
  const rulesBefore = (await db.select().from(blobs).where(eq(blobs.id, SENDER_RULES_BLOB)).limit(1))[0];
  try {
    const mine = await addSenderRule({ scope: "user", userId: "TEST335-u-del-a", match: { email: "x@del.test" }, action: { type: "noise" }, createdBy: "TEST335-u-del-a" });
    const theirs = await addSenderRule({ scope: "user", userId: "TEST335-u-del-b", match: { email: "y@del.test" }, action: { type: "noise" }, createdBy: "TEST335-u-del-b" });
    const company = await addSenderRule({ scope: "company", match: { domain: "del.test" }, action: { type: "noise" }, createdBy: "TEST335-u-boss" });
    ok(!(await removeSenderRule(theirs!.id, { userId: "TEST335-u-del-a", admin: false })), "rules delete: My sender rules can't delete someone else's rule");
    ok(!(await removeSenderRule(company!.id, { userId: "TEST335-u-del-a", admin: false })), "rules delete: … nor a company-wide rule");
    ok(await removeSenderRule(mine!.id, { userId: "TEST335-u-del-a", admin: false }), "rules delete: my own rule deletes");
    ok(await removeSenderRule(company!.id, { userId: "TEST335-u-boss", admin: true }), "rules delete: an admin deletes a company-wide rule");
    const left = (await getSenderRules()).map((r) => r.id);
    ok(!left.includes(mine!.id) && !left.includes(company!.id) && left.includes(theirs!.id), "rules delete: only the deleted rules are gone");
  } finally {
    if (rulesBefore) await db.update(blobs).set({ data: rulesBefore.data, updatedAt: rulesBefore.updatedAt }).where(eq(blobs.id, SENDER_RULES_BLOB));
    else await db.delete(blobs).where(eq(blobs.id, SENDER_RULES_BLOB));
  }
  ok(/export async function removeMySenderRuleAction[\s\S]*?requireUser\(\)[\s\S]*?removeSenderRule\(ruleId, \{ userId: me\.id, admin: false \}\)[\s\S]*?invalidateOrgContext\(\)/.test(acts), "rules delete: the account action deletes only my own rules (admin: false) and drops the cached context");
  const sa = read("src/app/(app)/settings/actions.ts");
  ok(/export async function removeCompanySenderRuleAction[\s\S]*?requirePerm\("manage_users"\)[\s\S]*?removeSenderRule\(ruleId, \{ userId: me\.id, admin: true \}\)[\s\S]*?invalidateOrgContext\(\)/.test(sa), "rules delete: the company list's delete is admin-only and drops the cached context");
  ok(/export async function setOwnDomainOverrideAction[\s\S]*?requirePerm\("manage_users"\)[\s\S]*?setOwnDomainOverride\([\s\S]*?invalidateOrgContext\(\)/.test(sa), "settings: the own-domain override is admin-only and drops the cached context");
  ok(sa.includes("FREEMAIL_DOMAINS.has(") && /setOwnDomainOverrideAction[\s\S]*?FREEMAIL_DOMAINS\.has\([\s\S]*?is a public mail provider/.test(sa), "fix: the own-domain override refuses a public mail provider with a clear error");
  ok(/const \{ last4 \} = await saveAssistKey\(key, me\.name\);[\s\S]{0,120}invalidateOrgContext\(\);/.test(sa) && /await clearAssistKey\(\);\s*invalidateOrgContext\(\);/.test(sa), "fix: saving or clearing the Assist key drops the cached org context");
  ok(/await setKeepInInboxAction\(v\);\s*setNote\(null\);/.test(read("src/app/(app)/account/inbox-org-card.tsx")), "fix: the account switch clears its error note after a later successful save");
  ok(/not atomic[\s\S]{0,400}Harmless/.test(read("src/lib/inbox-org/cleanup.ts")), "fix: the cleanup lease says it isn't atomic and why that's harmless");
  ok(/export async function setAssistSettingsAction[\s\S]*?await mergeSettingsObject\("assistFeatures", featurePartial\);\s*\/\/[^\n]*\n\s*invalidateOrgContext\(\);/.test(sa), "settings: changing the pilot / feature switches drops the cached context");

  /* settings card */
  const card = read("src/app/(app)/settings/groups/assist-pilot.tsx");
  ok(card.includes('{ key: "file", label: "Inbox organization" }') && card.includes('{ key: "promise", label: "Promise tasks" }'), "settings: the pilot card gains the Inbox organization and Promise tasks switches");
  ok(card.includes("<AssistOrgSettings org={assist.org} run={run} />") && card.includes("<FilingReportTable report={assist.org.filing} cleanupSuggested={assist.org.cleanupSuggested} />"), "settings: the card shows the org settings and the filing report");
  const data = read("src/app/(app)/settings/assist-data.ts");
  ok(data.includes("filingReport(runs, log.filter((e) => inMonth(e.at)), tasks.filter((t) => inMonth(t.createdAt)))") && data.includes('loadSenderRuleRows({ scope: "company" })') && data.includes("ctx.ownDomains"), "settings: the card data loads the month's filing report, the company rules and the domains in effect");

  /* client-bundle rule for the new client files */
  const banned = /^@\/(db\b|lib\/stores\/|lib\/inbox-org\/(apply|pipeline|cleanup|ai-|court|due|noise|forward|numbers|sender-rules|internal|ids|signoff|rule-list-server)\b)|(^|\/)load$/;
  for (const f of [
    "src/app/(app)/inbox/organize/cleanup-button.tsx",
    "src/app/(app)/account/inbox-org-card.tsx",
    "src/app/(app)/settings/groups/assist-org.tsx",
    "src/app/(app)/settings/groups/assist-pilot.tsx",
  ]) {
    const src = read(f);
    const bad = valueImports(src).filter((p) => banned.test(p));
    ok(src.startsWith('"use client";') && bad.length === 0, `client: ${f.split("/").pop()} imports only actions, pure modules and types${bad.length ? ` (found ${bad.join(", ")})` : ""}`);
  }
  ok(valueImports(read("src/lib/inbox-org/rule-list.ts")).length === 0, "client: inbox-org/rule-list.ts is pure (no value imports)");
}

/* ---------- #345: Organize entry points + placeholder companies ---------- */

/** #345 — the Inbox's Organize entry points (tab row, banner) and the brief link: pure VM + pins. */
export async function inboxOrgEntryChecks(ok: Ok): Promise<void> {
  const E = await import("@/app/(app)/inbox/organize/entry");
  const read = (p: string) => readFileSync(p, "utf8");

  /* the VM: shown under the gate, hidden without it */
  const inbox = E.organizeEntryVM({ available: true, toFile: 3, strong: 1, noise: 7, where: { kind: "inbox" } });
  ok(
    !!inbox &&
      inbox.tabs.map((t) => `${t.label}:${t.count ?? "-"}:${t.active ? "on" : "off"}`).join(" ") === "Inbox:-:on Organize:3:off Noise:7:off",
    `entry #345: the tab row reads Inbox · Organize (3) · Noise (7), Inbox active (${inbox?.tabs.map((t) => t.label).join(" · ")})`
  );
  ok(
    !!inbox && inbox.tabs[0].href === "/inbox" && inbox.tabs[1].href === "/inbox?view=organize&tab=to-file" && inbox.tabs[2].href === "/inbox?view=organize&tab=noise",
    "entry #345: Inbox → /inbox, Organize → ?view=organize (To file), Noise → ?view=organize&tab=noise (the real tab param)"
  );
  ok(inbox?.banner?.text === "3 emails to file · 1 ready to approve" && inbox.banner.href === "/inbox?view=organize&tab=to-file" && inbox.banner.count === 3, `entry #345: the banner on the plain inbox counts what is to file, and how many are ready to approve (${inbox?.banner?.text})`);
  ok(E.organizeEntryVM({ available: false, toFile: 3, strong: 0, noise: 7, where: { kind: "inbox" } }) === null, "entry #345: without the gate (Organize unavailable) neither the tab row nor the banner renders");
  ok(E.organizeEntryVM({ available: true, toFile: 3, strong: 0, noise: 7, where: { kind: "other" } }) === null, "entry #345: no tab row on Sent / Drafts / other views");
  const inOrg = E.organizeEntryVM({ available: true, toFile: 3, strong: 0, noise: 7, where: { kind: "organize", tab: "to-file" } });
  ok(!!inOrg && inOrg.banner === null && inOrg.tabs[1].active && !inOrg.tabs[0].active, "entry #345: inside Organize the tab row shows (Organize active) and the banner doesn't");
  const inNoise = E.organizeEntryVM({ available: true, toFile: 3, strong: 0, noise: 7, where: { kind: "organize", tab: "noise" } });
  ok(!!inNoise && inNoise.tabs[2].active && !inNoise.tabs[1].active, "entry #345: on the Noise tab, Noise is active");
  ok(E.organizeEntryVM({ available: true, toFile: 3, strong: 0, noise: 0, where: { kind: "organize", tab: "filed" } })?.tabs[1].active === true, "entry #345: Filed counts as Organize");
  ok(E.organizeEntryVM({ available: true, toFile: 0, strong: 0, noise: 2, where: { kind: "inbox" } })?.banner === null, "entry #345: no banner with nothing to file (the tab row still shows)");
  ok(E.bannerText(1, 0) === "1 email to file" && E.bannerText(4, 0) === "4 emails to file" && E.bannerText(4, 2) === "4 emails to file · 2 ready to approve" && E.bannerText(2, 5) === "2 emails to file · 2 ready to approve", "entry #345: the banner says 'N emails to file' (it counts No match yet rows too, so it never claims they all have a suggestion) and adds '· S ready to approve' only for strong suggestions");
  ok(!/AI has filing suggestions|have filing suggestions/.test(read("src/app/(app)/inbox/organize/entry.ts").replace(/^\s*(\*|\/\/).*$/gm, "")), "entry #345: the old 'filing suggestions' wording is gone");
  ok(E.bannerShows(3, null) && !E.bannerShows(3, 3) && E.bannerShows(4, 3) && !E.bannerShows(2, 3) && !E.bannerShows(0, null), "entry #345: dismissed for the session — back only when the count grows");
  ok(E.parseDismissed("5") === 5 && E.parseDismissed(null) === null && E.parseDismissed("x") === null && E.parseDismissed("-1") === null && E.parseDismissed("") === null, "entry #345: an unreadable dismissal counts as never dismissed");

  /* wiring pins */
  const page = read("src/app/(app)/inbox/page.tsx");
  ok(
    page.includes("const organizeEntry = organizeEntryVM({") &&
      page.includes("available: !inboxOrgDisabled(),") &&
      page.includes("strong: organizeCounts.strong,") &&
      page.includes('!isView && box === "personal" && folder === "inbox"') &&
      page.includes("organizeEntry={organizeEntry}"),
    "entry #345: the Inbox page builds the entry VM (gate = the view's: everyone unless INBOX_ORG_DISABLED; banner counts To file + strong) and hands it to the shell"
  );
  ok(page.includes("organizeEntryCounts(user)") && page.includes("count: organizeCounts.toFile") && page.includes("return { toFile: 0, strong: 0, noise: 0 };"), "entry #345: one comms scan gives the To file, strong and Noise counts; the sidebar row keeps its To file count");
  ok(page.includes('cleanupPrompt={str(params.cleanup) === "1" && vm.tab === "to-file"}'), "entry #345: ?cleanup=1 (the brief's link) calls out Organize my inbox");
  const shell = read("src/app/(app)/inbox/inbox-shell.tsx");
  ok(
    shell.includes("top={organizeEntry ? <OrganizeEntryBar vm={organizeEntry} /> : null}") && shell.includes("{organize && organizeEntry ? <OrganizeEntryBar vm={organizeEntry} /> : null}"),
    "entry #345: the shell renders the bar at the top of the list column — over the thread list and over the Organize box"
  );
  ok(shell.includes('{ value: "organize", label: "Organize" }'), "entry #345: the narrow picker keeps its Organize option");
  ok(read("src/app/(app)/inbox/thread-list.tsx").includes("      {top}\n      {/* command bar"), "entry #345: the thread list puts the bar above the command bar");
  const bar = read("src/app/(app)/inbox/organize/entry-bar.tsx");
  ok(bar.startsWith('"use client";') && valueImports(bar).every((p) => p === "react" || p === "next/link" || p === "./entry"), "entry #345: entry-bar.tsx is a client component importing only react, next/link and the pure entry module");
  ok(/try \{\s*raw = window\.sessionStorage\.getItem\(BANNER_DISMISS_KEY\);\s*\} catch/.test(bar) && /try \{\s*window\.sessionStorage\.setItem\(BANNER_DISMISS_KEY/.test(bar), "entry #345: sessionStorage reads and writes are wrapped in try/catch");
  ok(bar.includes("dismissedAt !== undefined && bannerShows(") && bar.includes("data-organize-banner") && bar.includes("data-entry-tab"), "entry #345: the banner waits for the stored dismissal (no flash) and is marked for the browser check");
  const entrySrc = read("src/app/(app)/inbox/organize/entry.ts");
  const noComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
  const colors = noComments(bar + entrySrc).match(/#[0-9a-fA-F]{3,8}\b/g) || [];
  ok(entrySrc.includes("var(--accent)") && bar.includes("var(--accent)") && colors.every((c) => ["#5b616e", "#fff", "#e8eaee", "#000"].includes(c.toLowerCase())), `entry #345: the accent comes from --accent; only neutral greys are literal (${[...new Set(colors)].join(" ")})`);
  ok(valueImports(entrySrc).every((p) => p === "./format"), "entry #345: entry.ts is pure (imports only format.ts)");
  const cb = read("src/app/(app)/inbox/organize/cleanup-button.tsx");
  ok(cb.includes("const callOut = prompt && !pending && !line && !(cleanup?.done);") && !/useEffect\([^)]*go\(/.test(cb) && !cb.includes("autoFocus"), "entry #345: the called-out button never starts the 90-day run by itself");
}

/** #345 — placeholder companies ("UNKNOWN" …) are never filing targets. */
export async function inboxOrgPlaceholderChecks(ok: Ok): Promise<void> {
  const { isPlaceholderCompany, withoutPlaceholderCustomer, PLACEHOLDER_COMPANY_RE } = await import("@/lib/inbox-org/placeholder");
  const { rankLinkTargets } = await import("@/lib/inbox-link-targets");
  const { isPlaceholderCustomerLabel } = await import("@/lib/gmail/peak-labels");
  const { buildFilingCandidates } = await import("@/lib/inbox-org/ai-filing");

  /* the helper */
  const yes = ["UNKNOWN", "unknown", " Unknown ", "UKN", "TBD", "tbd", "N/A", "n/a"];
  const no = ["", "Unknown Labs", "Test Kitchen HS", "NAU", "TBD Productions", "none of the above", "Lincoln HS", "N//A", "U.N.K.", "NA", "na", "None", "TEST", "Test"];
  ok(yes.every(isPlaceholderCompany), `placeholder #345: ${yes.join(" / ")} are placeholders`);
  ok(no.every((n) => !isPlaceholderCompany(n)) && !isPlaceholderCompany(null) && !isPlaceholderCompany(undefined), `placeholder #345: real names (and blanks) are not (${no.filter(isPlaceholderCompany).join(", ")})`);
  ok(PLACEHOLDER_COMPANY_RE.source === "^(unknown|ukn|tbd|n\\/a)$" && PLACEHOLDER_COMPANY_RE.flags === "i", "placeholder #345: the one rule is /^(unknown|ukn|tbd|n\\/a)$/i on the trimmed name — 'N/A' needs its slash; NA / None / Test are real-sounding and left out (review)");
  const ph = (id: string) => id === "UNK";
  const base = { customerId: "UNK", work: null, siteId: "loc1", noise: false, strength: "strong" as "strong" | "weak", reason: "pat is a known contact at UNKNOWN" };
  const cleared = withoutPlaceholderCustomer(base, ph);
  ok(cleared.customerId === null && cleared.siteId === undefined && cleared.strength === "weak" && cleared.reason === "No match yet — choose a customer", "placeholder #345: a suggestion under a placeholder reads as 'No match yet' (venue dropped)");
  const withWork = withoutPlaceholderCustomer({ ...base, work: { type: "quote", id: "Q1" } }, ph);
  ok(withWork.customerId === null && !!withWork.work && withWork.strength === "strong", "placeholder #345: a work record on a placeholder customer stays (it is real)");
  const real = { ...base, customerId: "C1" };
  ok(withoutPlaceholderCustomer(real, ph) === real, "placeholder #345: a real customer's filing is returned untouched");

  /* the Link popup / Change… search (shared with the AI candidates) */
  const hits = rankLinkTargets("unknown", {
    companies: [
      { id: "c-unk", name: "UNKNOWN" },
      { id: "c-labs", name: "Unknown Labs" },
    ],
    sites: [
      { id: "loc-unk", companyId: "c-unk", name: "Unknown Hall" },
      { id: "loc-labs", companyId: "c-labs", name: "Unknown Labs Theater" },
    ],
    people: [
      { id: "p1", name: "Unknown Person", companyId: "c-unk", emails: [] },
      { id: "p2", name: "Unknown Labs Person", companyId: "c-labs", emails: [] },
      { id: "p3", name: "Unknown Freelancer", companyId: null, emails: [] },
    ],
  });
  ok(hits.companies.map((c) => c.id).join(",") === "c-labs", "placeholder #345: the Link popup's company search never offers a placeholder company");
  ok(hits.venues.map((v) => v.id).join(",") === "loc-labs", `placeholder #345 review 1: …nor a venue under one (${hits.venues.map((v) => v.id).join(",")})`);
  ok(hits.people.map((p) => p.id).sort().join(",") === "p2,p3" && !hits.people.some((p) => p.companyName === "UNKNOWN"), `placeholder #345 review 1: …nor a person parked under one (a person with no company still shows) (${hits.people.map((p) => p.id).join(",")})`);
  const lts = readFileSync("src/lib/inbox-link-targets.ts", "utf8");
  ok(lts.includes("const nameOf = new Map(real.map((c) => [c.id, c.name]));"), "placeholder #345 review 1: nameOf (the venue/person filter) is built from the real companies only");

  /* Gmail labels */
  ok(isPlaceholderCustomerLabel("Peak/Customers/UNKNOWN") && isPlaceholderCustomerLabel("Peak/Customers/TBD") && !isPlaceholderCustomerLabel("Peak/Customers/Lincoln HS") && !isPlaceholderCustomerLabel("Peak/Status/Waiting"), "placeholder #345: Peak/Customers/UNKNOWN is a placeholder label");
  const sync = readFileSync("src/lib/gmail/label-sync.ts", "utf8");
  ok(/const add = rawAdd\.filter\(\(n\) => \{\s*\/\/ #345[^\n]*\n\s*if \(isPlaceholderCustomerLabel\(n\)\) return false;/.test(sync), "placeholder #345: the label writer never creates or applies Peak/Customers/<placeholder> (an existing one is left alone — `remove` unchanged)");
  const interp = readFileSync("src/lib/gmail/label-interpret.ts", "utf8");
  ok(interp.includes('if (isPlaceholderCustomerLabel("Peak/Customers/" + cmd.name)) continue;'), "placeholder #345: a Peak/Customers/UNKNOWN label applied in Gmail links nothing");

  /* the pipeline, apply and the Organize read (DB) */
  const db = await getDb();
  const MO = "TEST345 Mo";
  const MO_ID = "TEST345-u-mo";
  const me = { id: MO_ID, name: MO };
  const ctx = buildOrgContext({ users: [{ id: MO_ID, name: MO, email: "mo.t345@peaksystemsgroup.com", googleEmail: null }] });
  const UNK = fixtureId(345, "co-unknown");
  const REAL = fixtureId(345, "co-real");
  const QUOTE = fixtureId(345, "quote-unk");
  const T0 = 1_760_100_000_000;
  let n = 0;
  const msg = (o: Partial<CommMessage>): CommMessage =>
    ({ id: `ph${++n}`, at: T0 + n * 60_000, direction: "in", channel: "email", author: "Pat", body: "Can you send the price?", fromEmail: "pat@ph345.test", ...o }) as CommMessage;
  const mk = async (slug: string, o: Partial<CommThread>): Promise<string> => {
    const id = fixtureId(345, "ph-" + slug);
    await createFixture("comms", {
      id, mailbox: "personal", mailboxUser: MO, unread: true, archived: false, customerId: null, customer: "", contactName: "Pat",
      contactEmail: "pat@ph345.test", cc: "", subject: "Hello", channel: "email", status: "waiting_us", assignedTo: "", link: null,
      messages: [msg({})], createdAt: T0, updatedAt: T0 + 5, resolution: "unknown", ...o,
    } as unknown as CommThread);
    return id;
  };
  const read = async (id: string) => (await getDoc<CommThread>("comms", id))!;
  try {
    await saveCompany({ id: UNK, name: "UNKNOWN", type: "other" });
    await saveCompany({ id: REAL, name: "TEST345 Real School", type: "school" });
    await createFixture("quotes", { id: QUOTE, name: "Stage drape", customer: "UNKNOWN", customerId: UNK, estNo: 987800, quoteType: "system", status: "sent" });

    const linked = await mk("linked", { customerId: UNK, customer: "UNKNOWN", resolution: "linked" });
    await organizeThread(linked, { ctx });
    const tl = await read(linked);
    ok(tl.filing?.customerId === null && tl.filing.state === "suggested" && tl.filing.reason === "No match yet — choose a customer", `placeholder #345 pipeline: a thread auto-linked to UNKNOWN gets no suggestion under it (${tl.filing?.customerId} · ${tl.filing?.reason})`);
    ok(tl.customerId === UNK, "placeholder #345 pipeline: the thread's own link and the company record are left alone");

    const guessed = await mk("guessed", { resolution: "suggested", suggestedCustomerId: UNK });
    await organizeThread(guessed, { ctx });
    ok((await read(guessed)).filing?.customerId === null, "placeholder #345 pipeline: a domain guess of UNKNOWN is skipped");

    const numbered = await mk("number", { subject: "Re: EST-987800 drape" });
    await organizeThread(numbered, { ctx });
    const tn = await read(numbered);
    ok(tn.filing?.work?.id === QUOTE && tn.filing.customerId === null && tn.filing.source === "number", "placeholder #345 pipeline: a record number keeps its quote but drops the placeholder customer");

    const ruled = buildOrgContext({
      users: [{ id: MO_ID, name: MO, email: "mo.t345@peaksystemsgroup.com", googleEmail: null }],
      senderRules: [{ id: "SR-345", scope: "user", userId: MO_ID, match: { email: "pat@ph345.test" }, action: { type: "file", customerId: UNK }, createdBy: MO_ID, createdAt: 1 }],
    });
    const ruleT = await mk("rule", {});
    await organizeThread(ruleT, { ctx: ruled });
    ok((await read(ruleT)).filing?.source !== "rule" && (await read(ruleT)).filing?.customerId === null, "placeholder #345 pipeline: a sender rule filing under UNKNOWN is read as no rule");

    /* AI candidates */
    const cand = await buildFilingCandidates(await read(linked), { email: "pat@ph345.test", name: "Pat", body: "Thanks\n\nPat Smith\nUNKNOWN\n555-0100" });
    ok(!cand.candidates.some((c) => c.id === UNK || c.customerId === UNK) && cand.matchedCustomerId === null, `placeholder #345 ai: the candidate list never offers UNKNOWN (${cand.candidates.map((c) => c.id).join(",") || "none"})`);
    const cand2 = await buildFilingCandidates({ ...(await read(linked)), customer: "TEST345 Real School" }, null);
    ok(cand2.candidates.some((c) => c.id === REAL) && !cand2.candidates.some((c) => c.id === UNK), "placeholder #345 ai: a real company named in the mail is still a candidate");

    /* an OLD suggestion under UNKNOWN (stored before #345) stops showing */
    const old = await mk("old", {});
    await setOrg(old, {
      filing: { customerId: UNK, work: null, noise: false, source: "identity", reason: "pat is a known contact at UNKNOWN", strength: "strong", needsReply: false, state: "suggested", at: T0 } as Filing,
    });
    const oldT = await read(old);
    const names = (id: string) => (id === UNK ? "UNKNOWN" : id === REAL ? "TEST345 Real School" : null);
    const vm = buildOrganizeVM([oldT], { tab: "to-file", now: T0 + 1000, customerName: names });
    const row = vm.rows[0];
    ok(vm.counts.toFile === 1 && !!row && row.suggestion === null && !row.canApprove && !row.strong && vm.strongIds.length === 0, `placeholder #345 read: a stored UNKNOWN suggestion shows as nothing suggested — no Approve, not in Approve all strong (${row?.suggestion})`);
    const rOrg = buildReaderOrg(oldT, { customerName: names, teammateName: () => null, task: null, isAdmin: false });
    ok(rOrg?.filing?.suggestion === null && rOrg.filing.canApprove === false, "placeholder #345 read: the reader strip doesn't offer it either");
    const refused = await approveFiling(old, me);
    ok(!refused.ok && (await read(old)).filing?.state === "suggested" && (await read(old)).customerId === null, "placeholder #345 apply: Approve refuses to file under UNKNOWN");
    const ch = await changeFiling(old, { customerId: UNK }, me);
    ok(!ch.ok && (await read(old)).customerId === null, "placeholder #345 apply: Change… to UNKNOWN is refused");
    await approveAllStrong("all-visible", me);
    const mine = await Promise.all([guessed, numbered, ruleT, old].map(read));
    ok((await read(old)).filing?.state === "suggested" && mine.every((t) => t.customerId !== UNK && !(t.filing?.state === "filed" && t.filing.customerId === UNK)), "placeholder #345 apply: Approve all strong never files under UNKNOWN (the old stored suggestion stays suggested, untouched)");
    const viaWork = await changeFiling(old, { work: { type: "quote", id: QUOTE } }, me);
    const vw = await read(old);
    ok(viaWork.ok && vw.link?.id === QUOTE && vw.customerId === null && vw.filing?.customerId === null, "placeholder #345 apply: filing under the quote alone links the quote, never its UNKNOWN customer");

    /* the Gmail contact matcher: a placeholder company is no company (#345 follow-up) */
    const { resolveSender } = await import("@/lib/gmail/resolve");
    const { resolveForThread, applyResolution, resweepThreads } = await import("@/lib/gmail/linking");
    const { resolveCustomerId } = await import("@/lib/stores/comms");
    const { withoutPlaceholderLink } = await import("@/lib/inbox-org/placeholder");
    const phSet = async (ids: string[]) => new Set(ids.filter((i) => i.startsWith("UNK")));
    const lk = (hit: { contactId: string; customerId: string } | { ambiguous: string[]; contacts?: Array<{ contactId: string; customerId: string }> } | null, owners: string[] = []) => ({
      contactByEmail: async () => hit,
      customersByDomain: async () => owners,
      placeholderIds: phSet,
    });
    const p1 = await resolveSender("pat@school.test", lk({ contactId: "ct1", customerId: "UNK" }));
    ok(p1.kind === "unknown" && p1.contactId === "ct1", `matcher #345: a contact parked under UNKNOWN resolves to the contact only, no customer (${JSON.stringify(p1)})`);
    const p2 = await resolveSender("pat@school.test", lk({ contactId: "ct1", customerId: "UNK" }, ["C1"]));
    ok(p2.kind === "linked" && p2.customerId === "C1" && p2.via === "domain", "matcher #345: …and the domain step may still find the real customer");
    const p3 = await resolveSender("pat@school.test", lk({ ambiguous: ["UNK", "C1"] }));
    ok(p3.kind === "linked" && p3.customerId === "C1" && p3.via === "contact", "matcher #345: an address on UNKNOWN and one real customer is that customer, not ambiguous");
    const p4 = await resolveSender("pat@school.test", lk(null, ["UNK"]));
    ok(p4.kind === "unknown" && !("contactId" in p4 && p4.contactId), "matcher #345: a domain claimed by UNKNOWN is no claim");
    const p5 = await resolveSender("pat@school.test", { contactByEmail: async () => ({ contactId: "ct1", customerId: "UNK" }), customersByDomain: async () => [] });
    ok(p5.kind === "linked" && p5.customerId === "UNK", "matcher #345: without a placeholder lookup the resolver is unchanged (pure default)");

    const CT = fixtureId(345, "ct-unknown");
    await saveContact({ id: CT, firstName: "Parked", lastName: "Person", homeCompanyId: UNK, title: "" });
    await setEmails(CT, [{ value: "parked.t345@ph345-school.test", label: "work", isPrimary: true }]);
    const live = await resolveForThread("parked.t345@ph345-school.test");
    ok(live.kind === "unknown" && live.contactId === CT, `matcher #345: resolveForThread — the real lookups skip UNKNOWN (${JSON.stringify(live)})`);
    const probe = { customerId: null, customer: "", resolution: "unknown", resolvedContactId: null, suggestedCustomerId: null, candidates: [] } as unknown as CommThread;
    await applyResolution(probe, live);
    ok(probe.customerId === null && probe.resolvedContactId === CT && probe.resolution === "unknown", "matcher #345: applyResolution stamps the contact, no customerId (new mail / stampResolutionOnCreate)");
    const sweepT = await mk("sweep", { contactName: "Parked Person", contactEmail: "parked.t345@ph345-school.test", messages: [msg({ fromEmail: "parked.t345@ph345-school.test" })] });
    await resweepThreads({ email: "parked.t345@ph345-school.test" }, { owner: { id: MO_ID, name: MO, nameUnique: true } });
    const swept = await read(sweepT);
    ok(swept.customerId === null && swept.resolvedContactId === CT && swept.resolution === "unknown", `matcher #345: resweepThreads links the contact, never UNKNOWN (${swept.customerId} · ${swept.resolvedContactId})`);
    ok((await resolveCustomerId(swept)) === null, "matcher #345: resolveCustomerId — the contact's UNKNOWN home company is no customer");
    const stamped = await mk("stamped", { customerId: UNK, customer: "UNKNOWN", resolution: "linked", resolvedContactId: CT, contactEmail: "parked.t345@ph345-school.test" });
    const st = await read(stamped);
    ok((await resolveCustomerId(st)) === null, "matcher #345: a thread already stamped with UNKNOWN resolves to no customer at read");
    ok(st.customerId === UNK, "matcher #345: the stored stamp is not rewritten");
    const view = withoutPlaceholderLink(st, (id) => id === UNK);
    ok(view.customerId === null && view.customer === "" && view.siteId === null && view.resolution === "unknown" && view !== st && st.customerId === UNK, "matcher #345: the reader's view of a stamped thread shows no customer link (a copy — stored data untouched)");
    const sugg = withoutPlaceholderLink({ customerId: null, resolution: "suggested" as "suggested" | "unknown", suggestedCustomerId: UNK, candidates: [{ customerId: UNK, name: "UNKNOWN" }, { customerId: REAL, name: "Real" }] }, (id) => id === UNK);
    ok(sugg.suggestedCustomerId === null && sugg.resolution === "unknown" && sugg.candidates?.length === 1, "matcher #345: a placeholder domain guess or candidate is dropped too");
    const realT = { customerId: REAL, customer: "Real", resolution: "linked" as const };
    ok(withoutPlaceholderLink(realT, (id) => id === UNK) === realT, "matcher #345: a real link is returned untouched");
    const pageSrc = readFileSync("src/app/(app)/inbox/page.tsx", "utf8");
    ok(pageSrc.includes("const sel = selRaw ? withoutPlaceholderLink(selRaw, (id) => isPlaceholderCompany(placeholderNames.get(id))) : null;"), "matcher #345: the Inbox reader reads the thread through withoutPlaceholderLink");

    /* review of #345 — items 1–5, 8, 9 */
    const { rememberAddress } = await import("@/lib/gmail/linking");
    const { claimDomain, customersForDomain } = await import("@/lib/gmail/domains");
    const { isPlaceholderCompanyId, placeholderCompanyIds, invalidatePlaceholderCompanies } = await import("@/lib/identity/companies");
    const { PLACEHOLDER_PICK_ERROR } = await import("@/lib/inbox-org/placeholder");
    const { contactByEmail } = await import("@/lib/identity/lookup");
    // 1 — the remember / claim writes refuse a placeholder (the actions answer PLACEHOLDER_PICK_ERROR)
    const remembered = await rememberAddress(UNK, "new.t345@ph345-claim.test", "New Person", null, { id: MO_ID, name: MO });
    ok(remembered === "" && (await contactByEmail("new.t345@ph345-claim.test")) === null, "placeholder #345 review 1: rememberAddress never saves an address on UNKNOWN");
    await claimDomain("ph345-claim.test", UNK, "manual", MO);
    await claimDomain("ph345-claim.test", UNK, "learned", MO);
    ok((await customersForDomain("ph345-claim.test")).length === 0, "placeholder #345 review 1: claimDomain (manual or learned) never claims a domain for UNKNOWN");
    const la = readFileSync("src/app/(app)/inbox/link-actions.ts", "utf8");
    const fnSrc = (name: string) => {
      const i = la.indexOf(`export async function ${name}(`);
      const j = la.indexOf("\nexport async function ", i + 1);
      return la.slice(i, j < 0 ? undefined : j);
    };
    ok(
      fnSrc("linkThreadToCustomerAction").includes("if (await isPlaceholderCompanyId(customerId)) return { ok: false, error: PLACEHOLDER_PICK_ERROR };") &&
        fnSrc("linkThreadToCustomerAction").indexOf("isPlaceholderCompanyId(customerId)") < fnSrc("linkThreadToCustomerAction").indexOf("rememberAddress("),
      "placeholder #345 review 1: linkThreadToCustomerAction refuses a placeholder before any link / remember / claim write"
    );
    ok(fnSrc("claimDomainAction").includes("return { ok: false, error: PLACEHOLDER_PICK_ERROR };"), "placeholder #345 review 1: claimDomainAction refuses a placeholder");
    ok(PLACEHOLDER_PICK_ERROR === "That's a placeholder company — pick the real one.", "placeholder #345 review 1: the refusal reads \"That's a placeholder company — pick the real one.\"");
    // 2 — a manual person link never auto-links a placeholder home company
    const lpa = readFileSync("src/app/(app)/inbox/link-popup-actions.ts", "utf8");
    ok(lpa.includes("if (on && c?.homeCompanyId && !(await isPlaceholderCompanyId(c.homeCompanyId)) && !(await resolveCustomerId(t))) {"), "placeholder #345 review 2: linking a person whose home company is UNKNOWN never auto-links UNKNOWN (and a stored UNKNOWN doesn't count as a company)");
    // 3 — setThreadSiteAction reads the customer placeholder-aware
    const site = fnSrc("setThreadSiteAction");
    ok(site.includes("const customerId = await resolveCustomerId(t);") && !site.includes("t.customerId || (await resolveCustomerId(t))") && site.includes("if (t.customerId !== customerId) await linkThread("), "placeholder #345 review 3: the venue action uses resolveCustomerId (a stored UNKNOWN neither blocks the real company nor offers UNKNOWN's venues)");
    const stampedAuto = await mk("site-auto", { customerId: UNK, customer: "UNKNOWN", resolution: "linked", contactEmail: "nobody.t345@ph345-none.test" });
    ok((await resolveCustomerId(await read(stampedAuto))) === null, "placeholder #345 review 3: resolveCustomerId — an automatic UNKNOWN link reads as no customer");
    const deliberate = await mk("site-deliberate", { customerId: UNK, customer: "UNKNOWN", resolution: "linked", linkedBy: "user" } as Partial<CommThread>);
    ok((await resolveCustomerId(await read(deliberate))) === UNK, "placeholder #345 review 5: a deliberate (linkedBy) UNKNOWN link is history and stands");
    ok(withoutPlaceholderLink(await read(deliberate), (id) => id === UNK).customerId === UNK, "placeholder #345 review 5: the reader keeps a deliberate UNKNOWN link (only automatic stamps are hidden)");
    // 4 — the new-contact prefill never offers a placeholder
    ok(
      lpa.includes("const owners = claimed.filter((id) => !phOwners.has(id));") &&
        lpa.includes("(await allCompanies()).filter((c) => !isPlaceholderCompany(c.name))") &&
        lpa.includes("companyId: homeOf(c),") &&
        lpa.includes("const companies = await getCompanies(homeIds.filter((id) => !placeholders.has(id)));"),
      "placeholder #345 review 4: the link panel's participants and new-contact prefill drop a placeholder domain owner, signature company and home company"
    );
    // 5 — a FILED row keeps its true history in Filed and the reader
    const filedT = await mk("filed", {});
    await setOrg(filedT, {
      filing: { customerId: UNK, work: null, noise: false, source: "identity", reason: "pat is a known contact at UNKNOWN", strength: "strong", needsReply: false, state: "filed", filedBy: "approved", filedAt: Date.now(), at: T0 } as Filing,
    });
    const fT = await read(filedT);
    const nm = (id: string) => (id === UNK ? "UNKNOWN" : null);
    const fvm = buildOrganizeVM([fT], { tab: "filed", now: Date.now(), customerName: nm });
    ok(fvm.rows[0]?.suggestion === "UNKNOWN", `placeholder #345 review 5: a row already filed under UNKNOWN shows it in the Filed tab (${fvm.rows[0]?.suggestion})`);
    ok(buildReaderOrg(fT, { customerName: nm, teammateName: () => null, task: null, isAdmin: false })?.filing?.suggestion === "UNKNOWN", "placeholder #345 review 5: …and in the reader strip");
    ok(withoutPlaceholderCustomer({ ...base, state: "filed" as const }, ph).customerId === "UNK" && withoutPlaceholderCustomer({ ...base, state: "suggested" as const }, ph).customerId === null, "placeholder #345 review 5: only a waiting (suggested) filing is transformed");
    // 8 — an ambiguous hit where every customer is a placeholder keeps the contact
    const TBD = fixtureId(345, "co-tbd");
    await saveCompany({ id: TBD, name: "TBD", type: "other" });
    const CT2 = fixtureId(345, "ct-tbd");
    await saveContact({ id: CT2, firstName: "Twice", lastName: "Parked", homeCompanyId: TBD, title: "" });
    await setEmails(CT2, [{ value: "parked.t345@ph345-school.test", label: "work", isPrimary: true }]);
    const both = await contactByEmail("parked.t345@ph345-school.test");
    ok(!!both && "ambiguous" in both && (both.contacts || []).length === 2, "placeholder #345 review 8: (setup) the address sits on contacts under UNKNOWN and TBD — ambiguous, with its contacts");
    const amb = await resolveForThread("parked.t345@ph345-school.test");
    ok(amb.kind === "unknown" && amb.contactId === CT2, `placeholder #345 review 8: every customer a placeholder → the contact is kept (newest), no customer (${JSON.stringify(amb)})`);
    const ambPure = await resolveSender("x@y.test", lk({ ambiguous: ["UNK", "UNK2"], contacts: [{ contactId: "c9", customerId: "UNK2" }, { contactId: "c8", customerId: "UNK" }] }));
    ok(ambPure.kind === "unknown" && ambPure.contactId === "c9", "placeholder #345 review 8: pure — the newest contact is kept when the lookup can't pick a real customer");
    const ambOne = await resolveSender("x@y.test", lk({ ambiguous: ["UNK", "C1"], contacts: [{ contactId: "c7", customerId: "C1" }, { contactId: "c8", customerId: "UNK" }] }));
    ok(ambOne.kind === "linked" && ambOne.customerId === "C1" && ambOne.contactId === "c7", "placeholder #345 review 8: one real customer left → linked to it, with its own contact");
    // 9 — the placeholder lookup is cached and invalidated by saveCompany
    ok((await isPlaceholderCompanyId(UNK)) && (await isPlaceholderCompanyId(TBD)) && !(await isPlaceholderCompanyId(REAL)), "placeholder #345 review 9: isPlaceholderCompanyId");
    await saveCompany({ id: TBD, name: "TEST345 Renamed Real", type: "other" });
    ok(!(await isPlaceholderCompanyId(TBD)) && (await placeholderCompanyIds([UNK, TBD, REAL, null])).size === 1, "placeholder #345 review 9: renaming through saveCompany drops the cached answer at once");
    invalidatePlaceholderCompanies();
    const comp = readFileSync("src/lib/identity/companies.ts", "utf8");
    ok(comp.includes("export const PLACEHOLDER_CACHE_MS = 60_000;") && /onConflictDoUpdate[\s\S]*?invalidatePlaceholderCompanies\(\);\s*\}/.test(comp), "placeholder #345 review 9: a 60 s per-process memo, invalidated on company save");
    await db.delete(contactEmails).where(eq(contactEmails.contactId, CT2));
    await db.delete(contacts).where(eq(contacts.id, CT2));
    await db.delete(companies).where(eq(companies.id, TBD));
    await db.delete(contactEmails).where(eq(contactEmails.contactId, CT));
    await db.delete(contacts).where(eq(contacts.id, CT));
  } finally {
    await dropFixtures(345);
    await db.delete(companies).where(eq(companies.id, UNK));
    await db.delete(companies).where(eq(companies.id, REAL));
    invalidateOrgContext();
  }
}

/* ---------- #346: Archive + Labels from the Organize view ---------- */

export async function inboxOrgArchiveLabelChecks(ok: Ok): Promise<void> {
  const { archiveFromOrganize, undoArchiveFromOrganize, isToFileRow, ORGANIZE_ARCHIVE_MAX } = await import("@/lib/inbox-org/apply");
  const { setCategory, CATEGORIES } = await import("@/lib/stores/comms");
  const { threadGmailLabels } = await import("@/app/(app)/inbox/row-labels");
  const { organizeArchiveTarget, organizeArchiveRemoves, organizeArchiveNote, ORGANIZE_ARCHIVED_EVENT } = await import("@/app/(app)/inbox/organize/format");
  const { isPlaceholderCompany } = await import("@/lib/inbox-org/placeholder");
  const src = (p: string) => readFileSync(p, "utf8");

  /* pure: where the selection goes, and what the reader's Archive does */
  const rows = [
    { id: "a", href: "/inbox?view=organize&tab=to-file&thread=a" },
    { id: "b", href: "/inbox?view=organize&tab=to-file&thread=b" },
  ];
  const ta = organizeArchiveTarget({ tab: "to-file", baseHref: ORGANIZE_BASE_HREF, rows }, "a");
  const tb = organizeArchiveTarget({ tab: "to-file", baseHref: ORGANIZE_BASE_HREF, rows }, "b");
  const tx = organizeArchiveTarget({ tab: "noise", baseHref: ORGANIZE_BASE_HREF, rows }, "zz");
  ok(ta.inList && ta.nextHref === rows[1].href && tb.nextHref === null && tb.closeHref === "/inbox?view=organize&tab=to-file", "archive #346: after an Archive the selection moves to the next row, else clears (the tab, nothing open)");
  ok(organizeArchiveRemoves(ta) && !organizeArchiveRemoves({ tab: "filed", inList: true }) && !organizeArchiveRemoves(tx) && !organizeArchiveRemoves(null), "archive #346: the reader's Archive leaves the list on To file / Noise only (Filed only archives; a thread not in the list toggles as in the Inbox)");
  ok(organizeArchiveNote("to-file", 1) === "Archived — it comes back on new mail" && organizeArchiveNote("filed", 2) === "Archived 2", "archive #346: the note says a skipped row comes back on new mail");

  /* pure: a cleared Noise row is off the Noise tab (and its counts) */
  const NOW = Date.now();
  const thv = (id: string, o: Partial<CommThread>): CommThread =>
    ({ id, mailbox: "personal", mailboxUser: "TEST346 Vm", status: "waiting_us", archived: true, deleted: false, subject: id, updatedAt: NOW, messages: [], ...o }) as unknown as CommThread;
  const nz = [thv("n1", { noise: { flagged: true, reason: "Promo", moved: true } }), thv("n2", { noise: { flagged: true, reason: "Promo", moved: true, cleared: true } })];
  const vmN = buildOrganizeVM(nz, { tab: "noise", now: NOW, customerName: () => null });
  ok(vmN.rows.map((r) => r.id).join(",") === "n1" && vmN.counts.noise === 1 && !isNoiseRow(nz[1]), "archive #346: a Noise row archived from Organize (cleared) is off the Noise tab and its count");

  /* pure: labels — the Inbox's categories; Gmail chips skip placeholder labels */
  const opts = [
    { id: "L1", name: "Peak/Customers/UNKNOWN", type: "user" as const, textColor: null, backgroundColor: null },
    { id: "L2", name: "Clients", type: "user" as const, textColor: null, backgroundColor: null },
    { id: "INBOX", name: "INBOX", type: "system" as const, textColor: null, backgroundColor: null },
  ];
  const msgs = [{ gmailLabelIds: ["L1", "L2", "INBOX"] }];
  ok(threadGmailLabels(msgs, opts, { skipPlaceholders: true }).map((l) => l.id).join(",") === "L2", "labels #346: the Labels card never shows a placeholder Peak/Customers label (or Gmail's routing labels)");
  ok(threadGmailLabels(msgs, opts).map((l) => l.id).join(",") === "L1,L2", "labels #346: the Inbox row keeps its chips as before (shared helper)");
  ok(CATEGORIES.length > 0 && CATEGORIES.every((c) => !isPlaceholderCompany(c.label) && !isPlaceholderCompany(c.key)), "labels #346: the labels offered are the Inbox's category presets — never a placeholder");

  /* db */
  const ME = "TEST346 Ann Archive";
  const me = { id: "TEST346-u-ann", name: ME, roles: ["Estimator"] };
  let n = 0;
  const T0 = Date.now() - 3_600_000;
  const msg = (o: Partial<CommMessage> = {}): CommMessage =>
    ({ id: `ar${++n}`, at: T0 + n * 60_000, direction: "in", channel: "email", author: "Pat", body: "Can you send the price?", fromEmail: "pat@archive-346.test", ...o }) as CommMessage;
  const mk = async (slug: string, o: Partial<CommThread> = {}): Promise<string> => {
    const id = fixtureId(346, "ar-" + slug);
    await createFixture("comms", {
      id, mailbox: "personal", mailboxUser: ME, unread: false, archived: false, customerId: null, customer: "", contactName: "Pat",
      contactEmail: "pat@archive-346.test", cc: "", subject: "Hello", channel: "email", status: "waiting_us", assignedTo: "", link: null,
      messages: [msg()], createdAt: T0, updatedAt: T0 + 5, resolution: "unknown", ...o,
    } as unknown as CommThread);
    return id;
  };
  const read = async (id: string) => (await getDoc<CommThread>("comms", id))!;
  const sugg = (o: Partial<Filing> = {}): Filing => ({ customerId: "TEST346-cust", work: null, noise: false, source: "identity", reason: "Known contact", strength: "weak", needsReply: true, state: "suggested", at: T0, ...o });
  const db = await getDb();
  const logBefore = (await db.select().from(blobs).where(eq(blobs.id, FILING_LOG_BLOB)).limit(1))[0];
  try {
    /* To file: archive = archive + skip; Undo puts back both */
    const tf = await mk("to-file");
    await setOrg(tf, { filing: sugg() });
    ok(isToFileRow(await read(tf)), "archive #346: (setup) a To file row");
    const r1 = await archiveFromOrganize(tf, "to-file", me);
    const a1 = await read(tf);
    ok(r1.ok && a1.archived === true && a1.filing?.state === "skipped" && !isToFileRow(a1), "archive #346: Archive from To file archives the thread and skips the suggestion (off the list)");
    ok(r1.ok && r1.undo.threadId === tf && r1.undo.unarchive && r1.undo.unskip && !r1.undo.unclear, "archive #346: …and hands back what it changed for Undo");
    ok((await getFilingLog()).some((e) => e.threadId === tf && e.action === "skipped"), "archive #346: logged like Skip (filing log 'skipped')");
    if (r1.ok) await undoArchiveFromOrganize(r1.undo, me);
    const u1 = await read(tf);
    ok(u1.archived === false && u1.filing?.state === "suggested" && isToFileRow(u1), "archive #346: Undo un-archives and returns the suggestion to To file");
    ok((await getFilingLog()).some((e) => e.threadId === tf && e.action === "undone"), "archive #346: Undo is logged like Undo");
    const r1b = await archiveFromOrganize(tf, "to-file", me);
    await addMessage(tf, { direction: "in", body: "Any update?" });
    await organizeThread(tf);
    ok(r1b.ok && (await read(tf)).filing?.state === "suggested", "archive #346: new outside mail brings an archived To file row's suggestion back (like Skip)");

    /* the AI outcome is recorded the way Skip records it */
    const ai = await mk("ai");
    const RUN = fixtureId(346, "ar-run");
    await upsertDoc("assist_runs" as never, { id: RUN, feature: "file", step: null, userId: me.id, userName: ME, provider: "fake", model: "m", requestedModel: "m", fellBack: false, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0, latencyMs: 0, inputHash: "h", output: "", ok: true, error: null, stopReason: null, contextRef: "thread:" + ai, monthKey: "2026-10", outcome: null, outcomeDetail: null, outcomeAt: null, createdAt: Date.now() - 1000 } as never);
    registerFixture("assist_runs" as never, RUN);
    await setOrg(ai, { filing: sugg({ source: "ai", runId: RUN, strength: "strong" }) });
    await archiveFromOrganize(ai, "to-file", me);
    ok((await getRun(RUN))?.outcome === "discarded" && (await getRun(RUN))?.outcomeDetail?.action === "skipped", "archive #346: an AI suggestion archived from To file sets the run's outcome 'discarded' (action skipped), as Skip does");

    /* Filed: archive only — the filing stays */
    const fd = await mk("filed");
    const filed = sugg({ state: "filed", filedBy: "approved", filedAt: NOW, customerId: "TEST346-cust" });
    await setOrg(fd, { filing: filed });
    const filedBefore = JSON.stringify((await read(fd)).filing);
    const r2 = await archiveFromOrganize(fd, "filed", me);
    const a2 = await read(fd);
    ok(r2.ok && a2.archived === true && JSON.stringify(a2.filing) === filedBefore && a2.filing?.state === "filed" && a2.filing.filedBy === "approved" && !r2.undo.unskip, "archive #346: Archive from Filed only archives — the filing is untouched");
    if (r2.ok) await undoArchiveFromOrganize(r2.undo, me);
    ok((await read(fd)).archived === false && (await read(fd)).filing?.state === "filed", "archive #346: Undo on Filed un-archives; still filed");

    /* Noise: tagged (in the inbox) and moved (already archived) */
    const nt = await mk("noise-tagged");
    await setOrg(nt, { filing: sugg({ noise: true, customerId: null, source: "noise-rule", strength: "strong" }), noise: { flagged: true, reason: "Promotions", moved: false } });
    ok(isNoiseRow(await read(nt)), "archive #346: (setup) a tagged Noise row");
    const r3 = await archiveFromOrganize(nt, "noise", me);
    const a3 = await read(nt);
    ok(r3.ok && a3.archived === true && a3.noise?.cleared === true && a3.filing?.state === "skipped" && !isNoiseRow(a3) && r3.undo.unclear && r3.undo.unskip, "archive #346: Archive from Noise archives, takes the row off Noise (cleared) and skips its suggestion");
    if (r3.ok) await undoArchiveFromOrganize(r3.undo, me);
    const u3 = await read(nt);
    ok(u3.archived === false && u3.noise?.cleared === undefined && u3.noise?.flagged === true && u3.filing?.state === "suggested" && isNoiseRow(u3), "archive #346: Undo puts the Noise row back (in the inbox, flagged, suggested)");
    const nm = await mk("noise-moved", { archived: true });
    const dismissed = sugg({ noise: true, customerId: null, state: "dismissed", source: "noise-rule", basis: (await read(nm)).messages[0].id });
    await setOrg(nm, { filing: dismissed, noise: { flagged: true, reason: "Marked as noise", moved: true } });
    const r4 = await archiveFromOrganize(nm, "noise", me);
    ok(r4.ok && !r4.undo.unarchive && !r4.undo.unskip && r4.undo.unclear && (await read(nm)).filing?.state === "dismissed" && !isNoiseRow(await read(nm)), "archive #346: a moved (already archived) Noise row is only cleared — still dismissed, nothing to un-archive");
    await organizeThread(nm);
    ok(!isNoiseRow(await read(nm)) && (await read(nm)).noise?.cleared === true, "archive #346 review: with no new mail the cleared (dismissed) row stays off Noise");
    await addMessage(nm, { direction: "in", body: "Actually — can you quote the stage drapes?" });
    await organizeThread(nm);
    const back = await read(nm);
    ok(isNoiseRow(back) && back.noise?.cleared === undefined && back.filing?.state === "dismissed", "archive #346 review: new outside mail on an archived, dismissed (marked-noise) row brings it back to the Noise tab (cleared dropped, still marked)");
    await setOrg(nm, { noise: { flagged: true, reason: "Marked as noise", moved: true, cleared: true } });
    await patchDoc<CommThread>("comms", nm, (d) => {
      d.archived = true;
      d.gmailInboxed = false;
    });
    await reinboxFromGmail(nm);
    const rein = await read(nm);
    ok(rein.archived === false && rein.gmailInboxed === true && !rein.noise?.flagged && !rein.noise?.cleared, "archive #346 review: a Gmail re-inbox (D898 — Gmail puts a new reply back in INBOX) brings an archived, dismissed row back to the Inbox (rescued)");

    /* Gmail had already archived it: Undo never re-inboxes */
    const ga = await mk("gmail-archived", { gmailInboxed: false });
    await setOrg(ga, { filing: sugg() });
    const r5 = await archiveFromOrganize(ga, "to-file", me);
    ok(r5.ok && !r5.undo.unarchive && r5.undo.unskip && (await read(ga)).archived === true, "archive #346 review: a thread Gmail had already archived (gmailInboxed false) counts as archived — nothing for Undo to un-archive");
    if (r5.ok) await undoArchiveFromOrganize(r5.undo, me);
    ok((await read(ga)).gmailInboxed === false && (await read(ga)).filing?.state === "suggested", "archive #346 review: …so Undo puts the suggestion back but never re-inboxes it in Gmail");

    /* compare-and-set: a filing rewritten meanwhile is never clobbered */
    const cs = await mk("cas");
    await setOrg(cs, { filing: sugg() });
    const fresh = sugg({ customerId: "TEST346-other", reason: "New mail", at: NOW + 5 });
    const { casOrg: realCas } = await import("@/lib/stores/comms");
    ok(!(await realCas(cs, "filing", sugg({ reason: "stale" }), { ...fresh, state: "skipped" })) && (await read(cs)).filing?.state === "suggested", "archive #346 review: (setup) casOrg refuses a stale expected filing");
    await setOrg(cs, { filing: fresh });
    const r6 = await archiveFromOrganize(cs, "to-file", me);
    const a6 = await read(cs);
    ok(r6.ok && a6.filing?.state === "skipped" && a6.filing.customerId === "TEST346-other" && a6.filing.reason === "New mail", "archive #346 review: skip writes over the filing as read now (compare-and-set), keeping what a concurrent write put there");
    const lose = await mk("cas-lose");
    await setOrg(lose, { filing: sugg() });
    let tries = 0;
    const rl = await archiveFromOrganize(lose, "to-file", me, Date.now(), { cas: async () => (tries++, false) });
    const al = await read(lose);
    ok(!rl.ok && rl.error === "conflict" && /Couldn.t update — try again/.test(rl.message) && tries === 3 && al.archived === false && al.filing?.state === "suggested", "archive #346 review 2: when the skip keeps losing (3 tries) Archive answers 'Couldn't update — try again' and archives nothing");
    const apSrc = readFileSync("src/lib/inbox-org/apply.ts", "utf8");
    ok(/if \(await cas\(t\.id, "filing", t\.filing, want\)\) return/.test(apSrc) && /cas: FilingCas = casOrg/.test(apSrc) && !/await setOrg\(t\.id, \{ filing: \{ \.\.\.settled\(f\), state: "skipped" \} \}\)/.test(apSrc.slice(apSrc.indexOf("export async function archiveFromOrganize("))), "archive #346 review: archive / undo write the filing only through casFiling (casOrg, re-read on conflict)");

    /* label: the Inbox's category action leaves the filing alone */
    const lb = await mk("label");
    await setOrg(lb, { filing: sugg() });
    const before = JSON.stringify((await read(lb)).filing);
    await setCategory(lb, "red");
    ok((await read(lb)).category === "red" && JSON.stringify((await read(lb)).filing) === before && isToFileRow(await read(lb)), "labels #346: applying a label sets the category and leaves the filing (still in To file)");
    await setCategory(lb, null);
    ok(!(await read(lb)).category && JSON.stringify((await read(lb)).filing) === before, "labels #346: removing it (✕) leaves the filing too");

    /* several at once: the action's loop over two rows */
    const b1 = await mk("bulk-1");
    const b2 = await mk("bulk-2");
    for (const id of [b1, b2]) await setOrg(id, { filing: sugg() });
    const rb = await Promise.all([b1, b2].map((id) => archiveFromOrganize(id, "to-file", me)));
    ok(rb.every((r) => r.ok) && (await read(b1)).filing?.state === "skipped" && (await read(b2)).archived === true, "archive #346: two rows archive and skip independently (bulk)");
    for (const id of [b1, b2]) await setCategory(id, "blue");
    ok((await read(b1)).category === "blue" && (await read(b2)).filing?.state === "skipped", "labels #346: a label on several rows (bulkCategoryAction's loop) leaves each filing alone");

    /* never a teammate's thread */
    const other = await mk("other", { mailboxUser: "TEST346 Ben Other" });
    await setOrg(other, { filing: sugg() });
    const ro = await archiveFromOrganize(other, "to-file", me);
    const ru = await undoArchiveFromOrganize({ threadId: other, unarchive: true, unskip: true, unclear: true }, me);
    ok(!ro.ok && ro.error === "not-found" && !ru.ok && (await read(other)).archived === false && (await read(other)).filing?.state === "suggested", "archive #346: someone else's thread is refused (Archive and Undo) and left untouched");
    const forged = await undoArchiveFromOrganize({ threadId: lb, unarchive: true, unskip: true, unclear: true }, me);
    ok(forged.ok && (await read(lb)).archived === false && (await read(lb)).filing?.state === "suggested", "archive #346: Undo reverses only what is still there (a never-archived thread is left as it is)");
    ok(ORGANIZE_ARCHIVE_MAX === 500, "archive #346: one Archive takes at most 500 threads");

    /* Jeff 2026-10-15 #29 — Noise "Archive all shown": every row shown, a row's own Archive each, one Undo */
    const ns1 = await mk("ns-tagged");
    await setOrg(ns1, { filing: sugg({ noise: true, customerId: null, source: "noise-rule", strength: "strong" }), noise: { flagged: true, reason: "Promotions", moved: false } });
    const ns2 = await mk("ns-moved", { archived: true });
    await setOrg(ns2, { filing: sugg({ noise: true, customerId: null, source: "noise-rule", strength: "strong" }), noise: { flagged: true, reason: "Newsletter", moved: true } });
    const ns3 = await mk("ns-dismissed", { archived: true });
    await setOrg(ns3, { filing: sugg({ noise: true, customerId: null, state: "dismissed", source: "noise-rule" }), noise: { flagged: true, reason: "Marked as noise", moved: true } });
    const nsIds = [ns1, ns2, ns3];
    const vmBefore = buildOrganizeVM(await Promise.all(nsIds.map(read)), { tab: "noise", now: Date.now(), customerName: () => null });
    ok(nsIds.every((x) => vmBefore.noiseShownIds.includes(x)), "Jeff 10-15 #29: (setup) Archive all shown carries every Noise row shown — in the inbox, moved and marked-noise");
    const batch = [];
    for (const x of vmBefore.noiseShownIds) batch.push(await archiveFromOrganize(x, "noise", me));
    const after = await Promise.all(nsIds.map(read));
    ok(batch.every((r) => r.ok) && after.every((t) => t.archived === true && t.noise?.cleared === true && !isNoiseRow(t)), "Jeff 10-15 #29: every row shown is archived AND cleared off the Noise tab");
    ok(buildOrganizeVM(after, { tab: "noise", now: Date.now(), customerName: () => null }).rows.length === 0, "Jeff 10-15 #29: after Archive all shown the Noise tab shows none of them");
    ok(after[2].filing?.state === "dismissed" && after[0].filing?.state === "skipped", "Jeff 10-15 #29: a marked-noise (dismissed) row keeps its filing; a suggested one is skipped — a row's own Archive, unchanged");
    const undos = batch.flatMap((r) => (r.ok ? [r.undo] : []));
    for (const u of undos) await undoArchiveFromOrganize(u, me);
    const undone = await Promise.all(nsIds.map(read));
    ok(undone.every((t) => isNoiseRow(t)) && undone[0].archived === false && undone[1].archived === true && undone[2].archived === true && undone[0].filing?.state === "suggested",
      "Jeff 10-15 #29: the batch's one Undo puts every row back on Noise — only the one that was in the inbox is re-inboxed");
  } finally {
    await dropFixtures(346);
    if (logBefore) await db.update(blobs).set({ data: logBefore.data, updatedAt: logBefore.updatedAt }).where(eq(blobs.id, FILING_LOG_BLOB));
    else await db.delete(blobs).where(eq(blobs.id, FILING_LOG_BLOB));
  }

  /* source pins: actions, reader, sidebar, Organize box */
  const oa = src("src/app/(app)/inbox/organize-actions.ts");
  ok(/export async function archiveFromOrganizeAction\(threadIds: string\[\], tab: string\)[\s\S]*?const me = await actor\(\);[\s\S]*?await archiveFromOrganize\(id, t, me\)[\s\S]*?revalidate\(\);/.test(oa), "archive #346: archiveFromOrganizeAction loops my own threads through archiveFromOrganize, then revalidates");
  ok(/export async function undoArchiveFromOrganizeAction\(list: OrganizeArchiveUndo\[\]\)[\s\S]*?await undoArchiveFromOrganize\([\s\S]*?u\.unarchive === true/.test(oa), "archive #346: the Undo action re-reads each flag as a strict boolean");
  const ap = src("src/lib/inbox-org/apply.ts");
  ok(/export async function archiveFromOrganize\([\s\S]*?const t = await myThread\(threadId, me\);\s*if \(!t\) return NOT_FOUND\(\);[\s\S]*?const wasArchived = !!t\.archived \|\| t\.gmailInboxed === false;\s*if \(!t\.archived\) await archive\(t\.id\);/.test(ap), "archive #346: archiveFromOrganize is owner-checked (myThread) and archives through comms.archive (Gmail follows)");
  const tr = src("src/app/(app)/inbox/thread-reader.tsx");
  ok(tr.includes("await archiveFromOrganizeAction([vm.id], org.tab);") && tr.includes("router.push(org.nextHref ?? org.closeHref)") && tr.includes("new CustomEvent(ORGANIZE_ARCHIVED_EVENT") && tr.includes('postChanged("thread", vm.id);'), "archive #346: the reader's bottom Archive, opened from Organize, archives through the Organize action, posts changed, tells the box (Undo) and moves to the next row");
  ok(/if \(vm\.archived\) await unarchiveAction\(vm\.id\);\s*else await archiveAction\(vm\.id\);/.test(tr), "archive #346: outside Organize the reader's Archive / Unarchive is the Inbox's own");
  const ob = src("src/app/(app)/inbox/organize/organize-box.tsx");
  ok(ob.includes(`window.addEventListener(ORGANIZE_ARCHIVED_EVENT, on)`) && ob.includes("undoArchiveFromOrganizeAction(undo)") && ob.includes("data-organize-undo") && ob.includes("data-organize-archive") && ob.includes("archiveFromOrganizeAction(ids, tab)"), "archive #346: the Organize box shows Archived … Undo (its own row Archive and the reader's) and each row has Archive");
  ok(/for \(const id of ids\) postChanged\("thread", id\);/.test(ob) && /for \(const u of undo\) postChanged\("thread", u\.threadId\);/.test(ob), "archive #346: Archive and Undo post changed for each thread");
  ok(ob.includes("approveAllStrongAction(vm.strongIds)"), "archive #346: Approve all strong is still there");
  ok(/try \{\s*const r = await archiveFromOrganize\(id, t, me\);\s*if \(r\.ok\) undo\.push\(r\.undo\);\s*else refused\+\+;\s*\} catch \(e\) \{[\s\S]{0,160}refused\+\+;\s*\}/.test(oa) && ob.includes("(r.refused ? ` · ${r.refused} couldn't be archived` : \"\")"),
    "#351 M7: a row that throws counts as refused — the rows that archived keep their Undo, and the note names the rest");
  ok(/const archiveShown = \(\) => archiveRows\(vm\.noiseShownIds\);/.test(ob) && !ob.includes("bulkArchiveAction") && ob.includes('(r.more ? " · press again for the rest" : "")'), "Jeff 10-15 #29: Noise's Archive all shown runs the rows' own Archive (archiveFromOrganizeAction) over every row shown, with the one Undo note");
  ok(/const more = Array\.isArray\(threadIds\) && new Set\(threadIds\.map\(\(x\) => str\(x\)\)\.filter\(Boolean\)\)\.size > list\.length;\s*return \{ ok: true as const, archived: undo\.length, refused, undo, more \};/.test(oa), "Jeff 10-15 #29: past the 500 cap the action says there is more");
  ok(ORGANIZE_ARCHIVED_EVENT === "peak:organize-archived", "archive #346: the reader → box event name");
  const page = src("src/app/(app)/inbox/page.tsx");
  ok(page.includes("if (reader && !reader.readOnly) reader = { ...reader, organize: organizeArchiveTarget(vm, reader.id) };"), "archive #346: only my own thread's reader gets the Organize Archive");
  ok(/labels: readOnly\s*\?\s*null/.test(page) && page.includes("gmail: cardGmailChips(") && page.includes('gmailEditable: sel.mailbox === "personal" && !!sel.gmailThreadId,') && page.includes("labels: threadGmailLabels(t.messages || [], labelOptions),"), "labels #346/#347: the reader VM carries labels for my own thread only (null when read-only), Gmail chips from cardGmailChips; the Inbox row's chips keep their helper");
  const ls = src("src/app/(app)/inbox/link-sidebar.tsx");
  ok(ls.includes("<LabelsCard vm={vm} />"), "labels #346: the reader's sidebar has a Labels card");
  const lc = src("src/app/(app)/inbox/labels-card.tsx");
  ok(lc.startsWith('"use client";') && lc.includes("run(() => categoryAction(vm.id, key))") && lc.includes("run(() => categoryAction(vm.id, null))") && lc.includes('postChanged("thread", vm.id);') && lc.includes("if (!labels || vm.readOnly) return null;") && lc.includes("<CategoryMenu") && lc.includes("data-colour-row"), "labels #346/#347: the Colour row applies / removes (✕) through the Inbox's categoryAction, posts changed, and the card shows nothing on a read-only thread");
  ok(!valueImports(lc).some((p) => /^@\/(db\b|lib\/stores\/|lib\/inbox-org\/)/.test(p)), "labels #346: labels-card imports no store, db or server module");
  const cb = src("src/app/(app)/inbox/command-bar.tsx");
  ok(cb.includes("export function CategoryMenu(") && /<CategoryMenu\s+trigger=\{<ActBtnInner icon=\{<TagIcon size=\{14\} \/>\} label="Categorize" caret \/>\}/.test(cb), "labels #346: the Inbox's Categorize ▾ and the Labels card share one CategoryMenu");
  const act = src("src/app/(app)/inbox/actions.ts");
  ok(/export async function categoryAction\(id: string, key: string \| null\) \{\s*const user = await requireUser\(\);\s*if \(!\(await ownThread\(id, user\)\)\) return;/.test(act), "labels #346: categoryAction stays owner-checked (#341, #349: by identity)");
  const ld = src("src/app/(app)/inbox/organize/load.ts");
  ok(ld.includes('const mine = (await listDocsWhere<CommThread>("comms", ownMailboxCond(viewer))).filter((t) => visibleTo(t, viewer));'), "archive #346: Organize lists only my own threads — a read-only #341 thread never shows there (#349: by identity, cut in SQL)");
}

/* ---------- #347: the person's own Gmail labels on the Labels card ---------- */

export async function inboxGmailLabelChecks(ok: Ok): Promise<void> {
  const R = await import("@/lib/gmail/user-label-rules");
  const U = await import("@/lib/gmail/user-labels");
  const { isCardLabel, interpretLabelEvents } = await import("@/lib/gmail/label-interpret");
  const { listCachedLabels, replaceLabels } = await import("@/lib/gmail/connections");
  const { gmailLabels } = await import("@/db/schema");
  const src = (p: string) => readFileSync(p, "utf8");

  /* pure: picker, chips, names */
  const cache = [
    { labelId: "INBOX", name: "INBOX", type: "system" as const },
    { labelId: "UNREAD", name: "UNREAD", type: "system" as const },
    { labelId: "IMPORTANT", name: "IMPORTANT", type: "system" as const },
    { labelId: "STARRED", name: "STARRED", type: "system" as const },
    { labelId: "CATEGORY_PROMOTIONS", name: "CATEGORY_PROMOTIONS", type: "system" as const },
    { labelId: "Label_1", name: "Clients", type: "user" as const, backgroundColor: "#16a766", textColor: "#ffffff" },
    { labelId: "Label_2", name: "Bids/2026", type: "user" as const },
    { labelId: "Label_3", name: "Peak/Customers/Lincoln HS", type: "user" as const },
    { labelId: "Label_4", name: "Peak/Customers/UNKNOWN", type: "user" as const },
    { labelId: "Label_5", name: "Peak", type: "user" as const },
  ];
  const pick = R.pickerLabels(cache);
  ok(pick.map((l) => l.name).join(",") === "Starred,Important,Bids/2026,Clients", `labels #347: the picker offers Starred, Important, then my labels A→Z — never Peak/*, a placeholder or Gmail's other system labels (${pick.map((l) => l.name).join(",")})`);
  const chips = R.cardGmailChips([{ gmailLabelIds: ["INBOX", "UNREAD", "Label_1", "Label_3", "Label_4", "STARRED"] }, { gmailLabelIds: ["Label_2"] }], cache);
  ok(chips.map((c) => `${c.name}:${c.editable ? "e" : "r"}`).join(",") === "Starred:e,Bids/2026:e,Clients:e,Peak/Customers/Lincoln HS:r", `labels #347: chips — my labels and Starred editable, Peak/* read-only, a placeholder label never shown (${chips.map((c) => c.name).join(",")})`);
  ok(chips.find((c) => c.id === "Label_1")?.backgroundColor === "#16a766", "labels #347: a chip keeps its Gmail colours");
  const bad = ["", "  ", "x".repeat(226), "/Clients", "Clients/", "Clients//Lincoln", "Peak/Foo", "peak", "Inbox", "STARRED"];
  ok(bad.every((n) => !R.validateLabelName(n).ok), "labels #347: names refused — empty, over 225, a leading / trailing slash, an empty nested part, under Peak/, a Gmail system name");
  const good = R.validateLabelName("  Clients /  Lincoln HS ");
  ok(R.isPeakLabelName("Peak /X") && R.isPeakLabelName(" peak/X") && R.isPeakLabelName("PEAK") && !R.isPeakLabelName("Peakwood/X") && !R.validateLabelName("Peak /X").ok && !R.validateLabelName(" peak/X").ok, "labels #347 review: 'Peak /X' and ' peak/X' are under Peak/ (the first segment, trimmed) — refused");
  ok(R.pickerLabels([{ labelId: "L9", name: "Peak /Odd", type: "user" }, { labelId: "L8", name: " peak/x", type: "user" }]).length === 0, "labels #347 review: …and never offered in the picker");
  ok(good.ok && good.name === "Clients/Lincoln HS" && R.validateLabelName("x".repeat(225)).ok && R.validateLabelName("Peakwood").ok, "labels #347: a nested or 225-char name is fine (whitespace tidied); 'Peakwood' isn't under Peak/");
  ok(isCardLabel("Label_1", cache[5]) && !isCardLabel("Label_3", cache[7]) && isCardLabel("STARRED", cache[3]) && !isCardLabel("UNREAD", cache[1]) && isCardLabel("Label_99", undefined) && !isCardLabel("CATEGORY_X", undefined), "labels #347: the history import records my labels and Starred / Important (a not-yet-cached Label_ id too) — not Peak/*, UNREAD or categories");

  /* a fake Gmail */
  type Change = { addLabelIds?: string[]; removeLabelIds?: string[] };
  const fake = () => {
    const st = {
      enabled: true,
      canModify: true,
      labels: cache.map((l) => ({ id: l.labelId, name: l.name, type: l.type })) as Array<{ id: string; name: string; type: "system" | "user" }>,
      lists: 0,
      creates: [] as string[],
      modifies: [] as Array<{ key: string; thread: string; change: Change }>,
      modifyError: null as Error | null,
    };
    const client: import("@/lib/gmail/user-labels").GmailLabelClient = {
      enabled: () => st.enabled,
      canModify: async () => st.canModify,
      listLabels: async () => {
        st.lists++;
        return st.labels.map((l) => ({ ...l }));
      },
      createLabel: async (_k, name) => {
        st.creates.push(name);
        const l = { id: `Label_n${st.creates.length}`, name, type: "user" as const };
        st.labels.push(l);
        return l;
      },
      modifyThread: async (key, thread, change) => {
        if (st.modifyError) throw st.modifyError;
        st.modifies.push({ key, thread, change });
      },
    };
    return { st, client };
  };

  const ME = "TEST347 Ann Labels";
  const me = { id: "TEST347-u-ann", name: ME };
  const KEY = "personal:TEST347-u-ann";
  const NOW = Date.now();
  const T0 = NOW - 3_600_000;
  const mk = async (slug: string, o: Partial<CommThread> = {}): Promise<string> => {
    const id = fixtureId(347, "lb-" + slug);
    await createFixture("comms", {
      id, mailbox: "personal", mailboxUser: ME, unread: false, archived: false, customerId: null, customer: "", contactName: "Pat",
      contactEmail: "pat@labels-347.test", cc: "", subject: "Labels", channel: "email", status: "waiting_us", assignedTo: "", link: null,
      gmailThreadId: "gt-" + slug, gmailAccountKey: KEY,
      messages: [
        { id: "m1-" + slug, at: T0, direction: "in", channel: "email", author: "Pat", body: "Hi", fromEmail: "pat@labels-347.test", gmailId: "g1-" + slug, gmailLabelIds: ["INBOX", "Label_3"] },
        { id: "m2-" + slug, at: T0 + 60_000, direction: "out", channel: "email", author: ME, body: "Reply", gmailId: "g2-" + slug },
        { id: "m3-" + slug, at: T0 + 120_000, direction: "note", channel: "email", author: ME, body: "A note" },
      ],
      createdAt: T0, updatedAt: T0, resolution: "unknown",
      filing: { customerId: null, work: null, noise: false, source: "identity", reason: "x", strength: "weak", needsReply: false, state: "suggested", at: T0 },
      ...o,
    } as unknown as CommThread);
    return id;
  };
  const read = async (id: string) => (await getDoc<CommThread>("comms", id))!;
  const ids = (t: CommThread) => (t.messages || []).map((m) => (m.gmailLabelIds || []).join("+")).join("|");
  const db = await getDb();
  try {
    await replaceLabels(KEY, cache.map((l) => ({ id: l.labelId, name: l.name, type: l.type })));

    /* the cache: fresh → no Gmail call; stale (5 min) → refreshed; Gmail off → cache */
    const f1 = fake();
    await U.mailboxLabels(KEY, f1.client, { now: NOW });
    ok(f1.st.lists === 0, "labels #347: a fresh label cache is used as is (no Gmail call)");
    f1.st.labels.push({ id: "Label_6", name: "Warranty", type: "user" });
    const stale = await U.mailboxLabels(KEY, f1.client, { now: NOW + U.LABEL_CACHE_MS + 1000 });
    ok(f1.st.lists === 1 && stale.some((l) => l.labelId === "Label_6") && (await listCachedLabels(KEY)).some((r) => r.labelId === "Label_6"), "labels #347: a cache older than 5 minutes is refreshed from Gmail (users.labels.list) and stored");
    const f0 = fake();
    f0.st.enabled = false;
    await U.mailboxLabels(KEY, f0.client, { now: NOW + 60 * U.LABEL_CACHE_MS });
    ok(f0.st.lists === 0, "labels #347: with Gmail off the cache is used (no call)");

    /* picker */
    const t1 = await mk("apply");
    const pk = await U.labelPicker(t1, me, f1.client, NOW);
    ok(pk.ok && pk.labels.some((l) => l.name === "Warranty") && !pk.labels.some((l) => l.name.startsWith("Peak")), "labels #347: the picker lists my mailbox's labels, never Peak/*");
    // #349 — someone else's thread: their name AND their own Gmail account (ownership follows the key, not the name)
    const other = await mk("other", { mailboxUser: "TEST347 Ben Other", gmailAccountKey: "personal:TEST347-u-ben" });
    ok(!(await U.labelPicker(other, me, f1.client, NOW)).ok, "labels #347: the picker refuses someone else's thread");
    const local = await mk("local", { gmailThreadId: undefined });
    const lp = await U.labelPicker(local, me, f1.client, NOW);
    ok(!lp.ok && lp.error === "no-gmail", "labels #347: a thread not in Gmail can't take Gmail labels");

    /* apply / remove */
    const filingBefore = JSON.stringify((await read(t1)).filing);
    const a = await U.setThreadLabel(t1, "Label_1", true, me, f1.client, NOW);
    const ta = await read(t1);
    ok(a.ok && f1.st.modifies.length === 1 && f1.st.modifies[0].thread === "gt-apply" && f1.st.modifies[0].key === KEY && f1.st.modifies[0].change.addLabelIds?.[0] === "Label_1", "labels #347: apply calls Gmail threads.modify (addLabelIds) on the thread's Gmail thread");
    ok(ids(ta) === "INBOX+Label_3+Label_1|Label_1|" && ta.userLabelOps?.Label_1?.on === true && ta.userLabelOps.Label_1.at === NOW && JSON.stringify(ta.filing) === filingBefore, `labels #347: the stored gmailLabelIds follow at once on every Gmail message (a note untouched), the card's operation is stamped per label, the filing untouched (${ids(ta)})`);
    const rm = await U.setThreadLabel(t1, "Label_1", false, me, f1.client, NOW);
    ok(rm.ok && f1.st.modifies[1].change.removeLabelIds?.[0] === "Label_1" && ids(await read(t1)) === "INBOX+Label_3||", "labels #347: ✕ removes it in Gmail (removeLabelIds) and in the stored labels");
    const st = await U.setThreadLabel(t1, "STARRED", true, me, f1.client, NOW);
    ok(st.ok && f1.st.modifies[2].change.addLabelIds?.[0] === "STARRED", "labels #347: Starred can be set from the card");
    const pk3 = await U.setThreadLabel(t1, "Label_3", false, me, f1.client, NOW);
    ok(!pk3.ok && pk3.error === "bad-name" && f1.st.modifies.length === 3, "labels #347: a Peak/* label is never removed (or added) from the card");
    const miss = await U.setThreadLabel(t1, "Label_gone", true, me, f1.client, NOW);
    ok(!miss.ok && miss.error === "label-missing" && f1.st.modifies.length === 3, "labels #347: an unknown label id says the label is missing (the list is refreshed)");

    /* refusals and Gmail errors */
    const ro = await U.setThreadLabel(other, "Label_1", true, me, f1.client, NOW);
    ok(!ro.ok && ro.error === "not-found" && f1.st.modifies.length === 3 && ids(await read(other)) === "INBOX+Label_3||", "labels #347: someone else's thread is refused — no Gmail call, nothing stored");
    const f2 = fake();
    f2.st.enabled = false;
    const off = await U.setThreadLabel(t1, "Label_1", true, me, f2.client, NOW);
    f2.st.enabled = true;
    f2.st.canModify = false;
    const scope = await U.setThreadLabel(t1, "Label_1", true, me, f2.client, NOW);
    ok(!off.ok && off.error === "no-gmail" && !scope.ok && scope.error === "no-scope" && /reconnect/i.test(scope.message), "labels #347: Gmail off → 'no Gmail'; a connection without gmail.modify → reconnect");
    f2.st.canModify = true;
    f2.st.modifyError = new Error("Gmail API /threads/x/modify → 429 rateLimitExceeded");
    const q = await U.setThreadLabel(t1, "Label_1", true, me, f2.client, NOW);
    f2.st.modifyError = new Error("Gmail API /threads/x/modify → 404 Not Found");
    const nf = await U.setThreadLabel(t1, "Label_1", true, me, f2.client, NOW);
    ok(!q.ok && q.error === "quota" && !nf.ok && nf.error === "thread-missing" && /no longer in Gmail/.test(nf.message) && !ids(await read(t1)).includes("Label_1"), "labels #347 review: Gmail's quota error and a 404 on the thread ('That email is no longer in Gmail') show inline; nothing is stored when Gmail refuses");
    ok(U.gmailError(new Error("Gmail API /labels/Label_9 → 404 Not Found")) === "label-missing" && U.gmailError(new Error("Gmail API /threads/t1/modify → 404 Not Found")) === "thread-missing" && U.gmailError(new Error("Gmail API /threads/t1/modify → 400 Invalid label: Label_9")) === "label-missing" && U.gmailError(new Error("Gmail API /messages → 404")) === "failed", "labels #347 review: a 404 is 'label missing' only on a labels endpoint; on a thread it is 'no longer in Gmail'");

    /* review: the thread must be bridged through MY Gmail connection */
    // #349 — stamped mine (the owner id wins) but bridged through Ben's account
    const foreignKey = await mk("foreign-key", { mailboxOwnerId: "TEST347-u-ann", gmailAccountKey: "personal:TEST347-u-ben" });
    const unstamped = await mk("unstamped", { gmailAccountKey: undefined });
    const fk = await U.setThreadLabel(foreignKey, "Label_1", true, me, f1.client, NOW);
    const us = await U.labelPicker(unstamped, me, f1.client, NOW);
    ok(!fk.ok && fk.error === "no-gmail" && !us.ok && us.error === "no-gmail" && f1.st.modifies.length === 3, "labels #347 review: a thread in my mailbox bridged through another Gmail account (or unstamped) is refused — the token and label cache are personalKey(me.id)'s");

    /* create */
    const f3 = fake();
    const c1 = await U.createThreadLabel(t1, "Warranty claims", me, f3.client, NOW);
    ok(c1.ok && c1.created && f3.st.creates[0] === "Warranty claims" && f3.st.modifies[0]?.change.addLabelIds?.[0] === c1.label.id && ids(await read(t1)).includes(c1.label.id) && (await listCachedLabels(KEY)).some((r) => r.name === "Warranty claims"), "labels #347: Create makes the label in Gmail (users.labels.create), applies it and adds it to the cache");
    const c2 = await U.createThreadLabel(t1, "clients", me, f3.client, NOW);
    ok(c2.ok && !c2.created && f3.st.creates.length === 1 && c2.label.id === "Label_1", "labels #347: a name that already exists (any case) is applied, not created twice");
    const c3 = await U.createThreadLabel(t1, "Peak/Customers/Mine", me, f3.client, NOW);
    const c4 = await U.createThreadLabel(t1, "/Bad", me, f3.client, NOW);
    ok(!c3.ok && c3.error === "bad-name" && !c4.ok && f3.st.creates.length === 1, "labels #347: Create refuses a Peak/* or badly formed name before calling Gmail");
    ok(!(await U.createThreadLabel(other, "Fine name", me, f3.client, NOW)).ok && f3.st.creates.length === 1, "labels #347: Create refuses someone else's thread");

    /* the history import: my label changed in Gmail flows into gmailLabelIds; the card's own echo is skipped */
    const t2 = await mk("import");
    await interpretLabelEvents(KEY, [{ messageId: "g1-import", threadId: "gt-import", added: ["Label_2", "UNREAD"], removed: [] }]);
    ok(ids(await read(t2)) === "INBOX+Label_3+Label_2||", `labels #347: a label added in Gmail is recorded from the history import (UNREAD is not) (${ids(await read(t2))})`);
    await interpretLabelEvents(KEY, [{ messageId: "g1-import", threadId: "gt-import", added: [], removed: ["Label_2"] }]);
    ok(ids(await read(t2)) === "INBOX+Label_3||", "labels #347: …and one removed in Gmail is dropped");
    // review 3: an event carrying a Peak/* label AND one of mine keeps mine
    await interpretLabelEvents(KEY, [{ messageId: "g1-import", threadId: "gt-import", added: ["Label_3", "Label_2"], removed: [] }]);
    ok(ids(await read(t2)) === "INBOX+Label_3+Label_2||", `labels #347 review: a mixed event (Peak/* + my label) still records my label (${ids(await read(t2))})`);
    // history order: an add then a remove in one sync nets to removed
    await interpretLabelEvents(KEY, [
      { messageId: "g1-import", threadId: "gt-import", added: ["Label_1"], removed: [] },
      { messageId: "g1-import", threadId: "gt-import", added: [], removed: ["Label_1", "Label_2"] },
    ]);
    ok(ids(await read(t2)) === "INBOX+Label_3||", "labels #347 review: within one sync, the last event for a label wins (added then removed → removed)");

    // review 4: per-label echo guard — card add at t0, card remove at t1, then
    // Gmail's stale add echo arrives: it must not re-add the label
    const fe = fake();
    await U.setThreadLabel(t2, "Label_1", true, me, fe.client, Date.now());
    await U.setThreadLabel(t2, "Label_1", false, me, fe.client, Date.now() + 1);
    ok(ids(await read(t2)) === "INBOX+Label_3||" && (await read(t2)).userLabelOps?.Label_1?.on === false, "labels #347 review: (setup) the card added then removed Label_1");
    await interpretLabelEvents(KEY, [{ messageId: "g1-import", threadId: "gt-import", added: ["Label_1"], removed: [] }]);
    ok(!ids(await read(t2)).includes("Label_1"), "labels #347 review: a stale add echo after the card's remove never re-adds the label");
    await interpretLabelEvents(KEY, [{ messageId: "g1-import", threadId: "gt-import", added: ["Label_2"], removed: [] }]);
    ok(ids(await read(t2)).includes("Label_2"), "labels #347 review: the guard is per label — a Gmail change to another label in the window still lands");
    const I = await import("@/lib/gmail/label-interpret");
    const msgs = [{ id: "a", gmailId: "g1", gmailLabelIds: ["X"] }, { id: "b" }] as unknown as CommMessage[];
    const per = new Map([["g1", new Map([["Y", true], ["X", false]])]]);
    const applied = I.applyUserLabelChanges(msgs, per, { X: { on: true, at: 1000 } }, 1000 + 60_000);
    const later = I.applyUserLabelChanges(msgs, per, { X: { on: true, at: 1000 } }, 1000 + 10 * 60_000);
    ok(JSON.stringify(applied?.[0].gmailLabelIds) === '["X","Y"]' && JSON.stringify(later?.[0].gmailLabelIds) === '["Y"]' && I.applyUserLabelChanges(msgs, new Map(), undefined, 0) === null, `labels #347 review: applyUserLabelChanges holds a label the card changed in the window, releases it after (${JSON.stringify(applied?.[0].gmailLabelIds)} / ${JSON.stringify(later?.[0].gmailLabelIds)})`);
    ok(U.withLabel(msgs, "Z", true)?.[0].gmailLabelIds?.join() === "X,Z" && U.withLabel(msgs, "X", true) === null && (U.withLabel(msgs, "Z", true)?.[1] as { gmailLabelIds?: string[] }).gmailLabelIds === undefined, "labels #347 review: withLabel touches Gmail messages only, null when nothing changes");
  } finally {
    await dropFixtures(347);
    await db.delete(gmailLabels).where(eq(gmailLabels.mailboxKey, KEY));
  }

  /* pins: actions, card */
  const act = src("src/app/(app)/inbox/actions.ts");
  for (const n of ["gmailLabelPickerAction", "setGmailLabelAction", "createGmailLabelAction"])
    ok(new RegExp(`export async function ${n}\\(threadId: string[^)]*\\) \\{\\s*const user = await requireUser\\(\\);\\s*if \\(!\\(await ownThread\\(threadId, user\\)\\)\\)`).test(act), `labels #347: ${n} is owner-checked (#341, #349: by identity) before Gmail is touched`);
  const lc = src("src/app/(app)/inbox/labels-card.tsx");
  ok(lc.includes("setGmailLabelAction(vm.id, g.id, false)") && lc.includes("setGmailLabelAction(vm.id, l.id, true)") && lc.includes("createGmailLabelAction(vm.id, name)") && lc.includes("gmailLabelPickerAction(threadId)"), "labels #347: the card removes (✕), applies and creates through the owner-checked actions; the picker loads when it opens");
  ok(lc.includes("Create “{q.trim()}”") && lc.includes("validateLabelName(q)") && lc.includes('placeholder="Search or create a label…"') && lc.includes("data-peak-label") && lc.includes('role="alert"'), "labels #347: a searchable picker with Create '<typed>' at the bottom; Peak/* chips read-only; errors inline");
  ok(lc.indexOf("data-gmail-label-add") < lc.indexOf("data-colour-row"), "labels #347: Gmail labels lead; Colour is a small row under them");
  ok(!valueImports(lc).some((p) => /^@\/(db\b|lib\/stores\/|lib\/inbox-org\/)|^@\/lib\/gmail\/(?!user-label-rules)/.test(p)), "labels #347: the card imports only the pure label rules from lib/gmail (no store, db or Gmail client)");
  const ul = src("src/lib/gmail/user-labels.ts");
  ok(/casDocKey\("comms", threadId, "messages", t\.messages, next\)/.test(ul) && /casDocKey\("comms", threadId, "userLabelOps", prev, ops\)/.test(ul) && !/patchDoc/.test(ul), "labels #347 review: the label write is a compare-and-set on the messages key (re-read on conflict) — never a whole-doc rewrite that could drop a message appended meanwhile");
  ok(/const t = await ownThread\(threadId, me\);[\s\S]*?const key = personalKey\(me\.id\);\s*if \(t\.mailbox !== "personal" \|\| !t\.gmailThreadId \|\| t\.gmailAccountKey !== key\) return failWith\("no-gmail"\);/.test(ul), "labels #347 review: the Gmail key is personalKey(me.id), and the thread must be bridged through it");
  ok(/async function writeCache[\s\S]*?try \{\s*await replaceLabels\(key, labels\);\s*\} catch/.test(ul) && /if \(created\) \{\s*try \{/.test(ul), "labels #347 review: a cache write failing after Gmail created the label is logged, and Create still applies the label and reports success");
  const conn = src("src/lib/gmail/connections.ts");
  ok(/export async function replaceLabels[\s\S]*?await withTransaction\(async \(\) => \{\s*const db = await getDb\(\);\s*await db\.delete\(gmailLabels\)/.test(conn), "labels #347 review: replaceLabels deletes and inserts in one transaction");
  const li = src("src/lib/gmail/label-interpret.ts");
  ok(/for \(const \[gThread, perMessage\] of userLabelChanges\(events, isCard\)\)/.test(li) && /casDocKey\("comms", t\.id, "messages", t\.messages, next\)/.test(li) && /const evAdded = ev\.added\.filter\(notCard\);/.test(li), "labels #347 review: my labels are recorded from every event (Peak/* or not) by an ordered CAS pass; the Peak/* branch leaves them to it");
  const ld = src("src/app/(app)/inbox/organize/load.ts");
  ok(/export async function organizeEntryCounts[\s\S]*?listDocsWhere<CommThread>\("comms", ownMailboxCond\(viewer\)\)/.test(ld), "brief #347 review: the live Organize counts read only my mailbox (#349: ownMailboxCond in SQL, by identity), never the whole collection");
  const rules = src("src/lib/gmail/user-label-rules.ts");
  ok(valueImports(rules).length === 0, "labels #347: user-label-rules.ts has no imports (client-safe)");
  const cfg = src("src/lib/gmail/config.ts");
  ok(/export const GMAIL_SCOPES = \[[\s\S]*?"https:\/\/www\.googleapis\.com\/auth\/gmail\.modify"/.test(cfg), "labels #347: the Gmail connect already asks for gmail.modify (labels need nothing new)");
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
    await inboxOrgDbChecks(ok);
    await inboxOrgPipelineChecks(ok);
    await inboxOrgAiChecks(ok);
    await inboxOrgApplyChecks(ok);
    await inboxOrgUiChecks(ok);
    await inboxOrgCleanupChecks(ok);
    await inboxOrgEntryChecks(ok);
    await inboxOrgPlaceholderChecks(ok);
    await inboxOrgArchiveLabelChecks(ok);
    await inboxGmailLabelChecks(ok);
    // later tasks append: await inboxOrgXChecks(ok);
    console.log(fail ? `\n${fail} FAILED` : "\nall inbox-org checks passed");
    process.exit(fail ? 1 : 0);
  })().catch((err) => {
    console.log("FAIL " + (err instanceof Error ? err.stack || err.message : String(err)));
    process.exit(1);
  });
}
