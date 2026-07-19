import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";

/**
 * Shared screen primitives — the recurring patterns across prototype
 * screens (KPI tiles, stage/status pills, filter chips, section cards,
 * empty states). Exact values follow docs/specs tokens; screens must use
 * these instead of re-inventing per-screen variants.
 */

export function PageHeader({
  title,
  sub,
  actions,
}: {
  title: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 16,
        flexWrap: "wrap",
        marginBottom: 18,
      }}
    >
      <div>
        <div style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-0.015em" }}>
          {title}
        </div>
        {sub && (
          <div style={{ fontSize: 13.5, color: "#8c919c", marginTop: 5 }}>
            {sub}
          </div>
        )}
      </div>
      {actions && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {actions}
        </div>
      )}
    </div>
  );
}

export function Card({
  children,
  style,
  pad = true,
}: {
  children: ReactNode;
  style?: CSSProperties;
  pad?: boolean;
}) {
  return (
    <section
      className="pk-card"
      style={{ padding: pad ? "17px 18px" : 0, overflow: pad ? undefined : "hidden", ...style }}
    >
      {children}
    </section>
  );
}

export function SectionTitle({
  title,
  desc,
  right,
}: {
  title: ReactNode;
  desc?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
      <div>
        <div style={{ fontSize: 14.5, fontWeight: 600 }}>{title}</div>
        {desc && <div style={{ fontSize: 12, color: "#9aa0ab", marginTop: 3 }}>{desc}</div>}
      </div>
      {right}
    </div>
  );
}

