/* #348 slice 2b-i — pure addressee helpers. Browser-safe: imports only ./bids (and types), no stores. */
import { bidDueText, type QuoteBid } from "./bids";

export type DocAddressee = { companyName: string; contactName: string; contactRole: string; ownerName: string; bidLine: string };

/** "Bid due Oct 21, 2:00 PM · Addenda acknowledged: 1, 2" — either half omitted when empty. */
export function bidDocLine(bid: QuoteBid | null | undefined): string {
  if (!bid) return "";
  const parts: string[] = [];
  const due = typeof bid.dueAt === "number" ? bidDueText(bid.dueAt) : "";
  if (due) parts.push(`Bid due ${due}`);
  const nos = (bid.addenda || []).map((a) => a.no).sort((a, b) => a - b);
  if (nos.length) parts.push(`Addenda acknowledged: ${nos.join(", ")}`);
  return parts.join(" · ");
}

/**
 * #348 2b-ii (D1087) — the owner's Rewards (purchase-perks line, credit note) print only on the OWNER's copy: a
 * document addressed to a bidder (explicit, or the awarded default) hides them — the owner's loyalty standing is private.
 */
export function rewardsVisibleFor(addressee: DocAddressee | null | undefined): boolean {
  return !addressee;
}

const UNSAFE = /[\/\\:*?"<>|\u0000-\u001f\u007f]/g;
function namePart(s: string): string {
  return (s || "").replace(UNSAFE, "").replace(/\s+/g, " ").trim().slice(0, 60).trim();
}

/** `Peak – <project> – <bidder> – Rev <n>.pdf`; an empty project/bidder part is omitted. */
export function bidderPdfFileName(projectName: string, bidderName: string, rev: number, draft = false): string {
  const parts = ["Peak", namePart(projectName), namePart(bidderName), `Rev ${rev}${draft ? " (draft)" : ""}`].filter(Boolean);
  return `${parts.join(" – ")}.pdf`;
}

type HeaderBase = { custName: string; hasAttn: boolean; attnLine: string };

export function addressedHeader(
  base: HeaderBase,
  a: DocAddressee | null
): { custName: string; hasAttn: boolean; attnLine: string; ownerLine: string; bidLine: string } {
  if (!a) return { ...base, ownerLine: "", bidLine: "" };
  return {
    custName: a.companyName,
    hasAttn: !!a.contactName,
    attnLine: a.contactName + (a.contactRole ? " · " + a.contactRole : ""),
    ownerLine: a.ownerName ? "Owner: " + a.ownerName : "",
    bidLine: a.bidLine,
  };
}

/** "Owner: Acme ISD" → "Acme ISD" (the cover's Owner row and the package page's meta read the document's ownerLine). */
export function ownerNameFromLine(ownerLine: string | null | undefined): string {
  const l = (ownerLine || "").trim();
  return l.startsWith("Owner: ") ? l.slice("Owner: ".length).trim() : "";
}

/** Send & track's To + greeting name: the awarded bidder's contact when it has an email, else the owner's contact. */
export function sendDefaultsContact(
  recipient: { name: string; firstName: string; email: string } | null,
  owner: { name: string; email: string }
): { contactName: string; contactEmail: string } {
  if (recipient && recipient.email.trim()) return { contactName: recipient.firstName || recipient.name, contactEmail: recipient.email.trim() };
  return { contactName: owner.name, contactEmail: owner.email };
}
