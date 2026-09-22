import type { CSSProperties, ReactNode } from "react";

/**
 * #121 — the one search row. The box grows, the filters passed as children
 * (selects with className="pk-searchbar-select", or a .pk-searchbar-group of
 * toggle buttons) sit beside it at the same 36px height, and the row wraps
 * under 560px (globals.css `.pk-searchbar*`).
 *
 * Deliberately NOT "use client" and stateless: a client filter bar drives it
 * with value/onChange; a server-rendered GET <form> (Venues) uses
 * name/defaultValue and `submit` so the magnifier is the form's submit
 * button — a form holding two text inputs and no submit button never
 * submits on Enter.
 */
export function SearchFilterBar({
  value,
  onChange,
  name,
  defaultValue,
  placeholder = "Search…",
  ariaLabel = "Search",
  submit = false,
  children,
  style,
}: {
  value?: string;
  onChange?: (v: string) => void;
  /** Uncontrolled mode for a GET <form>: the input's name + initial value. */
  name?: string;
  defaultValue?: string;
  placeholder?: string;
  ariaLabel?: string;
  /** Render the magnifier as a submit button (GET forms). */
  submit?: boolean;
  children?: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div className="pk-searchbar" style={style}>
      <div className="pk-searchbar-box">
        {submit ? (
          <button type="submit" aria-label={ariaLabel} className="pk-searchbar-glass" />
        ) : (
          <span className="pk-searchbar-glass" aria-hidden />
        )}
        {onChange ? (
          <input
            type="text"
            name={name}
            aria-label={ariaLabel}
            placeholder={placeholder}
            autoComplete="off"
            value={value ?? ""}
            onChange={(e) => onChange(e.target.value)}
          />
        ) : (
          <input
            type="text"
            name={name}
            aria-label={ariaLabel}
            placeholder={placeholder}
            autoComplete="off"
            defaultValue={defaultValue}
          />
        )}
      </div>
      {children}
    </div>
  );
}
