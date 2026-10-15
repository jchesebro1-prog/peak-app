/**
 * #341 thread visibility checks — "a user may see an email thread only if it
 * is their own, assigned to them, or linked to an entity" (Jeff, 2026-10-14),
 * and Jeff's follow-up ruling: linked means DELIBERATELY linked (by the owner,
 * or #335 filing for them); the automatic sender match stays private.
 * Standalone: `npm run test:thread-visibility`; also chained into test:specs.
 *
 *  - pure: canSeeThread / hasDeliberateLink / isOwnThread / canOpenThread /
 *    readOnlyBanner, canSeeThreadCond's shape, the triage helpers;
 *  - DB: the SQL mirror (searchDocs `where`) answers exactly like the JS rule;
 *    ⌘K; the company page loader + activity feed; Ask's get_thread; the owner
 *    guard and the lib-level thread writes; reply / task drafting own-only;
 *    resweeps scoped to the acting user's mailbox; filing shares and Undo
 *    un-shares; the renewal draft lookup; admin Start here redaction; Inbox
 *    search crowding; a blank viewer;
 *  - pins: every Inbox server action that takes a thread id (found from the
 *    source, not a hand list) checks the owner first; the reader opens only
 *    canOpenThread, is read-only off-mailbox and ships no link / task data.
 *  - #349 (Jeff, 2026-10-14): mailbox ownership follows the signed-in user's
 *    IDENTITY (users.id — 1:1 with their unique email), never the display
 *    name: two users with one name see nothing of each other's; the owner id
 *    wins over the name; a Gmail key and a unique legacy name still resolve; a
 *    shared legacy name is nobody's; actions stamp lazily, page reads never;
 *    the comms:stamp-owners plan; creators refuse a blank owner; Settings →
 *    Team refuses a blank or duplicate name.
 */
import { readFileSync } from "node:fs";
import {
  canOpenThread,
  canSeeThread,
  canSeeThreadCond,
  hasDeliberateLink,
  isAssignedTo,
  isOwnThread,
  isSharedThread,
  isTaskSharedTo,
  isThreadLinked,
  mailboxOwnership,
  ownMailboxCond,
  ownsMailbox,
  readOnlyBanner,
  resolveMailboxOwnerId,
  taskShareCond,
  taskSharesThread,
  viewerFrom,
  visibleTo,
} from "@/lib/stores/comms-visibility";
import { planOwnerStamps, tombstoneStamps } from "@/lib/comms-owner-stamp";
import { MAILBOX_OWNER_NOBODY } from "@/lib/stores/comms-visibility";
import { duplicateNameIds, foldTeamName, teamNameError } from "@/lib/team-names";
import { PRIVATE_EMAIL_TITLE, redactEmailRows, triageMayActOnThread } from "@/lib/triage/thread-access";
import type { CommThread } from "@/lib/stores/comms";
import type { MailboxViewer } from "@/lib/stores/comms-visibility";
import type { SnapshotRow } from "@/lib/triage/types";
import type { Ok } from "./test-inbox-org";
import { sanitizePushedDoc, SERVER_OWNED_FIELDS } from "@/lib/sync/server-owned";

type T = Parameters<typeof canSeeThread>[0];
const base = (over: Partial<CommThread> = {}): T =>
  ({ mailbox: "personal", mailboxUser: "Other Person", status: "waiting_us", assignedTo: "", channel: "email", customerId: null, siteId: null, link: null, ...over }) as T;
const filedOn = (customerId: string | null) =>
  ({ customerId, work: null, noise: false, source: "rule", reason: "", strength: "strong", needsReply: false, state: "filed", at: 1 }) as CommThread["filing"];

export function threadVisibilityPureChecks(ok: Ok): void {
  // #349 — a viewer is an identity (id + name + whether the name is unique); these
  // threads carry only a legacy owner NAME, which counts while the name is unique
  const ME_NAME = "Me Person";
  const ME: MailboxViewer = { id: "u-me", name: ME_NAME, nameUnique: true };
  const OTHER_V: MailboxViewer = { id: "u-other", name: "Other Person", nameUnique: true };
  const NOBODY: MailboxViewer = { id: "", name: "", nameUnique: false };
  const own = base({ mailboxUser: ME_NAME });
  ok(visibleTo(own, ME) && isOwnThread(own, ME) && canSeeThread(own, ME) && canOpenThread(own, ME), "visibility: my own thread — own, visible, opens");
  ok(canSeeThread({ ...own, customerId: "C-1" }, ME), "visibility: my own thread with only an automatic customer match is still mine");
  const priv = base();
  ok(!canSeeThread(priv, ME) && !canOpenThread(priv, ME) && !isOwnThread(priv, ME) && canSeeThread(priv, OTHER_V), "visibility: another user's unlinked thread is hidden from me, visible to its owner");
  ok(
    !canSeeThread(base({ customerId: "C-1" }), ME) && !hasDeliberateLink(base({ customerId: "C-1" })) && !isThreadLinked(base({ customerId: "C-1", resolvedContactId: "P-1", resolution: "linked" })),
    "visibility (Jeff's ruling): a customerId from the automatic sender match alone does NOT share a thread"
  );
  ok(
    canSeeThread(base({ customerId: "C-1", linkedBy: "user" }), ME) && canSeeThread(base({ customerId: "C-1", linkedBy: "filing" }), ME) && canSeeThread(base({ customerId: "C-1", filing: filedOn("C-1") }), ME),
    "visibility: a customer linked by a person (linkedBy user), by filing (linkedBy filing) or a filed #335 filing is shared"
  );
  ok(
    !canSeeThread(base({ customerId: "C-1", filing: { ...filedOn("C-1")!, state: "suggested" } }), ME) && !canSeeThread(base({ customerId: "C-1", filing: { ...filedOn("C-1")!, state: "dismissed", noise: true } }), ME),
    "visibility: a suggested (not filed) or noise filing never shares an automatic match"
  );
  ok(
    canSeeThread(base({ siteId: "S-1" }), ME) &&
      canSeeThread(base({ link: { type: "quote", id: "Q-1" } }), ME) &&
      canSeeThread(base({ linkedContactIds: ["P-1"] }), ME) &&
      canSeeThread(base({ customerId: "C-1", channel: "call" }), ME),
    "visibility (legacy proofs): a venue, a work link, chosen people, or a logged call/meeting with a customer — fields only a person or filing writes — share without the flag"
  );
  ok(
    !canSeeThread(base({ link: { type: "quote", id: "" } }), ME) &&
      !canSeeThread(base({ link: { type: "", id: "Q-1" } }), ME) &&
      !canSeeThread(base({ linkedContactIds: [] }), ME) &&
      !canSeeThread(base({ customerId: "", linkedBy: "user" }), ME) &&
      !canSeeThread(base({ channel: "call" }), ME),
    "visibility: a half link, an empty people list, a flag with nothing linked, or a call with no customer is not a link"
  );
  ok(!canSeeThread(base({ resolvedContactId: "P-9" }), ME) && !isThreadLinked(base({ resolvedContactId: "P-9" })), "visibility: resolvedContactId alone (the automatic sender match) does NOT share a thread");
  ok(canSeeThread(base({ assignedTo: "  me person " }), ME) && isAssignedTo(base({ assignedTo: "ME PERSON" }), ME) && !isAssignedTo(base({ assignedTo: "" }), NOBODY) && !canSeeThread(base({ assignedTo: "Someone" }), ME), "visibility: assigned to me (trimmed, case-insensitive — triage's sameName) is visible; \"\" never matches");
  ok(
    !canSeeThread(base({ customerId: "C-1", linkedBy: "user", deleted: true }), ME) && !canSeeThread(base({ assignedTo: ME_NAME, deleted: true }), ME) && !canSeeThread({ ...own, deleted: true }, ME) && canOpenThread({ ...own, deleted: true } as T, ME) && !isOwnThread({ ...own, deleted: true } as T, ME),
    "visibility: Deleted hides a thread from every listing (even mine); only the owner still opens their own from the Deleted folder; isOwnThread excludes Deleted"
  );
  ok(!canSeeThread(base({ customerId: "C-1", linkedBy: "user", status: "draft" }), ME) && !canSeeThread(base({ assignedTo: ME_NAME, status: "draft" }), ME) && canSeeThread({ ...own, status: "draft" }, ME) && !isSharedThread(base({ customerId: "C-1", linkedBy: "user", status: "draft" })), "visibility: another person's draft is never visible, even linked or assigned; my own draft is");
  const shared = base({ mailbox: "sales", mailboxUser: null, customerId: "C-1", linkedBy: "user" });
  const legacyPriv = base({ mailbox: "sales", mailboxUser: null, customerId: "C-1" });
  ok(canSeeThread(shared, ME) && !isOwnThread(shared, ME) && !canSeeThread(legacyPriv, ME) && readOnlyBanner(shared) === "Shared mailbox — read only" && readOnlyBanner(priv) === "In Other Person’s mailbox — read only", "visibility: a legacy shared-box thread is nobody's own — visible only when deliberately linked, with the Shared mailbox banner");
  ok(!canSeeThread(base({ mailboxUser: "" }), NOBODY) && !isOwnThread(base({ mailboxUser: "" }), NOBODY) && !canOpenThread(base({ mailboxUser: "" }), NOBODY) && !visibleTo(base({ mailboxUser: "" }), NOBODY), "visibility: an empty viewer owns nothing (visibleTo needs an identity)");
  ok(isSharedThread(base({ customerId: "C-1", linkedBy: "filing" })) && !isSharedThread(base({ customerId: "C-1" })) && !isSharedThread(base({ customerId: "C-1", linkedBy: "user", deleted: true })) && !isSharedThread(own), "visibility: isSharedThread = deliberately linked, live, not a draft (the viewer-free feed rule)");
  const cond = JSON.stringify(canSeeThreadCond(ME));
  ok(
    cond.includes('"path":["deleted"],"isNot":"true"') &&
      cond.includes('"path":["mailboxOwnerId"],"is":"u-me"') &&
      cond.includes('"path":["gmailAccountKey"],"is":"personal:u-me"') &&
      cond.includes('"path":["mailboxUser"],"is":"Me Person"') &&
      cond.includes('"path":["assignedToId"],"is":"u-me"') &&
      cond.includes('"path":["assignedTo"],"isFolded":"me person"') &&
      cond.includes('"path":["status"],"isNot":"draft"') &&
      cond.includes('"path":["linkedBy"],"is":"user"') &&
      cond.includes('"path":["linkedBy"],"is":"filing"') &&
      cond.includes('"path":["filing","state"],"is":"filed"') &&
      cond.includes('"path":["channel"],"isNot":"email"') &&
      ["customerId", "siteId", "linkedContactIds"].every((f) => cond.includes(`"path":["${f}"],"filled"`)) &&
      cond.includes('"path":["link","type"],"filled":"text"') &&
      cond.includes('"path":["link","id"],"filled":"text"') &&
      !cond.includes("resolvedContactId"),
    "visibility: canSeeThreadCond mirrors canSeeThread branch for branch (deliberate-link flag, filed filing, legacy proofs; no resolvedContactId)"
  );
  ok(!JSON.stringify(canSeeThreadCond(NOBODY)).includes("mailboxUser") && !JSON.stringify(canSeeThreadCond(NOBODY)).includes("mailboxOwnerId"), "visibility: canSeeThreadCond with no viewer has no own-mailbox branch");
  const shared349 = JSON.stringify(canSeeThreadCond({ ...ME, nameUnique: false }));
  ok(shared349.includes('"path":["mailboxOwnerId"],"is":"u-me"') && !shared349.includes('"path":["mailboxUser"]') && !shared349.includes('"path":["assignedTo"]'), "visibility (#349): with a shared name the SQL rule keeps the id branches and drops both name branches");

  /* triage */
  ok(
    triageMayActOnThread(own, ME) && triageMayActOnThread(base({ assignedTo: ME_NAME }), ME) && !triageMayActOnThread(base({ assignedTo: ME_NAME, deleted: true }), ME) && !triageMayActOnThread(base({ customerId: "C-1", linkedBy: "user" }), ME) && !triageMayActOnThread(priv, ME),
    "triage (#341): Done / Reassign act on my own live thread or one still assigned to me — never a teammate's merely linked one, never one in Deleted"
  );
  const row = (key: string, title: string): SnapshotRow => ({ key, source: key.startsWith("email:") ? "email" : "task", title, sub: "Re: pricing", href: "/x", score: 1, reason: "Linked open deal: EST-1", callLine: null, also: ["y"] });
  const rows = [row("email:T-priv", "Secret Co"), row("email:T-shared", "Shared Co"), row("email:T-gone", "Gone Co"), row("task:K-1", "A task")];
  const threads = new Map<string, T>([["T-priv", base()], ["T-shared", base({ customerId: "C-1", linkedBy: "user" })]]);
  const out = redactEmailRows(rows, threads as never, ME);
  ok(
    out[0].title === PRIVATE_EMAIL_TITLE && out[0].sub === "" && out[0].href === "" && out[0].reason === "" && out[0].also.length === 0 && out[0].key === "email:T-priv" &&
      out[1].title === "Shared Co" && out[1].href === "/x" &&
      out[2].title === PRIVATE_EMAIL_TITLE &&
      out[3] === rows[3],
    "triage admin view (#341): an email row I can't see is \"Private email\" (no subject, customer, reason or link); a shared one and non-email rows pass through; a gone thread is private too"
  );

  mailboxIdentityPureChecks(ok);
}

