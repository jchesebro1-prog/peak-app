"use client";

/* Pick-list admin (#337 Task 11): per list, the built-in values (read-only), the added values with Retire /
   Restore, and an Add box. The server actions answer with a sentence on a refusal. */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { PickListAdminRow } from "@/lib/assessments/integration";
import { addPicklistValueAction, setPicklistRetiredAction } from "./actions";

const chip = (retired = false): React.CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  fontSize: 12,
  padding: "3px 10px",
  borderRadius: 20,
  color: retired ? "#9aa0ab" : "#3a3f4a",
  background: retired ? "#fafbfc" : "#f1f2f5",
  border: "1px solid #e4e7ec",
});

function ListCard({ row }: { row: PickListAdminRow }) {
  const router = useRouter();
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>, then?: () => void) => {
    setError(null);
    startTransition(async () => {
      try {
        const r = await fn();
        if (!r.ok) setError(r.error);
        else {
          then?.();
          router.refresh();
        }
      } catch {
        setError("That needs a connection. Try again.");
      }
    });
  };

  return (
    <section className="pk-card" style={{ padding: 0, overflow: "hidden", marginBottom: 16 }} aria-label={row.title}>
      <div style={{ padding: "13px 18px 11px", borderBottom: "1px solid #f0f1f4" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 9, flexWrap: "wrap" }}>
          <span style={{ fontSize: 14.5, fontWeight: 600 }}>{row.title}</span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "#9aa0ab" }}>{row.id}</span>
        </div>
        {row.usedBy.length > 0 && (
          <div style={{ fontSize: 11.5, color: "#8c919c", marginTop: 3 }}>
            Used by {row.usedBy.slice(0, 3).join("; ")}
            {row.usedBy.length > 3 ? ` and ${row.usedBy.length - 3} more` : ""}
          </div>
        )}
      </div>
      <div style={{ padding: "12px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
        <div>
          <div className="pk-field-label">Built in</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {row.builtIn.map((o) => (
              <span key={o.value} style={chip()} title={o.value}>
                {o.label}
              </span>
            ))}
          </div>
        </div>
        <div>
          <div className="pk-field-label">Added here</div>
          {row.added.length === 0 ? (
            <div style={{ fontSize: 12.5, color: "#9aa0ab" }}>Nothing added yet.</div>
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {row.added.map((o) => (
                <span key={o.value} style={chip(o.retired)} title={o.value}>
                  <span style={o.retired ? { textDecoration: "line-through" } : undefined}>{o.label}</span>
                  {o.retired && <span style={{ fontSize: 10.5 }}>(retired)</span>}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => run(() => setPicklistRetiredAction(row.id, o.value, !o.retired))}
                    style={{ background: "none", border: 0, padding: 0, font: "inherit", fontSize: 11.5, fontWeight: 600, color: "var(--accent)", cursor: "pointer" }}
                  >
                    {o.retired ? "Restore" : "Retire"}
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!label.trim()) return;
            run(
              () => addPicklistValueAction(row.id, label),
              () => setLabel("")
            );
          }}
          style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}
        >
          <input
            className="pk-input"
            aria-label={`Add a choice to ${row.title}`}
            placeholder="New choice"
            maxLength={80}
            value={label}
            disabled={busy}
            onChange={(e) => setLabel(e.target.value)}
            style={{ width: 240, maxWidth: "100%" }}
          />
          <button type="submit" className="pk-btn-accent" style={{ padding: "7px 14px" }} disabled={busy || !label.trim()}>
            {busy ? "Saving…" : "Add"}
          </button>
          {error && (
            <span role="alert" style={{ fontSize: 12.5, color: "#8c3b26" }}>
              {error}
            </span>
          )}
        </form>
      </div>
    </section>
  );
}

export default function PickListAdmin({ rows }: { rows: PickListAdminRow[] }) {
  return (
    <>
      {rows.map((r) => (
        <ListCard key={r.id} row={r} />
      ))}
    </>
  );
}
