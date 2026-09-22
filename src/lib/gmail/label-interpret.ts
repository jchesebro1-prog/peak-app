/**
 * #96 §3 — Gmail → Peak. Labels applied in Gmail under Peak/ are commands.
 * Fed by the history replay in bridge.ts; applies through the same store
 * functions the UI uses so feeds, badges and the bell fire.
 *
 * Every command applies through the store first; any best-effort mirror back
 * to Gmail (currently only the New-lead label swap) is wrapped in its own
 * try/catch so a Gmail hiccup never loses or duplicates the Peak-side effect
 * — same philosophy as label-sync.ts's syncPeakLabels.
 */
import { listDocs, patchDoc } from "@/db/doc-store";
import { assign, setLink, setStatus, type CommThread } from "@/lib/stores/comms";
import { allCompanies } from "@/lib/identity/companies";
import { create as createLead } from "@/lib/stores/leads";
import { activeUsers } from "@/lib/users";
import type { GmailLabelEvent } from "./api";
import { modifyThread } from "./api";
import { listCachedLabels } from "./connections";
import { type MailboxKey, userIdOfKey } from "./config";
import { linkThread, rememberAddress } from "./linking";
import { desiredPeakLabels, parsePeakLabel, type PeakCommand } from "./peak-labels";
import { ensureLabelId } from "./label-sync";

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
  const cache = await listCachedLabels(key);
  const idToName = new Map(cache.map((l) => [l.labelId, l.name]));
  const all = await listDocs<CommThread>("comms");
  const byGmailThread = new Map(
    all.filter((t) => t.gmailAccountKey === key && t.gmailThreadId).map((t) => [t.gmailThreadId!, t])
  );
  let applied = 0;

  for (const ev of events) {
    const t = byGmailThread.get(ev.threadId);
    if (!t) continue;
    const addedNames = ev.added.map((id) => idToName.get(id) || "").filter((n) => n.startsWith("Peak/"));
    const removedNames = ev.removed.map((id) => idToName.get(id) || "").filter((n) => n.startsWith("Peak/"));
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
        const u = (await activeUsers()).find(
          (x) => x.name.split(" ")[0].toLowerCase() === cmd.firstName.toLowerCase()
        );
        if (u) {
          await assign(t.id, u.name);
          applied++;
        } else {
          console.warn("[gmail] Peak/Assign/" + cmd.firstName + " matched no active user — skipped", t.id);
        }
      } else if (cmd.kind === "customer") {
        const c = await findCustomerBySanitizedName(cmd.name);
        if (c) {
          await linkThread(t.id, c.id);
          if (t.contactEmail) {
            await rememberAddress(c.id, t.contactEmail, t.contactName, null, {
              id: userIdOfKey(key) || "u1",
              name: "Gmail label",
            });
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
            email: t.contactEmail,
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

    // Removals: status/assign are never commands (the app re-asserts them
    // on its own next write) — only a matching customer removal unlinks.
    for (const n of removedNames) {
      const c = parsePeakLabel(n);
      if (c?.kind === "customer" && sanitizeCustomerName(t.customer) === c.name) {
        await patchDoc<CommThread>("comms", t.id, (d) => {
          d.customerId = null;
          d.customer = "";
          d.resolution = "unknown";
        });
        applied++;
      }
    }

    // Record what Gmail now holds so the writer's next pass sees "already
    // in sync" instead of echoing this change straight back.
    await patchDoc<CommThread>("comms", t.id, (d) => {
      d.messages = (d.messages || []).map((m) =>
        m.gmailId === ev.messageId
          ? {
              ...m,
              gmailLabelIds: Array.from(
                new Set([...(m.gmailLabelIds || []).filter((id) => !ev.removed.includes(id)), ...ev.added])
              ),
            }
          : m
      );
      d.peakLabelsAppliedAt = Date.now();
    });
  }
  return applied;
}
