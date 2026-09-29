"use client";

import { useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import Link from "next/link";
import type { SpecChecklist } from "@/lib/specs/assemble-section";
import type { SpecKind, SpecStatus } from "@/lib/specs/records";
import type { SpecDocument } from "@/lib/specs/spec-document";
import { SPEC_FILL_IN_MAX } from "@/lib/specs/spec-document";
import { approveDraftRecordAction, clearRowOverrideAction, linkRowToRecordAction, pinRowToRecordAction, unwaiveRowAction } from "../record-actions";
import { setSpecFillInAction } from "../builder-actions";
import type { SpecProductRow } from "./builder";
import { ERR, MUTED, useSave } from "./header-fields";
import { EditRecordPanel, LinkRecordDialog, WaivePanel, WriteRecordDialog } from "./record-dialogs";

/**
 * Spec records in the builder (Task 9, spec records design §5.1–§5.3) — one
 * product row's match report: a status chip, what it means, and the row's
 * actions. States (see `rowState`):
 *
 *   Matched            spec id + how it matched; Edit (project / library);
 *                      "Changed for this project" + Use library text;
 *                      "Library updated since you changed this";
 *                      "Library changed since your last download"
 *   Other section      the record belongs to another CSI section; links to
 *                      a new spec for that section from the same quote
 *   No spec            suggested records as quick-pick chips (Link)
 *   Pick one           ambiguous — the candidates as chips (pin)
 *   Draft spec         Approve
 *   Waived             the reason; Un-waive
 *
 * Unresolved rows (No spec / Pick one / Draft spec) all offer Link to
 * existing · Write new spec · Waive. Legacy-text rows (a catalog part's own
 * spec text, no record) keep the builder's #205 row UI and just get a chip.
 *
 * Every mutation runs through `useSave` (useTransition, the error inline,
 * router.refresh() on success, counted by the Download guard).
 */

/** What the client knows about a Spec Library record — only the records
 *  this spec refers to reach it (page.tsx). */
export type SlimSpecRecord = {
  specId: string;
  title: string;
  kind: SpecKind;
  status: SpecStatus;
  revision: number;
  matchKey: string | null;
  section: string;
  /** `recordProductName` — what the spec is ("Ion XE 20 · ETC"). */
  product: string;
  /** `partNumbersSummary` — the model numbers, shortened. */
  models: string;
};

export type RowState = "matched" | "other-section" | "legacy" | "no-spec" | "ambiguous" | "draft" | "waived" | "none";

/** The one place a row's match outcome becomes a builder state. "none" =
 *  no assembly (the section is gone) — the row keeps the #205 UI. */
export function rowState(r: SpecProductRow): RowState {
  const m = r.match;
  if (r.waivedReason != null || m?.status === "waived") return "waived";
  if (!m) return "none";
  if (m.status === "matched") return r.leftOutReason === "other-section" ? "other-section" : "matched";
  if (m.status === "ambiguous") return "ambiguous";
  if (m.status === "draft") return "draft";
  if (m.status === "no-match") return "no-spec";
  return "legacy";
}

/** A row the Spec Library speaks for (every state but legacy/none) — no
 *  per-spec header picker and no catalog-part spec title on these. */
export const isRecordState = (s: RowState) => s !== "legacy" && s !== "none";

const CHIP_BASE: CSSProperties = {
  display: "inline-block",
  fontSize: 11,
  fontWeight: 600,
  lineHeight: "16px",
  padding: "1px 8px",
  borderRadius: 999,
  whiteSpace: "nowrap",
};
const CHIP_TONE: Record<"good" | "warn" | "plain" | "info", CSSProperties> = {
  good: { color: "#1f7a52", background: "#e6f4ec" },
  warn: { color: "#8a6d1f", background: "#fbf3dd" },
  plain: { color: "#3a3f4a", background: "#f0f1f4" },
  info: { color: "#3b5b8c", background: "#e8eef8" },
};
const SKU: CSSProperties = { fontFamily: "var(--font-mono)", fontSize: 11.5 };
const WARN: CSSProperties = { fontSize: 12.5, color: "#8a6d1f" };
const LINK_BTN: CSSProperties = {
  background: "none",
  border: "none",
  padding: 0,
  color: "var(--accent)",
  fontSize: 12.5,
  fontWeight: 600,
  cursor: "pointer",
};
const PICK_CHIP: CSSProperties = {
  border: "1px solid #d6d9e0",
  background: "#fff",
  borderRadius: 999,
  padding: "2px 9px",
  fontSize: 11.5,
  color: "#3a3f4a",
  cursor: "pointer",
  maxWidth: 320,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

export function Chip({ tone, children }: { tone: keyof typeof CHIP_TONE; children: ReactNode }) {
  return <span style={{ ...CHIP_BASE, ...CHIP_TONE[tone] }}>{children}</span>;
}

const VIA_TEXT = { exact: "part number", wildcard: "part number pattern", key: "match key", pinned: "linked" } as const;

type ArticleOption = { id: string; title: string };
type Open = "" | "link" | "write" | "waive" | "edit";

export function RecordRowStatus({
  doc,
  row,
  recordsById,
  recordTexts,
  sectionArticles,
  systemMatchKeys,
  canEdit,
}: {
  doc: SpecDocument;
  row: SpecProductRow;
  recordsById: Record<string, SlimSpecRecord>;
  recordTexts: Record<string, { title: string; specText: string }>;
  sectionArticles: ArticleOption[];
  systemMatchKeys: string[];
  canEdit: boolean;
}) {
  const { err, pending, run } = useSave();
  const [open, setOpen] = useState<Open>("");
  const close = () => setOpen("");
  const state = rowState(row);
  const m = row.match;
  const title = (id: string) => recordsById[id]?.title || id;
  // Titles are generic categories; the product name is what tells two records apart.
  const label = (id: string) => recordsById[id]?.product || title(id);
  const tip = (id: string) => [`${id} — ${title(id)}`, recordsById[id]?.models].filter(Boolean).join(" · ");

  const quickPick = (specIds: string[], pin: boolean) =>
    specIds.length > 0 && (
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginTop: 4 }}>
        <span style={MUTED}>{pin ? "Pick one:" : "Suggested:"}</span>
        {specIds.map((id) => (
          <button
            key={id}
            type="button"
            style={PICK_CHIP}
            disabled={!canEdit || pending}
            title={tip(id)}
            onClick={() => run(() => (pin ? pinRowToRecordAction(doc.id, row.rowKey, id) : linkRowToRecordAction(doc.id, row.rowKey, id)))}
          >
            <span style={SKU}>{id}</span> {label(id)}
          </button>
        ))}
      </div>
    );

  const unresolvedActions = canEdit && (
    <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap", marginTop: 5 }}>
      <button type="button" style={LINK_BTN} disabled={pending} onClick={() => setOpen(open === "link" ? "" : "link")}>
        Link to existing
      </button>
      <button type="button" style={LINK_BTN} disabled={pending} onClick={() => setOpen(open === "write" ? "" : "write")}>
        Write new spec
      </button>
      <button type="button" style={LINK_BTN} disabled={pending} onClick={() => setOpen(open === "waive" ? "" : "waive")}>
        Waive
      </button>
    </div>
  );

  let body: ReactNode = null;
  if (state === "waived") {
    body = (
      <>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <Chip tone="plain">Waived</Chip>
          <span style={MUTED}>{row.waivedReason || (m?.status === "waived" ? m.reason : "")}</span>
          {canEdit && (
            <button type="button" style={LINK_BTN} disabled={pending} onClick={() => run(() => unwaiveRowAction(doc.id, row.rowKey))}>
              Un-waive
            </button>
          )}
        </div>
      </>
    );
  } else if (m?.status === "matched") {
    const rec = recordsById[m.specId];
    const ov = doc.overrides[m.specId];
    const stale = !!ov && !!rec && rec.revision > ov.baseRevision;
    const stamped = doc.usedRecords[m.specId];
    const changedSinceDownload = stamped != null && !!rec && stamped !== rec.revision;
    const via = m.via === "pinned" && row.fromLibrary ? "added from the Spec Library" : `via ${VIA_TEXT[m.via]}`;
    if (state === "other-section") {
      const src = doc.source;
      const quoteId = src.quoteId || (src.kind === "quote" ? src.id : undefined);
      const href =
        quoteId && row.otherSectionId
          ? `/design/specs/new?section=${encodeURIComponent(row.otherSectionId)}${src.kind === "grid" && src.id ? `&grid=${encodeURIComponent(src.id)}` : ""}&quote=${encodeURIComponent(quoteId)}`
          : null;
      body = (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <Chip tone="info">Other section {row.otherSectionNumber}</Chip>
          <span style={MUTED}>
            <span style={SKU}>{m.specId}</span> prints in section {row.otherSectionNumber}&apos;s file
          </span>
          {href && canEdit && (
            <Link href={href} style={{ fontSize: 12.5, fontWeight: 600, color: "var(--accent)" }}>
              Start a {row.otherSectionNumber} spec from this {src.kind === "grid" ? "design" : "quote"}
            </Link>
          )}
        </div>
      );
    } else {
      body = (
        <>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <Chip tone="good">Matched</Chip>
            <span style={MUTED}>
              <span style={SKU}>{m.specId}</span> {via}
              {rec && rec.revision > 1 ? ` · revision ${rec.revision}` : ""}
            </span>
            {canEdit && recordTexts[m.specId] && (
              <button type="button" style={LINK_BTN} disabled={pending} onClick={() => setOpen(open === "edit" ? "" : "edit")}>
                Edit
              </button>
            )}
          </div>
          {row.leftOutReason === "needs-header" && (
            <div style={{ ...WARN, marginTop: 3 }}>Its header isn&apos;t in this section, so it&apos;s left out — fix the spec&apos;s article in the Spec Library.</div>
          )}
          {ov && (
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 3 }}>
              <Chip tone="info">Changed for this project</Chip>
              {stale && <span style={WARN}>Library updated since you changed this</span>}
              {canEdit && (
                <button type="button" style={LINK_BTN} disabled={pending} onClick={() => run(() => clearRowOverrideAction(doc.id, m.specId))}>
                  Use library text
                </button>
              )}
            </div>
          )}
          {changedSinceDownload && <div style={{ ...WARN, marginTop: 3 }}>Library changed since your last download</div>}
        </>
      );
    }
  } else if (m?.status === "no-match") {
    const note =
      row.leftOutReason === "not-in-catalog"
        ? "Not in the catalog"
        : row.leftOutReason === "other-section"
          ? `Its catalog category belongs to ${row.otherArticleTitle || "another section"}`
          : null;
    body = (
      <>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <Chip tone="warn">No spec</Chip>
          <span style={MUTED}>{note ? `${note} · ` : ""}Nothing in the Spec Library matches yet</span>
        </div>
        {canEdit && quickPick(m.candidates, false)}
        {unresolvedActions}
      </>
    );
  } else if (m?.status === "ambiguous") {
    body = (
      <>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <Chip tone="warn">Pick one</Chip>
          <span style={MUTED}>More than one library spec matches — nothing prints until you pick</span>
        </div>
        {quickPick(m.specIds, true)}
        {unresolvedActions}
      </>
    );
  } else if (m?.status === "draft") {
    body = (
      <>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <Chip tone="warn">Draft spec</Chip>
          <span style={MUTED}>
            <span style={SKU}>{m.specId}</span> {label(m.specId)} — approve it to print
          </span>
          {canEdit && (
            <button type="button" className="pk-btn-outline" style={{ padding: "3px 8px", fontSize: 11.5 }} disabled={pending} onClick={() => run(() => approveDraftRecordAction(m.specId))}>
              Approve
            </button>
          )}
        </div>
        {unresolvedActions}
      </>
    );
  }

  const done = () => setOpen("");

  return (
    <div style={{ marginTop: 3 }}>
      {body}
      {err && (
        <div role="alert" style={{ ...ERR, marginTop: 4 }}>
          {err}
        </div>
      )}
      {open === "waive" && <WaivePanel docId={doc.id} row={row} onClose={close} onDone={done} />}
      {open === "edit" && m?.status === "matched" && recordTexts[m.specId] && (
        <EditRecordPanel docId={doc.id} specId={m.specId} library={recordTexts[m.specId]} override={doc.overrides[m.specId]} onClose={close} onDone={done} />
      )}
      {open === "link" && <LinkRecordDialog docId={doc.id} row={row} onClose={close} onDone={done} />}
      {open === "write" && (
        <WriteRecordDialog docId={doc.id} row={row} sectionArticles={sectionArticles} systemMatchKeys={systemMatchKeys} onClose={close} onDone={done} />
      )}
    </div>
  );
}

