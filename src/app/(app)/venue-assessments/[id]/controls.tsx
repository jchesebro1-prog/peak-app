"use client";

import { useMemo, useRef, useState, type CSSProperties, type ChangeEvent } from "react";
import Link from "next/link";
import type {
  SurveyRecord,
  SurveyPhoto,
  SurveyStage,
  SurveyStageMeta,
  MeasureField,
  MeasureGroup,
} from "@/lib/stores/surveys";
import {
  AUDITORIUM_SIZES,
  DISCIPLINE_GROUPS,
  INTAKE_STATUS_META,
  SYSTEM_KEYS,
  blankSystemsState,
  intakeStatus,
  newInventoryId,
  tier1Items,
  tier1Complete,
  type DisciplineData,
  type DisciplineKey,
  type InventoryRow,
  type SystemState,
} from "@/lib/stores/survey-intake";
import { saveSurvey, advanceSurveyStage, deleteSurvey, createQuoteFromSurvey, type SurveyPatch } from "./actions";
import Venue3D from "./venue-3d";
import { saveThroughOutbox } from "@/lib/sync/save";

/* ============================================================
 * Serializable props from the server. The store is DB-backed and cannot be
 * imported into a client bundle — its pure meta/option-lists are handed over
 * here, and the pure helpers below operate on them.
 * ============================================================ */

export type EditorCustomer = {
  id: string;
  name: string;
  type: string;
  location: string;
  locations: Array<{ id: string; label: string; primary: boolean; city: string; state: string }>;
  primaryContact: { name: string; email: string } | null;
};

export type EditorMeta = {
  venueTypes: string[];
  visitTypes: string[];
  floorTypes: string[];
  liftTypes: string[];
  liftSuppliers: string[];
  installTimeframes: string[];
  conditions: string[];
  stages: Array<{ key: SurveyStage; label: string }>;
  stageMeta: Record<SurveyStage, SurveyStageMeta>;
  measureGroups: MeasureGroup[];
  measureFieldsByType: Record<string, MeasureField[]>;
  defaultMeasureFields: MeasureField[];
  /** settings-merged site-intake type catalog, keyed by category */
  intakeCatalog: Record<string, string[]>;
};

/** Local draft — the editable slice of the record plus updatedAt for display. */
type Draft = {
  customer: string;
  customerId: string | null;
  locationId: string | null;
  venue: string;
  venueType: string;
  address: string;
  contact: string;
  contactPhone: string;
  contactEmail: string;
  visitType: string;
  reason: string;
  travelTime: string;
  distance: string;
  hasBOM: boolean;
  hasDrawings: boolean;
  hasPhotos: boolean;
  quoteNeededBy: string;
  budgetary: boolean;
  projectCompletion: string;
  installTimeframe: string;
  loadingDock: string;
  elevatorSize: string;
  floorType: string;
  accessDoorSize: string;
  liftNeeded: string;
  liftSupplier: string;
  scopeOfWork: string;
  quoteLook: string;
  notes: string;
  stage: SurveyStage;
  assignedTo: string;
  scheduledDate: string;
  requestedBy: string;
  measurements: Record<string, string | boolean>;
  conditions: string[];
  photos: SurveyPhoto[];
  // Site Intake extension (IDEAS #45)
  auditoriumSize: string;
  yearBuilt: string;
  systemsState: Record<string, SystemState>;
  disciplines: Record<string, DisciplineData>;
  disciplinesActive: string[];
  inventory: InventoryRow[];
  intakeReady: boolean;
  updatedAt: number;
};

/* ---------- accent tints ---------- */
const ACCENT = "var(--accent)";
const ACCENT_SOFT = "color-mix(in srgb, var(--accent) 13%, #fff)";
const ACCENT_INK = "color-mix(in srgb, var(--accent) 70%, #000)";
const ACCENT_BORDER_LT = "color-mix(in srgb, var(--accent) 30%, #fff)";

/* ---------- shared field styles ---------- */
const labelStyle: CSSProperties = {
  fontSize: 10.5,
  fontWeight: 600,
  color: "#9aa0ab",
  letterSpacing: ".04em",
  textTransform: "uppercase",
  marginBottom: 6,
  display: "block",
};
const inpStyle: CSSProperties = {
  width: "100%",
  fontFamily: "var(--font-ui)",
  fontSize: 16,
  color: "#16181d",
  border: "1px solid #e4e7ec",
  borderRadius: 10,
  padding: "12px 13px",
  outline: "none",
  background: "#fff",
};
const selStyle: CSSProperties = { ...inpStyle, cursor: "pointer" };
const measStyle: CSSProperties = { ...inpStyle, fontFamily: "var(--font-mono)", padding: "11px 12px" };
const taStyle: CSSProperties = { ...inpStyle, minHeight: 88, resize: "vertical", lineHeight: 1.5 };

/* ---------- field / section model ---------- */
type FieldDef =
  | { kind: "text"; key: string; label: string; full?: boolean; type?: string; inputMode?: string; placeholder?: string }
  | { kind: "select"; key: string; label: string; options: string[]; full?: boolean; measure?: boolean }
  | { kind: "measure"; key: string; label: string; full?: boolean }
  | { kind: "toggle"; key: string; label: string; full?: boolean }
  | { kind: "textarea"; key: string; label: string; placeholder?: string }
  | { kind: "checkTop"; key: string; label: string }
  | { kind: "checkMeasure"; key: string; label: string };

type SectionDef = {
  id: string;
  title: string;
  subtitle: string;
  group: "brief" | "field" | "intake";
  step: number;
  advanced?: boolean;
} & (
  | { kind: "custvenue" }
  | { kind: "fields"; fields: FieldDef[] }
  | { kind: "conditions" }
  | { kind: "photos" }
  | { kind: "viz3d" }
  | { kind: "tier1" }
  | { kind: "systems" }
  | { kind: "discipline"; disc: DisciplineKey }
);

