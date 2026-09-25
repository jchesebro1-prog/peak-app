"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  PROJECT_TAGS,
  QUOTE_TAGS,
  PROJECT_TAG_META,
  validateProjectPipeline,
  validateQuotePipeline,
  slugStageId,
  type Pipeline,
  type Pipelines,
  type ProjectPipeline,
  type QuotePipeline,
  type PipelineStage,
  type ProjectTag,
  type QuoteTag,
} from "@/lib/pipelines";
import { savePipelinesAction, moveStageRecordsAction } from "./actions";
import { PipelineStageRow } from "./pipeline-stage-row";

/**
 * Settings → Pipelines (Task 7) — the Daylite-stage editor: rename/add/
 * reorder/retag stages on the two project pipelines (Install, Order) and the
 * two quote pipelines (Estimate/Design, BID SPEC), plus the default quote
 * pipeline. One Save covers everything (savePipelinesAction, a full-
 * replacement of both lists + the default id); an in-use stage's remove
 * button is disabled with its record count until those records are moved to
 * another stage of the SAME pipeline via "Move records" (moveStageRecordsAction).
 *
 * The CustomerFieldsCard idiom: seeded from the server-
 * resolved props, whole-thing save, client-side pure validators run before
 * the server call so a bad edit never round-trips. Ids are minted once, on
 * add (slugStageId against the pipeline's own ids), and never re-slug when a
 * label changes later — the draft only ever patches `label` on an existing row.
 */

const QUOTE_TAG_LABEL: Record<QuoteTag, string> = { draft: "Draft", sent: "Sent", won: "Won" };
const projectTagLabel = (t: ProjectTag) => PROJECT_TAG_META[t].label;
const quoteTagLabel = (t: QuoteTag) => QUOTE_TAG_LABEL[t];

type UsageMap = Record<string, Record<string, number>>;
type Kind = "project" | "quote";
type MoverState = { kind: Kind; pipelineId: string; stageId: string; target: string };

const inS: React.CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 12.5,
  color: "#16181d",
  border: "1px solid #e4e7ec",
  borderRadius: 8,
  padding: "7px 10px",
  background: "#fff",
  outline: "none",
  width: "100%",
};

const clone = <T extends string>(list: Pipeline<T>[]): Pipeline<T>[] =>
  list.map((p) => ({ ...p, stages: p.stages.map((s) => ({ ...s })) }));

/** Shared array-edit ops for one pipeline list (project or quote — same shape, different tag type). */
function makeHandlers<T extends string>(setList: React.Dispatch<React.SetStateAction<Pipeline<T>[]>>, onEdit: () => void) {
  return {
    patch(pipelineId: string, stageId: string, patch: Partial<PipelineStage<T>>) {
      onEdit();
      setList((list) =>
        list.map((p) =>
          p.id !== pipelineId ? p : { ...p, stages: p.stages.map((s) => (s.id === stageId ? { ...s, ...patch } : s)) }
        )
      );
    },
    move(pipelineId: string, index: number, dir: -1 | 1) {
      onEdit();
      setList((list) =>
        list.map((p) => {
          if (p.id !== pipelineId) return p;
          const stages = p.stages.slice();
          const j = index + dir;
          if (j < 0 || j >= stages.length) return p;
          [stages[index], stages[j]] = [stages[j], stages[index]];
          return { ...p, stages };
        })
      );
    },
    remove(pipelineId: string, stageId: string) {
      onEdit();
      setList((list) => list.map((p) => (p.id !== pipelineId ? p : { ...p, stages: p.stages.filter((s) => s.id !== stageId) })));
    },
    /** Inserted just before the pipeline's terminal (Done/Won) stage, which
     *  must stay last — never appended at the very end. */
    add(pipelineId: string, label: string, fallbackTag: T) {
      onEdit();
      setList((list) =>
        list.map((p) => {
          if (p.id !== pipelineId) return p;
          const stages = p.stages.slice();
          const before = stages[stages.length - 2];
          const id = slugStageId(label, stages.map((s) => s.id));
          stages.splice(Math.max(0, stages.length - 1), 0, { id, label, tag: before ? before.tag : fallbackTag });
          return { ...p, stages };
        })
      );
    },
  };
}

