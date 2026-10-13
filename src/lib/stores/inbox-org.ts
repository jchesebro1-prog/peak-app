import { getBlob, setBlob } from "@/db/doc-store";
import { keepInInboxOn, setKeepInInboxOn } from "@/lib/stores/notif-prefs";
import type { Filing, FilingAction, FilingSource, SenderRule } from "@/lib/inbox-org/types";

/* ============================================================
   Inbox organization stores (#335, spec §5 and §8). Three settings blobs
   and one per-user flag, no new table:
     inbox_sender_rules  { rules: SenderRule[] }        capped at 2,000
     inbox_filing_log    { entries: FilingLogEntry[] }  last 2,000, newest last
     inbox_org_settings  { ownDomainOverride: string }  admin override
     notif_prefs row     "inbox_keep_after_reply"       keepInInbox(userName)

   The blob helpers read-modify-write one top-level key. Concurrent writers
   in one server process are serialized below; two separate serverless
   instances can still last-write-wins on the same blob (the accepted gap
   documented on setBlob).
   ============================================================ */

export const SENDER_RULES_BLOB = "inbox_sender_rules";
export const FILING_LOG_BLOB = "inbox_filing_log";
export const ORG_SETTINGS_BLOB = "inbox_org_settings";

export const MAX_SENDER_RULES = 2000;
export const MAX_FILING_LOG = 2000;

/** In-process write queue per blob — keeps two awaited-in-parallel writers from
 *  reading the same snapshot. */
const queues = new Map<string, Promise<unknown>>();
function serialized<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const run = (queues.get(key) ?? Promise.resolve()).then(fn, fn);
  queues.set(key, run.catch(() => undefined));
  return run;
}

/* ---- sender rules (§5) ---------------------------------------------------- */

const lc = (s: string | null | undefined) => String(s ?? "").trim().toLowerCase();

export async function getSenderRules(): Promise<SenderRule[]> {
  const b = await getBlob<{ rules: SenderRule[] }>(SENDER_RULES_BLOB, { rules: [] });
  return Array.isArray(b.rules) ? b.rules : [];
}

/** What the caller supplies; `id` and `createdAt` are filled in. */
export type NewSenderRule = Omit<SenderRule, "id" | "createdAt"> & { id?: string; createdAt?: number };

function normalizeMatch(m: SenderRule["match"] | undefined): SenderRule["match"] | null {
  const email = lc(m?.email);
  if (email) return email.includes("@") ? { email } : null;
  const domain = lc(m?.domain).replace(/^@+/, "");
  return domain && !/[\s@]/.test(domain) ? { domain } : null;
}

/** The action with only its known fields; null when it isn't a known action. */
function cleanAction(a: SenderRule["action"] | undefined): SenderRule["action"] | null {
  if (a?.type === "noise" || a?.type === "never-noise") return { type: a.type };
  if (a?.type === "file" && typeof a.customerId === "string" && a.customerId) {
    return a.work ? { type: "file", customerId: a.customerId, work: a.work } : { type: "file", customerId: a.customerId };
  }
  return null;
}

function sameTarget(a: SenderRule, b: SenderRule): boolean {
  return (
    a.scope === b.scope &&
    (a.scope === "user" ? a.userId === b.userId : true) &&
    (a.match.email ?? "") === (b.match.email ?? "") &&
    (a.match.domain ?? "") === (b.match.domain ?? "")
  );
}

/** Save a rule. The match is normalized (lower-case, no leading `@`); a rule
 *  must name an email or a domain, and a personal rule a user. A rule for the
 *  same match + scope + user REPLACES the old one (changing your mind from
 *  "noise" to "file" must not leave two rules). At the 2,000 cap the oldest
 *  rule drops. Returns the stored rule, or null when it was refused. */
