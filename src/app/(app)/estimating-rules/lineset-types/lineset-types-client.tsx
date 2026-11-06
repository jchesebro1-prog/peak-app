"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ConfirmButton } from "@/components/confirm-button";
import { PartPicker } from "@/app/(app)/design/grid/settings/equipment-map/part-picker";
import {
  DEFAULT_CABLE_ALLOWANCE_FT, LINESET_ROLES, LINESET_ROLE_NAMES, LINESET_ROLE_NOTES, RIGGING_LIMITS, isFootUnit, linesetTypeProblems, sanitizeLinesetType,
  type LinesetRole, type LinesetSource, type LinesetType,
} from "@/lib/rigging-config/types";
import { BTN, INPUT, LABEL, PRIMARY, PartLine, ROW, StatusChip, UnitWarning, day, type PartInfo } from "../rigging-ui";
import { deleteLinesetTypeAction, saveLinesetTypeAction } from "./actions";

type Assembly = { id: string; name: string };
type Draft = { id: string; name: string; manufacturer: string; parts: Partial<Record<LinesetRole, LinesetSource>>; allowanceFt: string; active: boolean };

const draftOf = (t: LinesetType | null): Draft =>
  t
    ? { id: t.id, name: t.name, manufacturer: t.manufacturer, parts: { ...t.parts }, allowanceFt: String(t.allowanceFt), active: t.active }
    : { id: "", name: "", manufacturer: "", parts: {}, allowanceFt: String(DEFAULT_CABLE_ALLOWANCE_FT), active: false };

function SourceLine({ source, parts, assemblies }: { source: LinesetSource | undefined; parts: Record<string, PartInfo>; assemblies: Assembly[] }) {
  if (!source) return <span style={{ color: "#a0442b" }}>Not mapped</span>;
  if (source.kind === "part") return <PartLine sku={source.sku} info={parts[source.sku]} />;
  const a = assemblies.find((x) => x.id === source.id);
  return a ? <span>Assembly: {a.name}</span> : <span style={{ color: "#a0442b" }}>Assembly no longer exists (counts as unmapped)</span>;
}

export default function LinesetTypesClient({ types, parts, assemblies }: { types: LinesetType[]; parts: Record<string, PartInfo>; assemblies: Assembly[] }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
        {open !== "new" && <button type="button" style={PRIMARY} onClick={() => setOpen("new")}>+ New lineset type</button>}
      </div>
      {open === "new" && (
        <section className="pk-card" style={{ padding: "14px 17px", marginBottom: 14 }}>
          <div style={{ fontSize: 14.5, fontWeight: 600 }}>New lineset type</div>
          <Editor type={null} parts={parts} assemblies={assemblies} onClose={() => setOpen(null)} />
        </section>
      )}
      {types.length === 0 && open !== "new" && (
        <div className="pk-card" style={{ padding: "40px 24px", textAlign: "center" }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>No lineset types yet</div>
          <div style={{ fontSize: 13, color: "#9aa0ab", marginTop: 6, lineHeight: 1.55 }}>Add a type (e.g. 1/4&quot; cable, 5/8&quot; hand line) and map each role. Nothing is mapped for you.</div>
        </div>
      )}
      {types.map((t) => (
        <section key={t.id} className="pk-card" style={{ padding: "14px 17px", marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 14.5, fontWeight: 650 }}>{t.name}</span>
            {t.manufacturer && <span style={{ fontSize: 12.5, color: "#737985" }}>{t.manufacturer}</span>}
            <StatusChip active={t.active} />
            <span style={{ flex: 1 }} />
            <button type="button" style={BTN} onClick={() => setOpen(open === t.id ? null : t.id)}>{open === t.id ? "Close" : "Edit"}</button>
          </div>
          <div style={{ fontSize: 12, color: "#5b616e", marginTop: 5 }}>Cable allowance {t.allowanceFt}&apos; per lift line</div>
          {open === t.id ? (
            <Editor type={t} parts={parts} assemblies={assemblies} onClose={() => setOpen(null)} />
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "minmax(150px, 210px) minmax(0, 1fr)", gap: "3px 12px", fontSize: 12, marginTop: 8 }}>
              {LINESET_ROLES.map((r) => (
                <div key={r} style={{ display: "contents" }}>
                  <div style={{ color: "#737985" }}>{LINESET_ROLE_NAMES[r]}</div>
                  <div style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}><SourceLine source={t.parts[r]} parts={parts} assemblies={assemblies} /></div>
                </div>
              ))}
            </div>
          )}
          {t.updatedBy && open !== t.id && <div style={{ fontSize: 10.5, color: "#aab0bb", marginTop: 8 }}>Last edited by {t.updatedBy} · {day(t.updatedAt)}</div>}
        </section>
      ))}
    </div>
  );
}

