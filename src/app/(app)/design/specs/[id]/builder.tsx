"use client";

import { useEffect, useRef, useState, useTransition, type CSSProperties } from "react";
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
import { CARD, CARD_SUB, CARD_TITLE, ERR, FillInsCard, HeaderCard, MUTED } from "./header-fields";
import Preview from "./preview";

/**
 * #205 Phase B (T5) — the spec builder, top to bottom: Header, Fill-ins,
 * Products (+ Add product picker, Write spec), Checklist, Preview + Download
 * Word, Delete. Everything saves as it changes through the builder's server
 * actions; router.refresh() re-runs the page's assembly so the preview and
 * checklist always show what the Word file will hold. Nothing here blocks the
 * download — gaps are listed, never enforced (design decision 4).
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
  specArticleId: string | null;
  specTitle: string;
  specBody: string;
  specSort: number | null;
  /** The part carries spec text of its own (a draft counts). */
  hasOwnText: boolean;
};

type ActionResult = { ok: true } | { ok: false; error: string };
type ArticleOption = { id: string; title: string };

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

/** Run one save; surface its error, refresh on success. */
function useRun() {
  const router = useRouter();
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<ActionResult>, onOk?: () => void) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) {
        setErr(r.error);
        return;
      }
      setErr("");
      onOk?.();
      router.refresh();
    });
  return { err, setErr, pending, run };
}

