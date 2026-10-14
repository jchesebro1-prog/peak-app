/**
 * #335 Inbox organization — the Organize view's loader (spec §2). One scan of
 * the person's own threads (`visibleTo`), partitioned by `buildOrganizeVM`
 * (pure — test-inbox-org drives it over fake threads) into To file (the
 * `toFileThreads` rows: `isToFileRow`), Noise (everything flagged as noise and
 * not rescued — moved out of the inbox for pilot users, or only tagged
 * "Looks like noise" and still in it) and Filed (the
 * last 14 days, at most 200). The client gets plain view models only — no
 * store, db or sync import crosses into the client bundle (the box imports
 * this module's types only).
 *
 * Not `import "server-only"`: the package isn't installed in this repo; the
 * `next build` gate catches a client import of this module instead.
 */
import { getAll as allThreads, visibleTo, type CommThread } from "@/lib/stores/comms";
import { inInbox, isNoiseRow, isStrongRow, isToFileRow, toFileThreads } from "@/lib/inbox-org/apply";
import { isPlaceholderCompany, withoutPlaceholderCustomer } from "@/lib/inbox-org/placeholder";
import { placeholderCompanyIds } from "@/lib/identity/companies";
import type { ReaderOrgVM } from "../types";
import {
  courtChipLabel,
  FILED_CAP,
  FILED_DAYS,
  filedByLabel,
  ORGANIZE_BASE_HREF,
  organizeHref,
  suggestionLabel,
  type OrganizeTab,
} from "./format";

export type { OrganizeTab } from "./format";
/** Moved to lib/inbox-org/apply (the daily brief counts it too); re-exported for existing importers. */
export { isNoiseRow } from "@/lib/inbox-org/apply";

export type OrganizeRowVM = {
  id: string;
  /** opens the thread reader beside the list, on this tab */
  href: string;
  sender: string;
  senderEmail: string;
  subject: string;
  /** "2:30 PM" today, else "Oct 9" (Chicago) — formatted on the server */
  when: string;
  /** "Lincoln HS → EST-1042 Main curtain" / "Noise" / null (nothing yet) */
  suggestion: string | null;
  reason: string;
  strength: "strong" | "weak";
  needsReply: boolean;
  /** Approve-all may take it (suggested, strong, resolved, not noise) */
  strong: boolean;
  /** Approve has something to file under */
  canApprove: boolean;
  /** an archived-on-reply To file row (the "Archived" chip) */
  archived: boolean;
  /** still in the inbox (app and Gmail side) — Noise's Archive all shown */
  inInbox: boolean;
  /** Filed tab: "approved" / "on reply" / "sender rule" / "teammate reply" */
  filedBy: string | null;
  filedWhen: string | null;
};

export type OrganizeVM = {
  tab: OrganizeTab;
  rows: OrganizeRowVM[];
  counts: { toFile: number; noise: number; filed: number };
  /** the To file rows Approve all strong takes */
  strongIds: string[];
  /** Noise rows still in the inbox */
  noiseInInboxIds: string[];
  /** company-wide sender rules (rule offer checkbox) */
  isAdmin: boolean;
  baseHref: string;
};

const TZ = "America/Chicago";
const TIME = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" });
const DAY = new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "short", day: "numeric" });
const DAY_YEAR = new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "short", day: "numeric", year: "numeric" });
const DAY_KEY = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const DAY_MS = 86_400_000;

function whenLabel(ms: number | null | undefined, now: number): string {
  if (!ms) return "";
  if (DAY_KEY.format(ms) === DAY_KEY.format(now)) return TIME.format(ms);
  return (Math.abs(now - ms) < 300 * DAY_MS ? DAY : DAY_YEAR).format(ms);
}


/** The Filed tab's rule: filed within the last FILED_DAYS. */
export function isRecentFiledRow(t: CommThread, now: number): boolean {
  const f = t.filing;
  return t.mailbox === "personal" && !t.deleted && t.status !== "draft" && f?.state === "filed" && (f.filedAt || 0) >= now - FILED_DAYS * DAY_MS;
}

