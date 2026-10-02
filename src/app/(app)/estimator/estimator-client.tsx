"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { CSSProperties, Dispatch, SetStateAction } from "react";
import type { QuoteStatus } from "@/lib/stores/quotes";
import type { QuoteNextStepView } from "@/lib/quote-next-step";
import type { NextStepSync } from "@/app/(app)/quotes/review-actions";
import { QuoteNextStep } from "@/components/quote-review/quote-next-step";
import { carriesPipeline, firstStage, stageById } from "@/lib/pipelines";
import {
  addQuoteTaskAction,
  removeQuoteTaskAction,
  applyQuoteTemplateAction,
  draftQuoteScopeAction,
  copySystemToEstimateAction,
  moveSystemToEstimateAction,
  resolveCatalogSkusAction,
  resolveTierAction,
  saveQuoteAction,
  searchQuotesAction,
  setQuotePipelineAction,
  setQuoteStageAction,
  setQuotePeopleAction,
  setQuoteTaskStatusAction,
  setStatusAction,
  travelForSelectionAction,
  updateQuoteMetaAction,
  updateQuoteTaskAction,
  type CopySystemTarget,
  type MoveSystemTarget,
  type ReviewSync,
  type StageSync,
} from "./actions";
import { rewardCreditInfoAction, type RewardCreditInfo } from "@/app/(app)/rewards/actions";
import { isRewardCreditItem, rewardCreditOf, withoutRewardCredit, withRewardCredit } from "@/lib/rewards/credit-line";
import { RewardCreditPanel } from "./reward-credit-panel";
import { PurchasePerksBanner } from "@/components/rewards/purchase-perks-banner";
import { pointsLabel } from "@/lib/rewards/points";
import { TasksCard } from "@/components/tasks-card";
import { ApplyTemplateControl } from "@/components/apply-template-control";
import { ChangeTypeControl } from "@/components/quote-flow-controls";
import { wonEditMessage, type WonEditField } from "@/app/(app)/quotes/new/handoff";
import type { DraftedLine } from "./ai-scope-modal";
import {
  DISC_LABEL,
  type SuggestPart,
} from "./estimator-data";
import {
  backSolveExtSell,
  buildLaborItems,
  computeCurtain,
  computeLabor,
  fmt,
  lineMarginOf,
  makeLaborRate,
  priceFromUnitSellEdit,
  repriceAtMargin,
  repricedAtLineMargin,
  round2,
  short,
  clearSellOverride,
  parseSellOverride,
  SYSTEM_PRICE_STEP,
  systemSellTotal,
  totals,
  vendorTotalSeed,
  withPriceRound,
} from "./pricing";
import type {
  CurtainDraft,
  CustomDraft,
  EstimatorProps,
  FixtureDraft,
  LaborDraft,
  MobDraft,
  SpecItem,
  SpecMob,
  SpecSection,
  TrackDraft,
  TravelLite,
  VendorDraft,
  VendorLineDraft,
  VendorQuote,
} from "./types";
import { sectionFreightDefault, applyAutoFreight } from "./freight-default";
import { PAYMENT_TERMS, vendorAttachmentLoad } from "./types";
import { fixtureBomLine } from "./fixture-bom";
import {
  applyAutoTrips as applyAutoTripsToMobs,
  applyLocalTrip,
  applyMobType,
  applyTravelTripTo,
  defaultLaborMobs,
  disciplineForSystemTitle,
  laborMob,
  roundTripMiles,
  typeMobMiles,
  setRouteMiles,
} from "./labor-defaults";
import {
  laborGroupEdits,
  laborGroupRecord,
  newLaborGroupId,
  pruneLaborGroups,
  snapshotLaborDraft,
  withLaborGroup,
} from "./labor-group";
import { ACCENT_INK, ACCENT_SOFT } from "./est-ui";
import type { QuotePdfOptions } from "@/lib/quote-pdf/pdf-options";
import type { QuotePdfView } from "@/lib/quote-pdf/state";
import { pdfDocKey, withSavedMeta, type PdfDocKeyInput } from "./pdf-doc-key";
import { saveEstimatorCustomPartAction } from "./actions";
import SectionCard, { type InputKind } from "./section-card";
import NarrativeColumn from "./narrative-column";
import { useKeyProductLibrary } from "./use-key-product-library";
import { isKeyProductEligible, remapKeyProducts, toggleKeyProduct, withKeyProducts } from "./narrative";
import { curtainSpecKey } from "@/lib/specs/record-keys";
import { parseMoney, type ImportedMaterial } from "./material-csv";
import { PARTS_CSV_HEADER, partsListCsvRows, partsListRows, partsListSkus, type PartInfo } from "./parts-csv";
import { downloadCsv, fileStem } from "../design/export";
import AiScopeModal from "./ai-scope-modal";
import CurtainModal from "./curtain-modal";
import FixtureModal from "./fixture-modal";
import LaborModal from "./labor-modal";
import TrackModal from "./track-modal";
import {
  curtainTrackDraft,
  curtainTrackPrefill,
  followCurtainPrefill,
  freshTrackDraft,
  replaceTrackLine,
  trackConfigFromDraft,
  trackDraftFromConfig,
  trackLine,
  type CurtainTrackPrefill,
} from "./track-bom";
import VendorQuoteModal, {
  vendorDraftTotal,
  vendorDraftTotalSource,
  vendorKeptLines,
  vendorLinesTotal,
} from "./vendor-quote-modal";
import PreviewDoc from "./preview-doc";
import { DeleteQuoteButton } from "../quotes/delete-quote-button";
import { PortalPanel } from "./portal-panel";
import { catalogAddPrice, repriceForTier, tierRepriceMessage } from "./tier-reprice";
import { PRICING_TIER_LABEL, type PricingTier } from "@/lib/identity/config";

/**
 * Estimator workspace — client port of Estimator.dc.html (build + preview
 * modes). All state lives here; pricing math in ./pricing; persistence via
 * server actions on the quotes store.
 */

/** Prototype prop taxRatePct defaulted to 0 — kept as a constant. */
const TAX_RATE_PCT = 0;

/** #245: freightPct comes from the caller — this runs at module scope (used by
 *  a lazy useState initializer before props are in scope), so it can't read
 *  the freight rule itself. */
const freshSections = (freightPct: number): SpecSection[] => [
  // #267: a new system's auto price rounds up to the next $25.
  { id: "sys1", name: "New System", kind: "materials", mfr: "", freightPct, freightAuto: true, priceRound: SYSTEM_PRICE_STEP, items: [] },
];

const CSS = `
.est-input { font-family: var(--font-mono); }
.est-scroll::-webkit-scrollbar { width: 10px; }
.est-scroll::-webkit-scrollbar-thumb { background: #d6d9e0; border-radius: 8px; border: 3px solid #f7f8fa; }
.est-qd::-webkit-scrollbar-thumb { background: #3a3e46; border-color: #23262d; }
.est-qd-done:hover { color: #fff !important; border-color: #4a4e56 !important; }
.est-qd-chip:hover { color: #fff !important; border-color: #4a4e56 !important; }
.est-qd-col + .est-qd-col { border-left: 1px solid #2b2e35; }
.est-narr-toggle:hover { color: #16181d !important; border-color: #c4c9d2 !important; }
.est-narr-tab:hover { color: #16181d !important; background: #f7f8fa !important; }
.est-side-toggle:hover { color: #16181d !important; border-color: #c4c9d2 !important; }
.est-side-tab:hover { color: #16181d !important; background: #f7f8fa !important; }
.est-field:focus { border-color: #c4c9d2 !important; outline: none; }
.est-warm:focus { border-color: #e3cf94 !important; outline: none; }
.est-secname:hover { border-color: #e4e7ec !important; }
.est-title:hover { border-color: #4a4e56 !important; }
.est-secname:focus { border-color: #c4c9d2 !important; background: #fff !important; outline: none; }
.est-notefield:focus { border-color: #4a4e56 !important; outline: none; }
.est-row:hover { background: #fafbff; }
.est-actions { opacity: .4; transition: opacity .12s; }
.est-row:hover .est-actions, .est-actions:focus-within { opacity: 1; }
.est-row-kp .est-actions { opacity: 1; }
.est-action-btn:hover { background: #eef0f3 !important; }
.est-x:hover { color: #d6584a !important; }
.est-delsys:hover { color: #d6584a !important; }
.est-sug:hover { background: #fff !important; }
.est-close:hover { background: #e7e9ee !important; }
.est-addsys:hover { border-color: var(--accent) !important; color: var(--accent) !important; }
.est-preset:hover { filter: brightness(.97); }
@media (max-width: 860px) {
  .est-root, .est-screen { height: auto !important; min-height: 100% !important; overflow: visible !important; }
  .est-topbar { flex-direction: column !important; align-items: stretch !important; gap: 12px !important; height: auto !important; }
  .est-topright { width: 100% !important; flex-wrap: wrap !important; gap: 10px !important; justify-content: flex-start !important; }
  .est-body { flex-direction: column !important; }
  .est-side { width: 100% !important; border-right: none !important; border-bottom: 1px solid #ececf0 !important; }
  .est-narr { width: 100% !important; order: -1; overflow: visible !important; border-left: none !important; border-bottom: 1px solid #ececf0 !important; }
  .est-narr-collapsed .est-narr-tab { flex-direction: row !important; justify-content: center !important; padding: 8px 12px !important; }
  .est-narr-vlabel { writing-mode: horizontal-tb !important; }
  .est-qd-grid { grid-template-columns: minmax(0, 1fr) !important; }
  .est-qd-col + .est-qd-col { border-left: none !important; border-top: 1px solid #2b2e35 !important; }
  .est-side-collapsed .est-side-tab { flex-direction: row !important; justify-content: center !important; padding: 8px 12px !important; }
  .est-side-vlabel { writing-mode: horizontal-tb !important; }
  .est-main { overflow: visible !important; padding: 16px 16px 48px !important; }
  .est-docwrap { padding: 16px !important; }
  .est-doc { width: 100% !important; padding: 26px 20px !important; }
  .est-prevhead { flex-wrap: wrap !important; row-gap: 10px !important; }
  .est-previewbody { flex-direction: column !important; }
  .est-prevhead { width: 100% !important; border-right: none !important; border-bottom: 1px solid #ececf0 !important; }
  .est-modalwrap { align-items: flex-end !important; padding: 0 !important; }
  .est-modal { width: 100% !important; max-width: 100% !important; border-radius: 16px 16px 0 0 !important; max-height: 92vh !important; }
  .est-modal input, .est-modal select, .est-modal textarea { font-size: 16px !important; }
}
`;

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
  specKey: "",
  sku: "",
  unit: "ea",
  qty: "1",
  cost: "",
  price: "",
});

