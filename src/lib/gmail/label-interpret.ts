/**
 * #96 §3 — Gmail → Peak. Labels applied in Gmail under Peak/ are commands.
 * Fed by the history replay in bridge.ts; applies through the same store
 * functions the UI uses so feeds, badges and the bell fire.
 *
 * Every command applies through the store first; any best-effort mirror back
 * to Gmail (currently only the New-lead label swap) is wrapped in its own
 * try/catch so a Gmail hiccup never loses or duplicates the Peak-side effect
 * — same philosophy as label-sync.ts's syncPeakLabels. That mirror also
 * checks the connection's gmail.modify scope first (same check as
 * syncPeakLabels) so a read-only mailbox never attempts a Gmail write.
 */
import { casDocKey, getDoc, listDocs, patchDoc } from "@/db/doc-store";
import { assign, setLink, setStatus, type CommMessage, type CommThread } from "@/lib/stores/comms";
import { allCompanies } from "@/lib/identity/companies";
import { create as createLead } from "@/lib/stores/leads";
import { activeUsers } from "@/lib/users";
import type { GmailLabelEvent } from "./api";
import { modifyThread } from "./api";
import { getConnectionInfo, listCachedLabels } from "./connections";
import { GMAIL_MODIFY_SCOPE, type MailboxKey, userIdOfKey } from "./config";
import { linkThread, rememberAddress } from "./linking";
import { resolveAddressFor } from "@/lib/inbox-identity";
import { desiredPeakLabels, isPlaceholderCustomerLabel, parsePeakLabel, type PeakCommand } from "./peak-labels";
import { ensureLabelId } from "./label-sync";
import { isPickableLabel, USER_LABEL_ECHO_MS } from "./user-label-rules";

/** #347 — a label id the Labels card shows as editable: a known user label
 *  (not Peak/*) or Starred / Important. An id the cache doesn't know (a
 *  label made in Gmail since the last label sync) counts when it looks like
 *  a user label id (`Label_…`), so a new label still shows. */
export function isCardLabel(id: string, row: { labelId: string; name: string; type: "system" | "user" } | undefined): boolean {
  if (row) return isPickableLabel(row);
  return /^Label_/.test(id);
}

/** #347 — pure: the person's own label changes in `events` (history order),
 *  per Gmail thread → Gmail message → label id → on/off; the last event for
 *  a message + label wins. */
export function userLabelChanges(
  events: ReadonlyArray<GmailLabelEvent>,
  isCard: (id: string) => boolean
): Map<string, Map<string, Map<string, boolean>>> {
  const out = new Map<string, Map<string, Map<string, boolean>>>();
  for (const ev of events) {
    const touched = [...ev.added.filter(isCard).map((id) => [id, true] as const), ...ev.removed.filter(isCard).map((id) => [id, false] as const)];
    if (!touched.length) continue;
    let byMsg = out.get(ev.threadId);
    if (!byMsg) out.set(ev.threadId, (byMsg = new Map()));
    let byLabel = byMsg.get(ev.messageId);
    if (!byLabel) byMsg.set(ev.messageId, (byLabel = new Map()));
    for (const [id, on] of touched) byLabel.set(id, on);
  }
  return out;
}

/** #347 — pure: `messages` with those changes applied, skipping a label the
 *  card changed within the echo window; null when nothing changes. */
export function applyUserLabelChanges(
  messages: ReadonlyArray<CommMessage>,
  perMessage: ReadonlyMap<string, ReadonlyMap<string, boolean>>,
  ops: CommThread["userLabelOps"],
  now: number,
  echoMs: number = USER_LABEL_ECHO_MS
): CommMessage[] | null {
  const held = (id: string) => {
    const op = ops?.[id];
    return !!op && op.at > now - echoMs;
  };
  let changed = false;
  const out = messages.map((m) => {
    const ch = m.gmailId ? perMessage.get(m.gmailId) : undefined;
    if (!ch) return m;
    let ids = m.gmailLabelIds || [];
    for (const [id, on] of ch) {
      if (held(id) || ids.includes(id) === on) continue;
      ids = on ? [...ids, id] : ids.filter((x) => x !== id);
      changed = true;
    }
    return ids === (m.gmailLabelIds || []) ? m : { ...m, gmailLabelIds: ids };
  });
  return changed ? out : null;
}

