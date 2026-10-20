/**
 * Estimator handoff — every remaining out-of-scope server action the Estimator's client tree imports,
 * registered explicitly so none is ever an "unregistered" call: bids, bid sends, client links (share),
 * vendor quotes from email, vendor-PDF reading, the vendors directory, Assist, the Grid design link,
 * parties, Rewards, the Inbox link popup and the Quotes hub's package / revision forms.
 *
 * Each is one of:
 *   - **refused** — NOT_IN_PROTOTYPE (`{ ok: false, error }`) plus one console.warn per name. The type
 *     `RefusableKey` only admits an action whose original result type has an `{ ok: false; error: string }`
 *     member, so every caller already handles the refusal (tsc enforces it).
 *   - **form refusal** — the Quotes hub's `<form action>` writers return void; they warn and return nothing.
 *   - **shape-valid empty** — the original's own "empty / not applicable" success, for an action a mounted
 *     component calls (or whose result type has no refusal member, so a refusal would break its caller).
 *     Each says why, against the consuming component. All are type-enforced (`Impl<A, K>`) against the
 *     original's signature.
 * Plan: PR 2 Task 6.
 */
import type * as BidActions from "@/app/(app)/estimator/bid-actions";
import type * as BidSendActions from "@/app/(app)/estimator/bid-send-actions";
import type * as ShareActions from "@/app/(app)/estimator/share-actions";
import type * as VendorActions from "@/app/(app)/estimator/vendor-actions";
import type * as VendorPdfActions from "@/app/(app)/estimator/vendor-pdf-actions";
import type * as VendorsDirActions from "@/app/(app)/vendors/actions";
import type * as AssistActions from "@/app/(app)/estimator/assist-actions";
import type * as GridDesignActions from "@/app/(app)/estimator/grid-design-actions";
import type * as PartiesActions from "@/app/(app)/parties/actions";
import type * as RewardsActions from "@/app/(app)/rewards/actions";
import type * as LinkPopupActions from "@/app/(app)/inbox/link-popup-actions";
import type * as QuotesHubActions from "@/app/(app)/quotes/actions";
import { emptyLinkTargets } from "@/lib/inbox-link-targets";
import { bidDueText, currentRev } from "@/lib/parties/bids";
import { sentRevisionRows, viewedStamp } from "@/lib/quote-share/package-view";
import { ONLINE_COPY, shareEligibility } from "@/lib/quote-share/view";
import { can } from "@/lib/team";
import { asVendorQuotes, vendorCompanyIdsOf } from "@/lib/vendor-quotes/rules";
import { NOT_IN_PROTOTYPE, type ActionImpl } from "../actions-registry";
import type { HandoffStore } from "../store";
import { customers, users } from "../ports";
import { quoteRepo } from "../quote-repo";
import type { Impl } from "./util";

export const BID_ACTIONS_KEY = "src/app/(app)/estimator/bid-actions.ts";
export const BID_SEND_ACTIONS_KEY = "src/app/(app)/estimator/bid-send-actions.ts";
export const SHARE_ACTIONS_KEY = "src/app/(app)/estimator/share-actions.ts";
export const VENDOR_ACTIONS_KEY = "src/app/(app)/estimator/vendor-actions.ts";
export const VENDOR_PDF_ACTIONS_KEY = "src/app/(app)/estimator/vendor-pdf-actions.ts";
export const VENDORS_DIR_ACTIONS_KEY = "src/app/(app)/vendors/actions.ts";
export const ASSIST_ACTIONS_KEY = "src/app/(app)/estimator/assist-actions.ts";
export const GRID_DESIGN_ACTIONS_KEY = "src/app/(app)/estimator/grid-design-actions.ts";
export const PARTIES_ACTIONS_KEY = "src/app/(app)/parties/actions.ts";
export const REWARDS_ACTIONS_KEY = "src/app/(app)/rewards/actions.ts";
export const LINK_POPUP_ACTIONS_KEY = "src/app/(app)/inbox/link-popup-actions.ts";
export const QUOTES_HUB_ACTIONS_KEY = "src/app/(app)/quotes/actions.ts";

