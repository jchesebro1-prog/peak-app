import type { SessionUser } from "@/lib/session";
import type { AssistFeature } from "@/lib/assist/types";
import { loadBriefView, type BriefView } from "@/lib/brief/build";
import { briefCardVM, type CardQuoteInfo, type CardRow, type CardThreadReady } from "@/lib/brief/card-vm";
import { nudgeFresh } from "@/lib/brief/fresh";
import { readerPreDraft } from "@/lib/brief/reader-predraft";
import { quoteBuilderHref } from "@/lib/quote-links";
import { get as getThread } from "@/lib/stores/comms";
import { get as getQuote } from "@/lib/stores/quotes";
import { snapshotId } from "@/lib/triage/clock";
import { parseTriageKey } from "@/lib/triage/keys";
import { getSnapshot } from "@/lib/triage/store";
import { triageNow } from "@/lib/triage/service";
import BriefCardView from "./brief-card-view";

/**
 * AI daily brief — the Home card (spec §4), above Start here. Home renders it
 * only for an Assist pilot user with Daily brief on, inside its own Suspense
 * ("Preparing your brief…": a missing brief builds lazily here, ≤ 20 s).
 * Server half: the stored brief, the snapshot rows its Do-these-first keys
 * point at, ready pre-drafts / nudges, and each quiet quote's builder link.
 * `flags` = the viewer's Assist UI flags — a chip only shows when the reader
 * would offer that draft. A failure here never breaks Home.
 */
export default async function BriefCard({ user, flags }: { user: SessionUser; flags: Record<AssistFeature, boolean> }) {
  let view: BriefView | null;
  try {
    view = await loadBriefView(user, triageNow());
  } catch (err) {
    console.error("[brief] Home card failed", err);
    return (
      <section className="pk-card" style={{ marginBottom: 22, padding: "14px 17px", fontSize: 12.5, color: "#8a6d1f" }}>
        Your brief couldn’t load — Start here below still has your list.
      </section>
    );
  }
  if (!view) return null;
  const b = view.brief;

  const threadIds = new Set<string>();
  const quoteIds = new Set<string>(b.quiet.map((q) => q.quoteId));
  for (const d of b.doFirst) {
    const k = parseTriageKey(d.key);
    if (k?.source === "email") threadIds.add(k.id);
    if (k?.source === "quote") quoteIds.add(k.id);
  }

  const [snap, threads, quotes] = await Promise.all([
    getSnapshot(snapshotId(b.userId, b.day, b.slot)).catch(() => null),
    Promise.all([...threadIds].map((id) => getThread(id).catch(() => null))),
    Promise.all([...quoteIds].map((id) => getQuote(id).catch(() => null))),
  ]);

  const rows: Record<string, CardRow> = {};
  const want = new Set(b.doFirst.map((d) => d.key));
  for (const r of Array.isArray(snap?.rows) ? snap.rows : []) {
    if (want.has(r.key)) rows[r.key] = { title: r.title, href: r.href };
  }

  const threadReady: Record<string, CardThreadReady> = {};
  for (const t of threads) {
    if (!t) continue;
    const pd = readerPreDraft(t, { name: user.name });
    threadReady[t.id] = { draft: flags.reply && !!pd?.reply, tasks: flags.tasks && !!pd?.tasks && pd.tasks.suggestions.length > 0 };
  }

  const quoteInfo: Record<string, CardQuoteInfo> = {};
  for (const q of quotes) {
    if (!q) continue;
    const n = q.assistNudge;
    const usable = flags.brief && !!n && nudgeFresh(q) && !n.error && !!n.emailBody.trim();
    quoteInfo[q.id] = {
      href: quoteBuilderHref(q),
      customerId: q.customerId || null,
      contactName: q.contactName || "",
      nudge: usable && n ? { note: n.note, emailSubject: n.emailSubject, emailBody: n.emailBody } : null,
    };
  }

  const vm = briefCardVM({ brief: b, stale: view.stale, transient: view.transient, rows, threads: threadReady, quotes: quoteInfo });
  return <BriefCardView vm={vm} />;
}
