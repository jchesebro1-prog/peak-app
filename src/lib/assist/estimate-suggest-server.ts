/**
 * Estimate suggestion (spec 2026-10-13 §1) — replaces #334's quote-creating
 * Draft estimate. One source (an email thread, a lead, a site visit or a
 * Krisp meeting) → Haiku extracts the request → the server gathers candidate
 * parts → Opus suggests systems over ONLY those parts → the sanitizer keeps
 * candidate SKUs only and drops every price → one blob suggestion. Nothing
 * else is written: no quote, no link, no status. The rep builds the estimate
 * from the Estimator's Suggested BOM panel; a line is priced only when added.
 *
 * Request-scope free (the POST route owns requireUser and the gate) so the DB
 * checks can drive it with fake providers.
 */
import { listDocsByField } from "@/db/doc-store";
import { get as getLead } from "@/lib/stores/leads";
import { get as getSurvey } from "@/lib/stores/surveys";
import { getMeeting } from "@/lib/stores/meetings";
import { resolveCustomerId, visibleTo, type CommThread } from "@/lib/stores/comms";
import { canSeeMeeting } from "@/lib/meetings/visibility";
import { renderMeeting } from "@/lib/meetings/render";
import { allContacts, displayName } from "@/lib/identity/contacts";
import { activeUsers } from "@/lib/users";
import { mergeRunDetail } from "@/lib/stores/assist-runs";
import { isRefId, saveSuggestion } from "@/lib/stores/estimate-suggestions";
import { slotWorstCaseMs } from "./models";
import { runAssist, type RunDeps } from "./run";
import { loadThreadFor } from "./thread-access";
import { gatherEstimateCandidates } from "./estimate-candidates";
import { buildDraftUserText, DraftSchema, ExtractSchema, sanitizeExtract } from "./features/estimate-draft";
import { SOURCE_NOUN, SUGGEST_DRAFT_SYSTEM, SUGGEST_EXTRACT_SYSTEM } from "./features/suggest-prompt";
import {
  leadText,
  meetingText,
  promptMessages,
  surveyText,
  SUGGEST_SOURCE_KINDS,
  threadText,
  type LeadThread,
  type SuggestSourceKind,
} from "./features/suggest-sources";
import { newSuggestionId, sanitizeSuggestion, suggestionHref, SUGGESTION_NAME_MAX, type EstimateSuggestion } from "./features/suggestion";
import type { DraftLine } from "./outcome";

export type SuggestSource = { kind: SuggestSourceKind; id: string };
/** `clock` is the wall clock the time budget reads (tests drive it); `now` stamps records. */
export type SuggestEstimateDeps = { extract?: RunDeps; draft?: RunDeps; now?: number; clock?: () => number };
export type SuggestEstimateResult =
  | { ok: true; suggestionId: string; href: string; suggestion: EstimateSuggestion }
  | { ok: false; error: string };

/** The route's maxDuration (300 s): the whole suggestion request must fit it (D870). */
export const ESTIMATE_BUDGET_MS = 300_000;
/** The draft call starts only with this much of the budget left: its worst case
 *  (210 s, no retries) plus ~10 s to sanitize and store the suggestion. */
export const DRAFT_MIN_REMAINING_MS = 220_000;
export const OUT_OF_TIME_ERROR = "Assist ran out of time before suggesting — nothing was saved. Please try again.";

/** Pure — may the draft call still start, `elapsedMs` into the request? */
export function draftTimeLeft(elapsedMs: number): boolean {
  return ESTIMATE_BUDGET_MS - elapsedMs >= DRAFT_MIN_REMAINING_MS;
}

/** The slot budgets fit the request budget (checked by test:assist). */
export function estimateBudgetFits(): boolean {
  return DRAFT_MIN_REMAINING_MS >= slotWorstCaseMs("estimate") && ESTIMATE_BUDGET_MS - DRAFT_MIN_REMAINING_MS >= slotWorstCaseMs("extract");
}

const LABEL_MAX = 200;
const oneLine = (v: unknown, max: number) =>
  typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max).trim() : "";
const orNull = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/** One source, loaded and access-checked: its prompt text and the Estimator header it fills. */
type LoadedSource = {
  id: string;
  text: string;
  label: string;
  customerId: string | null;
  contactName: string | null;
  venueId: string | null;
  leadId: string | null;
  fallbackName: string;
};

const UNAVAILABLE: Record<SuggestSourceKind, string> = {
  thread: "That email isn't available.",
  lead: "That lead isn't available.",
  survey: "That site visit isn't available.",
  meeting: "That meeting isn't available.",
};
export const MEETING_UNLINKED_ERROR = "Link this meeting to a company or a job first — a suggestion is shared with the team.";

