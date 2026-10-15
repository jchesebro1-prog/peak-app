/**
 * Oct 15 #43 (Jeff): a Grid rack group links to its rack's RU elevation — the
 * Assembly Builder rack (`/design/assemblies/rack/<id>`, #296) is the source.
 * Pure, DB-free, client-safe.
 *
 * A placed rack assembly (`asm:<rackId>`, #211/#296) already IS the rack on the
 * Grid: it prices as the whole assembly (rack-level parts + every RU device) and
 * the risers list its devices. This module adds the group view and the link:
 *
 * - Every `asm:` rack placement shows the rack's devices as its group,
 *   read-only, with "Open rack →" — derived from the rack record at read time,
 *   never stored as placements, so nothing is priced twice.
 * - "Link to rack…" turns a plain holder (a rack enclosure part, say) into that
 *   rack: its part becomes `asm:<rackId>`, `rackId` marks the link and
 *   `rackHolderPartId` remembers the part it had. Refused while it holds devices
 *   of its own (they would price on top of the rack).
 * - "Unlink" puts the remembered part back and copies the rack's devices in as
 *   an ordinary group — one member placement per unit, each priced on its own
 *   from then on. A link is a device's own state: a part swap drops it.
 */
import { MAX_GROUP_MEMBERS, holdRefusal, type GroupLite } from "./grid-groups";

/** `asm:<fixtureId>` — grid-virtual-parts' assembly id, spelled here so this module stays dependency-light (client bundle). */
const ASM = "asm:";
const assemblyPartId = (fixtureId: string) => ASM + fixtureId;
const isVirtualPart = (partId: string) => partId.startsWith(ASM) || partId.startsWith("allow:");

/** The fields the link rules read off a placement. */
export type RackLinkLite = GroupLite & { partId: string; rackHolderPartId?: string };

/** One device line of a rack, as the Grid shows it. */
export type RackDeviceRow = { sku: string; desc: string; qty: number };

export const RACK_LINK_CURTAIN = "Curtains can't link to a rack.";
export const RACK_LINK_ALREADY = "This device is already linked to a rack.";
export const RACK_LINK_ASSEMBLY = "This device is an assembly already — link a plain device (a rack enclosure, say).";
export const RACK_LINK_GONE = "That rack no longer exists — pick another in the list.";
export const RACK_UNLINK_NOT_LINKED = "This device isn't linked to a rack.";
export const rackLinkHasMembers = (n: number) =>
  `Take out the ${n} device${n === 1 ? "" : "s"} inside first — a linked rack's devices come from the rack.`;
export const rackUnlinkTooMany = (n: number) =>
  `The rack has ${n} devices — a group holds at most ${MAX_GROUP_MEMBERS}, so it can't be copied in. Edit the rack instead.`;

/** The rack assembly id a placement draws as (`asm:<id>` whose assembly is a rack), else null. */
export function rackIdOf(partId: string, isRack: (fixtureId: string) => boolean): string | null {
  const id = partId.startsWith(ASM) ? partId.slice(ASM.length) : "";
  return id && isRack(id) ? id : null;
}

/** True when the placement carries a link made by "Link to rack…" (and still draws as that rack). */
export function isRackLinked(pl: Pick<RackLinkLite, "partId" | "rackId">): boolean {
  return !!pl.rackId && pl.partId === assemblyPartId(pl.rackId);
}

/**
 * Why `pl` can't link to a rack, else null: a curtain, already linked, a member
 * (or otherwise unable to hold), an assembly already, or holding devices of its own.
 */
export function rackLinkRefusal(pl: RackLinkLite, placements: readonly RackLinkLite[]): string | null {
  if (pl.curtain) return RACK_LINK_CURTAIN;
  if (pl.rackId) return RACK_LINK_ALREADY;
  const own = holdRefusal(pl);
  if (own) return own;
  if (isVirtualPart(pl.partId)) return RACK_LINK_ASSEMBLY;
  const n = placements.filter((o) => o.groupId === pl.id && o.id !== pl.id).length;
  if (n) return rackLinkHasMembers(n);
  return null;
}

/** The rack's device lines (its RU placements grouped by SKU, qty > 0 — an optional add-on is not a device here). */
export function rackDeviceLines(lines: ReadonlyArray<{ slot: string; line: { sku: string; label?: string; qty: number } }>): Array<{ sku: string; label?: string; qty: number }> {
  return lines
    .filter(({ slot, line }) => slot === "rack" && !!line.sku && line.qty > 0)
    .map(({ line }) => ({ sku: line.sku, ...(line.label ? { label: line.label } : {}), qty: Math.floor(line.qty) }))
    .filter((l) => l.qty > 0);
}

/** One SKU per unit, in the rack's own order — what Unlink copies in. null when past MAX_GROUP_MEMBERS. */
export function snapshotUnits(lines: ReadonlyArray<{ sku: string; qty: number }>): string[] | null {
  const total = lines.reduce((n, l) => n + l.qty, 0);
  if (total > MAX_GROUP_MEMBERS) return null;
  return lines.flatMap((l) => Array.from({ length: l.qty }, () => l.sku));
}

/** The rack's devices for display: one row per SKU, the catalog description else the rack's label else the SKU. */
export function rackDeviceRows(
  lines: ReadonlyArray<{ sku: string; label?: string; qty: number }>,
  descOf: (sku: string) => string | undefined
): RackDeviceRow[] {
  return lines.map((l) => ({ sku: l.sku, desc: descOf(l.sku) || l.label || l.sku, qty: l.qty }));
}

/** The Assembly Builder page of a rack. */
export const rackHref = (rackId: string) => `/design/assemblies/rack/${encodeURIComponent(rackId)}`;
