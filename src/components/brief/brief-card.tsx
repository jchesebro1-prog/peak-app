import type { SessionUser } from "@/lib/session";
import type { AssistSettings } from "@/lib/assist/types";
import { assistUiFlags } from "@/lib/assist/config";
import { getAssistEnv } from "@/lib/assist/key-store";
import { loadBriefView } from "@/lib/brief/build";
import { briefCardVM, type BriefCardVM, type CardLeadSuggest, type CardQuoteInfo, type CardRow, type CardThreadReady } from "@/lib/brief/card-vm";
import { suggestionReadyHrefs } from "@/lib/assist/suggest-entry-server";
import { readerPreDraft } from "@/lib/brief/reader-predraft";
import { nudgePrefill } from "@/lib/inbox-compose-prefill";
import { quoteBuilderHref } from "@/lib/quote-links";
import { get as getThread } from "@/lib/stores/comms";
import { get as getQuote } from "@/lib/stores/quotes";
import { snapshotId } from "@/lib/triage/clock";
import { parseTriageKey } from "@/lib/triage/keys";
import { getSnapshot, marksFor } from "@/lib/triage/store";
import { loadClosedKeys } from "@/lib/triage/liveness";
import { visibleRows } from "@/lib/triage/view";
import type { SnapshotRow } from "@/lib/triage/types";
import { BLOCK_CAP } from "@/lib/brief/blocks";
import { getCleanupState } from "@/lib/inbox-org/cleanup";
import { inboxOrgDisabled } from "@/lib/inbox-org/kill-switch";
import { triageNow, triageUserFromSession } from "@/lib/triage/service";
import { organizeEntryCounts } from "@/app/(app)/inbox/organize/load";
import BriefCardView from "./brief-card-view";
import { mailboxViewer } from "@/lib/mailbox-viewer";

/**
 * AI daily brief — the Home card (spec §4), above Start here. Home mounts it
 * (inside its own Suspense, "Preparing your brief…") only after the cheap
 * settings check — Assist pilot + Daily brief on; the Assist gate itself
 * (it reads the stored key) runs here, behind the Suspense. A missing brief
 * builds lazily (≤ 20 s). Server half: the stored brief, the slot's visible
 * snapshot rows (the VM groups them into Emails / Estimates / Tasks and stars
 * the Do-these-first picks), ready pre-drafts / nudges (a chip shows
 * only when the reader would offer that draft), and each quiet quote's
 * builder link.
 *
 * It never breaks Home: anything that throws — the gate, the load, a store
 * read, the VM — renders the "couldn't load" notice instead.
 */
export default async function BriefCard({ user, settings }: { user: SessionUser; settings: AssistSettings }) {
  let vm: BriefCardVM | null;
  try {
    vm = await loadCardVM(user, settings);
  } catch (err) {
    console.error("[brief] Home card failed", err);
    return (
      <section className="pk-card" style={{ marginBottom: 22, padding: "14px 17px", fontSize: 12.5, color: "#8a6d1f" }}>
        Your brief couldn’t load — Start here below still has your list.
      </section>
    );
  }
  return vm ? <BriefCardView vm={vm} /> : null;
}


