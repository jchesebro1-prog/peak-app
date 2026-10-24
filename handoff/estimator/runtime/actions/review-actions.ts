/**
 * Estimator handoff — browser implementations of src/app/(app)/estimator/review-actions.ts (the Customer
 * review step's comments), type-enforced against the originals.
 *
 * The app keeps the comments on the quote (`Quote.reviewComments`, written only by the quotes store's
 * add/resolve/deleteReviewComment under the row lock, never bumping `updatedAt`). The prototype keeps them in
 * the `reviewComments` collection, one doc per quote — `{ id: quoteId, comments }` — so a comment write never
 * touches the quote doc; a quote's sliced `reviewComments` (if any) is the starting list. The writers'
 * rules are ported verbatim (body clean to 1–2,000 chars, the section must be on the SAVED estimate, a full
 * list of 200 drops its oldest resolved comment or refuses, resolve is idempotent, delete is judged on the
 * comment as stored). Permissions come from `ports.users` (the role switcher) through the same pure rules.
 *
 * reviewDocsAction (Datasheets / Drawings / the checklist's gaps) answers `{ ok: false, error }`: the
 * slice has no part documents, so the Package checklist says so and the two tabs read "Not included in the
 * prototype". Plan: PR 2 Task 5.
 */
import type * as Original from "@/app/(app)/estimator/review-actions";
import type { ReviewCommentsView } from "@/app/(app)/estimator/review-actions";
import {
  canAddComment, canDelete, canResolve, numberComments, REVIEW_COMMENT_COPY as COPY, REVIEW_COMMENTS_MAX, sanitizeComment,
  type ReviewComment,
} from "@/lib/estimate-review/comments";
import type { Quote } from "@/lib/stores/quotes";
import type { HandoffStore } from "../store";
import { users } from "../ports";
import { quoteRepo, withLock } from "../quote-repo";
import type { Impl as ImplOf } from "./util";

export const REVIEW_ACTIONS_KEY = "src/app/(app)/estimator/review-actions.ts";

/** What the Datasheets / Drawings tabs and the checklist read when the package documents aren't there. */
export const REVIEW_DOCS_NOT_IN_PROTOTYPE = "Datasheets and drawings are not included in the prototype.";

type A = typeof Original;
type Impl<K extends keyof A> = ImplOf<A, K>;

/** One quote's comments in the `reviewComments` collection. */
export type ReviewCommentsDoc = { id: string; comments: ReviewComment[] };

type Write = { ok: true; comments: ReviewComment[] } | { ok: false; reason: "gone" | "invalid" | "no-system" | "full" | "missing" | "forbidden" };

const sectionsOf = (q: Pick<Quote, "spec">): Array<{ id: string; name: string }> => {
  const raw = (q.spec as { sections?: Array<{ id?: unknown; name?: unknown }> } | null | undefined)?.sections;
  return Array.isArray(raw)
    ? raw.filter((s) => !!s && typeof s.id === "string").map((s) => ({ id: s.id as string, name: typeof s.name === "string" ? s.name : "" }))
    : [];
};

const viewOf = (q: Pick<Quote, "spec">, comments: ReviewComment[]): ReviewCommentsView => ({ comments, numbered: numberComments(comments, sectionsOf(q)) });

const clean = (list: unknown): ReviewComment[] => (Array.isArray(list) ? list.filter((c): c is ReviewComment => !!c && typeof (c as ReviewComment).id === "string") : []);

/** A fresh comment id (`rc-<uuid>`, as the store mints). */
function newCommentId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return "rc-" + c.randomUUID();
  return "rc-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}