/** A lead id only when that lead still exists. */
async function liveLeadId(id: unknown): Promise<string | null> {
  const v = orNull(id);
  return v && (await getLead(v)) ? v : null;
}

/**
 * Load one source with its access rule — the same rule its own screen uses:
 *  - thread: `loadThreadFor` (a live email thread in the user's own mailbox);
 *  - lead / survey: any signed-in team member (the leads and venue-assessment
 *    pages and actions are `requireUser` only);
 *  - meeting: `canSeeMeeting` (the reader's rule), and it must be linked to a
 *    company or a job: a suggestion is staff-visible, so a private meeting's
 *    notes never land in one.
 */
async function loadSource(kind: SuggestSourceKind, id: string, me: { id: string; name: string }): Promise<LoadedSource | { error: string }> {
  if (kind === "thread") {
    const t = await loadThreadFor(id, me.name);
    if (!t) return { error: UNAVAILABLE.thread };
    const subject = oneLine(t.subject, LABEL_MAX);
    return {
      id: t.id,
      text: threadText(t),
      label: subject || "Email",
      customerId: await resolveCustomerId(t),
      contactName: orNull(t.contactName),
      venueId: null,
      leadId: t.link?.type === "lead" ? await liveLeadId(t.link.id) : null,
      fallbackName: `Suggested estimate — ${subject || "email"}`,
    };
  }
  if (kind === "lead") {
    const lead = await getLead(id);
    if (!lead) return { error: UNAVAILABLE.lead };
    // Threads linked to the lead — only ones this user may read (their own mailbox).
    const mine = await listDocsByField<CommThread>("comms", "mailboxUser", [me.name]);
    const threads: LeadThread[] = mine
      .filter((t) => !t.deleted && t.channel === "email" && visibleTo(t, me.name) && t.link?.type === "lead" && t.link.id === lead.id)
      .map((t) => ({ subject: t.subject || "", messages: promptMessages(t) }));
    const org = oneLine(lead.org, LABEL_MAX);
    return {
      id: lead.id,
      text: leadText(lead, threads),
      label: org || lead.id,
      customerId: orNull(lead.customerId) ?? orNull(lead.convertedCustomerId),
      contactName: orNull(lead.contact),
      venueId: null,
      leadId: lead.id,
      fallbackName: `Suggested estimate — ${org || lead.id}`,
    };
  }
  if (kind === "survey") {
    const s = await getSurvey(id);
    if (!s) return { error: UNAVAILABLE.survey };
    const where = oneLine([s.customer, s.venue].map((x) => (x || "").trim()).filter(Boolean).join(" — "), LABEL_MAX);
    return {
      id: s.id,
      text: surveyText(s),
      label: where || s.id,
      customerId: orNull(s.customerId),
      contactName: orNull(s.contact),
      venueId: orNull(s.locationId),
      leadId: await liveLeadId(s.leadId),
      fallbackName: `Suggested estimate — ${where || "site visit"}`,
    };
  }
  const m = await getMeeting(id).catch(() => null);
  if (!m || !canSeeMeeting(m, me.id)) return { error: UNAVAILABLE.meeting };
  const L = m.links;
  if (!L.customerId && !L.work) return { error: MEETING_UNLINKED_ERROR };
  // Names exactly as the meeting reader renders them (speaker relabels included).
  const [contacts, users] = await Promise.all([allContacts(), activeUsers()]);
  const contactName = new Map(contacts.map((c) => [c.id, displayName(c)]));
  const userName = new Map(users.map((u) => [u.id, u.name]));
  const r = renderMeeting(m, { contact: (cid) => contactName.get(cid) ?? null, user: (uid) => userName.get(uid) ?? null });
  const title = oneLine(m.krisp.title, LABEL_MAX);
  return {
    id: m.id,
    text: meetingText({ id: m.id, title: m.krisp.title, startedAt: m.krisp.startedAt, attendees: r.attendees.map((a) => a.display) }, r),
    label: title || "Meeting",
    customerId: orNull(L.customerId),
    contactName: L.contactIds.map((cid) => contactName.get(cid)).find((n): n is string => !!n) ?? null,
    venueId: orNull(L.siteId),
    leadId: L.work?.type === "lead" ? await liveLeadId(L.work.id) : null,
    fallbackName: `Suggested estimate — ${title || "meeting"}`,
  };
}

