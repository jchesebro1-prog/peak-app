"use client";

/* One question of the assessment editor (#340, Task 7): its label, the answer control for its type, the ⋯ menu
   (N/A, Unable…, Clear), the venue-profile "On file" line and any photos already attached. Every change goes up as a
   whole Answer through `onAnswer`; the editor stamps nothing itself, the control does (at = now, by = me). */
import { useState, type ReactNode } from "react";
import { PhotoThumbs } from "./photo-button";
import type { Answer } from "@/lib/assessments/answers";
import { ANSWER_CAPS } from "@/lib/assessments/answers";
import type { AssessmentDef, ColumnDef, QuestionDef } from "@/lib/assessments/defs/types";
import type { PhotoRef } from "@/lib/assessments/photos";
import {
  REASON_MAX,
  answeredWith,
  clearMarker,
  contactValue,
  dateInputToMs,
  formatValue,
  msToDateInput,
  notApplicable,
  optionsFor,
  parseFtinInput,
  parseNumberInput,
  showCounter,
  stampNow,
  textAnswer,
  textCap,
  toggleMany,
  unableWith,
  type ContactValue,
  type PicklistExtrasVM,
  type ProfileFactVM,
} from "@/lib/assessments/editor-model";

export interface QuestionProps {
  q: QuestionDef;
  def: AssessmentDef;
  extras: PicklistExtrasVM;
  answer: Answer | undefined;
  onAnswer: (a: Answer) => void;
  me: string;
  disabled: boolean;
  required: boolean;
  onFile: ProfileFactVM | null;
  photos: PhotoRef[];
  assessmentId: string;
  /** the question a refusal or a Re-enter points at */
  highlight?: boolean;
  /** device copies of photos still uploading (photo id → object URL) */
  localUrls?: Record<string, string>;
  /** the camera button, beside the ⋯ menu */
  camera?: ReactNode;
  /** under the question: its prompt chips */
  below?: ReactNode;
  /** ⋯ → New finding… */
  onNewFinding?: () => void;
}

/** Keeps a control's draft text in step with its answer: a change that came from somewhere else (a server copy, Still
 *  true, Clear) resets the draft; the control's own commits don't, so typing is never fought. */
function useDraft<T>(answer: Answer | undefined, from: (a: Answer | undefined) => T): [T, (t: T) => void, (at: number) => void] {
  const [draft, setDraft] = useState<T>(() => from(answer));
  const [seenAt, setSeenAt] = useState<number | undefined>(answer?.at);
  const [mineAt, setMineAt] = useState<number | undefined>(undefined);
  if (answer?.at !== seenAt) {
    setSeenAt(answer?.at);
    if (answer?.at !== mineAt) setDraft(from(answer));
  }
  return [draft, setDraft, setMineAt];
}

const valueOf = (a: Answer | undefined): unknown => (a && a.state === "answered" ? a.v : undefined);

