"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ConfirmButton } from "@/components/confirm-button";
import { PartPicker } from "@/app/(app)/design/grid/settings/equipment-map/part-picker";
import { DEFAULT_PIPE_SPACING_FT, RIGGING_LIMITS, isFootUnit, pipeTypeProblems, sanitizePipeType, type PipeType } from "@/lib/rigging-config/types";
import { BTN, INPUT, LABEL, PRIMARY, PartLine, ROW, StatusChip, UnitWarning, day, type PartInfo } from "../rigging-ui";
import { deletePipeTypeAction, savePipeTypeAction } from "./actions";

type StickRow = { key: string; lengthFt: string; sku: string };
type Draft = { id: string; name: string; manufacturer: string; sticks: StickRow[]; spliceSku: string; clampSku: string; hangerSpacingFt: string; active: boolean };
type Picking = { kind: "stick"; key: string } | { kind: "splice" } | { kind: "clamp" } | null;

let seq = 0;
const stickRow = (lengthFt = "", sku = ""): StickRow => ({ key: `s${++seq}`, lengthFt, sku });

const draftOf = (t: PipeType | null): Draft =>
  t
    ? { id: t.id, name: t.name, manufacturer: t.manufacturer, sticks: t.sticks.map((s) => stickRow(String(s.lengthFt), s.sku)), spliceSku: t.spliceSku || "", clampSku: t.clampSku || "", hangerSpacingFt: String(t.hangerSpacingFt), active: t.active }
    : { id: "", name: "", manufacturer: "", sticks: [], spliceSku: "", clampSku: "", hangerSpacingFt: String(DEFAULT_PIPE_SPACING_FT), active: false };

export default function PipeTypesClient({ types, parts }: { types: PipeType[]; parts: Record<string, PartInfo> }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
        {open !== "new" && <button type="button" style={PRIMARY} onClick={() => setOpen("new")}>+ New pipe type</button>}
      </div>
      {open === "new" && (
        <section className="pk-card" style={{ padding: "14px 17px", marginBottom: 14 }}>
          <div style={{ fontSize: 14.5, fontWeight: 600 }}>New pipe type</div>
          <Editor type={null} parts={parts} onClose={() => setOpen(null)} />
        </section>
      )}
      {types.length === 0 && open !== "new" && (
        <div className="pk-card" style={{ padding: "40px 24px", textAlign: "center" }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>No pipe types yet</div>
          <div style={{ fontSize: 13, color: "#9aa0ab", marginTop: 6, lineHeight: 1.55 }}>Add a type (e.g. 1-1/2&quot; Sch 40 black), enter its stick lengths and map each part. Nothing is mapped for you.</div>
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
          <div style={{ fontSize: 12, color: "#5b616e", marginTop: 5 }}>
            {t.sticks.length ? t.sticks.map((s) => `${s.lengthFt}'`).join(", ") + " sticks" : "No sticks"} · hangers every {t.hangerSpacingFt}&apos;
          </div>
          {open === t.id ? (
            <Editor type={t} parts={parts} onClose={() => setOpen(null)} />
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "minmax(150px, 210px) minmax(0, 1fr)", gap: "3px 12px", fontSize: 12, marginTop: 8 }}>
              {t.sticks.map((s) => (
                <div key={s.lengthFt} style={{ display: "contents" }}>
                  <div style={{ color: "#737985" }}>Pipe {s.lengthFt}&apos; stick</div>
                  <div style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}><PartLine sku={s.sku} info={parts[s.sku]} /></div>
                </div>
              ))}
              <div style={{ color: "#737985" }}>Splice sleeve</div>
              <div>{t.spliceSku ? <PartLine sku={t.spliceSku} info={parts[t.spliceSku]} /> : <span style={{ color: "#9aa0ab" }}>Not mapped</span>}</div>
              <div style={{ color: "#737985" }}>Hanging clamp</div>
              <div><PartLine sku={t.clampSku || ""} info={t.clampSku ? parts[t.clampSku] : undefined} /></div>
            </div>
          )}
          {t.updatedBy && open !== t.id && <div style={{ fontSize: 10.5, color: "#aab0bb", marginTop: 8 }}>Last edited by {t.updatedBy} · {day(t.updatedAt)}</div>}
        </section>
      ))}
    </div>
  );
}

