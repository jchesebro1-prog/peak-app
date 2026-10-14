import { requireUser } from "@/lib/session";
import { gateFor } from "@/lib/assist/gate-server";
import { ASK_PAGE_MAX } from "@/lib/assist/features/ask-page";
import { pageContext } from "@/lib/assist/ask-context-server";

export const dynamic = "force-dynamic";

const HEADERS = { "cache-control": "private, no-store" };

/**
 * Ask AI context chip (spec 2026-10-13 §3) — GET ?page=<pathname + search>
 * → `{ ref: {kind, id, title, href}, title }` for the record the panel was
 * opened over, or `null` (unknown route, missing or forbidden record, Ask AI
 * off for this user). Read-only; the record text itself never leaves the
 * server here — the ask route loads it again for the prompt.
 */
export async function GET(request: Request) {
  // Outside any try: a signed-out request redirects to the login page.
  const me = await requireUser();
  try {
    if (await gateFor("ask", me.id)) return Response.json(null, { headers: HEADERS });
    const page = new URL(request.url).searchParams.get("page") || "";
    if (!page || page.length > ASK_PAGE_MAX) return Response.json(null, { headers: HEADERS });
    const ctx = await pageContext(page, { id: me.id, name: me.name });
    return Response.json(ctx ? { ref: ctx.ref, title: ctx.title } : null, { headers: HEADERS });
  } catch (err) {
    console.error("[ask] page context failed:", err);
    return Response.json(null, { headers: HEADERS });
  }
}
