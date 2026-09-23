import type { WidgetId } from "@/lib/dashboard/registry";
import type { WidgetRenderer } from "@/lib/dashboard/context";
import { HOME_RENDERERS } from "./widgets/home-cards";

/** #43 — id → renderer. Partial until every widget file lands (Task 9 makes
 *  it a full Record so tsc enforces completeness from then on). */
export const RENDERERS: Partial<Record<WidgetId, WidgetRenderer>> = { ...HOME_RENDERERS };
