"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { contactsForId } from "@/lib/stores/customers";
import { savePersonAction } from "@/app/(app)/people/actions";
import type { SavePersonInput } from "@/app/(app)/people/types";

/** The "new contact" quick-add (the vendor Contacts tab). */
export async function quickAddContactAction(input: {
  customerId: string;
  name: string;
  role: string;
  email: string;
  phone: string;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  await requireUser();
  const nm = (input.name || "").trim();
  if (!nm) return { ok: false, error: "Enter a name." };
  const sp = nm.lastIndexOf(" ");
  const email = (input.email || "").trim();
  const phone = (input.phone || "").trim();
  const person: SavePersonInput = {
    firstName: sp > 0 ? nm.slice(0, sp) : nm,
    lastName: sp > 0 ? nm.slice(sp + 1) : "",
    title: input.role || "",
    homeCompanyId: input.customerId,
    status: "active",
    pricingTier: null,
    isPrimary: ((await contactsForId(input.customerId)) || []).length === 0,
    emails: email ? [{ value: email, label: "work", isPrimary: true }] : [],
    phones: phone ? [{ value: phone, label: "work", isPrimary: true }] : [],
  };
  const res = await savePersonAction(person);
  if (!res.ok) return res;
  revalidatePath("/", "layout");
  return res;
}
