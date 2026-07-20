"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { MapPin } from "@/components/map/LeafletMap";
import { ACCENT_INK, ACCENT_SOFT } from "./lib";

/**
 * Client bits for the Customers directory: the search / type / scope filter bar
 * (URL-as-state, debounced) and the venue map panel (LeafletMap needs the
 * browser, so it's pulled in with next/dynamic { ssr: false }).
 */

const LeafletMap = dynamic(() => import("@/components/map/LeafletMap"), {
  ssr: false,
  loading: () => (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: "#8c919c", background: "#e9eef1" }}>
      Loading map…
    </div>
  ),
});

export function CustomersMap({ pins }: { pins: MapPin[] }) {
  return (
    <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
      <LeafletMap pins={pins} height={640} />
    </div>
  );
}

const segActive: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: "#16181d",
  background: "#fff",
  border: "none",
  borderRadius: 7,
  padding: "7px 12px",
  cursor: "pointer",
  boxShadow: "0 1px 2px rgba(0,0,0,.08)",
};
const segIdle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: "#787d87",
  background: "transparent",
  border: "none",
  borderRadius: 7,
  padding: "7px 12px",
  cursor: "pointer",
};

export function FilterBar({
  q,
  type,
  scope,
  types,
  ownerOptions,
  meName,
}: {
  q: string;
  type: string;
  scope: string;
  types: string[];
  ownerOptions: Array<{ value: string; label: string }>;
  meName: string;
}) {
  const router = useRouter();
  const [text, setText] = useState(q);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => setText(q), [q]);

  const pushWith = (patch: { q?: string; type?: string; scope?: string }) => {
    const p = new URLSearchParams();
    const nq = patch.q !== undefined ? patch.q : text;
    const nt = patch.type !== undefined ? patch.type : type;
    const ns = patch.scope !== undefined ? patch.scope : scope;
    if (nq.trim()) p.set("q", nq.trim());
    if (nt && nt !== "all") p.set("type", nt);
    if (ns && ns !== "all") p.set("scope", ns);
    const s = p.toString();
    router.push("/companies" + (s ? "?" + s : ""));
  };

  const onSearch = (v: string) => {
    setText(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => pushWith({ q: v }), 300);
  };

  const ownerSelectValue = scope === "mine" ? meName : scope;

  return (
    <div style={{ marginBottom: 14 }}>
      {/* search */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 9,
          background: "#fff",
          border: "1px solid #e4e7ec",
          borderRadius: 9,
          padding: "9px 12px",
        }}
      >
        <span style={{ width: 14, height: 14, border: "1.7px solid #aab0bb", borderRadius: "50%", flexShrink: 0, position: "relative" }}>
          <span style={{ position: "absolute", right: -3, bottom: -3, width: 6, height: 1.7, background: "#aab0bb", transform: "rotate(45deg)" }} />
        </span>
        <input
          value={text}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search customers…"
          style={{ flex: 1, border: "none", background: "transparent", fontSize: 13.5, fontFamily: "var(--font-ui)", color: "#16181d", outline: "none" }}
        />
      </div>

      {/* type chips */}
      <div style={{ display: "flex", gap: 6, marginTop: 11, flexWrap: "wrap" }}>
        {types.map((t) => {
          const active = type === t || (t === "all" && (!type || type === "all"));
          return (
            <button
              key={t}
              onClick={() => pushWith({ type: t })}
              style={{
                fontSize: 11.5,
                fontWeight: active ? 600 : 500,
                padding: "5px 11px",
                borderRadius: 20,
                border: `1px solid ${active ? "var(--accent)" : "#e4e7ec"}`,
                cursor: "pointer",
                background: active ? ACCENT_SOFT : "#fff",
                color: active ? ACCENT_INK : "#5b616e",
              }}
            >
              {t === "all" ? "All" : t}
            </button>
          );
        })}
      </div>

      {/* scope */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 11 }}>
        <div style={{ display: "flex", background: "#eceef1", borderRadius: 9, padding: 3, flexShrink: 0 }}>
          <button onClick={() => pushWith({ scope: "mine" })} style={scope === "mine" ? segActive : segIdle}>
            My work
          </button>
          <button onClick={() => pushWith({ scope: "all" })} style={scope === "all" || !scope ? segActive : segIdle}>
            Everyone
          </button>
        </div>
        <select
          value={ownerSelectValue}
          onChange={(e) => pushWith({ scope: e.target.value === meName ? "mine" : e.target.value })}
          style={{
            flex: 1,
            minWidth: 0,
            fontFamily: "var(--font-ui)",
            fontSize: 12,
            fontWeight: 600,
            color: "#3a3f4a",
            background: "#fff",
            border: "1px solid #e4e7ec",
            borderRadius: 9,
            padding: "8px 11px",
            cursor: "pointer",
          }}
        >
          {ownerOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
