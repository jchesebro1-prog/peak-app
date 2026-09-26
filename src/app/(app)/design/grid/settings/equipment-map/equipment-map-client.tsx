"use client";

import { useRef, useState, useTransition, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { ConfirmButton } from "@/components/confirm-button";
import type { TierKey } from "@/app/(app)/design/quick/engine";
import type { EquipCellInput, EquipRowInput, EquipRowStatus } from "@/lib/design/equipment-map";
import type { AssemblyOption, EquipCellVM, EquipRowVM } from "@/lib/design/equipment-map-view";
import {
  clearEquipmentRowAction,
  saveEquipmentRowAction,
  searchEquipmentPartsAction,
  suggestEquipmentPartsAction,
  type EquipPartHit,
} from "../actions";

const TIERS: Array<{ key: TierKey; label: string }> = [
  { key: "good", label: "Good" },
  { key: "better", label: "Better" },
  { key: "best", label: "Best" },
];
const STATUS: Record<EquipRowStatus, { label: string; ink: string; bg: string }> = {
  mapped: { label: "Mapped", ink: "#1f7a52", bg: "#eaf6ef" },
  allowance: { label: "Allowance", ink: "#8a6d1f", bg: "#fbf3dd" },
  "needs-part": { label: "Needs a part", ink: "#a0442b", bg: "#fbeae5" },
};
const INPUT: CSSProperties = { width: "100%", boxSizing: "border-box", border: "1px solid #e4e7ec", borderRadius: 7, padding: "7px 9px", fontSize: 12.5, fontFamily: "inherit", background: "#fff" };
const BTN: CSSProperties = { border: "1px solid #dfe2e8", background: "#fff", borderRadius: 7, padding: "6px 11px", fontSize: 12, fontWeight: 600, color: "#3d424e", cursor: "pointer", fontFamily: "inherit" };
const LABEL: CSSProperties = { fontSize: 10, fontWeight: 700, color: "#9aa0ab", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 5 };
const money = (n: number | null | undefined) => (n == null ? "—" : "$" + n.toLocaleString("en-US", { maximumFractionDigits: 2 }));
const day = (ts?: number) => (ts ? new Date(ts).toISOString().slice(0, 10) : "");

type Filter = "all" | EquipRowStatus;

export default function EquipmentMapClient({
  rows,
  assemblies,
  summary,
}: {
  rows: EquipRowVM[];
  assemblies: AssemblyOption[];
  summary: Record<EquipRowStatus, number>;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<string | null>(null);
  const shown = rows.filter((r) => filter === "all" || r.status === filter);
  const groups: Array<[string, EquipRowVM[]]> = [];
  for (const r of shown) {
    const g = groups.find(([label]) => label === r.systemLabel);
    if (g) g[1].push(r);
    else groups.push([r.systemLabel, [r]]);
  }
  const chip = (key: Filter, label: string, n: number) => (
    <button
      key={key}
      type="button"
      onClick={() => setFilter(key)}
      style={{ ...BTN, background: filter === key ? "#16181d" : "#fff", color: filter === key ? "#fff" : "#3d424e" }}
    >
      {label} · {n}
    </button>
  );

  return (
    <div>
      <section className="pk-card" style={{ padding: "15px 17px", marginBottom: 14 }}>
        <div style={{ fontSize: 13, color: "#5b616e", lineHeight: 1.55 }}>
          Map every equation item to a catalog part or an assembly for each tier. Auto uses only <b>Mapped</b> and
          confirmed <b>Allowance</b> rows; <b>Needs a part</b> rows are left off Auto plans and listed on the Equipment step.
          Nothing is mapped for you — each row shows the figure the old equations assumed, for reference only.
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 12 }}>
          {chip("all", "All", rows.length)}
          {chip("needs-part", "Needs a part", summary["needs-part"])}
          {chip("allowance", "Allowance", summary.allowance)}
          {chip("mapped", "Mapped", summary.mapped)}
        </div>
      </section>

      {groups.map(([label, list]) => (
        <section key={label} className="pk-card" style={{ padding: "14px 17px", marginBottom: 14 }}>
          <div style={{ fontSize: 14.5, fontWeight: 600, marginBottom: 8 }}>{label}</div>
          <div style={{ display: "grid", gap: 8 }}>
            {list.map((r) => (
              <div key={r.key} id={`row-${r.key.replace(":", "-")}`} style={{ border: "1px solid #eef0f3", borderRadius: 10, padding: "10px 12px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 13, fontWeight: 650 }}>{r.label}</span>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "#9aa0ab" }}>{r.key} · per {r.unit}</span>
                  <span style={{ fontSize: 10.5, fontWeight: 700, color: STATUS[r.status].ink, background: STATUS[r.status].bg, borderRadius: 999, padding: "2px 8px" }}>
                    {STATUS[r.status].label}
                  </span>
                  <span style={{ flex: 1 }} />
                  <button type="button" onClick={() => setOpen(open === r.key ? null : r.key)} style={BTN}>
                    {open === r.key ? "Close" : "Edit"}
                  </button>
                </div>
                {r.hint && <div style={{ fontSize: 11.5, color: "#9aa0ab", marginTop: 4 }}>{r.hint} (reference only, not used in any total)</div>}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8, marginTop: 8 }}>
                  {r.cells.map((c) => <CellSummary key={c.tier} cell={c} />)}
                </div>
                {r.updatedBy && <div style={{ fontSize: 10.5, color: "#aab0bb", marginTop: 6 }}>Last edited by {r.updatedBy} · {day(r.updatedAt)}</div>}
                {open === r.key && <RowEditor row={r} assemblies={assemblies} onClose={() => setOpen(null)} />}
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function CellSummary({ cell }: { cell: EquipCellVM }) {
  const tier = TIERS.find((t) => t.key === cell.tier)!.label;
  return (
    <div style={{ background: cell.kind === "empty" || cell.problem ? "#fdf6f3" : "#f7f8fa", borderRadius: 8, padding: "7px 9px", minWidth: 0 }}>
      <div style={LABEL}>{tier}</div>
      <div style={{ fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cell.title}</div>
      {cell.detail && <div style={{ fontSize: 11, color: "#737985", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cell.detail}</div>}
      {cell.kind !== "empty" && !cell.problem && (
        <div style={{ fontSize: 11, color: "#5b616e", marginTop: 2 }}>
          {cell.perSqft ? `${money(cell.unitCost)} / sq ft + making` : `cost ${money(cell.unitCost)} · sell ${money(cell.unitSell)}`}
        </div>
      )}
      {cell.confirmedBy && <div style={{ fontSize: 10.5, color: "#8a6d1f", marginTop: 2 }}>Confirmed by {cell.confirmedBy} · {day(cell.confirmedAt)}</div>}
      {cell.problem && <div style={{ fontSize: 11, color: "#a0442b", marginTop: 2 }}>{cell.problem}</div>}
    </div>
  );
}

function RowEditor({ row, assemblies, onClose }: { row: EquipRowVM; assemblies: AssemblyOption[]; onClose: () => void }) {
  const router = useRouter();
  const [sameAll, setSameAll] = useState(row.sameAll);
  const [cells, setCells] = useState<Record<TierKey, EquipCellInput>>(() => ({
    good: row.cells[0].input,
    better: row.cells[1].input,
    best: row.cells[2].input,
  }));
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const tiers = sameAll ? TIERS.slice(0, 1) : TIERS;
  const save = () =>
    start(async () => {
      setError("");
      const input: EquipRowInput = { sameAll, tiers: sameAll ? { good: cells.good } : cells };
      const r = await saveEquipmentRowAction(row.key, input);
      if (!r.ok) setError(r.error);
      else {
        onClose();
        router.refresh();
      }
    });

  return (
    <div style={{ borderTop: "1px solid #eef0f3", marginTop: 10, paddingTop: 12 }}>
      <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, fontWeight: 600 }}>
        <input type="checkbox" checked={sameAll} onChange={(e) => setSameAll(e.target.checked)} style={{ accentColor: "var(--accent)" }} />
        Same for all tiers
      </label>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${tiers.length}, minmax(0, 1fr))`, gap: 10, marginTop: 10 }}>
        {tiers.map((t) => (
          <div key={t.key}>
            <div style={LABEL}>{sameAll ? "All tiers" : t.label}</div>
            <CellEditor
              rowKey={row.key}
              curtain={row.curtain}
              value={cells[t.key]}
              assemblies={assemblies}
              onChange={(v) => setCells((c) => ({ ...c, [t.key]: v }))}
            />
          </div>
        ))}
      </div>
      {error && <div style={{ color: "#a0442b", fontSize: 12, marginTop: 8 }}>{error}</div>}
      <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center" }}>
        <button type="button" onClick={save} disabled={pending} style={{ ...BTN, background: "var(--accent)", borderColor: "var(--accent)", color: "#fff" }}>
          {pending ? "Saving…" : "Save row"}
        </button>
        <button type="button" onClick={onClose} style={BTN}>Cancel</button>
        <span style={{ flex: 1 }} />
        <ConfirmButton
          label="Clear row"
          confirmLabel="Clear all tiers?"
          pendingLabel="Clearing…"
          style={BTN}
          onConfirm={async () => {
            const r = await clearEquipmentRowAction(row.key);
            if (!r.ok) setError(r.error);
            else {
              onClose();
              router.refresh();
            }
          }}
        />
      </div>
    </div>
  );
}

function CellEditor({
  rowKey,
  curtain,
  value,
  assemblies,
  onChange,
}: {
  rowKey: string;
  curtain: boolean;
  value: EquipCellInput;
  assemblies: AssemblyOption[];
  onChange: (v: EquipCellInput) => void;
}) {
  const kind = value?.kind ?? "empty";
  const pick = (k: string) =>
    onChange(
      k === "part" ? { kind: "part", sku: "" }
        : k === "assembly" ? { kind: "assembly", id: "" }
          : k === "allowance" ? { kind: "allowance", amount: 0, note: "", confirmed: false }
            : null
    );
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <select value={kind} onChange={(e) => pick(e.target.value)} style={INPUT}>
        <option value="empty">Needs a part</option>
        <option value="part">{curtain ? "Catalog fabric" : "Catalog part"}</option>
        {!curtain && <option value="assembly">Assembly (fixture or system)</option>}
        <option value="allowance">Allowance</option>
      </select>
      {value?.kind === "part" && <PartPicker rowKey={rowKey} sku={value.sku} onPick={(sku) => onChange({ kind: "part", sku })} />}
      {value?.kind === "assembly" && (
        <select value={value.id} onChange={(e) => onChange({ kind: "assembly", id: e.target.value })} style={INPUT}>
          <option value="">Pick an assembly…</option>
          {assemblies.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label} · {a.kind === "system" ? `System (${a.scope})` : "Fixture"} · sell {money(a.unitSell)}
            </option>
          ))}
        </select>
      )}
      {value?.kind === "allowance" && (
        <>
          <input
            type="number"
            min={0}
            step="0.01"
            value={value.amount || ""}
            placeholder={curtain ? "Unit cost per drape, $" : "Unit cost, $"}
            onChange={(e) => onChange({ ...value, amount: Number(e.target.value) })}
            style={INPUT}
          />
          <input value={value.note ?? ""} placeholder="Why (e.g. waiting on the vendor's price book)" onChange={(e) => onChange({ ...value, note: e.target.value })} style={INPUT} />
          <label style={{ display: "flex", gap: 6, fontSize: 11.5, color: "#5b616e", alignItems: "flex-start" }}>
            <input type="checkbox" checked={value.confirmed} onChange={(e) => onChange({ ...value, confirmed: e.target.checked })} style={{ accentColor: "var(--accent)" }} />
            I confirm this allowance. It prices Auto designs, flagged internally, until a real part is mapped.
          </label>
        </>
      )}
    </div>
  );
}

function PartPicker({ rowKey, sku, onPick }: { rowKey: string; sku: string; onPick: (sku: string) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<EquipPartHit[]>([]);
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const search = (v: string) => {
    setQ(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(
      () =>
        start(async () => {
          const r = await searchEquipmentPartsAction(v);
          setHits(r.hits);
          setNote(r.hits.length ? `${r.total} match${r.total === 1 ? "" : "es"}${r.total > r.hits.length ? " — refine to narrow" : ""}` : "No matches");
        }),
      250
    );
  };
  const suggest = () =>
    start(async () => {
      const r = await suggestEquipmentPartsAction(rowKey);
      setHits(r.hits);
      setNote(r.hits.length ? "Suggested matches" : "No suggestions — search instead");
    });
  return (
    <div style={{ display: "grid", gap: 5 }}>
      {sku && <div style={{ fontFamily: "var(--font-mono)", fontSize: 11.5 }}>{sku}</div>}
      <div style={{ display: "flex", gap: 6 }}>
        <input value={q} onChange={(e) => search(e.target.value)} placeholder="Search SKU, description, maker…" style={{ ...INPUT, flex: 1 }} />
        <button type="button" onClick={suggest} style={BTN}>Suggest</button>
      </div>
      {pending ? <div style={{ fontSize: 11, color: "#8c919c" }}>Searching…</div> : note && <div style={{ fontSize: 11, color: "#8c919c" }}>{note}</div>}
      {hits.map((h) => (
        <button
          key={h.sku}
          type="button"
          onClick={() => {
            onPick(h.sku);
            setHits([]);
            setNote("");
          }}
          style={{ ...BTN, textAlign: "left", fontWeight: 500, background: h.sku === sku ? "color-mix(in srgb, var(--accent) 10%, #fff)" : "#fff" }}
        >
          <span style={{ fontFamily: "var(--font-mono)" }}>{h.sku}</span> — {h.desc}
          <span style={{ color: "#8c919c" }}> · {h.category} · cost {money(h.cost)} · list {money(h.list)}</span>
        </button>
      ))}
    </div>
  );
}