const freshCurtain = (fabricSku: string): CurtainDraft => ({
  name: "",
  hang: "Pipe",
  fabric: fabricSku,
  qty: "1",
  height: "",
  width: "",
  fullness: "50",
  bottom: "Chain",
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
});

const freshLabor = (
  t: TravelLite | null,
  /** Tier-seeded margin fraction (item 11, D87); null → the legacy 30. */
  tierMargin?: number | null,
  systemTitle = ""
): LaborDraft => ({
  discipline: disciplineForSystemTitle(systemTitle),
  margin:
    tierMargin != null && tierMargin > 0 && tierMargin < 1
      ? String(Math.round(tierMargin * 100))
      : "30",
  mobs: defaultLaborMobs(t),
  pmHrs: "",
  pmAuto: true,
  shopHrs: "",
  drfHrs: "",
  drfAuto: true,
  misc: "",
});

function computeNid(secs: SpecSection[] | null): number {
  let n = 100;
  (secs || []).forEach((s) => {
    const m = /^sys(\d+)$/.exec(s.id);
    if (m) n = Math.max(n, parseInt(m[1], 10));
    (s.items || []).forEach((it) => {
      if (typeof it.id === "number" && isFinite(it.id)) n = Math.max(n, Math.floor(it.id));
    });
  });
  return n;
}

const STATUS_DOT: Record<string, string> = {
  draft: "#c98a2b",
  sent: "#3155a8",
  won: "#1f8a5b",
  lost: "#8c919c",
};

/** Overlapping-chevron breadcrumb shape (Daylite stage bar, Task 6). Every
 *  segment gets the same clip-path and a negative left margin so the next
 *  segment's notch sits over the previous segment's point, and a rising
 *  z-index (left → right) so that notch actually shows through. */
const CHEVRON_CLIP = "polygon(0 0, calc(100% - 12px) 0, 100% 50%, calc(100% - 12px) 100%, 0 100%, 10px 50%)";

const DARK_SELECT: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 12.5,
  fontWeight: 600,
  color: "#fff",
  background: "#2b2e35",
  border: "1px solid #3a3e46",
  borderRadius: 7,
  padding: "7px 10px",
  cursor: "pointer",
};

const CTX_LABEL: CSSProperties = {
  fontSize: 10,
  color: "#9aa0ab",
  textTransform: "uppercase",
  letterSpacing: ".06em",
  flexShrink: 0,
};

const META_SECTION: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 7,
  padding: "14px 16px",
  borderBottom: "1px solid #2b2e35",
};
const META_SUB: CSSProperties = { fontSize: 11, color: "#6b7079", marginTop: 2 };
const META_HINT: CSSProperties = { fontSize: 10.5, color: "#6b7079", lineHeight: 1.35 };
const META_HEAD: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  padding: "10px 12px 10px 16px",
  borderBottom: "1px solid #2b2e35",
};
const META_TOGGLE: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 11,
  fontWeight: 600,
  color: "#9aa0ab",
  background: "transparent",
  border: "1px solid #3a3e46",
  borderRadius: 6,
  padding: "4px 8px",
  cursor: "pointer",
  whiteSpace: "nowrap",
};
const SIDE_OPEN_KEY = "quartzite.estimator.sideOpen";
/** #281: the narrative column's open/collapsed choice, per browser. */
const NARR_OPEN_KEY = "quartzite.estimator.narrOpen";
const SIDE_TOGGLE: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 11,
  fontWeight: 600,
  color: "#9aa0ab",
  background: "transparent",
  border: "1px solid #e4e7ec",
  borderRadius: 6,
  padding: "3px 7px",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const INSTALL_TIMEFRAMES = ["ASAP", "Under 1 month", "1–3 months", "3–6 months", "6–12 months", "TBD"] as const;

