import { CONFLICT_LABEL, type Conflict } from "@/lib/visit-plan/check";

/** "⚠ Double-booked +1" — every conflict's full text in title + aria-label.
 *  No hooks: renders in server and client trees alike. */
export default function ConflictBadge({ conflicts, compact = false }: { conflicts: Conflict[]; compact?: boolean }) {
  if (!conflicts.length) return null;
  const all = conflicts.map((c) => c.text).join("\n");
  const first = conflicts[0];
  const label = compact ? CONFLICT_LABEL[first.kind] : first.text;
  return (
    <span
      role="img"
      aria-label={all}
      title={all}
      style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: compact ? 10 : 11.5, fontWeight: 600, color: "#8a5a00", whiteSpace: compact ? "nowrap" : "normal" }}
    >
      ⚠ {label}
      {conflicts.length > 1 ? ` +${conflicts.length - 1}` : ""}
    </span>
  );
}
