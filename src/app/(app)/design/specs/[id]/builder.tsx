"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ConfirmButton } from "@/components/confirm-button";
import type { CustomerComboboxOption } from "@/components/customer-combobox";
import type { AssembledSection, LeftOutReason } from "@/lib/specs/assemble-section";
import type { RowMatch } from "@/lib/specs/record-match";
import type { SpecKind } from "@/lib/specs/records";
import type { SpecDocument } from "@/lib/specs/spec-document";
import { specFileName } from "@/lib/specs/spec-file-name";
import {
  addSpecProductAction,
  deleteSpecDocumentAction,
  removeSpecProductAction,
  reorderSpecProductsAction,
  searchSpecPartsAction,
  setSpecPrintQuantitiesAction,
  setSpecProductHeaderAction,
  type SpecPickerPart,
} from "../builder-actions";
import { CARD, CARD_SUB, CARD_TITLE, ERR, FillInsCard, HeaderCard, MUTED, SaveTracker, useSave } from "./header-fields";
import Preview from "./preview";
import { LibraryPicker } from "./library-picker";
import { Chip, isRecordState, JobValuesGroup, RecordRowStatus, rowState, type SlimSpecRecord } from "./record-row";

/**
 * #205 Phase B (T5) — the spec builder, top to bottom: Header, Fill-ins,
 * Products (+ Add product picker, + Add from Spec Library, the match report),
 * Checklist, Preview + Download Word, Delete. Everything saves as it changes through the builder's server
 * actions; router.refresh() re-runs the page's assembly so the preview and
 * checklist always show what the Word file will hold. Nothing here blocks the
 * download — gaps are listed, never enforced (design decision 4) — but a
 * Download click waits for saves still in flight (SaveTracker).
 *
 * Spec records (Task 9, design §5): each product row shows its match
 * outcome and actions (record-row.tsx, record-dialogs.tsx). "Write new spec"
 * saves a Spec Library record, never text on the catalog part — the old
 * catalog-part Write spec is gone from the builder (the catalog's own Spec
 * panel keeps its legacy editor). The catalog picker's "Show all catalog
 * parts" adds a part without a spec straight onto the spec, where its row
 * offers Write new spec like any other unresolved row; a part with text
 * from another section still asks for a header here.
 */

export type SpecProductRow = {
  /** Server-computed `specRowKey` of the STORED product (spec records design
   *  §3.1, #205 fix round) — the one identity `removeSpecProductAction`/
   *  `reorderSpecProductsAction`/`setSpecProductHeaderAction` and React keys
   *  use. Never recompute this from display-only fields on the client: a
   *  sku-less row's mfrNumber/specKey/specId/fromLibrary never reach here. */
  rowKey: string;
  sku: string;
  desc: string;
  qty?: number;
  /** The Part 2 article this product prints under, or null when it can't be placed. */
  placedArticleId: string | null;
  leftOutReason: LeftOutReason | null;
  /** For "other-section": the title of the article the part does belong to. */
  otherArticleTitle: string | null;
  /** For a Spec Library record from another section: that section's number. */
  otherSectionNumber: string | null;
  /** The row was waived — it prints under ITEMS NOT SPECIFIED. */
  waivedReason: string | null;
  /** The Spec Library record this row matched, when one did. */
  recordTitle: string | null;
  /** The part's own resolved article (explicit or category default), any section. */
  ownArticleId: string | null;
  specArticleId: string | null;
  /** specArticleId names an article that no longer exists. */
  deadArticle: boolean;
  specSameAs: string;
  specTitle: string;
  specBody: string;
  specSort: number | null;
  /** Spec records (Task 9): this row's match outcome (null = no assembly). */
  match: RowMatch | null;
  /** For a record from another section: that section's id, when it exists. */
  otherSectionId: string | null;
  /** Added straight from the Spec Library (a `SPEC:<id>` row, §5.3). */
  fromLibrary: boolean;
  /** Write new spec's starting values, inferred server-side from the row. */
  writeDefaults: { kind: SpecKind; title: string; partNumber: string; manufacturer: string; matchKey: string; specText: string };
};

type ArticleOption = { id: string; title: string };
type RunFn = ReturnType<typeof useSave>["run"];

