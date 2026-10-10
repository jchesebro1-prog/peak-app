import { deriveSummary } from "@/lib/krisp/derive";
import type { KrispNoteBlock } from "@/lib/stores/recordings";
import { normalizeText, personName } from "./names";
import type { KrispPerson, MeetingAttendee, MeetingCalendar, MeetingRecord, MeetingTodo } from "./types";

export function attendeeKey(name: string, email: string | null): string {
  return email ? email.trim().toLowerCase() : "name:" + normalizeText(name);
}

export function mergeAttendees(prev: MeetingAttendee[], krisp: KrispPerson[], calendar: MeetingCalendar | null): MeetingAttendee[] {
  const out = prev.map((a) => ({ ...a, sources: [...a.sources] }));
  const add = (name: string, email: string | null, source: "krisp" | "calendar") => {
    const key = attendeeKey(name || email || "", email);
    if (key === "name:") return;
    const hit = out.find((a) => a.key === key);
    if (hit) {
      if (!hit.sources.includes(source)) hit.sources.push(source);
      if (!hit.name && name) hit.name = name;
      return;
    }
    out.push({ key, name: name || email || "", email: email ? email.trim().toLowerCase() : null, sources: [source],
      removed: false, contactId: null, userId: null });
  };
  for (const p of krisp) add(personName(p), p.email, "krisp");
  for (const a of calendar?.attendees || []) add(a.name || "", a.email, "calendar");
  const order = (s: MeetingAttendee) => (s.sources.includes("krisp") ? 0 : s.sources.includes("calendar") ? 1 : 2);
  return out.sort((x, y) => order(x) - order(y));
}

export function resolveAttendees(atts: MeetingAttendee[], byEmail: Map<string, { contactId?: string; userId?: string }>): MeetingAttendee[] {
  return atts.map((a) => {
    if (!a.email || a.contactId || a.userId) return a;
    const r = byEmail.get(a.email);
    return r ? { ...a, contactId: r.contactId ?? null, userId: r.userId ?? null } : a;
  });
}

export function speakerIndexes(m: Pick<MeetingRecord, "krisp">): string[] {
  const set = new Set<string>([...Object.keys(m.krisp.speakers), ...m.krisp.segments.map((s) => String(s.speaker))]);
  return [...set].sort((a, b) => Number(a) - Number(b));
}

export function speakerLabel(m: Pick<MeetingRecord, "krisp">, idx: string): string {
  const p = m.krisp.speakers[idx];
  return (p && personName(p)) || `Speaker ${idx}`;
}

function escapeRe(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

/** Whole-word replace; a "Speaker N" label also matches its "Speaker_N" spelling. */
export function relabel(text: string, pairs: [string, string][]): string {
  let out = text;
  for (const [from, to] of pairs) {
    if (!from || from === to) continue;
    const pattern = escapeRe(from).replace(/\\? /g, "[ _]");
    out = out.replace(new RegExp(`(?<![\\w])${pattern}(?![\\w])`, "g"), to);
  }
  return out;
}

export type RenderNames = { contact: (id: string) => string | null; user: (id: string) => string | null };

export type RenderedMeeting = {
  attendees: (MeetingAttendee & { display: string })[];
  speakers: { idx: string; label: string; mapped: string | null }[];
  segments: { speakerIdx: string; speakerName: string; text: string; start: number; end: number }[];
  summary: { title: string; description: string }[];
  keyPoints: string[];
  todos: (MeetingTodo & { assigneeDisplay: string | null })[];
};

export function renderMeeting(m: MeetingRecord, names: RenderNames): RenderedMeeting {
  const mappedName = (idx: string): string | null => {
    const ref = m.speakerMap[idx];
    if (!ref) return null;
    return (ref.contactId && names.contact(ref.contactId)) || (ref.userId && names.user(ref.userId)) || ref.name || null;
  };
  const speakers = speakerIndexes(m).map((idx) => ({ idx, label: speakerLabel(m, idx), mapped: mappedName(idx) }));
  const pairs: [string, string][] = speakers.filter((s) => s.mapped).map((s) => [s.label, s.mapped!]);
  const fix = (s: string) => relabel(s, pairs);
  const derived = deriveSummary(m.krisp.notes as { blocks: KrispNoteBlock[] } | null);
  return {
    attendees: m.attendees.filter((a) => !a.removed).map((a) => ({
      ...a, display: (a.contactId && names.contact(a.contactId)) || (a.userId && names.user(a.userId)) || a.name,
    })),
    speakers,
    segments: m.krisp.segments.map((s) => {
      const idx = String(s.speaker);
      return { speakerIdx: idx, speakerName: mappedName(idx) || speakerLabel(m, idx), text: fix(s.text), start: s.start, end: s.end };
    }),
    summary: derived.summary.map((x) => ({ title: fix(x.title), description: fix(x.description) })),
    keyPoints: derived.keyPoints.map(fix),
    todos: m.todos.map((t) => ({ ...t, title: fix(t.title), assigneeDisplay: t.assigneeLabel ? fix(t.assigneeLabel) : null })),
  };
}
