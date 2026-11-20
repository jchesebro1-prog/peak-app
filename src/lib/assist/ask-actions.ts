"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { recordAskConfirm } from "@/lib/stores/assist-runs";
import { ASK_CARD_KINDS, type AskCardKind } from "./features/ask-cards";
import { ASK_RUN_ID_MAX } from "./features/ask-body";

const RUN_ID_RE = /^AR-[a-z0-9-]+$/;

/**
 * Ask AI — a proposal card was confirmed (spec 2026-10-13 §4). Called by the
 * panel after the card's own action (create task, add note, open composer,
 * Suggest estimate) went through; that action re-checks its permissions
 * itself. Records only: the asker's own `ask` run gets outcome `accepted`
 * when still undecided, and `kind` joins `outcomeDetail.confirmed` (≤ 20).
 */
export async function recordAskCardAction(runId: string, kind: AskCardKind): Promise<{ ok: boolean }> {
  const me = await requireUser();
  const id = typeof runId === "string" ? runId : "";
  if (!id || id.length > ASK_RUN_ID_MAX || !RUN_ID_RE.test(id)) return { ok: false };
  if (!ASK_CARD_KINDS.includes(kind)) return { ok: false };
  return { ok: await recordAskConfirm(id, me.id, kind) };
}

/** Ask AI — a task card. Tasks were removed from the app, so the card can no longer be confirmed. */
export async function createAskTaskAction(_req: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  void _req;
  await requireUser();
  return { ok: false, error: "Tasks were removed from the app." };
}
