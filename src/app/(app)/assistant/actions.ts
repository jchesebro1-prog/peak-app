"use server";

import { requireUser } from "@/lib/session";
import { aiEnabled } from "@/lib/ai/config";
import { AiError } from "@/lib/ai/client";
import { answerBusinessQuestion } from "@/lib/ai/features";
import { buildBusinessSnapshot } from "./snapshot";

/**
 * "Ask about your business data" (Phase 8, D5). Builds a live snapshot of the
 * app's stores and asks the model to answer over it. Read-only — the assistant
 * never writes anything (D6 guardrail). Any signed-in user may ask; the
 * snapshot is scoped to their Inbox view but otherwise company-wide, matching
 * what they can already see across the app.
 */
export type AskResult =
  | { ok: true; answer: string }
  | { ok: false; error: string };

export async function askAction(question: string): Promise<AskResult> {
  const me = await requireUser();
  if (!aiEnabled()) {
    return { ok: false, error: "AI features are not enabled." };
  }
  const q = (question || "").trim();
  if (!q) return { ok: false, error: "Ask a question first." };
  if (q.length > 2000) {
    return { ok: false, error: "That question is too long — please shorten it." };
  }
  try {
    const snapshot = await buildBusinessSnapshot(me.name);
    const answer = await answerBusinessQuestion({ question: q, snapshot });
    return { ok: true, answer };
  } catch (e) {
    if (e instanceof AiError) return { ok: false, error: e.message };
    console.error("[assistant] askAction failed:", e);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}
