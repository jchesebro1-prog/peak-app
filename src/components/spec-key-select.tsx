"use client";

import type { CSSProperties } from "react";
import { curtainSpecKey } from "@/lib/specs/record-keys";

/**
 * The Spec select (spec records design §6) — a system record's match key set
 * at the source, so the spec builder can match a custom or curtain line that
 * has no catalog part number (acoustic shell, pit filler, drapes, hoists).
 *
 * `options` are the library's non-archived system match keys, computed on the
 * server (`systemMatchKeys`) and passed in as plain strings — this file never
 * imports the records store. The empty option means "no key"; for a curtain
 * it means "derive one", so it reads `Auto: <derived key>` when the curtain's
 * name resolves to a drape kind, else `— none —`.
 */

/** The key the spec builder derives for a line with no explicit `specKey` —
 *  mirrors `bomFromQuote` (quote-bom.ts): curtains derive from their
 *  description, anything else has none. */
export function autoSpecKeyFor(item: { curtain?: boolean; desc: string }): string | null {
  return item.curtain ? curtainSpecKey(undefined, item.desc) : null;
}

export default function SpecKeySelect({
  value,
  options,
  auto,
  onChange,
  style,
  id,
}: {
  value: string;
  options: readonly string[];
  /** The derived key shown on the empty option, or null for "— none —". */
  auto: string | null;
  onChange: (value: string) => void;
  style?: CSSProperties;
  id?: string;
}) {
  // A key the library no longer offers (archived, renamed) stays selectable
  // so opening the line never silently drops it.
  const all = value && !options.includes(value) ? [value, ...options] : options;
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      title="Spec Library system this line specs as"
      style={style}
    >
      <option value="">{auto ? `Auto: ${auto}` : "— none —"}</option>
      {all.map((k) => (
        <option key={k} value={k}>
          {k}
        </option>
      ))}
    </select>
  );
}
