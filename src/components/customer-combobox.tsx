"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

export type CustomerComboboxOption = {
  id: string;
  name: string;
  detail?: string;
  searchText?: string;
};

/**
 * Small, dependency-free customer typeahead. It keeps the canonical id in
 * state while letting users search by company, venue, city, or contact text.
 */
export function CustomerCombobox({
  options,
  value,
  onChange,
  placeholder = "Search customers…",
  disabled = false,
  inputStyle,
}: {
  options: CustomerComboboxOption[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  disabled?: boolean;
  inputStyle?: React.CSSProperties;
}) {
  const listId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.id === value) || null;
  const [query, setQuery] = useState(selected?.name || "");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const close = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);

  const matches = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    const ranked = options
      .map((o) => {
        const name = o.name.toLocaleLowerCase();
        const hay = `${o.name} ${o.detail || ""} ${o.searchText || ""}`.toLocaleLowerCase();
        const score = !q ? 3 : name.startsWith(q) ? 0 : name.includes(q) ? 1 : hay.includes(q) ? 2 : 99;
        return { o, score };
      })
      .filter((x) => x.score < 99)
      .sort((a, b) => a.score - b.score || a.o.name.localeCompare(b.o.name))
      .slice(0, 12)
      .map((x) => x.o);
    return ranked;
  }, [options, query]);

  const pick = (o: CustomerComboboxOption) => {
    setQuery(o.name);
    setOpen(false);
    onChange(o.id);
  };

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <input
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        autoComplete="off"
        disabled={disabled}
        value={query}
        placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActive(0);
          if (!e.target.value) onChange("");
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActive((i) => Math.min(i + 1, Math.max(0, matches.length - 1)));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => Math.max(0, i - 1));
          } else if (e.key === "Enter" && open && matches[active]) {
            e.preventDefault();
            pick(matches[active]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        style={inputStyle}
      />
      {open && (
        <div
          id={listId}
          role="listbox"
          style={{
            position: "absolute",
            zIndex: 80,
            top: "calc(100% + 5px)",
            left: 0,
            right: 0,
            maxHeight: 300,
            overflowY: "auto",
            background: "#fff",
            border: "1px solid #dfe2e8",
            borderRadius: 10,
            boxShadow: "0 14px 36px rgba(20,24,32,.14)",
            padding: 5,
          }}
        >
          {matches.map((o, i) => (
            <button
              key={o.id}
              type="button"
              role="option"
              aria-selected={o.id === value}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(o)}
              style={{
                width: "100%",
                border: 0,
                borderRadius: 7,
                padding: "8px 10px",
                textAlign: "left",
                fontFamily: "var(--font-ui)",
                cursor: "pointer",
                color: "#16181d",
                background: i === active ? "var(--accent-soft)" : "transparent",
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 600 }}>{o.name}</div>
              {o.detail && <div style={{ marginTop: 2, fontSize: 11, color: "#8c919c" }}>{o.detail}</div>}
            </button>
          ))}
          {matches.length === 0 && (
            <div style={{ padding: "10px", fontSize: 12, color: "#8c919c" }}>No customers match “{query}”.</div>
          )}
        </div>
      )}
    </div>
  );
}
