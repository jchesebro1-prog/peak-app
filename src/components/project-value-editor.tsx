"use client";

import { useState } from "react";

/**
 * Task 9 follow-up — inline "fill in later" editor for a Daylite-imported
 * project's UKN contract value. Server-rendered display (formatted value or
 * "UKN") + an Edit affordance that swaps in a number input with Save/Cancel,
 * mirroring the file's existing inline forms (e.g. the procurement PO field
 * in view.tsx). Parented with `key={`${value}-${valueUnknown}`}` from the
 * server so a successful save (which changes those props) remounts this
 * component back to display mode automatically.
 */
export function ProjectValueEditor({
  id,
  value,
  valueUnknown,
  display,
  action,
}: {
  id: string;
  /** Current raw value — 0/absent when unknown, prefilled into the input. */
  value: number | null | undefined;
  valueUnknown: boolean;
  /** Server-formatted display string ("$86,400" or "UKN"). */
  display: string;
  action: (formData: FormData) => void | Promise<void>;
}) {
  const [editing, setEditing] = useState(false);

  if (!editing) {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
        {display}
        <button
          type="button"
          className="pk-btn-outline"
          style={{ padding: "2px 8px", fontSize: 10 }}
          onClick={() => setEditing(true)}
        >
          {valueUnknown ? "Fill in" : "Edit"}
        </button>
      </span>
    );
  }

  return (
    <form
      action={action}
      style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
    >
      <input type="hidden" name="id" value={id} />
      <input
        name="value"
        type="text"
        inputMode="decimal"
        defaultValue={value ? String(value) : ""}
        placeholder="86400"
        autoFocus
        className="pk-input mono"
        style={{ width: 104, padding: "5px 8px", fontSize: 12.5 }}
      />
      <button type="submit" className="pk-btn-outline" style={{ padding: "5px 10px", fontSize: 11 }}>
        Save
      </button>
      <button
        type="button"
        className="pk-btn-outline"
        style={{ padding: "5px 10px", fontSize: 11 }}
        onClick={() => setEditing(false)}
      >
        Cancel
      </button>
    </form>
  );
}
