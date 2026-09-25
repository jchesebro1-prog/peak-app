"use client";

import { useState, useTransition } from "react";
import type { CSSProperties } from "react";
import type { TaskTemplateLine, TaskTemplateSetRecord } from "@/lib/stores/task-templates";
import { TEMPLATE_RECORD_LABEL, TEMPLATE_RECORD_KINDS, type TemplateRecordKind } from "@/lib/task-template-kinds";
import type { Role } from "@/lib/team";
import { archiveTaskTemplateSetAction, deleteTaskTemplateSetAction, saveTaskTemplateSetAction } from "./actions";
import { ConfirmButton } from "@/components/confirm-button";

/**
 * Admin editor for task-template sets (D149, #118). Whole-record editing —
 * a set's name/description/appliesTo/lines all live in one piece of local
 * state per card, only reaching the server on "Save" (mirrors design/
 * assemblies' AssemblyBuilder: build up the shape client-side, save the
 * whole thing at once, rather than a form-per-field round trip for what is
 * fundamentally one small document).
 *
 * A line's assignment target is a discriminated union (person/role/team —
 * see task-templates.ts's module doc comment for why "team" fans out to
 * every active user rather than a real department/crew grouping, which
 * doesn't exist in this data model). `localKey` is a client-only React key
 * for not-yet-saved sets/lines; it's never sent to the server — a set's
 * real `id` (or `null` for "not created yet") is what actions.ts persists,
 * and a line's own stable `key` (what applyTaskTemplate's coverage-key dedup
 * keys off) is separate and editable-but-should-rarely-change once applied.
 */

type EditableLine = TaskTemplateLine & { localKey: string };
type EditableSet = Omit<TaskTemplateSetRecord, "lines"> & { localKey: string; lines: EditableLine[] };

const input: CSSProperties = { width: "100%", border: "1px solid #dfe2e8", borderRadius: 8, padding: "9px 10px", font: "inherit", fontSize: 13 };
const label: CSSProperties = { fontSize: 11, fontWeight: 600, color: "#8c919c", letterSpacing: ".03em", textTransform: "uppercase", marginBottom: 5, display: "block" };
const btn: CSSProperties = { fontSize: 12.5, fontWeight: 600, borderRadius: 8, padding: "8px 14px", cursor: "pointer", fontFamily: "var(--font-ui)" };
const primaryBtn: CSSProperties = { ...btn, color: "#fff", background: "var(--accent)", border: "none" };
const ghostBtn: CSSProperties = { ...btn, color: "#5b616e", background: "#fff", border: "1px solid #e4e7ec" };
const dangerBtn: CSSProperties = { ...btn, color: "#a0442b", background: "#fff", border: "1px solid #e4e7ec" };

