"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  DIMSCHEMA,
  LIM,
  SIZES,
  VENUES,
  sizedDims,
  type AState,
  type DimField,
} from "@/app/(app)/design/quick/engine";
import { coverAutoName, coverFromVenue, gridIntakeDefaults, intakeScopeInputs, UNTITLED_GRID_DESIGN } from "@/lib/design/grid-intake";
import { houseFields, type HouseField } from "@/lib/design/venue-templates/house-dims";
import { effectiveTemplateFor, planKindTemplates, resolveBackground, sanitizeTemplateId, templateEntry } from "@/lib/design/venue-templates";
import { TRACKABLE_SYS_KEYS } from "@/lib/design/grid-scopes";
import type { AutoEstimate } from "@/lib/design/grid-auto-model";
import type { VenueType } from "@/lib/venue-types";
import FeetInput from "@/components/design/feet-input";
import MovableFields from "@/components/design/movable-fields";
import type { IntakeCustomer } from "@/app/(app)/quotes/new/types";
import CustomerVenueContactPicker, {
  customerChoiceOf,
  customerReadyOf,
  initialCustomerVenueContact,
  type CustomerVenueContact,
} from "@/components/customer-venue-contact-picker";
import { notePlanUploadFailedAction, planCandidatesAction, saveGridIntakeAction } from "./actions";
import { newPlanUploadId, planFileProblem } from "@/lib/design/grid-plan-upload";
import { GRID_SHEET_ACCEPT, GRID_SHEET_DIRECT_MAX_LABEL } from "@/lib/design/grid-sheet-upload";
import { uploadGridSheet } from "./sheet-upload";
import Link from "next/link";
import { GRID_SHEET_MAX_LABEL } from "@/lib/grid-sheet-file";
import type { PlanCandidate } from "@/lib/design/grid-plan-intake";
import { estimateIntakeNote, GRID_LINK_COPY } from "@/lib/design/estimate-grid-link";
import ScopePicker from "./scope-picker";
import { EquipmentCards, useAutoPreview } from "./equipment-card";

/**
 * The one Grid intake (#211; one page since #244):
 *   Design title → Customer (the quote intake's picker: customer, venue,
 *   contact) → Start from Auto or Blank. Choosing one drops the venue section
 *   down on the same page: type, size, scopes, stage dimensions, cover page.
 *   Blank saves from there; Auto goes on to Equipment — per scope
 *   Good / Better / Best, swaps, qty.
 * Blank opens the canvas on the generated base sheet; Auto also fills it.
 * Everything lands as ordinary, fully editable placements.
 */

type Start = "auto" | "blank";
type Cover = { locationName: string; venueName: string; address: string };

function initialState(value?: AState): AState {
  if (value) return { ...value, sys: { ...value.sys } };
  // #244 — a new Grid design opens on Jeff's Auditorium default.
  return gridIntakeDefaults();
}

const input = { width: "100%", boxSizing: "border-box" as const, border: "1px solid #e4e7ec", borderRadius: 8, padding: "10px 11px", fontFamily: "var(--font-ui)", fontSize: 13, color: "#16181d", background: "#fff" };
const section = { borderTop: "1px solid #ececf0", paddingTop: 18, marginTop: 20 };
const label = { display: "block", fontSize: 10, fontWeight: 700, color: "#737985", textTransform: "uppercase" as const, marginBottom: 7, letterSpacing: ".06em" };
const card = (on: boolean): React.CSSProperties => ({
  textAlign: "left", padding: "12px 13px", borderRadius: 10, cursor: "pointer",
  background: on ? "color-mix(in srgb, var(--accent) 12%, #fff)" : "#fff",
  border: `1.5px solid ${on ? "var(--accent)" : "#e8eaee"}`,
});
const primary = (busy: boolean): React.CSSProperties => ({ border: "none", borderRadius: 9, padding: "12px 16px", background: "var(--accent)", color: "#fff", fontSize: 13.5, fontWeight: 700, cursor: busy ? "wait" : "pointer" });
const ghost: React.CSSProperties = { border: "1px solid #e4e7ec", borderRadius: 9, padding: "12px 16px", background: "#fff", color: "#3a3f4a", fontSize: 13.5, fontWeight: 600, cursor: "pointer" };

