"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import type {
  SurveyRecord,
  SurveyStage,
  MeasureGroup,
} from "@/lib/stores/surveys";
import { photoCountsBySection, type SketchRef, type SurveyPhotoRef } from "@/lib/field-files/files";
import {
  VENUE_CLASSES,
  VISIT_PURPOSES,
  classMeasureFields,
  venueClassFor,
  type VenueClass,
} from "@/lib/stores/venue-classes";
import {
  DISCIPLINE_GROUPS,
  INTAKE_STATUS_META,
  blankSystemsState,
  intakeStatus,
  newInventoryId,
  tier1Items,
  tier1Complete,
  type DisciplineData,
  type DisciplineKey,
  type DisciplineValue,
  type InventoryRow,
  REPLACE_VS_REUSE_OPTIONS,
} from "@/lib/stores/survey-intake";
import { LIFT_TYPES, LOADING_DOOR_TYPES, distanceText, shouldAutoFillTravel, showLiftDetails, travelTimeText } from "@/lib/field-lists";
import { saveSurvey, advanceSurveyStage, deleteSurvey, createQuoteFromSurvey, type SurveyPatch } from "./actions";
import Venue3D from "./venue-3d";
import SuggestEstimate from "@/components/assist/suggest-estimate";
import { saveThroughOutbox } from "@/lib/sync/save";
import { RecordingsStrip, type RecordingStripItem } from "@/components/recordings/recordings-strip";
import { FromRecordingPanel, type FromRecordingPanelData } from "@/components/recordings/from-recording-panel";
import type { Draft, EditorCustomer, EditorMeta, FieldDef, SectionDef } from "./sections/types";
import {
  ACCENT,
  ACCENT_BORDER_LT,
  ACCENT_INK,
  ACCENT_SOFT,
} from "./sections/styles";
import { FieldsSection } from "./sections/fields";
import { CustVenueSection } from "./sections/custvenue";
import { RecapSection } from "./sections/recap";
import { FinalThoughtsSection } from "./sections/final-thoughts";
import { OlderNotes } from "./sections/older-notes";
import { PhotosSection } from "./sections/photos";
import { useSectionPhotos } from "./sections/section-photos";
import { useSectionSketches } from "./sections/sketch-tile";
import { SystemsSection } from "./sections/systems";
import { LinesetsSection } from "./sections/linesets";
import { linesetsInUse } from "@/lib/stores/linesets";
import { AssessmentUsageSection } from "./sections/assessment-usage";
import { AssessmentConditionSection } from "./sections/assessment-condition";
import { AssessmentFindingsSection } from "./sections/assessment-findings";
import {
  SECTION_ORDER, STEP_LABELS, STEP_BY_ID, GROUP_BY_ID, GROUP_META, isQuoteVisit, sectionVisible, hasCounterweight,
} from "@/lib/survey-flow";
import { KillQuestions } from "./sections/kill-questions";
import { SectionRail, SECTION_RAIL_CSS, type RailItem } from "@/components/section-rail/section-rail";
import { sectionProgress } from "./sections/progress";
import { useCollapsed, isCollapsed } from "./sections/collapse";

/* Serializable props from the server — the store is DB-backed and cannot be
 * imported into a client bundle, so its pure meta/option-lists are handed
 * over as plain props. The shapes now live in ./sections/types. */
export type { EditorCustomer, EditorMeta } from "./sections/types";

const DISC_SECTION_ID: Record<DisciplineKey, string> = { rigging: "dRigging", curtain: "dCurtain", lighting: "dLighting", av: "dAv" };

/** Display label for a venue class — the derived `venueType` fallback. */
function classLabel(cls: VenueClass): string {
  return (VENUE_CLASSES.find((c) => c.key === cls) || VENUE_CLASSES[0]).label;
}

function timeAgo(ts: number | null | undefined): string {
  if (!ts) return "—";
  const diff = Date.now() - ts;
  const d = Math.floor(diff / 86400000);
  if (d <= 0) {
    const h = Math.floor(diff / 3600000);
    return h <= 0 ? "just now" : h + "h ago";
  }
  if (d === 1) return "yesterday";
  if (d < 14) return d + "d ago";
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** #344 B5 — the page's one-way drive from the office to a verified venue address (null = none). */
type TravelSuggestion = { min: number; miles: number } | null;
const TRAVEL_HINT = "From the venue's verified address";

/** `travel` fills a blank Travel time / Distance on open (#344 B5) — once: the fill also sets `travelAutoFilled`, which
    the next save stores, and a record carrying it is never refilled (a cleared field stays cleared). Not a change, so
    the draft stays clean — any save stores it. */
function toDraft(r: SurveyRecord, travel: TravelSuggestion = null): Draft {
  const fillTravel = shouldAutoFillTravel(r, travel) ? travel : null;
  return {
    customer: r.customer || "",
    customerId: r.customerId ?? null,
    locationId: r.locationId ?? null,
    venue: r.venue || "",
    venueType: r.venueType || "",
    venueClass: r.venueClass || venueClassFor(r.venueType),
    venueSubtype: r.venueSubtype || "",
    address: r.address || "",
    contact: r.contact || "",
    contactPhone: r.contactPhone || "",
    contactEmail: r.contactEmail || "",
    visitType: r.visitType || "",
    visitPurpose: r.visitPurpose || "",
    reason: r.reason || "",
    travelTime: r.travelTime || (fillTravel ? travelTimeText(fillTravel.min) : ""),
    distance: r.distance || (fillTravel ? distanceText(fillTravel.miles) : ""),
    ...(r.travelAutoFilled === true || fillTravel ? { travelAutoFilled: true as const } : {}),
    hasBOM: !!r.hasBOM,
    hasDrawings: !!r.hasDrawings,
    hasPhotos: !!r.hasPhotos,
    quoteNeededBy: r.quoteNeededBy || "",
    budgetary: !!r.budgetary,
    projectCompletion: r.projectCompletion || "",
    installTimeframe: r.installTimeframe || "",
    loadingDock: r.loadingDock || "",
    elevatorSize: r.elevatorSize || "",
    floorType: r.floorType || "",
    accessDoorSize: r.accessDoorSize || "",
    liftNeeded: r.liftNeeded || "",
    liftSupplier: r.liftSupplier || "",
    loadingDoorSize: r.loadingDoorSize || "",
    liftHeight: r.liftHeight || "",
    loadingDoorType: r.loadingDoorType || "",
    loadingDoorLocation: r.loadingDoorLocation || "",
    loadingDoorWH: r.loadingDoorWH || "",
    liftRequired: r.liftRequired === "yes" || r.liftRequired === "no" ? r.liftRequired : "",
    liftType: r.liftType || "",
    liftWorkingHeight: r.liftWorkingHeight || "",
    pathToFloor: r.pathToFloor || "",
    workingHours: r.workingHours || "",
    blackoutDates: r.blackoutDates || "",
    floorProtection: r.floorProtection || "",
    badgingRequired: r.badgingRequired || "",
    firstImpressions: r.firstImpressions || "",
    budget: r.budget || "",
    fiscalYearSpendBy: r.fiscalYearSpendBy || "",
    whoDecides: r.whoDecides || "",
    targetInstallWindow: r.targetInstallWindow || "",
    lifeSafety: {
      deluge: r.lifeSafety?.deluge || "",
      smokeVent: r.lifeSafety?.smokeVent || "",
      adaNotes: r.lifeSafety?.adaNotes || "",
      egressNotes: r.lifeSafety?.egressNotes || "",
    },
    scopeOfWork: r.scopeOfWork || "",
    quoteLook: r.quoteLook || "",
    notes: r.notes || "",
    stage: (r.stage || "requested") as SurveyStage,
    assignedTo: r.assignedTo || "",
    scheduledDate: r.scheduledDate || "",
    requestedBy: r.requestedBy || "",
    measurements: { ...(r.measurements || {}) },
    conditions: [...(r.conditions || [])],
    photos: [...(r.photos || [])],
    photoRefs: Array.isArray(r.photoRefs) ? [...r.photoRefs] : [],
    sketches: r.sketches && typeof r.sketches === "object" && !Array.isArray(r.sketches) ? { ...r.sketches } : {},
    auditoriumSize: r.auditoriumSize || "",
    yearBuilt: r.yearBuilt || "",
    systemsState: { ...blankSystemsState(), ...(r.systemsState || {}) },
    disciplines: { ...(r.disciplines || {}) },
    disciplinesActive: [...(r.disciplinesActive || [])],
    inventory: [...(r.inventory || [])],
    intakeReady: !!r.intakeReady,
    linesetsEnabled: !!r.linesetsEnabled,
    linesets: [...(r.linesets || [])],
    linesetQty: typeof r.linesetQty === "number" ? r.linesetQty : undefined,
    assessmentEnabled: !!r.assessmentEnabled,
    assessment: r.assessment,
    templateRev: r.templateRev,
    signoff: { ...r.signoff },
    scope: Array.isArray(r.scope) ? [...r.scope] : [],
    internalTags: Array.isArray(r.internalTags) ? [...r.internalTags] : [],
    legacyNotes: Array.isArray(r.legacyNotes) ? [...r.legacyNotes] : [],
    updatedAt: r.updatedAt || 0,
  };
}

type LayoutMode = "long" | "wizard";

/**
 * Two-step arm/confirm in front of the page's `onDelete` (never
 * `window.confirm`). `onDelete` already awaits `deleteSurvey` inside its
 * own try/catch exactly as shipped today — that call is left completely
 * untouched (including however it resolves deleteSurvey's internal
 * `redirect()`); only the first click is gated here.
 */
function DeleteSurveyButton({ onDelete, disabled }: { onDelete: () => void; disabled: boolean }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 5000);
    return () => clearTimeout(t);
  }, [armed]);
  const style = { flexShrink: 0, fontSize: 13, fontWeight: 600, color: "#b4543a", background: "#f9ece8", border: "1px solid #f0d6cd", borderRadius: 9, padding: "10px 14px", cursor: disabled ? "default" : "pointer", minHeight: 42 } as const;
  if (!armed) {
    return (
      <button onClick={() => setArmed(true)} disabled={disabled} style={style}>
        Delete
      </button>
    );
  }
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <button
        onClick={() => {
          setArmed(false);
          onDelete();
        }}
        disabled={disabled}
        style={style}
      >
        Confirm delete
      </button>
      <button onClick={() => setArmed(false)} disabled={disabled} style={{ ...style, color: "#5b616e", background: "#fff", border: "1px solid #e4e7ec" }}>
        Cancel
      </button>
    </span>
  );
}

