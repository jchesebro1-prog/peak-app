/**
 * #340 thread visibility checks — "a user may see an email thread only if it
 * is their own, assigned to them, or linked to an entity" (Jeff, 2026-10-14).
 * Standalone: `npm run test:thread-visibility`; also chained into test:specs.
 *
 *  - pure: canSeeThread / isOwnThread / canOpenThread / isThreadLinked /
 *    readOnlyBanner, and canSeeThreadCond's shape;
 *  - DB: the SQL mirror (searchDocs `where`) answers exactly like the JS rule;
 *    ⌘K; the company page loader + activity feed; Ask's get_thread; the owner
 *    guard and every lib-level thread write refusing a non-own thread; reply
 *    / task drafting still own-only;
 *  - pins: every Inbox server action that takes a thread id checks the owner
 *    first; the reader opens only canOpenThread and is read-only off-mailbox.
 */
import { readFileSync } from "node:fs";
import {
  canOpenThread,
  canSeeThread,
  canSeeThreadCond,
  isAssignedTo,
  isOwnThread,
  isSharedThread,
  isThreadLinked,
  readOnlyBanner,
  visibleTo,
} from "@/lib/stores/comms-visibility";
import type { CommThread } from "@/lib/stores/comms";
import type { Ok } from "./test-inbox-org";

type T = Parameters<typeof canSeeThread>[0];
const base = (over: Partial<CommThread> = {}): T =>
  ({ mailbox: "personal", mailboxUser: "Other Person", status: "waiting_us", assignedTo: "", customerId: null, siteId: null, link: null, ...over }) as T;

export function threadVisibilityPureChecks(ok: Ok): void {
  const ME = "Me Person";
  const own = base({ mailboxUser: ME });
  ok(visibleTo(own, ME) && isOwnThread(own, ME) && canSeeThread(own, ME) && canOpenThread(own, ME), "visibility: my own thread — own, visible, opens");
  const priv = base();
  ok(!canSeeThread(priv, ME) && !canOpenThread(priv, ME) && !isOwnThread(priv, ME) && canSeeThread(priv, "Other Person"), "visibility: another user's unlinked thread is hidden from me, visible to its owner");
  ok(
    canSeeThread(base({ customerId: "C-1" }), ME) &&
      canSeeThread(base({ siteId: "S-1" }), ME) &&
      canSeeThread(base({ link: { type: "quote", id: "Q-1" } }), ME) &&
      canSeeThread(base({ linkedContactIds: ["P-1"] }), ME),
    "visibility: another user's thread linked by customerId / siteId / work link / linked people is visible"
  );
  ok(
    !canSeeThread(base({ link: { type: "quote", id: "" } }), ME) &&
      !canSeeThread(base({ link: { type: "", id: "Q-1" } }), ME) &&
      !canSeeThread(base({ linkedContactIds: [] }), ME) &&
      !canSeeThread(base({ customerId: "" }), ME),
    "visibility: a half link (no type or no id), an empty people list or an empty customerId is not a link"
  );
  ok(!canSeeThread(base({ resolvedContactId: "P-9" }), ME) && !isThreadLinked(base({ resolvedContactId: "P-9" })), "visibility: resolvedContactId alone (the automatic sender match) does NOT share a thread");
  ok(canSeeThread(base({ assignedTo: "  me person " }), ME) && isAssignedTo(base({ assignedTo: "ME PERSON" }), ME) && !isAssignedTo(base({ assignedTo: "" }), "") && !canSeeThread(base({ assignedTo: "Someone" }), ME), "visibility: assigned to me (trimmed, case-insensitive — triage's sameName) is visible; \"\" never matches");
  ok(
    !canSeeThread(base({ customerId: "C-1", deleted: true }), ME) && !canSeeThread(base({ assignedTo: ME, deleted: true }), ME) && !canSeeThread({ ...own, deleted: true }, ME) && canOpenThread({ ...own, deleted: true } as T, ME) && !isOwnThread({ ...own, deleted: true } as T, ME),
    "visibility: Deleted hides a thread from every listing (even mine); only the owner still opens their own from the Deleted folder; isOwnThread excludes Deleted"
  );
  ok(!canSeeThread(base({ customerId: "C-1", status: "draft" }), ME) && !canSeeThread(base({ assignedTo: ME, status: "draft" }), ME) && canSeeThread({ ...own, status: "draft" }, ME) && !isSharedThread(base({ customerId: "C-1", status: "draft" })), "visibility: another person's draft is never visible, even linked or assigned; my own draft is");
  const shared = base({ mailbox: "sales", mailboxUser: null, customerId: "C-1" });
  const legacyPriv = base({ mailbox: "sales", mailboxUser: null });
  ok(canSeeThread(shared, ME) && !isOwnThread(shared, ME) && !canSeeThread(legacyPriv, ME) && readOnlyBanner(shared) === "Shared mailbox — read only" && readOnlyBanner(priv) === "In Other Person’s mailbox — read only", "visibility: a legacy shared-box thread is nobody's own — visible only when linked, with the Shared mailbox banner");
  ok(!canSeeThread(base({ mailboxUser: "" }), "") && !isOwnThread(base({ mailboxUser: "" }), "") && !canOpenThread(base({ mailboxUser: "" }), ""), "visibility: an empty viewer name owns nothing");
  ok(isSharedThread(base({ customerId: "C-1" })) && !isSharedThread(base({ customerId: "C-1", deleted: true })) && !isSharedThread(own), "visibility: isSharedThread = linked, live, not a draft (the viewer-free feed rule)");
  const cond = JSON.stringify(canSeeThreadCond(ME));
  ok(
    cond.includes('"path":["deleted"],"isNot":"true"') &&
      cond.includes('"path":["mailboxUser"],"is":"Me Person"') &&
      cond.includes('"path":["assignedTo"],"isFolded":"me person"') &&
      cond.includes('"path":["status"],"isNot":"draft"') &&
      ["customerId", "siteId", "linkedContactIds"].every((f) => cond.includes(`"path":["${f}"],"filled"`)) &&
      cond.includes('"path":["link","type"],"filled":"text"') &&
      cond.includes('"path":["link","id"],"filled":"text"') &&
      !cond.includes("resolvedContactId"),
    "visibility: canSeeThreadCond mirrors canSeeThread branch for branch (no resolvedContactId)"
  );
  ok(!JSON.stringify(canSeeThreadCond("")).includes("mailboxUser"), "visibility: canSeeThreadCond with no viewer name has no own-mailbox branch");
}