/** #349 — ownership by identity (pure). */
function mailboxIdentityPureChecks(ok: Ok): void {
  const roster = [
    { id: "u-a", name: "Pat Twin" },
    { id: "u-b", name: "pat twin " }, // same name, other case / spacing
    { id: "u-c", name: "Cam Solo" },
  ];
  const A = viewerFrom(roster[0], roster);
  const B = viewerFrom(roster[1], roster);
  const Cv = viewerFrom(roster[2], roster);
  ok(!A.nameUnique && !B.nameUnique && Cv.nameUnique && !viewerFrom({ id: "", name: "Cam Solo" }, roster).nameUnique, "identity (#349): a name another user also holds (trimmed, case-insensitive) is not unique; a blank id is nobody");
  const legacyTwin = base({ mailboxUser: "Pat Twin" });
  const aStamped = base({ mailboxUser: "Pat Twin", mailboxOwnerId: "u-a" });
  const bKeyed = base({ mailboxUser: "Pat Twin", gmailAccountKey: "personal:u-b" });
  ok(
    ownsMailbox(aStamped, A) && !ownsMailbox(aStamped, B) && ownsMailbox(bKeyed, B) && !ownsMailbox(bKeyed, A) && !ownsMailbox(legacyTwin, A) && !ownsMailbox(legacyTwin, B),
    "identity (#349): two users with one name — each owns only the thread stamped / Gmail-keyed to them; the legacy name-only thread is nobody's (fail closed)"
  );
  ok(
    !canSeeThread(aStamped, B) && !canOpenThread(aStamped, B) && !isOwnThread(aStamped, B) && !canSeeThread(bKeyed, A) && !canSeeThread(legacyTwin, A) && !canSeeThread(legacyTwin, B),
    "identity (#349): a shared name grants nothing — not visible, not openable, not own"
  );
  const idWins = base({ mailboxUser: "Cam Solo", mailboxOwnerId: "u-a", gmailAccountKey: "personal:u-c" });
  ok(ownsMailbox(idWins, A) && !ownsMailbox(idWins, Cv) && mailboxOwnership(idWins, A) === "stamp", "identity (#349): the owner id wins over the name and the Gmail key");
  ok(ownsMailbox(base({ mailboxUser: "Renamed Since", gmailAccountKey: "personal:u-c" }), Cv) && mailboxOwnership(base({ mailboxUser: "x", gmailAccountKey: "personal:u-c" }), Cv) === "key", "identity (#349): an unstamped Gmail-bridged thread is its account owner's, whatever its display name");
  ok(!ownsMailbox(base({ mailboxUser: "Cam Solo", gmailAccountKey: "personal:u-a" }), Cv), "identity (#349): a Gmail key that isn't mine is never mine by name");
  ok(ownsMailbox(base({ mailboxUser: "Cam Solo" }), Cv) && mailboxOwnership(base({ mailboxUser: "Cam Solo" }), Cv) === "name" && !ownsMailbox(base({ mailboxUser: "cam solo" }), Cv), "identity (#349): a legacy name-only thread is owned while the name is unique (exact spelling)");
  ok(
    resolveMailboxOwnerId(aStamped, roster) === "u-a" && resolveMailboxOwnerId(bKeyed, roster) === "u-b" && resolveMailboxOwnerId(legacyTwin, roster) === null && resolveMailboxOwnerId(base({ mailboxUser: "Cam Solo" }), roster) === "u-c" && resolveMailboxOwnerId(base({ mailboxUser: "Nobody Here" }), roster) === null && resolveMailboxOwnerId(base({ mailbox: "sales", mailboxUser: null }), roster) === null,
    "identity (#349): resolveMailboxOwnerId — stamp, else key, else a name one user holds; a shared or unknown name and a shared box are nobody's"
  );
  ok(isAssignedTo(base({ assignedTo: "Pat Twin", assignedToId: "u-a" }), A) && !isAssignedTo(base({ assignedTo: "Pat Twin", assignedToId: "u-a" }), B) && !isAssignedTo(base({ assignedTo: "Pat Twin" }), A) && isAssignedTo(base({ assignedTo: "cam solo" }), Cv) && !isAssignedTo(base({ assignedTo: "Cam Solo", assignedToId: "u-a" }), Cv), "identity (#349): assignment by assignedToId; a legacy assignee name counts only while unique; the id wins over the name");
  ok(triageMayActOnThread(base({ assignedTo: "Pat Twin", assignedToId: "u-a" }), A) && !triageMayActOnThread(base({ assignedTo: "Pat Twin", assignedToId: "u-a" }), B) && !triageMayActOnThread(base({ assignedTo: "Pat Twin" }), B), "identity (#349): triage Done / Reassign follow the assignee id (a shared legacy name acts for nobody)");
  const oc = JSON.stringify(ownMailboxCond(A));
  ok(oc.includes('"path":["mailboxOwnerId"],"is":"u-a"') && oc.includes('"path":["gmailAccountKey"],"is":"personal:u-a"') && !oc.includes("mailboxUser") && JSON.stringify(ownMailboxCond(Cv)).includes('"path":["mailboxUser"],"is":"Cam Solo"'), "identity (#349): ownMailboxCond — id and key branches always, the legacy-name branch only for a unique name");

  /* #349 review — the tombstone owns nothing, ever */
  const tomb = base({ mailboxUser: "Cam Solo", mailboxOwnerId: MAILBOX_OWNER_NOBODY });
  ok(!ownsMailbox(tomb, Cv) && !canSeeThread(tomb, Cv) && resolveMailboxOwnerId(tomb, roster) === null && mailboxOwnership(tomb, Cv) === null, "tombstone (#349 review): a thread stamped \"unresolved\" is nobody's — not even the sole holder of its name");
  const fakeTomb: MailboxViewer = { id: MAILBOX_OWNER_NOBODY, name: "x", nameUnique: true };
  ok(!ownsMailbox(tomb, fakeTomb) && JSON.stringify(ownMailboxCond(fakeTomb)) === JSON.stringify({ any: [] }), "tombstone (#349 review): no viewer can match it (a viewer id equal to the tombstone owns nothing, in JS and SQL)");
  ok(resolveMailboxOwnerId(base({ mailboxUser: "   " }), [{ id: "u-w", name: "   " }]) === null, "identity (#349 review): a whitespace-only name is never unique in resolveMailboxOwnerId (as viewerFrom)");

  /* the comms:stamp-owners plan */
  const plan = planOwnerStamps(
    [
      { id: "s1", mailbox: "personal", mailboxUser: "Cam Solo" },
      { id: "s2", mailbox: "personal", mailboxUser: "Pat Twin" },
      { id: "s3", mailbox: "personal", mailboxUser: "Old Name", gmailAccountKey: "personal:u-b" },
      { id: "s4", mailbox: "personal", mailboxUser: "Cam Solo", mailboxOwnerId: "u-c" },
      { id: "s5", mailbox: "personal", mailboxUser: "Ghost Person" },
      { id: "s6", mailbox: "personal", mailboxUser: "" },
      { id: "s7", mailbox: "sales", mailboxUser: null },
      { id: "s8", mailbox: "personal", mailboxUser: "Pat Twin", mailboxOwnerId: MAILBOX_OWNER_NOBODY },
    ],
    roster
  );
  ok(
    plan.candidates === 5 &&
      JSON.stringify(plan.stamps) === JSON.stringify([{ id: "s1", ownerId: "u-c", how: "name" }, { id: "s3", ownerId: "u-b", how: "key" }]) &&
      JSON.stringify(plan.unresolved.map((u) => [u.id, u.reason])) === JSON.stringify([["s2", "shared-name"], ["s5", "unknown-name"], ["s6", "no-name"]]) &&
      plan.tombstoned === 1,
    "comms:stamp-owners (#349): stamps by Gmail key or a unique name, skips stamped (and already tombstoned) and shared-box threads, lists shared / unknown / blank names as unresolved"
  );
  ok(JSON.stringify(tombstoneStamps(plan)) === JSON.stringify([{ id: "s2", ownerId: MAILBOX_OWNER_NOBODY }]), "comms:stamp-owners (#349 review): --apply tombstones the shared-name rows only (unknown / blank names are listed, not written)");

  /* Settings → Team names */
  const team = [
    { id: "u1", name: "Jeff Chesebro", status: "active" },
    { id: "u2", name: "Sam  Mills", status: "archived" },
  ];
  ok(foldTeamName("  Sam   MILLS ") === "sam mills" && teamNameError("", team) === "Name is required." && teamNameError("   ", team) === "Name is required.", "Settings → Team (#349): a blank name is refused");
  ok(/already has that name/.test(teamNameError(" jeff  chesebro", team) || "") && /\(archived\)/.test(teamNameError("Sam Mills", team) || "") && teamNameError("Jeff Chesebro", team, "u1") === null && teamNameError("Dana Lee", team) === null, "Settings → Team (#349): a duplicate (case / whitespace-insensitive, any status) is refused with a clear error; renaming yourself to your own name is fine");
  ok([...duplicateNameIds([...team, { id: "u3", name: "jeff chesebro" }])].sort().join() === "u1,u3" && duplicateNameIds(team).size === 0, "Settings → Team (#349): duplicateNameIds flags every holder of a shared name");
}