/**
 * Pure: the Organize VM over `threads` (already the person's own — the loader
 * applies `visibleTo`). `customerName` labels a filing's customer.
 */
export function buildOrganizeVM(
  threads: CommThread[],
  opts: {
    tab: OrganizeTab;
    now: number;
    customerName: (id: string) => string | null;
    isAdmin?: boolean;
    baseHref?: string;
  }
): OrganizeVM {
  const { tab, now } = opts;
  const baseHref = opts.baseHref ?? ORGANIZE_BASE_HREF;
  // #345 — an old suggestion under a placeholder company ("UNKNOWN" …) reads
  // as nothing suggested yet (a work record on it stays)
  const isPlaceholderId = (id: string) => isPlaceholderCompany(opts.customerName(id));
  const effective = (t: CommThread): Pick<CommThread, "filing"> => ({ filing: t.filing ? withoutPlaceholderCustomer(t.filing, isPlaceholderId) : t.filing });
  const byUpdated = (a: CommThread, b: CommThread) => (b.updatedAt || 0) - (a.updatedAt || 0);
  const toFile = threads.filter(isToFileRow).sort(byUpdated);
  const noise = threads.filter(isNoiseRow).sort(byUpdated);
  const filed = threads
    .filter((t) => isRecentFiledRow(t, now))
    .sort((a, b) => (b.filing?.filedAt || 0) - (a.filing?.filedAt || 0));

  const rowOf = (t: CommThread): OrganizeRowVM => {
    const f = effective(t).filing;
    const cname = f?.customerId ? opts.customerName(f.customerId) : null;
    const isFiled = f?.state === "filed";
    return {
      id: t.id,
      href: organizeHref(baseHref, tab, t.id),
      sender: t.contactName || t.contactEmail || t.customer || "Unknown sender",
      senderEmail: t.contactEmail || "",
      subject: t.subject || "(no subject)",
      when: whenLabel(t.updatedAt, now),
      suggestion: f ? suggestionLabel(f, cname) : null,
      reason: tab === "noise" ? t.noise?.reason || f?.reason || "" : f?.reason || "",
      strength: f?.strength === "strong" ? "strong" : "weak",
      needsReply: !!f?.needsReply,
      strong: isStrongRow(effective(t)),
      canApprove: !!f && (f.noise || !!f.customerId || !!f.work),
      archived: !!f?.archivedOnReply && !inInbox(t),
      inInbox: inInbox(t),
      filedBy: isFiled ? filedByLabel(f?.filedBy) : null,
      filedWhen: isFiled && f?.filedAt ? whenLabel(f.filedAt, now) : null,
    };
  };

  const shown = tab === "to-file" ? toFile : tab === "noise" ? noise : filed.slice(0, FILED_CAP);
  const rows = shown.map(rowOf);
  return {
    tab,
    rows,
    counts: { toFile: toFile.length, noise: noise.length, filed: filed.length },
    strongIds: tab === "to-file" ? toFile.filter((t) => isStrongRow(effective(t))).map((t) => t.id) : [],
    noiseInInboxIds: tab === "noise" ? rows.filter((r) => r.inInbox).map((r) => r.id) : [],
    isAdmin: !!opts.isAdmin,
    baseHref,
  };
}

const WEEKDAY = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short" });

/** "due Thu" within the week ahead, else "due Oct 20" (Chicago); "overdue …" when past. */
export function dueLabel(due: number | null | undefined, now: number): string | null {
  if (!due) return null;
  const label = due >= now && due - now < 6 * DAY_MS ? WEEKDAY.format(due) : DAY.format(due);
  return due < now ? `overdue ${label}` : `due ${label}`;
}

/**
 * Pure: the reader's organization strip for one thread. `task` is the
 * court's promise-task as read now (null when it was removed); `teammateName`
 * names a teammate court. `now` defaults to the clock (tests pass one).
 */