async function loadCardVM(user: SessionUser, settings: AssistSettings): Promise<BriefCardVM | null> {
  const flags = assistUiFlags(user.id, settings, await getAssistEnv());
  if (!flags.brief) return null;
  const now = triageNow();
  const view = await loadBriefView(user, now);
  if (!view) return null;
  const b = view.brief;

  // #345 — Organize's line + "Organize my inbox" (pilot with Inbox organization on, while the
  // 90-day cleanup was never run or is unfinished); a failed read just leaves the offer out
  const organizeAvailable = !inboxOrgDisabled();
  // #346 — the live Organize counts (the Inbox banner's), so an Archive or a
  // filing since the brief was built shows at once; a failed read keeps the
  // brief's stored counts
  const sid = snapshotId(b.userId, b.day, b.slot);
  const [snap, marks, cleanupState, organizeLive] = await Promise.all([
    getSnapshot(sid).catch(() => null),
    marksFor(user.id).catch(() => []),
    organizeAvailable && flags.file ? getCleanupState(user.id).catch(() => undefined) : Promise.resolve(undefined),
    organizeAvailable ? organizeEntryCounts(user).catch(() => null) : Promise.resolve(null),
  ]);
  const cleanup: "never" | "unfinished" | "done" | null =
    !organizeAvailable || !flags.file || cleanupState === undefined ? null : cleanupState === null ? "never" : cleanupState.done ? "done" : "unfinished";

  // The blocks list the slot's rows as Start here shows them: marks (done /
  // snooze / not mine) and liveness applied. No snapshot → null: the picks
  // then show from their stored why.
  const snapRows = Array.isArray(snap?.rows) ? snap.rows.filter((r) => r && typeof r.key === "string") : null;
  let visible: SnapshotRow[] | null = null;
  if (snapRows) {
    const closed = await loadClosedKeys(snapRows, triageUserFromSession(user), now).catch(() => new Set<string>());
    visible = visibleRows(snapRows, marks, closed, { snapshotId: sid, day: b.day, slot: b.slot });
  }
  const rows: CardRow[] | null = visible
    ? visible.map((r) => ({ key: r.key, source: r.source, title: String(r.title || ""), href: String(r.href || ""), reason: String(r.reason || "") }))
    : null;

  // Pre-draft / nudge / suggestion lookups for the rows a block can show:
  // the picks, plus the first BLOCK_CAP rows of each source (a superset of
  // what the cap keeps, so every shown row has its chips).
  const threadIds = new Set<string>();
  const quoteIds = new Set<string>(b.quiet.map((q) => q.quoteId));
  const leadIds = new Set<string>();
  const perSource = new Map<string, number>();
  const want = (key: string) => {
    const k = parseTriageKey(key);
    if (k?.source === "email") threadIds.add(k.id);
    if (k?.source === "quote") quoteIds.add(k.id);
    if (k?.source === "lead") leadIds.add(k.id);
  };
  for (const d of b.doFirst) want(d.key);
  for (const r of rows ?? []) {
    const src = parseTriageKey(r.key)?.source;
    if (!src) continue;
    const seen = perSource.get(src) ?? 0;
    if (seen >= BLOCK_CAP) continue;
    perSource.set(src, seen + 1);
    want(r.key);
  }

  // Estimate suggestion (spec 2026-10-13 §3): with Suggest estimate on, each
  // lead row's cue becomes Suggest estimate / Suggestion ready (bounded by
  // the lookup above, and by SUGGEST_LOOKUP_MAX).
  const [threads, quotes, leadReady] = await Promise.all([
    Promise.all([...threadIds].map((id) => getThread(id).catch(() => null))),
    Promise.all([...quoteIds].map((id) => getQuote(id).catch(() => null))),
    flags.estimate && leadIds.size ? suggestionReadyHrefs("lead", [...leadIds]) : Promise.resolve(null),
  ]);
  const leads: Record<string, CardLeadSuggest> | undefined = leadReady
    ? Object.fromEntries(Object.entries(leadReady).map(([id, readyHref]) => [id, { readyHref }]))
    : undefined;

  const threadReady: Record<string, CardThreadReady> = {};
  const viewer = await mailboxViewer(user); // #349 — assigned to me by identity
  for (const t of threads) {
    if (!t) continue;
    const pd = readerPreDraft(t, viewer);
    threadReady[t.id] = { draft: flags.reply && !!pd?.reply, tasks: flags.tasks && !!pd?.tasks };
  }

  const quoteInfo: Record<string, CardQuoteInfo> = {};
  for (const q of quotes) {
    if (!q) continue;
    // Send nudge shows only when the Inbox will prefill it (its own rule).
    const usable = nudgePrefill(q, { id: user.id, name: user.name }) !== null;
    quoteInfo[q.id] = { href: quoteBuilderHref(q), nudge: usable ? { note: String(q.assistNudge?.note || "") } : null };
  }

  return briefCardVM({
    brief: b,
    stale: view.stale,
    transient: view.transient,
    rows,
    threads: threadReady,
    quotes: quoteInfo,
    leads,
    organizeEntry: { available: organizeAvailable, cleanup },
    organizeLive,
  });
}
