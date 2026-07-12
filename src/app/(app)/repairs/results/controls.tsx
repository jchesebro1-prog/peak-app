"use client";

import { useRef, useState } from "react";
import { completeRepair, reopenRepair } from "../actions";
import { saveThroughOutbox } from "@/lib/sync/save";
import type {
  RepairJobRecord,
  RepairScopeItem,
  RepairPart,
  RepairCompletion,
} from "@/lib/stores/repair-jobs";

/** Client mirrors of repair-jobs helpers (the store is server-only). */
function money(n: number | null | undefined): string {
  return "$" + Math.round(n || 0).toLocaleString("en-US");
}
function msOfIso(s: string): number | null {
  const m = /(\d{4})-(\d{2})-(\d{2})/.exec(s || "");
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3]).getTime();
}

const LABEL: React.CSSProperties = {
  display: "block",
  fontSize: 11,
  fontWeight: 600,
  color: "#9aa0ab",
  letterSpacing: ".05em",
  textTransform: "uppercase",
  marginBottom: 7,
};

const INPUT: React.CSSProperties = {
  width: "100%",
  fontSize: 13.5,
  color: "#16181d",
  background: "#fff",
  border: "1px solid #e4e7ec",
  borderRadius: 9,
  padding: "10px 12px",
  outline: "none",
};

/**
 * Repair results-capture form — the offline-capable client half of the Repair
 * Results screen. Markup/fields/styles are the server component's form moved
 * verbatim; the "Complete & log results" submit now routes through
 * saveThroughOutbox so a tech on-site with no signal has the completed record
 * queued and synced on reconnect. Reopen keeps calling the server action
 * directly (it is not a capture save).
 */
