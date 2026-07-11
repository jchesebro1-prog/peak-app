"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { firstName } from "@/lib/team";
import type { DesignRecord, DesignRevision } from "@/lib/stores/designs";
import {
  DIMSCHEMA,
  LIM,
  SHORT,
  SIZES,
  SUBCFG,
  SYSSUB,
  TIERS,
  VENUES,
  buildRiser,
  clamp,
  compute,
  defaultAState,
  gridSets,
  hydrateAState,
  moneyRound,
  nameSuffix,
  rigSetsFor,
  sizedDims,
  tierDefsDefault,
  tierSystems,
  tierSystemsBase,
  tierTotals,
  venueOf,
  type AState,
  type DimField,
  type FabricOption,
  type SysKey,
  type TierDefs,
  type TierKey,
  type ViewKey,
} from "./engine";
import { PlanSvg, buildPlan, churchGeom, currentDoors, houseDragPatch, prosGeom, type PlanHandle } from "./plan-svg";
import {
  getAccentHex,
  getAccentHexServer,
  getTierDefs,
  getTierDefsServer,
  putTierDefs,
  subscribeAccent,
  subscribeTierDefs,
} from "./tierdefs-store";
import { addToQuotesAction, saveDesignAction, saveRevisionAction, type DesignPartial } from "./actions";
import {
  approveDesignAction,
  claimDesignReviewAction,
  requestDesignChangesAction,
  submitDesignReviewAction,
} from "../design/actions";

/* ------------------------------ shared tokens ------------------------------ */

const ACCENT = "var(--accent)";
const ACCENT_SOFT = "color-mix(in srgb, var(--accent) 12%, #fff)";
const ACCENT_INK = "color-mix(in srgb, var(--accent) 72%, #000)";
const MONO = "var(--font-mono)";
const UI = "var(--font-ui)";
const DAY = 86400000;

/** sandbox.js timeAgo — kept for label parity ("yesterday", "3d ago", "Jul 2") */
function timeAgoMs(ts: number | null | undefined): string {
  if (!ts) return "—";
  const diff = Date.now() - ts;
  const d = Math.floor(diff / DAY);
  if (d <= 0) {
    const h = Math.floor(diff / 3600000);
    return h <= 0 ? "just now" : h + "h ago";
  }
  if (d === 1) return "yesterday";
  if (d < 14) return d + "d ago";
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** strip the auto-suffix from a stored name so the prefix input round-trips */
function stripName(name: string | null | undefined): string | null {
  if (!name) return null;
  const m = /^(.*) — (?:Good|Better|Best) design \(\d+'×\d+'\)$/.exec(name);
  return m ? m[1] : name;
}

const secLabel: CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: "#9aa0ab",
  letterSpacing: ".06em",
  textTransform: "uppercase",
};

export type CustomerOpt = {
  id: string;
  name: string;
  type: string;
  location: string;
  locations: Array<{ id: string; label: string; city: string; primary: boolean }>;
};

/* ================================ component ================================ */