export function PipelinesCard({ pipelines, usage }: { pipelines: Pipelines; usage: UsageMap }) {
  const router = useRouter();

  const [savedProject, setSavedProject] = useState<ProjectPipeline[]>(() => clone(pipelines.project) as ProjectPipeline[]);
  const [project, setProject] = useState<ProjectPipeline[]>(() => clone(pipelines.project) as ProjectPipeline[]);
  const [savedQuote, setSavedQuote] = useState<QuotePipeline[]>(() => clone(pipelines.quote) as QuotePipeline[]);
  const [quote, setQuote] = useState<QuotePipeline[]>(() => clone(pipelines.quote) as QuotePipeline[]);
  const [savedDefaultId, setSavedDefaultId] = useState(pipelines.defaultQuotePipelineId);
  const [defaultId, setDefaultId] = useState(pipelines.defaultQuotePipelineId);
  const [usageState, setUsageState] = useState<UsageMap>(usage);
  const [addLabel, setAddLabel] = useState<Record<string, string>>({});

  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const [mover, setMover] = useState<MoverState | null>(null);
  const [moverError, setMoverError] = useState<string | null>(null);
  const [moverPending, setMoverPending] = useState(false);

  const onEdit = () => {
    setJustSaved(false);
    setError(null);
  };
  const projectH = makeHandlers<ProjectTag>(setProject, onEdit);
  const quoteH = makeHandlers<QuoteTag>(setQuote, onEdit);

  const dirty =
    JSON.stringify(project) !== JSON.stringify(savedProject) ||
    JSON.stringify(quote) !== JSON.stringify(savedQuote) ||
    defaultId !== savedDefaultId;

  const clientErrors = (): string[] => {
    const errs: string[] = [];
    for (const p of project) errs.push(...validateProjectPipeline(p).map((e) => `${p.label}: ${e}`));
    for (const p of quote) errs.push(...validateQuotePipeline(p).map((e) => `${p.label}: ${e}`));
    return errs;
  };

  const onSave = () => {
    setError(null);
    const errs = clientErrors();
    if (errs.length) {
      setError(errs.join(" "));
      return;
    }
    startTransition(async () => {
      const res = await savePipelinesAction({ project, quote, defaultQuotePipelineId: defaultId });
      if (!res.ok) {
        setError(res.errors.join(" "));
        return;
      }
      setSavedProject(project);
      setSavedQuote(quote);
      setSavedDefaultId(defaultId);
      setJustSaved(true);
      router.refresh();
    });
  };

  const openMover = (kind: Kind, pipelineId: string, stageId: string, firstOther: string) => {
    setMoverError(null);
    setMover({ kind, pipelineId, stageId, target: firstOther });
  };
  const closeMover = () => {
    setMover(null);
    setMoverError(null);
  };
  const onMove = () => {
    if (!mover) return;
    setMoverError(null);
    setMoverPending(true);
    startTransition(async () => {
      const res = await moveStageRecordsAction(mover.kind, mover.pipelineId, mover.stageId, mover.target);
      setMoverPending(false);
      if (!res.ok) {
        setMoverError(res.error);
        return;
      }
      setUsageState((u) => {
        const forPl = { ...(u[mover.pipelineId] || {}) };
        forPl[mover.stageId] = Math.max(0, (forPl[mover.stageId] || 0) - res.moved);
        forPl[mover.target] = (forPl[mover.target] || 0) + res.moved;
        return { ...u, [mover.pipelineId]: forPl };
      });
      setMover(null);
      router.refresh();
    });
  };

  const saveDisabled = !dirty || pending;

  return (
    <div className="pk-card" style={{ overflow: "hidden", marginBottom: 18 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", rowGap: 10, padding: "14px 18px", borderBottom: "1px solid #ececf0" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <span style={{ fontSize: 14.5, fontWeight: 600 }}>Pipelines</span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 600, letterSpacing: ".06em", color: "#8a6d1f", background: "#fbf3dd", border: "1px solid #f0e2bd", padding: "3px 9px", borderRadius: 6 }}>
              ADMIN
            </span>
          </div>
          <div style={{ fontSize: 12, color: "#8c919c", marginTop: 4, lineHeight: 1.45 }}>
            The stages projects, orders, and quotes move through. Behaviour follows each stage&apos;s status (Backlog/
            Scheduled/On site/Closeout/Done, or Draft/Sent/Won) — rename, add, reorder or retag freely.
          </div>
        </div>
        <button
          type="button"
          disabled={saveDisabled}
          onClick={onSave}
          style={{ fontSize: 13, fontWeight: 600, border: "none", borderRadius: 9, padding: "9px 16px", cursor: saveDisabled ? "not-allowed" : "pointer", color: saveDisabled ? "#aab0bb" : "#fff", background: saveDisabled ? "#eef0f3" : "var(--accent)", whiteSpace: "nowrap" }}
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </div>

      {error && (
        <div style={{ margin: "12px 18px 0", fontSize: 12, color: "#b4543a", background: "#f9ece8", border: "1px solid #f0d6cd", borderRadius: 8, padding: "9px 12px" }}>
          {error}
        </div>
      )}
      {justSaved && !dirty && (
        <div style={{ margin: "12px 18px 0", fontSize: 11.5, color: "#1f7a52", fontWeight: 600 }}>✓ Saved</div>
      )}

      <div style={{ padding: "14px 18px 18px" }}>
        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".03em", textTransform: "uppercase", color: "#8c919c", marginBottom: 10 }}>
          Projects
        </div>
        {project.map((pl) => (
          <PipelineBlock
            key={pl.id}
            kind="project"
            pl={pl}
            tags={PROJECT_TAGS}
            tagLabel={projectTagLabel}
            isProject
            usage={usageState[pl.id] || {}}
            addLabel={addLabel[pl.id] || ""}
            onAddLabel={(v) => setAddLabel((m) => ({ ...m, [pl.id]: v }))}
            onPatch={(stageId, patch) => projectH.patch(pl.id, stageId, patch)}
            onMove={(i, dir) => projectH.move(pl.id, i, dir)}
            onRemove={(stageId) => projectH.remove(pl.id, stageId)}
            onAdd={() => projectH.add(pl.id, (addLabel[pl.id] || "").trim() || "New stage", "backlog")}
            mover={mover}
            moverError={moverError}
            moverPending={moverPending}
            onRequestMove={(stageId) => {
              const other = pl.stages.find((s) => s.id !== stageId);
              if (other) openMover("project", pl.id, stageId, other.id);
            }}
            onMoverTargetChange={(target) => setMover((m) => (m ? { ...m, target } : m))}
            onMoverConfirm={onMove}
            onMoverCancel={closeMover}
          />
        ))}

        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".03em", textTransform: "uppercase", color: "#8c919c", margin: "16px 0 10px" }}>
          Quotes
        </div>
        {quote.map((pl) => (
          <PipelineBlock
            key={pl.id}
            kind="quote"
            pl={pl}
            tags={QUOTE_TAGS}
            tagLabel={quoteTagLabel}
            isProject={false}
            usage={usageState[pl.id] || {}}
            addLabel={addLabel[pl.id] || ""}
            onAddLabel={(v) => setAddLabel((m) => ({ ...m, [pl.id]: v }))}
            onPatch={(stageId, patch) => quoteH.patch(pl.id, stageId, patch)}
            onMove={(i, dir) => quoteH.move(pl.id, i, dir)}
            onRemove={(stageId) => quoteH.remove(pl.id, stageId)}
            onAdd={() => quoteH.add(pl.id, (addLabel[pl.id] || "").trim() || "New stage", "draft")}
            mover={mover}
            moverError={moverError}
            moverPending={moverPending}
            onRequestMove={(stageId) => {
              const other = pl.stages.find((s) => s.id !== stageId);
              if (other) openMover("quote", pl.id, stageId, other.id);
            }}
            onMoverTargetChange={(target) => setMover((m) => (m ? { ...m, target } : m))}
            onMoverConfirm={onMove}
            onMoverCancel={closeMover}
          >
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#5b616e", cursor: "pointer", marginTop: 4 }}>
              <input type="radio" name="default-quote-pipeline" checked={defaultId === pl.id} onChange={() => { onEdit(); setDefaultId(pl.id); }} />
              Default pipeline for new quotes
            </label>
          </PipelineBlock>
        ))}
      </div>
    </div>
  );
}

