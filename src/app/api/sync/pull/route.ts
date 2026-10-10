import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { listSince } from "@/db/doc-store";
import { pullCollections } from "@/lib/sync/pull-collections";

/**
 * Cursor-based pull — GET /api/sync/pull?cursors={"comms":123,...}
 * Returns changes (including soft-deletes and review updates) per
 * collection after each cursor. The Phase 6 client applies these to its
 * local cache and advances the stored cursor.
 *
 * #323 final review: only the offline field collections (pullCollections →
 * SYNCABLE_COLLECTIONS) are ever served — never meetings (other reps'
 * private notes and transcripts) or any other server-authoritative table.
 */
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.active) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  let cursors: Record<string, number> = {};
  try {
    cursors = JSON.parse(url.searchParams.get("cursors") || "{}");
  } catch {
    return NextResponse.json({ error: "bad cursors" }, { status: 400 });
  }
  const collections = pullCollections(url.searchParams.get("collections"));

  const changes: Record<string, unknown[]> = {};
  const nextCursors: Record<string, number> = {};
  for (const coll of collections) {
    const res = await listSince(coll, Number(cursors[coll] || 0));
    changes[coll] = res.changes;
    nextCursors[coll] = res.cursor;
  }
  return NextResponse.json({ changes, cursors: nextCursors });
}
