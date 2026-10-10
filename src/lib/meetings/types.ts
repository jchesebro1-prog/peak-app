/** #323 Krisp meeting matcher — shared types (spec 2026-10-09-krisp-meeting-matcher-design.md). */

export const NOISE_MAX_SEC = 180;
export const MAX_CONTACT_LINKS = 25;
export const BACKFILL_STEP_MS = 90 * 24 * 60 * 60 * 1000;
export const ROLLING_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
export const DETAIL_RETRY_MS = 48 * 60 * 60 * 1000;
export const SYNC_BUDGET_MS = 40_000;
export const HOME_STALE_MS = 10 * 60 * 1000;

export type WorkType = "lead" | "site_visit" | "survey" | "project" | "engagement" | "quote";
export const WORK_TYPES: WorkType[] = ["lead", "site_visit", "survey", "project", "engagement", "quote"];

export type MeetingWork = { type: WorkType; id: string; label: string };

export type MeetingLinks = {
  customerId: string | null;
  siteId: string | null;
  contactIds: string[];
  work: MeetingWork | null;
  internalUserIds: string[];
};

export type KrispPerson = { email: string | null; firstName: string | null; lastName: string | null };

export type MeetingSegment = { speaker: string; text: string; start: number; end: number };

export type MeetingKrisp = {
  title: string;
  startedAt: number | null;
  durationSec: number | null;
  source: string | null;
  status: string;
  tags: string[];
  participants: KrispPerson[];
  /** transcript speaker idx (as string) → identified participant; unidentified idx are absent */
  speakers: Record<string, KrispPerson>;
  segments: MeetingSegment[];
  /** raw Krisp notes; read through deriveSummary() */
  notes: { blocks: unknown[] } | null;
  fetchedAt: number;
  detailFetchedAt: number | null;
  removedAt: number | null;
};

export type AttendeeSource = "krisp" | "calendar" | "manual";

export type MeetingAttendee = {
  /** lowercased email, else "name:<normalizeText(name)>" */
  key: string;
  name: string;
  email: string | null;
  sources: AttendeeSource[];
  removed: boolean;
  contactId: string | null;
  userId: string | null;
};

export type MeetingPersonRef = { contactId?: string; userId?: string; name: string };

export type SuggestionKind = "company" | "venue" | "contact" | "work" | "internal";
export type Strength = "strong" | "weak";

export type MeetingSuggestion = {
  kind: SuggestionKind;
  id: string;
  label: string;
  workType?: WorkType;
  score: number;
  strength: Strength;
  reasons: string[];
};

export type TodoKind = "task" | "waiting" | "note" | "dismiss";

export type MeetingTodo = {
  key: string;
  title: string;
  assigneeLabel: string | null;
  dueDate: string | null;
  suggested: TodoKind;
  decision: null | { kind: TodoKind; createdId: string | null; decidedAt: number; decidedBy: string };
};

export type MeetingCalendar = { eventId: string; title: string; attendees: { email: string; name: string | null }[] };

export type MeetingShare = { sharedAt: number; sharedBy: string; summary: string };

export type MeetingRecord = {
  id: string;
  krispMeetingId: string;
  seenBy: string[];
  ownerUserId: string;
  recordingId: string | null;
  krisp: MeetingKrisp;
  calendar: MeetingCalendar | null;
  attendees: MeetingAttendee[];
  speakerMap: Record<string, MeetingPersonRef>;
  links: MeetingLinks;
  filedAt: number | null;
  filedBy: string | null;
  suggestions: MeetingSuggestion[];
  noise: boolean;
  noiseOverride: boolean;
  todos: MeetingTodo[];
  share: MeetingShare | null;
  createdAt: number;
  updatedAt: number;
};

export function meetingIdFor(krispMeetingId: string): string {
  return "km-" + krispMeetingId;
}

export function emptyLinks(): MeetingLinks {
  return { customerId: null, siteId: null, contactIds: [], work: null, internalUserIds: [] };
}
