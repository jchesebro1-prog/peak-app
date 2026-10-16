"use server";

/**
 * #348 slice 4 — the Inbox reader's vendor-file actions: the one-time lazy
 * attachment listing for mail imported before attachments were recorded (it
 * calls Gmail on the OWNER's connection), and filing a thread to an estimate /
 * project. Both are writes, so both need `ownThread` (#341: seeing a thread
 * never grants a write); filing also needs `create` (it writes a party).
 */
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/team";
import { displayQuoteNumber, quoteSearchRank } from "@/lib/estimate-number";
import { getAll as getAllQuotes, type Quote } from "@/lib/stores/quotes";
import { getAllProjects } from "@/lib/stores/projects";
import { fileThreadTo } from "@/lib/vendor-quotes/threads-server";
import { filingLinkLabel } from "@/lib/vendor-quotes/rules";
import type { FilingTargetVM } from "@/lib/vendor-quotes/vm";
import { patchDoc } from "@/db/doc-store";
import type { CommThread } from "@/lib/stores/comms";
import { gmailEnabled, shouldStampCcFetched } from "@/lib/gmail/config";
import { ownThread } from "@/lib/inbox-thread-guard";
import { VENDOR_COPY } from "@/lib/vendor-quotes/rules";

/** At most this many messages are listed per call (each is one Gmail messages.get). */
const LIST_PER_CALL = 10;

export async function listThreadAttachmentsAction(threadId: string): Promise<{ ok: true; changed: boolean } | { ok: false; error: string }> {
  const me = await requireUser();
  const t = await ownThread(threadId, me);
  if (!t) return { ok: false, error: VENDOR_COPY.notAvailable };
  if (!gmailEnabled()) return { ok: true, changed: false };
  const pending = (t.messages || []).filter((m) => m.gmailId && !m.attsListed && !(m.attachments || []).length).slice(0, LIST_PER_CALL);
  if (!pending.length) return { ok: true, changed: false };
  // Lazy import — the bridge (and the Gmail client) only loads when the env gate is on.
  const { listMessageAttachments } = await import("@/lib/gmail/bridge");
  let changed = false;
  for (const m of pending) {
    try {
      const n = await listMessageAttachments(t.id, m.id);
      if (n) changed = true;
    } catch (err) {
      console.error("[inbox] attachment listing failed", t.id, m.id, err);
      if (shouldStampCcFetched(err)) {
        // Gmail no longer has this message (404) — it will never list, so stop
        // asking. A transient failure is left for the next open.
        await patchDoc<CommThread>("comms", t.id, (d) => {
          const x = (d.messages || []).find((y) => y.id === m.id);
          if (x) x.attsListed = true;
        });
      }
    }
  }
  return { ok: true, changed };
}

const TARGET_ID_MAX = 200;

/** The File dialog's search: estimates (the one quote search rule) and projects (id / name). Reads — requireUser. */
export async function searchFilingTargetsAction(q: string, kinds: Array<"quote" | "project"> = ["quote", "project"]): Promise<FilingTargetVM[]> {
  await requireUser();
  const term = typeof q === "string" ? q.trim() : "";
  if (term.length < 2) return [];
  const want = new Set(Array.isArray(kinds) ? kinds : []);
  const out: FilingTargetVM[] = [];
  if (want.has("quote")) {
    const ranked = (await getAllQuotes())
      .map((quote, i) => ({ quote, i, r: quoteSearchRank(quote, term) }))
      .filter((x): x is { quote: Quote; i: number; r: number } => x.r !== null)
      .sort((a, b) => a.r - b.r || a.i - b.i)
      .slice(0, 8);
    for (const { quote } of ranked)
      out.push({
        type: "quote", id: quote.id, label: filingLinkLabel({ type: "quote", number: displayQuoteNumber(quote), name: quote.name }),
        sub: [quote.customer, quote.status].filter(Boolean).join(" · "),
      });
  }
  if (want.has("project")) {
    const t = term.toLowerCase();
    const hits = (await getAllProjects()).filter((p) => p.id.toLowerCase().includes(t) || (p.name || "").toLowerCase().includes(t)).slice(0, 8);
    for (const p of hits) out.push({ type: "project", id: p.id, label: filingLinkLabel({ type: "project", id: p.id, name: p.name }), sub: p.customer || "" });
  }
  return out;
}

/** File an email thread to an estimate / project (and, when a vendor is picked, link it to that vendor and add the
 *  vendor party). Needs the owner's mailbox AND `create`. */
export async function fileThreadAction(
  threadId: string,
  target: { type: "quote" | "project"; id: string },
  vendorCompanyId: string | null
): Promise<{ ok: true; label: string } | { ok: false; error: string }> {
  const me = await requireUser();
  const t = await ownThread(threadId, me);
  if (!t) return { ok: false, error: VENDOR_COPY.notAvailable };
  if (!can("create", me.roles)) return { ok: false, error: "You can't file emails to estimates." };
  if (!target || (target.type !== "quote" && target.type !== "project") || typeof target.id !== "string" || !target.id || target.id.length > TARGET_ID_MAX)
    return { ok: false, error: "That estimate or project wasn't found." };
  if (vendorCompanyId !== null && (typeof vendorCompanyId !== "string" || !vendorCompanyId || vendorCompanyId.length > TARGET_ID_MAX))
    return { ok: false, error: VENDOR_COPY.pickVendor };
  const r = await fileThreadTo(t, { type: target.type, id: target.id }, vendorCompanyId, { id: me.id, name: me.name });
  if (!r.ok) return r;
  revalidatePath("/inbox");
  revalidatePath("/estimator");
  revalidatePath("/projects", "layout");
  return { ok: true, label: r.label };
}
