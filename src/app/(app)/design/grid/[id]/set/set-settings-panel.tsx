"use client";

import { useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { SHEET_SIZES, type DrawingSetSettings, type SheetSizeKey } from "@/lib/design/grid-drawing-set";
import { saveDrawingSetAction } from "./actions";

/**
 * Set settings (#209 spec §3), saved on the project: size, drawn/checked by,
 * which sheets print, the set's own general notes (or the standard ones),
 * and labels for revisions that have no note. Never prints.
 */

const INPUT: CSSProperties = {
  border: "1px solid #dfe2e8",
  borderRadius: 7,
  padding: "6px 8px",
  fontSize: 12.5,
  fontFamily: "inherit",
  background: "#fff",
  color: "#16181d",
};
const FIELD: CSSProperties = { display: "flex", flexDirection: "column", gap: 4, fontSize: 11, fontWeight: 600, color: "#5b616e" };
const SECTION: CSSProperties = { fontSize: 10, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "#9aa0ab", margin: "14px 0 6px" };

export default function SetSettingsPanel({
  projectId,
  optionId,
  size,
  set,
  defaultDrawnBy,
  toggles,
  revisions,
  standardNotes,
}: {
  projectId: string;
  optionId: string;
  size: SheetSizeKey;
  set: DrawingSetSettings;
  defaultDrawnBy: string;
  toggles: Array<{ key: string; label: string }>;
  revisions: Array<{ rev: number; letter: string; note: string }>;
  standardNotes: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [drawnBy, setDrawnBy] = useState(set.drawnBy ?? defaultDrawnBy);
  const [checkedBy, setCheckedBy] = useState(set.checkedBy ?? "");
  const [excluded, setExcluded] = useState<string[]>(set.excluded ?? []);
  const [ownNotes, setOwnNotes] = useState(typeof set.generalNotes === "string");
  const [notes, setNotes] = useState(set.generalNotes ?? standardNotes);
  const [labels, setLabels] = useState<Record<string, string>>(set.revisionLabels ?? {});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const base = `/design/grid/${encodeURIComponent(projectId)}/set?option=${encodeURIComponent(optionId)}`;
  const unlabeled = revisions.filter((r) => !r.note.trim()).slice(-12);

  async function save(patch: DrawingSetSettings, opts?: { resetGeneralNotes?: boolean }): Promise<boolean> {
    setBusy(true);
    setMsg(null);
    try {
      const r = await saveDrawingSetAction(projectId, patch, opts);
      if (!r.ok) {
        setMsg({ ok: false, text: r.error });
        return false;
      }
      setMsg({ ok: true, text: "Saved" });
      return true;
    } catch {
      setMsg({ ok: false, text: "Couldn't save — please try again." });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function chooseSize(next: SheetSizeKey) {
    // Save it on the project, then drop any ?size= so the saved size applies.
    if (await save({ size: next })) {
      router.push(base);
      router.refresh();
    }
  }

  async function saveAll() {
    // Unticking "own notes" must actually revert the cover to the standard
    // notes, not just stop sending generalNotes — a bare merge patch would
    // leave the previously-saved custom text in place (#209 review I1).
    if (
      await save(
        { drawnBy, checkedBy, excluded, revisionLabels: labels, ...(ownNotes ? { generalNotes: notes } : {}) },
        { resetGeneralNotes: !ownNotes }
      )
    )
      router.refresh();
  }

  // Not named useStandard() — a leading "use" reads as a custom Hook to
  // react-hooks/rules-of-hooks, which refuses to let it be called from a
  // plain onClick callback.
  async function resetToStandardNotes() {
    if (await save({}, { resetGeneralNotes: true })) {
      setOwnNotes(false);
      setNotes(standardNotes);
      router.refresh();
    }
  }

  return (
    <div className="pk-card pk-no-print" style={{ padding: "12px 16px", marginBottom: 18, maxWidth: 980, marginInline: "auto" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        style={{ background: "transparent", border: "none", padding: 0, cursor: "pointer", fontSize: 13.5, fontWeight: 600, fontFamily: "inherit", color: "#16181d" }}
      >
        {`Set settings ${open ? "▾" : "▸"}`}
      </button>
      {open && (
        <div style={{ fontSize: 12.5 }}>
          <div style={SECTION}>Sheet size</div>
          <div style={{ display: "flex", gap: 6 }}>
            {(Object.keys(SHEET_SIZES) as SheetSizeKey[]).map((k) => (
              <button key={k} type="button" className={k === size ? "pk-btn-accent" : "pk-btn-outline"} disabled={busy} onClick={() => void chooseSize(k)}>
                {SHEET_SIZES[k].label}
              </button>
            ))}
          </div>

          <div style={SECTION}>Title block</div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <label style={FIELD}>
              Drawn by
              <input style={{ ...INPUT, width: 180 }} value={drawnBy} onChange={(e) => setDrawnBy(e.target.value)} maxLength={60} />
            </label>
            <label style={FIELD}>
              Checked by
              <input style={{ ...INPUT, width: 180 }} value={checkedBy} onChange={(e) => setCheckedBy(e.target.value)} maxLength={60} />
            </label>
          </div>

          <div style={SECTION}>Sheets in this set</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "4px 14px" }}>
            {toggles.map((t) => (
              <label key={t.key} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={!excluded.includes(t.key)}
                  onChange={(e) => setExcluded((x) => (e.target.checked ? x.filter((k) => k !== t.key) : [...x, t.key]))}
                />
                {t.label}
              </label>
            ))}
          </div>

          <div style={SECTION}>General notes (cover sheet)</div>
          <label style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }}>
            <input type="checkbox" checked={ownNotes} onChange={(e) => setOwnNotes(e.target.checked)} />
            This set has its own notes (otherwise the standard notes from Grid Settings print)
          </label>
          <textarea
            style={{ ...INPUT, width: "100%", minHeight: 110 }}
            value={notes}
            disabled={!ownNotes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="One note per line."
          />
          {ownNotes && (
            <button type="button" className="pk-btn-outline" style={{ marginTop: 6 }} disabled={busy} onClick={() => void resetToStandardNotes()}>
              Use the standard notes
            </button>
          )}

          {unlabeled.length > 0 && (
            <>
              <div style={SECTION}>Revision labels (revisions saved without a note)</div>
              <div style={{ display: "grid", gap: 6 }}>
                {unlabeled.map((r) => (
                  <label key={r.rev} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span style={{ width: 48, fontFamily: "var(--font-mono)" }}>{`Rev ${r.letter}`}</span>
                    <input
                      style={{ ...INPUT, flex: 1 }}
                      value={labels[String(r.rev)] || ""}
                      onChange={(e) => setLabels((l) => ({ ...l, [String(r.rev)]: e.target.value }))}
                      maxLength={80}
                      placeholder="Issued for bid, Owner comments…"
                    />
                  </label>
                ))}
              </div>
            </>
          )}

          <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 14 }}>
            <button type="button" className="pk-btn-accent" disabled={busy} onClick={() => void saveAll()}>
              {busy ? "Saving…" : "Save set settings"}
            </button>
            {msg && <span style={{ fontSize: 12, color: msg.ok ? "#1f7a52" : "#b4543a", fontWeight: 600 }}>{msg.text}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