type Refusal = { ok: false; error: string };
/** The actions of module M whose original result type admits a refusal (`{ ok: false; error: string }`). */
export type RefusableKey<M> = { [K in keyof M]: M[K] extends (...a: never[]) => Promise<infer R> ? (Refusal extends R ? K : never) : never }[keyof M];
/** The actions of module M that resolve to void (`<form action>` writers). */
type VoidKey<M> = { [K in keyof M]: M[K] extends (...a: never[]) => Promise<infer R> ? ([R] extends [void] ? K : never) : never }[keyof M];

const warned = new Set<string>();
function warnOnce(name: string): void {
  if (warned.has(name)) return;
  warned.add(name);
  console.warn(`[handoff] ${name} is not in the prototype`);
}

/** Explicit refusals for module M's `names` — each must be refusable (tsc). */
function refusals<M>(names: readonly RefusableKey<M>[]): Record<string, ActionImpl> {
  return Object.fromEntries(
    names.map((n) => [
      n,
      () => {
        warnOnce(String(n));
        return { ...NOT_IN_PROTOTYPE };
      },
    ]),
  );
}

/** `<form action>` writers that resolve to void: warn and do nothing. */
function formRefusals<M>(names: readonly VoidKey<M>[]): Record<string, ActionImpl> {
  return Object.fromEntries(
    names.map((n) => [
      n,
      async () => {
        warnOnce(String(n));
      },
    ]),
  );
}

/* ------------------------------------------------------------------ the refused names, per module (compile-checked) */

export const REFUSED_BID_ACTIONS = ["setBidDetailsAction", "addBidderAction", "updateBidderAction", "markSubmittedAction", "awardBidAction", "undoAwardAction"] as const satisfies readonly RefusableKey<typeof BidActions>[];
export const REFUSED_BID_SEND_ACTIONS = ["bidderEmailDefaultsAction", "bidderLinkAction"] as const satisfies readonly RefusableKey<typeof BidSendActions>[];
export const REFUSED_SHARE_ACTIONS = ["getShareLinkAction", "revokeShareLinkAction"] as const satisfies readonly RefusableKey<typeof ShareActions>[];
export const REFUSED_VENDOR_ACTIONS = ["vendorQuoteFromThreadAction"] as const satisfies readonly RefusableKey<typeof VendorActions>[];
export const REFUSED_VENDORS_DIR_ACTIONS = [
  "setCatalogOwnerAction", "createVendorAction", "claimManufacturerAction", "saveVendorProfileAction", "logPriceListAction", "setContactRoleAction",
  "removeVendorProfileAction", "releaseManufacturerAction",
] as const satisfies readonly RefusableKey<typeof VendorsDirActions>[];
export const REFUSED_ASSIST_ACTIONS = ["dismissAssistDraftAction"] as const satisfies readonly RefusableKey<typeof AssistActions>[];
export const REFUSED_GRID_DESIGN_ACTIONS = ["openGridDesignForQuoteAction"] as const satisfies readonly RefusableKey<typeof GridDesignActions>[];
export const REFUSED_PARTIES_ACTIONS = ["addPartyAction", "setPartyContactAction", "removePartyAction"] as const satisfies readonly RefusableKey<typeof PartiesActions>[];
export const REFUSED_REWARDS_ACTIONS = [
  "approveRewardAction", "dismissRewardAction", "postStartingCreditAction", "postAllStartingCreditAction", "postAdjustmentAction", "markPerkUsedAction",
  "undoPerkUseAction", "redeemPerkAction", "fulfilPerkAction",
] as const satisfies readonly RefusableKey<typeof RewardsActions>[];
export const REFUSED_LINK_POPUP_ACTIONS = ["linkPopupDataAction", "fetchMessageCcAction", "setThreadContactsAction", "fillContactBlanksAction"] as const satisfies readonly RefusableKey<typeof LinkPopupActions>[];
/** The Quotes hub's package / revision forms (Task 4 registered setQuoteStatus and deleteQuoteAction). */
export const REFUSED_QUOTES_HUB_FORMS = ["createQuoteClientPackageAction", "saveQuoteRevisionAction", "restoreQuoteRevisionAction"] as const satisfies readonly VoidKey<typeof QuotesHubActions>[];

/* ------------------------------------------------------------------ the shape-valid answers */

type BidPanelOk = Extract<Awaited<ReturnType<typeof BidActions.bidPanelAction>>, { ok: true }>["panel"];

