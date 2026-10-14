/**
 * #345 — Organize's entry points in the Inbox, pure (server builds the VM,
 * the client bar reads it; test-inbox-org drives it):
 *
 *  - the tab row above the list — Inbox · Organize (N) · Noise (N) — on the
 *    plain inbox and inside Organize;
 *  - the banner on the plain inbox — "AI has filing suggestions for N emails
 *    — Review" (pilot users with Inbox organization on; everyone else reads
 *    "N emails have filing suggestions") — dismissed for the browser session
 *    and back when the To file count grows past the dismissed count.
 *
 * Both are shown only when Organize is available — the same rule as the view
 * itself: every signed-in user has it (rule filing runs for everyone, D884–
 * D889), unless `INBOX_ORG_DISABLED=true` (D900) — then neither shows; the
 * sidebar row and the narrow picker entry stay as they were.
 */
import { ORGANIZE_BASE_HREF, organizeHref, type OrganizeTab } from "./format";

export type EntryTabKey = "inbox" | "organize" | "noise";

export type OrganizeEntryTab = {
  key: EntryTabKey;
  label: string;
  /** null = no count shown (Inbox) */
  count: number | null;
  href: string;
  active: boolean;
};

export type OrganizeBannerVM = { count: number; text: string; href: string };

export type OrganizeEntryVM = {
  tabs: OrganizeEntryTab[];
  /** only on the plain inbox, with something to file */
  banner: OrganizeBannerVM | null;
};

/** The plain inbox's own link (the personal Inbox folder). */
export const INBOX_HREF = "/inbox";
export const ORGANIZE_TO_FILE_HREF = organizeHref(ORGANIZE_BASE_HREF, "to-file");
export const ORGANIZE_NOISE_HREF = organizeHref(ORGANIZE_BASE_HREF, "noise");
/** Where the brief's "Organize my inbox" lands: To file, with the button called out. */
export const ORGANIZE_CLEANUP_HREF = `${ORGANIZE_TO_FILE_HREF}&cleanup=1`;

/** Where the person is: the plain inbox, an Organize tab, or anywhere else
 *  (Sent, Drafts, a smart view, Meetings — no tab row there). */
export type EntryWhere = { kind: "inbox" } | { kind: "organize"; tab: OrganizeTab } | { kind: "other" };

export function emailsLabel(n: number): string {
  return `${n} email${n === 1 ? "" : "s"}`;
}

export function bannerText(count: number, ai: boolean): string {
  return ai ? `AI has filing suggestions for ${emailsLabel(count)}` : `${emailsLabel(count)} ${count === 1 ? "has" : "have"} filing suggestions`;
}

export function organizeEntryVM(input: {
  /** Organize is available to this user (see the header) */
  available: boolean;
  /** Assist pilot with Inbox organization (`file`) on — the banner says "AI" */
  ai: boolean;
  toFile: number;
  noise: number;
  where: EntryWhere;
}): OrganizeEntryVM | null {
  if (!input.available || input.where.kind === "other") return null;
  const toFile = Math.max(0, Math.floor(input.toFile || 0));
  const noise = Math.max(0, Math.floor(input.noise || 0));
  const w = input.where;
  const tabs: OrganizeEntryTab[] = [
    { key: "inbox", label: "Inbox", count: null, href: INBOX_HREF, active: w.kind === "inbox" },
    { key: "organize", label: "Organize", count: toFile, href: ORGANIZE_TO_FILE_HREF, active: w.kind === "organize" && w.tab !== "noise" },
    { key: "noise", label: "Noise", count: noise, href: ORGANIZE_NOISE_HREF, active: w.kind === "organize" && w.tab === "noise" },
  ];
  const banner = w.kind === "inbox" && toFile > 0 ? { count: toFile, text: bannerText(toFile, input.ai), href: ORGANIZE_TO_FILE_HREF } : null;
  return { tabs, banner };
}

/** sessionStorage key: the To file count the banner was dismissed at. */
export const BANNER_DISMISS_KEY = "peak-organize-banner-dismissed";

/** A stored dismissal (a count) — anything unreadable is "never dismissed". */
export function parseDismissed(raw: string | null | undefined): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

/** Shown until dismissed; after a dismissal, only once the count has grown past it. */
export function bannerShows(count: number, dismissedAt: number | null): boolean {
  if (count <= 0) return false;
  return dismissedAt == null || count > dismissedAt;
}

/** The pill look the Organize box's own To file · Noise · Filed tabs use — accent from `--accent`. */
export const ACCENT_SOFT = "color-mix(in srgb, var(--accent) 12%, #fff)";
export const ACCENT_INK = "color-mix(in srgb, var(--accent) 68%, #000)";