export function KpiTile({
  label,
  value,
  sub,
  tone,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "green" | "amber" | "red" | "blue" | "accent";
}) {
  const toneColor =
    tone === "green"
      ? "#3fae74"
      : tone === "amber"
        ? "#d98a2b"
        : tone === "red"
          ? "#b4543a"
          : tone === "blue"
            ? "#3d8bf2"
            : tone === "accent"
              ? "var(--accent)"
              : "#16181d";
  return (
    <div className="pk-card" style={{ padding: "14px 16px" }}>
      <div
        style={{
          fontSize: 10.5,
          fontWeight: 600,
          letterSpacing: ".05em",
          textTransform: "uppercase",
          color: "#aab0bb",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 24,
          fontWeight: 700,
          letterSpacing: "-0.02em",
          marginTop: 6,
          color: toneColor,
          fontFamily: "var(--font-ui)",
        }}
      >
        {value}
      </div>
      {sub && <div style={{ fontSize: 11.5, color: "#9aa0ab", marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

/** Status pill — status colors per README: green won/complete/pass, amber due-soon/warning, red overdue/urgent/fail, blue informational/scheduled. */
export function Pill({
  children,
  color = "#5b616e",
}: {
  children: ReactNode;
  color?: string;
}) {
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 600,
        padding: "2px 8px",
        borderRadius: 20,
        color,
        background: `color-mix(in srgb, ${color} 11%, #fff)`,
        border: `1px solid color-mix(in srgb, ${color} 26%, #fff)`,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

/* ---- Monday-style status treatment (PUNCHLIST #5 phase 1, D79) ----------- */

/** Monday.com's status palette — the exact hues the team already knows:
 *  done-green, working-orange, stuck-red, plus blue/purple/gray accents. */
export const MONDAY_TONE: Record<string, string> = {
  green: "#00c875",
  orange: "#fdab3d",
  red: "#e2445c",
  blue: "#579bfc",
  darkblue: "#0086c0",
  purple: "#a25ddc",
  gray: "#c4c4c4",
};

/** Solid Monday-style status pill: saturated fill, white text, centered with
 *  a consistent width — the instantly recognizable status cell. Use for
 *  primary status/stage columns; keep the soft `Pill` for secondary metadata
 *  chips. `tone` is a MONDAY_TONE key or any CSS color. */
export function StatusPill({
  tone = "gray",
  children,
  minWidth = 84,
}: {
  tone?: string;
  children: ReactNode;
  minWidth?: number;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth,
        fontSize: 11.5,
        fontWeight: 600,
        color: "#fff",
        background: MONDAY_TONE[tone] || tone,
        borderRadius: 5,
        padding: "5px 11px",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

/** Canonical status→tone maps so every screen colors a given status the same
 *  way (quotes today; extend per record type as screens adopt StatusPill). */
export const QUOTE_STATUS_TONE: Record<string, string> = {
  draft: "orange",
  sent: "blue",
  won: "green",
  lost: "gray",
};

export const LEAD_STAGE_TONE: Record<string, string> = {
  new: "red",
  contacted: "orange",
  qualified: "blue",
  quoted: "purple",
  won: "green",
  lost: "gray",
};

export const STATUS_COLORS: Record<string, string> = {
  draft: "#5b616e",
  sent: "#3d8bf2",
  won: "#1f7a52",
  lost: "#8c919c",
  approved: "#3d8bf2",
  scheduled: "#3155a8",
  completed: "#1f7a52",
  requested: "#8a6d1f",
  onsite: "#7b3f8a",
  overdue: "#b4543a",
  due_soon: "#d98a2b",
  in_review: "#8a6d1f",
};

export function FilterChips<T extends string>({
  options,
  active,
  hrefFor,
  countFor,
}: {
  options: Array<{ key: T; label: string }>;
  active: T;
  hrefFor: (key: T) => string;
  countFor?: (key: T) => number | null;
}) {
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {options.map((o) => {
        const on = o.key === active;
        const count = countFor?.(o.key);
        return (
          <Link
            key={o.key}
            href={hrefFor(o.key)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12,
              fontWeight: 600,
              padding: "6px 11px",
              borderRadius: 20,
              textDecoration: "none",
              color: on ? "#fff" : "#3a3f4a",
              background: on ? "var(--accent)" : "#fff",
              border: on ? "1px solid var(--accent)" : "1px solid #e4e7ec",
            }}
          >
            {o.label}
            {count != null && count > 0 && (
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 10,
                  fontWeight: 700,
                  padding: "0 6px",
                  borderRadius: 20,
                  background: on ? "rgba(255,255,255,.25)" : "#f1f2f5",
                  color: on ? "#fff" : "#5b616e",
                }}
              >
                {count}
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}

export function EmptyState({
  title,
  sub,
}: {
  title: ReactNode;
  sub?: ReactNode;
}) {
  return (
    <div style={{ padding: "34px 18px", textAlign: "center" }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: "#3a3f4a" }}>{title}</div>
      {sub && <div style={{ fontSize: 12, color: "#9aa0ab", marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

export function Avatar({
  name,
  initials,
  color,
  size = 26,
}: {
  name?: string;
  initials: string;
  color: string;
  size?: number;
}) {
  return (
    <span
      title={name}
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: color,
        color: "#fff",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: Math.max(9, Math.round(size * 0.38)),
        fontWeight: 600,
        flexShrink: 0,
      }}
    >
      {initials}
    </span>
  );
}

/** Mono-typeface metadata text (ids, emails, dates) — IBM Plex Mono per spec. */
export function Mono({
  children,
  size = 10.5,
  color = "#aab0bb",
  style,
}: {
  children: ReactNode;
  size?: number;
  color?: string;
  style?: CSSProperties;
}) {
  return (
    <span style={{ fontFamily: "var(--font-mono)", fontSize: size, color, ...style }}>
      {children}
    </span>
  );
}

export function SegmentedToggle<T extends string>({
  options,
  active,
  hrefFor,
}: {
  options: Array<{ key: T; label: string }>;
  active: T;
  hrefFor: (key: T) => string;
}) {
  return (
    <div
      style={{
        display: "inline-flex",
        background: "#f1f2f5",
        borderRadius: 9,
        padding: 3,
        gap: 2,
      }}
    >
      {options.map((o) => {
        const on = o.key === active;
        return (
          <Link
            key={o.key}
            href={hrefFor(o.key)}
            style={{
              fontSize: 12.5,
              fontWeight: 600,
              padding: "6px 14px",
              borderRadius: 7,
              textDecoration: "none",
              color: on ? "#16181d" : "#8c919c",
              background: on ? "#fff" : "transparent",
              boxShadow: on ? "0 1px 2px rgba(0,0,0,.08)" : "none",
            }}
          >
            {o.label}
          </Link>
        );
      })}
    </div>
  );
}
