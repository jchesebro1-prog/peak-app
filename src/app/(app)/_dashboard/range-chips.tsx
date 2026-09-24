import Link from "next/link";
import { RANGES, RANGE_LABEL, dashHref, type RangeKey } from "@/lib/dashboard/registry";

export default function RangeChips({ base, range, keep }: { base: string; range: RangeKey; keep: Record<string, string | undefined> }) {
  return (
    <div style={{ display: "flex", gap: 6, background: "#fff", border: "1px solid #e4e7ec", borderRadius: 10, padding: 4 }}>
      {RANGES.map((k) => {
        const on = range === k;
        return (
          <Link
            key={k}
            href={dashHref(base, { ...keep, range: k })}
            style={{
              fontSize: 12, fontWeight: 600, padding: "6px 13px", borderRadius: 7, textDecoration: "none",
              background: on ? "var(--accent)" : "transparent",
              color: on ? "var(--accent-contrast, #16181b)" : "#8c919c",
            }}
          >
            {RANGE_LABEL[k]}
          </Link>
        );
      })}
    </div>
  );
}