const ROW: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0,1fr) auto",
  gap: 10,
  alignItems: "center",
  padding: "9px 0",
  borderTop: "1px solid #f5f6f8",
};
const SKU: CSSProperties = { fontFamily: "var(--font-mono)", fontSize: 12, color: "#3a3f4a" };
const SMALL_BTN: CSSProperties = { padding: "4px 8px", fontSize: 11.5 };
const WARN: CSSProperties = { fontSize: 12.5, color: "#8a6d1f" };

/** A row's name for aria-labels — sku-less rows have none of their own. */
const rowName = (r: SpecProductRow) => r.sku || r.recordTitle || r.desc || "product";

const REASON_TEXT: Record<LeftOutReason, string> = {
  "no-spec": "No approved spec",
  "needs-header": "Pick a header",
  "other-section": "Belongs to another section",
  "not-in-catalog": "Part no longer in catalog",
  "no-match": "No spec in the Spec Library",
  ambiguous: "More than one library spec matches",
  draft: "Has a draft spec — approve to use",
};

/** A catalog part with spec text from another section, picked in "Show all
 *  catalog parts": it needs a header in this spec before it's added. No text
 *  is typed here, so Escape just closes. */
function HeaderPickDialog({
  docId,
  part,
  sectionArticles,
  onClose,
  onDone,
}: {
  docId: string;
  part: SpecPickerPart;
  sectionArticles: ArticleOption[];
  onClose: () => void;
  onDone: (sku: string) => void;
}) {
  const { err, pending, run } = useSave();
  const [header, setHeader] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !pending) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending, onClose]);

  return (
    <div className="pk-modal-scrim">
      <div className="pk-modal" role="dialog" aria-modal="true" aria-labelledby="pick-header-heading" style={{ width: 520 }}>
        <div id="pick-header-heading" style={{ fontSize: 15, fontWeight: 700, marginBottom: 2 }}>
          Pick a header
        </div>
        <div style={{ ...MUTED, marginBottom: 12 }}>
          <span style={SKU}>{part.sku}</span> {part.desc}
        </div>
        <div style={{ ...MUTED, marginBottom: 12 }}>This part&apos;s spec belongs to another section. Pick the header it prints under in this one.</div>
        <label className="pk-field-label" htmlFor="pick-header-select" style={{ display: "block" }}>
          Header in this spec
        </label>
        <select id="pick-header-select" className="pk-input" value={header} onChange={(e) => setHeader(e.target.value)} style={{ marginBottom: 12 }}>
          <option value="">— Decide later —</option>
          {sectionArticles.map((a) => (
            <option key={a.id} value={a.id}>
              {a.title}
            </option>
          ))}
        </select>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <button
            type="button"
            className="pk-btn-accent"
            disabled={pending}
            onClick={() =>
              run(
                () => addSpecProductAction(docId, part.sku, header || undefined),
                () => onDone(part.sku)
              )
            }
          >
            {pending ? "Adding…" : "Add"}
          </button>
          <button type="button" className="pk-btn-outline" disabled={pending} onClick={onClose}>
            Cancel
          </button>
          {err && (
            <span role="alert" style={ERR}>
              {err}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/** + Add product: search this section's approved-spec parts, or the whole catalog. */
function Picker({
  docId,
  hidden,
  onPick,
  onClose,
}: {
  docId: string;
  /** SKUs added since the last search — no longer offered. */
  hidden: string[];
  onPick: (p: SpecPickerPart) => Promise<void>;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [results, setResults] = useState<SpecPickerPart[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [busySku, setBusySku] = useState("");
  const seq = useRef(0);

  // Debounced: the search scans the whole catalog, so wait for a pause in
  // typing, and drop any answer that arrives after a newer request.
  useEffect(() => {
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await searchSpecPartsAction(docId, q, showAll);
        if (mine !== seq.current) return;
        if (r.ok) {
          setResults(r.parts);
          setErr("");
        } else setErr(r.error);
      } catch {
        if (mine === seq.current) setErr("Search failed — check your connection and try again.");
      } finally {
        if (mine === seq.current) setLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [docId, q, showAll]);

  const pick = async (p: SpecPickerPart) => {
    setBusySku(p.sku);
    try {
      await onPick(p);
    } finally {
      setBusySku("");
    }
  };
  const shown = results.filter((r) => !hidden.includes(r.sku));

  return (
    <div style={{ border: "1px solid #eceef2", borderRadius: 10, padding: 14, marginTop: 12, background: "#fafbfc" }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
        <input
          className="pk-input"
          autoFocus
          aria-label="Search parts to add"
          placeholder="Search by SKU, description or manufacturer…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ flex: "1 1 260px", width: "auto" }}
        />
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "#3a3f4a", cursor: "pointer" }}>
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
          Show all catalog parts
        </label>
        <button type="button" className="pk-btn-outline" onClick={onClose}>
          Done
        </button>
      </div>
      <div style={{ ...MUTED, marginBottom: 8 }}>
        {showAll
          ? "Every catalog part. A part without a spec is added so you can write one (Write new spec on its row); a part from another section asks for a header."
          : "Parts with an approved spec that belong to this section."}
      </div>
      {err && (
        <div role="alert" style={{ ...ERR, marginBottom: 8 }}>
          {err}
        </div>
      )}
      <div style={{ maxHeight: 360, overflowY: "auto", background: "#fff", border: "1px solid #f0f1f4", borderRadius: 8 }}>
        {loading && shown.length === 0 && <div style={{ ...MUTED, padding: 12 }}>Searching…</div>}
        {!loading && !err && shown.length === 0 && (
          <div style={{ ...MUTED, padding: 12 }}>
            {showAll ? "No parts match." : "No parts with an approved spec in this section match. Try Show all catalog parts."}
          </div>
        )}
        {shown.map((p) => (
          <div
            key={p.sku}
            style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 10, alignItems: "center", padding: "8px 12px", borderBottom: "1px solid #f5f6f8" }}
          >
            <div style={{ minWidth: 0 }}>
              <div>
                <span style={SKU}>{p.sku}</span> <span style={{ fontSize: 12.5, color: "#3a3f4a" }}>{p.desc}</span>
              </div>
              <div style={{ fontSize: 11.5, color: p.hasSpec && p.inSection ? "#6b7079" : "#8a6d1f" }}>
                {!p.hasSpec ? "No spec yet" : p.articleTitle || "No header"}
                {p.hasSpec && !p.inSection && " — another section"}
              </div>
            </div>
            <button type="button" className="pk-btn-outline" style={SMALL_BTN} disabled={!!busySku} onClick={() => pick(p)}>
              {busySku === p.sku ? "Adding…" : "Add"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function HeaderSelect({
  docId,
  row,
  sectionArticles,
  run,
  pending,
}: {
  docId: string;
  row: SpecProductRow;
  sectionArticles: ArticleOption[];
  run: RunFn;
  pending: boolean;
}) {
  // Server-computed (§3.1, #205 fix round) — see SpecProductRow.rowKey.
  const rowKey = row.rowKey;
  return (
    <select
      className="pk-input"
      aria-label={`Header for ${row.sku}`}
      value=""
      disabled={pending}
      onChange={(e) => e.target.value && run(() => setSpecProductHeaderAction(docId, rowKey, e.target.value))}
      style={{ width: "auto", padding: "5px 8px", fontSize: 12.5 }}
    >
      <option value="">— Pick a header —</option>
      {sectionArticles.map((a) => (
        <option key={a.id} value={a.id}>
          {a.title}
        </option>
      ))}
    </select>
  );
}

function ProductsCard({
  doc,
  section,
  sectionArticles,
  productRows,
  canEdit,
  recordsById,
  recordTexts,
  systemMatchKeys,
}: {
  doc: SpecDocument;
  section: { id: string; number: string } | null;
  sectionArticles: ArticleOption[];
  productRows: SpecProductRow[];
  canEdit: boolean;
  recordsById: Record<string, SlimSpecRecord>;
  recordTexts: Record<string, { title: string; specText: string }>;
  systemMatchKeys: string[];
}) {
  const router = useRouter();
  const { err, setErr, pending, run, track } = useSave();
  const hasSection = !!section;
  // One picker open at a time: the catalog's, or the Spec Library's.
  const [picker, setPicker] = useState<"" | "catalog" | "library">("");
  const [headerFor, setHeaderFor] = useState<SpecPickerPart | null>(null);
  const [added, setAdded] = useState<string[]>([]);
  const fromBom = doc.source.kind !== "scratch";
  const closeHeader = useCallback(() => setHeaderFor(null), []);
  // Records already on the spec as their own library rows.
  const librarySpecIds = productRows
    .filter((r) => r.fromLibrary && r.match && (r.match.status === "matched" || r.match.status === "draft"))
    .map((r) => (r.match as { specId: string }).specId);

  const groups: Array<{ key: string; title: string; rows: SpecProductRow[]; attention?: boolean }> = [];
  // From a BOM, a quote's parts for OTHER sections are expected (one quote
  // feeds several section files), so they collapse into one expandable line
  // instead of a row each — final fix 7. From scratch, each was picked by
  // hand, so each keeps its own row.
  const otherSectionRows = hasSection && fromBom ? productRows.filter((r) => r.leftOutReason === "other-section") : [];
  if (hasSection) {
    for (const a of sectionArticles) {
      const rows = productRows.filter((r) => !r.leftOutReason && r.placedArticleId === a.id);
      if (rows.length) groups.push({ key: a.id, title: a.title, rows });
    }
    const left = productRows.filter((r) => r.leftOutReason);
    const attention = fromBom ? left.filter((r) => r.leftOutReason !== "other-section") : left;
    if (attention.length || otherSectionRows.length) {
      groups.push({ key: "attention", title: "Needs attention — left out of the Word file", rows: attention, attention: true });
    }
    const waivedRows = productRows.filter((r) => r.waivedReason);
    if (waivedRows.length) groups.push({ key: "waived", title: "Not specified — prints under ITEMS NOT SPECIFIED", rows: waivedRows });
  } else if (productRows.length) {
    groups.push({ key: "all", title: "Products", rows: productRows });
  }

  // ↑/↓ swap two neighbours of one group inside the spec's full order, so
  // every other product keeps its place.
  const move = (rows: SpecProductRow[], i: number, dir: -1 | 1) => {
    const a = rows[i];
    const b = rows[i + dir];
    if (!a || !b) return;
    const order = productRows.map((r) => r.rowKey);
    const ia = order.indexOf(a.rowKey);
    const ib = order.indexOf(b.rowKey);
    [order[ia], order[ib]] = [order[ib], order[ia]];
    run(() => reorderSpecProductsAction(doc.id, order));
  };

  // A removed product goes back into the picker's offer.
  const remove = (r: SpecProductRow) =>
    run(
      () => removeSpecProductAction(doc.id, r.rowKey),
      () => setAdded((a) => a.filter((s) => s.toUpperCase() !== r.sku.toUpperCase()))
    );

  const onPick = async (p: SpecPickerPart): Promise<void> => {
    // With text from another section: pick a header first. Otherwise add it
    // as is — a part without a spec lands as an unresolved row whose
    // Write new spec writes a Spec Library record (Task 9).
    if (!(p.hasSpec && !p.inSection)) {
      try {
        const r = await track(() => addSpecProductAction(doc.id, p.sku));
        if (!r.ok) {
          setErr(r.error);
          return;
        }
      } catch {
        setErr("Could not add the part. Try again.");
        return;
      }
      setErr("");
      setAdded((a) => [...a, p.sku]);
      router.refresh();
      return;
    }
    setHeaderFor(p);
  };

  const reasonLine = (r: SpecProductRow) => {
    switch (r.leftOutReason) {
      case "needs-header":
        return (
          <span style={{ ...WARN, display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            Pick a header
            {canEdit && <HeaderSelect docId={doc.id} row={r} sectionArticles={sectionArticles} run={run} pending={pending} />}
          </span>
        );
      case "other-section":
        if (r.otherSectionNumber) return <span style={WARN}>Belongs to section {r.otherSectionNumber}</span>;
        return (
          <span style={{ ...WARN, display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            Belongs to {r.otherArticleTitle || "another article"}&apos;s section — Use a header here
            {canEdit && <HeaderSelect docId={doc.id} row={r} sectionArticles={sectionArticles} run={run} pending={pending} />}
          </span>
        );
      case "not-in-catalog":
        return <span style={WARN}>Part no longer in catalog</span>;
      case "no-match":
      case "ambiguous":
      case "draft":
        return <span style={WARN}>{REASON_TEXT[r.leftOutReason]}</span>;
      default:
        return null;
    }
  };

  const productRow = (r: SpecProductRow, i: number, rows: SpecProductRow[]) => {
    const state = rowState(r);
    // A row the Spec Library speaks for: its title is the record's, never
    // the catalog part's legacy specTitle, and it has no header picker (a
    // record's placement is its own article).
    const record = isRecordState(state);
    const heading = record ? r.recordTitle || r.desc : r.specTitle || r.desc;
    const subtitle = record ? (r.recordTitle && r.desc && r.recordTitle !== r.desc ? r.desc : "") : r.specTitle && r.desc && r.specTitle !== r.desc ? r.desc : "";
    return (
    <div key={r.rowKey} style={ROW}>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
          {r.sku && <span style={SKU}>{r.sku}</span>}
          <span style={{ fontSize: 13, color: "#16181b" }}>{heading || "—"}</span>
          {fromBom && r.qty != null && <span style={{ ...MUTED, fontFamily: "var(--font-mono)" }}>Qty {r.qty}</span>}
          {state === "legacy" && <Chip tone="plain">Legacy text</Chip>}
          {state === "legacy" && r.match?.status === "legacy" && r.match.draftSpecId && (
            <span style={MUTED}>Has a draft spec ({r.match.draftSpecId}) — approve it in the Spec Library to replace the legacy text</span>
          )}
        </div>
        {subtitle && <div style={MUTED}>{subtitle}</div>}
        {record ? (
          <RecordRowStatus
            doc={doc}
            row={r}
            recordsById={recordsById}
            recordTexts={recordTexts}
            sectionArticles={sectionArticles}
            systemMatchKeys={systemMatchKeys}
            canEdit={canEdit}
          />
        ) : (
          <>
            {r.leftOutReason && <div style={{ marginTop: 3 }}>{reasonLine(r)}</div>}
            {r.waivedReason && <div style={{ ...MUTED, marginTop: 3 }}>Waived — {r.waivedReason}</div>}
          </>
        )}
      </div>
      {canEdit && (
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <button type="button" className="pk-btn-outline" style={SMALL_BTN} disabled={pending || i === 0} onClick={() => move(rows, i, -1)} aria-label={`Move ${rowName(r)} up`}>
            ↑
          </button>
          <button
            type="button"
            className="pk-btn-outline"
            style={SMALL_BTN}
            disabled={pending || i === rows.length - 1}
            onClick={() => move(rows, i, 1)}
            aria-label={`Move ${rowName(r)} down`}
          >
            ↓
          </button>
          <button type="button" className="pk-btn-outline" style={SMALL_BTN} disabled={pending} onClick={() => remove(r)}>
            Remove
          </button>
        </div>
      )}
    </div>
    );
  };

  return (
    <div className="pk-card" style={CARD}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={CARD_TITLE}>Products</div>
          <div style={CARD_SUB}>Part 2, grouped under this section&apos;s headers in print order.</div>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          {fromBom && (
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "#3a3f4a", cursor: canEdit ? "pointer" : "default" }}>
              <input
                type="checkbox"
                checked={doc.printQuantities}
                disabled={!canEdit || pending}
                onChange={(e) => {
                  const on = e.target.checked;
                  run(() => setSpecPrintQuantitiesAction(doc.id, on));
                }}
              />
              Print quantities
            </label>
          )}
          {canEdit && hasSection && picker !== "catalog" && (
            <button type="button" className="pk-btn-accent" onClick={() => setPicker("catalog")}>
              + Add product
            </button>
          )}
          {canEdit && hasSection && picker !== "library" && (
            <button type="button" className="pk-btn-outline" onClick={() => setPicker("library")}>
              Add from Spec Library
            </button>
          )}
        </div>
      </div>

      {hasSection && sectionArticles.length === 0 && (
        <div style={{ ...WARN, marginBottom: 8 }}>
          This section has no Part 2 headers in the library yet, so no product can be placed. Add one in the{" "}
          <Link href={`/design/specs/library/${encodeURIComponent(doc.sectionId)}`} style={{ color: "var(--accent)" }}>
            section editor
          </Link>
          .
        </div>
      )}

      {groups.length === 0 && <div style={MUTED}>No products yet{canEdit && hasSection ? " — + Add product picks parts with approved specs." : "."}</div>}

      {groups.map((g) => (
        <div key={g.key} style={{ marginTop: 10 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: g.attention ? "#8a6d1f" : "#3a3f4a", marginBottom: 2 }}>{g.title}</div>
          {g.rows.map((r, i) => productRow(r, i, g.rows))}
          {g.attention && otherSectionRows.length > 0 && (
            <details style={{ marginTop: 6 }}>
              <summary style={{ ...WARN, cursor: "pointer", padding: "6px 0" }}>
                {otherSectionRows.length} part{otherSectionRows.length === 1 ? "" : "s"} from this{" "}
                {doc.source.kind === "grid" ? "Grid design" : "quote"} belong{otherSectionRows.length === 1 ? "s" : ""} to other sections
              </summary>
              {otherSectionRows.map((r, i) => productRow(r, i, otherSectionRows))}
            </details>
          )}
        </div>
      ))}

      {err && (
        <div role="alert" style={{ ...ERR, marginTop: 10 }}>
          {err}
        </div>
      )}

      {picker === "catalog" && canEdit && <Picker docId={doc.id} hidden={added} onPick={onPick} onClose={() => setPicker("")} />}
      {picker === "library" && canEdit && section && (
        <LibraryPicker docId={doc.id} sectionNumber={section.number} onSpec={librarySpecIds} onClose={() => setPicker("")} />
      )}

      {headerFor && (
        <HeaderPickDialog
          docId={doc.id}
          part={headerFor}
          sectionArticles={sectionArticles}
          onClose={closeHeader}
          onDone={(sku) => {
            setAdded((a) => [...a, sku]);
            setHeaderFor(null);
            setErr("");
          }}
        />
      )}
    </div>
  );
}

function ChecklistCard({ assembled, doc, canEdit }: { assembled: AssembledSection; doc: SpecDocument; canEdit: boolean }) {
  const c = assembled.checklist;
  const n = c.fillInsLeft;
  const m = c.leftOut.length;
  return (
    <div className="pk-card" style={CARD}>
      <div style={CARD_TITLE}>Checklist</div>
      <div style={CARD_SUB}>What&apos;s still open. None of it stops the download.</div>
      <div style={{ display: "flex", gap: 18, flexWrap: "wrap", fontSize: 13 }}>
        <span style={{ color: n ? "#8a6d1f" : "#1f7a52", fontWeight: 600 }}>
          {n} fill-in{n === 1 ? "" : "s"} left
        </span>
        <span style={{ color: m ? "#8a6d1f" : "#1f7a52", fontWeight: 600 }}>
          {m} product{m === 1 ? "" : "s"} left out
        </span>
      </div>
      {m > 0 && (
        <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 12.5, color: "#3a3f4a" }}>
          {c.leftOut.map((l) => (
            <li key={l.rowKey}>
              <span style={SKU}>{l.sku || l.desc}</span> — {REASON_TEXT[l.reason]}
            </li>
          ))}
        </ul>
      )}
      <JobValuesGroup docId={doc.id} answers={doc.fillIns} labels={doc.fillInLabels} checklist={c} canEdit={canEdit} />
      {assembled.warnings.length > 0 && (
        <div style={{ marginTop: 10 }}>
          {assembled.warnings.map((w, i) => (
            <div key={i} style={MUTED}>
              {w}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Download Word — while a save is in flight it dims (aria-busy) and a click
 *  waits for the saves to land, then downloads, so the file never misses the
 *  last edit. The label never changes, so the button can't shift width
 *  between a blur-save's mousedown and the click's mouseup. */
function DownloadLink({ href, saving, onClick }: { href: string; saving: boolean; onClick: (e: MouseEvent<HTMLAnchorElement>) => void }) {
  return (
    <a
      href={href}
      download
      className="pk-btn-accent"
      aria-busy={saving || undefined}
      title={saving ? "Saving — the download starts when it's done" : undefined}
      onClick={onClick}
      style={{ textDecoration: "none", opacity: saving ? 0.6 : 1, cursor: saving ? "progress" : "pointer" }}
    >
      Download Word
    </a>
  );
}

export default function Builder({
  doc,
  section,
  assembled,
  sectionArticles,
  productRows,
  customerOptions,
  canEdit,
  sourceQuoteNumber,
  projectSpecCount,
  recordsById,
  recordTexts,
  systemMatchKeys,
}: {
  doc: SpecDocument;
  section: { id: string; number: string; title: string } | null;
  assembled: AssembledSection | null;
  sectionArticles: ArticleOption[];
  productRows: SpecProductRow[];
  customerOptions: CustomerComboboxOption[];
  canEdit: boolean;
  /** #223 — the source quote's estimate number (null: no quote / unknown). */
  sourceQuoteNumber: string | null;
  /** Other saved specs sharing this spec's project number (0 for viewers). */
  projectSpecCount: number;
  /** Spec records (Task 9): the records this spec refers to, slim. */
  recordsById: Record<string, SlimSpecRecord>;
  /** Library title/text of each matched record — the Edit panel's start. */
  recordTexts: Record<string, { title: string; specText: string }>;
  /** System records' match keys — Write new spec's suggestions. */
  systemMatchKeys: string[];
}) {
  const router = useRouter();
  const downloadHref = `/api/spec-documents/${encodeURIComponent(doc.id)}/docx`;

  // Saves in flight across every card (SaveTracker). A Download click while
  // any are pending is queued and fires when the count returns to zero.
  const [saving, setSaving] = useState(0);
  const inFlight = useRef(0);
  const queued = useRef(false);
  const bump = useCallback(
    (delta: number, failed?: boolean) => {
      inFlight.current = Math.max(0, inFlight.current + delta);
      setSaving(inFlight.current);
      // A failed save cancels a queued download: the error is on screen and
      // the file would miss the edit — the owner clicks again when ready.
      if (failed) queued.current = false;
      if (inFlight.current === 0 && queued.current) {
        queued.current = false;
        // A file download, not a page: click a throwaway download link —
        // attached to the document for the click (some browsers ignore a
        // click on a detached anchor), then removed.
        const link = document.createElement("a");
        link.href = downloadHref;
        link.download = "";
        link.style.display = "none";
        document.body.appendChild(link);
        link.click();
        link.remove();
      }
    },
    [downloadHref]
  );
  const onDownload = (e: MouseEvent<HTMLAnchorElement>) => {
    if (inFlight.current > 0) {
      e.preventDefault();
      queued.current = true;
    }
  };

  return (
    <SaveTracker.Provider value={bump}>
      <div className="pk-content" style={{ maxWidth: 980, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 18 }}>
          <div>
            <Link href="/design/specs" style={{ fontSize: 12, color: "#8c919c", textDecoration: "none" }}>
              ← Specs
            </Link>
            <div className="pk-page-title" style={{ marginTop: 6 }}>
              <span style={{ fontFamily: "var(--font-mono)" }}>{doc.id}</span>
              {section ? ` · ${section.number} ${section.title}` : ""}
            </div>
            <div className="pk-page-sub">Fill it in top to bottom — everything saves as you go. Download Word when it looks right.</div>
          </div>
          {section && <DownloadLink href={downloadHref} saving={saving > 0} onClick={onDownload} />}
        </div>

        {!section && (
          <div className="pk-card" style={{ ...CARD, background: "#fbf3dd", borderColor: "#f0e2bd", color: "#8a6d1f", fontSize: 13 }}>
            This section is no longer in the library, so this spec can&apos;t be previewed or downloaded. Its header and product
            list are kept below.
          </div>
        )}

        <HeaderCard
          doc={doc}
          customerOptions={customerOptions}
          canEdit={canEdit}
          sourceQuoteNumber={sourceQuoteNumber}
          projectSpecCount={projectSpecCount}
        />

        {assembled && <FillInsCard docId={doc.id} answers={doc.fillIns} labels={doc.fillInLabels} checklist={assembled.checklist} canEdit={canEdit} />}

        <ProductsCard
          doc={doc}
          section={section}
          sectionArticles={sectionArticles}
          productRows={productRows}
          canEdit={canEdit}
          recordsById={recordsById}
          recordTexts={recordTexts}
          systemMatchKeys={systemMatchKeys}
        />

        {assembled && <ChecklistCard assembled={assembled} doc={doc} canEdit={canEdit} />}

        {section && assembled && (
          <div className="pk-card" style={CARD}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
              <div>
                <div style={CARD_TITLE}>Preview</div>
                <div style={{ ...MUTED, fontFamily: "var(--font-mono)" }}>{specFileName(doc.header, section)}</div>
              </div>
              <DownloadLink href={downloadHref} saving={saving > 0} onClick={onDownload} />
            </div>
            <Preview assembled={assembled} />
          </div>
        )}

        {canEdit && (
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
            <ConfirmButton
              label="Delete spec"
              confirmLabel="Delete this spec"
              onConfirm={async () => {
                const r = await deleteSpecDocumentAction(doc.id);
                if (!r.ok) throw new Error(r.error);
                router.push("/design/specs");
              }}
            />
          </div>
        )}
      </div>
    </SaveTracker.Provider>
  );
}
