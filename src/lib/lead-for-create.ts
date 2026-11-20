import { get as getLead } from "@/lib/stores/leads";
import { HANDOFF_LEAD_RE } from "@/app/(app)/quotes/new/handoff";

/**
 * The lead a NEW quote is stamped with: a well-formed id of a lead that
 * exists, else null (an unknown lead would only skew the estimate number,
 * which carries from the lead). Never used on an update — a saved quote keeps
 * the lead it has.
 */
export async function leadIdForCreate(raw: unknown): Promise<string | null> {
  if (typeof raw !== "string") return null;
  const id = raw.trim();
  if (!id || !HANDOFF_LEAD_RE.test(id)) return null;
  try {
    return (await getLead(id)) ? id : null;
  } catch {
    return null;
  }
}
