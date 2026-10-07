import type { SpecSection } from "@/app/(app)/estimator/types";
import type { SystemGroup } from "@/lib/estimate-groups/groups";
import { fmt } from "@/app/(app)/estimator/pricing";
import { cleanText } from "@/lib/document-files";
import { permsFor } from "@/lib/team";
import { alternateScopes, outputScopes } from "./scopes";

/**
 * #301 slice C (D-m, D-n, R1, R15, R16) — what a client sends from the
 * package page: a scope selection ("accept") or a question. Pure and
 * client-safe. `Quote.clientResponses` is store-owned (appendClientResponse,
 * under the row lock); a response never changes the quote's status.
 */

export type ClientResponseKind = "accept" | "question";
export type ClientResponse = {
  id: string;
  kind: ClientResponseKind;
  /** QuoteRevision.rev the client was looking at (R11 — staff print "Rev N"). */
  rev: number;
  at: number;
  name: string;
  email: string;
  title?: string;
  message: string;
  sectionIds: string[];
  sectionNames: string[];
  /** Σ the selected scopes' prices, pre-credit (R1). 0 for a question. */
  total: number;
};
export type CleanResponse = Omit<ClientResponse, "id" | "rev" | "at">;
export type ClientActionResult = { ok: true; confirmation: string } | { ok: false; error: string };
/** `name` is what the picker shows and the note / task record; an Alternate
 *  group's system reads "Alternate — <group>: <system>" and carries
 *  `alternate: true` (absent on In-total scopes). */
export type ResponseScope = { id: string; name: string; price: number; priceLabel: string; alternate?: true };

export const MAX_CLIENT_RESPONSES = 200;
export const RESPONSE_NAME_MAX = 120;
export const RESPONSE_TITLE_MAX = 120;
export const RESPONSE_EMAIL_MAX = 200;
export const RESPONSE_MESSAGE_MAX = 4_000;
export const RESPONSE_IP_LIMIT = 5;
export const RESPONSE_IP_WINDOW_MS = 10 * 60_000;
export const RESPONSE_QUOTE_LIMIT = 30;
export const RESPONSE_QUOTE_WINDOW_MS = 24 * 60 * 60_000;
/** Who the note, the lead activity and the task say did it. */
export const CLIENT_LINK_ACTOR = "Client link";
/** R16: no lead estimator → the company. */
export const PEAK_NAME = "Peak Systems Group";

export const CLIENT_ACTION_COPY = {
  chooseTitle: "Choose your scopes",
  chooseHelp: "Check the scopes you want and submit. Peak will follow up to confirm.",
  selectedTotal: "Selected scopes",
  submitSelection: "Submit selection",
  askTitle: "Ask a question or request changes",
  send: "Send",
  sending: "Sending…",
  name: "Your name",
  title: "Title",
  email: "Email",
  note: "Note",
  message: "Message",
  needName: "Enter your name.",
  needScope: "Check at least one scope.",
  needMessage: "Enter a message.",
  badEmail: "Check the email address.",
  tooMany: "Too many submissions — try again later.",
  inactive: "This link isn’t active. Ask your Peak rep for a new one.",
  superseded: "A newer version of this estimate was sent — open the current version to respond.",
  closed: "This estimate can’t take responses right now.",
  full: "This estimate can’t take more responses online — contact Peak directly.",
  failed: "Couldn’t send — try again.",
  alternates: "Alternates",
  noJs: "Turn on JavaScript to respond here, or reply to Peak’s email.",
} as const;

const EMAIL_RE = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/;
const ID_RE = /^CR-[0-9a-f]{12}$/;

/** "Alternate — <group name>: <system name>" — the picker label, also what
 *  the note and task record for a chosen alternate. */
export function alternateScopeLabel(groupName: string, systemName: string): string {
  return `Alternate — ${groupName}: ${systemName}`;
}

/** The page's scopes as a client can choose them — the printed In-total
 *  systems, labor included (R2), then (Estimator Phase 2b) each printed
 *  Alternate group's systems, flagged `alternate: true`. `sections` must be
 *  normalised (stamped) against `groups` — no groups, no alternates. */
export function responseScopes(sections: SpecSection[], groups?: SystemGroup[]): ResponseScope[] {
  const inTotal: ResponseScope[] = outputScopes({ sections }).map((s) => ({ id: s.id, name: s.name, price: s.price, priceLabel: fmt(s.price) }));
  const alts: ResponseScope[] = alternateScopes({ sections, groups }).flatMap((g) =>
    g.systems.map((s) => ({ id: s.id, name: alternateScopeLabel(g.name, s.name), price: s.price, priceLabel: fmt(s.price), alternate: true as const }))
  );
  return [...inTotal, ...alts];
}

