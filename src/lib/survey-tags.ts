/* Venue Assessments — internal "Final thoughts" tags (#342, note 6). Judgments for internal use only ("Tight
   timeline", "Price-sensitive"…), never printed for the customer. Pure. Stored whole in the settings row as
   `surveyInternalTags` (Settings → Field); absent reads as the starter list. Ids are minted from the label once and
   never change; a row dropped in the editor is kept retired, so a survey that carries it still shows its label. */

export type SurveyTag = { id: string; label: string; retired?: boolean };
export type SurveyTagInput = { id?: string; label: string; retired?: boolean };

export const MAX_SURVEY_TAGS = 40;
const LABEL_MAX = 60;
const ID_RE = /^tg_[a-z0-9_]{1,40}$/;

function slug(label: string): string {
  return label.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 36) || "tag";
}

export function mintTagId(label: string, taken: ReadonlySet<string>): string {
  const base = "tg_" + slug(label);
  let id = base;
  let n = 2;
  while (taken.has(id)) id = `${base}_${n++}`;
  return id;
}

const STARTER_LABELS = [
  "Tight timeline",
  "Price-sensitive",
  "Strong champion",
  "Competitor involved",
  "Budget not confirmed",
  "Decision-maker not met",
  "Active venue (work around events)",
  "Volunteer install crew available",
  "Historic / preservation constraints",
];

export const STARTER_SURVEY_TAGS: readonly SurveyTag[] = (() => {
  const taken = new Set<string>();
  return STARTER_LABELS.map((label) => {
    const id = mintTagId(label, taken);
    taken.add(id);
    return { id, label };
  });
})();

const clean = (v: unknown, max: number): string =>
  typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";

/** The stored list, sanitized: bad / duplicate ids and blank labels dropped. Absent or empty → the starter list. */
export function resolveSurveyTags(stored: unknown): SurveyTag[] {
  if (!Array.isArray(stored) || !stored.length) return STARTER_SURVEY_TAGS.map((t) => ({ ...t }));
  const seen = new Set<string>();
  const out: SurveyTag[] = [];
  for (const raw of stored) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const id = typeof r.id === "string" ? r.id : "";
    const label = clean(r.label, LABEL_MAX);
    if (!ID_RE.test(id) || seen.has(id) || !label) continue;
    seen.add(id);
    out.push(r.retired === true ? { id, label, retired: true } : { id, label });
  }
  return out.length ? out : STARTER_SURVEY_TAGS.map((t) => ({ ...t }));
}

export function activeSurveyTags(tags: readonly SurveyTag[]): SurveyTag[] {
  return tags.filter((t) => !t.retired);
}

export function surveyTagLabel(tags: readonly SurveyTag[], id: string): string {
  return tags.find((t) => t.id === id)?.label ?? id;
}

/** The editor's whole-list save over the stored (resolved) list. */
export function mergeSurveyTags(
  stored: readonly SurveyTag[],
  input: unknown
): { ok: true; tags: SurveyTag[] } | { ok: false; error: string } {
  if (!Array.isArray(input)) return { ok: false, error: "Nothing to save." };
  const known = new Set(stored.map((t) => t.id));
  const taken = new Set(known);
  const used = new Set<string>();
  const labels = new Set<string>();
  const out: SurveyTag[] = [];
  for (const raw of input) {
    const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const label = clean(r.label, LABEL_MAX + 1);
    if (!label) return { ok: false, error: "Every tag needs a name." };
    if (label.length > LABEL_MAX) return { ok: false, error: `"${label.slice(0, LABEL_MAX)}…" is longer than ${LABEL_MAX} characters.` };
    const retired = r.retired === true;
    if (!retired) {
      const lower = label.toLowerCase();
      if (labels.has(lower)) return { ok: false, error: `Two tags are named "${label}".` };
      labels.add(lower);
    }
    let id = typeof r.id === "string" ? r.id : "";
    if (id) {
      if (!known.has(id)) return { ok: false, error: `Unknown tag "${id}".` };
    } else {
      id = mintTagId(label, taken);
      taken.add(id);
    }
    if (used.has(id)) return { ok: false, error: `"${label}" is listed twice.` };
    used.add(id);
    out.push(retired ? { id, label, retired: true } : { id, label });
  }
  for (const t of stored) {
    if (!used.has(t.id)) out.push({ id: t.id, label: t.label, retired: true });
  }
  if (out.length > MAX_SURVEY_TAGS) return { ok: false, error: `At most ${MAX_SURVEY_TAGS} tags.` };
  return { ok: true, tags: out };
}
