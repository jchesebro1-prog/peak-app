import { unstable_rethrow } from "next/navigation";
import { requireUser } from "@/lib/session";
import { ASK_FAILED_TEXT, runAsk } from "@/lib/assist/ask-runner";
import { parseAskBody } from "@/lib/assist/features/ask-body";
import { encodeEvent, type AskEvent } from "@/lib/assist/features/ask-events";

/** One question: ≤ 6 streamed rounds inside a 60 s (Haiku) / 90 s (Sonnet) wall clock, plus the run log. */
export const maxDuration = 120;
export const dynamic = "force-dynamic";

const JSON_HEADERS = { "cache-control": "private, no-store" };
const STREAM_HEADERS = { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" };
const bad = (error: string, status: number) => Response.json({ error }, { status, headers: JSON_HEADERS });

/**
 * Ask AI (spec 2026-10-13-ask-ai-design.md §2) — POST the AskBody as JSON;
 * the answer streams back as NDJSON, one AskEvent per line (ask-events.ts).
 * 415 for a non-JSON body (a cross-site form post can't be JSON), 400 for a
 * malformed one; everything else — the gate, the cap, the rate limit and any
 * failure — is a 200 stream carrying an `error` event, so the panel reads one
 * shape. `request.signal` (the panel's Stop, or a closed tab) aborts the run,
 * which is still logged.
 */
export async function POST(request: Request) {
  const type = (request.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (type !== "application/json") return bad("Send JSON (content-type: application/json).", 415);
  try {
    const me = await requireUser();
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return bad("Bad request.", 400);
    }
    const parsed = parseAskBody(raw);
    if (!parsed.ok) return bad(parsed.error, 400);
    const body = parsed.body;

    const ctl = new AbortController();
    const onAbort = () => ctl.abort();
    if (request.signal.aborted) ctl.abort();
    request.signal.addEventListener("abort", onAbort);
    const enc = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let open = true;
        const emit = (e: AskEvent) => {
          if (!open) return;
          try {
            controller.enqueue(enc.encode(encodeEvent(e)));
          } catch {
            open = false;
          }
        };
        try {
          await runAsk(body, { id: me.id, name: me.name }, emit, { signal: ctl.signal });
        } catch (err) {
          console.error("[ask] stream failed:", err);
          emit({ t: "error", message: ASK_FAILED_TEXT });
        } finally {
          open = false;
          request.signal.removeEventListener("abort", onAbort);
          try {
            controller.close();
          } catch {
            /* already closed by a cancel */
          }
        }
      },
      cancel() {
        ctl.abort();
      },
    });
    return new Response(stream, { status: 200, headers: STREAM_HEADERS });
  } catch (err) {
    // A signed-out request's redirect passes through.
    unstable_rethrow(err);
    console.error("[ask] request failed:", err);
    return bad(ASK_FAILED_TEXT, 500);
  }
}
