/**
 * Conduit riser (#321 polish) — small pure rules the riser editor and the
 * plan's riser prompt share with the harness: the spoken names of the
 * canvas hit targets, which keys press one, and when a late Add answer may
 * hide the plan prompt.
 */

import { drawingSystemOf, type DrawingSystemKey, type GridLayer } from "@/lib/design/grid-scopes";
import { systemDefaults, type ConduitRiserSystem } from "./model";
import { riserSystemOf } from "./live";

/** "Tag CRO-04" */
export const tagHitLabel = (label: string) => `Tag ${label}`;
/** "Stub TO FACP" */
export const stubHitLabel = (label: string) => `Stub ${label}`;
/** "Level Catwalk" */
export const levelHitLabel = (label: string) => `Level ${label}`;
/** "Run ER-01 → CRO-04, 3/4\"" — a cable-management run says so instead of a size. */
export function runHitLabel(aLabel: string, bLabel: string, size: string, style: "conduit" | "cableMgmt" = "conduit"): string {
  const what = style === "cableMgmt" ? "cable management" : size.trim();
  return `Run ${aLabel} → ${bLabel}${what ? `, ${what}` : ""}`;
}

/** Enter and Space press a hit target, as they press a button. */
export const isPressKey = (key: string) => key === "Enter" || key === " " || key === "Spacebar";

/** The plan prompt a user answered, and the one showing now. */
export type PromptTicket = { key: string; ticket: number };

/**
 * A late Add answer hides the prompt only when the prompt showing is still
 * the one that was answered — same pair key, same ticket. A newer wire's
 * prompt (a new ticket, maybe a new key) stays up.
 */
export function addAnswerHides(current: PromptTicket | null, answered: PromptTicket): boolean {
  return !!current && current.key === answered.key && current.ticket === answered.ticket;
}

/* ------------------------- #328: one rule per riser ------------------------ */

/** Each riser's name as a heading or page title. */
export const RISER_TITLE: Readonly<Record<ConduitRiserSystem, string>> = { lighting: "Lighting control riser", av: "A/V conduit riser" };

/** Each riser's name inside a sentence ("Add … to the A/V conduit riser?"). */
export const riserName = (system: ConduitRiserSystem) => (system === "av" ? "A/V conduit riser" : "lighting control riser");

/** The wires a riser takes, inside a sentence ("every A/V wire …"). */
export const riserWireNoun = (system: ConduitRiserSystem) => (system === "av" ? "A/V" : "lighting");

/** What a riser's devices are, for the empty-detail hint. */
export const riserDeviceNoun = (system: ConduitRiserSystem) => (system === "av" ? "audio or video" : "lighting control");

/** Connect → "With wire…" drew a wire this riser doesn't take. */
export const notThisRiserNotice = (system: ConduitRiserSystem) =>
  `The wire is on the plan, but it isn't ${system === "av" ? "an A/V" : "a lighting control"} wire, so the riser didn't add a run for it.`;

/** The riser page for one option and system — lighting keeps its old URL. */
export function conduitRiserHref(base: string, optionId: string, system: ConduitRiserSystem): string {
  return `${base}/conduit-riser?option=${encodeURIComponent(optionId)}${system === "av" ? "&system=av" : ""}`;
}

/**
 * The plan prompt's riser for a wire just drawn between two devices (#328
 * C3): the riser both ends' drawing systems belong on. A lighting pair asks
 * about the lighting control riser, an audio / video pair the A/V conduit
 * riser; an end on no riser (general, rigging) goes with the other end; a
 * lighting ↔ A/V pair, or a pair on no riser, asks nothing. Shared by the
 * client pre-check and the server rule so the two can't disagree.
 */
export function promptRiserSystem(a: DrawingSystemKey | null | undefined, b: DrawingSystemKey | null | undefined): ConduitRiserSystem | null {
  const found = new Set([a, b].map((k) => (k ? riserSystemOf(k) : null)).filter((s): s is ConduitRiserSystem => !!s));
  return found.size === 1 ? [...found][0] : null;
}

/** The plan prompt's line. Lighting's wording is unchanged from #321. */
export function riserPromptText(p: { label: string; joins: boolean; byOthers: boolean; system: ConduitRiserSystem }): string {
  const ask = p.joins
    ? p.system === "av"
      ? `${p.label} joins an existing run on the A/V conduit riser — add this wire?`
      : `${p.label} joins the existing run — add this wire?`
    : `Add ${p.label} to the ${riserName(p.system)}?`;
  return ask + (p.byOthers ? " — its wire will be listed as by others" : "");
}

/**
 * The Always show panel's device types for one riser: every live type whose
 * scope draws on that riser's system (Lighting → lighting; Audio, Video →
 * A/V), plus the system's default always-show types and anything the riser
 * already shows (so a ticked type never disappears from the list). Sorted
 * by the type list's order, then label.
 */
export function alwaysShowTypeOptions(
  types: ReadonlyArray<{ key: string; label: string; scope: GridLayer; order: number; archived?: boolean }>,
  system: ConduitRiserSystem,
  selected: readonly string[]
): { key: string; label: string }[] {
  const shown = new Set([...systemDefaults(system).alwaysShow, ...selected]);
  return types
    .filter((t) => !t.archived && (riserSystemOf(drawingSystemOf(t.scope)) === system || shown.has(t.key)))
    .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label))
    .map((t) => ({ key: t.key, label: t.label }));
}
