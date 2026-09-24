"use client";

import { useState } from "react";
import { CONNECTION_TYPES, type Port, type PortDirection } from "@/lib/catalog-connect";
import { PORT_DIRECTIONS, serializePorts } from "@/lib/catalog-ports";

/**
 * Ports editor (#158) — the one client island in an otherwise server-rendered
 * part modal. Adding and removing rows needs interactivity; the rest of the
 * form stays a plain FormData post that works without JS (AGENTS.md).
 *
 * Everything is serialized into ONE hidden field so `upsertPart` stays flat.
 * The field is always present, including when there are no rows: that empty
 * array is how a user deletes a part's last port (mergeUpsert only overwrites
 * keys the patch carries).
 *
 * connectionType is a <select> over CONNECTION_TYPES and never free text — a
 * typo would make the device silently unwireable rather than visibly wrong
 * (D189). The server re-validates anyway; this hidden input is editable in
 * devtools.
 *
 * Row order leads with connectionType, not name (#162). DaVinci's connector
 * data is dirty in places — when the library leaves a port's name blank, the
 * enricher falls back to the connector's own name, so a real production row
 * can read `name: "DMX Male"` on a port whose connectionType is correctly
 * "line power (unspecified)". The type is right (the enricher maps by
 * protocol); the name is what misleads. Leading with connectionType and
 * styling name as secondary keeps a contradictory name from being mistaken
 * for the port's actual type.
 */

const cell: React.CSSProperties = {
  fontSize: 12.5,
  fontFamily: "var(--font-ui)",
  color: "#16181d",
  border: "1px solid #e4e7ec",
  borderRadius: 7,
  padding: "6px 8px",
  outline: "none",
  background: "#fff",
  width: "100%",
};

const DIRECTION_LABEL: Record<PortDirection, string> = { in: "In", out: "Out", io: "In/Out" };

export default function PortsEditor({
  initial,
  davinci,
}: {
  initial: Port[];
  /** Provenance stamp (#162) — present when these ports were written by a
   *  DaVinci enrichment run, so a human editing here knows a future run will
   *  leave their version alone rather than silently overwrite it. */
  davinci?: { enrichedAt: number };
}) {
  const [rows, setRows] = useState<Port[]>(initial);

  const patch = (i: number, next: Partial<Port>) =>
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, ...next } : row)));

  return (
    <div>
      <input type="hidden" name="ports" value={serializePorts(rows)} readOnly />

      <div style={{ fontSize: 10.5, fontWeight: 600, color: "#9aa0ab", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 5 }}>
        Ports
      </div>
      <div style={{ fontSize: 11, color: "#aab0bb", marginBottom: 8 }}>
        What this device plugs into. The Grid can only wire devices that have ports, and
        it refuses to connect two that do not share a connection type.
      </div>

      {davinci && (
        <div
          style={{
            fontSize: 11,
            color: "#8a6d1f",
            background: "#fbf3dd",
            border: "1px solid #f0e2bd",
            borderRadius: 7,
            padding: "7px 10px",
            marginBottom: 8,
          }}
        >
          These ports came from ETC&rsquo;s DaVinci library ({new Date(davinci.enrichedAt).toLocaleDateString()}).
          Editing them here means a future enrichment run will leave your version alone.
        </div>
      )}

      {rows.length === 0 && (
        <div style={{ fontSize: 12, color: "#aab0bb", padding: "8px 0" }}>
          No ports — this part cannot be wired in The Grid yet.
        </div>
      )}

      {rows.map((row, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr .7fr 56px 30px", gap: 6, marginBottom: 6, alignItems: "center" }}>
          <select
            aria-label={`Port ${i + 1} connection type`}
            value={row.connectionType}
            onChange={(e) => patch(i, { connectionType: e.target.value })}
            style={cell}
          >
            {/* A new row starts on this placeholder, not a real connection
                type (D189 follow-up) — a stray "+ Add port" click must not
                manufacture a wireable-but-wrong `powerCON/True1` input with
                zero typing. The server already refuses "" (not a member of
                CONNECTION_TYPES), so the row can't be saved without a
                deliberate choice. */}
            <option value="" disabled>Choose a connection type…</option>
            {CONNECTION_TYPES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          {/* Secondary detail (#162) — connectionType above is what actually
              governs wireability; name is display-only and, on DaVinci rows,
              can be a leftover connector label that disagrees with it. */}
          <input
            aria-label={`Port ${i + 1} name`}
            value={row.name}
            onChange={(e) => patch(i, { name: e.target.value })}
            placeholder="Audio in"
            style={{ ...cell, color: "#5b616e", fontSize: 12 }}
          />
          <select
            aria-label={`Port ${i + 1} direction`}
            value={row.direction}
            onChange={(e) => patch(i, { direction: e.target.value as PortDirection })}
            style={cell}
          >
            {PORT_DIRECTIONS.map((d) => (
              <option key={d} value={d}>{DIRECTION_LABEL[d]}</option>
            ))}
          </select>
          <input
            aria-label={`Port ${i + 1} count`}
            type="number"
            min={1}
            step={1}
            value={row.count == null ? "" : String(row.count)}
            onChange={(e) => {
              const v = e.target.value.trim();
              // type="number" sanitizes the DOM value to "" or a valid
              // floating-point token, but an out-of-range exponent (e.g.
              // "1e400") still parses to a non-finite number — never let
              // NaN/Infinity reach state, where it would render back as the
              // literal string "NaN" and get silently dropped on submit
              // (JSON.stringify(NaN) -> null, which parsePortsField treats
              // as absent).
              const n = v === "" ? undefined : Number(v);
              patch(i, { count: n !== undefined && Number.isFinite(n) ? n : undefined });
            }}
            placeholder="1"
            style={cell}
          />
          <button
            type="button"
            aria-label={`Remove port ${i + 1}`}
            onClick={() => setRows((r) => r.filter((_, idx) => idx !== i))}
            style={{ ...cell, width: 30, cursor: "pointer", color: "#8a3a2a", fontWeight: 700, padding: "6px 0", textAlign: "center" }}
          >
            ×
          </button>
        </div>
      ))}

      <button
        type="button"
        onClick={() => setRows((r) => [...r, { name: "", direction: "in", connectionType: "" }])}
        style={{ ...cell, width: "auto", cursor: "pointer", fontWeight: 600, color: "#3d424e", marginTop: 2 }}
      >
        + Add port
      </button>
    </div>
  );
}