export async function threadVisibilityDbChecks(ok: Ok): Promise<void> {
  const { searchDocs } = await import("@/db/doc-store");
  const { createFixture, dropFixtures, fixtureId, registerFixture } = await import("./test-fixtures");
  const { globalSearch } = await import("@/lib/search/global-search");
  const C = await import("@/lib/stores/comms");
  const { loadCustomerFeed } = await import("@/lib/customer-feed");
  const { runReadTool } = await import("@/lib/assist/ask-tools-server");
  const { loadThreadFor, loadThreadReadable } = await import("@/lib/assist/thread-access");
  const { ownThread, ownThreadIds } = await import("@/lib/inbox-thread-guard");
  const { createTaskFromThread } = await import("@/lib/inbox-task-write");
  const apply = await import("@/lib/inbox-org/apply");
  const { draftReplyForThread } = await import("@/lib/assist/reply-server");
  const { suggestTasksForThread } = await import("@/lib/assist/tasks-server");
  const { assistSettingsOf } = await import("@/lib/assist/config");
  const { rememberAddress, resweepThreads, linkThread } = await import("@/lib/gmail/linking");
  const { upsert: upsertCustomer, remove: removeCustomer } = await import("@/lib/stores/customers");
  const { setEmails, softDeleteContact } = await import("@/lib/identity/contacts");
  const { upsertRenewalDraft } = await import("@/lib/renewal-outreach");
  const { redactRowsForViewer } = await import("@/lib/triage/redact-server");
  const { fakeProvider } = await import("./test-assist");
  const { seeded } = await import("@/db");
  const { mailboxViewer } = await import("@/lib/mailbox-viewer");
  await seeded();

  const ME = { id: "u-tv341-me", name: "TV341 Me", roles: ["admin"] };
  const OTHER = { id: "u-tv341-other", name: "TV341 Other", roles: ["admin"] };
  // #349 — every check takes the viewer's identity; these legacy name-only
  // fixtures resolve through the unique-name fallback
  const ME_V = await mailboxViewer(ME);
  const OTHER_V = await mailboxViewer(OTHER);
  const NOBODY: MailboxViewer = { id: "", name: "", nameUnique: false };
  const NOW = Date.UTC(2034, 5, 1, 15, 0);
  const CID = fixtureId(341, "co");
  const id = (slug: string) => fixtureId(341, slug);
  const ids = {
    mine: id("t-mine"),
    mineAuto: id("t-mine-auto"),
    mineDeleted: id("t-mine-deleted"),
    priv: id("t-priv"),
    auto: id("t-auto"),
    co: id("t-co"),
    filed: id("t-filed"),
    site: id("t-site"),
    work: id("t-work"),
    people: id("t-people"),
    call: id("t-call"),
    resolved: id("t-resolved"),
    assigned: id("t-assigned"),
    deleted: id("t-deleted"),
    draft: id("t-draft"),
    sharedBox: id("t-sharedbox"),
  };
  const th = (tid: string, mailboxUser: string | null, word: string, over: Record<string, unknown> = {}) => ({
    id: tid,
    mailbox: mailboxUser ? "personal" : "sales",
    mailboxUser,
    unread: true,
    customerId: null,
    customer: "Vizzlequark Arts",
    contactName: "Pat Vizzle",
    contactEmail: "pat@vizzlequark.test",
    subject: `Vizzlequark ${word}`,
    channel: "email",
    status: "waiting_us",
    assignedTo: "",
    link: null,
    createdAt: NOW,
    updatedAt: NOW,
    messages: [{ id: "m1", at: NOW, direction: "in", channel: "email", author: "Pat Vizzle", fromEmail: "pat@vizzlequark.test", body: `Body ${word}` }],
    ...over,
  });
  const fixtures = [
    th(ids.mine, ME.name, "mineword"),
    th(ids.mineAuto, ME.name, "mineautoword", { customerId: CID, resolution: "linked", resolvedContactId: "P-auto" }),
    th(ids.mineDeleted, ME.name, "minedeletedword", { customerId: CID, linkedBy: "user", deleted: true }),
    th(ids.priv, OTHER.name, "privword"),
    th(ids.auto, OTHER.name, "autoword", { customerId: CID, resolution: "linked", resolvedContactId: "P-auto" }),
    th(ids.co, OTHER.name, "coword", { customerId: CID, linkedBy: "user" }),
    th(ids.filed, OTHER.name, "filedword", { customerId: CID, filing: filedOn(CID) }),
    th(ids.site, OTHER.name, "siteword", { siteId: "LOC-341" }),
    th(ids.work, OTHER.name, "workword", { link: { type: "quote", id: "Q-341", label: "Quote" } }),
    th(ids.people, OTHER.name, "peopleword", { linkedContactIds: ["P-341"] }),
    th(ids.call, OTHER.name, "callword", { customerId: CID, channel: "call" }),
    th(ids.resolved, OTHER.name, "resolvedword", { resolvedContactId: "P-342" }),
    th(ids.assigned, OTHER.name, "assignedword", { assignedTo: ME.name }),
    th(ids.deleted, OTHER.name, "deletedword", { customerId: CID, linkedBy: "user", deleted: true }),
    th(ids.draft, OTHER.name, "draftword", { customerId: CID, linkedBy: "user", status: "draft" }),
    th(ids.sharedBox, null, "sharedboxword", { customerId: CID, linkedBy: "user" }),
  ];
  const extraComms: string[] = [];
  const contactIds: string[] = [];
  try {
    await upsertCustomer({ id: CID, name: "Vizzlequark Arts", type: "Education", locations: [], contacts: [] } as never);
    for (const f of fixtures) await createFixture("comms", f as never);

    /* the SQL mirror answers exactly like the JS rule, for both viewers */
    for (const who of [ME, OTHER]) {
      const v = await mailboxViewer(who);
      const sqlIds = new Set((await searchDocs("comms", "vizzlequark", 200, { where: canSeeThreadCond(v) })).map((d) => d.id));
      const mismatch = fixtures.filter((f) => sqlIds.has(f.id) !== canSeeThread(f as never, v)).map((f) => f.id);
      ok(mismatch.length === 0, `thread visibility db: canSeeThreadCond (SQL) === canSeeThread (JS) for every fixture, as ${who.name}` + (mismatch.length ? ` — differs on ${mismatch.join(", ")}` : ""));
    }
    const mineSql = new Set((await searchDocs("comms", "vizzlequark", 200, { where: canSeeThreadCond(ME_V) })).map((d) => d.id));
    ok(
      [ids.mine, ids.mineAuto, ids.co, ids.filed, ids.site, ids.work, ids.people, ids.call, ids.assigned, ids.sharedBox].every((x) => mineSql.has(x)) &&
        [ids.priv, ids.auto, ids.resolved, ids.deleted, ids.draft, ids.mineDeleted].every((x) => !mineSql.has(x)),
      "thread visibility db: as me — mine (auto-matched too), deliberately linked / filed / legacy-proven, assigned and a linked shared-box thread; never a teammate's private or auto-matched, deleted or draft thread"
    );

    /* ⌘K */
    const k = async (q: string, who: { id: string; name?: string } = ME) => ((await globalSearch(q, who)).find((g) => g.label === "Email threads")?.items ?? []).map((i) => i.id);
    ok((await k("privword")).length === 0 && (await k("privword", OTHER)).includes(ids.priv), "⌘K (#341): another user's unlinked thread is not in my results — it is in theirs");
    ok(!(await k("autoword")).includes(ids.auto) && (await k("autoword", OTHER)).includes(ids.auto), "⌘K (#341, Jeff's ruling): a teammate's thread matched to a customer automatically stays private");
    ok((await k("coword")).includes(ids.co) && (await k("filedword")).includes(ids.filed) && (await k("assignedword")).includes(ids.assigned) && (await k("mineword")).includes(ids.mine), "⌘K (#341): a teammate's deliberately linked and filed threads, one assigned to me, and my own are found");
    ok((await k("deletedword")).length === 0 && (await k("minedeletedword")).length === 0 && (await k("draftword")).length === 0 && (await k("resolvedword")).length === 0, "⌘K (#341): Deleted threads (mine too), another person's draft and a resolvedContactId-only thread are never listed");
    const groups = await globalSearch("coword", ME);
    ok(groups.every((g) => Object.keys(g).join(",") === "label,items" && g.items.every((i) => Object.keys(i).join(",") === "id,title,sub,href,letter,color")) && groups.find((g) => g.label === "Email threads")?.items[0]?.href === `/inbox?thread=${encodeURIComponent(ids.co)}`, "⌘K (#341): output shape unchanged; a hit still opens /inbox?thread=");
    ok(!(await k("mineword", { id: ME.id })).includes(ids.mine), "⌘K (#341): with no viewer name, nobody's own mailbox matches");

    /* company page loader + feed */
    const page = (await C.visibleByCustomer(CID, ME_V)).map((t) => t.id);
    ok(page.includes(ids.co) && page.includes(ids.filed) && page.includes(ids.sharedBox) && page.includes(ids.mineAuto) && !page.includes(ids.auto) && !page.includes(ids.deleted) && !page.includes(ids.draft) && !page.includes(ids.mineDeleted), "company page (#341): deliberately linked threads from any mailbox and my own; never a teammate's auto-matched thread, Deleted (mine too) or another person's draft");
    const feedIds = (rows: Array<{ href: string | null }>) => new Set(rows.flatMap((r) => (r.href?.startsWith("/inbox?thread=") ? [decodeURIComponent(r.href.slice("/inbox?thread=".length))] : [])));
    const feed = feedIds(await loadCustomerFeed({ id: CID, name: "Vizzlequark Arts" }, ME.id, ME));
    ok(feed.has(ids.co) && feed.has(ids.filed) && feed.has(ids.sharedBox) && feed.has(ids.mineAuto) && !feed.has(ids.auto) && !feed.has(ids.deleted) && !feed.has(ids.draft) && !feed.has(ids.mineDeleted), "activity feed (#341): as on the company page — shared threads plus my own; never a teammate's auto-matched, deleted or draft thread");
    const feedNoViewer = feedIds(await loadCustomerFeed({ id: CID, name: "Vizzlequark Arts" }));
    ok(feedNoViewer.has(ids.co) && !feedNoViewer.has(ids.mineAuto) && !feedNoViewer.has(ids.auto), "activity feed (#341): with no viewer (vendor page / company summary) only shared threads — no automatic match from anyone's mailbox");

    /* Ask */
    const gt = async (tid: string) => runReadTool("get_thread", { id: tid }, { id: ME.id, name: ME.name });
    const co = await gt(ids.co);
    const auto = await gt(ids.auto);
    const priv = await gt(ids.priv);
    ok(co.text.includes("Vizzlequark coword") && co.refs[0]?.id === ids.co && co.refs[0]?.readOnly === true, "Ask get_thread (#341): a teammate's deliberately linked thread is readable (ref flagged read-only)");
    ok(!priv.text.includes("privword") && priv.refs.length === 0 && !auto.text.includes("autoword") && auto.refs.length === 0, "Ask get_thread (#341): a teammate's unlinked or auto-matched thread reads like a missing one");
    ok(!!(await loadThreadReadable(ids.assigned, ME_V)) && !(await loadThreadReadable(ids.deleted, ME_V)) && !(await loadThreadReadable(ids.mineDeleted, ME_V)), "loadThreadReadable (#341): assigned → readable; Deleted (even mine) → null");

    /* the owner guard + every lib-level write refuses a non-own thread */
    ok(!!(await ownThread(ids.mine, ME_V)) && !!(await ownThread(ids.mineDeleted, ME_V)) && !(await ownThread(ids.co, ME_V)) && !(await ownThread(ids.assigned, ME_V)) && !(await ownThread(ids.sharedBox, ME_V)) && !(await ownThread("", ME_V)) && !(await ownThread(ids.mine, NOBODY)), "inbox guard (#341): ownThread — my mailbox (Deleted included) only; linked, assigned and shared-box threads are refused");
    ok(JSON.stringify(await ownThreadIds([ids.mine, ids.co, ids.mine, ids.assigned, 5, ids.mineDeleted], ME_V)) === JSON.stringify([ids.mine, ids.mineDeleted]), "inbox guard (#341): ownThreadIds keeps (deduped, in order) only my own ids — the bulk actions' cut");
    const actor = { id: ME.id, name: ME.name, roles: ME.roles };
    const refusals = await Promise.all([
      apply.approveFiling(ids.co, actor),
      apply.markNoise(ids.co, actor),
      apply.notNoise(ids.co, actor),
      apply.skipFiling(ids.co, actor),
      apply.undoFiling(ids.co, actor),
      apply.changeFiling(ids.co, { customerId: CID, siteId: null, work: null }, actor),
      apply.overrideCourt(ids.co, "me", actor),
      apply.archiveAfterReply(ids.co, "reply", actor, { manual: true }),
    ]);
    ok(refusals.every((r) => !!r && typeof r === "object" && "ok" in r && r.ok === false), "inbox organize (#341): approve / noise / not-noise / skip / undo / change / court / archive-on-Mark-replied all refuse another mailbox's linked thread");
    const task = await createTaskFromThread({ threadId: ids.co, title: "x", notes: "", assigneeUserId: "", dueDate: "", linkKeys: [] }, ME);
    ok(!task.ok, "inbox task (#341): Create task refuses a linked thread in another mailbox");

    /* reply / task drafting stay own-only */
    const settings = assistSettingsOf({ assistUsers: [ME.id] });
    const env = { ANTHROPIC_API_KEY: "test" };
    const calls: unknown[] = [];
    const reply = await draftReplyForThread(ids.co, ME, { provider: fakeProvider("draft", { calls: calls as never }), settings, env, now: NOW });
    const tasks = await suggestTasksForThread(ids.assigned, ME, { provider: fakeProvider("{}", { calls: calls as never }), settings, env, now: NOW });
    ok(!reply.ok && reply.kind === "thread" && !tasks.ok && calls.length === 0, "Assist (#341): Draft reply refuses a linked non-own thread and Suggest tasks an assigned one — before any model call");
    ok(!(await loadThreadFor(ids.co, ME_V)) && !!(await loadThreadFor(ids.mine, ME_V)), "loadThreadFor (#341): the action rule stays own mailbox only");

    /* resweeps: a contact I add re-links only MY mailbox, and an automatic link stays private */
    const SENDER = "pat341.vizzle@gmail.com"; // a public domain: no domain claim
    const viaMail = (tid: string, user: string) => th(tid, user, `sweepword ${tid.slice(-3)}`, { contactEmail: SENDER, messages: [{ id: "m1", at: NOW, direction: "in", channel: "email", author: "Pat", fromEmail: SENDER, body: "hi" }] });
    const swMine = id("sw-mine");
    const swOther = id("sw-other");
    await createFixture("comms", viaMail(swMine, ME.name) as never);
    await createFixture("comms", viaMail(swOther, OTHER.name) as never);
    const cid = await rememberAddress(CID, SENDER, "Pat Sweep", null, { id: ME.id, name: ME.name });
    if (cid) contactIds.push(cid);
    const afterMine = await C.get(swMine);
    const afterOther = await C.get(swOther);
    ok(
      afterMine?.customerId === CID && !afterMine.linkedBy && !afterOther?.customerId,
      "resweep (#341): adding a contact re-links only the acting user's own mailbox (an automatic match, no linkedBy); a teammate's thread from the same sender is untouched"
    );
    ok(!!afterMine && !canSeeThread(afterMine, OTHER_V) && canSeeThread(afterMine, ME_V), "resweep (#341): the automatically matched thread stays private to its owner");
    await resweepThreads({ email: SENDER });
    const sysOther = await C.get(swOther);
    ok(sysOther?.customerId === CID && !sysOther.linkedBy && !canSeeThread(sysOther, ME_V), "resweep (#341): a system resweep (no acting user) may link every mailbox, and what it links stays private");
    ok((await resweepThreads({ email: SENDER }, { owner: NOBODY })) === 0, "resweep (#341): a blank scope touches nothing (never \"everything\")");

    /* deliberate links: linkThread flags, a label echo keeps, filing shares, Undo un-shares */
    await linkThread(swMine, CID, null);
    ok((await C.get(swMine))?.linkedBy === "user" && canSeeThread((await C.get(swMine))!, OTHER_V), "linkThread (#341): a person's link sets linkedBy \"user\" — now shared");
    const flMine = id("fl-other");
    await createFixture("comms", th(flMine, OTHER.name, "filingword", {
      customerId: CID, resolution: "linked", resolvedContactId: "P-auto",
      filing: { customerId: CID, work: null, noise: false, source: "rule", reason: "", strength: "strong", needsReply: false, state: "suggested", at: NOW },
    }) as never);
    const oActor = { id: OTHER.id, name: OTHER.name, roles: OTHER.roles };
    ok(!canSeeThread((await C.get(flMine))!, ME_V), "filing (#341): an auto-matched thread with a filing still only SUGGESTED is private");
    const approved = await apply.approveFiling(flMine, oActor);
    ok(approved.ok && canSeeThread((await C.get(flMine))!, ME_V), "filing (#341): Approve files it — the filed thread is shared with the team");
    const undone = await apply.undoFiling(flMine, oActor);
    ok(undone.ok && !canSeeThread((await C.get(flMine))!, ME_V), "filing (#341): Undo un-shares it again");
    const flNew = id("fl-other-new");
    await createFixture("comms", th(flNew, OTHER.name, "filingword2", {
      filing: { customerId: CID, work: null, noise: false, source: "rule", reason: "", strength: "strong", needsReply: false, state: "suggested", at: NOW },
    }) as never);
    const ap2 = await apply.approveFiling(flNew, oActor);
    const filedNew = await C.get(flNew);
    ok(ap2.ok && filedNew?.linkedBy === "filing" && filedNew.customerId === CID && canSeeThread(filedNew, ME_V), "filing (#341): filing an unlinked thread links it with linkedBy \"filing\" — shared");
    await apply.undoFiling(flNew, oActor);
    const undoneNew = await C.get(flNew);
    ok(!!undoneNew && !undoneNew.customerId && !undoneNew.linkedBy && !canSeeThread(undoneNew, ME_V), "filing (#341): Undo restores the previous flag (none) and customer — private again");

    /* renewal draft lookup: only my own live draft is reused */
    const JOB = id("flame-job");
    const theirDraft = await C.saveDraft({ mailbox: "personal", owner: { id: OTHER.id, name: OTHER.name }, to: "a@b.test", subject: "Renewal", body: "x", link: { type: "flame_job", id: JOB, label: "Job" } });
    extraComms.push(theirDraft.id);
    const mineDeletedDraft = await C.saveDraft({ mailbox: "personal", owner: { id: ME.id, name: ME.name }, to: "a@b.test", subject: "Renewal", body: "x", link: { type: "flame_job", id: JOB, label: "Job" } });
    extraComms.push(mineDeletedDraft.id);
    await C.softDelete(mineDeletedDraft.id);
    const renewal = { linkType: "flame_job" as const, linkId: JOB, linkLabel: "Job", customerId: CID, customer: "Vizzlequark Arts", contactName: "Pat", to: "a@b.test", copy: { subject: "Renewal", body: "Hello" }, attachment: { name: "q.pdf", mime: "application/pdf", size: 1, dataUrl: "data:application/pdf;base64,QQ==" }, me: { id: ME.id, name: ME.name } };
    const myDraftId = await upsertRenewalDraft(renewal);
    extraComms.push(myDraftId);
    const myDraft = await C.get(myDraftId);
    ok(myDraftId !== theirDraft.id && myDraftId !== mineDeletedDraft.id && myDraft?.mailboxUser === ME.name && myDraft.status === "draft", "renewal outreach (#341): never reuses a teammate's draft or one of mine in Deleted — a new draft lands in my mailbox");
    ok((await upsertRenewalDraft(renewal)) === myDraftId, "renewal outreach (#341): my own live draft is reused (one renewal, one draft)");

    /* admin view of a teammate's Start here: redacted on the server */
    const snapRow = (tid: string): SnapshotRow => ({ key: `email:${tid}`, source: "email", title: "Vizzlequark Arts", sub: "Vizzlequark subject", href: `/inbox?thread=${tid}`, score: 1, reason: "Customer waiting", callLine: null, also: [] });
    const redacted = await redactRowsForViewer([snapRow(ids.priv), snapRow(ids.auto), snapRow(ids.co), snapRow(id("t-missing"))], ME);
    ok(
      redacted[0].title === PRIVATE_EMAIL_TITLE && redacted[0].sub === "" && redacted[0].href === "" && redacted[1].title === PRIVATE_EMAIL_TITLE && redacted[2].title === "Vizzlequark Arts" && redacted[3].title === PRIVATE_EMAIL_TITLE,
      "triage admin view (#341, DB): a teammate's private or auto-matched email is \"Private email\"; a shared one keeps its text; a missing thread is private"
    );

    /* Inbox search: other mailboxes can't crowd my own out of the 200 candidates */
    for (let i = 0; i < 205; i++) await createFixture("comms", th(id(`crowd-a${String(i).padStart(3, "0")}`), OTHER.name, "crowdword") as never);
    await createFixture("comms", th(id("crowd-zmine"), ME.name, "crowdword") as never);
    const found = await C.searchThreads("crowdword", { kind: "all" }, ME_V);
    ok(found.length === 1 && found[0].id === id("crowd-zmine"), "Inbox search (#341): my thread is found even when 205 of a teammate's matching threads sort first (SQL own-mailbox cut)");

    /* a blank viewer reads nothing */
    ok(
      (await C.threadsIn("personal", "inbox", NOBODY)).length === 0 && (await C.searchThreads("crowdword", { kind: "all" }, NOBODY)).length === 0 && (await C.folderCounts("personal", NOBODY)).inbox === 0 && (await C.unreadCount(NOBODY)) === 0,
      "comms reads (#341): a blank viewer gets nothing — no DEFAULT_USER fallback"
    );

    await mailboxIdentityDbChecks(ok, { ME, OTHER, ME_V, OTHER_V, CID, NOW, id, th, extraComms });
  } finally {
    for (const x of extraComms) registerFixture("comms", x);
    for (const c of contactIds) {
      await setEmails(c, []).catch(() => {});
      await softDeleteContact(c).catch(() => {});
    }
    await dropFixtures(341);
    await removeCustomer(CID).catch(() => {});
  }
}

