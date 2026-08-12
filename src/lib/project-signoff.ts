import { GRID_SCOPES, type GridScope } from "@/lib/design/grid-scopes";
import type { ProjectSignoff } from "@/lib/stores/projects";

export type ProjectSignoffLike = {
  stage: string;
  stageHistory?: Array<{ at: number; from: string | null; to: string; by: string }>;
  signoff?: ProjectSignoff | null;
  updatedAt?: number;
};

export function normalizeScopeChecks(raw: unknown): Partial<Record<GridScope, boolean>> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const out: Partial<Record<GridScope, boolean>> = {};
  for (const scope of GRID_SCOPES) {
    const value = (raw as Record<string, unknown>)[scope];
    if (typeof value === "boolean") out[scope] = value;
  }
  return Object.keys(out).length ? out : undefined;
}

export function normalizeProjectSignoff(
  signoff: Partial<ProjectSignoff>,
  signedBy: string,
  signedAt: number
): ProjectSignoff {
  const name = typeof signoff.name === "string" ? signoff.name.trim() : "";
  const role = typeof signoff.role === "string" ? signoff.role.trim() : "";
  const note = typeof signoff.note === "string" ? signoff.note.trim() : "";
  const signatureBlobKeyRaw =
    typeof signoff.signatureBlobKey === "string" ? signoff.signatureBlobKey.trim() : "";
  const signedByNameRaw =
    typeof signoff.signedByName === "string" ? signoff.signedByName.trim() : "";
  const capturedByRaw =
    typeof signoff.capturedBy === "string" ? signoff.capturedBy.trim() : "";
  const scopeChecks = normalizeScopeChecks(signoff.scopeChecks);
  return {
    signedBy,
    signedAt,
    ...(name ? { name } : {}),
    ...(role ? { role } : {}),
    ...(note ? { note } : {}),
    ...(scopeChecks ? { scopeChecks } : {}),
    signatureBlobKey: signatureBlobKeyRaw || null,
    signedByName: signedByNameRaw || name || signedBy,
    capturedBy: capturedByRaw || signedBy,
  };
}

export function applyProjectSignoff<T extends ProjectSignoffLike>(
  project: T,
  signoff: Partial<ProjectSignoff>,
  actor: string,
  stampedAt: number
): T {
  const next = {
    ...project,
    signoff: normalizeProjectSignoff(signoff, actor, stampedAt),
    updatedAt: stampedAt,
  } as T;
  if (next.stage !== "complete" && next.stage !== "signoff") {
    const stageHistory = Array.isArray(next.stageHistory) ? [...next.stageHistory] : [];
    stageHistory.push({ at: stampedAt, from: next.stage ?? null, to: "signoff", by: actor });
    next.stageHistory = stageHistory;
    next.stage = "signoff";
  }
  return next;
}
