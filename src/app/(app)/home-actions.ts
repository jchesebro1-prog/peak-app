"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { requireUser } from "@/lib/session";
import {
  STAGES,
  remove as removeQuote,
  setStatus as setQuoteStatus,
  statusFailureMessage,
  get as getQuote,
  type QuoteStatus,
} from "@/lib/stores/quotes";
import { REOPENED_AT_WON_NOTICE, reopenedAtWonVersion } from "@/lib/quote-won-version";

/**
 * Home dashboard mutations — port of Home.dc.html's Component methods
 * (setStatus / removeQuote) onto server actions.
 */

/** What the stage sheet gets back (#174) — see `setQuoteStatusAction`. */
/** `notice` (#355 review M8) — set when the move reopened a won estimate at the version that won. */
export type StageMoveResult = { ok: true; notice?: string } | { ok: false; error: string };

/**
 * Stage sheet "Move to stage" (prototype setStatus).
 *
 * #174: this was the worst of the callers — it caught nothing at all, so
 * `setStatus`'s throw escaped the server action. In production Next redacts
 * a server-action error to a generic digest, which meant the approval gate's
 * sentence ("This quote needs an approval on record…") never reached the
 * user here, while a spawn defect produced the same opaque failure. Now both
 * come back as a typed result: the gate's own message verbatim, anything
 * else the generic line with the real error logged — the single shared
 * branch in `statusFailureMessage`.
 */
export async function setQuoteStatusAction(
  id: string,
  status: string
): Promise<StageMoveResult> {
  const user = await requireUser();
  if (!(STAGES as readonly string[]).includes(status))
    return { ok: false, error: "That isn’t a stage a quote can move to." };
  const before = await getQuote(id);
  let after: Awaited<ReturnType<typeof setQuoteStatus>> = null;
  try {
    after = await setQuoteStatus(id, status as QuoteStatus, user.name);
  } catch (e) {
    // Next signals redirect/notFound by throwing; nothing in the try does
    // either today, but a catch in the app directory must never eat one.
    unstable_rethrow(e);
    return {
      ok: false,
      error: statusFailureMessage(
        e,
        `home-actions setQuoteStatusAction(${status}): setStatus threw`
      ),
    };
  }
  revalidatePath("/", "layout");
  return reopenedAtWonVersion(before, after) ? { ok: true, notice: REOPENED_AT_WON_NOTICE } : { ok: true };
}

/** Stage sheet "Delete" (prototype removeQuote). */
export async function removeQuoteAction(id: string) {
  const user = await requireUser();
  await removeQuote(id, user.name);
  revalidatePath("/", "layout");
}
