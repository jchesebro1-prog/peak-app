import { requireUser } from "@/lib/session";
import { getSettings } from "@/lib/settings";
import { mergedVisitReasons } from "@/lib/stores/site-visits";
import { activeUsers, getUser } from "@/lib/users";
import { deriveInitials, fallbackColor, firstName } from "@/lib/team";
import { followUpCount } from "@/lib/stores/leads";
import { crmModeOn } from "@/lib/stores/notif-prefs";
import { groupCompanyOptions } from "@/lib/vendor-status";
import { all as allCustomers } from "@/lib/stores/customers";
import { getAll as allQuotes } from "@/lib/stores/quotes";
import { getAll as allSurveys } from "@/lib/stores/surveys";
import { getAll as allInspections } from "@/lib/stores/inspections";
import { getAllProjects } from "@/lib/stores/projects";
import {
  domainOf,
  GMAIL_MODIFY_SCOPE,
  gmailEnabled,
  isPublicDomain,
  personalKey,
} from "@/lib/gmail/config";
import { getConnectionInfo, listCachedLabels } from "@/lib/gmail/connections";
import { customersForDomain } from "@/lib/gmail/domains";
import {
  boxMeta,
  callsCount,
  CATEGORIES,
  categoryMeta,
  channelMeta,
  companyDomain,
  flaggedCount,
  folderCounts,
  forwardAddress,
  get as getThread,
  getAll as allThreads,
  hasQueued,
  lastMsg,
  mailboxes,
  mailboxLabelFor,
  needsReplyCount,
  participantsFor,
  resolveCustomerId,
  snippet,
  statusMeta,
  threadsIn,
  timeAgo,
  timeFull,
  visibleTo,
  waitingSince,
  waitLabel,
  type CommMessage,
  type CommThread,
  type FilterKey,
  type FolderId,
  type MailboxId,
  type SmartView,
  type SortKey,
} from "@/lib/stores/comms";
import type {
  ChanIcon,
  ComposeInit,
  ConnectionVM,
  CustomerVM,
  FolderRowVM,
  LabelOpt,
  ListVM,
  MessageVM,
  Opt,
  ReaderVM,
  SidebarVM,
  ThreadRowVM,
} from "./types";
import InboxShell from "./inbox-shell";
import HomeTabs from "../home-tabs";

export const metadata = { title: "Inbox — Quartzite-6" };

// #97 — the Gmail import/poll can take longer than the platform default
export const maxDuration = 60;

// One mailbox: the signed-in user's own connected Gmail account. The shared
// sales/installs/info boxes were retired (see comms.ts SHARED_BOXES).
const BOX_IDS = ["personal"] as const;
const FOLDER_IDS = [
  "inbox",
  "sent",
  "drafts",
  "outbox",
  "archived",
  "deleted",
] as const;
const FOLDERS: Array<[FolderId, string]> = [
  ["inbox", "Inbox"],
  ["sent", "Sent"],
  ["drafts", "Drafts"],
  ["outbox", "Outbox"],
  ["archived", "Archived"],
  ["deleted", "Deleted"],
];
const FILTER_KEYS: readonly string[] = [
  "unread",
  "flagged",
  "attachments",
  "tome",
  "needs",
];
const SORT_KEYS: readonly string[] = ["date", "from", "subject"];

function str(v: string | string[] | undefined): string {
  return typeof v === "string" ? v : "";
}

/** Gmail labels available to filter by, for whichever mailbox `box` resolves
 *  to for this user. Empty (not an error) when that mailbox has never synced
 *  — the label cache only exists after gmail/bridge.ts syncLabels has run. */
