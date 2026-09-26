"use client";

import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { typeaheadMatches } from "@/lib/search/typeahead-rank";

/**
 * #121 — input + results rendered directly under it while typing: no
 * separate dropdown to open. Max 8 rows, ArrowUp/ArrowDown/Enter/Escape,
 * role=combobox/listbox/option. Generic over the item type; pass MODULE-LEVEL
 * filter/rank functions (stable identity) so the memo below is not recomputed
 * on every render of the parent.
 */
export type TypeaheadProps<T> = {
  items: T[];
  keyOf: (item: T) => string;
  filter: (q: string, item: T) => boolean;
  rank?: (q: string, item: T) => number;
  render: (item: T, active: boolean) => ReactNode;
  onPick: (item: T) => void;
  /** Text left in the box after a pick. Omit → the box clears (add-another pickers). */
  labelOf?: (item: T) => string;
  /** Controlled selection: when it changes the box re-syncs to labelOf(item), or clears. */
  selectedKey?: string | null;
  /**
   * Resolves the display item for `selectedKey` when `items` holds only a
   * live, server-searched result set (so the currently-selected item may not
   * be among them) rather than the full candidate pool. Falls back to
   * `items.find(i => keyOf(i) === selectedKey)` when omitted.
   */
  resolveSelected?: (key: string) => T | null | undefined;
  /** Multi-pick lists keep the results open after a pick. */
  stayOpen?: boolean;
  max?: number;
  placeholder?: string;
  ariaLabel?: string;
  inputStyle?: CSSProperties;
  emptyText?: string;
  /** Fires on every keystroke with the raw box text — for a parent that
   *  debounces a server search action instead of filtering `items` here. */
  onQueryChange?: (q: string) => void;
};

export function Typeahead<T>({
  items,
  keyOf,
  filter,
  rank,
  render,
  onPick,
  labelOf,
  selectedKey,
  resolveSelected,
  stayOpen = false,
  max = 8,
  placeholder = "Search…",
  ariaLabel,
  inputStyle,
  emptyText = "Nothing matches.",
  onQueryChange,
}: TypeaheadProps<T>) {
  const listId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const key = selectedKey ?? "";
  const selected = key ? (resolveSelected ? resolveSelected(key) ?? null : items.find((i) => keyOf(i) === key) ?? null) : null;
  const textFor = (item: T | null) => (item && labelOf ? labelOf(item) : "");
  const [query, setQuery] = useState(textFor(selected));
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  // Re-sync the box when the controlled selection changes (derived-state
  // reset during render — the repo's no-setState-in-effect idiom).
  const [prevKey, setPrevKey] = useState(key);
  if (key !== prevKey) {
    setPrevKey(key);
    setQuery(textFor(selected));
  }

  useEffect(() => {
    const close = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);

  const matches = useMemo(
    () => typeaheadMatches(query, items, filter, rank, max),
    [query, items, filter, rank, max]
  );
  const activeIdx = matches.length ? Math.min(active, matches.length - 1) : 0;

  const pick = (item: T) => {
    onPick(item);
    setActive(0);
    if (!stayOpen) {
      setQuery(labelOf ? labelOf(item) : "");
      setOpen(false);
    }
  };

  return (
    <div
      ref={wrapRef}
      style={{ position: "relative" }}
      onBlur={(e) => {
        if (!wrapRef.current?.contains(e.relatedTarget as Node)) setOpen(false);
      }}
    >
      <input
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={ariaLabel}
        autoComplete="off"
        value={query}
        placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActive(0);
          onQueryChange?.(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActive((i) => Math.min(i + 1, Math.max(0, matches.length - 1)));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => Math.max(0, i - 1));
          } else if (e.key === "Enter" && open && matches[activeIdx]) {
            e.preventDefault();
            pick(matches[activeIdx]);
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
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            maxHeight: 8 * 38,
            overflowY: "auto",
            background: "#fff",
            border: "1px solid #dfe2e8",
            borderRadius: 10,
            boxShadow: "0 14px 36px rgba(20,24,32,.14)",
            padding: 4,
          }}
        >
          {matches.map((item, i) => (
            <button
              key={keyOf(item)}
              type="button"
              role="option"
              aria-selected={keyOf(item) === key}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(item)}
              style={{
                width: "100%",
                border: 0,
                borderRadius: 7,
                padding: "7px 9px",
                textAlign: "left",
                fontFamily: "var(--font-ui)",
                cursor: "pointer",
                color: "#16181d",
                background: i === activeIdx ? "var(--accent-soft)" : "transparent",
              }}
            >
              {render(item, i === activeIdx)}
            </button>
          ))}
          {matches.length === 0 && (
            <div style={{ padding: "9px 10px", fontSize: 12, color: "#8c919c" }}>{emptyText}</div>
          )}
        </div>
      )}
    </div>
  );
}