export async function suggestEstimate(
  source: SuggestSource,
  me: { id: string; name: string },
  deps: SuggestEstimateDeps = {}
): Promise<SuggestEstimateResult> {
  const clock = deps.clock ?? Date.now;
  const startedAt = clock();
  const kind = source?.kind;
  const sourceId = String(source?.id ?? "").trim();
  if (!(SUGGEST_SOURCE_KINDS as readonly string[]).includes(kind) || !isRefId(sourceId)) {
    return { ok: false, error: "Nothing to suggest from." };
  }
  // 1. Load + access check — refused before any model call.
  const src = await loadSource(kind, sourceId, me);
  if ("error" in src) return { ok: false, error: src.error };
  const user = { id: me.id, name: me.name };
  const noun = SOURCE_NOUN[kind];
  const contextRef = `${kind}:${src.id}`;

  // 2. Extract (Haiku): what was asked for. Counts against the hourly limit.
  const a = await runAssist(
    { feature: "estimate", step: "extract", slot: "extract", user, system: SUGGEST_EXTRACT_SYSTEM, userText: src.text, schema: ExtractSchema, contextRef },
    deps.extract
  );
  if (!a.ok) return { ok: false, error: a.error };
  const extract = sanitizeExtract(a.value);
  if (!extract.requests.length && !extract.systems.length) {
    return { ok: false, error: `Assist didn't find an equipment request in this ${noun}.` };
  }

  // 3. Candidates — the only SKUs the draft may use; no money in the prompt.
  const c = await gatherEstimateCandidates({ phrases: extract.requests.map((r) => r.phrase), systems: extract.systems, customerId: src.customerId });

  // Time budget: a draft that can't finish inside maxDuration would be cut off
  // mid-call (billed, nothing saved). Refuse up front instead.
  const elapsedMs = clock() - startedAt;
  if (!draftTimeLeft(elapsedMs)) {
    console.warn(`[assist] estimate suggestion refused: ${Math.round(elapsedMs / 1000)} s of the ${ESTIMATE_BUDGET_MS / 1000} s budget used before the draft call (${contextRef}, extract run ${a.runId})`);
    await mergeRunDetail(a.runId, { draftSkipped: "time budget", elapsedMs }).catch(() => false);
    return { ok: false, error: OUT_OF_TIME_ERROR };
  }

  // 4. Draft (Opus). The second call of one request: not rate-counted again.
  const b = await runAssist(
    {
      feature: "estimate",
      step: "draft",
      slot: "estimate",
      user,
      countRate: false,
      system: SUGGEST_DRAFT_SYSTEM,
      userText: buildDraftUserText({
        thread: src.text,
        extract,
        categories: c.categories,
        pastSystems: c.pastSystems,
        customerSystems: c.customerSystems,
        candidates: c.candidates,
        requestedFrom: `the ${noun}`,
      }),
      schema: DraftSchema,
      contextRef,
    },
    deps.draft
  );
  if (!b.ok) return { ok: false, error: b.error };

  // 5. Sanitize — candidate SKUs only, no prices, capped.
  const san = sanitizeSuggestion(b.value, c.candidates, c.categories);
  const lines: DraftLine[] = san.systems.flatMap((s) => s.lines.map((l) => ({ sku: l.custom ? "" : l.sku, qty: l.qty })));
  const detail = { lines, dropped: san.dropped, unresolved: san.unresolved, truncated: san.truncated, extractRunId: a.runId };
  if (!san.systems.length) {
    // suggestionId null: nothing came of this run (the report reads it as no suggestion).
    await mergeRunDetail(b.runId, { ...detail, suggestionId: null, quoteId: null }).catch(() => false);
    return { ok: false, error: `Assist couldn't suggest any systems from this ${noun} — nothing was saved.` };
  }

  // 6. Store (blobs only). A re-run replaces the source's index.
  const now = deps.now ?? Date.now();
  const suggestion: EstimateSuggestion = {
    id: newSuggestionId(now),
    source: { kind, id: src.id, label: src.label },
    createdBy: user,
    createdAt: now,
    customerId: src.customerId,
    contactName: src.contactName,
    venueId: src.venueId,
    leadId: src.leadId,
    quoteName: oneLine(san.quoteName || extract.quoteName || src.fallbackName, SUGGESTION_NAME_MAX),
    systems: san.systems,
    notes: san.notes,
    truncated: san.truncated,
    runIds: { extract: a.runId, draft: b.runId },
    quoteId: null,
  };
  try {
    await saveSuggestion(suggestion);
  } catch (e) {
    console.error(`[assist] estimate suggestion for ${contextRef}: saving failed`, e);
    await mergeRunDetail(b.runId, { ...detail, suggestionId: null, quoteId: null }).catch(() => false);
    return { ok: false, error: "Could not save the suggestion — please try again." };
  }
  await mergeRunDetail(b.runId, { ...detail, suggestionId: suggestion.id }).catch((e) => {
    console.error(`[assist] estimate suggestion ${suggestion.id}: recording the run detail failed`, e);
    return false;
  });
  return { ok: true, suggestionId: suggestion.id, href: suggestionHref(suggestion), suggestion };
}