/** No echo-window constant lives in label-sync.ts (the writer stamps
 *  peakLabelsAppliedAt but doesn't need its own window) — 2 minutes here. */
const ECHO_WINDOW_MS = 2 * 60_000;

/** Pure: label NAMES already filtered to Peak/* → the commands they imply.
 *  Last status/assign/customer wins (Gmail lets a user apply several at
 *  once, e.g. moving Peak/Status/Waiting → Peak/Status/Done without first
 *  removing the old one); newLead and work-link commands are independent
 *  and all pass through. Non-Peak names are the caller's job to filter. */
export function planLabelCommands(addedNames: string[]): PeakCommand[] {
  const byKind = new Map<string, PeakCommand>();
  const out: PeakCommand[] = [];
  for (const n of addedNames) {
    const c = parsePeakLabel(n);
    if (!c) continue;
    if (c.kind === "status" || c.kind === "assign" || c.kind === "customer") byKind.set(c.kind, c);
    else out.push(c);
  }
  return [...byKind.values(), ...out];
}

/** Same `/` → `-` sanitiser desiredPeakLabels() applies to a customer name
 *  when writing Peak/Customers/<name> — a customer named "Acme/East" is
 *  labeled "Peak/Customers/Acme-East", so matching back has to sanitise the
 *  candidate name the same way rather than compare it raw. */
