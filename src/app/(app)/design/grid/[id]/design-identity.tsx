"use client";

import { useRef, useState, useTransition, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { CustomerCombobox, type CustomerComboboxOption } from "@/components/customer-combobox";
import { renameGridDesignAction, setGridCustomerAction } from "./actions";

/**
 * The editor header's title + customer (#244): click the title to rename the
 * design (Enter / blur saves, Esc cancels); click the customer — or
 * "+ Customer" on a design that has none — to link a different one. A new
 * customer clears the venue and contact picked off the old one.
 */

const quiet: CSSProperties = {
  background: "none",
  border: "none",
  padding: "1px 3px",
  margin: 0,
  borderRadius: 5,
  font: "inherit",
  color: "#8c919c",
  fontWeight: 500,
  cursor: "pointer",
};
const field: CSSProperties = {
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: "#dfe2e8",
  borderRadius: 7,
  padding: "4px 8px",
  fontSize: 12.5,
  fontFamily: "inherit",
  color: "#16181d",
  background: "#fff",
};

export default function DesignIdentity({
  projectId,
  name,
  customer,
  customerId,
  customerOptions,
  canEdit,
  onError,
}: {
  projectId: string;
  name: string;
  customer: string;
  customerId: string | null;
  customerOptions: CustomerComboboxOption[];
  /** `create` permission — renaming and re-linking are refused without it
   *  (server-checked); without it the title and customer are plain text. */
  canEdit: boolean;
  onError: (message: string | null) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editingName, setEditingName] = useState(false);
  const [draft, setDraft] = useState(name);
  const [editingCustomer, setEditingCustomer] = useState(false);
  // Enter saves and unmounts the input, which then blurs — save once.
  const settled = useRef(false);

  const beginRename = () => {
    settled.current = false;
    setDraft(name);
    setEditingName(true);
  };
  const finishRename = (save: boolean) => {
    if (settled.current) return;
    settled.current = true;
    setEditingName(false);
    const clean = draft.trim();
    if (!save || !clean || clean === name) return;
    startTransition(async () => {
      const r = await renameGridDesignAction(projectId, clean);
      if (!r.ok) onError(r.error);
      else {
        onError(null);
        router.refresh();
      }
    });
  };
  const pickCustomer = (id: string) => {
    if (!id) return; // clearing the search box is not a pick
    setEditingCustomer(false);
    if (id === customerId) return;
    startTransition(async () => {
      const r = await setGridCustomerAction(projectId, id);
      if (!r.ok) onError(r.error);
      else {
        onError(null);
        router.refresh();
      }
    });
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13, fontWeight: 700, color: "#16181d", flexWrap: "wrap" }}>
      Manual Layout <span style={{ color: "#8c919c", fontWeight: 500 }}>·</span>
      {editingName ? (
        <input
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => finishRename(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              finishRename(true);
            } else if (e.key === "Escape") {
              e.preventDefault();
              finishRename(false);
            }
          }}
          aria-label="Design title"
          style={{ ...field, width: 240 }}
        />
      ) : (
        <button type="button" onClick={beginRename} disabled={pending || !canEdit} title={canEdit ? "Rename this design" : undefined} style={canEdit ? quiet : { ...quiet, cursor: "default" }}>
          {name}
        </button>
      )}
      <span style={{ color: "#8c919c", fontWeight: 500 }}>·</span>
      {editingCustomer ? (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 230, fontWeight: 500 }}>
            <CustomerCombobox
              options={customerOptions}
              value={customerId || ""}
              onChange={pickCustomer}
              placeholder="Search customers…"
              inputStyle={{ ...field, width: "100%", boxSizing: "border-box" }}
            />
          </span>
          <button type="button" onClick={() => setEditingCustomer(false)} style={{ ...quiet, fontSize: 12 }}>
            Cancel
          </button>
        </span>
      ) : !canEdit ? (
        customer ? <span style={{ color: "#8c919c", fontWeight: 500 }}>{customer}</span> : null
      ) : (
        <button
          type="button"
          onClick={() => setEditingCustomer(true)}
          disabled={pending}
          title={customer ? "Change the customer — clears the venue and contact" : "Link this design to a customer"}
          style={customer ? quiet : { ...quiet, color: "var(--accent)", fontWeight: 600 }}
        >
          {customer || "+ Customer"}
        </button>
      )}
    </div>
  );
}
