"use client";

import { useState, useTransition, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { CustomerCombobox, type CustomerComboboxOption } from "@/components/customer-combobox";
import { SPEC_HEADER_MAX } from "@/lib/specs/spec-document";
import { createSpecDocumentAction } from "../builder-actions";
import { COMBO_INPUT } from "../[id]/header-fields";

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

/** Today in the browser's own time zone, YYYY-MM-DD — the default issue date. */
function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

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
  // The page already checked the source has equipment lines; if it changes
  // before Create (the quote was edited meanwhile), the owner can still
  // start from scratch instead of being stuck on the error (final fix 1).
  const [useSource, setUseSource] = useState(true);
  const [sourceFailed, setSourceFailed] = useState(false);
  const [pending, start] = useTransition();
  const activeSource = useSource ? source : null;

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
        issueDate: localToday(),
        ...(activeSource ? { source: activeSource } : {}),
      });
      if (!res.ok) {
        setErr(res.error);
        setSourceFailed("sourceFailed" in res && res.sourceFailed === true);
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
      {summary && activeSource && (
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
        <CustomerCombobox id="new-spec-customer" options={customerOptions} value={customerId} onChange={setCustomerId} inputStyle={COMBO_INPUT} />
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
          <input
            id="new-spec-project-name"
            className="pk-input"
            maxLength={SPEC_HEADER_MAX}
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
          />
        </div>
        <div style={FIELD}>
          <label style={LBL} htmlFor="new-spec-project-number">
            Project number
          </label>
          <input
            id="new-spec-project-number"
            className="pk-input"
            style={{ fontFamily: "var(--font-mono)" }}
            maxLength={SPEC_HEADER_MAX}
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
        {sourceFailed && activeSource && (
          <button
            type="button"
            className="pk-btn-outline"
            onClick={() => {
              setUseSource(false);
              setSourceFailed(false);
              setErr("");
            }}
          >
            Start from scratch instead
          </button>
        )}
      </div>
    </form>
  );
}