export default function GridIntake({
  projectId,
  projectName,
  initialAutoConfig,
  customers,
  venueTypes,
  initialCustomer,
  estimate: linkedEstimate = null,
  initialCover,
  planCandidates: initialCandidates = [],
  blobUploads = false,
}: {
  projectId: string;
  projectName: string;
  initialAutoConfig?: AState;
  /** #244 — the customer directory (the quote intake's view-model). */
  customers: IntakeCustomer[];
  venueTypes: VenueType[];
  /** #244 — a customer/venue/contact already on the project, pre-picked. */
  initialCustomer: { customerId: string; locationId: string; contactName: string };
  /** #314: the estimate this design draws — Auto is hidden, parts come from its tray. */
  estimate?: { quoteId: string; quoteNumber: string; href: string } | null;
  /** #314: the picked venue's cover fields, pre-filled (an estimate's venue). */
  initialCover?: Cover;
  /** #314: plans already on file for this job ("Use plan from …"). */
  planCandidates?: PlanCandidate[];
  /** #318: file storage is on — the dropped plan uploads straight to Blob (≤ 25 MB). */
  blobUploads?: boolean;
}) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [step, setStep] = useState<"setup" | "equipment">("setup");
  // No preselection (#244): the venue section drops down once one is chosen.
  // #314: an estimate-linked design has one start — Blank (Auto is refused server-side too).
  const [start, setStart] = useState<Start | null>(linkedEstimate ? "blank" : null);
  const [title, setTitle] = useState(projectName.trim() && projectName.trim() !== UNTITLED_GRID_DESIGN ? projectName : "");
  const [pick, setPick] = useState<CustomerVenueContact>(() => initialCustomerVenueContact(initialCustomer, venueTypes));
  const [cover, setCover] = useState<Cover>(() => initialCover ?? { locationName: "", venueName: "", address: "" });
  // What the last picked venue filled in — a field still holding it may be
  // replaced by the next pick; anything typed is never overwritten.
  const autoFilled = useRef<Cover>(initialCover ?? { locationName: "", venueName: "", address: "" });
  // #314 — the plan view: an on-file plan (pre-attached, on by default) or a dropped file.
  const [candidates, setCandidates] = useState<PlanCandidate[]>(initialCandidates);
  const [usePlan, setUsePlan] = useState(initialCandidates.length > 0);
  const [planPick, setPlanPick] = useState(initialCandidates[0]?.id ?? "");
  const [planFile, setPlanFile] = useState<File | null>(null);
  const [planError, setPlanError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const planInput = useRef<HTMLInputElement>(null);
  const candidateReq = useRef(0);
  /** One id per picked file — the upload route makes a repeat of it a no-op. */
  const [planUploadId, setPlanUploadId] = useState("");
  const [notes, setNotes] = useState("");
  const [a, setA] = useState<AState>(() => initialState(initialAutoConfig));
  const [estimate, setEstimate] = useState<AutoEstimate>({ tierByScope: {}, overrides: {} });
  const [error, setError] = useState("");
  const preview = useAutoPreview();
  const venue = VENUES.find((v) => v.key === a.venue) || VENUES[0];
  const scopeInputs = intakeScopeInputs(a);
  const chosen = TRACKABLE_SYS_KEYS.filter((k) => scopeInputs.sys[k]);
  const autoName = coverAutoName(cover.venueName, cover.locationName);
  const venueChosen = (pick.locationMode === "pick" && !!pick.locationId) || pick.locationMode === "new";
  // #255: the picked (or new) venue's type decides the Background; the server re-reads it from the saved venue.
  const pickedVenueType =
    pick.locationMode === "new"
      ? pick.newLocation.venueKind || null
      : pick.locationMode === "pick"
        ? customers.find((c) => c.id === pick.customerId)?.locations.find((l) => l.id === pick.locationId)?.venueKind || null
        : null;
  const tplId = effectiveTemplateFor(venue.kind, { ...a, venueType: pickedVenueType }, venueTypes);

  const update = (patch: Partial<AState>) => setA((current) => ({ ...current, ...patch }));
  const setVenue = (key: string) => {
    const next = VENUES.find((v) => v.key === key) || VENUES[0];
    update({ venue: next.key, sys: { ...next.sys }, ...sizedDims(next, a.size) });
  };
  const setDimension = (field: DimField, raw: number | string) => {
    const [min, max] = LIM[field];
    const value = Math.max(min, Math.min(max, Math.round(Number(raw)) || min));
    update({ [field]: value } as Partial<AState>);
  };
  const setCoverField = (field: keyof Cover, value: string) => setCover((c) => ({ ...c, [field]: value }));

  /** #314: the plans on file for a (new) customer + venue pick — newest request wins. */
  const refreshCandidates = (customerId: string, locationId: string) => {
    const req = ++candidateReq.current;
    planCandidatesAction(projectId, { customerId, locationId }).then(
      (r) => {
        if (req !== candidateReq.current || !r.ok) return;
        setCandidates(r.candidates);
        setPlanPick((cur) => (r.candidates.some((c) => c.id === cur) ? cur : r.candidates[0]?.id ?? ""));
        setUsePlan((on) => (r.candidates.length ? (planFile ? false : on || !candidates.length) : false));
      },
      () => {
        /* keep what is shown — the drop field still works */
      }
    );
  };

  /** A picked customer venue pre-fills the cover page's empty fields. */
  const changePick = (next: CustomerVenueContact) => {
    setPick(next);
    if (next.customerId !== pick.customerId || next.locationId !== pick.locationId || next.customerMode !== pick.customerMode) {
      refreshCandidates(next.customerMode === "pick" ? next.customerId : "", next.customerMode === "pick" && next.locationMode === "pick" ? next.locationId : "");
    }
    const venuePicked = next.customerMode === "pick" && next.locationMode === "pick" && !!next.locationId;
    const changed = next.locationId !== pick.locationId || next.customerId !== pick.customerId || pick.locationMode !== "pick";
    if (!venuePicked || !changed) return;
    const customer = customers.find((c) => c.id === next.customerId);
    const loc = customer?.locations.find((l) => l.id === next.locationId);
    if (!customer || !loc) return;
    const filled = coverFromVenue(loc, customer.name);
    const out = { ...cover };
    for (const f of ["locationName", "venueName", "address"] as const) {
      if (!cover[f].trim() || cover[f] === autoFilled.current[f]) out[f] = filled[f];
    }
    setCover(out);
    autoFilled.current = filled;
  };

  const changeEstimate = (next: AutoEstimate, delay = 0) => {
    setEstimate(next);
    preview.run(scopeInputs, next, delay);
  };
  const pickFile = (file: File | null | undefined) => {
    setPlanError("");
    if (!file) return;
    const problem = planFileProblem(file, blobUploads);
    if (problem) return setPlanError(problem);
    setPlanFile(file);
    setPlanUploadId(newPlanUploadId());
    setUsePlan(false);
  };
  const candidateId = usePlan && !planFile && candidates.some((c) => c.id === planPick) ? planPick : null;

  const save = () => {
    if (!start) return;
    startTransition(async () => {
      setError("");
      const saved = await saveGridIntakeAction({
        projectId,
        mode: start === "auto" ? "auto" : "manual",
        title: title.trim(),
        customer: customerChoiceOf(pick),
        venueName: cover.venueName,
        locationName: cover.locationName,
        address: cover.address,
        notes,
        autoConfig: { ...a, venueType: pickedVenueType },
        ...(start === "auto" ? { estimate } : {}),
        planCandidateId: candidateId,
      });
      if (!saved.ok) return setError(saved.error);
      // #314 review: the intake is saved from here on, and the save's own
      // re-render has already swapped this intake for the editor — so nothing
      // below may rely on this component's state. The server persisted its
      // warnings (Auto fill, the on-file plan copy) as notices the editor
      // shows; a dropped plan that fails to upload leaves one the same way.
      // Locals only: these keep working after this component unmounts.
      // #318: the plan view (copied above, or uploaded here) opens in Adjust sheet.
      let adjustId = saved.planSheetId ?? null;
      if (planFile && planUploadId) {
        const up = await uploadGridSheet(projectId, planFile, { blobUploads, planUploadId });
        if (!up.ok) await notePlanUploadFailedAction(projectId, up.error).catch(() => null);
        else adjustId = up.sheetId;
      }
      if (adjustId) router.replace(`/design/grid/${encodeURIComponent(projectId)}?adjust=${encodeURIComponent(adjustId)}`);
      else router.refresh();
    });
  };
  const next = () => {
    setError("");
    if (!customerReadyOf(pick))
      return setError(pick.customerMode === "new" ? "Enter a name for the new customer." : "Pick a customer, or add a new one.");
    if (!start) return setError("Choose Auto or Blank.");
    if (!cover.venueName.trim() && !cover.locationName.trim() && !venueChosen) return setError("Add a venue or location to continue.");
    if (start === "blank") return save();
    if (!chosen.length) return setError("Pick at least one scope for Auto to fill.");
    const est: AutoEstimate = {
      tierByScope: Object.fromEntries(chosen.map((k) => [k, estimate.tierByScope[k] ?? "better"])),
      overrides: estimate.overrides,
    };
    setEstimate(est);
    preview.run(scopeInputs, est);
    setStep("equipment");
  };

  const subtitle =
    step === "setup"
      ? "Who it's for, then start from the equations (Auto) or a blank plan — the venue drops down once you choose. Either way you end up on the canvas, free to move, edit and delete anything."
      : "Pick Good / Better / Best per scope. Swap any part for a catalog part or an assembly, and adjust quantities.";

  return (
    <div style={{ minHeight: "100%", background: "#f7f8fa", padding: "42px 22px" }}>
      <div style={{ maxWidth: 1040, margin: "0 auto" }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--accent)" }}>
          Design · New system design{linkedEstimate ? ` · from estimate ${linkedEstimate.quoteNumber}` : ""}{start === "auto" ? ` · Step ${step === "setup" ? 1 : 2} of 2` : ""}
        </div>
        <h1 style={{ margin: "10px 0 8px", fontSize: 30, letterSpacing: "-.025em" }}>{title.trim() || autoName || projectName}</h1>
        <p style={{ margin: 0, color: "#737985", fontSize: 14, lineHeight: 1.55, maxWidth: 720 }}>{subtitle}</p>
        <div style={{ marginTop: 26, background: "#fff", border: "1px solid #ececf0", borderRadius: 14, padding: 22, boxShadow: "0 1px 2px rgba(0,0,0,.04)" }}>
          {step === "setup" && (
            <>
              <label style={{ display: "block", maxWidth: 620 }}>
                <span style={label}>Design title</span>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={autoName ? `${autoName} (automatic)` : "Leave blank to name it from the venue and location"}
                  style={input}
                />
              </label>

              <div style={section}>
                <div style={{ ...label, marginBottom: 0 }}>Who it&apos;s for</div>
                <div style={{ maxWidth: 620 }}>
                  <CustomerVenueContactPicker customers={customers} value={pick} onChange={changePick} venueTypes={venueTypes} />
                </div>
              </div>

              {linkedEstimate ? (
                <div style={section}>
                  <div style={label}>Start from</div>
                  {/* #314: no Auto for a design drawn from an estimate — its parts are the estimate's. */}
                  <div data-testid="intake-estimate-note" style={{ ...card(true), cursor: "default" }}>
                    <span style={{ display: "block", fontSize: 13.5, fontWeight: 700 }}>Blank plan from estimate {linkedEstimate.quoteNumber}</span>
                    <span style={{ display: "block", color: "#737985", fontSize: 12, marginTop: 3, lineHeight: 1.5 }}>
                      {estimateIntakeNote(linkedEstimate.quoteNumber)} Prices stay in the Estimator.{" "}
                      <Link href={linkedEstimate.href} style={{ color: "var(--accent)", fontWeight: 600 }}>
                        {GRID_LINK_COPY.openEstimate}
                      </Link>
                    </span>
                  </div>
                </div>
              ) : (
              <div style={section}>
                <div style={label}>Start from</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <button type="button" onClick={() => setStart("auto")} style={card(start === "auto")}>
                    <span style={{ display: "block", fontSize: 13.5, fontWeight: 700 }}>Auto (equations)</span>
                    <span style={{ display: "block", color: "#737985", fontSize: 12, marginTop: 3, lineHeight: 1.5 }}>
                      Good / Better / Best equipment per scope from the Equipment map, sized by your measurements and placed on the plan for you.
                    </span>
                  </button>
                  <button type="button" onClick={() => setStart("blank")} style={card(start === "blank")}>
                    <span style={{ display: "block", fontSize: 13.5, fontWeight: 700 }}>Blank</span>
                    <span style={{ display: "block", color: "#737985", fontSize: 12, marginTop: 3, lineHeight: 1.5 }}>
                      Start on the scaled plan and place catalog devices yourself. The Scope panel tracks placed $ against targets.
                    </span>
                  </button>
                </div>
              </div>
              )}

              {start && (
                <div style={section}>
                  <div style={label}>Plan view (optional)</div>
                  <div style={{ maxWidth: 620, display: "grid", gap: 10 }}>
                    <span style={{ color: "#737985", fontSize: 12, lineHeight: 1.5 }}>
                      A PDF or image of the venue&apos;s plan opens as the first sheet; the scaled venue drawing is still made behind it. You set the plan&apos;s scale on the canvas (Calibrate).
                    </span>
                    {candidates.length > 0 && (
                      <div data-testid="intake-plan-candidates" style={{ display: "grid", gap: 6 }}>
                        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, fontWeight: 600 }}>
                          <input
                            type="checkbox"
                            checked={usePlan && !planFile}
                            onChange={(e) => {
                              setUsePlan(e.target.checked);
                              if (e.target.checked) setPlanFile(null);
                            }}
                          />
                          {candidates.length === 1
                            ? `Use plan from ${candidates[0].from}: ${candidates[0].name}`
                            : "Use a plan already on file"}
                        </label>
                        {candidates.length > 1 && (
                          <select
                            aria-label="Plan on file"
                            value={planPick}
                            disabled={!usePlan || !!planFile}
                            onChange={(e) => setPlanPick(e.target.value)}
                            style={{ ...input, padding: "8px 10px" }}
                          >
                            {candidates.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.from}: {c.name} ({c.sizeLabel})
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                    )}
                    <div
                      data-testid="intake-plan-drop"
                      role="button"
                      tabIndex={0}
                      onClick={() => planInput.current?.click()}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          planInput.current?.click();
                        }
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        setDragOver(true);
                      }}
                      onDragLeave={() => setDragOver(false)}
                      onDrop={(e) => {
                        e.preventDefault();
                        setDragOver(false);
                        pickFile(e.dataTransfer.files?.[0]);
                      }}
                      style={{
                        border: `1.5px dashed ${dragOver ? "var(--accent)" : "#d6dae1"}`,
                        borderRadius: 10,
                        padding: "12px 14px",
                        fontSize: 12.5,
                        color: "#5b616e",
                        background: dragOver ? "color-mix(in srgb, var(--accent) 6%, #fff)" : "#fbfbfc",
                        cursor: "pointer",
                      }}
                    >
                      {planFile ? (
                        <span>
                          <strong style={{ color: "#16181d" }}>{planFile.name}</strong> — uploads when you continue.{" "}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setPlanFile(null);
                              if (candidates.length) setUsePlan(true);
                            }}
                            style={{ border: "none", background: "none", padding: 0, color: "#a33a2b", fontWeight: 600, cursor: "pointer", fontFamily: "inherit", fontSize: 12.5 }}
                          >
                            Remove
                          </button>
                        </span>
                      ) : (
                        <span>
                          {candidates.length ? "Or drop a different plan here" : "Drop a plan here"} (PDF or image, up to {blobUploads ? GRID_SHEET_DIRECT_MAX_LABEL : GRID_SHEET_MAX_LABEL}), or click to choose one.
                        </span>
                      )}
                    </div>
                    <input
                      ref={planInput}
                      type="file"
                      accept={GRID_SHEET_ACCEPT}
                      hidden
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        e.target.value = "";
                        pickFile(f);
                      }}
                    />
                    {planError && <div style={{ color: "#b4543a", fontSize: 12 }}>{planError}</div>}
                  </div>
                </div>
              )}

              {start && (
                <div style={section}>
                  <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 22 }}>
                    <div>
                      <div style={label}>Venue type</div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                        {VENUES.map((item) => (
                          <button key={item.key} type="button" onClick={() => setVenue(item.key)} style={card(item.key === a.venue)}>
                            <span style={{ display: "block", fontSize: 13, fontWeight: 650 }}>{item.label}</span>
                            <span style={{ display: "block", color: "#9aa0ab", fontSize: 11, marginTop: 2 }}>{item.sub}</span>
                          </button>
                        ))}
                      </div>
                      <div style={section}>
                        <div style={label}>Size of venue</div>
                        <div style={{ display: "flex", gap: 8 }}>
                          {SIZES.map(([key, text]) => (
                            <button key={key} type="button" onClick={() => update({ size: key, ...sizedDims(venue, key) })} style={{ ...card(key === a.size), flex: 1, textAlign: "center", fontWeight: 600 }}>
                              {text}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div style={section}>
                        <div style={label}>Scopes</div>
                        <ScopePicker value={a} onChange={update} />
                      </div>
                    </div>
                    <div>
                      <div style={label}>Stage dimensions</div>
                      <div style={{ display: "grid", gap: 13 }}>
                        {(DIMSCHEMA[venue.kind] || DIMSCHEMA.proscenium).map((d) => (
                          <div key={d.field}>
                            <span style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12.5, fontWeight: 600 }}>
                              <span>{d.label}</span>
                              <FeetInput label={d.field} min={LIM[d.field][0]} max={LIM[d.field][1]} value={a[d.field]} onCommit={(n) => setDimension(d.field, n)} />
                            </span>
                            <span style={{ display: "block", color: "#9aa0ab", fontSize: 10.5, margin: "3px 0 5px" }}>{d.note}</span>
                            <input
                              type="range"
                              min={LIM[d.field][0]}
                              max={LIM[d.field][1]}
                              step={1}
                              value={a[d.field]}
                              onChange={(e) => setDimension(d.field, e.target.value)}
                              aria-label={d.label}
                              style={{ width: "100%", accentColor: "var(--accent)" }}
                            />
                          </div>
                        ))}
                        {(() => {
                          // #249/#255: the house / nave the effective template stretches to, and a drawing choice when the kind has more than one.
                          const choices = planKindTemplates(venue.kind);
                          const f = houseFields(a, tplId);
                          const setHouse = (key: HouseField["key"], raw: number | string, lim: [number, number]) =>
                            update({ [key]: Math.max(lim[0], Math.min(lim[1], Math.round(Number(raw)) || lim[0])) } as Partial<AState>);
                          return (
                            <>
                              {choices.length > 1 && (
                                <label style={{ display: "block", fontSize: 12.5, fontWeight: 600 }}>
                                  Background
                                  {/* Blank = no override: the design follows its venue type's Background. */}
                                  <select value={sanitizeTemplateId(venue.kind, a.templateId) ?? ""} onChange={(e) => update({ templateId: e.target.value || null })} style={{ display: "block", width: "100%", marginTop: 5, fontSize: 12.5, padding: "6px 8px", border: "1px solid #e4e7ec", borderRadius: 7, background: "#fff" }}>
                                    <option value="">Venue type default ({templateEntry(resolveBackground(venueTypes, pickedVenueType, venue.kind))?.label ?? "none"})</option>
                                    {choices.map((t) => (
                                      <option key={t.id} value={t.id}>{t.label}</option>
                                    ))}
                                  </select>
                                </label>
                              )}
                              {f?.rows.map((r) => (
                                <div key={r.key}>
                                  <span style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12.5, fontWeight: 600 }}>
                                    <span>{r.label}</span>
                                    <FeetInput label={r.label} min={r.lim[0]} max={r.lim[1]} value={r.v} onCommit={(n) => setHouse(r.key, n, r.lim)} />
                                  </span>
                                  <span style={{ display: "block", color: "#9aa0ab", fontSize: 10.5, margin: "3px 0 5px" }}>{r.note}</span>
                                  <input type="range" min={r.lim[0]} max={r.lim[1]} step={1} value={r.v} onChange={(e) => setHouse(r.key, e.target.value, r.lim)} aria-label={r.label} style={{ width: "100%", accentColor: "var(--accent)" }} />
                                </div>
                              ))}
                              {f?.warning && <div style={{ fontSize: 11.5, color: "#b4543a", lineHeight: 1.4 }}>{f.warning}</div>}
                              <MovableFields value={a} tpl={tplId} onChange={update} />
                            </>
                          );
                        })()}
                      </div>
                      <div style={section}>
                        <div style={{ ...label, marginBottom: 12 }}>Venue cover page</div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                          <label><span style={label}>Location / campus</span><input value={cover.locationName} onChange={(e) => setCoverField("locationName", e.target.value)} placeholder="High School" style={input} /></label>
                          <label><span style={label}>Venue / space</span><input value={cover.venueName} onChange={(e) => setCoverField("venueName", e.target.value)} placeholder="Main space" style={input} /></label>
                        </div>
                        <label style={{ display: "block", marginTop: 14 }}><span style={label}>Address</span><input value={cover.address} onChange={(e) => setCoverField("address", e.target.value)} placeholder="Street, city, state" style={input} /></label>
                        <label style={{ display: "block", marginTop: 14 }}><span style={label}>Design notes</span><textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Audience, stage, access, existing system notes…" style={{ ...input, minHeight: 78, resize: "vertical" }} /></label>
                      </div>
                    </div>
                  </div>
                  <div style={{ marginTop: 14, fontSize: 12, color: "#737985" }}>
                    {venue.label} · {a.width}&apos; × {a.depth}&apos; × {a.grid}&apos; · {a.size} · {chosen.length} scope{chosen.length === 1 ? "" : "s"}
                  </div>
                </div>
              )}

              {error && <div style={{ marginTop: 12, color: "#b4543a", fontSize: 12 }}>{error}</div>}
              {start && (
                <div style={{ display: "flex", gap: 10, marginTop: 22 }}>
                  <button type="button" onClick={next} disabled={busy} style={{ ...primary(busy), flex: 1 }}>
                    {start === "auto" ? "Next: equipment →" : busy ? "Setting up your plan…" : "Continue to The Grid →"}
                  </button>
                </div>
              )}
            </>
          )}

          {step === "equipment" && (
            <>
              <EquipmentCards cards={preview.cards} estimate={estimate} onChange={changeEstimate} loading={preview.loading} error={preview.error} />
              {preview.error && !preview.loading && (
                <div style={{ marginTop: 10 }}>
                  <button type="button" onClick={() => preview.run(scopeInputs, estimate)} style={ghost}>
                    Retry
                  </button>
                </div>
              )}
              {error && <div style={{ marginTop: 12, color: "#b4543a", fontSize: 12 }}>{error}</div>}
              <div style={{ display: "flex", gap: 10, marginTop: 22 }}>
                <button type="button" onClick={() => { setError(""); setStep("setup"); }} disabled={busy} style={ghost}>← Back</button>
                <button type="button" onClick={save} disabled={busy || !preview.cards} style={{ ...primary(busy), flex: 1 }}>
                  {busy ? "Building your plan…" : "Build the plan →"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
