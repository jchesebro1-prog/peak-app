import type { ReactNode } from "react";
import type { SessionUser } from "@/lib/session";
import type { DashboardData } from "./data";
import type { RangeKey, Surface } from "./registry";

/** #43 — what every widget renderer receives. `sp` is the flattened query
 *  string so widget-local URL state (?pipe, ?sheet, ?drill) passes through. */
export type WidgetCtx = {
  user: SessionUser;
  surface: Surface;
  range: RangeKey;
  now: number;
  sp: Record<string, string | undefined>;
  data: DashboardData;
};

export type WidgetRenderer = (ctx: WidgetCtx) => Promise<ReactNode>;
