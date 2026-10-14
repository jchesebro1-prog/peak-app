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
import { getSnapshot } from "@/lib/triage/store";
import { triageNow } from "@/lib/triage/service";
import BriefCardView from "./brief-card-view";

/**
 * AI daily brief — the Home card (spec §4), above Start here. Home mounts it
 * (inside its own Suspense, "Preparing your brief…") only after the cheap
 * settings check — Assist pilot + Daily brief on; the Assist gate itself
 * (it reads the stored key) runs here, behind the Suspense. A missing brief
 * builds lazily (≤ 20 s). Server half: the stored brief, the snapshot rows
 * its Do-these-first keys point at, ready pre-drafts / nudges (a chip shows
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
  const view = await loadBriefView(user, triageNow());
  if (!view) return null;
  const b = view.brief;

  const threadIds = new Set<string>();
  const quoteIds = new Set<string>(b.quiet.map((q) => q.quoteId));
  const leadIds = new Set<string>();
  for (const d of b.doFirst) {
    const k = parseTriageKey(d.key);
    if (k?.source === "email") threadIds.add(k.id);
    if (k?.source === "quote") quoteIds.add(k.id);
    if (k?.source === "lead") leadIds.add(k.id);
  }

  // Estimate suggestion (spec 2026-10-13 §3): with Suggest estimate on, each
  // lead row's cue becomes Suggest estimate / Suggestion ready (bounded by
  // the Do-these-first list, and by SUGGEST_LOOKUP_MAX).
  const [snap, threads, quotes, leadReady] = await Promise.all([
    getSnapshot(snapshotId(b.userId, b.day, b.slot)).catch(() => null),
    Promise.all([...threadIds].map((id) => getThread(id).catch(() => null))),
    Promise.all([...quoteIds].map((id) => getQuote(id).catch(() => null))),
    flags.estimate && leadIds.size ? suggestionReadyHrefs("lead", [...leadIds]) : Promise.resolve(null),
  ]);
  const leads: Record<string, CardLeadSuggest> | undefined = leadReady
    ? Object.fromEntries(Object.entries(leadReady).map(([id, readyHref]) => [id, { readyHref }]))
    : undefined;

  const rows: Record<string, CardRow> = {};
  const want = new Set(b.doFirst.map((d) => d.key));
  for (const r of Array.isArray(snap?.rows) ? snap.rows : []) {
    if (r && want.has(r.key)) rows[r.key] = { title: String(r.title || ""), href: String(r.href || "") };
  }

  const threadReady: Record<string, CardThreadReady> = {};
  for (const t of threads) {
    if (!t) continue;
    const pd = readerPreDraft(t, { id: user.id, name: user.name });
    threadReady[t.id] = { draft: flags.reply && !!pd?.reply, tasks: flags.tasks && !!pd?.tasks };
  }

  const quoteInfo: Record<string, CardQuoteInfo> = {};
  for (const q of quotes) {
    if (!q) continue;
    // Send nudge shows only when the Inbox will prefill it (its own rule).
    const usable = nudgePrefill(q, { id: user.id, name: user.name }) !== null;
    quoteInfo[q.id] = { href: quoteBuilderHref(q), nudge: usable ? { note: String(q.assistNudge?.note || "") } : null };
  }

  return briefCardVM({ brief: b, stale: view.stale, transient: view.transient, rows, threads: threadReady, quotes: quoteInfo, leads });
}
