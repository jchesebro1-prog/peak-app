"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { boxSaleLaborSystems, boxSaleSaveProblem, isBoxSaleQuoteType, isBoxSaleSource, newSystemPresentation } from "@/lib/estimate-box-sale/rules";
import { SIDE_OPEN_KEY } from "./estimator-styles";
import { surveyGoalsAction } from "./output-actions";
import { listReviewCommentsAction } from "./review-actions";
import type { ReviewComment } from "@/lib/estimate-review/comments";
import { fillClientGoals } from "@/lib/estimate-output/goals";
import { addGroup, groupBlocks, moveGroupBy, moveSystemBy, moveSystemTo, newGroupId, normalizeSystemOrder, removeGroup, renameGroup, setGroupAlternate, unmarkEdited, withoutBuilt, type SystemGroup } from "@/lib/estimate-groups/groups";
import type { Dispatch, SetStateAction } from "react";
import type { QuoteStatus } from "@/lib/stores/quotes";
import type { QuoteNextStepView } from "@/lib/quote-next-step";
import type { NextStepSync } from "@/app/(app)/quotes/review-actions";
import { carriesPipeline, firstStage, stageById } from "@/lib/pipelines";
import { saveBonusAlternatesAction, saveBonusSplitAction, draftQuoteScopeAction, copySystemToEstimateAction, moveSystemToEstimateAction, resolveCatalogSkusAction, resolveTierAction, saveQuoteAction, searchQuotesAction, setQuotePipelineAction, setQuoteStageAction, setQuotePeopleAction, setStatusAction, travelForSelectionAction, updateQuoteMetaAction, type CopySystemTarget, type MoveSystemTarget, type ReviewSync, type StageSync } from "./actions";
import { rewardCreditInfoAction, type RewardCreditInfo } from "@/app/(app)/rewards/actions";
import { isBonusItem } from "@/lib/estimate-bonus/flags";
import { defaultAlternatesTaken, normalizeSplit, type BonusRecord, type BonusSplit } from "@/lib/estimate-bonus/record";
import { useRouter } from "next/navigation";
import { bonusRatesFor, bonusRulesApply, isBonusEligibleQuote, withBonusLines } from "@/lib/estimate-bonus/rules";
import { applyProjectDiscounts, parseDiscountPct, projectDiscountsKey, PROJECT_DISCOUNT_NOTE_MAX, type ProjectDiscounts } from "@/lib/project-discounts/rules";
import { isRewardCreditItem, rewardCreditOf, withoutRewardCredit, withRewardCredit } from "@/lib/rewards/credit-line";
import type { WonEditField } from "@/app/(app)/quotes/new/handoff";
import type { DraftedLine } from "./ai-scope-modal";
import { DISC_LABEL, type SuggestPart } from "./estimator-data";
import { backSolveExtSell, priceFromUnitSellEdit, repriceAtMarkup, buildLaborItems, computeCurtain, computeLabor, lineMarkupOf, makeLaborRate, repricedAtLineMarkup, round2, clearSellOverride, parseSellOverride, SYSTEM_PRICE_STEP, systemSellTotal, totals, vendorTotalSeed, withPriceRound } from "./pricing";
import type { PdfToggle } from "./preview-doc";
import { vendorAttachmentLoad, type CurtainDraft, type CustomDraft, type EstimatorProps, type FixtureDraft, type LaborDraft, type MobDraft, type SpecItem, type SpecMob, type SpecSection, type TrackDraft, type TravelLite, type VendorDraft, type VendorLineDraft, type VendorPdfFormState, type VendorQuote } from "./types";
import { vendorQuoteFromThreadAction } from "./vendor-actions";
import { VENDOR_COPY, isPdfAttachment } from "@/lib/vendor-quotes/rules";
import { readVendorPdfAction } from "./vendor-pdf-actions";
import { VENDOR_PDF_COPY } from "@/lib/vendor-pdf/extraction";
import { applyVendorPdfRead, dropVendorPdfRead, readLinesEdited, undoVendorPdfRead } from "@/lib/vendor-pdf/fill";
import { sectionFreightDefault, applyAutoFreight } from "./freight-default";
import { fixtureBomLine } from "./fixture-bom";
import { applyAutoTrips as applyAutoTripsToMobs, applyLocalTrip, applyMobType, applyTravelTripTo, defaultLaborMobs, disciplineForSystemTitle, laborMob, roundTripMiles, typeMobMiles, setRouteMiles } from "./labor-defaults";
import { laborGroupEdits, laborGroupRecord, newLaborGroupId, pruneLaborGroups, snapshotLaborDraft, withLaborGroup } from "./labor-group";
import type { QuotePdfOptions } from "@/lib/quote-pdf/pdf-options";
import { excludeRefusal, normalizePackageSelection, selectionKey, type PackageSelection } from "@/lib/estimate-output/package-selection";
import type { QuotePdfView } from "@/lib/quote-pdf/state";
import type { PackageDoc } from "@/lib/package-doc/types";
import { docIdFloor } from "@/lib/package-doc/ids";
import { reanchorDocLine, reanchorPackageDoc } from "@/lib/package-doc/reanchor";
import { PACKAGE_DOC_TOO_LARGE } from "@/lib/package-doc/save";
import { docProductSkus } from "@/lib/package-doc/text";
import { pdfDocKey, withSavedMeta, type PdfDocKeyInput } from "./pdf-doc-key";
import { saveEstimatorCustomPartAction } from "./actions";
import type { InputKind } from "./section-card";
import { useKeyProductLibrary } from "./use-key-product-library";
import { memberAliases } from "@/lib/quote-line-members";
import { fillEmptyKeyProductText, isKeyProductEligible, isLineToken, keyProductSkuOf, remapKeyProducts, toggleKeyProduct, withKeyProducts } from "./narrative";
import { loadNotice, placeLoadedSection, type LoadedLibrarySystem } from "@/lib/narrative/system-library";
import { curtainSpecKey } from "@/lib/specs/record-keys";
import { parseMoney, type ImportedMaterial } from "./material-csv";
import { partsListSkus, reviewSheetModel, type PartInfo } from "./parts-csv";
import { downloadReviewSheet } from "./review-sheet-xlsx";
import { fileStem } from "../design/export";
import { curtainTrackDraft, curtainTrackPrefill, followCurtainPrefill, freshTrackDraft, replaceTrackLine, trackConfigFromDraft, trackDraftFromConfig, trackLine, type CurtainTrackPrefill } from "./track-bom";
import { customDraftFromLine, isCustomLineEditable, costUntouched, saveCustomEdit, sellUntouched } from "./custom-part-edit";
import { applyCurtainEdit, curtainDraftFromLine, curtainDraftValid, curtainItem } from "./curtain-line";
import { ASSUMED_MOUNT, DEFAULT_BOTTOM_FINISH, DEFAULT_TOP_FINISH } from "@/lib/curtain-cut-sheets/vocab";
import { linkCurtainTracks, newCurtainTrackKey } from "@/lib/curtain-cut-sheets/track-link";
import { countCutSheetTypes } from "@/lib/curtain-cut-sheets/estimator-curtains";
import { vendorDraftTotal, vendorDraftTotalSource, vendorKeptLines, vendorLinesTotal } from "./vendor-quote-modal";
import { systemFromCategory } from "@/lib/system-categories";
import { addedState, itemFromSuggestionLine, systemFromSuggestion } from "@/lib/assist/features/suggestion";
import { defaultSuggestionTarget, sendSuggestionId, suggestPanelFirstRead, suggestPanelKey, suggestPanelOpen, type SuggestionParts } from "@/lib/assist/features/suggestion-panel";
import { catalogAddPrice, customPartSell, repriceForTier, seedMarkupOf } from "./tier-reprice";
import { sellAt } from "@/lib/markup";
import { PRICING_TIER_LABEL, type PricingTier } from "@/lib/identity/config";
import { postChanged } from "@/lib/popout/channel";
import { applyLineMove, extractLinesAsSection, lineRefKey, planLineMove, removeLinesFromSources, type LineRef } from "@/lib/estimate-line-move/move";
import { setUnsavedHold } from "@/lib/popout/hold";
import { discardConfirmText, inputIsDirty, isModalInputKind, MODAL_INPUT_KINDS, rebaseDraft, stableDraftJson, type ModalInputKind } from "@/lib/estimate-steps/discard-confirm";

/** #333 review (F): how long Send waits for an in-flight Client package write. */
const SELECTION_SETTLE_TIMEOUT_MS = 10_000;
const SELECTION_NOT_SAVED = "Couldn't save package choices.";

/** Prototype prop taxRatePct defaulted to 0 — kept as a constant. */
export const TAX_RATE_PCT = 0;

/** #245: freightPct comes from the caller — this runs at module scope (used by
 *  a lazy useState initializer before props are in scope), so it can't read
 *  the freight rule itself. */
const freshSections = (freightPct: number, boxSale = false): SpecSection[] => [
  // #267: a new system's auto price rounds up to the next $25. Box goods sale: Itemized.
  { id: "sys1", name: "New System", kind: "materials", mfr: "", freightPct, freightAuto: true, priceRound: SYSTEM_PRICE_STEP, presentation: newSystemPresentation([], boxSale), items: [] },
];

/** Phase 2a — unmarkEdited, blind to the Rewards credit line. The credit
 *  re-pins to the last system after every reorder; that move is not an edit
 *  to either system, so it must not clear their `built`. */
function unmarkUserEdits(prev: SpecSection[], next: SpecSection[]): SpecSection[] {
  if (!next.some((s) => s.built)) return next;
  const kept = unmarkEdited(withoutRewardCredit(prev), withoutRewardCredit(next));
  let changed = false;
  const out = next.map((s, i) => {
    if (!s.built || kept[i].built) return s;
    changed = true;
    return withoutBuilt(s);
  });
  return changed ? out : next;
}

/** Phase 2a — which systems this person has collapsed on this quote (JSON array of section ids). */
const COLLAPSED_KEY_PREFIX = "quartzite.estimator.collapsed.v1:";

/* ---------------- fresh drafts (prototype defaults) ---------------- */

const freshCustom = (): CustomDraft => ({
  desc: "",
  manufacturer: "",
  manufacturerPartNumber: "",
  vendor: "",
  priceGoodThrough: new Date().toISOString().slice(0, 10),
  link: "",
  allowance: "",
  addToCatalog: "",
  sku: "",
  unit: "ea",
  qty: "1",
  cost: "",
  price: "",
  priceAuto: "1", // #302: Unit sell follows Unit cost until a sell is typed
});

/** #302 — the Unit sell text a cost seeds ("" when the cost isn't above 0). */
const autoSellText = (cost: string) => {
  const sell = customPartSell(parseFloat(cost));
  return sell > 0 ? sell.toFixed(2) : "";
};

const freshCurtain = (fabricSku: string): CurtainDraft => ({
  name: "",
  hang: "Pipe",
  fabric: fabricSku,
  qty: "1",
  height: "",
  width: "",
  fullness: "50",
  bottom: "Chain",
  topFinish: DEFAULT_TOP_FINISH,
  bottomFinish: DEFAULT_BOTTOM_FINISH,
  mountType: ASSUMED_MOUNT,
});

const freshFixture = (): FixtureDraft => {
  return {
    assemblyId: "",
    qty: "1",
    componentQty: {},
    position: "",
    circuit: "",
  };
};

/* Globally unique, NOT from nextId() (#143 re-review). That counter starts at
   100 on every fresh estimate, so the first vendor quote in any two estimates
   was "vq101" in both — and "Move system to another estimate" carries the
   item's vendorQuoteId verbatim, so the moved line would resolve against the
   target's unrelated record and print another vendor's name, file and terms.
   Same reasoning as "sys" + Date.now().

   Minted when the FORM OPENS, not at add time: with Blob storage on the file
   is uploaded under this id before the estimate itself has one, and the id on
   the stored record has to be the same one (see VendorDraft.id). Its shape is
   validated by /api/vendor-quote-attachments/upload — keep them in step. */
const mintVendorQuoteId = () =>
  "vq" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/** A blank vendor-quote form (#143). Display defaults to the single line —
 *  Jeff's "just the Vendor, Quote Number and Description" reading. */
const freshVendor = (): VendorDraft => ({
  id: mintVendorQuoteId(),
  vendor: "",
  quoteNumber: "",
  description: "",
  link: "",
  attachment: null,
  attachmentPreview: null,
  lines: [],
  terms: "",
  notes: "",
  total: "",
  includesFreight: false,
  display: "single",
  vendorCompanyId: null,
  fromThreadId: null,
  extracted: null,
  pdfRead: null,
});

/** #348 slice 5 — Read the PDF, idle. */
const VENDOR_PDF_IDLE: VendorPdfFormState = { busy: null, error: null };
/** Which file a read was for: a result for a replaced (or removed) file is dropped. */
const attKey = (d: VendorDraft) => {
  const a = d.attachment;
  return a ? a.blobPath ?? `${a.dataUrl?.length ?? 0}:${a.name}` : "";
};

const freshLabor = (
  t: TravelLite | null,
  /** Tier-seeded markup fraction (item 11, D87; #367); null → the 43 fallback. */
  tierMargin?: number | null,
  systemTitle = ""
): LaborDraft => ({
  discipline: disciplineForSystemTitle(systemTitle),
  margin: String(Math.round(seedMarkupOf(tierMargin) * 100)),
  mobs: defaultLaborMobs(t),
  pmHrs: "",
  pmAuto: true,
  shopHrs: "",
  drfHrs: "",
  drfAuto: true,
  misc: "",
});

function computeNid(secs: SpecSection[] | null, document?: PackageDoc | null): number {
  // Phase 5: ids the package document still refers to are never reissued.
  let n = Math.max(100, docIdFloor(document));
  (secs || []).forEach((s) => {
    const m = /^sys(\d+)$/.exec(s.id);
    if (m) n = Math.max(n, parseInt(m[1], 10));
    (s.items || []).forEach((it) => {
      if (typeof it.id === "number" && isFinite(it.id)) n = Math.max(n, Math.floor(it.id));
    });
  });
  return n;
}

export const INSTALL_TIMEFRAMES = ["ASAP", "Under 1 month", "1–3 months", "3–6 months", "6–12 months", "TBD"] as const;

