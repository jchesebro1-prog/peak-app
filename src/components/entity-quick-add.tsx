"use client";

import type { CSSProperties, ReactElement } from "react";
import { CUSTOMER_TYPES } from "@/app/(app)/companies/lib";

export type QuickAddKind = "customer" | "contact" | "venue";

export type QuickAddValues = {
  customer: { name: string; type: string };
  contact: { name: string; role: string; email: string; phone: string };
  venue: { label: string; city: string; state: string };
};

export const LABEL: CSSProperties = {
  display: "block",
  fontSize: 11,
  fontWeight: 600,
  color: "#9aa0ab",
  letterSpacing: ".05em",
  textTransform: "uppercase",
  margin: "16px 0 6px",
};

export const INPUT: CSSProperties = {
  width: "100%",
  border: "1px solid #e4e7ec",
  borderRadius: 9,
  padding: "9px 11px",
  fontSize: 13,
  fontFamily: "var(--font-ui)",
  color: "#16181d",
  background: "#fff",
  outline: "none",
};

const skipLinkStyle: CSSProperties = {
  justifySelf: "start",
  background: "none",
  border: "none",
  padding: 0,
  color: "#8c919c",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
};

type Props<K extends QuickAddKind> = {
  kind: K;
  value: QuickAddValues[K];
  onChange: (v: QuickAddValues[K]) => void;
  /** optional skip/cancel link — the quote intake uses it for venue + contact (not customer) */
  onCancel?: () => void;
  /** optional submit row — the quote intake omits it (submits with the surrounding form); the sidebar uses it */
  onSubmit?: () => void;
  submitting?: boolean;
  error?: string | null;
};

function EntityQuickAddImpl({
  kind,
  value,
  onChange,
  onCancel,
  onSubmit,
  submitting,
  error,
}: {
  kind: QuickAddKind;
  value: QuickAddValues[QuickAddKind];
  onChange: (v: QuickAddValues[QuickAddKind]) => void;
  onCancel?: () => void;
  onSubmit?: () => void;
  submitting?: boolean;
  error?: string | null;
}) {
  let fields: React.ReactNode;

  if (kind === "customer") {
    const v = value as QuickAddValues["customer"];
    fields = (
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <input
          value={v.name}
          onChange={(e) => onChange({ ...v, name: e.target.value })}
          placeholder="Customer name"
          style={INPUT}
        />
        <select
          value={v.type}
          onChange={(e) => onChange({ ...v, type: e.target.value })}
          style={INPUT}
        >
          {CUSTOMER_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>
    );
  } else if (kind === "venue") {
    const v = value as QuickAddValues["venue"];
    fields = (
      <div style={{ display: "grid", gap: 8 }}>
        <input
          value={v.label}
          onChange={(e) => onChange({ ...v, label: e.target.value })}
          placeholder="Venue name (e.g. Main auditorium)"
          style={INPUT}
        />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <input
            value={v.city}
            onChange={(e) => onChange({ ...v, city: e.target.value })}
            placeholder="City"
            style={INPUT}
          />
          <input
            value={v.state}
            onChange={(e) => onChange({ ...v, state: e.target.value })}
            placeholder="State"
            style={INPUT}
          />
        </div>
      </div>
    );
  } else {
    const v = value as QuickAddValues["contact"];
    fields = (
      <div style={{ display: "grid", gap: 8 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <input
            value={v.name}
            onChange={(e) => onChange({ ...v, name: e.target.value })}
            placeholder="Name"
            style={INPUT}
          />
          <input
            value={v.role}
            onChange={(e) => onChange({ ...v, role: e.target.value })}
            placeholder="Role (optional)"
            style={INPUT}
          />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <input
            value={v.email}
            onChange={(e) => onChange({ ...v, email: e.target.value })}
            placeholder="Email (optional)"
            style={INPUT}
          />
          <input
            value={v.phone}
            onChange={(e) => onChange({ ...v, phone: e.target.value })}
            placeholder="Phone (optional)"
            style={INPUT}
          />
        </div>
      </div>
    );
  }

  return (
    <div>
      {fields}
      {(onCancel || onSubmit) && (
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 8 }}>
          {onSubmit && (
            <button
              type="button"
              onClick={onSubmit}
              disabled={submitting}
              className="pk-btn-accent"
              style={{
                padding: "8px 14px",
                fontSize: 12.5,
                opacity: submitting ? 0.55 : 1,
                cursor: submitting ? "default" : "pointer",
              }}
            >
              {submitting ? "Adding…" : "Add"}
            </button>
          )}
          {onCancel && (
            <button type="button" onClick={onCancel} style={skipLinkStyle}>
              Skip for now
            </button>
          )}
        </div>
      )}
      {error && (
        <div
          style={{
            marginTop: 10,
            background: "#f9ece8",
            border: "1px solid #f0d6cd",
            borderRadius: 9,
            padding: "10px 13px",
            fontSize: 12.5,
            color: "#b4543a",
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}

// EntityQuickAddImpl is implemented against a loosened, non-generic prop
// shape (kind switches at runtime, so TS can't narrow the mapped type per
// branch); this cast restores the precise per-kind generic signature for
// callers.
const EntityQuickAdd = EntityQuickAddImpl as unknown as <K extends QuickAddKind>(
  props: Props<K>
) => ReactElement;

export default EntityQuickAdd;
