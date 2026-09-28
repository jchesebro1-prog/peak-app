"use client";

import { useMemo, useState, useTransition, type CSSProperties } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { restoreSpecRecordRevisionAction, saveSpecRecordAction } from "../../../record-actions";
import { csiKey } from "@/lib/specs/articles";
import {
  KIND_LABELS,
  SPEC_KINDS,
  SPEC_STATUSES,
  matchKeyConflict,
  normalizeSpecRecord,
  partNumberConflict,
  sameSpecContent,
  validateSpecRecord,
  type SpecKind,
  type SpecRecord,
  type SpecStatus,
} from "@/lib/specs/records";

/**
 * Spec records Task 10 — the Spec Library record editor (design §7): every
 * field, kind-aware (part numbers one per line for product kinds, a match
 * key for system specs, an include-with picker for companions, the article
 * select limited to the chosen section's articles), status (archive =
 * status), a why-note required when editing an existing record, live
 * validation + conflict problems inline, and the revision history with an
 * inline "Restore revision N? Restore / Cancel" (no browser dialogs, D96).
 *
 * Imports only the two record actions and pure modules — no stores, no
 * exceljs, no record-io (a client import of those breaks `next build`).
 *
 * The form is keyed on the record's revision by its parent, so a save or a
 * restore (both bump the revision) remounts it on the saved content; the
 * notice line lives in the parent and survives that remount.
 */

export type EditorSection = { id: string; number: string; title: string };
export type EditorArticle = { id: string; sectionId: string; title: string; sort: number };
export type EditorOther = {
  specId: string;
  title: string;
  kind: SpecKind;
  status: SpecStatus;
  mfrNumbers: string[];
  matchKey: string | null;
};
export type EditorHistoryEntry = {
  revision: number;
  atLabel: string;
  by: string;
  why: string;
  current: boolean;
  record: SpecRecord;
};

const CARD: CSSProperties = { padding: "16px 18px", marginBottom: 18 };
const H: CSSProperties = { fontSize: 14.5, fontWeight: 600, marginBottom: 12 };
const LBL: CSSProperties = {
  display: "block",
  fontSize: 10.5,
  fontWeight: 600,
  color: "#9aa0ab",
  letterSpacing: ".05em",
  textTransform: "uppercase",
  marginBottom: 5,
};
const EXPLAIN: CSSProperties = { fontSize: 11.5, color: "#8c919c", marginTop: 5, lineHeight: 1.4 };
const FIELD_ERR: CSSProperties = { fontSize: 11.5, color: "#b4543a", marginTop: 5, lineHeight: 1.4 };
const NOTE: CSSProperties = { fontSize: 11.5, color: "#9a6b12", marginTop: 5, lineHeight: 1.4 };
const ERR: CSSProperties = { fontSize: 12, color: "#b4543a" };
const SAVED: CSSProperties = { fontSize: 12, color: "#1f7a52", fontWeight: 600 };
const MONO: CSSProperties = { fontFamily: "var(--font-mono)" };
const GRID2: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14, marginBottom: 14 };
const PRE: CSSProperties = {
  margin: 0,
  fontFamily: "var(--font-mono)",
  fontSize: 12,
  background: "#fafbfc",
  border: "1px solid #f0f1f4",
  borderRadius: 9,
  padding: "10px 12px",
  whiteSpace: "pre-wrap",
  maxHeight: 360,
  overflowY: "auto",
};

const STATUS_LABEL: Record<SpecStatus, string> = { draft: "Draft", ready: "Ready", archived: "Archived" };
const isProduct = (k: SpecKind) => k === "product_catalog" || k === "product_vendor";

/** A slim other-record as the full shape the pure conflict guards take —
 *  they only read specId/kind/status/mfrNumbers/matchKey. */
function asRecord(o: EditorOther): SpecRecord {
  return {
    ...o,
    section: "",
    article: "",
    basisOfDesign: null,
    manufacturer: null,
    includeWith: [],
    specText: "",
    notes: null,
    sourceArticleId: null,
    revision: 1,
    updatedAt: 0,
    updatedBy: "",
  };
}

