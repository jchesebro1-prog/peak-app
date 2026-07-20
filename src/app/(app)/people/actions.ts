"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import {
  getContact,
  saveContact,
  setEmails,
  setPhones,
  softDeleteContact,
} from "@/lib/identity/contacts";
import { CONTACT_STATUSES, PRICING_TIERS } from "@/lib/identity/config";
import { mintId } from "@/lib/identity/ids";
import type { SavePersonInput } from "./types";

export type SavePersonResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

export async function savePersonAction(
  input: SavePersonInput
): Promise<SavePersonResult> {
  const me = await requireUser();
  const firstName = (input.firstName || "").trim();
  const lastName = (input.lastName || "").trim();
  if (!firstName && !lastName) {
    return { ok: false, error: "A person needs a name." };
  }
  const status = (CONTACT_STATUSES as readonly string[]).includes(input.status)
    ? input.status
    : "active";

  const existing = input.id ? await getContact(input.id) : null;
  const id = existing?.id ?? mintId("ct");
  await saveContact({
    id,
    firstName,
    lastName,
    homeCompanyId: input.homeCompanyId || null,
    title: (input.title || "").trim(),
    pricingTier: (PRICING_TIERS as readonly string[]).includes(
      input.pricingTier || ""
    )
      ? input.pricingTier
      : null,
    status,
    userId: existing?.userId ?? null,
    ownerUserId: existing?.ownerUserId ?? me.id,
    isPrimary: !!input.isPrimary,
    createdAt: existing?.createdAt ?? Date.now(),
  });
  // The People modal owns the FULL channel lists (unlike the legacy customer
  // seam, which only carries one email/phone) — full replace is correct here.
  await setEmails(id, input.emails || []);
  await setPhones(id, input.phones || []);
  revalidatePath("/", "layout");
  return { ok: true, id };
}

export async function deletePersonAction(
  id: string
): Promise<{ ok: boolean }> {
  await requireUser();
  if (id) await softDeleteContact(id);
  revalidatePath("/", "layout");
  return { ok: true };
}
