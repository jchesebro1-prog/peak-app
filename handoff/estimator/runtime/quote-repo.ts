/**
 * Estimator handoff — the quotes store over the browser store: src/lib/stores/quotes.ts's writers
 * (create, update, setStatus, setQuoteStage, setQuotePipeline, the bonus / selection / people writers,
 * remove) running the pure rules in quote-model.ts against the IndexedDB overlay. Postgres's row lock
 * becomes a per-quote promise chain (`withLock`), so two actions on one quote never interleave their
 * read-modify-write.
 *
 * Left out (server integrations the prototype doesn't have): the install/job spawn on Won (the
 * `onWon` port records a note instead), the "Install sold" assignment, the Rewards ledger, PDF
 * renders/copies, the system-library index, `contentChangedAt` (it only drives PDF staleness).
 * Plan: PR 2 Task 4.
 */
import type { Quote, QuoteStatus } from "@/lib/stores/quotes";
import type { BonusSplit } from "@/lib/estimate-bonus/record";
import { buildBonusRecord, normalizeSplit, quoteHasBonusLines } from "@/lib/estimate-bonus/record";
import { isBonusEligibleQuote } from "@/lib/estimate-bonus/rules";
import type { SpecSection } from "@/lib/estimating-core/types";
import { approvalSnapshotMatches } from "@/lib/approval-snapshot";
import { NO_REVIEW_LIMITS } from "@/lib/review-limits";
import { checkSelectionPatch, DEFAULT_PACKAGE_SELECTION, mergePackageSelection, type PackageSelection } from "@/lib/estimate-output/package-selection";
import { carriesPipeline, firstStage, normalizeQuotePipeline, quotePipelineFor, statusForQuoteStage } from "@/lib/pipelines";
import { tracksWonVersion } from "@/lib/quote-won-version";
import { rewriteQuoteSpec } from "@/lib/catalog-rename/rewrite";
import type { HandoffStore } from "./store";
import { clock, numbering, onWon, users } from "./ports";
import { pipelinesNow, renameRefs, reviewLimitContextNow } from "./readers";
import {
  ApprovalGateRefused,
  applyStatusMove,
  applyUpdate,
  asReopened,
  buildQuote,
  decideApprovalGate,
  isQuoteStatus,
  nextQuoteId,
  QUOTE_VERSION_CHANGED_MESSAGE,
  reopenPlanFor,
  requireApprovalToAdvance,
  resolveStatusGate,
  type ApprovalGateResult,
  type SetStatusOpts,
} from "./quote-model";

/** setStatus refused because the quote changed since the caller's `expectUpdatedAt` (quotes.ts QuoteVersionChanged). */
export class QuoteVersionChanged extends Error {
  readonly quoteVersionChanged = "quotes/version-changed" as const;
  constructor() {
    super(QUOTE_VERSION_CHANGED_MESSAGE);
    this.name = "QuoteVersionChanged";
  }
}

const locks = new Map<string, Promise<unknown>>();

/** The browser's stand-in for the quote row lock: calls on one key run one after another. */
export function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.catch(() => undefined);
  locks.set(key, tail);
  void tail.then(() => {
    if (locks.get(key) === tail) locks.delete(key);
  });
  return run;
}

/** catalog-renames renameRewriter: a spec brought to today's SKUs (a rename alone is never "a change"). */
async function renameRewriter(store: HandoffStore): Promise<(s: unknown) => unknown> {
  const r = await renameRefs(store);
  return (s) => (s && r.m.size ? rewriteQuoteSpec(s, r.m, r.models) ?? s : s);
}

/** The bonus record names its people from the FULL roster, inactive included (users.ts allUsers()). */
const bonusUsers = () => users.everyone().map((u) => ({ id: u.id, name: u.name }));

export type QuoteRepo = ReturnType<typeof quoteRepo>;