/**
 * bid-panel-server.ts loadBidPanel with no bidders (parties aren't in the prototype): the quote's own bid
 * header (due date, addenda, award) as stored, no rows, no candidates, and every write off (canEdit / canSend /
 * canCopyLink false). Pure.
 */
export function emptyBidPanel(q: { id: string; status: string; customer?: string | null; revisions?: unknown[] | null; bid?: { dueAt?: number | null; addenda?: BidPanelOk["addenda"]; awardedPartyId?: string | null } | null }): BidPanelOk {
  const dueAt = q.bid?.dueAt ?? null;
  return {
    quoteId: q.id,
    status: q.status,
    ownerName: q.customer || "",
    rev: currentRev(q),
    dueAt,
    dueText: dueAt ? bidDueText(dueAt) : "",
    addenda: q.bid?.addenda ?? [],
    awardedPartyId: q.bid?.awardedPartyId ?? null,
    bidders: [],
    candidates: [],
    canEdit: false,
    canAward: false,
    canUndo: false,
    canSend: false,
    canCopyLink: false,
    plan: { ids: [], label: null, noEmail: 0 },
    addendaAfterSend: [],
    scopeOnly: false,
  };
}

export function miscActions(store: HandoffStore): Record<string, Record<string, ActionImpl>> {
  const repo = quoteRepo(store);

  // BiddersCard (Send & track) and the header's Bid chip load the panel on mount. A refusal shows the card's
  // red error line; the empty panel is the app's own "Bidders · Not a bid" one-liner with no Add (canEdit false).
  const bidPanelAction: Impl<typeof BidActions, "bidPanelAction"> = async (quoteId) => {
    const q = typeof quoteId === "string" && quoteId ? await repo.get(quoteId) : null;
    if (!q) return { ok: false, error: "That estimate wasn't found." };
    return { ok: true, panel: emptyBidPanel(q) };
  };

  // ClientLinkPanel (Send & track's Client link card) reads its status on mount and on every focus; a refusal
  // leaves it reading "Not available in the prototype" in place of the card. share-links.ts shareLinkStatus with
  // no share secret (no links can be minted offline): the online state, the viewer's Send permission, no link,
  // the sent revisions and the last open. Copy client link then refuses (getShareLinkAction → NOT_IN_PROTOTYPE).
  const shareLinkStatusAction: Impl<typeof ShareActions, "shareLinkStatusAction"> = async (quoteId) => {
    const q = await repo.get(String(quoteId || ""));
    if (!q) return { ok: false, error: ONLINE_COPY.gone };
    return { ok: true, status: { state: shareEligibility(q), canSend: can("send", users.current().roles), link: null, sentRevs: sentRevisionRows(q), viewed: viewedStamp(q) } };
  };

  // VendorsCard (Build package → BOM quote, Send & track) reads it on mount and SETS `companies` / `threads` from
  // it; a refusal hides the vendor names. threads-server.ts loadVendorsPanel over the prototype: the vendor
  // companies the quote's own vendor quotes name (no parties), named from the customer port (else the id, as
  // the original), and no threads (no Inbox).
  const vendorsPanelAction: Impl<typeof VendorActions, "vendorsPanelAction"> = async (quoteId) => {
    if (typeof quoteId !== "string" || !quoteId) return { ok: false, error: "That estimate wasn't found." };
    const q = await repo.get(quoteId);
    const ids = vendorCompanyIdsOf(asVendorQuotes((q as { vendorQuotes?: unknown } | null)?.vendorQuotes));
    const companies = ids.map((id) => {
      const c = customers.resolve(id);
      return { id, name: (c && c.id === id && c.name) || id, href: `/companies/${encodeURIComponent(id)}` };
    });
    return { ok: true, companies, threads: [] };
  };

  // The Parties chip (Estimator header) loads the list on mount and shows its length; the original's type is the
  // list itself (PartyVM[], not `{ ok, parties }`), so the shape is `[]` — "Parties · 0". Adding refuses.
  const listPartiesAction: Impl<typeof PartiesActions, "listPartiesAction"> = async () => [];
  // PartiesEditor (inside the chip's dialog) lists a company's contacts — the original answers a list (no
  // refusal member), so a refusal would break `setContactsFor`; [] = no contacts.
  const companyContactsAction: Impl<typeof PartiesActions, "companyContactsAction"> = async () => {
    warnOnce("companyContactsAction");
    return [];
  };

  // use-estimator-state reads the customer's Rewards credit on mount once the estimate has a customer, and the
  // service-credit panel does too. Rewards is off in the prototype: the original's own program-off answer.
  const rewardCreditInfoAction: Impl<typeof RewardsActions, "rewardCreditInfoAction"> = async () => ({
    enabled: false,
    balance: 0,
    available: 0,
    purchasePerks: "",
    purchasePerksDocLine: "",
  });
  // PurchasePerksBanner: the original answers the banner text (a string — no refusal member); "" = no banner.
  const purchasePerksBannerAction: Impl<typeof RewardsActions, "purchasePerksBannerAction"> = async () => "";

  // VendorCompanyField's search (vendor-quote modal): the original answers the hit list (no refusal member);
  // [] = no hits. The vendors directory isn't in the prototype.
  const searchVendorCompaniesAction: Impl<typeof VendorsDirActions, "searchVendorCompaniesAction"> = async () => {
    warnOnce("searchVendorCompaniesAction");
    return [];
  };
  // CompanySearch (Parties / Bidders add) reads `.companies` off the groups (no refusal member); the original's
  // own empty answer.
  const searchLinkTargetsAction: Impl<typeof LinkPopupActions, "searchLinkTargetsAction"> = async () => {
    warnOnce("searchLinkTargetsAction");
    return emptyLinkTargets();
  };

  // Refusals whose original refusal member carries more than `{ ok, error }` — still refusals, in that shape.
  // A bidder row's send (no bidders exist here, so the Bidders card never offers it): `partyId` + `scope`.
  const sendToBidderAction: Impl<typeof BidSendActions, "sendToBidderAction"> = async (_quoteId, partyId) => {
    warnOnce("sendToBidderAction");
    return { ...NOT_IN_PROTOTYPE, partyId: String(partyId || ""), scope: "quote" };
  };
  // Read the PDF (vendor-quote modal): `runId` null — no Read-the-PDF run was started.
  const readVendorPdfAction: Impl<typeof VendorPdfActions, "readVendorPdfAction"> = async () => {
    warnOnce("readVendorPdfAction");
    return { ...NOT_IN_PROTOTYPE, runId: null };
  };

  return {
    [BID_ACTIONS_KEY]: { ...refusals<typeof BidActions>(REFUSED_BID_ACTIONS), bidPanelAction },
    [BID_SEND_ACTIONS_KEY]: { ...refusals<typeof BidSendActions>(REFUSED_BID_SEND_ACTIONS), sendToBidderAction },
    [SHARE_ACTIONS_KEY]: { ...refusals<typeof ShareActions>(REFUSED_SHARE_ACTIONS), shareLinkStatusAction },
    [VENDOR_ACTIONS_KEY]: { ...refusals<typeof VendorActions>(REFUSED_VENDOR_ACTIONS), vendorsPanelAction },
    [VENDOR_PDF_ACTIONS_KEY]: { readVendorPdfAction },
    [VENDORS_DIR_ACTIONS_KEY]: { ...refusals<typeof VendorsDirActions>(REFUSED_VENDORS_DIR_ACTIONS), searchVendorCompaniesAction },
    [ASSIST_ACTIONS_KEY]: refusals<typeof AssistActions>(REFUSED_ASSIST_ACTIONS),
    [GRID_DESIGN_ACTIONS_KEY]: refusals<typeof GridDesignActions>(REFUSED_GRID_DESIGN_ACTIONS),
    [PARTIES_ACTIONS_KEY]: { ...refusals<typeof PartiesActions>(REFUSED_PARTIES_ACTIONS), listPartiesAction, companyContactsAction },
    [REWARDS_ACTIONS_KEY]: { ...refusals<typeof RewardsActions>(REFUSED_REWARDS_ACTIONS), rewardCreditInfoAction, purchasePerksBannerAction },
    [LINK_POPUP_ACTIONS_KEY]: { ...refusals<typeof LinkPopupActions>(REFUSED_LINK_POPUP_ACTIONS), searchLinkTargetsAction },
    [QUOTES_HUB_ACTIONS_KEY]: formRefusals<typeof QuotesHubActions>(REFUSED_QUOTES_HUB_FORMS),
  };
}
