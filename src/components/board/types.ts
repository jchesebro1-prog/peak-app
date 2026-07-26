/**
 * Generic kanban board view-models (#19's prerequisite) — extracted from
 * src/app/(app)/leads/types.ts so Leads, Opportunities and Projects all
 * feed the same client board. Pure types, safe on either side of the
 * server/client boundary.
 */

export type ChipVM = { label: string; ink: string; soft: string; bd: string };

/** null = unassigned (dashed placeholder avatar). */
export type AvatarVM = { initials: string; color: string } | null;

export type BoardColumnVM = { key: string; label: string; dot: string };

export type BoardCardVM = {
  id: string;
  /** Which column the card sits in — replaces the old lead-only `stage`. */
  col: string;
  title: string;
  sub: string;
  value: number;
  valueLabel: string;
  /** Pill chips under the sub line (follow-up warning, source badge, Won/Lost…). */
  chips: ChipVM[];
  /** border-left strip color; undefined = transparent. */
  strip?: string;
  owner: AvatarVM;
  ownerTitle: string;
  /** Age / due chip rendered beside the value ("3d" / "2w" / "Due in 12d"). */
  ageLabel?: string;
  href: string;
  /** Columns this card may be dragged to. Empty (or no moveAction) = read-only. */
  canMoveTo: string[];
};