/** The quotes store over `store`. Every read is normalized onto its pipeline (stores/quotes get()). */
export function quoteRepo(store: HandoffStore) {
  /** The stored doc as written — what getDoc hands the app's writers (a copy: the store clones on get). */
  const raw = async (id: string): Promise<Quote | null> => (id ? (await store.get<Quote>("quotes", id)) ?? null : null);
  /** A read view: the doc onto its pipeline, on a copy (the stored doc is never rewritten by a read). */
  const view = (q: Quote): Quote => normalizeQuotePipeline(structuredClone(q), pipelinesNow());
  const read = async (id: string): Promise<Quote | null> => {
    const q = await raw(id);
    return q ? view(q) : null;
  };

  /**
   * quotes.ts patchQuote: read the RAW doc → mutate → write it back under the lock (a legacy stage key stays
   * as stored; only reads normalize). Returns the written doc as a read sees it. Null when the quote is missing.
   */
  const patch = (id: string, mutate: (doc: Quote) => void): Promise<Quote | null> =>
    withLock(`quote:${id}`, async () => {
      const doc = await raw(id);
      if (!doc) return null;
      mutate(doc);
      await store.put("quotes", doc);
      return view(doc);
    });

  const repo = {
    get: read,

    /** getAll(): every live quote, newest activity first. */
    async all(): Promise<Quote[]> {
      const pipes = pipelinesNow();
      const list = (await store.all<Quote>("quotes")).map((q) => normalizeQuotePipeline(structuredClone(q), pipes));
      return list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    },

    /**
     * create(): a new draft (system quotes enter their pipeline at its first stage), id Q-#### past
     * the highest one and the last minted (meta/quoteId — so a deleted id is never reused), numbered
     * at once by the `numbering` port (the app numbers right after the insert).
     */
    create(partial: Partial<Quote> = {}): Promise<Quote> {
      return withLock("quote:create", async () => {
        const t = clock.now();
        const quoteType = partial.quoteType || "system";
        const pipes = carriesPipeline(quoteType) ? pipelinesNow() : null;
        const pl = pipes ? quotePipelineFor(pipes, { pipelineId: partial.pipelineId || pipes.defaultQuotePipelineId }) : null;
        const all = await store.allIncludingDeleted<{ id: string }>("quotes");
        const last = await store.get<{ id: string; last?: number }>("meta", "quoteId");
        const { id, n } = nextQuoteId(all.map((q) => q.id), last?.last ?? null);
        const estNo = await numbering.nextEstNo();
        const q: Quote = { ...buildQuote(id, partial, quoteType, pl, t), estNo };
        await store.put("meta", { id: "quoteId", last: n });
        await store.put("quotes", q);
        return q;
      });
    },

    /** update(): shallow merge (owned fields + numbers stripped), updatedAt bumped, value rounded. */
    update(id: string, p: Partial<Quote>): Promise<Quote | null> {
      return patch(id, (doc) => applyUpdate(doc, p, clock.now()));
    },

    /** quotes.ts checkApprovalGate — the typed pre-check, same decision setStatus makes; writes nothing. */
    async checkApprovalGate(q: Quote | null, status: "sent" | "won", actor: string | null = null): Promise<ApprovalGateResult> {
      if (!q) return requireApprovalToAdvance(null, status === "won" ? "won" : "send");
      const plan = reopenPlanFor(q, status, await renameRewriter(store));
      const d = decideApprovalGate(status, asReopened(q, plan), reviewLimitContextNow(), {}, clock.now(), actor);
      return d.ok ? { ok: true } : d;
    },

    /**
     * setStatus(): the gated transition, ported — a same-status call is a no-op; sent/won pass the
     * approval gate (an auto/approver stamp lands in the same write) or THROW ApprovalGateRefused;
     * history, the reopen, the won version, the bonus record, Lost clearing credit, the stage and the
     * "sent" revision all happen in one write. A move INTO Won then runs the `onWon` port (the
     * prototype's stand-in for the install spawn — it records an activity note).
     */
    async setStatus(id: string, status: QuoteStatus, by?: string | null, opts: SetStatusOpts = {}): Promise<Quote | null> {
      if (!isQuoteStatus(status)) return null;
      let moved = false;
      const rewrite = await renameRewriter(store);
      const out = await withLock(`quote:${id}`, async () => {
        const q = await raw(id); // the stored doc, like setStatus's getDoc
        if (!q) return null;
        if (typeof opts.expectUpdatedAt === "number" && q.updatedAt !== opts.expectUpdatedAt) throw new QuoteVersionChanged();
        if (q.status === status) return view(q);
        const gated = !resolveStatusGate(status, null, opts).ok;
        const reopen = opts.bypassApprovalGate === "historical-import" ? null : reopenPlanFor(q, status, rewrite);
        const gateQ = asReopened(q, reopen);
        const needsLimits = gated && !(gateQ.review?.state === "approved" && gateQ.review?.method !== "auto_limit" && approvalSnapshotMatches(gateQ));
        const gate = decideApprovalGate(status, gateQ, needsLimits ? reviewLimitContextNow() : NO_REVIEW_LIMITS, opts, clock.now(), by ?? null);
        if (!gate.ok) throw new ApprovalGateRefused(status === "won" ? "won" : "send", gate.error);
        const pipes = carriesPipeline(q.quoteType) ? pipelinesNow() : null;
        const recordsWon = status === "won" && tracksWonVersion(q) && opts.bypassApprovalGate !== "historical-import";
        applyStatusMove(q, {
          status,
          by,
          now: clock.now(),
          autoStamp: gate.stamp,
          reopen,
          pipes,
          wonRewrite: recordsWon ? rewrite : null,
          alternatesTaken: opts.alternatesTaken,
          users: status === "won" ? bonusUsers() : [],
        });
        await store.put("quotes", q);
        moved = true;
        return view(q);
      });
      if (out && moved && status === "won") {
        try {
          await onWon.run(id);
        } catch (e) {
          console.error("[handoff] onWon port failed", id, e);
        }
      }
      return out;
    },

    /** setQuoteStage(): the stage's tag IS the status — a different tag runs setStatus first; null = refused. */
    async setQuoteStage(id: string, stageId: string, by?: string | null, alternatesTaken?: string[]): Promise<Quote | null> {
      const q = await read(id);
      if (!q || !carriesPipeline(q.quoteType) || q.status === "lost") return null;
      const pl = quotePipelineFor(pipelinesNow(), q);
      const tag = statusForQuoteStage(pl, stageId);
      if (!tag) return null;
      if (tag !== q.status) {
        const movedQ = await repo.setStatus(id, tag, by, alternatesTaken ? { alternatesTaken } : {});
        if (!movedQ || movedQ.status !== tag) return movedQ ? read(id) : null;
      }
      const res = await patch(id, (doc) => {
        doc.pipelineId = pl.id;
        doc.stage = stageId;
        doc.updatedAt = clock.now();
      });
      return res ? read(id) : null;
    },

    /** setQuotePipeline(): drafts only; lands on the new pipeline's first stage. Null = refused. */
    async setQuotePipeline(id: string, pipelineId: string): Promise<Quote | null> {
      const q = await read(id);
      if (!q || !carriesPipeline(q.quoteType) || q.status !== "draft") return null;
      const pl = pipelinesNow().quote.find((p) => p.id === pipelineId);
      if (!pl) return null;
      const res = await patch(id, (doc) => {
        doc.pipelineId = pl.id;
        doc.stage = firstStage(pl).id;
        doc.updatedAt = clock.now();
      });
      return res ? read(id) : null;
    },

    /** setEstimatorBonusSplit(): the split's only writer; a won quote's record is rebuilt. No updatedAt bump. */
    setEstimatorBonusSplit(id: string, split: BonusSplit): Promise<Quote | null> {
      const list = bonusUsers();
      return patch(id, (doc) => {
        doc.estimatorBonusSplit = normalizeSplit(split);
        if (doc.status === "won" && doc.bonusRecord) rebuildBonusRecord(doc, doc.bonusRecord.alternatesTaken, list);
      });
    },

    /** setBonusAlternatesTaken(): won quotes with bonus lines only; builds a missing record. No updatedAt bump. */
    async setBonusAlternatesTaken(id: string, ids: string[]): Promise<Quote | null | "not-won" | "no-bonus-lines"> {
      const list = bonusUsers();
      let refused: "not-won" | "no-bonus-lines" | null = null;
      const out = await patch(id, (doc) => {
        if (doc.status !== "won") {
          refused = "not-won";
          return;
        }
        const secs = (doc.spec as { sections?: SpecSection[] } | undefined)?.sections;
        if (!Array.isArray(secs) || !isBonusEligibleQuote(doc) || !quoteHasBonusLines(secs)) {
          refused = "no-bonus-lines";
          return;
        }
        const alts = new Set(secs.filter((x) => x.alternate === true).map((x) => x.id));
        const taken = (Array.isArray(ids) ? ids : []).filter((aid) => alts.has(aid));
        if (doc.bonusRecord) rebuildBonusRecord(doc, taken, list);
        else {
          const intoWon = (doc.history || []).filter((h) => h.to === "won").pop();
          doc.bonusRecord = buildBonusRecord({ sections: secs, owner: doc.owner, preparedBy: doc.preparedBy, split: doc.estimatorBonusSplit, alternatesTaken: taken, users: list, wonAt: intoWon?.at ?? clock.now() });
        }
      });
      return out && refused ? refused : out;
    },

    /** setPackageSelection(): the selection's only writer — a checked partial merged over the stored value. No updatedAt bump. */
    async setPackageSelection(
      id: string,
      raw: unknown,
      followRenames?: (sel: PackageSelection) => Promise<PackageSelection>,
    ): Promise<{ ok: true; selection: PackageSelection | null } | { ok: false; error: string }> {
      const notFound = { ok: false as const, error: "That estimate wasn't found." };
      const check = checkSelectionPatch(raw);
      if (check.kind === "refuse") return { ok: false, error: check.error };
      if (check.kind === "ignore") {
        const q = await read(id);
        return q ? { ok: true, selection: q.packageSelection ?? null } : notFound;
      }
      const p = { ...check.patch };
      if (p.excludedDatasheets && followRenames) {
        p.excludedDatasheets = (await followRenames({ ...DEFAULT_PACKAGE_SELECTION, excludedDatasheets: p.excludedDatasheets })).excludedDatasheets;
      }
      let selection: PackageSelection | null = null;
      const q = await patch(id, (doc) => {
        selection = mergePackageSelection(doc.packageSelection, p);
        doc.packageSelection = selection;
      });
      return q && selection ? { ok: true, selection } : notFound;
    },

    /** setQuotePeople(): owner / preparedBy + updatedAt (callers validate the names). */
    setQuotePeople(id: string, people: { owner?: string; preparedBy?: string }): Promise<Quote | null> {
      return patch(id, (doc) => {
        if (typeof people.owner === "string") doc.owner = people.owner;
        if (typeof people.preparedBy === "string") doc.preparedBy = people.preparedBy;
        doc.updatedAt = clock.now();
      });
    },

    /** remove(): soft delete → a tombstone in the overlay. */
    async remove(id: string): Promise<void> {
      await withLock(`quote:${id}`, () => store.remove("quotes", id));
    },

    /** retireReplacedDraftSafely(): the draft a new quote replaces goes once the replacement exists (drafts only; never throws). */
    async retireReplacedDraftSafely(replaces: string | null | undefined, replacementId: string): Promise<boolean> {
      try {
        const oldId = (replaces || "").trim();
        if (!oldId || oldId === (replacementId || "").trim()) return false;
        const old = await read(oldId);
        if (!old || old.status !== "draft") return false;
        await repo.remove(oldId);
        return true;
      } catch (e) {
        console.error("[handoff] retiring the replaced draft failed", replaces, e);
        return false;
      }
    },

  };
  return repo;
}

/** quotes.ts rebuildBonusRecord — a won quote's record from its current spec, keeping `wonAt`. Mutates `doc`. */
function rebuildBonusRecord(doc: Quote, alternatesTaken: string[], list: { id: string; name: string }[]): void {
  const prev = doc.bonusRecord;
  const secs = (doc.spec as { sections?: SpecSection[] } | undefined)?.sections;
  if (!prev || !Array.isArray(secs)) return;
  try {
    doc.bonusRecord = buildBonusRecord({ sections: secs, owner: doc.owner, preparedBy: doc.preparedBy, split: doc.estimatorBonusSplit, alternatesTaken, users: list, wonAt: prev.wonAt });
  } catch (e) {
    console.error("[bonus] record rebuild failed for", doc.id, e);
  }
}