async function labelOptionsFor(box: MailboxId, userId: string): Promise<LabelOpt[]> {
  const key = box === "personal" ? personalKey(userId) : box;
  const rows = await listCachedLabels(key);
  return rows
    .map((r) => ({
      id: r.labelId,
      name: r.name,
      type: r.type,
      textColor: r.textColor,
      backgroundColor: r.backgroundColor,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

/** The "on contact" picker's options (#96): the contacts of whichever
 *  customer(s) the sidebar has in play — value = display name, which
 *  rememberAddress matches case-insensitively. With more than one
 *  customer (ambiguous) the label carries the customer so the pick is
 *  unambiguous. */
function contactOptionsFor(
  cs: Array<{ name: string; contacts?: Array<{ name?: string }> | null } | null | undefined>
): Opt[] {
  const live = cs.filter((c): c is NonNullable<typeof c> => !!c);
  const out: Opt[] = [];
  const seen = new Set<string>();
  for (const c of live) {
    for (const ct of c.contacts || []) {
      const nm = (ct.name || "").trim();
      if (!nm) continue;
      const key = `${c.name}::${nm.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ value: nm, label: live.length > 1 ? `${nm} · ${c.name}` : nm });
    }
  }
  return out;
}

function chanIconOf(channel: string): ChanIcon {
  const icon = channelMeta(channel).icon;
  return icon === "phone" ? "phone" : icon === "calendar" ? "calendar" : "mail";
}

function tagFor(m: CommMessage): string {
  if (m.channel === "email") return m.direction === "out" ? "Sent" : "Received";
  if (m.channel === "call")
    return m.direction === "out" ? "Outbound call" : "Inbound call";
  if (m.channel === "meeting") return "Meeting";
  return m.direction === "out" ? "Sent" : "Received";
}

const LINK_KIND_COLOR: Record<string, string> = {
  quote: "var(--accent)",
  survey: "#1f7a52",
  inspection: "#7b3f8a",
  project: "#b4543a",
  flame_job: "#b4543a",
};

function linkHref(link: { type: string; id: string }): string {
  const id = encodeURIComponent(link.id);
  if (link.type === "quote") return `/quotes?id=${id}`;
  if (link.type === "survey") return `/venue-assessments?id=${id}`;
  if (link.type === "inspection") return `/inspections?id=${id}`;
  if (link.type === "project") return `/projects`;
  if (link.type === "flame_job") return `/flame-tests/results?job=${id}`;
  return "#";
}

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const user = await requireUser();
  const me = user.name;
  const settings = await getSettings();
  const domain = companyDomain(settings.companyName);
  // Whose mailbox this is, in order of how much we actually know:
  //   1. the address Google authorized for this user's Gmail connection,
  //   2. their roster (company) email — what they sign in as since D126,
  //   3. the alternate Google account on their roster row (googleEmail is a
  //      sign-in fallback, e.g. a personal Gmail — never the mailbox).
  // Never the name+company-domain guess comms.ts falls back to — that invents
  // an address for anyone who isn't first-initial+lastname@company.
  const myKey = personalKey(user.id);
  const [connection, myRow] = await Promise.all([
    getConnectionInfo(myKey),
    getUser(user.id),
  ]);
  const myAddress =
    connection?.address || myRow?.email || myRow?.googleEmail || user.email;
  const boxOpts = {
    domain,
    userColor: user.color,
    personalAddress: myAddress || undefined,
  };

  /* ---- resolve nav state from the URL (the URL drives everything) ---- */
  const viewParam = str(params.view);
  const view: SmartView | "unmatched" | null =
    viewParam === "needs" ||
    viewParam === "calls" ||
    viewParam === "flagged" ||
    viewParam === "unmatched"
      ? viewParam
      : null;

  const filter: FilterKey | null = FILTER_KEYS.includes(str(params.filter))
    ? (str(params.filter) as FilterKey)
    : null;
  const labelId = str(params.label) || null;
  // An explicit ?sort= from the Sort dropdown overrides each mode's default
  // ordering (plain = date-desc, CRM = waiting-first — see comms.ts
  // threadsIn). With no param, sortParam is null and both threadsIn and the
  // ListVM below treat that as "no explicit sort chosen" rather than lying
  // and calling it "date" (punch #42 finding 1 — see sort-defaults.ts).
  const sortExplicit = SORT_KEYS.includes(str(params.sort));
  const sortParam: SortKey | null = sortExplicit ? (str(params.sort) as SortKey) : null;
  let box: MailboxId = (BOX_IDS as readonly string[]).includes(str(params.box))
    ? (str(params.box) as MailboxId)
    : "personal";
  let folder: FolderId = (FOLDER_IDS as readonly string[]).includes(
    str(params.folder)
  )
    ? (str(params.folder) as FolderId)
    : "inbox";

  const threadParam = str(params.thread);
  const explicitThread = threadParam ? await getThread(threadParam) : null;
  // deep links carry only ?thread= (global search does) — land in its mailbox
  if (explicitThread && !params.box && !view) {
    box = explicitThread.mailbox === "personal" ? "personal" : explicitThread.mailbox;
    folder = "inbox";
  }

  // ?draft=<threadId> (IDEAS #36) — open a saved draft straight in the
  // composer (the ✉ renewal outreach redirects here after landing its draft)
  const draftParam = str(params.draft);
  const draftThread = draftParam ? await getThread(draftParam) : null;
  const openDraftThread =
    draftThread && draftThread.status === "draft" ? draftThread : null;

  const isView = !!view;
  const isDrafts = !isView && folder === "drafts";

  // Read up front (punch #42): threadsIn's opts.crmMode needs the resolved
  // value, so it can't sit in the Promise.all below alongside threadsIn itself.
  const crmMode = await crmModeOn(me);

  /* ---- parallel loads ---- */
  const [
    boxes,
    personalCounts,
    needsCount,
    callsCnt,
    flaggedCnt,
    allComms,
    leadFollow,
    queriedThreads,
    roster,
    customers,
    labelOptions,
  ] = await Promise.all([
    Promise.resolve(mailboxes(me, boxOpts)),
    folderCounts("personal", me),
    needsReplyCount(me),
    callsCount(me),
    flaggedCount(me),
    view === "unmatched" ? allThreads() : Promise.resolve([] as CommThread[]),
    followUpCount({ unownedOrMine: true, me }),
    // Unmatched builds its own list from allComms — skip the query it would discard.
    view === "unmatched"
      ? Promise.resolve([] as CommThread[])
      : threadsIn(view ?? box, view ? "inbox" : folder, me, {
          filter,
          sort: sortParam,
          crmMode,
          labelId,
        }),
    activeUsers(),
    allCustomers(),
    labelOptionsFor(box, user.id),
  ]);

  // Threads worth linking to a customer but not yet linked (#96 §5) — any
  // channel, but only the mailbox the signed-in user can see (same rule as
  // every other view), never deleted, never a draft, not already resolved.
  const isUnmatched = (t: CommThread) =>
    visibleTo(t, me) &&
    !t.deleted &&
    t.status !== "draft" &&
    !t.customerId &&
    t.resolution !== "linked";
  const unmatchedCnt = allComms.filter(isUnmatched).length;
  const threads = view === "unmatched" ? allComms.filter(isUnmatched) : queriedThreads;

  const countsFor = { personal: personalCounts } as const;

  const rosterIdent = new Map(
    roster.map((u) => [u.name, { initials: u.initials, color: u.color }])
  );
  const initialsOf = (n?: string | null) =>
    n ? rosterIdent.get(n)?.initials || deriveInitials(n) : "—";
  const colorOf = (n?: string | null) =>
    n ? rosterIdent.get(n)?.color || fallbackColor(n) : "#c9ccd3";

  /* ---- sidebar ---- */
  const folderHref = (b: string, f: string) => `/inbox?box=${b}&folder=${f}`;
  const viewHref = (v: string) => `/inbox?view=${v}`;

  const foldersFor = (boxId: "personal"): FolderRowVM[] => {
    const counts = countsFor[boxId];
    const rows: FolderRowVM[] = [];
    for (const [key, label] of FOLDERS) {
      const active = !isView && box === boxId && folder === key;
      let count = 0;
      let badge: FolderRowVM["badge"] = "plain";
      if (key === "inbox") {
        count = counts.inboxUnread;
        badge = "accent";
      } else if (key === "drafts") count = counts.drafts;
      else if (key === "outbox") count = counts.outbox;
      else if (key === "archived") count = counts.archived;
      else if (key === "deleted") count = counts.deleted;
      // hide empty archived/outbox/deleted rows to reduce noise (prototype rule)
      if (
        (key === "archived" || key === "outbox" || key === "deleted") &&
        count === 0 &&
        !active
      )
        continue;
      rows.push({
        key,
        label,
        active,
        count,
        badge,
        href: folderHref(boxId, key),
        icon: key,
      });
    }
    return rows;
  };

  /* ---- real Gmail connection state (no more hardcoded "Connected") ---- */
  const connectionVM: ConnectionVM = !gmailEnabled()
    ? {
        state: "off",
        label: "Local mail only",
        detail: "Gmail sync is off for this deployment",
        color: "#aab0bb",
        actionHref: "",
        actionLabel: "",
        canSync: false,
        lastSync: "",
      }
    : !connection
      ? {
          state: "none",
          label: "Not connected",
          detail: "Authorize your Google account to load mail",
          color: "#c25a4a",
          actionHref: "/api/gmail/connect?mailbox=" + encodeURIComponent(myKey),
          actionLabel: "Connect Gmail",
          canSync: false,
          lastSync: "",
        }
      : !(connection.scope || "").split(/\s+/).includes(GMAIL_MODIFY_SCOPE)
        ? {
            state: "stale",
            label: "Reconnect needed",
            detail: connection.address,
            color: "#c9972f",
            actionHref: "/api/gmail/connect?mailbox=" + encodeURIComponent(myKey),
            actionLabel: "Reconnect",
            canSync: true,
            lastSync: connection.lastSyncAt ? timeAgo(connection.lastSyncAt) : "",
          }
        : {
            state: "ok",
            label: "Connected",
            detail: connection.address,
            color: "#3fae74",
            actionHref: "",
            actionLabel: "",
            canSync: true,
            lastSync: connection.lastSyncAt ? timeAgo(connection.lastSyncAt) : "",
          };

  const personalBox = boxes[0];
  const sidebar: SidebarVM = {
    personal: {
      label: `${personalBox.label} (me)`,
      address: personalBox.address,
      color: personalBox.color,
      initials: initialsOf(me),
    },
    personalFolders: foldersFor("personal"),
    connection: connectionVM,
    views: [
      {
        key: "needs",
        label: "Needs reply",
        active: view === "needs",
        count: needsCount,
        badge: "red",
        href: viewHref("needs"),
        icon: "needs",
      },
      {
        key: "flagged",
        label: "Flagged",
        active: view === "flagged",
        count: flaggedCnt,
        badge: "plain",
        href: viewHref("flagged"),
        icon: "flagged",
      },
      {
        key: "calls",
        label: "Calls & meetings",
        active: view === "calls",
        count: callsCnt,
        badge: "plain",
        href: viewHref("calls"),
        icon: "calls",
      },
      {
        key: "unmatched",
        label: "Unmatched",
        active: view === "unmatched",
        count: unmatchedCnt,
        badge: "plain",
        href: viewHref("unmatched"),
        icon: "needs",
      },
    ],
    leadFollowCount: leadFollow,
    forwardAddr: forwardAddress(domain),
  };

  /* ---- thread list ---- */
  const rowFor = (t: CommThread): ThreadRowVM => {
    const unread = !!t.unread && !isDrafts;
    const sm = statusMeta(t.status);
    const nm = isDrafts
      ? "To: " + (t.draft?.to || t.contactEmail || "—")
      : t.customer || t.contactName || "Customer";
    const bm = boxMeta(t.mailbox || "personal", t.mailboxUser || undefined, {
      domain,
      userColor: t.mailboxUser === me ? user.color : undefined,
      personalAddress: t.mailboxUser === me ? myAddress : undefined,
    });
    const snip = snippet(t);
    const cat = categoryMeta(t.category);
    return {
      id: t.id,
      unread,
      isDraft: t.status === "draft",
      flagged: !!t.flagged,
      pinned: !!t.pinned,
      categoryColor: cat?.color || "",
      categoryLabel: cat?.label || "",
      labels: labelOptions
        .filter((l) => l.type === "user")
        .filter((l) => (t.messages || []).some((m) => (m.gmailLabelIds || []).includes(l.id)))
        .slice(0, 3),
      name: nm,
      msgCount: (t.messages || []).length,
      participants: participantsFor(t),
      subject: t.subject || "(no subject)",
      snippet: snip,
      time: timeAgo(t.updatedAt),
      waitingUs: t.status === "waiting_us",
      chan: chanIconOf(t.channel),
      showStatus:
        !isDrafts &&
        (t.status === "replied" ||
          t.status === "closed" ||
          t.status === "waiting_them"),
      statusLabel: sm.label,
      statusInk: sm.ink,
      statusSoft: sm.soft,
      statusBd: sm.bd,
      showWait: t.status === "waiting_us",
      waitLabel: waitLabel(waitingSince(t)),
      showQueued: hasQueued(t),
      showBoxTag: isView,
      boxTag: mailboxLabelFor(t),
      boxColor: bm?.color || "#8c919c",
      showAssignee: (box !== "personal" || isView) && !!t.assignedTo,
      assignee: t.assignedTo || "Unassigned",
      assigneeInitials: initialsOf(t.assignedTo),
      assigneeColor: colorOf(t.assignedTo),
      haystack: [t.customer, t.subject, t.contactName, t.contactEmail, snip]
        .map((s) => (s || "").toLowerCase())
        .join(" "),
      draft:
        t.status === "draft"
          ? {
              mailbox: t.mailbox || "personal",
              to: t.draft?.to || t.contactEmail || "",
              cc: t.draft?.cc || "",
              subject: t.draft?.subject || t.subject || "",
              body: t.draft?.body || "",
              customerId: t.customerId || "",
              contactName: t.contactName || "",
              attachments: (t.draft?.attachments || []).map((a) => ({
                name: a.name,
                size: a.size,
              })),
            }
          : null,
    };
  };

  let listTitle: string;
  let listSub: string;
  if (view === "needs") {
    listTitle = "Needs reply";
    listSub = "Customers waiting on us — across every mailbox";
  } else if (view === "flagged") {
    listTitle = "Flagged";
    listSub = "Flagged for follow-up — across every mailbox";
  } else if (view === "calls") {
    listTitle = "Calls & meetings";
    listSub = "Logged phone calls and meetings";
  } else if (view === "unmatched") {
    listTitle = "Unmatched";
    listSub = "Email not yet linked to a customer — link it once and the rest follows";
  } else {
    const bm = boxMeta(box, me, boxOpts);
    const fl = FOLDERS.find((f) => f[0] === folder);
    listTitle = bm?.label || firstName(me);
    listSub = (fl ? fl[1] : "Inbox") + " · " + (bm?.address || "");
  }

  const isDeleted = !isView && folder === "deleted";
  const list: ListVM = {
    title: listTitle,
    sub: listSub,
    rows: threads.map(rowFor),
    emptyKind: isDrafts
      ? "drafts"
      : isDeleted
        ? "deleted"
        : !isView && folder === "outbox"
          ? "outbox"
          : view === "needs"
            ? "needs"
            : view === "flagged"
              ? "flagged"
              : view === "unmatched"
                ? "unmatched"
                : "",
    boxSelValue: view ? view : `${box}:${folder}`,
    filter: filter || "",
    label: labelId || "",
    labelOptions,
    sort: sortParam || "",
    isDeleted,
  };

  /* ---- reader (explicit ?thread= or desktop auto-select) ---- */
  const autoThread = !isDrafts
    ? threads.find((t) => t.status !== "draft") || null
    : null;
  const sel = explicitThread ?? autoThread;

  let reader: ReaderVM | null = null;
  if (sel) {
    const sm = statusMeta(sel.status);
    const cm = channelMeta(sel.channel);
    const bm = boxMeta(sel.mailbox || "personal", sel.mailboxUser || undefined, {
      domain,
      userColor: sel.mailboxUser === me ? user.color : undefined,
      personalAddress: sel.mailboxUser === me ? myAddress : undefined,
    });
    const resolvedCid = await resolveCustomerId(sel);
    const resolvedCustomer = resolvedCid
      ? customers.find((c) => c.id === resolvedCid)?.name || sel.customer
      : "";

    // strictly this customer's records (no fall-back to everything)
    const nameToId = new Map(
      customers.map((c) => [(c.name || "").toLowerCase(), c.id])
    );
    let linkOptions: ReaderVM["linkOptions"] = {
      quote: [],
      survey: [],
      inspection: [],
      project: [],
    };
    // Loaded only for a resolved customer (the link picker + the sidebar's
    // customer card); an unlinked thread has nothing to count.
    let quotes: Awaited<ReturnType<typeof allQuotes>> = [];
    let projects: Awaited<ReturnType<typeof getAllProjects>> = [];
    if (resolvedCid) {
      const [q, surveys, inspections, p] = await Promise.all([
        allQuotes(),
        allSurveys(),
        allInspections(),
        getAllProjects(),
      ]);
      quotes = q;
      projects = p;
      linkOptions = {
        quote: quotes
          .filter(
            (q) =>
              (q.customerId && q.customerId === resolvedCid) ||
              nameToId.get((q.customer || "").toLowerCase()) === resolvedCid
          )
          .map((q) => ({ value: q.id, label: `${q.id} · ${q.name || "Quote"}` })),
        survey: surveys
          .filter((s) => s.customerId === resolvedCid)
          .map((s) => ({
            value: s.id,
            label: `${s.id} · ${s.venue || s.venueType || "Survey"}`,
          })),
        inspection: inspections
          .filter((i) => i.customerId === resolvedCid)
          .map((i) => ({
            value: i.id,
            label: `${i.id} · ${i.venue || "Inspection"}`,
          })),
        project: projects
          .filter((p) => p.customerId === resolvedCid)
          .map((p) => ({
            value: p.id,
            label: `${p.id} · ${p.name || "Project"}`,
          })),
      };
    }

    // D76 — schedule-site-visit modal data (venues/contacts of the resolved
    // customer, the Settings reason picklist, and the team for assignment)
    let visit: ReaderVM["visit"] = null;
    if (resolvedCid) {
      const cust = customers.find((c) => c.id === resolvedCid) || null;
      visit = {
        venues: (cust?.locations || []).map((l, i) => ({
          id: l.id || "l" + i,
          label: l.label || "Venue",
          address: [l.address, [l.city, l.state].filter(Boolean).join(", ")]
            .filter(Boolean)
            .join(", "),
          primary: !!l.primary,
        })),
        contacts: (cust?.contacts || []).map((ct) => ({
          name: ct.name,
          email: ct.email || "",
          phone: ct.phone || "",
          primary: !!ct.primary,
        })),
        reasons: mergedVisitReasons(settings.visitReasons),
        team: roster.map((u) => u.name),
        me,
      };
    }

    // #96 §2 — link sidebar state. A customer on the thread (stored, or
    // resolved via a known contact address) wins over whatever the sync
    // stamped; a dismissed suggestion (resolution back to "unknown",
    // suggestedCustomerId still set) is never re-offered.
    const linkedCustomer = resolvedCid
      ? customers.find((c) => c.id === resolvedCid) || null
      : null;
    const senderDomain = domainOf(sel.contactEmail || "");
    const senderIsPublicDomain = !senderDomain || isPublicDomain(senderDomain);
    // One query, only when a customer is linked and the domain is claimable
    // — drives the linked card's "Emails from @domain link here · Stop".
    const domainClaimedByThisCustomer =
      !!linkedCustomer && !senderIsPublicDomain
        ? (await customersForDomain(senderDomain)).some((r) => r.customerId === linkedCustomer.id)
        : false;
    let resolution: ReaderVM["resolution"] = linkedCustomer
      ? "linked"
      : sel.resolution && sel.resolution !== "linked"
        ? sel.resolution
        : "unknown";
    const suggestedCustomer =
      resolution === "suggested" && !sel.suggestionDismissed && sel.suggestedCustomerId
        ? customers.find((c) => c.id === sel.suggestedCustomerId) || null
        : null;
    if (resolution === "suggested" && !suggestedCustomer) resolution = "unknown";
    const candidates = (sel.candidates || []).filter((c) =>
      customers.some((x) => x.id === c.customerId)
    );
    if (resolution === "ambiguous" && candidates.length === 0) resolution = "unknown";
    const contactsAtDomain = suggestedCustomer
      ? (suggestedCustomer.contacts || []).filter(
          (ct) => domainOf(ct.email || "") === senderDomain
        ).length
      : 0;
    const senderEmailLc = (sel.contactEmail || "").trim().toLowerCase();
    const customerCard: ReaderVM["customerCard"] = linkedCustomer
      ? {
          id: linkedCustomer.id,
          name: linkedCustomer.name,
          tier: linkedCustomer.pricingTier || "Base",
          // "open" mirrors Home's pipeline definition (draft | sent) and
          // Reports' Installs book (stage !== complete)
          openQuotes: quotes.filter(
            (q) =>
              (q.status === "draft" || q.status === "sent") &&
              ((q.customerId && q.customerId === linkedCustomer.id) ||
                nameToId.get((q.customer || "").toLowerCase()) === linkedCustomer.id)
          ).length,
          openProjects: projects.filter(
            (p) => p.customerId === linkedCustomer.id && p.stage !== "complete"
          ).length,
          contactName:
            (senderEmailLc &&
              (linkedCustomer.contacts || []).find(
                (ct) => (ct.email || "").trim().toLowerCase() === senderEmailLc
              )?.name) ||
            "",
        }
      : null;

    const messages: MessageVM[] = (sel.messages || []).map((m) => ({
      id: m.id,
      author: m.author,
      initials: initialsOf(m.author),
      color: colorOf(m.author),
      out: m.direction === "out",
      tag: tagFor(m),
      queued: !!m.queued,
      time: timeFull(m.at),
      body: m.body,
      attachments: (m.attachments || []).map((a) => ({
        name: a.name,
        mime: a.mime,
        size: a.size,
        dataUrl: a.dataUrl,
      })),
    }));

    reader = {
      id: sel.id,
      unread: !!sel.unread,
      archived: !!sel.archived || sel.gmailInboxed === false,
      subject: sel.subject,
      status: sel.status,
      statusLabel: sm.label,
      statusInk: sm.ink,
      statusSoft: sm.soft,
      statusBd: sm.bd,
      waitingUs: sel.status === "waiting_us",
      waitLabel: waitLabel(waitingSince(sel)),
      isEmail: sel.channel === "email",
      chanLabel: cm.label,
      chanIcon: chanIconOf(sel.channel),
      boxLabel: bm?.label || "Info",
      boxAddress: bm?.address || "",
      boxColor: bm?.color || "#8a6d1f",
      contactName: sel.contactName || "Customer",
      contactEmail: sel.contactEmail || "",
      contactInitials: initialsOf(sel.contactName || "C"),
      contactColor: colorOf(sel.contactName || "C"),
      assignedTo: sel.assignedTo || "",
      messages,
      link: sel.link
        ? {
            type: sel.link.type,
            kindLabel:
              sel.link.type.charAt(0).toUpperCase() + sel.link.type.slice(1),
            label: sel.link.label || sel.link.id,
            color: LINK_KIND_COLOR[sel.link.type] || "#5b616e",
            href: linkHref(sel.link),
          }
        : null,
      resolvedCustomerId: resolvedCid,
      resolvedCustomerName: resolvedCustomer || sel.customer || "this contact",
      needsAdopt: !sel.customerId && !!resolvedCid,
      linkOptions,
      visit,
      lastBody: lastMsg(sel)?.body || "",
      forwardFrom: sel.contactName || sel.contactEmail || "",
      resolution,
      senderDomain,
      senderIsPublicDomain,
      domainClaimedByThisCustomer,
      suggested: suggestedCustomer
        ? { customerId: suggestedCustomer.id, name: suggestedCustomer.name, contactsAtDomain }
        : null,
      candidates: resolution === "ambiguous" ? candidates : [],
      customerCard,
      customerOptions: customers
        .map((c) => ({ value: c.id, label: c.name }))
        .sort((a, b) => a.label.localeCompare(b.label)),
      customerOptionGroups: groupCompanyOptions(customers.map((c) => ({ id: c.id, name: c.name, type: c.type || "" }))),
      contactOptions: contactOptionsFor(
        linkedCustomer || suggestedCustomer
          ? [linkedCustomer || suggestedCustomer]
          : resolution === "ambiguous"
            ? candidates.map((c) => customers.find((x) => x.id === c.customerId))
            : []
      ),
    };
  }

  /* ---- compose / log modal data ---- */
  const customerVMs: CustomerVM[] = customers.map((c) => {
    const contacts = (c.contacts || []).map((ct) => ({
      name: ct.name || "",
      role: ct.role || "",
      email: ct.email || "",
    }));
    const primary = (c.contacts || []).find((ct) => ct.primary) || (c.contacts || [])[0];
    return {
      id: c.id,
      name: c.name,
      contacts,
      primaryName: primary?.name || "",
      primaryEmail: primary?.email || "",
    };
  });

  const contactEmails: Opt[] = [];
  customerVMs.forEach((c) =>
    c.contacts.forEach((ct) => {
      if (ct.email)
        contactEmails.push({ value: ct.email, label: `${ct.name} · ${c.name}` });
    })
  );

  const fromOptions: Opt[] = boxes.map((b) => ({
    value: b.id,
    label:
      (b.kind === "personal" ? `${b.label} (me) · ` : `${b.label} · `) +
      b.address,
  }));

  const rosterOptions: Opt[] = roster.map((u) => ({
    value: u.name,
    label: u.name === me ? `${u.name} (me)` : u.name,
  }));

  // ?draft=<id> opens a saved draft in the composer (IDEAS #36 outreach);
  // ?compose=1 opens a blank sheet; ?new=<customerId> pre-fills the customer.
  // #122: ?customer=<companyId> is the same pre-filled composer (vendor pages
  // link here), and ?customer=<companyId>&log=1 opens the Log call / meeting
  // modal with that company preset instead.
  let initialCompose: ComposeInit | null = null;
  const customerParam = str(params.customer);
  const logCust = str(params.log) === "1" ? customerParam : "";
  const newCust = logCust ? "" : str(params.new) || customerParam;
  const initialLog = logCust && customerVMs.some((c) => c.id === logCust) ? { customerId: logCust } : null;
  if (openDraftThread) {
    const d = openDraftThread.draft || {};
    initialCompose = {
      id: openDraftThread.id,
      mailbox: openDraftThread.mailbox || "personal",
      to: d.to || openDraftThread.contactEmail || "",
      cc: d.cc || "",
      showCc: !!d.cc,
      subject: d.subject || openDraftThread.subject || "",
      body: d.body || "",
      customerId: openDraftThread.customerId || "",
      contactName: openDraftThread.contactName || "",
      attachments: (d.attachments || []).map((a) => ({
        name: a.name,
        size: a.size,
      })),
    };
  } else if (newCust) {
    const c = customerVMs.find((x) => x.id === newCust);
    initialCompose = {
      id: null,
      mailbox: "personal",
      to: c?.primaryEmail || "",
      cc: "",
      showCc: false,
      subject: "",
      body: "",
      customerId: c ? c.id : "",
      contactName: c?.primaryName || "",
    };
  } else if (str(params.compose)) {
    initialCompose = {
      id: null,
      mailbox: box !== "personal" && !isView ? box : "personal",
      to: "",
      cc: "",
      showCc: false,
      subject: "",
      body: "",
      customerId: "",
      contactName: "",
    };
  }

  return (
    <>
      <style>{`
        .ib-scroll::-webkit-scrollbar { width: 10px; height: 10px; }
        .ib-scroll::-webkit-scrollbar-thumb { background: #d6d9e0; border-radius: 8px; border: 3px solid #f7f8fa; }
        .ib-clamp { display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
        .ib-check { opacity:0; }
        .ib-row:hover .ib-check { opacity:1; }
        .ib-row:hover .ib-unread-dot { opacity:0; }
        .ib-quick { opacity:0; transition:opacity .1s ease; }
        .ib-row:hover .ib-quick { opacity:1; }
        @media (hover: none) { .ib-check { opacity:1; } .ib-quick { opacity:1; } }
        @keyframes ib-scrim { from { opacity:0 } to { opacity:1 } }
        @keyframes ib-slide { from { transform:translateX(24px); opacity:.6 } to { transform:translateX(0); opacity:1 } }
        .ib-boxsel { display:none; }
        @media (max-width: 960px) { .ib-pane { display:none !important; } .ib-list { flex:1 1 auto !important; width:auto !important; border-right:none !important; } }
        @media (max-width: 720px) {
          .ib-side { display:none !important; }
          .ib-boxsel { display:flex !important; }
          .ib-list { width:100% !important; border-right:none !important; }
          .ib-sheet input, .ib-sheet select, .ib-sheet textarea { font-size:16px !important; }
        }
      `}</style>
      {/* D98: InboxShell (below) is a fixed height:"100%" three-pane shell
          with no pk-content wrapper of its own — it must stay edge-to-edge,
          so it cannot be passed as HomeTabs children (that would cap it at
          HomeTabs' max-width). A flex column here gives the bar its own row
          so InboxShell's height:100% resolves against the remaining space
          instead of overflowing past the viewport.
          Final-review fix: the bar-only wrapper used to shrink-wrap to the
          tab bar's own content width (338px) — inside a column flex
          container, `.pk-content`'s `margin:0 auto` cross-axis auto-margins
          suppress `align-self:stretch`, so it never picked up the parent's
          full width. `width:"100%"` (now passed through HomeTabs' `style`)
          fixes it; top padding is normalized to 24px to match the other
          three hub routes. */}
      <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
        <HomeTabs
          active="inbox"
          style={{ padding: "24px 28px 0", flex: "0 0 auto", width: "100%" }}
        />
        <div style={{ flex: "1 1 auto", minHeight: 0 }}>
          <InboxShell
            box={view ? view : box}
            folder={folder}
            isView={isView}
            isDrafts={isDrafts}
            sidebar={sidebar}
            list={list}
            reader={reader}
            explicitSelected={!!explicitThread}
            rosterOptions={rosterOptions}
            customers={customerVMs}
            contactEmails={contactEmails}
            fromOptions={fromOptions}
            initialCompose={initialCompose}
            initialLog={initialLog}
            categoryOptions={CATEGORIES}
            crmMode={crmMode}
          />
        </div>
      </div>
    </>
  );
}
