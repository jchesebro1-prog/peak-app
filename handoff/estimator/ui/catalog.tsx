/**
 * Estimator handoff — the Catalog: a slim rebuild of src/app/(app)/catalog (a large server component) for browsing the whole
 * catalog and editing a part. Search ranks exactly like the Estimator's catalog picker (rankCatalogParts); Category and
 * Manufacturer are facets with counts; the table shows one page of at most 100 parts (photo, SKU / model, description,
 * manufacturer, category, unit, cost, list). A row opens the part editor drawer (description, category, unit, cost, list,
 * manufacturer, MFR part #, model #, rack data, narrative paragraph); "New part" starts a blank one whose SKU must be
 * unique. Save writes the catalog overlay (store.put), which the Estimator's picker reads at once; Reset to production
 * snapshot restores it. Reading is open to everyone; editing needs `create` — stricter than the app, whose part editor only requires a signed-in user (requireUser); the prototype keeps the stricter gate. Rules: runtime/catalog-model.ts.
 * Plan: PR 2 Task 8.
 */
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { clock, users } from "../runtime/ports";
import { liveCatalog, type LivePart } from "../runtime/readers";
import { partPhotoSrc } from "../runtime/assets";
import type { HandoffStore } from "../runtime/store";
import { errorMessage, LoadError } from "./load-error";
import {
  addLineSell, applyDraft, browseCatalog, draftFromPart, facetLabel, money, pageBounds, partFingerprint, RACK_ENUMS, RACK_LABEL, skuIndex, validateSku,
  type DraftField, type Facet, type PartDraft,
} from "../runtime/catalog-model";
import { RACK_FACT_KEYS, type RackFactKey } from "@/lib/rack/types";
import { MAX_PARAGRAPH } from "@/lib/estimating-core/narrative";
import { TIER_FALLBACK_MARKUP } from "@/lib/estimating-core/tier-reprice";

export const CATALOG_COPY = {
  title: "Catalog",
  newPart: "New part",
  searchPlaceholder: "Search SKU · model · description · manufacturer",
  empty: "No parts match.",
  allCategories: "All categories",
  allManufacturers: "All manufacturers",
  readOnly: "Your role can't edit the catalog — pick an Estimator, Manager or Admin to change a part.",
  pricingRule: "On an estimate, a part with a cost sells at cost × (1 + markup); a part with no cost sells at its list price.",
} as const;

const TH = { textAlign: "left", fontSize: 10.5, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "#8c919c", padding: "10px 12px", borderBottom: "1px solid #ececf0", whiteSpace: "nowrap" } as const;
const TD = { padding: "8px 12px", borderBottom: "1px solid #f1f2f5", fontSize: 13, verticalAlign: "middle" } as const;
const CLAMP: CSSProperties = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };

/** Window-level handle verify.ts reads: when the first page of rows was on screen. */
type CatalogProbe = { catalogFirstPaintMs?: number; catalogMountMs?: number; catalogSearchMs?: number };
const probe = (): CatalogProbe | null => {
  const w = window as unknown as { __peakHandoff?: CatalogProbe };
  return w.__peakHandoff ?? null;
};

/* ------------------------------------------------------------------ screen */

