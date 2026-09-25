"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { dateYear } from "@/lib/format";
import { FETCH_BATCH_SIZE, PART_DOC_KINDS, PART_DOC_KIND_LABEL, type PartDocKind } from "@/lib/part-docs/types";
import type { DocumentRow } from "@/lib/part-docs/views";
import type { FetchOutcome, FetchTarget } from "@/lib/part-docs/fetch-links";
import AlsoCovers from "./also-covers";
import SlotCell from "./slot-cell";
import {
  attachExistingDocumentAction,
  fetchLinksAction,
  searchDocumentsAction,
  setNotNeededAction,
  type DocumentHit,
} from "./actions";

/**
 * The Datasheets to-do table (#DOC, spec §3): one row per quoted part,
 * most-quoted first, two slot cells, multi-select with bulk actions.
 *
 * `fetchLinksAction` now runs under a shared wall-clock budget (45s, under
 * the page's 60s maxDuration): a target the budget ran out of room to even
 * start comes back as `{ ok: false, error: NOT_ATTEMPTED }` rather than a
 * real failure. That text is fixed and is NOT a failure to report — it means
 * "still to do". `fetchSelected` below treats it as such: the target is
 * silently requeued for a later call in this same run (every call attempts
 * at least one target, so the queue always makes forward progress), and only
 * genuine failures (a real HTTP/parse/store error) land in the "Could not
 * fetch" list.
 */

const TH: React.CSSProperties = { fontSize: 10, fontWeight: 600, color: "#aab0bb", textTransform: "uppercase", letterSpacing: ".04em", textAlign: "left", padding: "8px 8px" };
const TD: React.CSSProperties = { fontSize: 12.5, color: "#3a3f4a", padding: "9px 8px", verticalAlign: "top", borderTop: "1px solid #f0f1f4" };

/** Mirrors fetch-links.ts's NOT_ATTEMPTED_ERROR — not imported directly since
 *  that module pulls in server-only stores and blob code, and this file is
 *  "use client" (a client file may only import pure/type-safe modules). */
const NOT_ATTEMPTED = "Not attempted — run again.";