function Editor({ type, parts, onClose }: { type: PipeType | null; parts: Record<string, PartInfo>; onClose: () => void }) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(() => draftOf(type));
  const [known, setKnown] = useState<Record<string, PartInfo>>(parts);
  const [picking, setPicking] = useState<Picking>(null);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const setStick = (key: string, patch: Partial<StickRow>) => setDraft((d) => ({ ...d, sticks: d.sticks.map((s) => (s.key === key ? { ...s, ...patch } : s)) }));

  const payload = {
    ...(draft.id ? { id: draft.id } : {}),
    name: draft.name,
    manufacturer: draft.manufacturer,
    sticks: draft.sticks.map(({ lengthFt, sku }) => ({ lengthFt, sku })),
    spliceSku: draft.spliceSku,
    clampSku: draft.clampSku,
    hangerSpacingFt: draft.hangerSpacingFt,
  };
  const incomplete = draft.sticks.some((s) => !(Number(s.lengthFt) > 0) || !s.sku);
  const clean = sanitizePipeType({ ...payload, active: false });
  const problems = clean ? pipeTypeProblems(clean, new Set(Object.keys(known))) : ["Nothing to save."];
  const canActivate = problems.length === 0;
  const active = draft.active && canActivate;

  const save = () =>
    start(async () => {
      setError("");
      const r = await savePipeTypeAction({ ...payload, active });
      if (!r.ok) setError(r.error);
      else {
        onClose();
        router.refresh();
      }
    });

  const picker = (sku: string, onPick: (sku: string) => void) => (
    <div style={{ marginTop: 8 }}>
      <PartPicker
        sku={sku}
        showSku={false}
        onPick={(picked, hit) => {
          setKnown((k) => ({ ...k, [picked]: { desc: hit.desc, cost: hit.cost, unit: hit.unit, mfr: "" } }));
          onPick(picked);
          setPicking(null);
        }}
      />
    </div>
  );

  const roleRow = (label: string, need: string, kind: "splice" | "clamp", sku: string, field: "spliceSku" | "clampSku") => (
    <div style={ROW}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12.5, fontWeight: 650, minWidth: 170 }}>{label}</span>
        <span style={{ fontSize: 10.5, color: "#9aa0ab" }}>{need}</span>
        <span style={{ flex: 1, minWidth: 0, fontSize: 12 }}><PartLine sku={sku} info={known[sku]} /></span>
        <button type="button" style={BTN} onClick={() => setPicking(picking?.kind === kind ? null : { kind })}>{picking?.kind === kind ? "Done" : sku ? "Change" : "Map part"}</button>
        {sku && <button type="button" style={BTN} onClick={() => set(field, "")}>Clear</button>}
      </div>
      {picking?.kind === kind && picker(sku, (s) => set(field, s))}
    </div>
  );

  return (
    <div style={{ borderTop: "1px solid #eef0f3", marginTop: 10, paddingTop: 12 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
        <label style={{ display: "block" }}>
          <div style={LABEL}>Name</div>
          <input value={draft.name} maxLength={RIGGING_LIMITS.name} placeholder={'e.g. 1-1/2" Sch 40 black'} onChange={(e) => set("name", e.target.value)} style={INPUT} />
        </label>
        <label style={{ display: "block" }}>
          <div style={LABEL}>Manufacturer</div>
          <input value={draft.manufacturer} maxLength={RIGGING_LIMITS.manufacturer} onChange={(e) => set("manufacturer", e.target.value)} style={INPUT} />
        </label>
        <label style={{ display: "block" }}>
          <div style={LABEL}>Hanger spacing (ft)</div>
          <input type="number" min={0} step="any" value={draft.hangerSpacingFt} onChange={(e) => set("hangerSpacingFt", e.target.value)} style={INPUT} />
        </label>
      </div>

      <div style={{ ...LABEL, marginTop: 16 }}>Stick lengths</div>
      <div style={{ display: "grid", gap: 6 }}>
        {draft.sticks.map((st) => {
          const footed = st.sku && isFootUnit(known[st.sku]?.unit);
          return (
            <div key={st.key} style={ROW}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <input type="number" min={0} step="any" value={st.lengthFt} placeholder="ft" aria-label="Stick length (ft)" onChange={(e) => setStick(st.key, { lengthFt: e.target.value })} style={{ ...INPUT, width: 80 }} />
                <span style={{ fontSize: 12, color: "#8c919c" }}>ft</span>
                <span style={{ flex: 1, minWidth: 0, fontSize: 12 }}><PartLine sku={st.sku} info={known[st.sku]} /></span>
                <button type="button" style={BTN} onClick={() => setPicking(picking?.kind === "stick" && picking.key === st.key ? null : { kind: "stick", key: st.key })}>
                  {picking?.kind === "stick" && picking.key === st.key ? "Done" : st.sku ? "Change" : "Map part"}
                </button>
                <button type="button" style={BTN} aria-label="Remove this length" onClick={() => setDraft((d) => ({ ...d, sticks: d.sticks.filter((x) => x.key !== st.key) }))}>×</button>
              </div>
              {footed && <UnitWarning text="This part sells by the foot, but the configurator counts whole sticks. Check the price." />}
              {picking?.kind === "stick" && picking.key === st.key && picker(st.sku, (s) => setStick(st.key, { sku: s }))}
            </div>
          );
        })}
        {draft.sticks.length < RIGGING_LIMITS.sticks && (
          <div>
            <button type="button" style={BTN} onClick={() => setDraft((d) => ({ ...d, sticks: [...d.sticks, stickRow()] }))}>+ Add length</button>
          </div>
        )}
      </div>

      <div style={{ ...LABEL, marginTop: 16 }}>Parts</div>
      <div style={{ display: "grid", gap: 6 }}>
        {roleRow("Splice sleeve", "Needed once a run takes two sticks", "splice", draft.spliceSku, "spliceSku")}
        {roleRow("Hanging clamp", "Required", "clamp", draft.clampSku, "clampSku")}
      </div>

      <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, fontWeight: 600, marginTop: 14, color: canActivate ? "#16181d" : "#9aa0ab" }}>
        <input type="checkbox" checked={active} disabled={!canActivate} onChange={(e) => set("active", e.target.checked)} style={{ accentColor: "var(--accent)" }} />
        Active — offered in the pipe configurator
      </label>
      {!canActivate && <div style={{ fontSize: 11.5, color: "#8a6d1f", marginTop: 4 }}>Can&apos;t be active yet: {problems.join(" ")}</div>}

      {error && <div style={{ color: "#a0442b", fontSize: 12, marginTop: 8 }}>{error}</div>}
      <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center" }}>
        <button type="button" onClick={save} disabled={pending || incomplete} style={incomplete ? { ...PRIMARY, opacity: 0.5, cursor: "not-allowed" } : PRIMARY}>
          {pending ? "Saving…" : type ? "Save type" : "Add type"}
        </button>
        <button type="button" onClick={onClose} style={BTN}>Cancel</button>
        {incomplete && <span style={{ fontSize: 11.5, color: "#a0442b" }}>Finish or remove the incomplete stick length.</span>}
        <span style={{ flex: 1 }} />
        {type && (
          <ConfirmButton
            label="Delete type"
            confirmLabel="Delete this type?"
            pendingLabel="Deleting…"
            style={BTN}
            onConfirm={async () => {
              const r = await deletePipeTypeAction(type.id);
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
