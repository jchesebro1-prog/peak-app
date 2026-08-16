"use client";

import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";

export type SearchableOption = {
  value: string;
  label: string;
  /** Extra text such as a city, email, or record number to match while searching. */
  keywords?: string;
  disabled?: boolean;
};

type Props = {
  options: SearchableOption[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  name?: string;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  clearLabel?: string;
  className?: string;
  style?: CSSProperties;
  buttonStyle?: CSSProperties;
  disabled?: boolean;
  title?: string;
  "aria-label"?: string;
};

/**
 * A compact, keyboard-friendly record picker. It replaces long native selects
 * wherever a person needs to find a customer, vendor, venue, or other record.
 */
export function SearchableSelect({
  options,
  value,
  defaultValue = "",
  onValueChange,
  name,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  emptyMessage = "No matches.",
  clearLabel = "Clear selection",
  className,
  style,
  buttonStyle,
  disabled,
  title,
  "aria-label": ariaLabel,
}: Props) {
  const [internalValue, setInternalValue] = useState(defaultValue);
  const selectedValue = value === undefined ? internalValue : value;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const selected = options.find((option) => option.value === selectedValue);
  const matches = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return options;
    return options.filter((option) =>
      `${option.label} ${option.keywords || ""}`.toLocaleLowerCase().includes(needle),
    );
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    const closeOutside = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", closeOutside);
    return () => document.removeEventListener("mousedown", closeOutside);
  }, [open]);

  function select(next: string) {
    if (value === undefined) setInternalValue(next);
    onValueChange?.(next);
    setOpen(false);
    setQuery("");
  }

  return (
    <div ref={root} className={className} style={{ position: "relative", minWidth: 0, ...style }}>
      {name ? <input type="hidden" name={name} value={selectedValue} /> : null}
      <button
        type="button"
        title={title}
        aria-label={ariaLabel || placeholder}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
          if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setOpen(true);
          }
        }}
        style={{
          width: "100%",
          minWidth: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          border: "1px solid #dfe2e8",
          borderRadius: 8,
          padding: "8px 10px",
          font: "inherit",
          fontSize: 13,
          color: selected ? "#16181d" : "#747a85",
          background: "#fff",
          cursor: disabled ? "not-allowed" : "pointer",
          textAlign: "left",
          opacity: disabled ? 0.6 : 1,
          ...buttonStyle,
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {selected?.label || placeholder}
        </span>
        <span aria-hidden="true" style={{ color: "#747a85", fontSize: 11 }}>⌄</span>
      </button>
      {open ? (
        <div
          id={listId}
          role="listbox"
          aria-label={ariaLabel || placeholder}
          style={{
            position: "absolute", zIndex: 50, top: "calc(100% + 5px)", left: 0, width: "max(100%, 240px)",
            maxWidth: "min(420px, calc(100vw - 32px))", padding: 6, border: "1px solid #dfe2e8",
            borderRadius: 9, background: "#fff", boxShadow: "0 12px 30px rgba(24, 29, 38, .16)",
          }}
        >
          <input
            ref={input}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Escape") setOpen(false); }}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            style={{ width: "100%", boxSizing: "border-box", border: "1px solid #dfe2e8", borderRadius: 6, padding: "7px 8px", font: "inherit", fontSize: 13, outline: "none" }}
          />
          <div style={{ maxHeight: 230, overflowY: "auto", marginTop: 5 }}>
            {selected && clearLabel ? (
              <button
                type="button" role="option" aria-selected={false} onClick={() => select("")}
                style={{ width: "100%", border: 0, borderRadius: 6, padding: "8px 9px", background: "transparent", color: "#747a85", cursor: "pointer", textAlign: "left", font: "inherit", fontSize: 13 }}
              >
                {clearLabel}
              </button>
            ) : null}
            {matches.map((option) => (
              <button
                type="button" role="option" aria-selected={option.value === selectedValue} key={option.value}
                disabled={option.disabled} onClick={() => select(option.value)}
                style={{ width: "100%", border: 0, borderRadius: 6, padding: "8px 9px", background: option.value === selectedValue ? "color-mix(in srgb, var(--accent) 12%, white)" : "transparent", color: option.disabled ? "#9aa0aa" : "#16181d", cursor: option.disabled ? "not-allowed" : "pointer", textAlign: "left", font: "inherit", fontSize: 13 }}
              >
                {option.label}
              </button>
            ))}
            {matches.length === 0 ? <div style={{ padding: "10px 9px", color: "#747a85", fontSize: 13 }}>{emptyMessage}</div> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