export function reviewActions(store: HandoffStore): { [K in keyof A]: Impl<K> } {
  const repo = quoteRepo(store);

  /** The quote's list: the collection doc, else the quote's own (sliced) list. */
  const listOf = async (q: Quote): Promise<ReviewComment[]> => {
    const doc = await store.get<ReviewCommentsDoc>("reviewComments", q.id);
    return clean(doc ? doc.comments : q.reviewComments);
  };

  /** quotes.ts patchQuote for the comments: read → mutate → write, one at a time per quote. */
  const patch = (quoteId: string, mutate: (q: Quote, cur: ReviewComment[]) => Write | { next: ReviewComment[]; result: Write }): Promise<Write> =>
    withLock(`quote:${quoteId}`, async () => {
      const q = await repo.get(quoteId);
      if (!q) return { ok: false, reason: "gone" } as const;
      const r = mutate(q, await listOf(q));
      if ("next" in r) {
        await store.put<ReviewCommentsDoc>("reviewComments", { id: q.id, comments: r.next });
        return r.result;
      }
      return r;
    });

  /** A write's outcome → the fresh list (re-read for the system names) or the refusal copy. */
  const finish = async (quoteId: string, r: Write): Promise<Original.ReviewCommentsResult> => {
    if (!r.ok) {
      const error = { gone: COPY.gone, invalid: COPY.empty, "no-system": COPY.noSystem, full: COPY.full, missing: COPY.missing, forbidden: COPY.cantDelete }[r.reason];
      return { ok: false, error };
    }
    const q = await repo.get(quoteId);
    return q ? { ok: true, ...viewOf(q, r.comments) } : { ok: false, error: COPY.gone };
  };

  const listReviewCommentsAction: Impl<"listReviewCommentsAction"> = async (quoteId) => {
    const q = await repo.get(String(quoteId || ""));
    if (!q) return { ok: false, error: COPY.gone };
    return { ok: true, ...viewOf(q, await listOf(q)) };
  };

  const addReviewCommentAction: Impl<"addReviewCommentAction"> = async (quoteId, sectionId, rawBody) => {
    const user = users.current();
    if (!canAddComment(user.roles)) return { ok: false, error: COPY.needsPerm };
    const id = String(quoteId || "");
    const body = sanitizeComment(rawBody);
    const by = String(user.name ?? "").trim().slice(0, 200);
    const sec = sectionId == null ? null : typeof sectionId === "string" ? sectionId : String(sectionId);
    if (body === null || !by) return finish(id, { ok: false, reason: "invalid" });
    const r = await patch(id, (q, cur) => {
      if (sec !== null && !sectionsOf(q).some((x) => x.id === sec)) return { ok: false, reason: "no-system" };
      let list = cur;
      if (list.length >= REVIEW_COMMENTS_MAX) {
        const oldestResolved = list.findIndex((c) => c.resolvedAt != null);
        if (oldestResolved < 0) return { ok: false, reason: "full" };
        list = list.filter((_, i) => i !== oldestResolved);
      }
      const next = [...list, { id: newCommentId(), sectionId: sec, body, by, at: Date.now() }];
      return { next, result: { ok: true, comments: next } };
    });
    return finish(id, r);
  };

  const resolveReviewCommentAction: Impl<"resolveReviewCommentAction"> = async (quoteId, commentId) => {
    const user = users.current();
    if (!canResolve(user.roles, {})) return { ok: false, error: COPY.needsPerm };
    const id = String(quoteId || "");
    const who = String(user.name ?? "").trim().slice(0, 200);
    if (!who) return finish(id, { ok: false, reason: "invalid" });
    const cid = String(commentId || "");
    const now = Date.now();
    const r = await patch(id, (_q, cur) => {
      const hit = cur.find((c) => c.id === cid);
      if (!hit) return { ok: false, reason: "missing" };
      if (hit.resolvedAt != null) return { ok: true, comments: cur };
      const next = cur.map((c) => (c.id === cid ? { ...c, resolvedAt: now, resolvedBy: who } : c));
      return { next, result: { ok: true, comments: next } };
    });
    return finish(id, r);
  };

  const deleteReviewCommentAction: Impl<"deleteReviewCommentAction"> = async (quoteId, commentId) => {
    const user = users.current();
    const id = String(quoteId || "");
    const cid = String(commentId || "");
    const r = await patch(id, (_q, cur) => {
      const hit = cur.find((c) => c.id === cid);
      if (!hit) return { ok: false, reason: "missing" };
      if (!canDelete(user.roles, hit, user.name)) return { ok: false, reason: "forbidden" };
      const next = cur.filter((c) => c.id !== cid);
      return { next, result: { ok: true, comments: next } };
    });
    return finish(id, r);
  };

  const reviewDocsAction: Impl<"reviewDocsAction"> = async (quoteId) => {
    const q = await repo.get(String(quoteId || ""));
    if (!q) return { ok: false, error: COPY.gone };
    return { ok: false, error: REVIEW_DOCS_NOT_IN_PROTOTYPE };
  };

  return { listReviewCommentsAction, addReviewCommentAction, resolveReviewCommentAction, deleteReviewCommentAction, reviewDocsAction };
}
