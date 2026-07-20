"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Client bits for the People directory (identity core, D85): the search /
 * company / status filter bar — URL-as-state with a debounced search box,
 * same pattern as the Companies FilterBar.
 */

export function PeopleFilterBar({
  q,
  company,
  status,
  companyOptions,
  statusOptions,
}: {
  q: string;
  company: string;
  status: string;
  companyOptions: Array<{ id: string; name: string }>;
  statusOptions: Array<{ value: string; label: string }>;
}) {
  const router = useRouter();
  const [text, setText] = useState(q);
  const [prevQ, setPrevQ] = useState(q);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset the draft text when the URL's q changes (derived-state reset
  // during render — avoids the set-state-in-effect cascade).
  if (prevQ !== q) {
    setPrevQ(q);
    setText(q);
  }

  const pushWith = (patch: { q?: string; company?: string; status?: string }) => {
    const p = new URLSearchParams();
    const nq = patch.q !== undefined ? patch.q : text;
    const nc = patch.company !== undefined ? patch.company : company;
    const ns = patch.status !== undefined ? patch.status : status;
    if (nq.trim()) p.set("q", nq.trim());
    if (nc && nc !== "all") p.set("company", nc);
    // "active" is the default view (spec §5.4) — only non-defaults go in the URL.
    if (ns && ns !== "active") p.set("status", ns);
    const s = p.toString();
    router.push("/people" + (s ? "?" + s : ""));
  };

  const onSearch = (v: string) => {
    setText(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => pushWith({ q: v }), 300);
  };

  const select: React.CSSProperties = {
    fontSize: 12.5,
    fontWeight: 600,
    color: "#3a3f4a",
    background: "#fff",
    border: "1px solid #e4e7ec",
    borderRadius: 8,
    padding: "8px 10px",
    fontFamily: "var(--font-ui)",
  };

  return (
    <div style={{ marginBottom: 14 }}>
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
          placeholder="Search people…"
          style={{ flex: 1, border: "none", background: "transparent", fontSize: 13.5, fontFamily: "var(--font-ui)", color: "#16181d", outline: "none" }}
        />
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 11, flexWrap: "wrap" }}>
        <select
          value={status}
          onChange={(e) => pushWith({ status: e.target.value })}
          style={select}
          aria-label="Status filter"
        >
          {statusOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <select
          value={company}
          onChange={(e) => pushWith({ company: e.target.value })}
          style={select}
          aria-label="Company filter"
        >
          <option value="all">All companies</option>
          {companyOptions.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