export function CatalogScreen({ store, onReady }: { store: HandoffStore; onReady: () => void }) {
  const [parts, setParts] = useState<LivePart[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [mfr, setMfr] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<{ sku: string | null } | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const deferred = useDeferredValue(query);
  const canEdit = users.can("create");
  const mountedAt = useRef(0);
  const typedAt = useRef(0);
  useEffect(() => {
    mountedAt.current = performance.now();
  }, []);

  const load = useCallback(async () => setParts(await liveCatalog(store)), [store]);
  useEffect(() => {
    let alive = true;
    const run = () =>
      liveCatalog(store).then(
        (p) => alive && setParts(p),
        (e: unknown) => {
          console.error("[handoff] catalog: could not read the catalog", e);
          if (alive) setLoadError(errorMessage(e));
        },
      );
    void run();
    window.addEventListener("focus", run);
    return () => {
      alive = false;
      window.removeEventListener("focus", run);
    };
  }, [store]);

  const results = useMemo(() => (parts ? browseCatalog(parts, { query: deferred, category, mfr }) : null), [parts, deferred, category, mfr]);
  // verify.ts reads how long a keystroke took to reach the rows (typing → the ranked rows committed).
  useEffect(() => {
    if (!results || !typedAt.current) return;
    const h = probe();
    if (h) h.catalogSearchMs = Math.round((performance.now() - typedAt.current) * 10) / 10;
    typedAt.current = 0;
  }, [results]);

  const total = results?.rows.length ?? 0;
  const bounds = pageBounds(total, page);
  const shown = results ? results.rows.slice(bounds.start, bounds.end) : [];

  // Ready (and timed) once the first page of rows has been painted — two frames after the commit.
  const timed = useRef(false);
  useEffect(() => {
    if (!results || timed.current) return;
    timed.current = true;
    onReady();
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        const h = probe();
        if (h) {
          h.catalogFirstPaintMs = Math.round(performance.now());
          h.catalogMountMs = Math.round(performance.now() - mountedAt.current);
        }
        document.querySelector("[data-handoff-catalog]")?.setAttribute("data-catalog-painted", "");
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [results, onReady]);

  if (loadError && !parts) return <LoadError message={loadError} onReady={onReady} />;

  const editingPart = editing?.sku ? (parts?.find((p) => p.sku === editing.sku) ?? null) : null;

  return (
    <div className="pk-content" data-handoff-catalog="" style={{ padding: "22px 24px", overflow: "auto", height: "100%" }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginBottom: 18 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-.015em" }}>{CATALOG_COPY.title}</div>
          <div data-catalog-count="" style={{ fontSize: 13.5, color: "#8c919c", marginTop: 5 }}>
            {parts ? `${parts.length.toLocaleString("en-US")} parts in this snapshot${total !== parts.length ? ` · ${total.toLocaleString("en-US")} match` : ""}` : "Loading…"}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {flash && (
            <span data-catalog-saved="" role="status" style={{ fontSize: 12.5, color: "#1f7a4d", fontWeight: 600 }}>
              {flash}
            </span>
          )}
          {canEdit && (
            <button type="button" className="pk-btn-accent" data-catalog-new="" onClick={() => setEditing({ sku: null })}>
              {CATALOG_COPY.newPart}
            </button>
          )}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
        <input
          type="search"
          className="pk-input"
          data-catalog-search=""
          aria-label="Search the catalog by SKU, model, description or manufacturer"
          placeholder={CATALOG_COPY.searchPlaceholder}
          value={query}
          onChange={(e) => {
            typedAt.current = performance.now();
            setQuery(e.target.value);
            setPage(0);
          }}
          style={{ fontSize: 12.5, padding: "6px 10px", width: 340, maxWidth: "100%" }}
        />
        <FacetSelect
          label="Category"
          all={CATALOG_COPY.allCategories}
          attr="data-catalog-facet-category"
          value={category}
          facets={results?.categories ?? []}
          onChange={(v) => {
            setCategory(v);
            setPage(0);
          }}
        />
        <FacetSelect
          label="Manufacturer"
          all={CATALOG_COPY.allManufacturers}
          attr="data-catalog-facet-mfr"
          value={mfr}
          facets={results?.manufacturers ?? []}
          onChange={(v) => {
            setMfr(v);
            setPage(0);
          }}
        />
        {(category !== null || mfr !== null || query !== "") && (
          <button
            type="button"
            className="pk-btn-outline"
            data-catalog-clear=""
            onClick={() => {
              setQuery("");
              setCategory(null);
              setMfr(null);
              setPage(0);
            }}
            style={{ fontSize: 12.5, padding: "6px 10px" }}
          >
            Clear filters
          </button>
        )}
      </div>

      <div style={{ background: "#fff", border: "1px solid #ececf0", borderRadius: 12, boxShadow: "0 1px 2px rgba(0,0,0,.04)", overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1040, tableLayout: "fixed" }}>
          <colgroup>
            <col style={{ width: 56 }} />
            <col style={{ width: 250 }} />
            <col />
            <col style={{ width: 150 }} />
            <col style={{ width: 190 }} />
            <col style={{ width: 54 }} />
            <col style={{ width: 96 }} />
            <col style={{ width: 96 }} />
          </colgroup>
          <thead>
            <tr>
              <th style={{ ...TH, width: 52 }} aria-label="Photo" />
              <th style={TH}>SKU / model</th>
              <th style={TH}>Description</th>
              <th style={TH}>Manufacturer</th>
              <th style={TH}>Category</th>
              <th style={TH}>Unit</th>
              <th style={{ ...TH, textAlign: "right" }}>Cost</th>
              <th style={{ ...TH, textAlign: "right" }}>List</th>
            </tr>
          </thead>
          <tbody data-catalog-rows="">
            {shown.map((p) => (
              <tr key={p.sku} data-catalog-sku={p.sku} onClick={() => setEditing({ sku: p.sku })} style={{ cursor: "pointer" }}>
                <td style={{ ...TD, paddingRight: 0 }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={partPhotoSrc(p.sku)} alt="" width={36} height={36} loading="lazy" decoding="async" data-catalog-thumb="" style={{ display: "block", width: 36, height: 36, objectFit: "contain", borderRadius: 6, background: "#f4f5f7" }} />
                </td>
                <td data-col="sku" style={{ ...TD, overflow: "hidden" }}>
                  <button
                    type="button"
                    data-catalog-open=""
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditing({ sku: p.sku });
                    }}
                    style={{ all: "unset", cursor: "pointer", display: "block", maxWidth: "100%", fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 600, ...CLAMP }}
                  >
                    {p.sku}
                  </button>
                  {p.manufacturerModelNumber ? <div style={{ fontSize: 11.5, color: "#8c919c", ...CLAMP }}>{p.manufacturerModelNumber}</div> : null}
                </td>
                <td data-col="desc" style={{ ...TD, color: "#16181d", ...CLAMP }} title={p.desc}>{p.desc}</td>
                <td data-col="mfr" style={{ ...TD, color: "#5b616e", ...CLAMP }}>{p.mfr || "—"}</td>
                <td data-col="category" style={{ ...TD, color: "#5b616e", ...CLAMP }} title={p.category || undefined}>{p.category || "—"}</td>
                <td data-col="unit" style={{ ...TD, color: "#5b616e", whiteSpace: "nowrap" }}>{p.unit || "ea"}</td>
                <td data-col="cost" style={{ ...TD, fontFamily: "var(--font-mono)", textAlign: "right", whiteSpace: "nowrap" }}>{money(p.cost)}</td>
                <td data-col="list" style={{ ...TD, fontFamily: "var(--font-mono)", fontWeight: 600, textAlign: "right", whiteSpace: "nowrap" }}>{money(p.list)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {results && total === 0 && (
          <div data-catalog-empty="" style={{ padding: "28px 16px", textAlign: "center", color: "#8c919c", fontSize: 13 }}>
            {CATALOG_COPY.empty}
          </div>
        )}
      </div>

      {results && total > 0 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 12, fontSize: 12.5, color: "#5b616e" }}>
          <span data-catalog-range="">
            Showing {(bounds.start + 1).toLocaleString("en-US")}–{bounds.end.toLocaleString("en-US")} of {total.toLocaleString("en-US")}
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button type="button" className="pk-btn-outline" data-catalog-prev="" disabled={bounds.page === 0} onClick={() => setPage(bounds.page - 1)} style={{ fontSize: 12.5, padding: "5px 10px" }}>
              ← Previous
            </button>
            <span data-catalog-page="">Page {bounds.page + 1} of {bounds.pages.toLocaleString("en-US")}</span>
            <button type="button" className="pk-btn-outline" data-catalog-next="" disabled={bounds.page >= bounds.pages - 1} onClick={() => setPage(bounds.page + 1)} style={{ fontSize: 12.5, padding: "5px 10px" }}>
              Next →
            </button>
          </span>
        </div>
      )}

      {editing && parts && (
        <PartDrawer
          key={editing.sku ?? "(new)"}
          store={store}
          isNew={editing.sku === null}
          part={editingPart}
          parts={parts}
          canEdit={canEdit}
          onClose={() => setEditing(null)}
          onSaved={async (sku, isNew) => {
            setEditing(null);
            await load();
            setFlash(`${isNew ? "Added" : "Saved"} ✓ ${sku}`);
            window.setTimeout(() => setFlash((f) => (f && f.endsWith(sku) ? null : f)), 6000);
          }}
        />
      )}
    </div>
  );
}

/** The "no facet" option's value; a facet's own options are prefixed so a blank name ("(none)") can't be mistaken for it. */
const ALL = "";
const optionValue = (v: string) => `v:${v}`;

function FacetSelect({ label, all, attr, value, facets, onChange }: { label: string; all: string; attr: string; value: string | null; facets: Facet[]; onChange: (v: string | null) => void }) {
  // The picked value stays listed even when the other filters leave it no rows (count 0).
  const list = value !== null && !facets.some((f) => f.value === value) ? [...facets, { value, count: 0 }] : facets;
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 600, color: "#8c919c" }}>
      {label}
      <select
        {...{ [attr]: "" }}
        className="pk-input"
        aria-label={label}
        value={value === null ? ALL : optionValue(value)}
        onChange={(e) => onChange(e.target.value === ALL ? null : e.target.value.slice(2))}
        style={{ fontSize: 12.5, padding: "6px 8px", maxWidth: 260 }}
      >
        <option value={ALL}>{all}</option>
        {list.map((f) => (
          <option key={f.value} value={optionValue(f.value)}>
            {facetLabel(f.value)} ({f.count.toLocaleString("en-US")})
          </option>
        ))}
      </select>
    </label>
  );
}

