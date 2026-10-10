"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import WorkHoursEditor from "@/components/visit-booking/work-hours-editor";
import { fmtWorkHours, type WorkHours } from "@/lib/visit-plan/settings";
import { saveMyWorkHoursAction } from "./actions";

/** Spec 2026-10-09 site-visit scheduling — this person's work hours. */
export default function WorkHoursCard({ initial, companyDefault }: { initial: WorkHours | null; companyDefault: WorkHours }) {
  const router = useRouter();
  const [useDefault, setUseDefault] = useState(initial == null);
  const [hours, setHours] = useState<WorkHours>(initial ?? companyDefault);
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const save = (nextUseDefault: boolean, next: WorkHours) =>
    startTransition(async () => {
      setMsg("");
      setError("");
      const r = await saveMyWorkHoursAction(nextUseDefault ? null : next);
      if (!r.ok) {
        setError(r.error);
        if (nextUseDefault) setUseDefault(false); // the save didn't happen — don't show it as on
        return;
      }
      setHours(r.workHours ?? companyDefault);
      setMsg("Saved");
      router.refresh();
    });
  return (
    <div className="pk-card" style={{ padding: "17px 18px", marginTop: 20 }}>
      <div style={{ fontSize: 14.5, fontWeight: 600 }}>Work hours</div>
      <div style={{ fontSize: 12, color: "#9aa0ab", marginTop: 3, lineHeight: 1.5 }}>
        A visit or drive outside these hours is flagged when someone books you. Nothing is blocked.
      </div>
      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, marginTop: 10 }}>
        <input
          type="checkbox"
          checked={useDefault}
          disabled={pending}
          onChange={(e) => {
            setUseDefault(e.target.checked);
            if (e.target.checked) save(true, hours);
            else setHours(companyDefault); // start editing from the hours shown
          }}
        />
        Company default ({fmtWorkHours(companyDefault)})
      </label>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
        <WorkHoursEditor value={useDefault ? companyDefault : hours} onChange={setHours} disabled={useDefault || pending} />
        {!useDefault && (
          <button className="pk-btn-accent" style={{ fontSize: 12.5 }} disabled={pending} onClick={() => save(false, hours)}>
            {pending ? "Saving…" : "Save"}
          </button>
        )}
        {msg && !pending && <span style={{ fontSize: 11, color: "#1f7a52" }}>{msg}</span>}
        {error && <span style={{ fontSize: 11, color: "#b42318" }}>{error}</span>}
      </div>
    </div>
  );
}
