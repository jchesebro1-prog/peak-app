import {
  dateLabel,
  dueLabel,
  followUpInfo,
  sla,
  sourceMeta,
  stageIndex,
  stageMeta,
  STAGES,
  timeAgo,
  timeFull,
  type LeadRecord,
} from "@/lib/stores/leads";
import { deriveInitials, fallbackColor, firstName } from "@/lib/team";
import { moneyFull } from "./money";
import type { AvatarVM, ChipVM, DrawerDetailVM } from "./types";

/**
 * Server-side view-model builders for the Leads screens — exact ports of the
 * display logic in Leads.dc.html / Leads Explorations.dc.html / Lead
 * Detail.dc.html (fuChip, ownerAvatar, chip styles, drawer banner).
 */

export const ACCENT_INK = "color-mix(in srgb, var(--accent) 70%, #000)";

export type FuTone = "bad" | "warn" | "info" | "ok" | "mute";
export type FuChipVM = ChipVM & { full: string; tone: FuTone };

/** Colored follow-up / SLA chip shared by all three views (prototype fuChip). */
export function fuChip(l: LeadRecord): FuChipVM {
  const info = followUpInfo(l);
  const s = sla(l);
  if (info.need) {
    if (info.reason === "sla")
      return { label: dueLabel(s.ms), full: "Response " + dueLabel(s.ms), ink: "#b4543a", soft: "#f8ece7", bd: "#eccfc4", tone: "bad" };
    if (info.reason === "nextaction")
      return { label: "Follow-up due", full: "Follow-up overdue", ink: "#b4543a", soft: "#f8ece7", bd: "#eccfc4", tone: "bad" };
    return { label: "Going cold", full: info.label, ink: "#8a6d1f", soft: "#fbf3dd", bd: "#f0e2bd", tone: "warn" };
  }
  if (s.state === "pending")
    return { label: dueLabel(s.ms), full: "First reply " + dueLabel(s.ms), ink: "#3155a8", soft: "#e9eefb", bd: "#d4ddf3", tone: "info" };
  if (l.nextActionAt)
    return { label: dateLabel(l.nextActionAt), full: "Follow-up " + dateLabel(l.nextActionAt), ink: "#1f7a52", soft: "#eaf6ef", bd: "#cce9da", tone: "ok" };
  if (l.stage === "won")
    return { label: "Won", full: "Won", ink: "#1f7a52", soft: "#eaf6ef", bd: "#cce9da", tone: "ok" };
  if (l.stage === "lost")
    return { label: "Lost", full: "Lost", ink: "#8c919c", soft: "#f1f2f5", bd: "#e4e7ec", tone: "mute" };
  return { label: "On track", full: "On track", ink: "#5b7a6a", soft: "#eef3f0", bd: "#d8e6de", tone: "ok" };
}

export type Ident = { name: string; initials: string; color: string };

/** Owner avatar — team identity when known, derived otherwise, null = unassigned. */
export function avatarFor(roster: Ident[], owner: string): AvatarVM {
  if (!owner) return null;
  const hit = roster.find((r) => r.name === owner);
  return {
    initials: hit ? hit.initials : deriveInitials(owner),
    color: hit ? hit.color : fallbackColor(owner),
  };
}

export function srcChip(l: LeadRecord): ChipVM {
  const s = sourceMeta(l.source);
  return {
    label: s.short,
    ink: s.color,
    soft: `color-mix(in srgb, ${s.color} 12%, #fff)`,
    bd: `color-mix(in srgb, ${s.color} 24%, #fff)`,
  };
}

export function stageChip(l: LeadRecord): ChipVM {
  const m = stageMeta(l.stage);
  return { label: m.short, ink: m.ink, soft: m.soft, bd: m.bd };
}

const ACT_ICON: Record<string, string> = {
  call: "☎",
  email: "✉",
  meeting: "◷",
  note: "✎",
  stage: "⇢",
  system: "•",
};

/** Full drawer view-model for an existing lead (Lead Detail.dc.html). */
export function buildDrawerVM(l: LeadRecord): DrawerDetailVM {
  const src = sourceMeta(l.source);
  const info = followUpInfo(l);
  const s = sla(l);
  const converted = !!l.convertedQuoteId;

  let banner: DrawerDetailVM["banner"];
  if (info.need) {
    if (info.reason === "sla")
      banner = {
        title: "First response overdue",
        detail: "Website lead — SLA was " + l.slaHours + "h · " + dueLabel(s.ms),
        dot: "#c85a3c", ink: "#b4543a", soft: "#f8ece7", bd: "#eccfc4",
      };
    else if (info.reason === "nextaction")
      banner = {
        title: "Follow-up overdue",
        detail: (l.nextActionNote || "Scheduled follow-up") + " · due " + dateLabel(l.nextActionAt),
        dot: "#c85a3c", ink: "#b4543a", soft: "#f8ece7", bd: "#eccfc4",
      };
    else
      banner = {
        title: "Going cold",
        detail: info.label + " — reach out to keep it warm",
        dot: "#c8a53c", ink: "#8a6d1f", soft: "#fbf3dd", bd: "#f0e2bd",
      };
  } else if (s.state === "pending") {
    banner = {
      title: "Awaiting first response",
      detail: "SLA " + l.slaHours + "h · " + dueLabel(s.ms),
      dot: "#3d6fd0", ink: "#3155a8", soft: "#e9eefb", bd: "#d4ddf3",
    };
  } else if (l.nextActionAt) {
    banner = {
      title: "On track",
      detail: (l.nextActionNote || "Next follow-up") + " · " + dateLabel(l.nextActionAt),
      dot: "#2f9d6b", ink: "#1f7a52", soft: "#eaf6ef", bd: "#cce9da",
    };
  } else {
    banner = {
      title: "On track",
      detail: "Last touch " + timeAgo(l.lastActivityAt),
      dot: "#2f9d6b", ink: "#1f7a52", soft: "#eaf6ef", bd: "#cce9da",
    };
  }

  const curIdx = stageIndex(l.stage);
  const stages = STAGES.map((k, i) => {
    const m = stageMeta(k);
    return {
      key: k as string,
      short: m.short,
      label: m.label,
      on: k === l.stage,
      done: i < curIdx && curIdx <= 3,
      ink: m.ink,
      soft: m.soft,
      bd: m.bd,
    };
  });

  const acts = (l.activities || []).slice().sort((a, b) => b.at - a.at);
  const activities = acts.map((a, i) => ({
    id: a.id,
    icon: ACT_ICON[a.type] || "•",
    iconColor: a.type === "stage" ? ACCENT_INK : a.type === "system" ? "#aab0bb" : "#5b616e",
    who: a.by ? firstName(a.by) : a.type === "system" ? "System" : "Customer",
    note: a.note || "",
    when: timeFull(a.at),
    line: i < acts.length - 1,
  }));

  return {
    id: l.id,
    org: l.org,
    contact: l.contact,
    email: l.email,
    phone: l.phone,
    srcShort: src.short,
    srcColor: src.color,
    locLine:
      [l.city, l.state].filter(Boolean).join(", ") +
      (converted ? " · converted " + timeAgo(l.convertedAt) : ""),
    banner,
    interestLine: l.interest || "Not specified",
    timeline: l.timeline || "",
    valueLabel: moneyFull(l.value),
    message: l.message || "",
    stages,
    owner: l.owner || "",
    ownerShort: l.owner ? firstName(l.owner) : "you",
    nextActionAt: l.nextActionAt ?? null,
    nextActionNote: l.nextActionNote || "",
    activities,
    converted,
    quoteId: l.convertedQuoteId || "",
  };
}