/* ------------------------------------------------------------------ part editor drawer */

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function Field({ label, error, hint, children }: { label: string; error?: string; hint?: string; children: ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11.5, fontWeight: 600, color: "#5b616e", minWidth: 0 }}>
      {label}
      {children}
      {hint && !error ? <span style={{ fontWeight: 400, color: "#8c919c" }}>{hint}</span> : null}
      {error ? (
        <span role="alert" data-catalog-error="" style={{ fontWeight: 500, color: "#a33a2b" }}>
          {error}
        </span>
      ) : null}
    </label>
  );
}

const GRID2: CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 };
const SECTION: CSSProperties = { fontSize: 10.5, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "#8c919c", margin: "18px 0 8px" };

function PartDrawer({ store, isNew, part: livePart, parts, canEdit, onClose, onSaved }: { store: HandoffStore; isNew: boolean; part: LivePart | null; parts: LivePart[]; canEdit: boolean; onClose: () => void; onSaved: (sku: string, isNew: boolean) => void | Promise<void> }) {
  // New-part mode is the drawer's own flag (editing.sku === null), never "no part found". The part is snapshotted when the
  // drawer opens: a change from another window does not move `initial` under the open form — Save compares instead.
  const [opened, setOpened] = useState<LivePart | null>(livePart);
  const [gone, setGone] = useState(false);
  const [stale, setStale] = useState(false);
  const part = opened;
  // The parts list refreshes on focus; a part that is no longer in it (reset or removed elsewhere) can't be saved.
  const removed = !isNew && (gone || livePart === null);
  const initial = useMemo(() => draftFromPart(opened), [opened]);
  const [draft, setDraft] = useState<PartDraft>(initial);
  const [errors, setErrors] = useState<Partial<Record<DraftField, string>>>({});
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  // The SKU index is built when the editor opens on a NEW part — never for browsing.
  const index = useMemo(() => (isNew ? skuIndex(parts, store.catalogRenames) : null), [isNew, parts, store]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const readOnly = !canEdit;
  const noSave = readOnly || removed;
  const categories = useMemo(() => categoryNames(parts), [parts]);

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => before?.focus?.();
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (!saving) onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const at = document.activeElement;
      if (!panel.contains(at) || (e.shiftKey ? at === first : at === last)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [saving, onClose]);

  const set = <K extends keyof PartDraft>(k: K, v: PartDraft[K]) => {
    setDraft((d) => ({ ...d, [k]: v }));
    setErrors((e) => (e[k] || (k === "cost" && e.cost) ? { ...e, [k]: undefined } : e));
  };
  const setRack = (k: RackFactKey, v: string) => {
    setDraft((d) => ({ ...d, rack: { ...d.rack, [k]: v } }));
    setErrors((e) => (e.rack ? { ...e, rack: undefined } : e));
  };
  const skuError = isNew && draft.sku.trim() && index ? validateSku(draft.sku, index) : null;

  const reload = async () => {
    const fresh = opened ? await store.get<LivePart>("catalog", opened.id) : null;
    setStale(false);
    if (!fresh) {
      setGone(true);
      return;
    }
    const next = fresh.sku ? fresh : { ...fresh, sku: fresh.id };
    setOpened(next);
    setDraft(draftFromPart(next));
    setErrors({});
  };

  const save = async () => {
    if (saving || noSave) return;
    setFailure(null);
    // Re-read the catalog now: another window may have taken the SKU since the editor opened.
    const live = isNew ? await liveCatalog(store) : null;
    const idx = live ? skuIndex(live, store.catalogRenames) : undefined;
    let base: LivePart | null = null;
    if (!isNew) {
      const row = opened ? await store.get<LivePart>("catalog", opened.id) : null;
      if (!row || !opened) {
        setGone(true);
        return;
      }
      base = row.sku ? row : { ...row, sku: row.id };
      if (partFingerprint(base) !== partFingerprint(opened)) {
        setStale(true);
        return;
      }
    }
    const r = applyDraft(base, draft, { now: clock.now(), by: users.current().name, index: idx });
    if (!r.ok) {
      setErrors(r.errors);
      return;
    }
    setSaving(true);
    try {
      await store.put("catalog", r.part);
      await onSaved(r.part.sku, isNew);
    } catch (e) {
      setFailure(e instanceof Error ? e.message : "The part could not be saved.");
      setSaving(false);
    }
  };

  const costN = Number(draft.cost.replace(/[$,]/g, "")) || 0;
  const listN = Number(draft.list.replace(/[$,]/g, "")) || 0;
  const defaultSell = addLineSell({ cost: costN, list: listN }, null);

  return (
    <div className="pk-drawer-root" data-catalog-drawer="">
      <div className="pk-drawer-backdrop" onClick={() => !saving && onClose()} />
      <aside ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="catalog-drawer-title" className="pk-drawer-panel" style={{ width: 560 }}>
        <div className="pk-drawer-head">
          <h2 id="catalog-drawer-title" className="pk-drawer-title">
            {isNew ? "New part" : (part?.sku ?? "Part")}
          </h2>
          <button ref={closeRef} type="button" aria-label="Close part editor" className="pk-drawer-close" data-catalog-close="" onClick={() => !saving && onClose()}>
            ✕
          </button>
        </div>
        <div className="pk-drawer-body" style={{ padding: "4px 18px 18px" }}>
          {readOnly && (
            <div data-catalog-readonly="" style={{ margin: "12px 0 0", padding: "8px 10px", borderRadius: 8, background: "#f4f5f7", fontSize: 12.5, color: "#5b616e" }}>
              {CATALOG_COPY.readOnly}
            </div>
          )}
          {removed && (
            <div role="alert" data-catalog-removed="" style={{ margin: "12px 0 0", padding: "8px 10px", borderRadius: 8, background: "#fbeeeb", fontSize: 12.5, color: "#a33a2b" }}>
              This part was reset or removed — close this editor and pick it again from the list. Nothing can be saved here.
            </div>
          )}
          {stale && !removed && (
            <div role="alert" data-catalog-stale="" style={{ margin: "12px 0 0", padding: "8px 10px", borderRadius: 8, background: "#fdf3dd", fontSize: 12.5, color: "#7a5a12", display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ flex: 1 }}>This part changed in another window — reload it? Your edits here are replaced.</span>
              <button type="button" className="pk-btn-outline" data-catalog-reload="" onClick={reload}>
                Reload
              </button>
            </div>
          )}
          <div style={SECTION}>Part</div>
          <div style={{ display: "flex", gap: 14, alignItems: "flex-start", marginBottom: 12 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={partPhotoSrc(isNew ? draft.sku.trim() : (part?.sku ?? ""))} alt="" width={64} height={64} data-catalog-drawer-photo="" style={{ width: 64, height: 64, objectFit: "contain", borderRadius: 8, background: "#f4f5f7", flexShrink: 0 }} />
            <div style={{ fontSize: 12, color: "#8c919c", lineHeight: 1.5 }}>Bundled photos only — the prototype doesn&apos;t take uploads.</div>
          </div>
          <div style={{ display: "grid", gap: 12 }}>
            <Field label="SKU" error={errors.sku ?? skuError ?? undefined} hint={isNew ? "Unique across the catalog, including retired SKUs." : "A SKU is changed by a rename, not here."}>
              <input className="pk-input mono" data-catalog-field="sku" value={draft.sku} readOnly={!isNew} disabled={!isNew} onChange={(e) => set("sku", e.target.value)} autoFocus={false} />
            </Field>
            <Field label="Description" error={errors.desc}>
              <textarea className="pk-input" data-catalog-field="desc" rows={3} value={draft.desc} disabled={readOnly} onChange={(e) => set("desc", e.target.value)} style={{ resize: "vertical" }} />
            </Field>
            <div style={GRID2}>
              <Field label="Manufacturer">
                <input className="pk-input" data-catalog-field="mfr" value={draft.mfr} disabled={readOnly} onChange={(e) => set("mfr", e.target.value)} />
              </Field>
              <Field label="MFR part #">
                <input className="pk-input mono" data-catalog-field="manufacturerPartNumber" value={draft.manufacturerPartNumber} disabled={readOnly} onChange={(e) => set("manufacturerPartNumber", e.target.value)} />
              </Field>
            </div>
            <Field label="Model #">
              <input className="pk-input mono" data-catalog-field="manufacturerModelNumber" value={draft.manufacturerModelNumber} disabled={readOnly} onChange={(e) => set("manufacturerModelNumber", e.target.value)} />
            </Field>
          </div>

          <div style={SECTION}>Pricing</div>
          <div style={{ display: "grid", gap: 12 }}>
            <div style={GRID2}>
              <Field label="Category" error={errors.category}>
                <input className="pk-input" data-catalog-field="category" list="catalog-categories" value={draft.category} disabled={readOnly} onChange={(e) => set("category", e.target.value)} />
              </Field>
              <Field label="Unit" error={errors.unit}>
                <input className="pk-input" data-catalog-field="unit" value={draft.unit} disabled={readOnly} onChange={(e) => set("unit", e.target.value)} />
              </Field>
            </div>
            <div style={GRID2}>
              <Field label="Cost ($)" error={errors.cost}>
                <input className="pk-input mono" data-catalog-field="cost" inputMode="decimal" value={draft.cost} disabled={readOnly} onChange={(e) => set("cost", e.target.value)} />
              </Field>
              <Field label="List ($)" error={errors.list}>
                <input className="pk-input mono" data-catalog-field="list" inputMode="decimal" value={draft.list} disabled={readOnly} onChange={(e) => set("list", e.target.value)} />
              </Field>
            </div>
            <div data-catalog-pricing-rule="" style={{ fontSize: 12, color: "#5b616e", lineHeight: 1.5, background: "#f7f8fa", borderRadius: 8, padding: "8px 10px" }}>
              {CATALOG_COPY.pricingRule}
              <div style={{ marginTop: 4 }}>
                At the default {Math.round(TIER_FALLBACK_MARKUP * 100)}% markup it sells at <b data-catalog-default-sell="">{money(defaultSell)}</b>
                {costN > 0 ? " (from the cost)" : " (from the list price)"}.
              </div>
            </div>
          </div>

          <details style={{ marginTop: 6 }} data-catalog-rack="">
            <summary style={{ ...SECTION, cursor: "pointer", listStyle: "revert" }}>Rack data</summary>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              {RACK_FACT_KEYS.map((k) => {
                const options = RACK_ENUMS[k];
                return (
                  <div key={k} style={k === "rackNotes" ? { gridColumn: "1 / -1" } : undefined}>
                    <Field label={RACK_LABEL[k]}>
                      {options ? (
                        <select className="pk-input" data-catalog-field={`rack_${k}`} value={draft.rack[k]} disabled={readOnly} onChange={(e) => setRack(k, e.target.value)}>
                          <option value="">—</option>
                          {options.map((o) => (
                            <option key={o} value={o}>
                              {o}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input className="pk-input mono" data-catalog-field={`rack_${k}`} value={draft.rack[k]} disabled={readOnly} onChange={(e) => setRack(k, e.target.value)} />
                      )}
                    </Field>
                  </div>
                );
              })}
            </div>
            {errors.rack ? (
              <div role="alert" data-catalog-error="" style={{ marginTop: 8, fontSize: 12, color: "#a33a2b" }}>
                {errors.rack}
              </div>
            ) : (
              <div style={{ marginTop: 8, fontSize: 12, color: "#8c919c" }}>Blank = unknown (never zero). RU height is in half-RU steps.</div>
            )}
          </details>

          <div style={SECTION}>Narrative paragraph</div>
          <Field label="Customer-facing paragraph" error={errors.narrativeText} hint="Plain text the Estimator's narrative can pull in for this part.">
            <textarea className="pk-input" data-catalog-field="narrativeText" rows={5} maxLength={MAX_PARAGRAPH} value={draft.narrativeText} disabled={readOnly} onChange={(e) => set("narrativeText", e.target.value)} style={{ resize: "vertical" }} />
          </Field>
          <datalist id="catalog-categories">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8, padding: "12px 16px", borderTop: "1px solid #f0f1f4", flexShrink: 0 }}>
          {failure && (
            <span role="alert" data-catalog-save-error="" style={{ marginRight: "auto", fontSize: 12.5, color: "#a33a2b" }}>
              {failure}
            </span>
          )}
          {Object.values(errors).some(Boolean) && !failure && (
            <span style={{ marginRight: "auto", fontSize: 12.5, color: "#a33a2b" }}>Fix the highlighted fields.</span>
          )}
          <button type="button" className="pk-btn-outline" data-catalog-cancel="" disabled={saving} onClick={onClose}>
            {readOnly ? "Close" : "Cancel"}
          </button>
          {!readOnly && (
            <button type="button" className="pk-btn-accent" data-catalog-save="" disabled={saving || removed || (!isNew && !dirty)} onClick={save}>
              {saving ? "Saving…" : isNew ? "Add part" : "Save"}
            </button>
          )}
        </div>
      </aside>
    </div>
  );
}

/** The category names for the editor's suggestions — a flat list, built when the editor opens. */
function categoryNames(parts: readonly LivePart[]): string[] {
  const seen = new Set<string>();
  for (const p of parts) if (p.category) seen.add(p.category);
  return [...seen].sort((a, b) => a.localeCompare(b));
}
