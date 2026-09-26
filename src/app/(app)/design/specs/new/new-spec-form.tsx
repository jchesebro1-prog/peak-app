"use client";

import { useState, useTransition, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { CustomerCombobox, type CustomerComboboxOption } from "@/components/customer-combobox";
import { createSpecDocumentAction } from "../builder-actions";

/**
 * #205 Phase B (T5) — the New spec form. Section is the one required pick;
 * customer and project name/number are optional (the builder edits them
 * later too). Create → the builder.
 */

export type NewSpecSource = { kind: "quote"; quoteId: string } | { kind: "grid"; gridProjectId: string; quoteId: string };

const LBL: CSSProperties = {
  display: "block",
  fontSize: 10.5,
  fontWeight: 600,
  color: "#9aa0ab",
  letterSpacing: ".05em",
  textTransform: "uppercase",
  marginBottom: 5,
};
const FIELD: CSSProperties = { marginBottom: 14 };
const ERR: CSSProperties = { fontSize: 12.5, color: "#b4543a" };

export default function NewSpecForm({
  sections,
  customerOptions,
  source,
  summary,
  notice,
  defaultCustomerId,
  defaultProjectName,
}: {
  sections: Array<{ id: string; number: string; title: string }>;
  customerOptions: CustomerComboboxOption[];
  source: NewSpecSource | null;
  /** e.g. "From quote Q-2041 — only parts that belong to the section you pick are added." */
  summary: string;
  /** A source that didn't resolve, explained. */
  notice: string;
  defaultCustomerId: string;
  defaultProjectName: string;
}) {
  const router = useRouter();
  const [sectionId, setSectionId] = useState("");
  const [customerId, setCustomerId] = useState(defaultCustomerId);
  const [projectName, setProjectName] = useState(defaultProjectName);
  const [projectNumber, setProjectNumber] = useState("");
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();

  const create = () => {
    setErr("");
    if (!sectionId) {
      setErr("Pick a section.");
      return;
    }
    start(async () => {
      const res = await createSpecDocumentAction({
        sectionId,
        customerId: customerId || undefined,
        projectName,
        projectNumber,
        ...(source ? { source } : {}),
      });
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      router.push(`/design/specs/${encodeURIComponent(res.id)}`);
    });
  };

  return (
    <form
      className="pk-card"
      style={{ padding: 20 }}
      onSubmit={(e) => {
        e.preventDefault();
        create();
      }}
    >
      {summary && (
        <div style={{ fontSize: 13, color: "#3a3f4a", background: "#fafbfc", border: "1px solid #f0f1f4", borderRadius: 9, padding: "9px 12px", marginBottom: 16 }}>
          {summary}
        </div>
      )}
      {notice && (
        <div style={{ fontSize: 13, color: "#8a6d1f", background: "#fbf3dd", border: "1px solid #f0e2bd", borderRadius: 9, padding: "9px 12px", marginBottom: 16 }}>
          {notice}
        </div>
      )}

      <div style={FIELD}>
        <label style={LBL} htmlFor="new-spec-section">
          Section
        </label>
        <select id="new-spec-section" className="pk-input" required value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
          <option value="">— Pick a section —</option>
          {sections.map((s) => (
            <option key={s.id} value={s.id}>
              {s.number} · {s.title}
            </option>
          ))}
        </select>
      </div>

      <div style={FIELD}>
        <label style={LBL} htmlFor="new-spec-customer">
          Customer (optional)
        </label>
        <CustomerCombobox id="new-spec-customer" options={customerOptions} value={customerId} onChange={setCustomerId} />
        {customerId && (
          <button
            type="button"
            onClick={() => setCustomerId("")}
            style={{ background: "none", border: "none", padding: 0, marginTop: 6, color: "#8c919c", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
          >
            Clear customer
          </button>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,2fr) minmax(0,1fr)", gap: 12 }}>
        <div style={FIELD}>
          <label style={LBL} htmlFor="new-spec-project-name">
            Project name
          </label>
          <input id="new-spec-project-name" className="pk-input" value={projectName} onChange={(e) => setProjectName(e.target.value)} />
        </div>
        <div style={FIELD}>
          <label style={LBL} htmlFor="new-spec-project-number">
            Project number
          </label>
          <input
            id="new-spec-project-number"
            className="pk-input"
            style={{ fontFamily: "var(--font-mono)" }}
            value={projectNumber}
            onChange={(e) => setProjectNumber(e.target.value)}
          />
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <button type="submit" className="pk-btn-accent" disabled={pending}>
          {pending ? "Creating…" : "Create spec"}
        </button>
        {err && (
          <span role="alert" style={ERR}>
            {err}
          </span>
        )}
      </div>
    </form>
  );
}
