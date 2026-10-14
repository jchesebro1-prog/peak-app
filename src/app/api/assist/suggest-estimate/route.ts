import { z } from "zod";
import { requireUser } from "@/lib/session";
import { getSettings } from "@/lib/settings";
import { assistGate, assistSettingsOf } from "@/lib/assist/config";
import { getAssistEnv } from "@/lib/assist/key-store";
import { suggestEstimate } from "@/lib/assist/estimate-suggest-server";

/** Two model calls (Haiku extract + Opus draft): ESTIMATE_BUDGET_MS is this budget. */
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const Body = z.strictObject({
  kind: z.enum(["thread", "lead", "survey", "meeting"]),
  id: z.string().trim().min(1).max(100),
});

const HEADERS = { "cache-control": "private, no-store" };
type Reply = { ok: true; suggestionId: string; href: string } | { ok: false; error: string };
const reply = (body: Reply, status = 200) => Response.json(body, { status, headers: HEADERS });

/**
 * Estimate suggestion (spec 2026-10-13 §1) — POST { kind, id } (JSON only)
 * → { ok, suggestionId, href } or { ok: false, error }. HTTP 200 for every
 * answer the client shows inline; 415 (still JSON) for a non-JSON body —
 * a cross-site form post can't be JSON, so it never reaches the model.
 * A route handler, not a server action, so no page's maxDuration or
 * one-action-at-a-time queue applies; every entry point calls it with fetch.
 * Writes only the suggestion blobs — never a quote.
 */
export async function POST(request: Request) {
  // Outside any try: a signed-out request redirects to the login page.
  const me = await requireUser();
  const type = (request.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (type !== "application/json") return reply({ ok: false, error: "Send JSON (content-type: application/json)." }, 415);
  try {
    const gate = assistGate("estimate", me.id, assistSettingsOf(await getSettings()), await getAssistEnv());
    if (!gate.ok) return reply({ ok: false, error: gate.reason });
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return reply({ ok: false, error: "Bad request." });
    }
    const parsed = Body.safeParse(raw);
    if (!parsed.success) return reply({ ok: false, error: "Bad request." });
    const r = await suggestEstimate(parsed.data, { id: me.id, name: me.name });
    return reply(r.ok ? { ok: true, suggestionId: r.suggestionId, href: r.href } : { ok: false, error: r.error });
  } catch (err) {
    console.error("[assist] estimate suggestion failed:", err);
    return reply({ ok: false, error: "Assist couldn’t respond — please try again." });
  }
}