/** The picker's starting selection: every In-total scope, no alternate. */
export function defaultSelectedScopeIds(scopes: ReadonlyArray<Pick<ResponseScope, "id" | "alternate">>): string[] {
  return scopes.filter((s) => s.alternate !== true).map((s) => s.id);
}

export function selectedTotal(scopes: ReadonlyArray<Pick<ResponseScope, "price">>): number {
  return Math.round(scopes.reduce((n, s) => n + (Number.isFinite(s.price) ? s.price : 0), 0) * 100) / 100;
}

/** D-n — every field cleaned and capped; `sectionIds` filtered to the pinned revision's scopes. */
export function sanitizeClientResponse(
  kind: ClientResponseKind,
  input: unknown,
  scopes: readonly ResponseScope[]
): { ok: true; value: CleanResponse } | { ok: false; error: string } {
  // The type says accept | question; a server action's argument isn't checked at runtime.
  if ((kind as string) !== "accept" && (kind as string) !== "question") return { ok: false, error: CLIENT_ACTION_COPY.failed };
  const o = (input && typeof input === "object" && !Array.isArray(input) ? input : {}) as Record<string, unknown>;
  const name = cleanText(o.name, RESPONSE_NAME_MAX);
  if (!name) return { ok: false, error: CLIENT_ACTION_COPY.needName };
  const rawEmail = typeof o.email === "string" ? o.email.trim() : "";
  if (rawEmail.length > RESPONSE_EMAIL_MAX) return { ok: false, error: CLIENT_ACTION_COPY.badEmail };
  const email = cleanText(rawEmail, RESPONSE_EMAIL_MAX);
  if (email && !EMAIL_RE.test(email)) return { ok: false, error: CLIENT_ACTION_COPY.badEmail };
  const message = cleanText(o.message, RESPONSE_MESSAGE_MAX, { multiline: true });
  if (kind === "question") {
    if (!message) return { ok: false, error: CLIENT_ACTION_COPY.needMessage };
    return { ok: true, value: { kind, name, email, message, sectionIds: [], sectionNames: [], total: 0 } };
  }
  const title = cleanText(o.title, RESPONSE_TITLE_MAX);
  const want = new Set(Array.isArray(o.sectionIds) ? o.sectionIds.slice(0, 200).filter((x): x is string => typeof x === "string") : []);
  const picked = scopes.filter((s) => want.has(s.id));
  if (!picked.length) return { ok: false, error: CLIENT_ACTION_COPY.needScope };
  return {
    ok: true,
    value: {
      kind,
      name,
      email,
      ...(title ? { title } : {}),
      message,
      sectionIds: picked.map((s) => s.id),
      sectionNames: picked.map((s) => s.name),
      total: selectedTotal(picked),
    },
  };
}

export function newResponseId(): string {
  return "CR-" + globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}

export function isClientResponseId(v: unknown): v is string {
  return typeof v === "string" && ID_RE.test(v);
}

const strList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 200) : []);

function responseOf(v: unknown): ClientResponse | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (!isClientResponseId(o.id) || (o.kind !== "accept" && o.kind !== "question")) return null;
  // Real numbers only: Number(null) / Number("") would coerce a damaged record to 0.
  const { rev, at, total } = o;
  if (typeof rev !== "number" || typeof at !== "number" || typeof total !== "number") return null;
  if (!Number.isSafeInteger(rev) || rev < 1 || !Number.isFinite(at) || !Number.isFinite(total) || total < 0) return null;
  const title = cleanText(o.title, RESPONSE_TITLE_MAX);
  return {
    id: o.id,
    kind: o.kind,
    rev,
    at,
    name: cleanText(o.name, RESPONSE_NAME_MAX),
    email: cleanText(o.email, RESPONSE_EMAIL_MAX),
    ...(title ? { title } : {}),
    message: cleanText(o.message, RESPONSE_MESSAGE_MAX, { multiline: true }),
    sectionIds: strList(o.sectionIds),
    sectionNames: strList(o.sectionNames),
    total,
  };
}

