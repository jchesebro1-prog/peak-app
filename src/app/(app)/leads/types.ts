/**
 * Serializable view-models passed from the server page to the client
 * components (worklist row actions, lead drawer). Board VMs now live in
 * components/board. Pure types — safe to import from either side of the
 * boundary.
 */

/** Chip + avatar VMs now live with the generic board (#19 extraction);
    re-exported so worklist/drawer/table VMs below and avatar.tsx keep
    their import path. Board VMs import from @/components/board/types. */
import type { ChipVM, AvatarVM } from "@/components/board/types";
export type { ChipVM, AvatarVM };

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

/** #34 — the lead's visit/survey thread, server-built with chip colors
    precomputed (the client drawer must not value-import the stores).
    visit is the lead's ACTIVE visit (activeVisitForLead already excludes
    "done"), so visit !== null ⇒ hide the Request button. */
export type LeadThreadVM = {
  visit: {
    id: string;
    stage: string;
    label: string;
    ink: string;
    soft: string;
    bd: string;
    assignedTo: string;
    startAt: number | null;
  } | null;
  survey: {
    id: string;
    stage: string;
    label: string;
    ink: string;
    soft: string;
    bd: string;
  } | null;
};
