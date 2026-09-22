import { cache } from "react";
import type { CSSProperties } from "react";
import { getOptionalUser } from "@/lib/session";
import { canRecord, getSettings } from "@/lib/settings";
import { getKrispConnectionInfo } from "@/lib/krisp/connections";
import { recordingsForParent, type RecordingParentKind } from "@/lib/stores/recordings";
import { RecordControlLink } from "./record-control-link";

/**
 * <RecordControl parentKind parentId> — Recordings spec §6. Server component:
 * shown when the viewer passes the beta gate (`canRecord`, spec §1.3) AND
 * (the viewer has a Krisp connection OR the parent already has ≥ 1
 * recording). Renders ./record-control-link.tsx when visible, nothing
 * otherwise.
 *
 * Reads are batched for list surfaces: the per-viewer half (settings +
 * Krisp connection) is memoised per request with React `cache`, so a page
 * that renders one control per row pays for it once; the per-parent half
 * is skipped when the caller already knows `hasRecordings` (compute a
 * count map with `recordingCountByParent` in app/(app)/recordings/data.ts
 * from ONE allRecordings() pass).
 */

export type RecordGate = { canRecord: boolean; krispConnected: boolean; userId: string | null };

/** Pure visibility rule (spec §6) — exported for callers that already hold the data. */
export function recordControlVisibility(gate: {
  canRecord: boolean;
  krispConnected: boolean;
  hasRecordings: boolean;
}): boolean {
  return gate.canRecord && (gate.krispConnected || gate.hasRecordings);
}

/** Per-request memoised viewer gate: beta list + Krisp connection. */
export const loadRecordGate = cache(async (): Promise<RecordGate> => {
  const user = await getOptionalUser();
  if (!user) return { canRecord: false, krispConnected: false, userId: null };
  const [settings, conn] = await Promise.all([getSettings(), getKrispConnectionInfo(user.id)]);
  return { canRecord: canRecord(user.id, settings), krispConnected: !!conn, userId: user.id };
});

export async function RecordControl({
  parentKind,
  parentId,
  size = "md",
  hasRecordings,
  style,
}: {
  parentKind: RecordingParentKind;
  parentId: string;
  size?: "sm" | "md";
  /** Pass when the caller already knows (list pages) — skips the per-parent read. */
  hasRecordings?: boolean;
  style?: CSSProperties;
}) {
  const gate = await loadRecordGate();
  if (!gate.canRecord) return null;
  const has =
    hasRecordings ?? (gate.krispConnected ? true : (await recordingsForParent(parentKind, parentId)).length > 0);
  if (!recordControlVisibility({ ...gate, hasRecordings: has })) return null;
  return <RecordControlLink parentKind={parentKind} parentId={parentId} size={size} style={style} />;
}
