"use client";

import { useMemo, useRef, useState, type CSSProperties, type ChangeEvent } from "react";
import Link from "next/link";
import type {
  InspectionRecord,
  InspectionLog,
  RubricSection,
  RubricRef,
  InspectionSeverityKey,
  InspectionLogStatus,
  InspectionConditionKey,
  InspectionStageKey,
  RubricRatingKey,
  InspectionSeverityMeta,
  InspectionStageMeta,
  InspectionStatusMeta,
  RubricRating,
  RubricTemplateGroup,
  IssueTemplate,
} from "@/lib/stores/inspections";
import { saveInspection, advanceInspectionStage, deleteInspection, type InspectionPatch } from "./actions";
import { saveThroughOutbox } from "@/lib/sync/save";

/* ============================================================
 * Serializable props from the server (the store is DB-backed and
 * cannot be imported into a client bundle — its pure meta/templates
 * are handed over here, and the pure helpers below operate on them).
 * ============================================================ */

export type EditorCustomer = {
  id: string;
  name: string;
  locations: Array<{ id: string; label: string; city: string; state: string }>;
  primaryContact: { name: string; email: string } | null;
};

export type EditorMeta = {
  venueTypes: string[];
  conditions: Array<{ key: InspectionConditionKey; label: string }>;
  severities: Array<{ key: InspectionSeverityKey; label: string }>;
  severityMeta: Record<InspectionSeverityKey, InspectionSeverityMeta>;
  stages: Array<{ key: InspectionStageKey; label: string }>;
  stageMeta: Record<InspectionStageKey, InspectionStageMeta>;
  statusMeta: Record<InspectionLogStatus, InspectionStatusMeta>;
  rubricRatings: RubricRating[];
  rubricTemplate: RubricTemplateGroup[];
  rubricLetters: string;
  issueLibrary: IssueTemplate[];
  libraryCategories: string[];
  measurementGroups: Array<{ group: string; items: Array<{ key: string; label: string }> }>;
  venueFacts: Array<{ key: string; label: string; wide?: boolean }>;
  systemFields: Array<{ key: string; label: string }>;
};

type DraftLog = InspectionLog & { _uid: string };

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
  surveyDate: string;
  reportDate: string;
  inspector: string;
  condition: InspectionConditionKey;
  scope: string;
  narrative: string;
  logs: DraftLog[];
  rubric: RubricSection[];
  venueInfo: Record<string, string>;
  measurements: Record<string, string>;
  priorInspectionId: string | null;
  priorSurveyDate: string;
  stage: InspectionStageKey;
  assignedTo: string;
  scheduledDate: string;
  updatedAt: number;
};

/* ---------- accent tints (office accent = CSS var) ---------- */
const ACCENT = "var(--accent)";
const ACCENT_SOFT = "color-mix(in srgb, var(--accent) 13%, #fff)";
const ACCENT_INK = "color-mix(in srgb, var(--accent) 72%, #000)";
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
const taStyle: CSSProperties = {
  ...inpStyle,
  minHeight: 92,
  resize: "vertical",
  lineHeight: 1.55,
};
const cardStyle: CSSProperties = {
  background: "#fff",
  border: "1px solid #ececf0",
  borderRadius: 14,
  boxShadow: "0 1px 2px rgba(0,0,0,.04)",
};

const SEV_ORDER: Record<string, number> = { urgent: 0, necessary: 1, basic: 2 };
const RATING_ORDER: Record<string, number> = { na: 0, good: 1, fair: 2, poor: 3 };

