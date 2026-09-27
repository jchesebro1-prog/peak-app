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
import { TRACKABLE_SYS_KEYS } from "@/lib/design/grid-scopes";
import type { AutoEstimate } from "@/lib/design/grid-auto-model";
import type { VenueType } from "@/lib/venue-types";
import type { IntakeCustomer } from "@/app/(app)/quotes/new/types";
import CustomerVenueContactPicker, {
  customerChoiceOf,
  customerReadyOf,
  initialCustomerVenueContact,
  type CustomerVenueContact,
} from "@/components/customer-venue-contact-picker";
import { saveGridIntakeAction } from "./actions";
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

/** An exact-feet readout (#244): type any whole number; it clamps to the
 *  field's LIM on Enter / blur. The slider beside it moves in 1 ft steps. */
function FeetInput({ field, value, onCommit }: { field: DimField; value: number; onCommit: (n: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  const [synced, setSynced] = useState(value);
  if (value !== synced) {
    setSynced(value);
    setDraft(String(value));
  }
  const commit = () => {
    const [min, max] = LIM[field];
    const n = Math.round(Number(draft));
    const next = Number.isFinite(n) && draft.trim() !== "" ? Math.max(min, Math.min(max, n)) : value;
    setDraft(String(next));
    if (next !== value) onCommit(next);
  };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontFamily: "var(--font-mono)", color: "#737985" }}>
      <input
        type="number"
        inputMode="numeric"
        min={LIM[field][0]}
        max={LIM[field][1]}
        step={1}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
        }}
        aria-label={`${field} in feet`}
        style={{ width: 56, border: "1px solid #e4e7ec", borderRadius: 6, padding: "3px 6px", fontFamily: "var(--font-mono)", fontSize: 12, color: "#16181d", textAlign: "right", background: "#fff" }}
      />
      ft
    </span>
  );
}

export default function GridIntake({
  projectId,
  projectName,
  initialAutoConfig,
  customers,
  venueTypes,
  initialCustomer,
}: {
  projectId: string;
  projectName: string;
  initialAutoConfig?: AState;
  /** #244 — the customer directory (the quote intake's view-model). */
  customers: IntakeCustomer[];
  venueTypes: VenueType[];
  /** #244 — a customer/venue/contact already on the project, pre-picked. */
  initialCustomer: { customerId: string; locationId: string; contactName: string };
}) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [step, setStep] = useState<"setup" | "equipment">("setup");
  // No preselection (#244): the venue section drops down once one is chosen.
  const [start, setStart] = useState<Start | null>(null);
  const [title, setTitle] = useState(projectName.trim() && projectName.trim() !== UNTITLED_GRID_DESIGN ? projectName : "");
  const [pick, setPick] = useState<CustomerVenueContact>(() => initialCustomerVenueContact(initialCustomer, venueTypes));
  const [cover, setCover] = useState<Cover>({ locationName: "", venueName: "", address: "" });
  // What the last picked venue filled in — a field still holding it may be
  // replaced by the next pick; anything typed is never overwritten.
  const autoFilled = useRef<Cover>({ locationName: "", venueName: "", address: "" });
  const [notes, setNotes] = useState("");
  const [a, setA] = useState<AState>(() => initialState(initialAutoConfig));
  const [estimate, setEstimate] = useState<AutoEstimate>({ tierByScope: {}, overrides: {} });
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const preview = useAutoPreview();
  const venue = VENUES.find((v) => v.key === a.venue) || VENUES[0];
  const scopeInputs = intakeScopeInputs(a);
  const chosen = TRACKABLE_SYS_KEYS.filter((k) => scopeInputs.sys[k]);
  const autoName = coverAutoName(cover.venueName, cover.locationName);
  const venueChosen = (pick.locationMode === "pick" && !!pick.locationId) || pick.locationMode === "new";

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

  /** A picked customer venue pre-fills the cover page's empty fields. */
  const changePick = (next: CustomerVenueContact) => {
    setPick(next);
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
        autoConfig: a,
        ...(start === "auto" ? { estimate } : {}),
      });
      if (!saved.ok) setError(saved.error);
      else if (saved.warning) setWarning(saved.warning);
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
          Design · New system design{start === "auto" ? ` · Step ${step === "setup" ? 1 : 2} of 2` : ""}
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
                              <FeetInput field={d.field} value={a[d.field]} onCommit={(n) => setDimension(d.field, n)} />
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
              {warning ? (
                <div style={{ marginTop: 16, border: "1px solid #f0dcbb", background: "#fdf4e7", borderRadius: 10, padding: "12px 14px", fontSize: 12.5, color: "#7a5a1c" }}>
                  {warning}
                  <div style={{ marginTop: 10 }}>
                    <button type="button" onClick={() => router.refresh()} style={primary(false)}>Open the plan →</button>
                  </div>
                </div>
              ) : (
                <div style={{ display: "flex", gap: 10, marginTop: 22 }}>
                  <button type="button" onClick={() => { setError(""); setStep("setup"); }} disabled={busy} style={ghost}>← Back</button>
                  <button type="button" onClick={save} disabled={busy || !preview.cards} style={{ ...primary(busy), flex: 1 }}>
                    {busy ? "Building your plan…" : "Build the plan →"}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
