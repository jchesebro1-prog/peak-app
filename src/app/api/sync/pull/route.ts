import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { listSince } from "@/db/doc-store";
import { DOC_TABLES, type CollectionName } from "@/db/doc-tables";

/**
 * Cursor-based pull — GET /api/sync/pull?cursors={"comms":123,...}
 * Returns changes (including soft-deletes and review updates) per
 * collection after each cursor. The Phase 6 client applies these to its
 * local cache and advances the stored cursor.
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
  const collections =
    url.searchParams.get("collections")?.split(",").filter(Boolean) ||
    Object.keys(DOC_TABLES);

  const changes: Record<string, unknown[]> = {};
  const nextCursors: Record<string, number> = {};
  for (const coll of collections) {
    if (!(coll in DOC_TABLES)) continue;
    const res = await listSince(
      coll as CollectionName,
      Number(cursors[coll] || 0)
    );
    changes[coll] = res.changes;
    nextCursors[coll] = res.cursor;
  }
  return NextResponse.json({ changes, cursors: nextCursors });
}
