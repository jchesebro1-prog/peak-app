"use client";

import { useState, useTransition, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { ConfirmButton } from "@/components/confirm-button";
import { PartPicker } from "@/app/(app)/design/grid/settings/equipment-map/part-picker";
import {
  ALWAYS_REQUIRED_ROLES,
  CORD_ROLES,
  MOUNTING_ROLES,
  NEW_SERIES_DEFAULTS,
  TRACK_ROLES,
  TRACK_ROLE_LABELS,
  activationProblems,
  type TrackRole,
  type TrackSeries,
} from "@/lib/track-series";
import { deleteTrackSeriesAction, saveTrackSeriesAction } from "./actions";

/** Live catalog facts for one mapped SKU (server-read on page load, or from a picked search hit). */
export type PartInfo = { desc: string; cost: number; unit: string; mfr: string };

const INPUT: CSSProperties = { width: "100%", boxSizing: "border-box", border: "1px solid #e4e7ec", borderRadius: 7, padding: "7px 9px", fontSize: 12.5, fontFamily: "inherit", background: "#fff" };
const BTN: CSSProperties = { border: "1px solid #dfe2e8", background: "#fff", borderRadius: 7, padding: "6px 11px", fontSize: 12, fontWeight: 600, color: "#3d424e", cursor: "pointer", fontFamily: "inherit" };
const PRIMARY: CSSProperties = { ...BTN, background: "var(--accent)", borderColor: "var(--accent)", color: "#fff" };
const LABEL: CSSProperties = { fontSize: 10, fontWeight: 700, color: "#9aa0ab", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 5 };
const money = (n: number) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const day = (ts?: number) => (ts ? new Date(ts).toISOString().slice(0, 10) : "");

function roleNeed(role: TrackRole): string {
  if (ALWAYS_REQUIRED_ROLES.includes(role)) return "Required";
  if (MOUNTING_ROLES.includes(role)) return "One mounting required";
  if (CORD_ROLES.includes(role)) return "Cord-operated tracks";
  if (role === "curved") return "Curved runs";
  return "";
}

type Draft = {
  id: string;
  name: string;
  manufacturer: string;
  stickLengthFt: string;
  curvedSectionFt: string;
  minRadiusFt: string;
  carrierSpacingIn: string;
  hangerSpacingFt: string;
  overlapFt: string;
  parts: Partial<Record<TrackRole, string>>;
  active: boolean;
};

const str = (n: number | undefined) => (n == null || !(n > 0) ? "" : String(n));

function draftOf(s: TrackSeries | null): Draft {
  if (!s) {
    return {
      id: "",
      name: "",
      manufacturer: "",
      stickLengthFt: "",
      curvedSectionFt: "",
      minRadiusFt: "",
      carrierSpacingIn: String(NEW_SERIES_DEFAULTS.carrierSpacingIn),
      hangerSpacingFt: String(NEW_SERIES_DEFAULTS.hangerSpacingFt),
      overlapFt: String(NEW_SERIES_DEFAULTS.overlapFt),
      parts: {},
      active: false,
    };
  }
  const parts: Partial<Record<TrackRole, string>> = {};
  for (const r of TRACK_ROLES) if (s.parts[r]?.sku) parts[r] = s.parts[r]!.sku;
  return {
    id: s.id,
    name: s.name,
    manufacturer: s.manufacturer,
    stickLengthFt: str(s.stickLengthFt),
    curvedSectionFt: str(s.curvedSectionFt),
    minRadiusFt: str(s.minRadiusFt),
    carrierSpacingIn: String(s.carrierSpacingIn),
    hangerSpacingFt: String(s.hangerSpacingFt),
    overlapFt: String(s.overlapFt),
    parts,
    active: s.active,
  };
}

function PartLine({ sku, info }: { sku: string; info: PartInfo | undefined }) {
  if (!sku) return <span style={{ color: "#a0442b" }}>Not mapped</span>;
  if (!info)
    return (
      <span>
        <span style={{ fontFamily: "var(--font-mono)" }}>{sku}</span>
        <span style={{ color: "#a0442b" }}> — no longer in the catalog (counts as unmapped)</span>
      </span>
    );
  return (
    <span>
      <span style={{ fontFamily: "var(--font-mono)" }}>{sku}</span> — {info.desc}
      <span style={{ color: "#737985" }}>
        {" "}· cost {money(info.cost)}/{info.unit}
      </span>
    </span>
  );
}

export default function TrackSeriesClient({ series, parts }: { series: TrackSeries[]; parts: Record<string, PartInfo> }) {
  const [open, setOpen] = useState<string | null>(null); // series id, or "new"
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
        {open !== "new" && (
          <button type="button" style={PRIMARY} onClick={() => setOpen("new")}>
            + New series
          </button>
        )}
      </div>
      {open === "new" && (
        <section className="pk-card" style={{ padding: "14px 17px", marginBottom: 14 }}>
          <div style={{ fontSize: 14.5, fontWeight: 600 }}>New track series</div>
          <SeriesEditor series={null} parts={parts} onClose={() => setOpen(null)} />
        </section>
      )}
      {series.length === 0 && open !== "new" && (
        <div className="pk-card" style={{ padding: "40px 24px", textAlign: "center" }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>No track series yet</div>
          <div style={{ fontSize: 13, color: "#9aa0ab", marginTop: 6, lineHeight: 1.55 }}>
            Add a series (e.g. ADC 280), enter its stick length and map each piece to a catalog part. Nothing is mapped for you.
          </div>
        </div>
      )}
      {series.map((s) => (
        <section key={s.id} className="pk-card" style={{ padding: "14px 17px", marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 14.5, fontWeight: 650 }}>{s.name}</span>
            {s.manufacturer && <span style={{ fontSize: 12.5, color: "#737985" }}>{s.manufacturer}</span>}
            <span
              style={{
                fontSize: 10.5,
                fontWeight: 700,
                borderRadius: 999,
                padding: "2px 8px",
                color: s.active ? "#1f7a52" : "#737985",
                background: s.active ? "#eaf6ef" : "#f1f2f5",
              }}
            >
              {s.active ? "Active" : "Inactive"}
            </span>
            <span style={{ flex: 1 }} />
            <button type="button" style={BTN} onClick={() => setOpen(open === s.id ? null : s.id)}>
              {open === s.id ? "Close" : "Edit"}
            </button>
          </div>
          <div style={{ fontSize: 12, color: "#5b616e", marginTop: 5 }}>
            {[
              `Stick ${s.stickLengthFt > 0 ? `${s.stickLengthFt}'` : "—"}`,
              s.curvedSectionFt ? `curved section ${s.curvedSectionFt}'` : "no curved track",
              s.minRadiusFt ? `min radius ${s.minRadiusFt}'` : "",
              `carriers every ${s.carrierSpacingIn}"`,
              `clamps/hangers every ${s.hangerSpacingFt}'`,
              s.overlapFt ? `bi-parting overlap ${s.overlapFt}'` : "",
            ]
              .filter(Boolean)
              .join(" · ")}
          </div>
          {open === s.id ? (
            <SeriesEditor series={s} parts={parts} onClose={() => setOpen(null)} />
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "minmax(150px, 210px) minmax(0, 1fr)", gap: "3px 12px", fontSize: 12, marginTop: 10 }}>
              {TRACK_ROLES.filter((r) => s.parts[r]).map((r) => (
                <div key={r} style={{ display: "contents" }}>
                  <div style={{ color: "#737985" }}>{TRACK_ROLE_LABELS[r]}</div>
                  <div style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    <PartLine sku={s.parts[r]!.sku} info={parts[s.parts[r]!.sku]} />
                  </div>
                </div>
              ))}
              {!Object.keys(s.parts).length && <div style={{ color: "#a0442b", gridColumn: "1 / -1" }}>No parts mapped yet.</div>}
            </div>
          )}
          {s.updatedBy && open !== s.id && (
            <div style={{ fontSize: 10.5, color: "#aab0bb", marginTop: 8 }}>
              Last edited by {s.updatedBy} · {day(s.updatedAt)}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}

function SeriesEditor({ series, parts, onClose }: { series: TrackSeries | null; parts: Record<string, PartInfo>; onClose: () => void }) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(() => draftOf(series));
  const [known, setKnown] = useState<Record<string, PartInfo>>(parts);
  const [picking, setPicking] = useState<TrackRole | null>(null);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const setPart = (role: TrackRole, sku: string) =>
    setDraft((d) => {
      const next = { ...d.parts };
      if (sku) next[role] = sku;
      else delete next[role];
      return { ...d, parts: next };
    });

  const liveSkus = new Set(Object.keys(known));
  const partMap: Partial<Record<TrackRole, { sku: string }>> = {};
  for (const [r, sku] of Object.entries(draft.parts)) if (sku) partMap[r as TrackRole] = { sku };
  const problems = activationProblems({ stickLengthFt: Number(draft.stickLengthFt) || 0, parts: partMap }, liveSkus);
  const canActivate = problems.length === 0;
  const active = draft.active && canActivate;

  const save = () =>
    start(async () => {
      setError("");
      const r = await saveTrackSeriesAction({
        ...(draft.id ? { id: draft.id } : {}),
        name: draft.name,
        manufacturer: draft.manufacturer,
        stickLengthFt: draft.stickLengthFt,
        curvedSectionFt: draft.curvedSectionFt,
        minRadiusFt: draft.minRadiusFt,
        carrierSpacingIn: draft.carrierSpacingIn,
        hangerSpacingFt: draft.hangerSpacingFt,
        overlapFt: draft.overlapFt,
        parts: partMap,
        active,
      });
      if (!r.ok) setError(r.error);
      else {
        onClose();
        router.refresh();
      }
    });

  const field = (label: string, key: "stickLengthFt" | "curvedSectionFt" | "minRadiusFt" | "carrierSpacingIn" | "hangerSpacingFt" | "overlapFt", unit: string, placeholder = "") => (
    <label style={{ display: "block" }}>
      <div style={LABEL}>{label}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
        <input type="number" min={0} step="any" value={draft[key]} placeholder={placeholder} onChange={(e) => set(key, e.target.value)} style={INPUT} />
        <span style={{ fontSize: 12, color: "#8c919c" }}>{unit}</span>
      </div>
    </label>
  );

  return (
    <div style={{ borderTop: "1px solid #eef0f3", marginTop: 10, paddingTop: 12 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
        <label style={{ display: "block" }}>
          <div style={LABEL}>Name</div>
          <input value={draft.name} maxLength={80} placeholder="e.g. ADC 280" onChange={(e) => set("name", e.target.value)} style={INPUT} />
        </label>
        <label style={{ display: "block" }}>
          <div style={LABEL}>Manufacturer</div>
          <input value={draft.manufacturer} maxLength={60} placeholder="e.g. ADC" onChange={(e) => set("manufacturer", e.target.value)} style={INPUT} />
        </label>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, marginTop: 10 }}>
        {field("Stick length", "stickLengthFt", "ft", "from the maker's data")}
        {field("Curved section", "curvedSectionFt", "ft", "blank = no curves")}
        {field("Min radius", "minRadiusFt", "ft")}
        {field("Carrier spacing", "carrierSpacingIn", "in")}
        {field("Clamp / hanger spacing", "hangerSpacingFt", "ft")}
        {field("Bi-parting overlap", "overlapFt", "ft")}
      </div>

      <div style={{ ...LABEL, marginTop: 16 }}>Parts</div>
      <div style={{ display: "grid", gap: 6 }}>
        {TRACK_ROLES.map((role) => {
          const sku = draft.parts[role] || "";
          return (
            <div key={role} style={{ border: "1px solid #eef0f3", borderRadius: 9, padding: "8px 10px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <span style={{ fontSize: 12.5, fontWeight: 650, minWidth: 170 }}>{TRACK_ROLE_LABELS[role]}</span>
                {roleNeed(role) && <span style={{ fontSize: 10.5, color: "#9aa0ab" }}>{roleNeed(role)}</span>}
                <span style={{ flex: 1, minWidth: 0, fontSize: 12 }}>
                  <PartLine sku={sku} info={known[sku]} />
                </span>
                <button type="button" style={BTN} onClick={() => setPicking(picking === role ? null : role)}>
                  {picking === role ? "Done" : sku ? "Change" : "Map part"}
                </button>
                {sku && (
                  <button type="button" style={BTN} onClick={() => setPart(role, "")}>
                    Clear
                  </button>
                )}
              </div>
              {picking === role && (
                <div style={{ marginTop: 8 }}>
                  <PartPicker
                    sku={sku}
                    showSku={false}
                    onPick={(picked, hit) => {
                      setKnown((k) => ({ ...k, [picked]: { desc: hit.desc, cost: hit.cost, unit: hit.unit, mfr: "" } }));
                      setPart(role, picked);
                      setPicking(null);
                    }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, fontWeight: 600, marginTop: 14, color: canActivate ? "#16181d" : "#9aa0ab" }}>
        <input
          type="checkbox"
          checked={active}
          disabled={!canActivate}
          onChange={(e) => set("active", e.target.checked)}
          style={{ accentColor: "var(--accent)" }}
        />
        Active — offered in the track configurator
      </label>
      {!canActivate && <div style={{ fontSize: 11.5, color: "#8a6d1f", marginTop: 4 }}>Can&apos;t be active yet: {problems.join(" ")}</div>}

      {error && <div style={{ color: "#a0442b", fontSize: 12, marginTop: 8 }}>{error}</div>}
      <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center" }}>
        <button type="button" onClick={save} disabled={pending} style={PRIMARY}>
          {pending ? "Saving…" : series ? "Save series" : "Add series"}
        </button>
        <button type="button" onClick={onClose} style={BTN}>
          Cancel
        </button>
        <span style={{ flex: 1 }} />
        {series && (
          <ConfirmButton
            label="Delete series"
            confirmLabel="Delete this series?"
            pendingLabel="Deleting…"
            style={BTN}
            onConfirm={async () => {
              const r = await deleteTrackSeriesAction(series.id);
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