export async function threadVisibilityDbChecks(ok: Ok): Promise<void> {
  const { searchDocs } = await import("@/db/doc-store");
  const { createFixture, dropFixtures, fixtureId } = await import("./test-fixtures");
  const { globalSearch } = await import("@/lib/search/global-search");
  const { visibleByCustomer } = await import("@/lib/stores/comms");
  const { loadCustomerFeed } = await import("@/lib/customer-feed");
  const { runReadTool } = await import("@/lib/assist/ask-tools-server");
  const { loadThreadFor, loadThreadReadable } = await import("@/lib/assist/thread-access");
  const { ownThread, ownThreadIds } = await import("@/lib/inbox-thread-guard");
  const { createTaskFromThread } = await import("@/lib/inbox-task-write");
  const apply = await import("@/lib/inbox-org/apply");
  const { draftReplyForThread } = await import("@/lib/assist/reply-server");
  const { suggestTasksForThread } = await import("@/lib/assist/tasks-server");
  const { assistSettingsOf } = await import("@/lib/assist/config");
  const { fakeProvider } = await import("./test-assist");
  const { seeded } = await import("@/db");
  await seeded();

  const ME = { id: "u-tv340-me", name: "TV340 Me", roles: ["admin"] };
  const OTHER = { id: "u-tv340-other", name: "TV340 Other", roles: ["admin"] };
  const NOW = Date.UTC(2034, 5, 1, 15, 0);
  const CID = fixtureId(340, "co");
  const id = (slug: string) => fixtureId(340, slug);
  const ids = {
    mine: id("t-mine"),
    mineDeleted: id("t-mine-deleted"),
    priv: id("t-priv"),
    co: id("t-co"),
    site: id("t-site"),
    work: id("t-work"),
    people: id("t-people"),
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
    th(ids.mineDeleted, ME.name, "minedeletedword", { customerId: CID, deleted: true }),
    th(ids.priv, OTHER.name, "privword"),
    th(ids.co, OTHER.name, "coword", { customerId: CID }),
    th(ids.site, OTHER.name, "siteword", { siteId: "LOC-340" }),
    th(ids.work, OTHER.name, "workword", { link: { type: "quote", id: "Q-340", label: "Quote" } }),
    th(ids.people, OTHER.name, "peopleword", { linkedContactIds: ["P-340"] }),
    th(ids.resolved, OTHER.name, "resolvedword", { resolvedContactId: "P-341" }),
    th(ids.assigned, OTHER.name, "assignedword", { assignedTo: ME.name }),
    th(ids.deleted, OTHER.name, "deletedword", { customerId: CID, deleted: true }),
    th(ids.draft, OTHER.name, "draftword", { customerId: CID, status: "draft" }),
    th(ids.sharedBox, null, "sharedboxword", { customerId: CID }),
  ];
  try {
    for (const f of fixtures) await createFixture("comms", f as never);

    /* the SQL mirror answers exactly like the JS rule, for both viewers */
    for (const who of [ME, OTHER]) {
      const sqlIds = new Set((await searchDocs("comms", "vizzlequark", 200, { where: canSeeThreadCond(who.name) })).map((d) => d.id));
      const mismatch = fixtures.filter((f) => sqlIds.has(f.id) !== canSeeThread(f as never, who.name)).map((f) => f.id);
      ok(mismatch.length === 0, `thread visibility db: canSeeThreadCond (SQL) === canSeeThread (JS) for every fixture, as ${who.name}` + (mismatch.length ? ` — differs on ${mismatch.join(", ")}` : ""));
    }
    const mineSql = new Set((await searchDocs("comms", "vizzlequark", 200, { where: canSeeThreadCond(ME.name) })).map((d) => d.id));
    ok(
      [ids.mine, ids.co, ids.site, ids.work, ids.people, ids.assigned, ids.sharedBox].every((x) => mineSql.has(x)) &&
        [ids.priv, ids.resolved, ids.deleted, ids.draft, ids.mineDeleted].every((x) => !mineSql.has(x)),
      "thread visibility db: as me — mine, linked (customer / venue / work / people), assigned and a linked shared-box thread; never another user's private, resolvedContactId-only, deleted or draft thread"
    );

    /* ⌘K */
    const k = async (q: string, who = ME) => ((await globalSearch(q, who)).find((g) => g.label === "Email threads")?.items ?? []).map((i) => i.id);
    ok((await k("vizzlequark privword")).length === 0 && (await k("privword")).length === 0 && (await k("privword", OTHER)).includes(ids.priv), "⌘K (#340): another user's unlinked thread is not in my results — it is in theirs");
    ok((await k("coword")).includes(ids.co) && (await k("assignedword")).includes(ids.assigned) && (await k("mineword")).includes(ids.mine), "⌘K (#340): a teammate's customer-linked thread, one assigned to me, and my own are found");
    ok((await k("deletedword")).length === 0 && (await k("minedeletedword")).length === 0 && (await k("draftword")).length === 0 && (await k("resolvedword")).length === 0, "⌘K (#340): Deleted threads (mine too), another person's draft and a resolvedContactId-only thread are never listed");
    const groups = await globalSearch("coword", ME);
    ok(groups.every((g) => Object.keys(g).join(",") === "label,items" && g.items.every((i) => Object.keys(i).join(",") === "id,title,sub,href,letter,color")) && groups.find((g) => g.label === "Email threads")?.items[0]?.href === `/inbox?thread=${encodeURIComponent(ids.co)}`, "⌘K (#340): output shape unchanged; a hit still opens /inbox?thread=");
    ok((await globalSearch("vizzlequark", { id: ME.id })).find((g) => g.label === "Email threads")?.items.every((i) => i.id !== ids.mine) ?? true, "⌘K (#340): with no viewer name, nobody's own mailbox matches");

    /* company page loader + feed */
    const page = (await visibleByCustomer(CID, ME.name)).map((t) => t.id);
    ok(page.includes(ids.co) && page.includes(ids.sharedBox) && !page.includes(ids.deleted) && !page.includes(ids.draft) && !page.includes(ids.mineDeleted), "company page (#340): every linked thread from any mailbox is listed; Deleted (mine too) and another person's draft are dropped");
    const feed = await loadCustomerFeed({ id: CID, name: "Vizzlequark Arts" }, ME.id);
    const feedThreads = new Set(feed.flatMap((r) => (r.href?.startsWith("/inbox?thread=") ? [decodeURIComponent(r.href.slice("/inbox?thread=".length))] : [])));
    ok(feedThreads.has(ids.co) && feedThreads.has(ids.sharedBox) && !feedThreads.has(ids.deleted) && !feedThreads.has(ids.draft) && !feedThreads.has(ids.mineDeleted), "activity feed (#340): linked threads stay (any mailbox); deleted and draft threads are dropped");
    const feedNoViewer = await loadCustomerFeed({ id: CID, name: "Vizzlequark Arts" });
    ok(feedNoViewer.filter((r) => r.href?.startsWith("/inbox?thread=")).length === feed.filter((r) => r.href?.startsWith("/inbox?thread=")).length, "activity feed (#340): the vendor page / company summary (no viewer) list the same shared threads");

    /* Ask */
    const gt = async (tid: string) => runReadTool("get_thread", { id: tid }, { id: ME.id, name: ME.name });
    const co = await gt(ids.co);
    const priv = await gt(ids.priv);
    const res = await gt(ids.resolved);
    ok(co.text.includes("Vizzlequark coword") && co.refs[0]?.id === ids.co && co.refs[0]?.readOnly === true, "Ask get_thread (#340): a teammate's customer-linked thread is readable (ref flagged read-only)");
    ok(!priv.text.includes("privword") && priv.refs.length === 0 && !res.text.includes("resolvedword") && res.refs.length === 0, "Ask get_thread (#340): a teammate's unlinked (or resolvedContactId-only) thread reads like a missing one");
    ok(!!(await loadThreadReadable(ids.assigned, ME.name)) && !(await loadThreadReadable(ids.deleted, ME.name)) && !(await loadThreadReadable(ids.mineDeleted, ME.name)), "loadThreadReadable (#340): assigned → readable; Deleted (even mine) → null");

    /* the owner guard + every lib-level write refuses a non-own thread */
    ok(!!(await ownThread(ids.mine, ME.name)) && !!(await ownThread(ids.mineDeleted, ME.name)) && !(await ownThread(ids.co, ME.name)) && !(await ownThread(ids.assigned, ME.name)) && !(await ownThread(ids.sharedBox, ME.name)) && !(await ownThread("", ME.name)) && !(await ownThread(ids.mine, "")), "inbox guard (#340): ownThread — my mailbox (Deleted included) only; linked, assigned and shared-box threads are refused");
    ok(JSON.stringify(await ownThreadIds([ids.mine, ids.co, ids.mine, ids.assigned, 5, ids.mineDeleted], ME.name)) === JSON.stringify([ids.mine, ids.mineDeleted]), "inbox guard (#340): ownThreadIds keeps (deduped, in order) only my own ids — the bulk actions' cut");
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
    ok(refusals.every((r) => !!r && typeof r === "object" && "ok" in r && r.ok === false), "inbox organize (#340): approve / noise / not-noise / skip / undo / change / court / archive-on-Mark-replied all refuse another mailbox's linked thread");
    const task = await createTaskFromThread({ threadId: ids.co, title: "x", notes: "", assigneeUserId: "", dueDate: "", linkKeys: [] }, ME);
    ok(!task.ok, "inbox task (#340): Create task refuses a linked thread in another mailbox");

    /* reply / task drafting stay own-only */
    const settings = assistSettingsOf({ assistUsers: [ME.id] });
    const env = { ANTHROPIC_API_KEY: "test" };
    const calls: unknown[] = [];
    const reply = await draftReplyForThread(ids.co, ME, { provider: fakeProvider("draft", { calls: calls as never }), settings, env, now: NOW });
    const tasks = await suggestTasksForThread(ids.assigned, ME, { provider: fakeProvider("{}", { calls: calls as never }), settings, env, now: NOW });
    ok(!reply.ok && reply.kind === "thread" && !tasks.ok && calls.length === 0, "Assist (#340): Draft reply refuses a linked non-own thread and Suggest tasks an assigned one — before any model call");
    ok(!(await loadThreadFor(ids.co, ME.name)) && !!(await loadThreadFor(ids.mine, ME.name)), "loadThreadFor (#340): the action rule stays own mailbox only");
  } finally {
    await dropFixtures(340);
  }
}