/* ---------- id helpers ---------- */
let uidSeq = 0;
function uid(): string {
  uidSeq += 1;
  return "l" + Date.now().toString(36) + "_" + uidSeq;
}
function newSvid(): string {
  return String(30000 + Math.floor(Math.random() * 9999));
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

export default function InspectionEditor({
  record,
  customers,
  roster,
  meta,
}: {
  record: InspectionRecord;
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
  const [openLogId, setOpenLogId] = useState<string | null>(null);
  const [openRubric, setOpenRubric] = useState<Record<string, boolean>>(() => firstRubricOpen(initial.rubric));
  const [rubricSel, setRubricSel] = useState<Record<string, boolean>>({});
  const [rubricFilter, setRubricFilter] = useState<RubricRatingKey | null>(null);
  const [venueOpen, setVenueOpen] = useState<Record<string, boolean>>({});
  const [custNew, setCustNew] = useState(!record.customerId && !!(record.customer || "").trim());
  const [venueOther, setVenueOther] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [libQuery, setLibQuery] = useState("");
  const [libCat, setLibCat] = useState("all");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sevMeta = (k: string) => meta.severityMeta[k as InspectionSeverityKey] || meta.severityMeta.necessary;
  const statMeta = (k: string) => meta.statusMeta[k as InspectionLogStatus] || meta.statusMeta.open;
  const ratingMeta = (k: string | null) => meta.rubricRatings.find((r) => r.key === k) || null;

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
  const setVenueInfo = (key: string, val: string) =>
    patchDraft({ venueInfo: { ...draft.venueInfo, [key]: val } });
  const setMeasurement = (key: string, val: string) =>
    patchDraft({ measurements: { ...draft.measurements, [key]: val } });

  /* ---------- customer & venue linkage ---------- */
  const custObj = (id: string | null) => (id ? customers.find((c) => c.id === id) || null : null);
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
    const prim = c?.locations.find((l) => !!l.label) || c?.locations[0] || null;
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

  /* ---------- venue-information collapsible sections ---------- */
  const venueSectionDefs = useMemo(() => {
    const VENUE_PH: Record<string, string> = {
      yearBuilt: "e.g. 1968 · renovated 1997",
      currentUse: "e.g. Multi-use proscenium",
      ownerConcerns: "What prompted the inspection…",
    };
    const SYS_PH: Record<string, string> = {
      riggingType: "e.g. Single-purchase counterweight",
      lineSets: "e.g. 32",
      liftLines: "e.g. 4 per set",
      manufacturer: "e.g. SECOA",
      electrics: "e.g. 4 raceways",
      fireCurtain: "e.g. Manual-reset, single",
      curtainTrack: "e.g. Main traveler + 2 tracks",
      orchestraShell: "e.g. Acoustic ceiling",
      deadHung: "e.g. 1 electric",
      pitLift: "e.g. Fixed pit — no lift",
    };
    const defs: Array<{ id: string; title: string; kind: "vi" | "ms"; fields: Array<{ key: string; label: string; ph: string; area: boolean }> }> = [
      {
        id: "general",
        title: "General information",
        kind: "vi",
        fields: meta.venueFacts.map((f) => ({ key: f.key, label: f.label, ph: VENUE_PH[f.key] || "", area: !!f.wide })),
      },
      {
        id: "system",
        title: "System & equipment",
        kind: "vi",
        fields: meta.systemFields.map((f) => ({ key: f.key, label: f.label, ph: SYS_PH[f.key] || "", area: false })),
      },
    ];
    meta.measurementGroups.forEach((g, gi) =>
      defs.push({
        id: "meas" + gi,
        title: g.group,
        kind: "ms",
        fields: g.items.map((it) => ({ key: it.key, label: it.label, ph: "", area: false })),
      })
    );
    return defs;
  }, [meta]);

  function toggleVenue(id: string) {
    setVenueOpen((cur) => {
      const effective = id in cur ? cur[id] : true;
      return { ...cur, [id]: !effective };
    });
  }

  /* ---------- rubric ---------- */
  function loadRubric() {
    if (draft.rubric.length) {
      flash("Standard rubric already loaded");
      return;
    }
    const rubric = makeBlankRubric(meta);
    const open: Record<string, boolean> = {};
    if (rubric[0]) open[rubric[0].key] = true;
    setOpenRubric(open);
    patchDraft({ rubric });
    flash("Loaded the standard rubric — " + rubric.length + " component sections");
  }
  function clearRubric() {
    if (!draft.rubric.length) return;
    setOpenRubric({});
    patchDraft({ rubric: [] });
    flash("Cleared the rubric");
  }
  function toggleRubric(key: string) {
    setOpenRubric((o) => {
      const next = { ...o };
      if (next[key]) delete next[key];
      else next[key] = true;
      return next;
    });
  }
  function setAllRubric(open: boolean) {
    const o: Record<string, boolean> = {};
    if (open) draft.rubric.forEach((s) => (o[s.key] = true));
    setOpenRubric(o);
  }
  function updateRubricSection(key: string, patch: Partial<RubricSection>) {
    patchDraft({ rubric: draft.rubric.map((s) => (s.key === key ? { ...s, ...patch } : s)) });
  }
  function setRubricRating(key: string, idx: number, rating: RubricRatingKey) {
    patchDraft({
      rubric: draft.rubric.map((s) => {
        if (s.key !== key) return s;
        return {
          ...s,
          items: s.items.map((it, i) => (i === idx ? { ...it, rating: it.rating === rating ? null : rating } : it)),
        };
      }),
    });
  }
  function toggleRubricSel(key: string, idx: number) {
    const id = key + ":" + idx;
    setRubricSel((o) => {
      const next = { ...o };
      if (next[id]) delete next[id];
      else next[id] = true;
      return next;
    });
  }
  function setRubricPhoto(key: string, file: File | undefined) {
    readPhoto(file, (url) => updateRubricSection(key, { photo: url }));
  }
  function toggleRubricFilter(v: RubricRatingKey) {
    setRubricFilter((cur) => (cur === v ? null : v));
  }

  /* ---------- logs ---------- */
  function setLogs(logs: DraftLog[], open?: string | null) {
    const renum = renumber(logs);
    patchDraft({ logs: renum });
    if (open !== undefined) setOpenLogId(open);
  }
  function addBlank() {
    const l = blankLog({ severity: "necessary", status: "open" });
    setLogs([...draft.logs, l], l._uid);
  }
  function addFromLibrary(item: IssueTemplate) {
    const l = blankLog({
      severity: item.severity,
      status: "open",
      problem: item.problem,
      explanation: item.explanation,
      solution: item.solution,
      standards: (item.standards || []).slice(),
    });
    setLogs([...draft.logs, l], l._uid);
    setLibraryOpen(false);
    setLibQuery("");
    flash("Added: " + item.problem);
  }
  function updateLog(u: string, patch: Partial<InspectionLog>) {
    const logs = draft.logs.map((l) => (l._uid === u ? { ...l, ...patch } : l));
    if (patch.severity) setLogs(logs);
    else patchDraft({ logs });
  }
  function removeLog(u: string) {
    setLogs(draft.logs.filter((l) => l._uid !== u), null);
  }
  function toggleLog(u: string) {
    setOpenLogId((cur) => (cur === u ? null : u));
  }
  function setLogPhoto(u: string, which: "beforePhoto" | "afterPhoto", file: File | undefined) {
    readPhoto(file, (url) => updateLog(u, { [which]: url }));
  }

  /* ---------- rubric → findings ---------- */
  const coveredRefs = useMemo(() => {
    const m: Record<string, number> = {};
    draft.logs.forEach((l) => (l.rubricRefs || []).forEach((rf) => (m[rf.key + ":" + rf.idx] = l.id)));
    return m;
  }, [draft.logs]);

  function createFindingFromSelection() {
    const refs: Array<RubricRef & { lineSet: string; comments: string }> = [];
    draft.rubric.forEach((s) =>
      s.items.forEach((it, idx) => {
        if (rubricSel[s.key + ":" + idx])
          refs.push({ key: s.key, idx, label: it.label, rating: it.rating, section: s.title, lineSet: s.lineSet || "", comments: s.comments || "" });
      })
    );
    if (!refs.length) return;
    const hasPoor = refs.some((r) => r.rating === "poor");
    const severity: InspectionSeverityKey = hasPoor ? "urgent" : "necessary";
    const sections: Record<string, typeof refs> = {};
    refs.forEach((r) => (sections[r.section] = sections[r.section] || []).push(r));
    const secNames = Object.keys(sections);
    const compLines = secNames.map((name) => {
      const its = sections[name];
      const cmt = (its[0].comments || "").trim();
      return name + " (" + its.map((i) => i.label.toLowerCase()).join(", ") + ")" + (cmt ? " — " + cmt : "");
    });
    const sevWord = hasPoor ? "Poor" : "Fair";
    const problem =
      secNames.length === 1
        ? secNames[0] + (refs.length === 1 ? " — " + refs[0].label.toLowerCase() : "")
        : "Multiple components require attention";
    const explanation =
      "Rated " + sevWord + " during the component condition walkthrough. Affected components: " + compLines.join("; ") + ".";
    const lineSets = Array.from(new Set(refs.map((r) => r.lineSet).filter(Boolean)));
    const location = lineSets.length ? "Line set " + lineSets.join(", ") : secNames.length === 1 ? secNames[0] : "";
    const l = blankLog({
      severity,
      status: "open",
      problem,
      explanation,
      solution: "",
      location,
      standards: [],
      rubricRefs: refs.map((r) => ({ key: r.key, idx: r.idx, label: r.label, section: r.section, rating: r.rating })),
    });
    setLogs([...draft.logs, l], l._uid);
    setRubricSel({});
    flash("Created finding from " + refs.length + " rubric item" + (refs.length === 1 ? "" : "s") + " — refine the write-up below");
  }

  function addFindingsFromRating(rating: "poor" | "fair") {
    const covered: Record<string, boolean> = {};
    draft.logs.forEach((l) => (l.rubricRefs || []).forEach((rf) => (covered[rf.key + ":" + rf.idx] = true)));
    const groups: Array<{ sec: RubricSection; refs: RubricRef[] }> = [];
    draft.rubric.forEach((s) => {
      const refs: RubricRef[] = [];
      s.items.forEach((it, idx) => {
        if (it.rating === rating && !covered[s.key + ":" + idx])
          refs.push({ key: s.key, idx, label: it.label, rating: it.rating, section: s.title });
      });
      if (refs.length) groups.push({ sec: s, refs });
    });
    const sevWord = rating === "poor" ? "Poor" : "Fair";
    if (!groups.length) {
      flash("No un-logged " + sevWord + " items in the rubric");
      return;
    }
    const severity: InspectionSeverityKey = rating === "poor" ? "urgent" : "necessary";
    let logs = draft.logs.slice();
    let firstUid: string | null = null;
    let made = 0;
    groups.forEach(({ sec, refs }) => {
      const compList = refs.map((r) => r.label.toLowerCase()).join(", ");
      const cmt = (sec.comments || "").trim();
      const problem = sec.title + (refs.length === 1 ? " — " + refs[0].label.toLowerCase() : "");
      const explanation = "Rated " + sevWord + " during the component condition walkthrough. Affected: " + compList + (cmt ? " — " + cmt : "") + ".";
      const location = (sec.lineSet || "").trim() ? "Line set " + sec.lineSet : sec.title;
      const l = blankLog({
        severity,
        status: "open",
        problem,
        explanation,
        solution: "",
        location,
        standards: [],
        rubricRefs: refs.map((r) => ({ key: r.key, idx: r.idx, label: r.label, section: r.section, rating: r.rating })),
      });
      logs = [...logs, l];
      if (!firstUid) firstUid = l._uid;
      made++;
    });
    setLogs(logs, made === 1 ? firstUid : undefined);
    flash("Added " + made + " finding" + (made === 1 ? "" : "s") + " from " + sevWord + " ratings — refine the write-up below");
  }

  /* ---------- recommendation suggestions ---------- */
  const recPool = useMemo(() => {
    const seen: Record<string, boolean> = {};
    const pool: Array<{ text: string; key: string }> = [];
    meta.issueLibrary.forEach((it) => {
      const s = (it.solution || "").trim();
      if (s && !seen[s]) {
        seen[s] = true;
        pool.push({ text: s, key: (it.problem + " " + it.cat + " " + it.explanation).toLowerCase() });
      }
    });
    return pool;
  }, [meta]);
  function suggestRecs(problem: string, explanation: string): string[] {
    const q = ((problem || "") + " " + (explanation || "")).toLowerCase();
    const words = q.split(/[^a-z0-9]+/).filter((w) => w.length > 3);
    const scored = recPool
      .map((p) => {
        let s = 0;
        words.forEach((w) => {
          if (p.key.indexOf(w) >= 0) s++;
        });
        return { text: p.text, score: s };
      })
      .sort((a, b) => b.score - a.score);
    const top = scored.filter((x) => x.score > 0).slice(0, 4);
    return (top.length ? top : scored.slice(0, 3)).map((x) => x.text);
  }
  function applyRec(u: string, text: string) {
    const log = draft.logs.find((l) => l._uid === u);
    if (!log) return;
    const closed = log.status === "closed";
    const cur = (closed ? log.workPerformed || "" : log.solution || "").trim();
    const next = cur ? cur + " " + text : text;
    updateLog(u, closed ? { workPerformed: next } : { solution: next });
  }

  /* ---------- photo reader (resize like the prototype) ---------- */
  function readPhoto(file: File | undefined, cb: (url: string) => void) {
    if (!file) return;
    const r = new FileReader();
    r.onload = () => {
      const result = r.result as string;
      const img = new Image();
      img.onload = () => {
        const max = 1200;
        let w = img.width;
        let h = img.height;
        if (Math.max(w, h) > max) {
          const s = max / Math.max(w, h);
          w = Math.round(w * s);
          h = Math.round(h * s);
        }
        try {
          const c = document.createElement("canvas");
          c.width = w;
          c.height = h;
          c.getContext("2d")!.drawImage(img, 0, 0, w, h);
          cb(c.toDataURL("image/jpeg", 0.72));
        } catch {
          cb(result);
        }
      };
      img.onerror = () => cb(result);
      img.src = result;
    };
    r.readAsDataURL(file);
  }

  /* ---------- persistence ---------- */
  function validate(): boolean {
    if (!(draft.customer || "").trim()) {
      setSaveError("Select a customer (or add a new customer name) to save this inspection.");
      return false;
    }
    if (!(draft.venue || "").trim()) {
      setSaveError("Add a venue to save this inspection.");
      return false;
    }
    setSaveError("");
    return true;
  }
  function buildPatch(over?: Partial<InspectionPatch>): InspectionPatch {
    const logs: InspectionLog[] = draft.logs.map((l) => {
      const { _uid, ...rest } = l;
      void _uid;
      return rest;
    });
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
      surveyDate: draft.surveyDate,
      reportDate: draft.reportDate,
      inspector: draft.inspector,
      condition: draft.condition,
      scope: draft.scope,
      narrative: draft.narrative,
      logs,
      rubric: draft.rubric,
      venueInfo: draft.venueInfo,
      measurements: draft.measurements,
      priorInspectionId: draft.priorInspectionId,
      priorSurveyDate: draft.priorSurveyDate,
      stage: draft.stage,
      assignedTo: draft.assignedTo,
      scheduledDate: draft.scheduledDate,
      ...over,
    };
  }
  /**
   * The WHOLE resulting inspection document for the offline outbox
   * (/api/sync/push does a whole-doc upsert by id). Merge the SSR record with
   * the editor patch and stamp it the way the store's update() would when a
   * write reaches the cloud (synced, rev bumped).
   */
  function buildFullDoc(over?: Partial<InspectionPatch>): Record<string, unknown> {
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
        collection: "inspections",
        id: record.id,
        doc: buildFullDoc(),
        action: () => saveInspection(record.id, patch),
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
  async function advanceStage(target: InspectionStageKey) {
    if (!validate() || saving) return;
    let reportDate = draft.reportDate;
    if (target === "completed" && !(reportDate || "").trim()) {
      const t = new Date();
      reportDate = t.getFullYear() + "-" + ("0" + (t.getMonth() + 1)).slice(-2) + "-" + ("0" + t.getDate()).slice(-2);
    }
    setSaving(true);
    try {
      const patch = buildPatch({ reportDate });
      const { queued } = await saveThroughOutbox({
        collection: "inspections",
        id: record.id,
        doc: buildFullDoc({ reportDate }),
        action: () => advanceInspectionStage(record.id, patch, target),
      });
      setDraft((d) => ({ ...d, stage: target, reportDate, updatedAt: Date.now() }));
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

  /* ---------- derived ---------- */
  const cnt = countLogs(draft.logs);
  const stageKey = draft.stage || "requested";
  const curStageIdx = Math.max(0, meta.stages.findIndex((s) => s.key === stageKey));
  const canReport = cnt.total > 0 || stageKey === "completed";
  const title = (draft.customer || "").trim()
    ? draft.customer + " — " + (draft.venue || "Inspection")
    : "New inspection";
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
  let stageActionFn: () => void;
  if (stageKey === "requested") {
    stageActionLabel = "Schedule →";
    stageActionFn = () => advanceStage("scheduled");
  } else if (stageKey === "scheduled") {
    stageActionLabel = "Start on-site →";
    stageActionFn = () => advanceStage("onsite");
  } else if (stageKey === "onsite") {
    stageActionLabel = "Mark complete →";
    stageActionFn = () => advanceStage("completed");
  } else {
    stageActionLabel = "View report →";
    stageActionFn = () => {};
  }

  /* rubric counts */
  const rubTotals = useMemo(() => {
    const c = { good: 0, fair: 0, poor: 0, na: 0, rated: 0, total: 0 };
    draft.rubric.forEach((s) =>
      s.items.forEach((it) => {
        c.total++;
        if (it.rating) {
          c.rated++;
          (c as Record<string, number>)[it.rating]++;
        }
      })
    );
    return c;
  }, [draft.rubric]);
  const hasRubric = draft.rubric.length > 0;
  const rubricSummary = hasRubric
    ? rubTotals.rated + "/" + rubTotals.total + " rated" + (rubTotals.poor ? " · " + rubTotals.poor + " poor" : "") + (rubTotals.fair ? " · " + rubTotals.fair + " fair" : "")
    : "not started";

  let poorAvail = 0;
  let fairAvail = 0;
  draft.rubric.forEach((s) =>
    s.items.forEach((it, idx) => {
      if (coveredRefs[s.key + ":" + idx]) return;
      if (it.rating === "poor") poorAvail++;
      else if (it.rating === "fair") fairAvail++;
    })
  );

  const rubSelCount = Object.keys(rubricSel).filter((k) => rubricSel[k]).length;
  const findingsSummary = cnt.total ? cnt.total + " logs · " + cnt.urgent.open + " urgent · " + cnt.open + " open" : "none yet";

  /* rubric sections (with poor/fair filter) */
  const builtSections = useMemo(() => {
    const pre = draft.rubric
      .map((s) => {
        let worst: RubricRatingKey | null = null;
        const items = s.items.map((it, idx) => {
          if (it.rating && (worst === null || RATING_ORDER[it.rating] > RATING_ORDER[worst])) worst = it.rating;
          const refId = s.key + ":" + idx;
          const covered = !!coveredRefs[refId];
          const selectable = (it.rating === "fair" || it.rating === "poor") && !covered;
          return { it, idx, refId, covered, selectable };
        });
        const filtItems = rubricFilter ? items.filter((x) => x.it.rating === rubricFilter) : items;
        return { s, worst, items: filtItems, ratedCount: s.items.filter((it) => it.rating).length };
      })
      .filter((sec) => (rubricFilter ? sec.items.length > 0 : true));
    return pre.map((sec, i) => ({ ...sec, showGroupHeader: i === 0 || sec.s.group !== pre[i - 1].s.group }));
  }, [draft.rubric, rubricFilter, coveredRefs]);
  const rubricFilterEmpty = hasRubric && !!rubricFilter && builtSections.length === 0;

  /* library items */
  const libItems = useMemo(() => {
    const ql = libQuery.trim().toLowerCase();
    return meta.issueLibrary.filter((it) => {
      if (libCat !== "all" && it.cat !== libCat) return false;
      if (!ql) return true;
      return (it.problem + " " + it.explanation + " " + it.cat).toLowerCase().indexOf(ql) >= 0;
    });
  }, [meta.issueLibrary, libCat, libQuery]);

  /* ---------- render helpers ---------- */
  const sevBadgeStyle = (sk: string): CSSProperties => {
    const m = sevMeta(sk);
    return {
      display: "inline-block",
      fontSize: 9.5,
      fontWeight: 700,
      letterSpacing: ".03em",
      textTransform: "uppercase",
      color: m.ink,
      background: m.soft,
      border: `1px solid ${m.bd}`,
      padding: "2px 8px",
      borderRadius: 5,
      flexShrink: 0,
    };
  };
  const statusBadgeStyle = (st: string): CSSProperties => {
    const m = statMeta(st);
    return {
      display: "inline-block",
      fontFamily: "var(--font-mono)",
      fontSize: 9,
      fontWeight: 600,
      color: m.ink,
      background: m.soft,
      border: `1px solid ${m.bd}`,
      padding: "2px 7px",
      borderRadius: 4,
      flexShrink: 0,
    };
  };
  const segBtn = (active: boolean, col?: string): CSSProperties => ({
    flex: 1,
    fontFamily: "var(--font-ui)",
    fontSize: 12.5,
    fontWeight: 600,
    padding: "10px 6px",
    borderRadius: 8,
    cursor: "pointer",
    minHeight: 42,
    border: `1px solid ${active ? col || "var(--accent)" : "#e4e7ec"}`,
    background: active ? (col ? `color-mix(in srgb, ${col} 12%, #fff)` : ACCENT_SOFT) : "#fff",
    color: active ? col || ACCENT_INK : "#5b616e",
  });
  const ratingSeg = (active: boolean, m: RubricRating): CSSProperties => ({
    flex: 1,
    fontFamily: "var(--font-ui)",
    fontSize: 11.5,
    fontWeight: 600,
    padding: "8px 4px",
    borderRadius: 7,
    cursor: "pointer",
    minHeight: 38,
    textAlign: "center",
    border: `1px solid ${active ? m.bd : "#e8eaee"}`,
    background: active ? m.soft : "#fff",
    color: active ? m.ink : "#9aa0ab",
  });

  const stageBg = (i: number) => (i === curStageIdx ? ACCENT : i < curStageIdx ? ACCENT_SOFT : "#f1f2f5");
  const stageCol = (i: number) => (i === curStageIdx ? "#fff" : i < curStageIdx ? ACCENT_INK : "#9aa0ab");

  return (
    <div style={{ minHeight: "100vh", fontFamily: "var(--font-ui)", color: "#16181d", background: "#f7f8fa" }}>
      <style>{`
        .ie-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:13px 14px; }
        .ie-rail::-webkit-scrollbar { display:none; }
        .ie-rail { -ms-overflow-style:none; scrollbar-width:none; }
        .ie-hoverrow:hover { background:#fafbff; }
        @media (max-width:640px){ .ie-grid{ grid-template-columns:1fr !important; } .ie-pad{ padding-left:15px !important; padding-right:15px !important; } }
      `}</style>

      {/* sticky header */}
      <div style={{ position: "sticky", top: 0, zIndex: 24, background: "#fff", borderBottom: "1px solid #ececf0", boxShadow: "0 1px 2px rgba(0,0,0,.04)" }}>
        <div className="ie-pad" style={{ display: "flex", alignItems: "center", gap: 14, maxWidth: 920, margin: "0 auto", padding: "11px 24px", flexWrap: "wrap", rowGap: 10 }}>
          <Link href="/inspections" style={{ display: "flex", alignItems: "center", gap: 7, flexShrink: 0, fontSize: 13, fontWeight: 600, color: "#5b616e", background: "#f1f2f5", borderRadius: 9, padding: "9px 13px", textDecoration: "none", minHeight: 42, boxSizing: "border-box" }}>
            <span style={{ fontSize: 15, lineHeight: 1 }}>←</span> Inspections
          </Link>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 600, lineHeight: 1.25, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2 }}>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "#aab0bb" }}>{sub}</span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 9.5, fontWeight: 600, padding: "2px 8px", borderRadius: 6, color: savePillInk, background: savePillBg }}>{savePillLabel}</span>
            </div>
          </div>
          {canReport && (
            <>
              <Link href={`/inspections/${encodeURIComponent(record.id)}/report`} style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, color: ACCENT_INK, background: ACCENT_SOFT, border: `1px solid ${ACCENT_BORDER_LT}`, borderRadius: 9, padding: "10px 14px", textDecoration: "none", minHeight: 42, boxSizing: "border-box" }}>
                <span style={{ fontSize: 13 }}>⎙</span> Report
              </Link>
              <Link href={`/inspections/results-letter?id=${encodeURIComponent(record.id)}`} title="One-page results letter" style={{ flexShrink: 0, fontSize: 12.5, fontWeight: 600, color: ACCENT_INK, background: "transparent", border: `1px solid ${ACCENT_BORDER_LT}`, borderRadius: 9, padding: "10px 12px", textDecoration: "none", minHeight: 42, display: "inline-flex", alignItems: "center", boxSizing: "border-box" }}>
                Results letter
              </Link>
              <Link href={`/inspections/summary-letter?id=${encodeURIComponent(record.id)}`} title="One-page summary letter" style={{ flexShrink: 0, fontSize: 12.5, fontWeight: 600, color: ACCENT_INK, background: "transparent", border: `1px solid ${ACCENT_BORDER_LT}`, borderRadius: 9, padding: "10px 12px", textDecoration: "none", minHeight: 42, display: "inline-flex", alignItems: "center", boxSizing: "border-box" }}>
                Summary letter
              </Link>
            </>
          )}
          <button onClick={onSave} disabled={saving} style={{ flexShrink: 0, fontSize: 13.5, fontWeight: 600, color: "#fff", background: ACCENT, border: "none", borderRadius: 9, padding: "11px 20px", cursor: saving ? "default" : "pointer", minHeight: 42, opacity: saving ? 0.7 : 1 }}>
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>

        <div className="ie-pad" style={{ display: "flex", alignItems: "center", gap: 12, maxWidth: 920, margin: "0 auto", padding: "11px 24px", borderTop: "1px solid #f4f5f7", flexWrap: "wrap", rowGap: 10 }}>
          <div className="ie-rail" style={{ display: "flex", alignItems: "center", gap: 7, overflowX: "auto", minWidth: 0 }}>
            {meta.stages.map((st, i) => (
              <button key={st.key} onClick={() => advanceStage(st.key)} style={{ fontFamily: "var(--font-ui)", fontSize: 12, fontWeight: 600, border: "none", borderRadius: 20, padding: "8px 13px", cursor: "pointer", whiteSpace: "nowrap", minHeight: 36, flexShrink: 0, color: stageCol(i), background: stageBg(i) }}>
                {st.label}
              </button>
            ))}
          </div>
          <div style={{ flex: 1, minWidth: 8 }} />
          {stageKey === "completed" ? (
            <Link href={`/inspections/${encodeURIComponent(record.id)}/report`} style={{ flexShrink: 0, fontSize: 13, fontWeight: 600, color: "#fff", background: ACCENT, borderRadius: 9, padding: "10px 16px", textDecoration: "none", minHeight: 40, display: "inline-flex", alignItems: "center", boxSizing: "border-box" }}>
              {stageActionLabel}
            </Link>
          ) : (
            <button onClick={stageActionFn} style={{ flexShrink: 0, fontSize: 13, fontWeight: 600, color: "#fff", background: ACCENT, border: "none", borderRadius: 9, padding: "10px 16px", cursor: "pointer", minHeight: 40 }}>
              {stageActionLabel}
            </button>
          )}
        </div>
      </div>

      {/* body */}
      <div className="ie-pad" style={{ maxWidth: 920, margin: "0 auto", padding: "20px 24px 90px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Customer & venue */}
          <div style={{ ...cardStyle, padding: "16px 18px 20px" }}>
            <div style={{ fontSize: 14.5, fontWeight: 600, marginBottom: 14 }}>Customer &amp; venue</div>
            <div style={{ marginBottom: 13 }}>
              <label style={labelStyle}>Customer</label>
              <select value={draft.customerId ? draft.customerId : custNew ? "__new__" : ""} onChange={(e) => setCustomerSel(e.target.value)} style={selStyle}>
                <option value="">— Select customer —</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
                {draft.customerId && !linkedCust && <option value={draft.customerId}>{draft.customer || draft.customerId}</option>}
                <option value="__new__">+ New customer (not in directory)</option>
              </select>
              {custNew && (
                <input value={draft.customer} onChange={(e) => { setCustNew(true); patchDraft({ customer: e.target.value, customerId: null }); }} placeholder="New customer name" style={{ ...inpStyle, marginTop: 9 }} />
              )}
            </div>
            <div className="ie-grid">
              <div style={{ gridColumn: "1 / -1" }}>
                <label style={labelStyle}>Venue</label>
                {venueHasLocs && !venueOther ? (
                  <select value={draft.locationId ? draft.locationId : venueOther ? "__other__" : ""} onChange={(e) => setVenueSel(e.target.value)} style={selStyle}>
                    <option value="">— Select venue —</option>
                    {custLocs.map((l) => (
                      <option key={l.id} value={l.id}>{l.label + (l.city ? " · " + l.city : "")}</option>
                    ))}
                    <option value="__other__">Other venue…</option>
                  </select>
                ) : (
                  <input value={draft.venue} onChange={(e) => patchDraft({ venue: e.target.value, locationId: null })} placeholder="e.g. Main Hall" style={inpStyle} />
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
              <div style={{ gridColumn: "1 / -1" }}>
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
            </div>
          </div>

          {/* Inspection details */}
          <div style={{ ...cardStyle, padding: "16px 18px 20px" }}>
            <div style={{ fontSize: 14.5, fontWeight: 600, marginBottom: 14 }}>Inspection details</div>
            <div className="ie-grid">
              <div>
                <label style={labelStyle}>Survey date</label>
                <input type="date" value={draft.surveyDate} onChange={(e) => patchDraft({ surveyDate: e.target.value, scheduledDate: e.target.value })} style={inpStyle} />
              </div>
              <div>
                <label style={labelStyle}>Inspector</label>
                <select value={draft.inspector} onChange={(e) => patchDraft({ inspector: e.target.value, assignedTo: e.target.value })} style={selStyle}>
                  <option value="">— Select —</option>
                  {roster.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Prior survey date</label>
                <input type="date" value={draft.priorSurveyDate} onChange={(e) => setField("priorSurveyDate", e.target.value)} style={inpStyle} />
              </div>
              {stageKey === "completed" && (
                <div>
                  <label style={labelStyle}>Report date (issued)</label>
                  <input type="date" value={draft.reportDate} onChange={(e) => setField("reportDate", e.target.value)} style={inpStyle} />
                </div>
              )}
              <div style={{ gridColumn: "1 / -1" }}>
                <label style={labelStyle}>Scope of inspection</label>
                <textarea value={draft.scope} onChange={(e) => setField("scope", e.target.value)} placeholder="What was inspected — e.g. (32) single-purchase line sets, fire curtain, FOH catwalks…" style={taStyle} />
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <label style={labelStyle}>Condition narrative</label>
                <textarea value={draft.narrative} onChange={(e) => setField("narrative", e.target.value)} placeholder="Overall condition summary for the venue…" style={taStyle} />
              </div>
            </div>
          </div>

          {/* Venue information & measurements */}
          <div style={{ ...cardStyle, padding: "16px 18px 20px" }}>
            <div style={{ fontSize: 14.5, fontWeight: 600, marginBottom: 4 }}>Venue information &amp; measurements</div>
            <div style={{ fontSize: 12, color: "#9aa0ab", marginBottom: 14 }}>From the site-visit sheet — venue facts, the rigging system summary, and the stage measurements that open the report.</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 11, marginTop: 2 }}>
              {venueSectionDefs.map((sec) => {
                const store = sec.kind === "vi" ? draft.venueInfo : draft.measurements;
                const setter = sec.kind === "vi" ? setVenueInfo : setMeasurement;
                const total = sec.fields.length;
                const filled = sec.fields.filter((f) => ((store[f.key] || "") + "").trim()).length;
                const complete = total > 0 && filled === total;
                const open = sec.id in venueOpen ? venueOpen[sec.id] : true;
                return (
                  <div key={sec.id} style={{ border: "1px solid #eceef1", borderRadius: 11, overflow: "hidden" }}>
                    <div onClick={() => toggleVenue(sec.id)} className="ie-hoverrow" style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", cursor: "pointer", background: complete ? "#fbfcfd" : "#fff" }}>
                      <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 600 }}>{sec.title}</span>
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "#aab0bb", flexShrink: 0 }}>{filled + "/" + total}</span>
                      <span style={complete ? venueBadgeDone : venueBadgeTodo}>{complete ? "Complete" : total - filled + " left"}</span>
                      <span style={{ fontSize: 12, color: "#aab0bb", flexShrink: 0, display: "inline-block", transition: "transform .15s ease", transform: open ? "rotate(180deg)" : "none" }}>▾</span>
                    </div>
                    {open && (
                      <div style={{ padding: "8px 14px 16px", borderTop: "1px solid #f3f4f7" }}>
                        <div className="ie-grid">
                          {sec.fields.map((f) => (
                            <div key={f.key} style={f.area ? { gridColumn: "1 / -1" } : undefined}>
                              <label style={labelStyle}>{f.label}</label>
                              {f.area ? (
                                <textarea value={store[f.key] || ""} onChange={(e) => setter(f.key, e.target.value)} placeholder={f.ph} style={taStyle} />
                              ) : (
                                <input value={store[f.key] || ""} onChange={(e) => setter(f.key, e.target.value)} placeholder={f.ph} style={inpStyle} />
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Component condition rubric */}
          <div style={{ ...cardStyle, overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, padding: "16px 18px", borderBottom: "1px solid #f0f1f4", flexWrap: "wrap", rowGap: 10 }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 14.5, fontWeight: 600 }}>Component condition rubric</span>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "#9aa0ab" }}>{rubricSummary}</span>
                </div>
                <div style={{ fontSize: 12, color: "#9aa0ab", marginTop: 3, lineHeight: 1.5 }}>Walk the whole system and rate every component Good / Fair / Poor.</div>
              </div>
              {hasRubric && (
                <div style={{ display: "flex", alignItems: "center", gap: 7, flexShrink: 0, flexWrap: "wrap", justifyContent: "flex-end" }}>
                  <button onClick={() => toggleRubricFilter("poor")} title="Show only components rated Poor" style={rubFilterChip(rubricFilter === "poor", ratingMeta("poor"))}>Poor</button>
                  <button onClick={() => toggleRubricFilter("fair")} title="Show only components rated Fair" style={rubFilterChip(rubricFilter === "fair", ratingMeta("fair"))}>Fair</button>
                  <span style={{ width: 1, height: 20, background: "#e4e7ec", flexShrink: 0 }} />
                  <button onClick={() => setAllRubric(true)} style={miniBtn}>Expand all</button>
                  <button onClick={() => setAllRubric(false)} style={miniBtn}>Collapse all</button>
                  <button onClick={clearRubric} style={{ ...miniBtn, color: "#b4543a", background: "#f9ece8", border: "1px solid #f0d6cd" }}>Clear</button>
                </div>
              )}
            </div>

            {builtSections.map((sec) => {
              const isOpen = rubricFilter ? true : !!openRubric[sec.s.key];
              const wm = sec.worst ? ratingMeta(sec.worst) : null;
              return (
                <div key={sec.s.key}>
                  {sec.showGroupHeader && (
                    <div style={{ padding: "13px 18px 9px", background: "#fafbfc", borderBottom: "1px solid #f0f1f4", fontFamily: "var(--font-mono)", fontSize: 10.5, fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase", color: "#8c919c" }}>{sec.s.group}</div>
                  )}
                  <div style={{ borderBottom: "1px solid #f3f4f7" }}>
                    <div onClick={() => toggleRubric(sec.s.key)} className="ie-hoverrow" style={{ display: "flex", alignItems: "center", gap: 11, padding: "13px 16px 13px 18px", cursor: "pointer" }}>
                      <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 600, lineHeight: 1.3 }}>{sec.s.n + ". " + sec.s.title}</span>
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "#aab0bb", flexShrink: 0 }}>{sec.ratedCount + "/" + sec.s.items.length}</span>
                      <span style={{ display: "inline-block", fontSize: 9.5, fontWeight: 700, letterSpacing: ".03em", textTransform: "uppercase", padding: "2px 8px", borderRadius: 5, flexShrink: 0, ...(wm ? { color: wm.ink, background: wm.soft, border: `1px solid ${wm.bd}` } : { color: "#aab0bb", background: "#f4f5f7", border: "1px solid #e8eaee" }) }}>
                        {wm ? wm.label + (sec.worst === "poor" ? " — attention" : "") : sec.ratedCount ? "In progress" : "Not rated"}
                      </span>
                      <span style={{ fontSize: 12, color: "#aab0bb", flexShrink: 0, display: "inline-block", transition: "transform .15s ease", transform: isOpen ? "rotate(180deg)" : "none" }}>▾</span>
                    </div>
                    {isOpen && (
                      <div style={{ padding: "4px 16px 20px 18px", background: "#fcfcfd" }}>
                        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 15 }}>
                          {sec.items.map(({ it, idx, refId, covered, selectable }) => {
                            const selected = !!rubricSel[refId];
                            return (
                              <div key={idx} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", rowGap: 7 }}>
                                {selectable && (
                                  <button onClick={() => toggleRubricSel(sec.s.key, idx)} title="Select to write up as a finding" style={{ width: 20, height: 20, flexShrink: 0, borderRadius: 5, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, lineHeight: 1, border: `1.5px solid ${selected ? "var(--accent)" : "#cfd3da"}`, background: selected ? "var(--accent)" : "#fff", color: "#fff" }}>{selected ? "✓" : ""}</button>
                                )}
                                <span style={{ flex: 1, minWidth: 140, fontSize: 13, lineHeight: 1.35, color: "#3a3f4a" }}>
                                  <b style={{ fontWeight: 600, color: "#aab0bb", fontFamily: "var(--font-mono)", fontSize: 11, marginRight: 8 }}>{it.l}</b>
                                  {it.label}
                                  {covered && (
                                    <span style={{ display: "inline-block", marginLeft: 8, fontFamily: "var(--font-mono)", fontSize: 9, fontWeight: 600, letterSpacing: ".02em", color: "#1f7a52", background: "#eaf6ef", border: "1px solid #cce9da", borderRadius: 4, padding: "1px 6px", verticalAlign: "middle" }}>✓ in {coveredRefs[refId]}</span>
                                  )}
                                </span>
                                <div style={{ display: "flex", gap: 5, width: 250, maxWidth: "100%", flexShrink: 0 }}>
                                  {meta.rubricRatings.map((r) => (
                                    <button key={r.key} onClick={() => setRubricRating(sec.s.key, idx, r.key)} style={ratingSeg(it.rating === r.key, r)}>{r.label}</button>
                                  ))}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        <div className="ie-grid" style={{ marginBottom: 13 }}>
                          <div style={{ gridColumn: "1 / -1" }}>
                            <label style={labelStyle}>Comments</label>
                            <textarea value={sec.s.comments} onChange={(e) => updateRubricSection(sec.s.key, { comments: e.target.value })} placeholder="Condition notes for this component…" style={taStyle} />
                          </div>
                          <div>
                            <label style={labelStyle}>Line set #</label>
                            <input value={sec.s.lineSet} onChange={(e) => updateRubricSection(sec.s.key, { lineSet: e.target.value })} placeholder="e.g. 12, or ALL" style={inpStyle} />
                          </div>
                        </div>
                        <div style={{ maxWidth: 340 }}>
                          <label style={labelStyle}>Photo</label>
                          {sec.s.photo ? (
                            <div style={{ position: "relative" }}>
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={sec.s.photo} alt="rubric photo" style={{ width: "100%", maxHeight: 180, objectFit: "cover", borderRadius: 9, border: "1px solid #e4e7ec", display: "block" }} />
                              <button onClick={() => updateRubricSection(sec.s.key, { photo: null })} style={photoClearBtn}>×</button>
                            </div>
                          ) : (
                            <label style={photoDrop}>
                              <span style={{ fontSize: 16 }}>📷</span> Add photo
                              <input type="file" accept="image/*" capture="environment" onChange={(e) => onPickFile(e, (f) => setRubricPhoto(sec.s.key, f))} style={{ display: "none" }} />
                            </label>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {rubricFilterEmpty && (
              <div style={{ padding: "26px 24px", textAlign: "center", fontSize: 13, color: "#9aa0ab" }}>No components are rated {rubricFilter === "poor" ? "Poor" : "Fair"} yet.</div>
            )}

            {!hasRubric && (
              <div style={{ padding: "34px 24px 32px", textAlign: "center" }}>
                <div style={{ fontSize: 13, lineHeight: 1.6, color: "#9aa0ab", marginBottom: 16 }}>
                  No rubric loaded yet.
                  <br />
                  Load the standard rigging rubric to check every component — loft blocks, wire rope, arbors, rope locks, curtains &amp; track.
                </div>
                <button onClick={loadRubric} style={{ display: "inline-flex", alignItems: "center", gap: 9, fontSize: 13.5, fontWeight: 600, color: "#fff", background: ACCENT, border: "none", borderRadius: 10, padding: "12px 18px", cursor: "pointer", minHeight: 44 }}>
                  <span style={{ fontSize: 15, lineHeight: 1 }}>☑</span> Load standard rubric · {rubricSectionCount(meta)} sections
                </button>
              </div>
            )}
          </div>

          {/* Findings */}
          <div style={{ ...cardStyle, overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "16px 18px", borderBottom: "1px solid #f0f1f4", flexWrap: "wrap", rowGap: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                <span style={{ fontSize: 14.5, fontWeight: 600 }}>Findings</span>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "#9aa0ab" }}>{findingsSummary}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, flexWrap: "wrap", justifyContent: "flex-end" }}>
                {poorAvail > 0 && (
                  <button onClick={() => addFindingsFromRating("poor")} title="Create findings from the rubric items rated Poor" style={findingBtn(sevMeta("urgent"))}>
                    <span style={{ fontSize: 14, lineHeight: 1 }}>+</span> From Poor · {poorAvail}
                  </button>
                )}
                {fairAvail > 0 && (
                  <button onClick={() => addFindingsFromRating("fair")} title="Create findings from the rubric items rated Fair" style={findingBtn(sevMeta("necessary"))}>
                    <span style={{ fontSize: 14, lineHeight: 1 }}>+</span> From Fair · {fairAvail}
                  </button>
                )}
                <button onClick={() => setLibraryOpen(true)} style={{ fontSize: 12.5, fontWeight: 600, color: "#5b616e", background: "#fff", border: "1px solid #e4e7ec", borderRadius: 9, padding: "9px 13px", cursor: "pointer", minHeight: 40 }}>Library</button>
                <button onClick={addBlank} style={{ fontSize: 12.5, fontWeight: 600, color: "#5b616e", background: "#fff", border: "1px solid #e4e7ec", borderRadius: 9, padding: "9px 13px", cursor: "pointer", minHeight: 40 }}>Blank log</button>
              </div>
            </div>

            {renumber(draft.logs).map((l) => {
              const m = sevMeta(l.severity);
              const isOpen = openLogId === l._uid;
              const isClosed = l.status === "closed";
              const recs = isOpen && !isClosed ? suggestRecs(l.problem, l.explanation) : [];
              return (
                <div key={l._uid} style={{ borderBottom: "1px solid #f3f4f7", borderLeft: `4px solid ${m.bar}` }}>
                  <div onClick={() => toggleLog(l._uid)} className="ie-hoverrow" style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 16px", cursor: "pointer" }}>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 600, color: "#5b616e", width: 26, flexShrink: 0, textAlign: "right" }}>{l.id}</span>
                    <span style={sevBadgeStyle(l.severity)}>{m.label}</span>
                    <span style={statusBadgeStyle(l.status)}>{statMeta(l.status).label}</span>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 500, lineHeight: 1.3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: (l.problem || "").trim() ? undefined : "#aab0bb" }}>{(l.problem || "").trim() || "Untitled finding"}</span>
                    <span style={{ fontSize: 12, color: "#aab0bb", flexShrink: 0, display: "inline-block", transition: "transform .15s ease", transform: isOpen ? "rotate(180deg)" : "none" }}>▾</span>
                  </div>
                  {isOpen && (
                    <div style={{ padding: "4px 16px 20px 20px", background: "#fcfcfd" }}>
                      <div style={{ marginBottom: 13 }}>
                        <label style={labelStyle}>Problem</label>
                        <input value={l.problem} onChange={(e) => updateLog(l._uid, { problem: e.target.value })} placeholder="Short problem title" style={inpStyle} />
                      </div>
                      <div className="ie-grid" style={{ marginBottom: 13 }}>
                        <div>
                          <label style={labelStyle}>Level of problem</label>
                          <div style={{ display: "flex", gap: 6 }}>
                            {meta.severities.map((s) => (
                              <button key={s.key} onClick={() => updateLog(l._uid, { severity: s.key })} style={segBtn(l.severity === s.key, sevMeta(s.key).bar)}>{s.label}</button>
                            ))}
                          </div>
                        </div>
                        <div>
                          <label style={labelStyle}>Ticket status</label>
                          <div style={{ display: "flex", gap: 6 }}>
                            {(["open", "closed"] as InspectionLogStatus[]).map((k) => (
                              <button key={k} onClick={() => updateLog(l._uid, { status: k })} style={segBtn(l.status === k, k === "closed" ? "#1f7a52" : "#b4543a")}>{k === "open" ? "Open" : "Closed"}</button>
                            ))}
                          </div>
                        </div>
                      </div>
                      <div className="ie-grid" style={{ marginBottom: 13 }}>
                        <div>
                          <label style={labelStyle}>Location in venue</label>
                          <input value={l.location} onChange={(e) => updateLog(l._uid, { location: e.target.value })} placeholder="e.g. SL loading gallery" style={inpStyle} />
                        </div>
                        <div>
                          <label style={labelStyle}>Standards cited</label>
                          <input value={(l.standards || []).join(", ")} onChange={(e) => updateLog(l._uid, { standards: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} placeholder="e.g. OSHA 1910.28(b), ANSI E1.22" style={inpStyle} />
                        </div>
                      </div>
                      <div style={{ marginBottom: 13 }}>
                        <label style={labelStyle}>Explanation of problem</label>
                        <textarea value={l.explanation} onChange={(e) => updateLog(l._uid, { explanation: e.target.value })} placeholder="What is wrong and why it matters…" style={taStyle} />
                      </div>
                      <div style={{ marginBottom: 15 }}>
                        <label style={labelStyle}>{isClosed ? "Work performed" : "Recommended solution"}</label>
                        <textarea value={isClosed ? l.workPerformed || "" : l.solution || ""} onChange={(e) => updateLog(l._uid, isClosed ? { workPerformed: e.target.value } : { solution: e.target.value })} placeholder={isClosed ? "What was done to resolve it…" : "How it should be corrected…"} style={taStyle} />
                        {recs.length > 0 && (
                          <div style={{ marginTop: 10 }}>
                            <div style={{ fontSize: 10.5, fontWeight: 600, color: "#9aa0ab", letterSpacing: ".04em", textTransform: "uppercase", marginBottom: 7 }}>Suggested recommendations · tap to insert</div>
                            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                              {recs.map((t, i) => (
                                <button key={i} onClick={() => applyRec(l._uid, t)} style={{ textAlign: "left", fontSize: 12, lineHeight: 1.45, color: "#3a3f4a", background: "#fff", border: "1px solid #e4e7ec", borderRadius: 9, padding: "9px 12px", cursor: "pointer", display: "flex", gap: 9, alignItems: "flex-start" }}>
                                  <span style={{ color: ACCENT_INK, fontWeight: 700, flexShrink: 0, lineHeight: 1.45 }}>+</span>
                                  <span>{t.length > 92 ? t.slice(0, 90).replace(/\s+\S*$/, "") + "…" : t}</span>
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                        <div style={{ flex: 1, minWidth: 150 }}>
                          <label style={labelStyle}>Before photo</label>
                          {l.beforePhoto ? (
                            <div style={{ position: "relative" }}>
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={l.beforePhoto} alt="before" style={photoImg} />
                              <button onClick={() => updateLog(l._uid, { beforePhoto: null })} style={photoClearBtn}>×</button>
                            </div>
                          ) : (
                            <label style={{ ...photoDrop, height: 130 }}>
                              <span style={{ fontSize: 16 }}>📷</span> Add before
                              <input type="file" accept="image/*" capture="environment" onChange={(e) => onPickFile(e, (f) => setLogPhoto(l._uid, "beforePhoto", f))} style={{ display: "none" }} />
                            </label>
                          )}
                        </div>
                        {isClosed && (
                          <div style={{ flex: 1, minWidth: 150 }}>
                            <label style={labelStyle}>After photo</label>
                            {l.afterPhoto ? (
                              <div style={{ position: "relative" }}>
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={l.afterPhoto} alt="after" style={photoImg} />
                                <button onClick={() => updateLog(l._uid, { afterPhoto: null })} style={photoClearBtn}>×</button>
                              </div>
                            ) : (
                              <label style={{ ...photoDrop, height: 130 }}>
                                <span style={{ fontSize: 16 }}>📷</span> Add after
                                <input type="file" accept="image/*" capture="environment" onChange={(e) => onPickFile(e, (f) => setLogPhoto(l._uid, "afterPhoto", f))} style={{ display: "none" }} />
                              </label>
                            )}
                          </div>
                        )}
                      </div>
                      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 15 }}>
                        <button onClick={() => removeLog(l._uid)} style={{ fontSize: 12.5, fontWeight: 600, color: "#b4543a", background: "#f9ece8", border: "1px solid #f0d6cd", borderRadius: 9, padding: "9px 14px", cursor: "pointer" }}>Remove log</button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {draft.logs.length === 0 && (
              <div style={{ padding: "38px 20px", textAlign: "center", color: "#9aa0ab", fontSize: 13, lineHeight: 1.6 }}>
                No findings logged yet.
                <br />
                Rate components in the rubric above, then pull the <b style={{ fontWeight: 600, color: "#8c919c" }}>Poor</b> or <b style={{ fontWeight: 600, color: "#8c919c" }}>Fair</b> items in as findings — or start a <b style={{ fontWeight: 600, color: "#8c919c" }}>Blank log</b>.
              </div>
            )}
          </div>

          {/* Overall assessment */}
          <div style={{ ...cardStyle, padding: "16px 18px 20px" }}>
            <div style={{ fontSize: 14.5, fontWeight: 600, marginBottom: 4 }}>Overall assessment</div>
            <div style={{ fontSize: 12, color: "#9aa0ab", marginBottom: 14 }}>Rate the venue’s overall condition once the findings above are complete — this drives the report headline.</div>
            <div style={{ maxWidth: 280 }}>
              <label style={labelStyle}>Condition rating</label>
              <select value={draft.condition} onChange={(e) => setField("condition", e.target.value as InspectionConditionKey)} style={selStyle}>
                {meta.conditions.map((o) => (
                  <option key={o.key} value={o.key}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {saveError && (
          <div style={{ marginTop: 16, background: "#f9ece8", border: "1px solid #f0d6cd", borderRadius: 11, padding: "13px 15px", color: "#b4543a", fontSize: 13, lineHeight: 1.5 }}>{saveError}</div>
        )}

        <div style={{ marginTop: 22, display: "flex", justifyContent: "center" }}>
          <form action={deleteInspection.bind(null, record.id)}>
            <button type="submit" style={{ fontSize: 12.5, fontWeight: 600, color: "#b4543a", background: "transparent", border: "none", cursor: "pointer", padding: "8px 14px" }}>Delete this inspection</button>
          </form>
        </div>
      </div>

      {/* library picker sheet */}
      {libraryOpen && (
        <>
          <div onClick={() => setLibraryOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(16,18,22,.5)", zIndex: 110 }} />
          <div style={{ position: "fixed", left: "50%", top: "50%", transform: "translate(-50%,-50%)", zIndex: 120, width: 640, maxWidth: "94vw", maxHeight: "86vh", background: "#fff", borderRadius: 16, boxShadow: "0 24px 70px rgba(0,0,0,.34)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ padding: "16px 18px 12px", borderBottom: "1px solid #f0f1f4" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <div style={{ fontSize: 15, fontWeight: 600 }}>Add a finding from the library</div>
                <button onClick={() => setLibraryOpen(false)} style={{ width: 30, height: 30, border: "none", background: "#f1f2f5", borderRadius: 8, color: "#5b616e", fontSize: 17, cursor: "pointer", flexShrink: 0 }}>×</button>
              </div>
              <input value={libQuery} onChange={(e) => setLibQuery(e.target.value)} placeholder="Search findings — hardware, fire curtain, fall protection…" style={{ width: "100%", marginTop: 11, fontFamily: "var(--font-ui)", fontSize: 15, border: "1px solid #e4e7ec", borderRadius: 10, padding: "11px 13px", outline: "none" }} />
              <div className="ie-rail" style={{ display: "flex", gap: 7, overflowX: "auto", marginTop: 11, paddingBottom: 2 }}>
                {["all", ...meta.libraryCategories].map((cat) => (
                  <button key={cat} onClick={() => setLibCat(cat)} style={{ fontFamily: "var(--font-ui)", fontSize: 12, fontWeight: 600, borderRadius: 20, padding: "7px 12px", cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0, border: `1px solid ${libCat === cat ? "var(--accent)" : "#e4e7ec"}`, background: libCat === cat ? ACCENT_SOFT : "#fff", color: libCat === cat ? ACCENT_INK : "#5b616e" }}>{cat === "all" ? "All" : cat}</button>
                ))}
              </div>
            </div>
            <div style={{ overflowY: "auto", padding: 8 }}>
              {libItems.map((it, i) => {
                const m = sevMeta(it.severity);
                return (
                  <button key={i} onClick={() => addFromLibrary(it)} style={{ width: "100%", display: "flex", alignItems: "flex-start", gap: 12, textAlign: "left", padding: "12px 13px", border: "none", borderRadius: 10, background: "transparent", cursor: "pointer", fontFamily: "var(--font-ui)" }}>
                    <span style={{ width: 9, height: 9, borderRadius: "50%", flexShrink: 0, marginTop: 5, background: m.bar }} />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.3 }}>{it.problem}</span>
                        <span style={sevBadgeStyle(it.severity)}>{m.label}</span>
                      </span>
                      <span style={{ display: "block", fontSize: 11.5, color: "#9aa0ab", lineHeight: 1.45, marginTop: 3 }}>{it.cat} · {(it.explanation || "").slice(0, 84).replace(/\s+\S*$/, "")}…</span>
                    </span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: ACCENT_INK, flexShrink: 0, alignSelf: "center" }}>Add</span>
                  </button>
                );
              })}
              {libItems.length === 0 && (
                <div style={{ padding: "26px 12px", textAlign: "center", fontSize: 13, color: "#9aa0ab" }}>No library findings match “{libQuery.trim()}”. Use <b style={{ fontWeight: 600, color: "#8c919c" }}>Blank log</b> to write your own.</div>
              )}
            </div>
          </div>
        </>
      )}

      {/* rubric selection bar */}
      {rubSelCount > 0 && (
        <div style={{ position: "fixed", left: "50%", bottom: 22, transform: "translateX(-50%)", zIndex: 125, display: "flex", alignItems: "center", gap: 14, background: "#16181d", color: "#fff", borderRadius: 12, padding: "10px 12px 10px 17px", boxShadow: "0 12px 40px rgba(0,0,0,.32)", maxWidth: "94vw", flexWrap: "wrap", rowGap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 500 }}>{rubSelCount + " component" + (rubSelCount === 1 ? "" : "s") + " selected"}</span>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button onClick={() => setRubricSel({})} style={{ fontSize: 12.5, fontWeight: 600, color: "#cfd3da", background: "transparent", border: "none", cursor: "pointer", padding: "8px 10px" }}>Clear</button>
            <button onClick={createFindingFromSelection} style={{ fontSize: 12.5, fontWeight: 600, color: "#16181d", background: "#fff", border: "none", borderRadius: 9, padding: "9px 15px", cursor: "pointer", minHeight: 38 }}>Group into finding →</button>
          </div>
        </div>
      )}

      {/* toast */}
      {toast && (
        <div style={{ position: "fixed", left: "50%", bottom: 22, transform: "translateX(-50%)", zIndex: 130, display: "flex", alignItems: "center", gap: 11, background: "#16181d", color: "#fff", borderRadius: 12, padding: "13px 17px", boxShadow: "0 12px 40px rgba(0,0,0,.3)", maxWidth: "92vw" }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#5fd29a", flexShrink: 0 }} />
          <span style={{ fontSize: 13, lineHeight: 1.4 }}>{toast}</span>
        </div>
      )}
    </div>
  );
}

/* ============================================================
 * Pure style constants + helpers
 * ============================================================ */

const venueBadgeDone: CSSProperties = { display: "inline-block", fontSize: 9, fontWeight: 700, letterSpacing: ".03em", textTransform: "uppercase", color: "#1f7a52", background: "#eaf6ef", border: "1px solid #cce9da", padding: "2px 8px", borderRadius: 5, flexShrink: 0 };
const venueBadgeTodo: CSSProperties = { display: "inline-block", fontSize: 9, fontWeight: 700, letterSpacing: ".03em", textTransform: "uppercase", color: "#8c919c", background: "#f4f5f7", border: "1px solid #e8eaee", padding: "2px 8px", borderRadius: 5, flexShrink: 0 };
const miniBtn: CSSProperties = { fontSize: 12, fontWeight: 600, color: "#5b616e", background: "#f1f2f5", border: "none", borderRadius: 8, padding: "8px 11px", cursor: "pointer", minHeight: 36 };
const photoImg: CSSProperties = { width: "100%", height: 130, objectFit: "cover", borderRadius: 9, border: "1px solid #e4e7ec", display: "block" };
const photoDrop: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "center", gap: 7, height: 110, border: "1.5px dashed #dfe2e8", borderRadius: 9, cursor: "pointer", fontSize: 12.5, fontWeight: 600, color: "#9aa0ab" };
const photoClearBtn: CSSProperties = { position: "absolute", top: 6, right: 6, width: 26, height: 26, borderRadius: "50%", border: "none", background: "rgba(16,18,22,.66)", color: "#fff", fontSize: 14, cursor: "pointer" };

function rubFilterChip(active: boolean, m: RubricRating | null): CSSProperties {
  const col = m || { ink: "#5b616e", soft: "#fff", bd: "#e4e7ec" };
  return { fontFamily: "var(--font-ui)", fontSize: 12, fontWeight: 600, borderRadius: 8, padding: "8px 11px", cursor: "pointer", minHeight: 36, border: `1px solid ${active ? col.bd : "#e4e7ec"}`, background: active ? col.soft : "#fff", color: active ? col.ink : "#5b616e" };
}
function findingBtn(m: InspectionSeverityMeta): CSSProperties {
  return { display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 600, color: m.ink, background: m.soft, border: `1px solid ${m.bd}`, borderRadius: 9, padding: "9px 13px", cursor: "pointer", minHeight: 40 };
}

function onPickFile(e: ChangeEvent<HTMLInputElement>, cb: (f: File | undefined) => void) {
  const f = e.target.files && e.target.files[0] ? e.target.files[0] : undefined;
  try {
    e.target.value = "";
  } catch {
    /* ignore */
  }
  cb(f);
}

function toDraft(r: InspectionRecord): Draft {
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
    surveyDate: r.surveyDate || r.scheduledDate || "",
    reportDate: r.reportDate || "",
    inspector: r.inspector || r.assignedTo || "",
    condition: r.condition || "fair",
    scope: r.scope || "",
    narrative: r.narrative || "",
    logs: (r.logs || []).map((l) => ({ ...l, _uid: uid() })),
    rubric: (r.rubric || []).map((s) => ({ ...s, items: s.items.map((it) => ({ ...it })) })),
    venueInfo: { ...(r.venueInfo || {}) },
    measurements: { ...(r.measurements || {}) },
    priorInspectionId: r.priorInspectionId ?? null,
    priorSurveyDate: r.priorSurveyDate || "",
    stage: r.stage || "requested",
    assignedTo: r.assignedTo || "",
    scheduledDate: r.scheduledDate || "",
    updatedAt: r.updatedAt || Date.now(),
  };
}

function firstRubricOpen(rubric: RubricSection[]): Record<string, boolean> {
  const o: Record<string, boolean> = {};
  if (rubric[0]) o[rubric[0].key] = true;
  return o;
}

function renumber(logs: DraftLog[]): DraftLog[] {
  const arr = logs.slice();
  arr.sort((a, b) => (SEV_ORDER[a.severity] - SEV_ORDER[b.severity]) || (a.seq || 0) - (b.seq || 0));
  return arr.map((l, i) => ({ ...l, id: i + 1 }));
}

function blankLog(partial: Partial<DraftLog>): DraftLog {
  return {
    id: 0,
    seq: Date.now(),
    svid: newSvid(),
    severity: "necessary",
    status: "open",
    problem: "",
    explanation: "",
    solution: "",
    workPerformed: "",
    location: "",
    standards: [],
    beforePhoto: null,
    afterPhoto: null,
    firstNoted: "",
    estHours: null,
    estCost: null,
    _uid: uid(),
    ...partial,
  };
}

function makeBlankRubric(meta: EditorMeta): RubricSection[] {
  const out: RubricSection[] = [];
  meta.rubricTemplate.forEach((grp, gi) => {
    grp.sections.forEach((sec, si) => {
      out.push({
        key: gi + "-" + si,
        group: grp.group,
        n: sec.n,
        title: sec.title,
        items: sec.items.map((label, i) => ({ l: meta.rubricLetters[i] || String(i + 1), label, rating: null })),
        comments: "",
        lineSet: "",
        photo: null,
      });
    });
  });
  return out;
}

function rubricSectionCount(meta: EditorMeta): number {
  return meta.rubricTemplate.reduce((a, g) => a + g.sections.length, 0);
}

type Counts = {
  urgent: { open: number; closed: number };
  necessary: { open: number; closed: number };
  basic: { open: number; closed: number };
  open: number;
  closed: number;
  total: number;
};
function countLogs(logs: DraftLog[]): Counts {
  const by: Record<string, { open: number; closed: number }> = {
    urgent: { open: 0, closed: 0 },
    necessary: { open: 0, closed: 0 },
    basic: { open: 0, closed: 0 },
  };
  let open = 0;
  let closed = 0;
  let total = 0;
  logs.forEach((l) => {
    const b = by[l.severity] || (by[l.severity] = { open: 0, closed: 0 });
    if (l.status === "closed") {
      b.closed++;
      closed++;
    } else {
      b.open++;
      open++;
    }
    total++;
  });
  return { urgent: by.urgent, necessary: by.necessary, basic: by.basic, open, closed, total };
}
