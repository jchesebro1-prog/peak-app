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
  isThreadLinked,
  readOnlyBanner,
  visibleTo,
} from "@/lib/stores/comms-visibility";
import { PRIVATE_EMAIL_TITLE, redactEmailRows, triageMayActOnThread } from "@/lib/triage/thread-access";
import type { CommThread } from "@/lib/stores/comms";
import type { SnapshotRow } from "@/lib/triage/types";
import type { Ok } from "./test-inbox-org";

type T = Parameters<typeof canSeeThread>[0];
const base = (over: Partial<CommThread> = {}): T =>
  ({ mailbox: "personal", mailboxUser: "Other Person", status: "waiting_us", assignedTo: "", channel: "email", customerId: null, siteId: null, link: null, ...over }) as T;
const filedOn = (customerId: string | null) =>
  ({ customerId, work: null, noise: false, source: "rule", reason: "", strength: "strong", needsReply: false, state: "filed", at: 1 }) as CommThread["filing"];

export function threadVisibilityPureChecks(ok: Ok): void {
  const ME = "Me Person";
  const own = base({ mailboxUser: ME });
  ok(visibleTo(own, ME) && isOwnThread(own, ME) && canSeeThread(own, ME) && canOpenThread(own, ME), "visibility: my own thread — own, visible, opens");
  ok(canSeeThread({ ...own, customerId: "C-1" }, ME), "visibility: my own thread with only an automatic customer match is still mine");
  const priv = base();
  ok(!canSeeThread(priv, ME) && !canOpenThread(priv, ME) && !isOwnThread(priv, ME) && canSeeThread(priv, "Other Person"), "visibility: another user's unlinked thread is hidden from me, visible to its owner");
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
  ok(canSeeThread(base({ assignedTo: "  me person " }), ME) && isAssignedTo(base({ assignedTo: "ME PERSON" }), ME) && !isAssignedTo(base({ assignedTo: "" }), "") && !canSeeThread(base({ assignedTo: "Someone" }), ME), "visibility: assigned to me (trimmed, case-insensitive — triage's sameName) is visible; \"\" never matches");
  ok(
    !canSeeThread(base({ customerId: "C-1", linkedBy: "user", deleted: true }), ME) && !canSeeThread(base({ assignedTo: ME, deleted: true }), ME) && !canSeeThread({ ...own, deleted: true }, ME) && canOpenThread({ ...own, deleted: true } as T, ME) && !isOwnThread({ ...own, deleted: true } as T, ME),
    "visibility: Deleted hides a thread from every listing (even mine); only the owner still opens their own from the Deleted folder; isOwnThread excludes Deleted"
  );
  ok(!canSeeThread(base({ customerId: "C-1", linkedBy: "user", status: "draft" }), ME) && !canSeeThread(base({ assignedTo: ME, status: "draft" }), ME) && canSeeThread({ ...own, status: "draft" }, ME) && !isSharedThread(base({ customerId: "C-1", linkedBy: "user", status: "draft" })), "visibility: another person's draft is never visible, even linked or assigned; my own draft is");
  const shared = base({ mailbox: "sales", mailboxUser: null, customerId: "C-1", linkedBy: "user" });
  const legacyPriv = base({ mailbox: "sales", mailboxUser: null, customerId: "C-1" });
  ok(canSeeThread(shared, ME) && !isOwnThread(shared, ME) && !canSeeThread(legacyPriv, ME) && readOnlyBanner(shared) === "Shared mailbox — read only" && readOnlyBanner(priv) === "In Other Person’s mailbox — read only", "visibility: a legacy shared-box thread is nobody's own — visible only when deliberately linked, with the Shared mailbox banner");
  ok(!canSeeThread(base({ mailboxUser: "" }), "") && !isOwnThread(base({ mailboxUser: "" }), "") && !canOpenThread(base({ mailboxUser: "" }), "") && !visibleTo(base({ mailboxUser: "" }), ""), "visibility: an empty viewer name owns nothing (visibleTo needs a name)");
  ok(isSharedThread(base({ customerId: "C-1", linkedBy: "filing" })) && !isSharedThread(base({ customerId: "C-1" })) && !isSharedThread(base({ customerId: "C-1", linkedBy: "user", deleted: true })) && !isSharedThread(own), "visibility: isSharedThread = deliberately linked, live, not a draft (the viewer-free feed rule)");
  const cond = JSON.stringify(canSeeThreadCond(ME));
  ok(
    cond.includes('"path":["deleted"],"isNot":"true"') &&
      cond.includes('"path":["mailboxUser"],"is":"Me Person"') &&
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
  ok(!JSON.stringify(canSeeThreadCond("")).includes("mailboxUser"), "visibility: canSeeThreadCond with no viewer name has no own-mailbox branch");

  /* triage */
  ok(
    triageMayActOnThread(own, ME) && triageMayActOnThread(base({ assignedTo: ME }), ME) && !triageMayActOnThread(base({ assignedTo: ME, deleted: true }), ME) && !triageMayActOnThread(base({ customerId: "C-1", linkedBy: "user" }), ME) && !triageMayActOnThread(priv, ME),
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
  await seeded();

  const ME = { id: "u-tv341-me", name: "TV341 Me", roles: ["admin"] };
  const OTHER = { id: "u-tv341-other", name: "TV341 Other", roles: ["admin"] };
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
      const sqlIds = new Set((await searchDocs("comms", "vizzlequark", 200, { where: canSeeThreadCond(who.name) })).map((d) => d.id));
      const mismatch = fixtures.filter((f) => sqlIds.has(f.id) !== canSeeThread(f as never, who.name)).map((f) => f.id);
      ok(mismatch.length === 0, `thread visibility db: canSeeThreadCond (SQL) === canSeeThread (JS) for every fixture, as ${who.name}` + (mismatch.length ? ` — differs on ${mismatch.join(", ")}` : ""));
    }
    const mineSql = new Set((await searchDocs("comms", "vizzlequark", 200, { where: canSeeThreadCond(ME.name) })).map((d) => d.id));
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
    const page = (await C.visibleByCustomer(CID, ME.name)).map((t) => t.id);
    ok(page.includes(ids.co) && page.includes(ids.filed) && page.includes(ids.sharedBox) && page.includes(ids.mineAuto) && !page.includes(ids.auto) && !page.includes(ids.deleted) && !page.includes(ids.draft) && !page.includes(ids.mineDeleted), "company page (#341): deliberately linked threads from any mailbox and my own; never a teammate's auto-matched thread, Deleted (mine too) or another person's draft");
    const feedIds = (rows: Array<{ href: string | null }>) => new Set(rows.flatMap((r) => (r.href?.startsWith("/inbox?thread=") ? [decodeURIComponent(r.href.slice("/inbox?thread=".length))] : [])));
    const feed = feedIds(await loadCustomerFeed({ id: CID, name: "Vizzlequark Arts" }, ME.id, ME.name));
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
    ok(!!(await loadThreadReadable(ids.assigned, ME.name)) && !(await loadThreadReadable(ids.deleted, ME.name)) && !(await loadThreadReadable(ids.mineDeleted, ME.name)), "loadThreadReadable (#341): assigned → readable; Deleted (even mine) → null");

    /* the owner guard + every lib-level write refuses a non-own thread */
    ok(!!(await ownThread(ids.mine, ME.name)) && !!(await ownThread(ids.mineDeleted, ME.name)) && !(await ownThread(ids.co, ME.name)) && !(await ownThread(ids.assigned, ME.name)) && !(await ownThread(ids.sharedBox, ME.name)) && !(await ownThread("", ME.name)) && !(await ownThread(ids.mine, "")), "inbox guard (#341): ownThread — my mailbox (Deleted included) only; linked, assigned and shared-box threads are refused");
    ok(JSON.stringify(await ownThreadIds([ids.mine, ids.co, ids.mine, ids.assigned, 5, ids.mineDeleted], ME.name)) === JSON.stringify([ids.mine, ids.mineDeleted]), "inbox guard (#341): ownThreadIds keeps (deduped, in order) only my own ids — the bulk actions' cut");
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
    ok(!(await loadThreadFor(ids.co, ME.name)) && !!(await loadThreadFor(ids.mine, ME.name)), "loadThreadFor (#341): the action rule stays own mailbox only");

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
    ok(!!afterMine && !canSeeThread(afterMine, OTHER.name) && canSeeThread(afterMine, ME.name), "resweep (#341): the automatically matched thread stays private to its owner");
    await resweepThreads({ email: SENDER });
    const sysOther = await C.get(swOther);
    ok(sysOther?.customerId === CID && !sysOther.linkedBy && !canSeeThread(sysOther, ME.name), "resweep (#341): a system resweep (no acting user) may link every mailbox, and what it links stays private");
    ok((await resweepThreads({ email: SENDER }, { mailboxUser: "" })) === 0, "resweep (#341): a blank scope touches nothing (never \"everything\")");

    /* deliberate links: linkThread flags, a label echo keeps, filing shares, Undo un-shares */
    await linkThread(swMine, CID, null);
    ok((await C.get(swMine))?.linkedBy === "user" && canSeeThread((await C.get(swMine))!, OTHER.name), "linkThread (#341): a person's link sets linkedBy \"user\" — now shared");
    const flMine = id("fl-other");
    await createFixture("comms", th(flMine, OTHER.name, "filingword", {
      customerId: CID, resolution: "linked", resolvedContactId: "P-auto",
      filing: { customerId: CID, work: null, noise: false, source: "rule", reason: "", strength: "strong", needsReply: false, state: "suggested", at: NOW },
    }) as never);
    const oActor = { id: OTHER.id, name: OTHER.name, roles: OTHER.roles };
    ok(!canSeeThread((await C.get(flMine))!, ME.name), "filing (#341): an auto-matched thread with a filing still only SUGGESTED is private");
    const approved = await apply.approveFiling(flMine, oActor);
    ok(approved.ok && canSeeThread((await C.get(flMine))!, ME.name), "filing (#341): Approve files it — the filed thread is shared with the team");
    const undone = await apply.undoFiling(flMine, oActor);
    ok(undone.ok && !canSeeThread((await C.get(flMine))!, ME.name), "filing (#341): Undo un-shares it again");
    const flNew = id("fl-other-new");
    await createFixture("comms", th(flNew, OTHER.name, "filingword2", {
      filing: { customerId: CID, work: null, noise: false, source: "rule", reason: "", strength: "strong", needsReply: false, state: "suggested", at: NOW },
    }) as never);
    const ap2 = await apply.approveFiling(flNew, oActor);
    const filedNew = await C.get(flNew);
    ok(ap2.ok && filedNew?.linkedBy === "filing" && filedNew.customerId === CID && canSeeThread(filedNew, ME.name), "filing (#341): filing an unlinked thread links it with linkedBy \"filing\" — shared");
    await apply.undoFiling(flNew, oActor);
    const undoneNew = await C.get(flNew);
    ok(!!undoneNew && !undoneNew.customerId && !undoneNew.linkedBy && !canSeeThread(undoneNew, ME.name), "filing (#341): Undo restores the previous flag (none) and customer — private again");

    /* renewal draft lookup: only my own live draft is reused */
    const JOB = id("flame-job");
    const theirDraft = await C.saveDraft({ mailbox: "personal", mailboxUser: OTHER.name, me: OTHER.name, to: "a@b.test", subject: "Renewal", body: "x", link: { type: "flame_job", id: JOB, label: "Job" } });
    extraComms.push(theirDraft.id);
    const mineDeletedDraft = await C.saveDraft({ mailbox: "personal", mailboxUser: ME.name, me: ME.name, to: "a@b.test", subject: "Renewal", body: "x", link: { type: "flame_job", id: JOB, label: "Job" } });
    extraComms.push(mineDeletedDraft.id);
    await C.softDelete(mineDeletedDraft.id);
    const renewal = { linkType: "flame_job" as const, linkId: JOB, linkLabel: "Job", customerId: CID, customer: "Vizzlequark Arts", contactName: "Pat", to: "a@b.test", copy: { subject: "Renewal", body: "Hello" }, attachment: { name: "q.pdf", mime: "application/pdf", size: 1, dataUrl: "data:application/pdf;base64,QQ==" }, me: ME.name };
    const myDraftId = await upsertRenewalDraft(renewal);
    extraComms.push(myDraftId);
    const myDraft = await C.get(myDraftId);
    ok(myDraftId !== theirDraft.id && myDraftId !== mineDeletedDraft.id && myDraft?.mailboxUser === ME.name && myDraft.status === "draft", "renewal outreach (#341): never reuses a teammate's draft or one of mine in Deleted — a new draft lands in my mailbox");
    ok((await upsertRenewalDraft(renewal)) === myDraftId, "renewal outreach (#341): my own live draft is reused (one renewal, one draft)");

    /* admin view of a teammate's Start here: redacted on the server */
    const snapRow = (tid: string): SnapshotRow => ({ key: `email:${tid}`, source: "email", title: "Vizzlequark Arts", sub: "Vizzlequark subject", href: `/inbox?thread=${tid}`, score: 1, reason: "Customer waiting", callLine: null, also: [] });
    const redacted = await redactRowsForViewer([snapRow(ids.priv), snapRow(ids.auto), snapRow(ids.co), snapRow(id("t-missing"))], ME.name);
    ok(
      redacted[0].title === PRIVATE_EMAIL_TITLE && redacted[0].sub === "" && redacted[0].href === "" && redacted[1].title === PRIVATE_EMAIL_TITLE && redacted[2].title === "Vizzlequark Arts" && redacted[3].title === PRIVATE_EMAIL_TITLE,
      "triage admin view (#341, DB): a teammate's private or auto-matched email is \"Private email\"; a shared one keeps its text; a missing thread is private"
    );

    /* Inbox search: other mailboxes can't crowd my own out of the 200 candidates */
    for (let i = 0; i < 205; i++) await createFixture("comms", th(id(`crowd-a${String(i).padStart(3, "0")}`), OTHER.name, "crowdword") as never);
    await createFixture("comms", th(id("crowd-zmine"), ME.name, "crowdword") as never);
    const found = await C.searchThreads("crowdword", { kind: "all" }, ME.name);
    ok(found.length === 1 && found[0].id === id("crowd-zmine"), "Inbox search (#341): my thread is found even when 205 of a teammate's matching threads sort first (SQL own-mailbox cut)");

    /* a blank viewer reads nothing */
    ok(
      (await C.threadsIn("personal", "inbox", "")).length === 0 && (await C.searchThreads("crowdword", { kind: "all" }, "")).length === 0 && (await C.folderCounts("personal", "")).inbox === 0 && (await C.unreadCount("")) === 0,
      "comms reads (#341): a blank viewer gets nothing — no DEFAULT_USER fallback"
    );
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
  /\bownThread\(|\bownThreadIds\(|await ids\(list\)|\bvisibleTo\(|\bloadThread\(|\bcreateTaskFromThread\(|\bsuggestTasksForThread\(|\bdraftReplyForThread\(|await (?:approveFiling|changeFiling|markNoise|notNoise|skipFiling|undoFiling|overrideCourt|undoPromiseTask|approveAllStrong)\(/;

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
  ok(["markReadAction", "replyAction", "bulkArchiveAction", "linkThreadToCustomerAction", "createSiteVisitAction", "approveFilingAction", "createTaskFromThreadAction", "draftReplyAction"].every((n) => audited.includes(n)), "inbox action audit (#341): the generated list covers the known thread actions");
  const guard = read("src/lib/inbox-thread-guard.ts");
  ok(/return t && visibleTo\(t, me\) \? t : null;/.test(guard), "inbox guard (#341): ownThread is the mailbox owner check");
  const apply = read("src/lib/inbox-org/apply.ts");
  ok(/if \(!t \|\| t\.deleted \|\| t\.status === "draft" \|\| !visibleTo\(t, me\.name\)\) return null;/.test(apply), "inbox organize (#341): apply.ts myThread stays the owner check behind every Organize action");
  ok(/linkedBy: t\.linkedBy \?\? null,/.test(apply) && /await linkThread\(t\.id, target\.customerId, t\.resolvedContactId \?\? null, "filing"\);/.test(apply), "filing (#341): fileThread links with linkedBy \"filing\" and snapshots the old flag for Undo");

  // resweeps a person triggers stay in their mailbox
  const links = read("src/app/(app)/inbox/link-actions.ts");
  ok(
    (links.match(/resweepThreads\(\{ (?:domain: d|email) \}, \{ mailboxUser: me\.name \}\)/g) || []).length === 4 && !/resweepThreads\(\{[^}]*\}\);/.test(links),
    "resweep (#341): every resweep in link-actions (contact / customer quick-add, domain claim / release) is scoped to the acting user's mailbox"
  );
  const labels = read("src/lib/gmail/label-interpret.ts");
  ok(/\{ accountKey: key \}/.test(labels) && /linkThread\(t\.id, c\.id, null, t\.customerId === c\.id \? null : "user"\)/.test(labels) && /delete d\.linkedBy;/.test(labels), "Gmail labels (#341): a Peak/Customers label resweeps only that mailbox, a label echoing the app's own link keeps the flag, removing it un-shares");
  const linking = read("src/lib/gmail/linking.ts");
  ok(/scope: ResweepScope = \{ mailboxUser: addedBy\.name \}/.test(linking) && /await resweepThreads\(\{ email: e \}, scope\);/.test(linking), "rememberAddress (#341): its backlog resweep defaults to the acting person's mailbox");

  // renewal draft
  const ren = read("src/lib/renewal-outreach.ts");
  ok(/opts\.me \? await findDraftByLink\(opts\.linkType, opts\.linkId, \{ mailboxUser: opts\.me \}\) : null/.test(ren), "renewal outreach (#341): the draft lookup is the acting user's own mailbox");

  // triage
  const tri = read("src/app/(app)/triage/actions.ts");
  ok(
    (tri.match(/if \(!triageMayActOnThread\((?:t|thread), user\.name\)\) return \{ ok: false, error: NOT_YOURS \};/g) || []).length === 2 &&
      tri.indexOf("const t = await getThread(plan.id);") < tri.indexOf('setThreadStatus(plan.id, "closed")') &&
      tri.indexOf("const thread = await getThread(parsed.id)") < tri.indexOf("await assignThread(parsed.id, target.name);"),
    "triage (#341): Done and Reassign re-read the thread at action time and act only on my own or still-assigned thread"
  );
  const triPage = read("src/app/(app)/triage/page.tsx");
  ok(/const rows = viewingSelf \? view\.rows : await redactRowsForViewer\(view\.rows, user\.name\);/.test(triPage) && /<TriageRows rows=\{rows\}/.test(triPage) && !/rows=\{view\.rows\}/.test(triPage), "triage admin view (#341): a teammate's rows are redacted on the server before they reach TriageRows");

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
  ok(/searchDocs<CommThread>\("comms", q, CANDIDATES, \{ fieldEquals: \{ mailbox: "personal", mailboxUser: user \} \}\)/.test(comms), "Inbox search (#341): candidates cut to my own mailbox in SQL");
  ok(/\.\.\.\(partial\.customerId \|\| partial\.link \? \{ linkedBy: "user" as const \} : \{\}\)/.test(comms), "comms create (#341): a thread created with a picked customer or record is a deliberate link");
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
    threadVisibilityPins(ok);
    console.log(fail ? `\n${fail} FAILED` : "\nall thread visibility checks passed");
    process.exit(fail ? 1 : 0);
  })().catch((err) => {
    console.log("FAIL " + (err instanceof Error ? err.stack || err.message : String(err)));
    process.exit(1);
  });
}