function sanitizeCustomerName(name: string): string {
  return (name || "").replace(/\//g, "-");
}

/** Resolve a Peak/Customers/<name> label back to a customer by comparing
 *  every live customer's SANITISED name — never a raw match, and never a
 *  guess: no match or more than one match both return null so the caller
 *  logs and does nothing rather than link the wrong (or a random) account. */
async function findCustomerBySanitizedName(name: string): Promise<{ id: string; name: string } | null> {
  const list = await allCompanies();
  const matches = list.filter((c) => sanitizeCustomerName(c.name) === name);
  return matches.length === 1 ? { id: matches[0].id, name: matches[0].name } : null;
}

/** One collapsed Peak/* label change per Gmail thread — see
 *  collapseLabelEventsByThread below. */
export type CollapsedLabelEvent = {
  threadId: string;
  messageIds: string[];
  added: string[];
  removed: string[];
};

/**
 * Pure: collapse Gmail's per-MESSAGE history records into one event per
 * THREAD. Gmail's history API returns a separate labelAdded/labelRemoved
 * record for every message when a label is applied to a whole thread from
 * the Gmail UI, and api.ts's history walk flattens those into one
 * GmailLabelEvent per message — all sharing the same threadId. Without this
 * collapse, interpretLabelEvents iterated one command-plan per message, so a
 * `Peak/New lead` applied to an N-message thread spawned N duplicate leads
 * (the guard reads a single in-memory thread snapshot whose `.link` never
 * reflects an earlier iteration's own setLink patch within the same call).
 *
 * added/removed label ids are unioned and deduped across every message event
 * for the same thread. If a label id shows up in both sets for a thread
 * (e.g. one message's record adds it, another's removes it — order isn't
 * guaranteed), added wins: it's a net add, mirroring the writer's
 * thread-wide-set approach (commit 2414a04) rather than the two canceling
 * out and silently doing nothing.
 */
export function collapseLabelEventsByThread(events: GmailLabelEvent[]): CollapsedLabelEvent[] {
  const byThread = new Map<
    string,
    { threadId: string; messageIds: string[]; added: Set<string>; removed: Set<string> }
  >();
  for (const ev of events) {
    let c = byThread.get(ev.threadId);
    if (!c) {
      c = { threadId: ev.threadId, messageIds: [], added: new Set(), removed: new Set() };
      byThread.set(ev.threadId, c);
    }
    c.messageIds.push(ev.messageId);
    for (const id of ev.added) c.added.add(id);
    for (const id of ev.removed) c.removed.add(id);
  }
  return Array.from(byThread.values()).map((c) => ({
    threadId: c.threadId,
    messageIds: c.messageIds,
    added: Array.from(c.added),
    removed: Array.from(c.removed).filter((id) => !c.added.has(id)),
  }));
}

/**
 * Interpret Gmail-side Peak/* label changes for one mailbox's incremental
 * history page. `events` are keyed by Gmail thread id (label ids, resolved
 * to names via the mailbox's cached label list); a thread with no matching
 * CommThread (not yet bridged, or on a different mailbox) is skipped.
 * Returns the number of commands actually applied (for the caller's
 * changed-something bookkeeping).
 */
export async function interpretLabelEvents(key: MailboxKey, events: GmailLabelEvent[]): Promise<number> {
  if (!events.length) return 0;
  const conn = await getConnectionInfo(key);
  const canModify = !!conn && (conn.scope || "").includes(GMAIL_MODIFY_SCOPE);
  const cache = await listCachedLabels(key);
  const idToName = new Map(cache.map((l) => [l.labelId, l.name]));
  const cacheById = new Map(cache.map((l) => [l.labelId, l]));
  const all = await listDocs<CommThread>("comms");
  const byGmailThread = new Map(
    all.filter((t) => t.gmailAccountKey === key && t.gmailThreadId).map((t) => [t.gmailThreadId!, t])
  );
  let applied = 0;

  for (const ev of collapseLabelEventsByThread(events)) {
    const t = byGmailThread.get(ev.threadId);
    if (!t) continue;
    const addedNames = ev.added.map((id) => idToName.get(id) || "").filter((n) => n.startsWith("Peak/"));
    const removedNames = ev.removed.map((id) => idToName.get(id) || "").filter((n) => n.startsWith("Peak/"));
    // (the person's own labels are recorded by the #347 pass below, whatever
    // else the event carries)
    if (!addedNames.length && !removedNames.length) continue;

    // Our own echo: the writer just wrote exactly this add/remove set for
    // this thread within the last two minutes — this event is Gmail
    // reporting back our own write, not a person's action. Every added
    // name must be one we currently want, and every removed name must be
    // one we do NOT want (i.e. the write correctly dropped it) — anything
    // else (a person adding/removing something on top of our write) still
    // gets processed.
    const want = new Set(desiredPeakLabels(t));
    const recent = (t.peakLabelsAppliedAt || 0) > Date.now() - ECHO_WINDOW_MS;
    if (recent && addedNames.every((n) => want.has(n)) && removedNames.every((n) => !want.has(n))) {
      continue;
    }

    for (const cmd of planLabelCommands(addedNames)) {
      if (cmd.kind === "status") {
        await setStatus(t.id, cmd.status);
        applied++;
      } else if (cmd.kind === "assign") {
        // Ambiguous -> skip, never guess (mirrors the customer path's
        // length === 1 requirement below). Two active users can share a
        // first name; picking the first Array.find() happens to return is
        // a coin flip on who gets assigned, so require exactly one match.
        const matches = (await activeUsers()).filter(
          (x) => x.name.split(" ")[0].toLowerCase() === cmd.firstName.toLowerCase()
        );
        if (matches.length === 1) {
          await assign(t.id, matches[0].name);
          applied++;
        } else {
          console.warn("[gmail] ambiguous/unknown assignee, skipping:", cmd.firstName, t.id);
        }
      } else if (cmd.kind === "customer") {
        // #345 — Peak/Customers/UNKNOWN (a placeholder company) links nothing
        if (isPlaceholderCustomerLabel("Peak/Customers/" + cmd.name)) continue;
        const c = await findCustomerBySanitizedName(cmd.name);
        if (c) {
          // #341 — a person labelling the thread in their own Gmail is a
          // deliberate link; a label that only echoes the customer the app
          // already holds (the label writer's own, after the echo window)
          // keeps the thread's flag as it was, so an automatic match never
          // becomes shared through its own label.
          await linkThread(t.id, c.id, null, t.customerId === c.id ? null : "user");
          // I review — the picked identity message's address (#125) when
          // one is set, else the thread contact; a Peak/Customers label
          // applied on a multi-party or forwarded thread must remember the
          // SAME address the sidebar is showing, not always the counterpart.
          // selfEmail = this mailbox's own connected address (`conn`,
          // already fetched above for the modify-scope check) — the I
          // follow-up review: firstRecipient skips it on an outbound
          // identity message so a self-CC never gets remembered as the
          // customer's own contact address.
          const identityEmail = resolveAddressFor(t, conn?.address);
          if (identityEmail) {
            await rememberAddress(
              c.id,
              identityEmail,
              t.contactName,
              null,
              { id: userIdOfKey(key) || "u1", name: "Gmail label" },
              // #341 — the backlog resweep stays in this mailbox
              { accountKey: key }
            );
          }
          applied++;
        } else {
          console.warn("[gmail] Peak/Customers/" + cmd.name + " matched no single customer — skipped", t.id);
        }
      } else if (cmd.kind === "work") {
        await setLink(t.id, { type: cmd.type, id: cmd.id, label: cmd.id });
        applied++;
      } else if (cmd.kind === "newLead") {
        // Idempotent: a thread that already spawned a lead never spawns a
        // second one, regardless of whether Gmail redelivers this same
        // history event or the earlier label-swap attempt failed.
        if (t.link && t.link.type === "lead") continue;
        const lead = await createLead(
          {
            org: t.customer || t.contactName,
            contact: t.contactName,
            email: resolveAddressFor(t, conn?.address),
            source: "manual",
            message: t.subject,
            customerId: t.customerId,
          },
          "Gmail label"
        );
        await setLink(t.id, { type: "lead", id: lead.id, label: lead.id });
        applied++;
        // Best-effort: swap the Gmail label so this can't fire twice even
        // if a retry redelivers the same history entry before this patch
        // lands, and so Gmail reflects the new lead id. A failure here
        // (quota, revoked scope, transient 5xx) must never re-surface as a
        // duplicate lead — the idempotency guard above already covers that
        // on the next pass, so this is logged, not thrown.
        if (canModify) {
          try {
            const newLeadId = cache.find((l) => l.name === "Peak/New lead")?.labelId;
            const leadLabelId = await ensureLabelId(key, "Peak/Leads/" + lead.id, cache);
            await modifyThread(key, ev.threadId, {
              addLabelIds: [leadLabelId],
              removeLabelIds: newLeadId ? [newLeadId] : [],
            });
          } catch (err) {
            console.error("[gmail] new-lead label swap failed for", t.id, err);
          }
        }
      }
    }

    // Removals: status/assign are never commands (the app re-asserts them
    // on its own next write) — only a matching customer removal unlinks.
    for (const n of removedNames) {
      const c = parsePeakLabel(n);
      if (c?.kind === "customer" && sanitizeCustomerName(t.customer) === c.name) {
        await patchDoc<CommThread>("comms", t.id, (d) => {
          d.customerId = null;
          d.customer = "";
          d.resolution = "unknown";
          d.siteId = null; // #124 — no customer, no venue
          delete d.linkedBy; // #341 — unlinked, so no longer shared
        });
        applied++;
      }
    }

    // Record what Gmail now holds so the writer's next pass sees "already
    // in sync" instead of echoing this change straight back. A collapsed
    // event can span every message in the thread (Gmail stamps the label on
    // each one), so update every message this event actually touched, not
    // just one.
    const touchedMessageIds = new Set(ev.messageIds);
    // #347 — the person's own labels are left to the ordered pass below
    const notCard = (id: string) => !isCardLabel(id, cacheById.get(id));
    const evAdded = ev.added.filter(notCard);
    const evRemoved = ev.removed.filter(notCard);
    await patchDoc<CommThread>("comms", t.id, (d) => {
      d.messages = (d.messages || []).map((m) =>
        m.gmailId && touchedMessageIds.has(m.gmailId)
          ? {
              ...m,
              gmailLabelIds: Array.from(
                new Set([...(m.gmailLabelIds || []).filter((id) => !evRemoved.includes(id)), ...evAdded])
              ),
            }
          : m
      );
      d.peakLabelsAppliedAt = Date.now();
    });
  }

  // #347 — the person's own labels (and Starred / Important) changed in
  // Gmail: no command, just record them so the Labels card shows them —
  // from every event, Peak/* or not. In history order (the last event for a
  // message + label wins, so an add then a remove nets to removed). A label
  // the card changed within the echo window is ignored (`userLabelOps`): the
  // card's state wins, so a stale echo never re-adds a label it removed.
  // Compare-and-set on `messages`, re-read on conflict.
  const isCard = (id: string) => isCardLabel(id, cacheById.get(id));
  for (const [gThread, perMessage] of userLabelChanges(events, isCard)) {
    const t0 = byGmailThread.get(gThread);
    if (!t0) continue;
    for (let i = 0; i < 5; i++) {
      const t = await getDoc<CommThread>("comms", t0.id);
      if (!t) break;
      const next = applyUserLabelChanges(t.messages || [], perMessage, t.userLabelOps, Date.now());
      if (!next) break;
      if (await casDocKey("comms", t.id, "messages", t.messages, next)) break;
    }
  }
  return applied;
}
