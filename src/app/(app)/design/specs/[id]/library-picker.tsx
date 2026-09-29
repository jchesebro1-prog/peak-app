"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { addLibraryRowAction, searchSpecRecordsAction, type SpecRecordHit } from "../record-actions";
import { ERR, MUTED, useSave } from "./header-fields";

/**
 * Add from Spec Library (Task 9, spec records design §5.3) — sits beside the
 * catalog picker and adds a record straight onto the spec as its own row
 * (`SPEC:<id>`), for scratch specs and for system scope the BOM doesn't
 * carry. Defaults to this spec's section; "All sections" widens it (a record
 * from another section is listed on the spec but prints in its own file).
 */

const SKU: CSSProperties = { fontFamily: "var(--font-mono)", fontSize: 12, color: "#3a3f4a" };
const SMALL_BTN: CSSProperties = { padding: "4px 8px", fontSize: 11.5 };

export function LibraryPicker({
  docId,
  sectionNumber,
  onSpec,
  onClose,
}: {
  docId: string;
  sectionNumber: string;
  /** Spec ids already on this spec as library rows — shown as added. */
  onSpec: string[];
  onClose: () => void;
}) {
  const { err, pending, run } = useSave();
  const [q, setQ] = useState("");
  const [allSections, setAllSections] = useState(false);
  const [results, setResults] = useState<SpecRecordHit[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchErr, setSearchErr] = useState("");
  const [added, setAdded] = useState<string[]>([]);
  const [busyId, setBusyId] = useState("");
  const seq = useRef(0);

  // Debounced; an answer that arrives after a newer request is dropped.
  useEffect(() => {
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await searchSpecRecordsAction(q, allSections ? undefined : { sectionNumber });
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
  }, [q, allSections, sectionNumber]);

  const add = (specId: string) => {
    setBusyId(specId);
    run(
      () => addLibraryRowAction(docId, specId),
      () => setAdded((a) => [...a, specId])
    );
  };

  return (
    <div style={{ border: "1px solid #eceef2", borderRadius: 10, padding: 14, marginTop: 12, background: "#fafbfc" }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
        <input
          className="pk-input"
          autoFocus
          aria-label="Search the Spec Library to add"
          placeholder="Search by title, spec ID, part number, manufacturer or match key…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ flex: "1 1 260px", width: "auto" }}
        />
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "#3a3f4a", cursor: "pointer" }}>
          <input type="checkbox" checked={allSections} onChange={(e) => setAllSections(e.target.checked)} />
          All sections
        </label>
        <button type="button" className="pk-btn-outline" onClick={onClose}>
          Done
        </button>
      </div>
      <div style={{ ...MUTED, marginBottom: 8 }}>
        {allSections ? "Every spec in the library. One from another section is listed here but prints in its own file." : `Specs in section ${sectionNumber}.`}{" "}
        Adds the spec as its own row — for system scope the quote doesn&apos;t list.
      </div>
      {(searchErr || err) && (
        <div role="alert" style={{ ...ERR, marginBottom: 8 }}>
          {searchErr || err}
        </div>
      )}
      <div style={{ maxHeight: 360, overflowY: "auto", background: "#fff", border: "1px solid #f0f1f4", borderRadius: 8 }}>
        {loading && results.length === 0 && <div style={{ ...MUTED, padding: 12 }}>Searching…</div>}
        {!loading && !searchErr && results.length === 0 && (
          <div style={{ ...MUTED, padding: 12 }}>{allSections ? "No specs match." : "No specs in this section match. Try All sections."}</div>
        )}
        {results.map((h) => {
          const isAdded = added.includes(h.specId) || onSpec.includes(h.specId);
          return (
            <div
              key={h.specId}
              style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 10, alignItems: "center", padding: "8px 12px", borderBottom: "1px solid #f5f6f8" }}
            >
              <div style={{ minWidth: 0 }}>
                <div>
                  <span style={SKU}>{h.specId}</span> <span style={{ fontSize: 12.5, color: "#3a3f4a" }}>{h.title}</span>
                </div>
                {h.product && <div style={{ fontSize: 12, fontWeight: 600, color: "#3a3f4a" }}>{h.product}</div>}
                <div style={{ fontSize: 11.5, color: h.status === "draft" ? "#8a6d1f" : "#6b7079" }}>
                  {h.section}
                  {h.matchKey ? ` · ${h.matchKey}` : ""}
                  {h.status === "draft" ? " · Draft — approve it before it prints" : ""}
                </div>
              </div>
              <button type="button" className="pk-btn-outline" style={SMALL_BTN} disabled={pending || isAdded} onClick={() => add(h.specId)}>
                {isAdded ? "Added" : pending && busyId === h.specId ? "Adding…" : "Add"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
