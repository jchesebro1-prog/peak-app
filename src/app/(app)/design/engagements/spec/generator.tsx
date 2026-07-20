"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, PageHeader, Pill } from "@/components/ui";
import type { BomRow, MatchedRow } from "@/lib/bid-spec";
import { parseCsv } from "./parse-bom";
import {
  bomFromQuoteAction,
  matchBomAction,
  remapRowAction,
  saveSpecAction,
  seedSectionsAction,
  writePartSpecAction,
} from "./actions";

/**
 * Bid-spec generator UI (D94): pick a source → resolve the match report →
 * save. The match report is the completeness guarantee — nothing can be
 * saved while a row is neither specified nor explicitly waived.
 */

const INPUT: React.CSSProperties = {
  border: "1px solid #dfe2e8",
  borderRadius: 8,
  padding: "7px 10px",
  fontSize: 13,
  fontFamily: "inherit",
  background: "#fff",
  color: "#16181d",
};

const BTN: React.CSSProperties = {
  border: "1px solid #dfe2e8",
  background: "#fff",
  borderRadius: 8,
  padding: "7px 12px",
  fontSize: 12.5,
  fontWeight: 600,
  color: "#3d424e",
  cursor: "pointer",
  fontFamily: "inherit",
};

const PRIMARY: React.CSSProperties = {
  ...BTN,
  background: "#16181d",
  borderColor: "#16181d",
  color: "#fff",
};

type SectionLite = { id: string; number: string; title: string };

