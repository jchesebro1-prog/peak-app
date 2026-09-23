"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { CSSProperties } from "react";
import { firstName } from "@/lib/team";
import { approvedReviewLine } from "@/lib/review-line";
import type { QuoteReview, QuoteStatus } from "@/lib/stores/quotes";
import {
  addQuoteTaskAction,
  applyQuoteTemplateAction,
  approveReviewAction,
  attestApprovalAction,
  claimReviewAction,
  draftQuoteScopeAction,
  moveSystemToEstimateAction,
  requestChangesAction,
  resolveCatalogSkusAction,
  saveQuoteAction,
  searchQuotesAction,
  sendToCustomerAction,
  setQuoteTaskStatusAction,
  setStatusAction,
  submitReviewAction,
  travelForSelectionAction,
  updateQuoteMetaAction,
  updateQuoteTaskAction,
  type MoveSystemTarget,
  type ReviewSync,
} from "./actions";
import { TasksCard } from "@/components/tasks-card";
import { ApplyTemplateControl } from "@/components/apply-template-control";
import type { DraftedLine } from "./ai-scope-modal";
import {
  DISC_LABEL,
  type SuggestPart,
} from "./estimator-data";
import {
  computeCurtain,
  computeLabor,
  fmt,
  lineMarginOf,
  makeLaborRate,
  repricedAtLineMargin,
  round2,
  short,
  systemFreight,
  systemItemsRev,
  totals,
  vendorTotalSeed,
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
  TravelLite,
  VendorDraft,
  VendorLineDraft,
  VendorQuote,
} from "./types";
import { PAYMENT_TERMS, vendorAttachmentLoad } from "./types";
import { assemblyDescription } from "@/lib/fixture-assemblies";
import { defaultLaborMobs, disciplineForSystemTitle, laborMob } from "./labor-defaults";
import { ACCENT_INK, ACCENT_SOFT } from "./est-ui";
import { saveEstimatorCustomPartAction } from "./actions";
import SectionCard, { type InputKind } from "./section-card";
import { parseMoney, type ImportedMaterial } from "./material-csv";
import AiScopeModal from "./ai-scope-modal";
import CurtainModal from "./curtain-modal";
import FixtureModal from "./fixture-modal";
import LaborModal from "./labor-modal";
import VendorQuoteModal, {
  vendorDraftTotal,
  vendorDraftTotalSource,
  vendorKeptLines,
  vendorLinesTotal,
} from "./vendor-quote-modal";
import PreviewDoc from "./preview-doc";

/**
 * Estimator workspace — client port of Estimator.dc.html (build + preview
 * modes). All state lives here; pricing math in ./pricing; persistence via
 * server actions on the quotes store.
 */

/** Prototype prop taxRatePct defaulted to 0 — kept as a constant. */
const TAX_RATE_PCT = 0;

const freshSections = (): SpecSection[] => [
  { id: "sys1", name: "New System", kind: "materials", mfr: "", freightPct: 2, items: [] },
];

