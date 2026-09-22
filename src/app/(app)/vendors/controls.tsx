"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { SearchFilterBar } from "@/components/search/search-filter-bar";
import { ACCENT_INK, ACCENT_SOFT } from "@/app/(app)/companies/lib";
import { VENDOR_STATUS_KEYS, VENDOR_STATUS_META, type VendorStatusKey } from "@/lib/vendor-status";
import { claimManufacturerAction, createVendorAction } from "./actions";

/**
 * #122 — client bits for /vendors: the search + status filter bar
 * (URL-as-state, debounced — the Companies FilterBar idiom), the "+ New
 * vendor" quick-add, and the "Unclaimed manufacturers" panel's one-click
 * claims. Display + server-action calls only: no store imports.
 */

const INPUT: React.CSSProperties = {
  flex: 1,
  border: "none",
  background: "transparent",
  fontSize: 13.5,
  fontFamily: "var(--font-ui)",
  color: "#16181d",
  outline: "none",
};
const BTN: React.CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 12,
  fontWeight: 600,
  color: "#3a3f4a",
  background: "#fff",
  border: "1px solid #e4e7ec",
  borderRadius: 8,
  padding: "7px 11px",
  cursor: "pointer",
};
const SELECT: React.CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 12,
  color: "#16181d",
  border: "1px solid #e4e7ec",
  borderRadius: 8,
  padding: "6px 8px",
  background: "#fff",
  maxWidth: 220,
};

export function VendorFilterBar({
  q,
  status,
  counts,
  total,
}: {
  q: string;
  status: VendorStatusKey | "all";
  counts: Record<VendorStatusKey, number>;
  total: number;
}) {
  const router = useRouter();
  const [text, setText] = useState(q);
  const [prevQ, setPrevQ] = useState(q);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Derived-state reset during render (companies/controls.tsx idiom) — no effect.
  if (prevQ !== q) {
    setPrevQ(q);
    setText(q);
  }
  const pushWith = (patch: { q?: string; status?: string }) => {
    const p = new URLSearchParams();
    const nq = patch.q !== undefined ? patch.q : text;
    const ns = patch.status !== undefined ? patch.status : status;
    if (nq.trim()) p.set("q", nq.trim());
    if (ns && ns !== "all") p.set("status", ns);
    const s = p.toString();
    router.push("/vendors" + (s ? "?" + s : ""));
  };
  const onSearch = (v: string) => {
    setText(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => pushWith({ q: v }), 300);
  };
  const chips: Array<{ key: VendorStatusKey | "all"; label: string; n: number }> = [
    { key: "all", label: "All", n: total },
    ...VENDOR_STATUS_KEYS.map((k) => ({ key: k, label: VENDOR_STATUS_META[k].label, n: counts[k] })),
  ];
  return (
    <div style={{ marginBottom: 14 }}>
      {/* #121: the search box and the status chips share ONE row (SearchFilterBar). */}
      <SearchFilterBar
        value={text}
        onChange={onSearch}
        placeholder="Search vendors and manufacturers…"
        ariaLabel="Search vendors"
      >
        <span className="pk-searchbar-group" role="group" aria-label="Status filter">
          {chips.map((c) => {
            const on = status === c.key;
            return (
              <button
                key={c.key}
                type="button"
                aria-pressed={on}
                onClick={() => pushWith({ status: c.key })}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  height: 36,
                  boxSizing: "border-box",
                  fontSize: 11.5,
                  fontWeight: on ? 600 : 500,
                  borderRadius: 20,
                  padding: "0 11px",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  border: `1px solid ${on ? "var(--accent)" : "#e4e7ec"}`,
                  background: on ? ACCENT_SOFT : "#fff",
                  color: on ? ACCENT_INK : "#5b616e",
                }}
              >
                {c.label}
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 600, color: on ? ACCENT_INK : "#9aa0ab" }}>
                  {c.n}
                </span>
              </button>
            );
          })}
        </span>
      </SearchFilterBar>
    </div>
  );
}

export function NewVendorForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();
  const submit = () => {
    const n = name.trim();
    if (!n) {
      setErr("Enter the vendor's name.");
      return;
    }
    start(async () => {
      setErr("");
      const res = await createVendorAction(n);
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      router.push(`/vendors/${encodeURIComponent(res.id)}`);
      router.refresh();
    });
  };
  return (
    <div className="pk-card" style={{ padding: "14px 18px", marginBottom: 14 }}>
      <div style={{ fontSize: 13.5, fontWeight: 600 }}>New vendor</div>
      <div style={{ fontSize: 11.5, color: "#8c919c", marginTop: 2 }}>
        Creates a company typed vendor/manufacturer. Claim its manufacturers and add contacts on the vendor page.
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          placeholder="e.g. Rose Brand"
          aria-label="Vendor name"
          autoFocus
          style={{ ...INPUT, flex: "1 1 260px", border: "1px solid #e4e7ec", borderRadius: 9, padding: "9px 11px", background: "#fff" }}
        />
        <button type="button" className="pk-btn-accent" disabled={pending} onClick={submit}>
          {pending ? "Creating…" : "Create vendor"}
        </button>
        <Link href="/vendors" style={{ ...BTN, textDecoration: "none", display: "inline-flex", alignItems: "center" }}>
          Cancel
        </Link>
      </div>
      {err && <div style={{ marginTop: 8, fontSize: 12, color: "#b4543a" }}>{err}</div>}
    </div>
  );
}

export function UnclaimedPanel({
  items,
  vendors,
}: {
  items: Array<{ name: string; count: number }>;
  vendors: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  /** per-manufacturer target: "" = a vendor named after the manufacturer */
  const [target, setTarget] = useState<Record<string, string>>({});
  const claim = (name: string) =>
    start(async () => {
      setErr("");
      const res = await claimManufacturerAction(target[name] || null, name);
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      router.push(`/vendors/${encodeURIComponent(res.id)}`);
      router.refresh();
    });
  return (
    <div className="pk-card" style={{ padding: 0, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "14px 18px 12px", borderBottom: "1px solid #f0f1f4" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14.5, fontWeight: 600 }}>Unclaimed manufacturers</div>
          <div style={{ fontSize: 11.5, color: "#8c919c", marginTop: 2 }}>
            One vendor owns each manufacturer — claiming it moves it to that vendor. Spellings that differ only in case or
            punctuation are the same claim.
          </div>
        </div>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "#9aa0ab" }}>{items.length}</span>
      </div>
      {items.map((m) => (
        <div key={m.name} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 18px", borderBottom: "1px solid #f5f6f8", flexWrap: "wrap" }}>
          <span style={{ flex: "1 1 160px", minWidth: 0, fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.name}</span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "#9aa0ab" }}>{m.count} part{m.count === 1 ? "" : "s"}</span>
          <select
            value={target[m.name] || ""}
            onChange={(e) => setTarget((t) => ({ ...t, [m.name]: e.target.value }))}
            aria-label={`Vendor for ${m.name}`}
            style={SELECT}
          >
            <option value="">New vendor “{m.name}”</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>{v.name}</option>
            ))}
          </select>
          <button type="button" style={BTN} disabled={pending} onClick={() => claim(m.name)}>
            Claim
          </button>
        </div>
      ))}
      {items.length === 0 && (
        <div style={{ padding: "22px 18px", textAlign: "center", color: "#9aa0ab", fontSize: 12.5 }}>
          Every catalog manufacturer is claimed by a vendor.
        </div>
      )}
      {err && <div style={{ padding: "8px 18px 12px", fontSize: 12, color: "#b4543a" }}>{err}</div>}
    </div>
  );
}