type Props = {
  mode: "new" | "edit";
  record: SpecRecord;
  history: EditorHistoryEntry[];
  sections: EditorSection[];
  articles: EditorArticle[];
  others: EditorOther[];
  /** New records only: each section number's next free Spec ID (a preview —
   *  the server allocates the real one on save). */
  nextIds: Record<string, string>;
  /** The viewer's `create` permission (D260): without it the form is
   *  read-only — no Save, no Restore. The actions refuse regardless. */
  canCreate: boolean;
};

export default function RecordEditor(props: Props) {
  const { mode, record, history } = props;
  const [notice, setNotice] = useState("");

  return (
    <div className="pk-content" style={{ maxWidth: 960, margin: "0 auto" }}>
      <div style={{ marginBottom: 10 }}>
        <Link href="/design/specs/library" style={{ fontSize: 12, color: "#8c919c", textDecoration: "none" }}>
          ← Spec library
        </Link>
      </div>
      <div style={{ marginBottom: 18 }}>
        <div className="pk-page-title">
          {mode === "new" ? (
            "New spec"
          ) : (
            <>
              <span style={MONO}>{record.specId}</span> · {record.title || "Untitled spec"}
            </>
          )}
        </div>
        <div className="pk-page-sub">
          {mode === "new"
            ? "Write a spec once — it matches every BOM row that carries one of its part numbers (or its match key)."
            : `${KIND_LABELS[record.kind]} · ${STATUS_LABEL[record.status]} · revision ${record.revision}${record.updatedBy ? ` · last saved by ${record.updatedBy}` : ""}`}
        </div>
      </div>

      {notice && (
        <div className="pk-card" style={{ padding: "10px 16px", marginBottom: 14, ...SAVED }}>
          {notice}
        </div>
      )}

      <RecordForm key={`${record.specId}@${record.revision}`} {...props} onNotice={setNotice} />
      {mode === "edit" && <History specId={record.specId} history={history} canRestore={props.canCreate} onNotice={setNotice} />}
    </div>
  );
}

