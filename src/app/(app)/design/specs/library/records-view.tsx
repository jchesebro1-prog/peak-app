import Link from "next/link";
import { SearchFilterBar } from "@/components/search/search-filter-bar";
import { allSpecRecords } from "@/lib/stores/spec-records";
import { csiKey } from "@/lib/specs/articles";
import { KIND_LABELS, SPEC_KINDS, SPEC_STATUSES, filterSpecRecords, partNumbersSummary, recordProductName, type SpecStatus } from "@/lib/specs/records";
import { RecordsImport } from "./records-import";

/**
 * Spec records Task 10 — the Spec Library's default view (design §7): every
 * `spec_records` row in one table, filtered server-side by GET params
 * (`q`, `kind`, `section`, `status`, `mfr`) through the pure
 * `filterSpecRecords`. Select options come from the data itself. The page
 * does the session check; this component only reads.
 */

const TH: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  color: "#aab0bb",
  textTransform: "uppercase",
  letterSpacing: ".04em",
};
const CELL: React.CSSProperties = { fontSize: 12.5, color: "#3a3f4a" };
const MONO: React.CSSProperties = { fontFamily: "var(--font-mono)" };
const COLS = "130px minmax(0,1.7fr) 130px 80px 80px minmax(0,0.9fr) minmax(0,1.2fr) 44px 92px";

const STATUS_LABEL: Record<SpecStatus, string> = { draft: "Draft", ready: "Ready", archived: "Archived" };
const STATUS_CHIP: Record<SpecStatus, { fg: string; bg: string }> = {
  ready: { fg: "#1f7a52", bg: "#e8f5ee" },
  draft: { fg: "#9a6b12", bg: "#fdf3df" },
  archived: { fg: "#5b616e", bg: "#f1f2f5" },
};

function one(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] ?? "" : v ?? "";
}