/** The part a Write spec box is for — a picker result or a product row. */
type WriteTarget = {
  sku: string;
  desc: string;
  specArticleId: string | null;
  /** The part's resolved article (own or category default), any section. */
  resolvedArticleId: string | null;
  specTitle: string;
  specBody: string;
  specSort: number | null;
  /** Needs spec text written (false = it has an approved spec already). */
  needsText: boolean;
  /** Needs a header in this section picked (false = it has one). */
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
  const [title, setTitle] = useState(target.specTitle);
  const [body, setBody] = useState(target.specBody);
  const [header, setHeader] = useState("");
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();

  const save = () => {
    setErr("");
    if (target.needsText && !body.trim()) {
      setErr("Write the spec text first.");
      return;
    }
    start(async () => {
      if (target.needsText) {
        // Keep the part's own article; a part with no article at all adopts
        // the header picked here. A part whose category puts it in another
        // section keeps that — the header below goes on this spec only.
        const specArticleId = target.specArticleId || (!target.resolvedArticleId && header ? header : undefined);
        const w = await writePartSpecFieldsAction({
          sku: target.sku,
          specArticleId,
          specTitle: title,
          specBody: body,
          ...(target.specSort != null ? { specSort: target.specSort } : {}),
        });
        if (!w.ok) {
          setErr(w.error);
          return;
        }
      }
      if (target.addToSpec) {
        const a = await addSpecProductAction(docId, target.sku, target.needsHeader && header ? header : undefined);
        if (!a.ok) {
          setErr(a.error);
          return;
        }
      }
      onDone(target.sku);
    });
  };

  return (
    <div className="pk-modal-scrim" onClick={onClose}>
      <div className="pk-modal" style={{ width: 620 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 2 }}>{target.needsText ? "Write spec" : "Pick a header"}</div>
        <div style={{ ...MUTED, marginBottom: 14 }}>
          <span style={SKU}>{target.sku}</span> {target.desc}
        </div>

        {target.needsText && (
          <>
            <div style={{ ...MUTED, marginBottom: 12 }}>
              This text is saved to the part in the catalog, so every future spec gets it too.
              {target.specBody.trim() && " The part already has draft text — review it; saving approves it."}
            </div>
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

        {target.needsHeader && (
          <>
            <label className="pk-field-label" htmlFor="write-spec-header" style={{ display: "block" }}>
              Header in this spec
            </label>
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
      const r = await searchSpecPartsAction(docId, q, showAll);
      if (mine !== seq.current) return;
      setLoading(false);
      if (r.ok) {
        setResults(r.parts);
        setErr("");
      } else setErr(r.error);
    }, 250);
    return () => clearTimeout(t);
  }, [docId, q, showAll]);

  const pick = async (p: SpecPickerPart) => {
    setBusySku(p.sku);
    await onPick(p);
    setBusySku("");
  };
  const shown = results.filter((r) => !hidden.includes(r.sku));

  return (
    <div style={{ border: "1px solid #eceef2", borderRadius: 10, padding: 14, marginTop: 12, background: "#fafbfc" }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
        <input
          className="pk-input"
          autoFocus
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
        <div role="alert" style={ERR}>
          {err}
        </div>
      )}
      <div style={{ maxHeight: 360, overflowY: "auto", background: "#fff", border: "1px solid #f0f1f4", borderRadius: 8 }}>
        {loading && shown.length === 0 && <div style={{ ...MUTED, padding: 12 }}>Searching…</div>}
        {!loading && shown.length === 0 && (
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

function HeaderSelect({ docId, sku, sectionArticles, run }: { docId: string; sku: string; sectionArticles: ArticleOption[]; run: ReturnType<typeof useRun>["run"] }) {
  return (
    <select
      className="pk-input"
      value=""
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
  const { err, setErr, pending, run } = useRun();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [writing, setWriting] = useState<WriteTarget | null>(null);
  const [added, setAdded] = useState<string[]>([]);
  const fromBom = doc.source.kind !== "scratch";

  const groups: Array<{ key: string; title: string; rows: SpecProductRow[]; attention?: boolean }> = [];
  if (hasSection) {
    for (const a of sectionArticles) {
      const rows = productRows.filter((r) => !r.leftOutReason && r.placedArticleId === a.id);
      if (rows.length) groups.push({ key: a.id, title: a.title, rows });
    }
    const left = productRows.filter((r) => r.leftOutReason);
    if (left.length) groups.push({ key: "attention", title: "Needs attention — left out of the Word file", rows: left, attention: true });
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

  const onPick = async (p: SpecPickerPart): Promise<void> => {
    if (p.hasSpec && p.inSection) {
      const r = await addSpecProductAction(doc.id, p.sku);
      if (!r.ok) {
        setErr(r.error);
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
      specArticleId: p.specArticleId,
      resolvedArticleId: p.articleId,
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
                    specArticleId: r.specArticleId,
                    resolvedArticleId: r.placedArticleId,
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
            {canEdit && <HeaderSelect docId={doc.id} sku={r.sku} sectionArticles={sectionArticles} run={run} />}
          </span>
        );
      case "other-section":
        return (
          <span style={{ ...WARN, display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            Belongs to {r.otherArticleTitle || "another article"}&apos;s section — Use a header here
            {canEdit && <HeaderSelect docId={doc.id} sku={r.sku} sectionArticles={sectionArticles} run={run} />}
          </span>
        );
      case "not-in-catalog":
        return <span style={WARN}>Part no longer in catalog</span>;
      default:
        return null;
    }
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
          {g.rows.map((r, i) => (
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
                  <button type="button" className="pk-btn-outline" style={SMALL_BTN} disabled={pending || i === 0} onClick={() => move(g.rows, i, -1)} aria-label={`Move ${r.sku} up`}>
                    ↑
                  </button>
                  <button
                    type="button"
                    className="pk-btn-outline"
                    style={SMALL_BTN}
                    disabled={pending || i === g.rows.length - 1}
                    onClick={() => move(g.rows, i, 1)}
                    aria-label={`Move ${r.sku} down`}
                  >
                    ↓
                  </button>
                  <button type="button" className="pk-btn-outline" style={SMALL_BTN} disabled={pending} onClick={() => run(() => removeSpecProductAction(doc.id, r.sku))}>
                    Remove
                  </button>
                </div>
              )}
            </div>
          ))}
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
          onClose={() => setWriting(null)}
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

  return (
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
        {section && (
          <a href={downloadHref} download className="pk-btn-accent" style={{ textDecoration: "none" }}>
            Download Word
          </a>
        )}
      </div>

      {!section && (
        <div className="pk-card" style={{ ...CARD, background: "#fbf3dd", borderColor: "#f0e2bd", color: "#8a6d1f", fontSize: 13 }}>
          This section is no longer in the library, so this spec can&apos;t be previewed or downloaded. Its header and product
          list are kept below.
        </div>
      )}

      <HeaderCard doc={doc} customerOptions={customerOptions} canEdit={canEdit} />

      {assembled && <FillInsCard docId={doc.id} answers={doc.fillIns} checklist={assembled.checklist} canEdit={canEdit} />}

      <ProductsCard doc={doc} hasSection={!!section} sectionArticles={sectionArticles} productRows={productRows} canEdit={canEdit} />

      {assembled && <ChecklistCard assembled={assembled} />}

      {section && assembled && (
        <div className="pk-card" style={CARD}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
            <div>
              <div style={CARD_TITLE}>Preview</div>
              <div style={{ ...MUTED, fontFamily: "var(--font-mono)" }}>{specFileName(doc.header, section)}</div>
            </div>
            <a href={downloadHref} download className="pk-btn-accent" style={{ textDecoration: "none" }}>
              Download Word
            </a>
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
  );
}
