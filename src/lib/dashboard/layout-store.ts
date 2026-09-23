/**
 * #43 — per-user dashboard layouts. One blobs row per user
 * (`dashboard_layouts:<userId>`), one key per surface. `null` for a surface
 * means "never customized" → the role preset. Same shape as the notifPrefs
 * row (per-user, sparse JSON) but keyed by user id and stored through the
 * settings-style getBlob/setBlob so no table or migration is needed.
 */
import { getBlob, setBlob } from "@/db/doc-store";
import { getSettings } from "@/lib/settings";
import { getDashboardOverride } from "@/lib/stores/notif-prefs";
import { resolveDashboardLayout } from "@/lib/dashboard-layout";
import { normalizeLayout, type Surface, type WidgetId } from "./registry";

type Stored = { home: string[] | null; reports: string[] | null };
const EMPTY: Stored = { home: null, reports: null };
const blobId = (userId: string) => `dashboard_layouts:${userId}`;
const LEGACY_HOME: Record<string, string[]> = {
  stats: ["my-open-pipeline", "my-win-rate", "my-out-for-signature", "my-avg-quote"],
  pipeline: ["my-pipeline"], calendar: ["calendar"], queue: ["my-queue"], inbox: ["inbox"],
  leads: ["my-leads"], designs: ["my-designs"], surveys: ["venue-assessments"],
  teamActivity: ["team-activity"], needsAttention: ["needs-attention"], catalog: ["catalog"],
};

async function legacyHome(userName: string, roles: string[]): Promise<WidgetId[] | null> {
  const [settings, override] = await Promise.all([getSettings(), getDashboardOverride(userName)]);
  const resolved = resolveDashboardLayout(settings.dashboardDefaults, override);
  const ids = resolved.widgets
    .filter((w) => w.visible)
    .sort((a, b) => a.position - b.position)
    .flatMap((w) => LEGACY_HOME[w.key] || []);
  return ids.length ? normalizeLayout(ids, "home", roles) : null;
}

async function storedLayout(userId: string, surface: Surface): Promise<string[] | null> {
  const row = await getBlob<Stored>(blobId(userId), EMPTY);
  const v = row[surface];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : null;
}

export async function layoutFor(
  userId: string,
  surface: Surface,
  roles: string[],
  legacyUserName?: string,
): Promise<{ ids: WidgetId[]; customized: boolean }> {
  const stored = await storedLayout(userId, surface);
  if (stored === null && surface === "home" && legacyUserName) {
    const legacy = await legacyHome(legacyUserName, roles);
    if (legacy) return { ids: legacy, customized: true };
  }
  return { ids: normalizeLayout(stored, surface, roles), customized: stored !== null };
}

/** Normalizes before writing so a stale client list can't persist junk. */
export async function saveLayout(
  userId: string,
  surface: Surface,
  ids: string[],
  roles: string[]
): Promise<WidgetId[]> {
  const next = normalizeLayout(ids, surface, roles);
  await setBlob(blobId(userId), { [surface]: next });
  return next;
}

export async function resetLayout(userId: string, surface: Surface): Promise<void> {
  await setBlob(blobId(userId), { [surface]: null });
}
