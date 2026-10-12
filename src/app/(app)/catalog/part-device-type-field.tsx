"use client";

import { useState, useTransition, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { setPartDeviceTypeAction } from "./device-types/actions";

/**
 * Grid notes #2 — the part editor's admin-only "Device type" control. Lives
 * inside `<form action={upsertPart}>` but submits nothing with it (no `name`,
 * a type="button" Save): the override is written only by
 * setPartDeviceTypeAction (manage_users, re-checked on the server), never by
 * the part form's save. "Auto" clears the override so the part follows its
 * raw category through Catalog → Device types.
 */

const LBL: CSSProperties = {
  fontSize: 10.5,
  fontWeight: 600,
  color: "#9aa0ab",
  textTransform: "uppercase",
  letterSpacing: ".05em",
  marginBottom: 5,
};

export type PartTypeChoice = { key: string; label: string };

export default function PartDeviceTypeField({
  sku,
  category,
  categoryTypeLabel,
  initial,
  types,
  inputStyle,
}: {
  sku: string;
  /** The part's raw catalog category ("" when blank). */
  category: string;
  /** The type that category maps to on its own, or null (unmapped). */
  categoryTypeLabel: string | null;
  /** The stored override ("" = none). */
  initial: string;
  /** Active device types, in order. An archived stored override is listed too. */
  types: PartTypeChoice[];
  inputStyle: CSSProperties;
}) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const auto = `Auto (from category: ${category || "none"} → ${categoryTypeLabel ?? "Unmapped"})`;

  const save = () =>
    start(async () => {
      setMsg(null);
      const r = await setPartDeviceTypeAction([sku], value || null);
      if (!r.ok) {
        setMsg({ ok: false, text: r.error });
        if (r.partial) router.refresh();
        return;
      }
      setSaved(value);
      setMsg({ ok: true, text: "Saved — every Grid design using this part shows the new type. Existing designators keep their numbers until Renumber." });
      router.refresh();
    });

  return (
    <div>
      <div style={LBL}>Device type (Grid)</div>
      <div style={{ display: "flex", gap: 8 }}>
        <select aria-label="Device type" value={value} onChange={(e) => setValue(e.target.value)} disabled={pending} style={{ ...inputStyle, flex: 1, minWidth: 0 }}>
          <option value="">{auto}</option>
          {types.map((t) => (
            <option key={t.key} value={t.key}>
              {t.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={save}
          disabled={pending || value === saved}
          style={{ ...inputStyle, width: "auto", cursor: pending || value === saved ? "default" : "pointer", fontWeight: 600, opacity: pending || value === saved ? 0.55 : 1 }}
        >
          {pending ? "Saving…" : "Save type"}
        </button>
      </div>
      <div style={{ fontSize: 11, color: msg && !msg.ok ? "#a0442b" : "#aab0bb", marginTop: 4 }}>
        {msg?.text ?? "This part only — wins over its category's type in the Grid's palette, layers, legends and designators. Admins only; saves on its own."}
      </div>
    </div>
  );
}
