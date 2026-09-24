import Link from "next/link";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/team";
import { getSettings } from "@/lib/settings";
import { list, get, type CatalogPart } from "@/lib/stores/catalog";
import { dateYear, money } from "@/lib/format";
import { effectivePriceDate, isoDateOf, mfrKey, priceBooks } from "@/lib/catalog-books";
import { resolveCategoryMap } from "@/lib/catalog-taxonomy";
import { CatalogControls, CatalogImportPanel, PartDatasheetControl } from "./controls";
import CatalogDangerZone from "./catalog-danger-zone";
import { TaxonomyCard } from "./taxonomy-card";
import { PriceDateBanner } from "./price-date-banner";
import { upsertPart } from "./actions";
import { activeUsers } from "@/lib/users";
import { allVendorProfiles, vendorCompanies } from "@/lib/stores/vendors";
import { claimOwnerByKey, resolveCatalogOwner } from "@/lib/vendor-status";
import { CatalogOwnerCard } from "./catalog-owner-card";

export const metadata = { title: "Catalog — Quartzite-6" };

function one(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] ?? "" : v ?? "";
}

const UNSPEC = "Unspecified";

const CSS = `
  .ct-sel { -webkit-appearance: none; appearance: none; background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'><path d='M1 1l4 4 4-4' fill='none' stroke='%238c919c' stroke-width='1.5'/></svg>"); background-repeat: no-repeat; background-position: right 10px center; }
  .ct-row:hover { background: #fafbff; }
  .ct-filter:hover { background: #f6f7f9; }
  .ct-body { display: grid; gap: 18px; align-items: start; grid-template-columns: 210px minmax(0,1fr); }
  .ct-body.ct-import { grid-template-columns: 210px minmax(0,1fr) 360px; }
  @media (max-width: 1040px) {
    .ct-body, .ct-body.ct-import { grid-template-columns: 1fr; }
    .ct-rail { display: none; }
  }
`;

