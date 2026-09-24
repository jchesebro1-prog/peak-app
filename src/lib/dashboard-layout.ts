export const DASHBOARD_WIDGETS = [
  "stats",
  "pipeline",
  "calendar",
  "queue",
  "inbox",
  "leads",
  "designs",
  "surveys",
  "teamActivity",
  "needsAttention",
  "catalog",
] as const;

export type DashboardWidgetKey = (typeof DASHBOARD_WIDGETS)[number];
export type DashboardWidgetWidth = "full" | "half" | "third" | "sidebar";

export type DashboardWidget = {
  key: DashboardWidgetKey;
  visible: boolean;
  position: number;
  width: DashboardWidgetWidth;
};

export type DashboardLayout = {
  version: 1;
  widgets: DashboardWidget[];
};

export type DashboardOverride = {
  version?: number;
  hidden?: string[];
  order?: string[];
  widths?: Record<string, string>;
};

const DEFAULT_WIDTHS: Record<DashboardWidgetKey, DashboardWidgetWidth> = {
  stats: "full",
  pipeline: "full",
  calendar: "sidebar",
  queue: "sidebar",
  inbox: "half",
  leads: "half",
  designs: "half",
  surveys: "half",
  teamActivity: "half",
  needsAttention: "half",
  catalog: "half",
};

export function defaultDashboardLayout(): DashboardLayout {
  return {
    version: 1,
    widgets: DASHBOARD_WIDGETS.map((key, position) => ({
      key,
      visible: true,
      position,
      width: DEFAULT_WIDTHS[key],
    })),
  };
}

function isWidgetKey(value: string): value is DashboardWidgetKey {
  return (DASHBOARD_WIDGETS as readonly string[]).includes(value);
}

function isWidth(value: string): value is DashboardWidgetWidth {
  return value === "full" || value === "half" || value === "third" || value === "sidebar";
}

export function resolveDashboardLayout(
  company: DashboardLayout,
  override: DashboardOverride | null | undefined,
): DashboardLayout {
  if (!override) return cloneLayout(company);
  if (override.version != null && override.version !== 1) return cloneLayout(company);

  const hidden = new Set((override.hidden || []).filter(isWidgetKey));
  const requestedOrder = (override.order || []).filter(isWidgetKey);
  const order = [...requestedOrder, ...company.widgets.map((w) => w.key)]
    .filter((key, index, all) => all.indexOf(key) === index);

  const companyByKey = new Map(company.widgets.map((w) => [w.key, w]));
  const widths = override.widths || {};

  return {
    version: 1,
    widgets: order.map((key, position) => {
      const base = companyByKey.get(key) || {
        key,
        visible: true,
        position,
        width: DEFAULT_WIDTHS[key],
      };
      const requestedWidth = widths[key];
      return {
        key,
        visible: !hidden.has(key) && base.visible,
        position,
        width: isWidth(requestedWidth || "") ? requestedWidth as DashboardWidgetWidth : base.width,
      };
    }),
  };
}

function cloneLayout(layout: DashboardLayout): DashboardLayout {
  return {
    version: 1,
    widgets: layout.widgets.map((w, position) => ({ ...w, position })),
  };
}