export default function SpecGenerator({
  engagement,
  sections,
  sourceQuotes,
  saved,
}: {
  engagement: { id: string; name: string; customer: string };
  sections: SectionLite[];
  sourceQuotes: Array<{ id: string; name: string; customer: string; value: number }>;
  saved: Array<{
    id: string;
    source: string;
    createdAt: number;
    createdBy: string;
    sectionCount: number;
    waivedCount: number;
  }>;
}) {
  const router = useRouter();
  const [bom, setBom] = useState<BomRow[]>([]);
  const [rows, setRows] = useState<MatchedRow[] | null>(null);
  const [source, setSource] = useState("");
  const [paste, setPaste] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const counts = rows
    ? rows.reduce(
        (acc, r) => {
          const key = r.waived ? "waived" : r.bucket;
          acc[key] = (acc[key] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>
      )
    : {};
  const unresolved = rows ? rows.filter((r) => r.bucket !== "ready" && !r.waived).length : 0;

  async function runMatch(nextBom: BomRow[], src: string) {
    setErr(null);
    setBusy(true);
    const r = await matchBomAction(nextBom);
    setBusy(false);
    if (!r.ok) {
      setErr(r.error);
      return;
    }
    setBom(nextBom);
    setSource(src);
    setRows(r.rows);
  }

  async function fromQuote(quoteId: string) {
    setErr(null);
    setBusy(true);
    const r = await bomFromQuoteAction(quoteId);
    setBusy(false);
    if (!r.ok) {
      setErr(r.error);
      return;
    }
    await runMatch(r.bom, `quote:${quoteId}`);
  }

  function fromPaste() {
    const parsed = parseCsv(paste);
    if (!parsed.ok) {
      setErr(parsed.error);
      return;
    }
    runMatch(parsed.rows, "upload");
  }

  /** Inline, not window.prompt(): prompt() throws in this app's browser
   *  context ("prompt() is not supported") and the waive silently no-oped. */
  function waive(index: number, reason: string) {
    setRows((prev) =>
      prev
        ? prev.map((r, i) => (i === index ? { ...r, waived: true, waiveReason: reason.trim() } : r))
        : prev
    );
  }

  async function remap(index: number, sku: string) {
    if (!rows) return;
    setBusy(true);
    const r = await remapRowAction(rows, index, sku);
    setBusy(false);
    if (!r.ok) {
      setErr(r.error);
      return;
    }
    setRows(r.rows);
  }

  async function save() {
    if (!rows) return;
    setErr(null);
    setBusy(true);
    const r = await saveSpecAction({ engagementId: engagement.id, source, bom, rows });
    setBusy(false);
    if (!r.ok) {
      setErr(r.error);
      return;
    }
    router.push(`/design/engagements/spec/${r.id}`);
  }

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <PageHeader
        title="Bid specification"
        sub={`${engagement.name}${engagement.customer ? ` · ${engagement.customer}` : ""}`}
        actions={
          <Link href={`/design/engagements/${engagement.id}`} style={{ ...BTN, textDecoration: "none" }}>
            ← Engagement
          </Link>
        }
      />

      {err && (
        <div style={{ background: "#f9ece8", border: "1px solid #f0d6cd", borderRadius: 9, padding: "9px 12px", fontSize: 12.5, color: "#a0442b" }}>
          {err}
        </div>
      )}

      {sections.length === 0 && (
        <Card>
          <div style={{ fontSize: 13, marginBottom: 8 }}>
            No spec sections exist yet. Sections hold the Part 1 / Part 3 boilerplate that wraps
            each product — add the standard set to start.
          </div>
          <button
            style={PRIMARY}
            onClick={async () => {
              await seedSectionsAction();
              router.refresh();
            }}
          >
            Add the standard CSI sections
          </button>
        </Card>
      )}

      {!rows && (
        <>
          <Card>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "#9aa0ab", marginBottom: 10 }}>
              Start from a quote
            </div>
            {sourceQuotes.length === 0 && (
              <div style={{ fontSize: 12.5, color: "#8c919c" }}>
                No related quotes — paste an equipment list below instead.
              </div>
            )}
            <div style={{ display: "grid", gap: 6 }}>
              {sourceQuotes.map((q) => (
                <div key={q.id} style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 13, padding: "6px 0", borderTop: "1px solid #f4f5f7" }}>
                  <span style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 12 }}>{q.id}</span>
                  <span style={{ flex: 1, color: "#3d424e" }}>{q.name}</span>
                  <button style={BTN} disabled={busy} onClick={() => fromQuote(q.id)}>
                    Use this
                  </button>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "#9aa0ab", marginBottom: 10 }}>
              Or paste a bill of materials
            </div>
            <div style={{ fontSize: 12, color: "#8c919c", marginBottom: 8 }}>
              CSV or tab-separated, with a header row. Recognized columns: SKU / part number,
              description, quantity.
            </div>
            <textarea
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              rows={7}
              placeholder={"sku,description,qty\nS4LED-S2,ETC Source Four LED Series 2,12"}
              style={{ ...INPUT, width: "100%", resize: "vertical", fontFamily: "var(--font-mono, monospace)", fontSize: 12 }}
            />
            <button style={{ ...PRIMARY, marginTop: 8 }} disabled={busy || !paste.trim()} onClick={fromPaste}>
              Match against the catalog
            </button>
          </Card>

          {saved.length > 0 && (
            <Card>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "#9aa0ab", marginBottom: 10 }}>
                Previously generated
              </div>
              {saved.map((s) => (
                <div key={s.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "7px 0", borderTop: "1px solid #f4f5f7", fontSize: 12.5 }}>
                  <Link href={`/design/engagements/spec/${s.id}`} style={{ flex: 1, color: "#16181d", textDecoration: "none" }}>
                    {new Date(s.createdAt).toLocaleDateString()} · {s.sectionCount} section
                    {s.sectionCount === 1 ? "" : "s"}
                    {s.waivedCount ? ` · ${s.waivedCount} not specified` : ""}
                  </Link>
                  <span style={{ color: "#9aa0ab", fontSize: 11.5 }}>{s.createdBy}</span>
                </div>
              ))}
            </Card>
          )}
        </>
      )}

      {rows && (
        <>
          <Card>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#16181d", flex: 1 }}>
                Match report — {rows.length} item{rows.length === 1 ? "" : "s"}
              </div>
              <Pill color="#2e9e6b">{counts.ready || 0} ready</Pill>
              <Pill color="#c07f28">{counts["no-spec"] || 0} need spec text</Pill>
              <Pill color="#c4553a">{counts["no-match"] || 0} unmatched</Pill>
              {counts.waived ? <Pill color="#8c919c">{counts.waived} waived</Pill> : null}
            </div>
            <div style={{ fontSize: 12, color: unresolved ? "#a0442b" : "#2e7d55", marginBottom: 10 }}>
              {unresolved
                ? `${unresolved} item${unresolved === 1 ? "" : "s"} must be specified or waived before this can be saved.`
                : "Every item is specified or waived — ready to generate."}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button style={PRIMARY} disabled={busy || unresolved > 0} onClick={save}>
                Generate specification
              </button>
              <button style={BTN} onClick={() => { setRows(null); setErr(null); }}>
                Start over
              </button>
            </div>
          </Card>

          <Card>
            {rows.map((r, i) => (
              <MatchRow
                key={`${r.row.sku}-${i}`}
                row={r}
                sections={sections}
                busy={busy}
                onWaive={(reason) => waive(i, reason)}
                onRemap={(sku) => remap(i, sku)}
                onWrote={async () => {
                  // Re-run the match so the row flips to 'ready'.
                  await runMatch(bom, source);
                }}
              />
            ))}
          </Card>
        </>
      )}
    </div>
  );
}

