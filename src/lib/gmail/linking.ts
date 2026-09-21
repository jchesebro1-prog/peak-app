/**
 * #96 — wires the pure resolver to real data and stamps threads. Backfill and
 * re-sweep live here too (Task 4).
 */
import { listDocs, patchDoc } from "@/db/doc-store";
import { contactByEmail } from "@/lib/identity/lookup";
import { nameFor as customerNameFor } from "@/lib/stores/customers";
import type { CommThread } from "@/lib/stores/comms";
import { domainOf } from "./config";
import { customersForDomain } from "./domains";
import { resolveSender, type Resolution } from "./resolve";

export async function resolveForThread(email: string): Promise<Resolution> {
  return resolveSender(email, {
    contactByEmail,
    customersByDomain: async (d) => (await customersForDomain(d)).map((r) => r.customerId),
  });
}

/** Mutates `t` in place. Never downgrades an existing customerId. */
export async function applyResolution(t: CommThread, r: Resolution): Promise<void> {
  if (t.customerId) {
    t.resolution = "linked";
    return;
  }
  if (r.kind === "linked" && r.via === "contact") {
    t.customerId = r.customerId;
    t.customer = await customerNameFor(r.customerId);
    t.resolvedContactId = r.contactId ?? null;
    t.resolution = "linked";
    t.suggestedCustomerId = null;
    t.candidates = [];
  } else if (r.kind === "linked" && r.via === "domain") {
    t.resolution = t.suggestionDismissed ? "unknown" : "suggested";
    t.suggestedCustomerId = r.customerId;
    t.candidates = [];
  } else if (r.kind === "ambiguous") {
    t.resolution = "ambiguous";
    t.suggestedCustomerId = null;
    t.candidates = await Promise.all(
      r.candidates.map(async (c) => ({ customerId: c.customerId, name: await customerNameFor(c.customerId) }))
    );
  } else {
    t.resolution = "unknown";
    t.suggestedCustomerId = null;
    t.candidates = [];
  }
}

function matchesFilter(t: CommThread, f?: { email?: string; domain?: string }): boolean {
  if (!f) return true;
  const e = (t.contactEmail || "").toLowerCase();
  if (f.email && e !== f.email.toLowerCase()) return false;
  if (f.domain && domainOf(e) !== f.domain.toLowerCase()) return false;
  return true;
}

/** Re-run the resolver over unlinked threads. Idempotent; patches only when
 *  something changes. */
export async function resweepThreads(
  filter?: { email?: string; domain?: string },
  onlyAccountKey?: string
): Promise<number> {
  const all = await listDocs<CommThread>("comms");
  let changed = 0;
  for (const t of all) {
    if (t.deleted) continue;
    if (t.customerId && t.resolution === "linked") continue;
    if (onlyAccountKey && t.gmailAccountKey !== onlyAccountKey) continue;
    if (!matchesFilter(t, filter)) continue;
    if (!t.contactEmail) continue;
    const r = await resolveForThread(t.contactEmail);
    const before = JSON.stringify([t.customerId, t.resolution, t.suggestedCustomerId, t.candidates]);
    const next = { ...t };
    await applyResolution(next, r);
    const after = JSON.stringify([next.customerId, next.resolution, next.suggestedCustomerId, next.candidates]);
    if (before === after) continue;
    await patchDoc<CommThread>("comms", t.id, (d) => {
      d.customerId = next.customerId;
      d.customer = next.customer;
      d.resolvedContactId = next.resolvedContactId ?? null;
      d.resolution = next.resolution;
      d.suggestedCustomerId = next.suggestedCustomerId ?? null;
      d.candidates = next.candidates ?? [];
    });
    changed++;
  }
  return changed;
}

export async function backfillMailbox(key: string): Promise<number> {
  return resweepThreads(undefined, key);
}