const CSS = `
.est-input { font-family: var(--font-mono); }
.est-scroll::-webkit-scrollbar { width: 10px; }
.est-scroll::-webkit-scrollbar-thumb { background: #d6d9e0; border-radius: 8px; border: 3px solid #f7f8fa; }
.est-field:focus { border-color: #c4c9d2 !important; outline: none; }
.est-warm:focus { border-color: #e3cf94 !important; outline: none; }
.est-secname:hover { border-color: #e4e7ec !important; }
.est-secname:focus { border-color: #c4c9d2 !important; background: #fff !important; outline: none; }
.est-notefield:focus { border-color: #4a4e56 !important; outline: none; }
.est-row:hover { background: #fafbff; }
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

const rbMeta: Record<string, { bg: string; bd: string; ink: string; icon: string; title: string }> = {
  none: { bg: "#f4f5f7", bd: "#e4e7ec", ink: "#5b616e", icon: "○", title: "Not submitted for review" },
  in_review: { bg: "#eef3fc", bd: "#d4ddf3", ink: "#3155a8", icon: "◴", title: "In review" },
  approved: { bg: "#ecf6f0", bd: "#cce9da", ink: "#1f7a52", icon: "✓", title: "Approved" },
  changes: { bg: "#fcefe9", bd: "#f0d6cd", ink: "#b4543a", icon: "↩", title: "Changes requested" },
};

const STATUS_DOT: Record<string, string> = {
  draft: "#c98a2b",
  sent: "#3155a8",
  won: "#1f8a5b",
  lost: "#8c919c",
};

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

const INSTALL_TIMEFRAMES = ["ASAP", "Under 1 month", "1–3 months", "3–6 months", "6–12 months", "TBD"] as const;

export default function EstimatorClient({
  initial,
  companyName,
  logoDark,
  fabrics,
  laborRates,
  fixtureRates,
  fixtureAssemblies,
  vendors,
  blobUploads,
  customers,
  travel,
  reviewers,
  me,
  canApprove,
  aiSource,
  people,
  quoteTasks,
  templateSets,
}: EstimatorProps) {
  /* ---------------- state (port of the prototype's this.state) ---------------- */
  const [sections, setSections] = useState<SpecSection[]>(
    () => initial.sections ?? freshSections()
  );
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
  const [review, setReview] = useState<QuoteReview>(initial.review);
  const [reviewerSel, setReviewerSel] = useState("queue");
  const [rcOpen, setRcOpen] = useState(false);
  const [rcNote, setRcNote] = useState("");
  const [attestOpen, setAttestOpen] = useState(false);
  const [attestNote, setAttestNote] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  /** Result banner for "Move system" — never auto-navigates (the user may
   *  have other unsaved edits on the CURRENT estimate). */
  const [moveNotice, setMoveNotice] = useState<
    { ok: true; targetId: string; targetName: string } | { ok: false; error: string } | null
  >(null);
  const [projectName, setProjectName] = useState(initial.projectName);
  const [custName, setCustName] = useState(initial.custName);
  const [customerId, setCustomerId] = useState(initial.customerId);
  const [locationId, setLocationId] = useState(initial.locationId);
  const [contactName, setContactName] = useState(initial.contactName);
  const [quoteNote, setQuoteNote] = useState(initial.quoteNote);
  const [assumptions, setAssumptions] = useState(initial.assumptions || "");
  const [installTimeframe, setInstallTimeframe] = useState(initial.installTimeframe);
  const [paymentTerms, setPaymentTerms] = useState(initial.paymentTerms);
  // #110: user-named quote category — persisted on blur, not per keystroke.
  const [category, setCategory] = useState(initial.category);
  const categorySaved = useRef(initial.category);
  const [revNum, setRevNum] = useState(initial.revNum);
  const [revDateMs, setRevDateMs] = useState(initial.revDateMs);
  const [pdfQty, setPdfQty] = useState(true);
  const [pdfNotes, setPdfNotes] = useState(true);
  const [pdfCover, setPdfCover] = useState(true);
  const [pdfTerms, setPdfTerms] = useState(true);
  const [pdfOptions, setPdfOptions] = useState(true);
  const [pdfPrices, setPdfPrices] = useState(true);
  const [detail, setDetail] = useState<"itemized" | "sectioned">("itemized");
  const [activeId, setActiveId] = useState<string | null>(
    () => (initial.sections ?? freshSections())[0]?.id ?? null
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
  const [laborDraft, setLaborDraft] = useState<LaborDraft>(() =>
    freshLabor(null, initial.tierMargin, (initial.sections ?? freshSections())[0]?.name || "")
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

  const isBuild = !phone && mode === "build";
  const isPreview = phone || mode === "preview";
  const isInternal = true; // build mode is the internal view (prototype view: 'internal')
  const cols = isInternal
    ? "minmax(190px,1fr) 112px 100px 100px 100px 22px"
    : "minmax(190px,1fr) 112px 100px 100px 22px";

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

  /* ---------------- persistence ---------------- */
  const persistMeta = (meta: Parameters<typeof updateQuoteMetaAction>[1]) => {
    if (!loadedId) return;
    const id = loadedId;
    startTransition(async () => {
      const r = await updateQuoteMetaAction(id, meta);
      // Customer/contact changes re-stamp the tier server-side (item 11).
      if (r && typeof r.tierMargin === "number") setTierMargin(r.tierMargin);
    });
  };

  const applySync = (r: ReviewSync) => {
    if (r.review) setReview(r.review);
    if (r.status) setStatus(r.status);
  };

  const doSave = () => {
    const cname = customerId
      ? customers.find((c) => c.id === customerId)?.name || custName
      : custName;
    const mobs: SpecMob[] = [];
    sections.forEach((sec) => sec.items.forEach((it) => it.mob && mobs.push(it.mob)));
    startTransition(async () => {
      try {
        const res = await saveQuoteAction(loadedId, {
          name: projectName,
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
          sections,
          mobs,
          vendorQuotes,
        });
        if (res.ok && res.id) {
          setLoadedId(res.id);
          setQuoteId(res.id);
          // The server may have moved attachments into Blob storage — take its
          // version back so the next save doesn't re-upload the same bytes.
          if (res.vendorQuotes) setVendorQuotes(res.vendorQuotes);
          setRevNum(res.revNum);
          setRevDateMs(res.updatedAt);
          if (res.review) setReview(res.review);
          if (res.status) setStatus(res.status);
        }
        setJustSaved(true);
        if (savedTimer.current) clearTimeout(savedTimer.current);
        savedTimer.current = setTimeout(() => setJustSaved(false), 1800);
      } catch (e) {
        /* #143 re-review: a save that THROWS — a rejected request body, a
           dropped connection — used to be indistinguishable from a save that
           did nothing: no "Saved" flash, no banner, and every edit still
           only in memory. Say so instead. */
        console.error("[estimator] save failed:", e);
        setActionError(
          "That save did not go through — nothing was written. Check your connection, or remove a large vendor-quote attachment, and try again."
        );
      }
    });
  };

  const changeStatus = (v: QuoteStatus) => {
    const prevStatus = status;
    setStatus(v);
    if (loadedId) {
      const id = loadedId;
      startTransition(async () => {
        const r = await setStatusAction(id, v);
        if (!r.ok) {
          // Punch #60: server rejected the transition (e.g. "won" without an
          // approval on record) — roll back the optimistic UI change and
          // surface why, instead of silently pretending it worked.
          setStatus(prevStatus);
          setActionError(r.error || "That status change was rejected.");
          return;
        }
        setActionError(null);
        applySync(r);
      });
    }
  };

  /* ---------------- review & approval ---------------- */
  const submitReview = () => {
    if (!loadedId) return;
    const id = loadedId;
    const sel = reviewerSel;
    startTransition(async () => {
      applySync(await submitReviewAction(id, sel && sel !== "queue" ? sel : null));
    });
  };
  const claimReviewNow = () => {
    if (!loadedId) return;
    const id = loadedId;
    startTransition(async () => {
      applySync(await claimReviewAction(id));
    });
  };
  const approveNow = () => {
    if (!loadedId) return;
    const id = loadedId;
    startTransition(async () => {
      applySync(await approveReviewAction(id));
    });
  };
  const submitRc = () => {
    if (!rcNote.trim() || !loadedId) return;
    const id = loadedId;
    const note = rcNote.trim();
    setRcOpen(false);
    setRcNote("");
    startTransition(async () => {
      applySync(await requestChangesAction(id, note));
    });
  };
  /** Attested approval (punch #60): the estimator names who reviewed the
   *  quote and how (phone call, Teams, etc.) instead of routing it through
   *  the in-app review queue. The note is mandatory — enforced server-side,
   *  re-checked here only so the "Record approval" button can stay disabled. */
  const submitAttest = () => {
    if (!attestNote.trim() || !loadedId) return;
    const id = loadedId;
    const note = attestNote.trim();
    setAttestOpen(false);
    setAttestNote("");
    startTransition(async () => {
      const r = await attestApprovalAction(id, note);
      if (!r.ok) {
        setActionError(r.error || "That attested approval could not be recorded.");
        return;
      }
      setActionError(null);
      applySync(r);
    });
  };
  const sendCustomer = () => {
    if (!loadedId) return;
    const id = loadedId;
    startTransition(async () => {
      const r = await sendToCustomerAction(id);
      if (!r.ok) {
        setActionError(r.error || "This quote could not be sent to the customer.");
        return;
      }
      setActionError(null);
      applySync(r);
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
    setCustomerId(id || null);
    setLocationId(locId);
    setCustName(name);
    setContactName(contact);
    persistMeta({ customerId: id || null, locationId: locId, customer: name, contactName: contact });
    reapplyAutoTrips(id || null, locId);
  };
  const pickVenue = (locId: string) => {
    setLocationId(locId || null);
    persistMeta({ locationId: locId || null });
    reapplyAutoTrips(customerId, locId || null);
  };
  const pickContact = (name: string) => {
    setContactName(name || "");
    persistMeta({ contactName: name || "" });
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
  const onInstallTimeframe = (v: string) => {
    setInstallTimeframe(v);
    persistMeta({ installTimeframe: v });
  };
  const onProjectName = (v: string) => {
    setProjectName(v);
    if (loadedId) persistMeta({ name: v });
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
    patchItem(id, (it) => ({ ...it, price: round2(price), sellOverride: true, extSellOverride: undefined }));
  };
  const setItemExtSell = (id: number, value: string) => {
    const ext = Number(value.replace(/[$,\s]/g, ""));
    if (!Number.isFinite(ext) || ext < 0) return;
    patchItem(id, (it) => ({ ...it, extSellOverride: round2(ext) }));
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
    setSections((ss) => ss.map((s) => ({ ...s, items: s.items.filter((x) => x.id !== id) })));
  };

  const setMarginAll = (v: string) => {
    const m = parseInt(v, 10) / 100;
    setSections((ss) =>
      ss.map((s) => ({
        ...s,
        items: s.items.map((it) => ({ ...it, price: round2(it.cost / (1 - m)) })),
      }))
    );
  };
  const setSystemMargin = (secId: string, v: string) => {
    const m = parseFloat(v) / 100; // fractional so a typed sell price hits exactly (punch #37)
    setSections((ss) =>
      ss.map((s) =>
        s.id === secId
          ? { ...s, items: s.items.map((it) => ({ ...it, price: round2(it.cost / (1 - m)) })) }
          : s
      )
    );
  };
  const setFreightPct = (secId: string, val: string) => {
    let v = parseFloat(val);
    if (isNaN(v) || v < 0) v = 0;
    if (v > 15) v = 15;
    setSections((ss) => ss.map((s) => (s.id === secId ? { ...s, freightPct: v } : s)));
  };
  const renameSystem = (secId: string, name: string) =>
    setSections((ss) => ss.map((s) => (s.id === secId ? { ...s, name } : s)));
  const setSystemNarrative = (secId: string, narrative: string) =>
    setSections((ss) => ss.map((s) => (s.id === secId ? { ...s, narrative } : s)));
  const setSystemPresentation = (secId: string, presentation: "itemized" | "narrative") =>
    setSections((ss) => ss.map((s) => (s.id === secId ? { ...s, presentation } : s)));
  const deleteSystem = (secId: string) => {
    const list = sections.filter((s) => s.id !== secId);
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
        const list = sections.filter((s) => s.id !== secId);
        setSections(list);
        if (movedVq.length) setVendorQuotes((vs) => vs.filter((v) => !movedVqIds.has(v.id)));
        setActiveId((a) => (a === secId ? (list[0] ? list[0].id : null) : a));
        setMoveNotice({ ok: true, targetId: res.targetId, targetName: res.targetName });
      } else {
        setMoveNotice({ ok: false, error: res.error || "Could not move that system." });
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
      { id, name: "New System", kind: "materials", mfr: "", freightPct: 2, items: [] },
    ]);
    setActiveId(id);
    openInputMethod("catalog", id);
    requestAnimationFrame(() => requestAnimationFrame(() => scrollToCard(id)));
  };

  const pushItems = (secId: string, items: SpecItem[]) =>
    setSections((ss) =>
      ss.map((s) => (s.id === secId ? { ...s, items: [...s.items, ...items] } : s))
    );

  const addPart = (secId: string, cat: SuggestPart) => {
    const margin = tierMargin != null && tierMargin > 0 && tierMargin < 1 ? tierMargin : 0.3;
    pushItems(secId, [
      { id: nextId(), sku: cat.sku, desc: cat.desc, qty: 1, unit: cat.unit, cost: cat.cost, price: cat.cost > 0 ? round2(cat.cost / (1 - margin)) : cat.price },
    ]);
    closeInput();
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
    const margin = tierMargin != null && tierMargin > 0 && tierMargin < 1 ? tierMargin : 0.3;
    let fromCatalog = 0;
    const next: SpecItem[] = items.map((item) => {
      const hit = item.sku.trim() ? resolved[item.sku.trim()] : undefined;
      if (!hit) return { ...item, id: nextId(), desc: item.desc || item.sku, unit: item.unit || "ea", custom: true };
      fromCatalog++;
      const cost = item.cost > 0 ? item.cost : hit.cost;
      const price = item.price > 0 ? item.price : cost > 0 ? round2(cost / (1 - margin)) : hit.list;
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
    else if (kind === "curtain") setCurtainDraft(freshCurtain(defaultFabric));
    else if (kind === "fixture") setFixtureDraft(freshFixture());
    else if (kind === "vendor") {
      // #144: an abandoned edit must not seed the next "+ Vendor quote".
      vendorEditRef.current = null;
      setVendorDraft(freshVendor());
    } else if (kind === "labor")
      setLaborDraft(
        freshLabor(travelEstNow(), tierMargin, sections.find((s) => s.id === secId)?.name || "")
      );
  };

  /** Seed the incoming method's draft (the prototype defaults each had). */
  const seedDraft = (kind: InputKind, secId: string) => {
    if (kind === "custom") setCustomDraft(freshCustom());
    else if (kind === "curtain") setCurtainDraft(freshCurtain(defaultFabric));
    else if (kind === "vendor") {
      /* #144: the pending edit seed, consumed and CLEARED here so it applies to
         exactly one open. With none set — or a record since deleted — this is
         the unchanged blank form. */
      const editId = vendorEditRef.current;
      vendorEditRef.current = null;
      const rec = editId ? vendorQuotes.find((v) => v.id === editId) : undefined;
      setVendorDraft(rec ? vendorDraftFromRecord(rec) : freshVendor());
    } else if (kind === "fixture") {
      const first = fixtureAssemblies[0];
      setFixtureDraft({
        ...freshFixture(),
        assemblyId: first?.id || "",
        componentQty: Object.fromEntries((first?.components || []).map((part) => [part.sku, String(part.defaultQty)])),
      });
    } else if (kind === "labor") {
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
    const c = computeCurtain(d, fabrics, tierMargin ?? undefined);
    if (!name || c.priceEach <= 0) return;
    let qty = parseInt(d.qty, 10);
    if (isNaN(qty) || qty < 1) qty = 1;
    const dims = (parseFloat(d.width) || 0) + "'W × " + (parseFloat(d.height) || 0) + "'H";
    const idN = nextId();
    const skuN = nextId();
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
      },
    ]);
    closeInput();
  };

  const setFixture = (field: "qty" | "position" | "circuit", val: string) =>
    setFixtureDraft((d) => ({ ...d, [field]: val }));
  const setFixtureAssembly = (assemblyId: string) => {
    const assembly = fixtureAssemblies.find((item) => item.id === assemblyId);
    setFixtureDraft((draft) => ({
      ...draft,
      assemblyId,
      componentQty: Object.fromEntries((assembly?.components || []).map((part) => [part.sku, String(part.defaultQty)])),
    }));
  };
  const setFixtureComponentQty = (sku: string, value: string) =>
    setFixtureDraft((draft) => ({ ...draft, componentQty: { ...draft.componentQty, [sku]: value } }));
  const addFixture = (secId: string) => {
    const d = fixtureDraft;
    const assembly = fixtureAssemblies.find((item) => item.id === d.assemblyId);
    if (!assembly) return;
    const components = assembly.components.map((part) => ({
      sku: part.sku,
      label: part.label,
      role: part.role,
      qty: Math.max(0, Number(d.componentQty[part.sku] ?? part.defaultQty) || 0),
      unit: part.unit,
      cost: part.cost,
      price: part.list,
    }));
    const included = components.filter((part) => part.qty > 0);
    const unitCost = included.reduce((sum, part) => sum + part.cost * part.qty, 0);
    const unitSell = included.reduce((sum, part) => sum + part.price * part.qty, 0);
    if (unitSell <= 0) return;
    const pc: string[] = [];
    if ((d.position || "").trim()) pc.push("Pos " + d.position.trim());
    if ((d.circuit || "").trim()) pc.push("Ckt " + d.circuit.trim());
    let desc = assemblyDescription({
      ...assembly,
      components: assembly.components.map((part) => ({
        ...part,
        defaultQty: Math.max(0, Number(d.componentQty[part.sku] ?? part.defaultQty) || 0),
      })),
    });
    if (pc.length) desc += " (" + pc.join(" / ") + ")";
    const qty = Math.max(1, Number.parseInt(d.qty, 10) || 1);
    pushItems(secId, [
      { id: nextId(), sku: assembly.id, desc, qty, unit: "ea", cost: unitCost, price: unitSell, fixture: true, components },
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
    setLaborDraft((d) => d.mobs.length >= 1 ? d : { ...d, mobs: [laborMob(travelEstNow())] });
  const removeMob = (idx: number) =>
    setLaborDraft((d) =>
      d.mobs.length <= 1 ? d : { ...d, mobs: d.mobs.filter((_, i) => i !== idx) }
    );
  const setMob = (idx: number, field: keyof MobDraft, val: string) =>
    setLaborDraft((d) => ({
      ...d,
      mobs: d.mobs.map((m, i) => (i === idx ? { ...m, [field]: val } : m)),
    }));
  const setMobNameSelect = (idx: number, val: string) =>
    setLaborDraft((d) => ({
      ...d,
      mobs: d.mobs.map((m, i) => {
        if (i !== idx) return m;
        if (val === "__custom__") return { ...m, nameCustom: true, name: "" };
        return { ...m, name: val, nameCustom: false };
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
  const autoMilesRT = () => {
    const est = travelEstNow();
    return est && est.miles != null ? Math.round(est.miles * 2) : null;
  };
  const applyAutoMiles = (idx: number) => {
    const auto = autoMilesRT();
    if (auto == null) return;
    setMob(idx, "milesRT", String(auto));
  };
  const setTripLocal = (idx: number) =>
    setLaborDraft((d) => ({
      ...d,
      mobs: d.mobs.map((m, i) =>
        i === idx ? { ...m, tripType: "local" as const, tripAuto: false } : m
      ),
    }));
  const applyTravelTrip = (idx: number) => {
    const auto = autoMilesRT();
    setLaborDraft((d) => ({
      ...d,
      mobs: d.mobs.map((m, i) =>
        i === idx
          ? {
              ...m,
              tripType: "travel" as const,
              tripAuto: false,
              milesRT:
                (m.milesRT === "" || m.milesRT == null) && auto != null
                  ? String(auto)
                  : m.milesRT,
            }
          : m
      ),
    }));
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
    const far = !!(est && est.minutes != null && est.minutes > 60);
    const rt = est && est.miles != null ? Math.round(est.miles * 2) : null;
    setLaborDraft((d) => ({
      ...d,
      mobs: d.mobs.map((m) => {
        if (m.tripAuto === false) return m; // manual override wins
        const tt: "local" | "travel" = far ? "travel" : "local";
        const miles =
          tt === "travel" && (m.milesRT === "" || m.milesRT == null) && rt != null
            ? String(rt)
            : m.milesRT;
        return { ...m, tripType: tt, milesRT: miles };
      }),
    }));
  };

  const addLabor = (secId: string) => {
    const r = computeLabor(laborDraft, rate);
    if (r.totalCost <= 0) return;
    const discLabel = DISC_LABEL[r.disc] || r.disc;
    const price = (c: number) => (r.margin < 1 ? round2(c / (1 - r.margin)) : c);
    const items: SpecItem[] = [];
    r.mobs.forEach((m, i) => {
      if (m.cost <= 0) return;
      const label = m.raw.name && m.raw.name.trim() ? m.raw.name.trim() : "Mobilization " + (i + 1);
      const desc = label + " — " + discLabel;
      const comment = (m.raw.comments || "").trim();
      const internalNote = (m.raw.internalNote || "").trim();
      const idN = nextId();
      const skuN = nextId();
      items.push({
        id: idN,
        sku: "LAB-" + r.disc + "-" + skuN,
        desc,
        qty: 1,
        unit: "lot",
        cost: round2(m.cost),
        price: price(m.cost),
        labor: true,
        comment,
        internalNote,
        mob: { type: label, days: m.days, crew: m.people, discipline: discLabel },
      });
    });
    if (r.shopCost > 0) {
      const idN = nextId();
      const skuN = nextId();
      items.push({
        id: idN,
        sku: "LAB-SHOP-" + skuN,
        desc: "Shop & engineering — PM, fabrication & drafting",
        qty: 1,
        unit: "lot",
        cost: round2(r.shopCost),
        price: price(r.shopCost),
        labor: true,
      });
    }
    if (r.misc > 0) {
      const idN = nextId();
      const skuN = nextId();
      items.push({
        id: idN,
        sku: "LAB-MISC-" + skuN,
        desc: "Project allowance / misc",
        qty: 1,
        unit: "lot",
        cost: round2(r.misc),
        price: price(r.misc),
        labor: true,
      });
    }
    if (r.performanceBonus > 0) {
      const idN = nextId();
      const skuN = nextId();
      items.push({
        id: idN,
        sku: "LAB-BONUS-" + skuN,
        desc: "Performance bonus — 5% of labor cost",
        qty: 1,
        unit: "lot",
        cost: round2(r.performanceBonus),
        price: price(r.performanceBonus),
        labor: true,
      });
    }
    if (items.length) pushItems(secId, items);
    closeInput(); // discards → reseeds freshLabor for this system
  };

  /* ---------------- review banner view-model ---------------- */
  const owner = initial.owner || me;
  const isOwner = owner === me;
  const rev = review || { state: "none" };
  const rm = rbMeta[rev.state] || rbMeta.none;
  let rbSub: string;
  if (rev.state === "none")
    rbSub = "Submit for a reviewer’s approval before sending to the customer.";
  else if (rev.state === "in_review")
    rbSub = rev.reviewer
      ? "With " + firstName(rev.reviewer) + " for approval"
      : "In the shared queue — awaiting a reviewer";
  // Punch #77: one shared phrasing for both surfaces. When the quotes list had
  // its own copy of this, it silently dropped the attestation detail. Imported
  // from @/lib/review-line, NOT from @/lib/stores/quotes — that would pull the
  // doc store into this client bundle and 500 the page.
  else if (rev.state === "approved") rbSub = approvedReviewLine(rev);
  else
    rbSub = rev.note
      ? "“" + rev.note + "” — " + firstName(rev.decidedBy || "")
      : "Returned by " + firstName(rev.decidedBy || "");
  const reviewerOptions = [{ value: "queue", label: "Shared queue (any reviewer)" }].concat(
    reviewers.filter((n) => n !== me && n !== owner).map((n) => ({ value: n, label: n }))
  );
  const sentAlready = status === "sent" || status === "won" || status === "lost";
  const rbCanSubmit = isOwner && (rev.state === "none" || rev.state === "changes") && !sentAlready;
  const rbSubmitLabel = rev.state === "changes" ? "Resubmit for review" : "Submit for review";
  const rbCanDecide = canApprove && rev.state === "in_review" && !isOwner;
  const rbCanClaim = canApprove && rev.state === "in_review" && !rev.reviewer && !isOwner;
  const rbCanSend = isOwner && rev.state === "approved" && !sentAlready;
  // Punch #60: the estimator can self-approve any time it isn't already
  // approved or sent — a stand-in for a review that happened by phone/Teams
  // rather than in the app. Available regardless of canApprove: this is
  // deliberately NOT a permission gate (see attestApprovalAction).
  // `changes` is excluded (Jeff 2026-08-01): a reviewer who formally asked for
  // changes can't be attested past — resubmit for review instead. The server
  // enforces this too (canAttestApproval); hiding it here is only convenience.
  const rbCanAttest =
    isOwner && rev.state !== "approved" && rev.state !== "changes" && !sentAlready;
  const showReviewBar = !!loadedId;

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
  const showContactPick = contacts.length >= 1;
  const contactOptions = [{ value: "", label: "— No contact —" }].concat(
    contacts.map((c) => ({ value: c.name, label: c.name + (c.role ? " · " + c.role : "") }))
  );
  const hasAttn = currentContact ? true : !!contactName;
  const attnLine = currentContact
    ? currentContact.name + (currentContact.role ? " · " + currentContact.role : "")
    : contactName || "";

  const curtainSec = sections.find((s) => s.id === curtainFor);
  const fixtureSec = sections.find((s) => s.id === fixtureFor);
  const laborSec = sections.find((s) => s.id === laborFor);
  const vendorSec = sections.find((s) => s.id === vendorFor);
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
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    lineHeight: 1.2,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  <input
                    value={projectName}
                    onChange={(e) => onProjectName(e.target.value)}
                    aria-label="Estimate name"
                    style={{ background: "transparent", border: "1px solid transparent", color: "#fff", font: "inherit", width: "100%", minWidth: 140, outline: "none" }}
                  />
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: "#9aa0ab",
                    fontFamily: "var(--font-mono)",
                    marginTop: 2,
                  }}
                >
                  {quoteId} · Rev {revNum}
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
                onClick={doSave}
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: 13,
                  fontWeight: 600,
                  border: "none",
                  borderRadius: 8,
                  padding: "9px 15px",
                  cursor: "pointer",
                  ...(justSaved
                    ? { background: "#22361f", color: "#5fd29a" }
                    : { background: "#2b2e35", color: "#cfd3da" }),
                }}
              >
                {justSaved ? "Saved ✓" : "Save"}
              </button>
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
          </div>

          {/* customer / venue context bar */}
          <div
            className="est-ctxbar"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px 14px",
              flexWrap: "wrap",
              rowGap: 8,
              padding: "9px 22px",
              background: "#23262d",
              borderTop: "1px solid #2b2e35",
              color: "#fff",
              flexShrink: 0,
            }}
          >
            <span style={CTX_LABEL}>Prepared for</span>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                flexWrap: "wrap",
                rowGap: 8,
                minWidth: 0,
              }}
            >
              <select
                value={customerId || ""}
                onChange={(e) => pickCustomer(e.target.value)}
                title="Linked customer — flows to the project when this quote is won"
                style={{ ...DARK_SELECT, minWidth: 180, maxWidth: 280 }}
              >
                {customerOptions.map((o) => (
                  <option key={o.value || "__none"} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              {showVenuePick && (
                <>
                  <span style={{ fontSize: 11, color: "#6b7079", flexShrink: 0 }}>at</span>
                  <select
                    value={locationId || ""}
                    onChange={(e) => pickVenue(e.target.value)}
                    title="Which of the customer's venues"
                    style={{ ...DARK_SELECT, minWidth: 160, maxWidth: 240 }}
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
                  <span style={{ fontSize: 11, color: "#6b7079", flexShrink: 0 }}>attn</span>
                  <select
                    value={currentContact ? currentContact.name : ""}
                    onChange={(e) => pickContact(e.target.value)}
                    title="Contact this quote is prepared for"
                    style={{ ...DARK_SELECT, minWidth: 150, maxWidth: 240 }}
                  >
                    {contactOptions.map((o) => (
                      <option key={o.value || "__none"} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </>
              )}
              <span style={{ fontSize: 11, color: "#6b7079", flexShrink: 0 }}>category</span>
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
                style={{ ...DARK_SELECT, minWidth: 140, cursor: "text" }}
              />
            </div>
          </div>

          {/* quote note */}
          <div
            className="est-noterow"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "9px 22px",
              background: "#23262d",
              borderTop: "1px solid #2b2e35",
              color: "#fff",
              flexShrink: 0,
            }}
          >
            <span style={CTX_LABEL}>Quote note</span>
            <input
              className="est-notefield"
              value={quoteNote}
              onChange={(e) => onQuoteNote(e.target.value)}
              placeholder="Cover language printed on the quote header — e.g. Thank you for the opportunity…"
              style={{
                flex: 1,
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
            <span style={{ fontSize: 10.5, color: "#6b7079", flexShrink: 0 }}>
              Shows on the PDF header
            </span>
          </div>

          {/* quote assumptions / exceptions (#36) */}
          <div
            className="est-noterow"
            style={{
              display: "flex", alignItems: "flex-start", gap: 12, padding: "9px 22px",
              background: "#23262d", borderTop: "1px solid #2b2e35", color: "#fff", flexShrink: 0,
            }}
          >
            <span style={{ ...CTX_LABEL, paddingTop: 8 }}>Assumptions</span>
            <textarea
              className="est-notefield"
              value={assumptions}
              onChange={(e) => onAssumptions(e.target.value)}
              placeholder="Assumptions, exclusions, and exceptions for this estimate…"
              rows={2}
              style={{ flex: 1, minWidth: 0, resize: "vertical", fontFamily: "var(--font-ui)", fontSize: 12.5, color: "#fff", background: "#2b2e35", border: "1px solid #3a3e46", borderRadius: 7, padding: "8px 11px" }}
            />
            <span style={{ fontSize: 10.5, color: "#6b7079", flexShrink: 0, paddingTop: 8 }}>Optional · shown on the quote</span>
          </div>

          <div
            className="est-noterow"
            style={{
              display: "flex", alignItems: "center", gap: 12, padding: "8px 22px",
              background: "#23262d", borderTop: "1px solid #2b2e35", color: "#fff", flexShrink: 0,
            }}
          >
            <span style={CTX_LABEL}>Suggested install timeframe</span>
            <select
              value={installTimeframe}
              onChange={(e) => onInstallTimeframe(e.target.value)}
              aria-label="Suggested install timeframe"
              style={{ ...DARK_SELECT, minWidth: 150 }}
            >
              {INSTALL_TIMEFRAMES.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
            <span style={{ fontSize: 10.5, color: "#6b7079" }}>
              Carries to the project goal when this quote is won
            </span>
          </div>

          {/* review & approval banner */}
          {showReviewBar && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
                flexWrap: "wrap",
                rowGap: 11,
                padding: "11px 22px",
                background: rm.bg,
                borderBottom: "1px solid " + rm.bd,
                flexShrink: 0,
              }}
            >
              <span
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: "50%",
                  background: "#fff",
                  border: "1px solid " + rm.bd,
                  color: rm.ink,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 14,
                  flexShrink: 0,
                }}
              >
                {rm.icon}
              </span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: rm.ink }}>{rm.title}</div>
                <div style={{ fontSize: 12, color: "#5b616e", marginTop: 1 }}>{rbSub}</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
                {rbCanSubmit && (
                  <>
                    <select
                      value={reviewerSel}
                      onChange={(e) => setReviewerSel(e.target.value)}
                      style={{
                        fontFamily: "var(--font-ui)",
                        fontSize: 12.5,
                        fontWeight: 600,
                        color: "#3a3f4a",
                        background: "#fff",
                        border: "1px solid #e4e7ec",
                        borderRadius: 8,
                        padding: "8px 11px",
                        cursor: "pointer",
                      }}
                    >
                      {reviewerOptions.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={submitReview}
                      style={{
                        fontSize: 12.5,
                        fontWeight: 600,
                        color: "#fff",
                        background: "#3155a8",
                        border: "none",
                        borderRadius: 8,
                        padding: "9px 15px",
                        cursor: "pointer",
                      }}
                    >
                      {rbSubmitLabel}
                    </button>
                  </>
                )}
                {rbCanClaim && (
                  <button
                    type="button"
                    onClick={claimReviewNow}
                    style={{
                      fontSize: 12.5,
                      fontWeight: 600,
                      color: "#3155a8",
                      background: "#e9eefb",
                      border: "1px solid #d4ddf3",
                      borderRadius: 8,
                      padding: "8px 13px",
                      cursor: "pointer",
                    }}
                  >
                    Claim review
                  </button>
                )}
                {rbCanDecide && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setRcOpen(true);
                        setRcNote("");
                      }}
                      style={{
                        fontSize: 12.5,
                        fontWeight: 600,
                        color: "#b4543a",
                        background: "#f9ece8",
                        border: "1px solid #f0d6cd",
                        borderRadius: 8,
                        padding: "8px 13px",
                        cursor: "pointer",
                      }}
                    >
                      Request changes
                    </button>
                    <button
                      type="button"
                      onClick={approveNow}
                      style={{
                        fontSize: 12.5,
                        fontWeight: 600,
                        color: "#fff",
                        background: "#1f7a52",
                        border: "none",
                        borderRadius: 8,
                        padding: "9px 15px",
                        cursor: "pointer",
                      }}
                    >
                      Approve
                    </button>
                  </>
                )}
                {rbCanAttest && (
                  <button
                    type="button"
                    title="Reviewed by phone, on a call, or otherwise off-platform? Record it here — a note naming who reviewed it is required."
                    onClick={() => {
                      setAttestOpen(true);
                      setAttestNote("");
                    }}
                    style={{
                      fontSize: 12.5,
                      fontWeight: 600,
                      color: "#1f7a52",
                      background: "#ecf6f0",
                      border: "1px solid #cce9da",
                      borderRadius: 8,
                      padding: "8px 13px",
                      cursor: "pointer",
                    }}
                  >
                    Attest approval…
                  </button>
                )}
                {rbCanSend && (
                  <button
                    type="button"
                    onClick={sendCustomer}
                    style={{
                      fontSize: 12.5,
                      fontWeight: 600,
                      color: "#fff",
                      background: "#1f7a52",
                      border: "none",
                      borderRadius: 8,
                      padding: "9px 15px",
                      cursor: "pointer",
                    }}
                  >
                    Send to customer →
                  </button>
                )}
              </div>
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
              <button
                type="button"
                onClick={() => setActionError(null)}
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
                {moveNotice.ok ? (
                  <>
                    Moved to {moveNotice.targetName} ({moveNotice.targetId}) —{" "}
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

          {/* attested-approval modal (punch #60) */}
          {attestOpen && (
            <div
              className="est-modalwrap"
              onClick={() => {
                setAttestOpen(false);
                setAttestNote("");
              }}
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(16,22,30,.5)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: 28,
                zIndex: 80,
              }}
            >
              <div
                className="est-modal"
                onClick={(e) => e.stopPropagation()}
                style={{
                  width: 460,
                  maxWidth: "100%",
                  background: "#fff",
                  borderRadius: 15,
                  boxShadow: "0 24px 70px rgba(0,0,0,.34)",
                  overflow: "hidden",
                  color: "#16181d",
                }}
              >
                <div
                  style={{
                    padding: "17px 22px",
                    borderBottom: "1px solid #f0f1f4",
                    fontSize: 16,
                    fontWeight: 600,
                  }}
                >
                  Attest approval
                </div>
                <div style={{ padding: "20px 22px" }}>
                  <div
                    style={{ fontSize: 12.5, color: "#5b616e", marginBottom: 11, lineHeight: 1.5 }}
                  >
                    Reviews here often happen by phone or on a call, not in the app. If that
                    already happened, name who reviewed it and how — this note is required and
                    becomes the approval record.
                  </div>
                  <textarea
                    className="est-field"
                    value={attestNote}
                    onChange={(e) => setAttestNote(e.target.value)}
                    placeholder='e.g. "Reviewed by Jeff on a Teams call, 2026-08-01"'
                    style={{
                      width: "100%",
                      minHeight: 96,
                      border: "1px solid #e4e7ec",
                      borderRadius: 9,
                      padding: "11px 13px",
                      fontSize: 13.5,
                      fontFamily: "var(--font-ui)",
                      resize: "vertical",
                      outline: "none",
                    }}
                  />
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "flex-end",
                    gap: 9,
                    padding: "14px 22px",
                    borderTop: "1px solid #f0f1f4",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setAttestOpen(false);
                      setAttestNote("");
                    }}
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: "#5b616e",
                      background: "transparent",
                      border: "none",
                      cursor: "pointer",
                      padding: "10px 12px",
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={submitAttest}
                    disabled={!attestNote.trim()}
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: "#fff",
                      background: attestNote.trim() ? "#1f7a52" : "#9cc7ae",
                      border: "none",
                      borderRadius: 9,
                      padding: "10px 18px",
                      cursor: attestNote.trim() ? "pointer" : "not-allowed",
                    }}
                  >
                    Record approval
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* request-changes modal */}
          {rcOpen && (
            <div
              className="est-modalwrap"
              onClick={() => {
                setRcOpen(false);
                setRcNote("");
              }}
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(16,22,30,.5)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: 28,
                zIndex: 80,
              }}
            >
              <div
                className="est-modal"
                onClick={(e) => e.stopPropagation()}
                style={{
                  width: 460,
                  maxWidth: "100%",
                  background: "#fff",
                  borderRadius: 15,
                  boxShadow: "0 24px 70px rgba(0,0,0,.34)",
                  overflow: "hidden",
                  color: "#16181d",
                }}
              >
                <div
                  style={{
                    padding: "17px 22px",
                    borderBottom: "1px solid #f0f1f4",
                    fontSize: 16,
                    fontWeight: 600,
                  }}
                >
                  Request changes
                </div>
                <div style={{ padding: "20px 22px" }}>
                  <div
                    style={{ fontSize: 12.5, color: "#5b616e", marginBottom: 11, lineHeight: 1.5 }}
                  >
                    Tell the estimator what needs to change before this can be approved.
                  </div>
                  <textarea
                    className="est-field"
                    value={rcNote}
                    onChange={(e) => setRcNote(e.target.value)}
                    placeholder="e.g. Re-check the rigging load math and add the pit filler line."
                    style={{
                      width: "100%",
                      minHeight: 96,
                      border: "1px solid #e4e7ec",
                      borderRadius: 9,
                      padding: "11px 13px",
                      fontSize: 13.5,
                      fontFamily: "var(--font-ui)",
                      resize: "vertical",
                      outline: "none",
                    }}
                  />
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "flex-end",
                    gap: 9,
                    padding: "14px 22px",
                    borderTop: "1px solid #f0f1f4",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setRcOpen(false);
                      setRcNote("");
                    }}
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: "#5b616e",
                      background: "transparent",
                      border: "none",
                      cursor: "pointer",
                      padding: "10px 12px",
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={submitRc}
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: "#fff",
                      background: "#b4543a",
                      border: "none",
                      borderRadius: 9,
                      padding: "10px 18px",
                      cursor: "pointer",
                    }}
                  >
                    Send back for changes
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* body */}
          <div className="est-body" style={{ flex: 1, display: "flex", minHeight: 0 }}>
            {/* left sidebar */}
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
                </div>
                {sections.map((sec) => {
                  const sub = systemItemsRev(sec) + systemFreight(sec);
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
              </div>

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
                      defaultSection="Review"
                    />
                  </>
                ) : (
                  <div style={{ fontSize: 11.5, color: "#aab0bb" }}>Save the quote to add tasks.</div>
                )}
              </div>
            </div>

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
                  onSetNarrative={(value) => setSystemNarrative(sec.id, value)}
                  onSetPresentation={(value) => setSystemPresentation(sec.id, value)}
                  onDelete={() => deleteSystem(sec.id)}
                  onSetMargin={(v) => setSystemMargin(sec.id, v)}
                  onSetFreight={(v) => setFreightPct(sec.id, v)}
                  onInc={inc}
                  onDec={dec}
                  onSetQty={setQty}
                  onSetPrice={setItemPrice}
                  onSetExtSell={setItemExtSell}
                  onMoveItem={(itemId, direction) => moveItem(sec.id, itemId, direction)}
                  onRemoveItem={removeItem}
                  onToggleCatalog={() => openInputMethod("catalog", sec.id)}
                  onToggleCurtain={() => openInputMethod("curtain", sec.id)}
                  onToggleFixture={() => openInputMethod("fixture", sec.id)}
                  onToggleLabor={() => openInputMethod("labor", sec.id)}
                  onToggleCustom={() => openInputMethod("custom", sec.id)}
                  onToggleVendor={() => openInputMethod("vendor", sec.id)}
                  onAddPart={(cat) => addPart(sec.id, cat)}
                  onImportMaterials={(items) => importMaterials(sec.id, items)}
                  onSetVendorDisplay={setVendorDisplay}
                  onEditVendor={(vqId) => openVendorEdit(sec.id, vqId)}
                  onSetCustomDraft={(field, v) => setCustomDraft((d) => ({ ...d, [field]: v }))}
                  onAddCustomPart={() => addCustomPart(sec.id)}
                  onMoveToNew={() => moveSystem(sec.id, { kind: "new" })}
                  onMoveToExisting={(targetQuoteId) =>
                    moveSystem(sec.id, { kind: "existing", quoteId: targetQuoteId })
                  }
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
          </div>

          {/* configurator modals */}
          {curtainFor && (
            <CurtainModal
              secName={curtainSec ? curtainSec.name : ""}
              draft={curtainDraft}
              fabrics={fabrics}
              margin={tierMargin ?? undefined}
              onSet={(field, val) => setCurtainDraft((d) => ({ ...d, [field]: val }))}
              onAdd={() => addCurtain(curtainFor)}
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

      {/* ===================== PREVIEW MODE (customer quote) ===================== */}
      {isPreview && (
        <PreviewDoc
          phone={phone}
          canBuild={!phone}
          onBack={() => setMode("build")}
          quoteId={quoteId}
          revNum={revNum}
          revDateMs={revDateMs}
          custName={
            customerId ? customers.find((c) => c.id === customerId)?.name || custName : custName
          }
          hasAttn={hasAttn}
          attnLine={attnLine}
          projectName={projectName}
          venueLabel={(() => {
            const l = locations.find((x) => x.id === locationId);
            if (!l) return "";
            return [l.label, l.city].filter(Boolean).join(" — ");
          })()}
          ownerName={initial.owner || me}
          companyName={companyName}
          logoDark={logoDark}
          quoteNote={quoteNote}
          assumptions={assumptions}
          sections={sections}
          setSectionPresentation={(id, value) => setSystemPresentation(id, value)}
          vendorQuotes={vendorQuotes}
          t={t}
          taxRatePct={TAX_RATE_PCT}
          detail={detail}
          setDetail={setDetail}
          pdfQty={pdfQty}
          pdfNotes={pdfNotes}
          pdfPrices={pdfPrices}
          pdfCover={pdfCover}
          pdfTerms={pdfTerms}
          pdfOptions={pdfOptions}
          paymentTerms={paymentTerms}
          paymentTermsOptions={PAYMENT_TERMS}
          setPaymentTerms={setPaymentTerms}
          togglePdf={(flag) => {
            if (flag === "pdfQty") setPdfQty((v) => !v);
            else if (flag === "pdfNotes") setPdfNotes((v) => !v);
            else if (flag === "pdfPrices") setPdfPrices((v) => !v);
            else if (flag === "pdfCover") setPdfCover((v) => !v);
            else if (flag === "pdfOptions") setPdfOptions((v) => !v);
            else setPdfTerms((v) => !v);
          }}
        />
      )}
    </div>
  );
}