export function ResultsForm({
  record,
  users,
  items,
  parts,
  performedDate,
  performedBy,
  warrantyMonths,
  defaultWarrantyMonths,
  partsPrefill,
  workPerformedDefault,
  followUpDefault,
  previewExpiryLabel,
  isCompleted,
}: {
  record: RepairJobRecord;
  users: Array<{ id: string; name: string }>;
  items: RepairScopeItem[];
  parts: RepairPart[];
  performedDate: string;
  performedBy: string;
  warrantyMonths: number;
  defaultWarrantyMonths: number;
  partsPrefill: string;
  workPerformedDefault: string;
  followUpDefault: string;
  previewExpiryLabel: string;
  isCompleted: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [saving, setSaving] = useState(false);
  const [queuedMsg, setQueuedMsg] = useState("");
  const [errMsg, setErrMsg] = useState("");

  /**
   * The WHOLE resulting repair document for the offline outbox
   * (/api/sync/push upserts by id). Merge the SSR record with the completion
   * fields complete() stamps on the cloud write — stage/completedAt/
   * warrantyMonths/completion/assignedTo — and mark it synced with a bumped rev.
   */
  function buildFullDoc(fd: FormData): Record<string, unknown> {
    const completedDate = String(fd.get("completedDate") || "");
    const performedByV = String(fd.get("performedBy") || record.assignedTo || "");
    const workPerformed = String(fd.get("workPerformed") || "").trim();
    const followUp = String(fd.get("followUp") || "").trim();
    const partsUsed = String(fd.get("partsUsed") || "")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    const warrantyRaw = String(fd.get("warrantyMonths") || "");
    const warrantyVal = warrantyRaw
      ? Math.max(0, parseInt(warrantyRaw, 10) || 0)
      : defaultWarrantyMonths;
    const completedAt = msOfIso(completedDate) || Date.now();
    const completion: RepairCompletion = {
      performedBy: performedByV,
      workPerformed,
      partsUsed,
      followUp,
      photos: [],
    };
    return {
      ...(record as unknown as Record<string, unknown>),
      stage: "completed",
      completedAt,
      warrantyMonths: warrantyVal,
      completion,
      assignedTo: performedByV || record.assignedTo || "",
      updatedAt: Date.now(),
      rev: (record.rev || 1) + 1,
      syncState: "synced",
    };
  }

  async function onComplete() {
    const form = formRef.current;
    if (!form || saving) return;
    // Keep the date input's required-field gate the browser gave the server form.
    if (!form.reportValidity()) return;
    // Preserve the existing FormData contract for the online server write.
    const formData = new FormData(form);
    setSaving(true);
    setErrMsg("");
    try {
      const { queued } = await saveThroughOutbox({
        collection: "repair_jobs",
        id: record.id,
        doc: buildFullDoc(formData),
        action: () => completeRepair(formData),
      });
      // queued === false → completeRepair redirected to the saved view.
      if (queued) {
        setQueuedMsg("Saved on this device — will sync when you're back online");
      }
    } catch {
      setErrMsg("Could not save results — please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form ref={formRef}>
      <input type="hidden" name="id" value={record.id} />
      <div
        style={{
          background: "#fff",
          border: "1px solid #ececf0",
          borderRadius: 13,
          boxShadow: "0 1px 2px rgba(0,0,0,.04)",
          padding: 20,
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: 14,
            marginBottom: 20,
          }}
        >
          <div>
            <label style={LABEL}>Date performed</label>
            <input
              type="date"
              name="completedDate"
              defaultValue={performedDate}
              required
              style={{ ...INPUT, fontFamily: "var(--font-mono)" }}
            />
          </div>
          <div>
            <label style={LABEL}>Performed by</label>
            <select
              name="performedBy"
              defaultValue={performedBy}
              style={{ ...INPUT, cursor: "pointer", paddingRight: 34 }}
            >
              <option value="">Select technician…</option>
              {users.map((u) => (
                <option key={u.id} value={u.name}>
                  {u.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={LABEL}>Warranty (months)</label>
            <input
              type="number"
              min={0}
              name="warrantyMonths"
              defaultValue={warrantyMonths || defaultWarrantyMonths}
              style={{ ...INPUT, fontFamily: "var(--font-mono)" }}
            />
          </div>
        </div>

        {/* scope reference */}
        {items.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <div style={LABEL}>Scope of work</div>
            <div style={{ border: "1px solid #f0f1f4", borderRadius: 9, overflow: "hidden" }}>
              {items.map((it, i) => (
                <div
                  key={i}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(0,1fr) 56px",
                    gap: 10,
                    alignItems: "center",
                    padding: "9px 12px",
                    borderTop: i === 0 ? "none" : "1px solid #f3f4f7",
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{it.label}</div>
                    {it.note && (
                      <div style={{ fontSize: 11, color: "#9aa0ab", marginTop: 1 }}>{it.note}</div>
                    )}
                  </div>
                  <div
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 12.5,
                      color: "#5b616e",
                      textAlign: "right",
                    }}
                  >
                    ×{it.qty}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ marginBottom: 16 }}>
          <label style={LABEL}>Work performed</label>
          <textarea
            name="workPerformed"
            rows={3}
            defaultValue={workPerformedDefault}
            placeholder="What was done on site, method, and any parts replaced…"
            style={{ ...INPUT, lineHeight: 1.5, resize: "vertical" }}
          />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 16 }}>
          <div>
            <label style={LABEL}>Parts used (one per line)</label>
            <textarea
              name="partsUsed"
              rows={4}
              defaultValue={partsPrefill}
              placeholder={"e.g.\n2× Wire rope clip\n1× Lift line 3/16″"}
              style={{ ...INPUT, fontFamily: "var(--font-mono)", lineHeight: 1.5, resize: "vertical" }}
            />
            {parts.length > 0 && (
              <div style={{ fontSize: 11, color: "#9aa0ab", marginTop: 6, lineHeight: 1.5 }}>
                Quoted parts:{" "}
                {parts
                  .map((p) => (p.qty ? p.qty + "× " : "") + p.name + " (" + money(p.cost) + ")")
                  .join(", ")}
              </div>
            )}
          </div>
          <div>
            <label style={LABEL}>Follow-up needed</label>
            <textarea
              name="followUp"
              rows={4}
              defaultValue={followUpDefault}
              placeholder="Any re-visit, re-quote, or monitoring the office should track…"
              style={{ ...INPUT, lineHeight: 1.5, resize: "vertical" }}
            />
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginTop: 20,
            paddingTop: 18,
            borderTop: "1px solid #f0f1f4",
          }}
        >
          <div style={{ fontSize: 11.5, color: "#9aa0ab", lineHeight: 1.5, flex: 1 }}>
            On save, this repair is marked complete and its {warrantyMonths}-month warranty runs
            through {previewExpiryLabel}.
          </div>
          {isCompleted && (
            <button
              type="submit"
              formAction={reopenRepair}
              style={{
                fontFamily: "var(--font-ui)",
                fontSize: 13,
                fontWeight: 600,
                color: "#b4543a",
                background: "#fff",
                border: "1px solid #f0d6cd",
                borderRadius: 10,
                padding: "11px 16px",
                cursor: "pointer",
              }}
            >
              Reopen
            </button>
          )}
          <button
            type="button"
            onClick={onComplete}
            disabled={saving}
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: 13.5,
              fontWeight: 600,
              color: "#fff",
              border: "none",
              borderRadius: 10,
              padding: "12px 20px",
              cursor: saving ? "not-allowed" : "pointer",
              background: saving ? "#c8ccd3" : "var(--accent)",
              flexShrink: 0,
            }}
          >
            {saving ? "Saving…" : isCompleted ? "Update results" : "Complete & log results"}
          </button>
        </div>

        {queuedMsg && (
          <div
            style={{
              marginTop: 14,
              padding: "13px 15px",
              background: "#eaf6ef",
              border: "1px solid #cce9da",
              borderRadius: 10,
              fontSize: 13,
              fontWeight: 600,
              color: "#1f7a52",
            }}
          >
            {queuedMsg}
          </div>
        )}
        {errMsg && (
          <div
            style={{
              marginTop: 14,
              padding: "13px 15px",
              background: "#f7e9e5",
              border: "1px solid #f0d6cd",
              borderRadius: 10,
              fontSize: 13,
              color: "#b4543a",
            }}
          >
            {errMsg}
          </div>
        )}
      </div>
    </form>
  );
}
