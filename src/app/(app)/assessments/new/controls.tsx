"use client";

/* The /assessments/new form (#340, Task 7). Server-rendered choices (customer, venues, scopes) come in as props; this
   only adds the online check — assessments are started online, then answered offline — and the pending state. */
import { useActionState, useSyncExternalStore } from "react";
import type { CreateState, NewAssessmentPrefill } from "../types";
import { createAssessmentAction } from "./actions";

function subscribeOnline(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => { window.removeEventListener("online", cb); window.removeEventListener("offline", cb); };
}
const onlineNow = () => navigator.onLine !== false;
const onlineServer = () => true;

export default function NewAssessmentForm({ p }: { p: NewAssessmentPrefill }) {
  const [state, formAction, pending] = useActionState<CreateState, FormData>(createAssessmentAction, {});
  const online = useSyncExternalStore(subscribeOnline, onlineNow, onlineServer);
  const noSites = p.sites.length === 0;

  return (
    <form
      action={formAction}
      onSubmit={(e) => { if (!navigator.onLine) e.preventDefault(); }}
      className="pk-card"
      style={{ padding: "18px 20px", display: "grid", gap: 14, maxWidth: 640 }}
    >
      <input type="hidden" name="customerId" value={p.company?.id ?? ""} />
      <input type="hidden" name="leadId" value={p.leadId} />
      <input type="hidden" name="visitId" value={p.visitId} />
      <input type="hidden" name="projectId" value={p.projectId} />

      <label>
        <div className="pk-field-label">Venue</div>
        {noSites ? (
          <div style={{ fontSize: 13, color: "#8c919c" }}>This customer has no venues yet. Add one on the company record first.</div>
        ) : (
          <select className="pk-input" name="siteId" defaultValue={p.siteId || p.sites[0]?.id} required>
            {p.sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
      </label>

      <label>
        <div className="pk-field-label">Space</div>
        <input className="pk-input" name="spaceLabel" maxLength={200} placeholder="Auditorium rm 132" />
      </label>

      <label>
        <div className="pk-field-label">Visit type</div>
        <select className="pk-input" name="visitType" defaultValue={p.visitTypes[0]?.key}>
          {p.visitTypes.map((v) => <option key={v.key} value={v.key}>{v.title}</option>)}
        </select>
      </label>

      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <div className="pk-field-label">Scopes</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 6 }}>
          {p.scopes.map((s) => (
            <label key={s.code} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13 }}>
              <input type="checkbox" name={`scope_${s.code}`} defaultChecked={s.on} disabled={s.code === "S0"} />
              <span>{s.title}</span>
              {s.depths.length > 0 && (
                <select name={`depth_${s.code}`} defaultValue={s.depths[0]} aria-label={`${s.title} depth`} style={{ fontSize: 12, marginLeft: 4 }}>
                  {s.depths.map((d) => <option key={d} value={d}>{d === "screen" ? "Screen" : "Full"}</option>)}
                </select>
              )}
            </label>
          ))}
        </div>
      </fieldset>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
        <label>
          <div className="pk-field-label">Visit date</div>
          <input className="pk-input" type="date" name="visitDate" defaultValue={p.visitDate} required />
        </label>
        <label>
          <div className="pk-field-label">Assessor</div>
          <select className="pk-input" name="assessorId" defaultValue={p.meId}>
            {p.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </label>
      </div>

      {!online && <div role="alert" style={{ fontSize: 13, color: "#8c3b26" }}>Start assessments while online.</div>}
      {state.error && <div role="alert" style={{ fontSize: 13, color: "#8c3b26" }}>{state.error}</div>}

      <div>
        <button type="submit" className="pk-btn-accent" style={{ padding: "9px 16px" }} disabled={pending || !online || noSites || !p.company}>
          {pending ? "Starting…" : "Start assessment"}
        </button>
      </div>
    </form>
  );
}
