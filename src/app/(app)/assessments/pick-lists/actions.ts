"use server";

import { revalidatePath } from "next/cache";
import { getOptionalUser } from "@/lib/session";
import { can } from "@/lib/team";
import { addPicklistValue, setPicklistRetired } from "@/lib/stores/assessment-picklists";

/* Pick-list admin (#340 Task 11): adding and retiring the values an administrator adds to the assessment's code
   lists. The definition's own values never change. Needs `manage_users`; answers rather than throws, so the form
   can show the sentence. */

type Reply = { ok: true } | { ok: false; error: string };

async function admin(): Promise<Reply> {
  const user = await getOptionalUser();
  if (!user) return { ok: false, error: "Sign in again to change pick lists." };
  if (!can("manage_users", user.roles)) return { ok: false, error: "Only an administrator changes pick lists." };
  return { ok: true };
}

const refresh = () => {
  // The editor reads the added values when it renders, so every assessment page picks the change up.
  revalidatePath("/assessments", "layout");
};

/** Adds `label` to a list; the stored value is its slug. Refuses an unknown list, a blank label, a duplicate. */
export async function addPicklistValueAction(listId: string, label: string): Promise<Reply> {
  const gate = await admin();
  if (!gate.ok) return gate;
  if (typeof listId !== "string" || typeof label !== "string") return { ok: false, error: "Enter a label" };
  const r = await addPicklistValue(listId, label);
  if (r.ok) refresh();
  return r;
}

/** Retires an added value (it stays valid on stored answers, it just isn't offered), or brings it back. */
export async function setPicklistRetiredAction(listId: string, value: string, retired: boolean): Promise<Reply> {
  const gate = await admin();
  if (!gate.ok) return gate;
  if (typeof listId !== "string" || typeof value !== "string" || typeof retired !== "boolean") return { ok: false, error: "Nothing to change" };
  await setPicklistRetired(listId, value, retired);
  refresh();
  return { ok: true };
}
