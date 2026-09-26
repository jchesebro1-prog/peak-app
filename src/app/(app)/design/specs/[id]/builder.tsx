"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ConfirmButton } from "@/components/confirm-button";
import type { CustomerComboboxOption } from "@/components/customer-combobox";
import type { AssembledSection, LeftOutReason } from "@/lib/specs/assemble-section";
import type { SpecDocument } from "@/lib/specs/spec-document";
import { specFileName } from "@/lib/specs/spec-file-name";
import { writePartSpecFieldsAction } from "@/app/(app)/catalog/actions";
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
import { CARD, CARD_SUB, CARD_TITLE, ERR, FillInsCard, HeaderCard, MUTED, SaveTracker, useSave, type ActionResult } from "./header-fields";
import Preview from "./preview";

/**
 * #205 Phase B (T5) — the spec builder, top to bottom: Header, Fill-ins,
 * Products (+ Add product picker, Write spec), Checklist, Preview + Download
 * Word, Delete. Everything saves as it changes through the builder's server
 * actions; router.refresh() re-runs the page's assembly so the preview and
 * checklist always show what the Word file will hold. Nothing here blocks the
 * download — gaps are listed, never enforced (design decision 4) — but a
 * Download click waits for saves still in flight (SaveTracker).
 *
 * Writing spec text for a part saves it TO THE PART (the catalog Spec
 * panel's writePartSpecFieldsAction), so the next spec gets it for free.
 * That action overwrites every spec field it is handed, so the part's
 * current specArticleId and specSort always go back with it.
 */

