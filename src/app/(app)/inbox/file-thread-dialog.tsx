"use client";

/**
 * #348 slice 4 — "File to estimate / project…": link this thread to an estimate or project, optionally under a vendor
 * company (which adds the vendor party). Owner-only (the card hides the button on a read-only thread and the action
 * refuses it). The thread's current work link is shown and, when the pick differs, the dialog says filing replaces it.
 */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ReaderVM } from "./types";
import { fileThreadAction } from "./vendor-file-actions";
import FilingTargetSearch from "@/components/vendors/filing-target-search";
import VendorCompanyField from "@/components/vendors/vendor-company-field";
import { VENDOR_COPY } from "@/lib/vendor-quotes/rules";
import type { FilingTargetVM } from "@/lib/vendor-quotes/vm";
import { ACCENT_BTN, BTN, MUTED } from "./sidebar-styles";

export default function FileThreadDialog({ vm, onClose }: { vm: ReaderVM; onClose: () => void }) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  // An estimate/project the thread is already linked to starts picked — filing it just adds the vendor.
  const current: FilingTargetVM | null =
    vm.link && (vm.link.type === "quote" || vm.link.type === "project")
      ? { type: vm.link.type, id: vm.link.id, label: vm.link.label, sub: "" }
      : null;
  const [target, setTarget] = useState<FilingTargetVM | null>(current);
  const [vendor, setVendor] = useState(vm.vendorCompany?.name ?? "");
  const [vendorId, setVendorId] = useState<string | null>(vm.vendorCompany?.id ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filed, setFiled] = useState<string | null>(null);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (!d.open) d.showModal();
    d.querySelector("input")?.focus();
  }, []);

  const replaces = !!vm.link && !!target && !(vm.link.type === target.type && vm.link.id === target.id);

  const file = async () => {
    if (!target || busy || filed) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fileThreadAction(vm.id, { type: target.type, id: target.id }, vendorId);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setFiled(VENDOR_COPY.filed(r.label));
      router.refresh();
    } catch {
      setError("Couldn't file this email — try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      aria-label={VENDOR_COPY.fileTitle}
      style={{ width: "min(480px, calc(100vw - 32px))", margin: "auto", maxHeight: "calc(100vh - 64px)", overflow: "visible", border: "1px solid #e4e7ec", borderRadius: 12, padding: 0 }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 18px", borderBottom: "1px solid #f0f1f4" }}>
        <span style={{ fontSize: 14.5, fontWeight: 600 }}>{VENDOR_COPY.fileTitle}</span>
        <button type="button" onClick={onClose} aria-label="Close" style={{ border: 0, background: "transparent", fontSize: 16, cursor: "pointer" }}>
          ✕
        </button>
      </div>
      <div style={{ padding: "14px 18px 18px", display: "grid", gap: 12 }}>
        {vm.link && (
          <div style={{ fontSize: 12, color: "#5b616e" }}>
            Currently linked: <span style={{ fontWeight: 600 }}>{vm.link.kindLabel} · {vm.link.label}</span>
          </div>
        )}
        <FilingTargetSearch initial={current} onPick={setTarget} disabled={busy || !!filed} />
        {replaces && vm.link && (
          <div style={{ fontSize: 12, color: "#8a5a00", background: "#fff6e0", border: "1px solid #f0dcaa", borderRadius: 7, padding: "6px 9px" }}>
            {VENDOR_COPY.replaceLink(vm.link.label)}
          </div>
        )}
        <div>
          <label htmlFor="file-thread-vendor" style={{ display: "block", fontSize: 11.5, fontWeight: 600, color: "#5b616e", marginBottom: 5 }}>
            Vendor
          </label>
          <VendorCompanyField
            inputId="file-thread-vendor"
            vendor={vendor}
            vendorCompanyId={vendorId}
            vendors={[]}
            onPick={(c) => {
              setVendor(c.name);
              setVendorId(c.id);
            }}
            onTyped={(name) => {
              setVendor(name);
              setVendorId(null);
            }}
            onUnlink={() => setVendorId(null)}
            disabled={busy || !!filed}
          />
          {!vendorId && <div style={MUTED}>{VENDOR_COPY.fileNoVendor}</div>}
        </div>
        <div style={MUTED}>{VENDOR_COPY.fileShares}</div>
        {error && (
          <div role="alert" style={{ fontSize: 12, color: "#b4543a" }}>
            {error}
          </div>
        )}
        {filed && (
          <div role="status" style={{ fontSize: 12.5, fontWeight: 600, color: "#2f6b3a" }}>
            {filed}
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" onClick={onClose} style={BTN}>
            {filed ? "Done" : "Cancel"}
          </button>
          {!filed && (
            <button type="button" onClick={() => void file()} disabled={!target || busy} style={{ ...ACCENT_BTN, opacity: !target || busy ? 0.6 : 1 }}>
              {busy ? "Filing…" : "File"}
            </button>
          )}
        </div>
      </div>
    </dialog>
  );
}