const STEP_LABELS = ["Brief", "Site & access", "Measurements", "Site intake", "Details"];
const STEP_BY_ID: Record<string, number> = {
  cust: 0, visit: 0, project: 0, assign: 0, site: 1, conditions: 1,
  mQuick: 2, mLayout: 2, mSection: 2, mBeams: 2, mFOH: 2, mHouse: 2, m3d: 2,
  tier1: 3, systems: 3, dRigging: 3, dCurtain: 3, dLighting: 3, dAv: 3,
  photos: 4, notes: 4,
};
const BRIEF_IDS: Record<string, boolean> = { cust: true, visit: true, project: true, assign: true };
const INTAKE_IDS: Record<string, boolean> = { tier1: true, systems: true, dRigging: true, dCurtain: true, dLighting: true, dAv: true };
const ORDER = ["cust", "visit", "project", "assign", "site", "conditions", "mQuick", "mLayout", "mSection", "mBeams", "mFOH", "mHouse", "m3d", "tier1", "systems", "dRigging", "dCurtain", "dLighting", "dAv", "photos", "notes"];
const DISC_SECTION_ID: Record<DisciplineKey, string> = { rigging: "dRigging", curtain: "dCurtain", lighting: "dLighting", av: "dAv" };

let photoSeq = 0;
function newPhotoId(): string {
  photoSeq += 1;
  return "p" + Date.now().toString(36) + photoSeq.toString(36);
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

function toDraft(r: SurveyRecord): Draft {
  return {
    customer: r.customer || "",
    customerId: r.customerId ?? null,
    locationId: r.locationId ?? null,
    venue: r.venue || "",
    venueType: r.venueType || "",
    address: r.address || "",
    contact: r.contact || "",
    contactPhone: r.contactPhone || "",
    contactEmail: r.contactEmail || "",
    visitType: r.visitType || "",
    reason: r.reason || "",
    travelTime: r.travelTime || "",
    distance: r.distance || "",
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
    auditoriumSize: r.auditoriumSize || "",
    yearBuilt: r.yearBuilt || "",
    systemsState: { ...blankSystemsState(), ...(r.systemsState || {}) },
    disciplines: { ...(r.disciplines || {}) },
    disciplinesActive: [...(r.disciplinesActive || [])],
    inventory: [...(r.inventory || [])],
    intakeReady: !!r.intakeReady,
    updatedAt: r.updatedAt || 0,
  };
}

type LayoutMode = "long" | "wizard" | "accordion";

export default function SurveyEditor({
  record,
  customers,
  roster,
  meta,
}: {
  record: SurveyRecord;
  customers: EditorCustomer[];
  roster: string[];
  meta: EditorMeta;
}) {
  const initial = useMemo<Draft>(() => toDraft(record), [record]);
  const [draft, setDraft] = useState<Draft>(initial);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [custNew, setCustNew] = useState(!record.customerId && !!(record.customer || "").trim());
  const [venueOther, setVenueOther] = useState(false);
  const [layoutMode, setLayoutMode] = useState<LayoutMode>("long");
  const [step, setStep] = useState(0);
  const [openSet, setOpenSet] = useState<Record<string, boolean>>({ cust: true });
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
  const toggleCondition = (c: string) => {
    const set = draft.conditions.slice();
    const i = set.indexOf(c);
    if (i >= 0) set.splice(i, 1);
    else set.push(c);
    patchDraft({ conditions: set });
  };

  /* ---------- site intake: discipline data + inventory helpers ---------- */
  const tier1 = tier1Items(draft);
  const tier1Done = tier1Complete(draft);
  const intakeSt = intakeStatus(draft);
  const intakeMeta = INTAKE_STATUS_META[intakeSt];

  const dv = (disc: DisciplineKey, key: string): string | boolean | string[] => {
    const d = draft.disciplines[disc];
    return d && d[key] != null ? d[key] : "";
  };
  const setDisc = (disc: DisciplineKey, key: string, val: string | boolean | string[]) =>
    patchDraft({
      disciplines: { ...draft.disciplines, [disc]: { ...(draft.disciplines[disc] || {}), [key]: val } },
      disciplinesActive: draft.disciplinesActive.includes(disc)
        ? draft.disciplinesActive
        : draft.disciplinesActive.concat(disc),
    });
  const toggleDiscScope = (disc: DisciplineKey, opt: string) => {
    const cur = dv(disc, "scope");
    const set = Array.isArray(cur) ? cur.slice() : [];
    const i = set.indexOf(opt);
    if (i >= 0) set.splice(i, 1);
    else set.push(opt);
    setDisc(disc, "scope", set);
  };
  const setSystem = (key: string, patch: Partial<SystemState>) =>
    patchDraft({
      systemsState: {
        ...draft.systemsState,
        [key]: { ...(draft.systemsState[key] || { installed: "", desc: "" }), ...patch },
      },
    });

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

  /* ---------- photos (client-side downscale — metadata-only placeholder, no upload) ---------- */
  function readPhoto(file: File): Promise<SurveyPhoto | null> {
    return new Promise((resolve) => {
      const fr = new FileReader();
      fr.onload = () => {
        const result = fr.result as string;
        const img = new Image();
        img.onload = () => {
          const max = 1200;
          let w = img.width;
          let h = img.height;
          if (w > max || h > max) {
            const r = Math.min(max / w, max / h);
            w = Math.round(w * r);
            h = Math.round(h * r);
          }
          let url: string;
          try {
            const c = document.createElement("canvas");
            c.width = w;
            c.height = h;
            c.getContext("2d")!.drawImage(img, 0, 0, w, h);
            url = c.toDataURL("image/jpeg", 0.7);
          } catch {
            url = result;
          }
          resolve({ id: newPhotoId(), name: file.name || "photo.jpg", dataUrl: url });
        };
        img.onerror = () => resolve(null);
        img.src = result;
      };
      fr.onerror = () => resolve(null);
      fr.readAsDataURL(file);
    });
  }
  async function onPhotos(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    try {
      e.target.value = "";
    } catch {}
    if (!files.length) return;
    const room = Math.max(0, 8 - draft.photos.length);
    if (room <= 0) {
      setSaveError("Up to 8 photos per survey. Remove one to add another.");
      return;
    }
    const added: SurveyPhoto[] = [];
    for (const f of files.slice(0, room)) {
      const p = await readPhoto(f);
      if (p) added.push(p);
    }
    setSaveError("");
    patchDraft({ photos: draft.photos.concat(added) });
  }
  const removePhoto = (id: string) => patchDraft({ photos: draft.photos.filter((p) => p.id !== id) });

  /* ---------- sections ---------- */
  const sections = useMemo<SectionDef[]>(() => {
    const quick = meta.measureFieldsByType[draft.venueType] || meta.defaultMeasureFields;
    const groupFields = (g: MeasureGroup): FieldDef[] =>
      g.fields.map((f) => {
        if (f.type === "select") return { kind: "select", key: f.key, label: f.label, options: f.options || [], measure: true };
        if (f.type === "check") return { kind: "checkMeasure", key: f.key, label: f.label };
        return { kind: "measure", key: f.key, label: f.label };
      });

    const secs: SectionDef[] = [];
    secs.push({ id: "cust", title: "Customer & venue", subtitle: "Who and where", group: "brief", step: 0, kind: "custvenue" });
    secs.push({
      id: "visit", title: "Visit", subtitle: "Purpose & travel", group: "brief", step: 0, kind: "fields",
      fields: [
        { kind: "select", key: "visitType", label: "Type of visit", options: meta.visitTypes },
        { kind: "text", key: "travelTime", label: "Travel time", placeholder: "e.g. 35 min" },
        { kind: "text", key: "distance", label: "Distance", placeholder: "e.g. 22 mi" },
        { kind: "textarea", key: "reason", label: "Reason / scope of visit", placeholder: "Why are we here? What triggered the visit?" },
      ],
    });
    secs.push({
      id: "project", title: "Existing materials & quote", subtitle: "What we have on file, and what the quote needs", group: "brief", step: 1, kind: "fields",
      fields: [
        { kind: "checkTop", key: "hasBOM", label: "Existing BOM on file" },
        { kind: "checkTop", key: "hasDrawings", label: "Existing drawings on file" },
        { kind: "checkTop", key: "hasPhotos", label: "Existing photos on file" },
        { kind: "text", key: "quoteNeededBy", label: "Quote needed by", type: "date" },
        { kind: "toggle", key: "budgetary", label: "Is it budgetary?" },
        { kind: "text", key: "projectCompletion", label: "Project completion", type: "date" },
        { kind: "select", key: "installTimeframe", label: "Install timeframe", options: meta.installTimeframes },
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
        { kind: "select", key: "liftNeeded", label: "Kind of lift needed", options: meta.liftTypes },
        { kind: "select", key: "liftSupplier", label: "Who supplies lift", options: meta.liftSuppliers },
      ],
    });
    secs.push({ id: "conditions", title: "Site conditions", subtitle: "Quick tags", group: "field", step: 1, kind: "conditions" });
    secs.push({
      id: "mQuick", title: "Measurements", subtitle: "Feet — type ft-in (38′-6″) or decimal (38.5)", group: "field", step: 2, kind: "fields",
      fields: quick.map((f) => ({ kind: "measure", key: f.key, label: f.label })),
    });
    meta.measureGroups.forEach((g) => {
      secs.push({ id: g.id, title: g.title, subtitle: g.subtitle, group: "field", step: 2, advanced: true, kind: "fields", fields: groupFields(g) });
    });
    // 3D preview (IDEAS #49 P1) — parametric model auto-built from measurements
    secs.push({ id: "m3d", title: "3D preview", subtitle: "Auto-built from measurements — drag to orbit", group: "field", step: 2, advanced: true, kind: "viz3d" });
    // ---- Site intake (IDEAS #45): kill-question gate, current systems,
    // discipline branches. Soft gate — sections lock until Tier 1 is done,
    // but the record always saves as a draft.
    secs.push({
      id: "tier1", title: "Kill questions", subtitle: "Required before the discipline intakes unlock",
      group: "intake", step: 3, kind: "tier1",
    });
    secs.push({
      id: "systems", title: "Existing systems", subtitle: "What's installed today — yes / no, then describe",
      group: "intake", step: 3, kind: "systems",
    });
    DISCIPLINE_GROUPS.forEach((g) => {
      secs.push({
        id: DISC_SECTION_ID[g.key], title: g.title, subtitle: g.subtitle,
        group: "intake", step: 3, advanced: true, kind: "discipline", disc: g.key,
      });
    });
    secs.push({ id: "photos", title: "Photos", subtitle: "Up to 8", group: "field", step: 4, kind: "photos" });
    secs.push({
      id: "notes", title: "Scope & notes", subtitle: "Free text", group: "field", step: 4, kind: "fields",
      fields: [
        { kind: "textarea", key: "scopeOfWork", label: "Scope of work", placeholder: "What are we scoping / installing?" },
        { kind: "textarea", key: "quoteLook", label: "How the quote should look", placeholder: "Format, breakdown, alternates the customer wants to see…" },
        { kind: "textarea", key: "notes", label: "Generic notes", placeholder: "Access, hazards, scheduling constraints…" },
      ],
    });
    secs.forEach((s) => {
      s.group = BRIEF_IDS[s.id] ? "brief" : INTAKE_IDS[s.id] ? "intake" : "field";
      if (STEP_BY_ID[s.id] != null) s.step = STEP_BY_ID[s.id];
    });
    secs.sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id));
    return secs;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.venueType, draft.requestedBy, meta, roster]);

  const measFilled = (fields: FieldDef[]): number =>
    fields.filter((f) => {
      const v = mv(f.key);
      return f.kind === "checkMeasure" ? !!v : String(v ?? "").trim() !== "";
    }).length;

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
  function buildPatch(over?: Partial<SurveyPatch>): SurveyPatch {
    return {
      customer: draft.customer,
      customerId: draft.customerId,
      locationId: draft.locationId,
      venue: draft.venue,
      venueType: draft.venueType,
      address: draft.address,
      contact: draft.contact,
      contactPhone: draft.contactPhone,
      contactEmail: draft.contactEmail,
      visitType: draft.visitType,
      reason: draft.reason,
      travelTime: draft.travelTime,
      distance: draft.distance,
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
      auditoriumSize: draft.auditoriumSize,
      yearBuilt: draft.yearBuilt,
      systemsState: draft.systemsState,
      disciplines: draft.disciplines,
      disciplinesActive: draft.disciplinesActive,
      inventory: draft.inventory,
      intakeReady: draft.intakeReady,
      ...over,
    };
  }
  /**
   * The WHOLE resulting survey document for the offline outbox
   * (/api/sync/push does a whole-doc upsert by id). Merge the SSR record with
   * the editor patch and stamp it the way the store's update() would when a
   * write reaches the cloud (synced, rev bumped).
   */
  function buildFullDoc(over?: Partial<SurveyPatch>): Record<string, unknown> {
    return {
      ...(record as unknown as Record<string, unknown>),
      ...(buildPatch(over) as Record<string, unknown>),
      updatedAt: Date.now(),
      rev: (record.rev || 1) + 1,
      syncState: "synced",
    };
  }
  async function onSave() {
    if (!validate() || saving) return;
    setSaving(true);
    try {
      const patch = buildPatch();
      const { queued } = await saveThroughOutbox({
        collection: "surveys",
        id: record.id,
        doc: buildFullDoc(),
        action: () => saveSurvey(record.id, patch),
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
    try {
      const patch = buildPatch({ stage: target });
      const { queued } = await saveThroughOutbox({
        collection: "surveys",
        id: record.id,
        doc: buildFullDoc({ stage: target }),
        action: () => advanceSurveyStage(record.id, patch, target),
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
      await createQuoteFromSurvey(record.id, buildPatch({ stage: "completed" }));
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
      setSaving(false);
    }
  }

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

  const isCollapsible = (sec: SectionDef) => layoutMode === "accordion" || !!sec.advanced;
  const isOpen = (sec: SectionDef) => (isCollapsible(sec) ? !!openSet[sec.id] : true);
  const toggleSection = (id: string) => setOpenSet((o) => ({ ...o, [id]: !o[id] }));

  const visibleSections = layoutMode === "wizard" ? sections.filter((s) => s.step === step) : sections;

  function jumpTo(id: string) {
    try {
      const el = document.getElementById("sec-" + id);
      if (el) {
        const y = el.getBoundingClientRect().top + window.pageYOffset - 128;
        window.scrollTo({ top: y, behavior: "smooth" });
      }
    } catch {}
  }
  function gotoStep(i: number) {
    setStep(i);
    try {
      window.scrollTo({ top: 0, behavior: "smooth" });
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

  function renderField(f: FieldDef) {
    const wrap: CSSProperties | undefined =
      "full" in f && f.full ? { gridColumn: "1 / -1" } : undefined;
    if (f.kind === "textarea") {
      return (
        <div key={f.key} style={{ gridColumn: "1 / -1" }}>
          <label style={labelStyle}>{f.label}</label>
          <textarea value={String(draft[f.key as keyof Draft] ?? "")} onChange={(e) => setField(f.key as keyof Draft, e.target.value as never)} placeholder={f.placeholder} style={taStyle} />
        </div>
      );
    }
    if (f.kind === "checkTop") {
      const c = !!draft[f.key as keyof Draft];
      return (
        <div key={f.key} style={{ gridColumn: "1 / -1" }}>
          <div onClick={() => setField(f.key as keyof Draft, !c as never)} style={{ display: "flex", alignItems: "center", gap: 11, padding: "12px 13px", border: "1px solid #e4e7ec", borderRadius: 10, cursor: "pointer", background: "#fff" }}>
            <span style={boxStyle(c)}>{c ? "✓" : ""}</span>
            <span style={{ fontSize: 14, fontWeight: 500, color: "#3a3f4a" }}>{f.label}</span>
          </div>
        </div>
      );
    }
    if (f.kind === "checkMeasure") {
      const c = !!mv(f.key);
      return (
        <div key={f.key} style={{ gridColumn: "1 / -1" }}>
          <div onClick={() => toggleMeasure(f.key)} style={{ display: "flex", alignItems: "center", gap: 11, padding: "12px 13px", border: "1px solid #e4e7ec", borderRadius: 10, cursor: "pointer", background: "#fff" }}>
            <span style={boxStyle(c)}>{c ? "✓" : ""}</span>
            <span style={{ fontSize: 14, fontWeight: 500, color: "#3a3f4a" }}>{f.label}</span>
          </div>
        </div>
      );
    }
    if (f.kind === "toggle") {
      const yes = draft[f.key as keyof Draft] === true;
      const no = draft[f.key as keyof Draft] === false;
      return (
        <div key={f.key} style={wrap}>
          <label style={labelStyle}>{f.label}</label>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setField(f.key as keyof Draft, true as never)} style={toggleBtn(yes)}>Yes</button>
            <button onClick={() => setField(f.key as keyof Draft, false as never)} style={toggleBtn(no)}>No</button>
          </div>
        </div>
      );
    }
    if (f.kind === "select") {
      const val = f.measure ? String(mv(f.key) ?? "") : String(draft[f.key as keyof Draft] ?? "");
      const onChange = (e: ChangeEvent<HTMLSelectElement>) =>
        f.measure ? setMeasure(f.key, e.target.value) : setField(f.key as keyof Draft, e.target.value as never);
      return (
        <div key={f.key} style={wrap}>
          <label style={labelStyle}>{f.label}</label>
          <select value={val} onChange={onChange} style={selStyle}>
            <option value="">— Select —</option>
            {f.options.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        </div>
      );
    }
    if (f.kind === "measure") {
      return (
        <div key={f.key} style={wrap}>
          <label style={labelStyle}>{f.label}</label>
          <input inputMode="text" value={String(mv(f.key) ?? "")} onChange={(e) => setMeasure(f.key, e.target.value)} placeholder="ft-in or ft" style={measStyle} />
        </div>
      );
    }
    // text
    return (
      <div key={f.key} style={wrap}>
        <label style={labelStyle}>{f.label}</label>
        <input type={f.type || "text"} inputMode={f.inputMode as never} value={String(draft[f.key as keyof Draft] ?? "")} onChange={(e) => setField(f.key as keyof Draft, e.target.value as never)} placeholder={f.placeholder} style={inpStyle} />
      </div>
    );
  }

  function renderCustVenue() {
    let customerOptions = customers.map((c) => ({ value: c.id, label: c.name }));
    if (draft.customerId && !linkedCust) customerOptions = customerOptions.concat([{ value: draft.customerId, label: draft.customer || draft.customerId }]);
    const custMetaSuffix = linkedCust ? " · " + [linkedCust.type, linkedCust.location].filter(Boolean).join(" · ") : "";
    const venuePickMode = venueHasLocs && !venueOther;
    return (
      <>
        <div style={{ marginBottom: 13 }}>
          <label style={labelStyle}>Customer</label>
          <select value={draft.customerId ? draft.customerId : custNew ? "__new__" : ""} onChange={(e) => setCustomerSel(e.target.value)} style={selStyle}>
            <option value="">— Select customer —</option>
            {customerOptions.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
            <option value="__new__">+ New customer (not in directory)</option>
          </select>
          {linkedCust && (
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 7, fontSize: 11.5, color: "#8c919c" }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: ACCENT, flexShrink: 0 }} />
              <span>Linked to directory{custMetaSuffix}</span>
            </div>
          )}
          {custNew && (
            <input value={draft.customer} onChange={(e) => { setCustNew(true); patchDraft({ customer: e.target.value, customerId: null }); }} placeholder="New customer name — e.g. Harbor Repertory Theatre" style={{ ...inpStyle, marginTop: 9 }} />
          )}
        </div>
        <div className="sv-grid">
          <div style={{ gridColumn: "1 / -1" }}>
            <label style={labelStyle}>Venue</label>
            {venuePickMode ? (
              <select value={draft.locationId ? draft.locationId : venueOther ? "__other__" : ""} onChange={(e) => setVenueSel(e.target.value)} style={selStyle}>
                <option value="">— Select venue —</option>
                {custLocs.map((l) => (
                  <option key={l.id} value={l.id}>{l.label + (l.city ? " · " + l.city : "")}</option>
                ))}
                <option value="__other__">Other venue…</option>
              </select>
            ) : (
              <input value={draft.venue} onChange={(e) => patchDraft({ venue: e.target.value, locationId: null })} placeholder={linkedCust ? "e.g. Main Hall" : "e.g. Main Auditorium"} style={inpStyle} />
            )}
          </div>
          <div>
            <label style={labelStyle}>Venue type</label>
            <select value={draft.venueType} onChange={(e) => setField("venueType", e.target.value)} style={selStyle}>
              {meta.venueTypes.map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Site address</label>
            <input value={draft.address} onChange={(e) => setField("address", e.target.value)} placeholder="Street, City, State" style={inpStyle} />
          </div>
          <div>
            <label style={labelStyle}>On-site contact</label>
            <input value={draft.contact} onChange={(e) => setField("contact", e.target.value)} placeholder="Name" style={inpStyle} />
          </div>
          <div>
            <label style={labelStyle}>Contact phone</label>
            <input type="tel" value={draft.contactPhone} onChange={(e) => setField("contactPhone", e.target.value)} placeholder="(000) 000-0000" style={inpStyle} />
          </div>
          <div>
            <label style={labelStyle}>Contact email</label>
            <input type="email" value={draft.contactEmail} onChange={(e) => setField("contactEmail", e.target.value)} placeholder="name@venue.org" style={inpStyle} />
          </div>
          <div>
            <label style={labelStyle}>Auditorium size</label>
            <select value={draft.auditoriumSize} onChange={(e) => setField("auditoriumSize", e.target.value)} style={selStyle}>
              <option value="">— Select —</option>
              {AUDITORIUM_SIZES.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Built year</label>
            <input inputMode="numeric" value={draft.yearBuilt} onChange={(e) => setField("yearBuilt", e.target.value)} placeholder="e.g. 1998" style={inpStyle} />
          </div>
        </div>
      </>
    );
  }

  /* ---------- site intake renderers ---------- */
  function renderDiscField(disc: DisciplineKey, f: MeasureField) {
    if (f.type === "check") {
      const c = dv(disc, f.key) === true;
      return (
        <div key={f.key} style={{ gridColumn: "1 / -1" }}>
          <div onClick={() => setDisc(disc, f.key, !c)} style={{ display: "flex", alignItems: "center", gap: 11, padding: "12px 13px", border: "1px solid #e4e7ec", borderRadius: 10, cursor: "pointer", background: "#fff" }}>
            <span style={boxStyle(c)}>{c ? "✓" : ""}</span>
            <span style={{ fontSize: 14, fontWeight: 500, color: "#3a3f4a" }}>{f.label}</span>
          </div>
        </div>
      );
    }
    if (f.type === "select") {
      return (
        <div key={f.key}>
          <label style={labelStyle}>{f.label}</label>
          <select value={String(dv(disc, f.key) || "")} onChange={(e) => setDisc(disc, f.key, e.target.value)} style={selStyle}>
            <option value="">— Select —</option>
            {(f.options || []).map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        </div>
      );
    }
    return (
      <div key={f.key}>
        <label style={labelStyle}>{f.label}</label>
        <input value={String(dv(disc, f.key) || "")} onChange={(e) => setDisc(disc, f.key, e.target.value)} style={inpStyle} />
      </div>
    );
  }

  function renderInventory(disc: DisciplineKey, category: string, label: string) {
    const rows = invRows(disc, category);
    const types = meta.intakeCatalog[category] || [];
    return (
      <div key={category} style={{ gridColumn: "1 / -1" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 7 }}>
          <label style={{ ...labelStyle, marginBottom: 0 }}>{label}</label>
          <span style={{ fontSize: 11, color: "#aab0bb" }}>type · qty · flag if it needs attention</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          {rows.map((r) => {
            const known = !r.type || types.includes(r.type);
            return (
              <div key={r.id} className="sv-inv-row">
                <select value={known ? r.type : "__custom__"} onChange={(e) => patchInvRow(r.id, { type: e.target.value === "__custom__" ? r.type || " " : e.target.value })} style={{ ...selStyle, padding: "10px 11px" }}>
                  <option value="">— Type —</option>
                  {types.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                  {!known && <option value="__custom__">{r.type}</option>}
                </select>
                <input inputMode="numeric" value={r.quantity} onChange={(e) => patchInvRow(r.id, { quantity: e.target.value })} placeholder="Qty" style={{ ...measStyle, padding: "10px 10px", textAlign: "center" }} />
                <button
                  onClick={() => patchInvRow(r.id, { flag: !r.flag })}
                  title="Flag — needs attention / replace / verify"
                  style={{ minHeight: 42, borderRadius: 9, cursor: "pointer", fontSize: 15, lineHeight: 1, border: `1px solid ${r.flag ? "#f0e2bd" : "#e4e7ec"}`, background: r.flag ? "#fbf3dd" : "#fff", color: r.flag ? "#8a6d1f" : "#c4c9d2" }}
                >
                  ⚑
                </button>
                <input value={r.notes} onChange={(e) => patchInvRow(r.id, { notes: e.target.value })} placeholder="Notes / model" style={{ ...inpStyle, padding: "10px 11px" }} />
                <button onClick={() => removeInvRow(r.id)} aria-label="Remove row" style={{ minHeight: 42, borderRadius: 9, cursor: "pointer", fontSize: 16, lineHeight: 1, border: "1px solid #e4e7ec", background: "#fff", color: "#aab0bb" }}>
                  ×
                </button>
              </div>
            );
          })}
        </div>
        <button
          onClick={() => addInvRow(disc, category)}
          style={{ marginTop: rows.length ? 8 : 0, fontSize: 12.5, fontWeight: 600, color: ACCENT_INK, background: ACCENT_SOFT, border: `1px solid ${ACCENT_BORDER_LT}`, borderRadius: 9, padding: "9px 13px", cursor: "pointer", minHeight: 38 }}
        >
          + Add {label.toLowerCase().replace(/s$/, "")}
        </button>
      </div>
    );
  }

  const stageBg = (i: number) => (i === curStageIdx ? ACCENT : i < curStageIdx ? ACCENT_SOFT : "#f1f2f5");
  const stageCol = (i: number) => (i === curStageIdx ? "#fff" : i < curStageIdx ? ACCENT_INK : "#9aa0ab");

  let prevGroup: string | null = null;

  return (
    <div style={{ minHeight: "100vh", fontFamily: "var(--font-ui)", color: "#16181d", background: "#f7f8fa" }}>
      <style>{`
        .sv-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:13px 14px; }
        .sv-rail::-webkit-scrollbar { display:none; }
        .sv-rail { -ms-overflow-style:none; scrollbar-width:none; }
        .sv-inv-row { display:grid; grid-template-columns:minmax(130px,1.3fr) 68px 44px minmax(110px,1fr) 40px; gap:7px; align-items:stretch; }
        @media (max-width:640px){ .sv-grid{ grid-template-columns:1fr !important; } .sv-pad{ padding-left:15px !important; padding-right:15px !important; } .sv-inv-row{ grid-template-columns:minmax(0,1.3fr) 58px 42px minmax(0,1fr) 38px; } }
      `}</style>

      {/* sticky header */}
      <div style={{ position: "sticky", top: 0, zIndex: 24, background: "#fff", borderBottom: "1px solid #ececf0", boxShadow: "0 1px 2px rgba(0,0,0,.04)" }}>
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
          <button onClick={onDelete} disabled={saving} style={{ flexShrink: 0, fontSize: 13, fontWeight: 600, color: "#b4543a", background: "#f9ece8", border: "1px solid #f0d6cd", borderRadius: 9, padding: "10px 14px", cursor: saving ? "default" : "pointer", minHeight: 42 }}>
            Delete
          </button>
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
              <button onClick={() => setLayoutMode("accordion")} style={modeBtn(layoutMode === "accordion")}>Sections</button>
            </div>
          </div>

          {layoutMode === "long" && (
            <div className="sv-rail" style={{ display: "flex", alignItems: "center", gap: 7, overflowX: "auto", flex: 1, minWidth: 0 }}>
              {sections.map((s) => (
                <button key={s.id} onClick={() => jumpTo(s.id)} style={{ flexShrink: 0, fontFamily: "var(--font-ui)", fontSize: 12, fontWeight: 600, color: "#5b616e", background: "#f4f5f7", border: "1px solid #eceef1", borderRadius: 20, padding: "7px 12px", cursor: "pointer", whiteSpace: "nowrap" }}>
                  {s.title}
                </button>
              ))}
            </div>
          )}

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
      <div className="sv-pad" style={{ maxWidth: 900, margin: "0 auto", padding: "20px 24px 90px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {visibleSections.map((sec) => {
            const locked = sec.kind === "discipline" && !tier1Done;
            const collapsible = isCollapsible(sec) || sec.kind === "discipline";
            const open = locked ? false : isOpen(sec);
            const showGroupHeader = layoutMode !== "wizard" && sec.group !== prevGroup;
            prevGroup = sec.group;
            const filled = sec.kind === "fields" && sec.advanced ? measFilled(sec.fields) : 0;
            const discFilled =
              sec.kind === "discipline"
                ? Object.values(draft.disciplines[sec.disc] || {}).filter((v) =>
                    Array.isArray(v) ? v.length > 0 : typeof v === "boolean" ? v : String(v ?? "").trim() !== ""
                  ).length + draft.inventory.filter((r) => r.discipline === sec.disc).length
                : 0;
            const headerClick = collapsible
              ? () => {
                  if (locked) {
                    flash("Answer the kill questions to unlock the discipline intakes");
                    jumpTo("tier1");
                  } else {
                    toggleSection(sec.id);
                  }
                }
              : undefined;
            return (
              <div key={sec.id}>
                {showGroupHeader && (
                  <div style={{ display: "flex", alignItems: "baseline", gap: 10, margin: "6px 2px 10px", flexWrap: "wrap" }}>
                    <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "#5b616e" }}>
                      {sec.group === "brief" ? "Office brief" : sec.group === "intake" ? "Site intake" : "Field capture"}
                    </span>
                    <span style={{ fontSize: 11.5, color: "#aab0bb" }}>
                      {sec.group === "brief"
                        ? "Filled when the request is created"
                        : sec.group === "intake"
                          ? "Venue baseline, then branch into a discipline"
                          : "Filled on-site by the surveyor"}
                    </span>
                  </div>
                )}
                <div id={"sec-" + sec.id} style={{ background: "#fff", border: "1px solid #ececf0", borderRadius: 14, boxShadow: "0 1px 2px rgba(0,0,0,.04)", overflow: "hidden", opacity: locked ? 0.72 : 1 }}>
                  <div
                    onClick={headerClick}
                    style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: `16px 18px ${open ? "10px" : "16px"}`, cursor: collapsible ? "pointer" : "default" }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 14.5, fontWeight: 600, letterSpacing: "-.01em" }}>{sec.title}</div>
                      {sec.subtitle && <div style={{ fontSize: 12, color: "#9aa0ab", marginTop: 2 }}>{locked ? "Locked — answer the kill questions above first" : sec.subtitle}</div>}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                      {sec.advanced && filled > 0 && (
                        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, fontWeight: 600, color: ACCENT_INK, background: ACCENT_SOFT, border: `1px solid ${ACCENT_BORDER_LT}`, padding: "3px 9px", borderRadius: 20 }}>
                          {filled} filled
                        </span>
                      )}
                      {sec.kind === "discipline" && !locked && discFilled > 0 && (
                        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, fontWeight: 600, color: ACCENT_INK, background: ACCENT_SOFT, border: `1px solid ${ACCENT_BORDER_LT}`, padding: "3px 9px", borderRadius: 20 }}>
                          {discFilled} captured
                        </span>
                      )}
                      {locked && (
                        <span style={{ display: "inline-flex", color: "#aab0bb" }} title="Complete the kill questions to unlock">
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <rect x="3" y="11" width="18" height="11" rx="2" />
                            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                          </svg>
                        </span>
                      )}
                      {collapsible && !locked && (
                        <span style={{ fontSize: 11, color: "#aab0bb", display: "inline-block", transition: "transform .15s ease", transform: open ? "rotate(180deg)" : "none" }}>▾</span>
                      )}
                    </div>
                  </div>

                  {open && (
                    <div style={{ padding: "4px 18px 20px" }}>
                      {sec.kind === "custvenue" && renderCustVenue()}
                      {sec.kind === "fields" && <div className="sv-grid">{sec.fields.map(renderField)}</div>}
                      {sec.kind === "tier1" && (
                        <div>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                            {tier1.map((item) => (
                              <button
                                key={item.key}
                                onClick={() => jumpTo(item.section)}
                                title={item.done ? "Answered" : "Missing — tap to jump to the field"}
                                style={{
                                  display: "flex", alignItems: "center", gap: 7,
                                  fontFamily: "var(--font-ui)", fontSize: 12.5, fontWeight: 600,
                                  padding: "9px 13px", borderRadius: 20, cursor: "pointer", minHeight: 40,
                                  border: `1px solid ${item.done ? "#cce9da" : "#f0e2bd"}`,
                                  background: item.done ? "#eaf6ef" : "#fbf3dd",
                                  color: item.done ? "#1f7a52" : "#8a6d1f",
                                }}
                              >
                                <span style={{ fontSize: 12 }}>{item.done ? "✓" : "○"}</span>
                                {item.label}
                              </button>
                            ))}
                          </div>
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
                        </div>
                      )}
                      {sec.kind === "systems" && (
                        <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                          {SYSTEM_KEYS.map((s) => {
                            const st = draft.systemsState[s.key] || { installed: "", desc: "" };
                            return (
                              <div key={s.key} style={{ border: "1px solid #e4e7ec", borderRadius: 10, padding: "11px 13px", background: "#fff" }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                                  <span style={{ fontSize: 14, fontWeight: 500, color: "#3a3f4a", flex: 1, minWidth: 120 }}>{s.label}</span>
                                  <div style={{ display: "flex", gap: 7 }}>
                                    <button onClick={() => setSystem(s.key, { installed: st.installed === "yes" ? "" : "yes" })} style={{ ...toggleBtn(st.installed === "yes"), flex: "none", padding: "8px 16px", minHeight: 38 }}>Yes</button>
                                    <button onClick={() => setSystem(s.key, { installed: st.installed === "no" ? "" : "no" })} style={{ ...toggleBtn(st.installed === "no"), flex: "none", padding: "8px 16px", minHeight: 38 }}>No</button>
                                  </div>
                                </div>
                                {st.installed === "yes" && (
                                  <input value={st.desc} onChange={(e) => setSystem(s.key, { desc: e.target.value })} placeholder={"Describe — " + s.hint} style={{ ...inpStyle, marginTop: 9, padding: "10px 12px" }} />
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                      {sec.kind === "discipline" && (() => {
                        const g = DISCIPLINE_GROUPS.find((x) => x.key === sec.disc);
                        if (!g) return null;
                        const scope = dv(g.key, "scope");
                        const scopeSet = Array.isArray(scope) ? scope : [];
                        return (
                          <div>
                            <div className="sv-grid">{g.fields.map((f) => renderDiscField(g.key, f))}</div>
                            <div style={{ marginTop: 14 }}>
                              <label style={labelStyle}>{g.scopeLabel}</label>
                              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                                {g.scopeOptions.map((o) => (
                                  <button key={o} onClick={() => toggleDiscScope(g.key, o)} style={chipStyle(scopeSet.includes(o))}>{o}</button>
                                ))}
                              </div>
                            </div>
                            {g.inventories.length > 0 && (
                              <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 16 }}>
                                {g.inventories.map((inv) => renderInventory(g.key, inv.category, inv.label))}
                              </div>
                            )}
                            <div style={{ marginTop: 14 }}>
                              <label style={labelStyle}>Notes</label>
                              <textarea value={String(dv(g.key, "notes") || "")} onChange={(e) => setDisc(g.key, "notes", e.target.value)} style={taStyle} />
                            </div>
                          </div>
                        );
                      })()}
                      {sec.kind === "conditions" && (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                          {meta.conditions.map((c) => {
                            const active = draft.conditions.indexOf(c) >= 0;
                            return (
                              <button key={c} onClick={() => toggleCondition(c)} style={chipStyle(active)}>{c}</button>
                            );
                          })}
                        </div>
                      )}
                      {sec.kind === "viz3d" && <Venue3D venueType={draft.venueType} measurements={draft.measurements} />}
                      {sec.kind === "photos" && (
                        <>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 12 }}>
                            <span style={{ fontSize: 12, color: "#9aa0ab" }}>{draft.photos.length} of 8</span>
                            <label style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 13, fontWeight: 600, color: ACCENT_INK, background: ACCENT_SOFT, border: `1px solid ${ACCENT_BORDER_LT}`, borderRadius: 9, padding: "9px 13px", cursor: "pointer", minHeight: 40 }}>
                              Add photo
                              <input type="file" accept="image/*" capture="environment" multiple onChange={onPhotos} style={{ display: "none" }} />
                            </label>
                          </div>
                          {draft.photos.length > 0 ? (
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(92px,1fr))", gap: 9 }}>
                              {draft.photos.map((p) => (
                                <div key={p.id} style={{ position: "relative", height: 92, borderRadius: 10, overflow: "hidden", background: "#f1f2f5", border: "1px solid #e8eaee" }}>
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img src={p.dataUrl} alt="site photo" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                                  <button onClick={() => removePhoto(p.id)} aria-label="Remove photo" style={{ position: "absolute", top: 5, right: 5, width: 26, height: 26, borderRadius: "50%", background: "rgba(16,18,22,.62)", color: "#fff", border: "none", cursor: "pointer", fontSize: 14, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div style={{ border: "1.5px dashed #dfe2e8", borderRadius: 11, padding: 20, textAlign: "center", fontSize: 12.5, color: "#aab0bb" }}>
                              No photos yet — tap <b style={{ fontWeight: 600, color: "#8c919c" }}>Add photo</b> to capture the site.
                            </div>
                          )}
                        </>
                      )}
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

      {toast && (
        <div style={{ position: "fixed", left: "50%", bottom: 22, transform: "translateX(-50%)", zIndex: 90, display: "flex", alignItems: "center", gap: 11, background: "#16181d", color: "#fff", borderRadius: 12, padding: "13px 17px", boxShadow: "0 12px 40px rgba(0,0,0,.3)", maxWidth: "92vw" }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#5fd29a", flexShrink: 0 }} />
          <span style={{ fontSize: 13, lineHeight: 1.4 }}>{toast}</span>
        </div>
      )}
    </div>
  );
}
