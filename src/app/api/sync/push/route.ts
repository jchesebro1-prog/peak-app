import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  DOC_TABLES,
  type CollectionName,
} from "@/db/doc-tables";
import { getDb } from "@/db";
import { eq, sql } from "drizzle-orm";

/**
 * Batched document push — the server side of the prototype's
 * SyncEngine/CloudStore seam (docs/specs/sync-architecture.json).
 *
 * Body: { collections: { [coll]: [{ id, rev, updatedAt, doc }] } }
 * Reply: { results: { [coll]: [{ id, status: "ok"|"conflict", rev, seq }] } }
 *
 * Semantics (ported from CloudStore._put):
 * - whole-document upsert keyed by client id (client-generated ids accepted)
 * - server preserves its own `review` subdoc on re-push
 * - last-write-wins like the prototype, but a stale rev is reported as
 *   "conflict" with the server copy so the client can surface it
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.active) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await req.json()) as {
    collections?: Record<
      string,
      Array<{ id: string; rev?: number; doc: Record<string, unknown> }>
    >;
  };
  const collections = body.collections || {};
  const db = await getDb();
  const results: Record<
    string,
    Array<{
      id: string;
      status: "ok" | "conflict" | "error";
      rev?: number;
      server?: Record<string, unknown>;
    }>
  > = {};

  for (const [coll, records] of Object.entries(collections)) {
    const t = DOC_TABLES[coll as CollectionName];
    if (!t || !Array.isArray(records)) continue;
    results[coll] = [];
    for (const rec of records) {
      if (!rec?.id || typeof rec.id !== "string" || !rec.doc) {
        results[coll].push({ id: String(rec?.id ?? "?"), status: "error" });
        continue;
      }
      try {
        const existing = await db
          .select()
          .from(t)
          .where(eq(t.id, rec.id))
          .limit(1);
        const now = Date.now();
        const doc = { ...rec.doc, id: rec.id };
        if (!existing.length) {
          await db.insert(t).values({
            id: rec.id,
            doc,
            rev: rec.rev ?? 1,
            updatedAt: now,
            receivedAt: now,
            review: { state: "new" },
            deleted: false,
          });
          results[coll].push({ id: rec.id, status: "ok", rev: rec.rev ?? 1 });
        } else if (
          typeof rec.rev === "number" &&
          rec.rev < existing[0].rev
        ) {
          results[coll].push({
            id: rec.id,
            status: "conflict",
            rev: existing[0].rev,
            server: { ...(existing[0].doc as object), id: rec.id },
          });
        } else {
          await db
            .update(t)
            .set({
              doc,
              rev:
                typeof rec.rev === "number"
                  ? sql`GREATEST(${t.rev}, ${rec.rev})`
                  : sql`${t.rev} + 1`,
              updatedAt: now,
              receivedAt: now,
              deleted: false,
              // review deliberately untouched — server-owned
            })
            .where(eq(t.id, rec.id));
          results[coll].push({ id: rec.id, status: "ok", rev: rec.rev });
        }
      } catch {
        results[coll].push({ id: rec.id, status: "error" });
      }
    }
  }
  return NextResponse.json({ results });
}
