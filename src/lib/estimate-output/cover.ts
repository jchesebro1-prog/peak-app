import type { QuoteDocumentProps } from "@/app/(app)/estimator/quote-document";
import { fmt } from "@/app/(app)/estimator/pricing";
import type { OnlineEstimateState, ShareLinkView } from "@/lib/quote-share/view";
import { addOptions, coverSummaryText, coverTotals, notIncludedLine, outputScopes, scopePriceLabel } from "./scopes";

/**
 * #301 slice A — the cover PDF's props (spec §4), built from the customer
 * document's own props so prices and totals can't drift (R1, R20). Pure;
 * the server loader (cover-loader.ts) supplies the signer, footer, link and
 * letterhead.
 */

export type CoverSigner = { name: string; title: string; phone: string; email: string };
export type CoverUser = { name: string; title?: string | null; phone?: string | null; mobile?: string | null; email?: string | null };
export type CoverOffice = { street?: string; city?: string; state?: string; zip?: string; phone?: string; quoteDefault?: boolean };

export const COVER_DEFAULT_TITLE = "Estimate Summary";
export const COVER_LINK_LEAD = "View the full estimate online:";

export type CoverDocumentProps = {
  title: string;
  letterhead: { src: string; full: boolean };
  companyName: string;
  footerLine: string;
  project: { customer: string; attn: string; venue: string; project: string; number: string; date: string };
  scopes: Array<{ id: string; text: string; missing: boolean; priceLabel: string }>;
  summary: string;
  totals: { creditLabel: string | null; creditAmount: string | null; totalLabel: string; total: string; rewardsLine: string; standingLines: string[] };
  options: Array<{ label: string; desc: string; reason: string; price: string }>;
  notIncluded: string;
  shareUrl: string | null;
  signer: CoverSigner | null;
};

export type CoverInput = {
  doc: QuoteDocumentProps;
  coverSummary: string;
  notIncluded: string;
  signer: CoverSigner | null;
  footerLine: string;
  shareUrl: string | null;
  letterhead: { src: string; full: boolean };
};

const norm = (s: string | null | undefined) => (s || "").trim().toLowerCase();

/** R16: owner, else Prepared by — exact case-insensitive name, unique only. */
export function resolveCoverSigner(owner: string | null | undefined, preparedBy: string | null | undefined, users: CoverUser[]): CoverSigner | null {
  const find = (name: string | null | undefined) => {
    const n = norm(name);
    if (!n) return null;
    const hits = users.filter((u) => norm(u.name) === n);
    return hits.length === 1 ? hits[0] : null;
  };
  const u = find(owner) ?? find(preparedBy);
  if (!u) return null;
  return { name: u.name.trim(), title: (u.title || "").trim(), phone: (u.phone || "").trim() || (u.mobile || "").trim(), email: (u.email || "").trim() };
}

/** R17: company · street, city, ST zip · office phone · website (blanks drop out). */
export function coverFooterLine(input: { companyName: string; offices?: CoverOffice[]; website?: string }): string {
  const offices = input.offices || [];
  const o = offices.find((x) => x.quoteDefault) || offices[0];
  const stateZip = o ? [o.state, o.zip].map((s) => (s || "").trim()).filter(Boolean).join(" ") : "";
  const cityLine = o ? [o.city || "", stateZip].map((s) => s.trim()).filter(Boolean).join(", ") : "";
  const address = o ? [o.street || "", cityLine].map((s) => s.trim()).filter(Boolean).join(", ") : "";
  return [input.companyName, address, o?.phone || "", input.website || ""].map((s) => (s || "").trim()).filter(Boolean).join(" · ");
}

/** The cover's link line: the active link's v2 (rev-pinned) path — #301
 *  slice B — else its v1 path (a view built without pathV2), only while the
 *  online page would show the estimate. */
export function coverShareUrl(origin: string | null, link: ShareLinkView | null, state: OnlineEstimateState["kind"]): string | null {
  const path = link ? (link.pathV2 ?? link.path) : null;
  if (!origin || !link || !link.active || !path || state !== "ok") return null;
  return origin.replace(/\/+$/, "") + path;
}

export function coverPdfFileName(number: string): string {
  return `${(number || "Estimate").replace(/[^A-Za-z0-9 _-]/g, "_")} Cover.pdf`;
}

const chicagoLong = (ms: number) =>
  new Date(ms).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/Chicago" });

export function coverDocumentPropsFor(input: CoverInput): CoverDocumentProps {
  const d = input.doc;
  const scopes = outputScopes(d);
  const t = coverTotals(d);
  return {
    title: (d.projectName || "").trim() || COVER_DEFAULT_TITLE,
    letterhead: input.letterhead,
    companyName: d.companyName,
    footerLine: input.footerLine,
    project: {
      customer: d.custName,
      attn: d.hasAttn ? d.attnLine : "",
      venue: d.venueLabel,
      project: d.projectName,
      number: `${d.quoteId} Rev ${d.revNum}`,
      date: chicagoLong(d.revDateMs),
    },
    scopes: scopes.map((s) => ({ id: s.id, text: s.cover.text, missing: s.cover.source === "missing", priceLabel: `${scopePriceLabel(s.name)}: ${fmt(s.price)}` })),
    summary: coverSummaryText(input.coverSummary, scopes.map((s) => s.name)),
    totals: {
      creditLabel: t.creditLabel,
      creditAmount: t.credit > 0 ? "−" + fmt(t.credit) : null,
      totalLabel: t.totalLabel,
      total: fmt(t.total),
      rewardsLine: t.rewardsLine,
      standingLines: t.standingLines,
    },
    options: addOptions(d).map((o) => ({ label: o.label, desc: o.desc, reason: o.reason, price: fmt(o.price) })),
    notIncluded: notIncludedLine(input.notIncluded),
    shareUrl: input.shareUrl,
    signer: input.signer,
  };
}
