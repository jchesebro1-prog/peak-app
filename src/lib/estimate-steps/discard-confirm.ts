/* #348 follow-up (Jeff 2026-10-15) — ask before a stray click discards an Estimator pop-up with unsaved work.
   Pure: the hook snapshots each open's draft once it settles (stableDraftJson) and compares it at close (inputIsDirty);
   the confirm text comes from here. Nothing here touches the DOM or React. */

/** The five configurator pop-ups whose × / backdrop click discards a draft (closeInput). AI scope and Add a system
 *  hold no draft and keep closing without a question. */
export const MODAL_INPUT_KINDS = ["curtain", "track", "fixture", "labor", "vendor"] as const;
export type ModalInputKind = (typeof MODAL_INPUT_KINDS)[number];
export const isModalInputKind = (k: string): k is ModalInputKind => (MODAL_INPUT_KINDS as readonly string[]).includes(k);

/** Plain values with sorted keys and no undefined members, so key order and "undefined vs missing" never count. */
function normalize(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(normalize);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(o).sort()) if (o[k] !== undefined && typeof o[k] !== "function") out[k] = normalize(o[k]);
    return out;
  }
  return v;
}

/** A draft as a comparable string (the baseline the hook stores). */
export function stableDraftJson(v: unknown): string {
  return JSON.stringify(normalize(v)) ?? "";
}

/** Whether `current` differs from the stored baseline. No baseline yet (null / undefined: the open hasn't settled) is
 *  clean — a question with nothing behind it is worse than none. */
export function draftChanged(baseline: string | null | undefined, current: unknown): boolean {
  if (baseline == null) return false;
  return stableDraftJson(current) !== baseline;
}

/** The open pop-up is dirty when its draft moved off the baseline, or (vendor) while Read the PDF is running. */
export function inputIsDirty(a: { baseline: string | null | undefined; current: unknown; reading?: boolean }): boolean {
  return !!a.reading || draftChanged(a.baseline, a.current);
}

/** Re-base a stored baseline through the same change the form just took (the Inbox hand-off's fill), so typing done
 *  while it ran still counts as the user's. A missing or unreadable baseline is returned as-is. */
export function rebaseDraft<T>(baseline: string | null | undefined, apply: (d: T) => T): string | null | undefined {
  if (baseline == null) return baseline;
  try {
    return stableDraftJson(apply(JSON.parse(baseline) as T));
  } catch {
    return baseline;
  }
}

export const DISCARD_COPY = {
  noun: { curtain: "curtain", track: "track", fixture: "assembly", labor: "labor", vendor: "vendor quote" } as Record<ModalInputKind, string>,
  generic: (noun: string) => `Discard this ${noun}? Your changes will be lost.`,
  vendorRead: "Discard this vendor quote? The PDF read and your changes will be lost.",
} as const;

/** The confirm text: a vendor quote with a PDF read (or one running) names the read; every other pop-up the generic. */
export function discardConfirmText(kind: ModalInputKind, o: { read?: boolean } = {}): string {
  if (kind === "vendor" && o.read) return DISCARD_COPY.vendorRead;
  return DISCARD_COPY.generic(DISCARD_COPY.noun[kind]);
}