function RecordForm({
  mode,
  record,
  sections,
  articles,
  others,
  nextIds,
  canCreate,
  onNotice,
}: Props & { onNotice: (s: string) => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");

  const [kind, setKind] = useState<SpecKind>(record.kind);
  const [status, setStatus] = useState<SpecStatus>(record.status);
  const [section, setSection] = useState(record.section);
  const [sourceArticleId, setSourceArticleId] = useState(record.sourceArticleId ?? "");
  const [title, setTitle] = useState(record.title);
  const [manufacturer, setManufacturer] = useState(record.manufacturer ?? "");
  const [basisOfDesign, setBasisOfDesign] = useState(record.basisOfDesign ?? "");
  const [mfrText, setMfrText] = useState(record.mfrNumbers.join("\n"));
  const [matchKey, setMatchKey] = useState(record.matchKey ?? "");
  const [includeWith, setIncludeWith] = useState<string[]>(record.includeWith);
  const [specText, setSpecText] = useState(record.specText);
  const [notes, setNotes] = useState(record.notes ?? "");
  const [why, setWhy] = useState("");

  const sortedSections = useMemo(() => [...sections].sort((a, b) => csiKey(a.number).localeCompare(csiKey(b.number))), [sections]);
  const sectionRow = sections.find((s) => csiKey(s.number) === csiKey(section)) ?? null;
  const sectionArticles = useMemo(
    () =>
      sectionRow
        ? articles.filter((a) => a.sectionId === sectionRow.id).sort((a, b) => a.sort - b.sort || a.title.localeCompare(b.title))
        : [],
    [articles, sectionRow]
  );
  const articleInSection = sectionArticles.some((a) => a.id === sourceArticleId);

  // New records: a read-only preview of the section's next id; the server
  // allocates the real one at save time (it may differ if someone else
  // created a spec in the same section meanwhile).
  const previewId = mode === "new" ? (sectionRow ? nextIds[sectionRow.number] ?? "" : "") : record.specId;

  // The article text is round-trip only (design §1.1): keep the record's own
  // heading while the placement is unchanged, else take the chosen article's.
  const articleText =
    sourceArticleId === (record.sourceArticleId ?? "")
      ? record.article
      : articles.find((a) => a.id === sourceArticleId)?.title ?? "";

  const raw = {
    kind,
    status,
    section: sectionRow ? sectionRow.number : section,
    article: articleText,
    title,
    basisOfDesign,
    manufacturer,
    // Only the kind's own matching field is kept (design §1.1).
    mfrNumbers: isProduct(kind) ? mfrText : [],
    matchKey: kind === "system" ? matchKey : null,
    includeWith: kind === "companion" ? includeWith : [],
    specText,
    notes,
    sourceArticleId: sourceArticleId || null,
    revision: record.revision,
    updatedAt: record.updatedAt,
    updatedBy: record.updatedBy,
  };
  const candidate = normalizeSpecRecord({ ...raw, specId: previewId || "(new)" });

  const otherRecords = useMemo(() => others.map(asRecord), [others]);
  const problems = candidate
    ? validateSpecRecord(candidate, {
        sections: sections.map((s) => ({ id: s.id, number: s.number })),
        articles: articles.map((a) => ({ id: a.id, sectionId: a.sectionId })),
        specIds: new Set([...others.map((o) => o.specId), candidate.specId]),
      })
    : [];
  const mfrConflict = candidate ? partNumberConflict(candidate, otherRecords) : null;
  const mkConflict = candidate ? matchKeyConflict(candidate, otherRecords) : null;
  const conflict = mfrConflict
    ? `That part number is already on ${mfrConflict}.`
    : mkConflict
      ? `That match key is already used by ${mkConflict}.`
      : "";

  const blocking = problems.some((p) => p.blocking) || !!conflict;
  const unchanged = mode === "edit" && !!candidate && sameSpecContent(record, candidate);
  const needWhy = mode === "edit" && !why.trim();

  /** A field's validation problems, inline under it. */
  const fieldErr = (field: string) =>
    problems
      .filter((p) => p.field === field)
      .map((p, i) => (
        <div key={i} style={p.blocking ? FIELD_ERR : NOTE}>
          {field === "section" && !section.trim() ? "Choose a section." : p.message}
          {!p.blocking && " (only blocks a Ready record)"}
        </div>
      ));

  const onSectionChange = (next: string) => {
    setSection(next);
    const row = sections.find((s) => csiKey(s.number) === csiKey(next));
    if (!row || !articles.some((a) => a.id === sourceArticleId && a.sectionId === row.id)) setSourceArticleId("");
  };

  const save = () => {
    if (mode === "edit" && !why.trim()) {
      setErr("Say why you're changing this spec.");
      return;
    }
    start(async () => {
      setErr("");
      onNotice("");
      try {
        if (mode === "new") {
          // A blank id is a create — the server allocates the id.
          const res = await saveSpecRecordAction({ ...raw, specId: "" }, "");
          if (!res.ok) {
            setErr(res.error);
            return;
          }
          router.push(`/design/specs/library/records/${encodeURIComponent(res.specId)}`);
          return;
        }
        const res = await saveSpecRecordAction({ ...raw, specId: record.specId }, why.trim());
        if (!res.ok) {
          setErr(res.error);
          return;
        }
        onNotice(res.outcome === "unchanged" ? "No changes to save." : `Saved ${record.specId} as revision ${record.revision + 1}.`);
        router.refresh();
      } catch {
        setErr("Could not save — check your connection and try again.");
      }
    });
  };

  return (
    <div className="pk-card" style={CARD}>
      <div style={H}>{mode === "new" ? "Spec" : "Edit spec"}</div>

      <div style={GRID2}>
        <div>
          <div style={LBL}>Spec ID</div>
          {mode === "new" ? (
            <>
              <div id="rec-specid" style={{ ...MONO, fontSize: 13, padding: "8px 0", color: previewId ? "#3a3f4a" : "#9aa0ab" }}>
                {previewId || "Assigned on save"}
              </div>
              <div style={EXPLAIN}>
                {previewId ? "The section's next number — assigned when you save." : "Choose a section; the next number is assigned when you save."}
              </div>
            </>
          ) : (
            <div id="rec-specid" style={{ ...MONO, fontSize: 13, padding: "8px 0" }}>{record.specId}</div>
          )}
        </div>
        <div>
          <label style={LBL} htmlFor="rec-kind">
            Kind
          </label>
          <select id="rec-kind" className="pk-input" value={kind} onChange={(e) => setKind(e.target.value as SpecKind)} style={{ width: "100%" }}>
            {SPEC_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label style={LBL} htmlFor="rec-status">
            Status
          </label>
          <select id="rec-status" className="pk-input" value={status} onChange={(e) => setStatus(e.target.value as SpecStatus)} style={{ width: "100%" }}>
            {SPEC_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
          <div style={EXPLAIN}>Only Ready specs print. Drafts are reported, never printed; Archived never match.</div>
        </div>
      </div>

      <div style={GRID2}>
        <div>
          <label style={LBL} htmlFor="rec-section">
            Section
          </label>
          <select id="rec-section" className="pk-input" value={sectionRow ? sectionRow.number : section} onChange={(e) => onSectionChange(e.target.value)} style={{ width: "100%" }}>
            <option value="">Choose a section…</option>
            {!sectionRow && section && <option value={section}>{section} (no such section)</option>}
            {sortedSections.map((s) => (
              <option key={s.id} value={s.number}>
                {s.number} · {s.title}
              </option>
            ))}
          </select>
          {fieldErr("section")}
        </div>
        <div>
          <label style={LBL} htmlFor="rec-article">
            Article (prints under)
          </label>
          <select
            id="rec-article"
            className="pk-input"
            value={sourceArticleId}
            onChange={(e) => setSourceArticleId(e.target.value)}
            style={{ width: "100%" }}
            disabled={!sectionRow}
          >
            <option value="">{sectionRow ? "No article" : "Choose a section first"}</option>
            {sourceArticleId && !articleInSection && <option value={sourceArticleId}>{sourceArticleId} (not in this section)</option>}
            {sectionArticles.map((a) => (
              <option key={a.id} value={a.id}>
                {a.title}
              </option>
            ))}
          </select>
          {fieldErr("sourceArticleId")}
        </div>
      </div>

      <div style={{ marginBottom: 14 }}>
        <label style={LBL} htmlFor="rec-title">
          Title
        </label>
        <input id="rec-title" className="pk-input" value={title} onChange={(e) => setTitle(e.target.value)} style={{ width: "100%" }} />
        {fieldErr("title")}
      </div>

      <div style={GRID2}>
        <div>
          <label style={LBL} htmlFor="rec-mfr">
            Manufacturer
          </label>
          <input id="rec-mfr" className="pk-input" value={manufacturer} onChange={(e) => setManufacturer(e.target.value)} style={{ width: "100%" }} />
        </div>
        <div>
          <label style={LBL} htmlFor="rec-bod">
            Basis of design
          </label>
          <input id="rec-bod" className="pk-input" value={basisOfDesign} onChange={(e) => setBasisOfDesign(e.target.value)} style={{ width: "100%" }} />
        </div>
      </div>

      {isProduct(kind) && (
        <div style={{ marginBottom: 14 }}>
          <label style={LBL} htmlFor="rec-parts">
            Part numbers — one per line
          </label>
          <textarea
            id="rec-parts"
            className="pk-input mono"
            rows={Math.min(8, Math.max(3, mfrText.split("\n").length + 1))}
            value={mfrText}
            onChange={(e) => setMfrText(e.target.value)}
            style={{ width: "100%", resize: "vertical" }}
          />
          <div style={EXPLAIN}>Every BOM row carrying one of these matches this spec. # stands for one digit 1–5.</div>
          {fieldErr("mfrNumbers")}
        </div>
      )}
      {!isProduct(kind) && mfrText.trim() && (
        <div style={{ ...NOTE, marginBottom: 10 }}>This spec also has part numbers; a {KIND_LABELS[kind]} spec doesn&apos;t match by part number, so they&apos;re cleared on save.</div>
      )}

      {kind === "system" && (
        <div style={{ marginBottom: 14 }}>
          <label style={LBL} htmlFor="rec-matchkey">
            Match key
          </label>
          <input id="rec-matchkey" className="pk-input" value={matchKey} onChange={(e) => setMatchKey(e.target.value)} style={{ width: "100%" }} />
          <div style={EXPLAIN}>The estimate line or Grid key this system spec matches, e.g. “Stage Drapes – Main Curtain”. Case and dash style don&apos;t matter.</div>
          {fieldErr("matchKey")}
        </div>
      )}
      {kind !== "system" && matchKey.trim() && (
        <div style={{ ...NOTE, marginBottom: 10 }}>This spec also has a match key; only a System spec matches by key, so it&apos;s cleared on save.</div>
      )}

      {kind === "companion" && (
        <div style={{ marginBottom: 14 }}>
          <label style={LBL}>Include with</label>
          <IncludeWithPicker value={includeWith} onChange={setIncludeWith} others={others} />
          <div style={EXPLAIN}>This spec prints whenever one of these specs does.</div>
          {fieldErr("includeWith")}
        </div>
      )}
      {kind !== "companion" && includeWith.length > 0 && (
        <div style={{ ...NOTE, marginBottom: 10 }}>This spec also rides with {includeWith.join(", ")}; only a Companion spec does, so that&apos;s cleared on save.</div>
      )}

      <div style={{ marginBottom: 14 }}>
        <label style={LBL} htmlFor="rec-text">
          Spec text
        </label>
        <textarea
          id="rec-text"
          className="pk-input mono"
          rows={16}
          value={specText}
          onChange={(e) => setSpecText(e.target.value)}
          style={{ width: "100%", resize: "vertical" }}
        />
        <div style={EXPLAIN}>Outline — two spaces per level. [Brackets] are per-job values the builder asks for.</div>
        {fieldErr("specText")}
      </div>

      <div style={{ marginBottom: 14 }}>
        <label style={LBL} htmlFor="rec-notes">
          Notes (internal, never printed)
        </label>
        <textarea id="rec-notes" className="pk-input" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} style={{ width: "100%", resize: "vertical" }} />
      </div>

      {mode === "edit" && canCreate && (
        <div style={{ marginBottom: 14 }}>
          <label style={LBL} htmlFor="rec-why">
            Why are you changing it?
          </label>
          <input
            id="rec-why"
            className="pk-input"
            value={why}
            maxLength={300}
            placeholder="e.g. Updated to the Mk2 datasheet"
            onChange={(e) => setWhy(e.target.value)}
            style={{ width: "100%" }}
          />
          <div style={EXPLAIN}>Kept with this revision in the history below.</div>
        </div>
      )}

      {conflict && <div style={{ ...FIELD_ERR, marginBottom: 10 }}>{conflict}</div>}

      {!canCreate ? (
        <div style={{ fontSize: 11.5, color: "#9aa0ab" }}>You can view this spec; editing needs the Create permission.</div>
      ) : (
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button type="button" className="pk-btn-accent" disabled={pending || blocking || unchanged || !candidate} onClick={save}>
            {pending ? "Saving…" : mode === "new" ? "Create spec" : "Save"}
          </button>
          {mode === "new" ? (
            <Link href="/design/specs/library" className="pk-btn-outline" style={{ textDecoration: "none" }}>
              Cancel
            </Link>
          ) : null}
          {unchanged && <span style={{ fontSize: 11.5, color: "#9aa0ab" }}>No changes yet.</span>}
          {!unchanged && blocking && <span style={{ fontSize: 11.5, color: "#b4543a" }}>Fix the problems above to save.</span>}
          {!unchanged && !blocking && needWhy && <span style={{ fontSize: 11.5, color: "#9aa0ab" }}>A reason is required to save.</span>}
          {err && <span style={ERR}>{err}</span>}
        </div>
      )}
    </div>
  );
}

function IncludeWithPicker({
  value,
  onChange,
  others,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  others: EditorOther[];
}) {
  const [q, setQ] = useState("");
  const byId = new Map(others.map((o) => [o.specId, o]));
  const needle = q.trim().toLowerCase();
  const matches = needle
    ? others
        .filter((o) => o.status !== "archived" && !value.includes(o.specId))
        .filter((o) => o.specId.toLowerCase().includes(needle) || o.title.toLowerCase().includes(needle))
        .slice(0, 8)
    : [];

  return (
    <div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: value.length ? 8 : 0 }}>
        {value.map((id) => {
          const o = byId.get(id);
          return (
            <span
              key={id}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                fontSize: 11.5,
                background: o ? "#f1f2f5" : "#fbeae5",
                color: o ? "#3a3f4a" : "#b4543a",
                border: "1px solid #e4e7ec",
                padding: "3px 4px 3px 9px",
                borderRadius: 20,
              }}
            >
              <span style={{ ...MONO, fontWeight: 600 }}>{id}</span>
              {o ? o.title : "unknown spec"}
              <button
                type="button"
                aria-label={`Remove ${id}`}
                onClick={() => onChange(value.filter((v) => v !== id))}
                style={{ border: "none", background: "transparent", cursor: "pointer", color: "#8c919c", fontSize: 13, lineHeight: 1, padding: "0 4px" }}
              >
                ×
              </button>
            </span>
          );
        })}
      </div>
      <input className="pk-input" value={q} placeholder="Search a spec id or title to add…" onChange={(e) => setQ(e.target.value)} style={{ width: "100%" }} />
      {matches.length > 0 && (
        <div style={{ border: "1px solid #f0f1f4", borderRadius: 9, marginTop: 6, overflow: "hidden" }}>
          {matches.map((o) => (
            <button
              key={o.specId}
              type="button"
              onClick={() => {
                onChange([...value, o.specId]);
                setQ("");
              }}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                border: "none",
                borderBottom: "1px solid #f5f6f8",
                background: "#fff",
                padding: "7px 12px",
                fontSize: 12.5,
                cursor: "pointer",
              }}
            >
              <span style={{ ...MONO, fontWeight: 600 }}>{o.specId}</span> {o.title}
              <span style={{ color: "#9aa0ab" }}> · {KIND_LABELS[o.kind]}</span>
            </button>
          ))}
        </div>
      )}
      {needle && matches.length === 0 && <div style={EXPLAIN}>No spec matches “{q.trim()}”.</div>}
    </div>
  );
}