/** #349 — ownership by identity, against the DB (two real users who share a
 *  name; lazy stamping; the stamp plan; creators refusing a blank owner). */
async function mailboxIdentityDbChecks(
  ok: Ok,
  f: {
    ME: { id: string; name: string; roles: string[] };
    OTHER: { id: string; name: string; roles: string[] };
    ME_V: MailboxViewer;
    OTHER_V: MailboxViewer;
    CID: string;
    NOW: number;
    id: (slug: string) => string;
    th: (tid: string, mailboxUser: string | null, word: string, over?: Record<string, unknown>) => Record<string, unknown> & { id: string };
    extraComms: string[];
  }
): Promise<void> {
  const { ME, OTHER, ME_V, OTHER_V, CID, NOW, id, th, extraComms } = f;
  const { searchDocs } = await import("@/db/doc-store");
  const { createFixture } = await import("./test-fixtures");
  const { getDb } = await import("@/db");
  const { users } = await import("@/db/schema");
  const { inArray } = await import("drizzle-orm");
  const C = await import("@/lib/stores/comms");
  const { globalSearch } = await import("@/lib/search/global-search");
  const { runReadTool } = await import("@/lib/assist/ask-tools-server");
  const { loadThreadFor, loadThreadReadable } = await import("@/lib/assist/thread-access");
  const { ownThread } = await import("@/lib/inbox-thread-guard");
  const { mailboxViewer, mailboxRoster, actorByName } = await import("@/lib/mailbox-viewer");
  const { loadOwnerStampPlan, applyOwnerStamps } = await import("@/lib/comms-owner-stamp");
  const { upsertRenewalDraft } = await import("@/lib/renewal-outreach");
  const { handOverNameOnly, retireNameForNewcomer } = await import("@/lib/mailbox-names");
  const { eq } = await import("drizzle-orm");
  const apply = await import("@/lib/inbox-org/apply");

  const TWIN = "TV349 Twin";
  const A = { id: "u-tv349-a", name: TWIN, roles: ["admin"] };
  const B = { id: "u-tv349-b", name: TWIN, roles: ["admin"] };
  const db = await getDb();
  // real user rows: the twins, plus ME and OTHER (the stamp script resolves a
  // legacy name only to a user who exists)
  const rows: Array<{ id: string; name: string; roles: string[] }> = [A, B, ME, OTHER];
  await db.insert(users).values(
    rows.map((u, i) => ({ id: u.id, name: u.name, email: `tv349-user-${i}@peak.test`, roles: ["Estimator"], color: "#5b616e", initials: "TT", status: "active" as const, createdAt: NOW }))
  );
  try {
    const AV = await mailboxViewer(A);
    const BV = await mailboxViewer(B);
    ok(!AV.nameUnique && !BV.nameUnique && ME_V.nameUnique && OTHER_V.nameUnique && (await actorByName(TWIN)) === null && (await actorByName(" tv341 me "))?.id === ME.id, "identity db (#349): two users share \"TV349 Twin\" — neither name is unique, and a picker can't resolve it to one person (a unique name resolves to its one user)");

    const filing = { customerId: CID, work: null, noise: false, source: "rule", reason: "", strength: "strong", needsReply: false, state: "suggested", at: NOW };
    const w = (slug: string) => id("i349-" + slug);
    const T = {
      aStamp: th(w("a-stamp"), TWIN, "twinastampword", { customerId: CID, mailboxOwnerId: A.id, filing }),
      bKey: th(w("b-key"), TWIN, "twinbkeyword", { customerId: CID, gmailAccountKey: "personal:" + B.id, filing }),
      legacyTwin: th(w("legacy-twin"), TWIN, "twinlegacyword", { customerId: CID, filing }),
      idWins: th(w("id-wins"), ME.name, "idwinsword", { mailboxOwnerId: OTHER.id }),
      meLegacy: th(w("me-legacy"), ME.name, "melegacyword", { customerId: CID }),
      meKey: th(w("me-key"), "Someone Renamed", "mekeyword", { gmailAccountKey: "personal:" + ME.id }),
      scriptLegacy: th(w("script-legacy"), ME.name, "scriptlegacyword"),
      ghost: th(w("ghost"), "TV349 Nobody", "ghostword"),
      assignA: th(w("assign-a"), OTHER.name, "assignaword", { assignedTo: TWIN, assignedToId: A.id }),
      assignTwin: th(w("assign-twin"), OTHER.name, "assigntwinword", { assignedTo: TWIN }),
    };
    for (const t of Object.values(T)) await createFixture("comms", t as never);
    const all = Object.values(T);

    /* the JS rule and its SQL mirror agree, for all four viewers */
    for (const [label, v] of [["A", AV], ["B", BV], ["me", ME_V], ["other", OTHER_V]] as const) {
      const sqlIds = new Set((await searchDocs("comms", "vizzlequark", 400, { where: canSeeThreadCond(v) })).map((d) => d.id));
      const mismatch = all.filter((t) => sqlIds.has(t.id) !== canSeeThread(t as never, v)).map((t) => t.id);
      ok(mismatch.length === 0, `identity db (#349): canSeeThreadCond (SQL) === canSeeThread (JS) as ${label}` + (mismatch.length ? ` — differs on ${mismatch.join(", ")}` : ""));
    }
    const sees = (t: { id: string }, v: MailboxViewer) => canSeeThread(t as never, v);
    ok(sees(T.aStamp, AV) && !sees(T.aStamp, BV) && sees(T.bKey, BV) && !sees(T.bKey, AV) && !sees(T.legacyTwin, AV) && !sees(T.legacyTwin, BV), "identity db (#349): same-name users — each sees only their own stamped / keyed thread; the legacy twin thread is nobody's");
    ok(sees(T.idWins, OTHER_V) && !sees(T.idWins, ME_V) && sees(T.meKey, ME_V) && !sees(T.meKey, OTHER_V) && sees(T.meLegacy, ME_V), "identity db (#349): the owner id wins over my name; a Gmail key is its owner's; my unique legacy name still resolves");

    /* reader list, ⌘K, the company page, Organize, Ask */
    const inbox = async (v: MailboxViewer) => (await C.threadsIn("personal", "inbox", v)).map((t) => t.id);
    const ia = await inbox(AV);
    ok(ia.includes(T.aStamp.id) && !ia.includes(T.bKey.id) && !ia.includes(T.legacyTwin.id), "identity db (#349): the Inbox list — A's own thread only, never B's or the legacy twin");
    const k = async (q: string, who: { id: string; name: string }) => ((await globalSearch(q, who)).find((g) => g.label === "Email threads")?.items ?? []).map((i) => i.id);
    ok((await k("twinastampword", A)).includes(T.aStamp.id) && (await k("twinastampword", B)).length === 0 && (await k("twinbkeyword", A)).length === 0 && (await k("twinbkeyword", B)).includes(T.bKey.id) && (await k("twinlegacyword", A)).length === 0 && (await k("twinlegacyword", B)).length === 0, "identity db (#349): ⌘K — a namesake's threads are never in my results");
    const pageA = (await C.visibleByCustomer(CID, AV)).map((t) => t.id);
    ok(pageA.includes(T.aStamp.id) && !pageA.includes(T.bKey.id) && !pageA.includes(T.legacyTwin.id), "identity db (#349): the company page / feed — my own auto-matched thread, never my namesake's or the legacy twin");
    const orgA = (await apply.toFileThreads(AV)).map((t) => t.id);
    const orgB = (await apply.toFileThreads(BV)).map((t) => t.id);
    ok(orgA.includes(T.aStamp.id) && !orgA.includes(T.bKey.id) && !orgA.includes(T.legacyTwin.id) && orgB.includes(T.bKey.id) && !orgB.includes(T.aStamp.id), "identity db (#349): Organize's To file — each namesake's own rows only");
    const { organizeEntryCounts } = await import("@/app/(app)/inbox/organize/load");
    ok((await organizeEntryCounts(A)).toFile === 1 && (await organizeEntryCounts(B)).toFile === 1, "identity db (#349): Organize counts (the brief / banner) — one each, the legacy twin counted for nobody");
    const gtA = await runReadTool("get_thread", { id: T.bKey.id }, A);
    const gtOwn = await runReadTool("get_thread", { id: T.aStamp.id }, A);
    ok(!gtA.text.includes("twinbkeyword") && gtA.refs.length === 0 && gtOwn.text.includes("twinastampword") && gtOwn.refs[0]?.readOnly !== true, "identity db (#349): Ask get_thread — a namesake's thread reads like a missing one; my own is mine (not read-only)");
    ok(!(await loadThreadReadable(T.bKey.id, AV)) && !(await loadThreadFor(T.bKey.id, AV)) && !!(await loadThreadFor(T.aStamp.id, AV)), "identity db (#349): Assist's thread loaders follow the id");

    /* actions: refused for a namesake; legacy threads stamped lazily — only on an action path */
    ok(!(await ownThread(T.bKey.id, A)) && !(await ownThread(T.legacyTwin.id, A)) && !(await ownThread(T.legacyTwin.id, B)) && !!(await ownThread(T.aStamp.id, A)), "identity db (#349): the Inbox action guard refuses a namesake's thread and the legacy twin");
    // page-render reads never stamp
    await C.threadsIn("personal", "inbox", ME_V);
    await globalSearch("melegacyword", ME);
    await C.visibleByCustomer(CID, ME_V);
    await loadThreadReadable(T.meLegacy.id, ME_V);
    await loadThreadFor(T.meLegacy.id, ME_V);
    ok(!(await C.get(T.meLegacy.id))?.mailboxOwnerId && !(await C.get(T.meKey.id))?.mailboxOwnerId, "identity db (#349): listings, ⌘K, the company page and Assist's loaders never stamp an owner");
    await ownThread(T.meLegacy.id, ME);
    await ownThread(T.meKey.id, ME);
    await ownThread(T.legacyTwin.id, A);
    ok((await C.get(T.meLegacy.id))?.mailboxOwnerId === ME.id && (await C.get(T.meKey.id))?.mailboxOwnerId === ME.id && !(await C.get(T.legacyTwin.id))?.mailboxOwnerId, "identity db (#349): an action stamps a unique-name or Gmail-keyed legacy thread with its owner's id (key-level CAS); a shared name is never stamped");

    /* assignment by id */
    ok(canSeeThread(T.assignA as never, AV) && !canSeeThread(T.assignA as never, BV) && !canSeeThread(T.assignTwin as never, AV) && !canSeeThread(T.assignTwin as never, BV), "identity db (#349): assigned by id — only A; a shared legacy assignee name assigns nobody");
    await C.assign(T.assignTwin.id, { id: B.id, name: TWIN });
    const reassigned = await C.get(T.assignTwin.id);
    ok(reassigned?.assignedToId === B.id && reassigned.assignedTo === TWIN && isAssignedTo(reassigned, BV) && !isAssignedTo(reassigned, AV), "identity db (#349): assign() stores the assignee id beside the name");
    await C.assign(T.assignTwin.id, null);
    const cleared = await C.get(T.assignTwin.id);
    ok(!!cleared && cleared.assignedTo === "" && !cleared.assignedToId, "identity db (#349): clearing an assignment clears the id too");

    /* the comms:stamp-owners plan + apply, idempotent */
    const ours = new Set(all.map((t) => t.id));
    const plan = await loadOwnerStampPlan(await mailboxRoster());
    const mine = plan.stamps.filter((s) => ours.has(s.id));
    const unresolved = plan.unresolved.filter((u) => ours.has(u.id));
    ok(
      mine.some((s) => s.id === T.scriptLegacy.id && s.ownerId === ME.id && s.how === "name") && mine.some((s) => s.id === T.bKey.id && s.ownerId === B.id && s.how === "key") &&
        !mine.some((s) => s.id === T.aStamp.id || s.id === T.meLegacy.id) &&
        unresolved.some((u) => u.id === T.legacyTwin.id && u.reason === "shared-name") && unresolved.some((u) => u.id === T.ghost.id && u.reason === "unknown-name"),
      "comms:stamp-owners db (#349): the dry-run plan — by key and by unique name; already-stamped threads skipped; a shared and an unknown name listed as unresolved"
    );
    const first = await applyOwnerStamps(mine);
    const again = await applyOwnerStamps(mine);
    const replan = (await loadOwnerStampPlan(await mailboxRoster())).stamps.filter((s) => ours.has(s.id));
    ok(first.stamped === mine.length && again.stamped === 0 && again.raced === mine.length && replan.length === 0 && (await C.get(T.scriptLegacy.id))?.mailboxOwnerId === ME.id && (await C.get(T.bKey.id))?.mailboxOwnerId === B.id && !(await C.get(T.legacyTwin.id))?.mailboxOwnerId, "comms:stamp-owners db (#349): apply stamps each once (compare-and-set), a re-run writes nothing, unresolved threads stay unstamped");
    // #349 review — --apply also tombstones the shared-name rows
    const tombs = tombstoneStamps({ unresolved }).filter((s) => ours.has(s.id));
    const tw = await applyOwnerStamps(tombs);
    ok(tombs.some((s) => s.id === T.legacyTwin.id) && !tombs.some((s) => s.id === T.ghost.id) && tw.stamped === tombs.length && (await C.get(T.legacyTwin.id))?.mailboxOwnerId === MAILBOX_OWNER_NOBODY && !(await C.get(T.ghost.id))?.mailboxOwnerId, "comms:stamp-owners db (#349 review): --apply tombstones the shared-name thread (\"unresolved\"); an unknown name is only listed");
    const replan2 = await loadOwnerStampPlan(await mailboxRoster());
    ok(!replan2.unresolved.some((u) => u.id === T.legacyTwin.id) && replan2.tombstoned >= 1 && !(await ownThread(T.legacyTwin.id, A)) && (await C.get(T.legacyTwin.id))?.mailboxOwnerId === MAILBOX_OWNER_NOBODY, "comms:stamp-owners db (#349 review): a tombstone is never re-planned, resolved or overwritten (the lazy stamp leaves it)");

    /* #349 review — renames never move mail; newcomers inherit nothing */
    const rename = async (u: { id: string }, name: string) => db.update(users).set({ name }).where(eq(users.id, u.id));
    // the twins: after the script, rename A away — B is now the name's only holder, yet the tombstoned thread stays nobody's
    await handOverNameOnly(A, await mailboxRoster());
    await rename(A, "TV349 Twin Renamed");
    const BV2 = await mailboxViewer(B);
    ok(BV2.nameUnique && !canSeeThread((await C.get(T.legacyTwin.id))! as never, BV2) && !(await ownThread(T.legacyTwin.id, B)), "rename (#349 review): renaming one of two namesakes after the script never hands the shared-name thread to the other — it stays tombstoned");
    // a fresh name-only thread on a SHARED old name is tombstoned by the rename itself
    await rename(A, TWIN);
    const twin2 = th(w("twin2"), TWIN, "twintwoword");
    await createFixture("comms", twin2 as never);
    const h = await handOverNameOnly(A, await mailboxRoster());
    await rename(A, "TV349 Twin Renamed");
    ok(h.owner === MAILBOX_OWNER_NOBODY && (await C.get(twin2.id))?.mailboxOwnerId === MAILBOX_OWNER_NOBODY && !canSeeThread((await C.get(twin2.id))! as never, await mailboxViewer(B)), "rename (#349 review): renaming away from a shared name tombstones that name's name-only threads — the remaining namesake gets nothing");
    // a UNIQUE old name: the renamed user keeps their name-only mail (and assignments); a new hire with the old name inherits nothing
    const R = { id: "u-tv349-r", name: "TV349 Renamer", roles: ["admin"] };
    await db.insert(users).values({ id: R.id, name: R.name, email: "tv349-renamer@peak.test", roles: ["Estimator"], color: "#5b616e", initials: "TR", status: "active" as const, createdAt: NOW });
    rows.push(R);
    const rLegacy = th(w("r-legacy"), R.name, "renamerword");
    const rAssign = th(w("r-assign"), OTHER.name, "renamerassignword", { assignedTo: R.name });
    await createFixture("comms", rLegacy as never);
    await createFixture("comms", rAssign as never);
    const hr = await handOverNameOnly(R, await mailboxRoster());
    await rename(R, "TV349 Renamed");
    const RV = await mailboxViewer({ id: R.id, name: "TV349 Renamed" });
    const rl = (await C.get(rLegacy.id))!;
    const ra = (await C.get(rAssign.id))!;
    ok(hr.owner === R.id && rl.mailboxOwnerId === R.id && ra.assignedToId === R.id && canSeeThread(rl, RV) && isAssignedTo(ra, RV), "rename (#349 review): before a rename the old (unique) name's name-only thread and assignment are stamped with the user's id — they stay theirs under the new name");
    await retireNameForNewcomer(R.name);
    const N = { id: "u-tv349-n", name: R.name };
    await db.insert(users).values({ id: N.id, name: N.name, email: "tv349-newhire@peak.test", roles: ["Estimator"], color: "#5b616e", initials: "TN", status: "active" as const, createdAt: NOW });
    rows.push({ ...N, roles: [] });
    const NV = await mailboxViewer(N);
    ok(NV.nameUnique && !canSeeThread(rl, NV) && !isAssignedTo(ra, NV) && !(await ownThread(rLegacy.id, N)) && (await k("renamerword", N)).length === 0, "new hire (#349 review): a new user taking a renamed teammate's old name inherits none of their mail or assignments");
    // a later rename of R moves nothing either (everything is stamped)
    const hr2 = await handOverNameOnly({ id: R.id, name: "TV349 Renamed" }, await mailboxRoster());
    await rename(R, "TV349 Third Name");
    ok(hr2.threads === 0 && (await C.get(rLegacy.id))?.mailboxOwnerId === R.id && canSeeThread((await C.get(rLegacy.id))!, await mailboxViewer({ id: R.id, name: "TV349 Third Name" })), "rename (#349 review): renaming again after the stamp transfers nothing — the thread follows the id");
    // an orphaned name (no current holder) is retired before a newcomer takes it
    const ghostHire = { id: "u-tv349-ghost", name: "TV349 Nobody" };
    const retired = await retireNameForNewcomer(ghostHire.name);
    await db.insert(users).values({ id: ghostHire.id, name: ghostHire.name, email: "tv349-ghost@peak.test", roles: ["Estimator"], color: "#5b616e", initials: "TG", status: "active" as const, createdAt: NOW });
    rows.push({ ...ghostHire, roles: [] });
    ok(retired.threads >= 1 && (await C.get(T.ghost.id))?.mailboxOwnerId === MAILBOX_OWNER_NOBODY && !canSeeThread((await C.get(T.ghost.id))!, await mailboxViewer(ghostHire)), "new hire (#349 review): older name-only mail already carrying a newcomer's name is tombstoned first — they inherit nothing");

    /* creators: a personal thread needs a real owner — never DEFAULT_USER */
    const throws = async (fn: () => Promise<unknown>) => {
      try {
        await fn();
        return false;
      } catch (e) {
        return e instanceof Error && e.message === C.NO_OWNER_ERROR;
      }
    };
    ok(
      (await throws(() => C.create({ mailbox: "personal", subject: "x" }))) &&
        (await throws(() => C.compose({ subject: "x", owner: { id: "", name: "Me" } }))) &&
        (await throws(() => C.saveDraft({ owner: { id: ME.id, name: "  " }, subject: "x" }))) &&
        (await throws(() => C.saveDraft({ subject: "x" }))) &&
        (await throws(() => C.moveTo(T.ghost.id, "personal", null))) &&
        (await throws(() => upsertRenewalDraft({ linkType: "flame_job", linkId: w("job"), linkLabel: "Job", customerId: null, customer: "", contactName: "", to: "a@b.test", copy: { subject: "s", body: "b" }, attachment: { name: "q.pdf", mime: "application/pdf", size: 1, dataUrl: "data:application/pdf;base64,QQ==" }, me: { id: "", name: "" } }))),
      "creators (#349): create / compose / saveDraft / moveTo / renewal drafts refuse a blank or missing owner — no DEFAULT_USER fallback"
    );
    const d = await C.saveDraft({ owner: { id: ME.id, name: ME.name }, to: "a@b.test", subject: "Owned", body: "x" });
    extraComms.push(d.id);
    ok(d.mailboxOwnerId === ME.id && d.mailboxUser === ME.name && d.assignedToId === ME.id && (await C.get(d.id))?.mailboxOwnerId === ME.id, "creators (#349): a new thread stores its owner's id beside the display name (and the assignee's id)");
  } finally {
    await db.delete(users).where(inArray(users.id, rows.map((u) => u.id)));
  }
}

