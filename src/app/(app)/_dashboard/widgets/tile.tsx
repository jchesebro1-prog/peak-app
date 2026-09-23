import type { ReactNode } from "react";
import { KpiTile } from "@/components/ui";

/** #43 — every metric-tile widget renders through KpiTile (decision 7). */
export function tile(
  label: string,
  value: string,
  sub: string,
  tone?: "green" | "amber" | "red" | "blue" | "accent"
): ReactNode {
  return <KpiTile label={label} value={value} sub={sub} tone={tone} />;
}
