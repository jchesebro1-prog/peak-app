/**
 * Serializable view-models passed from the server page to the client
 * components (board drag, worklist row actions, lead drawer). Pure types —
 * safe to import from either side of the boundary.
 */

export type ChipVM = { label: string; ink: string; soft: string; bd: string };

/** null = unassigned (dashed placeholder avatar). */
export type AvatarVM = { initials: string; color: string } | null;

export type BoardColumnVM = { key: string; label: string; dot: string };

export type BoardCardVM = {
  id: string;
  stage: string;
  org: string;
  interest: string;
  value: number;
  valueLabel: string;
  urg: number;
  updatedAt: number;
  /** border-left strip color (#c85a3c bad / #c8a53c warn / transparent). */
  strip: string;
  showFu: boolean;
  fu: ChipVM;
  owner: AvatarVM;
  ownerTitle: string;
  href: string;
};

export type WorklistRowVM = {
  id: string;
  org: string;
  sub: string;
  valueLabel: string;
  owner: AvatarVM;
  ownerTitle: string;
  src: ChipVM;
  stage: ChipVM;
  reason: ChipVM;
  canClaim: boolean;
  href: string;
};

export type DrawerStageVM = {
  key: string;
  short: string;
  label: string;
  on: boolean;
  done: boolean;
  ink: string;
  soft: string;
  bd: string;
};

export type DrawerActivityVM = {
  id: string;
  icon: string;
  iconColor: string;
  who: string;
  note: string;
  when: string;
  line: boolean;
};

export type DrawerDetailVM = {
  id: string;
  org: string;
  contact: string;
  email: string;
  phone: string;
  srcShort: string;
  srcColor: string;
  locLine: string;
  banner: {
    title: string;
    detail: string;
    dot: string;
    ink: string;
    soft: string;
    bd: string;
  };
  interestLine: string;
  timeline: string;
  valueLabel: string;
  message: string;
  stages: DrawerStageVM[];
  owner: string;
  ownerShort: string;
  nextActionAt: number | null;
  nextActionNote: string;
  forecastAt: number | null;
  activities: DrawerActivityVM[];
  converted: boolean;
  quoteId: string;
};

export type SourceOptionVM = { value: string; label: string };
