"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { SpecKind } from "@/lib/specs/records";
import type { SpecOverride } from "@/lib/specs/spec-document";
import { SPEC_FILL_IN_MAX, SPEC_OVERRIDE_TEXT_MAX, SPEC_OVERRIDE_TITLE_MAX } from "@/lib/specs/spec-document";
import {
  createRecordFromRowAction,
  linkRowToRecordAction,
  recordUsageAction,
  saveRowOverrideAction,
  searchSpecRecordsAction,
  updateLibraryRecordAction,
  waiveRowAction,
  type SpecRecordHit,
} from "../record-actions";
import { ERR, MUTED, useSave } from "./header-fields";

/**
 * Spec records in the builder (Task 9, spec records design §5.1–§5.2) — the
 * dialogs and inline panels a match-report row opens:
 *
 *   LinkRecordDialog   Link to existing spec — search the Spec Library
 *   WriteRecordDialog  Write new spec — a new `ready` record from the row
 *   WaivePanel         Waive — reason required, prints under ITEMS NOT SPECIFIED
 *   EditRecordPanel    Edit a matched row — This project only / Update the library
 *
 * Never a browser confirm/prompt box (D96): an unsaved-text discard asks inline.
 * Every save goes through the builder's `useSave` (a transition, the error
 * inline, router.refresh() on success, counted by the Download guard).
 */

/** What a dialog needs to know about the row it acts on (a slice of the
 *  builder's SpecProductRow — `rowKey` is the server-computed identity). */
export type RecordRowTarget = {
  rowKey: string;
  sku: string;
  desc: string;
  writeDefaults: { kind: SpecKind; title: string; partNumber: string; manufacturer: string; matchKey: string; specText: string };
};
type ArticleOption = { id: string; title: string };

const SKU: CSSProperties = { fontFamily: "var(--font-mono)", fontSize: 12, color: "#3a3f4a" };
const SMALL_BTN: CSSProperties = { padding: "4px 8px", fontSize: 11.5 };
const WARN: CSSProperties = { fontSize: 12.5, color: "#8a6d1f" };
const PANEL: CSSProperties = { border: "1px solid #eceef2", borderRadius: 10, padding: 12, marginTop: 8, background: "#fafbfc" };
const LABEL: CSSProperties = { display: "block" };
const KIND_LABEL: Record<SpecKind, string> = {
  product_catalog: "Product – catalog",
  product_vendor: "Product – vendor quote",
  system: "System (custom, no part #)",
  companion: "Companion",
};

function rowLabel(row: RecordRowTarget) {
  return (
    <>
      {row.sku && <span style={SKU}>{row.sku}</span>} {row.desc}
    </>
  );
}

/** Escape closes a dialog only when nothing was typed; otherwise it asks
 *  inline first. A click on the scrim never closes. */
function useEscape(dirty: boolean, pending: boolean, onClose: () => void, setAsking: (v: boolean) => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || pending) return;
      if (dirty) setAsking(true);
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dirty, pending, onClose, setAsking]);
}

function DiscardAsk({ onDiscard, onKeep }: { onDiscard: () => void; onKeep: () => void }) {
  return (
    <div role="alert" style={{ ...WARN, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 10 }}>
      Discard what you wrote here?
      <button type="button" className="pk-btn-outline" style={SMALL_BTN} onClick={onDiscard}>
        Discard
      </button>
      <button type="button" className="pk-btn-outline" style={SMALL_BTN} onClick={onKeep}>
        Keep editing
      </button>
    </div>
  );
}

/** Link to existing spec (§5.1): a search over the Spec Library. A row with
 *  a part number adds it to the picked record; a system record sets the
 *  row's match key; otherwise the row is pinned. */
