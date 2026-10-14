/**
 * Ask AI runner (spec 2026-10-13-ask-ai-design.md §2 "Runner", steps 1–6).
 *
 * One question = one fresh series of streamed model calls over the beta
 * messages API: the earlier turns ride in the first user message (never
 * replayed as assistant messages); inside the question the model's own
 * assistant content — tool_use, server tool blocks and thinking — is replayed
 * unmodified. Read tools run server-side with the user's own access rules;
 * proposal tools only become sanitised cards. Every event goes out through
 * `emit`; one `assist_runs` row is logged per question that passed the gate.
 *
 * The model client is injectable (`AskModelClient`) so the loop runs against a
 * fake in scripts/test-ask.ts.
 */
import { createHash } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import type {
  BetaContentBlock,
  BetaMessage,
  BetaMessageParam,
  BetaMessageStreamParams,
  BetaRawMessageStreamEvent,
  BetaToolResultBlockParam,
  BetaToolUnion,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { getSettings } from "@/lib/settings";
import { rateLimit } from "@/lib/rate-limit";
import { activeUsers } from "@/lib/users";
import { ASK_CONFIRMED_MAX, createRun, getRun, monthSpend, newRunId, setRunOutcome, type AssistRun } from "@/lib/stores/assist-runs";
import { assistSettingsOf, chicagoToday, monthKeyChicago } from "./config";
import { askGateFor } from "./gate-server";
import { getAssistEnv } from "./key-store";
import { clientFor, FALLBACK_BETA } from "./anthropic";
import { modelFor, SLOT_SETTINGS, wantsFallbacks } from "./models";
import { RATE_LIMITS, toJsonSchema } from "./run";
import { ASK_READ_TOOLS, isReadToolName, resolveAskRef, runReadTool, type AskToolRef, type AskUser } from "./ask-tools-server";
import { pageContext } from "./ask-context-server";
import type { AssistEffort, AssistSettings, Env } from "./types";
import type { AskBody } from "./features/ask-body";
import type { AskEvent } from "./features/ask-events";
import { refKey, refTokensIn } from "./features/ask-refs";
import { ASK_PROPOSAL_TOOLS, cleanEmail, proposalToolKind, sanitizeCard, type CardContext } from "./features/ask-cards";
import { ASK_SYSTEM, packFirstUserMessage, type AskScreen } from "./features/ask-prompt";
import {
  ASK_CUT_OFF_NOTE,
  ASK_FINAL_NOTE,
  ASK_LOG_REFS_MAX,
  ASK_MIN_ROUND_MS,
  ASK_OUTPUT_MAX,
  ASK_PRIOR_REFS_MAX,
  ASK_REFUSAL_TEXT,
  ASK_TIMEOUT_NOTE,
  ASK_WEB_MAX_USES,
  askCostUsd,
  askWallMs,
  nextRoundPolicy,
  sumUsage,
  toolCallsAllowed,
  type AskRoundUsage,
} from "./features/ask-limits";

/* ---------------- the injectable model client ---------------- */

export type AskParams = BetaMessageStreamParams;
export type AskRequestOptions = { timeout: number; maxRetries: number; signal: AbortSignal };
/** What the runner needs from one streamed call: its raw events, then the final message. */
export interface AskModelStream extends AsyncIterable<BetaRawMessageStreamEvent> {
  finalMessage(): Promise<BetaMessage>;
}
export interface AskModelClient {
  name: "anthropic" | "fake";
  stream(params: AskParams, opts: AskRequestOptions): AskModelStream;
}

/** The real client: the official SDK's beta messages stream (one client per key, anthropic.ts). */
export function anthropicAskClient(env: Env): AskModelClient {
  const client: Anthropic = clientFor(env);
  return { name: "anthropic", stream: (params, opts) => client.beta.messages.stream(params, opts) };
}

/* ---------------- pure pieces (unit-tested) ---------------- */

/** Models that take the dynamic-filtering web search tool (claude-api skill, 2026-10-06): Opus 4.6+, Sonnet 4.6+. */
const WEB_SEARCH_20260209 = new Set([
  "claude-opus-5-5",
  "claude-opus-5",
  "claude-opus-4-8",
  "claude-opus-4-7",
  "claude-opus-4-6",
  "claude-sonnet-5-5",
  "claude-sonnet-5",
  "claude-sonnet-4-6",
]);

/** The web search server tool for a model: web_search_20260209 where supported (Sonnet 5.5), else the basic 20250305 (Haiku 5.5). */
export function webSearchToolFor(model: string): BetaToolUnion {
  return WEB_SEARCH_20260209.has(model)
    ? { type: "web_search_20260209", name: "web_search", max_uses: ASK_WEB_MAX_USES }
    : { type: "web_search_20250305", name: "web_search", max_uses: ASK_WEB_MAX_USES };
}

/** The custom tools — eleven read tools then four proposal tools — with eager input streaming. Fixed order (cache-stable). */
export const ASK_CUSTOM_TOOLS: readonly BetaToolUnion[] = [
  ...ASK_READ_TOOLS.map((t) => ({ name: t.name, description: t.description, input_schema: t.schema as { type: "object" }, eager_input_streaming: true })),
  ...ASK_PROPOSAL_TOOLS.map((t) => ({ name: t.name, description: t.description, input_schema: toJsonSchema(t.schema) as { type: "object" }, eager_input_streaming: true })),
];

export type AskParamsInput = {
  model: string;
  system: string;
  messages: BetaMessageParam[];
  tools: readonly BetaToolUnion[];
  web: boolean;
  effort: AssistEffort;
  maxTokens: number;
  fallbacks: boolean;
  /** The final round: the tools stay defined (the history holds tool_use blocks) but `tool_choice: none`. */
  final?: boolean;
};

/**
 * The exact params for client.beta.messages.stream. The system prompt is
 * cached (tools render before it, so the tool list is cached with it). No
 * `thinking` key (adaptive by default; `disabled` 400s on Sonnet 5.5) and no
 * forced tool_choice — only `none` on the final round.
 */
export function buildAskParams(p: AskParamsInput): AskParams {
  return {
    model: p.model,
    max_tokens: p.maxTokens,
    system: [{ type: "text", text: p.system, cache_control: { type: "ephemeral" } }],
    messages: p.messages,
    tools: [...p.tools, ...(p.web ? [webSearchToolFor(p.model)] : [])],
    ...(p.final ? { tool_choice: { type: "none" as const } } : {}),
    output_config: { effort: p.effort },
    ...(p.fallbacks ? { betas: [FALLBACK_BETA], fallbacks: "default" as const } : {}),
  };
}

const TOOL_STATUS: Record<string, string> = {
  search: "Searching…",
  get_company: "Looking up companies…",
  get_venue: "Looking up venues…",
  get_quote: "Looking up quotes…",
  list_quotes: "Looking up quotes…",
  get_lead: "Looking up leads…",
  get_project: "Looking up projects…",
  get_thread: "Looking up email…",
  get_meeting: "Looking up meetings…",
  search_catalog: "Looking up the catalog…",
  my_tasks: "Looking up your tasks…",
  web_search: "Searching the web…",
};
/** The panel's status line for a tool the model started. */
export function toolStatus(name: string): string {
  if (TOOL_STATUS[name]) return TOOL_STATUS[name];
  return name.startsWith("propose_") ? "Drafting a suggestion…" : "Looking things up…";
}

/** The SDK's error for a tool input whose streamed JSON didn't parse (eager input streaming). */
export function isToolInputJsonError(e: unknown): boolean {
  return e instanceof Error && /Unable to parse tool parameter JSON/i.test(e.message);
}

/** A 400 that names the web search tool — retry the round once without web. */
export function isWebToolRejection(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  const status = (e as { status?: unknown }).status;
  return status === 400 && /web_search|web search/i.test(e.message);
}

export const ASK_SOURCES_MAX = 12;
export const ASK_WEB_UNAVAILABLE_NOTE = "(Web search wasn't available, so this answer uses Peak's records only.)";
export const ASK_EMPTY_TEXT = "I couldn't find that.";
export const ASK_FAILED_TEXT = "Ask AI couldn't answer — please try again.";
export const ASK_CAP_TEXT = "Assist paused for the month (spend cap reached).";
export const ASK_RATE_TEXT = "Too many Ask AI questions — try again in a bit.";
const TOOL_LIMIT_TEXT = "Not run: the lookup limit for this question is used up. Answer from what you already have.";
const CARD_SHOWN_TEXT = "Shown to the user as a card for confirmation. Nothing has been done — the user decides.";
const CARD_DROPPED_TEXT = "No card was shown: it named records this conversation hasn't looked up, or it was empty. Look the record up first, then propose again.";
const SOURCE_TITLE_MAX = 200;

/** Web pages a round cited or searched: text citations first, then search results — http(s) only, deduped by URL. */
export function webSourcesOf(content: readonly BetaContentBlock[]): { url: string; title: string }[] {
  const cited: { url: string; title: string }[] = [];
  const found: { url: string; title: string }[] = [];
  for (const b of content) {
    if (b.type === "text") {
      for (const c of b.citations ?? []) if (c.type === "web_search_result_location") cited.push({ url: c.url, title: c.title || c.url });
    } else if (b.type === "web_search_tool_result" && Array.isArray(b.content)) {
      for (const r of b.content) found.push({ url: r.url, title: r.title || r.url });
    }
  }
  const out: { url: string; title: string }[] = [];
  const seen = new Set<string>();
  for (const s of [...cited, ...found]) {
    const url = typeof s.url === "string" ? s.url.trim() : "";
    if (!/^https?:\/\//i.test(url) || seen.has(url)) continue;
    seen.add(url);
    out.push({ url, title: String(s.title).replace(/\s+/g, " ").trim().slice(0, SOURCE_TITLE_MAX) || url });
  }
  return out;
}

const EMAIL_IN_TEXT = /[^\s@<>"(),;:[\]\\]+@[^\s@<>"(),;:[\]\\]+\.[^\s@<>"(),;:[\]\\]+/g;
/** Addresses the user typed in this conversation (the email card may use them). */
export function typedEmails(turns: readonly { role: string; text: string }[]): string[] {
  const out = new Set<string>();
  for (const t of turns) {
    if (t.role !== "user") continue;
    for (const m of t.text.match(EMAIL_IN_TEXT) ?? []) {
      const e = cleanEmail(m.replace(/[.]+$/, ""));
      if (e) out.add(e);
    }
  }
  return [...out];
}

/* ---------------- the runner ---------------- */

export type AskRunDeps = {
  client?: AskModelClient;
  settings?: AssistSettings;
  env?: Env;
  /** Timestamp for the run row, its month and "today" (default Date.now()). */
  now?: number;
  /** The loop's wall clock (default Date.now) — injectable for the timeout test. */
  clock?: () => number;
  /** The request's signal: a client disconnect aborts the stream (the run is still logged). */
  signal?: AbortSignal;
  /** Active team ids for the task card's assignee (default: activeUsers()). */
  team?: { id: string }[];
};

export type AskRunResult = { runId: string | null; ok: boolean; error: string | null };

type Stop = "end" | "refusal" | "max_tokens" | "timeout" | "aborted" | "error" | "final";

export async function runAsk(input: AskBody, me: AskUser, emit: (e: AskEvent) => void, deps: AskRunDeps = {}): Promise<AskRunResult> {
  const now = deps.now ?? Date.now();
  const clock = deps.clock ?? Date.now;
  const env = deps.env ?? (await getAssistEnv());
  const settings = deps.settings ?? assistSettingsOf(await getSettings());

  // 1. Gate (Claude key required), cap, rate limit — a refusal is one error event, no run.
  const refused = await askGateFor(me.id, { settings, env });
  if (refused) {
    emit({ t: "error", message: refused });
    return { runId: null, ok: false, error: refused };
  }
  const monthKey = monthKeyChicago(now);
  if ((await monthSpend(monthKey)) >= settings.capUsd) {
    emit({ t: "error", message: ASK_CAP_TEXT });
    return { runId: null, ok: false, error: ASK_CAP_TEXT };
  }
  if (!rateLimit(`assist:ask:${me.id}`, RATE_LIMITS.ask, 3_600_000).ok) {
    emit({ t: "error", message: ASK_RATE_TEXT });
    return { runId: null, ok: false, error: ASK_RATE_TEXT };
  }

  // 2. Model — Haiku, or Sonnet behind Try harder. Claude only.
  const slot = input.hard ? "askHard" : "ask";
  const model = modelFor(slot, env);
  const s = SLOT_SETTINGS[slot];
  const client = deps.client ?? anthropicAskClient(env);
  const t0 = clock();
  const deadline = t0 + askWallMs(input.hard);

  // The whitelist: refs this request exposed (page context, re-checked prior tokens, tool results).
  const refs = new Map<string, AskToolRef>();
  const emails = new Set<string>(typedEmails(input.messages));
  const exposeRef = (r: AskToolRef) => {
    const k = refKey(r.kind, r.id);
    if (refs.has(k)) return;
    refs.set(k, r);
    emit({ t: "ref", kind: r.kind, id: r.id, title: r.title, href: r.href });
  };

  let answer = "";
  let roundHasText = false;
  const say = (d: string) => {
    if (!d) return;
    answer += d;
    emit({ t: "text", d });
  };
  const sayBlock = (d: string) => {
    if (answer && !answer.endsWith("\n")) say("\n\n");
    say(d);
  };

  const rounds: AskRoundUsage[] = [];
  let webSearches = 0;
  let toolCalls = 0;
  let cards = 0;
  /** Each shown card's kind, in order (the report's "proposed by kind"); capped like `confirmed`. */
  const cardKinds: string[] = [];
  let lastStopReason: string | null = null;
  let stop: Stop = "end";
  let error: string | null = null;
  let firstUser = "";
  let pageRef: string | null = null;
  const sourcesSent = new Set<string>();

  try {
    // Page context (§3) and the earlier conversation's [[kind:id]] tokens, each re-checked.
    let screen: AskScreen | null = null;
    try {
      const ctx = await pageContext(input.page, me);
      if (ctx) {
        screen = { kind: ctx.ref.kind, id: ctx.ref.id, title: ctx.title, text: ctx.text };
        pageRef = refKey(ctx.ref.kind, ctx.ref.id);
        for (const r of [ctx.ref, ...ctx.refs]) exposeRef(r);
        for (const e of ctx.emails) emails.add(e.toLowerCase());
      }
    } catch (err) {
      console.error("[ask] page context failed:", err);
    }
    const prior = refTokensIn(input.messages.map((m) => m.text).join("\n"), ASK_PRIOR_REFS_MAX);
    const rechecked = await Promise.all(prior.map((r) => resolveAskRef(r.kind, r.id, me).catch(() => null)));
    for (const r of rechecked) if (r) exposeRef(r);

    const team = deps.team ?? (await activeUsers()).map((u) => ({ id: u.id }));
    const cardCtx = (): CardContext => ({ refs: new Set(refs.keys()), emails, team, meId: me.id, todayYmd: chicagoToday(now).date });

    firstUser = packFirstUserMessage({ messages: input.messages, screen, today: chicagoToday(now) });
    const messages: BetaMessageParam[] = [{ role: "user", content: firstUser }];

    let web = input.web;
    let webRetried = false;
    let jsonRetried = false;
    let resumed = false;
    let final = false;
    const fallbacks = wantsFallbacks(model);

    // 3. The loop.
    for (;;) {
      const msLeft = deadline - clock();
      const policy = nextRoundPolicy({ round: rounds.length, toolCalls, msLeft });
      if (policy === "stop") {
        // Out of time, or (after a re-issued round) out of rounds.
        stop = msLeft > ASK_MIN_ROUND_MS ? "end" : "timeout";
        break;
      }
      if (policy === "final" && !final) {
        // Spent: the round after the tool results is answered without tools.
        final = true;
        const last = messages[messages.length - 1];
        if (last.role === "user") {
          last.content = typeof last.content === "string" ? [{ type: "text", text: last.content }, { type: "text", text: ASK_FINAL_NOTE }] : [...last.content, { type: "text", text: ASK_FINAL_NOTE }];
        }
      }

      const params = buildAskParams({ model, system: ASK_SYSTEM, messages, tools: ASK_CUSTOM_TOOLS, web, effort: s.effort, maxTokens: s.maxTokens, fallbacks, final });
      const ctl = new AbortController();
      let timedOut = false;
      const onAbort = () => ctl.abort();
      if (deps.signal?.aborted) ctl.abort();
      deps.signal?.addEventListener("abort", onAbort);
      const timer = setTimeout(() => {
        timedOut = true;
        ctl.abort();
      }, Math.max(1, msLeft));
      roundHasText = false;
      let msg: BetaMessage;
      try {
        const stream = client.stream(params, { timeout: Math.max(1, msLeft), maxRetries: 0, signal: ctl.signal });
        for await (const ev of stream) {
          if (ev.type === "content_block_start") {
            const b = ev.content_block;
            if (b.type === "tool_use" || b.type === "server_tool_use") emit({ t: "status", text: toolStatus(b.name) });
          } else if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
            if (!roundHasText) {
              roundHasText = true;
              if (answer && !answer.endsWith("\n")) say("\n\n");
            }
            say(ev.delta.text);
          }
        }
        msg = await stream.finalMessage();
      } catch (err) {
        if (deps.signal?.aborted) {
          stop = "aborted";
          break;
        }
        if (timedOut) {
          stop = "timeout";
          break;
        }
        if (web && !webRetried && isWebToolRejection(err)) {
          webRetried = true;
          web = false;
          sayBlock(ASK_WEB_UNAVAILABLE_NOTE);
          continue;
        }
        if (!jsonRetried && isToolInputJsonError(err)) {
          // An unreadable streamed tool input: re-issue the round once (it counts as a round).
          jsonRetried = true;
          rounds.push({ answered: model, requested: model, usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } });
          continue;
        }
        throw err;
      } finally {
        clearTimeout(timer);
        deps.signal?.removeEventListener("abort", onAbort);
      }

      rounds.push({
        answered: msg.model || model,
        requested: model,
        usage: {
          inputTokens: msg.usage?.input_tokens ?? 0,
          outputTokens: msg.usage?.output_tokens ?? 0,
          cacheReadTokens: msg.usage?.cache_read_input_tokens ?? 0,
          cacheWriteTokens: msg.usage?.cache_creation_input_tokens ?? 0,
        },
      });
      webSearches += msg.usage?.server_tool_use?.web_search_requests ?? 0;
      for (const src of webSourcesOf(msg.content)) {
        if (sourcesSent.size >= ASK_SOURCES_MAX || sourcesSent.has(src.url)) continue;
        sourcesSent.add(src.url);
        emit({ t: "source", url: src.url, title: src.title });
      }
      lastStopReason = msg.stop_reason ?? null;

      // 5. Stop reasons.
      if (msg.stop_reason === "refusal") {
        sayBlock(ASK_REFUSAL_TEXT);
        stop = "refusal";
        break;
      }
      if (msg.stop_reason === "max_tokens") {
        say(ASK_CUT_OFF_NOTE);
        stop = "max_tokens";
        break;
      }
      if (final) {
        // Any tool_use on the no-tools round is ignored.
        stop = "final";
        break;
      }
      if (msg.stop_reason === "pause_turn") {
        // A server tool paused: send the conversation back once more, as is (a tools round only).
        if (resumed || nextRoundPolicy({ round: rounds.length, toolCalls, msLeft: deadline - clock() }) !== "tools") {
          stop = "end";
          break;
        }
        resumed = true;
        messages.push({ role: "assistant", content: msg.content });
        continue;
      }
      if (msg.stop_reason !== "tool_use") {
        stop = "end";
        break;
      }

      // Tool round: replay the assistant content unmodified, answer every tool_use.
      const uses = msg.content.filter((b): b is Extract<BetaContentBlock, { type: "tool_use" }> => b.type === "tool_use");
      if (!uses.length) {
        stop = "end";
        break;
      }
      messages.push({ role: "assistant", content: msg.content });
      const allowed = toolCallsAllowed(toolCalls, uses.length);
      const results: BetaToolResultBlockParam[] = [];
      for (let i = 0; i < uses.length; i++) {
        const u = uses[i];
        if (i >= allowed) {
          results.push({ type: "tool_result", tool_use_id: u.id, content: TOOL_LIMIT_TEXT, is_error: true });
          continue;
        }
        toolCalls++;
        results.push(await runToolCall(u, me, exposeRef, emails, cardCtx, (card) => {
          cards++;
          if (cardKinds.length < ASK_CONFIRMED_MAX) cardKinds.push(card.kind);
          emit({ t: "card", card });
        }));
      }
      messages.push({ role: "user", content: results });
      if (deps.signal?.aborted) {
        stop = "aborted";
        break;
      }
    }

    if (stop === "timeout") sayBlock(ASK_TIMEOUT_NOTE);
    else if (stop !== "aborted" && !answer.trim() && cards === 0) say(ASK_EMPTY_TEXT);
  } catch (err) {
    console.error("[ask] run failed:", err);
    stop = "error";
    error = errorText(err);
    emit({ t: "error", message: ASK_FAILED_TEXT });
  }

  // 6. Log one run per question.
  const usage = sumUsage(rounds);
  const last = rounds[rounds.length - 1];
  const runError = error ?? (stop === "aborted" ? "aborted" : stop === "timeout" ? "timed out" : stop === "refusal" ? "declined" : null);
  const run: AssistRun = {
    id: newRunId(now),
    feature: "ask",
    step: null,
    userId: me.id,
    userName: me.name,
    provider: client.name,
    model: last?.answered ?? model,
    requestedModel: model,
    fellBack: rounds.some((r) => r.answered !== r.requested),
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    costUsd: askCostUsd(rounds, webSearches),
    latencyMs: Math.max(0, clock() - t0),
    inputHash: createHash("sha256").update(ASK_SYSTEM + "\n" + firstUser).digest("hex"),
    output: answer.slice(0, ASK_OUTPUT_MAX),
    ok: runError === null,
    error: runError,
    stopReason: stop === "aborted" || stop === "timeout" || stop === "error" ? stop : lastStopReason,
    contextRef: `ask:${pageRef ?? "none"}`,
    monthKey,
    outcome: null,
    outcomeDetail: {
      rounds: rounds.length,
      toolCalls,
      refs: [...refs.keys()].slice(0, ASK_LOG_REFS_MAX),
      cards,
      cardKinds,
      web: webSearches,
      hard: input.hard,
      retryOf: input.retryOf,
    },
    outcomeAt: null,
    createdAt: now,
  };
  let runId: string | null = null;
  try {
    await createRun(run);
    runId = run.id;
  } catch (err) {
    console.error("[ask] run log failed:", err);
  }
  if (input.retryOf) {
    try {
      // Try harder replaces that answer: discard it — the asker's own Ask run only, first decision wins.
      const prev = await getRun(input.retryOf);
      if (prev && prev.feature === "ask" && prev.userId === me.id) await setRunOutcome(input.retryOf, me.id, "discarded", { retriedBy: runId });
    } catch (err) {
      console.error("[ask] retryOf discard failed:", err);
    }
  }
  emit({ t: "done", runId });
  return { runId, ok: run.ok, error: runError };
}

function errorText(err: unknown): string {
  if (err instanceof Error) return err.message.slice(0, 300) || "failed";
  return "failed";
}

/** One tool_use → its tool_result: a read tool (refs + emails exposed), a proposal (a card), or an error. */
async function runToolCall(
  u: { id: string; name: string; input: unknown },
  me: AskUser,
  exposeRef: (r: AskToolRef) => void,
  emails: Set<string>,
  cardCtx: () => CardContext,
  onCard: (card: NonNullable<ReturnType<typeof sanitizeCard>>) => void
): Promise<BetaToolResultBlockParam> {
  if (isReadToolName(u.name)) {
    const r = await runReadTool(u.name, u.input, me);
    for (const ref of r.refs) exposeRef(ref);
    for (const e of r.emails) emails.add(e.toLowerCase());
    return { type: "tool_result", tool_use_id: u.id, content: r.text, ...(r.isError ? { is_error: true } : {}) };
  }
  const kind = proposalToolKind(u.name);
  if (kind) {
    const schema = ASK_PROPOSAL_TOOLS.find((t) => t.name === u.name)!.schema;
    const parsed = schema.safeParse(u.input ?? {});
    if (!parsed.success) {
      const why = parsed.error.issues.map((i) => `${i.path.join(".") || "input"} ${i.message}`).join("; ").slice(0, 300);
      return { type: "tool_result", tool_use_id: u.id, content: `Invalid input for ${u.name}: ${why}`, is_error: true };
    }
    const card = sanitizeCard(kind, parsed.data, cardCtx());
    if (!card) return { type: "tool_result", tool_use_id: u.id, content: CARD_DROPPED_TEXT };
    onCard(card);
    return { type: "tool_result", tool_use_id: u.id, content: CARD_SHOWN_TEXT };
  }
  return { type: "tool_result", tool_use_id: u.id, content: `Unknown tool "${String(u.name).slice(0, 60)}".`, is_error: true };
}