export function buildReaderOrg(
  t: Pick<CommThread, "court" | "noise" | "filing">,
  opts: {
    now?: number;
    customerName: (id: string) => string | null;
    teammateName: (id: string) => string | null;
    task: { id: string; title: string; dueAt: number | null; status: string } | null;
    isAdmin: boolean;
  }
): ReaderOrgVM | null {
  const c = t.court;
  // #345 — a suggestion under a placeholder company reads as none
  const f = t.filing ? withoutPlaceholderCustomer(t.filing, (id) => isPlaceholderCompany(opts.customerName(id))) : t.filing;
  const n = t.noise?.flagged ? t.noise : null;
  const promiseTaskId = c?.promise?.taskId;
  const task = promiseTaskId && opts.task && opts.task.id === promiseTaskId ? opts.task : null;
  if (!c && !f && !n) return null;
  const override = c?.source === "override";
  return {
    court: c
      ? {
          owner: c.owner,
          label: courtChipLabel(c.owner, override ? "" : c.reason, c.teammateId ? opts.teammateName(c.teammateId) : null),
          reason: c.reason || "",
          override,
        }
      : null,
    noise: n ? { reason: n.reason || "", moved: !!n.moved } : null,
    filing: f
      ? {
          state: f.state,
          suggestion: suggestionLabel(f, f.customerId ? opts.customerName(f.customerId) : null),
          reason: f.reason || "",
          strength: f.strength === "strong" ? "strong" : "weak",
          canApprove: f.noise || !!f.customerId || !!f.work,
          filedBy: f.state === "filed" ? filedByLabel(f.filedBy) : null,
        }
      : null,
    promise: task
      ? { taskId: task.id, title: task.title || c?.promise?.text || "Task", due: dueLabel(task.dueAt, opts.now ?? Date.now()), open: task.status !== "done" }
      : null,
    isAdmin: opts.isAdmin,
  };
}

/** The Organize view for `me`: one comms scan, then the pure builder. */
export async function loadOrganize(
  me: { name: string },
  tab: OrganizeTab,
  opts: { customers: Array<{ id: string; name: string }>; isAdmin: boolean; baseHref?: string }
): Promise<OrganizeVM> {
  const mine = (await allThreads()).filter((t) => visibleTo(t, me.name));
  const names = new Map(opts.customers.map((c) => [c.id, c.name]));
  return buildOrganizeVM(mine, {
    tab,
    now: Date.now(),
    customerName: (id) => names.get(id) ?? null,
    isAdmin: opts.isAdmin,
    baseHref: opts.baseHref,
  });
}

/** The sidebar row's count on every Inbox view: my To file rows. */
export async function organizeToFileCount(me: { name: string }): Promise<number> {
  return (await toFileThreads(me)).length;
}

/** #345 — the Inbox's Organize entry points (tab row, banner): my To file,
 *  strong (Approve all strong's rows) and Noise counts — one comms scan, the
 *  same rules as the Organize tabs; a strong suggestion under a placeholder
 *  company ("UNKNOWN" …) isn't strong, as in the Organize view. */
export async function organizeEntryCounts(me: { name: string }): Promise<{ toFile: number; strong: number; noise: number }> {
  let toFile = 0;
  let noise = 0;
  const strongRows: CommThread[] = [];
  for (const t of await allThreads()) {
    if (!visibleTo(t, me.name)) continue;
    if (isToFileRow(t)) {
      toFile++;
      if (isStrongRow(t)) strongRows.push(t);
    }
    if (isNoiseRow(t)) noise++;
  }
  const placeholders = await placeholderCompanyIds(strongRows.map((t) => t.filing?.customerId));
  const strong = strongRows.filter((t) => isStrongRow({ filing: t.filing ? withoutPlaceholderCustomer(t.filing, (id) => placeholders.has(id)) : t.filing })).length;
  return { toFile, strong, noise };
}