function MatchRow({
  row,
  sections,
  busy,
  onWaive,
  onRemap,
  onWrote,
}: {
  row: MatchedRow;
  sections: SectionLite[];
  busy: boolean;
  onWaive: (reason: string) => void;
  onRemap: (sku: string) => void;
  onWrote: () => void;
}) {
  const [writing, setWriting] = useState(false);
  const [body, setBody] = useState("");
  const [sectionId, setSectionId] = useState(sections[0]?.id || "");
  const [manualSku, setManualSku] = useState("");
  const [err, setErr] = useState<string | null>(null);
  // Inline waive entry — prompt() is unavailable in this browser context.
  const [waiving, setWaiving] = useState(false);
  const [waiveReason, setWaiveReason] = useState("");

  const tone = row.waived
    ? "#8c919c"
    : row.bucket === "ready"
      ? "#2e9e6b"
      : row.bucket === "no-spec"
        ? "#c07f28"
        : "#c4553a";

  return (
    <div style={{ padding: "10px 0", borderTop: "1px solid #f4f5f7", fontSize: 12.5 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start", flexWrap: "wrap" }}>
        <span style={{ width: 4, alignSelf: "stretch", background: tone, borderRadius: 2 }} />
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ color: "#16181d", fontWeight: 500 }}>
            {row.row.desc || row.row.sku}
            {row.row.qty ? <span style={{ color: "#8c919c" }}> × {row.row.qty}</span> : null}
          </div>
          <div style={{ color: "#8c919c", fontSize: 11.5, fontFamily: "var(--font-mono, monospace)" }}>
            {row.row.sku || "no SKU"}
            {row.part && row.part.sku !== row.row.sku ? ` → ${row.part.sku}` : ""}
          </div>
          {row.waived && (
            <div style={{ color: "#8c919c", fontSize: 11.5, marginTop: 2 }}>
              Not specified: {row.waiveReason}
            </div>
          )}
        </div>
        <Pill color={tone}>
          {row.waived
            ? "Waived"
            : row.bucket === "ready"
              ? "Ready"
              : row.bucket === "no-spec"
                ? "No spec text"
                : "Unmatched"}
        </Pill>
        {!row.waived && row.bucket !== "ready" && !waiving && (
          <button
            style={{ ...BTN, padding: "3px 9px", fontSize: 11.5 }}
            onClick={() => { setWaiving(true); setWaiveReason(""); }}
          >
            No spec needed
          </button>
        )}
        {!row.waived && row.bucket === "no-spec" && !writing && (
          <button
            style={{ ...BTN, padding: "3px 9px", fontSize: 11.5 }}
            onClick={() => {
              setWriting(true);
              setSectionId(row.part?.specSectionId || sections[0]?.id || "");
            }}
          >
            Write spec
          </button>
        )}
      </div>

      {waiving && (
        <div style={{ display: "flex", gap: 6, marginTop: 8, paddingLeft: 14 }}>
          <input
            value={waiveReason}
            onChange={(e) => setWaiveReason(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && waiveReason.trim()) { onWaive(waiveReason.trim()); setWaiving(false); } }}
            placeholder="Why does this item need no specification?"
            style={{ ...INPUT, flex: 1, fontSize: 12, padding: "4px 8px" }}
            autoFocus
          />
          <button
            style={{ ...BTN, padding: "3px 9px", fontSize: 11.5 }}
            disabled={!waiveReason.trim()}
            onClick={() => { onWaive(waiveReason.trim()); setWaiving(false); }}
          >
            Waive
          </button>
          <button style={{ ...BTN, padding: "3px 9px", fontSize: 11.5 }} onClick={() => setWaiving(false)}>
            Cancel
          </button>
        </div>
      )}

      {row.bucket === "no-match" && !row.waived && (
        <div style={{ marginTop: 8, paddingLeft: 14 }}>
          {row.candidates.length > 0 ? (
            <div style={{ display: "grid", gap: 4 }}>
              <div style={{ color: "#8c919c", fontSize: 11.5 }}>Closest catalog matches:</div>
              {row.candidates.map((c) => (
                <div key={c.sku} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ flex: 1, color: "#3d424e" }}>
                    {c.desc} <span style={{ color: "#8c919c" }}>({c.sku})</span>
                  </span>
                  <button style={{ ...BTN, padding: "2px 8px", fontSize: 11 }} disabled={busy} onClick={() => onRemap(c.sku)}>
                    This one
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ color: "#8c919c", fontSize: 11.5 }}>
              Nothing in the catalog looks close.
            </div>
          )}
          <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
            <input
              value={manualSku}
              onChange={(e) => setManualSku(e.target.value)}
              placeholder="Map to SKU…"
              style={{ ...INPUT, fontSize: 12, padding: "4px 8px", width: 160 }}
            />
            <button
              style={{ ...BTN, padding: "3px 9px", fontSize: 11.5 }}
              disabled={busy || !manualSku.trim()}
              onClick={() => onRemap(manualSku.trim())}
            >
              Map
            </button>
          </div>
        </div>
      )}

      {writing && row.part && (
        <div style={{ marginTop: 8, paddingLeft: 14, display: "grid", gap: 6 }}>
          {err && <div style={{ color: "#a0442b", fontSize: 11.5 }}>{err}</div>}
          <select value={sectionId} onChange={(e) => setSectionId(e.target.value)} style={{ ...INPUT, fontSize: 12 }}>
            <option value="">Which section?</option>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.number} — {s.title}
              </option>
            ))}
          </select>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={5}
            placeholder={"Part 2 paragraph for this product. Separate sub-points with a blank line — they render as A., B., C."}
            style={{ ...INPUT, resize: "vertical", fontSize: 12 }}
          />
          <div style={{ display: "flex", gap: 6 }}>
            <button
              style={{ ...BTN, padding: "4px 10px" }}
              onClick={async () => {
                setErr(null);
                const r = await writePartSpecAction(row.part!.sku, sectionId, body);
                if (!r.ok) {
                  setErr(r.error);
                  return;
                }
                setWriting(false);
                setBody("");
                onWrote();
              }}
            >
              Save to catalog
            </button>
            <button style={{ ...BTN, padding: "4px 10px" }} onClick={() => setWriting(false)}>
              Cancel
            </button>
          </div>
          <div style={{ color: "#8c919c", fontSize: 11 }}>
            Saved on the catalog part — written once, reused on every future bid.
          </div>
        </div>
      )}
    </div>
  );
}
