/**
 * #96 — wires the pure resolver to real data and stamps threads. Backfill and
 * re-sweep live here too (Task 4).
 */
import { contactByEmail } from "@/lib/identity/lookup";
import { nameFor as customerNameFor } from "@/lib/stores/customers";
import type { CommThread } from "@/lib/stores/comms";
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
