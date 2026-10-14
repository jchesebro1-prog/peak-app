import { requireUser } from "@/lib/session";
import { askGateFor } from "@/lib/assist/gate-server";
import { ASK_PAGE_MAX, parsePage } from "@/lib/assist/features/ask-page";
import { resolveAskRef } from "@/lib/assist/ask-tools-server";

export const dynamic = "force-dynamic";

const HEADERS = { "cache-control": "private, no-store" };

/**
 * Ask AI context chip (spec 2026-10-13 §3) — GET ?page=<pathname + search>
 * → `{ ref: {kind, id, title, href}, title }` for the record the panel was
 * opened over, or `null` (unknown route, missing or forbidden record, Ask AI
 * off for this user or no Claude key). The cheap ref check only — the record
 * text never leaves the server here; the ask route loads the summary itself.
 */
export async function GET(request: Request) {
  // Outside any try: a signed-out request redirects to the login page.
  const me = await requireUser();
  try {
    if (await askGateFor(me.id)) return Response.json(null, { headers: HEADERS });
    const page = new URL(request.url).searchParams.get("page") || "";
    if (!page || page.length > ASK_PAGE_MAX) return Response.json(null, { headers: HEADERS });
    const at = parsePage(page);
    const ref = at ? await resolveAskRef(at.kind, at.id, { id: me.id, name: me.name }) : null;
    return Response.json(ref ? { ref, title: ref.title } : null, { headers: HEADERS });
  } catch (err) {
    console.error("[ask] page context failed:", err);
    return Response.json(null, { headers: HEADERS });
  }
}
