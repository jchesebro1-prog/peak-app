/**
 * #347 — the person's own Gmail labels on the reader's Labels card. Pure
 * rules (no imports with side effects — safe in the client bundle): which
 * labels the picker offers, which chips a thread shows, and what a new
 * label's name may be.
 *
 * Under `Peak/` is the app's own namespace (#96): those labels follow the
 * thread's filing, status and assignment, so they show read-only and are
 * never offered, created or removed here. A `Peak/Customers/<placeholder>`
 * label ("UNKNOWN" …, #345) is never shown at all.
 */

/** Gmail rejects a label name longer than this (same limit as label-sync). */
export const LABEL_NAME_MAX = 225;

/** The system labels a person can set on a thread from the card. */
export const SETTABLE_SYSTEM_LABELS: Readonly<Record<string, string>> = { STARRED: "Starred", IMPORTANT: "Important" };

/** Gmail's reserved system label names — a user label can't take one. */
const RESERVED = new Set(["inbox", "sent", "draft", "drafts", "trash", "spam", "starred", "important", "unread", "chat", "all mail", "scheduled", "snoozed"]);

const PLACEHOLDER_CUSTOMER = /^peak\/customers\/\s*(unknown|ukn|tbd|n\/a)\s*$/i;

export type LabelLike = { labelId: string; name: string; type: "system" | "user"; textColor?: string | null; backgroundColor?: string | null };

export type PickerLabel = { id: string; name: string; textColor: string | null; backgroundColor: string | null };

export type CardGmailChip = PickerLabel & {
  /** a person's own label (or Starred / Important): ✕ removes it in Gmail;
   *  false for the app's Peak/* labels (read-only) */
  editable: boolean;
};

/** Under the app's own `Peak/` namespace (or the bare `Peak` parent). */
export function isPeakLabelName(name: string): boolean {
  const n = (name || "").trim().toLowerCase();
  return n === "peak" || n.startsWith("peak/");
}

export function isPlaceholderPeakLabel(name: string): boolean {
  return PLACEHOLDER_CUSTOMER.test((name || "").trim());
}

/** A label the card may add or remove: a user label outside `Peak/`, or Starred / Important. */
export function isPickableLabel(l: Pick<LabelLike, "labelId" | "name" | "type">): boolean {
  if (l.type === "system") return l.labelId in SETTABLE_SYSTEM_LABELS;
  return !isPeakLabelName(l.name) && !isPlaceholderPeakLabel(l.name);
}

function displayName(l: Pick<LabelLike, "labelId" | "name" | "type">): string {
  return l.type === "system" ? SETTABLE_SYSTEM_LABELS[l.labelId] || l.name : l.name;
}

const toPicker = (l: LabelLike): PickerLabel => ({
  id: l.labelId,
  name: displayName(l),
  textColor: l.textColor ?? null,
  backgroundColor: l.backgroundColor ?? null,
});

/** The picker's list: every pickable label of the mailbox — Starred and
 *  Important first, then the person's labels A→Z. */
export function pickerLabels(cache: ReadonlyArray<LabelLike>): PickerLabel[] {
  const sys = cache.filter((l) => l.type === "system" && isPickableLabel(l)).sort((a, b) => (a.labelId === "STARRED" ? -1 : b.labelId === "STARRED" ? 1 : 0));
  const user = cache
    .filter((l) => l.type === "user" && isPickableLabel(l))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  return [...sys, ...user].map(toPicker);
}

/** The thread's chips: every label id on any of its messages that the cache
 *  names — the person's labels and Starred / Important (editable), the
 *  app's Peak/* labels (read-only, never a placeholder one). Gmail's other
 *  system labels (INBOX, UNREAD, CATEGORY_* …) are left out. */
export function cardGmailChips(messages: ReadonlyArray<{ gmailLabelIds?: string[] }>, cache: ReadonlyArray<LabelLike>): CardGmailChip[] {
  const on = new Set<string>();
  for (const m of messages) for (const id of m.gmailLabelIds || []) on.add(id);
  const editable: CardGmailChip[] = [];
  const peak: CardGmailChip[] = [];
  for (const l of pickerOrder(cache)) {
    if (!on.has(l.labelId)) continue;
    if (isPickableLabel(l)) editable.push({ ...toPicker(l), editable: true });
    else if (l.type === "user" && isPeakLabelName(l.name) && !isPlaceholderPeakLabel(l.name)) peak.push({ ...toPicker(l), editable: false });
  }
  return [...editable, ...peak];
}

function pickerOrder(cache: ReadonlyArray<LabelLike>): LabelLike[] {
  return [...cache].sort((a, b) => {
    if (a.type !== b.type) return a.type === "system" ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}

/** A new label's name, trimmed — or why it can't be one. Nesting on "/" is
 *  allowed ("Clients/Lincoln"), an empty part is not. */
export function validateLabelName(raw: string): { ok: true; name: string } | { ok: false; message: string } {
  const name = (raw || "").replace(/\s+/g, " ").trim();
  if (!name) return { ok: false, message: "Type a name for the label." };
  if (name.length > LABEL_NAME_MAX) return { ok: false, message: `Label names can be at most ${LABEL_NAME_MAX} characters.` };
  if (name.startsWith("/") || name.endsWith("/")) return { ok: false, message: "A label name can't start or end with “/”." };
  if (name.split("/").some((p) => !p.trim())) return { ok: false, message: "Each part of a nested label needs a name." };
  if (isPeakLabelName(name)) return { ok: false, message: "Labels under “Peak/” are set by the app — pick another name." };
  if (RESERVED.has(name.toLowerCase())) return { ok: false, message: "That name belongs to a Gmail system label." };
  return { ok: true, name };
}