export default function QuickDesignClient({
  me,
  canApprove,
  initialDesign,
  customers,
  fabrics,
  rates,
  reviewerNames,
}: {
  me: string;
  canApprove: boolean;
  initialDesign: DesignRecord | null;
  customers: CustomerOpt[];
  fabrics: FabricOption[];
  rates: { installPct: number; freightPct: number; contingencyPct: number };
  reviewerNames: string[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  /* ------------------------------- state ------------------------------- */

  const [a, setA] = useState<AState>(() =>
    initialDesign ? hydrateAState(initialDesign, rates.contingencyPct) : defaultAState(rates.contingencyPct)
  );
  const [designId, setDesignId] = useState<string | null>(initialDesign ? initialDesign.id : null);
  const [designRec, setDesignRec] = useState<DesignRecord | null>(initialDesign);
  const [designName, setDesignName] = useState<string | null>(initialDesign ? stripName(initialDesign.name) : null);
  const [linkedCustomer, setLinkedCustomer] = useState<string | null>(() => {
    if (!initialDesign) return null;
    if (initialDesign.customerId && customers.some((c) => c.id === initialDesign.customerId)) return initialDesign.customerId;
    const byName = initialDesign.customer ? customers.find((c) => c.name === initialDesign.customer) : null;
    return byName ? byName.id : null;
  });
  const [linkedLocation, setLinkedLocation] = useState<string | null>(() => {
    if (!initialDesign) return null;
    return initialDesign.locationId || null;
  });
  const [tierRailOpen, setTierRailOpen] = useState(true);
  const [inputsOpen, setInputsOpen] = useState(true);
  const [sec, setSec] = useState({ venue: true, size: true, dims: true, systems: true });
  const [bomOpen, setBomOpen] = useState<Record<string, boolean>>({});
  const [reviewerSel, setReviewerSel] = useState("queue");
  const [rcOpen, setRcOpen] = useState(false);
  const [rcNote, setRcNote] = useState("");
  const [revOpen, setRevOpen] = useState(false);
  const [savedToast, setSavedToast] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  /** Manual layout / plan-drawing editor is deferred (spatial-estimating work). */
  const [manualNotice, setManualNotice] = useState(false);

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // tier definitions are global, per-browser (prototype localStorage parity);
  // resolved accent feeds SVG fills (attributes can't consume CSS vars)
  const tierDefs = useSyncExternalStore(subscribeTierDefs, getTierDefs, getTierDefsServer);
  const accentHex = useSyncExternalStore(subscribeAccent, getAccentHex, getAccentHexServer);

  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    []
  );

  const updA = (patch: Partial<AState>) => setA((prev) => ({ ...prev, ...patch }));

  const toast = (msg: string | null) => {
    setToastMsg(msg);
    setSavedToast(true);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setSavedToast(false), 5000);
  };

  /* ------------------------------ derived ------------------------------ */

  const laborPct = rates.installPct / 100;
  const freightPct = rates.freightPct / 100;
  const contPct = (a.contingency ?? 0) / 100;

  const C = useMemo(() => compute(a), [a]);
  const selKey = (a.tier || "better") as TierKey;
  const selTd = TIERS.find((t) => t.key === selKey) || TIERS[1];
  const selBase = useMemo(() => tierSystemsBase(C, a, selKey, tierDefs, fabrics), [C, a, selKey, tierDefs, fabrics]);
  const selSystems = useMemo(() => {
    const ov = (a.qtyOverrides && a.qtyOverrides[selKey]) || {};
    return selBase.map((sys) => {
      const so = ov[sys.key];
      if (!so) return sys;
      let rev = 0;
      let cost = 0;
      const items = sys.items.map((it) => {
        const q = so[it.desc] != null ? so[it.desc] : it.qty;
        rev += q * it.price;
        cost += q * it.cost;
        return { ...it, qty: q };
      });
      return { ...sys, items, rev, cost };
    });
  }, [selBase, a.qtyOverrides, selKey]);
  const selTot = useMemo(() => tierTotals(selSystems, selTd, laborPct, freightPct, contPct), [selSystems, selTd, laborPct, freightPct, contPct]);
  const tierCards = useMemo(
    () =>
      TIERS.map((td) => ({
        td,
        tot: tierTotals(tierSystems(C, a, td.key, tierDefs, fabrics), td, laborPct, freightPct, contPct),
      })),
    [C, a, tierDefs, fabrics, laborPct, freightPct, contPct]
  );

  const venue = venueOf(a);
  const suffix = nameSuffix(a);
  const linkedCustomerObj = linkedCustomer ? customers.find((c) => c.id === linkedCustomer) || null : null;
  const customerMeta = linkedCustomerObj
    ? linkedCustomerObj.type + (linkedCustomerObj.location ? " · " + linkedCustomerObj.location : "")
    : "";
  const showVenuePick = !!(linkedCustomerObj && linkedCustomerObj.locations && linkedCustomerObj.locations.length > 1);

  const revisions: DesignRevision[] = (designRec && designRec.revisions) || [];

  /* ------------------------------ actions ------------------------------ */

  const makeDesign = (): DesignPartial => {
    const s = a;
    const td = TIERS.find((t) => t.key === (s.tier || "better")) || TIERS[1];
    const Cx = compute(s);
    const sysForTot = tierSystems(Cx, s, td.key, tierDefs, fabrics);
    const tot = tierTotals(sysForTot, td, laborPct, freightPct, (s.contingency ?? 0) / 100);
    const v = venueOf(s);
    const sysNames = Cx.systems.filter((x) => x.on).map((x) => SHORT[x.key] || x.name);
    return {
      name: (designName || v.label) + " — " + td.label + " design (" + s.width + "'×" + s.depth + "')",
      venue: v.label,
      size: s.size,
      tier: td.key,
      width: s.width,
      depth: s.depth,
      grid: s.grid,
      systems: sysNames,
      budget: tot.grand,
      customerId: linkedCustomerObj ? linkedCustomerObj.id : null,
      locationId: linkedCustomerObj ? linkedLocation || null : null,
      customer: linkedCustomerObj ? linkedCustomerObj.name : "",
      config: JSON.parse(JSON.stringify(s)) as Record<string, unknown>,
    };
  };

  const afterSave = (record: DesignRecord, msg: string | null) => {
    const isNew = !designId;
    setDesignId(record.id);
    setDesignRec(record);
    setSavedId(record.id);
    toast(msg);
    if (isNew) router.replace(`/quick-design?design=${encodeURIComponent(record.id)}`, { scroll: false });
  };

  const onSaveDesign = () => {
    const partial = makeDesign();
    startTransition(async () => {
      const res = await saveDesignAction(designId, partial);
      afterSave(res.record, null);
    });
  };

  const onSaveRevision = () => {
    const partial = makeDesign();
    startTransition(async () => {
      const res = await saveRevisionAction(designId, partial);
      afterSave(res.record, "Revision v" + res.rev + " saved");
    });
  };

  const onAddToQuotes = () => {
    const partial = makeDesign();
    startTransition(async () => {
      const res = await addToQuotesAction(designId, partial);
      router.push(`/estimator?id=${encodeURIComponent(res.quoteId)}`);
    });
  };

  const restoreRevision = (r: DesignRevision) => {
    const cfg = r.config as Partial<AState> | undefined;
    if (!cfg) return;
    setA((prev) => ({ ...prev, ...cfg }));
    const cname = typeof r.customer === "string" ? r.customer : "";
    const lc = cname ? customers.find((c) => c.name === cname) : null;
    if (lc) setLinkedCustomer(lc.id);
    setRevOpen(false);
    toast("Restored revision v" + r.rev);
  };

  /* ---- review workflow ---- */

  const review = designRec ? designRec.review || { state: "none", reviewer: null, submittedBy: null, submittedAt: null, decidedBy: null, decidedAt: null, note: "" } : null;
  const dOwner = designRec ? designRec.owner : me;
  const isOwner = dOwner === me;

  const doReview = (fn: () => Promise<{ ok: boolean; record?: DesignRecord; error?: string }>) => {
    startTransition(async () => {
      const res = await fn();
      if (res.ok && res.record) setDesignRec(res.record);
      else if (!res.ok && res.error) toast(res.error);
    });
  };

  const onSubmitReview = () => {
    if (!designId) return;
    doReview(() => submitDesignReviewAction(designId, reviewerSel !== "queue" ? reviewerSel : null));
  };
  const onClaimReview = () => {
    if (!designId) return;
    doReview(() => claimDesignReviewAction(designId));
  };
  const onApproveReview = () => {
    if (!designId) return;
    doReview(() => approveDesignAction(designId));
  };
  const submitRc = () => {
    if (!designId || !rcNote.trim()) return;
    const note = rcNote.trim();
    setRcOpen(false);
    setRcNote("");
    doReview(() => requestDesignChangesAction(designId, note));
  };

  /* ---- customer link ---- */

  const primaryLocId = (c: CustomerOpt | null) => {
    const ls = (c && c.locations) || [];
    const p = ls.find((l) => l.primary) || ls[0];
    return p ? p.id : null;
  };
  const onLinkCustomer = (id: string) => {
    const c = id ? customers.find((x) => x.id === id) || null : null;
    setLinkedCustomer(id || null);
    setLinkedLocation(c ? primaryLocId(c) : null);
  };

  /* ---- tier definitions ---- */

  const setTierDefsPersist = (next: TierDefs) => {
    putTierDefs(next);
  };
  const setTierBlurb = (tk: TierKey, val: string) => {
    const td = JSON.parse(JSON.stringify(tierDefs)) as TierDefs;
    td[tk].blurb = val;
    setTierDefsPersist(td);
  };
  const setTierSpec = (tk: TierKey, sysKey: string, val: string) => {
    const td = JSON.parse(JSON.stringify(tierDefs)) as TierDefs;
    td[tk].specs[sysKey] = val;
    setTierDefsPersist(td);
  };
  const setTierSets = (tk: TierKey, raw: string) => {
    let v = parseInt(raw, 10);
    if (isNaN(v)) v = 0;
    v = clamp(v, 1, 300);
    const td = JSON.parse(JSON.stringify(tierDefs)) as TierDefs;
    td[tk].sets = v;
    setTierDefsPersist(td);
  };
  const setTierFabric = (tk: TierKey, fk: string, sku: string) => {
    const td = JSON.parse(JSON.stringify(tierDefs)) as TierDefs;
    td[tk].fabrics = td[tk].fabrics || {};
    td[tk].fabrics[fk] = sku;
    setTierDefsPersist(td);
  };

  /* ---- designer edits ---- */

  const setVenue = (vk: string) => {
    const v = VENUES.find((x) => x.key === vk) || VENUES[0];
    const d = sizedDims(v, a.size);
    updA({ venue: vk, sys: { ...v.sys }, ...d });
  };
  const stepDim = (field: DimField, dir: number) => {
    const l = LIM[field];
    updA({ [field]: clamp(a[field] + dir * 2, l[0], l[1]) } as Partial<AState>);
  };
  const setDimVal = (field: DimField, raw: string) => {
    const l = LIM[field];
    let v = parseInt(raw, 10);
    if (isNaN(v)) v = l[0];
    updA({ [field]: clamp(v, l[0], l[1]) } as Partial<AState>);
  };
  const toggleSys = (sk: SysKey) => updA({ sys: { ...a.sys, [sk]: !a.sys[sk] } });
  const setSingle = (field: string, val: string) => updA({ [field]: val } as Partial<AState>);
  const toggleMulti = (field: string, opt: string) => {
    const o = (a as unknown as Record<string, Record<string, boolean>>)[field] || {};
    updA({ [field]: { ...o, [opt]: !o[opt] } } as Partial<AState>);
  };
  const setContingency = (raw: string) => {
    let v = parseInt(raw, 10);
    if (isNaN(v)) v = 0;
    updA({ contingency: clamp(v, 0, 25) });
  };
  const setQtyOverride = (tk: TierKey, sysKey: string, desc: string, raw: string) => {
    let v = parseInt(raw, 10);
    if (isNaN(v) || v < 0) v = 0;
    const ov = JSON.parse(JSON.stringify(a.qtyOverrides || {})) as AState["qtyOverrides"];
    ov[tk] = ov[tk] || {};
    ov[tk]![sysKey] = ov[tk]![sysKey] || {};
    ov[tk]![sysKey][desc] = v;
    updA({ qtyOverrides: ov });
  };
  const resetQtyOverride = (tk: TierKey, sysKey: string, desc: string) => {
    const cur = a.qtyOverrides;
    if (!cur || !cur[tk] || !cur[tk]![sysKey]) return;
    const ov = JSON.parse(JSON.stringify(cur)) as AState["qtyOverrides"];
    delete ov[tk]![sysKey][desc];
    updA({ qtyOverrides: ov });
  };

  /* ---- house walls & doors (auto plan) ---- */

  const addDoor = (key: "doorsL" | "doorsR" | "doorsBack") => {
    const g = currentDoors(a);
    const cur = (Array.isArray(a[key]) ? (a[key] as number[]) : g[key]).slice();
    cur.push(key === "doorsBack" ? (cur.length % 2 === 0 ? 0.1 : 0.9) : 0.55);
    updA({ [key]: cur } as Partial<AState>);
  };
  const removeDoor = (key: "doorsL" | "doorsR" | "doorsBack", idx: number) => {
    const g = currentDoors(a);
    const cur = (Array.isArray(a[key]) ? (a[key] as number[]) : g[key]).slice();
    cur.splice(idx, 1);
    updA({ [key]: cur } as Partial<AState>);
  };
  const resetHouse = () => updA({ houseHalfFt: null, doorsL: null, doorsR: null, doorsBack: null });

  // The wall/door drag maps the ABSOLUTE pointer position onto the plan
  // geometry (port of the prototype's 'house' drag), so the handlers can
  // safely close over the drag-start state: cx/ppf/bounds don't move.
  const dragCleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => dragCleanup.current?.(), []);
  const onHandleDown = (hd: PlanHandle, e: ReactPointerEvent<SVGGElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const svg = (e.currentTarget as SVGGElement).ownerSVGElement;
    if (!svg) return;
    const s = a;
    const kind = venueOf(s).kind;
    const G = kind === "church" ? churchGeom(s) : prosGeom(s);
    const move = (ev: globalThis.PointerEvent) => {
      const r = svg.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const sx = ((ev.clientX - r.left) / r.width) * G.W;
      const sy = ((ev.clientY - r.top) / r.height) * G.H;
      const patch = houseDragPatch(s, hd, sx, sy);
      if (patch) setA((prev) => ({ ...prev, ...patch }));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      dragCleanup.current = null;
    };
    dragCleanup.current = up;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  /* ------------------------------ view data ------------------------------ */

  const view: ViewKey = a.view || "estimate";
  const setView = (v: ViewKey) => updA({ view: v });

  const estRows = selSystems
    .filter((x) => x.on)
    .map((x) => {
      const rev = x.rev * (x.tierFixed ? 1 : selTd.priceMul);
      const share = selTot.matRev > 0 ? (rev / selTot.matRev) * 100 : 0;
      return { key: x.key, name: SHORT[x.key], rev, share, dot: x.dot };
    });

  const ovSel = (a.qtyOverrides && a.qtyOverrides[selKey]) || {};
  const bomGroups = selBase
    .filter((x) => x.on)
    .map((x) => {
      const so = ovSel[x.key] || {};
      let sub = 0;
      const rows = x.items.map((it) => {
        const hasOv = so[it.desc] != null;
        const qty = hasOv ? so[it.desc] : it.qty;
        const up = it.price * (x.tierFixed ? 1 : selTd.priceMul);
        const ext = up * qty;
        sub += ext;
        const upLabel = up > 0 && up < 10 ? "$" + up.toFixed(2) : moneyRound(up);
        return { desc: it.desc, unit: it.unit, qty, edited: hasOv, upLabel, ext };
      });
      return { key: x.key, name: x.name, dot: x.dot, sub, rows, open: !!bomOpen[x.key] };
    });
  const anyBomOpen = bomGroups.some((g) => g.open);
  const bomToggleAll = () => {
    if (anyBomOpen) setBomOpen({});
    else {
      const m: Record<string, boolean> = {};
      bomGroups.forEach((g) => {
        m[g.key] = true;
      });
      setBomOpen(m);
    }
  };

  const plan = useMemo(
    () => (view === "plan" && !manualNotice ? buildPlan(a, gridSets(a, tierDefs), C.electrics, accentHex) : null),
    [a, tierDefs, C.electrics, accentHex, view, manualNotice]
  );
  const riser = useMemo(() => buildRiser(a, C.dimmerRacks, C.lineSets, ACCENT_INK, ACCENT_SOFT), [a, C.dimmerRacks, C.lineSets]);

  const workspaceMaxW = !inputsOpen && !tierRailOpen ? "none" : "760px";

  /* ---- review banner meta ---- */

  const rbMeta: Record<string, { bg: string; bd: string; ink: string; icon: string; title: string }> = {
    none: { bg: "#f4f5f7", bd: "#e4e7ec", ink: "#5b616e", icon: "○", title: "Not submitted for review" },
    in_review: { bg: "#eef3fc", bd: "#d4ddf3", ink: "#3155a8", icon: "◴", title: "In review" },
    approved: { bg: "#ecf6f0", bd: "#cce9da", ink: "#1f7a52", icon: "✓", title: "Approved" },
    changes: { bg: "#fcefe9", bd: "#f0d6cd", ink: "#b4543a", icon: "↩", title: "Changes requested" },
  };
  const rmd = review ? rbMeta[review.state] || rbMeta.none : rbMeta.none;
  let rbSub = "";
  if (review) {
    if (review.state === "none") rbSub = "Submit this design for a reviewer’s approval.";
    else if (review.state === "in_review")
      rbSub = review.reviewer ? "With " + firstName(review.reviewer) + " for approval" : "In the shared queue — awaiting a reviewer";
    else if (review.state === "approved") rbSub = "Approved by " + firstName(review.decidedBy || review.reviewer || "");
    else rbSub = review.note ? "“" + review.note + "” — " + firstName(review.decidedBy || "") : "Returned by " + firstName(review.decidedBy || "");
  }
  const rbCanSubmit = !!(review && isOwner && (review.state === "none" || review.state === "changes"));
  const rbSubmitLabel = review && review.state === "changes" ? "Resubmit for review" : "Submit for review";
  const rbCanDecide = !!(review && canApprove && review.state === "in_review" && !isOwner);
  const rbCanClaim = !!(review && canApprove && review.state === "in_review" && !review.reviewer && !isOwner);
  const reviewerOptions = [{ value: "queue", label: "Shared queue (any reviewer)" }].concat(
    reviewerNames.filter((n) => n !== me && n !== dOwner).map((n) => ({ value: n, label: n }))
  );

  /* -------------------------------- render -------------------------------- */

  const segOn: CSSProperties = { fontFamily: UI, fontSize: 12.5, fontWeight: 600, padding: "7px 15px", borderRadius: 6, background: "#fff", color: "#16181d", border: "none", cursor: "pointer", boxShadow: "0 1px 2px rgba(0,0,0,.1)" };
  const segOff: CSSProperties = { fontFamily: UI, fontSize: 12.5, fontWeight: 500, padding: "7px 15px", borderRadius: 6, background: "transparent", color: "#9aa0ab", border: "none", cursor: "pointer" };
  const modeSeg = (on: boolean): CSSProperties => ({ fontFamily: UI, fontSize: 12, fontWeight: 600, padding: "7px 13px", borderRadius: 7, border: "none", cursor: "pointer", background: on ? "#16181d" : "transparent", color: on ? "#fff" : "#8c919c" });
  const chipStyle = (sel: boolean): CSSProperties => ({ flex: "1 1 auto", minWidth: 54, textAlign: "center", fontFamily: UI, fontSize: 11, fontWeight: 600, padding: "6px 6px", borderRadius: 7, cursor: "pointer", border: `1px solid ${sel ? ACCENT : "#e4e7ec"}`, background: sel ? ACCENT_SOFT : "#fff", color: sel ? ACCENT_INK : "#5b616e" });
  const collapseBtn: CSSProperties = { width: 24, height: 24, border: "1px solid #e4e7ec", background: "#fff", borderRadius: 7, color: "#9aa0ab", fontSize: 13, lineHeight: 1, cursor: "pointer", padding: 0, flexShrink: 0 };
  const stepBtn: CSSProperties = { width: 26, height: 26, border: "1px solid #e4e7ec", background: "#fff", borderRadius: 7, color: "#5b616e", fontSize: 16, lineHeight: 1, cursor: "pointer", padding: 0 };
  const doorBtn: CSSProperties = { fontFamily: UI, fontSize: 12, fontWeight: 600, color: ACCENT_INK, background: ACCENT_SOFT, border: "none", borderRadius: 7, padding: "6px 11px", cursor: "pointer" };
  const ghostDoorBtn: CSSProperties = { fontFamily: UI, fontSize: 12, fontWeight: 600, color: "#9aa0ab", background: "transparent", border: "1px solid #e4e7ec", borderRadius: 7, padding: "6px 11px", cursor: "pointer" };

  const manualMode = manualNotice;

  return (
    <div
      className="qd-root"
      style={{ height: "100%", display: "flex", flexDirection: "column", fontFamily: UI, color: "#16181d", background: "#f7f8fa", overflow: "hidden" }}
    >
      {/* ===== header ===== */}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, padding: "18px 28px 15px", borderBottom: "1px solid #ececf0", flexShrink: 0, background: "#fff" }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontFamily: MONO, fontSize: 9.5, fontWeight: 600, letterSpacing: ".08em", color: "#aab0bb", textTransform: "uppercase", marginBottom: 5 }}>
            Design · Sandbox
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 3, flexWrap: "wrap", marginLeft: -7, maxWidth: 640 }}>
            <input
              type="text"
              className="qd-name-input"
              value={designName || ""}
              placeholder={venue.label}
              onChange={(e) => setDesignName(e.target.value || null)}
              title="Name this design — the part after the dash updates automatically"
              style={{ fontFamily: UI, fontSize: 21, fontWeight: 600, letterSpacing: "-.015em", color: "#16181d", border: "none", background: "transparent", outline: "none", padding: "3px 7px", borderRadius: 7, flex: "0 1 auto", minWidth: 120, maxWidth: 340 }}
            />
            <span style={{ fontFamily: UI, fontSize: 18, fontWeight: 600, letterSpacing: "-.01em", color: "#aab0bb", whiteSpace: "nowrap", paddingBottom: 3 }}>
              — {suffix}
            </span>
          </div>
          <div style={{ fontSize: 13.5, color: "#8c919c", marginTop: 4 }}>
            Build and price a system freely — budgetary only until you add it to Quotes.
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, flexShrink: 0 }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: "#aab0bb", textTransform: "uppercase", letterSpacing: ".05em" }}>Linked customer</div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {customerMeta && <span style={{ fontFamily: MONO, fontSize: 11, color: "#9aa0ab", whiteSpace: "nowrap" }}>{customerMeta}</span>}
            <select
              className="qd-outline"
              value={linkedCustomer || ""}
              onChange={(e) => onLinkCustomer(e.target.value)}
              title="Link this design to a customer"
              style={{ fontFamily: UI, fontSize: 13, fontWeight: 600, color: "#16181d", background: "#fff", border: "1px solid #e4e7ec", borderRadius: 8, padding: "8px 11px", cursor: "pointer", maxWidth: 250 }}
            >
              <option value="">No customer linked</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            {showVenuePick && (
              <select
                className="qd-outline"
                value={linkedLocation || ""}
                onChange={(e) => setLinkedLocation(e.target.value || null)}
                title="Which venue at this customer"
                style={{ fontFamily: UI, fontSize: 13, fontWeight: 600, color: "#16181d", background: "#fff", border: "1px solid #e4e7ec", borderRadius: 8, padding: "8px 11px", cursor: "pointer", maxWidth: 210 }}
              >
                {(linkedCustomerObj ? linkedCustomerObj.locations : []).map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.label + (l.city ? " · " + l.city : "")}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>
      </div>

      {/* ===== body ===== */}
      <div className="qd-body" style={{ flex: 1, display: "flex", minHeight: 0 }}>
        {/* ---- inputs ---- */}
        {inputsOpen ? (
          <div className="qd-scroll qd-inputs" style={{ width: 360, flexShrink: 0, borderRight: "1px solid #ececf0", overflowY: "auto", padding: "20px 22px", background: "#fbfbfc" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 17 }}>
              <div style={{ ...secLabel, fontWeight: 700 }}>Design inputs</div>
              <button className="qd-ghostbtn" onClick={() => setInputsOpen(false)} title="Collapse inputs for a bigger preview" style={collapseBtn}>
                ‹
              </button>
            </div>

            {/* venue type */}
            <button onClick={() => setSec({ ...sec, venue: !sec.venue })} title="Show/hide" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, width: "100%", background: "transparent", border: "none", cursor: "pointer", padding: 0, marginBottom: 10 }}>
              <span style={secLabel}>Venue type</span>
              <span style={{ display: "inline-block", fontSize: 14, color: "#aab0bb", lineHeight: 1, transition: "transform .15s", transform: sec.venue ? "rotate(90deg)" : "rotate(0deg)" }}>›</span>
            </button>
            {sec.venue && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9, marginBottom: 22 }}>
                {VENUES.map((v) => {
                  const on = v.key === a.venue;
                  return (
                    <button key={v.key} onClick={() => setVenue(v.key)} style={{ display: "flex", flexDirection: "column", gap: 2, textAlign: "left", padding: "11px 12px", borderRadius: 10, cursor: "pointer", background: on ? ACCENT_SOFT : "#fff", border: `1.5px solid ${on ? ACCENT : "#e8eaee"}` }}>
                      <span style={{ fontSize: 13.5, fontWeight: 600, color: "#16181d" }}>{v.label}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* size */}
            <button onClick={() => setSec({ ...sec, size: !sec.size })} title="Show/hide" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, width: "100%", background: "transparent", border: "none", cursor: "pointer", padding: 0, marginBottom: 10 }}>
              <span style={secLabel}>Size of venue</span>
              <span style={{ display: "inline-block", fontSize: 14, color: "#aab0bb", lineHeight: 1, transition: "transform .15s", transform: sec.size ? "rotate(90deg)" : "rotate(0deg)" }}>›</span>
            </button>
            {sec.size && (
              <div style={{ display: "flex", gap: 9, marginBottom: 22 }}>
                {SIZES.map(([key, label]) => {
                  const on = key === a.size;
                  return (
                    <button key={key} onClick={() => updA({ size: key })} style={{ flex: 1, textAlign: "center", fontSize: 13, fontWeight: 600, padding: "10px 8px", borderRadius: 10, cursor: "pointer", background: on ? ACCENT_SOFT : "#fff", border: `1.5px solid ${on ? ACCENT : "#e8eaee"}`, color: on ? ACCENT_INK : "#5b616e", fontFamily: UI }}>
                      {label}
                    </button>
                  );
                })}
              </div>
            )}

            {/* dims */}
            <button onClick={() => setSec({ ...sec, dims: !sec.dims })} title="Show/hide" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, width: "100%", background: "transparent", border: "none", cursor: "pointer", padding: 0, marginBottom: 11 }}>
              <span style={secLabel}>Stage dimensions</span>
              <span style={{ display: "inline-block", fontSize: 14, color: "#aab0bb", lineHeight: 1, transition: "transform .15s", transform: sec.dims ? "rotate(90deg)" : "rotate(0deg)" }}>›</span>
            </button>
            {sec.dims && (
              <div style={{ display: "flex", flexDirection: "column", gap: 15, marginBottom: 22 }}>
                {(DIMSCHEMA[venue.kind] || DIMSCHEMA.proscenium).map((d) => (
                  <div key={d.field}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 7 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>{d.label}</div>
                        <div style={{ fontSize: 11, color: "#aab0bb" }}>{d.note}</div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 7, flexShrink: 0 }}>
                        <button onClick={() => stepDim(d.field, -1)} style={stepBtn}>–</button>
                        <span style={{ fontFamily: MONO, fontSize: 14.5, fontWeight: 600, minWidth: 52, textAlign: "center" }}>{a[d.field]} ft</span>
                        <button onClick={() => stepDim(d.field, 1)} style={stepBtn}>+</button>
                      </div>
                    </div>
                    <input type="range" min={LIM[d.field][0]} max={LIM[d.field][1]} step={2} value={a[d.field]} onChange={(e) => setDimVal(d.field, e.target.value)} style={{ width: "100%", accentColor: accentHex, cursor: "pointer" }} />
                  </div>
                ))}
              </div>
            )}

            {/* systems */}
            <button onClick={() => setSec({ ...sec, systems: !sec.systems })} title="Show/hide" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, width: "100%", background: "transparent", border: "none", cursor: "pointer", padding: 0, marginBottom: 11 }}>
              <span style={secLabel}>Systems to include</span>
              <span style={{ display: "inline-block", fontSize: 14, color: "#aab0bb", lineHeight: 1, transition: "transform .15s", transform: sec.systems ? "rotate(90deg)" : "rotate(0deg)" }}>›</span>
            </button>
            {sec.systems && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {C.systems.map((sys) => {
                  const on = sys.on;
                  const cfg = SUBCFG[sys.key];
                  let chips: Array<{ label: string; sel: boolean; onClick: () => void }> = [];
                  let sub: string = SYSSUB[sys.key];
                  if (cfg) {
                    if (cfg.mode === "single") {
                      const cur = (a as unknown as Record<string, string>)[cfg.stateKey];
                      chips = cfg.options.map(([v, l]) => ({ label: l, sel: cur === v, onClick: () => setSingle(cfg.stateKey, v) }));
                      const f = cfg.options.find((o) => o[0] === cur);
                      if (f) sub = f[1];
                    } else {
                      const obj = ((a as unknown as Record<string, Record<string, boolean>>)[cfg.stateKey] || {}) as Record<string, boolean>;
                      chips = cfg.options.map(([v, l]) => ({ label: l, sel: !!obj[v], onClick: () => toggleMulti(cfg.stateKey, v) }));
                      const picked = cfg.options.filter(([v]) => obj[v]).map(([, l]) => l);
                      sub = picked.length ? picked.join(" · ") : "Select options";
                    }
                  }
                  return (
                    <div key={sys.key} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <button onClick={() => toggleSys(sys.key)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, width: "100%", padding: "11px 13px", borderRadius: 10, cursor: "pointer", background: on ? "#fff" : "#f7f8fa", border: `1px solid ${on ? "#e8eaee" : "#eef0f3"}` }}>
                        <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                          <span style={{ width: 9, height: 9, borderRadius: "50%", flexShrink: 0, background: on ? sys.dot : "#d6d9e0" }} />
                          <span style={{ textAlign: "left", minWidth: 0 }}>
                            <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#16181d" }}>{sys.name}</span>
                            <span style={{ display: "block", fontSize: 11, color: "#9aa0ab" }}>{sub}</span>
                          </span>
                        </span>
                        <span style={{ position: "relative", width: 36, height: 20, borderRadius: 999, flexShrink: 0, transition: "background .15s", background: on ? ACCENT : "#d6d9e0" }}>
                          <span style={{ position: "absolute", top: 2, left: on ? 18 : 2, width: 16, height: 16, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 2px rgba(0,0,0,.25)", transition: "left .15s" }} />
                        </span>
                      </button>
                      {on && chips.length > 0 && (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "1px 2px 3px" }}>
                          {chips.map((ch) => (
                            <button key={ch.label} onClick={ch.onClick} style={chipStyle(ch.sel)}>
                              {ch.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          <div className="qd-siderail" style={{ width: 46, flexShrink: 0, borderRight: "1px solid #ececf0", background: "#fbfbfc", display: "flex", flexDirection: "column", alignItems: "center", padding: "16px 0", gap: 14 }}>
            <button className="qd-ghostbtn" onClick={() => setInputsOpen(true)} title="Show design inputs" style={{ ...collapseBtn, width: 26, height: 26, color: "#5b616e", fontSize: 14 }}>
              ›
            </button>
            <span style={{ writingMode: "vertical-rl", fontSize: 10.5, fontWeight: 600, color: "#9aa0ab", letterSpacing: ".08em", textTransform: "uppercase" }}>Design inputs</span>
          </div>
        )}

        {/* ---- preview ---- */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "16px 28px 0", flexShrink: 0, flexWrap: "wrap", rowGap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7, background: "#eceef1", borderRadius: 9, padding: 3 }} title="How this design is estimated">
                <button onClick={() => setManualNotice(false)} style={modeSeg(!manualMode)}>Auto estimate</button>
                <button onClick={() => setManualNotice(true)} style={modeSeg(manualMode)}>Manual layout</button>
              </div>
              {!manualMode && (
                <div style={{ display: "flex", background: "#f1f2f5", borderRadius: 9, padding: 3 }}>
                  {([["estimate", "Estimate"], ["bom", "BOM"], ["plan", "Plan"], ["schedule", "Schedule"], ["riser", "Control riser"]] as Array<[ViewKey, string]>).map(([key, label]) => (
                    <button key={key} onClick={() => setView(key)} style={view === key ? segOn : segOff}>
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div style={{ fontFamily: MONO, fontSize: 12, color: "#aab0bb" }}>
              {venue.label} · {a.width}&apos; × {a.depth}&apos; × {a.grid}&apos;
            </div>
          </div>

          <div className="qd-scroll qd-pvscroll" style={{ flex: 1, overflowY: "auto", padding: "20px 28px 8px", minHeight: 0 }}>
            <div style={{ maxWidth: workspaceMaxW }}>
              {/* ===== deferred manual-layout editor ===== */}
              {manualMode && (
                <div style={{ background: ACCENT_SOFT, border: `1.5px dashed ${ACCENT}`, borderRadius: 13, padding: "46px 28px", textAlign: "center" }}>
                  <div style={{ fontFamily: MONO, fontSize: 9.5, fontWeight: 600, letterSpacing: ".08em", color: ACCENT_INK, textTransform: "uppercase", marginBottom: 10 }}>
                    Manual layout · Plan drawing
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 600 }}>Plan drawing editor arrives with the spatial-estimating work</div>
                  <div style={{ fontSize: 12.5, color: "#5b616e", lineHeight: 1.6, maxWidth: 440, margin: "8px auto 0" }}>
                    Drag-and-drop placement, imported floor plans, and the lineset schedule land together with spatial estimating.
                    Auto estimate keeps every number live from the equations in the meantime.
                  </div>
                  <button onClick={() => setManualNotice(false)} style={{ marginTop: 18, fontFamily: UI, fontSize: 13, fontWeight: 600, color: "#fff", background: ACCENT, border: "none", borderRadius: 9, padding: "11px 18px", cursor: "pointer" }}>
                    Back to auto estimate
                  </button>
                </div>
              )}

              {/* ===== ESTIMATE ===== */}
              {!manualMode && view === "estimate" && (
                <div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 20 }}>
                    {tierCards.map(({ td, tot }) => {
                      const on = td.key === selKey;
                      return (
                        <button key={td.key} onClick={() => updA({ tier: td.key })} style={{ display: "flex", flexDirection: "column", textAlign: "left", padding: "13px 14px", borderRadius: 12, cursor: "pointer", background: on ? ACCENT_SOFT : "#fff", border: `1.5px solid ${on ? ACCENT : "#e8eaee"}`, boxShadow: on ? `0 1px 3px ${ACCENT_SOFT}` : undefined, fontFamily: UI }}>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, minHeight: 18 }}>
                            <span style={{ fontSize: 13, fontWeight: 700, color: on ? ACCENT_INK : "#16181d" }}>{td.label}</span>
                            {td.key === "better" && (
                              <span style={{ fontSize: 9, fontWeight: 700, color: "#fff", background: ACCENT, padding: "2px 7px", borderRadius: 5, textTransform: "uppercase", letterSpacing: ".04em" }}>Pick</span>
                            )}
                          </div>
                          <div style={{ fontFamily: MONO, fontSize: 20, fontWeight: 600, marginTop: 9, letterSpacing: "-.01em" }}>{moneyRound(tot.grand)}</div>
                          <div style={{ fontSize: 10.5, color: "#9aa0ab", marginTop: 4, lineHeight: 1.35 }}>
                            {(tierDefs[td.key] && tierDefs[td.key].blurb) || td.spec}
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  <div style={{ fontSize: 10.5, fontWeight: 600, color: "#9aa0ab", letterSpacing: ".06em", textTransform: "uppercase", marginBottom: 2 }}>
                    {selTd.label} price · by system
                  </div>
                  {estRows.map((r) => (
                    <div key={r.key} style={{ padding: "12px 0", borderBottom: "1px solid #f3f4f7" }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                        <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                          <span style={{ width: 9, height: 9, borderRadius: "50%", flexShrink: 0, background: r.dot }} />
                          <span style={{ minWidth: 0 }}>
                            <span style={{ display: "block", fontSize: 13.5, fontWeight: 600, color: "#16181d" }}>{r.name}</span>
                          </span>
                        </span>
                        <span style={{ fontFamily: MONO, fontSize: 14, fontWeight: 600, color: "#16181d", flexShrink: 0 }}>{moneyRound(r.rev)}</span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 9 }}>
                        <div style={{ flex: 1, height: 5, background: "#f1f2f5", borderRadius: 999, overflow: "hidden" }}>
                          <div style={{ height: "100%", borderRadius: 999, width: `${Math.max(2, Math.round(r.share))}%`, background: r.dot }} />
                        </div>
                        <span style={{ fontFamily: MONO, fontSize: 10.5, color: "#aab0bb", minWidth: 80, textAlign: "right" }}>{Math.round(r.share)}% of total</span>
                      </div>
                    </div>
                  ))}

                  <div style={{ marginTop: 16, padding: "16px 17px", background: "#fbfbfc", border: "1px solid #f0f1f4", borderRadius: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 8 }}>
                      <span style={{ color: "#5b616e" }}>Materials &amp; equipment</span>
                      <span style={{ fontFamily: MONO, fontWeight: 500 }}>{moneyRound(selTot.matRev)}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 8 }}>
                      <span style={{ color: "#5b616e" }}>Installation &amp; commissioning</span>
                      <span style={{ fontFamily: MONO, fontWeight: 500 }}>{moneyRound(selTot.install)}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 11 }}>
                      <span style={{ color: "#5b616e" }}>Freight &amp; delivery</span>
                      <span style={{ fontFamily: MONO, fontWeight: 500 }}>{moneyRound(selTot.freight)}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, marginBottom: 13, paddingTop: 11, borderTop: "1px solid #f0f1f4" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 11, flex: 1, minWidth: 0 }}>
                        <span style={{ color: "#5b616e", fontSize: 13, whiteSpace: "nowrap" }}>Contingency</span>
                        <input type="range" min={0} max={25} step={1} value={a.contingency ?? 0} onChange={(e) => setContingency(e.target.value)} style={{ flex: 1, maxWidth: 200, accentColor: accentHex, cursor: "pointer" }} />
                        <span style={{ fontFamily: MONO, fontSize: 12.5, fontWeight: 600, color: ACCENT_INK, minWidth: 34 }}>{a.contingency ?? 0}%</span>
                      </div>
                      <span style={{ fontFamily: MONO, fontWeight: 500, fontSize: 13, flexShrink: 0 }}>{moneyRound(selTot.contingency)}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "#16181d", color: "#fff", borderRadius: 9, padding: "13px 16px" }}>
                      <span style={{ fontSize: 13.5, fontWeight: 600 }}>{selTd.label} total</span>
                      <span style={{ fontFamily: MONO, fontSize: 19, fontWeight: 600 }}>{moneyRound(selTot.grand)}</span>
                    </div>
                    <div style={{ fontSize: 11, color: "#aab0bb", marginTop: 10, lineHeight: 1.5 }}>
                      {selTd.label} tier combines {selSystems.filter((x) => x.on).length} systems. Good / Better / Best swap the spec on every line — open in the Estimator to lock pricing against live catalog books.
                    </div>
                  </div>
                </div>
              )}

              {/* ===== BOM ===== */}
              {!manualMode && view === "bom" && (
                <div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 13 }}>
                    <div style={{ fontSize: 12, color: "#8c919c" }}>{bomGroups.length} systems · open a system to see its line items</div>
                    <button onClick={bomToggleAll} style={{ fontFamily: UI, fontSize: 12, fontWeight: 600, color: ACCENT_INK, background: "transparent", border: "none", cursor: "pointer", padding: "4px 2px" }}>
                      {anyBomOpen ? "Collapse all" : "Expand all"}
                    </button>
                  </div>
                  {bomGroups.map((g) => (
                    <div key={g.key} style={{ marginBottom: 14, border: "1px solid #f0f1f4", borderRadius: 12, overflow: "hidden" }}>
                      <button onClick={() => setBomOpen({ ...bomOpen, [g.key]: !bomOpen[g.key] })} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, width: "100%", padding: "11px 16px", background: "#fbfbfc", border: "none", borderBottom: "1px solid #f0f1f4", cursor: "pointer", textAlign: "left", fontFamily: UI }}>
                        <span style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
                          <span style={{ display: "inline-block", fontSize: 14, color: "#aab0bb", lineHeight: 1, transition: "transform .15s", transform: g.open ? "rotate(90deg)" : "rotate(0deg)", flexShrink: 0 }}>›</span>
                          <span style={{ width: 9, height: 9, borderRadius: "50%", flexShrink: 0, background: g.dot }} />
                          <span style={{ fontSize: 13.5, fontWeight: 600, color: "#16181d" }}>{g.name}</span>
                          <span style={{ fontSize: 11, color: "#aab0bb", whiteSpace: "nowrap" }}>{g.rows.length} line items</span>
                        </span>
                        <span style={{ fontFamily: MONO, fontSize: 13, fontWeight: 600, color: "#16181d" }}>{moneyRound(g.sub)}</span>
                      </button>
                      {g.open && (
                        <>
                          <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 124px 88px 92px", gap: 8, padding: "7px 16px", fontSize: 9.5, fontWeight: 600, color: "#aab0bb", textTransform: "uppercase", letterSpacing: ".04em", borderBottom: "1px solid #f3f4f7" }}>
                            <span>Item</span>
                            <span style={{ textAlign: "right" }}>Qty</span>
                            <span style={{ textAlign: "right" }}>Unit price</span>
                            <span style={{ textAlign: "right" }}>Ext.</span>
                          </div>
                          {g.rows.map((it) => (
                            <div key={it.desc} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 124px 88px 92px", gap: 8, padding: "9px 16px", fontSize: 12.5, alignItems: "center", borderBottom: "1px solid #f5f6f8" }}>
                              <span style={{ lineHeight: 1.3 }}>{it.desc}</span>
                              <span style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 5 }}>
                                <input
                                  type="number"
                                  min={0}
                                  value={it.qty}
                                  onChange={(e) => setQtyOverride(selKey, g.key, it.desc, e.target.value)}
                                  style={{ width: 54, fontFamily: MONO, fontSize: 12, textAlign: "right", color: "#16181d", background: "#fff", border: `1px solid ${it.edited ? accentHex : "#e4e7ec"}`, borderRadius: 6, padding: "4px 6px", outline: "none" }}
                                />
                                <span style={{ fontFamily: MONO, fontSize: 10, color: "#aab0bb", minWidth: 22 }}>{it.unit}</span>
                                {it.edited && (
                                  <button onClick={() => resetQtyOverride(selKey, g.key, it.desc)} title="Reset to calculated quantity" style={{ border: "none", background: "transparent", color: ACCENT_INK, fontSize: 13, lineHeight: 1, cursor: "pointer", padding: 0 }}>
                                    ↺
                                  </button>
                                )}
                              </span>
                              <span style={{ fontFamily: MONO, textAlign: "right", color: "#5b616e" }}>{it.upLabel}</span>
                              <span style={{ fontFamily: MONO, textAlign: "right", fontWeight: 600 }}>{moneyRound(it.ext)}</span>
                            </div>
                          ))}
                        </>
                      )}
                    </div>
                  ))}
                  <div style={{ fontSize: 11, color: "#aab0bb", lineHeight: 1.5, marginTop: 4 }}>
                    {selTd.label} tier · materials only. Installation, freight, and contingency are applied on the Estimate tab. Edit any quantity above — changes save per tier and roll up to the totals.
                  </div>
                </div>
              )}

              {/* ===== PLAN (auto) ===== */}
              {!manualMode && view === "plan" && plan && (
                <div>
                  <div style={{ background: "#fbfbfc", border: "1px solid #f0f1f4", borderRadius: 12, padding: 18 }}>
                    {plan.isHouse && (
                      <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap", marginBottom: 14, paddingBottom: 13, borderBottom: "1px solid #f0f1f4" }}>
                        <span style={{ fontSize: 10, fontWeight: 700, color: "#9aa0ab", letterSpacing: ".05em", textTransform: "uppercase", marginRight: 2 }}>Doors</span>
                        <button onClick={() => addDoor("doorsL")} style={doorBtn}>+ Left wall</button>
                        <button onClick={() => addDoor("doorsR")} style={doorBtn}>+ Right wall</button>
                        <button onClick={() => addDoor("doorsBack")} style={doorBtn}>+ Rear wall</button>
                        <span style={{ flex: 1 }} />
                        <button onClick={resetHouse} title="Reset walls & doors to defaults" style={ghostDoorBtn}>Reset house</button>
                      </div>
                    )}
                    <PlanSvg plan={plan} accent={accentHex} interactive onHandleDown={onHandleDown} onRemoveDoor={removeDoor} svgId="qd-autoplan-svg" />
                    <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap", marginTop: 13, fontSize: 11, color: "#8c919c" }}>
                      {(plan.legend || []).map((lg, i) => (
                        <span key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={lg.sw} />
                          {lg.label}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div style={{ fontSize: 11, color: "#9aa0ab", lineHeight: 1.5, marginTop: 15 }}>
                    Calculated from your stage dimensions — adjust the sliders on the left and these update live. On stage-and-audience plans, drag the accent handles to slide the house walls outward or move a doorway along the wall.
                  </div>
                </div>
              )}

              {/* ===== SCHEDULE (empty state — generation opens the deferred editor) ===== */}
              {!manualMode && view === "schedule" && (
                <div>
                  <div style={{ background: "#fbfbfc", border: "1px dashed #d6d9e0", borderRadius: 12, padding: "40px 24px", textAlign: "center" }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "#5b616e", marginBottom: 6 }}>No flown items yet</div>
                    <div style={{ fontSize: 12.5, color: "#9aa0ab", lineHeight: 1.6, maxWidth: 400, margin: "0 auto 16px" }}>
                      Generate a lineset schedule from the equation estimate. Line-set count follows the Good · Better · Best slider; you can then edit each item&apos;s distance from the plaster line and it moves on the plan.
                    </div>
                    <button onClick={() => setManualNotice(true)} style={{ fontFamily: UI, fontSize: 13, fontWeight: 600, color: "#fff", background: ACCENT, border: "none", borderRadius: 9, padding: "11px 18px", cursor: "pointer" }}>
                      Generate schedule from equations
                    </button>
                  </div>
                </div>
              )}

              {/* ===== RISER ===== */}
              {!manualMode && view === "riser" && (
                <div>
                  {riser.empty ? (
                    <div style={{ background: "#fbfbfc", border: "1px dashed #d6d9e0", borderRadius: 12, padding: "40px 20px", textAlign: "center", color: "#9aa0ab", fontSize: 13, lineHeight: 1.6 }}>
                      No powered systems selected.
                      <br />
                      Turn on <b style={{ color: "#5b616e" }}>Fixtures</b>, <b style={{ color: "#5b616e" }}>Audio</b>, <b style={{ color: "#5b616e" }}>Video</b>, <b style={{ color: "#5b616e" }}>Controls</b>, or motorized rigging to generate a control riser.
                    </div>
                  ) : (
                    <div style={{ background: "#fbfbfc", border: "1px solid #f0f1f4", borderRadius: 12, padding: 18 }}>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                        {riser.nodes.map((n, i) => (
                          <div key={i} style={{ display: "contents" }}>
                            {n.connector && <span style={{ width: 2, height: 14, background: "#d6d9e0" }} />}
                            <div style={{ width: 360, maxWidth: "100%", border: "1px solid #ececf0", borderLeft: `4px solid ${n.tone}`, background: n.tint, borderRadius: 10, padding: "12px 15px" }}>
                              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                                <span style={{ fontSize: 13, fontWeight: 600, color: "#16181d" }}>{n.label}</span>
                                <span style={{ fontFamily: MONO, fontSize: 9.5, fontWeight: 600, color: n.tone, background: n.tint, padding: "2px 7px", borderRadius: 5, flexShrink: 0 }}>{n.tag}</span>
                              </div>
                              <div style={{ fontSize: 11, color: "#9aa0ab", marginTop: 2 }}>{n.sub}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                      {riser.estop && (
                        <div style={{ marginTop: 14, display: "flex", justifyContent: "center" }}>
                          <div style={{ width: 360, maxWidth: "100%", display: "flex", alignItems: "center", gap: 8, fontSize: 11.5, color: "#b4543a", background: "#f9ece8", border: "1px solid #f0d6cd", borderRadius: 9, padding: "9px 12px" }}>
                            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#b4543a", flexShrink: 0 }} />
                            E-stop loop — console to every drive, hardwired &amp; monitored.
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* ---- review banner ---- */}
          {designRec && review && (
            <div style={{ display: "flex", alignItems: "center", gap: 13, flexWrap: "wrap", rowGap: 10, padding: "11px 28px", background: rmd.bg, borderTop: `1px solid ${rmd.bd}`, flexShrink: 0 }}>
              <span style={{ width: 26, height: 26, borderRadius: "50%", background: "#fff", border: `1px solid ${rmd.bd}`, color: rmd.ink, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0 }}>{rmd.icon}</span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: rmd.ink }}>{rmd.title}</div>
                <div style={{ fontSize: 12, color: "#5b616e", marginTop: 1 }}>{rbSub}</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
                {rbCanSubmit && (
                  <>
                    <select value={reviewerSel} onChange={(e) => setReviewerSel(e.target.value)} style={{ fontFamily: UI, fontSize: 12.5, fontWeight: 600, color: "#3a3f4a", background: "#fff", border: "1px solid #e4e7ec", borderRadius: 8, padding: "8px 11px", cursor: "pointer" }}>
                      {reviewerOptions.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    <button onClick={onSubmitReview} style={{ fontSize: 12.5, fontWeight: 600, color: "#fff", background: "#3155a8", border: "none", borderRadius: 8, padding: "9px 15px", cursor: "pointer", fontFamily: UI }}>
                      {rbSubmitLabel}
                    </button>
                  </>
                )}
                {rbCanClaim && (
                  <button onClick={onClaimReview} style={{ fontSize: 12.5, fontWeight: 600, color: "#3155a8", background: "#e9eefb", border: "1px solid #d4ddf3", borderRadius: 8, padding: "8px 13px", cursor: "pointer", fontFamily: UI }}>
                    Claim review
                  </button>
                )}
                {rbCanDecide && (
                  <>
                    <button onClick={() => { setRcOpen(true); setRcNote(""); }} style={{ fontSize: 12.5, fontWeight: 600, color: "#b4543a", background: "#f9ece8", border: "1px solid #f0d6cd", borderRadius: 8, padding: "8px 13px", cursor: "pointer", fontFamily: UI }}>
                      Request changes
                    </button>
                    <button onClick={onApproveReview} style={{ fontSize: 12.5, fontWeight: 600, color: "#fff", background: "#1f7a52", border: "none", borderRadius: 8, padding: "9px 15px", cursor: "pointer", fontFamily: UI }}>
                      Approve
                    </button>
                  </>
                )}
              </div>
            </div>
          )}

          {/* ---- footer CTA ---- */}
          <div className="qd-foot" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "15px 28px", borderTop: "1px solid #ececf0", flexShrink: 0, background: "#fff" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
              <button onClick={onSaveDesign} style={{ fontFamily: UI, fontSize: 13, fontWeight: 600, color: "#5b616e", background: "#f1f2f5", border: "none", borderRadius: 9, padding: "11px 17px", cursor: "pointer" }}>
                {designId ? "Update design" : "Save design"}
              </button>
              <button onClick={onSaveRevision} title="Snapshot this design as a tracked revision" style={{ display: "flex", alignItems: "center", gap: 7, fontFamily: UI, fontSize: 13, fontWeight: 600, color: ACCENT_INK, background: ACCENT_SOFT, border: `1px solid ${ACCENT_SOFT}`, borderRadius: 9, padding: "11px 15px", cursor: "pointer" }}>
                <span style={{ fontSize: 14, lineHeight: 1 }}>⎘</span> Save revision
              </button>
              {revisions.length > 0 && (
                <button onClick={() => setRevOpen(true)} title="View revision history" style={{ fontFamily: UI, fontSize: 13, fontWeight: 600, color: "#5b616e", background: "transparent", border: "none", borderRadius: 9, padding: "11px 6px", cursor: "pointer" }}>
                  Revisions · {revisions.length}
                </button>
              )}
            </div>
            <button onClick={onAddToQuotes} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, fontFamily: UI, fontSize: 13.5, fontWeight: 600, color: "#fff", background: ACCENT, padding: "12px 20px", borderRadius: 9, border: "none", cursor: "pointer" }}>
              Add to Quotes <span style={{ fontSize: 15 }}>→</span>
            </button>
          </div>
        </div>

        {/* ---- tier definitions rail ---- */}
        {tierRailOpen ? (
          <div className="qd-scroll qd-tierbar" style={{ width: 320, flexShrink: 0, borderLeft: "1px solid #ececf0", overflowY: "auto", padding: "20px 20px", background: "#fbfbfc" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 4 }}>
              <div style={secLabel}>Tier definitions</div>
              <button className="qd-ghostbtn" onClick={() => setTierRailOpen(false)} title="Collapse panel" style={collapseBtn}>›</button>
            </div>
            <div style={{ fontSize: 12.5, color: "#9aa0ab", lineHeight: 1.45, marginBottom: 15 }}>
              Define what Good · Better · Best mean for each system. Applies to every estimate.
            </div>

            <div style={{ display: "flex", gap: 7, marginBottom: 18 }}>
              {TIERS.map((td) => {
                const on = td.key === selKey;
                return (
                  <button key={td.key} onClick={() => updA({ tier: td.key })} style={{ flex: 1, textAlign: "center", fontFamily: UI, fontSize: 12.5, fontWeight: 600, padding: "9px 6px", borderRadius: 8, cursor: "pointer", border: `1.5px solid ${on ? ACCENT : "#e8eaee"}`, background: on ? ACCENT_SOFT : "#fff", color: on ? ACCENT_INK : "#5b616e" }}>
                    {td.label}
                  </button>
                );
              })}
            </div>

            <div style={{ fontSize: 10.5, fontWeight: 600, color: "#9aa0ab", letterSpacing: ".05em", textTransform: "uppercase", marginBottom: 7 }}>
              {selTd.label} — summary
            </div>
            <textarea
              className="qd-focus-accent"
              value={(tierDefs[selKey] && tierDefs[selKey].blurb) || ""}
              onChange={(e) => setTierBlurb(selKey, e.target.value)}
              rows={2}
              placeholder="One-line summary of this tier"
              style={{ width: "100%", fontFamily: UI, fontSize: 12.5, lineHeight: 1.4, color: "#16181d", background: "#fff", border: "1px solid #e4e7ec", borderRadius: 9, padding: "9px 11px", outline: "none", resize: "vertical" }}
            />

            <div style={{ fontSize: 10.5, fontWeight: 600, color: "#9aa0ab", letterSpacing: ".05em", textTransform: "uppercase", margin: "19px 0 11px" }}>
              {selTd.label} spec · by system
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {(Object.keys(SHORT) as SysKey[]).map((key) => {
                const included = !!a.sys[key];
                const baseSets = rigSetsFor(a) || 1;
                const tdActive = tierDefs[selKey] || tierDefsDefault()[selKey];
                const setsVal = tdActive.sets != null ? tdActive.sets : baseSets;
                const loBound = Math.max(2, Math.round(baseSets * 0.4));
                const setsMin = Math.min(setsVal, loBound);
                const setsMax = Math.max(setsVal, loBound + 6, Math.round(baseSets * 2.5));
                const fabricDefs: Array<[string, string]> = [["draw", "Draw"], ["legs", "Legs"], ["border", "Border"], ["fullstage", "Full Stage"]];
                return (
                  <div key={key}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
                      <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                        <span style={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0, background: included ? ACCENT : "#d6d9e0" }} />
                        <span style={{ fontSize: 13, fontWeight: 600, color: "#16181d" }}>{SHORT[key]}</span>
                      </span>
                      <span style={{ fontFamily: MONO, fontSize: 9, fontWeight: 600, color: included ? ACCENT_INK : "#aab0bb", background: included ? ACCENT_SOFT : "#f1f2f5", padding: "2px 7px", borderRadius: 5, flexShrink: 0, whiteSpace: "nowrap" }}>
                        {included ? "In design" : "Off"}
                      </span>
                    </div>
                    <input
                      type="text"
                      className="qd-focus-accent"
                      value={(tierDefs[selKey] && tierDefs[selKey].specs[key]) || ""}
                      placeholder={"Define " + SHORT[key] + " spec…"}
                      onChange={(e) => setTierSpec(selKey, key, e.target.value)}
                      style={{ width: "100%", fontFamily: UI, fontSize: 12.5, color: "#16181d", background: "#fff", border: "1px solid #e4e7ec", borderRadius: 8, padding: "8px 10px", outline: "none" }}
                    />
                    {key === "rigging" && (
                      <div style={{ marginTop: 9, padding: "10px 11px", background: "#fff", border: "1px solid #e8eaee", borderRadius: 9 }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                          <span style={{ fontSize: 11, fontWeight: 600, color: "#5b616e" }}>Line sets</span>
                          <span style={{ fontFamily: MONO, fontSize: 13, fontWeight: 600, color: ACCENT_INK }}>{setsVal}</span>
                        </div>
                        <input type="range" min={setsMin} max={setsMax} step={1} value={setsVal} onChange={(e) => setTierSets(selKey, e.target.value)} style={{ width: "100%", accentColor: accentHex, cursor: "pointer" }} />
                        <div style={{ fontSize: 10.5, color: "#aab0bb", marginTop: 6, lineHeight: 1.4 }}>
                          Base {baseSets} sets from the rigging equation (size × depth). Scales the {selTd.label} rigging BOM and rolls up to the totals.
                        </div>
                      </div>
                    )}
                    {key === "curtains" && (
                      <div style={{ marginTop: 9, padding: "10px 11px", background: "#fff", border: "1px solid #e8eaee", borderRadius: 9, display: "flex", flexDirection: "column", gap: 9 }}>
                        <div style={{ fontSize: 10.5, fontWeight: 600, color: "#9aa0ab", letterSpacing: ".04em", textTransform: "uppercase" }}>Fabric type · from catalog</div>
                        {fabricDefs.map(([fk, label]) => (
                          <div key={fk} style={{ display: "grid", gridTemplateColumns: "62px 1fr", gap: 9, alignItems: "center" }}>
                            <span style={{ fontSize: 12, fontWeight: 600, color: "#5b616e" }}>{label}</span>
                            <select
                              value={(tierDefs[selKey].fabrics || {})[fk] || ""}
                              onChange={(e) => setTierFabric(selKey, fk, e.target.value)}
                              style={{ width: "100%", fontFamily: UI, fontSize: 11.5, color: "#16181d", background: "#fff", border: "1px solid #e4e7ec", borderRadius: 7, padding: "6px 8px", outline: "none", cursor: "pointer" }}
                            >
                              {fabrics.map((f) => (
                                <option key={f.sku} value={f.sku}>
                                  {f.desc + " · $" + (f.costPerSqft != null ? f.costPerSqft.toFixed(2) : "?") + "/ft²"}
                                </option>
                              ))}
                            </select>
                          </div>
                        ))}
                        <div style={{ fontSize: 10.5, color: "#aab0bb", lineHeight: 1.4 }}>
                          {selTd.label} curtain fabric drives material cost per ft² for Draw, Legs, Border &amp; Full Stage.
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="qd-siderail" style={{ width: 46, flexShrink: 0, borderLeft: "1px solid #ececf0", background: "#fbfbfc", display: "flex", flexDirection: "column", alignItems: "center", padding: "16px 0", gap: 14 }}>
            <button className="qd-ghostbtn" onClick={() => setTierRailOpen(true)} title="Show tier definitions" style={{ ...collapseBtn, width: 26, height: 26, color: "#5b616e", fontSize: 14 }}>
              ‹
            </button>
            <span style={{ writingMode: "vertical-rl", fontSize: 10.5, fontWeight: 600, color: "#9aa0ab", letterSpacing: ".08em", textTransform: "uppercase" }}>Tier definitions</span>
          </div>
        )}
      </div>

      {/* ===== saved toast ===== */}
      {savedToast && (
        <div style={{ position: "fixed", left: "50%", bottom: 20, transform: "translateX(-50%)", zIndex: 80, display: "flex", alignItems: "center", gap: 13, background: "#16181d", color: "#fff", borderRadius: 12, padding: "13px 16px", boxShadow: "0 12px 40px rgba(0,0,0,.3)", maxWidth: "92vw", fontFamily: UI }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#5fd29a", flexShrink: 0 }} />
          <span style={{ fontSize: 13, whiteSpace: "nowrap" }}>{toastMsg || "Saved to sandbox as " + (savedId || "")}</span>
          <Link href="/" style={{ fontSize: 13, fontWeight: 600, color: "#fff", textDecoration: "underline", whiteSpace: "nowrap" }}>
            View dashboard
          </Link>
          <button onClick={() => setSavedToast(false)} style={{ width: 24, height: 24, border: "none", background: "#2b2e35", borderRadius: 6, color: "#cfd3da", fontSize: 14, cursor: "pointer", flexShrink: 0 }}>
            ×
          </button>
        </div>
      )}

      {/* ===== request-changes modal ===== */}
      {rcOpen && (
        <div onClick={() => { setRcOpen(false); setRcNote(""); }} style={{ position: "fixed", inset: 0, background: "rgba(16,22,30,.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 28, zIndex: 90 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: 460, maxWidth: "100%", background: "#fff", borderRadius: 15, boxShadow: "0 24px 70px rgba(0,0,0,.34)", overflow: "hidden", color: "#16181d" }}>
            <div style={{ padding: "17px 22px", borderBottom: "1px solid #f0f1f4", fontSize: 16, fontWeight: 600 }}>Request changes</div>
            <div style={{ padding: "20px 22px" }}>
              <div style={{ fontSize: 12.5, color: "#5b616e", marginBottom: 11, lineHeight: 1.5 }}>
                Tell the designer what needs to change before this can be approved.
              </div>
              <textarea
                value={rcNote}
                onChange={(e) => setRcNote(e.target.value)}
                placeholder="e.g. Trim the grid height and re-check the budgetary fixture count."
                style={{ width: "100%", minHeight: 96, border: "1px solid #e4e7ec", borderRadius: 9, padding: "11px 13px", fontSize: 13.5, fontFamily: UI, resize: "vertical", outline: "none" }}
              />
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 9, padding: "14px 22px", borderTop: "1px solid #f0f1f4" }}>
              <button onClick={() => { setRcOpen(false); setRcNote(""); }} style={{ fontSize: 13, fontWeight: 600, color: "#5b616e", background: "transparent", border: "none", cursor: "pointer", padding: "10px 12px", fontFamily: UI }}>
                Cancel
              </button>
              <button onClick={submitRc} style={{ fontSize: 13, fontWeight: 600, color: "#fff", background: "#b4543a", border: "none", borderRadius: 9, padding: "10px 18px", cursor: "pointer", fontFamily: UI }}>
                Send back for changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== revision history modal ===== */}
      {revOpen && (
        <div onClick={() => setRevOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(16,22,30,.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 28, zIndex: 90 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: 580, maxWidth: "100%", maxHeight: "80vh", display: "flex", flexDirection: "column", background: "#fff", borderRadius: 15, boxShadow: "0 24px 70px rgba(0,0,0,.34)", overflow: "hidden", color: "#16181d" }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, padding: "17px 22px", borderBottom: "1px solid #f0f1f4", flexShrink: 0 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 16, fontWeight: 600 }}>Revision history</div>
                <div style={{ fontSize: 12, color: "#9aa0ab", marginTop: 1 }}>Saved snapshots of this design — restore any point to keep iterating.</div>
              </div>
              <button onClick={() => setRevOpen(false)} style={{ width: 28, height: 28, border: "1px solid #e4e7ec", background: "#fff", borderRadius: 8, color: "#5b616e", fontSize: 16, lineHeight: 1, cursor: "pointer", flexShrink: 0 }}>
                ×
              </button>
            </div>
            <div className="qd-scroll" style={{ overflowY: "auto", padding: "6px 0" }}>
              {revisions.length === 0 ? (
                <div style={{ padding: "40px 22px", textAlign: "center", color: "#9aa0ab", fontSize: 13, lineHeight: 1.6 }}>
                  No revisions yet.
                  <br />
                  Use <b style={{ color: "#5b616e" }}>Save revision</b> to capture the current design.
                </div>
              ) : (
                revisions
                  .slice()
                  .reverse()
                  .map((r) => {
                    const tierLabel = (TIERS.find((t) => t.key === r.tier) || { label: (r.tier as string) || "" }).label;
                    const cname = typeof r.customer === "string" && r.customer ? " · " + r.customer : "";
                    return (
                      <div key={"v" + r.rev} style={{ display: "flex", alignItems: "center", gap: 13, padding: "12px 22px", borderBottom: "1px solid #f5f6f8" }}>
                        <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 600, color: "#fff", background: "#16181d", borderRadius: 6, padding: "4px 8px", flexShrink: 0 }}>v{r.rev}</span>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ fontSize: 13.5, fontWeight: 600, color: "#16181d", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {(r.name as string) || "Revision v" + r.rev}
                          </div>
                          <div style={{ fontSize: 11.5, color: "#9aa0ab" }}>
                            {tierLabel + cname} · {timeAgoMs(r.at)} · {firstName((r.by as string) || "")}
                          </div>
                        </div>
                        <span style={{ fontFamily: MONO, fontSize: 13, fontWeight: 600, color: "#16181d", flexShrink: 0 }}>{moneyRound((r.budget as number) || 0)}</span>
                        <button onClick={() => restoreRevision(r)} style={{ fontSize: 12.5, fontWeight: 600, color: ACCENT_INK, background: ACCENT_SOFT, border: "none", borderRadius: 8, padding: "8px 13px", cursor: "pointer", flexShrink: 0, fontFamily: UI }}>
                          Restore
                        </button>
                      </div>
                    );
                  })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