/* ---------------- source pins ---------------- */

/** The thread-taking Inbox server-action files. (`meetings/actions.ts` takes
 *  meeting ids, which follow canSeeMeeting — not threads.) */
const ACTION_FILES = [
  "src/app/(app)/inbox/actions.ts",
  "src/app/(app)/inbox/link-actions.ts",
  "src/app/(app)/inbox/link-popup-actions.ts",
  "src/app/(app)/inbox/organize-actions.ts",
  "src/app/(app)/inbox/site-visit-actions.ts",
  "src/app/(app)/inbox/task-actions.ts",
  "src/app/(app)/inbox/assist-actions.ts",
];
/** A parameter list that carries a thread id. */
const THREAD_PARAM = /\b(?:id|threadId|threadIds|ids|list)\??\s*:|\bthreadId\b|\bComposePayload\b|\bCreateSiteVisitInput\b|\bThreadTaskRequest\b/;
/** What counts as checking the owner before the write (directly, or by the
 *  one lib function the action hands the id to, each itself owner-checked). */
const OWNER_CHECK =
  /\bownThread\(|\bownThreadIds\(|await ids\(list\)|\bvisibleTo\(|\bloadThread\(|\bcreateTaskFromThread\(|\bsuggestTasksForThread\(|\bdraftReplyForThread\(|await (?:approveFiling|changeFiling|markNoise|notNoise|skipFiling|undoFiling|overrideCourt|undoPromiseTask|approveAllStrong|archiveFromOrganize|undoArchiveFromOrganize)\(/;

/** Every `export async function` in `src`: name, its parameter list (`header`)
 *  and its body. */
export function exportedActions(src: string): Array<{ name: string; header: string; body: string }> {
  const out: Array<{ name: string; header: string; body: string }> = [];
  const re = /export async function (\w+)\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const at = m.index;
    const end = src.indexOf("\n}\n", at);
    const body = src.slice(at, end < 0 ? undefined : end);
    // the parameter list: up to the matching ")" — never the return type
    const open = at + m[0].length - 1;
    let depth = 0;
    let close = open;
    for (let i = open; i < src.length; i++) {
      if (src[i] === "(") depth++;
      else if (src[i] === ")" && --depth === 0) {
        close = i;
        break;
      }
    }
    out.push({ name: m[1], header: src.slice(open + 1, close), body });
  }
  return out;
}

/** Source pins — the server actions can't run outside a request (requireUser). */
export function threadVisibilityPins(ok: Ok): void {
  const read = (f: string) => readFileSync(f, "utf8");
  const audited: string[] = [];
  const missing: string[] = [];
  for (const file of ACTION_FILES) {
    for (const a of exportedActions(read(file))) {
      if (!THREAD_PARAM.test(a.header)) continue;
      audited.push(a.name);
      if (!OWNER_CHECK.test(a.body)) missing.push(`${file.split("/").pop()}:${a.name}`);
    }
  }
  ok(audited.length >= 40 && missing.length === 0, `inbox action audit (#341): every exported action taking a thread id (found from the source: ${audited.length}) checks the owner before it writes` + (missing.length ? ` — unguarded: ${missing.join(", ")}` : ""));
  const demo = 'export async function okAction(id: string) {\n  const u = await requireUser();\n  if (!(await ownThread(id, u.name))) return;\n}\nexport async function badAction(threadId: string) {\n  await requireUser();\n  await archive(threadId);\n}\nexport async function otherAction(taskId: string) {\n  await x();\n}\n';
  const demoActs = exportedActions(demo);
  ok(
    demoActs.length === 3 && THREAD_PARAM.test(demoActs[1].header) && !OWNER_CHECK.test(demoActs[1].body) && OWNER_CHECK.test(demoActs[0].body) && !THREAD_PARAM.test(demoActs[2].header),
    "inbox action audit (#341): the harness finds a new unguarded thread-id action (and skips a non-thread id)"
  );
  ok(["markReadAction", "replyAction", "bulkArchiveAction", "linkThreadToCustomerAction", "createSiteVisitAction", "approveFilingAction", "createTaskFromThreadAction", "draftReplyAction", "archiveFromOrganizeAction", "undoArchiveFromOrganizeAction"].every((n) => audited.includes(n)), "inbox action audit (#341): the generated list covers the known thread actions");
  const guard = read("src/lib/inbox-thread-guard.ts");
  ok(/if \(!t \|\| !visibleTo\(t, viewer\)\) return null;\n  await stampMailboxOwner\(t, viewer\);/.test(guard), "inbox guard (#341, #349): ownThread is the mailbox owner check — by identity — and stamps the owner lazily");
  const apply = read("src/lib/inbox-org/apply.ts");
  ok(/if \(!t \|\| t\.deleted \|\| t\.status === "draft"\) return null;\n  const viewer = await viewerFor\(me\);\n  if \(!visibleTo\(t, viewer\)\) return null;/.test(apply), "inbox organize (#341, #349): apply.ts myThread stays the owner check behind every Organize action — by identity");
  ok(/linkedBy: t\.linkedBy \?\? null,/.test(apply) && /await linkThread\(t\.id, target\.customerId, t\.resolvedContactId \?\? null, "filing"\);/.test(apply), "filing (#341): fileThread links with linkedBy \"filing\" and snapshots the old flag for Undo");

  // resweeps a person triggers stay in their mailbox
  const links = read("src/app/(app)/inbox/link-actions.ts");
  ok(
    (links.match(/resweepThreads\(\{ (?:domain: d|email) \}, \{ owner: await mailboxViewer\(me\) \}\)/g) || []).length === 4 && !/resweepThreads\(\{[^}]*\}\);/.test(links),
    "resweep (#341): every resweep in link-actions (contact / customer quick-add, domain claim / release) is scoped to the acting user's mailbox"
  );
  const labels = read("src/lib/gmail/label-interpret.ts");
  ok(/\{ accountKey: key \}/.test(labels) && /linkThread\(t\.id, c\.id, null, t\.customerId === c\.id \? null : "user"\)/.test(labels) && /delete d\.linkedBy;/.test(labels), "Gmail labels (#341): a Peak/Customers label resweeps only that mailbox, a label echoing the app's own link keeps the flag, removing it un-shares");
  const linking = read("src/lib/gmail/linking.ts");
  ok(/await resweepThreads\(\{ email: e \}, scope \?\? \{ owner: await mailboxViewer\(addedBy\) \}\);/.test(linking) && /!\(sc\.owner && !ownsMailbox\(t, sc\.owner\)\)/.test(linking), "rememberAddress (#341, #349): its backlog resweep defaults to the acting person's mailbox, by identity");

  // renewal draft
  const ren = read("src/lib/renewal-outreach.ts");
  ok(/opts\.me\?\.id \? await findDraftByLink\(opts\.linkType, opts\.linkId, \{ owner: await mailboxViewer\(opts\.me\) \}\) : null/.test(ren), "renewal outreach (#341, #349): the draft lookup is the acting user's own mailbox, by identity");

  // triage
  const tri = read("src/app/(app)/triage/actions.ts");
  ok(
    (tri.match(/if \(!triageMayActOnThread\((?:t|thread), await mailboxViewer\(user\)\)\) return \{ ok: false, error: NOT_YOURS \};/g) || []).length === 2 &&
      tri.indexOf("const t = await getThread(plan.id);") < tri.indexOf('setThreadStatus(plan.id, "closed")') &&
      tri.indexOf("const thread = await getThread(parsed.id)") < tri.indexOf("await assignThread(parsed.id, target);") &&
      /const target = await actorByName\(String\(assignee \|\| ""\)\);/.test(tri),
    "triage (#341): Done and Reassign re-read the thread at action time and act only on my own or still-assigned thread"
  );
  const triPage = read("src/app/(app)/triage/page.tsx");
  ok(/const rows = viewingSelf \? view\.rows : await redactRowsForViewer\(view\.rows, user\);/.test(triPage) && /<TriageRows rows=\{rows\}/.test(triPage) && !/rows=\{view\.rows\}/.test(triPage), "triage admin view (#341): a teammate's rows are redacted on the server before they reach TriageRows");

  // bell
  const nav = read("src/lib/nav-counts.ts");
  ok(/!t\.deleted && \/\/ #341/.test(nav) && /href: `\/inbox\?thread=\$\{encodeURIComponent\(t\.id\)\}`,/.test(nav), "bell (#341): Customers waiting on a reply skips Deleted threads and links to the thread itself");

  // reader payload
  const inbox = read("src/app/(app)/inbox/page.tsx");
  ok(
    /if \(readOnly\) \{\s*reader = \{/.test(inbox) &&
      ["taskLinks: \\[\\]", "threadTasks: \\[\\]", "linkOptions: \\{ quote: \\[\\], lead: \\[\\], survey: \\[\\], inspection: \\[\\], project: \\[\\] \\}", "resolvedCustomerId: null", "customerCard: null", "linkedPeople: \\[\\]"].every((f) => new RegExp(f).test(inbox)) &&
      /isThreadLinked\(sel\) && sel\.customerId \?/.test(inbox),
    "reader (#341): a read-only thread ships no task / link / customer-card data, and names its customer only when deliberately linked (sel.customerId, never resolveCustomerId)"
  );
  const reader = read("src/app/(app)/inbox/thread-reader.tsx");
  ok(/\{vm\.readOnlyLinkedTo \? <span/.test(reader) && !/vm\.resolvedCustomerName \? \(\s*<span style=\{\{ fontWeight: 400 \}\}> · linked to/.test(reader), "reader (#341): the read-only banner's \"linked to\" uses readOnlyLinkedTo");

  // comms reads
  const comms = read("src/lib/stores/comms.ts");
  ok(/searchDocs<CommThread>\("comms", q, CANDIDATES, \{ where: ownMailboxCond\(user\) \}\)/.test(comms), "Inbox search (#341, #349): candidates cut to my own mailbox in SQL — by identity");
  ok(/\.\.\.\(partial\.customerId \|\| partial\.link \? \{ linkedBy: "user" as const \} : \{\}\)/.test(comms), "comms create (#341): a thread created with a picked customer or record is a deliberate link");

  // #349 — identity everywhere a mailbox is owned
  ok(/if \(mailbox === "personal" && !owner\) throw new Error\(NO_OWNER_ERROR\);/.test(comms) && /mailboxOwnerId: owner!\.id/.test(comms) && !/partial\.me \|\| DEFAULT_USER/.test(comms) && !/p\.me \|\| DEFAULT_USER/.test(comms), "creators (#349): comms create stamps the owner id and refuses a missing owner — DEFAULT_USER is display-only");
  const bridge = read("src/lib/gmail/bridge.ts");
  ok(/mailboxOwnerId: userIdOfKey\(key\)/.test(bridge) && /const uid = resolveMailboxOwnerId\(t, users\);\n  return uid \? personalKey\(uid\) : null;/.test(bridge) && /sameId\.find\(\(t\) => \(t\.gmailAccountKey \?\? keyForThreadWith\(t, users\)\) === key\)/.test(bridge), "Gmail bridge (#349): an imported thread is stamped with its account's user; the sending account follows the owner id, never a name; a reply attaches only within its own account");
  const userLabels = read("src/lib/gmail/user-labels.ts");
  ok(/const t = await ownThread\(threadId, me\);/.test(userLabels) && /t\.gmailAccountKey !== key\) return failWith\("no-gmail"\)/.test(userLabels), "Gmail labels (#347, #349): labels act only on my own thread (identity) bridged through my own key");
  const track = read("src/lib/estimate-email/track-server.ts");
  ok(!/sameName\(/.test(track) && (track.match(/ownedBy\(raw, await viewerOf\(deps, actor\)\)/g) || []).length === 2 && !/isLead/.test(track) && /return \{ id: [^}]*nameUnique: false \};/.test(track), "Send & track (#349 + review, Jeff 10-15 #25): reply and Mark read need the mailbox owner by identity; the text no longer follows a Lead-estimator check; a failed roster read fails closed (nameUnique false)");
  const settings = read("src/app/(app)/settings/actions.ts");
  ok(/const nameError = teamNameError\(name, await allUsers\(\)\);/.test(settings) && /teamNameError\(next, users, id\)/.test(settings), "Settings → Team (#349): add and rename refuse a blank or duplicate name");
  const renameSrc = settings.slice(settings.indexOf("export async function updateMemberAction"), settings.indexOf("export async function setRolesAction"));
  ok(
    /foldTeamName\(next\) !== foldTeamName\(current\?\.name\) \? teamNameError/.test(renameSrc) && /if \(current && next !== current\.name\) \{/.test(renameSrc) &&
      renameSrc.indexOf("await handOverNameOnly(") < renameSrc.indexOf("await updateUser(") && renameSrc.indexOf("await retireNameForNewcomer(next)") < renameSrc.indexOf("await updateUser(") &&
      /await retireNameForNewcomer\(name\);\n  await addUser\(/.test(settings),
    "Settings → Team (#349 review): a case-only rename saves (the fold is only the duplicate check); a rename pins the old name's mail and retires the new name BEFORE it is applied; a new user's name is retired before they are added"
  );
  const teamUi = read("src/app/(app)/settings/groups/team.tsx");
  ok(/const dupIds = duplicateNameIds\(users\);/.test(teamUi) && /Duplicate name/.test(teamUi) && /if \(!member\.ok\) return member;/.test(teamUi), "Settings → Team (#349): duplicates already on the team get a warning chip; a refused rename shows its error");
  const script = read("scripts/comms-stamp-owners.ts");
  ok(/const t = await applyOwnerStamps\(tombs\);/.test(script) && /const apply = args\.includes\("--apply"\);/.test(script) && /resolveExplicitDbTarget\(/.test(script) && /if \(apply\) requireHostedConfirmation\(target\.hosted, args\);/.test(script) && /"comms:stamp-owners": "tsx scripts\/comms-stamp-owners\.ts"/.test(read("package.json")), "comms:stamp-owners (#349): a dry run by default; --apply writes; a hosted DB also needs --yes; an explicit target only");
}

/** Jeff 2026-10-15 #26 (#351 review) — sharing an email through a task is the
 *  THREAD OWNER's act, stamped by the server (`threadShare`). Live task
 *  fields, a pushed document, a non-owner's re-assign and a promise-task share
 *  nothing. Pure rule + SQL parity + the real write paths. */
export function taskSharePureChecks(ok: Ok): void {
  const ME: MailboxViewer = { id: "u-me", name: "Me Person", nameUnique: true, taskThreadIds: new Set(["C-T1"]) };
  const t = base({ id: "C-T1" } as Partial<CommThread>);
  ok(canSeeThread(t, ME) && canOpenThread(t, ME) && !isOwnThread(t, ME) && !visibleTo(t, ME), "task share (#26): a shared thread is visible and opens, but is not mine (read-only)");
  ok(!canSeeThread(base({ id: "C-T2" } as Partial<CommThread>), ME), "task share (#26): a thread nobody shared with me stays hidden");
  ok(!canSeeThread({ ...t, deleted: true }, ME) && !canSeeThread({ ...t, status: "draft" }, ME), "task share (#26): never a deleted thread or another person's draft");
  ok(!canSeeThread(t, { ...ME, taskThreadIds: undefined }), "task share (#26): a viewer built without the task read (viewerFrom) shares nothing");
  ok(isTaskSharedTo(t, ME) && !isTaskSharedTo(base(), ME), "task share (#26): isTaskSharedTo — a Set lookup on the thread id");
  const stamp = (to: string) => ({ threadId: "C-T1", by: "u-owner", to, at: 1 });
  ok(
    taskSharesThread({ assigneeUserId: "u-me", threadShare: stamp("u-me") }, ME) === "C-T1" &&
      taskSharesThread({ assigneeUserId: "u-third", threadShare: stamp("u-me") }, ME) === null &&
      taskSharesThread({ assigneeUserId: "u-me", threadShare: stamp("u-third") }, ME) === null &&
      taskSharesThread({ assigneeUserId: "u-me", threadShare: null }, ME) === null &&
      taskSharesThread({ assigneeUserId: "u-me" } as never, ME) === null &&
      taskSharesThread({ assigneeUserId: "u-me", threadShare: stamp("u-me") }, { id: "", name: "", nameUnique: false }) === null,
    "task share (#351): only the server stamp naming me AND still matching the assignee shares; a re-assigned (stale) stamp, no stamp or a live threadId alone grant nothing"
  );
  const row = (key: string, title: string): SnapshotRow => ({ key, source: "email", title, sub: "Re: pricing", href: "/x", score: 1, reason: "r", callLine: null, also: [] });
  const red = redactEmailRows([row("email:C-T1", "Task Co"), row("email:C-T2", "Other Co")], new Map<string, T>([["C-T1", t], ["C-T2", base({ id: "C-T2" } as Partial<CommThread>)]]) as never, ME);
  ok(red[0].title === "Task Co" && red[1].title === PRIVATE_EMAIL_TITLE, "task share (#26): an admin's Start here view shows a shared email, redacts the rest");
  const cond = JSON.stringify(canSeeThreadCond(ME));
  ok(cond.includes('{"idIn":["C-T1"]}') && JSON.stringify(canSeeThreadCond({ ...ME, taskThreadIds: undefined })).includes('{"idIn":[]}'), "task share (#26): canSeeThreadCond filters the shared ids on the row id (idIn; none → matches nothing)");
  const sc = JSON.stringify(taskShareCond(ME));
  ok(sc.includes('"path":["threadShare","threadId"],"filled":"text"') && sc.includes('"path":["threadShare","to"],"is":"u-me"') && sc.includes('"path":["assigneeUserId"],"is":"u-me"') && !sc.includes('["threadId"]') && !sc.includes("assigneeName") && JSON.stringify(taskShareCond({ id: "", name: "", nameUnique: false })) === '{"any":[]}',
    "task share (#351): taskShareCond reads only the stamp (+ the matching assignee) — never the live threadId or a name");
  /* push sanitiser */
  const forged = { id: "T-x", title: "x", assigneeUserId: "u-me", threadId: "C-T1", threadShare: stamp("u-me") };
  const ins = sanitizePushedDoc("tasks", forged, null);
  ok(!("threadShare" in ins) && !("threadId" in ins) && ins.title === "x", "sync push (#351): an inserted task loses threadShare and threadId");
  const storedDoc = { id: "T-x", title: "old", assigneeUserId: "u-other", threadId: "C-REAL", threadShare: { threadId: "C-REAL", by: "u-owner", to: "u-other", at: 1 } };
  const upd = sanitizePushedDoc("tasks", { ...forged, title: "new" }, { doc: storedDoc, deleted: false });
  ok(upd.title === "new" && upd.threadId === "C-REAL" && JSON.stringify(upd.threadShare) === JSON.stringify(storedDoc.threadShare), "sync push (#351): an updated task keeps the stored threadId and threadShare, whatever the push sends");
  const rev = sanitizePushedDoc("tasks", { ...forged }, { doc: storedDoc, deleted: true });
  ok(rev.threadId === "C-REAL" && !("threadShare" in rev), "sync push (#351): a push that revives a deleted task brings no share stamp back");
  ok(sanitizePushedDoc("surveys", { id: "s", threadShare: 1 }, null).threadShare === 1 && SERVER_OWNED_FIELDS.tasks.join() === "threadShare,threadId", "sync push (#351): only the listed server-owned fields are touched");
}

export async function taskShareDbChecks(ok: Ok): Promise<void> {
  const { searchDocs, softDeleteDoc, getDoc } = await import("@/db/doc-store");
  const { createFixture, dropFixtures, fixtureId, registerFixture } = await import("./test-fixtures");
  const { mailboxViewer, taskThreadIdsFor } = await import("@/lib/mailbox-viewer");
  const { globalSearch } = await import("@/lib/search/global-search");
  const { loadThreadFor, loadThreadReadable } = await import("@/lib/assist/thread-access");
  const { ownThread } = await import("@/lib/inbox-thread-guard");
  const { createTaskFromThread } = await import("@/lib/inbox-task-write");
  const { createAskTask } = await import("@/lib/assist/ask-task-write");
  const { handOff } = await import("@/lib/task-plan/write");
  const { reshareTaskThread } = await import("@/lib/task-thread-share");
  const T = await import("@/lib/stores/tasks");
  const { getDb, seeded } = await import("@/db");
  const { users } = await import("@/db/schema");
  const { inArray } = await import("drizzle-orm");
  await seeded();
  const NOW = Date.UTC(2034, 6, 1, 15, 0);
  const OWNER = { id: "u-tv26-owner", name: "TV26 Owner" };
  const ME = { id: "u-tv26-me", name: "TV26 Me" };
  const THIRD = { id: "u-tv26-third", name: "TV26 Third" };
  const db = await getDb();
  await db.insert(users).values([OWNER, ME, THIRD].map((u, i) => ({ id: u.id, name: u.name, email: `tv26-${i}@peak.test`, roles: ["Estimator"], color: "#5b616e", initials: "TV", status: "active" as const, createdAt: NOW })));
  const id = (s: string) => fixtureId("tv26", s);
  const ids = { a: id("t-a"), ask: id("t-ask"), self: id("t-self"), legacy: id("t-legacy"), pushed: id("t-pushed"), promise: id("t-promise"), gone: id("t-gone"), hand: id("t-hand"), draft: id("t-draft") };
  const th = (tid: string, word: string, over: Record<string, unknown> = {}) => ({
    id: tid, mailbox: "personal", mailboxUser: OWNER.name, mailboxOwnerId: OWNER.id, unread: true, customerId: null, customer: "Quuxlefrond Hall",
    contactName: "Pat Q", contactEmail: "pat@quuxlefrond.test", subject: `Quuxlefrond ${word}`, channel: "email", status: "waiting_us", assignedTo: "", link: null,
    createdAt: NOW, updatedAt: NOW, messages: [{ id: "m1", at: NOW, direction: "in", channel: "email", author: "Pat Q", fromEmail: "pat@quuxlefrond.test", body: `Body ${word}` }], ...over,
  });
  const threads = Object.entries(ids).map(([k, v]) => th(v, k, k === "draft" ? { status: "draft" } : {}));
  const req = (threadId: string, assigneeUserId: string) => ({ threadId, title: "Follow up", notes: "", assigneeUserId, dueDate: "", linkKeys: [] });
  const made: string[] = [];
  const track = <X extends { id: string }>(t: X | null | undefined): X | null | undefined => {
    if (t) {
      registerFixture("tasks", t.id);
      made.push(t.id);
    }
    return t;
  };
  const sees = async (who: { id: string; name: string }, tid: string) => canSeeThread((await getDoc("comms", tid)) as never, await mailboxViewer(who));
  try {
    for (const t of threads) await createFixture("comms", t as never);

    /* the owner's own act shares */
    const a = await createTaskFromThread(req(ids.a, ME.id), OWNER);
    const at = a.ok ? track(a.task) : null;
    ok(a.ok && at?.threadShare?.to === ME.id && at.threadShare.by === OWNER.id && at.threadShare.threadId === ids.a && (await sees(ME, ids.a)) && !(await sees(THIRD, ids.a)),
      "task share db (#351): the owner's assign-from-email stamps the share — the assignee reads it, nobody else");
    const sk = await createAskTask({ title: "Ask task", notes: "", assigneeUserId: ME.id, dueDate: "", links: { threadId: ids.ask } as never }, OWNER);
    if (sk.ok) track(sk.task);
    ok(sk.ok && sk.task.threadShare?.to === ME.id && (await sees(ME, ids.ask)), "task share db (#351): Ask's task card, confirmed by the owner, shares too");
    const self = await createTaskFromThread(req(ids.self, ""), OWNER);
    if (self.ok) track(self.task);
    ok(self.ok && !self.task.threadShare && !(await sees(ME, ids.self)), "task share db (#351): an owner's task for themself shares nothing");
    const notMine = await createTaskFromThread(req(ids.a, THIRD.id), ME);
    ok(!notMine.ok, "task share db (#351): a non-owner can't create a task from the thread at all");

    /* live fields alone share nothing */
    await createFixture("tasks", T.normalizeTask({ id: id("k-legacy"), title: "Legacy", assigneeUserId: ME.id, assigneeName: ME.name, status: "open", threadId: ids.legacy, createdAt: NOW }) as never);
    ok(!(await sees(ME, ids.legacy)), "task share db (#351): a task that merely links the thread and is assigned to me (no stamp) shares nothing");

    /* a pushed task can't share (the route's sanitiser over a forged doc) */
    const forged = { id: id("k-pushed"), title: "Pushed", assigneeUserId: ME.id, assigneeName: ME.name, status: "open", threadId: ids.pushed, threadShare: { threadId: ids.pushed, by: OWNER.id, to: ME.id, at: NOW }, createdAt: NOW };
    await createFixture("tasks", sanitizePushedDoc("tasks", forged, null) as never);
    ok(!(await sees(ME, ids.pushed)) && !(await getDoc<{ id: string; threadId?: string }>("tasks", forged.id))?.threadId, "task share db (#351): a pushed task (insert) carrying a forged stamp and threadId shares nothing; both are dropped");
    const stored = await getDoc("tasks", at!.id);
    const pushedOver = sanitizePushedDoc("tasks", { ...(stored as object), id: at!.id, threadId: ids.pushed, threadShare: { threadId: ids.pushed, by: OWNER.id, to: ME.id, at: NOW } }, { doc: stored, deleted: false });
    await createFixture("tasks", pushedOver as never);
    ok((await sees(ME, ids.a)) && !(await sees(ME, ids.pushed)) && (await getDoc<{ id: string; threadId?: string }>("tasks", at!.id))?.threadId === ids.a, "task share db (#351): a pushed update keeps the stored threadId and stamp — it can't re-point the share");
    const route = readFileSync("src/app/api/sync/push/route.ts", "utf8");
    ok(/let doc: Record<string, unknown> = sanitizePushedDoc\(coll, \{ \.\.\.rec\.doc, id: rec\.id \}, existing\.length \? \{ doc: existing\[0\]\.doc, deleted: !!existing\[0\]\.deleted \} : null\);/.test(route), "sync push (#351): the push route sanitises every document before insert or update");

    /* a promise-task never shares */
    const p = await T.createTaskOnce({ id: id("k-promise"), title: "Promise", assigneeUserId: ME.id, assigneeName: ME.name, threadId: ids.promise, threadShare: { threadId: ids.promise, by: OWNER.id, to: ME.id, at: NOW } }, { id: "system", name: "System" });
    track(p);
    ok(!p.threadShare && !(await sees(ME, ids.promise)), "task share db (#351): a promise-task (createTaskOnce) never carries a share, even when one is passed");
    ok(!readFileSync("src/lib/inbox-org/ai-court.ts", "utf8").includes("threadShare"), "task share db (#351): applyPromises never sets threadShare");

    /* re-assigning: a non-owner's hand-off moves nothing; the owner's re-stamps */
    const h = await createTaskFromThread(req(ids.hand, ME.id), OWNER);
    const ht = h.ok ? track(h.task)! : null;
    ok(!!ht && (await sees(ME, ids.hand)), "task share db (#351): (setup) shared with me");
    const r1 = await handOff({ kind: "task", id: ht!.id, userId: THIRD.id }, ME);
    ok(r1.ok && !(await T.getTask(ht!.id))?.threadShare && !(await sees(THIRD, ids.hand)) && !(await sees(ME, ids.hand)), "task share db (#351): my (non-owner) hand-off to a third person shares nothing — with them or still with me");
    await T.updateTask(ht!.id, { assigneeUserId: ME.id, assigneeName: ME.name });
    await reshareTaskThread(ht!.id, ME);
    ok(!(await sees(ME, ids.hand)), "task share db (#351): updateTask back to me by a non-owner (updateTaskAction's path) shares nothing");
    const r2 = await handOff({ kind: "task", id: ht!.id, userId: THIRD.id }, OWNER);
    ok(r2.ok && (await T.getTask(ht!.id))?.threadShare?.to === THIRD.id && (await sees(THIRD, ids.hand)) && !(await sees(ME, ids.hand)), "task share db (#351): the owner's hand-off re-stamps the share for the new assignee");
    await T.patchTask(ht!.id, (t) => {
      t.assigneeUserId = ME.id;
      t.assigneeName = ME.name;
    });
    ok(!(await sees(ME, ids.hand)) && !(await sees(THIRD, ids.hand)), "task share db (#351): any other re-assign leaves the stamp inert (to ≠ assignee)");
    await T.updateTask(ht!.id, { threadShare: { threadId: ids.hand, by: OWNER.id, to: ME.id, at: NOW } } as never);
    ok(!(await sees(ME, ids.hand)), "task share db (#351): updateTask never takes a stamp from a patch");

    /* deleted task, draft thread */
    const g = await createTaskFromThread(req(ids.gone, ME.id), OWNER);
    if (g.ok) {
      track(g.task);
      await softDeleteDoc("tasks", g.task.id);
    }
    ok(g.ok && !(await sees(ME, ids.gone)), "task share db (#351): a deleted task shares nothing");

    /* parity, read-only, loaders */
    for (const who of [OWNER, ME, THIRD]) {
      const w = await mailboxViewer(who);
      const sqlIds = new Set((await searchDocs("comms", "quuxlefrond", 200, { where: canSeeThreadCond(w) })).map((d) => d.id));
      const mismatch = threads.filter((t) => sqlIds.has(t.id) !== canSeeThread(t as never, w)).map((t) => t.id);
      ok(mismatch.length === 0, `task share db (#26): canSeeThreadCond (SQL) === canSeeThread (JS), as ${who.name}` + (mismatch.length ? ` — differs on ${mismatch.join(", ")}` : ""));
    }
    const v = await mailboxViewer(ME);
    ok(v.taskThreadIds instanceof Set && v.taskThreadIds.has(ids.a) && (await taskThreadIdsFor({ id: "", name: "", nameUnique: false })).size === 0, "task share db (#26): the viewer carries a Set of shared thread ids; a blank viewer reads none");
    const k = ((await globalSearch("quuxlefrond", ME)).find((x) => x.label === "Email threads")?.items ?? []).map((i) => i.id);
    ok(k.includes(ids.a) && !k.includes(ids.legacy) && !k.includes(ids.pushed), "task share db (#26): ⌘K finds only the emails shared with me");
    ok(!!(await loadThreadReadable(ids.a, v)) && !(await loadThreadFor(ids.a, v)), "task share db (#26): Ask reads it; reply / task drafting stays own-only");
    ok(!(await ownThread(ids.a, v)) && !(await ownThread(ids.a, ME)) && !!(await ownThread(ids.a, OWNER)), "task share db (#26): every Inbox write guard still refuses the assignee — read-only");
  } finally {
    await dropFixtures("tv26");
    // the T-#### tasks are registered fixtures: the harness teardown (or the throwaway TEST_DB) removes them
    await db.delete(users).where(inArray(users.id, [OWNER.id, ME.id, THIRD.id]));
  }
}

/** Jeff 2026-10-15 #39 — the offline field pull serves field roles only
 *  (`create` holders: Estimator / Manager / Admin); a Reviewer-only user gets
 *  403 and the client engine stops pulling (no 60 s poll of refusals). */
export async function syncPullRoleChecks(ok: Ok): Promise<void> {
  const { mayPullFieldData } = await import("@/lib/sync/pull-collections");
  const { pullStopsOn } = await import("@/lib/sync/engine");
  const { ROLE_PERMS } = await import("@/lib/team");
  ok(mayPullFieldData(["Estimator"]) && mayPullFieldData(["Manager"]) && mayPullFieldData(["Admin"]) && mayPullFieldData(["Reviewer", "Estimator"]),
    "sync pull (#39): estimators, managers and admins pull the field set");
  ok(!mayPullFieldData(["Reviewer"]) && !mayPullFieldData([]) && !mayPullFieldData(null) && !mayPullFieldData(["Crew"]), "sync pull (#39): a Reviewer-only user (or no role) may not");
  ok(ROLE_PERMS.Reviewer.includes("approve") && !ROLE_PERMS.Reviewer.includes("create") && (["Admin", "Manager", "Estimator"] as const).every((r) => ROLE_PERMS[r].includes("create")), "sync pull (#39): `create` is exactly the field roles in ROLE_PERMS");
  ok(pullStopsOn(403) && !pullStopsOn(401) && !pullStopsOn(500) && !pullStopsOn(200), "sync pull (#39): only a 403 stops the client's pulling — a sign-out or a server error tries again later");
  const route = readFileSync("src/app/api/sync/pull/route.ts", "utf8");
  ok(/if \(!session\?\.user\?\.active\) \{[\s\S]{0,120}status: 401 \}\);\s*\}\s*if \(!mayPullFieldData\(session\.user\.roles\)\) \{\s*return NextResponse\.json\(\{ error: "forbidden" \}, \{ status: 403 \}\);/.test(route),
    "sync pull (#39): the route answers 403 to a non-field role before reading anything");
  const eng = readFileSync("src/lib/sync/engine.ts", "utf8");
  ok(/if \(!this\.connected\(\) \|\| this\.pullForbidden\) return;/.test(eng) && /if \(pullStopsOn\(res\.status\)\) \{[\s\S]{0,120}this\.pullForbidden = true;\s*if \(this\.pollTimer\) clearInterval\(this\.pollTimer\);/.test(eng),
    "sync pull (#39): on a 403 the engine stops the poll and never pulls again this page");
  const push = readFileSync("src/app/api/sync/push/route.ts", "utf8");
  ok(!push.includes("mayPullFieldData"), "sync pull (#39): push stays open to any active user (the field editors save through it)");
}

if (process.argv[1] && /test-thread-visibility\.ts$/.test(process.argv[1])) {
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
    threadVisibilityPureChecks(ok);
    await threadVisibilityDbChecks(ok);
    taskSharePureChecks(ok);
    await taskShareDbChecks(ok);
    await syncPullRoleChecks(ok);
    threadVisibilityPins(ok);
    console.log(fail ? `\n${fail} FAILED` : "\nall thread visibility checks passed");
    process.exit(fail ? 1 : 0);
  })().catch((err) => {
    console.log("FAIL " + (err instanceof Error ? err.stack || err.message : String(err)));
    process.exit(1);
  });
}