export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [user, sp, parts, settings, users, profiles, vendorCos] = await Promise.all([
    requireUser(),
    searchParams,
    list(),
    getSettings(),
    activeUsers(),
    allVendorProfiles(),
    vendorCompanies(),
  ]);
  const isAdmin = can("manage_users", user.roles);
  const catalogOwner = resolveCatalogOwner(settings.catalogOwner, users);
  const vendorNameById = new Map(vendorCos.map((c) => [c.id, c.name]));
  // A soft-deleted vendor's profile keeps its claims (#122 I1) — count only
  // LIVE vendors as owners, or the facet tooltip and the banner would link to
  // a /vendors/<id> that 404s, labelled with the raw id.
  const vendorByKey = claimOwnerByKey(profiles.filter((p) => vendorNameById.has(p.id)));
  /** #122 — the vendor that claims a manufacturer spelling, or null. */
  const vendorFor = (m: string): { id: string; name: string } | null => {
    const id = vendorByKey.get(mfrKey(m));
    return id ? { id, name: vendorNameById.get(id) ?? id } : null;
  };

  const mfrParam = one(sp.mfr) || "all";
  const catParam = one(sp.cat) || "all";
  const unitParam = one(sp.unit) || "all";
  const q = one(sp.q).trim();
  const sort = one(sp.sort) || "relevance";
  const importOpen = one(sp.import) === "1";
  const editSku = one(sp.edit);
  const isNew = one(sp.new) === "1";
  const importedN = one(sp.imported);
  const importError = one(sp.importError);
  const reset = one(sp.reset) === "1";

  const mfrOf = (p: CatalogPart) => (p.mfr && p.mfr.trim() ? p.mfr.trim() : UNSPEC);

  /* ---- filter facets ---- */
  const manufacturers = Array.from(new Set(parts.map(mfrOf))).sort((a, b) =>
    a === UNSPEC ? 1 : b === UNSPEC ? -1 : a.localeCompare(b)
  );
  const categories = Array.from(new Set(parts.map((p) => p.category || "Uncategorized"))).sort((a, b) =>
    a.localeCompare(b)
  );
  const units = Array.from(new Set(parts.map((p) => p.unit || "ea"))).sort();

  const hrefFor = (over: { mfr?: string; cat?: string; unit?: string }) => {
    const qs = new URLSearchParams();
    const m = over.mfr ?? mfrParam;
    const c = over.cat ?? catParam;
    const u = over.unit ?? unitParam;
    if (m && m !== "all") qs.set("mfr", m);
    if (c && c !== "all") qs.set("cat", c);
    if (u && u !== "all") qs.set("unit", u);
    if (q) qs.set("q", q);
    if (sort !== "relevance") qs.set("sort", sort);
    if (importOpen) qs.set("import", "1");
    const s = qs.toString();
    return "/catalog" + (s ? "?" + s : "");
  };

  /* ---- #133 price-list dates: outdated / undated manufacturers ---- */
  const books = priceBooks(parts, settings, { limit: Infinity });
  const flaggedBooks = books
    .filter((b) => b.key && (b.outdated || b.unknown)) // Unbranded has no key: nothing to date
    // #122: `vendor` is the vendor that claims this manufacturer, or null.
    .map((b) => ({ ...b, href: hrefFor({ mfr: b.name }), vendor: vendorFor(b.name) }));

  /* ---- filter + sort ---- */
  const ql = q.toLowerCase();
  const tokens = ql.split(/\s+/).filter(Boolean);
  let rows = parts.filter((p) => {
    if (mfrParam !== "all" && mfrOf(p) !== mfrParam) return false;
    if (catParam !== "all" && (p.category || "Uncategorized") !== catParam) return false;
    if (unitParam !== "all" && (p.unit || "ea") !== unitParam) return false;
    if (tokens.length) {
      const hay = [p.desc, p.sku, p.mfr, p.category].filter(Boolean).join(" ").toLowerCase();
      if (!tokens.every((token) => hay.includes(token))) return false;
    }
    return true;
  });
  if (sort === "price") rows = rows.slice().sort((a, b) => (b.list || 0) - (a.list || 0));
  else if (sort === "alpha") rows = rows.slice().sort((a, b) => (a.desc || "").localeCompare(b.desc || ""));

  // The catalog can hold thousands of parts (imported price books); render only
  // a page of them so the DOM stays light. Filters + search narrow the set.
  const PAGE = 200;
  const matchCount = rows.length;
  const truncated = matchCount > PAGE;
  rows = rows.slice(0, PAGE);

  const catalogMeta = `${parts.length} parts · ${manufacturers.length} manufacturer${manufacturers.length === 1 ? "" : "s"}`;
  const resultLabel =
    (truncated ? `Showing ${PAGE} of ${matchCount}` : `${matchCount} of ${parts.length}`) +
    ` parts` +
    (mfrParam !== "all" ? " · " + mfrParam : "") +
    (catParam !== "all" ? " · " + catParam : "") +
    (unitParam !== "all" ? " · " + unitParam : "") +
    (truncated ? " · refine with search or filters to narrow" : "");

  const editingPart = editSku ? await get(editSku) : null;
  const showForm = isNew || !!editingPart;

  return (
    <div className="pk-content">
      <style>{CSS}</style>

      {/* header */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
          rowGap: 12,
          marginBottom: 18,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-.015em" }}>Catalog</div>
          <div style={{ fontSize: 13.5, color: "#8c919c", marginTop: 5 }}>{catalogMeta}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
          <Link
            href="/catalog?new=1"
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "#16181d",
              background: "#fff",
              border: "1px solid #e4e7ec",
              borderRadius: 9,
              padding: "10px 15px",
              textDecoration: "none",
            }}
          >
            + Add part
          </Link>
          <Link
            href={importOpen ? hrefForImport(hrefFor, false) : hrefForImport(hrefFor, true)}
            scroll={false}
            style={{
              fontSize: 13,
              fontWeight: 600,
              borderRadius: 9,
              padding: "10px 16px",
              textDecoration: "none",
              ...(importOpen
                ? { color: "#5b616e", background: "#f1f2f5" }
                : { color: "#fff", background: "var(--accent)" }),
            }}
          >
            {importOpen ? "✕ Close import" : "↑ Import price book"}
          </Link>
        </div>
      </div>

      {reset && (
        <div style={{ marginBottom: 16, padding: "10px 14px", borderRadius: 10, background: "#eaf6ef", border: "1px solid #cce9da", color: "#1f7a52", fontSize: 12.5, fontWeight: 600 }}>
          ✓ Current price list cleared. Import a new manufacturer list to start fresh.
        </div>
      )}

      {importedN && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 9,
            background: "#eaf6ef",
            border: "1px solid #cce9da",
            borderRadius: 10,
            padding: "10px 14px",
            marginBottom: 16,
            fontSize: 12.5,
            color: "#1f7a52",
            fontWeight: 600,
          }}
        >
          ✓ Imported {importedN} part{importedN === "1" ? "" : "s"} into the catalog.
        </div>
      )}

      {!importedN && importError && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 9,
            background: "#f7e9e5",
            border: "1px solid #f0d6cd",
            borderRadius: 10,
            padding: "10px 14px",
            marginBottom: 16,
            fontSize: 12.5,
            color: "#b4543a",
            fontWeight: 600,
          }}
        >
          Import failed — {importError} Nothing was added to the catalog.
        </div>
      )}

      {flaggedBooks.length > 0 && <PriceDateBanner books={flaggedBooks} />}

      <div className={"ct-body" + (importOpen ? " ct-import" : "")}>
        {/* left filter rail */}
        <div className="ct-rail" style={{ minWidth: 0 }}>
          <FilterGroup
            title="Manufacturer"
            active={mfrParam}
            allLabel="All manufacturers"
            allHref={hrefFor({ mfr: "all" })}
            allCount={parts.length}
            options={manufacturers.map((m) => {
              const v = vendorFor(m);
              return {
                key: m,
                label: m,
                href: hrefFor({ mfr: m }),
                count: parts.filter((p) => mfrOf(p) === m).length,
                title: v ? `Supplied by ${v.name} — open the vendor from the price banner or /vendors` : undefined,
              };
            })}
          />
          <div style={{ height: 16 }} />
          <FilterGroup
            title="Unit"
            active={unitParam}
            allLabel="All units"
            allHref={hrefFor({ unit: "all" })}
            allCount={parts.length}
            options={units.map((u) => ({ key: u, label: u, href: hrefFor({ unit: u }), count: parts.filter((p) => (p.unit || "ea") === u).length }))}
          />
          <div style={{ height: 16 }} />
          <FilterGroup
            title="Category"
            active={catParam}
            allLabel="All categories"
            allHref={hrefFor({ cat: "all" })}
            allCount={parts.length}
            options={categories.map((c) => ({
              key: c,
              label: c,
              href: hrefFor({ cat: c }),
              count: parts.filter((p) => (p.category || "Uncategorized") === c).length,
            }))}
          />
        </div>

        {/* center table */}
        <div
          style={{
            background: "#fff",
            border: "1px solid #ececf0",
            borderRadius: 13,
            boxShadow: "0 1px 2px rgba(0,0,0,.04)",
            overflow: "hidden",
            minWidth: 0,
          }}
        >
          <div style={{ padding: "14px 18px 12px", borderBottom: "1px solid #ececf0" }}>
            <CatalogControls q={q} mfr={mfrParam} cat={catParam} sort={sort} />
            <div style={{ marginTop: 9, fontSize: 11.5, color: "#8c919c" }}>{resultLabel}</div>
          </div>

          <div style={{ overflowX: "auto" }}>
            <div style={{ minWidth: 620 }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "150px 150px minmax(220px,1fr) 110px 60px 84px 96px",
                  gap: 12,
                  padding: "8px 18px",
                  fontSize: 10,
                  fontWeight: 600,
                  color: "#aab0bb",
                  textTransform: "uppercase",
                  letterSpacing: ".04em",
                  borderBottom: "1px solid #eef0f3",
                  background: "#fbfbfc",
                }}
              >
                <span>Manufacturer</span>
                <span>MFR Part #</span>
                <span>Description</span>
                <span>Category</span>
                <span style={{ textAlign: "right" }}>Unit</span>
                <span style={{ textAlign: "right" }}>Cost</span>
                <span style={{ textAlign: "right" }}>List price</span>
              </div>

              {rows.map((p) => (
                <Link
                  key={p.id}
                  href={`/catalog?edit=${encodeURIComponent(p.sku)}`}
                  scroll={false}
                  className="ct-row"
                  style={{
                    display: "grid",
                    gridTemplateColumns: "150px 150px minmax(220px,1fr) 110px 60px 84px 96px",
                    gap: 12,
                    padding: "11px 18px",
                    alignItems: "center",
                    borderBottom: "1px solid #f3f4f7",
                    textDecoration: "none",
                    color: "#16181d",
                  }}
                >
                  <span style={{ minWidth: 0, fontSize: 12, color: "#3a3f4a" }}>
                    {p.mfr || UNSPEC}
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 500,
                        display: "block",
                        lineHeight: 1.3,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                    {p.manufacturerPartNumber || p.sku}
                    {p.manufacturerModelNumber && p.manufacturerModelNumber !== p.manufacturerPartNumber && (
                      <span style={{ display: "block", fontSize: 10.5, color: "#9aa0ab" }}>
                        M/N {p.manufacturerModelNumber}
                      </span>
                    )}
                    </span>
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <span style={{
                      fontSize: 13,
                      fontWeight: 500,
                      display: "block",
                      lineHeight: 1.3,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}>{p.desc}</span>
                    {(p.note || p.datasheetBlobKey || p.docs?.length) && (
                      <span style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6, marginTop: 3 }}>
                        {p.note && (
                          <span
                            style={{
                              display: "inline-block",
                              fontSize: 9.5,
                              fontWeight: 700,
                              letterSpacing: ".03em",
                              textTransform: "uppercase",
                              color: "#8a6d1f",
                              background: "#fbf3dd",
                              border: "1px solid #f0e2bd",
                              borderRadius: 5,
                              padding: "1px 6px",
                            }}
                          >
                            ⚠ {p.note}
                          </span>
                        )}
                        {p.datasheetBlobKey && (
                          <span style={{ fontSize: 10.5, color: "#8c919c" }}>Datasheet</span>
                        )}
                        {p.docs?.map((doc) => (
                          <a key={doc.url} href={doc.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 10.5, color: "var(--accent)", textDecoration: "none" }}>
                            {doc.label || doc.kind} ↗
                          </a>
                        ))}
                      </span>
                    )}
                  </span>
                  <span style={{ fontSize: 11.5, color: "#8c919c" }}>{p.category || "—"}</span>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "#8c919c", textAlign: "right" }}>
                    {p.unit || "—"}
                  </span>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "#aab0bb", textAlign: "right" }}>
                    {money(p.cost || 0)}
                  </span>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 500, textAlign: "right" }}>
                    {money(p.list || 0)}
                  </span>
                </Link>
              ))}

              {rows.length === 0 && (
                <div style={{ padding: "56px 18px", textAlign: "center", color: "#9aa0ab", fontSize: 13 }}>
                  {parts.length === 0
                    ? "The catalog is empty — import a price book or add a part to get started."
                    : "No parts match these filters."}
                </div>
              )}
              <div style={{ height: 22 }} />
            </div>
          </div>
        </div>

        {/* right import rail */}
        {importOpen && (
          <div
            className="ct-rail"
            style={{
              background: "#fff",
              border: "1px solid #ececf0",
              borderRadius: 13,
              boxShadow: "0 1px 2px rgba(0,0,0,.04)",
              overflow: "hidden",
              minWidth: 0,
            }}
          >
            <CatalogImportPanel manufacturers={manufacturers.filter((m) => m !== UNSPEC)} accent="var(--accent)" today={isoDateOf(Date.now())} />
          </div>
        )}
      </div>

      {isAdmin && (
        <>
          <TaxonomyCard categories={categories} initialMap={resolveCategoryMap(settings.catalogCategoryMap)} />
          <CatalogOwnerCard
            value={settings.catalogOwner?.userId || ""}
            options={users.map((u) => ({ value: u.id, label: u.name }))}
            effectiveName={catalogOwner?.name || ""}
          />
          <CatalogDangerZone count={parts.length} />
        </>
      )}

      {showForm && (
        <PartFormModal
          part={editingPart}
          priceDate={editingPart ? effectivePriceDate(editingPart, settings) : null}
          categories={categories}
          manufacturers={manufacturers.filter((m) => m !== UNSPEC)}
          isAdmin={isAdmin}
        />
      )}
    </div>
  );
}