function fmtDate(ts: number): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** `canCreate` (the viewer's `create` permission, D260) shows New spec and
 *  Import .xlsx; the actions refuse without it regardless. */
export default async function RecordsView({
  sp,
  canCreate,
}: {
  sp: Record<string, string | string[] | undefined>;
  canCreate: boolean;
}) {
  const all = await allSpecRecords();

  const q = one(sp.q).trim();
  const kind = one(sp.kind).trim();
  const section = one(sp.section).trim();
  const status = one(sp.status).trim();
  const mfr = one(sp.mfr).trim();
  const filtered = filterSpecRecords(all, { q, kind, section, status, mfr });
  const anyFilter = !!(q || kind || section || status || mfr);

  // Options from the data (design §7) — only values some record carries.
  const kindOptions = SPEC_KINDS.filter((k) => all.some((r) => r.kind === k));
  const statusOptions = SPEC_STATUSES.filter((s) => all.some((r) => r.status === s));
  const sectionByKey = new Map<string, string>();
  for (const r of all) {
    const key = csiKey(r.section);
    if (key && !sectionByKey.has(key)) sectionByKey.set(key, r.section);
  }
  const sectionOptions = [...sectionByKey.values()].sort((a, b) => csiKey(a).localeCompare(csiKey(b)));
  const mfrByLower = new Map<string, string>();
  for (const r of all) {
    const m = (r.manufacturer ?? "").trim();
    if (m && !mfrByLower.has(m.toLowerCase())) mfrByLower.set(m.toLowerCase(), m);
  }
  const mfrOptions = [...mfrByLower.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

  return (
    <div className="pk-content" style={{ maxWidth: 1180, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8, flexWrap: "wrap", marginBottom: 18 }}>
        <div style={{ flex: "1 1 320px", marginRight: 4 }}>
          <div className="pk-page-title">Spec library</div>
          <div className="pk-page-sub">
            Every product, system and companion spec — written once, matched against any BOM row.
          </div>
        </div>
        {canCreate && (
          <>
            <Link href="/design/specs/library/records/new" className="pk-btn-accent" style={{ textDecoration: "none" }}>
              New spec
            </Link>
            <RecordsImport />
          </>
        )}
        {/* A file download from a route handler, not a page — a plain <a>, never a client-side <Link>. */}
        <a href="/design/specs/library/records-export" download className="pk-btn-outline" style={{ textDecoration: "none" }}>
          Export .xlsx
        </a>
        <Link href="/design/specs/library?view=sections" className="pk-btn-outline" style={{ textDecoration: "none" }}>
          Sections &amp; articles →
        </Link>
      </div>

      <form action="/design/specs/library" method="GET" style={{ marginBottom: 14 }}>
        <SearchFilterBar name="q" defaultValue={q} placeholder="Search spec id, product, title, model #…" ariaLabel="Search spec records" submit>
          <select name="kind" defaultValue={kind} className="pk-searchbar-select" aria-label="Kind filter">
            <option value="">All kinds</option>
            {kindOptions.map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </select>
          <select name="section" defaultValue={section} className="pk-searchbar-select" aria-label="Section filter">
            <option value="">All sections</option>
            {sectionOptions.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select name="status" defaultValue={status} className="pk-searchbar-select" aria-label="Status filter">
            <option value="">All statuses</option>
            {statusOptions.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
          <select name="mfr" defaultValue={mfr} className="pk-searchbar-select" aria-label="Manufacturer filter">
            <option value="">All manufacturers</option>
            {mfrOptions.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <button type="submit" className="pk-btn-outline">
            Filter
          </button>
          {anyFilter && (
            <Link href="/design/specs/library" style={{ fontSize: 12, color: "#8c919c", textDecoration: "none", alignSelf: "center" }}>
              Clear
            </Link>
          )}
        </SearchFilterBar>
      </form>

      <div className="pk-card" style={{ padding: 0, overflow: "hidden", marginBottom: 22 }}>
        <div
          style={{
            padding: "12px 18px",
            borderBottom: "1px solid #f0f1f4",
            fontSize: 14.5,
            fontWeight: 600,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <span>Spec records</span>
          <span style={{ ...MONO, fontSize: 12, color: "#9aa0ab", fontWeight: 500 }}>
            {filtered.length} of {all.length}
          </span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <div style={{ minWidth: 900 }}>
            <div style={{ display: "grid", gridTemplateColumns: COLS, gap: 10, padding: "9px 18px", background: "#fafbfc", borderBottom: "1px solid #f0f1f4" }}>
              <span style={TH}>Spec ID</span>
              <span style={TH}>Title</span>
              <span style={TH}>Kind</span>
              <span style={TH}>Section</span>
              <span style={TH}>Status</span>
              <span style={TH}>Manufacturer</span>
              <span style={TH}>Model #s</span>
              <span style={{ ...TH, textAlign: "right" }}>Rev</span>
              <span style={TH}>Updated</span>
            </div>
            {filtered.map((r) => {
              const chip = STATUS_CHIP[r.status];
              const n = r.mfrNumbers.length;
              const product = recordProductName(r);
              return (
                <div
                  key={r.specId}
                  style={{ display: "grid", gridTemplateColumns: COLS, gap: 10, padding: "10px 18px", borderBottom: "1px solid #f5f6f8", alignItems: "center" }}
                >
                  <Link
                    href={`/design/specs/library/records/${encodeURIComponent(r.specId)}`}
                    style={{ ...CELL, ...MONO, fontWeight: 600, color: "var(--accent)", textDecoration: "none" }}
                  >
                    {r.specId}
                  </Link>
                  <span style={{ ...CELL, fontWeight: 600, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                    {r.title || "—"}
                    {product && <span style={{ display: "block", fontSize: 11.5, fontWeight: 400, color: "#8c919c" }}>{product}</span>}
                  </span>
                  <span style={{ ...CELL, fontSize: 12 }}>{KIND_LABELS[r.kind]}</span>
                  <span style={{ ...CELL, ...MONO }}>{r.section || "—"}</span>
                  <span>
                    <span style={{ fontSize: 10.5, fontWeight: 600, color: chip.fg, background: chip.bg, padding: "2px 8px", borderRadius: 20 }}>
                      {STATUS_LABEL[r.status]}
                    </span>
                  </span>
                  <span style={CELL}>{r.manufacturer || "—"}</span>
                  <span style={{ ...CELL, ...MONO, fontSize: 11.5, minWidth: 0, overflowWrap: "anywhere" }} title={n ? r.mfrNumbers.join(", ") : undefined}>
                    {partNumbersSummary(r.mfrNumbers, 3) || "—"}
                  </span>
                  <span style={{ ...CELL, ...MONO, textAlign: "right" }}>{r.revision}</span>
                  <span style={{ ...CELL, fontSize: 12 }} title={r.updatedBy ? `by ${r.updatedBy}` : undefined}>
                    {fmtDate(r.updatedAt)}
                  </span>
                </div>
              );
            })}
            {filtered.length === 0 && (
              <div style={{ padding: "36px 18px", textAlign: "center", color: "#9aa0ab", fontSize: 13 }}>
                {all.length === 0 ? "No spec records yet — import the library workbook or add a new spec." : "No spec records match these filters."}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
