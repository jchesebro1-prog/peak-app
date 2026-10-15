/* #348 slice 4 — filing an email thread to an estimate / project, and the visibility-filtered vendor threads a Vendors
   card lists. Filing is an OWNER write (the caller has already run ownThread); listing is a READ and shows a thread only
   to someone who may see it (#341 canSeeThread, cut in SQL and re-checked here), never a draft or a deleted one, and
   only subject / last author / last time / unread. Server-only. */
import { listDocsWhere, type Doc, type DocCond } from "@/db/doc-store";
import { getCompanies } from "@/lib/identity/companies";
import { linkThread } from "@/lib/gmail/linking";
import { skipFiling, type OrgActor } from "@/lib/inbox-org/apply";
import { displayQuoteNumber } from "@/lib/estimate-number";
import { canSeeThread, setLink, type CommThread, type MailboxViewer } from "@/lib/stores/comms";
import { canSeeThreadCond } from "@/lib/stores/comms-visibility";
import { addParty, listFor } from "@/lib/stores/parties";
import { getProject } from "@/lib/stores/projects";
import { get as getQuote } from "@/lib/stores/quotes";
import {
  VENDOR_COPY, asVendorQuotes, filingLinkLabel, isListedVendorThread, isVendorPickerType, vendorCompanyIdsOf, vendorThreadRow,
  type VendorQuoteLike,
} from "./rules";
import type { VendorCompanyVM, VendorThreadVM } from "./vm";

export type FileTarget = { type: "quote" | "project"; id: string };

export async function fileThreadTo(
  t: CommThread,
  target: FileTarget,
  vendorCompanyId: string | null,
  by: OrgActor
): Promise<{ ok: true; label: string; partyAdded: boolean } | { ok: false; error: string }> {
  const notFound = { ok: false as const, error: "That estimate or project wasn't found." };
  let label: string;
  if (target.type === "quote") {
    const q = await getQuote(target.id);
    if (!q) return notFound;
    label = filingLinkLabel({ type: "quote", number: displayQuoteNumber(q), name: q.name });
  } else {
    const p = await getProject(target.id);
    if (!p) return notFound;
    label = filingLinkLabel({ type: "project", id: p.id, name: p.name });
  }
  if (vendorCompanyId) {
    const c = (await getCompanies([vendorCompanyId])).get(vendorCompanyId);
    if (!c || !isVendorPickerType(c.type)) return { ok: false, error: VENDOR_COPY.pickVendor };
    if (t.customerId !== vendorCompanyId) await linkThread(t.id, vendorCompanyId, t.resolvedContactId ?? null, "user");
  }
  await setLink(t.id, { type: target.type, id: target.id, label });
  /* A person filed this by hand, so a pending #335 suggestion must not file it somewhere else later (Approve-all, a
     sender-rule sweep, archive-on-reply). Skip is the inbox-org writer for exactly this decision: a `suggested` filing
     becomes `skipped` and the skip is logged; a thread with no suggestion, or one already filed / dismissed / skipped,
     answers not-suggested and is left alone. Best effort — the filing itself has already succeeded. */
  try {
    await skipFiling(t.id, by);
  } catch (err) {
    console.error("[vendor-quotes] pending filing suggestion not skipped", t.id, err);
  }
  let partyAdded = false;
  if (vendorCompanyId) {
    try {
      const r = await addParty({ recordType: target.type, recordId: target.id, companyId: vendorCompanyId, role: "vendor" }, by.id);
      if (r.ok) partyAdded = !r.existed;
      else console.error("[vendor-quotes] vendor party not added on filing", target, vendorCompanyId, r.error);
    } catch (err) {
      console.error("[vendor-quotes] vendor party not added on filing", target, vendorCompanyId, err);
    }
  }
  return { ok: true, label, partyAdded };
}

const linkCond = (type: string, id: string | null | undefined): DocCond =>
  id ? { all: [{ path: ["link", "type"], is: type }, { path: ["link", "id"], is: id }] } : { any: [] };

export async function vendorThreadsFor(
  records: { quoteId?: string | null; projectId?: string | null },
  vendorCompanyIds: ReadonlySet<string>,
  viewer: MailboxViewer
): Promise<VendorThreadVM[]> {
  if (!vendorCompanyIds.size || (!records.quoteId && !records.projectId)) return [];
  const rows = await listDocsWhere<CommThread & Doc>(
    "comms",
    { all: [{ any: [linkCond("quote", records.quoteId), linkCond("project", records.projectId)] }, canSeeThreadCond(viewer), { path: ["status"], isNot: "draft" }] },
    { limit: 200 }
  );
  return rows.filter((t) => canSeeThread(t, viewer) && isListedVendorThread(t, vendorCompanyIds)).map((t) => vendorThreadRow({ ...t, customerId: t.customerId as string }));
}

export async function loadVendorsPanel(
  input: { quoteId: string | null; projectId?: string | null },
  viewer: MailboxViewer
): Promise<{ companies: VendorCompanyVM[]; threads: VendorThreadVM[]; vendorQuotes: VendorQuoteLike[] }> {
  const quote = input.quoteId ? await getQuote(input.quoteId) : null;
  const vendorQuotes = asVendorQuotes((quote as { vendorQuotes?: unknown } | null)?.vendorQuotes);
  const [qParties, pParties] = await Promise.all([
    input.quoteId ? listFor("quote", input.quoteId) : Promise.resolve([]),
    input.projectId ? listFor("project", input.projectId) : Promise.resolve([]),
  ]);
  const ids = new Set<string>();
  for (const p of [...qParties, ...pParties]) if (p.role === "vendor") ids.add(p.companyId);
  for (const id of vendorCompanyIdsOf(vendorQuotes)) ids.add(id);
  const names = await getCompanies([...ids]);
  const companies: VendorCompanyVM[] = [...ids].map((id) => ({ id, name: names.get(id)?.name || id, href: `/companies/${encodeURIComponent(id)}` }));
  const threads = await vendorThreadsFor({ quoteId: input.quoteId, projectId: input.projectId ?? null }, ids, viewer);
  return { companies, threads, vendorQuotes };
}
