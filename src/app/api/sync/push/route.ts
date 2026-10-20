import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  DOC_TABLES,
  SYNCABLE_SET,
  type CollectionName,
} from "@/db/doc-tables";
import { getDb } from "@/db";
import { eq, sql } from "drizzle-orm";
import { loadPipelines } from "@/lib/pipelines-server";
import { normalizeProject, type ProjectRecord } from "@/lib/stores/projects";
import type { Pipelines } from "@/lib/pipelines";
import { pushAssessment } from "@/lib/stores/assessments";
import { pushFinding } from "@/lib/stores/findings";
import { pushSurvey } from "@/lib/stores/surveys";
import { sanitizePushedDoc } from "@/lib/sync/server-owned";
import { mayPullFieldData } from "@/lib/sync/pull-collections";
import { taskPushDecision, TASK_PUSH_REFUSED } from "@/lib/sync/task-push";
import { getProject } from "@/lib/stores/projects";

/** Abuse guards for the open sync endpoint. */
const MAX_RECORDS_PER_COLLECTION = 1000;
const MAX_DOC_BYTES = 512 * 1024; // 512 KB per document

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
  // #356 review — the pull's gate (Jeff 2026-10-15 #39): only field roles (`create`) write field data. The client
  // parks every entry of a refused push as read-only (engine pushParksOn), so a 403 is never retried.
  if (!mayPullFieldData(session.user.roles)) {
    return NextResponse.json({ error: "read-only" }, { status: 403 });
  }
  const pusher = { id: String(session.user.id ?? ""), name: String(session.user.name ?? "") };
  const projectSeen = new Map<string, boolean>();
  const projectExists = async (id: string): Promise<boolean> => {
    if (!projectSeen.has(id)) projectSeen.set(id, !!(await getProject(id)));
    return projectSeen.get(id)!;
  };
  const body = (await req.json()) as {
    collections?: Record<
      string,
      Array<{ id: string; rev?: number; doc: Record<string, unknown> }>
    >;
  };
  const collections = body.collections || {};
  const db = await getDb();
  // Loaded once, only if a projects batch arrives — an offline device may still
  // hold a pre-pipeline stage key; it's converted before it's stored.
  let pipes: Pipelines | null = null;
  const results: Record<
    string,
    Array<{
      id: string;
      status: "ok" | "conflict" | "error" | "retry";
      rev?: number;
      server?: Record<string, unknown>;
      error?: string;
    }>
  > = {};

  for (const [coll, records] of Object.entries(collections)) {
    const t = DOC_TABLES[coll as CollectionName];
    // Only genuinely offline-synced collections may be written here. Quotes,
    // designs, leads, comms and catalog_parts are managed through
    // permission-checked server actions — never accept them over sync, or the
    // approval gate and catalog prices could be rewritten by any active user.
    if (!t || !SYNCABLE_SET.has(coll) || !Array.isArray(records)) continue;
    results[coll] = [];
    for (const rec of records.slice(0, MAX_RECORDS_PER_COLLECTION)) {
      if (
        !rec?.id ||
        typeof rec.id !== "string" ||
        !rec.doc ||
        typeof rec.doc !== "object" ||
        Array.isArray(rec.doc)
      ) {
        results[coll].push({ id: String(rec?.id ?? "?"), status: "error" });
        continue;
      }
      if (JSON.stringify(rec.doc).length > MAX_DOC_BYTES) {
        results[coll].push({ id: rec.id, status: "error" });
        continue;
      }
      // Assessments engine (#340): never a whole-document replace. Each needs
      // `create`; answers merge per key and findings get their printed id
      // from the server (see the stores). Assessments are never created here
      // and never reply conflict: ok + the stored rev (anything skipped is in
      // the doc's server-written syncRejects), error + a message (a permanent
      // refusal, parked in the outbox), or retry (a throw — the entry stays
      // pending). Findings: ok, conflict + the server copy, error, or retry.
      if (coll === "assessments" || coll === "findings") {
        const user = { id: String(session.user.id ?? ""), roles: session.user.roles };
        const one = { id: rec.id, rev: rec.rev, doc: rec.doc };
        results[coll].push(coll === "assessments" ? await pushAssessment(one, user) : await pushFinding(one, user));
        continue;
      }
      // Venue Assessment surveys (#344 C4): the same whole-document upsert as
      // below, but under the survey's advisory lock and merged with the stored
      // doc so a finished photo / sketch file is never replaced by the pushed
      // copy's still-pending slot (the device photo queue may have finished it
      // after this copy was made). A throw replies retry.
      if (coll === "surveys") {
        results[coll].push(await pushSurvey({ id: rec.id, rev: rec.rev, doc: rec.doc }));
        continue;
      }
      try {
        const existing = await db
          .select()
          .from(t)
          .where(eq(t.id, rec.id))
          .limit(1);
        const now = Date.now();
        // #356 review — a task push may insert only a new Field Work task and update only a field task on its own
        // project, or a task the pusher is assigned to / created (lib/sync/task-push)
        let pushDoc: Record<string, unknown> = rec.doc;
        if (coll === "tasks") {
          // A stored row counts even when deleted: reviving one is an update, not a fresh insert.
          const stored = existing.length ? ((existing[0].doc as Record<string, unknown>) ?? {}) : null;
          const inc = rec.doc as Record<string, unknown>;
          const known = new Map<string, boolean>();
          for (const pid of [stored?.projectId, inc.projectId]) if (typeof pid === "string" && pid && !known.has(pid)) known.set(pid, await projectExists(pid));
          const decision = taskPushDecision(rec.id, stored, inc, pusher, (x) => known.get(x) === true, { storedDeleted: !!existing[0]?.deleted });
          if (!decision.ok) {
            results[coll].push({ id: rec.id, status: "error", error: TASK_PUSH_REFUSED });
            continue;
          }
          // a tick (re-review): the stored copy with only status / doneAt / updatedAt from the device
          if (decision.doc) pushDoc = decision.doc;
        }
        // #351 review — server-owned fields (a task's share stamp and thread link) never come from a push
        let doc: Record<string, unknown> = sanitizePushedDoc(coll, { ...pushDoc, id: rec.id }, existing.length ? { doc: existing[0].doc, deleted: !!existing[0].deleted } : null);
        if (coll === "projects") {
          pipes ||= await loadPipelines();
          doc = normalizeProject(doc as unknown as ProjectRecord, pipes) as unknown as Record<string, unknown>;
        }
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
