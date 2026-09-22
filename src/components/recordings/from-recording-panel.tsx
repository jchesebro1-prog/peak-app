"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type CSSProperties } from "react";
import { insertPrefillAction } from "@/app/(app)/recordings/actions";

/**
 * "From recording" panel (Recordings spec §4.4) — inside the Survey and
 * Inspection capture editors, one per READY recording on the record: every
 * routed summary section with its target field and an Insert button.
 * Insert-on-tap only — nothing is written until the button is pressed, and
 * a row greys once its key is in `prefill.insertedKeys`.
 *
 * Pure presentation over server-built data: the page computes `sections`
 * with `loadPrefillPanels()` (app/(app)/recordings/data.ts —
 * summarySectionsWithKeys + routePrefill) because the recordings store and
 * write-back modules cannot reach a client bundle. Insert calls the
 * existing `insertPrefillAction` (which resolves the target record itself)
 * and then `router.refresh()` so the editor receives the updated record.
 *
 * The editors keep a local draft, so they pass `disabled` while dirty (an
 * insert into the saved record would otherwise be overwritten by the next
 * Save) and use `onInserted` to adopt the refreshed record.
 */

export type PrefillRouteView = {
  kind: "map" | "text" | "skip";
  field: string;
  mapKey?: string;
};

export type FromRecordingSection = {
  key: string;
  title: string;
  description: string;
  route: PrefillRouteView;
  inserted: boolean;
};

/** One panel's worth of server-built data (the recording + its routed sections). */
export type FromRecordingPanelData = {
  recordingId: string;
  title: string;
  sections: FromRecordingSection[];
};

const FIELD_LABEL: Record<string, string> = {
  notes: "Generic notes",
  scopeOfWork: "Scope of work",
  measurements: "Measurements",
  narrative: "Condition narrative",
  venueInfo: "Venue information",
};

function routeLabel(route: PrefillRouteView): string {
  const base = FIELD_LABEL[route.field] ?? route.field;
  return route.kind === "map" && route.mapKey ? `${base} · ${route.mapKey}` : base;
}

const PREVIEW_CHARS = 140;

function preview(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > PREVIEW_CHARS ? t.slice(0, PREVIEW_CHARS).trimEnd() + "…" : t;
}

export function FromRecordingPanel({
  recordingId,
  title,
  target,
  sections,
  disabled = false,
  disabledHint,
  onInserted,
  style,
}: {
  recordingId: string;
  /** the recording's title — the <details> heading. */
  title?: string;
  target: "survey" | "inspection";
  sections: FromRecordingSection[];
  /** editor has unsaved changes — Insert would be overwritten by the next Save. */
  disabled?: boolean;
  disabledHint?: string;
  /** fired after a successful insert, before router.refresh(). */
  onInserted?: (sectionKey: string) => void;
  style?: CSSProperties;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [doneLocal, setDoneLocal] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);

  const rows = sections.filter((s) => s.route.kind !== "skip");
  if (rows.length === 0) return null;

  const targetLabel = target === "inspection" ? "inspection" : "survey";
  const remaining = rows.filter((s) => !s.inserted && !doneLocal.has(s.key)).length;

  function insert(key: string) {
    if (pending || disabled) return;
    setError(null);
    setBusyKey(key);
    startTransition(async () => {
      const r = await insertPrefillAction(recordingId, key);
      setBusyKey(null);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setDoneLocal((prev) => new Set(prev).add(key));
      onInserted?.(key);
      router.refresh();
    });
  }

  return (
    <details
      style={{
        background: "#fff",
        border: "1px solid #ececf0",
        borderRadius: 12,
        boxShadow: "0 1px 2px rgba(0,0,0,.04)",
        padding: "0 14px",
        ...style,
      }}
    >
      <summary
        style={{
          cursor: "pointer",
          listStyle: "none",
          display: "flex",
          alignItems: "center",
          gap: 9,
          padding: "11px 0",
          fontSize: 12.5,
          fontWeight: 600,
          color: "#16181d",
        }}
      >
        <span style={{ fontSize: 11, fontWeight: 600, color: "#9aa0ab", letterSpacing: ".05em", textTransform: "uppercase", flexShrink: 0 }}>
          From recording
        </span>
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {title || recordingId}
        </span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: remaining ? "#5b616e" : "#aab0bb", flexShrink: 0 }}>
          {remaining ? `${remaining} to insert` : "all inserted"}
        </span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "#aab0bb", flexShrink: 0 }}>{recordingId}</span>
      </summary>

      <div style={{ borderTop: "1px solid #f3f4f7", paddingBottom: 6 }}>
        {disabled && disabledHint && (
          <div style={{ fontSize: 11.5, color: "#8a6d1f", background: "#fbf3dd", border: "1px solid #f0e2bd", borderRadius: 8, padding: "7px 10px", margin: "10px 0 4px" }}>
            {disabledHint}
          </div>
        )}
        {rows.map((s) => {
          const done = s.inserted || doneLocal.has(s.key);
          const busy = busyKey === s.key && pending;
          return (
            <div
              key={s.key}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
                padding: "9px 0",
                borderTop: "1px solid #f3f4f7",
                opacity: done ? 0.55 : 1,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: "#16181d", lineHeight: 1.3 }}>{s.title}</div>
                {s.description.trim() && (
                  <div style={{ fontSize: 12, color: "#5b616e", lineHeight: 1.45, marginTop: 2 }}>{preview(s.description)}</div>
                )}
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "#8c919c", marginTop: 4 }}>→ {routeLabel(s.route)}</div>
              </div>
              <button
                type="button"
                disabled={done || busy || pending || disabled}
                onClick={() => insert(s.key)}
                title={
                  done
                    ? "Already inserted"
                    : disabled
                      ? disabledHint || "Save your changes first"
                      : `Append to the ${targetLabel}'s ${routeLabel(s.route)}`
                }
                style={{
                  flexShrink: 0,
                  fontSize: 11,
                  fontWeight: 600,
                  padding: "5px 10px",
                  borderRadius: 7,
                  minHeight: 28,
                  cursor: done || disabled || pending ? "default" : "pointer",
                  color: done ? "#aab0bb" : "color-mix(in srgb, var(--accent) 70%, #000)",
                  background: done ? "#f8f9fb" : "color-mix(in srgb, var(--accent) 8%, #fff)",
                  border: `1px solid ${done ? "#eef0f3" : "color-mix(in srgb, var(--accent) 30%, #fff)"}`,
                  opacity: !done && disabled ? 0.6 : 1,
                }}
              >
                {done ? "Inserted" : busy ? "Inserting…" : "Insert"}
              </button>
            </div>
          );
        })}
        {error && (
          <div style={{ fontSize: 12, color: "#b4543a", background: "#f9ece8", border: "1px solid #f0d6cd", borderRadius: 8, padding: "8px 10px", margin: "6px 0 8px" }}>
            {error}
          </div>
        )}
      </div>
    </details>
  );
}