function hrefForImport(hrefFor: (o: { mfr?: string; cat?: string; unit?: string }) => string, open: boolean): string {
  const base = hrefFor({});
  const url = new URL(base, "http://x");
  if (open) url.searchParams.set("import", "1");
  else url.searchParams.delete("import");
  const s = url.searchParams.toString();
  return "/catalog" + (s ? "?" + s : "");
}

function FilterGroup({
  title,
  active,
  allLabel,
  allHref,
  allCount,
  options,
}: {
  title: string;
  active: string;
  allLabel: string;
  allHref: string;
  allCount: number;
  options: Array<{ key: string; label: string; href: string; count: number; title?: string }>;
}) {
  const items: Array<{ key: string; label: string; href: string; count: number; title?: string }> = [
    { key: "all", label: allLabel, href: allHref, count: allCount },
    ...options,
  ];
  return (
    <div>
      <div
        style={{
          fontSize: 10.5,
          fontWeight: 600,
          color: "#aab0bb",
          letterSpacing: ".06em",
          textTransform: "uppercase",
          margin: "0 0 7px",
          padding: "0 6px",
        }}
      >
        {title}
      </div>
      {items.map((o) => {
        const on = active === o.key;
        return (
          <Link
            key={o.key}
            href={o.href}
            scroll={false}
            className="ct-filter"
            title={o.title}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
              padding: "9px 11px",
              borderRadius: 8,
              marginBottom: 2,
              textDecoration: "none",
              background: on ? "var(--accent-soft)" : "transparent",
            }}
          >
            <span
              style={{
                fontSize: 13,
                fontWeight: on ? 600 : 500,
                color: on ? "color-mix(in srgb, var(--accent) 72%, #000)" : "#3a3f4a",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {o.label}
            </span>
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                color: on ? "color-mix(in srgb, var(--accent) 72%, #000)" : "#9aa0ab",
                flexShrink: 0,
              }}
            >
              {o.count}
            </span>
          </Link>
        );
      })}
    </div>
  );
}

