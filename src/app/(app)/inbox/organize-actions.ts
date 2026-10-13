"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { runAiPass } from "@/lib/inbox-org/ai-pass";
import { isOrgPilot, loadOrgContext } from "@/lib/inbox-org/pipeline";
import {
  acceptRuleOffer,
  approveAllStrong,
  approveFiling,
  changeFiling,
  markNoise,
  notNoise,
  overrideCourt,
  skipFiling,
  undoFiling,
  undoPromiseTask,
  type FilingTarget,
  type OrgActor,
  type RuleChoice,
  type RuleOffer,
} from "@/lib/inbox-org/apply";
import type { CourtOwner, Filing } from "@/lib/inbox-org/types";
import { customerRecordCandidates, likelyFilingCustomer } from "@/lib/inbox-org/ai-filing";
import { filingSenderOf } from "@/lib/inbox-org/pipeline";
import { get as getThread, visibleTo } from "@/lib/stores/comms";
import { nameFor as customerNameFor } from "@/lib/stores/customers";

/** #335 Inbox organization — run the time-boxed AI pass over my own
 *  pendingAi threads now (the Organize view's "Sync now"-style button).
 *  Pilot only; suggestions and promise-tasks only — nothing is sent. */
export async function runAiPassAction(): Promise<
  { ok: true; looked: number; filed: number; courts: number; tasks: number; more: boolean } | { ok: false; error: string }
> {
  const me = await requireUser();
  const ctx = await loadOrgContext();
  if (!isOrgPilot(me.id, "file", ctx) && !isOrgPilot(me.id, "promise", ctx)) return { ok: false, error: "Assist isn't enabled for you." };
  // leases make it safe beside a sync pass running for the same threads
  const r = await runAiPass({ ownerIds: [me.id] }, { ctx });
  if (r.changed) revalidatePath("/inbox");
  return { ok: true, looked: r.looked, filed: r.filed, courts: r.courts, tasks: r.tasks, more: r.stoppedByBudget };
}

/* ---- thin wrappers over src/lib/inbox-org/apply.ts (the Organize view and
 * the reader call these; every check — visibility, the target's records,
 * admin-only company rules — lives in apply.ts) ---------------------------- */

async function actor(): Promise<OrgActor> {
  const u = await requireUser();
  return { id: u.id, name: u.name, roles: u.roles };
}

const str = (v: unknown, max = 200): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

function revalidate() {
  revalidatePath("/", "layout");
}

export async function approveFilingAction(threadId: string) {
  const r = await approveFiling(str(threadId), await actor());
  revalidate();
  return r;
}

export async function changeFilingAction(threadId: string, target: FilingTarget) {
  const t = target && typeof target === "object" ? target : {};
  const work = t.work && typeof t.work === "object" ? { type: str(t.work.type, 20), id: str(t.work.id) } : null;
  const r = await changeFiling(str(threadId), { customerId: str(t.customerId) || null, siteId: str(t.siteId) || null, work }, await actor());
  revalidate();
  return r;
}

export async function markNoiseAction(threadId: string) {
  const r = await markNoise(str(threadId), await actor());
  revalidate();
  return r;
}

export async function notNoiseAction(threadId: string) {
  const r = await notNoise(str(threadId), await actor());
  revalidate();
  return r;
}

export async function skipFilingAction(threadId: string) {
  const r = await skipFiling(str(threadId), await actor());
  revalidate();
  return r;
}

export async function undoFilingAction(threadId: string) {
  const r = await undoFiling(str(threadId), await actor());
  revalidate();
  return r;
}

/** `ids`: the rows the person sees, or "all-visible" for their whole To file
 *  list (capped server-side). */
export async function approveAllStrongAction(ids: string[] | "all-visible") {
  const list = ids === "all-visible" ? ids : Array.isArray(ids) ? ids.slice(0, 1000).map((x) => str(x)) : [];
  const r = await approveAllStrong(list, await actor());
  revalidate();
  return r;
}

export async function acceptRuleOfferAction(offer: RuleOffer, choice: RuleChoice) {
  const o = offer && typeof offer === "object" ? offer : ({} as RuleOffer);
  let target: RuleOffer["target"];
  if (o.target === "noise" || o.target === "never-noise") target = o.target;
  else if (o.target && typeof o.target === "object") {
    const w = o.target.work && typeof o.target.work === "object" ? o.target.work : null;
    // the work type is re-checked (quote / project / lead) and the record
    // re-read by acceptRuleOffer — this only strips unknown fields
    target = { customerId: str(o.target.customerId), ...(w ? { work: { type: str(w.type, 20), id: str(w.id) } as NonNullable<Filing["work"]> } : {}) };
  } else return { ok: false as const, error: "bad-target" as const, message: "Choose what the rule does." };
  const c = choice && typeof choice === "object" ? choice : ({} as RuleChoice);
  const r = await acceptRuleOffer(
    { email: str(o.email, 320), domain: str(o.domain, 255) || null, target },
    { match: c.match === "domain" ? "domain" : "email", scope: c.scope === "company" ? "company" : "user" },
    await actor()
  );
  revalidate();
  return r;
}

export async function overrideCourtAction(threadId: string, owner: CourtOwner, teammateId?: string) {
  const r = await overrideCourt(str(threadId), owner, await actor(), { teammateId: str(teammateId) || undefined });
  revalidate();
  return r;
}

export async function undoPromiseTaskAction(threadId: string, taskId: string) {
  const r = await undoPromiseTask(str(threadId), str(taskId), await actor());
  revalidate();
  return r;
}

/** Change…'s second group (spec §2): the open quotes, active projects and open
 *  leads of one customer — `customerId` when the person picked a company,
 *  else the thread's likely customer (the same store reads the AI candidate
 *  list uses). Only for the person's own thread; ids only — every pick is
 *  re-checked by changeFiling. */
const FILING_RECORDS_MAX = 30;

export async function filingRecordsAction(
  threadId: string,
  customerId?: string | null
): Promise<
  | { ok: true; customer: { id: string; name: string } | null; records: Array<{ id: string; type: "quote" | "project" | "lead"; label: string }> }
  | { ok: false; error: string }
> {
  const me = await requireUser();
  const t = await getThread(str(threadId));
  if (!t || t.deleted || t.status === "draft" || !visibleTo(t, me.name)) return { ok: false, error: "Thread not found." };
  let cid = str(customerId);
  if (!cid) cid = (await likelyFilingCustomer(t, filingSenderOf(t, await loadOrgContext()))) || "";
  if (!cid) return { ok: true, customer: null, records: [] };
  const name = await customerNameFor(cid).catch(() => "");
  if (!name) return { ok: true, customer: null, records: [] };
  const recs = await customerRecordCandidates(cid, name, FILING_RECORDS_MAX);
  return {
    ok: true,
    customer: { id: cid, name },
    records: recs.flatMap((r) => (r.type === "customer" ? [] : [{ id: r.id, type: r.type, label: r.label }])),
  };
}
