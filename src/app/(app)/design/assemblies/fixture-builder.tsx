"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { dateYear } from "@/lib/format";
import { resolveFixture, toSkuMap, type FixtureKind, type FixtureRecord } from "@/lib/fixture-assemblies";
import type { MemberCoverage } from "@/lib/part-docs/assembly-graph";
import { ConfirmButton } from "@/components/confirm-button";
import { deleteFixtureAction, saveFixtureAction } from "./actions";
import FixtureForm, { draftFromRecord, draftResolvable, draftToInput, emptyDraft, money, pricesNote, type Draft, type PartHit } from "./fixture-form";

type Filter = "all" | FixtureKind;
const FILTER_LABEL: Record<Filter, string> = { all: "All", fixture: "Fixtures", system: "Systems" };
const EDIT_BTN = { border: "1px solid #dfe2e8", borderRadius: 7, padding: "6px 9px", background: "#fff", color: "#3d424e", cursor: "pointer", fontSize: 11.5 } as const;

/** #FXB — the one Assemblies list (fixtures + systems) and its form. */
export default function FixtureBuilder({ initial, parts: seed, priceListEffective, coverage }: {
  initial: FixtureRecord[];
  /** The server's priced seed — every part currently referenced by a saved
   *  fixture (I1, fix wave 1), never the whole catalog. Grown locally below
   *  as the pickers' server search turns up parts not yet in any fixture. */
  parts: PartHit[];
  priceListEffective: Record<string, number>;
  /** #207 — each saved line's datasheet coverage, keyed by pairKey(). */
  coverage: Record<string, MemberCoverage>;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  // JSON snapshot of `draft` as loaded (new/edit), for the M5 dirty check —
  // null whenever no draft is open or nothing has diverged from it yet.
  const [draftOrigin, setDraftOrigin] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Session-grown parts: the server seed plus every hit a picker has turned
  // up (I1). A fresh seed from the server (after save/delete → router.refresh)
  // is merged in rather than replacing local state outright, so an unsaved
  // draft's just-picked (not-yet-saved) parts keep pricing across a refresh
  // triggered by editing/deleting a DIFFERENT row.
  const [parts, setParts] = useState<PartHit[]>(seed);
  const [prevSeed, setPrevSeed] = useState(seed);
  if (seed !== prevSeed) {
    setPrevSeed(seed);
    setParts((prev) => {
      const merged = new Map(seed.map((p) => [p.sku, p] as const));
      for (const p of prev) if (!merged.has(p.sku)) merged.set(p.sku, p);
      return [...merged.values()];
    });
  }
  const mergePart = (hit: PartHit) => setParts((prev) => {
    const existing = prev.find((p) => p.sku === hit.sku);
    if (existing && existing.pricedAt === hit.pricedAt && existing.cost === hit.cost && existing.list === hit.list) return prev;
    return [...prev.filter((p) => p.sku !== hit.sku), hit];
  });

  const bySku = useMemo(() => toSkuMap(parts), [parts]);
  const settings = useMemo(() => ({ priceListEffective }), [priceListEffective]);
  const rows = useMemo(() => initial.map((rec) => ({ rec, live: resolveFixture(rec, bySku, settings) })), [initial, bySku, settings]);
  const counts: Record<Filter, number> = {
    all: rows.length,
    fixture: rows.filter((r) => r.rec.kind === "fixture").length,
    system: rows.filter((r) => r.rec.kind === "system").length,
  };
  const shown = rows.filter((r) => filter === "all" || r.rec.kind === filter);
  const live = draft ? resolveFixture(draftResolvable(draft), bySku, settings) : null;
  const dirty = draft != null && draftOrigin != null && JSON.stringify(draft) !== draftOrigin;

  const start = (kind: FixtureKind) => {
    setChoosing(false);
    setError(null);
    const next = emptyDraft(kind);
    setDraft(next);
    setDraftOrigin(JSON.stringify(next));
  };
  const edit = (rec: FixtureRecord) => {
    setChoosing(false);
    setError(null);
    const next = draftFromRecord(rec);
    setDraft(next);
    setDraftOrigin(JSON.stringify(next));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const save = async () => {
    if (!draft) return;
    setBusy(true);
    setError(null);
    try {
      const result = await saveFixtureAction(draftToInput(draft));
      if (!result.ok) { setError(result.error); return; }
      setDraft(null);
      setDraftOrigin(null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };
  const remove = async (rec: FixtureRecord) => {
    await deleteFixtureAction(rec.id);
    if (draft?.id === rec.id) { setDraft(null); setDraftOrigin(null); }
    router.refresh();
  };

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <div role="tablist" aria-label="Show" style={{ display: "inline-flex", background: "#f1f2f5", borderRadius: 9, padding: 3 }}>
          {(["all", "fixture", "system"] as const).map((f) => (
            <button
              key={f}
              type="button"
              role="tab"
              aria-selected={filter === f}
              onClick={() => setFilter(f)}
              style={{ border: 0, cursor: "pointer", fontSize: 12.5, fontWeight: 600, padding: "7px 13px", borderRadius: 7, background: filter === f ? "#fff" : "transparent", color: filter === f ? "#16181d" : "#8c919c", boxShadow: filter === f ? "0 1px 2px rgba(0,0,0,.1)" : "none" }}
            >
              {FILTER_LABEL[f]} <span style={{ color: "#9aa0ab", fontWeight: 500 }}>{counts[f]}</span>
            </button>
          ))}
        </div>
        {!draft && (choosing ? (
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span style={{ fontSize: 12.5, color: "#737985" }}>New assembly:</span>
            <button type="button" className="pk-btn-outline" onClick={() => start("fixture")}>Fixture</button>
            <button type="button" className="pk-btn-outline" onClick={() => start("system")}>System</button>
            <button type="button" onClick={() => setChoosing(false)} style={{ border: 0, background: "transparent", color: "#8c919c", cursor: "pointer", fontSize: 12 }}>Cancel</button>
          </div>
        ) : (
          <button type="button" className="pk-btn-accent" onClick={() => setChoosing(true)}>+ New assembly</button>
        ))}
      </div>

      {draft && live && (
        <FixtureForm
          draft={draft}
          onChange={setDraft}
          bySku={bySku}
          onPickPart={mergePart}
          live={live}
          coverage={coverage}
          busy={busy}
          error={error}
          onSave={save}
          onCancel={() => { setDraft(null); setDraftOrigin(null); setError(null); }}
        />
      )}

      <section className="pk-card" style={{ padding: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
          <h2 style={{ fontSize: 17, margin: 0 }}>Assemblies</h2>
          <span style={{ color: "#9aa0ab", fontSize: 12 }}>{shown.length} shown</span>
        </div>
        {shown.length === 0 ? (
          <p style={{ color: "#8c919c", fontSize: 13 }}>No assemblies yet — build the first fixture or system from your catalog.</p>
        ) : (
          <div style={{ display: "grid", gap: 0 }}>
            {shown.map(({ rec, live: l }) => {
              const was = rec.snapshot?.cost;
              const drift = was != null && Math.abs(was - l.cost) >= 0.005;
              // M3: the badge dates from when the snapshot was priced, not
              // from the record's last save (a human edit that touches only
              // the label, say, bumps updatedAt without repricing).
              const builtAt = rec.snapshot?.pricedAt ?? rec.updatedAt;
              const head = l.parts.filter((p) => p.slot === "lightEngine" || p.slot === "lens").map((p) => p.label).join(" + ");
              const optional = l.parts.filter((p) => !p.included).length;
              return (
                <div key={rec.id} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto auto", gap: 14, alignItems: "center", padding: "12px 0", borderTop: "1px solid #eef0f3" }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                      <span style={{ fontSize: 13.5, fontWeight: 700 }}>{rec.label}</span>
                      <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: "#737985", background: "#f2f4f7", borderRadius: 999, padding: "2px 8px" }}>
                        {rec.kind === "system" ? `System · ${rec.scope || "—"}` : "Fixture"}
                      </span>
                      {rec.needsReview && (
                        <span title="Converted from an assembly with no fixture-role part — its first part became the light engine. Check it and save." style={{ fontSize: 10.5, fontWeight: 700, color: "#8a6d1f", background: "#fbf3dc", borderRadius: 999, padding: "2px 8px" }}>
                          needs review
                        </span>
                      )}
                    </div>
                    {rec.description && <div style={{ color: "#737985", fontSize: 12, marginTop: 4 }}>{rec.description}</div>}
                    <div style={{ color: "#9aa0ab", fontSize: 11.5, marginTop: 4 }}>
                      {rec.kind === "system" ? `${l.parts.length} part${l.parts.length === 1 ? "" : "s"}` : head}
                      {optional ? ` · ${optional} optional add-on${optional === 1 ? "" : "s"}` : ""}
                      {` · updated ${dateYear(rec.updatedAt)} by ${rec.updatedBy || "—"}`}
                    </div>
                    {l.missing.length > 0 && (
                      <div style={{ color: "#a0442b", fontSize: 11.5, marginTop: 4 }}>
                        {l.missing.length} part{l.missing.length === 1 ? "" : "s"} no longer in the catalog: {l.missing.join(", ")}
                      </div>
                    )}
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 700 }}>{money(l.sell)}</div>
                    <div style={{ color: "#9aa0ab", fontSize: 10.5 }}>sell · cost {money(l.cost)} · {pricesNote(l.pricesAsOf)}</div>
                    {drift && <div style={{ color: "#8a6d1f", fontSize: 10.5 }}>cost was {money(was ?? 0)} when built ({dateYear(builtAt)})</div>}
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    {/* M5: switching the open, unsaved draft to a different
                       row would silently discard it — confirm first. */}
                    {dirty && draft?.id !== rec.id ? (
                      <ConfirmButton
                        label="Edit"
                        confirmLabel="Discard changes & edit?"
                        pendingLabel="Discard changes & edit?"
                        className=""
                        style={EDIT_BTN}
                        onConfirm={() => edit(rec)}
                      />
                    ) : (
                      <button type="button" onClick={() => edit(rec)} style={EDIT_BTN}>Edit</button>
                    )}
                    <ConfirmButton label="Delete" confirmLabel={`Delete ${rec.label}?`} style={{ fontSize: 11.5, padding: "6px 9px" }} onConfirm={() => remove(rec)} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}