export default function SurveyEditor({
  record,
  customers,
  roster,
  meta,
  recordings = [],
  canShowRecord = false,
  fromRecording = [],
  meetingsSlot = null,
  canSuggest = false,
  suggestionHref = null,
  travelSuggestion = null,
  blobEnabled = false,
  me = "",
}: {
  record: SurveyRecord;
  customers: EditorCustomer[];
  roster: string[];
  meta: EditorMeta;
  /** Recordings on this survey (+ its linked site visits) — header strip (spec §6). */
  recordings?: RecordingStripItem[];
  /** spec §6 Record-control visibility, computed by the page. */
  canShowRecord?: boolean;
  /** "From recording" prefill panels, one per ready recording (spec §4.4). */
  fromRecording?: FromRecordingPanelData[];
  /** #323 — the server-rendered Meetings card (this survey + its site visits); null when none. */
  meetingsSlot?: ReactNode;
  /** Estimate suggestion (spec 2026-10-13 §3) — pilot + `estimate`, computed on the server. */
  canSuggest?: boolean;
  /** This assessment's latest suggestion ("Suggestion ready → Open"); null when none. */
  suggestionHref?: string | null;
  /** #344 B5 — one-way drive to the venue's verified address, for a blank Travel time / Distance; null when none. */
  travelSuggestion?: TravelSuggestion;
  /** #344 C5 — the server's Blob flag: photos upload to private Blob, else (local dev) inline */
  blobEnabled?: boolean;
  /** #344 C5 — the signed-in user's id, stamped on photos taken here */
  me?: string;
}) {
  const initial = useMemo<Draft>(() => toDraft(record, travelSuggestion), [record, travelSuggestion]);
  const [draft, setDraft] = useState<Draft>(initial);
  const [dirty, setDirty] = useState(false);
  // A "From recording" Insert (spec §4.4) writes into the SAVED survey and
  // refreshes the route. Adopt the refreshed record so the appended text
  // shows and the next Save doesn't overwrite it with this stale draft —
  // scoped to that flow only (sync pulls never reset a draft) and to a
  // clean draft (the panel disables Insert while dirty).
  const [seenInitial, setSeenInitial] = useState(initial);
  const [adoptNextRecord, setAdoptNextRecord] = useState(false);
  // #344 C5 fix: the last draft the server holds (a photo save sends this + the current photo refs, never the user's
  // unsaved edits) and the current photo refs (every save sends them). Both reset when a refreshed record is adopted.
  const [adoptedBase, setAdoptedBase] = useState(initial);
  const lastSaved = useRef<Draft>(initial);
  const refsNow = useRef<SurveyPhotoRef[]>(initial.photoRefs);
  const sketchesNow = useRef<Record<string, SketchRef>>(initial.sketches); // #344 C6: the current sketches, same rule
  useEffect(() => {
    lastSaved.current = adoptedBase;
    refsNow.current = adoptedBase.photoRefs;
    sketchesNow.current = adoptedBase.sketches;
  }, [adoptedBase]);
  if (initial !== seenInitial) {
    setSeenInitial(initial);
    if (adoptNextRecord) {
      setAdoptNextRecord(false);
      if (!dirty) {
        setDraft(initial);
        setAdoptedBase(initial);
      }
    }
  }
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [custNew, setCustNew] = useState(!record.customerId && !!(record.customer || "").trim());
  const [venueOther, setVenueOther] = useState(false);
  const [layoutMode, setLayoutMode] = useState<LayoutMode>("long");
  const [step, setStep] = useState(0);
  // #344 A8: every section collapses; the choice is remembered per viewer per survey (localStorage)
  const [collapsedMap, setCollapsedFor] = useCollapsed(record.id);
  const [activeSec, setActiveSec] = useState("cust");
  const headRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [headH, setHeadH] = useState(128);
  const [railMax, setRailMax] = useState(600);
  useEffect(() => {
    const el = headRef.current;
    if (!el) return;
    const main = el.closest("main");
    // the rail may be at most the scroll pane's height minus the sticky header and its gaps (#344 A8)
    const measure = () => {
      setHeadH(Math.round(el.getBoundingClientRect().height));
      const paneH = main ? main.clientHeight : window.innerHeight;
      setRailMax(Math.max(200, paneH - Math.round(el.getBoundingClientRect().height) - 24));
    };
    measure();
    window.addEventListener("resize", measure);
    if (typeof ResizeObserver === "undefined") return () => window.removeEventListener("resize", measure);
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (main) ro.observe(main);
    return () => { ro.disconnect(); window.removeEventListener("resize", measure); };
  }, []);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function flash(msg: string) {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }
  function patchDraft(patch: Partial<Draft>) {
    setDraft((d) => ({ ...d, ...patch }));
    setDirty(true);
  }
  const setField = <K extends keyof Draft>(key: K, val: Draft[K]) => patchDraft({ [key]: val } as Partial<Draft>);
  const mv = (k: string): string | boolean => (draft.measurements[k] != null ? draft.measurements[k] : "");
  const setMeasure = (key: string, val: string | boolean) =>
    patchDraft({ measurements: { ...draft.measurements, [key]: val } });
  const toggleMeasure = (key: string) => setMeasure(key, !mv(key));

  /* ---------- site intake: discipline data + inventory helpers ---------- */
  const tier1 = tier1Items(draft);
  const tier1Done = tier1Complete(draft);
  const intakeSt = intakeStatus(draft);
  const intakeMeta = INTAKE_STATUS_META[intakeSt];

  const dv = (disc: DisciplineKey, key: string): DisciplineValue => {
    const d = draft.disciplines[disc];
    return d && d[key] != null ? d[key] : "";
  };
  /** `undefined` removes the key (#344 B4: an unset condition level is an absent key). */
  const setDisc = (disc: DisciplineKey, key: string, val: DisciplineValue | undefined) => {
    const next: DisciplineData = { ...(draft.disciplines[disc] || {}) };
    if (val === undefined) delete next[key];
    else next[key] = val;
    patchDraft({
      disciplines: { ...draft.disciplines, [disc]: next },
      disciplinesActive: draft.disciplinesActive.includes(disc)
        ? draft.disciplinesActive
        : draft.disciplinesActive.concat(disc),
    });
  };
  const invRows = (disc: DisciplineKey, category: string) =>
    draft.inventory.filter((r) => r.discipline === disc && r.category === category);
  const addInvRow = (disc: DisciplineKey, category: string) =>
    patchDraft({
      inventory: draft.inventory.concat([
        { id: newInventoryId(), discipline: disc, category, type: "", quantity: "", flag: false, notes: "" },
      ]),
      disciplinesActive: draft.disciplinesActive.includes(disc)
        ? draft.disciplinesActive
        : draft.disciplinesActive.concat(disc),
    });
  const patchInvRow = (id: string, patch: Partial<InventoryRow>) =>
    patchDraft({ inventory: draft.inventory.map((r) => (r.id === id ? { ...r, ...patch } : r)) });
  const removeInvRow = (id: string) =>
    patchDraft({ inventory: draft.inventory.filter((r) => r.id !== id) });
  const patchLineset = (id: string, patch: Partial<(typeof draft.linesets)[number]>) =>
    patchDraft({ linesets: draft.linesets.map((row) => (row.id === id ? { ...row, ...patch } : row)), linesetsEnabled: true });
  // always a number once touched (0 = none) — an unset quantity would be reseeded on the next read
  // #344 B-final: a schedule in use (a quantity above 0 or any row) also turns linesetsEnabled on, so every reader that
  // gates on it shows the sets
  const applyLinesets = (rows: typeof draft.linesets, qty?: number) => {
    const enable = draft.linesetsEnabled || linesetsInUse(rows, qty ?? draft.linesetQty);
    patchDraft(qty == null ? { linesets: rows, linesetsEnabled: enable } : { linesets: rows, linesetQty: qty, linesetsEnabled: enable });
  };
  const removeLineset = (id: string) =>
    patchDraft({ linesets: draft.linesets.filter((row) => row.id !== id) });

  /* ---------- customer & venue linkage ---------- */
  const custObj = (id: string | null) => (id ? customers.find((c) => c.id === id) || null : null);
  const primaryLoc = (c: EditorCustomer | null) => {
    const ls = c?.locations || [];
    return ls.find((l) => l.primary) || ls[0] || null;
  };
  const linkedCust = draft.customerId ? custObj(draft.customerId) : null;
  const custLocs = linkedCust?.locations || [];
  const venueHasLocs = custLocs.length > 0;

  function setCustomerSel(val: string) {
    if (val === "__new__") {
      setCustNew(true);
      setVenueOther(false);
      patchDraft({ customerId: null, locationId: null });
      return;
    }
    if (!val) {
      setCustNew(false);
      setVenueOther(false);
      patchDraft({ customerId: null, customer: "", locationId: null, venue: "" });
      return;
    }
    const c = custObj(val);
    const prim = primaryLoc(c);
    const patch: Partial<Draft> = {
      customerId: val,
      customer: c ? c.name : draft.customer,
      locationId: prim ? prim.id : null,
      venue: prim ? prim.label : "",
    };
    if (prim && !(draft.address || "").trim()) {
      const a = [prim.city, prim.state].filter(Boolean).join(", ");
      if (a) patch.address = a;
    }
    const pc = c?.primaryContact || null;
    if (pc) {
      if (!(draft.contact || "").trim()) patch.contact = pc.name;
      if (!(draft.contactEmail || "").trim() && pc.email) patch.contactEmail = pc.email;
    }
    setCustNew(false);
    setVenueOther(false);
    patchDraft(patch);
  }
  function setVenueSel(val: string) {
    if (val === "__other__") {
      setVenueOther(true);
      patchDraft({ locationId: null });
      return;
    }
    const c = custObj(draft.customerId);
    const loc = (c?.locations || []).find((l) => l.id === val) || null;
    const patch: Partial<Draft> = { locationId: val || null, venue: loc ? loc.label : draft.venue };
    if (loc && !(draft.address || "").trim()) {
      const a = [loc.city, loc.state].filter(Boolean).join(", ");
      if (a) patch.address = a;
    }
    setVenueOther(false);
    patchDraft(patch);
  }

  /* ---------- sections ---------- */
  const sections = useMemo<SectionDef[]>(() => {
    // the quick measurement set is the venue class's own field set (D132)
    const quick = classMeasureFields(draft.venueClass);
    const groupFields = (g: MeasureGroup): FieldDef[] =>
      g.fields.map((f) => {
        if (f.type === "select") return { kind: "select", key: f.key, label: f.label, options: f.options || [], measure: true };
        if (f.type === "check") return { kind: "checkMeasure", key: f.key, label: f.label };
        return { kind: "measure", key: f.key, label: f.label };
      });
    /* #344 B5 — Beams & rigging: the drawings on file sit at the top (brick / CW elevation only with a counterweight
       system); a structural drawing on file hides the beam measurements (their values stay stored). */
    const DRAWING_KEYS = ["structuralDrawingOnFile", "brickDrawingOnFile", "cwElevationOnFile"];
    const beamFields = (g: MeasureGroup): FieldDef[] => {
      const all = groupFields(g);
      const cw = hasCounterweight(draft);
      const drawings = all.filter((f) => f.key === "structuralDrawingOnFile" || (cw && (f.key === "brickDrawingOnFile" || f.key === "cwElevationOnFile")));
      if (draft.measurements.structuralDrawingOnFile) {
        return [...drawings, { kind: "note", key: "structuralDrawingNote", text: "The structural drawing covers the beam measurements." }];
      }
      return [...drawings, ...all.filter((f) => !DRAWING_KEYS.includes(f.key))];
    };

    const secs: SectionDef[] = [];
    secs.push({ id: "cust", title: "Customer & venue", subtitle: "Who and where", group: "brief", step: 0, kind: "custvenue" });
    secs.push({
      id: "visit", title: "Visit", subtitle: "Purpose & travel", group: "brief", step: 0, kind: "fields",
      fields: [
        { kind: "select", key: "visitPurpose", label: "Purpose of visit", options: VISIT_PURPOSES },
        // #344 B5: the hint shows while the value is still the verified-address suggestion
        {
          kind: "text", key: "travelTime", label: "Travel time", placeholder: "e.g. 35 min",
          hint: travelSuggestion && draft.travelTime === travelTimeText(travelSuggestion.min) ? TRAVEL_HINT : undefined,
        },
        {
          kind: "text", key: "distance", label: "Distance", placeholder: "e.g. 22 mi",
          hint: travelSuggestion && draft.distance === distanceText(travelSuggestion.miles) ? TRAVEL_HINT : undefined,
        },
        { kind: "textarea", key: "reason", label: "Reason / scope of visit", placeholder: "Why are we here? What triggered the visit?" },
      ],
    });
    secs.push({
      id: "project", title: "Existing materials & quote",
      subtitle: isQuoteVisit(draft)
        ? "What we have on file, and what the quote needs. Ask these last, once the customer is comfortable."
        : "What we have on file. The quote questions show when the purpose is New system design.",
      group: "wrapup", step: 5, kind: "fields",
      fields: [
        { kind: "checkTop", key: "hasBOM", label: "Existing BOM on file" },
        { kind: "checkTop", key: "hasDrawings", label: "Existing drawings on file" },
        { kind: "checkTop", key: "hasPhotos", label: "Existing photos on file" },
        // #344 A3: the quote / budget half only on a quote visit (answers stay stored either way)
        ...(isQuoteVisit(draft)
          ? ([
              { kind: "text", key: "quoteNeededBy", label: "Quote needed by", type: "date" },
              { kind: "toggle", key: "budgetary", label: "Is it budgetary?" },
              { kind: "text", key: "projectCompletion", label: "Project completion", type: "date" },
              { kind: "select", key: "installTimeframe", label: "Install timeframe", options: meta.installTimeframes },
              { kind: "text", key: "budget", label: "Budget" },
              { kind: "text", key: "fiscalYearSpendBy", label: "Fiscal year / spend-by date" },
              { kind: "text", key: "whoDecides", label: "Who decides" },
              { kind: "text", key: "targetInstallWindow", label: "Target install window" },
            ] as FieldDef[])
          : []),
      ],
    });
    secs.push({
      id: "assign", title: "Assignment & schedule",
      subtitle: draft.requestedBy ? "Requested by " + draft.requestedBy : "Assign a surveyor and set a date",
      group: "brief", step: 0, kind: "fields",
      fields: [
        { kind: "select", key: "assignedTo", label: "Assigned to", options: roster },
        { kind: "text", key: "scheduledDate", label: "Scheduled date", type: "date" },
      ],
    });
    secs.push({
      id: "site", title: "Site access & logistics", subtitle: "Getting in and getting up", group: "field", step: 1, kind: "fields",
      fields: [
        { kind: "text", key: "loadingDock", label: "Loading dock", placeholder: "Type / location" },
        { kind: "text", key: "elevatorSize", label: "Elevator size", placeholder: "e.g. 5' × 7' or none" },
        { kind: "select", key: "floorType", label: "Floor type", options: meta.floorTypes },
        { kind: "text", key: "accessDoorSize", label: "Access door size", placeholder: "e.g. 8' × 10'" },
        // #344 B5: loading door + lift replace loadingDoorSize / liftNeeded / liftHeight (old keys stay stored)
        { kind: "select", key: "loadingDoorType", label: "Loading door type", options: LOADING_DOOR_TYPES },
        { kind: "text", key: "loadingDoorLocation", label: "Loading door location" },
        { kind: "text", key: "loadingDoorWH", label: "Loading door W × H", placeholder: "e.g. 10' × 12'" },
        { kind: "choice", key: "liftRequired", label: "Lift needed?", options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }] },
        ...(showLiftDetails(draft)
          ? ([
              { kind: "select", key: "liftType", label: "Lift type", options: LIFT_TYPES },
              { kind: "text", key: "liftWorkingHeight", label: "Working height", placeholder: "e.g. 32'" },
              { kind: "select", key: "liftSupplier", label: "Who supplies lift", options: meta.liftSuppliers },
            ] as FieldDef[])
          : []),
        { kind: "textarea", key: "pathToFloor", label: "Path: truck → floor" },
        { kind: "text", key: "workingHours", label: "Working hours allowed" },
        { kind: "text", key: "blackoutDates", label: "Blackout dates / events" },
        { kind: "text", key: "floorProtection", label: "Floor protection required" },
        { kind: "text", key: "badgingRequired", label: "Badging / background check" },
        { kind: "textarea", key: "firstImpressions", label: "First impressions / notes" },
      ],
    });
    // Life safety — auditorium sheet p.5, offered on any class. Collapsed by
    // default; the values live one level down on draft.lifeSafety.
    secs.push({
      id: "lifeSafety", title: "Life safety", subtitle: "Deluge, smoke vent, ADA and egress", group: "field", step: 1, advanced: true, kind: "fields",
      fields: [
        { kind: "sub", obj: "lifeSafety", key: "deluge", label: "Deluge / sprinkler over stage?" },
        { kind: "sub", obj: "lifeSafety", key: "smokeVent", label: "Smoke vent / hatch?" },
        { kind: "sub", obj: "lifeSafety", key: "adaNotes", label: "ADA access notes" },
        { kind: "sub", obj: "lifeSafety", key: "egressNotes", label: "Egress notes" },
      ],
    });
    secs.push({
      id: "mQuick", title: "Measurements", subtitle: "Feet — type ft-in (38′-6″) or decimal (38.5)", group: "field", step: 2, kind: "fields",
      fields: quick.map((f) => ({ kind: "measure", key: f.key, label: f.label })),
    });
    meta.measureGroups.forEach((g) => {
      const fields = g.id === "mBeams" ? beamFields(g) : groupFields(g);
      secs.push({ id: g.id, title: g.title, subtitle: g.subtitle, group: "field", step: 2, advanced: true, kind: "fields", fields });
    });
    // 3D preview (IDEAS #49 P1) — parametric model auto-built from measurements
    secs.push({ id: "m3d", title: "3D preview", subtitle: "Auto-built from measurements — drag to orbit", group: "field", step: 2, advanced: true, kind: "viz3d" });
    // ---- Kill questions (the first step's gate) and the discipline branches. Soft gate — the
    // discipline sections lock until the kill questions are answered, but the record always saves as a draft.
    secs.push({
      id: "tier1", title: "Kill questions", subtitle: "Scope, rigging system and the basics — the discipline intakes unlock once these are in",
      group: "brief", step: 0, kind: "tier1",
    });
    DISCIPLINE_GROUPS.forEach((g) => {
      secs.push({
        id: DISC_SECTION_ID[g.key], title: g.title, subtitle: g.subtitle,
        group: "intake", step: 3, advanced: true, kind: "discipline", disc: g.key,
      });
    });
    secs.push({ id: "linesets", title: "Lineset schedule", subtitle: "Physical positions, loads, trim and condition", group: "intake", step: 3, advanced: true, kind: "linesets" });
    secs.push({ id: "assessmentToggle", title: "Condition & Needs assessment", subtitle: "Add an advisory layer when the customer needs Peak's opinion", group: "intake", step: 3, kind: "assessmentToggle" });
    // #344 C5: photos live in each section now; the old inline photos stay readable (findings may link them)
    if (draft.photos.length > 0) secs.push({ id: "photos", title: "Earlier photos", subtitle: "Read-only", group: "field", step: 4, kind: "photos" });
    secs.push({
      id: "notes", title: "Scope & notes", subtitle: "Free text", group: "field", step: 4, kind: "fields",
      fields: [
        { kind: "textarea", key: "scopeOfWork", label: "Scope of work", placeholder: "What are we scoping / installing?" },
        { kind: "textarea", key: "quoteLook", label: "How the quote should look", placeholder: "Format, breakdown, alternates the customer wants to see…" },
        { kind: "textarea", key: "notes", label: "Generic notes", placeholder: "Access, hazards, scheduling constraints…" },
      ],
    });
    // #344 B5 — wrap-up questions asked last; visible per sectionVisible (curtains in scope)
    secs.push({
      id: "finalQuestions", title: "Final questions", subtitle: "Last things to settle before you leave", group: "wrapup", step: 5, kind: "fields",
      fields: [
        { kind: "select", key: "replaceVsReuse", label: "Replace vs. reuse (curtains)", options: REPLACE_VS_REUSE_OPTIONS, disc: "curtain" },
      ],
    });
    secs.push({ id: "recap", title: "Customer recap", subtitle: "Read back what we heard", group: "wrapup", step: 5, kind: "recap" });
    secs.push({ id: "finalThoughts", title: "Final thoughts", subtitle: "Internal tags — never shown to the customer", group: "wrapup", step: 5, kind: "finalThoughts" });
    if (draft.assessmentEnabled) {
      secs.push({ id: "assessmentUsage", title: "Usage & needs profile", subtitle: "How the room is used, operated, and expected to grow", group: "assessment", step: 5, kind: "assessmentUsage" });
      secs.push({ id: "assessmentCondition", title: "Condition ratings", subtitle: "Good, monitor, or replace—with formal inspection references", group: "assessment", step: 5, kind: "assessmentCondition" });
      secs.push({ id: "assessmentFindings", title: "Findings & recommendations", subtitle: "Priorities, planning ranges, and supporting photos", group: "assessment", step: 5, kind: "assessmentFindings" });
    }
    secs.forEach((s) => {
      if (GROUP_BY_ID[s.id]) s.group = GROUP_BY_ID[s.id];
      if (STEP_BY_ID[s.id] != null) s.step = STEP_BY_ID[s.id];
    });
    return secs
      .filter((s) => sectionVisible(draft, s.id))
      .sort((a, b) => SECTION_ORDER.indexOf(a.id) - SECTION_ORDER.indexOf(b.id));
  }, [draft, meta, roster, travelSuggestion]);

  /* ---------- persistence ---------- */
  function validate(): boolean {
    if (!(draft.customer || "").trim()) {
      setSaveError("Select a customer (or add a new customer name) to save this survey.");
      return false;
    }
    if (!(draft.venue || "").trim()) {
      setSaveError("Add a venue to save this survey.");
      return false;
    }
    setSaveError("");
    return true;
  }
  function buildPatch(over?: Partial<SurveyPatch>, d: Draft = draft): SurveyPatch {
    const draft = d;
    return {
      customer: draft.customer,
      customerId: draft.customerId,
      locationId: draft.locationId,
      venue: draft.venue,
      // venueType is derived now (D132) — the class + subtype are the inputs.
      // Keep writing it so the ~20 call sites that display it show something;
      // a legacy value on the record wins over the class label.
      venueType: draft.venueType || classLabel(draft.venueClass),
      venueClass: draft.venueClass,
      venueSubtype: draft.venueSubtype,
      address: draft.address,
      contact: draft.contact,
      contactPhone: draft.contactPhone,
      contactEmail: draft.contactEmail,
      // visitType is legacy — read by the migration, never written from here
      visitPurpose: draft.visitPurpose,
      reason: draft.reason,
      travelTime: draft.travelTime,
      distance: draft.distance,
      ...(draft.travelAutoFilled ? { travelAutoFilled: draft.travelAutoFilled } : {}),
      hasBOM: draft.hasBOM,
      hasDrawings: draft.hasDrawings,
      hasPhotos: draft.hasPhotos,
      quoteNeededBy: draft.quoteNeededBy,
      budgetary: draft.budgetary,
      projectCompletion: draft.projectCompletion,
      installTimeframe: draft.installTimeframe,
      loadingDock: draft.loadingDock,
      elevatorSize: draft.elevatorSize,
      floorType: draft.floorType,
      accessDoorSize: draft.accessDoorSize,
      liftNeeded: draft.liftNeeded,
      liftSupplier: draft.liftSupplier,
      loadingDoorSize: draft.loadingDoorSize,
      liftHeight: draft.liftHeight,
      loadingDoorType: draft.loadingDoorType,
      loadingDoorLocation: draft.loadingDoorLocation,
      loadingDoorWH: draft.loadingDoorWH,
      liftRequired: draft.liftRequired,
      liftType: draft.liftType,
      liftWorkingHeight: draft.liftWorkingHeight,
      pathToFloor: draft.pathToFloor,
      workingHours: draft.workingHours,
      blackoutDates: draft.blackoutDates,
      floorProtection: draft.floorProtection,
      badgingRequired: draft.badgingRequired,
      firstImpressions: draft.firstImpressions,
      budget: draft.budget,
      fiscalYearSpendBy: draft.fiscalYearSpendBy,
      whoDecides: draft.whoDecides,
      targetInstallWindow: draft.targetInstallWindow,
      lifeSafety: draft.lifeSafety,
      scopeOfWork: draft.scopeOfWork,
      quoteLook: draft.quoteLook,
      notes: draft.notes,
      assignedTo: draft.assignedTo,
      scheduledDate: draft.scheduledDate,
      // measurements carry booleans for check-type rig fields (prototype shape);
      // the store types this as string-map, so cast at the boundary.
      measurements: draft.measurements as Record<string, string>,
      conditions: draft.conditions,
      photos: draft.photos,
      // #344 C5 — whole list every save (a ref absent from a save is deleted); finished slots are kept by the store
      // once photos were touched in this session they are always sent (deleting the only one must reach the server)
      ...(draft.photoRefs.length || Array.isArray(record.photoRefs) || photosTouched.current ? { photoRefs: draft.photoRefs } : {}),
      // #344 C6 — sketch pads, sent whole once there are any (a stored finished slot is kept by the store)
      ...(Object.keys(draft.sketches).length || (record.sketches && typeof record.sketches === "object") || sketchesTouched.current ? { sketches: draft.sketches } : {}),
      auditoriumSize: draft.auditoriumSize,
      yearBuilt: draft.yearBuilt,
      systemsState: draft.systemsState,
      disciplines: draft.disciplines,
      disciplinesActive: draft.disciplinesActive,
      inventory: draft.inventory,
      intakeReady: draft.intakeReady,
      linesetsEnabled: draft.linesetsEnabled,
      linesets: draft.linesets,
      // only ever a number — an unset quantity is reseeded from the rows on the next read
      ...(typeof draft.linesetQty === "number" ? { linesetQty: draft.linesetQty } : {}),
      assessmentEnabled: draft.assessmentEnabled,
      assessment: draft.assessment,
      templateRev: draft.templateRev,
      signoff: draft.signoff,
      // an unanswered scope stays unset (R2) so the read-time seed can still run
      scope: draft.scope.length ? draft.scope : undefined,
      internalTags: draft.internalTags,
      ...over,
    };
  }
  /**
   * The WHOLE resulting survey document for the offline outbox
   * (/api/sync/push does a whole-doc upsert by id). Merge the SSR record with
   * the editor patch and stamp it the way the store's update() would when a
   * write reaches the cloud (synced, rev bumped).
   */
  function buildFullDoc(over?: Partial<SurveyPatch>, d: Draft = draft): Record<string, unknown> {
    // legacyNotes is derived on every read (src/lib/survey-migrate.ts) — never write it back
    const { legacyNotes: _legacy, ...rec } = record as unknown as Record<string, unknown>;
    void _legacy;
    return {
      ...rec,
      ...(buildPatch(over, d) as Record<string, unknown>),
      updatedAt: Date.now(),
      rev: Math.max(record.rev || 1, revSeen.current) + 1,
      syncState: "synced",
    };
  }
  async function onSave() {
    if (!validate() || saving) return;
    setSaving(true);
    const edits = draft; // the user's draft as of this click; the photo refs are read when the save runs
    try {
      const { queued } = await serialSave(async () => {
        const sent: Draft = { ...edits, photoRefs: refsNow.current, sketches: sketchesNow.current };
        const patch = buildPatch(undefined, sent);
        const res = await saveThroughOutbox({
          collection: "surveys",
          id: record.id,
          doc: buildFullDoc(undefined, sent),
          action: () => saveSurvey(record.id, patch),
        });
        lastSaved.current = sent;
        setPhotoUnsaved(false);
        return res;
      });
      setDirty(false);
      setDraft((d) => ({ ...d, updatedAt: Date.now() }));
      flash(
        queued
          ? "Saved on this device — will sync when you're back online"
          : "Saved to the office"
      );
    } catch {
      setSaveError("Could not save — please try again.");
    } finally {
      setSaving(false);
    }
  }
  async function advanceStage(target: SurveyStage) {
    if (!validate() || saving) return;
    setSaving(true);
    const edits = draft;
    try {
      const { queued } = await serialSave(async () => {
        const sent: Draft = { ...edits, photoRefs: refsNow.current, sketches: sketchesNow.current };
        const patch = buildPatch({ stage: target }, sent);
        const res = await saveThroughOutbox({
          collection: "surveys",
          id: record.id,
          doc: buildFullDoc({ stage: target }, sent),
          action: () => advanceSurveyStage(record.id, patch, target),
        });
        lastSaved.current = { ...sent, stage: target };
        setPhotoUnsaved(false);
        return res;
      });
      setDraft((d) => ({ ...d, stage: target, updatedAt: Date.now() }));
      setDirty(false);
      flash(
        queued
          ? `Moved to ${meta.stageMeta[target].label} — will sync when you're back online`
          : "Moved to " + meta.stageMeta[target].label
      );
    } catch {
      setSaveError("Could not update stage — please try again.");
    } finally {
      setSaving(false);
    }
  }
  async function onCreateQuote() {
    if (!validate() || saving) return;
    setSaving(true);
    try {
      const edits = draft;
      await serialSave(() => createQuoteFromSurvey(record.id, buildPatch({ stage: "completed" }, { ...edits, photoRefs: refsNow.current, sketches: sketchesNow.current })));
      // redirect happens server-side
    } catch {
      setSaveError("Could not create the quote — please try again.");
      setSaving(false);
    }
  }
  async function onDelete() {
    if (saving) return;
    setSaving(true);
    try {
      await deleteSurvey(record.id);
    } catch {
      setSaveError("Could not delete the survey — please try again.");
      setSaving(false);
    }
  }

  async function onPrintSheet() {
    if (saving) return;
    const preview = window.open("", "_blank");
    setSaving(true);
    try {
      // The saved record supplies Earlier photos; sending them inline would only bloat the request.
      const { photos: _earlier, ...patch } = buildPatch(undefined, { ...draft, photoRefs: refsNow.current, sketches: sketchesNow.current });
      void _earlier;
      const res = await fetch(`/api/surveys/${encodeURIComponent(record.id)}/sheet-pdf`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const url = URL.createObjectURL(await res.blob());
      if (preview) preview.location.href = url;
      else window.location.assign(url);
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      if (preview) preview.close();
      setSaveError("Could not build the field sheet — please try again.");
    } finally {
      setSaving(false);
    }
  }

  /* ---------- per-section photos (#344 C5) ---------- */
  // The survey's stored rev a finalize reported (a finalize never bumps it) — the next outbox save builds on it.
  const revSeen = useRef(0);
  /** Once photos change in this session, every save carries photoRefs (even an empty list). */
  const photosTouched = useRef(false);
  /** Same for sketches: once they change in this session every save carries them (even an empty set). */
  const sketchesTouched = useRef(false);
  /** A photo (true) or sketch ("drawing") save failed and nothing has saved since — the pill says so instead of "Saved". */
  const [photoUnsaved, setPhotoUnsaved] = useState<boolean | "drawing">(false);
  /** Save changes, stage moves and photo saves run one at a time (each reads the newest refs when it runs). */
  const saveChain = useRef<Promise<unknown>>(Promise.resolve());
  function serialSave<T>(fn: () => Promise<T>): Promise<T> {
    const run = saveChain.current.then(fn, fn);
    saveChain.current = run.catch(() => undefined);
    return run;
  }
  /** A photo change saves the LAST-SAVED draft + the current refs: the user's unsaved edits stay unsaved (and dirty),
   *  and are never saved half-typed or past validate(). */
  async function savePhotoRefs(kind: "photo" | "drawing" = "photo") {
    try {
      await serialSave(async () => {
        const sent: Draft = { ...lastSaved.current, photoRefs: refsNow.current, sketches: sketchesNow.current };
        const patch = buildPatch(undefined, sent);
        await saveThroughOutbox({
          collection: "surveys",
          id: record.id,
          doc: buildFullDoc(undefined, sent),
          action: () => saveSurvey(record.id, patch),
        });
        lastSaved.current = { ...lastSaved.current, photoRefs: sent.photoRefs, sketches: sent.sketches };
        setPhotoUnsaved(false);
      });
    } catch (e) {
      if (kind === "drawing") setPhotoUnsaved("drawing");
      else setPhotoUnsaved(true);
      throw e;
    }
  }
  // #344 C6 — sketch pads save through the same file save (last-saved draft + current photos + current sketches)
  const sectionSketches = useSectionSketches({
    recordId: record.id,
    me,
    sketches: draft.sketches,
    survey: draft,
    onSketches: (next) => {
      sketchesNow.current = next;
      sketchesTouched.current = true;
      setDraft((d) => ({ ...d, sketches: next }));
    },
    save: () => savePhotoRefs("drawing"),
  });
  const sectionPhotos = useSectionPhotos({
    recordId: record.id,
    me,
    blobEnabled,
    refs: draft.photoRefs,
    onRefs: (next) => {
      refsNow.current = next;
      photosTouched.current = true;
      setDraft((d) => ({ ...d, photoRefs: next }));
    },
    save: () => savePhotoRefs("photo"),
    onRev: (rev) => {
      if (rev > revSeen.current) revSeen.current = rev;
    },
    sectionTitle: (id) => sections.find((s) => s.id === id)?.title ?? "another section",
    foldOther: (fileId, slot) => sectionSketches.fold(fileId, slot),
    discardOther: (fileId) => sectionSketches.discard(fileId),
    describeOther: (fileId) => sectionSketches.describe(fileId),
  });
  const photoCounts = photoCountsBySection(draft.photoRefs);

  /* ---------- derived ---------- */
  const stageKey = draft.stage || "requested";
  const curStageIdx = Math.max(0, meta.stages.findIndex((s) => s.key === stageKey));
  const title = (draft.customer || "").trim() ? draft.customer : "Site survey";
  const sub = record.id + " · " + timeAgo(draft.updatedAt);

  let savePillLabel: string;
  let savePillBg: string;
  let savePillInk: string;
  if (dirty) {
    savePillLabel = "Unsaved changes";
    savePillBg = "#fbf3dd";
    savePillInk = "#9a6a1f";
  } else if (photoUnsaved) {
    savePillLabel = photoUnsaved === "drawing" ? "Drawing not saved yet" : "Photo not saved yet";
    savePillBg = "#fbf3dd";
    savePillInk = "#9a6a1f";
  } else {
    savePillLabel = "Saved";
    savePillBg = "#eaf6ef";
    savePillInk = "#1f7a52";
  }

  let stageActionLabel: string;
  let stageAction: () => void;
  if (stageKey === "requested") {
    stageActionLabel = "Schedule →";
    stageAction = () => advanceStage("scheduled");
  } else if (stageKey === "scheduled") {
    stageActionLabel = "Start on-site →";
    stageAction = () => advanceStage("onsite");
  } else if (stageKey === "onsite") {
    stageActionLabel = "Mark complete →";
    stageAction = () => advanceStage("completed");
  } else {
    stageActionLabel = "Create quote →";
    stageAction = () => onCreateQuote();
  }

  const assignInfo = [draft.assignedTo ? "Assigned to " + draft.assignedTo : "", draft.scheduledDate || ""].filter(Boolean).join(" · ");

  /* ---------- section visibility (layout modes) ---------- */
  const stepsPresent = useMemo(() => {
    const s: number[] = [];
    sections.forEach((sec) => {
      if (s.indexOf(sec.step) < 0) s.push(sec.step);
    });
    return s.sort((a, b) => a - b);
  }, [sections]);
  const curStepIdx = stepsPresent.indexOf(step);

  const isOpen = (sec: SectionDef) => !isCollapsed(collapsedMap, sec);
  const toggleSection = (sec: SectionDef) => setCollapsedFor(sec.id, isOpen(sec));

  const visibleSections = layoutMode === "wizard" ? sections.filter((s) => s.step === step) : sections;

  function scrollToSection(id: string) {
    try {
      const el = document.getElementById("sec-" + id);
      if (el) {
        // the app shell scrolls <main class="pk-main">, not the window, so let the browser find the container;
        // each section card's scrollMarginTop keeps it clear of the sticky header
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    } catch {}
  }
  function jumpTo(id: string) {
    // #344: Kill questions sit in Brief while the intakes they unlock sit in Site intake — in Stepped
    // layout a jump to another step switches to it first, then scrolls once it has rendered. A collapsed
    // target opens first (A8), so the scroll waits a frame for it to lay out.
    const target = sections.find((s) => s.id === id);
    // a locked discipline stays shut (and its stored choice untouched) until the kill questions are in
    const locked = target?.kind === "discipline" && !tier1Done;
    if (target && !locked && !isOpen(target)) setCollapsedFor(id, false);
    setActiveSec(id);
    if (layoutMode === "wizard" && target && target.step !== step) {
      setStep(target.step);
      window.setTimeout(() => scrollToSection(id), 60);
      return;
    }
    requestAnimationFrame(() => scrollToSection(id));
  }
  function gotoStep(i: number) {
    setStep(i);
    try {
      rootRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch {}
  }

  /* ---------- render helpers ---------- */
  const modeBtn = (on: boolean): CSSProperties => ({
    fontFamily: "var(--font-ui)",
    fontSize: 12.5,
    fontWeight: 600,
    border: "none",
    borderRadius: 8,
    padding: "8px 13px",
    cursor: "pointer",
    minHeight: 38,
    color: on ? "#16181d" : "#787d87",
    background: on ? "#fff" : "transparent",
    boxShadow: on ? "0 1px 2px rgba(0,0,0,.08)" : undefined,
  });
  const toggleBtn = (active: boolean): CSSProperties => ({
    flex: 1,
    fontFamily: "var(--font-ui)",
    fontSize: 14,
    fontWeight: 600,
    padding: 11,
    borderRadius: 9,
    cursor: "pointer",
    minHeight: 44,
    border: `1px solid ${active ? "var(--accent)" : "#e4e7ec"}`,
    background: active ? ACCENT_SOFT : "#fff",
    color: active ? ACCENT_INK : "#5b616e",
  });
  const chipStyle = (active: boolean): CSSProperties => ({
    fontFamily: "var(--font-ui)",
    fontSize: 12.5,
    fontWeight: 500,
    padding: "9px 13px",
    borderRadius: 20,
    cursor: "pointer",
    minHeight: 40,
    border: `1px solid ${active ? "var(--accent)" : "#e4e7ec"}`,
    background: active ? ACCENT_SOFT : "#fff",
    color: active ? ACCENT_INK : "#5b616e",
  });
  const boxStyle = (checked: boolean): CSSProperties => ({
    width: 20,
    height: 20,
    borderRadius: 6,
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 12,
    fontWeight: 700,
    color: "#fff",
    border: `1.5px solid ${checked ? "var(--accent)" : "#cfd3da"}`,
    background: checked ? "var(--accent)" : "#fff",
  });

  /* ---------- the section rail (long scroll, #344 A8) ---------- */
  // the phone <select> is controlled — if a scope toggle hid the active section, fall back to a shown one
  const shownActive = sections.some((s) => s.id === activeSec) ? activeSec : (sections[0]?.id ?? "cust");
  const LOCKED_MSG = "Answer the kill questions to unlock the discipline intakes";
  // a locked discipline picked in the rail goes to Kill questions (its own card stays shut)
  function pickFromRail(id: string) {
    const t = sections.find((s) => s.id === id);
    if (t?.kind === "discipline" && !tier1Done) {
      flash(LOCKED_MSG);
      jumpTo("tier1");
      return;
    }
    jumpTo(id);
  }
  const railItems: RailItem[] = sections.map((sec) => {
    const p = sectionProgress(sec, draft, { tier1Done });
    return {
      key: sec.id,
      label: sec.title,
      done: p.done,
      total: p.total,
      badges: [
        ...(p.gate ? [{ tone: "prompt" as const, n: 1, title: LOCKED_MSG, text: "needs answers" }] : []),
        ...(photoCounts[sec.id] ? [{ tone: "photo" as const, n: photoCounts[sec.id], title: `${photoCounts[sec.id]} photo${photoCounts[sec.id] === 1 ? "" : "s"}`, text: `${photoCounts[sec.id]} photo${photoCounts[sec.id] === 1 ? "" : "s"}` }] : []),
      ],
      muted: sec.kind === "discipline" && !tier1Done,
    };
  });

  const stageBg = (i: number) => (i === curStageIdx ? ACCENT : i < curStageIdx ? ACCENT_SOFT : "#f1f2f5");
  const stageCol = (i: number) => (i === curStageIdx ? "#fff" : i < curStageIdx ? ACCENT_INK : "#9aa0ab");

  return (
    <div ref={rootRef} style={{ minHeight: "100vh", fontFamily: "var(--font-ui)", color: "#16181d", background: "#f7f8fa" }}>
      <style>{`
        .sv-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:13px 14px; }
        .sv-rail::-webkit-scrollbar { display:none; }
        .sv-rail { -ms-overflow-style:none; scrollbar-width:none; }
        .sv-inv-row { display:grid; grid-template-columns:minmax(130px,1.3fr) 68px 44px minmax(110px,1fr) 40px; gap:7px; align-items:stretch; }
        .sv-inv-row.sv-inv-pos { grid-template-columns:minmax(120px,1.2fr) minmax(104px,.9fr) 64px 44px minmax(100px,1fr) 40px; }
        .va-layout { display:grid; grid-template-columns: 230px minmax(0,1fr); gap: 18px; align-items: start; max-width: 1160px; margin: 0 auto; }
        @media (max-width:759px){ .va-layout{ display:block; } }
        ${SECTION_RAIL_CSS}
        @media (max-width:640px){ .sv-grid{ grid-template-columns:1fr !important; } .sv-pad{ padding-left:15px !important; padding-right:15px !important; } .sv-inv-row{ grid-template-columns:minmax(0,1.3fr) 58px 42px minmax(0,1fr) 38px; } .sv-inv-row.sv-inv-pos{ grid-template-columns:minmax(0,1fr) minmax(0,1fr) 54px 42px 38px; } .sv-inv-pos .sv-inv-notes{ grid-column:1 / -1; order:1; } .va-lineset-desktop{ display:none !important; } .va-lineset-mobile{ display:flex !important; } .va-condition-row,.va-cert-row{ grid-template-columns:1fr !important; } }
      `}</style>

      {/* sticky header */}
      <div ref={headRef} style={{ position: "sticky", top: 0, zIndex: 24, background: "#fff", borderBottom: "1px solid #ececf0", boxShadow: "0 1px 2px rgba(0,0,0,.04)" }}>
        <div className="sv-pad" style={{ display: "flex", alignItems: "center", gap: 14, maxWidth: 900, margin: "0 auto", padding: "11px 24px", flexWrap: "wrap", rowGap: 10 }}>
          <Link href="/venue-assessments" style={{ display: "flex", alignItems: "center", gap: 7, flexShrink: 0, fontSize: 13, fontWeight: 600, color: "#5b616e", background: "#f1f2f5", borderRadius: 9, padding: "9px 13px", textDecoration: "none", minHeight: 42, boxSizing: "border-box" }}>
            <span style={{ fontSize: 15, lineHeight: 1 }}>←</span> Assessments
          </Link>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 600, lineHeight: 1.25, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2, flexWrap: "wrap" }}>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "#aab0bb" }}>{sub}</span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 9.5, fontWeight: 600, padding: "2px 8px", borderRadius: 6, color: savePillInk, background: savePillBg }}>{savePillLabel}</span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 9.5, fontWeight: 600, padding: "2px 8px", borderRadius: 6, color: intakeMeta.ink, background: intakeMeta.soft, border: `1px solid ${intakeMeta.bd}` }}>{intakeMeta.label}</span>
            </div>
          </div>
          <RecordingsStrip parentKind="survey" parentId={record.id} recordings={recordings} canRecord={canShowRecord} />
          {canSuggest && (
            <SuggestEstimate
              source={{ kind: "survey", id: record.id }}
              readyHref={suggestionHref}
              disabled={dirty || saving}
              disabledTitle={saving ? "Saving…" : "Save your changes first — Assist reads the saved assessment"}
              compact
              buttonStyle={{ fontSize: 13, color: "#5b616e", borderRadius: 9, padding: "10px 14px", minHeight: 42 }}
            />
          )}
          <button onClick={onPrintSheet} disabled={saving} style={{ flexShrink: 0, fontSize: 13, fontWeight: 600, color: "#5b616e", background: "#fff", border: "1px solid #e4e7ec", borderRadius: 9, padding: "10px 14px", cursor: saving ? "default" : "pointer", minHeight: 42 }}>
            Print sheet
          </button>
          <DeleteSurveyButton onDelete={onDelete} disabled={saving} />
          <button onClick={onSave} disabled={saving} style={{ flexShrink: 0, fontSize: 13.5, fontWeight: 600, color: "#fff", background: ACCENT, border: "none", borderRadius: 9, padding: "11px 20px", cursor: saving ? "default" : "pointer", minHeight: 42, opacity: saving ? 0.7 : 1 }}>
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>

        {/* stage pills + action */}
        <div className="sv-pad" style={{ display: "flex", alignItems: "center", gap: 12, maxWidth: 900, margin: "0 auto", padding: "11px 24px", borderTop: "1px solid #f4f5f7", flexWrap: "wrap", rowGap: 10 }}>
          <div className="sv-rail" style={{ display: "flex", alignItems: "center", gap: 7, overflowX: "auto", minWidth: 0 }}>
            {meta.stages.map((st, i) => (
              <button key={st.key} onClick={() => advanceStage(st.key)} style={{ fontFamily: "var(--font-ui)", fontSize: 12, fontWeight: 600, border: "none", borderRadius: 20, padding: "8px 13px", cursor: "pointer", whiteSpace: "nowrap", minHeight: 36, flexShrink: 0, color: stageCol(i), background: stageBg(i) }}>
                {st.label}
              </button>
            ))}
          </div>
          {assignInfo && <span style={{ fontSize: 12, color: "#8c919c", whiteSpace: "nowrap" }}>{assignInfo}</span>}
          <div style={{ flex: 1, minWidth: 8 }} />
          <button onClick={stageAction} disabled={saving} style={{ flexShrink: 0, fontSize: 13, fontWeight: 600, color: "#fff", background: ACCENT, border: "none", borderRadius: 9, padding: "10px 16px", cursor: saving ? "default" : "pointer", minHeight: 40 }}>
            {stageActionLabel}
          </button>
        </div>

        {/* layout toggle + jump rail / stepper */}
        <div className="sv-pad" style={{ display: "flex", alignItems: "center", gap: 12, maxWidth: 900, margin: "0 auto", padding: "0 24px 11px", flexWrap: "wrap", rowGap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <span style={{ fontSize: 10.5, fontWeight: 600, color: "#aab0bb", letterSpacing: ".05em", textTransform: "uppercase", flexShrink: 0 }}>Layout</span>
            <div style={{ display: "flex", background: "#eceef1", borderRadius: 10, padding: 3 }}>
              <button onClick={() => setLayoutMode("long")} style={modeBtn(layoutMode === "long")}>Long scroll</button>
              <button onClick={() => setLayoutMode("wizard")} style={modeBtn(layoutMode === "wizard")}>Stepped</button>
            </div>
          </div>

          {layoutMode === "wizard" && (
            <div className="sv-rail" style={{ display: "flex", alignItems: "center", gap: 8, overflowX: "auto", flex: 1, minWidth: 0 }}>
              {stepsPresent.map((si, idx) => {
                const on = si === step;
                return (
                  <button key={si} onClick={() => gotoStep(si)} style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, fontFamily: "var(--font-ui)", fontSize: 12.5, fontWeight: 600, borderRadius: 9, padding: "8px 13px", cursor: "pointer", border: "none", whiteSpace: "nowrap", color: on ? "#fff" : "#787d87", background: on ? ACCENT : "#f4f5f7" }}>
                    <span style={{ width: 19, height: 19, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10.5, fontWeight: 700, flexShrink: 0, color: on ? ACCENT_INK : "#fff", background: on ? "#fff" : "#c4c9d2" }}>{idx + 1}</span>
                    {STEP_LABELS[si] || "Step " + (idx + 1)}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* body */}
      <div className="sv-pad" style={{ padding: "20px 24px 90px" }}>
        <div className={layoutMode === "long" ? "va-layout" : undefined} style={layoutMode === "long" ? undefined : { maxWidth: 900, margin: "0 auto" }}>
          {layoutMode === "long" && (
            <SectionRail items={railItems} active={shownActive} onPick={pickFromRail} ariaLabel="Sections" sheetLabel="Jump to section" top={headH + 12} maxHeight={railMax} />
          )}
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {sectionSketches.overlay}
              {sectionPhotos.overlay}
              {meetingsSlot}
              {visibleSections.map((sec, secIdx) => {
                const locked = sec.kind === "discipline" && !tier1Done;
                const collapsible = !locked;
                const open = locked ? false : isOpen(sec);
                const showGroupHeader = layoutMode !== "wizard" && (secIdx === 0 || visibleSections[secIdx - 1].group !== sec.group);
                const headerClick = () => {
                  if (locked) {
                    flash(LOCKED_MSG);
                    jumpTo("tier1");
                  } else {
                    toggleSection(sec);
                  }
                };
                return (
                  <div key={sec.id}>
                    {showGroupHeader && (
                      <div style={{ display: "flex", alignItems: "baseline", gap: 10, margin: "6px 2px 10px", flexWrap: "wrap" }}>
                        <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "#5b616e" }}>
                          {GROUP_META[sec.group].label}
                        </span>
                        <span style={{ fontSize: 11.5, color: "#aab0bb" }}>
                          {GROUP_META[sec.group].blurb}
                        </span>
                      </div>
                    )}
                    <div id={"sec-" + sec.id} style={{ scrollMarginTop: headH + 12, background: "#fff", border: "1px solid #ececf0", borderRadius: 14, boxShadow: "0 1px 2px rgba(0,0,0,.04)", overflow: "hidden", opacity: locked ? 0.72 : 1 }}>
                      <div
                        onClick={headerClick}
                        role="button"
                        aria-disabled={locked || undefined}
                        tabIndex={0}
                        aria-expanded={open}
                        aria-controls={open ? "sec-body-" + sec.id : undefined}
                        onKeyDown={(e) => {
                          if (e.target !== e.currentTarget) return;
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            headerClick();
                          }
                        }}
                        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: `16px 18px ${open ? "10px" : "16px"}`, cursor: "pointer" }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 14.5, fontWeight: 600, letterSpacing: "-.01em" }}>{sec.title}</div>
                          {sec.subtitle && <div style={{ fontSize: 12, color: "#9aa0ab", marginTop: 2 }}>{locked ? "Locked — answer the kill questions above first" : sec.subtitle}</div>}
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                          {!locked && sec.kind !== "photos" && sectionPhotos.addButton(sec.id)}
                          {locked && (
                            <span style={{ display: "inline-flex", color: "#aab0bb" }} title="Complete the kill questions to unlock">
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <rect x="3" y="11" width="18" height="11" rx="2" />
                                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                              </svg>
                            </span>
                          )}
                          {collapsible && (
                            <span style={{ fontSize: 11, color: "#aab0bb", display: "inline-block", transition: "transform .15s ease", transform: open ? "rotate(180deg)" : "none" }}>▾</span>
                          )}
                        </div>
                      </div>

                      {!locked && sectionPhotos.strip(sec.id)}
                      {open && (
                        <div id={"sec-body-" + sec.id} style={{ padding: "4px 18px 20px" }}>
                          {sectionSketches.tiles(sec.id, sec.kind === "fields" ? sec.fields.map((f) => f.key) : undefined)}
                          {sec.kind === "custvenue" && (
                            <CustVenueSection
                              draft={draft}
                              patchDraft={patchDraft}
                              setField={setField}
                              customers={customers}
                              linkedCust={linkedCust}
                              custLocs={custLocs}
                              venueHasLocs={venueHasLocs}
                              custNew={custNew}
                              setCustNew={setCustNew}
                              venueOther={venueOther}
                              setCustomerSel={setCustomerSel}
                              setVenueSel={setVenueSel}
                            />
                          )}
                          {sec.kind === "fields" && (
                            <FieldsSection
                              fields={sec.fields}
                              draft={draft}
                              patchDraft={patchDraft}
                              mv={mv}
                              setMeasure={setMeasure}
                              toggleMeasure={toggleMeasure}
                              toggleBtn={toggleBtn}
                              boxStyle={boxStyle}
                              dv={dv}
                              setDisc={setDisc}
                              aside={sectionSketches.aside}
                            />
                          )}
                          {sec.id === "notes" && fromRecording.length > 0 && (
                            <div style={{ display: "grid", gap: 8, marginTop: 14 }}>
                              {fromRecording.map((p) => (
                                <FromRecordingPanel
                                  key={p.recordingId}
                                  recordingId={p.recordingId}
                                  title={p.title}
                                  sections={p.sections}
                                  target="survey"
                                  disabled={dirty}
                                  disabledHint="Save your changes first — Insert appends to the saved survey."
                                  onInserted={() => setAdoptNextRecord(true)}
                                />
                              ))}
                            </div>
                          )}
                          {sec.kind === "tier1" && (
                            <KillQuestions
                              draft={draft}
                              items={tier1}
                              onJump={jumpTo}
                              onScope={(next) => setField("scope", next)}
                              onRigSystems={(next) =>
                                patchDraft({
                                  disciplines: { ...draft.disciplines, rigging: { ...(draft.disciplines.rigging || {}), present: next } },
                                })
                              }
                              mv={mv}
                              setMeasure={setMeasure}
                              chipStyle={chipStyle}
                              footer={
                                <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
                                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, fontWeight: 600, padding: "4px 10px", borderRadius: 20, color: intakeMeta.ink, background: intakeMeta.soft, border: `1px solid ${intakeMeta.bd}` }}>
                                    {intakeMeta.label}
                                  </span>
                                  <span style={{ fontSize: 12, color: "#9aa0ab" }}>
                                    {tier1Done
                                      ? "Discipline intakes are unlocked."
                                      : "The record saves as a draft any time — but discipline intakes stay locked until these are answered."}
                                  </span>
                                  <div style={{ flex: 1, minWidth: 8 }} />
                                  {intakeSt === "discipline-added" && (
                                    <button onClick={() => setField("intakeReady", true)} style={{ fontSize: 12.5, fontWeight: 600, color: "#fff", background: "#1f7a52", border: "none", borderRadius: 9, padding: "9px 14px", cursor: "pointer", minHeight: 38 }}>
                                      Mark ready for quote
                                    </button>
                                  )}
                                  {intakeSt === "ready-for-quote" && (
                                    <button onClick={() => setField("intakeReady", false)} style={{ fontSize: 12.5, fontWeight: 600, color: "#1f7a52", background: "#eaf6ef", border: "1px solid #cce9da", borderRadius: 9, padding: "9px 14px", cursor: "pointer", minHeight: 38 }}>
                                      ✓ Ready — undo
                                    </button>
                                  )}
                                </div>
                              }
                            />
                          )}
                          {sec.kind === "discipline" && (() => {
                            const g = DISCIPLINE_GROUPS.find((x) => x.key === sec.disc);
                            if (!g) return null;
                            return (
                              <SystemsSection
                                group={g}
                                venueClass={draft.venueClass}
                                intakeCatalog={meta.intakeCatalog}
                                fabricOptions={meta.fabricOptions}
                                value={dv}
                                setValue={setDisc}
                                measureValue={mv}
                                setMeasure={setMeasure}
                                inventoryRows={invRows}
                                addInventoryRow={addInvRow}
                                patchInventoryRow={patchInvRow}
                                removeInventoryRow={removeInvRow}
                                presentFromKill={g.key === "rigging"}
                                onJumpKill={() => jumpTo("tier1")}
                              />
                            );
                          })()}
                          {sec.kind === "linesets" && (
                            <LinesetsSection
                              handSheet={sectionSketches.linesetSheet()}
                              qty={draft.linesetQty}
                              rows={draft.linesets}
                              onApply={applyLinesets}
                              onRemove={removeLineset}
                              onChange={patchLineset}
                            />
                          )}
                          {sec.kind === "assessmentToggle" && (
                            <button
                              type="button"
                              onClick={() => setField("assessmentEnabled", !draft.assessmentEnabled)}
                              style={{ display: "flex", alignItems: "center", gap: 11, width: "100%", textAlign: "left", border: `1px solid ${draft.assessmentEnabled ? ACCENT_BORDER_LT : "#e4e7ec"}`, borderRadius: 10, padding: "12px 13px", background: draft.assessmentEnabled ? ACCENT_SOFT : "#fff", color: draft.assessmentEnabled ? ACCENT_INK : "#5b616e", cursor: "pointer" }}
                            >
                              <span style={boxStyle(draft.assessmentEnabled)}>{draft.assessmentEnabled ? "✓" : ""}</span>
                              <span><strong style={{ display: "block", fontSize: 13.5 }}>Add Condition & Needs assessment</strong><span style={{ display: "block", marginTop: 2, fontSize: 11.5, color: "#8c919c" }}>Use when the customer has no defined ask or needs a formal deliverable.</span></span>
                            </button>
                          )}
                          {sec.kind === "assessmentUsage" && (
                            <AssessmentUsageSection
                              assessment={draft.assessment}
                              roster={roster}
                              quote={{ budget: draft.budget, fiscalYearSpendBy: draft.fiscalYearSpendBy, whoDecides: draft.whoDecides, targetInstallWindow: draft.targetInstallWindow, quoteNeededBy: draft.quoteNeededBy }}
                              onAssessment={(assessment) => setField("assessment", assessment)}
                              onQuoteField={(key, value) => setField(key, value)}
                            />
                          )}
                          {sec.kind === "assessmentCondition" && (
                            <AssessmentConditionSection assessment={draft.assessment} autoCerts={meta.autoCerts} onChange={(assessment) => setField("assessment", assessment)} />
                          )}
                          {sec.kind === "assessmentFindings" && (
                            <AssessmentFindingsSection assessment={draft.assessment} photos={draft.photos} onChange={(assessment) => setField("assessment", assessment)} />
                          )}
                          {sec.kind === "recap" && <RecapSection draft={draft} />}
                          {sec.kind === "finalThoughts" && (
                            <FinalThoughtsSection draft={draft} tags={meta.internalTags} onTags={(next) => setField("internalTags", next)} chipStyle={chipStyle} />
                          )}
                          {sec.kind === "viz3d" && <Venue3D venueClass={draft.venueClass} venueSubtype={draft.venueSubtype} measurements={draft.measurements} />}
                          {sec.kind === "photos" && (
                            <PhotosSection draft={draft} />
                          )}
                          <OlderNotes notes={draft.legacyNotes.filter((n) => n.section === sec.id)} />
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {saveError && (
              <div style={{ marginTop: 16, display: "flex", alignItems: "flex-start", gap: 9, background: "#f9ece8", border: "1px solid #f0d6cd", borderRadius: 11, padding: "13px 15px", color: "#b4543a", fontSize: 13, lineHeight: 1.5 }}>
                {saveError}
              </div>
            )}

            {layoutMode === "wizard" && (
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 20 }}>
                {curStepIdx > 0 && (
                  <button onClick={() => gotoStep(stepsPresent[Math.max(0, curStepIdx - 1)])} style={{ fontSize: 13.5, fontWeight: 600, color: "#5b616e", background: "#fff", border: "1px solid #e4e7ec", borderRadius: 10, padding: "12px 20px", cursor: "pointer", minHeight: 46 }}>← Back</button>
                )}
                <div style={{ flex: 1 }} />
                {curStepIdx < stepsPresent.length - 1 ? (
                  <button onClick={() => gotoStep(stepsPresent[Math.min(stepsPresent.length - 1, curStepIdx + 1)])} style={{ fontSize: 13.5, fontWeight: 600, color: "#fff", background: ACCENT, border: "none", borderRadius: 10, padding: "12px 22px", cursor: "pointer", minHeight: 46 }}>Next →</button>
                ) : (
                  <button onClick={onSave} disabled={saving} style={{ fontSize: 13.5, fontWeight: 600, color: "#fff", background: ACCENT, border: "none", borderRadius: 10, padding: "12px 22px", cursor: saving ? "default" : "pointer", minHeight: 46 }}>{saving ? "Saving…" : "Save changes"}</button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {toast && (
        <div style={{ position: "fixed", left: "50%", bottom: 22, transform: "translateX(-50%)", zIndex: 90, display: "flex", alignItems: "center", gap: 11, background: "#16181d", color: "#fff", borderRadius: 12, padding: "13px 17px", boxShadow: "0 12px 40px rgba(0,0,0,.3)", maxWidth: "92vw" }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#5fd29a", flexShrink: 0 }} />
          <span style={{ fontSize: 13, lineHeight: 1.4 }}>{toast}</span>
        </div>
      )}
    </div>
  );
}
