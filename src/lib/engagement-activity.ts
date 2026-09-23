/**
 * Activity feed merge (#145, D170) — PURE. The feed stores nothing of its
 * own: it reads the notes written by the composer plus the meetings,
 * decisions and phase attachments the engagement already carries, and
 * orders them newest first.
 *
 * Kept dependency-free (no store imports, no DB) so it is spec-tested with
 * no DB — see scripts/test-review-and-spec.ts. Also home to
 * `prefillFromMeeting` (Task 8, Krisp/meeting pre-fill) — same purity
 * requirement, so it stays testable without a DB alongside `mergeActivity`.
 */

export type ActivityKind = "note" | "meeting" | "decision" | "file";

export type ActivityEntry = {
  id: string;
  kind: ActivityKind;
  at: number;
  by: string;
  title: string;
  body: string;
  taskIds: string[];
  /** Load-bearing for `kind: "file"` (the only attachment a phase doc has —
   *  its name). For `kind: "note"`, this is a NAME-ONLY shadow of the
   *  note's real `FileRef[]` — enough for the merge to prove attachments
   *  round-trip (see the #145 D170 spec block below), but the real UI
   *  (`activity-tab.tsx`'s `ActivityRow`) renders a note's attachments by
   *  looking the note back up by `id` for the full `FileRef` (download
   *  link, mime, etc.), not from this field. Kept because collapsing it to
   *  `[]` for notes would silently break that merge-level guarantee. */
  attachments: Array<{ name: string }>;
  system: boolean;
};

export type MergeInput = {
  notes: Array<{ id: string; at: number; text: string; by: string; attachments: Array<{ name: string }>; taskIds: string[]; system: boolean }>;
  meetings: Array<{ id: string; at: number; title?: string; attendees: string; minutes: string }>;
  decisions: Array<{ id: string; at: number; by: string; decision: string; context: string }>;
  phaseAttachments: Array<{ id: string; addedAt: number; name: string; addedBy: string; phaseName: string }>;
};

export function mergeActivity(input: MergeInput): ActivityEntry[] {
  const out: ActivityEntry[] = [];

  for (const n of input.notes) {
    out.push({
      id: n.id, kind: "note", at: n.at, by: n.by,
      title: "", body: n.text,
      taskIds: n.taskIds || [], attachments: n.attachments || [], system: !!n.system,
    });
  }
  for (const m of input.meetings) {
    out.push({
      id: m.id, kind: "meeting", at: m.at, by: "",
      title: m.title || "Meeting", body: m.minutes,
      taskIds: [], attachments: [], system: false,
    });
  }
  for (const d of input.decisions) {
    out.push({
      id: d.id, kind: "decision", at: d.at, by: d.by,
      title: d.decision, body: d.context,
      taskIds: [], attachments: [], system: false,
    });
  }
  for (const f of input.phaseAttachments) {
    out.push({
      id: f.id, kind: "file", at: f.addedAt, by: f.addedBy,
      title: f.name, body: f.phaseName,
      taskIds: [], attachments: [{ name: f.name }], system: false,
    });
  }

  return out.sort((a, b) => (b.at || 0) - (a.at || 0));
}

/**
 * The generic "meeting-shaped" source a pre-fill can come from — a real
 * `ConsultingEngagement["meetings"][number]` entry, or (Task 8) a Krisp
 * recording linked to the engagement, projected into this same shape by the
 * [id] page server-side (never a store import here — see
 * activity-tab.tsx's `recordingSource` prop).
 */
export type MeetingSource = {
  id: string;
  at: number;
  title?: string;
  attendees: string;
  minutes: string;
};

/**
 * #145 D170 — what the composer opens with when launched from a meeting or
 * a Krisp recording. Body only: NOTHING is auto-extracted into tasks. A
 * human ticks the lines that become work.
 */
export function prefillFromMeeting(meeting: MeetingSource): { text: string; attendees: string[] } {
  const title = String(meeting.title || "").trim();
  const minutes = String(meeting.minutes || "").trim();
  const attendees = String(meeting.attendees || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!title && !minutes) return { text: "", attendees };
  const head = title || "Meeting";
  return { text: minutes ? `${head}\n\n${minutes}` : head, attendees };
}
