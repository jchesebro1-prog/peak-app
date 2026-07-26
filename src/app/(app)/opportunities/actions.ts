"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { get as getLead, setStage } from "@/lib/stores/leads";
import { get as getQuote, setPoReceived } from "@/lib/stores/quotes";
import { allowedMoves, leadColumn, leadStageForCol, quoteColumn } from "@/lib/opportunities";

/**
 * One dispatch action for opportunity-board drags (#18). The id prefix is
 * the source discriminator (L- lead / Q- quote); the move is RE-VALIDATED
 * here with the same pure policy the board used — never trust the client's
 * canMoveTo. Lead drags write lead stages; quote drags only ever toggle the
 * PO-received flag (the won/lost spawn machinery stays behind setQuoteStatus,
 * which the board never calls).
 */
export async function moveOpportunityAction(id: string, colKey: string): Promise<{ ok: boolean }> {
  const me = await requireUser();

  if (id.startsWith("L-")) {
    const l = await getLead(id);
    const col = l ? leadColumn(l.stage) : null;
    if (!l || !col) return { ok: false };
    const legal = allowedMoves({ kind: "lead", col, srcStage: l.stage });
    const stage = leadStageForCol(colKey);
    if (!(legal as string[]).includes(colKey) || !stage) return { ok: false };
    await setStage(id, stage, me.name);
    revalidatePath("/", "layout");
    return { ok: true };
  }

  if (id.startsWith("Q-")) {
    const q = await getQuote(id);
    const col = q ? quoteColumn({ status: q.status, poReceivedAt: q.poReceivedAt ?? null }) : null;
    if (!q || !col) return { ok: false };
    const legal = allowedMoves({ kind: "quote", col, srcStage: q.status });
    if (!(legal as string[]).includes(colKey)) return { ok: false };
    const updated = await setPoReceived(id, colKey === "po_received");
    if (!updated) return { ok: false };
    revalidatePath("/", "layout");
    return { ok: true };
  }

  return { ok: false };
}
