"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { CSSProperties } from "react";
import { firstName } from "@/lib/team";
import { approvedReviewLine } from "@/lib/review-line";
import type { QuoteReview, QuoteStatus } from "@/lib/stores/quotes";
import {
  approveReviewAction,
  attestApprovalAction,
  claimReviewAction,
  draftQuoteScopeAction,
  requestChangesAction,
  saveQuoteAction,
  sendToCustomerAction,
  setStatusAction,
  submitReviewAction,
  travelForSelectionAction,
  updateQuoteMetaAction,
  type ReviewSync,
} from "./actions";
import type { DraftedLine } from "./ai-scope-modal";
import {
  demoSections,
  DISC_LABEL,
  FIX_PRESETS,
  FIXTURES,
  fixtureAddOns,
  GENERIC_SUGGEST,
  SUGGEST,
  type SuggestPart,
} from "./estimator-data";
import {
  computeCurtain,
  computeFixture,
  computeLabor,
  fmt,
  makeLaborRate,
  round2,
  short,
  systemFreight,
  systemItemsRev,
  totals,
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
} from "./types";
import { ACCENT_INK, ACCENT_SOFT } from "./est-ui";
import SectionCard from "./section-card";
import AiScopeModal from "./ai-scope-modal";
import CurtainModal from "./curtain-modal";
import FixtureModal from "./fixture-modal";
import LaborModal from "./labor-modal";
import PreviewDoc from "./preview-doc";

/**
 * Estimator workspace — client port of Estimator.dc.html (build + preview
 * modes). All state lives here; pricing math in ./pricing; persistence via
 * server actions on the quotes store.
 */

