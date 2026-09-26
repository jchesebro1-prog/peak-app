"use client";

import { useRef, useState, useTransition, type CSSProperties, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { CustomerCombobox, type CustomerComboboxOption } from "@/components/customer-combobox";
import type { SpecDocHeader, SpecDocSource, SpecDocument } from "@/lib/specs/spec-document";
import type { SpecChecklist } from "@/lib/specs/assemble-section";
import { setSpecCustomerAction, setSpecFillInAction, updateSpecHeaderAction } from "../builder-actions";

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
 */

export const CARD: CSSProperties = { padding: "16px 20px", marginBottom: 18 };
export const CARD_TITLE: CSSProperties = { fontSize: 14.5, fontWeight: 600, marginBottom: 4 };
export const CARD_SUB: CSSProperties = { fontSize: 12, color: "#8c919c", marginBottom: 14 };
export const MUTED: CSSProperties = { fontSize: 12, color: "#9aa0ab" };
export const ERR: CSSProperties = { fontSize: 12.5, color: "#b4543a" };

type ActionResult = { ok: true } | { ok: false; error: string };

/** Run one save; surface its error, refresh on success. */
function useSave() {
  const router = useRouter();
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<ActionResult>, onOk?: () => void) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) {
        setErr(r.error);
        return;
      }
      setErr("");
      onOk?.();
      router.refresh();
    });
  return { err, pending, run };
}

/** Enter in a one-line field commits it (blur → save) instead of doing nothing. */
function blurOnEnter(e: KeyboardEvent<HTMLInputElement>) {
  if (e.key === "Enter") e.currentTarget.blur();
}

export function sourceText(s: SpecDocSource): string {
  if (s.kind === "quote") return `From quote ${s.quoteId || s.id || ""}${s.label && s.label !== s.quoteId ? ` — ${s.label}` : ""}`;
  if (s.kind === "grid") return `From Grid design ${s.id || ""}${s.quoteId ? ` (quote ${s.quoteId})` : ""}`;
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
}: {
  doc: SpecDocument;
  customerOptions: CustomerComboboxOption[];
  canEdit: boolean;
}) {
  const { err, pending, run } = useSave();
  const [values, setValues] = useState<SpecDocHeader>(doc.header);
  // What the server last accepted — a blur with nothing changed saves nothing.
  const saved = useRef<SpecDocHeader>(doc.header);
  const [customerId, setCustomerId] = useState(doc.customerId || "");

  const commit = (key: keyof SpecDocHeader, value: string) => {
    if (!canEdit || value.trim() === (saved.current[key] || "")) return;
    run(
      () => updateSpecHeaderAction(doc.id, { [key]: value }),
      () => (saved.current = { ...saved.current, [key]: value.trim() })
    );
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
          <label className="pk-field-label" style={{ display: "block" }}>
            Customer
          </label>
          {canEdit ? (
            <>
              <CustomerCombobox options={customerOptions} value={customerId} onChange={pickCustomer} />
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
            <input className="pk-input" value={doc.customer || "—"} disabled readOnly />
          )}
        </div>
      </div>

      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginTop: 14 }}>
        <span style={MUTED}>Source: {sourceText(doc.source)}</span>
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
  checklist,
  canEdit,
}: {
  docId: string;
  answers: Record<string, string>;
  checklist: SpecChecklist;
  canEdit: boolean;
}) {
  const { err, pending, run } = useSave();
  const [values, setValues] = useState<Record<string, string>>(answers);
  const saved = useRef<Record<string, string>>(answers);

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
                  </label>
                  <input
                    id={`spec-fill-${s.key}`}
                    className="pk-input"
                    placeholder={s.label}
                    value={values[s.key] || ""}
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
            These answers match a blank that is no longer in the library&apos;s text, so they don&apos;t print.
          </div>
          {checklist.staleAnswers.map((key) => (
            <div key={key} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12.5, color: "#3a3f4a", marginBottom: 4 }}>
              <span>
                No longer used: <span style={{ fontFamily: "var(--font-mono)" }}>{key}</span> = {answers[key]}
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
