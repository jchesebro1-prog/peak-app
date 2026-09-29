"use client";

import { createContext, useContext, useRef, useState, useTransition, type CSSProperties, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { CustomerCombobox, type CustomerComboboxOption } from "@/components/customer-combobox";
import { ConfirmButton } from "@/components/confirm-button";
import { SPEC_FILL_IN_MAX, SPEC_HEADER_MAX, type SpecDocHeader, type SpecDocSource, type SpecDocument } from "@/lib/specs/spec-document";
import type { SpecChecklist } from "@/lib/specs/assemble-section";
import { applySpecHeaderToProjectAction, setSpecCustomerAction, setSpecFillInAction, updateSpecHeaderAction } from "../builder-actions";

/**
 * #205 Phase B (T5) — the builder's first two cards: the Word file's header
 * (project name/number, phase, issue date, prepared by, customer) and the
 * fill-in form (one field per [FILL IN: …] in the section's Part 1/3).
 *
 * Every field saves on its own when you leave it (header text, fill-ins) or
 * the moment it changes (issue date, customer), then router.refresh() brings
 * the preview current. PUNCHLIST #141 rule: each input seeds local state from
 * props once per mount, so a refresh after one save never clobbers typing in
 * another field.
 *
 * One header per project: when other saved specs share this spec's project
 * number, "Apply this header to N other specs" copies the saved header onto
 * all of them (after any header save still in flight lands).
 */

export const CARD: CSSProperties = { padding: "16px 20px", marginBottom: 18 };
export const CARD_TITLE: CSSProperties = { fontSize: 14.5, fontWeight: 600, marginBottom: 4 };
export const CARD_SUB: CSSProperties = { fontSize: 12, color: "#8c919c", marginBottom: 14 };
export const MUTED: CSSProperties = { fontSize: 12, color: "#9aa0ab" };
export const ERR: CSSProperties = { fontSize: 12.5, color: "#b4543a" };
/** CustomerCombobox takes an inline style, not a class — this mirrors
 *  `.pk-input` (globals.css) so the typeahead matches the fields around it. */
export const COMBO_INPUT: CSSProperties = {
  width: "100%",
  fontSize: 14,
  fontFamily: "var(--font-ui)",
  border: "1px solid #d6d9e0",
  borderRadius: 9,
  padding: "10px 12px",
  outline: "none",
  color: "var(--ink)",
  background: "#fff",
};

export type ActionResult = { ok: true } | { ok: false; error: string };

/** Counts saves in flight across every card, so the Builder can hold the
 *  Download Word link until the file would include them. `failed` on the
 *  closing bump cancels a queued download — the owner sees the error and
 *  clicks again. The Builder provides it; the default is a no-op. */
export const SaveTracker = createContext<(delta: number, failed?: boolean) => void>(() => {});

/** A server call's answer counts as failed when it is `{ ok: false }`. */
const failedResult = (r: unknown) => !!r && typeof r === "object" && (r as { ok?: unknown }).ok === false;

/** The builder's one save hook. `run` saves, surfaces the error, refreshes
 *  on success; `track` wraps any other server call so it counts as a save
 *  in flight too. */
export function useSave() {
  const router = useRouter();
  const bump = useContext(SaveTracker);
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();
  const track = async <T,>(p: () => Promise<T>): Promise<T> => {
    bump(1);
    let failed = true;
    try {
      const r = await p();
      failed = failedResult(r);
      return r;
    } finally {
      bump(-1, failed);
    }
  };
  const run = (fn: () => Promise<ActionResult>, onOk?: () => void) => {
    // Counted before the transition starts, so a Download click right after
    // a blur already sees the save in flight.
    bump(1);
    start(async () => {
      let failed = true;
      try {
        const r = await fn();
        if (!r.ok) {
          setErr(r.error);
          return;
        }
        failed = false;
        setErr("");
        onOk?.();
        router.refresh();
      } catch {
        setErr("Could not save. Try again.");
      } finally {
        bump(-1, failed);
      }
    });
  };
  return { err, setErr, pending, run, track };
}

/** Enter in a one-line field commits it (blur → save) instead of doing nothing. */
function blurOnEnter(e: KeyboardEvent<HTMLInputElement>) {
  if (e.key === "Enter") e.currentTarget.blur();
}

/** #223 — `quoteNumber` is the source quote's estimate number; the id shows when absent. */
export function sourceText(s: SpecDocSource, quoteNumber?: string | null): string {
  if (s.kind === "quote") return `From quote ${quoteNumber || s.quoteId || s.id || ""}${s.label && s.label !== s.quoteId ? ` — ${s.label}` : ""}`;
  if (s.kind === "grid") return `From Grid design ${s.id || ""}${s.quoteId ? ` (quote ${quoteNumber || s.quoteId})` : ""}`;
  return "From scratch — no quantities";
}

const HEADER_FIELDS: Array<{ key: keyof SpecDocHeader; label: string; mono?: boolean }> = [
  { key: "projectName", label: "Project name" },
  { key: "projectNumber", label: "Project number", mono: true },
  { key: "phase", label: "Phase" },
  { key: "preparedBy", label: "Prepared by" },
];

export function HeaderCard({
  doc,
  customerOptions,
  canEdit,
  sourceQuoteNumber,
  projectSpecCount = 0,
}: {
  doc: SpecDocument;
  customerOptions: CustomerComboboxOption[];
  canEdit: boolean;
  sourceQuoteNumber?: string | null;
  /** Other saved specs with this spec's project number. */
  projectSpecCount?: number;
}) {
  const router = useRouter();
  const { err, pending, run, track } = useSave();
  // Header saves in flight (true = saved). Apply waits for them, so it copies
  // what you just typed — the server reads the saved header, never ours.
  const headerSaves = useRef(new Set<Promise<boolean>>());
  const [applied, setApplied] = useState("");
  const [values, setValues] = useState<SpecDocHeader>(doc.header);
  // What the server last accepted — a blur with nothing changed saves nothing.
  const saved = useRef<SpecDocHeader>(doc.header);
  const [customerId, setCustomerId] = useState(doc.customerId || "");

  const commit = (key: keyof SpecDocHeader, value: string) => {
    if (!canEdit || value.trim() === (saved.current[key] || "")) return;
    setApplied("");
    run(
      () => {
        const p = updateSpecHeaderAction(doc.id, { [key]: value });
        const settled = p.then(
          (r) => r.ok,
          () => false
        );
        headerSaves.current.add(settled);
        void settled.then(() => headerSaves.current.delete(settled));
        return p;
      },
      () => (saved.current = { ...saved.current, [key]: value.trim() })
    );
  };

  const projectNumber = doc.header.projectNumber.trim();
  const others = `${projectSpecCount} other ${projectSpecCount === 1 ? "spec" : "specs"}`;
  const applyToProject = async () => {
    setApplied("");
    if ((await Promise.all([...headerSaves.current])).includes(false)) {
      throw new Error("A header field didn't save — fix it, then apply.");
    }
    let r: Awaited<ReturnType<typeof applySpecHeaderToProjectAction>>;
    try {
      r = await track(() => applySpecHeaderToProjectAction(doc.id));
    } catch {
      throw new Error("Could not apply the header. Try again.");
    }
    if (!r.ok) throw new Error(r.error);
    setApplied(`Updated ${r.count} ${r.count === 1 ? "spec" : "specs"}.`);
    router.refresh();
  };

  const pickCustomer = (id: string) => {
    setCustomerId(id);
    run(() => setSpecCustomerAction(doc.id, id || null));
  };

  return (
    <div className="pk-card" style={CARD}>
      <div style={CARD_TITLE}>Header</div>
      <div style={CARD_SUB}>Prints at the top of every page of the Word file.</div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "12px 14px" }}>
        {HEADER_FIELDS.map((f) => (
          <div key={f.key}>
            <label className="pk-field-label" htmlFor={`spec-h-${f.key}`} style={{ display: "block" }}>
              {f.label}
            </label>
            <input
              id={`spec-h-${f.key}`}
              className={f.mono ? "pk-input mono" : "pk-input"}
              value={values[f.key]}
              maxLength={SPEC_HEADER_MAX}
              disabled={!canEdit}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              onBlur={(e) => commit(f.key, e.target.value)}
              onKeyDown={blurOnEnter}
            />
          </div>
        ))}
        <div>
          <label className="pk-field-label" htmlFor="spec-h-issueDate" style={{ display: "block" }}>
            Issue date
          </label>
          <input
            id="spec-h-issueDate"
            type="date"
            className="pk-input"
            value={values.issueDate}
            disabled={!canEdit}
            onChange={(e) => {
              const v = e.target.value;
              setValues((s) => ({ ...s, issueDate: v }));
              commit("issueDate", v);
            }}
          />
        </div>
        <div>
          <label className="pk-field-label" htmlFor="spec-h-customer" style={{ display: "block" }}>
            Customer
          </label>
          {canEdit ? (
            <>
              <CustomerCombobox id="spec-h-customer" options={customerOptions} value={customerId} onChange={pickCustomer} inputStyle={COMBO_INPUT} />
              {customerId && (
                <button
                  type="button"
                  onClick={() => pickCustomer("")}
                  style={{ background: "none", border: "none", padding: 0, marginTop: 6, color: "#8c919c", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
                >
                  Clear customer
                </button>
              )}
            </>
          ) : (
            <input id="spec-h-customer" className="pk-input" value={doc.customer || "—"} disabled readOnly />
          )}
        </div>
      </div>

      {canEdit && projectNumber && projectSpecCount > 0 && (
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 14, paddingTop: 12, borderTop: "1px solid #f0f1f4" }}>
          <ConfirmButton
            className="pk-btn-outline"
            label={`Apply this header to ${others} for Project No. ${projectNumber}`}
            confirmLabel={`Replace the header on ${others}`}
            pendingLabel="Applying…"
            disabled={pending}
            onConfirm={applyToProject}
          />
          {applied ? (
            <span role="status" style={{ fontSize: 12.5, color: "#3a3f4a" }}>
              {applied}
            </span>
          ) : (
            <span style={MUTED}>Copies the project name, number, phase, issue date and prepared by so every spec for this project prints the same header.</span>
          )}
        </div>
      )}

      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginTop: 14 }}>
        <span style={MUTED}>Source: {sourceText(doc.source, sourceQuoteNumber)}</span>
        {pending && <span style={MUTED}>Saving…</span>}
        {err && (
          <span role="alert" style={ERR}>
            {err}
          </span>
        )}
      </div>
    </div>
  );
}

