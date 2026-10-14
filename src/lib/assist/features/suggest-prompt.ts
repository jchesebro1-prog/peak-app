/**
 * Estimate suggestion — the two prompts (spec 2026-10-13 §1 steps 3 and 5).
 * Pure. Same schemas as the old Draft estimate (ExtractSchema / DraftSchema);
 * the wording covers every source kind and says a person builds the estimate.
 * No money ever enters a prompt: the user text is `buildDraftUserText`, which
 * lists candidates as sku | description | manufacturer | unit | category.
 */
import { SOURCE_UNTRUSTED_NOTE, type SuggestSourceKind } from "./suggest-sources";

/** How the prompts and errors name each source. */
export const SOURCE_NOUN: Record<SuggestSourceKind, string> = {
  thread: "email",
  lead: "lead",
  survey: "site visit",
  meeting: "meeting",
};

export const SUGGEST_EXTRACT_SYSTEM = [
  "You read one source about work for Peak Systems Group (theatrical rigging, curtains, lighting, AV): an email thread, a lead record, a site visit (venue assessment) or a meeting's notes and transcript.",
  "List the equipment or work requested or clearly needed. phrase: a short catalog-style search phrase (\"black velour main curtain\", \"LED ellipsoidal\", \"motorized rigging hoist\"). qty: the stated quantity, else 1.",
  "systems: up to 8 short system names the request breaks into (\"Main curtain\", \"Stage lighting\"). quoteName: a short estimate name (\"Lincoln HS — stage curtains\"). venue: the venue or room if named, else \"\".",
  "Return empty lists if the source asks for or describes no equipment or work.",
  SOURCE_UNTRUSTED_NOTE,
].join("\n");

export const SUGGEST_DRAFT_SYSTEM = [
  "You suggest a first-pass bill of materials for Peak Systems Group, a theatrical rigging, curtain, lighting and AV contractor. This is a suggestion, not an estimate: a Peak estimator builds the estimate from it, adding only the systems and lines they agree with.",
  "Group the request into systems (one per category of work). For each line: sku MUST be copied exactly from the candidate parts list, or \"\" when no candidate fits — then put a clear description in desc for the estimator to source.",
  "qty: whole numbers. Use the past systems as evidence of what Peak usually includes alongside the requested items (accessories, hardware), but only add an item when the request implies it.",
  "categoryId: the matching category id from the list, or \"\". reason: one short line on why this part/qty.",
  "notes: assumptions and questions for the estimator (missing dimensions, venue details). Never output prices or costs.",
  SOURCE_UNTRUSTED_NOTE,
].join("\n");