function Seg({ options, value, onPick, disabled }: { options: { value: string; label: string }[]; value: unknown; onPick: (v: string) => void; disabled: boolean }) {
  return (
    <div className="as-seg" role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className={value === o.value ? "on" : ""}
          disabled={disabled}
          onClick={() => onPick(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Counter({ len, cap }: { len: number; cap: number }) {
  if (!showCounter(len, cap)) return null;
  return <span className="as-counter" style={{ color: len > cap ? "#b4543a" : undefined }}>{len.toLocaleString()} / {cap.toLocaleString()}</span>;
}

/* ---------- per-type controls ---------- */

type Ctl = { q: QuestionDef; def: AssessmentDef; extras: PicklistExtrasVM; answer: Answer | undefined; commit: (v: unknown | null) => Answer; disabled: boolean };

function TextControl({ q, answer, commit, disabled }: Ctl) {
  const [draft, setDraft, mine] = useDraft(answer, (a) => (typeof valueOf(a) === "string" ? (valueOf(a) as string) : ""));
  const cap = textCap(q);
  const change = (raw: string) => {
    setDraft(raw);
    // Trimmed to nothing → the Clear marker, never "" (textAnswer's rule).
    mine(commit(textAnswer(raw, "", 0).v === null ? null : raw).at);
  };
  return (
    <div style={{ position: "relative" }}>
      {q.type === "longtext" ? (
        <textarea className="pk-input" rows={3} value={draft} maxLength={cap} disabled={disabled} onChange={(e) => change(e.target.value)} />
      ) : (
        <input className="pk-input" value={draft} maxLength={cap} disabled={disabled} onChange={(e) => change(e.target.value)} />
      )}
      <Counter len={draft.length} cap={cap} />
    </div>
  );
}

function NumberControl({ answer, commit, disabled }: Ctl) {
  const [draft, setDraft, mine] = useDraft(answer, (a) => (typeof valueOf(a) === "number" ? String(valueOf(a)) : ""));
  const bad = parseNumberInput(draft) === "invalid";
  return (
    <input
      className="pk-input as-num"
      inputMode="decimal"
      value={draft}
      disabled={disabled}
      aria-invalid={bad}
      style={bad ? { borderColor: "#d9a08f" } : undefined}
      onChange={(e) => {
        setDraft(e.target.value);
        const n = parseNumberInput(e.target.value);
        if (n !== "invalid") mine(commit(n).at);
      }}
    />
  );
}

function FtinControl({ answer, commit, disabled }: Ctl) {
  const [draft, setDraft, mine] = useDraft(answer, (a) => {
    const v = valueOf(a) as { ft?: number; in?: number } | undefined;
    return v && typeof v === "object" ? { ft: String(v.ft ?? ""), inch: String(v.in ?? "") } : { ft: "", inch: "" };
  });
  const parsed = parseFtinInput(draft.ft, draft.inch);
  const change = (next: { ft: string; inch: string }) => {
    setDraft(next);
    const p = parseFtinInput(next.ft, next.inch);
    if (p !== "invalid") mine(commit(p).at);
  };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <input className="pk-input as-num" inputMode="numeric" value={draft.ft} disabled={disabled} aria-label="Feet" style={parsed === "invalid" ? { borderColor: "#d9a08f" } : undefined} onChange={(e) => change({ ...draft, ft: e.target.value })} />
      <span className="as-unit">ft</span>
      <input className="pk-input as-num" inputMode="decimal" value={draft.inch} disabled={disabled} aria-label="Inches" style={parsed === "invalid" ? { borderColor: "#d9a08f" } : undefined} onChange={(e) => change({ ...draft, inch: e.target.value })} />
      <span className="as-unit">in</span>
    </div>
  );
}

function DateControl({ answer, commit, disabled }: Ctl) {
  return (
    <input
      type="date"
      className="pk-input as-date"
      value={msToDateInput(valueOf(answer))}
      disabled={disabled}
      onChange={(e) => {
        if (!e.target.value) { commit(null); return; }
        const ms = dateInputToMs(e.target.value);
        if (ms !== null) commit(ms);
      }}
    />
  );
}

function ContactControl({ answer, commit, disabled }: Ctl) {
  const [draft, setDraft, mine] = useDraft<ContactValue>(answer, (a) => {
    const v = valueOf(a);
    return v && typeof v === "object" ? { ...(v as ContactValue) } : {};
  });
  const state = contactValue(draft);
  const change = (k: keyof ContactValue, val: string) => {
    const next = { ...draft, [k]: val };
    setDraft(next);
    const c = contactValue(next);
    if (c !== "needsName") mine(commit(c).at);
  };
  const field = (k: keyof ContactValue, label: string, type = "text") => (
    <input className="pk-input" placeholder={label} aria-label={label} type={type} value={draft[k] ?? ""} maxLength={200} disabled={disabled} onChange={(e) => change(k, e.target.value)} />
  );
  return (
    <div>
      <div className="as-contact">
        {field("name", "Name")}
        {field("title", "Title")}
        {field("phone", "Phone", "tel")}
        {field("email", "Email", "email")}
      </div>
      {state === "needsName" && <div className="as-hint">Enter a name to save this contact.</div>}
    </div>
  );
}

type RowDraft = Record<string, string>;

function cellToDraft(col: ColumnDef, v: unknown, row: RowDraft) {
  if (col.type === "ftin") {
    const x = v as { ft?: number; in?: number } | undefined;
    row[`${col.key}__ft`] = x && typeof x === "object" ? String(x.ft ?? "") : "";
    row[`${col.key}__in`] = x && typeof x === "object" ? String(x.in ?? "") : "";
  } else row[col.key] = v === undefined || v === null ? "" : String(v);
}

/** Draft rows → saved rows. A cell that doesn't parse is left out (and outlined); an all-blank row is kept. */
function rowsValue(cols: ColumnDef[], rows: RowDraft[]): Record<string, unknown>[] {
  return rows.map((r) => {
    const out: Record<string, unknown> = {};
    for (const c of cols) {
      if (c.type === "ftin") { const p = parseFtinInput(r[`${c.key}__ft`] ?? "", r[`${c.key}__in`] ?? ""); if (p && p !== "invalid") out[c.key] = p; }
      else if (c.type === "number") { const n = parseNumberInput(r[c.key] ?? ""); if (typeof n === "number") out[c.key] = n; }
      else if ((r[c.key] ?? "").trim()) out[c.key] = r[c.key];
    }
    return out;
  });
}

function TableControl({ q, def, extras, answer, commit, disabled }: Ctl) {
  const cols = q.columns ?? [];
  const [rows, setRows, mine] = useDraft<RowDraft[]>(answer, (a) => {
    const v = valueOf(a);
    return Array.isArray(v) ? v.map((r) => { const d: RowDraft = {}; for (const c of cols) cellToDraft(c, (r as Record<string, unknown>)?.[c.key], d); return d; }) : [];
  });
  const change = (next: RowDraft[]) => {
    setRows(next);
    mine(commit(next.length ? rowsValue(cols, next) : null).at);
  };
  const set = (i: number, k: string, v: string) => change(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  return (
    <div className="as-table-wrap">
      <table className="as-table">
        <thead>
          <tr>
            {cols.map((c) => <th key={c.key}>{c.label}</th>)}
            <th aria-label="Remove" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {cols.map((c) => (
                <td key={c.key}>
                  {c.type === "one" ? (
                    <select className="pk-input" value={r[c.key] ?? ""} disabled={disabled} onChange={(e) => set(i, c.key, e.target.value)}>
                      <option value="">—</option>
                      {optionsFor(def, extras, c.options, r[c.key]).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  ) : c.type === "ftin" ? (
                    <span style={{ display: "flex", gap: 3, alignItems: "center" }}>
                      <input className="pk-input as-cell-sm" inputMode="numeric" aria-label={`${c.label} feet`} value={r[`${c.key}__ft`] ?? ""} disabled={disabled} onChange={(e) => set(i, `${c.key}__ft`, e.target.value)} />
                      <span className="as-unit">′</span>
                      <input className="pk-input as-cell-sm" inputMode="decimal" aria-label={`${c.label} inches`} value={r[`${c.key}__in`] ?? ""} disabled={disabled} onChange={(e) => set(i, `${c.key}__in`, e.target.value)} />
                      <span className="as-unit">″</span>
                    </span>
                  ) : (
                    <input
                      className="pk-input"
                      inputMode={c.type === "number" ? "decimal" : undefined}
                      value={r[c.key] ?? ""}
                      maxLength={ANSWER_CAPS.text}
                      disabled={disabled}
                      style={c.type === "number" && parseNumberInput(r[c.key] ?? "") === "invalid" ? { borderColor: "#d9a08f" } : undefined}
                      onChange={(e) => set(i, c.key, e.target.value)}
                    />
                  )}
                </td>
              ))}
              <td>
                <button type="button" className="as-x" aria-label="Remove row" disabled={disabled} onClick={() => change(rows.filter((_, j) => j !== i))}>×</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6 }}>
        <button type="button" className="pk-btn-outline" disabled={disabled || rows.length >= ANSWER_CAPS.tableRows} onClick={() => change([...rows, {}])}>
          + Add row
        </button>
        <span className="as-mono-sm">{rows.length} / {ANSWER_CAPS.tableRows}</span>
      </div>
    </div>
  );
}

/* ---------- the question ---------- */

export default function Question({ q, def, extras, answer, onAnswer, me, disabled, required, onFile, photos, assessmentId, highlight, localUrls, camera, below, onNewFinding }: QuestionProps) {
  const [menu, setMenu] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const value = valueOf(answer);

  /** v → an answered entry; null → the Clear marker. Returns the answer it sent (controls note its `at`). */
  const commit = (v: unknown | null): Answer => {
    const at = stampNow();
    const a = v === null ? clearMarker(me, at) : answeredWith(v, me, at);
    onAnswer(a);
    return a;
  };
  const ctl: Ctl = { q, def, extras, answer, commit, disabled };
  const opts = optionsFor(def, extras, q.options, value);
  const unableReason = (reason ?? "").trim();

  const control = (() => {
    switch (q.type) {
      case "yesno":
        return <Seg options={[{ value: "yes", label: "Yes" }, { value: "no", label: "No" }]} value={value} disabled={disabled} onPick={(v) => commit(v)} />;
      case "one":
        return opts.length <= 5 ? (
          <Seg options={opts} value={value} disabled={disabled} onPick={(v) => commit(v)} />
        ) : (
          <select className="pk-input as-select" value={typeof value === "string" ? value : ""} disabled={disabled} onChange={(e) => commit(e.target.value || null)}>
            <option value="">Choose…</option>
            {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        );
      case "many": {
        const cur = Array.isArray(value) ? (value as string[]) : [];
        return (
          <div className="as-chips">
            {opts.map((o) => (
              <button key={o.value} type="button" aria-pressed={cur.includes(o.value)} className={cur.includes(o.value) ? "on" : ""} disabled={disabled} onClick={() => commit(toggleMany(cur, o.value))}>
                {o.label}
              </button>
            ))}
          </div>
        );
      }
      case "number": return <NumberControl {...ctl} />;
      case "ftin": return <FtinControl {...ctl} />;
      case "date": return <DateControl {...ctl} />;
      case "text": case "longtext": return <TextControl {...ctl} />;
      case "contact": return <ContactControl {...ctl} />;
      case "table": return <TableControl {...ctl} />;
    }
  })();

  const onFileText = onFile ? formatValue(q, onFile.v, def, extras) : "";
  const onFileWhen = onFile && onFile.at ? new Date(onFile.at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";
  const collapsed = !!onFile && q.firstVisitOnly && !expanded;
  const stillTrue = () => { if (onFile) onAnswer(answeredWith(onFile.v, me, Date.now())); };
  const qPhotos = photos.filter((p) => p.questionKey === q.key || answer?.photoIds?.includes(p.id));

  return (
    <div className={`as-q${highlight ? " as-q-hl" : ""}`} id={`q-${q.key}`}>
      <div className="as-q-head">
        <label className="as-q-label">
          {q.label}
          {required && <span className="as-req" title="Required"> *</span>}
        </label>
        {!disabled && (
          <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 6 }}>
            {camera}
            <button type="button" className="as-more" aria-label="More options" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>⋯</button>
            {menu && <div aria-hidden="true" onClick={() => setMenu(false)} style={{ position: "fixed", inset: 0, zIndex: 19 }} />}
            {menu && (
              <div className="pk-dropdown as-menu" role="menu">
                <button type="button" role="menuitem" className="pk-dropdown-item" onClick={() => { onAnswer(notApplicable(me, Date.now())); setMenu(false); }}>N/A</button>
                <button type="button" role="menuitem" className="pk-dropdown-item" onClick={() => { setReason(answer?.state === "unable" ? answer.reason ?? "" : ""); setMenu(false); }}>Unable…</button>
                <button type="button" role="menuitem" className="pk-dropdown-item" onClick={() => { commit(null); setMenu(false); }}>Clear</button>
                {onNewFinding && <button type="button" role="menuitem" className="pk-dropdown-item" onClick={() => { onNewFinding(); setMenu(false); }}>New finding…</button>}
              </div>
            )}
          </div>
        )}
      </div>
      {q.help && <div className="as-help">{q.help}</div>}

      {onFile && (
        <div className="as-onfile">
          <span>
            On file: <b>{onFileText}</b> <span className="as-mono-sm">({onFile.from}{onFileWhen ? `, ${onFileWhen}` : ""})</span>
          </span>
          {!disabled && <button type="button" className="pk-btn-outline" onClick={stillTrue}>Still true</button>}
          {!disabled && collapsed && <button type="button" className="pk-btn-outline" onClick={() => setExpanded(true)}>Change</button>}
        </div>
      )}

      {answer?.state === "na" && <div className="as-state">Not applicable</div>}
      {answer?.state === "unable" && <div className="as-state as-state-unable">Unable: {answer.reason}</div>}

      {reason !== null && (
        <div className="as-reason">
          <textarea className="pk-input" rows={2} autoFocus placeholder="Why couldn't this be answered?" maxLength={REASON_MAX} value={reason} onChange={(e) => setReason(e.target.value)} />
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
            <button
              type="button"
              className="pk-btn-accent"
              style={{ padding: "7px 12px" }}
              disabled={!unableReason || unableReason.length > REASON_MAX}
              onClick={() => { const a = unableWith(reason, me, Date.now()); if (a) { onAnswer(a); setReason(null); } }}
            >
              Mark unable
            </button>
            <button type="button" className="pk-btn-outline" onClick={() => setReason(null)}>Cancel</button>
            <span className="as-mono-sm">{reason.length} / {REASON_MAX}</span>
          </div>
        </div>
      )}

      {!collapsed && <div className="as-control">{control}</div>}

      <PhotoThumbs photos={qPhotos} assessmentId={assessmentId} localUrls={localUrls ?? {}} />
      {below}
    </div>
  );
}