function History({
  specId,
  history,
  canRestore,
  onNotice,
}: {
  specId: string;
  history: EditorHistoryEntry[];
  canRestore: boolean;
  onNotice: (s: string) => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<number | null>(null);
  const [asking, setAsking] = useState<number | null>(null);
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();

  const restore = (revision: number) =>
    start(async () => {
      setErr("");
      onNotice("");
      try {
        const res = await restoreSpecRecordRevisionAction(specId, revision);
        if (!res.ok) {
          setErr(res.error);
          return;
        }
        setAsking(null);
        setOpen(null);
        if (res.outcome === "unchanged") {
          onNotice(`Revision ${revision} matches the current text — nothing to restore.`);
          return;
        }
        onNotice(`Restored revision ${revision} as a new revision — nothing was deleted from the history.`);
        router.refresh();
      } catch {
        setErr("Could not restore — check your connection and try again.");
      }
    });

  return (
    <div className="pk-card" style={{ padding: 0, overflow: "hidden", marginBottom: 18 }}>
      <div style={{ padding: "12px 18px", borderBottom: "1px solid #f0f1f4", fontSize: 14.5, fontWeight: 600 }}>
        History <span style={{ ...MONO, fontSize: 12, fontWeight: 500, color: "#9aa0ab" }}>{history.length}</span>
      </div>
      {err && <div style={{ ...ERR, padding: "8px 18px" }}>{err}</div>}
      {history.map((h) => (
        <div key={h.revision} style={{ borderBottom: "1px solid #f5f6f8" }}>
          <div style={{ display: "grid", gridTemplateColumns: "90px 170px minmax(0,0.8fr) minmax(0,1.6fr) auto", gap: 10, padding: "10px 18px", alignItems: "center" }}>
            <span style={{ fontSize: 12.5, ...MONO, fontWeight: 600 }}>
              Rev {h.revision}
              {h.current && (
                <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 600, color: "#1f7a52", background: "#e8f5ee", padding: "1px 6px", borderRadius: 20, fontFamily: "inherit" }}>
                  current
                </span>
              )}
            </span>
            <span style={{ fontSize: 12, color: "#5b616e" }}>{h.atLabel}</span>
            <span style={{ fontSize: 12, color: "#5b616e" }}>{h.by || "—"}</span>
            <span style={{ fontSize: 12.5, color: "#3a3f4a" }}>{h.why || "—"}</span>
            <span style={{ display: "flex", gap: 6, justifyContent: "flex-end", flexWrap: "wrap" }}>
              <button type="button" className="pk-btn-outline" onClick={() => setOpen(open === h.revision ? null : h.revision)}>
                {open === h.revision ? "Hide" : "Show"}
              </button>
              {canRestore && !h.current && asking !== h.revision && (
                <button type="button" className="pk-btn-outline" disabled={pending} onClick={() => setAsking(h.revision)}>
                  Restore this version
                </button>
              )}
            </span>
          </div>
          {asking === h.revision && (
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", padding: "0 18px 10px" }}>
              <span style={{ fontSize: 12.5, fontWeight: 600 }}>{`Restore revision ${h.revision}?`}</span>
              <button type="button" className="pk-btn-accent" disabled={pending} onClick={() => restore(h.revision)}>
                {pending ? "Restoring…" : "Restore"}
              </button>
              <button type="button" className="pk-btn-outline" disabled={pending} onClick={() => setAsking(null)}>
                Cancel
              </button>
              <span style={{ fontSize: 11.5, color: "#9aa0ab" }}>Saved as a new revision; the history keeps every version.</span>
            </div>
          )}
          {open === h.revision && (
            <div style={{ padding: "0 18px 14px" }}>
              <div style={{ fontSize: 12, color: "#5b616e", marginBottom: 6, lineHeight: 1.6 }}>
                <strong>{h.record.title || "Untitled"}</strong> · {KIND_LABELS[h.record.kind]} · {STATUS_LABEL[h.record.status]} · {h.record.section || "no section"}
                {h.record.manufacturer ? ` · ${h.record.manufacturer}` : ""}
                {h.record.mfrNumbers.length > 0 && (
                  <>
                    {" "}
                    · part #s <span style={MONO}>{h.record.mfrNumbers.join(", ")}</span>
                  </>
                )}
                {h.record.matchKey && <> · key “{h.record.matchKey}”</>}
                {h.record.includeWith.length > 0 && (
                  <>
                    {" "}
                    · with <span style={MONO}>{h.record.includeWith.join(", ")}</span>
                  </>
                )}
              </div>
              <pre style={PRE}>{h.record.specText || "(no spec text)"}</pre>
              {h.record.notes && <div style={{ ...EXPLAIN, marginTop: 8 }}>Notes: {h.record.notes}</div>}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
