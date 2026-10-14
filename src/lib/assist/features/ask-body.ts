/**
 * Ask AI request body (spec 2026-10-13-ask-ai-design.md §2 "Route"). Pure.
 * The whole visible conversation, newest last — the last turn is the new
 * question. Strict: unknown keys are refused, and the client never sends refs.
 */
import { z } from "zod";
import { ASK_PAGE_MAX } from "./ask-page";

export { ASK_PAGE_MAX };

export const ASK_MAX_TURNS = 12;
export const ASK_TURN_MAX = 8000;
export const ASK_TOTAL_MAX = 40_000;
export const ASK_RUN_ID_MAX = 80;

export const AskTurnSchema = z.strictObject({
  role: z.enum(["user", "assistant"]),
  text: z.string().max(ASK_TURN_MAX),
});

export const AskBodySchema = z
  .strictObject({
    messages: z.array(AskTurnSchema).min(1).max(ASK_MAX_TURNS),
    page: z.string().max(ASK_PAGE_MAX).nullable(),
    web: z.boolean(),
    hard: z.boolean(),
    retryOf: z.string().min(1).max(ASK_RUN_ID_MAX).regex(/^AR-[a-z0-9-]+$/).nullable(),
  })
  // zod 4 runs these even when an earlier check failed — read defensively
  .refine((b) => b.messages.reduce((n, m) => n + (typeof m?.text === "string" ? m.text.length : 0), 0) <= ASK_TOTAL_MAX, { message: `The conversation is over ${ASK_TOTAL_MAX.toLocaleString("en-US")} characters.`, path: ["messages"] })
  .refine((b) => {
    const last = b.messages[b.messages.length - 1];
    return !!last && last.role === "user" && typeof last.text === "string" && last.text.trim().length > 0;
  }, { message: "The last message must be the user's question.", path: ["messages"] });

export type AskBody = z.infer<typeof AskBodySchema>;

export function parseAskBody(raw: unknown): { ok: true; body: AskBody } | { ok: false; error: string } {
  const p = AskBodySchema.safeParse(raw);
  if (p.success) return { ok: true, body: p.data };
  return { ok: false, error: p.error.issues[0]?.message || "Bad request." };
}