export function FillInsCard({
  docId,
  answers,
  labels,
  checklist,
  canEdit,
}: {
  docId: string;
  answers: Record<string, string>;
  /** The label each answer was written for (SpecDocument.fillInLabels). */
  labels: Record<string, string>;
  checklist: SpecChecklist;
  canEdit: boolean;
}) {
  const { err, pending, run } = useSave();
  // A stale answer was written for a different blank than the one now at its
  // key — it's listed below, never pre-filled into the live blank's field.
  const [live] = useState<Record<string, string>>(() => {
    const out = { ...answers };
    for (const k of checklist.staleAnswers) delete out[k];
    return out;
  });
  const [values, setValues] = useState<Record<string, string>>(live);
  const saved = useRef<Record<string, string>>(live);

  const commit = (key: string, value: string) => {
    if (!canEdit || value.trim() === (saved.current[key] || "").trim()) return;
    run(
      () => setSpecFillInAction(docId, key, value),
      () => (saved.current = { ...saved.current, [key]: value.trim() })
    );
  };

  const parts: Array<{ part: 1 | 3; title: string }> = [
    { part: 1, title: "Part 1 — General" },
    { part: 3, title: "Part 3 — Execution" },
  ];

  return (
    <div className="pk-card" style={CARD}>
      <div style={CARD_TITLE}>Fill-ins</div>
      <div style={CARD_SUB}>
        The job-specific blanks in Parts 1 and 3. A blank you leave empty prints as [FILL IN: …] so it&apos;s easy to find in
        Word.
      </div>

      {checklist.fillIns.length === 0 && <div style={MUTED}>This section has no blanks to fill in.</div>}

      {parts.map(({ part, title }) => {
        const slots = checklist.fillIns.filter((s) => s.part === part);
        if (slots.length === 0) return null;
        return (
          <div key={part} style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: "#3a3f4a", marginBottom: 8 }}>{title}</div>
            <div style={{ display: "grid", gap: 10 }}>
              {slots.map((s) => (
                <div key={s.key}>
                  <label className="pk-field-label" htmlFor={`spec-fill-${s.key}`} style={{ display: "block" }}>
                    {s.articleTitle ? `${s.articleTitle} — ${s.label}` : s.label}
                    {s.context && (
                      <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 400, color: "#9aa0ab" }}> · after &ldquo;{s.context}&rdquo;</span>
                    )}
                  </label>
                  <input
                    id={`spec-fill-${s.key}`}
                    className="pk-input"
                    placeholder={s.label}
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
          </div>
        );
      })}

      {checklist.staleAnswers.length > 0 && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid #f0f1f4" }}>
          <div style={{ ...MUTED, marginBottom: 6 }}>
            These answers were written for a blank that is no longer in the library&apos;s text (or has moved), so they
            don&apos;t print.
          </div>
          {checklist.staleAnswers.map((key) => (
            <div key={key} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12.5, color: "#3a3f4a", marginBottom: 4 }}>
              <span>
                No longer used: {labels[key] ? <>&ldquo;{labels[key]}&rdquo; </> : null}
                <span style={{ fontFamily: "var(--font-mono)" }}>{key}</span> = {answers[key]}
              </span>
              {canEdit && (
                <button
                  type="button"
                  className="pk-btn-outline"
                  disabled={pending}
                  onClick={() => run(() => setSpecFillInAction(docId, key, ""))}
                >
                  Clear
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {(pending || err) && (
        <div style={{ marginTop: 10 }}>
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
