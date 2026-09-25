"use client";

/**
 * #123 — the sidebar's top card: the thread's work link (quote / lead /
 * survey / inspection / project) with the picker that used to live inline
 * in thread-reader.tsx, plus "+ New quote", which opens the guided quote
 * intake pre-filled from the thread; the intake links the thread to the
 * quote it mints and comes back here (quotes/new/actions.ts).
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ReaderVM } from "./types";
import { setLinkAction } from "./actions";
import { LINK_TYPE_OPTIONS, newQuoteHref, type LinkWorkType } from "@/lib/inbox-links";
import { ACCENT_BTN, BTN, CARD, H, MUTED, SELECT } from "./sidebar-styles";

export default function WorkLinkCard({ vm }: { vm: ReaderVM }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [linkType, setLinkType] = useState<LinkWorkType>("quote");
  const [busy, setBusy] = useState(false);
  const options = open ? vm.linkOptions[linkType] || [] : [];
  // picking a record on an unlinked thread also adopts the resolved customer
  // (port of Comm Thread onLinkRec — unchanged from the inline picker)
  const adopt =
    vm.needsAdopt && vm.resolvedCustomerId
      ? { customerId: vm.resolvedCustomerId, customer: vm.resolvedCustomerName }
      : null;

  const pick = async (id: string) => {
    if (!id || busy) return;
    setBusy(true);
    try {
      const opt = options.find((o) => o.value === id);
      await setLinkAction(vm.id, { type: linkType, id, label: opt ? opt.label : id }, adopt);
      setOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await setLinkAction(vm.id, null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };
  const newQuote = () =>
    router.push(
      newQuoteHref({
        threadId: vm.id,
        customerId: vm.resolvedCustomerId,
        contactName: vm.customerCard?.contactName || "",
        siteId: vm.siteId,
      })
    );

  return (
    <div style={CARD}>
      <div style={H}>Work</div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {vm.link && (
          <>
            <a
              href={vm.link.href}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 7,
                minWidth: 0,
                maxWidth: "100%",
                textDecoration: "none",
                fontSize: 11.5,
                fontWeight: 600,
                color: "#3a3f4a",
                background: "#f4f5f7",
                border: "1px solid #e8eaee",
                borderRadius: 8,
                padding: "6px 10px",
              }}
            >
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: ".04em",
                  textTransform: "uppercase",
                  color: "#fff",
                  background: vm.link.color,
                  padding: "2px 6px",
                  borderRadius: 5,
                  flexShrink: 0,
                }}
              >
                {vm.link.kindLabel}
              </span>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {vm.link.label}
              </span>
            </a>
            <button
              onClick={remove}
              disabled={busy}
              title="Remove link"
              style={{
                width: 26,
                height: 26,
                flexShrink: 0,
                borderRadius: 7,
                border: "1px solid #e4e7ec",
                background: "#fff",
                color: "#aab0bb",
                fontSize: 14,
                lineHeight: 1,
                cursor: "pointer",
              }}
            >
              ×
            </button>
          </>
        )}
        <button onClick={() => setOpen(!open)} style={ACCENT_BTN}>
          {vm.link ? "Change link" : "+ Link to work"}
        </button>
        <button
          onClick={newQuote}
          title="Start a draft quote for this thread's customer — it links back here"
          style={BTN}
        >
          + New quote
        </button>
      </div>
      {open && (
        <>
          {vm.resolvedCustomerId ? (
            <div style={{ ...MUTED, marginTop: 9 }}>
              Showing{" "}
              <span style={{ fontWeight: 600, color: "#5b616e" }}>{vm.resolvedCustomerName}</span>
              &apos;s quotes, leads, surveys, inspections &amp; projects.
            </div>
          ) : (
            <div style={{ ...MUTED, marginTop: 9 }}>
              Link this thread to a customer first and their records will show here.
            </div>
          )}
          <div style={{ display: "grid", gap: 8, marginTop: 9 }}>
            <select
              value={linkType}
              onChange={(e) => setLinkType(e.target.value as LinkWorkType)}
              style={SELECT}
            >
              {LINK_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <select value="" onChange={(e) => void pick(e.target.value)} disabled={busy} style={SELECT}>
              <option value="">Select a record…</option>
              {options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </>
      )}
    </div>
  );
}