/** Enter in a one-line field commits it (blur → save). */
function blurOnEnter(e: KeyboardEvent<HTMLInputElement>) {
  if (e.key === "Enter") e.currentTarget.blur();
}

/** Checklist → Job values (design §4): every `[bracket]` in the printed
 *  record entries, with its default and the words before it. An answer
 *  saves through the builder's own fill-in action (the server looks the
 *  label up from the printed text); an empty one prints the default as
 *  written, brackets included. Never blocks the download. */
export function JobValuesGroup({
  docId,
  answers,
  labels,
  checklist,
  canEdit,
}: {
  docId: string;
  answers: Record<string, string>;
  labels: Record<string, string>;
  checklist: SpecChecklist;
  canEdit: boolean;
}) {
  const { err, pending, run } = useSave();
  // PUNCHLIST #141: seeded once per mount, so a refresh after one save never
  // clobbers typing in another field. A stale answer is listed, never pre-filled.
  const [live] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    const stale = new Set(checklist.staleJobValues);
    for (const s of checklist.jobValues) if (!stale.has(s.key) && answers[s.key]) out[s.key] = answers[s.key];
    return out;
  });
  const [values, setValues] = useState<Record<string, string>>(live);
  const saved = useRef<Record<string, string>>(live);
  const jv = checklist.jobValues;
  if (jv.length === 0 && checklist.staleJobValues.length === 0) return null;
  const answered = jv.filter((s) => s.answered).length;

  const commit = (key: string, value: string) => {
    if (!canEdit || value.trim() === (saved.current[key] || "").trim()) return;
    run(
      () => setSpecFillInAction(docId, key, value),
      () => (saved.current = { ...saved.current, [key]: value.trim() })
    );
  };

  return (
    <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid #f0f1f4" }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: "#3a3f4a", marginBottom: 2 }}>
        Job values · {answered} of {jv.length} set
      </div>
      <div style={{ ...MUTED, marginBottom: 8 }}>
        [Bracketed] values in the library specs. Leave one empty and it prints its default as written, brackets included.
      </div>
      <div style={{ display: "grid", gap: 8 }}>
        {jv.map((s) => (
          <div key={s.key}>
            <label className="pk-field-label" htmlFor={`spec-jv-${s.key}`} style={{ display: "block" }}>
              {s.title} — [{s.defaultText}]
              {s.context && (
                <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 400, color: "#9aa0ab" }}> · after &ldquo;{s.context}&rdquo;</span>
              )}
            </label>
            <input
              id={`spec-jv-${s.key}`}
              className="pk-input"
              placeholder={s.defaultText || "Value for this job"}
              value={values[s.key] || ""}
              maxLength={SPEC_FILL_IN_MAX}
              disabled={!canEdit}
              onChange={(e) => setValues((v) => ({ ...v, [s.key]: e.target.value }))}
              onBlur={(e) => commit(s.key, e.target.value)}
              onKeyDown={blurOnEnter}
            />
          </div>
        ))}
      </div>
      {checklist.staleJobValues.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div style={{ ...MUTED, marginBottom: 6 }}>These values were written for a bracket that has since changed or moved, so they don&apos;t print.</div>
          {checklist.staleJobValues.map((key) => (
            <div key={key} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12.5, color: "#3a3f4a", marginBottom: 4 }}>
              <span>
                No longer used: {labels[key] ? <>&ldquo;{labels[key]}&rdquo; </> : null}
                <span style={{ fontFamily: "var(--font-mono)" }}>{key}</span> = {answers[key]}
              </span>
              {canEdit && (
                <button type="button" className="pk-btn-outline" disabled={pending} onClick={() => run(() => setSpecFillInAction(docId, key, ""))}>
                  Clear
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {(pending || err) && (
        <div style={{ marginTop: 8 }}>
          {pending && <span style={MUTED}>Saving…</span>}
          {err && (
            <span role="alert" style={ERR}>
              {err}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
