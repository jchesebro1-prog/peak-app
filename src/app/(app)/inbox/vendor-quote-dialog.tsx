"use client";

/**
 * #348 slice 4 — "Add as vendor quote…": pick the estimate, optionally file this email to it too (owner only), then
 * open the Estimator's vendor-quote form pre-filled from the attachment (only ids ride the URL, D-next-6). Adding is a
 * read of the email, so a read-only viewer gets this dialog without the filing checkbox.
 */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ReaderVM } from "./types";
import { fileThreadAction } from "./vendor-file-actions";
import FilingTargetSearch from "@/components/vendors/filing-target-search";
import { VENDOR_COPY, parseThreadAttachmentRef, vendorFromEmailHref } from "@/lib/vendor-quotes/rules";
import type { FilingTargetVM } from "@/lib/vendor-quotes/vm";
import { ACCENT_BTN, BTN } from "./sidebar-styles";

export default function VendorQuoteDialog({
  vm,
  attachment,
  onClose,
}: {
  vm: ReaderVM;
  attachment: { ref: string; name: string };
  onClose: () => void;
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [target, setTarget] = useState<FilingTargetVM | null>(() =>
    vm.link && vm.link.type === "quote" ? { type: "quote", id: vm.link.id, label: vm.link.label, sub: "" } : null
  );
  const [alsoFile, setAlsoFile] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (!d.open) d.showModal();
    d.querySelector("input")?.focus();
  }, []);

  const replaces =
    !vm.readOnly && alsoFile && !!vm.link && !!target && !(vm.link.type === "quote" && vm.link.id === target.id);

  const go = async () => {
    if (!target || busy) return;
    const ref = parseThreadAttachmentRef(attachment.ref);
    if (!ref) {
      setError(VENDOR_COPY.notOnEmail);
      return;
    }
    setBusy(true);
    setError(null);
    let pushed = false;
    try {
      if (!vm.readOnly && alsoFile) {
        const r = await fileThreadAction(vm.id, { type: "quote", id: target.id }, vm.vendorCompany?.id ?? null);
        if (!r.ok) {
          setError(r.error);
          return;
        }
      }
      router.push(vendorFromEmailHref(target.id, ref));
      pushed = true; // stay busy until the page changes so Continue can't double-submit
    } catch {
      setError("Couldn't open the estimate — try again.");
    } finally {
      if (!pushed) setBusy(false);
    }
  };

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      aria-label={VENDOR_COPY.addTitle}
      style={{ width: "min(480px, calc(100vw - 32px))", margin: "auto", maxHeight: "calc(100vh - 64px)", overflow: "visible", border: "1px solid #e4e7ec", borderRadius: 12, padding: 0 }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 18px", borderBottom: "1px solid #f0f1f4" }}>
        <span style={{ fontSize: 14.5, fontWeight: 600 }}>{VENDOR_COPY.addTitle}</span>
        <button type="button" onClick={onClose} aria-label="Close" style={{ border: 0, background: "transparent", fontSize: 16, cursor: "pointer" }}>
          ✕
        </button>
      </div>
      <div style={{ padding: "14px 18px 18px", display: "grid", gap: 12 }}>
        <div style={{ fontSize: 12, color: "#5b616e", overflowWrap: "anywhere" }}>
          Adding <span style={{ fontWeight: 600 }}>{attachment.name}</span> to an estimate.
        </div>
        <FilingTargetSearch kinds={["quote"]} initial={target} onPick={setTarget} disabled={busy} />
        {!vm.readOnly && (
          <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, color: "#3a3f4a" }}>
            <input type="checkbox" checked={alsoFile} onChange={(e) => setAlsoFile(e.target.checked)} disabled={busy} />
            {VENDOR_COPY.alsoFile}
          </label>
        )}
        {replaces && vm.link && (
          <div style={{ fontSize: 12, color: "#8a5a00", background: "#fff6e0", border: "1px solid #f0dcaa", borderRadius: 7, padding: "6px 9px" }}>
            {VENDOR_COPY.replaceLink(vm.link.label)}
          </div>
        )}
        {error && (
          <div role="alert" style={{ fontSize: 12, color: "#b4543a" }}>
            {error}
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" onClick={onClose} style={BTN}>
            Cancel
          </button>
          <button type="button" onClick={() => void go()} disabled={!target || busy} style={{ ...ACCENT_BTN, opacity: !target || busy ? 0.6 : 1 }}>
            {busy ? "Opening…" : "Continue"}
          </button>
        </div>
      </div>
    </dialog>
  );
}
