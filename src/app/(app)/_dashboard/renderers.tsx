import type { WidgetId } from "@/lib/dashboard/registry";
import type { WidgetRenderer } from "@/lib/dashboard/context";
import { HOME_RENDERERS } from "./widgets/home-cards";
import { INSTALLS_RENDERERS } from "./widgets/installs";
import { SALES_RENDERERS } from "./widgets/sales";
import { BACKWARD_RENDERERS } from "./widgets/backward";

/** #43 — id → renderer. The full Record makes tsc enforce registry coverage. */
export const RENDERERS: Record<WidgetId, WidgetRenderer> = {
  ...HOME_RENDERERS,
  ...SALES_RENDERERS,
  ...INSTALLS_RENDERERS,
  ...BACKWARD_RENDERERS,
};
