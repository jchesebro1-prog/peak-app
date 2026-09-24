"use client";

import { useState, type CSSProperties, type FormEvent } from "react";
import { useRouter } from "next/navigation";

type ActionResult = { ok: true } | { ok: false; error: string } | void;

/**
 * Shared "Apply template" control (D149, #118) — sits next to a record's
 * TasksCard on the project detail, quote builder, and design detail pages.
 * A plain server-action form (no client JS needed): pick one of the
 * template sets that apply to this record kind and submit. Renders nothing
 * when there are no applicable sets, so a fresh install with no templates
 * authored yet doesn't show a dead control.
 *
 * Each parent type owns its own thin action wrapper around
 * task-templates.ts's applyTaskTemplate() (projects/actions.ts,
 * estimator/actions.ts, design/designs/actions.ts) — same "each route keeps
 * its own use-server file" convention TasksCard's addAction/setStatusAction
 * props already follow.
 */
export function ApplyTemplateControl({
  parentField,
  parentId,
  templateSets,
  action,
}: {
  parentField: string;
  parentId: string;
  templateSets: { id: string; name: string }[];
  action: (formData: FormData) => ActionResult | Promise<ActionResult>;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  if (!templateSets.length) return null;

  const selectStyle: CSSProperties = {
    fontFamily: "var(--font-ui)",
    fontSize: 12,
    fontWeight: 500,
    color: "#3a3f4a",
    background: "#fff",
    border: "1px solid #e4e7ec",
    borderRadius: 7,
    padding: "6px 9px",
    cursor: "pointer",
  };

  return (
    <form
      onSubmit={async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const form = event.currentTarget;
        setError(null);
        const result = await action(new FormData(form));
        if (result && !result.ok) {
          setError(result.error);
          return;
        }
        router.refresh();
      }}
      style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}
    >
      {error && <div role="alert" style={{ flex: "1 0 100%", color: "#b4543a", fontSize: 11.5 }}>{error}</div>}
      <input type="hidden" name={parentField} value={parentId} />
      <select name="setId" defaultValue={templateSets[0].id} style={selectStyle}>
        {templateSets.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      <button
        type="submit"
        style={{
          fontFamily: "var(--font-ui)",
          fontSize: 12,
          fontWeight: 600,
          color: "#3a3f4a",
          background: "#f4f5f7",
          border: "1px solid #e4e7ec",
          borderRadius: 7,
          padding: "6px 11px",
          cursor: "pointer",
        }}
      >
        Apply template
      </button>
    </form>
  );
}