export default function DocumentsClient({ rows }: { rows: DocumentRow[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [justUploaded, setJustUploaded] = useState<{ sku: string; documentId: string; fileName: string } | null>(null);
  const [bulkKind, setBulkKind] = useState<PartDocKind>("datasheet");
  const [progress, setProgress] = useState<string | null>(null);
  const [failures, setFailures] = useState<FetchOutcome[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [docQuery, setDocQuery] = useState("");
  const [docHits, setDocHits] = useState<DocumentHit[]>([]);

  const allOnPage = rows.length > 0 && rows.every((r) => selected.has(r.sku));
  const toggle = (sku: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(sku)) next.delete(sku);
      else next.add(sku);
      return next;
    });
  const picked = rows.filter((r) => selected.has(r.sku));

  const fetchSelected = async () => {
    const targets: FetchTarget[] = [];
    for (const r of picked) for (const k of PART_DOC_KINDS) if (r[k].state === "link-only") targets.push({ sku: r.sku, kind: k });
    if (!targets.length) {
      setError("None of the selected parts has a link to fetch.");
      return;
    }
    setError(null);
    setFailures([]);
    const total = targets.length;
    let queue: FetchTarget[] = [...targets];
    const failed: FetchOutcome[] = [];
    let done = 0;
    while (queue.length) {
      const chunk = queue.slice(0, FETCH_BATCH_SIZE);
      queue = queue.slice(FETCH_BATCH_SIZE);
      setProgress(`Fetching ${Math.min(done + chunk.length, total)} of ${total}…`);
      const r = await fetchLinksAction(chunk);
      if (!r.ok) {
        setError(r.error);
        break;
      }
      for (const res of r.results) {
        if (!res.ok && res.error === NOT_ATTEMPTED) {
          // Still to do — the budget ran out of room to even start it.
          // Requeue it for a later call in this same run.
          queue.push({ sku: res.sku, kind: res.kind });
          continue;
        }
        done++;
        if (!res.ok) failed.push(res);
      }
    }
    setProgress(`Fetched ${done - failed.length} of ${total}${failed.length ? ` · ${failed.length} failed` : ""}.`);
    setFailures(failed);
    router.refresh();
  };

  const markNotNeeded = async () => {
    setError(null);
    const r = await setNotNeededAction(picked.map((p) => p.sku), bulkKind, true);
    if (!r.ok) setError(r.error);
    else {
      setProgress(`${r.changed} part${r.changed === 1 ? "" : "s"} marked ${PART_DOC_KIND_LABEL[bulkKind].toLowerCase()} not needed.`);
      router.refresh();
    }
  };

  const searchDocs = async (q: string) => {
    setDocQuery(q);
    if (q.trim().length < 2) {
      setDocHits([]);
      return;
    }
    const r = await searchDocumentsAction(q);
    if (r.ok) setDocHits(r.hits);
  };

  const attachExisting = async (hit: DocumentHit) => {
    setError(null);
    const r = await attachExistingDocumentAction(hit.id, picked.map((p) => p.sku));
    if (!r.ok) setError(r.error);
    else {
      setProgress(`${hit.title} attached to ${r.linked} part${r.linked === 1 ? "" : "s"}.`);
      setDocQuery("");
      setDocHits([]);
      router.refresh();
    }
  };

  return (
    <div>
      {justUploaded && <AlsoCovers {...justUploaded} onDone={() => setJustUploaded(null)} />}

      {picked.length > 0 && (
        <div className="pk-card" style={{ padding: 12, marginBottom: 12, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", position: "sticky", top: 8, zIndex: 5 }}>
          <b style={{ fontSize: 12.5 }}>{picked.length} selected</b>
          <button type="button" className="pk-btn-outline" onClick={fetchSelected}>Fetch links</button>
          <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
            <select aria-label="Kind to mark" value={bulkKind} onChange={(e) => setBulkKind(e.target.value as PartDocKind)} style={{ fontSize: 12, padding: "5px 8px", borderRadius: 7, border: "1px solid #dfe2e8" }}>
              {PART_DOC_KINDS.map((k) => <option key={k} value={k}>{PART_DOC_KIND_LABEL[k]}</option>)}
            </select>
            <button type="button" className="pk-btn-outline" onClick={markNotNeeded}>Mark not needed</button>
          </span>
          <span style={{ position: "relative" }}>
            <input
              aria-label="Attach an existing document"
              placeholder="Attach an existing document…"
              value={docQuery}
              onChange={(e) => searchDocs(e.target.value)}
              style={{ fontSize: 12, padding: "6px 9px", borderRadius: 7, border: "1px solid #dfe2e8", minWidth: 240 }}
            />
            {!!docHits.length && (
              <div className="pk-card" style={{ position: "absolute", top: "110%", left: 0, zIndex: 10, minWidth: 320, padding: 4 }}>
                {docHits.map((h) => (
                  <button key={h.id} type="button" onClick={() => attachExisting(h)} style={{ display: "block", width: "100%", textAlign: "left", border: "none", background: "none", padding: "6px 8px", fontSize: 12, cursor: "pointer" }}>
                    <b>{h.title}</b> <span style={{ color: "#8c919c" }}>{PART_DOC_KIND_LABEL[h.kind]}{h.hasFile ? "" : " · link only"}</span>
                  </button>
                ))}
              </div>
            )}
          </span>
          <button type="button" className="pk-btn-outline" onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      )}
      {progress && <div style={{ fontSize: 12, color: "#1f7a52", marginBottom: 8 }}>{progress}</div>}
      {error && <div role="alert" style={{ fontSize: 12, color: "#b4543a", marginBottom: 8 }}>{error}</div>}
      {!!failures.length && (
        <div className="pk-card" style={{ padding: 10, marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 650, marginBottom: 4 }}>Could not fetch</div>
          {failures.map((f) => (
            <div key={`${f.sku}-${f.kind}`} style={{ fontSize: 11.5, color: "#5b616e" }}>
              <b>{f.sku}</b> · {PART_DOC_KIND_LABEL[f.kind]} — {f.error}
            </div>
          ))}
        </div>
      )}

      <div className="pk-card" style={{ padding: 0, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 880 }}>
          <thead>
            <tr>
              <th style={{ ...TH, width: 28 }}>
                <input
                  type="checkbox"
                  aria-label="Select every row on this page"
                  checked={allOnPage}
                  onChange={() => setSelected(allOnPage ? new Set() : new Set(rows.map((r) => r.sku)))}
                />
              </th>
              <th style={TH}>Part</th>
              <th style={{ ...TH, textAlign: "right" }}>Quoted</th>
              <th style={TH}>Last quoted</th>
              <th style={TH}>Datasheet</th>
              <th style={TH}>Spec sheet</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.sku}>
                <td style={TD}>
                  <input type="checkbox" aria-label={`Select ${r.sku}`} checked={selected.has(r.sku)} onChange={() => toggle(r.sku)} />
                </td>
                <td style={{ ...TD, maxWidth: 320 }}>
                  <a href={`/catalog?edit=${encodeURIComponent(r.sku)}`} style={{ fontWeight: 650, color: "#16181d", textDecoration: "none" }}>{r.sku}</a>
                  <div style={{ fontSize: 11.5, color: "#6b7079" }}>{[r.mfr, r.model].filter(Boolean).join(" · ")}</div>
                  <div style={{ fontSize: 11.5, color: "#8c919c", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.desc}</div>
                </td>
                <td style={{ ...TD, textAlign: "right", fontFamily: "var(--font-mono)" }}>{r.quotes}</td>
                <td style={{ ...TD, whiteSpace: "nowrap", color: "#8c919c" }}>{r.lastQuotedAt ? dateYear(r.lastQuotedAt) : "—"}</td>
                {PART_DOC_KINDS.map((k) => (
                  <td key={k} style={{ ...TD, minWidth: 200 }}>
                    <SlotCell sku={r.sku} kind={k} view={r[k]} onUploaded={(sku, documentId, fileName) => setJustUploaded({ sku, documentId, fileName })} />
                  </td>
                ))}
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={6} style={{ ...TD, textAlign: "center", color: "#8c919c", padding: 28 }}>Nothing matches these filters.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