function PartFormModal({
  part,
  priceDate,
  categories,
  manufacturers,
  isAdmin,
}: {
  part: CatalogPart | null;
  /** #133 — the part's effective price date (own pricedAt or the manufacturer's book date), null when undated. */
  priceDate: number | null;
  categories: string[];
  manufacturers: string[];
  /** Datasheet attach/replace/remove (punch #39, Task 5) is admin-gated —
   *  same convention as the Categories & trades card. */
  isAdmin: boolean;
}) {
  const editing = !!part;
  const label = (t: string) => (
    <div style={{ fontSize: 10.5, fontWeight: 600, color: "#9aa0ab", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 5 }}>
      {t}
    </div>
  );
  const inputStyle: React.CSSProperties = {
    width: "100%",
    fontSize: 13,
    fontFamily: "var(--font-ui)",
    color: "#16181d",
    border: "1px solid #e4e7ec",
    borderRadius: 8,
    padding: "9px 11px",
    outline: "none",
    background: "#fff",
  };

  return (
    <>
      <Link
        href="/catalog"
        scroll={false}
        aria-label="Close"
        style={{ position: "fixed", inset: 0, background: "rgba(16,18,22,.5)", zIndex: 60 }}
      />
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 61,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 26,
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            width: 520,
            maxWidth: "100%",
            maxHeight: "88vh",
            background: "#fff",
            borderRadius: 16,
            boxShadow: "0 24px 70px rgba(0,0,0,.34)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            pointerEvents: "auto",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              padding: "16px 20px",
              borderBottom: "1px solid #f0f1f4",
            }}
          >
            <div style={{ fontSize: 15, fontWeight: 600 }}>{editing ? "Edit part" : "Add a part"}</div>
            <Link
              href="/catalog"
              scroll={false}
              style={{
                width: 30,
                height: 30,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "#f1f2f5",
                borderRadius: 8,
                color: "#5b616e",
                fontSize: 17,
                textDecoration: "none",
              }}
            >
              ×
            </Link>
          </div>

          <form action={upsertPart} style={{ padding: "18px 20px", overflowY: "auto" }}>
            <div style={{ marginBottom: 13 }}>
              {label("SKU")}
              <input
                name="sku"
                defaultValue={part?.sku || ""}
                readOnly={editing}
                required
                placeholder="CL-HB3"
                style={{ ...inputStyle, ...(editing ? { background: "#f7f8fa", color: "#5b616e", fontFamily: "var(--font-mono)" } : {}) }}
              />
              {editing && (
                <div style={{ fontSize: 11, color: "#aab0bb", marginTop: 4 }}>
                  The SKU is the catalog key and can’t be changed here.
                </div>
              )}
            </div>
            <div style={{ marginBottom: 13 }}>
              {label("Description")}
              <input name="desc" defaultValue={part?.desc || ""} required placeholder="Head block, 3-groove, 8″ sheave" style={inputStyle} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 13 }}>
              <div>
                {label("Category")}
                <input name="category" defaultValue={part?.category || ""} list="ct-cats" placeholder="Rigging" style={inputStyle} />
                <datalist id="ct-cats">
                  {categories.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </div>
              <div>
                {label("Unit")}
                <input name="unit" defaultValue={part?.unit || "ea"} placeholder="ea" style={inputStyle} />
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 13 }}>
              <div>
                {label("List price")}
                <input name="list" defaultValue={part?.list != null ? String(part.list) : ""} inputMode="decimal" placeholder="680" style={inputStyle} />
              </div>
              <div>
                {label("Cost")}
                <input name="cost" defaultValue={part?.cost != null ? String(part.cost) : ""} inputMode="decimal" placeholder="469" style={inputStyle} />
              </div>
            </div>
            {editing && (
              <div style={{ fontSize: 11, color: "#aab0bb", marginTop: -7, marginBottom: 13 }}>
                {priceDate
                  ? `Price effective ${dateYear(priceDate)} — moves when the list price or cost changes.`
                  : "No price date yet — a price change here, an import, or the manufacturer's price-list date on the Catalog banner sets one."}
              </div>
            )}
            <div style={{ marginBottom: 4 }}>
              {label("Manufacturer")}
              <input name="mfr" defaultValue={part?.mfr || ""} list="ct-mfrs" placeholder="JR Clancy" style={inputStyle} />
              <datalist id="ct-mfrs">
                {manufacturers.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 13, marginBottom: 13 }}>
              <div>
                {label("MFR P/N")}
                <input name="manufacturerPartNumber" defaultValue={part?.manufacturerPartNumber || ""} placeholder="7060A" style={inputStyle} />
              </div>
              <div>
                {label("MFR M/N")}
                <input name="manufacturerModelNumber" defaultValue={part?.manufacturerModelNumber || ""} placeholder="Source Four LED" style={inputStyle} />
              </div>
            </div>
            <div style={{ marginBottom: 4 }}>
              {label("MAP / minimum advertised price")}
              <input name="mapPrice" defaultValue={part?.mapPrice != null ? String(part.mapPrice) : ""} inputMode="decimal" placeholder="1699" style={inputStyle} />
              <div style={{ fontSize: 11, color: "#aab0bb", marginTop: 4 }}>
                Separate from Peak cost, list price, and quote sell price.
              </div>
            </div>
            <div style={{ marginTop: 13, marginBottom: 4 }}>
              {label("Note")}
              <input name="note" defaultValue={part?.note || ""} placeholder="e.g. verify price" style={inputStyle} />
              <div style={{ fontSize: 11, color: "#aab0bb", marginTop: 4 }}>
                Shows as a flag on the part. Clear it once the pricing is confirmed.
              </div>
            </div>

            {/* Datasheet attach/replace/remove (punch #39, Task 5) — admin
                only, and only once the part exists (its SKU is the doc id
                the blob pathname is keyed under). */}
            {isAdmin && editing && part && (
              <div style={{ marginTop: 16, paddingTop: 13, borderTop: "1px solid #f0f1f4" }}>
              {part.davinci && <div style={{ margin: "10px 0", fontSize: 11, color: "#6d5a25", background: "#fff9e8", border: "1px solid #efe4c4", borderRadius: 7, padding: "7px 9px" }}>Ports and documents include manufacturer data from ETC DaVinci. Editing ports will override this imported shape.</div>}
              {part.docs?.length ? <div style={{ margin: "10px 0" }}><div style={{ fontSize: 11, fontWeight: 700, color: "#8c919c", textTransform: "uppercase" }}>Documents</div>{part.docs.map((doc) => <a key={doc.url} href={doc.url} target="_blank" rel="noopener noreferrer" style={{ display: "block", fontSize: 12, color: "var(--accent)", textDecoration: "none", marginTop: 5 }}>{doc.label || doc.kind} ↗</a>)}</div> : null}
              <PartDatasheetControl sku={part.sku} datasheetName={part.datasheetName} />
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 9, marginTop: 20 }}>
              <Link
                href="/catalog"
                scroll={false}
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: "#5b616e",
                  background: "#fff",
                  border: "1px solid #e4e7ec",
                  borderRadius: 9,
                  padding: "9px 15px",
                  textDecoration: "none",
                }}
              >
                Cancel
              </Link>
              <button
                type="submit"
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: "#fff",
                  background: "var(--accent)",
                  border: "none",
                  borderRadius: 9,
                  padding: "10px 18px",
                  cursor: "pointer",
                }}
              >
                {editing ? "Save changes" : "Add to catalog"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