/** Source pins — the server actions can't run outside a request (requireUser). */
export function threadVisibilityPins(ok: Ok): void {
  const read = (f: string) => readFileSync(f, "utf8");
  const fnBody = (src: string, name: string): string => {
    const at = src.indexOf(`export async function ${name}(`);
    if (at < 0) return "";
    const end = src.indexOf("\n}\n", at);
    return src.slice(at, end < 0 ? undefined : end);
  };
  // file → every exported action that takes a thread id, and the check it runs before writing
  const audit: Array<[string, string[], RegExp]> = [
    [
      "src/app/(app)/inbox/actions.ts",
      ["markReadAction", "archiveAction", "unarchiveAction", "markUnreadAction", "flagAction", "pinAction", "categoryAction", "deleteAction", "restoreAction", "setStatusAction", "reopenAction", "assignAction", "setLinkAction", "setMessageLinkAction", "replyAction", "logNoteAction"],
      /if \(!(?:\(await )?ownThread\((?:id|threadId), user\.name\)|const thread = await ownThread\(threadId, user\.name\)/,
    ],
    ["src/app/(app)/inbox/actions.ts", ["bulkArchiveAction", "bulkDeleteAction", "bulkRestoreAction", "bulkMarkReadAction", "bulkFlagAction", "bulkCategoryAction"], /for \(const id of await ids\(list\)\)/],
    ["src/app/(app)/inbox/actions.ts", ["composeSendAction", "saveDraftAction"], /if \(!\(await ownThread\(d\.id, me\)\)\)/],
    ["src/app/(app)/inbox/link-actions.ts", ["linkThreadToCustomerAction", "dismissSuggestionAction", "setThreadSiteAction", "setIdentityMessageAction"], /if \(!t \|\| !visibleTo\(t, me\.name\)\)/],
    ["src/app/(app)/inbox/link-actions.ts", ["quickAddCustomerAction", "quickAddVenueAction"], /!visibleTo\(thread, me\.name\)/],
    ["src/app/(app)/inbox/link-popup-actions.ts", ["linkPopupDataAction", "fetchMessageCcAction", "fillContactBlanksAction"], /loadThread\(/],
    ["src/app/(app)/inbox/link-popup-actions.ts", ["setThreadContactsAction"], /visibleTo\(t, me\.name\)/],
    ["src/app/(app)/inbox/site-visit-actions.ts", ["createSiteVisitAction"], /if \(!\(await ownThread\(input\.adoptThreadId, me\.name\)\)\)/],
    ["src/app/(app)/inbox/task-actions.ts", ["createTaskFromThreadAction"], /createTaskFromThread\(req,/],
    ["src/app/(app)/inbox/assist-actions.ts", ["suggestTasksAction"], /suggestTasksForThread\(threadId,/],
    ["src/app/(app)/inbox/assist-actions.ts", ["draftReplyAction"], /draftReplyForThread\(threadId,/],
    ["src/app/(app)/inbox/organize-actions.ts", ["filingRecordsAction"], /!visibleTo\(t, me\.name\)/],
    [
      "src/app/(app)/inbox/organize-actions.ts",
      ["approveFilingAction", "changeFilingAction", "markNoiseAction", "notNoiseAction", "skipFilingAction", "undoFilingAction", "overrideCourtAction", "undoPromiseTaskAction"],
      /await (?:approveFiling|changeFiling|markNoise|notNoise|skipFiling|undoFiling|overrideCourt|undoPromiseTask)\(/,
    ],
  ];
  for (const [file, names, re] of audit) {
    const src = read(file);
    const missing = names.filter((n) => !re.test(fnBody(src, n)));
    ok(missing.length === 0, `inbox action audit (#340): ${file.split("/").pop()} — ${names.length} action(s) check the owner first` + (missing.length ? ` — missing: ${missing.join(", ")}` : ""));
  }
  const guard = read("src/lib/inbox-thread-guard.ts");
  ok(/return t && visibleTo\(t, me\) \? t : null;/.test(guard), "inbox guard (#340): ownThread is the mailbox owner check");
  const apply = read("src/lib/inbox-org/apply.ts");
  ok(/if \(!t \|\| t\.deleted \|\| t\.status === "draft" \|\| !visibleTo\(t, me\.name\)\) return null;/.test(apply), "inbox organize (#340): apply.ts myThread stays the owner check behind every Organize action");
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