export function LinkRecordDialog({ docId, row, onClose, onDone }: { docId: string; row: RecordRowTarget; onClose: () => void; onDone: () => void }) {
  const { err, pending, run } = useSave();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SpecRecordHit[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchErr, setSearchErr] = useState("");
  const [busyId, setBusyId] = useState("");
  const seq = useRef(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !pending) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending, onClose]);

  // Debounced; an answer that arrives after a newer request is dropped.
  useEffect(() => {
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await searchSpecRecordsAction(q);
        if (mine !== seq.current) return;
        if (r.ok) {
          setResults(r.records);
          setSearchErr("");
        } else setSearchErr(r.error);
      } catch {
        if (mine === seq.current) setSearchErr("Search failed — check your connection and try again.");
      } finally {
        if (mine === seq.current) setLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const link = (specId: string) => {
    setBusyId(specId);
    run(
      () => linkRowToRecordAction(docId, row.rowKey, specId),
      () => onDone()
    );
  };

  return (
    <div className="pk-modal-scrim">
      <div className="pk-modal" role="dialog" aria-modal="true" aria-labelledby="link-record-heading" style={{ width: 640 }}>
        <div id="link-record-heading" style={{ fontSize: 15, fontWeight: 700, marginBottom: 2 }}>
          Link to an existing spec
        </div>
        <div style={{ ...MUTED, marginBottom: 12 }}>{rowLabel(row)}</div>
        <div style={{ ...MUTED, marginBottom: 10 }}>
          A row with a part number adds it to the spec you pick, so the part matches it on every spec from now on.
        </div>
        <input
          className="pk-input"
          autoFocus
          aria-label="Search the Spec Library"
          placeholder="Search by title, spec ID, part number, manufacturer or match key…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ marginBottom: 10 }}
        />
        {searchErr && (
          <div role="alert" style={{ ...ERR, marginBottom: 8 }}>
            {searchErr}
          </div>
        )}
        <div style={{ maxHeight: 360, overflowY: "auto", border: "1px solid #f0f1f4", borderRadius: 8 }}>
          {loading && results.length === 0 && <div style={{ ...MUTED, padding: 12 }}>Searching…</div>}
          {!loading && !searchErr && results.length === 0 && <div style={{ ...MUTED, padding: 12 }}>No specs match.</div>}
          {results.map((h) => (
            <div
              key={h.specId}
              style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 10, alignItems: "center", padding: "8px 12px", borderBottom: "1px solid #f5f6f8" }}
            >
              <div style={{ minWidth: 0 }}>
                <div>
                  <span style={SKU}>{h.specId}</span> <span style={{ fontSize: 12.5, color: "#16181b" }}>{h.title}</span>
                </div>
                <div style={{ fontSize: 11.5, color: "#6b7079" }}>
                  {h.section} · {KIND_LABEL[h.kind]}
                  {h.status === "draft" && <span style={{ color: "#8a6d1f" }}> · Draft</span>}
                  {h.mfrNumbers.length > 0 && <span style={{ fontFamily: "var(--font-mono)" }}> · {h.mfrNumbers.slice(0, 4).join(", ")}{h.mfrNumbers.length > 4 ? "…" : ""}</span>}
                  {h.matchKey && <span> · {h.matchKey}</span>}
                </div>
              </div>
              <button type="button" className="pk-btn-outline" style={SMALL_BTN} disabled={pending} onClick={() => link(h.specId)}>
                {pending && busyId === h.specId ? "Linking…" : "Link"}
              </button>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
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

/** Part numbers typed one per line or comma/semicolon separated. */
function splitNumbers(s: string): string[] {
  return s
    .split(/[\n,;]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

/** Write new spec (§5.1): a new `ready` record in this spec's section,
 *  prefilled from the row. Replaces the builder's old catalog-part Write
 *  spec — the text lives in the Spec Library, not on the part. */
export function WriteRecordDialog({
  docId,
  row,
  sectionArticles,
  systemMatchKeys,
  onClose,
  onDone,
}: {
  docId: string;
  row: RecordRowTarget;
  sectionArticles: ArticleOption[];
  systemMatchKeys: string[];
  onClose: () => void;
  onDone: (specId: string) => void;
}) {
  const { err, setErr, pending, run } = useSave();
  const d = row.writeDefaults;
  const [kind, setKind] = useState<SpecKind>(d.kind);
  const [title, setTitle] = useState(d.title);
  const [numbers, setNumbers] = useState(d.partNumber);
  const [manufacturer, setManufacturer] = useState(d.manufacturer);
  const [basis, setBasis] = useState("");
  const [matchKey, setMatchKey] = useState(d.matchKey);
  const initialArticle = sectionArticles.length === 1 ? sectionArticles[0].id : "";
  const [articleId, setArticleId] = useState(initialArticle);
  // A catalog part's draft legacy text (never approved) is the starting point.
  const [text, setText] = useState(d.specText);
  const [asking, setAsking] = useState(false);
  const dirty =
    text !== d.specText ||
    title !== d.title ||
    basis !== "" ||
    kind !== d.kind ||
    numbers !== d.partNumber ||
    matchKey !== d.matchKey ||
    manufacturer !== d.manufacturer ||
    articleId !== initialArticle;
  useEscape(dirty, pending, onClose, setAsking);
  const isSystem = kind === "system";

  const save = () => {
    setErr("");
    if (!title.trim()) return setErr("Give the spec a title.");
    if (!articleId) return setErr("Pick the header it prints under.");
    if (!text.trim()) return setErr("Write the spec text first.");
    const mfrNumbers = isSystem ? [] : splitNumbers(numbers);
    if (!isSystem && mfrNumbers.length === 0) return setErr("Add at least one part number.");
    if (isSystem && !matchKey.trim()) return setErr("A system spec needs a match key.");
    let specId = "";
    run(
      async () => {
        const r = await createRecordFromRowAction(docId, row.rowKey, {
          title: title.trim(),
          specText: text,
          kind,
          ...(manufacturer.trim() ? { manufacturer: manufacturer.trim() } : {}),
          ...(basis.trim() ? { basisOfDesign: basis.trim() } : {}),
          mfrNumbers,
          ...(isSystem ? { matchKey: matchKey.trim() } : {}),
          sourceArticleId: articleId,
        });
        if (r.ok) specId = r.specId;
        return r;
      },
      () => onDone(specId)
    );
  };

  return (
    <div className="pk-modal-scrim">
      <div className="pk-modal" role="dialog" aria-modal="true" aria-labelledby="write-record-heading" style={{ width: 660 }}>
        <div id="write-record-heading" style={{ fontSize: 15, fontWeight: 700, marginBottom: 2 }}>
          Write new spec
        </div>
        <div style={{ ...MUTED, marginBottom: 12 }}>{rowLabel(row)}</div>
        <div style={{ ...MUTED, marginBottom: 12 }}>
          Saved to the Spec Library, ready to use — every spec with this {isSystem ? "match key" : "part number"} picks it up from now on.
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "10px 12px", marginBottom: 12 }}>
          <div>
            <label className="pk-field-label" htmlFor="write-record-kind" style={LABEL}>
              Kind
            </label>
            <select id="write-record-kind" className="pk-input" value={kind} onChange={(e) => setKind(e.target.value as SpecKind)}>
              {(["product_catalog", "product_vendor", "system"] as const).map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="pk-field-label" htmlFor="write-record-article" style={LABEL}>
              Prints under
            </label>
            <select id="write-record-article" className="pk-input" value={articleId} onChange={(e) => setArticleId(e.target.value)}>
              <option value="">— Pick a header —</option>
              {sectionArticles.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.title}
                </option>
              ))}
            </select>
          </div>
          {isSystem ? (
            <div>
              <label className="pk-field-label" htmlFor="write-record-key" style={LABEL}>
                Match key
              </label>
              <input
                id="write-record-key"
                className="pk-input"
                list="write-record-keys"
                value={matchKey}
                maxLength={200}
                placeholder="e.g. Stage Drapes – Legs"
                onChange={(e) => setMatchKey(e.target.value)}
              />
              <datalist id="write-record-keys">
                {systemMatchKeys.map((k) => (
                  <option key={k} value={k} />
                ))}
              </datalist>
            </div>
          ) : (
            <div>
              <label className="pk-field-label" htmlFor="write-record-numbers" style={LABEL}>
                Part numbers (comma separated; # = one digit 1–5)
              </label>
              <input
                id="write-record-numbers"
                className="pk-input mono"
                value={numbers}
                onChange={(e) => setNumbers(e.target.value)}
              />
            </div>
          )}
          <div>
            <label className="pk-field-label" htmlFor="write-record-mfr" style={LABEL}>
              Manufacturer (optional)
            </label>
            <input id="write-record-mfr" className="pk-input" value={manufacturer} maxLength={200} onChange={(e) => setManufacturer(e.target.value)} />
          </div>
          <div>
            <label className="pk-field-label" htmlFor="write-record-basis" style={LABEL}>
              Basis of design (optional)
            </label>
            <input id="write-record-basis" className="pk-input" value={basis} maxLength={200} onChange={(e) => setBasis(e.target.value)} />
          </div>
        </div>

        <label className="pk-field-label" htmlFor="write-record-title" style={LABEL}>
          Title (the product&apos;s heading in the spec)
        </label>
        <input
          id="write-record-title"
          className="pk-input"
          value={title}
          maxLength={SPEC_OVERRIDE_TITLE_MAX}
          placeholder="e.g. COLOR MIXING LED PROFILE FIXTURE"
          onChange={(e) => setTitle(e.target.value)}
          style={{ marginBottom: 12 }}
        />
        <label className="pk-field-label" htmlFor="write-record-text" style={LABEL}>
          Spec text — one item per line, indent two spaces per level; [brackets] are per-job values
        </label>
        <textarea
          id="write-record-text"
          className="pk-input pk-mono"
          rows={12}
          value={text}
          maxLength={SPEC_OVERRIDE_TEXT_MAX}
          onChange={(e) => setText(e.target.value)}
          style={{ resize: "vertical", marginBottom: 12 }}
        />

        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <button type="button" className="pk-btn-accent" disabled={pending} onClick={save}>
            {pending ? "Saving…" : "Save to Spec Library"}
          </button>
          <button type="button" className="pk-btn-outline" disabled={pending} onClick={() => (dirty ? setAsking(true) : onClose())}>
            Cancel
          </button>
          {err && (
            <span role="alert" style={ERR}>
              {err}
            </span>
          )}
        </div>
        {asking && <DiscardAsk onDiscard={onClose} onKeep={() => setAsking(false)} />}
      </div>
    </div>
  );
}

/** Waive (§5.1) — inline under the row; the reason prints under ITEMS NOT SPECIFIED. */
export function WaivePanel({ docId, row, onClose, onDone }: { docId: string; row: RecordRowTarget; onClose: () => void; onDone: () => void }) {
  const { err, setErr, pending, run } = useSave();
  const [reason, setReason] = useState("");
  const save = () => {
    if (!reason.trim()) return setErr("A reason is required.");
    run(
      () => waiveRowAction(docId, row.rowKey, reason),
      () => onDone()
    );
  };
  return (
    <div style={PANEL}>
      <label className="pk-field-label" htmlFor={`waive-${row.rowKey}`} style={LABEL}>
        Why isn&apos;t it specified? (prints under ITEMS NOT SPECIFIED)
      </label>
      <input
        id={`waive-${row.rowKey}`}
        className="pk-input"
        autoFocus
        value={reason}
        maxLength={SPEC_FILL_IN_MAX}
        placeholder="e.g. Owner furnished, installed by others"
        onChange={(e) => setReason(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") onClose();
        }}
        style={{ marginBottom: 8 }}
      />
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" className="pk-btn-accent" style={SMALL_BTN} disabled={pending} onClick={save}>
          {pending ? "Saving…" : "Waive"}
        </button>
        <button type="button" className="pk-btn-outline" style={SMALL_BTN} disabled={pending} onClick={onClose}>
          Cancel
        </button>
        {err && (
          <span role="alert" style={ERR}>
            {err}
          </span>
        )}
      </div>
    </div>
  );
}

/** Edit a matched row (§5.2) — inline under the row. "This project only"
 *  (default) saves an override on this spec; "Update the library" saves a
 *  new record revision (why required) and shows how many saved specs'
 *  last download used it. */
export function EditRecordPanel({
  docId,
  specId,
  library,
  override,
  onClose,
  onDone,
}: {
  docId: string;
  specId: string;
  /** The record's current library title/text. */
  library: { title: string; specText: string };
  /** This spec's project-only change, when it has one. */
  override?: SpecOverride;
  onClose: () => void;
  onDone: () => void;
}) {
  const { err, setErr, pending, run } = useSave();
  const [title, setTitle] = useState(override?.title || library.title);
  const [text, setText] = useState(override ? override.specText : library.specText);
  const [scope, setScope] = useState<"project" | "library">("project");
  const [why, setWhy] = useState("");
  const [usage, setUsage] = useState<number | null>(null);
  const [usageErr, setUsageErr] = useState("");
  const [asking, setAsking] = useState(false);
  const dirty = title !== (override?.title || library.title) || text !== (override ? override.specText : library.specText);

  // "Used on N saved specs" — information only, fetched the first time the
  // library choice is picked.
  useEffect(() => {
    if (scope !== "library" || usage !== null) return;
    let live = true;
    recordUsageAction(specId)
      .then((r) => {
        if (!live) return;
        if (r.ok) setUsage(r.count);
        else setUsageErr(r.error);
      })
      .catch(() => live && setUsageErr("Couldn't count the specs that use it."));
    return () => {
      live = false;
    };
  }, [scope, usage, specId]);

  const save = () => {
    setErr("");
    if (!title.trim()) return setErr("Title is required.");
    if (!text.trim()) return setErr("Spec text is required.");
    if (scope === "library" && !why.trim()) return setErr("Say why the library changes — it's kept in the spec's history.");
    run(
      () => (scope === "project" ? saveRowOverrideAction(docId, specId, { title, specText: text }) : updateLibraryRecordAction(specId, { title, specText: text }, why)),
      () => onDone()
    );
  };

  const radio = (value: "project" | "library", label: string) => (
    <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "#3a3f4a", cursor: "pointer" }}>
      <input type="radio" name={`edit-scope-${specId}`} checked={scope === value} onChange={() => setScope(value)} />
      {label}
    </label>
  );

  return (
    <div style={PANEL}>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: "#3a3f4a", marginBottom: 8 }}>
        Edit <span style={SKU}>{specId}</span>
      </div>
      <label className="pk-field-label" htmlFor={`edit-title-${specId}`} style={LABEL}>
        Title
      </label>
      <input
        id={`edit-title-${specId}`}
        className="pk-input"
        value={title}
        maxLength={SPEC_OVERRIDE_TITLE_MAX}
        onChange={(e) => setTitle(e.target.value)}
        style={{ marginBottom: 10 }}
      />
      <label className="pk-field-label" htmlFor={`edit-text-${specId}`} style={LABEL}>
        Spec text — indent two spaces per level; [brackets] are per-job values
      </label>
      <textarea
        id={`edit-text-${specId}`}
        className="pk-input pk-mono"
        rows={10}
        value={text}
        maxLength={SPEC_OVERRIDE_TEXT_MAX}
        onChange={(e) => setText(e.target.value)}
        style={{ resize: "vertical", marginBottom: 10 }}
      />
      <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginBottom: 8 }}>
        {radio("project", "This project only")}
        {radio("library", "Update the library")}
      </div>
      {scope === "project" && <div style={{ ...MUTED, marginBottom: 8 }}>Only this spec prints the change. The Spec Library stays as it is.</div>}
      {scope === "library" && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ ...MUTED, marginBottom: 6 }}>
            Every spec using {specId} prints the new text from now on; the old version stays in its history.{" "}
            {usage !== null ? `Used on ${usage} saved spec${usage === 1 ? "" : "s"}.` : usageErr ? usageErr : "Counting the specs that use it…"}
          </div>
          {override && (
            <div style={{ ...WARN, marginBottom: 6 }}>
              This spec has its own changed text for {specId}; it keeps printing that until you choose Use library text.
            </div>
          )}
          <label className="pk-field-label" htmlFor={`edit-why-${specId}`} style={LABEL}>
            Why (kept in the history)
          </label>
          <input
            id={`edit-why-${specId}`}
            className="pk-input"
            value={why}
            maxLength={300}
            placeholder="e.g. Manufacturer updated the lamp spec"
            onChange={(e) => setWhy(e.target.value)}
          />
        </div>
      )}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" className="pk-btn-accent" style={SMALL_BTN} disabled={pending} onClick={save}>
          {pending ? "Saving…" : scope === "project" ? "Save for this project" : "Update the library"}
        </button>
        <button type="button" className="pk-btn-outline" style={SMALL_BTN} disabled={pending} onClick={() => (dirty ? setAsking(true) : onClose())}>
          Cancel
        </button>
        {err && (
          <span role="alert" style={ERR}>
            {err}
          </span>
        )}
      </div>
      {asking && <DiscardAsk onDiscard={onClose} onKeep={() => setAsking(false)} />}
    </div>
  );
}
