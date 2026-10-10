"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveMyDriveBufferAction } from "./actions";

/** Spec 2026-10-09 "Buffer" — fixed minutes added to every drive leg. */
export default function DriveBufferCard({
  initial,
  companyDefault,
}: {
  initial: number | null;
  companyDefault: number;
}) {
  const router = useRouter();
  const [useDefault, setUseDefault] = useState(initial == null);
  const [value, setValue] = useState(String(initial ?? companyDefault));
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState("");

  function save(nextUseDefault: boolean, nextValue: string) {
    setMsg("");
    startTransition(async () => {
      const n = nextUseDefault || nextValue.trim() === "" ? null : Number(nextValue);
      const r = await saveMyDriveBufferAction(n != null && Number.isFinite(n) ? n : null);
      if (r.ok) {
        if (r.driveBufferMin != null) setValue(String(r.driveBufferMin));
        else {
          // Cleared box = company default: make the card say so too.
          setUseDefault(true);
          setValue(String(companyDefault));
        }
        setMsg("Saved");
        router.refresh();
      }
    });
  }

  return (
    <div className="pk-card" style={{ padding: "17px 18px", marginTop: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 14.5, fontWeight: 600 }}>Drive buffer</div>
          <div style={{ fontSize: 12, color: "#9aa0ab", marginTop: 3, lineHeight: 1.5 }}>
            Extra minutes added to every drive on your calendar — parking, walking in, slack.
          </div>
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5 }}>
          <input
            type="checkbox"
            checked={useDefault}
            disabled={pending}
            onChange={(e) => {
              setUseDefault(e.target.checked);
              save(e.target.checked, value);
            }}
          />
          Company default ({companyDefault} min)
        </label>
        <input
          type="number"
          min={0}
          max={120}
          className="pk-input"
          style={{ width: 72, fontSize: 12.5 }}
          value={value}
          disabled={useDefault || pending}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => !useDefault && save(false, value)}
        />
        <span style={{ fontSize: 12, color: "#9aa0ab" }}>min</span>
        {msg && !pending && <span style={{ fontSize: 11, color: "#1f7a52" }}>{msg}</span>}
      </div>
    </div>
  );
}
