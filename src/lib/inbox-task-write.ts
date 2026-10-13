import { get as getThread, resolveCustomerId, visibleTo, type CommThread } from "@/lib/stores/comms";
import { get as getCustomer, type CustomerDoc } from "@/lib/stores/customers";
import { createTask, type TaskRecord } from "@/lib/stores/tasks";
import { displayName as contactDisplayName, getContact } from "@/lib/identity/contacts";
import { leadNumbersFor, quoteNumbersFor } from "@/lib/stores/estimate-numbers";
import { relabelLinkedRecord } from "@/lib/estimate-number";
import { activeUsers } from "@/lib/users";
import {
  buildThreadTaskInput,
  threadTaskLinkCandidates,
  type ThreadTaskLinkCandidate,
  type ThreadTaskRequest,
} from "@/lib/inbox-task";

/**
 * #215 — the write half of "Create task" from an email. Kept out of the
 * "use server" file (every export there is POST-reachable) so the action is
 * just requireUser() + this, and the harness can drive the real write.
 * Links are re-derived from the stored thread: a key the thread doesn't
 * carry is ignored, and a venue must belong to the thread's company.
 */
async function threadCandidates(
  thread: CommThread
): Promise<{ candidates: ThreadTaskLinkCandidate[]; customer: CustomerDoc | null }> {
  const customerId = await resolveCustomerId(thread);
  const customer = customerId ? await getCustomer(customerId) : null;
  const siteId =
    thread.siteId && (customer?.locations || []).some((l) => l.id === thread.siteId) ? thread.siteId : null;
  const candidates = threadTaskLinkCandidates({
    threadId: thread.id,
    // Fix wave 1 — resolveCustomerId can return an id that no longer maps
    // to a real customer record (e.g. deleted after the thread linked or
    // resolved to it); only offer/link the company — and, transitively,
    // its venue — once it actually resolves to something.
    customerId: customer ? customerId : null,
    siteId,
    link: thread.link,
    primaryContactId: thread.resolvedContactId ?? null,
    contactIds: thread.linkedContactIds ?? [],
  });
  return { candidates, customer };
}

/**
 * #334 Assist — the same candidates the writer accepts, labeled for the
 * prompt and the suggestion dialog (labels mirror the Inbox page's task
 * dialog). A contact whose record is gone is left out, as on the page.
 */
export async function threadTaskLinkOptions(thread: CommThread): Promise<{ key: string; label: string }[]> {
  const { candidates, customer } = await threadCandidates(thread);
  const link = thread.link;
  const [quoteNos, leadNos, contacts] = await Promise.all([
    link?.type === "quote" ? quoteNumbersFor([link.id]) : Promise.resolve(new Map<string, string>()),
    link?.type === "lead" ? leadNumbersFor([link.id]) : Promise.resolve(new Map<string, string>()),
    Promise.all(candidates.filter((c) => c.kind === "contact").map((c) => getContact(c.id))),
  ]);
  const contactName = new Map(
    contacts.filter((r): r is NonNullable<typeof r> => !!r).map((r) => [r.id, contactDisplayName(r)] as const)
  );
  const workKind = link ? link.type.charAt(0).toUpperCase() + link.type.slice(1) : "";
  const workLabel = link
    ? relabelLinkedRecord(link.label, link.id, link.type === "quote" ? quoteNos.get(link.id) : link.type === "lead" ? leadNos.get(link.id) : null)
    : "";
  return candidates.flatMap((c): { key: string; label: string }[] => {
    switch (c.kind) {
      case "thread":
        return [{ key: c.key, label: "This email thread" }];
      case "contact": {
        const name = contactName.get(c.id);
        return name ? [{ key: c.key, label: name }] : [];
      }
      case "customer":
        return [{ key: c.key, label: customer?.name || c.id }];
      case "site": {
        const l = (customer?.locations || []).find((x) => x.id === c.id);
        const label = l
          ? [l.label || "Venue", [l.city, l.state].filter(Boolean).join(", ")].filter(Boolean).join(" — ")
          : "Venue";
        return [{ key: c.key, label }];
      }
      default:
        return [{ key: c.key, label: `${workKind} · ${workLabel || c.id}` }];
    }
  });
}

export async function createTaskFromThread(
  req: ThreadTaskRequest,
  me: { id: string; name: string }
): Promise<{ ok: true; task: TaskRecord } | { ok: false; error: string }> {
  const thread = await getThread(String(req?.threadId || ""));
  // Fix wave 1 — the same rule link-actions.ts applies at every write site
  // that touches a thread (setThreadSiteAction, setIdentityMessageAction,
  // quickAddVenueAction): missing, tombstoned, or another person's personal
  // mailbox are all "not there" from this user's side.
  if (!thread || thread.deleted || !visibleTo(thread, me.name))
    return { ok: false, error: "That email thread no longer exists." };
  const [{ candidates }, roster] = await Promise.all([threadCandidates(thread), activeUsers()]);
  const built = buildThreadTaskInput({
    req,
    candidates,
    workLabel: thread.link?.label || "",
    roster: roster.map((u) => ({ id: u.id, name: u.name })),
    me,
  });
  if (!built.ok) return built;
  return { ok: true, task: await createTask(built.input, me) };
}