export async function addSenderRule(input: NewSenderRule): Promise<SenderRule | null> {
  const match = normalizeMatch(input.match);
  if (!match) return null;
  if (input.scope !== "user" && input.scope !== "company") return null;
  if (input.scope === "user" && !input.userId) return null;
  const action = cleanAction(input.action);
  const createdBy = typeof input.createdBy === "string" ? input.createdBy.trim() : "";
  if (!action || !createdBy) return null;
  // Known fields only — nothing else a caller spread in reaches the blob.
  const rule: SenderRule = {
    id: input.id || `SR-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    scope: input.scope,
    ...(input.scope === "user" ? { userId: input.userId } : {}),
    match,
    action,
    createdBy,
    createdAt: input.createdAt ?? Date.now(),
  };
  return serialized(SENDER_RULES_BLOB, async () => {
    const rest = (await getSenderRules()).filter((r) => !sameTarget(r, rule) && r.id !== rule.id);
    const next = [...rest, rule].slice(-MAX_SENDER_RULES);
    await setBlob(SENDER_RULES_BLOB, { rules: next });
    return rule;
  });
}

/** Who is deleting: their user id, and whether they are an admin. */
export type RuleRemover = { userId: string; admin: boolean };

/** Delete a rule. Your own personal rule — or any rule, for an admin; a
 *  company-wide rule is admin-only. Returns whether a rule was removed. */
export async function removeSenderRule(id: string, by: RuleRemover): Promise<boolean> {
  return serialized(SENDER_RULES_BLOB, async () => {
    const rules = await getSenderRules();
    const rule = rules.find((r) => r.id === id);
    if (!rule) return false;
    const mine = rule.scope === "user" && !!by.userId && rule.userId === by.userId;
    if (!mine && !by.admin) return false;
    await setBlob(SENDER_RULES_BLOB, { rules: rules.filter((r) => r.id !== id) });
    return true;
  });
}

/* ---- filing log (§8) ------------------------------------------------------ */

/** One rule-based (or AI) filing event, so the Assist report can compare
 *  sources. `outcome` is how it ended: suggested, filed, skipped, dismissed. */
export type FilingLogEntry = {
  at: number;
  threadId: string;
  source: FilingSource;
  strength: Filing["strength"];
  outcome: Filing["state"];
  customerId?: string | null;
  workType?: string | null;
  noise?: boolean;
  userId?: string;
  /** what a person (or a reply) did with the suggestion; absent on the
   *  pipeline's own "suggested" entries */
  action?: FilingAction;
};

export async function getFilingLog(): Promise<FilingLogEntry[]> {
  const b = await getBlob<{ entries: FilingLogEntry[] }>(FILING_LOG_BLOB, { entries: [] });
  return Array.isArray(b.entries) ? b.entries : [];
}

/** Append entries, newest last, keeping the last 2,000. */
export async function appendFilingLogs(entries: FilingLogEntry[]): Promise<void> {
  if (!entries.length) return;
  await serialized(FILING_LOG_BLOB, async () => {
    const next = [...(await getFilingLog()), ...entries].slice(-MAX_FILING_LOG);
    await setBlob(FILING_LOG_BLOB, { entries: next });
  });
}

export async function appendFilingLog(entry: FilingLogEntry): Promise<void> {
  await appendFilingLogs([entry]);
}

/* ---- Peak's own domain override (§1 step 4, "Internal sender") ------------ */

/** The admin's own-domain override ("" / null = derive from the team). */
export async function getOwnDomainOverride(): Promise<string | null> {
  const b = await getBlob<{ ownDomainOverride: string | null }>(ORG_SETTINGS_BLOB, { ownDomainOverride: null });
  return String(b.ownDomainOverride ?? "").trim() || null;
}

/** Save the override as typed (trimmed); blank clears it. */
export async function setOwnDomainOverride(v: string | null): Promise<void> {
  const value = String(v ?? "").trim().slice(0, 200);
  await serialized(ORG_SETTINGS_BLOB, () => setBlob(ORG_SETTINGS_BLOB, { ownDomainOverride: value || null }));
}

/* ---- keep threads in my inbox after I reply (§4) -------------------------- */

/** True when this user opted out of archive-on-reply. Default false. */
export const keepInInbox = keepInInboxOn;
export const setKeepInInbox = (userName: string, on: boolean): Promise<void> => setKeepInInboxOn(on, userName);