export function useEstimatorState(props: EstimatorProps) {
  const {
    initial, pipelines, fabrics, curtainSewingPct, trackSeries, trackParts, laborRates, fixtureRates,
    fixtureAssemblies, vendors, blobUploads, customers, travel, next: initialNext, aiSource, people,
    quoteTasks, templateSets, assumptionLibrary, freightRule, portalStatusError, assistDraft, specKeys, canApplyCredit,
    viewerName, viewerCanApprove, canWriteNarrativeLibrary, narrativeIntros, notIncludedDefault, peopleSentOnce = false, bonusRates,
    suggestion = null, suggestionParts,
  } = props;
  /* ---------------- state (port of the prototype's this.state) ---------------- */
  /** #245: the freight default for THIS load — computed once from the props
   *  the server already seeded (no venue picked yet ⇒ base %; a picked venue
   *  reads its precomputed travel entry, seeded by page.tsx the same way
   *  travelSeen below is). Only used to seed the two initializers below and
   *  the `freightDefault` state (~travel block) — never read after mount. */
  const initialTravelMiles = initial.customerId
    ? travel[initial.customerId + "|" + (initial.locationId || "")]?.miles ?? null
    : travel["name|" + initial.custName]?.miles ?? null;
  const initialFreightDefault = sectionFreightDefault({
    hasVenue: !!initial.locationId,
    miles: initialTravelMiles,
    rule: freightRule,
  });
  /* #267: a draft (or unsaved) estimate's systems round up to the next $25
     from this load on; a sent/won/lost quote keeps its exact prices until a
     system's "Round to $25" is used. A portal-catalog quote is left exact —
     its customer already saw the cart's own total. Not saved until Save. */
  const stampPriceRoundOnLoad = !initial.portal && (!initial.loadedId || initial.status === "draft");
  const [sections, setSectionsState] = useState<SpecSection[]>(() =>
    initial.sections
      ? stampPriceRoundOnLoad
        ? withPriceRound(initial.sections)
        : initial.sections
      : freshSections(initialFreightDefault.pct, initial.boxSale)
  );
  /** #254 — the tier re-price banner: what the stamp just changed, and the
   *  exact sections to put back on Undo. Internal only (D87). */
  const [tierReprice, setTierReprice] = useState<{
    before: SpecSection[];
    repriced: number;
    /** Only hand-priced lines are named; POR / no-cost / fixtures aren't. */
    handPriced: number;
    label: string;
    margin: number;
    /** "· Save to keep" until a Save that started after this re-price
     *  succeeds — the stamp is persisted only with the lines. */
    unsaved: boolean;
    seq: number;
  } | null>(null);
  /** Bumped on every re-price, so a Save only clears the "Save to keep" of
   *  a re-price it actually carried. */
  const tierRepriceSeqRef = useRef(0);
  /** Every user edit to the sections goes through here, so the next edit
   *  clears the #254 banner (its Undo would otherwise restore over it). The
   *  tier re-price itself, Undo, and the automatic freight re-apply write
   *  setSectionsState directly. */
  const setSections: Dispatch<SetStateAction<SpecSection[]>> = (v) => {
    setTierReprice(null);
    // Phase 2a: any edit to a built system other than `built` itself un-marks it.
    setSectionsState((prev) => unmarkUserEdits(prev, typeof v === "function" ? v(prev) : v));
  };
  /** The latest committed sections, read when a tier stamp lands (#254). */
  const sectionsRef = useRef(sections);
  useEffect(() => {
    sectionsRef.current = sections;
  }, [sections]);
  const nidRef = useRef<number | null>(null);
  if (nidRef.current == null) nidRef.current = computeNid(initial.sections, initial.document);
  const nextId = () => ++(nidRef.current as number);
  /** Phase 2a — the quote's named system groups (spec.groups). Sections stay
   *  stored ungrouped-first, then each group in this order (normalizeSystemOrder). */
  const [groups, setGroups] = useState<SystemGroup[]>(initial.groups ?? []);
  /** Estimator Phase 5 — the Build package document (spec.document); null = none.
   *  Rides every Save (null removes it) and the PDF doc key. */
  const [packageDoc, setPackageDocState] = useState<PackageDoc | null>(initial.document ?? null);
  /** Phase 5 fix — the editor holds more than the caps allow (it never emits
   *  that copy), so a Save would only store the last valid document: refuse.
   *  Not cleared when the editor unmounts while over (a step change): Save
   *  keeps refusing until the user returns and shortens the document. */
  const [packageDocOver, setPackageDocOverState] = useState(false);
  /** Phase 5 final fix — synchronous mirrors of the two, so saveNow reads the
   *  editor's pending keystrokes right after asking it to flush (state would
   *  still be the previous render's). */
  const packageDocRef = useRef<PackageDoc | null>(packageDoc);
  const packageDocOverRef = useRef(false);
  /** The over-the-caps editor content (never emitted), kept so a step change
   *  and return gives the user their text back instead of a stale copy. */
  const [packageDocOverDraft, setPackageDocOverDraft] = useState<unknown>(null);
  /** The editor registers its flush() here while mounted. */
  const packageDocFlushRef = useRef<(() => void) | null>(null);
  const setPackageDoc = useCallback((doc: PackageDoc | null) => {
    packageDocRef.current = doc;
    setPackageDocState(doc);
  }, []);
  const setPackageDocOver = useCallback((over: boolean, draft?: unknown) => {
    packageDocOverRef.current = over;
    setPackageDocOverState(over);
    setPackageDocOverDraft(over ? draft ?? null : null);
  }, []);
  const blocks = useMemo(() => groupBlocks(sections, groups, { includeEmpty: true }), [sections, groups]);

  const defaultFabric = fabrics.some((f) => f.sku === "RB-MV-MN")
    ? "RB-MV-MN"
    : fabrics[0]?.sku ?? "RB-MV-MN";

  const [phone, setPhone] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [loadedId, setLoadedId] = useState(initial.loadedId);
  const [quoteId, setQuoteId] = useState(initial.quoteId);
  const [status, setStatus] = useState<QuoteStatus>(initial.status);
  /** #180 review 2 — the status this tab last received FROM THE SERVER
   *  (page load, or a confirmed save/status-change response). `status`
   *  above also updates OPTIMISTICALLY (changeStatus/changeStage set it
   *  before their server round trip resolves); this one only ever moves on
   *  a server-confirmed value, so saveQuoteAction can tell a genuine
   *  in-flight change apart from a stale tab that never heard about a
   *  change made elsewhere. */
  const [baseStatus, setBaseStatus] = useState<QuoteStatus>(initial.status);
  /** #366 — the estimate's project discounts (spec.projectDiscounts): SKU → { pct, note }. Rides every Save; the
   *  server stamps who / when and re-applies the map itself. */
  const [projectDiscounts, setProjectDiscounts] = useState<ProjectDiscounts>(() => initial.projectDiscounts ?? {});
  /** #366 — the map as of the last load / successful Save (an edit that moves no line — a note — still holds the window). */
  const [savedDiscountsKey, setSavedDiscountsKey] = useState(() => projectDiscountsKey(initial.projectDiscounts ?? {}));
  // #366: keep every line's project discount stamped — a line added, a qty changed, a system loaded or copied in, or
  // the map edited. applyProjectDiscounts returns the same array when nothing changes, so this settles in one pass.
  // Declared BEFORE the bonus effect below: both queue functional updates in this order, so the bonus lines are
  // always figured on stamped lines (they read normal cost anyway). Writes setSectionsState directly, like the bonus
  // effect, so it never un-marks a built system or clears the tier banner.
  useEffect(() => {
    setSectionsState((cur) => applyProjectDiscounts(cur, projectDiscounts));
  }, [sections, projectDiscounts]);
  /** #366 — set (or change) one SKU's project discount; it applies to that SKU everywhere on the estimate. */
  const setProjectDiscount = useCallback((sku: string, pct: number, note: string) => {
    const key = sku.trim();
    const p = parseDiscountPct(pct);
    if (!key || p == null) return;
    setProjectDiscounts((cur) => ({ ...cur, [key]: { pct: p, note: note.trim().slice(0, PROJECT_DISCOUNT_NOTE_MAX), by: cur[key]?.by ?? "", at: cur[key]?.at ?? 0 } }));
  }, []);
  /** #366 — remove one SKU's project discount (its lines go back to their normal cost). */
  const removeProjectDiscount = useCallback((sku: string) => {
    setProjectDiscounts((cur) => {
      if (!Object.prototype.hasOwnProperty.call(cur, sku)) return cur;
      const next = { ...cur };
      delete next[sku];
      return next;
    });
  }, []);
  // Estimator bonuses: keep each system's 5% / 2% lines current. Runs after
  // every sections change (all writers, including setSectionsState callers);
  // withBonusLines returns the same array when nothing changes, so this
  // settles in one pass. Writes setSectionsState directly so it never
  // un-marks a built system. `status` is the hook's own state (declared just
  // above); `nextId` is the nidRef counter declared before the sections.
  useEffect(() => {
    // Functional update: judged against the CURRENT sections, so an edit that
    // lands between this render and the update is never overwritten.
    setSectionsState((cur) =>
      bonusRulesApply({ source: initial.bonusSource, quoteType: initial.bonusQuoteType, status }, cur) ? withBonusLines(cur, nextId, bonusRatesFor(status, cur, bonusRates)) : cur
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sections, status]);
  /** #284 — the server-evaluated next-step control (pill, primary action, ⋯);
   *  every sync/save refreshes it. It carries the #242 limit chip as its strip. */
  const [next, setNext] = useState<QuoteNextStepView | null>(initialNext);
  /** #284 — the actionError banner came from the approval gate, so it offers the next step. */
  const [gateRefused, setGateRefused] = useState(false);
  /** Phase 3 — the Send step's Activity card reports the client-link opens and
   *  unread customer replies here (null until it has loaded); the Send tab
   *  badge reads it. */
  const [trackSummary, setTrackSummary] = useState<{ opens: number; newReplies: number } | null>(null);
  /** Phase 4 (spec §11.3) — the SAVED quote's review comments (all of them,
   *  oldest first; store-owned, never part of a Save). Read once per saved
   *  quote; the Customer review sidebar (and Task 5's pins) replace it with
   *  each action's fresh list. `seq` drops a read that a newer read or a
   *  mutation's result has overtaken. */
  const [reviewComments, setReviewCommentsState] = useState<ReviewComment[]>([]);
  const reviewSeqRef = useRef(0);
  const setReviewComments = useCallback((list: ReviewComment[]) => {
    reviewSeqRef.current += 1;
    setReviewCommentsState(list);
  }, []);
  const refreshReviewComments = useCallback(async () => {
    if (!loadedId) return;
    const seq = ++reviewSeqRef.current;
    try {
      const r = await listReviewCommentsAction(loadedId);
      if (seq === reviewSeqRef.current && r.ok) setReviewCommentsState(r.comments);
    } catch {
      /* the list keeps what it had; the next action answers with a fresh one */
    }
  }, [loadedId]);
  useEffect(() => {
    /* A different (or no) quote: drop the old list and any read still in flight before refetching. */
    const seq = ++reviewSeqRef.current;
    setReviewCommentsState([]);
    if (!loadedId) return;
    listReviewCommentsAction(loadedId)
      .then((r) => {
        if (seq === reviewSeqRef.current && r.ok) setReviewCommentsState(r.comments);
      })
      .catch(() => undefined);
  }, [loadedId]);
  /* Daylite stage bar (Task 6) — quoteType never changes client-side (no UI
     changes it), so it stays a plain const rather than state. */
  const quoteType = initial.quoteType;
  const [pipelineId, setPipelineId] = useState(initial.pipelineId);
  const [stage, setStage] = useState(initial.stage);
  /** #293 — the system-intro library; the intro actions answer with the new list. */
  const [intros, setIntros] = useState(narrativeIntros);
  /** #293 slice 2: the system library modal (Load system). */
  const [libraryOpen, setLibraryOpen] = useState(false);
  /** Phase 6: the "Add a system" modal. */
  const [addSystemOpen, setAddSystemOpen] = useState(false);
  const narrRef = useRef<HTMLTextAreaElement | null>(null);
  /** Bumped by a card's snippet — the effect focuses the textarea once the
   *  column (and the newly active system) has rendered, caret at the end.
   *  #305: the column lives on the Build package step, which may mount after
   *  this effect runs (the step switch is a separate URL update) — so the
   *  request stays pending until the textarea exists, and PackageStep calls
   *  focusNarrIfPending on mount. */
  const [narrFocusReq, setNarrFocusReq] = useState(0);
  const narrFocusPending = useRef(false);
  const focusNarrIfPending = useCallback(() => {
    const el = narrRef.current;
    if (!narrFocusPending.current || !el) return;
    narrFocusPending.current = false;
    el.focus();
    const n = el.value.length;
    el.setSelectionRange(n, n);
  }, []);
  useEffect(() => {
    if (!narrFocusReq) return;
    narrFocusPending.current = true;
    focusNarrIfPending();
  }, [narrFocusReq, focusNarrIfPending]);
  /** Systems rail (#168). Defaults open on both server and first client
   *  render; the remembered choice is applied after mount so hydration matches. */
  const [sideOpen, setSideOpen] = useState(true);
  useEffect(() => {
    try {
      if (window.localStorage.getItem(SIDE_OPEN_KEY) === "0") setSideOpen(false);
    } catch {
      /* storage unavailable — stay open */
    }
  }, []);
  const toggleSide = () => {
    const next = !sideOpen;
    setSideOpen(next);
    try {
      window.localStorage.setItem(SIDE_OPEN_KEY, next ? "1" : "0");
    } catch {
      /* ignore */
    }
  };
  const [actionError, setActionError] = useState<string | null>(null);
  /** #180 review 3 — an informational note from the server that isn't a
   *  failure: e.g. a stale tab's status display was refreshed because
   *  someone else moved it elsewhere, even though this save succeeded and
   *  never asked to change status itself. Shown alongside "Saved ✓", not
   *  in place of it, and never implies anything went wrong. */
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  /** True while changeStatus/changeStage's own gated setStatusAction/
   *  setQuoteStageAction round trip is in flight (security review,
   *  2026-09-25) — disables Save so a click landing in that window can't
   *  race the server's own gate with a second, ungated status value. */
  const [statusChanging, setStatusChanging] = useState(false);
  /** Result banner for "Move system" — never auto-navigates (the user may
   *  have other unsaved edits on the CURRENT estimate). */
  const [moveNotice, setMoveNotice] = useState<
    | {
        ok: true;
        targetId: string;
        targetName: string;
        targetNumber: string;
        /** #266: "Copied" reuses this banner; absent = the original Moved wording. */
        verb?: "Moved" | "Copied" | "Loaded" | "Lines";
        /** #266: the re-price summary; a copy within this estimate has no targetId. */
        detail?: string;
      }
    | { ok: false; error: string }
    | null
  >(null);
  /** #357: a "move lines to another estimate" round trip is in flight. */
  const [movingLines, setMovingLines] = useState(false);
  const [custName, setCustName] = useState(initial.custName);
  const [customerId, setCustomerId] = useState(initial.customerId);
  const [locationId, setLocationId] = useState(initial.locationId);
  const [contactName, setContactName] = useState(initial.contactName);
  // #160: the quote name is editable in the header (click-to-edit).
  const [projectName, setProjectName] = useState(initial.projectName);
  const [titleEditing, setTitleEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState(initial.projectName);
  const titleOpenRef = useRef(false);
  const [quoteNote, setQuoteNote] = useState(initial.quoteNote);
  const [assumptions, setAssumptions] = useState(initial.assumptions || "");
  /** #301 — the cover PDF's Overall summary and Not included (never on the estimate PDF). */
  const [coverSummary, setCoverSummary] = useState(initial.coverSummary);
  const [notIncluded, setNotIncluded] = useState(initial.notIncluded ?? notIncludedDefault);
  const checkedAssumptions = useMemo(() => new Set(assumptions.split("\n").map((line) => line.trim()).filter(Boolean)), [assumptions]);
  const [installTimeframe, setInstallTimeframe] = useState(initial.installTimeframe);
  const [paymentTerms, setPaymentTerms] = useState(initial.paymentTerms);
  // #110: user-named quote category — persisted on blur, not per keystroke.
  const [category, setCategory] = useState(initial.category);
  const categorySaved = useRef(initial.category);
  /** Box goods sale (spec 2026-10-21) — content: rides Save (never the header autosave) and is part of the
   *  document key, so a toggle reads "Unsaved changes" like any document edit. System estimates only. */
  const [boxSale, setBoxSale] = useState(initial.boxSale);
  const canBoxSale = isBoxSaleQuoteType(initial.quoteType) && isBoxSaleSource(initial.bonusSource);
  /** The systems whose labor blocks a box-sale Save — the Build banner names them. */
  const boxSaleLabor = useMemo(() => (boxSale ? boxSaleLaborSystems(sections) : []), [boxSale, sections]);
  const [revNum, setRevNum] = useState(initial.revNum);
  // #333: read by the live BOM quote (Build package → BOM quote), which prints the saved Rev date.
  const [revDateMs, setRevDateMs] = useState(initial.revDateMs);
  const [pdfQty, setPdfQty] = useState(initial.pdfOptions.pdfQty);
  const [pdfNotes, setPdfNotes] = useState(initial.pdfOptions.pdfNotes);
  const [pdfCover, setPdfCover] = useState(initial.pdfOptions.pdfCover);
  const [pdfTerms, setPdfTerms] = useState(initial.pdfOptions.pdfTerms);
  const [pdfOptions, setPdfOptions] = useState(initial.pdfOptions.pdfOptions);
  const [pdfPrices, setPdfPrices] = useState(initial.pdfOptions.pdfPrices);
  const [pdfItemizedAppendix, setPdfItemizedAppendix] = useState(initial.pdfOptions.pdfItemizedAppendix);
  const [pdfCutSheets, setPdfCutSheets] = useState(initial.pdfOptions.pdfCutSheets);
  const [detail, setDetail] = useState<"itemized" | "sectioned">(initial.pdfOptions.detail);
  // #364 — Build package → BOM quote → Show on BOM (the BOM view only).
  const [bomLinePrices, setBomLinePrices] = useState(initial.pdfOptions.bomLinePrices);
  const [bomMaterials, setBomMaterials] = useState(initial.pdfOptions.bomMaterials);
  const [bomLabor, setBomLabor] = useState(initial.pdfOptions.bomLabor);
  const [bomFreight, setBomFreight] = useState(initial.pdfOptions.bomFreight);
  /** #305 — one Show-on-PDF toggle (#333: Build package → Client package). */
  const togglePdf = (flag: PdfToggle) => {
    if (flag === "pdfQty") setPdfQty((v) => !v);
    else if (flag === "pdfNotes") setPdfNotes((v) => !v);
    else if (flag === "pdfPrices") setPdfPrices((v) => !v);
    else if (flag === "pdfCover") setPdfCover((v) => !v);
    else if (flag === "pdfOptions") setPdfOptions((v) => !v);
    else if (flag === "pdfItemizedAppendix") setPdfItemizedAppendix((v) => !v);
    else if (flag === "pdfCutSheets") setPdfCutSheets((v) => !v);
    else if (flag === "bomLinePrices") setBomLinePrices((v) => !v);
    else if (flag === "bomMaterials") setBomMaterials((v) => !v);
    else if (flag === "bomLabor") setBomLabor((v) => !v);
    else if (flag === "bomFreight") setBomFreight((v) => !v);
    else setPdfTerms((v) => !v);
  };
  /** #222 — the Show-on-PDF choices, saved with the quote (Quote.pdfOptions). */
  const pdfOpts = useMemo<QuotePdfOptions>(
    () => ({ detail, pdfQty, pdfNotes, pdfPrices, pdfCover, pdfTerms, pdfOptions, pdfItemizedAppendix, pdfCutSheets, bomLinePrices, bomMaterials, bomLabor, bomFreight }),
    [detail, pdfQty, pdfNotes, pdfPrices, pdfCover, pdfTerms, pdfOptions, pdfItemizedAppendix, pdfCutSheets, bomLinePrices, bomMaterials, bomLabor, bomFreight]
  );
  /** #292 — how many cut sheets the saved PDF would append (client-safe count; never collect.ts). */
  const cutSheetCount = useMemo(() => countCutSheetTypes({ sections }, fabrics.map((f) => ({ sku: f.sku, desc: f.name })), trackSeries), [sections, fabrics, trackSeries]);
  const [activeId, setActiveId] = useState<string | null>(
    () => (initial.sections ?? freshSections(initialFreightDefault.pct))[0]?.id ?? null
  );
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  /** Phase 2a — collapse is remembered per person per SAVED quote in
   *  localStorage. Read once after mount (hydration-safe, like sideOpen) and
   *  again when a brand-new estimate gains its id — that first id writes the
   *  collapses made before the first Save. Every access is try/catch'd. */
  const expandedRef = useRef(expanded);
  useEffect(() => {
    expandedRef.current = expanded;
  }, [expanded]);
  const collapseReadFor = useRef<string | null>(null);
  useEffect(() => {
    if (!loadedId || collapseReadFor.current === loadedId) return;
    collapseReadFor.current = loadedId;
    const key = COLLAPSED_KEY_PREFIX + loadedId;
    try {
      const raw = window.localStorage.getItem(key);
      const ids: unknown = raw ? JSON.parse(raw) : null;
      if (Array.isArray(ids)) {
        const shut = ids.filter((x): x is string => typeof x === "string");
        if (shut.length) setExpanded((e) => ({ ...e, ...Object.fromEntries(shut.map((id) => [id, false])) }));
      } else {
        const cur = expandedRef.current;
        const shut = Object.keys(cur).filter((id) => cur[id] === false);
        if (shut.length) window.localStorage.setItem(key, JSON.stringify(shut));
      }
    } catch {
      /* storage unavailable or a bad value — collapse just isn't remembered */
    }
  }, [loadedId]);
  /** Every collapse change goes through here, so it is written for a saved quote. */
  const setExpandedRemembered = (next: Record<string, boolean>) => {
    setExpanded(next);
    if (!loadedId) return;
    try {
      const live = new Set(sections.map((s) => s.id));
      window.localStorage.setItem(
        COLLAPSED_KEY_PREFIX + loadedId,
        JSON.stringify(Object.keys(next).filter((id) => next[id] === false && live.has(id)))
      );
    } catch {
      /* ignore */
    }
  };
  /* The add-part row is exclusive: at most ONE input method is open across the
     whole estimate, named by this one descriptor. Opening a different method
     closes and discards the last one (see openInputMethod). Five per-method
     section ids used to be cross-cleared by hand — and the sixth, the CSV
     importer, lived inside SectionCard and was coordinated with nothing, so one
     could sit open per section. #143 then split that button: the CSV importer
     folded into the catalog panel and "+ Vendor quote" became its own method —
     one entry in InputKind rather than five more setter calls. */
  const [openInput, setOpenInput] = useState<{ kind: InputKind; secId: string } | null>(null);
  /** Mirrors `openInput` for callbacks that land later (the labor travel fetch
   *  below). openInputMethod/closeInput are its only writers. */
  const openInputRef = useRef<{ kind: InputKind; secId: string } | null>(null);
  /** Stamps each open with its own number. The descriptor alone can't tell
   *  "still the same open" from "closed and reopened on the same method and
   *  system", so a travel fetch issued by the earlier open would pass a
   *  kind+secId check and overwrite what the user has since typed. */
  const openSeqRef = useRef(0);
  const openFor = (kind: InputKind) =>
    openInput && openInput.kind === kind ? openInput.secId : null;
  const isOpenFor = (kind: InputKind, secId: string) =>
    !!openInput && openInput.kind === kind && openInput.secId === secId;
  const curtainFor = openFor("curtain");
  const fixtureFor = openFor("fixture");
  const laborFor = openFor("labor");
  const vendorFor = openFor("vendor");
  const trackFor = openFor("track");
  const [customDraft, setCustomDraft] = useState<CustomDraft>(freshCustom);
  // #302: why the last "Add custom part" didn't add, and the in-flight guard.
  const [customError, setCustomError] = useState("");
  const [savingCustom, setSavingCustom] = useState(false);
  const savingCustomRef = useRef(false);
  /* #312: the custom line the open form edits in place (null = adding), and the
     draft staged for the next open — consumed by seedDraft like curtainEditRef. */
  const [customEdit, setCustomEdit] = useState<{ lineId: number } | null>(null);
  const customEditRef = useRef<{ lineId: number; draft: CustomDraft } | null>(null);
  const [curtainDraft, setCurtainDraft] = useState<CurtainDraft>(() =>
    freshCurtain(defaultFabric)
  );
  const [fixtureDraft, setFixtureDraft] = useState<FixtureDraft>(freshFixture);
  const [vendorDraft, setVendorDraft] = useState<VendorDraft>(freshVendor);
  /* #143: vendor quotes live TOP-LEVEL on the quote doc, beside `spec` — the
     attachment proxy route reads `quote.vendorQuotes`, and keeping file bytes
     out of `spec` stops every revision snapshot from copying them. */
  const [vendorQuotes, setVendorQuotes] = useState<VendorQuote[]>(initial.vendorQuotes);
  /* #143: object-URLs for files uploaded straight to Blob storage, keyed by
     vendor-quote id. They fill the one gap the upload-on-select path opens —
     a record whose bytes are in Blob but whose estimate has no id yet, so the
     authenticated proxy has nothing to look it up by. Page-lifetime only; a
     reload falls back to the proxy, which by then has a saved quote. */
  const [vendorPreviews, setVendorPreviews] = useState<Record<string, string>>({});
  const vendorLineIdRef = useRef(0);
  /* #144: a pending EDIT seed for the vendor form, handed from the row's Edit
     control to seedDraft. Editing goes through the SAME coordinator as every
     other open (D161) rather than a second open path, so this ref is how the
     record to edit reaches the seed. Consumed and cleared by seedDraft, and
     cleared by discardDraft, so an abandoned edit can never leak into the next
     plain "+ Vendor quote". */
  const vendorEditRef = useRef<string | null>(null);
  /* #348 slice 4: the Inbox → Estimator hand-off (`?vq=`). `vendorSeedRef` is the blank draft the hand-off opens the
     form on (its id is the one the PDF is copied under), consumed by seedDraft ahead of the edit seed; `vendorHandoff`
     is the copy's live state (Add waits while it loads; its note shows under the file row). discardDraft clears both. */
  const vendorSeedRef = useRef<VendorDraft | null>(null);
  const [vendorHandoff, setVendorHandoff] = useState<{ status: "loading" | "done" | "failed"; note: string } | null>(null);
  const vendorHandoffConsumedRef = useRef(false);
  /* #348 slice 5: Read the PDF's live state. `vendorPdfSeqRef` numbers each read and each reset, so a result (or a
     failure) that lands after its form closed, reseeded or changed file is dropped; `vendorPdfBusyRef` is the
     synchronous double-click guard (one action call per click). */
  const [vendorPdf, setVendorPdf] = useState<VendorPdfFormState>(VENDOR_PDF_IDLE);
  const vendorPdfSeqRef = useRef(0);
  const vendorPdfBusyRef = useRef(false);
  const resetVendorPdf = () => {
    vendorPdfSeqRef.current++;
    vendorPdfBusyRef.current = false;
    setVendorPdf(VENDOR_PDF_IDLE);
  };
  /* #269: the labor group a "click the line to edit" open is seeding, set
     just before openInputMethod("labor") and consumed by seedDraft — the
     vendor-edit pattern above. `laborEdit` is that open's live state (the
     modal's Update mode + its note); discardDraft clears both. */
  const laborEditRef = useRef<{ group: string; draft: LaborDraft; handEdited: number; removed: number } | null>(null);
  const [laborEdit, setLaborEdit] = useState<{ group: string; handEdited: number; removed: number } | null>(null);
  /* #274: the track configurator's form. Reopened from a track line (the
     #269 labor pattern above), `trackEditRef` carries that line to seedDraft
     and `trackEdit` is the open's live state — Update mode, or read-only
     (with the line's saved parts) when its series was deleted. */
  const [trackDraft, setTrackDraft] = useState<TrackDraft>(() => freshTrackDraft(trackSeries));
  type TrackEdit = { lineId: number; readOnly: { components: SpecItem["components"]; cost: number; price: number } | null };
  const trackEditRef = useRef<(TrackEdit & { draft: TrackDraft }) | null>(null);
  const [trackEdit, setTrackEdit] = useState<TrackEdit | null>(null);
  /* #292: Edit curtain — the same close-then-seed dance as the track edit. */
  const curtainEditRef = useRef<{ lineId: number; draft: CurtainDraft; linkedTrack: string | null } | null>(null);
  const [curtainEdit, setCurtainEdit] = useState<{ lineId: number; linkedTrack: string | null } | null>(null);
  /* #274: the curtain modal's Add track form (null = off) and the pre-fill
     it last took from the curtain, so untouched fields follow the curtain. */
  const [curtainTrack, setCurtainTrack] = useState<TrackDraft | null>(null);
  const curtainTrackPrefillRef = useRef<CurtainTrackPrefill>({ operation: "oneway", run: "", label: "" });
  /* #210: the position/circuit values last auto-filled from a fixture's
     defaults, so switching the assembly can tell "still what we prefilled"
     apart from "the user typed something" and never clobber the latter. */
  const fixturePrefillRef = useRef<{ position: string; circuit: string }>({ position: "", circuit: "" });
  /** A stored vendor quote, back into the form's draft shape (#144). */
  const vendorDraftFromRecord = (v: VendorQuote): VendorDraft => {
    /* Line ids are persisted on the record and so outlive the page that minted
       them, while vendorLineIdRef restarts at 0 — clear the counter past them
       or the next "+ Add line" mints a duplicate id and typing in one row
       writes both. */
    for (const l of v.lines)
      if (l.id > vendorLineIdRef.current) vendorLineIdRef.current = l.id;
    const lines: VendorLineDraft[] = v.lines.map((l) => ({
      id: l.id,
      description: l.description,
      manufacturerPartNumber: l.manufacturerPartNumber || "",
      qty: String(l.qty),
      unit: l.unit,
      amount: String(l.amount),
      // #348 slice 5: a read line is tagged only while the record still has its read (the server strips both together).
      ...(v.extracted && typeof l.extractedIndex === "number" ? { fromRead: l.extractedIndex } : {}),
    }));
    return {
      /* The record's OWN id, never a fresh mint: the attachment is stored under
         it, so re-minting would orphan the file (#143). */
      id: v.id,
      vendor: v.vendor,
      quoteNumber: v.quoteNumber,
      description: v.description,
      link: v.link || "",
      // Carried as-is, so an untouched attachment survives the round trip.
      attachment: v.attachment
        ? {
            name: v.attachment.name || "quote file",
            mime: v.attachment.mime || "application/octet-stream",
            ...(v.attachment.dataUrl ? { dataUrl: v.attachment.dataUrl } : {}),
            ...(v.attachment.blobPath ? { blobPath: v.attachment.blobPath } : {}),
          }
        : null,
      /* Deliberately NOT seeded from vendorPreviews: the form revokes this
         object-URL when the file is replaced, and the same URL is still held
         in that map for the line's own Download link. */
      attachmentPreview: null,
      lines,
      terms: v.terms || "",
      notes: v.notes || "",
      /* Blank when the stored total is just the lines' sum — how the field
         stood when the quote was entered (#144 re-review). Seeding it
         unconditionally would convert every lines-driven quote into a
         typed-total one on its first edit, so the line a vendor's revision adds
         would land in the customer's itemized breakdown without being in the
         price: the exact invariant #143 installed vendorKeptLines to protect.
         The rule is vendorTotalSeed, pinned in the spec harness. */
      total: vendorTotalSeed(v.total, vendorLinesTotal(lines)),
      includesFreight: !!v.includesFreight,
      display: v.display,
      vendorCompanyId: v.vendorCompanyId ?? null,
      fromThreadId: v.fromThreadId ?? null,
      extracted: v.extracted ?? null,
      pdfRead: null,
    };
  };
  // Customer tier markup stamp (item 11, D87; field `tierMargin`) — SEEDS the labor draft and
  // curtain configurator; refreshed when the meta action re-stamps.
  const [tierMargin, setTierMargin] = useState<number | null>(initial.tierMargin);
  /** The stamp in effect, read synchronously when the next one lands (#254) —
   *  the closure's `tierMargin` can be a render behind. */
  const tierMarginRef = useRef<number | null>(initial.tierMargin);
  const [laborDraft, setLaborDraft] = useState<LaborDraft>(() =>
    freshLabor(null, initial.tierMargin, (initial.sections ?? freshSections(initialFreightDefault.pct))[0]?.name || "")
  );
  /* #348 follow-up (Jeff 2026-10-15): the five configurator pop-ups ask before a stray click discards unsaved work.
     ONE helper, markDraftBaseline, marks an open's baseline pending wherever its draft is (re)initialized — every open
     through openInputMethod (fresh, an edit's seed, the hand-off's blank seed), and the labor travel reseed; the effect
     below snapshots the COMMITTED draft (so a seed set in the same click is in it). The hand-off's fill re-bases the
     stored baseline instead (rebaseDraft). confirmDiscardInput compares at close; Add / Save never asks. */
  const modalDrafts = useMemo<Record<ModalInputKind, unknown>>(
    () => ({ curtain: { draft: curtainDraft, track: curtainTrack }, track: trackDraft, fixture: fixtureDraft, labor: laborDraft, vendor: vendorDraft }),
    [curtainDraft, curtainTrack, trackDraft, fixtureDraft, laborDraft, vendorDraft]
  );
  /** Per pop-up: the clean draft's stableDraftJson, or null while pending (snapshotted after the next commit). */
  const draftBaselineRef = useRef<Partial<Record<ModalInputKind, string | null>>>({});
  const [draftBaselineTick, setDraftBaselineTick] = useState(0);
  const markDraftBaseline = (kind: InputKind) => {
    if (!isModalInputKind(kind)) return;
    draftBaselineRef.current[kind] = null;
    setDraftBaselineTick((t) => t + 1); // guarantees the snapshot runs even when the seed equals the old draft
  };
  useEffect(() => {
    for (const k of MODAL_INPUT_KINDS) {
      if (draftBaselineRef.current[k] === null) draftBaselineRef.current[k] = stableDraftJson(modalDrafts[k]);
    }
  }, [draftBaselineTick, modalDrafts]);
  const [, startTransition] = useTransition();

  /* ---- AI scope draft (Phase 8, D4) — drafts only, estimator sets prices ---- */
  const [aiOpen, setAiOpen] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiErr, setAiErr] = useState<string | null>(null);
  const [aiScope, setAiScope] = useState<string | null>(null);
  const [aiLines, setAiLines] = useState<DraftedLine[] | null>(null);
  const [aiScopeInserted, setAiScopeInserted] = useState(false);
  const [aiAdded, setAiAdded] = useState<Record<number, boolean>>({});

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const assumptionsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const coverSummaryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notIncludedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* #333 (spec §4.4, D-TBD-d) — what the client gets on this project
     (Quote.packageSelection). Not content: each change writes IMMEDIATELY
     through the header-meta action (no timer), serialised so the latest value
     always lands last. #333 review — the write model:
       - the meta action (store: setPackageSelection) is the ONE writer; Save
         never carries the selection (B), so a Save built before a newer tick
         can't revert it, and a selection write never bumps updatedAt (G), so
         it can't fail an in-flight Send's version check;
       - `selectionAckedKey` is the key the SERVER last confirmed (the loaded
         value, or the defaults an absent key reads as); a write is skipped
         only when the latest value already equals it (A), and a skip clears
         the error, since UI = server again (E);
       - a new estimate holds the selection until its first Save, which then
         flushes it ONLY when it was edited — an untouched estimate never
         gains the key; any later Save also retries a failed write (E);
       - Send awaits selectionSettled(), which races a 10 s timeout and says
         whether the server holds the latest value (F). */
  const [packageSelection, setPackageSelectionState] = useState<PackageSelection>(() => normalizePackageSelection(initial.packageSelection));
  const selectionLatest = useRef<PackageSelection>(packageSelection);
  const selectionAckedKey = useRef(selectionKey(packageSelection));
  const selectionChain = useRef<Promise<void>>(Promise.resolve());
  const selectionInFlight = useRef(0);
  const [selectionSaving, setSelectionSaving] = useState(false);
  /** Why the last selection write failed (null = none pending). */
  const [selectionError, setSelectionError] = useState<string | null>(null);
  /** Queue a write of the latest selection to quote `id` (latest wins). */
  const enqueueSelectionWrite = (id: string) => {
    selectionInFlight.current += 1;
    setSelectionSaving(true);
    selectionChain.current = selectionChain.current
      .then(async () => {
        // Latest wins: a write queued behind another sends the newest value.
        const latest = selectionLatest.current;
        const key = selectionKey(latest);
        if (key === selectionAckedKey.current) {
          setSelectionError(null);
          return;
        }
        const r = await updateQuoteMetaAction(id, { packageSelection: latest });
        if (!r || !r.ok) throw new Error((r && r.error) || SELECTION_NOT_SAVED);
        selectionAckedKey.current = key;
        if (r.pdf) setPdf(r.pdf); // spec 2026-10-16 §4: drawings / left-out datasheets re-rendered the PDF
        postChanged("quote", id);
        if (selectionKey(selectionLatest.current) === key) setSelectionError(null);
      })
      .catch((e: unknown) => setSelectionError(e instanceof Error && e.message ? e.message : SELECTION_NOT_SAVED))
      .finally(() => {
        selectionInFlight.current -= 1;
        if (selectionInFlight.current === 0) setSelectionSaving(false);
      });
  };
  const writeSelection = (next: PackageSelection) => {
    const value = normalizePackageSelection(next);
    selectionLatest.current = value;
    setPackageSelectionState(value);
    // A new estimate holds it until the first Save (flushSelection).
    if (!loadedId) return;
    enqueueSelectionWrite(loadedId);
  };
  /** After a Save: write the selection when the server doesn't hold it yet. */
  const flushSelection = (id: string) => {
    if (selectionKey(selectionLatest.current) === selectionAckedKey.current) {
      setSelectionError(null);
      return;
    }
    enqueueSelectionWrite(id);
  };
  /** The Client package tab's Retry. */
  const retrySelection = () => {
    if (loadedId) enqueueSelectionWrite(loadedId);
  };
  /** Client package → Documents: Estimate PDF / Cover PDF (Send & track defaults) and Drawings. */
  const setPackageSwitch = (flag: "estimatePdf" | "coverPdf" | "drawings", on: boolean) =>
    writeSelection({ ...selectionLatest.current, [flag]: on });
  /** Client package → Datasheets: tick (included) or untick these SKUs. Returns
   *  why it was refused (a cap — excludeRefusal), or null once applied. */
  const setDatasheetsIncluded = (skus: string[], included: boolean): string | null => {
    if (!included) {
      const refusal = excludeRefusal(selectionLatest.current.excludedDatasheets, skus);
      if (refusal) return refusal;
    }
    const set = new Set(selectionLatest.current.excludedDatasheets);
    for (const sku of skus) {
      if (included) set.delete(sku);
      else set.add(sku);
    }
    writeSelection({ ...selectionLatest.current, excludedDatasheets: [...set] });
    return null;
  };
  /** Resolves once every queued selection write has landed (or after
   *  SELECTION_SETTLE_TIMEOUT_MS): true only when the server holds the latest value. */
  const selectionSettled = async (): Promise<boolean> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = await Promise.race([
      selectionChain.current.then(() => false),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(true), SELECTION_SETTLE_TIMEOUT_MS);
      }),
    ]);
    if (timer) clearTimeout(timer);
    return !timedOut && selectionKey(selectionLatest.current) === selectionAckedKey.current;
  };

  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onResize = () => setPhone(window.innerWidth <= 700);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const rate = useMemo(() => makeLaborRate(laborRates), [laborRates]);
  void fixtureRates;
  const t = useMemo(() => totals(sections, TAX_RATE_PCT), [sections]);

  /* #282 phase 2 — Rewards credit: the customer's balance / available
     (re-read on customer, quote, status or a save), and what this quote
     carries. The save clamps it again on the server. */
  const [creditInfo, setCreditInfo] = useState<RewardCreditInfo | null>(null);
  const [creditSeq, setCreditSeq] = useState(0);
  useEffect(() => {
    let live = true;
    if (!customerId) {
      setCreditInfo(null);
      return;
    }
    rewardCreditInfoAction(customerId, loadedId || null)
      .then((info) => {
        if (live) setCreditInfo(info);
      })
      .catch(() => {
        if (live) setCreditInfo(null);
      });
    return () => {
      live = false;
    };
  }, [customerId, loadedId, status, creditSeq]);
  /** #333: the customer-document perks line for the live BOM quote — only an answer for THIS customer. */
  const purchasePerksDocLine = creditInfo && customerId && creditInfo.customerId === customerId ? creditInfo.purchasePerksDocLine || "" : "";
  const appliedCredit = rewardCreditOf(sections);
  const applyCredit = (amount: number) =>
    setSections((ss) => withRewardCredit(ss, amount, nextId()));
  const removeCredit = () => setSections((ss) => withoutRewardCredit(ss));

  const isInternal = true; // build mode is the internal view (prototype view: 'internal')
  /* One shared line-item grid template — header, item rows and the freight
     row all render off this SAME `cols` (section-card.tsx), so a column can
     only drift out of alignment here. Item shrunk / numeric columns widened
     (punch: raw-looking columns) so Unit sell's 92px input + margin% chip and
     Ext sell's own input both have room; the ×/↑/↓ actions now share ONE
     64px cell instead of three, which used to overflow the old 22px column
     and wrap onto a second grid row. #269: 84px internally, room for the
     labor lines' ✎ Edit labor button beside them. #293: +20px for the ★
     key-product toggle — five 20px buttons + 1px gaps (✎ ★ ↑ ↓ × on a
     labor, track or curtain line) need 104px in BOTH views. #357: +22px
     internally for ⇄ Move to another system — six buttons (✎ ★ ⇄ ↑ ↓ ×). */
  const cols = isInternal
    ? "minmax(150px,1.3fr) 104px 92px 136px 116px 126px"
    : "minmax(150px,1.3fr) 104px 136px 116px 104px";

  /* ---------------- travel (seeded + fetched on demand, punch #89) ----------------
     `travel` used to carry an estimate for every customer AND venue in the
     directory — 5,100 entries / ~327 KiB measured against ~1,700 companies,
     to serve one lookup at a time. It now arrives holding only the loaded
     quote's own estimate, and anything else is fetched when the user picks
     it. Results are cached in `travelSeen` so re-picking a customer, or
     switching back and forth, never refetches. */
  const [travelSeen, setTravelSeen] = useState<Record<string, TravelLite | null>>(travel);
  const travelKey = (custId: string | null, locId: string | null) =>
    custId ? custId + "|" + (locId || "") : "name|" + custName;
  const travelEstFor = (custId: string | null, locId: string | null): TravelLite | null => {
    if (custId) {
      const k = custId + "|" + (locId || "");
      return travelSeen[k] ?? travelSeen[custId + "|"] ?? null;
    }
    return travelSeen["name|" + custName] ?? null;
  };
  const travelEstNow = () => travelEstFor(customerId, locationId);
  /** Fetch (once) the estimate for a selection, then hand it to `then`.
   *  Resolves from cache synchronously when we already have it, so the
   *  common re-select path stays instant and does no round trip. */
  const withTravelFor = (
    custId: string | null,
    locId: string | null,
    then: (est: TravelLite | null) => void
  ) => {
    const k = travelKey(custId, locId);
    if (k in travelSeen) {
      then(travelSeen[k]);
      return;
    }
    if (!custId) {
      then(null);
      return;
    }
    startTransition(async () => {
      const est = await travelForSelectionAction(custId, locId);
      setTravelSeen((m) => (k in m ? m : { ...m, [k]: est }));
      then(est);
    });
  };

  /** #245 — the freight % a NEW/untouched system should carry right now:
   *  base until a venue is picked, then the distance rule. Paired 1:1 with
   *  what's actually been applied to `sections` (see reapplyAutoFreight
   *  below) so the "venue not located" hint below the slider never flashes
   *  ahead of — or lags behind — the number the slider shows. */
  const [freightDefault, setFreightDefault] = useState(initialFreightDefault);
  /** Re-apply the freight default to sections staff haven't touched
   *  (`freightAuto`) when the customer/venue selection changes. Same
   *  cached-vs-fetch shape as reapplyAutoTrips below: withTravelFor calls
   *  back synchronously once the selection's travel is cached, and only
   *  fetches (i.e. only "still loading") on a selection never seen before —
   *  so a freshly-fetched `null` (venue not locatable) still re-applies,
   *  just later, instead of being skipped. */
  const reapplyAutoFreight = (custId: string | null, locId: string | null) => {
    withTravelFor(custId, locId, (est) => {
      const fd = sectionFreightDefault({ hasVenue: !!locId, miles: est?.miles ?? null, rule: freightRule });
      setFreightDefault(fd);
      // Automatic, not an edit: a live #254 banner stays, and its Undo
      // snapshot takes the same freight so Undo never reverts it.
      setSectionsState((ss) => applyAutoFreight(ss, { pct: fd.pct }));
      setTierReprice((n) => (n ? { ...n, before: applyAutoFreight(n.before, { pct: fd.pct }) } : n));
    });
  };

  /* #222 — the saved PDF is the customer preview. `docInput` is what the
     customer document shows; the preview reads "Unsaved changes" while its
     key differs from `savedDoc`, the document as last written — by a Save,
     or by a header autosave, which re-renders the PDF from the saved quote
     with just those fields changed (withSavedMeta). The Show-on-PDF controls
     are part of the key, so flipping one asks for a Save. */
  const [pdf, setPdf] = useState<QuotePdfView | null>(initial.pdf);
  const docCustName = customerId ? customers.find((c) => c.id === customerId)?.name || custName : custName;
  const docInput = useMemo<PdfDocKeyInput>(
    () => ({
      quoteNumber: quoteId,
      projectName,
      custName: docCustName,
      customerId,
      locationId,
      contactName,
      quoteNote,
      assumptions,
      paymentTerms,
      sections,
      groups,
      vendorQuotes,
      pdfOptions: pdfOpts,
      boxSale,
      document: packageDoc,
    }),
    [quoteId, projectName, docCustName, customerId, locationId, contactName, quoteNote, assumptions, paymentTerms, packageDoc, boxSale, sections, groups, vendorQuotes, pdfOpts]
  );
  const docKey = useMemo(() => pdfDocKey(docInput), [docInput]);
  // #267: when the load-time $25 stamp moved a system's price, the saved PDF
  // still shows the old one — baseline on the stored sections so the preview
  // says "Unsaved changes" until a Save.
  const [savedDoc, setSavedDoc] = useState<PdfDocKeyInput>(() =>
    initial.sections &&
    initial.sections.some((s, i) => !!sections[i] && systemSellTotal(s) !== systemSellTotal(sections[i]))
      ? { ...docInput, sections: initial.sections }
      : docInput
  );
  const savedDocKey = useMemo(() => pdfDocKey(savedDoc), [savedDoc]);
  const pdfDirty = !!loadedId && docKey !== savedDocKey;
  // Pop-outs (D912): while this estimate has unsaved work — edits since the
  // last Save, or a new estimate with lines — this window won't answer "Open
  // in main window" and skips its focus refresh. Keyed on the boolean only.
  // #366: a project-discount edit that moved no line (a note) is unsaved work too.
  const unsavedHold = pdfDirty || (!loadedId && sections.some((s) => s.items.length > 0)) || projectDiscountsKey(projectDiscounts) !== savedDiscountsKey;
  useEffect(() => {
    setUnsavedHold(unsavedHold);
    return () => setUnsavedHold(false);
  }, [unsavedHold]);

  /* ---------------- persistence ---------------- */
  /** #254 (D87 amended) — re-price the lines still at `prev`'s markup to
   *  `next`, keep hand-priced ones, and say so with Undo. The normal Save
   *  persists it; no re-priced line → no new banner (the silent stamp), and
   *  a banner already showing (with its Undo) stays. */
  const applyTierStamp = (prev: number | null, next: number, tier: string | null) => {
    const before = sectionsRef.current;
    const res = repriceForTier(before, prev, next);
    // Any change lands — including (#269) a draft-only one, where nothing
    // re-priced but a stored labor draft's margin followed the tier. That
    // case applies silently: no banner, and an existing banner is left alone.
    if (res.sections !== before) {
      sectionsRef.current = res.sections;
      setSectionsState(res.sections);
    }
    if (res.repriced === 0) return;
    setTierReprice({
      before,
      repriced: res.repriced,
      handPriced: res.handPriced,
      label: (tier && PRICING_TIER_LABEL[tier as PricingTier]) || tier || "Base",
      margin: next,
      unsaved: true,
      seq: ++tierRepriceSeqRef.current,
    });
  };
  /** #254 review — the ONE place a customer/contact pick applies its tier,
   *  saved quote or not: resolve server-side (read-only), then move the stamp
   *  in effect and re-price against it. Only the latest pick lands, and only
   *  a resolution that came back ok. Nothing is persisted here — Save stamps
   *  the tier together with the re-priced lines. */
  const tierResolveSeqRef = useRef(0);
  /** #254 fix wave 2: a tier lookup is in flight — Save waits for it, so a
   *  pick-then-Save can't stamp the new tier over lines still at the old
   *  markup (the server resolves the stamp from the posted customer/contact).
   *  The ref guards a click that lands before the disabled button renders. */
  const [tierResolving, setTierResolving] = useState(false);
  const tierResolvingRef = useRef(false);
  const resolveTierFor = (custId: string | null, contact: string) => {
    const seq = ++tierResolveSeqRef.current;
    tierResolvingRef.current = true;
    setTierResolving(true);
    startTransition(async () => {
      try {
        let r: Awaited<ReturnType<typeof resolveTierAction>>;
        try {
          r = await resolveTierAction(custId, contact);
        } catch (e) {
          console.error("[estimator] resolveTierAction threw:", e);
          return;
        }
        if (seq !== tierResolveSeqRef.current || !r.ok) return;
        const prev = tierMarginRef.current;
        tierMarginRef.current = r.tierMargin;
        setTierMargin(r.tierMargin);
        applyTierStamp(prev, r.tierMargin, r.pricingTier);
      } finally {
        // Only the latest lookup clears the wait — an older one finishing
        // first must not re-enable Save ahead of the newer pick.
        if (seq === tierResolveSeqRef.current) {
          tierResolvingRef.current = false;
          setTierResolving(false);
        }
      }
    });
  };
  /** Undo puts back the exact sections from before the re-price; the new
   *  tier stamp stays — it describes the customer. */
  const undoTierReprice = () => {
    if (!tierReprice) return;
    setSectionsState(tierReprice.before);
    setTierReprice(null);
  };

  const persistMeta = (meta: Parameters<typeof updateQuoteMetaAction>[1]) => {
    if (!loadedId) return;
    const id = loadedId;
    startTransition(async () => {
      const r = await updateQuoteMetaAction(id, meta);
      // #254 review: the header autosave never carries the tier stamp — a
      // pick resolves it through resolveTierFor, and Save persists it with
      // the re-priced lines.
      if (r && r.ok) {
        postChanged("quote", id);
        setSavedDoc((d) => withSavedMeta(d, meta));
        if (r.pdf) setPdf(r.pdf);
      }
    });
  };

  /* #287 task B — Lead estimator (`owner`) and Prepared by (`preparedBy`).
     Each select saves the moment it changes, through setQuotePeopleAction —
     never Save, whose allowlist deliberately excludes `owner` (the owner's
     review limit drives auto-approval). A new lead changes the next-step
     control, so its fresh view comes back with the names; both names print
     on the customer document, so a change re-renders the PDF. */
  const [owner, setOwner] = useState(initial.owner);
  const [preparedBy, setPreparedBy] = useState(initial.preparedBy);

  /* Estimator bonuses — Send & track card state. `bonusRecord` is the
   * server-written record at Won; a router refresh re-reads it from `initial`. */
  const router = useRouter();
  const [bonusSplit, setBonusSplit] = useState<BonusSplit>(() => normalizeSplit(initial.estimatorBonusSplit));
  const [bonusRecord, setBonusRecord] = useState<BonusRecord | null>(initial.bonusRecord);
  const [alternatesTaken, setAlternatesTaken] = useState<string[]>(() =>
    initial.bonusRecord ? initial.bonusRecord.alternatesTaken : defaultAlternatesTaken(initial.sections ?? [], initial.clientResponses)
  );
  /** True once the user ticks/unticks an alternate here — until then a Won
   *  move sends no list, so the server picks the default from the customer's
   *  latest accept (the list above was seeded once, at load). */
  const [alternatesTouched, setAlternatesTouched] = useState(false);
  /** After a refresh the server-written record is the truth: re-read it, and
   *  adopt its alternates (a Won recorded with the server's default list would
   *  otherwise keep the load-time list) and clear "touched". */
  useEffect(() => {
    setBonusRecord(initial.bonusRecord);
    if (initial.bonusRecord) {
      setAlternatesTaken(initial.bonusRecord.alternatesTaken);
      setAlternatesTouched(false);
    }
  }, [initial.bonusRecord]);
  const [bonusError, setBonusError] = useState<string | null>(null);
  /** An alternates save is in flight — the card's Record now button waits on it. */
  const [bonusSaving, setBonusSaving] = useState(false);
  const bonusEligible = isBonusEligibleQuote({ source: initial.bonusSource, quoteType: initial.bonusQuoteType });
  /** A status change that lands on or leaves Won changes the server-written
   *  record: drop a stale "Recorded at Won" block at once when leaving Won and
   *  re-read it from the server either way (bonus-eligible quotes only). */
  const syncBonusAfterStatus = (from: QuoteStatus, to: QuoteStatus | null | undefined) => {
    if (!bonusEligible || !to || from === to) return;
    if (from !== "won" && to !== "won") return;
    if (from === "won") setBonusRecord(null);
    router.refresh();
  };
  const saveBonusSplit = (leadPct: number) => {
    if (!loadedId) return;
    const before = bonusSplit;
    setBonusSplit({ leadPct });
    setBonusError(null);
    startTransition(async () => {
      const r = await saveBonusSplitAction(loadedId, leadPct);
      if (!r.ok) {
        setBonusSplit(before);
        setBonusError(r.error || "Could not save the split.");
        return;
      }
      postChanged("quote", loadedId);
      if (status === "won" && bonusEligible) router.refresh();
    });
  };
  const pickAlternatesTaken = (ids: string[]) => {
    const before = alternatesTaken;
    setAlternatesTaken(ids);
    setAlternatesTouched(true);
    setBonusError(null);
    if (status !== "won" || !loadedId || !bonusEligible) return;
    setBonusSaving(true);
    startTransition(async () => {
      try {
        const r = await saveBonusAlternatesAction(loadedId, ids);
        if (!r.ok) {
          setAlternatesTaken(before);
          setBonusError(r.error || "Could not save the alternates.");
          return;
        }
        postChanged("quote", loadedId);
        router.refresh();
      } finally {
        setBonusSaving(false);
      }
    });
  };
  const [peopleBusy, setPeopleBusy] = useState(false);
  const changePeople = (patch: { owner?: string; preparedBy?: string }) => {
    if (!loadedId) return;
    const id = loadedId;
    const before = { owner, preparedBy };
    if (patch.owner !== undefined) setOwner(patch.owner);
    if (patch.preparedBy !== undefined) setPreparedBy(patch.preparedBy);
    setPeopleBusy(true);
    startTransition(async () => {
      try {
        const r = await setQuotePeopleAction(id, patch);
        setOwner(r.owner);
        setPreparedBy(r.preparedBy);
        if (r.next !== undefined) setNext(r.next ?? null);
        setGateRefused(false);
        if (r.ok) {
          postChanged("quote", id);
          setActionError(null);
          if (r.pdf) setPdf(r.pdf);
        } else {
          setActionError(r.error || "That change did not go through — nothing was written.");
        }
      } catch {
        setOwner(before.owner);
        setPreparedBy(before.preparedBy);
        setActionError("Couldn't change the lead estimator or Prepared by — try again.");
      } finally {
        setPeopleBusy(false);
      }
    });
  };
  const samePerson = (a: string, b: string) => !!a.trim() && a.trim().toLowerCase() === b.trim().toLowerCase();
  /** The active team, plus the stored name when it isn't on it (an import, or
   *  someone who left) so the select still shows who is on the quote. */
  const peopleOptions = (current: string) => {
    const names = people.map((p) => p.name);
    const extra = !current.trim()
      ? [{ value: "", label: "— none —" }]
      : names.some((n) => samePerson(n, current))
        ? []
        : [{ value: current, label: `${current} (not on the team)` }];
    return [...extra, ...names.map((n) => ({ value: n, label: n }))];
  };
  const ownerValue = people.find((p) => samePerson(p.name, owner))?.name ?? owner;
  const preparedValue = people.find((p) => samePerson(p.name, preparedBy))?.name ?? preparedBy;

  const openTitle = () => {
    titleOpenRef.current = true;
    setTitleDraft(projectName);
    setTitleEditing(true);
  };
  /** Enter/blur save, Esc reverts. The ref makes Enter-then-blur a single save. */
  const closeTitle = (save: boolean) => {
    if (!titleOpenRef.current) return;
    titleOpenRef.current = false;
    setTitleEditing(false);
    const next = titleDraft.trim();
    if (!save || !next || next === projectName) return;
    setProjectName(next);
    persistMeta({ name: next }); // no-op until the first save; doSave carries it then
  };

  /**
   * Guards editing a won quote's customer/venue/contact (PUNCHLIST #178) — a
   * won quote's project/job already keeps the OLD value, so changing these
   * here would silently disagree with it. `@/components/quote-flow-controls`
   * has a shared `useWonEditGuard` (D206) other quote builders use for this
   * same warning, but it still calls window.confirm() under the hood — which
   * returns false with NO dialog at all in this app's Capacitor shells, so
   * the edit is refused with no explanation, exactly what #178 reports. The
   * estimator uses its own inline two-step confirm instead (D127 pattern,
   * settings-client.tsx): nothing changes, locally or on the server, until
   * the user hits Change in the banner rendered next to "Prepared for"
   * below. wonEditMessage/WonEditField (quotes/new/handoff.ts) keep its
   * copy identical to the shared hook's.
   */
  const [wonMetaGuard, setWonMetaGuard] = useState<{ field: WonEditField; run: () => void } | null>(null);
  /** Quote details (#164) now drop down from the top bar's chip (#281). Starts
   *  closed on every load — not remembered. Closing is a cancel: it drops any
   *  pending won-quote guard. */
  const [qdOpen, setQdOpen] = useState(false);
  const qdChipRef = useRef<HTMLButtonElement | null>(null);
  const qdPanelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!qdOpen) return;
    const close = () => {
      setQdOpen(false);
      setWonMetaGuard(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (!t) return;
      if (qdChipRef.current?.contains(t) || qdPanelRef.current?.contains(t)) return;
      close();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [qdOpen]);
  const closeQd = () => {
    setQdOpen(false);
    setWonMetaGuard(null);
  };
  const guardWonMeta = (field: WonEditField, run: () => void) => {
    if (status === "won") {
      setWonMetaGuard({ field, run });
      return;
    }
    run();
  };

  const applySync = (r: ReviewSync | NextStepSync) => {
    if (r.next !== undefined) setNext(r.next ?? null);
    // Server-confirmed — this is what makes baseStatus trustworthy for the
    // next save's stale-tab check (#180 review 2).
    if (r.status) {
      syncBonusAfterStatus(status, r.status);
      setStatus(r.status);
      setBaseStatus(r.status);
    }
  };

  /** Jeff 2026-10-15 #18 — Lead estimator / Prepared by are read-only for a non-approver once the quote has been sent. */
  const peopleLocked = !viewerCanApprove && (peopleSentOnce || status === "sent" || status === "won" || status === "lost");

  /** Same idea as applySync, for the Daylite stage bar's StageSync (Task 6) —
   *  a stage move can also change status/review (setQuoteStage runs setStatus
   *  underneath when the tag changes), so all four fields sync together. */
  const applyStageSync = (r: StageSync) => {
    if (r.next !== undefined) setNext(r.next ?? null);
    if (r.status) {
      syncBonusAfterStatus(status, r.status);
      setStatus(r.status);
      setBaseStatus(r.status);
    }
    if (r.pipelineId) setPipelineId(r.pipelineId);
    if (r.stage) setStage(r.stage);
  };

  /** #284: the save itself, awaitable — the next-step control saves unsaved
   *  edits first and acts only when this resolves to a version (written, no
   *  refusal). #287: that version is the saved quote's updatedAt, which the
   *  control then decides; false = abort. */
  const saveNow = async (): Promise<number | false> => {
    // #254 fix wave 2: never save while a tier lookup is in flight.
    if (tierResolvingRef.current) return false;
    // Phase 5 fix: the editor's document is over the caps — nothing is written
    // (a Save would otherwise store the last valid copy and say "Saved ✓").
    // Pending keystrokes first: the editor emits (or flags over) synchronously.
    packageDocFlushRef.current?.();
    const docNow = packageDocRef.current;
    if (docNow && packageDocOverRef.current) {
      setActionNotice(null);
      setGateRefused(false);
      setActionError(PACKAGE_DOC_TOO_LARGE);
      return false;
    }
    // Box goods sale (spec 2026-10-21): any labor line refuses the save — the server's own sentence, nothing sent.
    const boxProblem = boxSaleSaveProblem(boxSale, sections);
    if (boxProblem) {
      setActionNotice(null);
      setGateRefused(false);
      setActionError(boxProblem);
      return false;
    }
    const docAtSave = { ...docInput, document: docNow };
    const discountsAtSave = projectDiscounts; // #366
    // What the server had before this save (estimator bonuses: syncBonusAfterStatus).
    const statusBeforeSave = baseStatus;
    const repriceSeqAtSave = tierRepriceSeqRef.current;
    const cname = customerId
      ? customers.find((c) => c.id === customerId)?.name || custName
      : custName;
    const mobs: SpecMob[] = [];
    sections.forEach((sec) => sec.items.forEach((it) => it.mob && mobs.push(it.mob)));
    // (the former startTransition body — doSave below still runs it in one)
    {
      try {
        const res = await saveQuoteAction(loadedId, {
          name: projectName,
          // D205: only the create save retires the replaced draft.
          replaces: loadedId ? "" : initial.replaces,
          // Estimate suggestion: the lead rides the CREATE save only (a saved
          // quote keeps its own); the suggestion id rides every save while the
          // panel shows one — linking is idempotent server-side.
          ...(!loadedId && initial.leadId ? { leadId: initial.leadId } : {}),
          ...(suggestion && sendSuggestionId(suggestion, suggestionLinkedRef.current) ? { suggestionId: suggestion.id } : {}),
          customer: cname,
          customerId: customerId || null,
          locationId: locationId || null,
          contactName: contactName || "",
          quoteNote: quoteNote || "",
          assumptions: assumptions || "",
          installTimeframe,
          paymentTerms,
          category,
          value: t.grand,
          markup: t.markup,
          status,
          // #180 review 2 — what this tab last confirmed from the server,
          // so the action can tell a genuine change from a stale tab.
          baseStatus,
          sections,
          mobs,
          // Phase 2a: the named system groups ride every Save.
          groups,
          vendorQuotes,
          pdfOptions: pdfOpts,
          // Box goods sale: rides every Save (content; the server refuses it with labor).
          boxSale,
          // #301 (R14): the cover fields ride every Save.
          coverSummary,
          notIncluded,
          // #333 review (B): the Client package selection does NOT ride Save — it
          // autosaves through the meta action (flushSelection after the first save).
          // Estimator Phase 5: the package document rides every Save (null = remove it).
          document: docNow,
          // #366: the project discounts ride every Save (the server stamps by / at and re-applies them).
          projectDiscounts,
        });
        // #181: adopt the id whenever the server hands one back, even when
        // `ok` is false — the create branch mints the quote FIRST and only
        // then attempts the requested status advance, so a refused advance
        // still returns a real, saved id. Gating adoption on `res.ok` left
        // `loadedId` unset, so the next Save took the create path again and
        // minted a second quote for the same draft.
        if (res.id) {
          // #254: the quote WAS written — lines and the tier stamp together —
          // even when a requested status change was refused (ok:false with
          // the gate's message), so the banner stops asking to Save.
          setTierReprice((n) => (n && n.unsaved && n.seq <= repriceSeqAtSave ? { ...n, unsaved: false } : n));
          setLoadedId(res.id);
          // Estimate suggestion: linked — later saves stop sending the id.
          if (res.suggestionLinked) suggestionLinkedRef.current = true;
          postChanged("quote", res.id);
          // #333 review (A, E): the first save writes an edited selection; any
          // later Save retries one that failed. Untouched → nothing written.
          if (res.id && (!loadedId || selectionError)) flushSelection(res.id);
          // #223: this save's render prints the number the server hands back.
          setSavedDoc({ ...docAtSave, quoteNumber: res.number ?? res.id });
          setSavedDiscountsKey(projectDiscountsKey(discountsAtSave)); // #366
          if (res.pdf) setPdf(res.pdf);
          setQuoteId(res.number ?? res.id);
          // The server may have moved attachments into Blob storage — take its
          // version back so the next save doesn't re-upload the same bytes.
          if (res.vendorQuotes) setVendorQuotes(res.vendorQuotes);
          setRevNum(res.revNum);
          setRevDateMs(res.updatedAt);
          if (res.next !== undefined) setNext(res.next ?? null);
          // #282 phase 2: take the server's (clamped) Rewards credit back.
          if (typeof res.rewardCredit === "number") {
            const stored = res.rewardCredit;
            // Only when the server clamped it — an edit like any other.
            if (rewardCreditOf(sectionsRef.current) !== stored)
              setSections((ss) => withRewardCredit(ss, stored, nextId()));
            setCreditSeq((n) => n + 1);
          }
          // Server-confirmed either way (ok or refused/stale) — this IS the
          // resync: whether the requested status applied, was refused, or
          // was left alone because this tab was stale, res.status is always
          // what the server actually has now (#180 review 2).
          if (res.status) {
            // Estimator bonuses: a save that moves to/from Won refreshes the card.
            syncBonusAfterStatus(statusBeforeSave, res.status);
            setStatus(res.status);
            setBaseStatus(res.status);
          }
          // Daylite stage bar (Task 6) — a brand-new quote has no pipeline
          // until this first save creates it; pick it up immediately so the
          // bar shows the right stage highlighted without another round trip.
          if (res.pipelineId) setPipelineId(res.pipelineId);
          if (res.stage) setStage(res.stage);
          // #355 review M2: the save's status move reopened a won estimate at the
          // version that won — this document holds the edits; load it afresh.
          if (res.reopenedAtWon) {
            window.location.reload();
            return false;
          }
        }
        if (res.ok) {
          setActionError(null);
          setGateRefused(false);
          // #180 review 3 — a stale tab's status got silently refreshed;
          // shown alongside "Saved ✓", never implying the save failed.
          setActionNotice(res.notice || null);
          setJustSaved(true);
          if (savedTimer.current) clearTimeout(savedTimer.current);
          savedTimer.current = setTimeout(() => setJustSaved(false), 1800);
          return res.id ? res.updatedAt : false;
        } else {
          // The gate's own message (statusFailureMessage, D230) — the quote
          // itself saved; only the requested status advance was refused.
          setActionNotice(null);
          setActionError(res.error || "That save did not go through — nothing was written.");
          setGateRefused(false);
          return false;
        }
      } catch (e) {
        /* #143 re-review: a save that THROWS — a rejected request body, a
           dropped connection — used to be indistinguishable from a save that
           did nothing: no "Saved" flash, no banner, and every edit still
           only in memory. Say so instead. */
        console.error("[estimator] save failed:", e);
        setGateRefused(false);
        setActionError(
          "That save did not go through — nothing was written. Check your connection, or remove a large vendor-quote attachment, and try again."
        );
        return false;
      }
    }
  };
  const doSave = () => {
    if (tierResolvingRef.current) return;
    startTransition(async () => {
      await saveNow();
    });
  };

  const changeStatus = (v: QuoteStatus) => {
    const prevStatus = status;
    setStatus(v);
    if (loadedId) {
      const id = loadedId;
      setStatusChanging(true);
      startTransition(async () => {
        try {
          // #355 review I3: leaving Won with unsaved edits — save them first, so
          // the reopen's snapshot keeps them before the won version comes back.
          if (prevStatus === "won" && v !== "won" && pdfDirty && (await saveNow()) === false) {
            setStatus(prevStatus);
            return;
          }
          const r = await setStatusAction(id, v, v === "won" && alternatesTouched ? { alternatesTaken } : undefined);
          if (!r.ok) {
            // Punch #60: server rejected the transition (e.g. "won" without an
            // approval on record) — roll back the optimistic UI change and
            // surface why, instead of silently pretending it worked.
            setStatus(prevStatus);
            setActionError(r.error || "That status change was rejected.");
            setGateRefused(!!r.gateRefused);
            return;
          }
          setActionError(null);
          setGateRefused(false);
          applySync(r);
          postChanged("quote", id);
          // Batch 5 #59: the server put the won version back (the post-win edits are a
          // revision now) — this document holds the edits, so load the quote afresh.
          if (r.reopenedAtWon) {
            window.location.reload();
            return;
          }
          // #282 follow-up: the server cleared the credit when the quote went
          // Lost — take the line off the open document too.
          if (v === "lost") setSections((ss) => (rewardCreditOf(ss) > 0 ? withoutRewardCredit(ss) : ss));
          // Estimator bonuses: Won writes the record server-side — re-read it;
          // leaving Won clears it (applySync above already handled both when the
          // server echoed a status; this covers a reply without one).
          if (!r.status) syncBonusAfterStatus(prevStatus, v);
        } finally {
          setStatusChanging(false);
        }
      });
    }
  };

  /**
   * Daylite stage bar (Task 6). A stage move can change the quote's status
   * underneath (setQuoteStage runs the real setStatus when the stage's tag
   * differs) — optimistic-update both, and roll both back on a gate refusal,
   * mirroring changeStatus above exactly.
   */
  const changeStage = (stageId: string) => {
    if (!loadedId || status === "lost") return;
    const id = loadedId;
    const prevStage = stage;
    const prevStatus = status;
    setStage(stageId);
    setStatusChanging(true);
    startTransition(async () => {
      try {
        // #355 review I3: same as changeStatus — a stage move can leave Won.
        if (prevStatus === "won" && pdfDirty && (await saveNow()) === false) {
          setStage(prevStage);
          setStatus(prevStatus);
          return;
        }
        const r = await setQuoteStageAction(id, stageId, alternatesTouched ? alternatesTaken : undefined);
        if (!r.ok) {
          setStage(prevStage);
          setStatus(prevStatus);
          setActionError(r.error || "That stage change was rejected.");
          setGateRefused(!!r.gateRefused);
          return;
        }
        setActionError(null);
        setGateRefused(false);
        applyStageSync(r);
        postChanged("quote", id);
        if (r.reopenedAtWon) {
          window.location.reload();
          return;
        }
      } finally {
        setStatusChanging(false);
      }
    });
  };

  /** The pipeline select (Estimate/Design ⇄ BID SPEC) — draft only, lands on
   *  the new pipeline's first stage. */
  const changePipeline = (pid: string) => {
    if (!loadedId || status !== "draft") return;
    const id = loadedId;
    const prevPipelineId = pipelineId;
    const prevStage = stage;
    setPipelineId(pid);
    // Optimistic: setQuotePipeline always lands on the new pipeline's first
    // stage (never keeps the old one) — mirror that here too, so a chevron
    // stays highlighted through the round trip instead of the bar going
    // blank until applyStageSync's real value comes back.
    const target = pipelines.quote.find((p) => p.id === pid);
    if (target) setStage(firstStage(target).id);
    startTransition(async () => {
      const r = await setQuotePipelineAction(id, pid);
      if (!r.ok) {
        setPipelineId(prevPipelineId);
        setStage(prevStage);
        setActionError(r.error || "That pipeline change was rejected.");
        setGateRefused(false);
        return;
      }
      setActionError(null);
      setGateRefused(false);
      applyStageSync(r);
      postChanged("quote", id);
    });
  };

  /* ---------------- customer / venue / contact link ---------------- */
  const contacts = customerId
    ? customers.find((c) => c.id === customerId)?.contacts ?? []
    : [];
  const currentContact = (() => {
    if (!contacts.length || !contactName) return null;
    return (
      contacts.find((c) => c.name === contactName) ||
      contacts.find((c) => c.primary) ||
      contacts[0]
    );
  })();
  const locations = customerId
    ? customers.find((c) => c.id === customerId)?.locations ?? []
    : [];

  const pickCustomer = (id: string) => {
    const c = id ? customers.find((x) => x.id === id) : undefined;
    const prim = c ? c.locations.find((l) => l.primary) || c.locations[0] : undefined;
    const locId = prim?.id || null;
    const name = c ? c.name : custName;
    const pc = c ? c.contacts.find((ct) => ct.primary) || c.contacts[0] : undefined;
    const contact = pc ? pc.name : "";
    guardWonMeta("customer", () => {
      // #282 phase 2: Rewards credit belongs to one customer — a new
      // customer starts with none on this quote.
      if (id !== customerId) setSections((ss) => (rewardCreditOf(ss) > 0 ? withoutRewardCredit(ss) : ss));
      setCustomerId(id || null);
      setLocationId(locId);
      setCustName(name);
      setContactName(contact);
      persistMeta({ customerId: id || null, locationId: locId, customer: name, contactName: contact });
      resolveTierFor(id || null, contact);
      reapplyAutoTrips(id || null, locId);
      reapplyAutoFreight(id || null, locId);
    });
  };
  const pickVenue = (locId: string) => {
    guardWonMeta("venue", () => {
      setLocationId(locId || null);
      persistMeta({ locationId: locId || null });
      reapplyAutoTrips(customerId, locId || null);
      reapplyAutoFreight(customerId, locId || null);
    });
  };
  const pickContact = (name: string) => {
    guardWonMeta("contact", () => {
      setContactName(name || "");
      persistMeta({ contactName: name || "" });
      resolveTierFor(customerId, name || "");
    });
  };
  const onQuoteNote = (v: string) => {
    setQuoteNote(v);
    if (!loadedId) return;
    if (noteTimer.current) clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => persistMeta({ quoteNote: v }), 500);
  };
  const onAssumptions = (v: string) => {
    setAssumptions(v);
    if (!loadedId) return;
    if (assumptionsTimer.current) clearTimeout(assumptionsTimer.current);
    assumptionsTimer.current = setTimeout(() => persistMeta({ assumptions: v }), 500);
  };
  // #301: autosaved like the cover note so the Cover PDF reflects them without a full Save.
  const onCoverSummary = (v: string) => {
    setCoverSummary(v);
    if (!loadedId) return;
    if (coverSummaryTimer.current) clearTimeout(coverSummaryTimer.current);
    coverSummaryTimer.current = setTimeout(() => persistMeta({ coverSummary: v }), 500);
  };
  const onNotIncluded = (v: string) => {
    setNotIncluded(v);
    if (!loadedId) return;
    if (notIncludedTimer.current) clearTimeout(notIncludedTimer.current);
    notIncludedTimer.current = setTimeout(() => persistMeta({ notIncluded: v }), 500);
  };
  const toggleAssumption = (line: string) => {
    const current = assumptions.split("\n").map((item) => item.trim()).filter(Boolean);
    const next = checkedAssumptions.has(line)
      ? current.filter((item) => item !== line)
      : [...current, line];
    onAssumptions(next.join("\n"));
  };
  const onInstallTimeframe = (v: string) => {
    setInstallTimeframe(v);
    persistMeta({ installTimeframe: v });
  };

  /* ---------------- sections & items ---------------- */
  const isExpanded = (id: string) => expanded[id] !== false;
  const toggleExpand = (id: string) => setExpandedRemembered({ ...expanded, [id]: !isExpanded(id) });

  /** Estimator bonuses: an automatic bonus line is read-only — every
   *  line-level writer below refuses it (the effect re-derives it). */
  const isBonusId = (id: number) => sections.some((s) => s.items.some((x) => x.id === id && isBonusItem(x)));
  const patchItem = (id: number, f: (it: SpecItem) => SpecItem) => {
    if (isBonusId(id)) return;
    setSections((ss) =>
      ss.map((s) =>
        s.items.some((x) => x.id === id)
          ? { ...s, items: s.items.map((x) => (x.id === id ? f(x) : x)) }
          : s
      )
    );
  };
  const setItemPrice = (id: number, value: string) => {
    const price = Number(value.replace(/[$,\s]/g, ""));
    if (!Number.isFinite(price) || price < 0) return;
    patchItem(id, (it) => ({ ...it, ...priceFromUnitSellEdit(price) }));
  };
  const setItemSpecKey = (id: number, value: string) =>
    patchItem(id, (it) => ({ ...it, specKey: value || undefined }));
  const setItemExtSell = (id: number, value: string) => {
    const ext = Number(value.replace(/[$,\s]/g, ""));
    if (!Number.isFinite(ext) || ext < 0) return;
    patchItem(id, (it) => ({ ...it, ...backSolveExtSell(ext, it.qty) }));
  };
  const moveItem = (secId: string, id: number, direction: -1 | 1) => {
    if (isBonusId(id)) return;
    setSections((ss) => ss.map((s) => {
      if (s.id !== secId) return s;
      const index = s.items.findIndex((item) => item.id === id);
      const next = index + direction;
      if (index < 0 || next < 0 || next >= s.items.length) return s;
      const items = [...s.items];
      [items[index], items[next]] = [items[next], items[index]];
      return { ...s, items: items.map((item, i) => ({ ...item, lineOrder: i })) };
    }));
  };
  const inc = (id: number) => patchItem(id, (it) => ({ ...it, qty: it.qty + 1 }));
  const dec = (id: number) => patchItem(id, (it) => ({ ...it, qty: Math.max(0, it.qty - 1) }));
  const setQty = (id: number, v: string) => {
    let n = parseInt(v, 10);
    if (isNaN(n) || n < 0) n = 0;
    patchItem(id, (it) => ({ ...it, qty: n }));
  };
  const removeItem = (id: number) => {
    if (isBonusId(id)) return;
    // #143: the × on a vendor line takes its VendorQuote record with it —
    // otherwise the attachment and the internal terms outlive the money.
    const gone = sections.flatMap((s) => s.items).find((x) => x.id === id);
    if (gone?.vendorQuoteId)
      setVendorQuotes((vs) => vs.filter((v) => v.id !== gone.vendorQuoteId));
    // #269: a labor group's stored draft goes with its LAST line.
    setSections((ss) => ss.map((s) => pruneLaborGroups({ ...s, items: s.items.filter((x) => x.id !== id) })));
  };

  // #267: both markup sliders re-price the lines AND drop a typed system sell.
  const setMarkupAll = (v: string) => {
    const k = parseInt(v, 10) / 100;
    setSections((ss) =>
      ss.map((s) => ({
        ...clearSellOverride(s),
        // #282 phase 2: the Rewards credit is not a priced line.
        items: s.items.map((it) => (isRewardCreditItem(it) || isBonusItem(it) ? it : { ...it, ...repriceAtMarkup(it.cost, k) })),
      }))
    );
  };
  const setSystemMarkup = (secId: string, v: string) => {
    const k = parseFloat(v) / 100;
    setSections((ss) =>
      ss.map((s) =>
        s.id === secId
          ? { ...clearSellOverride(s), items: s.items.map((it) => (isRewardCreditItem(it) || isBonusItem(it) ? it : { ...it, ...repriceAtMarkup(it.cost, k) })) }
          : s
      )
    );
  };
  /** #267: the Sell box — a typed system price used exactly; the line prices
   *  are untouched. Empty, 0 or junk clears it (back to auto). */
  const setSystemSell = (secId: string, raw: string) => {
    const o = parseSellOverride(raw);
    setSections((ss) =>
      ss.map((s) => (s.id !== secId ? s : o == null ? clearSellOverride(s) : { ...s, sellOverride: o }))
    );
  };
  const resetSystemSell = (secId: string) =>
    setSections((ss) => ss.map((s) => (s.id === secId ? clearSellOverride(s) : s)));
  /** #267: a sent/won system opts into the $25 round-up. */
  const roundSystemPrice = (secId: string) =>
    setSections((ss) => ss.map((s) => (s.id === secId ? { ...s, priceRound: SYSTEM_PRICE_STEP } : s)));
  const setFreightPct = (secId: string, val: string) => {
    let v = parseFloat(val);
    if (isNaN(v) || v < 0) v = 0;
    // #245 final review: 30 matches the Estimating Rules freight-cap max
    // (src/lib/stores/pricing.ts FREIGHT_RATE_IDS.cap, min:0/max:30) — the
    // old 15 ceiling meant an auto-applied cap above 15% (an admin can set
    // the rule's cap up to 30) could never be typed back in by hand.
    if (v > 30) v = 30;
    // #245: a hand-set freight % opts this section out of the distance-rule
    // auto-updates a later venue change would otherwise re-apply.
    setSections((ss) => ss.map((s) => (s.id === secId ? { ...s, freightPct: v, freightAuto: false } : s)));
  };
  const renameSystem = (secId: string, name: string) =>
    setSections((ss) => ss.map((s) => (s.id === secId ? { ...s, name } : s)));
  // #262: stored raw, like narrative — partsListRows trims on export.
  const setSystemRoom = (secId: string, room: string) =>
    setSections((ss) => ss.map((s) => (s.id === secId ? { ...s, room } : s)));
  const setSystemPresentation = (secId: string, presentation: "itemized" | "narrative") =>
    setSections((ss) => ss.map((s) => (s.id === secId ? { ...s, presentation } : s)));
  const deleteSystem = (secId: string) => {
    // #282 phase 2: the Rewards credit is the quote's — it moves to the new last system.
    const list = withRewardCredit(sections.filter((s) => s.id !== secId), rewardCreditOf(sections), nextId());
    setSections(list);
    setActiveId((a) => (a === secId ? (list[0] ? list[0].id : null) : a));
  };

  /** "Move…" — sibling of deleteSystem. Removes the system locally (same as
   *  delete; only persisted on the source when the user hits Save) once the
   *  server confirms it landed in the target estimate. */
  const moveSystem = (secId: string, target: MoveSystemTarget) => {
    const sec = sections.find((s) => s.id === secId);
    if (!sec) return;
    const cname = customerId
      ? customers.find((c) => c.id === customerId)?.name || custName
      : custName;
    setMoveNotice(null);
    /* #143: a vendor line's file, terms, notes and material list live on a
       VendorQuote record beside the spec, so they travel WITH the section —
       otherwise the target showed a bare line and the source's next save
       pruned the only copy of the vendor's PDF away. */
    const movedVqIds = new Set(
      sec.items.map((it) => it.vendorQuoteId).filter((id): id is string => !!id)
    );
    const movedVq = vendorQuotes.filter((v) => movedVqIds.has(v.id));
    startTransition(async () => {
      const res = await moveSystemToEstimateAction(
        sec,
        target,
        {
          customerId: customerId || null,
          locationId: locationId || null,
          customer: cname,
          contactName: contactName || "",
        },
        movedVq,
        // #348 slice 3: the server reads the stored source quote's lead + companies; an unsaved estimate has none.
        loadedId || null,
        // #366: a NEW estimate carries the discounts for this system's SKUs (an existing one applies its own).
        projectDiscounts
      );
      if (res.ok) {
        postChanged("quote", res.targetId);
        // #282 phase 2: the Rewards credit stays on this quote (the server
        // never moves it with a system).
        const list = withRewardCredit(sections.filter((s) => s.id !== secId), rewardCreditOf(sections), nextId());
        setSections(list);
        if (movedVq.length) setVendorQuotes((vs) => vs.filter((v) => !movedVqIds.has(v.id)));
        setActiveId((a) => (a === secId ? (list[0] ? list[0].id : null) : a));
        setMoveNotice({ ok: true, targetId: res.targetId, targetName: res.targetName, targetNumber: res.targetNumber });
      } else {
        setMoveNotice({ ok: false, error: res.error || "Could not move that system." });
      }
    });
  };

  /** #266: "Copy…" — sibling of moveSystem. The server re-prices the copy
   *  (today's catalog costs, then the destination customer's tier). New /
   *  existing leave this estimate untouched; "same" appends the returned
   *  section right after the source, unsaved until the user hits Save. */
  const copySystem = (secId: string, target: CopySystemTarget) => {
    const sec = sections.find((s) => s.id === secId);
    if (!sec) return;
    const cname = customerId
      ? customers.find((c) => c.id === customerId)?.name || custName
      : custName;
    setMoveNotice(null);
    // Vendor records are shared by id (never duplicated) — the copy points at the same ones.
    const usedVqIds = new Set(
      sec.items.map((it) => it.vendorQuoteId).filter((id): id is string => !!id)
    );
    const usedVq = vendorQuotes.filter((v) => usedVqIds.has(v.id));
    startTransition(async () => {
      const res = await copySystemToEstimateAction(
        sec,
        target,
        {
          customerId: customerId || null,
          locationId: locationId || null,
          customer: cname,
          contactName: contactName || "",
          tierMargin: tierMarginRef.current,
        },
        usedVq,
        // #348 slice 6: the server reads the stored source's Scope-only state; an unsaved estimate has none.
        loadedId || null,
        // #366: as Move — "same" comes back at normal cost and this builder's map re-applies.
        projectDiscounts
      );
      if (!res.ok) {
        setMoveNotice({ ok: false, error: res.error || "Could not copy that system." });
        return;
      }
      const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
      const parts: string[] = [];
      if (res.costsUpdated > 0) parts.push(`${plural(res.costsUpdated, "part")} updated to today's cost`);
      if (res.tierRepriced > 0) {
        const tier = res.kind === "same" ? null : res.tierLabel;
        parts.push(`${plural(res.tierRepriced, "line")} re-priced${tier ? " to " + tier : ""}`);
      }
      const detail = parts.length ? parts.join(" · ") : "prices already current";
      if (res.kind === "same") {
        const newId = sections.some((s) => s.id === res.section.id) ? "sys" + nextId() : res.section.id;
        // #293: item ids are re-minted, so key-product blocks follow them.
        const idMap = new Map<number, number>();
        const copyItems = res.section.items.map((it) => {
          const nid = nextId();
          idMap.set(it.id, nid);
          return { ...it, id: nid };
        });
        // Phase 2a: a copy within this estimate joins the source's group (never built).
        const copy: SpecSection = withKeyProducts(
          withoutBuilt({ ...res.section, id: newId, name: sec.name + " (copy)", items: copyItems, ...(sec.groupId ? { groupId: sec.groupId } : {}) }),
          remapKeyProducts(res.section.keyProducts, idMap)
        );
        setSections((ss) => {
          const at = ss.findIndex((s) => s.id === secId);
          return normalizeSystemOrder(at < 0 ? [...ss, copy] : [...ss.slice(0, at + 1), copy, ...ss.slice(at + 1)], groups);
        });
        requestAnimationFrame(() => requestAnimationFrame(() => selectSystem(newId)));
        setMoveNotice({ ok: true, targetId: "", targetName: "", targetNumber: "", verb: "Copied", detail });
      } else {
        postChanged("quote", res.targetId);
        setMoveNotice({
          ok: true,
          targetId: res.targetId,
          targetName: res.targetName,
          targetNumber: res.targetNumber,
          verb: "Copied",
          detail,
        });
      }
    });
  };
  /** #357: move ticked lines (and their partners) to another system here or a
   *  new one. Client-only — kept by the next Save, like ↑/↓. */
  const moveLinesHere = (selected: LineRef[], target: { kind: "system"; sectionId: string } | { kind: "new"; name: string }) => {
    const resolved = target.kind === "new" ? { kind: "new" as const, id: "sys" + nextId(), name: target.name.trim() || "New System" } : target;
    // Ids are unique per system only: a line whose id the target already holds lands with a fresh one.
    const { sections: next, plan, moved } = applyLineMove(sections, selected, resolved, { mintItemId: nextId });
    if (plan.noop) return;
    // The package document's product blocks / images / line-quantity chips follow their lines (system, and a
    // re-minted id) — through the same setter as #312's re-anchor, saved with the next Save. No document: nothing.
    const nd = reanchorPackageDoc(packageDocRef.current, moved);
    if (nd !== packageDocRef.current) setPackageDoc(nd);
    // The over-cap draft (restored on return to Build package) follows too.
    const od = reanchorPackageDoc(packageDocOverDraft as PackageDoc | null, moved);
    if (od !== packageDocOverDraft) setPackageDocOverDraft(od);
    const targetId = resolved.kind === "new" ? resolved.id : resolved.sectionId;
    const targetName = resolved.kind === "new" ? resolved.name : sections.find((s) => s.id === targetId)?.name || "that system";
    // Same order as reorderSections: a system inserted last must not leave the Rewards credit off the last row.
    setSections(withRewardCredit(normalizeSystemOrder(next, groups), rewardCreditOf(sections), nextId()));
    const n = plan.lines.length;
    setMoveNotice({ ok: true, targetId: "", targetName: "", targetNumber: "", verb: "Lines", detail: `Moved ${n} line${n === 1 ? "" : "s"} to ${targetName}` });
    requestAnimationFrame(() => requestAnimationFrame(() => selectSystem(targetId)));
  };

  /** #357: move ticked lines to another estimate — bundled as one section and
   *  sent through Move system's own server path; they leave this estimate only
   *  once the server confirms. */
  const moveLinesToEstimate = (selected: LineRef[], dest: MoveSystemTarget) => {
    const plan = planLineMove(sections, selected, { kind: "estimate" });
    if (plan.noop || movingLines) return;
    // Lines from two systems may share an id: the outgoing section gets them unique (the server re-ids against the target).
    const outgoing = extractLinesAsSection(sections, plan, { mintItemId: nextId });
    const usedVqIds = new Set(outgoing.items.map((it) => it.vendorQuoteId).filter((id): id is string => !!id));
    const usedVq = vendorQuotes.filter((v) => usedVqIds.has(v.id));
    const cname = customerId ? customers.find((c) => c.id === customerId)?.name || custName : custName;
    setMoveNotice(null);
    setMovingLines(true);
    startTransition(async () => {
      try {
        const res = await moveSystemToEstimateAction(
          outgoing,
          dest,
          { customerId: customerId || null, locationId: locationId || null, customer: cname, contactName: contactName || "" },
          usedVq,
          loadedId || null,
          projectDiscounts // #366
        );
        if (!res.ok) {
          setMoveNotice({ ok: false, error: res.error || "Could not move those lines." });
          return;
        }
        postChanged("quote", res.targetId);
        const gone = new Set(plan.lines.map(lineRefKey));
        const stillUsed = new Set(
          sectionsRef.current
            .flatMap((s) => s.items.filter((it) => !gone.has(lineRefKey({ sectionId: s.id, id: it.id }))))
            .map((it) => it.vendorQuoteId)
            .filter((id): id is string => !!id)
        );
        setSections((ss) => removeLinesFromSources(ss, plan.lines));
        if (usedVq.length) setVendorQuotes((vs) => vs.filter((v) => !usedVqIds.has(v.id) || stillUsed.has(v.id)));
        setMoveNotice({ ok: true, targetId: res.targetId, targetName: res.targetName, targetNumber: res.targetNumber });
      } catch {
        setMoveNotice({ ok: false, error: "Could not move those lines." });
      } finally {
        setMovingLines(false);
      }
    });
  };
  const searchQuotes = (q: string) => searchQuotesAction(q, loadedId);

  const scrollToCard = (id: string) => {
    const el = cardRefs.current[id];
    const sc = scrollRef.current;
    if (el && sc) sc.scrollTo({ top: el.offsetTop - 12, behavior: "smooth" });
  };
  const selectSystem = (id: string) => {
    setActiveId(id);
    scrollToCard(id);
  };
  const addSystem = () => {
    const id = "sys" + nextId();
    // Phase 2a: a new system joins the active system's group ("+ Add system" under a group stays in it).
    const groupId = sections.find((s) => s.id === activeId)?.groupId;
    setSections((ss) => normalizeSystemOrder([
      ...ss,
      { id, name: "New System", kind: "materials", mfr: "", freightPct: freightDefault.pct, freightAuto: true, priceRound: SYSTEM_PRICE_STEP, presentation: newSystemPresentation(ss, boxSale), items: [], ...(groupId ? { groupId } : {}) },
    ], groups));
    setActiveId(id);
    openInputMethod("catalog", id);
    requestAnimationFrame(() => requestAnimationFrame(() => scrollToCard(id)));
  };
  /** Phase 6: "Add a system" on a category — the pure builder makes the system
   *  (named after the category, its discipline, the picked parts priced like
   *  addPart, joining the active system's group); placement is addSystem's. */
  const addSystemFromCategory = (categoryId: string, picks: Array<{ sku: string; qty: number }>) => {
    const category = initial.systemCategories.find((c) => c.id === categoryId);
    if (!category) return;
    const groupId = sections.find((s) => s.id === activeId)?.groupId;
    const sec = systemFromCategory(category, picks, {
      nextId,
      tierMargin,
      price: catalogAddPrice,
      groupId,
      freightPct: freightDefault.pct,
      priceRound: SYSTEM_PRICE_STEP,
      presentation: newSystemPresentation(sections, boxSale),
    });
    setSections((ss) => normalizeSystemOrder([...ss, sec], groups));
    setActiveId(sec.id);
    setAddSystemOpen(false);
    // Nothing picked (or nothing resolvable): open the catalog picker exactly like Blank system / addSystem.
    if (sec.items.length === 0) openInputMethod("catalog", sec.id);
    requestAnimationFrame(() => requestAnimationFrame(() => scrollToCard(sec.id)));
  };
  /* ---------------- Estimate suggestion: the Suggested BOM panel (spec 2026-10-13 §2) ---------------- */
  const suggestionLookup = useMemo(() => new Map(Object.entries(suggestionParts ?? ({} as SuggestionParts))), [suggestionParts]);
  /** The system each suggestion system's lines last went to (the line "+"'s default target). */
  const [suggestionTargets, setSuggestionTargets] = useState<Record<string, string>>({});
  /** "+ Add system" on a suggestion system: built like Add a system → category
   *  (live parts at catalogAddPrice and the tier, the active group; a missing
   *  part lands as an unpriced "Suggested: needs a part and price" line). */
  const addSuggestedSystem = (systemKey: string) => {
    const sys = suggestion?.systems.find((x) => x.key === systemKey);
    if (!sys) return;
    const groupId = sections.find((s) => s.id === activeId)?.groupId;
    const sec = systemFromSuggestion(sys, suggestionLookup, {
      nextId,
      tierMargin,
      price: catalogAddPrice,
      groupId,
      freightPct: freightDefault.pct,
      priceRound: SYSTEM_PRICE_STEP,
      presentation: newSystemPresentation(sections, boxSale),
    });
    setSections((ss) => normalizeSystemOrder([...ss, sec], groups));
    setSuggestionTargets((m) => ({ ...m, [systemKey]: sec.id }));
    setActiveId(sec.id);
    requestAnimationFrame(() => requestAnimationFrame(() => scrollToCard(sec.id)));
  };
  /** "+" on one suggestion line: a live part goes through addPart (same price
   *  as the catalog picker); a custom / gone part lands as an unpriced custom line. */
  const addSuggestedLine = (systemKey: string, lineKey: string, targetSecId: string) => {
    const line = suggestion?.systems.find((x) => x.key === systemKey)?.lines.find((l) => l.key === lineKey);
    if (!line || !sections.some((s) => s.id === targetSecId)) return;
    const part = !line.custom && line.sku ? suggestionLookup.get(line.sku) : undefined;
    if (part) addPart(targetSecId, { sku: part.sku, desc: part.desc, cost: part.cost, price: part.list, unit: part.unit || "ea" }, line.qty);
    else pushItems(targetSecId, [itemFromSuggestionLine(line, suggestionLookup, { nextId, tierMargin, price: catalogAddPrice })]);
    setSuggestionTargets((m) => ({ ...m, [systemKey]: targetSecId }));
  };
  const suggestionTargetFor = (systemKey: string) => defaultSuggestionTarget(systemKey, suggestionTargets, sections.map((s) => s.id), activeId);
  /** ✓ added — derived from the estimate as it stands (nothing stored). */
  const suggestionAdded = useMemo(
    () => (suggestion ? addedState(suggestion, sections, suggestionLookup) : {}),
    [suggestion, sections, suggestionLookup]
  );
  /** Open on a new estimate, collapsed on a saved quote; this browser's choice
   *  wins. Read ONCE per suggestion id after mount (hydration-safe), judged by
   *  whether the quote was saved AT MOUNT — a save giving it an id (and the
   *  refresh after it) never re-reads, so the panel can't collapse mid-session.
   *  Only Hide / Show writes a value (toggleSuggestOpen). */
  const [suggestOpen, setSuggestOpen] = useState(() => suggestPanelOpen(null, !!initial.loadedId));
  const suggestSavedAtMount = useRef(!!initial.loadedId);
  const suggestReadFor = useRef<string | null>(null);
  const suggestionKeyId = suggestion?.id ?? null;
  useEffect(() => {
    if (!suggestionKeyId || suggestReadFor.current === suggestionKeyId) return;
    suggestReadFor.current = suggestionKeyId;
    try {
      setSuggestOpen(suggestPanelFirstRead(window.localStorage.getItem(suggestPanelKey(suggestionKeyId)), suggestSavedAtMount.current));
    } catch {
      /* storage unavailable — keep the default */
    }
  }, [suggestionKeyId]);
  /** Linked by a save in this session (the page's `suggestion.linked` covers earlier ones). */
  const suggestionLinkedRef = useRef(false);
  const toggleSuggestOpen = () => {
    const next = !suggestOpen;
    setSuggestOpen(next);
    if (!suggestion) return;
    try {
      window.localStorage.setItem(suggestPanelKey(suggestion.id), next ? "1" : "0");
    } catch {
      /* ignore */
    }
  };

  /* ---------------- Phase 2a: groups, moves, built ---------------- */
  /** Every reorder writes through here: the Rewards credit re-pins to the new
   *  last system, exactly like deleteSystem. A no-op (same reference) writes nothing. */
  const reorderSections = (list: SpecSection[]) => {
    if (list === sections) return;
    setSections(withRewardCredit(list, rewardCreditOf(sections), nextId()));
  };
  /** + Add group — returns the new group's id, or null at the 20-group cap. */
  const addGroupAction = (name?: string): string | null => {
    const id = newGroupId();
    const next = addGroup(groups, name, id);
    if (next === groups) return null;
    setGroups(next);
    return id;
  };
  /** The card's "+ New group": creates an Untitled group and moves this system
   *  into it in ONE render — setSystemGroup right after addGroupAction would
   *  read the old `groups` and refuse the (still unknown) target. Returns the
   *  new group's id, or null at the 20-group cap. */
  const addGroupForSystem = (secId: string): string | null => {
    const id = newGroupId();
    const next = addGroup(groups, undefined, id);
    if (next === groups) return null;
    setGroups(next);
    reorderSections(moveSystemTo(sections, next, secId, { groupId: id, beforeId: null }));
    return id;
  };
  const renameGroupAction = (id: string, name: string) => {
    const next = renameGroup(groups, id, name);
    if (next !== groups) setGroups(next);
  };
  const moveGroupByAction = (id: string, delta: -1 | 1) => {
    const next = moveGroupBy(groups, id, delta);
    if (next === groups) return;
    setGroups(next);
    reorderSections(normalizeSystemOrder(sections, next));
  };
  /** Phase 2b: In total / Alternate. Re-normalises at once so every system in
   *  the group gains/loses its `alternate` stamp (and the Rewards credit
   *  re-pins inside reorderSections) in the same render. */
  const setGroupAlternateAction = (id: string, alternate: boolean) => {
    const next = setGroupAlternate(groups, id, alternate);
    if (next === groups) return;
    setGroups(next);
    reorderSections(normalizeSystemOrder(sections, next));
  };
  /** Removing a group keeps its systems — they become ungrouped. */
  const removeGroupAction = (id: string) => {
    const res = removeGroup(sections, groups, id);
    if (res.groups === groups) return;
    setGroups(res.groups);
    reorderSections(res.sections);
  };
  const moveSystemToAction = (id: string, target: { groupId: string | null; beforeId: string | null }) =>
    reorderSections(moveSystemTo(sections, groups, id, target));
  const moveSystemByAction = (id: string, delta: -1 | 1) => reorderSections(moveSystemBy(sections, groups, id, delta));
  /** The card's Group select: lands last in the chosen group (null = Ungrouped). */
  const setSystemGroup = (secId: string, groupId: string | null) =>
    reorderSections(moveSystemTo(sections, groups, secId, { groupId, beforeId: null }));
  /** ✓ Mark built & collapse. Written through setSections: unmarkEdited keeps
   *  `built` when it is the only change, by construction. */
  const markBuilt = (secId: string) => {
    setSections((ss) => ss.map((s) => (s.id === secId && !s.built ? { ...s, built: true as const } : s)));
    setExpandedRemembered({ ...expanded, [secId]: false });
  };
  const isBuilt = (secId: string) => sections.some((s) => s.id === secId && s.built === true);

  /** #293 slice 2: Load system — the server re-read and re-priced the library
   *  system (today's catalog, this estimate's tier, vendor-quote lines left
   *  out). Here it gets fresh ids (blocks follow), lands after the active
   *  system like Copy here, and is selected; Save persists it. */
  const placeLibrarySystem = (res: LoadedLibrarySystem) => {
    const newId = "sys" + nextId();
    const loaded = placeLoadedSection(res.section, { id: newId, nextId, autoFreightPct: freightDefault.pct });
    // Phase 2a: it joins the active system's group (the library copy carries none, never built).
    const groupId = sections.find((s) => s.id === activeId)?.groupId;
    const placed: SpecSection = groupId ? { ...loaded, groupId } : loaded;
    setSections((ss) => {
      const at = ss.findIndex((s) => s.id === activeId);
      return normalizeSystemOrder(at < 0 ? [...ss, placed] : [...ss.slice(0, at + 1), placed, ...ss.slice(at + 1)], groups);
    });
    setLibraryOpen(false);
    requestAnimationFrame(() => requestAnimationFrame(() => selectSystem(newId)));
    setMoveNotice({ ok: true, targetId: "", targetName: "", targetNumber: "", verb: "Loaded", detail: loadNotice(res) });
  };

  const pushItems = (secId: string, items: SpecItem[]) =>
    setSections((ss) =>
      ss.map((s) => (s.id === secId ? { ...s, items: [...s.items, ...items] } : s))
    );

  /** #160: a catalog add carries its qty and keeps the picker OPEN (rapid-fire);
   *  the panel closes only via its toggle or ×. */
  const addPart = (secId: string, cat: SuggestPart, qty = 1) => {
    const n = Math.max(1, Math.floor(qty) || 1);
    pushItems(secId, [
      { id: nextId(), sku: cat.sku, desc: cat.desc, qty: n, unit: cat.unit, cost: cat.cost, price: catalogAddPrice(cat.cost, cat.price, tierMargin) },
    ]);
  };

  /* ---- CSV batch-add (#112) ----
     Rows carrying a SKU are priced from the catalog: blank description/unit
     fill from the part, a $0 cost takes the catalog cost, and a $0 sell is
     seeded from cost with the same margin rule addPart uses. Anything the
     file states explicitly wins. SKUs the catalog doesn't know keep their
     CSV numbers and land as custom lines, exactly as before. */
  const importMaterials = async (
    secId: string,
    items: ImportedMaterial[]
  ): Promise<{ fromCatalog: number; custom: number }> => {
    const skus = Array.from(new Set(items.map((item) => item.sku.trim()).filter(Boolean)));
    const resolved = skus.length ? await resolveCatalogSkusAction(skus) : {};
    let fromCatalog = 0;
    const next: SpecItem[] = items.map((item) => {
      const hit = item.sku.trim() ? resolved[item.sku.trim()] : undefined;
      if (!hit) return { ...item, id: nextId(), desc: item.desc || item.sku, unit: item.unit || "ea", custom: true };
      fromCatalog++;
      const cost = item.cost > 0 ? item.cost : hit.cost;
      const price = item.price > 0 ? item.price : catalogAddPrice(cost, hit.list, tierMargin);
      return {
        ...item,
        id: nextId(),
        sku: hit.sku,
        desc: item.desc || hit.desc,
        unit: item.unit || hit.unit,
        cost,
        price,
      };
    });
    pushItems(secId, next);
    return { fromCatalog, custom: next.length - fromCatalog };
  };

  /* #363: More ▾ → Review spreadsheet (was Parts list (CSV), #262) — the
     parts list as an .xlsx with links, markup formulas and per-system cost /
     markup / fees subtotals; exceljs loads on demand inside downloadReviewSheet. */
  const [reviewBusy, setReviewBusy] = useState(false);
  const exportReviewSheet = async () => {
    if (reviewBusy) return;
    setReviewBusy(true);
    try {
      const skus = partsListSkus(sections);
      const resolved = skus.length ? await resolveCatalogSkusAction(skus) : {};
      const info: Record<string, PartInfo> = {};
      for (const [sku, r] of Object.entries(resolved)) {
        info[sku] = {
          desc: r.desc,
          mfr: r.mfr,
          manufacturerPartNumber: r.manufacturerPartNumber,
          manufacturerModelNumber: r.manufacturerModelNumber,
        };
      }
      const blocks = reviewSheetModel(sections, vendorQuotes, info, venueRoomName, projectDiscounts); // #366: + the project-pricing notes
      if (!blocks.length) {
        setActionError(null);
        setGateRefused(false);
        setActionNotice("No parts to export yet.");
        return;
      }
      const name = loadedId ? quoteId : projectName || quoteId;
      await downloadReviewSheet(fileStem(name, "estimate"), blocks);
    } catch {
      setActionError("Couldn't build the review spreadsheet — try again.");
      setGateRefused(false);
    } finally {
      setReviewBusy(false);
    }
  };

  /* #305 — the Quote details panel's Category field commits on blur (trimmed;
     persisted only when it changed). Lives here so the ref write stays in the hook. */
  const commitCategory = () => {
    const v = category.trim();
    if (v !== category) setCategory(v);
    if (v === categorySaved.current) return;
    categorySaved.current = v;
    persistMeta({ category: v });
  };

  /* #305 — the ⋯ menu's Cut sheets: save first when the PDF is out of date, then open in a new tab. */
  const openCutSheets = async () => {
    if (!loadedId) return;
    const href = `/estimator/cut-sheets?id=${encodeURIComponent(loadedId)}`;
    if (!pdfDirty) {
      window.open(href, "_blank", "noopener");
      return;
    }
    // Opened inside the click so it isn't popup-blocked; navigated after the save lands.
    const w = window.open("", "_blank");
    const saved = await saveNow();
    if (!w) return;
    if (saved === false) w.close();
    else w.location.href = href;
  };

  /* ---- Scope draft from survey/inspection (S12/D83 — rules-based) ----
     Deterministic: the linked record's captured fields are assembled into a
     scope paragraph (no model call, no line items — Jeff adds items
     manually). "Insert scope" appends the paragraph to the quote note. */
  const aiTargetSection = (): SpecSection | null =>
    sections.find((s) => s.id === activeId) || sections[0] || null;

  /* #301 (R3): a page opened from a site visit (?surveyId=) copies that
     visit's Client goals into every system whose discipline (stored, else
     inferred) matches and whose goals are blank. Automatic, like the tier
     re-price, so it writes setSectionsState and leaves the #254 banner alone;
     fillClientGoals returns the same array when nothing matches (no dirty). */
  const goalsSurveyId = aiSource?.kind === "survey" ? aiSource.id : null;
  useEffect(() => {
    if (!goalsSurveyId) return;
    let live = true;
    // Raw state on purpose (not the setSections wrapper, which clears the #254
    // banner). Automatic, so — like the freight auto-apply — the same pre-fill
    // goes into a live re-price banner's Undo snapshot, or Undo would drop it.
    surveyGoalsAction(goalsSurveyId)
      .then((r) => {
        if (!live || !r.ok) return;
        setSectionsState((prev) => fillClientGoals(prev, r.goals));
        setTierReprice((n) => (n ? { ...n, before: fillClientGoals(n.before, r.goals) } : n));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [goalsSurveyId]);

  const runAiDraft = () => {
    if (!aiSource) return;
    setAiBusy(true);
    setAiErr(null);
    startTransition(async () => {
      const res = await draftQuoteScopeAction(
        aiSource.kind === "survey"
          ? { surveyId: aiSource.id }
          : { inspectionId: aiSource.id }
      );
      if (res.ok) {
        setAiScope(res.scope);
        setAiLines(res.lines);
      } else {
        setAiErr(res.error);
      }
      setAiBusy(false);
    });
  };

  const openAiDraft = () => {
    setAiOpen(true);
    setAiScopeInserted(false);
    setAiAdded({});
    setAiScope(null);
    setAiLines(null);
    runAiDraft();
  };

  const insertAiScope = () => {
    if (aiScope == null) return;
    const cur = (quoteNote || "").trim();
    onQuoteNote(cur ? cur + "\n\n" + aiScope : aiScope);
    setAiScopeInserted(true);
  };

  const addAiLine = (index: number, line: DraftedLine) => {
    const target = aiTargetSection();
    if (!target) return;
    const qty = Number.isFinite(line.qty) && line.qty > 0 ? line.qty : 1;
    // Price/cost left at 0 — the estimator sets pricing (guardrail D6).
    pushItems(target.id, [
      {
        id: nextId(),
        sku: "AI",
        desc: line.description,
        qty,
        unit: (line.unit || "ea").trim() || "ea",
        cost: 0,
        price: 0,
        custom: true,
      },
    ]);
    setAiAdded((m) => ({ ...m, [index]: true }));
  };

  /* ---------------- add-flows (portals + modals) ----------------
     One coordinator for all six input methods, so "click a different input
     method" is a single, uniform transition: discard the OUTGOING draft, seed
     the INCOMING one, write the descriptor. Every close path — the same button
     clicked again, a modal's × or scrim, a successful add — goes through
     closeInput(), so none of them leave a typed draft alive in memory. */

  /** Reset one method's draft to its fresh seed. Catalog owns no shared draft
   *  (CatalogPicker unmounts, taking its query with it) — and since #143 it
   *  also hosts the CSV importer, whose only state is SectionCard's result
   *  banner, which deliberately OUTLIVES the panel: an import closed
   *  mid-flight still has to report what it did. */
  const discardDraft = (kind: InputKind, secId: string) => {
    if (kind === "custom") {
      setCustomDraft(freshCustom());
      setCustomError("");
      customEditRef.current = null;
      setCustomEdit(null);
    } else if (kind === "curtain") {
      setCurtainDraft(freshCurtain(defaultFabric));
      setCurtainTrack(null);
      curtainEditRef.current = null;
      setCurtainEdit(null);
    } else if (kind === "track") {
      // #274: an abandoned track edit must not seed the next "+ Configure track".
      trackEditRef.current = null;
      setTrackEdit(null);
      setTrackDraft(freshTrackDraft(trackSeries));
    } else if (kind === "fixture") setFixtureDraft(freshFixture());
    else if (kind === "vendor") {
      // #144: an abandoned edit must not seed the next "+ Vendor quote".
      vendorEditRef.current = null;
      // #348 slice 4: nor an abandoned email hand-off.
      vendorSeedRef.current = null;
      setVendorHandoff(null);
      setVendorDraft(freshVendor());
      resetVendorPdf();
    } else if (kind === "labor") {
      // #269: an abandoned labor edit must not seed the next "+ Labor".
      laborEditRef.current = null;
      setLaborEdit(null);
      setLaborDraft(
        freshLabor(travelEstNow(), tierMargin, sections.find((s) => s.id === secId)?.name || "")
      );
    }
  };

  /** Seed the incoming method's draft (the prototype defaults each had). */
  const seedDraft = (kind: InputKind, secId: string) => {
    if (kind === "custom") {
      const edit = customEditRef.current;
      customEditRef.current = null;
      setCustomEdit(edit ? { lineId: edit.lineId } : null);
      setCustomDraft(edit ? edit.draft : freshCustom());
      setCustomError("");
    } else if (kind === "curtain") {
      const edit = curtainEditRef.current;
      curtainEditRef.current = null;
      setCurtainEdit(edit ? { lineId: edit.lineId, linkedTrack: edit.linkedTrack } : null);
      setCurtainDraft(edit ? edit.draft : freshCurtain(defaultFabric));
      setCurtainTrack(null);
    } else if (kind === "track") {
      /* #274: reopened from a track line — its stored config, consumed and
         CLEARED here so it applies to exactly one open (as labor, #269). */
      const edit = trackEditRef.current;
      trackEditRef.current = null;
      setTrackEdit(edit ? { lineId: edit.lineId, readOnly: edit.readOnly } : null);
      setTrackDraft(edit ? edit.draft : freshTrackDraft(trackSeries));
    } else if (kind === "vendor") {
      /* #144: the pending edit seed, consumed and CLEARED here so it applies to
         exactly one open. With none set — or a record since deleted — this is
         the unchanged blank form. */
      /* #348 slice 4: the email hand-off's blank draft comes first — consumed and cleared the same way. */
      const handoffSeed = vendorSeedRef.current;
      vendorSeedRef.current = null;
      const editId = vendorEditRef.current;
      vendorEditRef.current = null;
      const rec = !handoffSeed && editId ? vendorQuotes.find((v) => v.id === editId) : undefined;
      setVendorDraft(handoffSeed || (rec ? vendorDraftFromRecord(rec) : freshVendor()));
      resetVendorPdf();
    } else if (kind === "fixture") {
      // #246: the list now holds every kind (fixtures first); preselect the
      // first FIXTURE — today's pick — and nothing when there is none.
      const first = fixtureAssemblies.find((item) => (item.kind ?? "fixture") === "fixture");
      // #210: the fixture's default hang position / circuit.
      const position = first?.position || "";
      const circuit = first?.circuit || "";
      fixturePrefillRef.current = { position, circuit };
      setFixtureDraft({
        ...freshFixture(),
        assemblyId: first?.id || "",
        componentQty: Object.fromEntries((first?.components || []).map((part) => [part.sku, String(part.defaultQty)])),
        position,
        circuit,
      });
    } else if (kind === "labor") {
      /* #269: reopened from a labor line — seed the group's own stored draft
         (consumed and CLEARED here, so it applies to exactly one open) and
         skip the travel reseed below, which would overwrite it. Rates are
         whatever `rate` resolves now, exactly as for a fresh add. */
      const edit = laborEditRef.current;
      laborEditRef.current = null;
      if (edit) {
        setLaborEdit({ group: edit.group, handEdited: edit.handEdited, removed: edit.removed });
        setLaborDraft(snapshotLaborDraft(edit.draft));
        return;
      }
      setLaborEdit(null);
      // Resolve travel before seeding the draft (punch #89): the estimate is
      // fetched on selection now, so opening this immediately after picking a
      // customer could otherwise seed the mobilization with no distance and
      // quietly price the trip as local. Cached selections call back inline.
      const seq = openSeqRef.current;
      withTravelFor(customerId, locationId, (est) => {
        // A slow resolve must not write into a draft the user has already left,
        // nor into the NEXT open of the same method on the same system — hence
        // the sequence number rather than a kind/secId comparison.
        if (openSeqRef.current !== seq) return;
        setLaborDraft(
          freshLabor(est, tierMargin, sections.find((section) => section.id === secId)?.name || "")
        );
        markDraftBaseline("labor"); // #348 follow-up: the travel reseed is the new clean point
      });
    }
  };

  /** #348 follow-up: whether the open pop-up holds unsaved work (null when clean, or not one of the five). */
  const openInputDirty = (): { kind: ModalInputKind; read: boolean } | null => {
    const cur = openInputRef.current;
    if (!cur || !isModalInputKind(cur.kind)) return null;
    const reading = cur.kind === "vendor" && (vendorPdfBusyRef.current || !!vendorPdf.busy);
    // Fix round 1: the Inbox hand-off still copying the PDF in counts too (closing drops the copy).
    const copying = cur.kind === "vendor" && vendorHandoff?.status === "loading";
    if (!inputIsDirty({ baseline: draftBaselineRef.current[cur.kind], current: modalDrafts[cur.kind], reading, copying })) return null;
    return { kind: cur.kind, read: cur.kind === "vendor" && (reading || !!vendorDraft.pdfRead) };
  };

  /** #348 follow-up: true = OK to discard the open pop-up — it's clean, or the user confirmed. The pop-ups' × and
   *  backdrop (ConfigModal's confirmClose) and a switch away (openInputMethod) ask; Add / Save call closeInput directly. */
  const confirmDiscardInput = (): boolean => {
    const d = openInputDirty();
    return !d || window.confirm(discardConfirmText(d.kind, { read: d.read }));
  };

  /** Close whatever input method is open, discarding its draft. */
  const closeInput = () => {
    const cur = openInputRef.current;
    openInputRef.current = null;
    openSeqRef.current++; // retires any callback still in flight for that open
    setOpenInput(null);
    // #348 slice 4: the email hand-off never outlives the form it opened.
    vendorSeedRef.current = null;
    setVendorHandoff(null);
    // #348 slice 5: nor a Read the PDF in flight.
    resetVendorPdf();
    if (cur) discardDraft(cur.kind, cur.secId);
  };

  /** Open one input method on one system, exclusively. Clicking the method that
   *  is already open on that system closes it — which discards it too. */
  const openInputMethod = (kind: InputKind, secId: string) => {
    const cur = openInputRef.current;
    // #348 follow-up: closing or switching away from a pop-up with unsaved work asks first.
    if (cur && !confirmDiscardInput()) return;
    if (cur && cur.kind === kind && cur.secId === secId) {
      closeInput();
      return;
    }
    if (cur) discardDraft(cur.kind, cur.secId);
    // Stamped before seeding so the labor fetch captures THIS open's number,
    // including when withTravelFor resolves from cache, inline.
    openSeqRef.current++;
    openInputRef.current = { kind, secId };
    setOpenInput({ kind, secId });
    seedDraft(kind, secId);
    markDraftBaseline(kind);
  };

  /** Open the vendor form on a STORED quote (#144), so editing participates in
   *  the exclusivity rule (D161) like any other open. */
  const openVendorEdit = (secId: string, vqId: string) => {
    /* Closed first, for two reasons: openInputMethod reads "the method already
       open on this system" as a toggle and would close the form we are about to
       seed, and its discard of the outgoing draft would clear the pending seed
       set below. After closeInput there is nothing open left to discard. */
    if (!confirmDiscardInput()) return; // #348 follow-up: switching away from unsaved work asks first
    closeInput();
    vendorEditRef.current = vqId;
    openInputMethod("vendor", secId);
  };

  /** #348 slice 4: the hand-off's "Add to system" — move the OPEN vendor form to another system without discarding
   *  its draft (the PDF is already copied under the draft's id). A no-op unless a vendor form is open. */
  const retargetVendor = (secId: string) => {
    const cur = openInputRef.current;
    if (!cur || cur.kind !== "vendor" || cur.secId === secId) return;
    if (!sections.some((sec) => sec.id === secId)) return;
    openInputRef.current = { kind: "vendor", secId };
    setOpenInput({ kind: "vendor", secId });
  };

  /** #348 slice 4: pick (or, with null, unlink) the vendor company. A pick names the vendor; unlinking keeps the name. */
  const setVendorCompany = (c: { id: string; name: string } | null) =>
    setVendorDraft((d) => (c ? { ...d, vendorCompanyId: c.id, vendor: c.name } : { ...d, vendorCompanyId: null }));

  /* #348 slice 4: the Inbox → Estimator hand-off, once per page. The `vq` param is stripped from the URL FIRST, so a
     reload never copies the PDF twice; only ids ever rode it, and the action re-checks the thread's visibility. */
  useEffect(() => {
    const ref = props.vendorFromThread;
    if (!ref || !loadedId || vendorHandoffConsumedRef.current) return;
    vendorHandoffConsumedRef.current = true;
    try {
      const u = new URL(window.location.href);
      u.searchParams.delete("vq"); // VENDOR_FROM_EMAIL_PARAM
      window.history.replaceState(window.history.state, "", u.pathname + u.search + u.hash);
    } catch {
      /* ignore — the copy below still runs once (the consumed ref) */
    }
    const secId = sections.some((sec) => sec.id === activeId) ? (activeId as string) : sections[0]?.id;
    if (!secId) {
      setActionError(VENDOR_COPY.noSystem);
      return;
    }
    const seed = freshVendor();
    closeInput();
    vendorSeedRef.current = seed;
    openInputMethod("vendor", secId);
    setVendorHandoff({ status: "loading", note: VENDOR_COPY.copying });
    const quoteId = loadedId;
    void (async () => {
      try {
        const r = await vendorQuoteFromThreadAction({
          quoteId,
          ref,
          vendorQuoteId: seed.id,
          attachedChars: vendorAttachmentLoad(vendorQuotes),
        });
        if (!r.ok) {
          setVendorHandoff((h) => (h ? { status: "failed", note: r.error || VENDOR_COPY.copyFailed } : h));
          return;
        }
        const p = r.prefill;
        const fill = (d: VendorDraft): VendorDraft => {
          // The user closed (or switched) the form meanwhile — this result belongs to no open draft.
          if (d.id !== seed.id) return d;
          /* Apply the vendor only while the draft's vendor is still the seeded blank — never over what the user
             typed or picked while the PDF was copying. */
          const blank = !(d.vendor || "").trim() && !d.vendorCompanyId;
          return {
            ...d,
            ...(blank ? { vendor: p.vendor, vendorCompanyId: p.vendorCompanyId } : {}),
            quoteNumber: d.quoteNumber || p.quoteNumber,
            attachment: p.attachment ?? d.attachment,
            attachmentPreview: p.attachment ? p.preview : d.attachmentPreview,
            fromThreadId: p.fromThreadId,
          };
        };
        setVendorDraft(fill);
        /* #348 follow-up: the filled form is the new clean point — the same fill applied to the baseline, so what the
           user typed while the PDF copied still counts as theirs (a pending baseline snapshots the filled draft). */
        draftBaselineRef.current.vendor = rebaseDraft<VendorDraft>(draftBaselineRef.current.vendor, fill);
        setVendorHandoff((h) => (h ? { status: "done", note: p.note } : h));
      } catch {
        setVendorHandoff((h) => (h ? { status: "failed", note: VENDOR_COPY.copyFailed } : h));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedId, sections.length]);

  /** #269: reopen the Labor configurator on the draft that built a labor
   *  group, from any of its lines. Same close-then-seed dance as
   *  openVendorEdit. A group with no stored draft (added before #269) has
   *  no edit affordance, so this is a no-op for it. */
  const openLaborEdit = (secId: string, group: string) => {
    const sec = sections.find((s) => s.id === secId);
    const rec = sec ? laborGroupRecord(sec, group) : null;
    if (!sec || !rec) return;
    if (!confirmDiscardInput()) return; // #348 follow-up: switching away from unsaved work asks first
    closeInput();
    laborEditRef.current = { group, draft: rec.draft, ...laborGroupEdits(sec, group) };
    openInputMethod("labor", secId);
  };

  /** #274: reopen the track configurator on a track line — the same
   *  close-then-seed dance as openLaborEdit. A line whose series no longer
   *  exists opens read-only with its saved parts. */
  const openTrackEdit = (secId: string, lineId: number) => {
    const it = sections.find((s) => s.id === secId)?.items.find((x) => x.id === lineId);
    if (!it?.track) return;
    const gone = !trackSeries.some((s) => s.id === it.track!.seriesId);
    if (!confirmDiscardInput()) return; // #348 follow-up: switching away from unsaved work asks first
    closeInput();
    trackEditRef.current = {
      lineId,
      draft: trackDraftFromConfig(it.track),
      readOnly: gone ? { components: it.components, cost: it.cost, price: it.price } : null,
    };
    openInputMethod("track", secId);
  };

  /** #312: reopen the Custom part form on a hand-entered custom line, pre-filled —
   *  the same close-then-seed dance as the configurators above. */
  const openCustomEdit = (secId: string, lineId: number) => {
    const it = sections.find((s) => s.id === secId)?.items.find((x) => x.id === lineId);
    if (!it || !isCustomLineEditable(it)) return;
    if (!confirmDiscardInput()) return; // #348 follow-up: switching away from unsaved work asks first
    closeInput();
    customEditRef.current = { lineId, draft: customDraftFromLine(it) };
    openInputMethod("custom", secId);
  };

  /** #292: reopen the curtain configurator on a curtain line. */
  const openCurtainEdit = (secId: string, lineId: number) => {
    const it = sections.find((s) => s.id === secId)?.items.find((x) => x.id === lineId);
    if (!it?.curtain) return;
    const linked = linkCurtainTracks(sections).links.get(it);
    if (!confirmDiscardInput()) return; // #348 follow-up: switching away from unsaved work asks first
    closeInput();
    curtainEditRef.current = { lineId, draft: curtainDraftFromLine(it, defaultFabric, fabrics, (d) => computeCurtain(d, fabrics, { sewingPct: curtainSewingPct }, tierMargin ?? undefined).costEach), linkedTrack: linked?.track ? String(linked.track.mounting) : null };
    openInputMethod("curtain", secId);
  };

  /** #274: Add track pushes one track line; Update track replaces the line
   *  it was opened from, in place, at today's catalog prices. */
  const addTrack = (secId: string) => {
    if (trackEdit?.readOnly) return;
    const config = trackConfigFromDraft(trackDraft);
    const res = trackLine(config, trackSeries.find((s) => s.id === config.seriesId), trackParts, tierMargin);
    if (!res.ok) return;
    const lineId = trackEdit?.lineId;
    if (lineId != null) setSections((ss) => ss.map((s) => (s.id === secId ? replaceTrackLine(s, lineId, res.item) : s)));
    else pushItems(secId, [{ ...res.item, id: nextId() }]);
    closeInput();
  };

  /** #274: a curtain field changed — an Add track form follows the curtain's
   *  pre-fills on every field the user hasn't touched. */
  const setCurtainField = (field: keyof CurtainDraft, val: string) => {
    const next = { ...curtainDraft, [field]: val };
    setCurtainDraft(next);
    if (!curtainTrack) return;
    const pre = curtainTrackPrefill(next);
    // Captured now: the updater runs later, after the ref has moved on.
    const prev = curtainTrackPrefillRef.current;
    setCurtainTrack((t) => (t ? followCurtainPrefill(t, prev, pre) : t));
    curtainTrackPrefillRef.current = pre;
  };
  const toggleCurtainTrack = (on: boolean) => {
    if (!on) return setCurtainTrack(null);
    curtainTrackPrefillRef.current = curtainTrackPrefill(curtainDraft);
    setCurtainTrack(curtainTrackDraft(curtainDraft, trackSeries));
  };

  /** #302 — one field of the Custom part form. Unit sell follows Unit cost at
   *  the flat custom-part markup until a sell is typed; clearing the sell
   *  hands it back to the cost. Any edit clears a stale error. */
  const setCustomField = (field: keyof CustomDraft, v: string) => {
    setCustomError("");
    setCustomDraft((d) => {
      const next = { ...d, [field]: v };
      if (field === "cost" && d.priceAuto) next.price = autoSellText(v);
      else if (field === "price") {
        if (v.trim()) next.priceAuto = "";
        else {
          next.priceAuto = "1";
          next.price = autoSellText(d.cost);
        }
      }
      return next;
    });
  };

  /** Resolves to a one-line confirmation when the part was also saved to the
   *  catalog (the section card shows it); nothing otherwise. */
  const addCustomPart = async (secId: string): Promise<string | void> => {
    if (savingCustomRef.current) return;
    const d = customDraft;
    const desc = (d.desc || "").trim();
    const markup = seedMarkupOf(tierMargin);
    const editId = customEdit?.lineId;
    // #312: a typed 0 on an EDITED line stays 0 (a zero-quantity option); only an add defaults to 1.
    let qty = parseInt(d.qty, 10);
    if (isNaN(qty) || qty < 0 || (qty === 0 && editId == null)) qty = 1;
    // #312: the line may have been deleted while the form was open (or during the catalog save below).
    const lineGone = () => editId != null && !sectionsRef.current.find((x) => x.id === secId)?.items.some((x) => x.id === editId);
    const GONE = "That line was removed \u2014 nothing was changed.";
    let cost = parseFloat(d.cost);
    if (isNaN(cost) || cost < 0) cost = 0;
    const typedPrice = parseFloat(d.price);
    const price = d.allowance && (!Number.isFinite(typedPrice) || typedPrice <= 0)
      ? round2(sellAt(cost, markup))
      : typedPrice;
    if (!desc || !Number.isFinite(price) || price <= 0) return;
    if (lineGone()) {
      setCustomError(GONE);
      return;
    }
    let savedMessage: string | undefined;
    if (d.addToCatalog && !d.allowance) {
      const catalogSku = (d.sku || "").trim();
      if (!catalogSku || catalogSku.toUpperCase() === "CUSTOM") {
        setCustomError("Enter a Part no. / SKU to save this part to the catalog.");
        return;
      }
      savingCustomRef.current = true;
      setSavingCustom(true);
      setCustomError("");
      try {
        const saved = await saveEstimatorCustomPartAction({
          sku: catalogSku,
          desc,
          category: "Custom Parts",
          unit: (d.unit || "").trim() || "ea",
          cost,
          list: price,
          mfr: d.manufacturer.trim(),
          manufacturerPartNumber: d.manufacturerPartNumber.trim(),
          priceGoodThrough: d.priceGoodThrough,
        });
        if (!saved.ok) {
          setCustomError(saved.error);
          return;
        }
        savedMessage = `Saved ${saved.sku} to the catalog under Custom Parts.`;
      } catch {
        setCustomError("Couldn't save to the catalog \u2014 try again.");
        return;
      } finally {
        savingCustomRef.current = false;
        setSavingCustom(false);
      }
    }
    if (lineGone()) {
      setCustomError(GONE);
      return;
    }
    const customItem: SpecItem = {
        id: editId ?? 0,
        sku: d.allowance ? "" : ((d.sku || "").trim() || "CUSTOM"),
        desc,
        qty,
        unit: (d.unit || "").trim() || "ea",
        cost,
        price,
        custom: true,
        manufacturer: d.manufacturer.trim() || undefined,
        manufacturerPartNumber: d.manufacturerPartNumber.trim() || undefined,
        priceGoodThrough: d.priceGoodThrough || undefined,
        link: (d.link || "").trim() || undefined,
        allowance: d.allowance ? true : undefined,
    };
    // #312: Save changes replaces the line in place; the ★ and any document blocks follow a changed anchor.
    if (editId != null) {
      const cur = sectionsRef.current.find((x) => x.id === secId)?.items.find((x) => x.id === editId);
      const res = cur ? saveCustomEdit(sectionsRef.current.find((x) => x.id === secId)!, editId, customItem, sellUntouched(d, cur), costUntouched(d, cur)) : null;
      setSections((ss) =>
        ss.map((x) => {
          const at = x.id === secId ? x.items.find((i) => i.id === editId) : undefined;
          return at ? saveCustomEdit(x, editId, customItem, sellUntouched(d, at), costUntouched(d, at)).section : x;
        }),
      );
      if (res?.anchor) {
        const nd = reanchorDocLine(packageDocRef.current, secId, res.anchor.lineKey, res.anchor.sku);
        if (nd) setPackageDoc(nd);
        // The over-cap draft (restored on return to Build package) follows the same anchor.
        const od = reanchorDocLine(packageDocOverDraft as PackageDoc | null, secId, res.anchor.lineKey, res.anchor.sku);
        if (od) setPackageDocOverDraft(od);
      }
    } else pushItems(secId, [{ ...customItem, id: nextId() }]);
    closeInput(); // closing discards, so the draft reseed happens there
    return savedMessage;
  };

  /* ---------------- vendor quote (#143, D162) ----------------
     ONE priced SpecItem per vendor quote carries the money (the vendor's
     rolled-up total, marked up by the section margin like any other cost
     line). The material lines stay on the VendorQuote record rather than
     becoming sibling SpecItems: that keeps pricing.ts honest with a single
     priced line, survives the row's × control, and makes Single/Itemized a
     pure render decision instead of a set of $0 rows that would leak onto
     the customer document. */
  const setVendorField = <K extends keyof VendorDraft>(field: K, value: VendorDraft[K]) => {
    /* #348 slice 5: a replaced or removed file drops the read (its lines stay, now the user's own) and any read
       still in flight for the old file, with its error. */
    if (field === "attachment") {
      resetVendorPdf();
      setVendorDraft((d) => ({ ...dropVendorPdfRead(d), [field]: value }));
      return;
    }
    setVendorDraft((d) => ({ ...d, [field]: value }));
  };

  /** #348 slice 5 — Read the PDF (hard = Try harder, on Sonnet). One click = one action call; a new read over an
   *  earlier one confirms first, then undoes that read before applying the new one (applyVendorPdfRead doesn't). */
  const readVendorPdf = async (hard: boolean) => {
    const d = vendorDraft;
    const a = d.attachment;
    const source = a?.blobPath
      ? { kind: "blob" as const, blobPath: a.blobPath }
      : a?.dataUrl
        ? { kind: "dataUrl" as const, dataUrl: a.dataUrl }
        : null;
    if (!a || !source || !isPdfAttachment(a) || vendorPdfBusyRef.current) return;
    if (d.extracted) {
      const { read, edited } = readLinesEdited(d);
      if (read > 0 && !window.confirm(VENDOR_PDF_COPY.replaceConfirm(read, edited, hard))) return;
    }
    const seq = ++vendorPdfSeqRef.current;
    vendorPdfBusyRef.current = true;
    setVendorPdf({ busy: hard ? "hard" : "read", error: null });
    let r: Awaited<ReturnType<typeof readVendorPdfAction>>;
    try {
      r = await readVendorPdfAction({
        vendorQuoteId: d.id,
        quoteId: loadedId,
        source,
        hard,
        // Any read over an earlier one replaces it — the server retires that run (Read again or Try harder).
        retryOf: d.extracted?.runId ?? null,
      });
    } catch (e) {
      console.error("[estimator] Read the PDF failed:", e);
      r = { ok: false, error: VENDOR_PDF_COPY.couldNotRead, runId: null };
    }
    // The form closed, reseeded or changed file meanwhile: this result belongs to nothing on screen.
    if (vendorPdfSeqRef.current !== seq) return;
    vendorPdfBusyRef.current = false;
    if (r.ok) {
      const result = r;
      setVendorDraft((cur) =>
        cur.id !== d.id || attKey(cur) !== attKey(d)
          ? cur
          : applyVendorPdfRead(undoVendorPdfRead(cur), result, () => ++vendorLineIdRef.current)
      );
      setVendorPdf(VENDOR_PDF_IDLE);
    } else {
      setVendorPdf({ busy: null, error: { text: r.error, tooLarge: !!r.tooLarge, hard } });
    }
  };
  const setVendorLine = (
    id: number,
    field: keyof Omit<VendorLineDraft, "id">,
    value: string
  ) =>
    setVendorDraft((d) => ({
      ...d,
      lines: d.lines.map((l) => (l.id === id ? { ...l, [field]: value } : l)),
    }));
  const addVendorLine = () =>
    setVendorDraft((d) => ({
      ...d,
      lines: d.lines.concat([
        { id: ++vendorLineIdRef.current, description: "", manufacturerPartNumber: "", qty: "1", unit: "ea", amount: "" },
      ]),
    }));
  const removeVendorLine = (id: number) =>
    setVendorDraft((d) => ({ ...d, lines: d.lines.filter((l) => l.id !== id) }));
  /** APPENDS (#143 re-review) — a CSV load used to silently replace lines the
   *  user had typed by hand, with no warning and no undo. */
  const loadVendorLines = (lines: Omit<VendorLineDraft, "id">[]) =>
    setVendorDraft((d) => ({
      ...d,
      lines: d.lines.concat(lines.map((l) => ({ ...l, id: ++vendorLineIdRef.current }))),
    }));

  /** Create or update (#144). The draft carries the record's id either way —
   *  minted when a blank form opened, or the stored record's own on an edit —
   *  so which of the two this is, is a lookup, not a flag. */
  const commitVendorQuote = (secId: string) => {
    const d = vendorDraft;
    const vendor = (d.vendor || "").trim();
    const quoteNumber = (d.quoteNumber || "").trim();
    const description = (d.description || "").trim();
    const total = vendorDraftTotal(d);
    if (!vendor || !quoteNumber || !description || total <= 0) return;
    const seedMarkup = seedMarkupOf(tierMargin);
    /* The id the form was opened with (mintVendorQuoteId, or the record's own
       on an edit) — NOT a second one. With Blob storage on the attachment was
       already uploaded under it, so a fresh id here would orphan the file
       (#143). */
    const vqId = d.id;
    // #144: an id already on the estimate means this is an edit, not an add.
    const editing = vendorQuotes.some((v) => v.id === vqId);
    /* Every part of this is editable, so the line's desc is RESTAMPED on an
       edit rather than inherited — a stale vendor name on a re-quoted line is
       the failure this feature exists to prevent. */
    const lineDesc = vendor + " \u00b7 " + quoteNumber + " \u2014 " + description;
    // #348 slice 4: addedAt is server-stamped; keep the client copy honest between saves.
    const prevRec = vendorQuotes.find((v) => v.id === vqId);
    const record: VendorQuote = {
      id: vqId,
      vendor,
      quoteNumber,
      description,
      ...(d.attachment ? { attachment: { ...d.attachment } } : {}),
      ...((d.link || "").trim() ? { link: d.link.trim() } : {}),
      // vendorKeptLines is the ONE rule for which lines exist: the same set
      // vendorDraftTotal priced, so the breakdown can never omit money the
      // customer is paying (#143 re-review). parseMoney handles "1,250.00".
      lines: vendorKeptLines(d.lines).map((l) => ({
        id: l.id,
        description: (l.description || "").trim(),
        ...(l.manufacturerPartNumber.trim() ? { manufacturerPartNumber: l.manufacturerPartNumber.trim() } : {}),
        qty: parseMoney(l.qty) || 0,
        unit: (l.unit || "").trim() || "ea",
        amount: round2(parseMoney(l.amount) || 0),
        // #348 slice 5: which read line this row came from — the server keeps it only with a verified read.
        ...(typeof l.fromRead === "number" && d.extracted ? { extractedIndex: l.fromRead } : {}),
      })),
      terms: d.terms || "",
      notes: d.notes || "",
      total,
      totalSource: vendorDraftTotalSource(d),
      includesFreight: d.includesFreight,
      display: d.display,
      ...(d.vendorCompanyId ? { vendorCompanyId: d.vendorCompanyId } : {}),
      ...(d.fromThreadId ? { fromThreadId: d.fromThreadId } : {}),
      ...(prevRec?.addedAt ? { addedAt: prevRec.addedAt } : {}),
      // #348 slice 5: the read this form keeps — re-verified against its run on the server at save.
      ...(d.extracted ? { extracted: d.extracted } : {}),
    };
    /* Replaced IN PLACE on an edit — same id, same position — so the spawned
       line keeps resolving against it and the row order does not shuffle. */
    setVendorQuotes((vs) =>
      editing ? vs.map((v) => (v.id === vqId ? record : v)) : vs.concat([record])
    );
    if (d.attachmentPreview)
      setVendorPreviews((m) => ({ ...m, [vqId]: d.attachmentPreview as string }));
    if (editing) {
      /* Update the line this quote already spawned, wherever it lives: never
         push a second one, never leave the old one behind, and never move it to
         `secId` — the form is opened from the line's own card, but an edit is
         not a change of system. qty, unit, option, allowance, comment and
         internalNote are the estimator's, not the vendor's, so they are left
         exactly as they are. */
      setSections((ss) =>
        ss.map((s) => ({
          ...s,
          items: s.items.map((it) => {
            if (it.vendorQuoteId !== vqId) return it;
            const next: SpecItem = {
              ...it,
              sku: quoteNumber,
              desc: lineDesc,
              cost: total,
              /* The line's CURRENT markup, rescaled to the new cost (#144,
                 D163) — never re-seeded from the tier, which would undo a
                 markup slider drag or a typed sell price. Shared with the
                 form's own Sell stat (`vendorFormMarkup`) so the number the
                 user reads before saving is the number that lands. */
              price: repricedAtLineMarkup(it.cost, it.price, total, seedMarkup),
            };
            /* Must be able to CLEAR the flag, not only set it: this spreads the
               existing item, so unticking "includes freight" has to delete the
               key or the line stays out of the freight base forever. */
            if (d.includesFreight) next.noFreight = true;
            else delete next.noFreight;
            return next;
          }),
        }))
      );
    } else {
      pushItems(secId, [
        {
          id: nextId(),
          sku: quoteNumber,
          desc: lineDesc,
          qty: 1,
          unit: "lot",
          cost: total,
          price: round2(sellAt(total, seedMarkup)),
          vendorQuoteId: vqId,
          // Jeff's exemption: a quote that already includes freight is excluded
          // from the section freight base (pricing.systemFreightBase).
          ...(d.includesFreight ? { noFreight: true } : {}),
        },
      ]);
    }
    closeInput();
  };

  /** Single/Itemized is LIVE on the stored record, not frozen at add time —
   *  Jeff must be able to flip it without re-entering the quote. */
  const setVendorDisplay = (vendorQuoteId: string, display: "single" | "itemized") =>
    setVendorQuotes((vs) =>
      vs.map((v) => (v.id === vendorQuoteId ? { ...v, display } : v))
    );

  const addCurtain = (secId: string) => {
    const d = curtainDraft;
    const name = (d.name || "").trim();
    const c = computeCurtain(d, fabrics, { sewingPct: curtainSewingPct }, tierMargin ?? undefined);
    if (!name || !curtainDraftValid(d, c.priceEach)) return;
    // #274: Add track — the curtain's track line follows it; a track with a
    // blocking error blocks the whole add (the modal already disables it).
    let track: SpecItem | null = null;
    if (curtainTrack) {
      const config = trackConfigFromDraft(curtainTrack);
      const res = trackLine(config, trackSeries.find((s) => s.id === config.seriesId), trackParts, tierMargin);
      if (!res.ok) return;
      track = { ...res.item, id: 0 };
    }
    if (curtainEdit) {
      if (track) track.id = nextId();
      const item = curtainItem(d, c, { id: curtainEdit.lineId, sku: "" });
      setSections((ss) => ss.map((s) => (s.id === secId ? applyCurtainEdit(s, curtainEdit.lineId, item, curtainEdit.linkedTrack ? null : track) : s)));
      closeInput();
      return;
    }
    const idN = nextId();
    const skuN = nextId();
    if (track) track.id = nextId();
    // #292: a curtain added with its track shares one key with it.
    const key = track ? newCurtainTrackKey(idN) : undefined;
    if (track) track.curtainTrackKey = key;
    pushItems(secId, [
      {
        ...curtainItem(d, c, { id: idN, sku: "CRT-" + skuN, trackKey: key }),
        curtain: true,
        specKey: curtainSpecKey(undefined, name) || undefined,
      },
      ...(track ? [track] : []),
    ]);
    closeInput();
  };

  const setFixture = (field: "qty" | "position" | "circuit", val: string) =>
    setFixtureDraft((d) => ({ ...d, [field]: val }));
  const setFixtureAssembly = (assemblyId: string) => {
    const assembly = fixtureAssemblies.find((item) => item.id === assemblyId);
    const nextPosition = assembly?.position || "";
    const nextCircuit = assembly?.circuit || "";
    // #210: only replace position/circuit when the field still equals what
    // was last prefilled (i.e. the user never touched it) — never overwrite
    // a value the user typed.
    const prefill = fixturePrefillRef.current;
    setFixtureDraft((draft) => ({
      ...draft,
      assemblyId,
      componentQty: Object.fromEntries((assembly?.components || []).map((part) => [part.sku, String(part.defaultQty)])),
      position: draft.position === prefill.position ? nextPosition : draft.position,
      circuit: draft.circuit === prefill.circuit ? nextCircuit : draft.circuit,
    }));
    fixturePrefillRef.current = { position: nextPosition, circuit: nextCircuit };
  };
  const setFixtureComponentQty = (sku: string, value: string) =>
    setFixtureDraft((draft) => ({ ...draft, componentQty: { ...draft.componentQty, [sku]: value } }));
  const addFixture = (secId: string) => {
    const d = fixtureDraft;
    const assembly = fixtureAssemblies.find((item) => item.id === d.assemblyId);
    if (!assembly) return;
    // #210: the BOM math lives in fixture-bom.ts (pure, parity-tested);
    // the line's shape is unchanged.
    const line = fixtureBomLine(assembly, d);
    if (!line) return;
    const qty = Math.max(1, Number.parseInt(d.qty, 10) || 1);
    pushItems(secId, [
      { id: nextId(), sku: assembly.id, desc: line.desc, qty, unit: "ea", cost: line.cost, price: line.price, fixture: true, components: line.components, ...(line.rackId ? { rackId: line.rackId } : {}) },
    ]);
    closeInput();
  };

  /* ---------------- labor configurator handlers ---------------- */
  const setLabor = (field: "discipline" | "margin" | "shopHrs" | "misc", val: string) =>
    setLaborDraft((d) => ({ ...d, [field]: val }));
  const setAutoHrs = (field: "pmHrs" | "drfHrs", flag: "pmAuto" | "drfAuto", val: string) =>
    setLaborDraft((d) =>
      val === "" ? { ...d, [field]: "", [flag]: true } : { ...d, [field]: val, [flag]: false }
    );
  const resetAutoHrs = (field: "pmHrs" | "drfHrs", flag: "pmAuto" | "drfAuto") =>
    setLaborDraft((d) => ({ ...d, [field]: "", [flag]: true }));
  const addMob = () =>
    setLaborDraft((d) => ({ ...d, mobs: d.mobs.concat([laborMob(travelEstNow())]) }));
  const removeMob = (idx: number) =>
    setLaborDraft((d) =>
      d.mobs.length <= 1 ? d : { ...d, mobs: d.mobs.filter((_, i) => i !== idx) }
    );
  const setMob = (idx: number, field: keyof MobDraft, val: string) =>
    setLaborDraft((d) => ({
      ...d,
      // #272: typing in the miles box makes the value the user's (clears milesAuto)
      mobs: d.mobs.map((m, i) => (i !== idx ? m : field === "milesRT" ? typeMobMiles(m, val) : { ...m, [field]: val })),
    }));
  const setMobNameSelect = (idx: number, val: string) =>
    setLaborDraft((d) => ({
      ...d,
      mobs: d.mobs.map((m, i) => {
        if (i !== idx) return m;
        if (val === "__custom__") return { ...m, nameCustom: true, name: "" };
        return applyMobType(m, val);
      }),
    }));
  const useMobNameList = (idx: number) =>
    setLaborDraft((d) => ({
      ...d,
      mobs: d.mobs.map((m, i) => (i === idx ? { ...m, nameCustom: false, name: "" } : m)),
    }));
  const toggleMobFlag = (idx: number, field: "sup" | "lift") =>
    setLaborDraft((d) => ({
      ...d,
      mobs: d.mobs.map((m, i) => (i === idx ? { ...m, [field]: !m[field] } : m)),
    }));
  const applyAutoMiles = (idx: number) => {
    const est = travelEstNow();
    if (roundTripMiles(est) == null) return;
    setLaborDraft((d) => ({ ...d, mobs: d.mobs.map((m, i) => (i === idx ? setRouteMiles(m, est) : m)) }));
  };
  // #272: the pure helpers (labor-defaults.ts) own the fill rule — blank miles
  // fill from the route for Local and Travel alike, typed miles always win.
  const setTripLocal = (idx: number) => {
    const est = travelEstNow();
    setLaborDraft((d) => ({ ...d, mobs: d.mobs.map((m, i) => (i === idx ? applyLocalTrip(m, est) : m)) }));
  };
  const applyTravelTrip = (idx: number) => {
    const est = travelEstNow();
    setLaborDraft((d) => ({ ...d, mobs: d.mobs.map((m, i) => (i === idx ? applyTravelTripTo(m, est) : m)) }));
  };
  /** Re-apply the >1h auto trip-type when customer/venue changes mid-configure.
   *  The estimate may need fetching (punch #89), so the draft update runs in
   *  the callback rather than inline — `withTravelFor` calls back synchronously
   *  whenever the value is already cached, which is every re-selection. */
  const reapplyAutoTrips = (custId: string | null, locId: string | null) => {
    // NB: fetch unconditionally, apply only when the configurator is open.
    // The `!laborFor` early return used to live at the top, which was safe
    // when every estimate was precomputed — now it would leave the selection
    // unfetched, and travelEstNow() also drives the labor modal's own
    // defaults (freshLabor/freshMob) and the distance it displays.
    withTravelFor(custId, locId, (est) => {
      if (laborFor) applyAutoTrips(est);
    });
  };
  const applyAutoTrips = (est: TravelLite | null) => {
    setLaborDraft((d) => ({ ...d, mobs: applyAutoTripsToMobs(d.mobs, est) }));
  };

  const addLabor = (secId: string) => {
    const r = computeLabor(laborDraft, rate);
    if (r.totalCost <= 0) return;
    const discLabel = DISC_LABEL[r.disc] || r.disc;
    // One line per mobilization, plus shop & engineering / allowance /
    // performance bonus as their own lines when present — reverted back to
    // that shape off a recent change that had folded them together (owner
    // request: "I like setting the shop and engineering as separate lines
    // ... and the bonus"). The customer document still never shows them:
    // `customerLines` (pricing.ts) folds their sell into the mobilization
    // line(s) for display only. buildLaborItems is the pure line-building
    // half, kept in pricing.ts for testability. #270: each mobilization's
    // mileage / hotel / per diem / lift land as their own lines too.
    //
    // #269: every line shares one labor group id and the draft is stored
    // once on the section, so clicking any of them reopens this configurator.
    // An edit rebuilds the whole group from the draft IN PLACE (same
    // position, same group id) — lines removed from the group come back and
    // hand edits to its lines are replaced (the modal says so).
    const group = laborEdit?.group || newLaborGroupId();
    const items = buildLaborItems(r, discLabel, nextId, group);
    const draft = snapshotLaborDraft(laborDraft);
    if (items.length)
      setSections((ss) => ss.map((s) => (s.id === secId ? withLaborGroup(s, group, items, draft) : s)));
    closeInput(); // discards → reseeds freshLabor for this system
  };

  /* ---------------- Daylite stage bar (Task 6) ---------------- */
  // No bar for an unsaved new quote (no id to move), and none for a quote
  // type that carries no pipeline (service quotes build their own screens).
  const showStageBar = !!loadedId && carriesPipeline(quoteType);
  const stageBarPipeline =
    pipelines.quote.find((p) => p.id === pipelineId) ||
    pipelines.quote.find((p) => p.id === pipelines.defaultQuotePipelineId) ||
    pipelines.quote[0];
  const stageBarCurIdx = stageBarPipeline.stages.findIndex((s) => s.id === stage);
  const stageBarLostLabel = status === "lost" ? stageById(stageBarPipeline, stage)?.label : null;

  /* ---------------- ctx bar options ---------------- */
  const customerOptions = [
    {
      value: "",
      label: customerId ? "— No customer —" : custName || "— Select customer —",
    },
  ].concat(customers.map((c) => ({ value: c.id, label: c.name })));
  const showVenuePick = locations.length > 1;
  const venueOptions = locations.map((l) => ({
    value: l.id,
    label: l.label + (l.city ? " · " + l.city : ""),
  }));
  // #262: the selected venue's own name (not the "Name · City" option label) —
  // the Room input's placeholder fallback when a system's room is blank.
  const venueRoomName = locations.find((l) => l.id === locationId)?.label || "";
  const showContactPick = contacts.length >= 1;
  const contactOptions = [{ value: "", label: "— No contact —" }].concat(
    contacts.map((c) => ({ value: c.name, label: c.name + (c.role ? " · " + c.role : "") }))
  );
  /** #281: the top bar's Quote details chip — customer · venue · attn contact. */
  const qdChipLabel =
    [
      (customerId ? customers.find((c) => c.id === customerId)?.name : "") || custName,
      venueRoomName,
      currentContact ? "attn " + currentContact.name : "",
    ]
      .filter(Boolean)
      .join(" · ") || "Add quote details";
  /** #281: the narrative column follows the active system (first as fallback). */
  const narrSec = sections.find((s) => s.id === activeId) || sections[0] || null;
  /** #293: the active system's eligible skus — the library cache prefetches them.
   *  An allowance/custom line anchors on a `line:<id>` token (no library row);
   *  a block saved on such a line's real sku before that still prefetches. */
  /* Phase 5: plus every product block's sku in the package document, so its
     tags (from product / edited here), Revert and photo previews have rows. */
  const narrSkus = useMemo(
    () =>
      [
        ...(narrSec ? [...narrSec.items.filter(isKeyProductEligible).map(keyProductSkuOf), ...(narrSec.keyProducts || []).map((k) => k.sku)] : []),
        ...docProductSkus(packageDoc),
      ].filter((k) => !!k && !isLineToken(k)),
    [narrSec, packageDoc]
  );
  /** #332: a starred assembly line (never a rack or track) shows its primary member's paragraph and photo — the same memberAliases the server prints with. */
  const kpAliases = useMemo(() => Object.fromEntries(memberAliases(sections.flatMap((s) => s.items))), [sections]);
  const kpLib = useKeyProductLibrary(narrSkus, kpAliases);
  const updateSection = (secId: string, fn: (s: SpecSection) => SpecSection) =>
    setSections((ss) => ss.map((s) => (s.id === secId ? fn(s) : s)));
  /** #293 ★: marking copies the saved paragraph when the library row is
   *  loaded. When it isn't yet (a ★ in a system the prefetch hasn't reached —
   *  pointer-down activates it, the prefetch effect runs after), mark the
   *  line now, await the row, then fill the block's text if it's still empty
   *  (functional updater on the live section, so nothing typed is lost). */
  const toggleKeyProductLine = (secId: string, itemId: number) => {
    const it = sections.find((s) => s.id === secId)?.items.find((i) => i.id === itemId);
    // A line token (allowance/custom line) has no library paragraph to copy.
    const anchor = it ? keyProductSkuOf(it) : "";
    const sku = isLineToken(anchor) ? "" : anchor;
    const text = (sku && kpLib.rows[sku]?.paragraph) || "";
    updateSection(secId, (s) => toggleKeyProduct(s, itemId, text));
    if (!sku || Object.hasOwn(kpLib.rows, sku)) return;
    void kpLib
      .ensure([sku])
      .then((rows) => {
        const para = rows[sku]?.paragraph || "";
        if (para) updateSection(secId, (s) => fillEmptyKeyProductText(s, itemId, sku, para));
      })
      .catch(() => {});
  };

  const curtainSec = sections.find((s) => s.id === curtainFor);
  const fixtureSec = sections.find((s) => s.id === fixtureFor);
  const laborSec = sections.find((s) => s.id === laborFor);
  const vendorSec = sections.find((s) => s.id === vendorFor);
  const trackSec = sections.find((s) => s.id === trackFor);
  /** The stored quote the vendor form is editing, if it is editing one (#144). */
  const vendorEditingRec = vendorQuotes.find((v) => v.id === vendorDraft.id);
  /**
   * The markup the vendor form prices its "Sell" stat at (#144 re-review).
   *
   * On an ADD that is the tier seed, the same rule the spawned line is built
   * with. On an EDIT it has to be the markup the LINE is carrying, because that
   * is what commitVendorQuote preserves (repricedAtLineMarkup): the tier seed
   * would show a sell price the save then does not write, off by exactly
   * however far the system markup slider has since been dragged — and the Sell
   * stat is the one number in the form Jeff reads to decide whether to accept
   * the vendor's new total.
   */
  const vendorFormMarkup = (() => {
    const seed = seedMarkupOf(tierMargin);
    if (!vendorEditingRec) return seed;
    const line = sections
      .flatMap((s) => s.items)
      .find((it) => it.vendorQuoteId === vendorDraft.id);
    const k = line ? lineMarkupOf(line.cost, line.price) : null;
    return k != null ? k : seed;
  })();

  return {
    ...props,
    actionError,
    actionNotice,
    activeId,
    addAiLine,
    addCurtain,
    addCustomPart,
    customEdit,
    openCustomEdit,
    addFixture,
    addGroupAction,
    addGroupForSystem,
    addLabor,
    addMob,
    addPart,
    addSystem,
    addSystemFromCategory,
    suggestion,
    suggestionParts: suggestionParts ?? null,
    addSuggestedSystem,
    addSuggestedLine,
    suggestionAdded,
    suggestionTargetFor,
    suggestOpen,
    toggleSuggestOpen,
    addSystemOpen,
    setAddSystemOpen,
    addTrack,
    addVendorLine,
    aiAdded,
    aiBusy,
    aiErr,
    aiLines,
    aiOpen,
    aiScope,
    aiScopeInserted,
    aiSource,
    aiTargetSection,
    appliedCredit,
    applyAutoMiles,
    applyCredit,
    applySync,
    applyTravelTrip,
    assumptionLibrary,
    assumptions,
    blobUploads,
    blocks,
    canApplyCredit,
    canWriteNarrativeLibrary,
    cardRefs,
    boxSale,
    boxSaleLabor,
    canBoxSale,
    setBoxSale,
    category,
    commitCategory,
    changePeople,
    changePipeline,
    changeStage,
    changeStatus,
    checkedAssumptions,
    closeInput,
    confirmDiscardInput,
    closeQd,
    closeTitle,
    cols,
    commitVendorQuote,
    contactOptions,
    copySystem,
    groups,
    isBuilt,
    markBuilt,
    moveGroupByAction,
    moveSystemByAction,
    moveSystemToAction,
    openCutSheets,
    coverSummary,
    creditInfo,
    currentContact,
    curtainDraft,
    curtainEdit,
    curtainFor,
    curtainSec,
    curtainSewingPct,
    curtainTrack,
    customDraft,
    customError,
    customerId,
    customerOptions,
    cutSheetCount,
    dec,
    deleteSystem,
    detail,
    doSave,
    exportReviewSheet,
    // #366: project discounts.
    projectDiscounts,
    setProjectDiscount,
    removeProjectDiscount,
    fabrics,
    fixtureAssemblies,
    fixtureDraft,
    fixtureFor,
    fixtureSec,
    focusNarrIfPending,
    freightDefault,
    gateRefused,
    importMaterials,
    inc,
    initial,
    insertAiScope,
    installTimeframe,
    intros,
    isExpanded,
    isInternal,
    isOpenFor,
    justSaved,
    kpLib,
    laborDraft,
    laborEdit,
    laborFor,
    laborSec,
    libraryOpen,
    loadVendorLines,
    loadedId,
    locationId,
    moveItem,
    moveLinesHere,
    moveLinesToEstimate,
    movingLines,
    moveNotice,
    moveSystem,
    narrRef,
    narrSec,
    notIncluded,
    notIncludedDefault,
    onAssumptions,
    onCoverSummary,
    onInstallTimeframe,
    onNotIncluded,
    onQuoteNote,
    openAiDraft,
    openCurtainEdit,
    openInput,
    openInputMethod,
    openLaborEdit,
    openTitle,
    openTrackEdit,
    openVendorEdit,
    retargetVendor,
    setVendorCompany,
    vendorHandoff,
    vendorPdf,
    readVendorPdf,
    ownerValue,
    reviewBusy,
    paymentTerms,
    pdf,
    pdfCover,
    pdfCutSheets,
    pdfDirty,
    pdfItemizedAppendix,
    pdfNotes,
    pdfOptions,
    pdfPrices,
    pdfQty,
    pdfTerms,
    people,
    peopleBusy,
    peopleOptions,
    phone,
    pickContact,
    pickCustomer,
    pickVenue,
    pipelines,
    placeLibrarySystem,
    portalStatusError,
    assistDraft,
    preparedValue,
    projectName,
    qdChipLabel,
    qdChipRef,
    qdOpen,
    qdPanelRef,
    quoteId,
    quoteNote,
    quoteTasks,
    rate,
    removeCredit,
    removeGroupAction,
    removeItem,
    removeMob,
    removeVendorLine,
    renameGroupAction,
    renameSystem,
    resetAutoHrs,
    resetSystemSell,
    revNum,
    roundSystemPrice,
    runAiDraft,
    samePerson,
    saveNow,
    savingCustom,
    scrollRef,
    searchQuotes,
    sections,
    selectSystem,
    setActionError,
    setGroupAlternateAction,
    setActionNotice,
    setActiveId,
    setAiOpen,
    setAutoHrs,
    setCategory,
    setCurtainField,
    setCurtainTrack,
    setCustomField,
    setDetail,
    setFixture,
    setFixtureAssembly,
    setFixtureComponentQty,
    setFreightPct,
    setGateRefused,
    setIntros,
    setItemExtSell,
    setItemPrice,
    setItemSpecKey,
    setLabor,
    setLibraryOpen,
    setMarkupAll,
    setMob,
    setMobNameSelect,
    setMoveNotice,
    setNarrFocusReq,
    setPaymentTerms,
    setPdf,
    setPdfCover,
    setPdfCutSheets,
    setPdfItemizedAppendix,
    setPdfNotes,
    setPdfOptions,
    setPdfPrices,
    setPdfQty,
    setPdfTerms,
    setQdOpen,
    setQty,
    setSystemGroup,
    setSystemMarkup,
    setSystemPresentation,
    setSystemRoom,
    setSystemSell,
    setTierReprice,
    setTitleDraft,
    setTrackDraft,
    setTripLocal,
    setVendorDisplay,
    setVendorField,
    setVendorLine,
    setWonMetaGuard,
    showContactPick,
    showStageBar,
    showVenuePick,
    sideOpen,
    specKeys,
    stageBarCurIdx,
    stageBarLostLabel,
    stageBarPipeline,
    status,
    statusChanging,
    t,
    templateSets,
    tierMargin,
    tierReprice,
    tierResolving,
    titleDraft,
    titleEditing,
    toggleAssumption,
    toggleCurtainTrack,
    toggleExpand,
    toggleKeyProductLine,
    toggleMobFlag,
    togglePdf,
    toggleSide,
    trackDraft,
    trackEdit,
    trackFor,
    trackParts,
    trackSec,
    trackSeries,
    travelEstNow,
    undoTierReprice,
    updateSection,
    useMobNameList,
    vendorDraft,
    vendorEditingRec,
    vendorFor,
    vendorFormMarkup,
    vendorPreviews,
    vendorQuotes,
    vendorSec,
    vendors,
    venueOptions,
    venueRoomName,
    viewerCanApprove,
    peopleLocked,
    viewerName,
    bonusSplit,
    bonusRecord,
    alternatesTaken,
    bonusError,
    bonusSaving,
    saveBonusSplit,
    pickAlternatesTaken,
    owner,
    preparedBy,
    wonMetaGuard,
    packageDocOver,
    setPackageDocOver,
    packageDocOverDraft,
    packageDocFlushRef,
    // #333 — Build package tabs.
    revDateMs,
    contactName,
    docCustName,
    pdfOpts,
    packageSelection,
    setPackageSwitch,
    setDatasheetsIncluded,
    selectionSaving,
    selectionError,
    selectionSettled,
    retrySelection,
    purchasePerksDocLine,
    trackSummary,
    setTrackSummary,
    packageDoc,
    setPackageDoc,
    reviewComments,
    setReviewComments,
    refreshReviewComments,
    next,
  };
}

export type EstimatorState = ReturnType<typeof useEstimatorState>;
