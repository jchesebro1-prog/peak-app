/**
 * Activity feed merge (#145, D170) — PURE. The feed stores nothing of its
 * own: it reads the notes written by the composer plus the meetings,
 * decisions and phase attachments the engagement already carries, and
 * orders them newest first.
 *
 * Kept dependency-free (no store imports, no DB) so it is spec-tested with
 * no DB — see scripts/test-review-and-spec.ts. Task 8 (Krisp/meeting
 * pre-fill) adds `prefillFromMeeting` to this file; leave room for it.
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