/** Prototype prop taxRatePct defaulted to 0 — kept as a constant. */
const TAX_RATE_PCT = 0;

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
  .est-modalwrap { align-items: flex-end !important; padding: 0 !important; }
  .est-modal { width: 100% !important; max-width: 100% !important; border-radius: 16px 16px 0 0 !important; max-height: 92vh !important; }
  .est-modal input, .est-modal select, .est-modal textarea { font-size: 16px !important; }
}
`;

/* ---------------- fresh drafts (prototype defaults) ---------------- */

const freshCustom = (): CustomDraft => ({
  desc: "",
  allowance: "",
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
  const f0 = FIXTURES[0] || { sku: "", list: 0 };
  return {
    model: f0.sku,
    custom: false,
    name: "",
    price: String(f0.list || ""),
    qty: "1",
    mount: "C-clamp",
    accessories: ["Safety cable"],
    power: [],
    lamp: "LED",
    position: "",
    circuit: "",
  };
};

/** New mobilization — defaults to travel rates when the venue is >1h away. */
function freshMob(t: TravelLite | null): MobDraft {
  const far = !!(t && t.minutes != null && t.minutes > 60);
  const rt = t && t.miles != null ? Math.round(t.miles * 2) : null;
  return {
    name: "",
    nameCustom: false,
    tripType: far ? "travel" : "local",
    tripAuto: true,
    people: "4",
    days: "5",
    otHrs: "",
    sup: false,
    milesRT: far && rt != null ? String(rt) : "",
    lift: false,
    comments: "",
    internalNote: "",
  };
}

const freshLabor = (
  t: TravelLite | null,
  /** Tier-seeded margin fraction (item 11, D87); null → the legacy 30. */
  tierMargin?: number | null
): LaborDraft => ({
  discipline: "RIG",
  margin:
    tierMargin != null && tierMargin > 0 && tierMargin < 1
      ? String(Math.round(tierMargin * 100))
      : "30",
  mobs: [freshMob(t)],
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

export default function EstimatorClient({
  initial,
  companyName,
  logoDark,
  fabrics,
  laborRates,
  fixtureRates,
  customers,
  travel,
  reviewers,
  me,
  canApprove,
  aiSource,
}: EstimatorProps) {
  /* ---------------- state (port of the prototype's this.state) ---------------- */
  const [sections, setSections] = useState<SpecSection[]>(
    () => initial.sections ?? demoSections()
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
  const [custName, setCustName] = useState(initial.custName);
  const [customerId, setCustomerId] = useState(initial.customerId);
  const [locationId, setLocationId] = useState(initial.locationId);
  const [contactName, setContactName] = useState(initial.contactName);
  const [quoteNote, setQuoteNote] = useState(initial.quoteNote);
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
    () => (initial.sections ?? demoSections())[0]?.id ?? null
  );
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [openCatalog, setOpenCatalog] = useState<string | null>(null);
  const [customFor, setCustomFor] = useState<string | null>(null);
  const [customDraft, setCustomDraft] = useState<CustomDraft>(freshCustom);
  const [curtainFor, setCurtainFor] = useState<string | null>(null);
  const [curtainDraft, setCurtainDraft] = useState<CurtainDraft>(() =>
    freshCurtain(defaultFabric)
  );
  const [fixtureFor, setFixtureFor] = useState<string | null>(null);
  const [fixtureDraft, setFixtureDraft] = useState<FixtureDraft>(freshFixture);
  const [laborFor, setLaborFor] = useState<string | null>(null);
  // Customer tier margin stamp (item 11, D87) — SEEDS the labor draft and
  // curtain configurator; refreshed when the meta action re-stamps.
  const [tierMargin, setTierMargin] = useState<number | null>(initial.tierMargin);
  const [laborDraft, setLaborDraft] = useState<LaborDraft>(() =>
    freshLabor(null, initial.tierMargin)
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
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onResize = () => setPhone(window.innerWidth <= 700);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const rate = useMemo(() => makeLaborRate(laborRates), [laborRates]);
  const fixAddOns = useMemo(() => fixtureAddOns(fixtureRates), [fixtureRates]);
  const t = useMemo(() => totals(sections, TAX_RATE_PCT), [sections]);

  const isBuild = !phone && mode === "build";
  const isPreview = phone || mode === "preview";
  const isInternal = true; // build mode is the internal view (prototype view: 'internal')
  const cols = isInternal
    ? "minmax(190px,1fr) 112px 128px 80px 58px 100px 22px"
    : "minmax(190px,1fr) 112px 128px 100px 22px";

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
      const res = await saveQuoteAction(loadedId, {
        name: initial.projectName,
        customer: cname,
        customerId: customerId || null,
        locationId: locationId || null,
        contactName: contactName || "",
        quoteNote: quoteNote || "",
        value: t.grand,
        margin: t.margin,
        status,
        sections,
        mobs,
      });
      if (res.ok && res.id) {
        setLoadedId(res.id);
        setQuoteId(res.id);
        setRevNum(res.revNum);
        setRevDateMs(res.updatedAt);
        if (res.review) setReview(res.review);
        if (res.status) setStatus(res.status);
      }
      setJustSaved(true);
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setJustSaved(false), 1800);
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
  const inc = (id: number) => patchItem(id, (it) => ({ ...it, qty: it.qty + 1 }));
  const dec = (id: number) => patchItem(id, (it) => ({ ...it, qty: Math.max(0, it.qty - 1) }));
  const setQty = (id: number, v: string) => {
    let n = parseInt(v, 10);
    if (isNaN(n) || n < 0) n = 0;
    patchItem(id, (it) => ({ ...it, qty: n }));
  };
  const removeItem = (id: number) =>
    setSections((ss) => ss.map((s) => ({ ...s, items: s.items.filter((x) => x.id !== id) })));

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
  const deleteSystem = (secId: string) => {
    const list = sections.filter((s) => s.id !== secId);
    setSections(list);
    setActiveId((a) => (a === secId ? (list[0] ? list[0].id : null) : a));
  };

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
      { id, name: "New System", kind: "materials", mfr: "", freightPct: 0, items: [] },
    ]);
    setActiveId(id);
    setOpenCatalog(id);
    requestAnimationFrame(() => requestAnimationFrame(() => scrollToCard(id)));
  };

  const pushItems = (secId: string, items: SpecItem[]) =>
    setSections((ss) =>
      ss.map((s) => (s.id === secId ? { ...s, items: [...s.items, ...items] } : s))
    );

  const addPart = (secId: string, cat: SuggestPart) => {
    pushItems(secId, [
      { id: nextId(), sku: cat.sku, desc: cat.desc, qty: 1, unit: cat.unit, cost: cat.cost, price: cat.price },
    ]);
    setOpenCatalog(null);
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

  /* ---------------- add-flows (portals + modals) ---------------- */
  const toggleCatalog = (id: string) => setOpenCatalog((cur) => (cur === id ? null : id));
  const toggleCustom = (id: string) => {
    if (customFor === id) {
      setCustomFor(null);
      return;
    }
    setCustomFor(id);
    setOpenCatalog(null);
    setCurtainFor(null);
    setLaborFor(null);
    setFixtureFor(null);
    setCustomDraft(freshCustom());
  };
  const toggleCurtain = (id: string) => {
    if (curtainFor === id) {
      setCurtainFor(null);
      return;
    }
    setCurtainFor(id);
    setOpenCatalog(null);
    setCustomFor(null);
    setLaborFor(null);
    setFixtureFor(null);
    setCurtainDraft(freshCurtain(defaultFabric));
  };
  const toggleFixture = (id: string) => {
    if (fixtureFor === id) {
      setFixtureFor(null);
      return;
    }
    setFixtureFor(id);
    setOpenCatalog(null);
    setCustomFor(null);
    setCurtainFor(null);
    setLaborFor(null);
    setFixtureDraft(freshFixture());
  };
  const toggleLabor = (id: string) => {
    if (laborFor === id) {
      setLaborFor(null);
      return;
    }
    setLaborFor(id);
    setOpenCatalog(null);
    setCustomFor(null);
    setCurtainFor(null);
    setFixtureFor(null);
    // Resolve travel before seeding the draft (punch #89): the estimate is
    // fetched on selection now, so opening this immediately after picking a
    // customer could otherwise seed the mobilization with no distance and
    // quietly price the trip as local. Cached selections call back inline.
    withTravelFor(customerId, locationId, (est) =>
      setLaborDraft(freshLabor(est, tierMargin))
    );
  };

  const addCustomPart = (secId: string) => {
    const d = customDraft;
    const desc = (d.desc || "").trim();
    const price = parseFloat(d.price);
    if (!desc || isNaN(price) || price <= 0) return;
    let qty = parseInt(d.qty, 10);
    if (isNaN(qty) || qty < 1) qty = 1;
    let cost = parseFloat(d.cost);
    if (isNaN(cost) || cost < 0) cost = 0;
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
        allowance: d.allowance ? true : undefined,
      },
    ]);
    setCustomFor(null);
    setCustomDraft(freshCustom());
  };

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
    setCurtainFor(null);
    setCurtainDraft(freshCurtain(defaultFabric));
  };

  const setFixture = (field: keyof FixtureDraft, val: string) =>
    setFixtureDraft((d) => ({ ...d, [field]: val }));
  const setFixtureModel = (sku: string) => {
    if (sku === "__custom") {
      setFixtureDraft((d) => ({ ...d, custom: true, model: "__custom", price: "", name: "" }));
      return;
    }
    const f = FIXTURES.find((x) => x.sku === sku);
    setFixtureDraft((d) => ({ ...d, custom: false, model: sku, price: f ? String(f.list) : "" }));
  };
  const toggleFixArr = (field: "accessories" | "power", key: string) =>
    setFixtureDraft((d) => {
      const arr = (d[field] || []).slice();
      const i = arr.indexOf(key);
      if (i >= 0) arr.splice(i, 1);
      else arr.push(key);
      return { ...d, [field]: arr };
    });
  const applyFixturePreset = (index: number) => {
    const p = FIX_PRESETS[index];
    if (!p) return;
    const f = FIXTURES.find((x) => x.sku === p.d.model);
    setFixtureDraft({
      ...freshFixture(),
      ...p.d,
      accessories: [...(p.d.accessories || [])],
      power: [...(p.d.power || [])],
      custom: false,
      price: f ? String(f.list) : "",
      name: "",
    });
  };
  const addFixture = (secId: string) => {
    const d = fixtureDraft;
    const c = computeFixture(d, fixAddOns);
    const name = d.custom ? (d.name || "").trim() : c.fx.name;
    if (!name || c.unit <= 0) return;
    const opts: string[] = [];
    if (d.mount && d.mount !== "None") opts.push(d.mount);
    if ((d.accessories || []).length) opts.push(d.accessories.join(", "));
    if ((d.power || []).length) opts.push(d.power.join("/"));
    if (d.lamp && d.lamp !== "LED") opts.push(d.lamp);
    const pc: string[] = [];
    if ((d.position || "").trim()) pc.push("Pos " + d.position.trim());
    if ((d.circuit || "").trim()) pc.push("Ckt " + d.circuit.trim());
    let desc = name;
    if (opts.length) desc += " — " + opts.join("; ");
    if (pc.length) desc += " (" + pc.join(" / ") + ")";
    const idN = nextId();
    const sku = d.custom ? "FIX-" + nextId() : c.fx.sku;
    pushItems(secId, [
      { id: idN, sku, desc, qty: c.qty, unit: "ea", cost: c.cost, price: c.unit, fixture: true },
    ]);
    setFixtureFor(null);
    setFixtureDraft(freshFixture());
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
    setLaborDraft((d) => ({ ...d, mobs: d.mobs.concat([freshMob(travelEstNow())]) }));
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
    if (items.length) pushItems(secId, items);
    setLaborFor(null);
    setLaborDraft(freshLabor(travelEstNow(), tierMargin));
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
                  {initial.projectName}
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
                  catalogOpen={openCatalog === sec.id}
                  customOpen={customFor === sec.id}
                  customDraft={customDraft}
                  suggestions={SUGGEST[sec.id] || GENERIC_SUGGEST}
                  registerRef={(id, el) => {
                    cardRefs.current[id] = el;
                  }}
                  onToggleExpand={() => toggleExpand(sec.id)}
                  onRename={(name) => renameSystem(sec.id, name)}
                  onDelete={() => deleteSystem(sec.id)}
                  onSetMargin={(v) => setSystemMargin(sec.id, v)}
                  onSetFreight={(v) => setFreightPct(sec.id, v)}
                  onInc={inc}
                  onDec={dec}
                  onSetQty={setQty}
                  onRemoveItem={removeItem}
                  onToggleCatalog={() => toggleCatalog(sec.id)}
                  onToggleCurtain={() => toggleCurtain(sec.id)}
                  onToggleFixture={() => toggleFixture(sec.id)}
                  onToggleLabor={() => toggleLabor(sec.id)}
                  onToggleCustom={() => toggleCustom(sec.id)}
                  onAddPart={(cat) => addPart(sec.id, cat)}
                  onSetCustomDraft={(field, v) => setCustomDraft((d) => ({ ...d, [field]: v }))}
                  onAddCustomPart={() => addCustomPart(sec.id)}
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
              onClose={() => setCurtainFor(null)}
            />
          )}
          {fixtureFor && (
            <FixtureModal
              secName={fixtureSec ? fixtureSec.name : ""}
              draft={fixtureDraft}
              addOns={fixAddOns}
              onSet={setFixture}
              onSetModel={setFixtureModel}
              onToggleArr={toggleFixArr}
              onApplyPreset={applyFixturePreset}
              onAdd={() => addFixture(fixtureFor)}
              onClose={() => setFixtureFor(null)}
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
              onClose={() => setLaborFor(null)}
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
          projectName={initial.projectName}
          venueLabel={(() => {
            const l = locations.find((x) => x.id === locationId);
            if (!l) return "";
            return [l.label, l.city].filter(Boolean).join(" — ");
          })()}
          ownerName={initial.owner || me}
          companyName={companyName}
          logoDark={logoDark}
          quoteNote={quoteNote}
          sections={sections}
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