function PipelineBlock<T extends string>({
  kind,
  pl,
  tags,
  tagLabel,
  isProject,
  usage,
  addLabel,
  onAddLabel,
  onPatch,
  onMove,
  onRemove,
  onAdd,
  mover,
  moverError,
  moverPending,
  onRequestMove,
  onMoverTargetChange,
  onMoverConfirm,
  onMoverCancel,
  children,
}: {
  kind: Kind;
  pl: Pipeline<T>;
  tags: readonly T[];
  tagLabel: (t: T) => string;
  isProject: boolean;
  usage: Record<string, number>;
  addLabel: string;
  onAddLabel: (v: string) => void;
  onPatch: (stageId: string, patch: Partial<PipelineStage<T>>) => void;
  onMove: (index: number, dir: -1 | 1) => void;
  onRemove: (stageId: string) => void;
  onAdd: () => void;
  mover: MoverState | null;
  moverError: string | null;
  moverPending: boolean;
  onRequestMove: (stageId: string) => void;
  onMoverTargetChange: (target: string) => void;
  onMoverConfirm: () => void;
  onMoverCancel: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div style={{ border: "1px solid #eef0f3", borderRadius: 10, padding: 12, marginBottom: 10, background: "#fafbfc" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 9 }}>
        <span style={{ fontSize: 13.5, fontWeight: 600 }}>{pl.label}</span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "#9aa0ab" }}>{pl.stages.length} stages</span>
      </div>
      {pl.stages.map((stage, i) => (
        <PipelineStageRow
          key={stage.id}
          stage={stage}
          tags={tags}
          tagLabel={tagLabel}
          isProject={isProject}
          usageCount={usage[stage.id] || 0}
          canMoveUp={i > 0 && i < pl.stages.length - 1}
          canMoveDown={i < pl.stages.length - 2}
          onPatch={(patch) => onPatch(stage.id, patch)}
          onMoveUp={() => onMove(i, -1)}
          onMoveDown={() => onMove(i, 1)}
          onRemove={() => onRemove(stage.id)}
          onRequestMove={() => onRequestMove(stage.id)}
          moverPanel={
            mover && mover.kind === kind && mover.pipelineId === pl.id && mover.stageId === stage.id ? (
              <div style={{ marginTop: 6, marginBottom: 4, padding: 10, background: "#fff", border: "1px solid #e4e7ec", borderRadius: 8 }}>
                <div style={{ fontSize: 11.5, color: "#5b616e", marginBottom: 7 }}>
                  Move {usage[stage.id] || 0} record{(usage[stage.id] || 0) === 1 ? "" : "s"} on &ldquo;{stage.label}&rdquo; to:
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <select value={mover.target} onChange={(e) => onMoverTargetChange(e.target.value)} style={{ ...inS, width: 200 }}>
                    {pl.stages.filter((s) => s.id !== stage.id).map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={moverPending}
                    onClick={onMoverConfirm}
                    style={{ fontSize: 12, fontWeight: 600, border: "none", borderRadius: 7, padding: "7px 12px", cursor: moverPending ? "not-allowed" : "pointer", color: "#fff", background: "var(--accent)" }}
                  >
                    {moverPending ? "Moving…" : "Move"}
                  </button>
                  <button type="button" onClick={onMoverCancel} style={{ fontSize: 12, fontWeight: 600, border: "none", background: "transparent", color: "#8c919c", cursor: "pointer" }}>
                    Cancel
                  </button>
                </div>
                {moverError && <div style={{ marginTop: 7, fontSize: 11.5, color: "#b4543a" }}>{moverError}</div>}
              </div>
            ) : undefined
          }
        />
      ))}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
        <input
          value={addLabel}
          onChange={(e) => onAddLabel(e.target.value)}
          placeholder="New stage name"
          aria-label="New stage name"
          style={{ ...inS, maxWidth: 220 }}
        />
        <button type="button" onClick={onAdd} style={{ fontSize: 12.5, fontWeight: 600, color: "var(--accent)", background: "transparent", border: "none", cursor: "pointer", padding: 0, whiteSpace: "nowrap" }}>
          + Add stage
        </button>
      </div>
      {children}
    </div>
  );
}
