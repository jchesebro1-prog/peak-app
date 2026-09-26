"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { requireUser } from "@/lib/session";
import {
  STAGES,
  remove as removeQuote,
  setStatus as setQuoteStatus,
  statusFailureMessage,
  type QuoteStatus,
} from "@/lib/stores/quotes";
import { promoteDesignAction as promoteFromDesigns } from "./design/designs/actions";

/**
 * Home dashboard mutations — port of Home.dc.html's Component methods
 * (setStatus / removeQuote / promoteDesign) onto server actions.
 */

/** What the stage sheet gets back (#174) — see `setQuoteStatusAction`. */
export type StageMoveResult = { ok: true } | { ok: false; error: string };

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
  await requireUser();
  if (!(STAGES as readonly string[]).includes(status))
    return { ok: false, error: "That isn’t a stage a quote can move to." };
  try {
    await setQuoteStatus(id, status as QuoteStatus);
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
  return { ok: true };
}

/** Stage sheet "Delete" (prototype removeQuote). */
export async function removeQuoteAction(id: string) {
  await requireUser();
  await removeQuote(id);
  revalidatePath("/", "layout");
}

/**
 * The bridge: promote a budgetary sandbox design into the formal pipeline.
 * Port of Home.dc.html promoteDesign(). #GEM final review I2: delegates to
 * the Designs dashboard's promoteDesignAction — the one path that branches
 * Grid/manual designs to The Grid's own quote builder and re-prices Quick
 * designs on the server against the Equipment map (D-GEM-19) — so Home can
 * never promote a Grid design as if it were Quick, or an incomplete one.
 */
export async function promoteDesignAction(
  designId: string
): Promise<{ ok: true; id: string } | { ok: false; error: string; needsPart?: number }> {
  const res = await promoteFromDesigns(designId);
  if (!res.ok) return res;
  revalidatePath("/", "layout");
  return { ok: true, id: res.quoteId };
}