function Editor({ type, parts, assemblies, onClose }: { type: LinesetType | null; parts: Record<string, PartInfo>; assemblies: Assembly[]; onClose: () => void }) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(() => draftOf(type));
  const [known, setKnown] = useState<Record<string, PartInfo>>(parts);
  const [picking, setPicking] = useState<LinesetRole | null>(null);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const setSource = (role: LinesetRole, source: LinesetSource | null) =>
    setDraft((d) => {
      const next = { ...d.parts };
      if (source) next[role] = source;
      else delete next[role];
      return { ...d, parts: next };
    });

  const payload = { ...(draft.id ? { id: draft.id } : {}), name: draft.name, manufacturer: draft.manufacturer, parts: draft.parts, allowanceFt: draft.allowanceFt };
  const clean = sanitizeLinesetType({ ...payload, active: false });
  const problems = clean ? linesetTypeProblems(clean, { skus: new Set(Object.keys(known)), assemblyIds: new Set(assemblies.map((a) => a.id)) }) : ["Nothing to save."];
  const canActivate = problems.length === 0;
  const active = draft.active && canActivate;

  const save = () =>
    start(async () => {
      setError("");
      const r = await saveLinesetTypeAction({ ...payload, active });
      if (!r.ok) setError(r.error);
      else {
        onClose();
        router.refresh();
      }
    });

  return (
    <div style={{ borderTop: "1px solid #eef0f3", marginTop: 10, paddingTop: 12 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
        <label style={{ display: "block" }}>
          <div style={LABEL}>Name</div>
          <input value={draft.name} maxLength={RIGGING_LIMITS.name} placeholder={'e.g. 1/4" cable, 5/8" hand line'} onChange={(e) => set("name", e.target.value)} style={INPUT} />
        </label>
        <label style={{ display: "block" }}>
          <div style={LABEL}>Manufacturer</div>
          <input value={draft.manufacturer} maxLength={RIGGING_LIMITS.manufacturer} onChange={(e) => set("manufacturer", e.target.value)} style={INPUT} />
        </label>
        <label style={{ display: "block" }}>
          <div style={LABEL}>Cable allowance (ft per lift line)</div>
          <input type="number" min={0} step="any" value={draft.allowanceFt} onChange={(e) => set("allowanceFt", e.target.value)} style={INPUT} />
        </label>
      </div>

      <div style={{ ...LABEL, marginTop: 16 }}>Parts</div>
      <div style={{ display: "grid", gap: 6 }}>
        {LINESET_ROLES.map((role) => {
          const source = draft.parts[role];
          const perFoot = role === "cable" || role === "handLine";
          const badUnit = perFoot && source?.kind === "part" && known[source.sku] && !isFootUnit(known[source.sku].unit);
          return (
            <div key={role} style={ROW}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <span style={{ fontSize: 12.5, fontWeight: 650, minWidth: 130 }}>{LINESET_ROLE_NAMES[role]}</span>
                <span style={{ fontSize: 10.5, color: "#9aa0ab" }}>{LINESET_ROLE_NOTES[role]}</span>
                <span style={{ flex: 1, minWidth: 0, fontSize: 12 }}><SourceLine source={source} parts={known} assemblies={assemblies} /></span>
                <button type="button" style={BTN} onClick={() => setPicking(picking === role ? null : role)}>{picking === role ? "Done" : source ? "Change" : "Map"}</button>
                {source && <button type="button" style={BTN} onClick={() => setSource(role, null)}>Clear</button>}
              </div>
              {badUnit && <UnitWarning text={`This part sells by "${known[(source as { sku: string }).sku].unit}", but the configurator counts feet. Check the price.`} />}
              {picking === role && (
                <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
                  <PartPicker
                    sku={source?.kind === "part" ? source.sku : ""}
                    showSku={false}
                    onPick={(picked, hit) => {
                      setKnown((k) => ({ ...k, [picked]: { desc: hit.desc, cost: hit.cost, unit: hit.unit, mfr: "" } }));
                      setSource(role, { kind: "part", sku: picked });
                      setPicking(null);
                    }}
                  />
                  {assemblies.length > 0 && (
                    <select
                      aria-label={`${LINESET_ROLE_NAMES[role]} Hardware assembly`}
                      value={source?.kind === "assembly" ? source.id : ""}
                      onChange={(e) => {
                        setSource(role, e.target.value ? { kind: "assembly", id: e.target.value } : null);
                        setPicking(null);
                      }}
                      style={INPUT}
                    >
                      <option value="">Or pick a Hardware assembly…</option>
                      {assemblies.map((a) => (
                        <option key={a.id} value={a.id}>{a.name}</option>
                      ))}
                    </select>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, fontWeight: 600, marginTop: 14, color: canActivate ? "#16181d" : "#9aa0ab" }}>
        <input type="checkbox" checked={active} disabled={!canActivate} onChange={(e) => set("active", e.target.checked)} style={{ accentColor: "var(--accent)" }} />
        Active — offered in the lineset configurator
      </label>
      {!canActivate && <div style={{ fontSize: 11.5, color: "#8a6d1f", marginTop: 4 }}>Can&apos;t be active yet: {problems.join(" ")}</div>}

      {error && <div style={{ color: "#a0442b", fontSize: 12, marginTop: 8 }}>{error}</div>}
      <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center" }}>
        <button type="button" onClick={save} disabled={pending} style={PRIMARY}>{pending ? "Saving…" : type ? "Save type" : "Add type"}</button>
        <button type="button" onClick={onClose} style={BTN}>Cancel</button>
        <span style={{ flex: 1 }} />
        {type && (
          <ConfirmButton
            label="Delete type"
            confirmLabel="Delete this type?"
            pendingLabel="Deleting…"
            style={BTN}
            onConfirm={async () => {
              const r = await deleteLinesetTypeAction(type.id);
              if (!r.ok) setError(r.error);
              else {
                onClose();
                router.refresh();
              }
            }}
          />
        )}
      </div>
    </div>
  );
}
