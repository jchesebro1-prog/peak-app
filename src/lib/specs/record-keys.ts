/**
 * Spec record matching — keys + normalization (#205 follow-on, spec
 * 2026-09-28-spec-records-design.md §3.1, §3.2, §6). Pure: no store/db
 * imports. Shared by `record-match.ts` (matching a BOM row against the
 * library) and the builder's row-identity / merge logic (§3.1).
 */

/** SKUs a row carries when it has no real part number — a vendor
 *  allowance, an AI-drafted line, a curtain, a custom line. Any sku
 *  starting `CRT-` (a Grid curtain placeholder id) is also a placeholder,
 *  checked separately in `isPlaceholderSku` since it's a prefix, not an
 *  exact value. */
export const PLACEHOLDER_SKUS: ReadonlySet<string> = new Set(["", "CUSTOM", "AI", "CURTAIN"]);

function upperTrim(s: string | undefined | null): string {
  return (s ?? "").trim().toUpperCase();
}

export function isPlaceholderSku(sku: string): boolean {
  const s = upperTrim(sku);
  return PLACEHOLDER_SKUS.has(s) || s.startsWith("CRT-");
}

/** Uppercase, trim, collapse internal whitespace runs to one space. The
 *  normalization every part number is compared under (exact + wildcard). */
export function normPartNumber(s: string): string {
  return upperTrim(s).replace(/\s+/g, " ");
}

/** Lowercase, unify en/em/hyphen dashes to a plain "-", collapse whitespace,
 *  trim. The normalization `specKey` / `matchKey` are compared under so
 *  case and dash-style drift (a workbook em-dash vs. a typed hyphen) never
 *  breaks a match key hit. */
export function normMatchKey(s: string): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/[–—-]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/** `stored` (a record's mfrNumber, may carry `#` wildcards) vs. `candidate`
 *  (a row's part number) — both normalized inside. Equal length required;
 *  `#` in `stored` matches exactly one digit `1`-`5` in `candidate`,
 *  everything else must match literally. */
export function wildcardMatches(stored: string, candidate: string): boolean {
  const s = normPartNumber(stored);
  const c = normPartNumber(candidate);
  if (s.length !== c.length) return false;
  for (let i = 0; i < s.length; i++) {
    const sc = s[i];
    if (sc === "#") {
      const cc = c[i];
      if (cc < "1" || cc > "5") return false;
    } else if (sc !== c[i]) {
      return false;
    }
  }
  return true;
}

/** Every part-number-shaped candidate a row could be matched on, normalized
 *  and de-duped, in priority order: the row's own `mfrNumber`, its `sku`
 *  (skipped entirely when the sku is a placeholder — a placeholder carries
 *  no part-number information, colon-split included), that sku's text
 *  after a `Mfr:` prefix (only when it contains `:`), then the linked
 *  catalog part's own MPN / model number. */
export function partNumberCandidates(
  row: { sku?: string; mfrNumber?: string },
  part?: { manufacturerPartNumber?: string; manufacturerModelNumber?: string } | null
): string[] {
  const out: string[] = [];
  const add = (v: string | undefined | null) => {
    const n = normPartNumber(v ?? "");
    if (n && !out.includes(n)) out.push(n);
  };

  add(row.mfrNumber);

  const sku = row.sku ?? "";
  if (sku && !isPlaceholderSku(sku)) {
    add(sku);
    const ci = sku.indexOf(":");
    if (ci >= 0) add(sku.slice(ci + 1));
  }

  add(part?.manufacturerPartNumber);
  add(part?.manufacturerModelNumber);

  return out;
}

/** Row identity for merging and row actions (§3.1): a library-added row →
 *  `SPEC:<id>`; a real SKU → `SKU:<UPPER>`; a placeholder-SKU row with a
 *  vendor part number → `MPN:<norm>`; else a match key + description; else
 *  bare description. */
export function specRowKey(row: {
  sku?: string;
  mfrNumber?: string;
  specKey?: string;
  desc?: string;
  specId?: string;
  fromLibrary?: boolean;
}): string {
  if (row.fromLibrary && row.specId) return `SPEC:${row.specId}`;

  const sku = row.sku ?? "";
  if (sku && !isPlaceholderSku(sku)) return `SKU:${normPartNumber(sku)}`;

  const mpn = normPartNumber(row.mfrNumber ?? "");
  if (mpn) return `MPN:${mpn}`;

  const desc = (row.desc ?? "").trim().toLowerCase();
  if (row.specKey) return `KEY:${normMatchKey(row.specKey)}|${desc}`;

  return `DESC:${desc}`;
}

/** `Stage Drapes – <X>` for a Grid curtain (§6) — name keywords win over
 *  type (a "Main Valance" is a Valance, not a Main Curtain). `null` when
 *  neither the name nor the type resolves to a known drape kind. */
export function curtainSpecKey(type: string | undefined, name: string | undefined): string | null {
  const n = (name ?? "").trim().toLowerCase();
  const t = (type ?? "").trim().toLowerCase();

  const byName = (): string | null => {
    if (n.includes("valance")) return "Valance";
    if (n.includes("main") || n.includes("grand")) return "Main Curtain";
    if (n.includes("border")) return "Borders";
    if (n.includes("leg")) return "Legs";
    if (n.includes("traveler") || n.includes("draw") || n.includes("mid") || n.includes("rear")) {
      return "Mid and Rear Draws";
    }
    if (n.includes("scrim")) return "Scrim";
    if (n.includes("cyc")) return "Cyclorama";
    return null;
  };
  const byType = (): string | null => {
    if (t === "border") return "Borders";
    if (t === "leg") return "Legs";
    if (t === "draw") return "Mid and Rear Draws";
    if (t === "full") return "Main Curtain";
    return null;
  };

  const x = byName() ?? byType();
  return x ? `Stage Drapes – ${x}` : null;
}