/** Every read of the stored list: junk and duplicate ids dropped. */
export function cleanClientResponses(raw: unknown): ClientResponse[] {
  if (!Array.isArray(raw)) return [];
  const out: ClientResponse[] = [];
  const seen = new Set<string>();
  for (const v of raw) {
    const r = responseOf(v);
    if (!r || seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
  }
  return out;
}

/** The list with `r` appended, or null at the 200 cap. */
export function appendResponseTo(list: unknown, r: ClientResponse): ClientResponse[] | null {
  const cur = cleanClientResponses(list);
  if (cur.length >= MAX_CLIENT_RESPONSES) return null;
  return [...cur, r];
}

export function responseTaskTitle(r: Pick<CleanResponse, "kind" | "sectionNames" | "total">, number: string, revNo: number): string {
  return r.kind === "accept" ? `Client accepted ${number} Rev ${revNo} — ${r.sectionNames.join(", ")} (${fmt(r.total)})` : `Client question — ${number}`;
}

export function responseNoteText(r: CleanResponse, number: string, revNo: number): string {
  const who = [r.name, r.title, r.email].filter(Boolean).join(" · ");
  const head =
    r.kind === "accept"
      ? `Client selected scopes on ${number} Rev ${revNo} (client link): ${r.sectionNames.join(", ")} — ${fmt(r.total)} before any Rewards credit.`
      : `Client question on ${number} Rev ${revNo} (client link).`;
  return [head, `From: ${who}`, r.message ? `Message: ${r.message}` : ""].filter(Boolean).join("\n");
}

export type RosterUser = { id: string; name: string; status?: string | null; roles?: string[] | null };

const norm = (s: unknown) => (typeof s === "string" ? s : "").trim().toLowerCase();

/** R16: exact, case-insensitive, trimmed name — unique only. */
export function matchRosterName<T extends { name: string }>(name: string | null | undefined, users: readonly T[]): T | null {
  const n = norm(name);
  if (!n) return null;
  const hits = users.filter((u) => norm(u.name) === n);
  return hits.length === 1 ? hits[0] : null;
}

/** R16: the quote's Lead estimator (`owner`), else Prepared by. */
export function leadEstimator<T extends { name: string }>(owner: string | null | undefined, preparedBy: string | null | undefined, users: readonly T[]): T | null {
  return matchRosterName(owner, users) ?? matchRosterName(preparedBy, users);
}

const isActive = (u: RosterUser) => (u.status ?? "active") === "active";

/** R16 + Slice C adaptation 11: the lead estimator when active, else every active approve holder. */
export function responseAssignees<T extends RosterUser>(owner: string | null | undefined, preparedBy: string | null | undefined, users: readonly T[]): T[] {
  const lead = leadEstimator(owner, preparedBy, users);
  if (lead && isActive(lead)) return [lead];
  return users.filter((u) => isActive(u) && !!permsFor(u.roles || []).approve);
}

export function confirmationText(leadName: string | null): string {
  return `Thanks — ${(leadName || "").trim() || PEAK_NAME} has been notified.`;
}

/** 11:59 PM Chicago on the day `now` falls on there (the task's "due today"). */
export function chicagoDayEnd(now: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value])) as Record<string, string>;
  const wallAsUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  const offset = wallAsUtc - Math.floor(now / 1000) * 1000; // Chicago wall clock − UTC
  return Date.UTC(+p.year, +p.month - 1, +p.day, 23, 59, 0) - offset;
}

export type ResponseRow = { id: string; kindLabel: string; revLabel: string; who: string; scopes: string; total: string; message: string; when: string };

/** U+202F / U+00A0 (newer ICU puts one before AM/PM) → a plain space, so the stamp is ICU-independent. */
const chicagoStamp = (ms: number) =>
  new Date(ms)
    .toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" })
    .replace(/[\u202f\u00a0]/g, " ");

/** The staff list, newest first. `revNoOf` maps QuoteRevision.rev → the printed Rev N. */
export function responseRows(raw: unknown, revNoOf: (rev: number) => number): ResponseRow[] {
  return cleanClientResponses(raw)
    .sort((a, b) => b.at - a.at)
    .map((r) => ({
      id: r.id,
      kindLabel: r.kind === "accept" ? "Selected scopes" : "Question",
      revLabel: `Rev ${revNoOf(r.rev)}`,
      who: [r.name, r.title, r.email].filter(Boolean).join(" · "),
      scopes: r.sectionNames.join(", "),
      total: r.kind === "accept" ? fmt(r.total) : "",
      message: r.message,
      when: chicagoStamp(r.at),
    }));
}

/** R1 — under the live "Selected scopes" total. `creditAmount` is the page's formatted "−$X". */
export function creditNoteText(creditAmount: string | null | undefined): string | null {
  const amt = (creditAmount || "").replace(/^[−-]\s*/, "").trim();
  return amt ? `A Rewards credit of ${amt} applies to your order.` : null;
}