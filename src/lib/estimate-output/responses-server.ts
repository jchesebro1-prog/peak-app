import { displayQuoteNumber } from "@/lib/estimate-number";
import { canAct } from "@/lib/quote-share/package-view";
import { resolveSharedPackage } from "@/lib/quote-share/links";
import { revisionSections } from "@/lib/quote-share/photo-response";
import { sentDocumentStamp } from "@/lib/quote-share/view";
import { rateLimit } from "@/lib/rate-limit";
import { logActivity } from "@/lib/stores/leads";
import { addNoteRecord } from "@/lib/stores/notes";
import { appendClientResponse, type Quote } from "@/lib/stores/quotes";
import { createTask } from "@/lib/stores/tasks";
import { allUsers } from "@/lib/users";
import {
  chicagoDayEnd, CLIENT_ACTION_COPY, CLIENT_LINK_ACTOR, confirmationText, leadEstimator, newResponseId, PEAK_NAME, RESPONSE_IP_LIMIT,
  RESPONSE_IP_WINDOW_MS, RESPONSE_QUOTE_LIMIT, RESPONSE_QUOTE_WINDOW_MS, responseAssignees, responseNoteText, responseScopes, responseTaskTitle,
  sanitizeClientResponse, type ClientActionResult, type ClientResponse, type ClientResponseKind, type RosterUser,
} from "./responses";

/**
 * #301 slice C (D-m, D-n, R15, R16) — a client's scope selection or question
 * from the package page. Every submit re-verifies: the v2 token, the pinned
 * revision is the latest sent one and the quote is `sent` (canAct; the store
 * re-checks under the row lock), then the per-IP and per-quote limits, the
 * honeypot and the field caps. Side effects are best-effort after the
 * write. Status never changes (decision 11). No cookies. Server-only.
 */

type SubmitDeps = {
  secret?: string;
  now?: () => number;
  users?: () => Promise<RosterUser[]>;
  notify?: (q: Quote, r: ClientResponse, users: RosterUser[], now: number) => Promise<void>;
};

export async function submitClientResponse(kind: ClientResponseKind, id: string, token: string, input: unknown, ip: string, deps: SubmitDeps = {}): Promise<ClientActionResult> {
  const o = (input && typeof input === "object" && !Array.isArray(input) ? input : {}) as Record<string, unknown>;
  // Honeypot: a filled hidden field looks like a success and writes nothing (adaptation 14).
  if (typeof o.website === "string" && o.website.trim()) return { ok: true, confirmation: confirmationText(PEAK_NAME) };
  if (!rateLimit(`share-respond-ip:${ip || "unknown"}`, RESPONSE_IP_LIMIT, RESPONSE_IP_WINDOW_MS).ok) return { ok: false, error: CLIENT_ACTION_COPY.tooMany };
  const now = (deps.now ?? Date.now)();
  const hit = await resolveSharedPackage(id, token, { secret: deps.secret, now });
  if (!hit) return { ok: false, error: CLIENT_ACTION_COPY.inactive };
  if (!canAct(hit.state)) return { ok: false, error: hit.state.kind === "superseded" ? CLIENT_ACTION_COPY.superseded : CLIENT_ACTION_COPY.closed };
  const clean = sanitizeClientResponse(kind, o, responseScopes(revisionSections(hit.rev)));
  if (!clean.ok) return clean;
  // The per-quote daily slot is spent only on a submission that will be written (an invalid one costs the quote nothing).
  if (!rateLimit(`share-respond-quote:${hit.q.id}`, RESPONSE_QUOTE_LIMIT, RESPONSE_QUOTE_WINDOW_MS).ok) return { ok: false, error: CLIENT_ACTION_COPY.tooMany };
  const res = await appendClientResponse(hit.q.id, hit.rev.rev, clean.value, now, newResponseId());
  if (!res.ok) return { ok: false, error: res.reason === "full" ? CLIENT_ACTION_COPY.full : res.reason === "state" ? CLIENT_ACTION_COPY.closed : CLIENT_ACTION_COPY.inactive };
  let users: RosterUser[] = [];
  try {
    users = await (deps.users ?? allUsers)();
  } catch (e) {
    console.error("[client-response] roster unavailable", e instanceof Error ? e.message : e);
  }
  const notify = deps.notify ?? notifyClientResponse;
  try {
    await notify(hit.q, res.response, users, now);
  } catch (e) {
    console.error("[client-response] notify failed", e instanceof Error ? e.message : e);
  }
  // Name the lead estimator only when they were the one notified (an inactive lead falls back to the approvers).
  const notified = responseAssignees(hit.q.owner, hit.q.preparedBy, users);
  const lead = leadEstimator(hit.q.owner, hit.q.preparedBy, users);
  return { ok: true, confirmation: confirmationText(notified.length === 1 && lead && notified[0] === lead ? lead.name : null) };
}

type NotifyDeps = {
  addNote: (input: Parameters<typeof addNoteRecord>[0], me: string) => Promise<unknown>;
  logActivity: (leadId: string, a: { type?: string; by?: string; at?: number; note?: string }, me: string) => Promise<unknown>;
  createTask: (input: Parameters<typeof createTask>[0], me: { id: string; name: string }) => Promise<unknown>;
};

const liveNotify: NotifyDeps = { addNote: addNoteRecord, logActivity, createTask };

/** R15 + R16: a system note on the quote (customer timeline), a system
 *  activity on the lead (never `note` — that stamps firstContactAt), one
 *  task per assignee. Each step on its own: one failing never stops the rest. */
export async function notifyClientResponse(q: Quote, r: ClientResponse, users: RosterUser[], now: number, deps: Partial<NotifyDeps> = {}): Promise<void> {
  const d: NotifyDeps = { ...liveNotify, ...deps };
  const number = displayQuoteNumber(q);
  const rev = (q.revisions || []).find((x) => x.rev === r.rev);
  const revNo = rev ? sentDocumentStamp(q, rev).revNo : r.rev;
  const text = responseNoteText(r, number, revNo);
  const steps: Array<() => Promise<unknown>> = [
    () => d.addNote({ parentKind: "quote", parentId: q.id, customerId: q.customerId ?? null, text, system: true }, CLIENT_LINK_ACTOR),
    ...(q.leadId ? [() => d.logActivity(q.leadId as string, { type: "system", by: CLIENT_LINK_ACTOR, at: now, note: text }, CLIENT_LINK_ACTOR)] : []),
    ...responseAssignees(q.owner, q.preparedBy, users).map((u) => () =>
      d.createTask(
        {
          title: responseTaskTitle(r, number, revNo),
          section: "Review",
          quoteId: q.id,
          assigneeUserId: u.id,
          assigneeName: u.name,
          dueAt: chicagoDayEnd(now),
          notes: text,
          ...(q.customerId ? { customerId: q.customerId } : {}),
          ...(q.leadId ? { leadId: q.leadId } : {}),
        },
        { id: "system", name: CLIENT_LINK_ACTOR }
      )
    ),
  ];
  for (const step of steps) {
    try {
      await step();
    } catch (e) {
      console.error("[client-response] side effect failed", e instanceof Error ? e.message : e);
    }
  }
}