export type SpecProductRow = {
  sku: string;
  desc: string;
  qty?: number;
  /** The Part 2 article this product prints under, or null when it can't be placed. */
  placedArticleId: string | null;
  leftOutReason: LeftOutReason | null;
  /** For "other-section": the title of the article the part does belong to. */
  otherArticleTitle: string | null;
  /** The part's own resolved article (explicit or category default), any section. */
  ownArticleId: string | null;
  specArticleId: string | null;
  /** specArticleId names an article that no longer exists. */
  deadArticle: boolean;
  specSameAs: string;
  specTitle: string;
  specBody: string;
  specSort: number | null;
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
const LINK_BTN: CSSProperties = {
  background: "none",
  border: "none",
  padding: 0,
  color: "var(--accent)",
  fontSize: 12.5,
  fontWeight: 600,
  cursor: "pointer",
};
const WARN: CSSProperties = { fontSize: 12.5, color: "#8a6d1f" };

const REASON_TEXT: Record<LeftOutReason, string> = {
  "no-spec": "No approved spec",
  "needs-header": "Pick a header",
  "other-section": "Belongs to another section",
  "not-in-catalog": "Part no longer in catalog",
};

/** The part a Write spec box is for — a picker result or a product row. */
type WriteTarget = {
  sku: string;
  desc: string;
  /** The part's explicit article, when it still exists. */
  specArticleId: string | null;
  /** The part's own resolved article (explicit or category default), any section. */
  ownArticleId: string | null;
  /** The part's explicit article was deleted from the library. */
  deadArticle: boolean;
  specSameAs: string;
  specTitle: string;
  specBody: string;
  specSort: number | null;
  /** Needs spec text written (false = it has an approved spec already). */
  needsText: boolean;
  /** Needs a header in this spec (it isn't in this section on its own). */
  needsHeader: boolean;
  /** Add it to the spec after saving (picker) vs. it is already on it (row). */
  addToSpec: boolean;
};

/** Write a part's spec text (and/or pick its header), then add it to the spec. */
function WriteSpecDialog({
  docId,
  target,
  sectionArticles,
  onClose,
  onDone,
}: {
  docId: string;
  target: WriteTarget;
  sectionArticles: ArticleOption[];
  onClose: () => void;
  onDone: (sku: string) => void;
}) {
  const { track } = useSave();
  const [title, setTitle] = useState(target.specTitle);
  const [body, setBody] = useState(target.specBody);
  const [header, setHeader] = useState("");
  const [err, setErr] = useState("");
  const [pending, setPending] = useState(false);
  const dirty = title !== target.specTitle || body !== target.specBody || header !== "";
  // A dead article needs a new one picked, even when the part is already on the spec.
  const showHeader = target.needsHeader || (target.needsText && target.deadArticle);

  // Escape closes only when nothing was typed; otherwise it asks first. A
  // click on the scrim never closes — it would throw away written text.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || pending) return;
      if (!dirty || window.confirm("Discard what you wrote here?")) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dirty, pending, onClose]);

  const save = async () => {
    setErr("");
    if (target.needsText && !body.trim()) {
      setErr("Write the spec text first.");
      return;
    }
    setPending(true);
    try {
      await track(async (): Promise<ActionResult> => {
        if (target.needsText) {
          // Keep the part's own (live) article; a part with no article at all
          // — or a deleted one — adopts the header picked here. A part whose
          // category puts it in another section keeps that; the header then
          // goes on this spec only.
          const specArticleId = target.specArticleId || (!target.ownArticleId && header ? header : undefined);
          const w = await writePartSpecFieldsAction({
            sku: target.sku,
            specArticleId,
            specTitle: title,
            specBody: body,
            ...(target.specSort != null ? { specSort: target.specSort } : {}),
          });
          if (!w.ok) {
            setErr(w.error);
            return w;
          }
        }
        if (target.addToSpec) {
          const a = await addSpecProductAction(docId, target.sku, target.needsHeader && header ? header : undefined);
          if (!a.ok) {
            setErr(a.error);
            return a;
          }
        }
        onDone(target.sku);
        return { ok: true };
      });
    } catch {
      setErr("Could not save. Try again.");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="pk-modal-scrim">
      <div className="pk-modal" role="dialog" aria-modal="true" aria-labelledby="write-spec-heading" style={{ width: 620 }}>
        <div id="write-spec-heading" style={{ fontSize: 15, fontWeight: 700, marginBottom: 2 }}>
          {target.needsText ? "Write spec" : "Pick a header"}
        </div>
        <div style={{ ...MUTED, marginBottom: 14 }}>
          <span style={SKU}>{target.sku}</span> {target.desc}
        </div>

        {target.needsText && (
          <>
            <div style={{ ...MUTED, marginBottom: 12 }}>
              This text is saved to the part in the catalog, so every future spec gets it too.
              {target.specBody.trim() && " The part already has draft text — review it; saving approves it."}
            </div>
            {target.specSameAs && (
              <div style={{ ...WARN, marginBottom: 12 }}>This replaces the &apos;same as {target.specSameAs}&apos; link.</div>
            )}
            <label className="pk-field-label" htmlFor="write-spec-title" style={{ display: "block" }}>
              Title (the product&apos;s heading in the spec)
            </label>
            <input
              id="write-spec-title"
              className="pk-input"
              value={title}
              placeholder={target.desc || "e.g. COLOR MIXING LED PROFILE FIXTURE"}
              onChange={(e) => setTitle(e.target.value)}
              style={{ marginBottom: 12 }}
            />
            <label className="pk-field-label" htmlFor="write-spec-body" style={{ display: "block" }}>
              Spec text — one item per line, indent two spaces per level
            </label>
            <textarea
              id="write-spec-body"
              className="pk-input pk-mono"
              rows={12}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              style={{ resize: "vertical", marginBottom: 12 }}
            />
          </>
        )}

        {showHeader && (
          <>
            <label className="pk-field-label" htmlFor="write-spec-header" style={{ display: "block" }}>
              Header in this spec
            </label>
            {target.deadArticle && (
              <div style={{ ...MUTED, marginBottom: 6 }}>This part&apos;s header was deleted from the library — pick one from this section.</div>
            )}
            <select id="write-spec-header" className="pk-input" value={header} onChange={(e) => setHeader(e.target.value)} style={{ marginBottom: 12 }}>
              <option value="">— Decide later —</option>
              {sectionArticles.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.title}
                </option>
              ))}
            </select>
          </>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <button type="button" className="pk-btn-accent" disabled={pending} onClick={save}>
            {pending ? "Saving…" : target.addToSpec ? (target.needsText ? "Save spec and add" : "Add") : "Save spec"}
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
          ? "Every catalog part. A part without a spec asks you to write one; a part from another section asks for a header."
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
  sku,
  sectionArticles,
  run,
  pending,
}: {
  docId: string;
  sku: string;
  sectionArticles: ArticleOption[];
  run: RunFn;
  pending: boolean;
}) {
  return (
    <select
      className="pk-input"
      aria-label={`Header for ${sku}`}
      value=""
      disabled={pending}
      onChange={(e) => e.target.value && run(() => setSpecProductHeaderAction(docId, sku, e.target.value))}
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
  hasSection,
  sectionArticles,
  productRows,
  canEdit,
}: {
  doc: SpecDocument;
  hasSection: boolean;
  sectionArticles: ArticleOption[];
  productRows: SpecProductRow[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const { err, setErr, pending, run, track } = useSave();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [writing, setWriting] = useState<WriteTarget | null>(null);
  const [added, setAdded] = useState<string[]>([]);
  const fromBom = doc.source.kind !== "scratch";
  const closeWriting = useCallback(() => setWriting(null), []);

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
  } else if (productRows.length) {
    groups.push({ key: "all", title: "Products", rows: productRows });
  }

  // ↑/↓ swap two neighbours of one group inside the spec's full order, so
  // every other product keeps its place.
  const move = (rows: SpecProductRow[], i: number, dir: -1 | 1) => {
    const a = rows[i];
    const b = rows[i + dir];
    if (!a || !b) return;
    const order = productRows.map((r) => r.sku);
    const ia = order.indexOf(a.sku);
    const ib = order.indexOf(b.sku);
    [order[ia], order[ib]] = [order[ib], order[ia]];
    run(() => reorderSpecProductsAction(doc.id, order));
  };

  // A removed product goes back into the picker's offer.
  const remove = (sku: string) =>
    run(
      () => removeSpecProductAction(doc.id, sku),
      () => setAdded((a) => a.filter((s) => s.toUpperCase() !== sku.toUpperCase()))
    );

  const onPick = async (p: SpecPickerPart): Promise<void> => {
    if (p.hasSpec && p.inSection) {
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
    setWriting({
      sku: p.sku,
      desc: p.desc,
      specArticleId: p.articleId ? p.specArticleId : null,
      ownArticleId: p.articleId,
      deadArticle: !!p.specArticleId && !p.articleId,
      specSameAs: p.specSameAs,
      specTitle: p.specTitle,
      specBody: p.specBody,
      specSort: p.specSort,
      needsText: !p.hasSpec,
      needsHeader: !p.inSection,
      addToSpec: true,
    });
  };

  const reasonLine = (r: SpecProductRow) => {
    switch (r.leftOutReason) {
      case "no-spec":
        return (
          <span style={WARN}>
            No approved spec —{" "}
            {canEdit ? (
              <button
                type="button"
                style={LINK_BTN}
                onClick={() =>
                  setWriting({
                    sku: r.sku,
                    desc: r.desc,
                    specArticleId: r.deadArticle ? null : r.specArticleId,
                    ownArticleId: r.ownArticleId,
                    deadArticle: r.deadArticle,
                    specSameAs: r.specSameAs,
                    specTitle: r.specTitle,
                    specBody: r.specBody,
                    specSort: r.specSort,
                    needsText: true,
                    needsHeader: false,
                    addToSpec: false,
                  })
                }
              >
                Write spec
              </button>
            ) : (
              "write one in the catalog"
            )}
          </span>
        );
      case "needs-header":
        return (
          <span style={{ ...WARN, display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            Pick a header
            {canEdit && <HeaderSelect docId={doc.id} sku={r.sku} sectionArticles={sectionArticles} run={run} pending={pending} />}
          </span>
        );
      case "other-section":
        return (
          <span style={{ ...WARN, display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            Belongs to {r.otherArticleTitle || "another article"}&apos;s section — Use a header here
            {canEdit && <HeaderSelect docId={doc.id} sku={r.sku} sectionArticles={sectionArticles} run={run} pending={pending} />}
          </span>
        );
      case "not-in-catalog":
        return <span style={WARN}>Part no longer in catalog</span>;
      default:
        return null;
    }
  };

  const productRow = (r: SpecProductRow, i: number, rows: SpecProductRow[]) => (
    <div key={r.sku} style={ROW}>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
          <span style={SKU}>{r.sku}</span>
          <span style={{ fontSize: 13, color: "#16181b" }}>{r.specTitle || r.desc || "—"}</span>
          {fromBom && r.qty != null && <span style={{ ...MUTED, fontFamily: "var(--font-mono)" }}>Qty {r.qty}</span>}
        </div>
        {r.specTitle && r.desc && r.specTitle !== r.desc && <div style={MUTED}>{r.desc}</div>}
        {r.leftOutReason && <div style={{ marginTop: 3 }}>{reasonLine(r)}</div>}
      </div>
      {canEdit && (
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <button type="button" className="pk-btn-outline" style={SMALL_BTN} disabled={pending || i === 0} onClick={() => move(rows, i, -1)} aria-label={`Move ${r.sku} up`}>
            ↑
          </button>
          <button
            type="button"
            className="pk-btn-outline"
            style={SMALL_BTN}
            disabled={pending || i === rows.length - 1}
            onClick={() => move(rows, i, 1)}
            aria-label={`Move ${r.sku} down`}
          >
            ↓
          </button>
          <button type="button" className="pk-btn-outline" style={SMALL_BTN} disabled={pending} onClick={() => remove(r.sku)}>
            Remove
          </button>
        </div>
      )}
    </div>
  );

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
          {canEdit && hasSection && !pickerOpen && (
            <button type="button" className="pk-btn-accent" onClick={() => setPickerOpen(true)}>
              + Add product
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

      {pickerOpen && canEdit && <Picker docId={doc.id} hidden={added} onPick={onPick} onClose={() => setPickerOpen(false)} />}

      {writing && (
        <WriteSpecDialog
          docId={doc.id}
          target={writing}
          sectionArticles={sectionArticles}
          onClose={closeWriting}
          onDone={(sku) => {
            if (writing.addToSpec) setAdded((a) => [...a, sku]);
            setWriting(null);
            setErr("");
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function ChecklistCard({ assembled }: { assembled: AssembledSection }) {
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
            <li key={l.sku}>
              <span style={SKU}>{l.sku}</span> — {REASON_TEXT[l.reason]}
            </li>
          ))}
        </ul>
      )}
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
}: {
  doc: SpecDocument;
  section: { id: string; number: string; title: string } | null;
  assembled: AssembledSection | null;
  sectionArticles: ArticleOption[];
  productRows: SpecProductRow[];
  customerOptions: CustomerComboboxOption[];
  canEdit: boolean;
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

        <HeaderCard doc={doc} customerOptions={customerOptions} canEdit={canEdit} />

        {assembled && <FillInsCard docId={doc.id} answers={doc.fillIns} labels={doc.fillInLabels} checklist={assembled.checklist} canEdit={canEdit} />}

        <ProductsCard doc={doc} hasSection={!!section} sectionArticles={sectionArticles} productRows={productRows} canEdit={canEdit} />

        {assembled && <ChecklistCard assembled={assembled} />}

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