export default function EstimatorClient({
  initial,
  pipelines,
  fabrics,
  curtainSewingPct,
  trackSeries,
  trackParts,
  laborRates,
  fixtureRates,
  fixtureAssemblies,
  vendors,
  blobUploads,
  customers,
  travel,
  next: initialNext,
  aiSource,
  people,
  quoteTasks,
  templateSets,
  assumptionLibrary,
  freightRule,
  portalStatusError,
  specKeys,
  canApplyCredit,
  viewerName,
  viewerCanApprove,
  canWriteNarrativeLibrary,
  narrativeIntros,
}: EstimatorProps) {
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
      : freshSections(initialFreightDefault.pct)
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
    setSectionsState(v);
  };
  /** The latest committed sections, read when a tier stamp lands (#254). */
  const sectionsRef = useRef(sections);
  useEffect(() => {
    sectionsRef.current = sections;
  }, [sections]);
  const nidRef = useRef<number | null>(null);
  if (nidRef.current == null) nidRef.current = computeNid(initial.sections);
  const nextId = () => ++(nidRef.current as number);

  const defaultFabric = fabrics.some((f) => f.sku === "RB-MV-MN")
    ? "RB-MV-MN"
    : fabrics[0]?.sku ?? "RB-MV-MN";

  const [mode, setMode] = useState<"build" | "preview">("build");
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
  /** #284 — the server-evaluated next-step control (pill, primary action, ⋯);
   *  every sync/save refreshes it. It carries the #242 limit chip as its strip. */
  const [next, setNext] = useState<QuoteNextStepView | null>(initialNext);
  /** #284 — the actionError banner came from the approval gate, so it offers the next step. */
  const [gateRefused, setGateRefused] = useState(false);
  /* Daylite stage bar (Task 6) — quoteType never changes client-side (no UI
     changes it), so it stays a plain const rather than state. */
  const quoteType = initial.quoteType;
  const [pipelineId, setPipelineId] = useState(initial.pipelineId);
  const [stage, setStage] = useState(initial.stage);
  /** Narrative column (#281). Defaults open on both server and first client
   *  render; the remembered choice is applied after mount so hydration matches. */
  const [narrOpen, setNarrOpen] = useState(true);
  /** #293 — the system-intro library; the intro actions answer with the new list. */
  const [intros, setIntros] = useState(narrativeIntros);
  useEffect(() => {
    try {
      if (window.localStorage.getItem(NARR_OPEN_KEY) === "0") setNarrOpen(false);
    } catch {
      /* storage unavailable (private mode, blocked) — stay open */
    }
  }, []);
  const showNarr = (next: boolean) => {
    setNarrOpen(next);
    try {
      window.localStorage.setItem(NARR_OPEN_KEY, next ? "1" : "0");
    } catch {
      /* ignore */
    }
  };
  const narrRef = useRef<HTMLTextAreaElement | null>(null);
  /** Bumped by a card's snippet — the effect focuses the textarea once the
   *  column (and the newly active system) has rendered, caret at the end. */
  const [narrFocusReq, setNarrFocusReq] = useState(0);
  useEffect(() => {
    if (!narrFocusReq) return;
    const el = narrRef.current;
    if (!el) return;
    el.focus();
    const n = el.value.length;
    el.setSelectionRange(n, n);
  }, [narrFocusReq]);
  /** Systems rail (#168). Same hydration-safe pattern as narrOpen above. */
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
        verb?: "Moved" | "Copied";
        /** #266: the re-price summary; a copy within this estimate has no targetId. */
        detail?: string;
      }
    | { ok: false; error: string }
    | null
  >(null);
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
  const checkedAssumptions = useMemo(() => new Set(assumptions.split("\n").map((line) => line.trim()).filter(Boolean)), [assumptions]);
  const [installTimeframe, setInstallTimeframe] = useState(initial.installTimeframe);
  const [paymentTerms, setPaymentTerms] = useState(initial.paymentTerms);
  // #110: user-named quote category — persisted on blur, not per keystroke.
  const [category, setCategory] = useState(initial.category);
  const categorySaved = useRef(initial.category);
  const [revNum, setRevNum] = useState(initial.revNum);
  const [, setRevDateMs] = useState(initial.revDateMs);
  const [pdfQty, setPdfQty] = useState(initial.pdfOptions.pdfQty);
  const [pdfNotes, setPdfNotes] = useState(initial.pdfOptions.pdfNotes);
  const [pdfCover, setPdfCover] = useState(initial.pdfOptions.pdfCover);
  const [pdfTerms, setPdfTerms] = useState(initial.pdfOptions.pdfTerms);
  const [pdfOptions, setPdfOptions] = useState(initial.pdfOptions.pdfOptions);
  const [pdfPrices, setPdfPrices] = useState(initial.pdfOptions.pdfPrices);
  const [pdfItemizedAppendix, setPdfItemizedAppendix] = useState(initial.pdfOptions.pdfItemizedAppendix);
  const [detail, setDetail] = useState<"itemized" | "sectioned">(initial.pdfOptions.detail);
  /** #222 — the Show-on-PDF choices, saved with the quote (Quote.pdfOptions). */
  const pdfOpts = useMemo<QuotePdfOptions>(
    () => ({ detail, pdfQty, pdfNotes, pdfPrices, pdfCover, pdfTerms, pdfOptions, pdfItemizedAppendix }),
    [detail, pdfQty, pdfNotes, pdfPrices, pdfCover, pdfTerms, pdfOptions, pdfItemizedAppendix]
  );
  const [activeId, setActiveId] = useState<string | null>(
    () => (initial.sections ?? freshSections(initialFreightDefault.pct))[0]?.id ?? null
  );
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
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
    };
  };
  // Customer tier margin stamp (item 11, D87) — SEEDS the labor draft and
  // curtain configurator; refreshed when the meta action re-stamps.
  const [tierMargin, setTierMargin] = useState<number | null>(initial.tierMargin);
  /** The stamp in effect, read synchronously when the next one lands (#254) —
   *  the closure's `tierMargin` can be a render behind. */
  const tierMarginRef = useRef<number | null>(initial.tierMargin);
  const [laborDraft, setLaborDraft] = useState<LaborDraft>(() =>
    freshLabor(null, initial.tierMargin, (initial.sections ?? freshSections(initialFreightDefault.pct))[0]?.name || "")
  );
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
  const appliedCredit = rewardCreditOf(sections);
  const applyCredit = (amount: number) =>
    setSections((ss) => withRewardCredit(ss, amount, nextId()));
  const removeCredit = () => setSections((ss) => withoutRewardCredit(ss));

  const isBuild = !phone && mode === "build";
  const isPreview = phone || mode === "preview";
  const isInternal = true; // build mode is the internal view (prototype view: 'internal')
  /* One shared line-item grid template — header, item rows and the freight
     row all render off this SAME `cols` (section-card.tsx), so a column can
     only drift out of alignment here. Item shrunk / numeric columns widened
     (punch: raw-looking columns) so Unit sell's 92px input + margin% chip and
     Ext sell's own input both have room; the ×/↑/↓ actions now share ONE
     64px cell instead of three, which used to overflow the old 22px column
     and wrap onto a second grid row. #269: 84px internally, room for the
     labor lines' ✎ Edit labor button beside them. #293: +20px for the ★
     key-product toggle. */
  const cols = isInternal
    ? "minmax(150px,1.3fr) 104px 92px 136px 116px 104px"
    : "minmax(150px,1.3fr) 104px 136px 116px 84px";

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
      vendorQuotes,
      pdfOptions: pdfOpts,
    }),
    [quoteId, projectName, docCustName, customerId, locationId, contactName, quoteNote, assumptions, paymentTerms, sections, vendorQuotes, pdfOpts]
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

  /* ---------------- persistence ---------------- */
  /** #254 (D87 amended) — re-price the lines still at `prev`'s margin to
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
   *  margin (the server resolves the stamp from the posted customer/contact).
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
      setStatus(r.status);
      setBaseStatus(r.status);
    }
  };

  /** Same idea as applySync, for the Daylite stage bar's StageSync (Task 6) —
   *  a stage move can also change status/review (setQuoteStage runs setStatus
   *  underneath when the tag changes), so all four fields sync together. */
  const applyStageSync = (r: StageSync) => {
    if (r.next !== undefined) setNext(r.next ?? null);
    if (r.status) {
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
    const docAtSave = docInput;
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
          margin: t.margin,
          status,
          // #180 review 2 — what this tab last confirmed from the server,
          // so the action can tell a genuine change from a stale tab.
          baseStatus,
          sections,
          mobs,
          vendorQuotes,
          pdfOptions: pdfOpts,
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
          // #223: this save's render prints the number the server hands back.
          setSavedDoc({ ...docAtSave, quoteNumber: res.number ?? res.id });
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
            setStatus(res.status);
            setBaseStatus(res.status);
          }
          // Daylite stage bar (Task 6) — a brand-new quote has no pipeline
          // until this first save creates it; pick it up immediately so the
          // bar shows the right stage highlighted without another round trip.
          if (res.pipelineId) setPipelineId(res.pipelineId);
          if (res.stage) setStage(res.stage);
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
          const r = await setStatusAction(id, v);
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
          // #282 follow-up: the server cleared the credit when the quote went
          // Lost — take the line off the open document too.
          if (v === "lost") setSections((ss) => (rewardCreditOf(ss) > 0 ? withoutRewardCredit(ss) : ss));
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
        const r = await setQuoteStageAction(id, stageId);
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
  const toggleExpand = (id: string) => setExpanded((e) => ({ ...e, [id]: !isExpanded(id) }));

  const patchItem = (id: number, f: (it: SpecItem) => SpecItem) =>
    setSections((ss) =>
      ss.map((s) =>
        s.items.some((x) => x.id === id)
          ? { ...s, items: s.items.map((x) => (x.id === id ? f(x) : x)) }
          : s
      )
    );
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
  const moveItem = (secId: string, id: number, direction: -1 | 1) =>
    setSections((ss) => ss.map((s) => {
      if (s.id !== secId) return s;
      const index = s.items.findIndex((item) => item.id === id);
      const next = index + direction;
      if (index < 0 || next < 0 || next >= s.items.length) return s;
      const items = [...s.items];
      [items[index], items[next]] = [items[next], items[index]];
      return { ...s, items: items.map((item, i) => ({ ...item, lineOrder: i })) };
    }));
  const inc = (id: number) => patchItem(id, (it) => ({ ...it, qty: it.qty + 1 }));
  const dec = (id: number) => patchItem(id, (it) => ({ ...it, qty: Math.max(0, it.qty - 1) }));
  const setQty = (id: number, v: string) => {
    let n = parseInt(v, 10);
    if (isNaN(n) || n < 0) n = 0;
    patchItem(id, (it) => ({ ...it, qty: n }));
  };
  const removeItem = (id: number) => {
    // #143: the × on a vendor line takes its VendorQuote record with it —
    // otherwise the attachment and the internal terms outlive the money.
    const gone = sections.flatMap((s) => s.items).find((x) => x.id === id);
    if (gone?.vendorQuoteId)
      setVendorQuotes((vs) => vs.filter((v) => v.id !== gone.vendorQuoteId));
    // #269: a labor group's stored draft goes with its LAST line.
    setSections((ss) => ss.map((s) => pruneLaborGroups({ ...s, items: s.items.filter((x) => x.id !== id) })));
  };

  // #267: both margin sliders re-price the lines AND drop a typed system sell.
  const setMarginAll = (v: string) => {
    const m = parseInt(v, 10) / 100;
    setSections((ss) =>
      ss.map((s) => ({
        ...clearSellOverride(s),
        // #282 phase 2: the Rewards credit is not a priced line.
        items: s.items.map((it) => (isRewardCreditItem(it) ? it : { ...it, ...repriceAtMargin(it.cost, m) })),
      }))
    );
  };
  const setSystemMargin = (secId: string, v: string) => {
    const m = parseFloat(v) / 100;
    setSections((ss) =>
      ss.map((s) =>
        s.id === secId
          ? { ...clearSellOverride(s), items: s.items.map((it) => (isRewardCreditItem(it) ? it : { ...it, ...repriceAtMargin(it.cost, m) })) }
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
        movedVq
      );
      if (res.ok) {
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
        usedVq
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
        const copy: SpecSection = withKeyProducts(
          { ...res.section, id: newId, name: sec.name + " (copy)", items: copyItems },
          remapKeyProducts(res.section.keyProducts, idMap)
        );
        setSections((ss) => {
          const at = ss.findIndex((s) => s.id === secId);
          return at < 0 ? [...ss, copy] : [...ss.slice(0, at + 1), copy, ...ss.slice(at + 1)];
        });
        requestAnimationFrame(() => requestAnimationFrame(() => selectSystem(newId)));
        setMoveNotice({ ok: true, targetId: "", targetName: "", targetNumber: "", verb: "Copied", detail });
      } else {
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
    setSections((ss) => [
      ...ss,
      { id, name: "New System", kind: "materials", mfr: "", freightPct: freightDefault.pct, freightAuto: true, priceRound: SYSTEM_PRICE_STEP, items: [] },
    ]);
    setActiveId(id);
    openInputMethod("catalog", id);
    requestAnimationFrame(() => requestAnimationFrame(() => scrollToCard(id)));
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

  const [partsBusy, setPartsBusy] = useState(false);
  const exportPartsList = async () => {
    if (partsBusy) return;
    setPartsBusy(true);
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
      const rows = partsListRows(sections, vendorQuotes, info, venueRoomName);
      if (!rows.length) {
        setActionError(null);
        setGateRefused(false);
        setActionNotice("No parts to export yet.");
        return;
      }
      const name = loadedId ? quoteId : projectName || quoteId;
      downloadCsv(`${fileStem(name, "estimate")}-parts-list`, PARTS_CSV_HEADER, partsListCsvRows(rows));
    } catch {
      setActionError("Couldn't build the parts list — try again.");
      setGateRefused(false);
    } finally {
      setPartsBusy(false);
    }
  };

  /* ---- Scope draft from survey/inspection (S12/D83 — rules-based) ----
     Deterministic: the linked record's captured fields are assembled into a
     scope paragraph (no model call, no line items — Jeff adds items
     manually). "Insert scope" appends the paragraph to the quote note. */
  const aiTargetSection = (): SpecSection | null =>
    sections.find((s) => s.id === activeId) || sections[0] || null;

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
    if (kind === "custom") setCustomDraft(freshCustom());
    else if (kind === "curtain") {
      setCurtainDraft(freshCurtain(defaultFabric));
      setCurtainTrack(null);
    } else if (kind === "track") {
      // #274: an abandoned track edit must not seed the next "+ Configure track".
      trackEditRef.current = null;
      setTrackEdit(null);
      setTrackDraft(freshTrackDraft(trackSeries));
    } else if (kind === "fixture") setFixtureDraft(freshFixture());
    else if (kind === "vendor") {
      // #144: an abandoned edit must not seed the next "+ Vendor quote".
      vendorEditRef.current = null;
      setVendorDraft(freshVendor());
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
    if (kind === "custom") setCustomDraft(freshCustom());
    else if (kind === "curtain") {
      setCurtainDraft(freshCurtain(defaultFabric));
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
      const editId = vendorEditRef.current;
      vendorEditRef.current = null;
      const rec = editId ? vendorQuotes.find((v) => v.id === editId) : undefined;
      setVendorDraft(rec ? vendorDraftFromRecord(rec) : freshVendor());
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
      });
    }
  };

  /** Close whatever input method is open, discarding its draft. */
  const closeInput = () => {
    const cur = openInputRef.current;
    openInputRef.current = null;
    openSeqRef.current++; // retires any callback still in flight for that open
    setOpenInput(null);
    if (cur) discardDraft(cur.kind, cur.secId);
  };

  /** Open one input method on one system, exclusively. Clicking the method that
   *  is already open on that system closes it — which discards it too. */
  const openInputMethod = (kind: InputKind, secId: string) => {
    const cur = openInputRef.current;
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
  };

  /** Open the vendor form on a STORED quote (#144), so editing participates in
   *  the exclusivity rule (D161) like any other open. */
  const openVendorEdit = (secId: string, vqId: string) => {
    /* Closed first, for two reasons: openInputMethod reads "the method already
       open on this system" as a toggle and would close the form we are about to
       seed, and its discard of the outgoing draft would clear the pending seed
       set below. After closeInput there is nothing open left to discard. */
    closeInput();
    vendorEditRef.current = vqId;
    openInputMethod("vendor", secId);
  };

  /** #269: reopen the Labor configurator on the draft that built a labor
   *  group, from any of its lines. Same close-then-seed dance as
   *  openVendorEdit. A group with no stored draft (added before #269) has
   *  no edit affordance, so this is a no-op for it. */
  const openLaborEdit = (secId: string, group: string) => {
    const sec = sections.find((s) => s.id === secId);
    const rec = sec ? laborGroupRecord(sec, group) : null;
    if (!sec || !rec) return;
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
    closeInput();
    trackEditRef.current = {
      lineId,
      draft: trackDraftFromConfig(it.track),
      readOnly: gone ? { components: it.components, cost: it.cost, price: it.price } : null,
    };
    openInputMethod("track", secId);
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

  const addCustomPart = async (secId: string) => {
    const d = customDraft;
    const desc = (d.desc || "").trim();
    const margin = tierMargin != null && tierMargin > 0 && tierMargin < 1 ? tierMargin : 0.3;
    let qty = parseInt(d.qty, 10);
    if (isNaN(qty) || qty < 1) qty = 1;
    let cost = parseFloat(d.cost);
    if (isNaN(cost) || cost < 0) cost = 0;
    const typedPrice = parseFloat(d.price);
    const price = d.allowance && (!Number.isFinite(typedPrice) || typedPrice <= 0)
      ? round2(cost / (1 - margin))
      : typedPrice;
    if (!desc || !Number.isFinite(price) || price <= 0) return;
    if (d.addToCatalog && !d.allowance) {
      const saved = await saveEstimatorCustomPartAction({
        sku: (d.sku || "").trim(),
        desc,
        category: "Custom Parts",
        unit: (d.unit || "").trim() || "ea",
        cost,
        list: price,
        mfr: d.manufacturer.trim(),
        manufacturerPartNumber: d.manufacturerPartNumber.trim(),
        priceGoodThrough: d.priceGoodThrough,
      });
      if (!saved.ok) return;
    }
    pushItems(secId, [
      {
        id: nextId(),
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
        specKey: d.specKey || undefined,
      },
    ]);
    closeInput(); // closing discards, so the draft reseed happens there
  };

  /* ---------------- vendor quote (#143, D162) ----------------
     ONE priced SpecItem per vendor quote carries the money (the vendor's
     rolled-up total, marked up by the section margin like any other cost
     line). The material lines stay on the VendorQuote record rather than
     becoming sibling SpecItems: that keeps pricing.ts honest with a single
     priced line, survives the row's × control, and makes Single/Itemized a
     pure render decision instead of a set of $0 rows that would leak onto
     the customer document. */
  const setVendorField = <K extends keyof VendorDraft>(field: K, value: VendorDraft[K]) =>
    setVendorDraft((d) => ({ ...d, [field]: value }));
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
    const seedMargin = tierMargin != null && tierMargin > 0 && tierMargin < 1 ? tierMargin : 0.3;
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
      })),
      terms: d.terms || "",
      notes: d.notes || "",
      total,
      totalSource: vendorDraftTotalSource(d),
      includesFreight: d.includesFreight,
      display: d.display,
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
              /* The line's CURRENT margin, rescaled to the new cost (#144,
                 D163) — never re-seeded from the tier, which would undo a
                 margin slider drag or a typed sell price. Shared with the
                 form's own Sell stat (`vendorFormMargin`) so the number the
                 user reads before saving is the number that lands. */
              price: repricedAtLineMargin(it.cost, it.price, total, seedMargin),
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
          price: round2(total / (1 - seedMargin)),
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
    if (!name || c.priceEach <= 0) return;
    // #274: Add track — the curtain's track line follows it; a track with a
    // blocking error blocks the whole add (the modal already disables it).
    let track: SpecItem | null = null;
    if (curtainTrack) {
      const config = trackConfigFromDraft(curtainTrack);
      const res = trackLine(config, trackSeries.find((s) => s.id === config.seriesId), trackParts, tierMargin);
      if (!res.ok) return;
      track = { ...res.item, id: 0 };
    }
    let qty = parseInt(d.qty, 10);
    if (isNaN(qty) || qty < 1) qty = 1;
    const dims = (parseFloat(d.width) || 0) + "'W × " + (parseFloat(d.height) || 0) + "'H";
    const idN = nextId();
    const skuN = nextId();
    if (track) track.id = nextId();
    pushItems(secId, [
      {
        id: idN,
        sku: "CRT-" + skuN,
        desc: name + " — " + c.fab.name + ", " + dims + ", " + d.fullness + "% fullness",
        qty,
        unit: "ea",
        cost: c.costEach,
        price: c.priceEach,
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
      { id: nextId(), sku: assembly.id, desc: line.desc, qty, unit: "ea", cost: line.cost, price: line.price, fixture: true, components: line.components },
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
  /** #293: the active system's eligible skus — the library cache prefetches them. */
  const narrSkus = useMemo(() => (narrSec ? narrSec.items.filter(isKeyProductEligible).map((it) => it.sku.trim()) : []), [narrSec]);
  const kpLib = useKeyProductLibrary(narrSkus);
  const updateSection = (secId: string, fn: (s: SpecSection) => SpecSection) =>
    setSections((ss) => ss.map((s) => (s.id === secId ? fn(s) : s)));
  /** #293 ★: marking copies the saved paragraph when the library row is loaded. */
  const toggleKeyProductLine = (secId: string, itemId: number) => {
    const it = sections.find((s) => s.id === secId)?.items.find((i) => i.id === itemId);
    const text = (it && kpLib.rows[it.sku.trim()]?.paragraph) || "";
    updateSection(secId, (s) => toggleKeyProduct(s, itemId, text));
  };

  const curtainSec = sections.find((s) => s.id === curtainFor);
  const fixtureSec = sections.find((s) => s.id === fixtureFor);
  const laborSec = sections.find((s) => s.id === laborFor);
  const vendorSec = sections.find((s) => s.id === vendorFor);
  const trackSec = sections.find((s) => s.id === trackFor);
  /** The stored quote the vendor form is editing, if it is editing one (#144). */
  const vendorEditingRec = vendorQuotes.find((v) => v.id === vendorDraft.id);
  /**
   * The margin the vendor form prices its "Sell" stat at (#144 re-review).
   *
   * On an ADD that is the tier seed, the same rule the spawned line is built
   * with. On an EDIT it has to be the margin the LINE is carrying, because that
   * is what commitVendorQuote preserves (repricedAtLineMargin): the tier seed
   * would show a sell price the save then does not write, off by exactly
   * however far the system margin slider has since been dragged — and the Sell
   * stat is the one number in the form Jeff reads to decide whether to accept
   * the vendor's new total.
   */
  const vendorFormMargin = (() => {
    const seed = tierMargin != null && tierMargin > 0 && tierMargin < 1 ? tierMargin : 0.3;
    if (!vendorEditingRec) return seed;
    const line = sections
      .flatMap((s) => s.items)
      .find((it) => it.vendorQuoteId === vendorDraft.id);
    const m = line ? lineMarginOf(line.cost, line.price) : null;
    return m != null ? m : seed;
  })();

  return (
    <div
      className="est-root"
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        fontFamily: "var(--font-ui)",
        color: "#16181d",
        background: "#f7f8fa",
        overflow: "hidden",
      }}
    >
      <style>{CSS}</style>

      {/* ===================== BUILD MODE ===================== */}
      {isBuild && (
        <div
          data-screen-label="Estimator workspace"
          className="est-screen"
          style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}
        >
          {/* contextual project toolbar */}
          <div
            className="est-topbar"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 18,
              padding: "11px 22px",
              background: "#1d2026",
              borderTop: "1px solid #2b2e35",
              color: "#fff",
              flexShrink: 0,
              position: "sticky",
              top: 0,
              zIndex: 20,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 11, minWidth: 0 }}>
              <div style={{ minWidth: 0 }}>
                {titleEditing ? (
                  <input
                    autoFocus
                    aria-label="Quote name"
                    value={titleDraft}
                    onChange={(e) => setTitleDraft(e.target.value)}
                    onBlur={() => closeTitle(true)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        closeTitle(true);
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        closeTitle(false);
                      }
                    }}
                    style={{
                      fontSize: 14,
                      fontWeight: 600,
                      lineHeight: 1.2,
                      fontFamily: "var(--font-ui)",
                      color: "#fff",
                      background: "#2b2e35",
                      border: "1px solid #4a4e56",
                      borderRadius: 6,
                      padding: "2px 6px",
                      width: 340,
                      maxWidth: "100%",
                      outline: "none",
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    onClick={openTitle}
                    title="Rename this quote"
                    style={{
                      display: "block",
                      maxWidth: "100%",
                      fontSize: 14,
                      fontWeight: 600,
                      lineHeight: 1.2,
                      fontFamily: "var(--font-ui)",
                      color: "#fff",
                      background: "none",
                      border: "1px dashed transparent",
                      borderRadius: 6,
                      padding: "2px 6px",
                      margin: "-3px -7px",
                      cursor: "text",
                      textAlign: "left",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                    className="est-title"
                  >
                    {projectName}
                  </button>
                )}
                <div style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 2, minWidth: 0 }}>
                  <span style={{ fontSize: 11, color: "#9aa0ab", fontFamily: "var(--font-mono)", flexShrink: 0, whiteSpace: "nowrap" }}>
                    {quoteId} · Rev {revNum}
                  </span>
                  {loadedId && <ChangeTypeControl quoteId={loadedId} status={status} tone="dark" />}
                  {/* #281: Quote details moved from the right column into a dropdown. */}
                  <button
                    ref={qdChipRef}
                    type="button"
                    className="est-qd-chip"
                    onClick={() => (qdOpen ? closeQd() : setQdOpen(true))}
                    aria-expanded={qdOpen}
                    aria-controls="est-quote-details"
                    title="Prepared for, venue, contact, category, quote note, assumptions, install timeframe"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 5,
                      minWidth: 0,
                      maxWidth: 420,
                      fontFamily: "var(--font-ui)",
                      fontSize: 11,
                      fontWeight: 600,
                      color: qdOpen ? "#fff" : "#cfd3da",
                      background: qdOpen ? "#2b2e35" : "transparent",
                      border: "1px solid " + (qdOpen ? "#4a4e56" : "#3a3e46"),
                      borderRadius: 6,
                      padding: "2px 8px",
                      cursor: "pointer",
                    }}
                  >
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {qdChipLabel}
                    </span>
                    <span aria-hidden="true" style={{ flexShrink: 0, fontSize: 9 }}>
                      {qdOpen ? "▴" : "▾"}
                    </span>
                  </button>
                </div>
              </div>
            </div>
            <div
              className="est-topright"
              style={{ display: "flex", alignItems: "center", gap: 22, flexShrink: 0 }}
            >
              <div style={{ textAlign: "right" }}>
                <div
                  style={{
                    fontSize: 10,
                    color: "#9aa0ab",
                    textTransform: "uppercase",
                    letterSpacing: ".05em",
                  }}
                >
                  Blended margin
                </div>
                <div
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 15,
                    fontWeight: 600,
                    color: "#5fd29a",
                  }}
                >
                  {(t.margin * 100).toFixed(1)}%
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div
                  style={{
                    fontSize: 10,
                    color: "#9aa0ab",
                    textTransform: "uppercase",
                    letterSpacing: ".05em",
                  }}
                >
                  Quoted total
                </div>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 18, fontWeight: 600 }}>
                  {fmt(t.grand)}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: STATUS_DOT[status] || "#c98a2b",
                    flexShrink: 0,
                  }}
                />
                <select
                  value={status}
                  onChange={(e) => changeStatus(e.target.value as QuoteStatus)}
                  style={{ ...DARK_SELECT, borderRadius: 8, padding: "9px 10px" }}
                >
                  <option value="draft">Draft</option>
                  <option value="sent">Sent</option>
                  <option value="won">Won</option>
                  <option value="lost">Lost</option>
                </select>
              </div>
              {loadedId && <DeleteQuoteButton id={loadedId} won={status === "won"} redirectTo="/estimator" />}
              {aiSource && (
                <button
                  type="button"
                  onClick={openAiDraft}
                  title={"Assemble the scope of work from " + aiSource.label}
                  style={{
                    fontFamily: "var(--font-ui)",
                    fontSize: 13,
                    fontWeight: 600,
                    borderRadius: 8,
                    padding: "9px 15px",
                    cursor: "pointer",
                    border: "1px solid var(--accent)",
                    background: ACCENT_SOFT,
                    color: ACCENT_INK,
                  }}
                >
                  Draft from survey/inspection
                </button>
              )}
              <button
                type="button"
                onClick={exportPartsList}
                disabled={partsBusy}
                title="Model numbers, descriptions and cost for every part — assemblies broken into their parts. For purchasing."
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: 13,
                  fontWeight: 600,
                  border: "none",
                  borderRadius: 8,
                  padding: "9px 15px",
                  cursor: partsBusy ? "not-allowed" : "pointer",
                  opacity: partsBusy ? 0.6 : 1,
                  background: "#2b2e35",
                  color: "#cfd3da",
                }}
              >
                Parts list (CSV)
              </button>
              <button
                type="button"
                onClick={doSave}
                disabled={statusChanging || tierResolving}
                title={
                  statusChanging
                    ? "A status change is still saving — try again in a moment."
                    : tierResolving
                      ? "Looking up the customer’s pricing tier — Save in a moment."
                      : undefined
                }
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: 13,
                  fontWeight: 600,
                  border: "none",
                  borderRadius: 8,
                  padding: "9px 15px",
                  cursor: statusChanging || tierResolving ? "not-allowed" : "pointer",
                  opacity: statusChanging || tierResolving ? 0.6 : 1,
                  ...(justSaved
                    ? { background: "#22361f", color: "#5fd29a" }
                    : { background: "#2b2e35", color: "#cfd3da" }),
                }}
              >
                {justSaved ? "Saved ✓" : "Save"}
              </button>
              {/* #284 — the one next-step control: pill · Submit / Approve / Send → · ⋯ */}
              {loadedId && next && (
                <QuoteNextStep
                  quoteId={loadedId}
                  view={next}
                  variant="toolbar"
                  savedOnly={pdfDirty}
                  disabled={statusChanging || tierResolving}
                  beforeAction={pdfDirty ? saveNow : undefined}
                  onSync={(r) => {
                    applySync(r);
                    if (r.ok) {
                      setActionError(null);
                      setGateRefused(false);
                    }
                  }}
                  onError={(m) => {
                    setActionError(m);
                    setGateRefused(false);
                  }}
                />
              )}
              <button
                type="button"
                onClick={() => setMode("preview")}
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: 13,
                  fontWeight: 600,
                  color: "#16181d",
                  background: "#fff",
                  padding: "9px 16px",
                  borderRadius: 8,
                  border: "none",
                  cursor: "pointer",
                }}
              >
                Customer preview →
              </button>
            </div>
            {qdOpen && (
              <div
                ref={qdPanelRef}
                id="est-quote-details"
                className="est-qd est-scroll"
                role="region"
                aria-label="Quote details"
                style={{
                  position: "absolute",
                  top: "100%",
                  left: 0,
                  right: 0,
                  zIndex: 30,
                  maxHeight: "min(70vh, 640px)",
                  overflowY: "auto",
                  background: "#23262d",
                  borderTop: "1px solid #2b2e35",
                  borderBottom: "1px solid #2b2e35",
                  boxShadow: "0 12px 28px rgba(0,0,0,.28)",
                  color: "#fff",
                }}
              >
                <div style={META_HEAD}>
                  <span style={{ ...CTX_LABEL, fontWeight: 600 }}>Quote details</span>
                  <button type="button" className="est-qd-done" onClick={closeQd} style={META_TOGGLE}>
                    Done
                  </button>
                </div>
                <div className="est-qd-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
                  <div className="est-qd-col">
                  <section style={META_SECTION}>
                    <span style={CTX_LABEL}>Prepared for</span>
                    <select
                      value={customerId || ""}
                      onChange={(e) => pickCustomer(e.target.value)}
                      title="Linked customer — flows to the project when this quote is won"
                      style={{ ...DARK_SELECT, width: "100%", minWidth: 0 }}
                    >
                      {customerOptions.map((o) => (
                        <option key={o.value || "__none"} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    {showVenuePick && (
                      <>
                        <span style={META_SUB}>at</span>
                        <select
                          value={locationId || ""}
                          onChange={(e) => pickVenue(e.target.value)}
                          title="Which of the customer's venues"
                          style={{ ...DARK_SELECT, width: "100%", minWidth: 0 }}
                        >
                          {venueOptions.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </>
                    )}
                    {showContactPick && (
                      <>
                        <span style={META_SUB}>attn</span>
                        <select
                          value={currentContact ? currentContact.name : ""}
                          onChange={(e) => pickContact(e.target.value)}
                          title="Contact this quote is prepared for"
                          style={{ ...DARK_SELECT, width: "100%", minWidth: 0 }}
                        >
                          {contactOptions.map((o) => (
                            <option key={o.value || "__none"} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </>
                    )}
                    {wonMetaGuard && (
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          flexWrap: "wrap",
                          gap: 7,
                          marginTop: 2,
                          padding: "7px 9px",
                          fontSize: 11.5,
                          lineHeight: 1.35,
                          color: "#e3c26e",
                          background: "#3a331d",
                          border: "1px solid #55471f",
                          borderRadius: 7,
                        }}
                      >
                        <span style={{ flex: 1, minWidth: 140 }}>
                          {wonEditMessage(wonMetaGuard.field)}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            const run = wonMetaGuard.run;
                            setWonMetaGuard(null);
                            run();
                          }}
                          style={{
                            fontFamily: "var(--font-ui)",
                            fontSize: 11,
                            fontWeight: 600,
                            color: "#16181d",
                            background: "#e3c26e",
                            border: "none",
                            borderRadius: 6,
                            padding: "4px 9px",
                            cursor: "pointer",
                          }}
                        >
                          Change
                        </button>
                        <button
                          type="button"
                          onClick={() => setWonMetaGuard(null)}
                          style={{
                            fontFamily: "var(--font-ui)",
                            fontSize: 11,
                            fontWeight: 600,
                            color: "#e3c26e",
                            background: "transparent",
                            border: "1px solid #55471f",
                            borderRadius: 6,
                            padding: "4px 9px",
                            cursor: "pointer",
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                    <span style={META_SUB}>category</span>
                    <input
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                      onBlur={() => {
                        const v = category.trim();
                        if (v !== category) setCategory(v);
                        if (v === categorySaved.current) return;
                        categorySaved.current = v;
                        persistMeta({ category: v });
                      }}
                      placeholder="Category"
                      title="Quote category — shown on the Quotes hub"
                      style={{ ...DARK_SELECT, width: "100%", minWidth: 0, cursor: "text" }}
                    />
                  </section>
                  <section style={META_SECTION}>
                    <span style={CTX_LABEL}>Lead estimator</span>
                    <select
                      value={ownerValue}
                      onChange={(e) => changePeople({ owner: e.target.value })}
                      disabled={!loadedId || peopleBusy}
                      aria-label="Lead estimator"
                      title={
                        viewerCanApprove
                          ? "Owns the quote — their review limit applies and it lists under them on the Quotes hub"
                          : "Only an approver can hand a quote to someone else"
                      }
                      style={{ ...DARK_SELECT, width: "100%", minWidth: 0, opacity: loadedId ? 1 : 0.6 }}
                    >
                      {peopleOptions(ownerValue).map((o) => {
                        const locked = !viewerCanApprove && !samePerson(o.value, viewerName) && o.value !== ownerValue;
                        return (
                          <option
                            key={o.value || "__none"}
                            value={o.value}
                            disabled={locked || !o.value}
                            title={locked ? "Only an approver can hand a quote to someone else" : undefined}
                          >
                            {o.label}
                          </option>
                        );
                      })}
                    </select>
                    <span style={{ ...CTX_LABEL, marginTop: 4 }}>Prepared by</span>
                    <select
                      value={preparedValue}
                      onChange={(e) => changePeople({ preparedBy: e.target.value })}
                      disabled={!loadedId || peopleBusy}
                      aria-label="Prepared by"
                      title="Prints under Prepared by on the customer document"
                      style={{ ...DARK_SELECT, width: "100%", minWidth: 0, opacity: loadedId ? 1 : 0.6 }}
                    >
                      {peopleOptions(preparedValue).map((o) => (
                        <option key={o.value || "__none"} value={o.value} disabled={!o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    <span style={META_HINT}>
                      {loadedId ? "Saved as you pick" : "Save the quote to change these"}
                    </span>
                  </section>
                  <section style={{ ...META_SECTION, borderBottom: "none" }}>
                    <span style={CTX_LABEL}>Suggested install timeframe</span>
                    <select
                      value={installTimeframe}
                      onChange={(e) => onInstallTimeframe(e.target.value)}
                      aria-label="Suggested install timeframe"
                      style={{ ...DARK_SELECT, width: "100%", minWidth: 0 }}
                    >
                      {INSTALL_TIMEFRAMES.map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                    <span style={META_HINT}>Carries to the project goal when this quote is won</span>
                  </section>
                  </div>
                  <div className="est-qd-col">
                  <section style={{ ...META_SECTION, borderBottom: "none" }}>
                    <span style={CTX_LABEL}>Quote note</span>
                    <input
                      className="est-notefield"
                      value={quoteNote}
                      onChange={(e) => onQuoteNote(e.target.value)}
                      placeholder="Cover language printed on the quote header — e.g. Thank you for the opportunity…"
                      style={{
                        width: "100%",
                        minWidth: 0,
                        fontFamily: "var(--font-ui)",
                        fontSize: 12.5,
                        color: "#fff",
                        background: "#2b2e35",
                        border: "1px solid #3a3e46",
                        borderRadius: 7,
                        padding: "8px 11px",
                      }}
                    />
                    <span style={META_HINT}>Shows on the PDF header</span>
                  </section>
                  </div>
                  <div className="est-qd-col">
                  <section style={{ ...META_SECTION, borderBottom: "none" }}>
                    <span style={CTX_LABEL}>Assumptions</span>
                    {assumptionLibrary.length > 0 && (
                      <div style={{ display: "grid", gap: 5 }}>
                        {assumptionLibrary.map((line) => (
                          <label key={line} style={{ display: "flex", alignItems: "flex-start", gap: 7, fontSize: 11.5, color: "#d7dae0", lineHeight: 1.35, cursor: "pointer" }}>
                            <input type="checkbox" checked={checkedAssumptions.has(line)} onChange={() => toggleAssumption(line)} style={{ marginTop: 2 }} />
                            <span>{line}</span>
                          </label>
                        ))}
                      </div>
                    )}
                    <textarea
                      className="est-notefield"
                      value={assumptions}
                      onChange={(e) => onAssumptions(e.target.value)}
                      placeholder="Add quote-specific assumptions, exclusions, and exceptions…"
                      rows={3}
                      style={{ width: "100%", minWidth: 0, resize: "vertical", fontFamily: "var(--font-ui)", fontSize: 12.5, color: "#fff", background: "#2b2e35", border: "1px solid #3a3e46", borderRadius: 7, padding: "8px 11px" }}
                    />
                    <span style={META_HINT}>Company defaults + editable exceptions</span>
                  </section>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Daylite stage bar (Task 6) — system quotes only, none for an
              unsaved estimate. Read-only + a "Lost" marker on a lost quote;
              the pipeline switch (Estimate/Design ⇄ BID SPEC) only while
              draft, since a sent/won stage carries contractual meaning. */}
          {showStageBar && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 16,
                flexWrap: "wrap",
                rowGap: 8,
                padding: "9px 22px",
                background: "#22252b",
                borderBottom: "1px solid #2b2e35",
                flexShrink: 0,
              }}
            >
              <div style={{ display: "flex", alignItems: "center" }}>
                {stageBarPipeline.stages.map((s, i) => {
                  const isCurrent = i === stageBarCurIdx;
                  const isPast = stageBarCurIdx >= 0 && i < stageBarCurIdx;
                  const readOnly = status === "lost";
                  return (
                    <button
                      key={s.id}
                      type="button"
                      disabled={readOnly}
                      onClick={() => changeStage(s.id)}
                      title={readOnly ? "Lost — the stage the quote died at" : "Set stage: " + s.label}
                      style={{
                        fontFamily: "var(--font-ui)",
                        fontSize: 11,
                        fontWeight: isCurrent ? 700 : 600,
                        color: isCurrent ? "#16181d" : isPast ? "#cfd3da" : "#7d828d",
                        background: isCurrent ? "var(--accent)" : "#2b2e35",
                        border: "1px solid " + (isCurrent ? "var(--accent)" : "#3a3e46"),
                        padding: "6px 16px 6px 20px",
                        marginLeft: i === 0 ? 0 : -10,
                        clipPath: CHEVRON_CLIP,
                        cursor: readOnly ? "default" : "pointer",
                        whiteSpace: "nowrap",
                        position: "relative",
                        zIndex: i + 1,
                        opacity: readOnly ? 0.6 : 1,
                      }}
                    >
                      {s.label}
                    </button>
                  );
                })}
              </div>
              {status === "lost" && (
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: "#e0a08f",
                    background: "#3a2b26",
                    border: "1px solid #5a3c33",
                    borderRadius: 20,
                    padding: "4px 11px",
                    whiteSpace: "nowrap",
                  }}
                >
                  ✕ Lost{stageBarLostLabel ? " at " + stageBarLostLabel : ""}
                </span>
              )}
              {status === "draft" && (
                <select
                  value={stageBarPipeline.id}
                  onChange={(e) => changePipeline(e.target.value)}
                  aria-label="Quote pipeline"
                  style={{ ...DARK_SELECT, borderRadius: 7, padding: "6px 9px" }}
                >
                  {pipelines.quote.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          {/* #284 — the next step's note (a send-back note, the limit chip, an
              approval line), always visible; the actions live in the toolbar. */}
          {loadedId && next?.strip && (
            <div style={{ padding: "7px 22px", fontSize: 12.5, color: "#5b616e", background: "#f8f9fb", borderBottom: "1px solid #e4e7ec", flexShrink: 0 }}>
              {next.strip}
            </div>
          )}

          {/* action rejection banner (punch #60: send/won gated server-side) */}
          {actionError && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                padding: "9px 22px",
                background: "#fdecea",
                borderBottom: "1px solid #f3c8c2",
                color: "#9a2f22",
                fontSize: 12.5,
                fontWeight: 600,
                flexShrink: 0,
              }}
            >
              <span>{actionError}</span>
              {/* #284: the gate refused Sent/Won — offer the way through right here. */}
              {gateRefused && loadedId && next?.primary && next.primary.action !== "approve" && (
                <QuoteNextStep
                  quoteId={loadedId}
                  view={{ ...next, secondary: [], pill: { ...next.pill, label: "" } }}
                  variant="panel"
                  disabled={statusChanging || tierResolving}
                  beforeAction={pdfDirty ? saveNow : undefined}
                  onSync={(r) => {
                    applySync(r);
                    if (r.ok) {
                      setActionError(null);
                      setGateRefused(false);
                    }
                  }}
                  onError={(m) => {
                    setActionError(m);
                    setGateRefused(false);
                  }}
                />
              )}
              <button
                type="button"
                onClick={() => {
                  setActionError(null);
                  setGateRefused(false);
                }}
                style={{
                  fontSize: 12.5,
                  fontWeight: 600,
                  color: "#9a2f22",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  padding: "2px 4px",
                  flexShrink: 0,
                }}
              >
                Dismiss
              </button>
            </div>
          )}

          {/* informational save notice (#180 review 3) — a stale tab's
              status got refreshed, but nothing this save asked for failed */}
          {!actionError && actionNotice && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                padding: "9px 22px",
                background: "#eef3fb",
                borderBottom: "1px solid #cddaf0",
                color: "#2b4a7a",
                fontSize: 12.5,
                fontWeight: 600,
                flexShrink: 0,
              }}
            >
              <span>{actionNotice}</span>
              <button
                type="button"
                onClick={() => setActionNotice(null)}
                style={{
                  fontSize: 12.5,
                  fontWeight: 600,
                  color: "#2b4a7a",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  padding: "2px 4px",
                  flexShrink: 0,
                }}
              >
                Dismiss
              </button>
            </div>
          )}

          {/* #282 perks+points — the customer's standing purchase perks
              (informational; only the answer for the customer picked now). */}
          {customerId && creditInfo?.customerId === customerId && <PurchasePerksBanner text={creditInfo.purchasePerks} />}

          {/* "Move system" result banner — success links to the target
              estimate without auto-navigating (this estimate may have
              other unsaved edits); failure surfaces the server's reason. */}
          {moveNotice && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                padding: "9px 22px",
                background: moveNotice.ok ? "#ecf6f0" : "#fdecea",
                borderBottom: moveNotice.ok ? "1px solid #cce9da" : "1px solid #f3c8c2",
                color: moveNotice.ok ? "#1f7a52" : "#9a2f22",
                fontSize: 12.5,
                fontWeight: 600,
                flexShrink: 0,
              }}
            >
              <span>
                {moveNotice.ok && moveNotice.verb === "Copied" ? (
                  moveNotice.targetId ? (
                    <>
                      Copied to {moveNotice.targetNumber} · {moveNotice.targetName} — {moveNotice.detail} —{" "}
                      <a
                        href={`/estimator?id=${moveNotice.targetId}`}
                        style={{ color: "inherit", textDecoration: "underline" }}
                      >
                        Open {moveNotice.targetName} →
                      </a>
                    </>
                  ) : (
                    <>Copied within this estimate — {moveNotice.detail}</>
                  )
                ) : moveNotice.ok ? (
                  <>
                    Moved to {moveNotice.targetName} ({moveNotice.targetNumber}) —{" "}
                    <a
                      href={`/estimator?id=${moveNotice.targetId}`}
                      style={{ color: "inherit", textDecoration: "underline" }}
                    >
                      Open {moveNotice.targetName} →
                    </a>
                  </>
                ) : (
                  moveNotice.error
                )}
              </span>
              <button
                type="button"
                onClick={() => setMoveNotice(null)}
                style={{
                  fontSize: 12.5,
                  fontWeight: 600,
                  color: "inherit",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  padding: "2px 4px",
                  flexShrink: 0,
                }}
              >
                Dismiss
              </button>
            </div>
          )}

          {/* #254 tier re-price banner — internal only, never on the
              customer document; clears on the next edit or Undo. */}
          {tierReprice && (
            <div
              role="status"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                padding: "9px 22px",
                background: "#eef3fb",
                borderBottom: "1px solid #cddaf0",
                color: "#2b4a7a",
                fontSize: 12.5,
                fontWeight: 600,
                flexShrink: 0,
              }}
            >
              <span>
                {tierRepriceMessage(tierReprice.repriced, tierReprice.handPriced, tierReprice.label, tierReprice.margin, tierReprice.unsaved)}
                {" · "}
                <button
                  type="button"
                  onClick={undoTierReprice}
                  style={{
                    fontSize: 12.5,
                    fontWeight: 600,
                    color: "inherit",
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    padding: 0,
                    textDecoration: "underline",
                  }}
                >
                  Undo
                </button>
              </span>
              <button
                type="button"
                onClick={() => setTierReprice(null)}
                style={{
                  fontSize: 12.5,
                  fontWeight: 600,
                  color: "inherit",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  padding: "2px 4px",
                  flexShrink: 0,
                }}
              >
                Dismiss
              </button>
            </div>
          )}

          {/* body */}
          <div className="est-body" style={{ flex: 1, display: "flex", minHeight: 0 }}>
            {/* left sidebar — collapsible to a 36px tab, remembered per browser (#168, D224) */}
            {sideOpen ? (
              <div
                className="est-side"
                style={{
                  width: 262,
                  background: "#fff",
                  borderRight: "1px solid #ececf0",
                  display: "flex",
                  flexDirection: "column",
                  flexShrink: 0,
                }}
              >
                <div style={{ padding: "16px 14px 8px" }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      marginBottom: 10,
                      padding: "0 6px",
                    }}
                  >
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        color: "#9aa0ab",
                        letterSpacing: ".06em",
                        textTransform: "uppercase",
                      }}
                    >
                      Systems
                    </span>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <button
                        type="button"
                        onClick={addSystem}
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          color: "var(--accent)",
                          background: "transparent",
                          border: "none",
                          cursor: "pointer",
                          padding: 0,
                        }}
                      >
                        + Add
                      </button>
                      <button
                        type="button"
                        className="est-side-toggle"
                        onClick={toggleSide}
                        aria-expanded={true}
                        title="Hide systems"
                        style={SIDE_TOGGLE}
                      >
                        ‹ Hide
                      </button>
                    </div>
                  </div>
                  {sections.map((sec) => {
                    const sub = systemSellTotal(sec);
                    const active = activeId === sec.id;
                    const label = sec.name
                      .split(" — ")[0]
                      .split(" & ")[0]
                      .replace("Motorized Hoists", "Hoists");
                    return (
                      <button
                        type="button"
                        key={sec.id}
                        onClick={() => selectSystem(sec.id)}
                        style={{
                          width: "100%",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 8,
                          padding: active ? "10px 12px 10px 9px" : "10px 12px",
                          borderRadius: 9,
                          marginBottom: 3,
                          border: "none",
                          cursor: "pointer",
                          textAlign: "left",
                          background: active ? ACCENT_SOFT : "transparent",
                          borderLeft: active ? "3px solid var(--accent)" : undefined,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 13,
                            fontWeight: active ? 600 : 500,
                            color: active ? ACCENT_INK : "#3a3f4a",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {label || "Untitled"}
                        </span>
                        <span
                          style={{
                            fontFamily: "var(--font-mono)",
                            fontSize: 11.5,
                            color: active ? ACCENT_INK : "#9aa0ab",
                            flexShrink: 0,
                          }}
                        >
                          {short(sub)}
                        </span>
                      </button>
                    );
                  })}
                </div>

                <div
                  style={{ margin: "6px 14px", padding: 13, background: "#f7f8fa", borderRadius: 10 }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      marginBottom: 9,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        color: "#9aa0ab",
                        letterSpacing: ".05em",
                        textTransform: "uppercase",
                      }}
                    >
                      Margin · all systems
                    </span>
                    <span
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 12.5,
                        fontWeight: 600,
                        color: ACCENT_INK,
                      }}
                    >
                      {Math.round(t.margin * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={55}
                    value={Math.round(t.margin * 100)}
                    onChange={(e) => setMarginAll(e.target.value)}
                    style={{ width: "100%", accentColor: "var(--accent)", cursor: "pointer" }}
                  />
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      fontSize: 10,
                      color: "#9aa0ab",
                      marginTop: 3,
                    }}
                  >
                    <span>0%</span>
                    <span>Reprice every line</span>
                    <span>55%</span>
                  </div>
                </div>

                <div
                  style={{ margin: "6px 14px", padding: 13, background: "#f7f8fa", borderRadius: 10 }}
                >
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: "#9aa0ab",
                      letterSpacing: ".05em",
                      textTransform: "uppercase",
                      marginBottom: 10,
                    }}
                  >
                    Cost breakdown
                  </div>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      fontSize: 12.5,
                      marginBottom: 7,
                    }}
                  >
                    <span style={{ color: "#5b616e" }}>Materials</span>
                    <span style={{ fontFamily: "var(--font-mono)" }}>{fmt(t.mat)}</span>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      fontSize: 12.5,
                      marginBottom: 7,
                    }}
                  >
                    <span style={{ color: "#5b616e" }}>Labor</span>
                    <span style={{ fontFamily: "var(--font-mono)" }}>{fmt(t.lab)}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5 }}>
                    <span style={{ color: "#5b616e" }}>Freight</span>
                    <span style={{ fontFamily: "var(--font-mono)" }}>{fmt(t.fr)}</span>
                  </div>
                  {(t.credit || 0) > 0 && (
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginTop: 7, color: "#1f8a5b", fontWeight: 600 }}>
                      <span>Rewards credit · {pointsLabel(t.credit || 0)}</span>
                      <span style={{ fontFamily: "var(--font-mono)" }}>−{fmt(t.credit || 0)}</span>
                    </div>
                  )}
                </div>

                <RewardCreditPanel
                  info={creditInfo}
                  applied={appliedCredit}
                  preCreditTotal={t.grand + (t.credit || 0)}
                  editable={canApplyCredit && (status === "draft" || status === "sent")}
                  hasSystems={sections.length > 0}
                  onApply={applyCredit}
                  onRemove={removeCredit}
                />

                {/* Tasks (PUNCHLIST #17 remainder) — needs a saved quote to
                    attach to; a brand-new unsaved draft has nowhere for
                    quoteId to point yet. */}
                <div style={{ margin: "6px 14px 14px" }}>
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: "#9aa0ab",
                      letterSpacing: ".05em",
                      textTransform: "uppercase",
                      marginBottom: 8,
                    }}
                  >
                    Tasks
                  </div>
                  {loadedId ? (
                    <>
                      <ApplyTemplateControl
                        parentField="quoteId"
                        parentId={loadedId}
                        templateSets={templateSets}
                        action={applyQuoteTemplateAction}
                      />
                      <TasksCard
                        parentField="quoteId"
                        parentId={loadedId}
                        tasks={quoteTasks}
                        people={people}
                        addAction={addQuoteTaskAction}
                        setStatusAction={setQuoteTaskStatusAction}
                        updateAction={updateQuoteTaskAction}
                        removeAction={removeQuoteTaskAction}
                        defaultSection="Review"
                      />
                    </>
                  ) : (
                    <div style={{ fontSize: 11.5, color: "#aab0bb" }}>Save the quote to add tasks.</div>
                  )}
                </div>
              </div>
            ) : (
              <div
                className="est-side est-side-collapsed"
                style={{ width: 36, flexShrink: 0, minHeight: 0, display: "flex", flexDirection: "column", background: "#fff", borderRight: "1px solid #ececf0" }}
              >
                <button
                  type="button"
                  className="est-side-tab"
                  onClick={toggleSide}
                  aria-expanded={false}
                  title="Show systems"
                  style={{
                    flex: 1,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "flex-start",
                    gap: 10,
                    padding: "12px 0",
                    background: "transparent",
                    border: "none",
                    color: "#9aa0ab",
                    cursor: "pointer",
                    fontFamily: "var(--font-ui)",
                  }}
                >
                  <span aria-hidden="true" style={{ fontSize: 15, lineHeight: 1 }}>›</span>
                  <span
                    className="est-side-vlabel"
                    style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase", writingMode: "vertical-rl", whiteSpace: "nowrap" }}
                  >
                    Systems
                  </span>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "#6b7079" }}>{sections.length}</span>
                </button>
              </div>
            )}

            {/* main cards */}
            <div
              ref={scrollRef}
              className="est-scroll est-main"
              style={{
                flex: 1,
                overflowY: "auto",
                padding: "20px 26px 60px",
                minWidth: 0,
                position: "relative",
              }}
            >
              {initial.portal && <PortalPanel data={initial.portal} statusError={portalStatusError} />}
              {sections.map((sec, i) => (
                <SectionCard
                  key={sec.id}
                  sec={sec}
                  index={i}
                  active={activeId === sec.id}
                  expanded={isExpanded(sec.id)}
                  isInternal={isInternal}
                  cols={cols}
                  catalogOpen={isOpenFor("catalog", sec.id)}
                  customOpen={isOpenFor("custom", sec.id)}
                  openMethod={openInput && openInput.secId === sec.id ? openInput.kind : null}
                  customDraft={customDraft}
                  vendorQuotes={vendorQuotes}
                  vendorPreviews={vendorPreviews}
                  savedQuoteId={loadedId}
                  registerRef={(id, el) => {
                    cardRefs.current[id] = el;
                  }}
                  onToggleExpand={() => toggleExpand(sec.id)}
                  onRename={(name) => renameSystem(sec.id, name)}
                  onEditNarrative={() => {
                    // #281: make this system active, open the column, focus the textarea.
                    setActiveId(sec.id);
                    if (!narrOpen) showNarr(true);
                    setNarrFocusReq((n) => n + 1);
                  }}
                  onActivate={() => setActiveId(sec.id)}
                  onSetRoom={(value) => setSystemRoom(sec.id, value)}
                  defaultRoom={venueRoomName}
                  onSetPresentation={(value) => setSystemPresentation(sec.id, value)}
                  onDelete={() => deleteSystem(sec.id)}
                  onSetMargin={(v) => setSystemMargin(sec.id, v)}
                  onSetSell={(v) => setSystemSell(sec.id, v)}
                  onResetSell={() => resetSystemSell(sec.id)}
                  onRoundPrice={() => roundSystemPrice(sec.id)}
                  onSetFreight={(v) => setFreightPct(sec.id, v)}
                  freightUnknown={freightDefault.unknown}
                  onInc={inc}
                  onDec={dec}
                  onSetQty={setQty}
                  onSetPrice={setItemPrice}
                  onSetExtSell={setItemExtSell}
                  specKeys={specKeys}
                  onSetSpecKey={setItemSpecKey}
                  onMoveItem={(itemId, direction) => moveItem(sec.id, itemId, direction)}
                  onRemoveItem={removeItem}
                  onToggleKeyProduct={(itemId) => toggleKeyProductLine(sec.id, itemId)}
                  onToggleCatalog={() => openInputMethod("catalog", sec.id)}
                  onToggleCurtain={() => openInputMethod("curtain", sec.id)}
                  onToggleFixture={() => openInputMethod("fixture", sec.id)}
                  onToggleLabor={() => openInputMethod("labor", sec.id)}
                  onToggleTrack={() => openInputMethod("track", sec.id)}
                  onToggleCustom={() => openInputMethod("custom", sec.id)}
                  onToggleVendor={() => openInputMethod("vendor", sec.id)}
                  onAddPart={(cat, qty) => addPart(sec.id, cat, qty)}
                  onImportMaterials={(items) => importMaterials(sec.id, items)}
                  onSetVendorDisplay={setVendorDisplay}
                  onEditVendor={(vqId) => openVendorEdit(sec.id, vqId)}
                  onEditLabor={(group) => openLaborEdit(sec.id, group)}
                  onEditTrack={(lineId) => openTrackEdit(sec.id, lineId)}
                  onSetCustomDraft={(field, v) => setCustomDraft((d) => ({ ...d, [field]: v }))}
                  onAddCustomPart={() => addCustomPart(sec.id)}
                  onMoveToNew={() => moveSystem(sec.id, { kind: "new" })}
                  onMoveToExisting={(targetQuoteId) =>
                    moveSystem(sec.id, { kind: "existing", quoteId: targetQuoteId })
                  }
                  onCopyToNew={() => copySystem(sec.id, { kind: "new" })}
                  onCopyToExisting={(targetQuoteId) =>
                    copySystem(sec.id, { kind: "existing", quoteId: targetQuoteId })
                  }
                  onCopyHere={() => copySystem(sec.id, { kind: "same" })}
                  onSearchQuotes={searchQuotes}
                />
              ))}

              <button
                type="button"
                className="est-addsys"
                onClick={addSystem}
                style={{
                  width: "100%",
                  padding: 14,
                  background: "#fff",
                  border: "1px dashed #d6d9e0",
                  borderRadius: 12,
                  color: "#8c919c",
                  fontSize: 13,
                  fontWeight: 600,
                  fontFamily: "var(--font-ui)",
                  cursor: "pointer",
                }}
              >
                + Add system
              </button>
            </div>

            {/* system narrative — the right column Quote details vacated (#281);
                a light writing surface that follows the active system;
                collapsible to a 36px tab, remembered per browser */}
            {narrOpen ? (
              <aside
                className="est-narr"
                aria-label="System narrative"
                style={{
                  width: 360,
                  flexShrink: 0,
                  minHeight: 0,
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                  padding: "16px 18px 18px",
                  background: "#fff",
                  borderLeft: "1px solid #ececf0",
                }}
              >
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        color: "#9aa0ab",
                        letterSpacing: ".06em",
                        textTransform: "uppercase",
                      }}
                    >
                      Narrative
                    </div>
                    {narrSec && (
                      <div
                        style={{
                          marginTop: 3,
                          fontSize: 13.5,
                          fontWeight: 600,
                          color: "#16181d",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {narrSec.name || "Untitled system"}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    className="est-narr-toggle"
                    onClick={() => showNarr(false)}
                    aria-expanded={true}
                    title="Hide narrative"
                    style={SIDE_TOGGLE}
                  >
                    Hide ›
                  </button>
                </div>
                {narrSec ? (
                  <NarrativeColumn
                    key={narrSec.id}
                    sec={narrSec}
                    narrRef={narrRef}
                    onChange={(fn) => updateSection(narrSec.id, fn)}
                    library={kpLib}
                    canWriteLibrary={canWriteNarrativeLibrary}
                    intros={intros}
                    onIntros={setIntros}
                  />
                ) : (
                  <div style={{ fontSize: 12, color: "#8c919c", lineHeight: 1.45 }}>
                    Add a system to write its narrative.
                  </div>
                )}
              </aside>
            ) : (
              <aside
                className="est-narr est-narr-collapsed"
                aria-label="System narrative (collapsed)"
                style={{ width: 36, flexShrink: 0, minHeight: 0, display: "flex", flexDirection: "column", background: "#fff", borderLeft: "1px solid #ececf0" }}
              >
                <button
                  type="button"
                  className="est-narr-tab"
                  onClick={() => showNarr(true)}
                  aria-expanded={false}
                  title="Show narrative"
                  style={{
                    flex: 1,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "flex-start",
                    gap: 10,
                    padding: "12px 0",
                    background: "transparent",
                    border: "none",
                    color: "#9aa0ab",
                    cursor: "pointer",
                    fontFamily: "var(--font-ui)",
                  }}
                >
                  <span aria-hidden="true" style={{ fontSize: 15, lineHeight: 1 }}>‹</span>
                  <span
                    className="est-narr-vlabel"
                    style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase", writingMode: "vertical-rl", whiteSpace: "nowrap" }}
                  >
                    Narrative
                  </span>
                </button>
              </aside>
            )}
          </div>

          {/* configurator modals */}
          {curtainFor && (
            <CurtainModal
              secName={curtainSec ? curtainSec.name : ""}
              draft={curtainDraft}
              fabrics={fabrics}
              sewingPct={curtainSewingPct}
              margin={tierMargin ?? undefined}
              onSet={setCurtainField}
              onAdd={() => addCurtain(curtainFor)}
              onClose={closeInput}
              track={curtainTrack}
              trackSeries={trackSeries}
              trackParts={trackParts}
              onToggleTrack={toggleCurtainTrack}
              onSetTrack={(field, val) => setCurtainTrack((t) => (t ? { ...t, [field]: val } : t))}
            />
          )}
          {trackFor && (
            <TrackModal
              secName={trackSec ? trackSec.name : ""}
              draft={trackDraft}
              series={trackSeries}
              parts={trackParts}
              margin={tierMargin}
              editing={!!trackEdit}
              readOnly={trackEdit?.readOnly ?? null}
              onSet={(field, val) => setTrackDraft((d) => ({ ...d, [field]: val }))}
              onAdd={() => addTrack(trackFor)}
              onClose={closeInput}
            />
          )}
          {fixtureFor && (
            <FixtureModal
              secName={fixtureSec ? fixtureSec.name : ""}
              draft={fixtureDraft}
              assemblies={fixtureAssemblies}
              onSet={setFixture}
              onAssembly={setFixtureAssembly}
              onComponentQty={setFixtureComponentQty}
              onAdd={() => addFixture(fixtureFor)}
              onClose={closeInput}
            />
          )}
          {laborFor && (
            <LaborModal
              secName={laborSec ? laborSec.name : ""}
              draft={laborDraft}
              rate={rate}
              travel={travelEstNow()}
              onSet={setLabor}
              onSetAutoHrs={setAutoHrs}
              onResetAutoHrs={resetAutoHrs}
              onAddMob={addMob}
              onRemoveMob={removeMob}
              onSetMob={setMob}
              onSetMobNameSelect={setMobNameSelect}
              onUseMobNameList={useMobNameList}
              onSetTripLocal={setTripLocal}
              onApplyTravelTrip={applyTravelTrip}
              onToggleMobFlag={toggleMobFlag}
              onApplyAutoMiles={applyAutoMiles}
              onAdd={() => addLabor(laborFor)}
              editing={laborEdit}
              onClose={closeInput}
            />
          )}
          {vendorFor && (
            <VendorQuoteModal
              /* Keyed by the record id (#144) so switching straight from one
                 vendor quote to another — an add into an edit, or edit into
                 edit, which no longer unmounts the modal because the kind is
                 unchanged — remounts the form. That is what retires the #143
                 `alive` guard on an upload still in flight, which would
                 otherwise drop the abandoned file onto the quote now open. */
              key={vendorDraft.id}
              secName={vendorSec ? vendorSec.name : ""}
              draft={vendorDraft}
              vendors={vendors}
              margin={vendorFormMargin}
              blobUploads={blobUploads}
              /* Lets the form reach the download proxy for a file that is
                 already stored (#144 re-review): on an edit the object-URL that
                 minted the in-memory preview died with the page that made it,
                 so a Blob-only attachment would otherwise show a filename the
                 user cannot open before replacing it. */
              savedQuoteId={loadedId}
              /* The record being EDITED is left out of the budget (#144): its
                 stored data-URL is about to be replaced by whatever this draft
                 ends up holding, so counting both would ration the estimate
                 against its own file twice. */
              attachedChars={vendorAttachmentLoad(
                vendorQuotes.filter((v) => v.id !== vendorDraft.id)
              )}
              onSet={setVendorField}
              onSetLine={setVendorLine}
              onAddLine={addVendorLine}
              onRemoveLine={removeVendorLine}
              onLoadLines={loadVendorLines}
              editing={!!vendorEditingRec}
              onAdd={() => commitVendorQuote(vendorFor)}
              onClose={closeInput}
            />
          )}
          {aiSource && aiOpen && (
            <AiScopeModal
              sourceLabel={
                (aiSource.kind === "survey" ? "field survey" : "inspection") +
                " · " +
                aiSource.label
              }
              targetSection={aiTargetSection()?.name || ""}
              busy={aiBusy}
              error={aiErr}
              scope={aiScope}
              lines={aiLines}
              scopeInserted={aiScopeInserted}
              addedLines={aiAdded}
              onInsertScope={insertAiScope}
              onAddLine={addAiLine}
              onRetry={runAiDraft}
              onClose={() => setAiOpen(false)}
            />
          )}
        </div>
      )}

      {/* ===================== PREVIEW MODE (the saved customer PDF, #222) ===================== */}
      {isPreview && (
        <>
          {/* #284 — an approver on a phone can decide right from the preview.
              The build-mode error banner isn't rendered here, so the control
              shows its own inline error line. */}
          {phone && loadedId && next?.approverMode && (
            <div style={{ padding: "10px 14px", borderBottom: "1px solid #e4e7ec", background: "#fff" }}>
              <QuoteNextStep
                quoteId={loadedId}
                view={next}
                variant="panel"
                approverOnly
                onSync={(r) => {
                  applySync(r);
                  if (r.ok) {
                    setActionError(null);
                    setGateRefused(false);
                  }
                }}
              />
            </div>
          )}
          <PreviewDoc
            phone={phone}
            canBuild={!phone}
            onBack={() => setMode("build")}
            savedQuoteId={loadedId}
            pdf={pdf}
            onPdf={setPdf}
            dirty={pdfDirty}
            onSave={doSave}
            saveDisabled={statusChanging || tierResolving}
            sections={sections}
            setSectionPresentation={(id, value) => setSystemPresentation(id, value)}
            detail={detail}
            setDetail={setDetail}
            pdfQty={pdfQty}
            pdfNotes={pdfNotes}
            pdfPrices={pdfPrices}
            pdfCover={pdfCover}
            pdfTerms={pdfTerms}
            pdfOptions={pdfOptions}
            pdfItemizedAppendix={pdfItemizedAppendix}
            paymentTerms={paymentTerms}
            paymentTermsOptions={PAYMENT_TERMS}
            setPaymentTerms={setPaymentTerms}
            togglePdf={(flag) => {
              if (flag === "pdfQty") setPdfQty((v) => !v);
              else if (flag === "pdfNotes") setPdfNotes((v) => !v);
              else if (flag === "pdfPrices") setPdfPrices((v) => !v);
              else if (flag === "pdfCover") setPdfCover((v) => !v);
              else if (flag === "pdfOptions") setPdfOptions((v) => !v);
              else if (flag === "pdfItemizedAppendix") setPdfItemizedAppendix((v) => !v);
              else setPdfTerms((v) => !v);
            }}
          />
        </>
      )}
    </div>
  );
}