function rid(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** Display label for a stored (lowercased) discipline — "av" -> "AV",
 *  everything else title-cased on its first letter only, since the
 *  vocabulary is admin-free-text and may not match any known acronym. */
function disciplineLabel(d: string): string {
  return d.length <= 2 ? d.toUpperCase() : d.charAt(0).toUpperCase() + d.slice(1);
}

function blankLine(): EditableLine {
  return {
    // #145 — phase/discipline/startPct/lengthPct match normalizeLine's own
    // defaults (blank phase never expands on a consulting target until one
    // is picked below; 0/100 covers the whole phase window), so a
    // never-touched line reads back identically to one saved this way.
    localKey: rid(), key: rid(), title: "", section: "", target: { kind: "team" },
    phase: "", discipline: "", startPct: 0, lengthPct: 100,
  };
}

function blankSet(): EditableSet {
  const at = Date.now();
  return {
    id: "", localKey: rid(), name: "", description: "", appliesTo: [],
    lines: [], archived: false, createdBy: "", createdAt: at, updatedAt: at,
  };
}

function toEditable(s: TaskTemplateSetRecord): EditableSet {
  return { ...s, localKey: s.id, lines: s.lines.map((l) => ({ ...l, localKey: rid() })) };
}

export default function TemplateSetsClient({
  initial,
  people,
  roles,
  phaseMenu,
  disciplineMenu,
}: {
  initial: TaskTemplateSetRecord[];
  people: { id: string; name: string }[];
  roles: readonly string[];
  /** #145 D165 — the consulting phase/discipline menus, computed server-side
   *  (settings + engagements are both DB-backed store modules — this file
   *  must never import them itself; see the 763febd note above). */
  phaseMenu: string[];
  disciplineMenu: string[];
}) {
  const [sets, setSets] = useState<EditableSet[]>(() => initial.map(toEditable));
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<Record<string, string>>({});

  const patchSet = (localKey: string, change: Partial<EditableSet>) =>
    setSets((all) => all.map((s) => (s.localKey === localKey ? { ...s, ...change } : s)));

  const patchLine = (setKey: string, lineKey: string, change: Partial<EditableLine>) =>
    setSets((all) =>
      all.map((s) =>
        s.localKey === setKey
          ? { ...s, lines: s.lines.map((l) => (l.localKey === lineKey ? { ...l, ...change } : l)) }
          : s
      )
    );

  const addLine = (setKey: string) =>
    setSets((all) => all.map((s) => (s.localKey === setKey ? { ...s, lines: [...s.lines, blankLine()] } : s)));

  const removeLine = (setKey: string, lineKey: string) =>
    setSets((all) =>
      all.map((s) => (s.localKey === setKey ? { ...s, lines: s.lines.filter((l) => l.localKey !== lineKey) } : s))
    );

  const toggleAppliesTo = (setKey: string, kind: TemplateRecordKind) =>
    setSets((all) =>
      all.map((s) =>
        s.localKey === setKey
          ? { ...s, appliesTo: s.appliesTo.includes(kind) ? s.appliesTo.filter((k) => k !== kind) : [...s.appliesTo, kind] }
          : s
      )
    );

  const addNew = () => setSets((all) => [blankSet(), ...all]);

  const save = (setKey: string) => {
    const s = sets.find((x) => x.localKey === setKey);
    if (!s) return;
    startTransition(async () => {
      const result = await saveTaskTemplateSetAction({
        id: s.id || null,
        name: s.name,
        description: s.description,
        appliesTo: s.appliesTo,
        lines: s.lines.map((l) => ({
          key: l.key, title: l.title, section: l.section, target: l.target,
          phase: l.phase, discipline: l.discipline, startPct: l.startPct, lengthPct: l.lengthPct,
        })),
      });
      if (!result.ok) {
        setStatus((m) => ({ ...m, [setKey]: result.error }));
        return;
      }
      setStatus((m) => ({ ...m, [setKey]: "Saved." }));
      setSets((all) => all.map((x) => (x.localKey === setKey ? toEditable(result.record) : x)));
    });
  };

  const archive = (setKey: string, archived: boolean) => {
    const s = sets.find((x) => x.localKey === setKey);
    if (!s || !s.id) return;
    startTransition(async () => {
      const result = await archiveTaskTemplateSetAction(s.id, archived);
      if (result.ok) setSets((all) => all.map((x) => (x.localKey === setKey ? toEditable(result.record) : x)));
    });
  };

  const remove = (setKey: string) => {
    const s = sets.find((x) => x.localKey === setKey);
    if (!s) return;
    if (!s.id) {
      setSets((all) => all.filter((x) => x.localKey !== setKey));
      return;
    }
    startTransition(async () => {
      const result = await deleteTaskTemplateSetAction(s.id);
      if (result.ok) setSets((all) => all.filter((x) => x.localKey !== setKey));
    });
  };

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <button onClick={addNew} style={primaryBtn}>
          + New template set
        </button>
      </div>

      {sets.length === 0 && (
        <div className="pk-card" style={{ padding: "32px 20px", textAlign: "center", color: "#9aa0ab", fontSize: 13 }}>
          No task templates yet. Start one above.
        </div>
      )}

      {sets.map((s) => (
        <div key={s.localKey} className="pk-card" style={{ padding: 16, marginBottom: 14, opacity: s.archived ? 0.6 : 1 }}>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 3fr", gap: 12, marginBottom: 12 }}>
            <div>
              <span style={label}>Name</span>
              <input
                style={input}
                value={s.name}
                placeholder="e.g. Standard install checklist"
                onChange={(e) => patchSet(s.localKey, { name: e.target.value })}
              />
            </div>
            <div>
              <span style={label}>Description</span>
              <input
                style={input}
                value={s.description}
                placeholder="Optional — shown to whoever picks a template to apply"
                onChange={(e) => patchSet(s.localKey, { description: e.target.value })}
              />
            </div>
          </div>

          <div style={{ marginBottom: 14 }}>
            <span style={label}>Applies to</span>
            <div style={{ display: "flex", gap: 14 }}>
              {TEMPLATE_RECORD_KINDS.map((kind) => (
                <label key={kind} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                  <input
                    type="checkbox"
                    checked={s.appliesTo.includes(kind)}
                    onChange={() => toggleAppliesTo(s.localKey, kind)}
                  />
                  {TEMPLATE_RECORD_LABEL[kind]}
                </label>
              ))}
            </div>
          </div>

          <span style={label}>Lines</span>
          {s.lines.length === 0 && (
            <div style={{ fontSize: 12.5, color: "#9aa0ab", marginBottom: 8 }}>No lines yet.</div>
          )}
          {s.lines.map((l) => (
            <div
              key={l.localKey}
              style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}
            >
              <input
                style={{ ...input, flex: "2 1 200px" }}
                value={l.title}
                placeholder="Task title"
                onChange={(e) => patchLine(s.localKey, l.localKey, { title: e.target.value })}
              />
              <input
                style={{ ...input, flex: "1 1 110px" }}
                value={l.section}
                placeholder="Section"
                onChange={(e) => patchLine(s.localKey, l.localKey, { section: e.target.value })}
              />
              <select
                title="Phase — must match the engagement's phase menu to expand (D165)"
                style={{ ...input, flex: "1 1 140px" }}
                value={l.phase}
                onChange={(e) => patchLine(s.localKey, l.localKey, { phase: e.target.value })}
              >
                <option value="">— phase —</option>
                {phaseMenu.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
              <select
                title="Discipline — blank matches every discipline the engagement bought (D165)"
                style={{ ...input, flex: "1 1 140px" }}
                value={l.discipline}
                onChange={(e) => patchLine(s.localKey, l.localKey, { discipline: e.target.value })}
              >
                <option value="">All disciplines</option>
                {disciplineMenu.map((d) => (
                  <option key={d} value={d}>
                    {disciplineLabel(d)}
                  </option>
                ))}
              </select>
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ fontSize: 11, color: "#9aa0ab" }}>Start%</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  title="Position within the phase window, 0–100 (D166)"
                  style={{ ...input, width: 60, flex: "0 0 auto" }}
                  value={l.startPct}
                  onChange={(e) => patchLine(s.localKey, l.localKey, { startPct: Number(e.target.value) || 0 })}
                />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ fontSize: 11, color: "#9aa0ab" }}>Len%</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  title="Length within the phase window, 0–100 (D166)"
                  style={{ ...input, width: 60, flex: "0 0 auto" }}
                  value={l.lengthPct}
                  onChange={(e) => patchLine(s.localKey, l.localKey, { lengthPct: Number(e.target.value) || 0 })}
                />
              </div>
              <select
                style={{ ...input, flex: "1 1 110px" }}
                value={l.target.kind}
                onChange={(e) => {
                  const kind = e.target.value as "person" | "role" | "team";
                  if (kind === "team") patchLine(s.localKey, l.localKey, { target: { kind: "team" } });
                  else if (kind === "role") patchLine(s.localKey, l.localKey, { target: { kind: "role", role: roles[0] as Role } });
                  else patchLine(s.localKey, l.localKey, { target: { kind: "person", userId: people[0]?.id || "" } });
                }}
              >
                <option value="team">Everyone</option>
                <option value="role">Role</option>
                <option value="person">Person</option>
              </select>
              {l.target.kind === "role" && (
                <select
                  style={{ ...input, flex: "1 1 110px" }}
                  value={l.target.role}
                  onChange={(e) => patchLine(s.localKey, l.localKey, { target: { kind: "role", role: e.target.value as Role } })}
                >
                  {roles.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              )}
              {l.target.kind === "person" && (
                <select
                  style={{ ...input, flex: "1 1 140px" }}
                  value={l.target.userId}
                  onChange={(e) => patchLine(s.localKey, l.localKey, { target: { kind: "person", userId: e.target.value } })}
                >
                  {people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              )}
              <button onClick={() => removeLine(s.localKey, l.localKey)} style={dangerBtn}>
                Remove
              </button>
            </div>
          ))}
          <button onClick={() => addLine(s.localKey)} style={{ ...ghostBtn, marginTop: 4, marginBottom: 14 }}>
            + Add line
          </button>

          <div style={{ display: "flex", alignItems: "center", gap: 10, borderTop: "1px solid #f0f1f4", paddingTop: 12 }}>
            <button onClick={() => save(s.localKey)} disabled={pending} style={primaryBtn}>
              Save
            </button>
            {s.id && (
              <button onClick={() => archive(s.localKey, !s.archived)} disabled={pending} style={ghostBtn}>
                {s.archived ? "Unarchive" : "Archive"}
              </button>
            )}
            <ConfirmButton
              label="Delete"
              confirmLabel="Confirm delete"
              disabled={pending}
              className=""
              style={dangerBtn}
              onConfirm={() => remove(s.localKey)}
            />
            {status[s.localKey] && (
              <span style={{ fontSize: 12, color: status[s.localKey] === "Saved." ? "#1f7a52" : "#b4543a" }}>
                {status[s.localKey]}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
