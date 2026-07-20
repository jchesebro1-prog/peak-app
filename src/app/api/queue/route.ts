import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { loadQueue } from "@/lib/queue";
import { getAssignment, setAssignmentDone } from "@/lib/stores/assignments";

/**
 * Queue API (D93) — the contract for the Mac-side Apple Reminders sync agent.
 * Design: docs/superpowers/specs/2026-07-19-work-queue-reminders-sync-design.md
 *
 * Apple publishes no cloud API for Reminders (osascript/EventKit are
 * local-device only), so a hosted app can never write reminders itself. The
 * agent runs on the Mac, GETs a person's open queue here, reconciles it
 * against the "Peak" list, and POSTs back completions.
 *
 * Auth: either a signed-in session (so the endpoint is inspectable in a
 * browser) or a machine token in `x-queue-token` matched against
 * QUEUE_API_TOKEN. The token lives in the Mac keychain / env — never in the
 * repo or the memory files.
 *
 * Write-back is restricted to `assignment` items AT THIS LAYER, not just in
 * the agent: a phone checkbox must never approve a review or close a
 * milestone, and a buggy client must not be able to try.
 */

async function authorize(req: Request): Promise<{ ok: boolean; who: string | null }> {
  const token = process.env.QUEUE_API_TOKEN;
  const header = req.headers.get("x-queue-token");
  if (token && header && header === token) {
    const url = new URL(req.url);
    return { ok: true, who: url.searchParams.get("who") };
  }
  const session = await auth();
  const name = session?.user?.name || null;
  return { ok: Boolean(name), who: name };
}

export async function GET(req: Request) {
  const { ok, who } = await authorize(req);
  if (!ok || !who) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const items = await loadQueue(who);
  return NextResponse.json({
    who,
    generatedAt: Date.now(),
    items: items.map((i) => ({
      key: i.key,
      source: i.source,
      title: i.title,
      context: i.context,
      due: i.due,
      href: i.href,
      writable: i.writable,
    })),
  });
}

/** Body: { key: "assignment:<id>", done: true }. Anything else is refused. */
export async function POST(req: Request) {
  const { ok } = await authorize(req);
  if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { key?: string; done?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const key = String(body?.key || "");
  if (!key.startsWith("assignment:")) {
    return NextResponse.json(
      { error: "only assignment items can be completed through this API" },
      { status: 403 }
    );
  }
  const id = key.slice("assignment:".length);
  const existing = await getAssignment(id);
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  await setAssignmentDone(id, body?.done !== false, "reminders");
  return NextResponse.json({ ok: true, id });
}
