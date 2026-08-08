import Link from "next/link";
import { requireUser } from "@/lib/session";
import { list, get, type EquipmentItem, type EquipmentCategory } from "@/lib/stores/equipment-items";
import { list as listLocations, type EquipmentLocation } from "@/lib/stores/equipment-locations";
import { money } from "@/lib/format";
import { upsertEquipmentItem } from "./actions";

export const metadata = { title: "Rentals — Quartzite-6" };

function one(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] ?? "" : v ?? "";
}

const CATEGORY_LABEL: Record<EquipmentCategory, string> = {
  speakers: "Speakers",
  monitors: "Monitors",
  lighting: "Lighting",
  consoles: "Consoles",
  "control-io": "Control/IO",
  other: "Other",
};

const CATEGORIES: EquipmentCategory[] = ["speakers", "monitors", "lighting", "consoles", "control-io", "other"];

const CSS = `
  .rt-row:hover { background: #fafbff; }
  .rt-filter:hover { background: #f6f7f9; }
  .rt-body { display: grid; gap: 18px; align-items: start; grid-template-columns: 210px minmax(0,1fr); }
  @media (max-width: 1040px) {
    .rt-body { grid-template-columns: 1fr; }
    .rt-rail { display: none; }
  }
`;

export default async function RentalsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [, sp, items, locations] = await Promise.all([
    requireUser(),
    searchParams,
    list(),
    listLocations(),
  ]);

  const catParam = (one(sp.cat) || "all") as EquipmentCategory | "all";
  const editId = one(sp.edit);
  const isNew = one(sp.new) === "1";

  const hrefFor = (over: { cat?: string }) => {
    const qs = new URLSearchParams();
    const c = over.cat ?? catParam;
    if (c && c !== "all") qs.set("cat", c);
    const s = qs.toString();
    return "/rentals" + (s ? "?" + s : "");
  };

  const qtyOf = (item: EquipmentItem) => item.stock.reduce((sum, s) => sum + s.qty, 0);

  const rows = items
    .filter((i) => catParam === "all" || i.category === catParam)
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));

  const rentalsMeta = `${items.length} item${items.length === 1 ? "" : "s"} · ${locations.length} location${locations.length === 1 ? "" : "s"}`;
  const resultLabel = `${rows.length} of ${items.length} items` + (catParam !== "all" ? " · " + CATEGORY_LABEL[catParam] : "");

  const editingItem = editId ? await get(editId) : null;
  const showForm = isNew || !!editingItem;

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
          <div style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-.015em" }}>Rentals</div>
          <div style={{ fontSize: 13.5, color: "#8c919c", marginTop: 5 }}>{rentalsMeta}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
          <Link
            href="/rentals/board"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              fontSize: 13,
              fontWeight: 600,
              color: "#16181d",
              background: "#fff",
              border: "1px solid #e4e7ec",
              borderRadius: 10,
              padding: "10px 15px",
              textDecoration: "none",
            }}
          >
            Booking board →
          </Link>
          <Link
            href="/rentals/quote"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              fontSize: 13,
              fontWeight: 600,
              color: "#fff",
              background: "var(--accent)",
              borderRadius: 10,
              padding: "10px 16px",
              textDecoration: "none",
            }}
          >
            + New rental quote
          </Link>
          <Link
            href="/rentals?new=1"
            scroll={false}
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "#16181d",
              background: "#fff",
              border: "1px solid #e4e7ec",
              borderRadius: 9,
              padding: "10px 16px",
              textDecoration: "none",
            }}
          >
            + Add item
          </Link>
        </div>
      </div>

      <div className="rt-body">
        {/* left filter rail */}
        <div className="rt-rail" style={{ minWidth: 0 }}>
          <FilterGroup
            title="Category"
            active={catParam}
            allLabel="All categories"
            allHref={hrefFor({ cat: "all" })}
            allCount={items.length}
            options={CATEGORIES.map((c) => ({
              key: c,
              label: CATEGORY_LABEL[c],
              href: hrefFor({ cat: c }),
              count: items.filter((i) => i.category === c).length,
            })).filter((o) => o.count > 0)}
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
            <div style={{ fontSize: 11.5, color: "#8c919c" }}>{resultLabel}</div>
          </div>

          <div style={{ overflowX: "auto" }}>
            <div style={{ minWidth: 620 }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0,1fr) 110px 84px 84px 92px 70px",
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
                <span>Item</span>
                <span>Category</span>
                <span style={{ textAlign: "right" }}>Day rate</span>
                <span style={{ textAlign: "right" }}>Week rate</span>
                <span style={{ textAlign: "right" }}>Month rate</span>
                <span style={{ textAlign: "right" }}>Qty</span>
              </div>

              {rows.map((item) => (
                <Link
                  key={item.id}
                  href={`/rentals?edit=${encodeURIComponent(item.id)}${catParam !== "all" ? "&cat=" + catParam : ""}`}
                  scroll={false}
                  className="rt-row"
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(0,1fr) 110px 84px 84px 92px 70px",
                    gap: 12,
                    padding: "11px 18px",
                    alignItems: "center",
                    borderBottom: "1px solid #f3f4f7",
                    textDecoration: "none",
                    color: "#16181d",
                  }}
                >
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
                      {item.name}
                    </span>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "#aab0bb" }}>
                      {item.sku}
                      {item.manufacturer ? " · " + item.manufacturer : ""}
                    </span>
                  </span>
                  <span style={{ fontSize: 11.5, color: "#8c919c" }}>{CATEGORY_LABEL[item.category]}</span>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "#5b616e", textAlign: "right" }}>
                    {money(item.dayRate)}
                  </span>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "#5b616e", textAlign: "right" }}>
                    {money(item.weekRate)}
                  </span>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "#5b616e", textAlign: "right" }}>
                    {money(item.monthRate)}
                  </span>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 500, textAlign: "right" }}>
                    {qtyOf(item)}
                  </span>
                </Link>
              ))}

              {rows.length === 0 && (
                <div style={{ padding: "56px 18px", textAlign: "center", color: "#9aa0ab", fontSize: 13 }}>
                  {items.length === 0
                    ? "No rental equipment yet — add an item to get started."
                    : "No items match this filter."}
                </div>
              )}
              <div style={{ height: 22 }} />
            </div>
          </div>
        </div>
      </div>

      {showForm && <ItemFormModal item={editingItem} catParam={catParam} locations={locations} />}
    </div>
  );
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
  options: Array<{ key: string; label: string; href: string; count: number }>;
}) {
  const items = [{ key: "all", label: allLabel, href: allHref, count: allCount }, ...options];
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
            className="rt-filter"
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

function ItemFormModal({
  item,
  catParam,
  locations,
}: {
  item: EquipmentItem | null;
  catParam: string;
  locations: EquipmentLocation[];
}) {
  const editing = !!item;
  const closeHref = "/rentals" + (catParam !== "all" ? "?cat=" + catParam : "");
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
        href={closeHref}
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
            width: 480,
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
            <div style={{ fontSize: 15, fontWeight: 600 }}>{editing ? "Edit rental item" : "Add rental item"}</div>
            <Link
              href={closeHref}
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

          <form action={upsertEquipmentItem} style={{ padding: "18px 20px", overflowY: "auto" }}>
            {editing && <input type="hidden" name="id" value={item.id} />}
            <div style={{ marginBottom: 13 }}>
              {label("SKU")}
              <input name="sku" defaultValue={item?.sku || ""} required placeholder="SPK-QSC-K12" style={inputStyle} />
            </div>
            <div style={{ marginBottom: 13 }}>
              {label("Name")}
              <input name="name" defaultValue={item?.name || ""} required placeholder="QSC K12.2 Speaker" style={inputStyle} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 13 }}>
              <div>
                {label("Category")}
                <select name="category" defaultValue={item?.category || "other"} style={{ ...inputStyle, appearance: "auto" }}>
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {CATEGORY_LABEL[c]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                {label("Manufacturer")}
                <input name="manufacturer" defaultValue={item?.manufacturer || ""} placeholder="QSC" style={inputStyle} />
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 4 }}>
              <div>
                {label("Day rate")}
                <input
                  name="dayRate"
                  defaultValue={item?.dayRate != null ? String(item.dayRate) : ""}
                  inputMode="decimal"
                  placeholder="45"
                  style={inputStyle}
                />
              </div>
              <div>
                {label("Week rate")}
                <input
                  name="weekRate"
                  defaultValue={item?.weekRate != null ? String(item.weekRate) : ""}
                  inputMode="decimal"
                  placeholder="180"
                  style={inputStyle}
                />
              </div>
              <div>
                {label("Month rate")}
                <input
                  name="monthRate"
                  defaultValue={item?.monthRate != null ? String(item.monthRate) : ""}
                  inputMode="decimal"
                  placeholder="500"
                  style={inputStyle}
                />
              </div>
            </div>

            {locations.length > 0 && (
              <div style={{ marginTop: 17 }}>
                {label("Stock by location")}
                <div style={{ display: "grid", gap: 8 }}>
                  {locations.map((loc) => {
                    const existingQty = item?.stock.find((s) => s.locationId === loc.id)?.qty ?? 0;
                    return (
                      <div key={loc.id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ fontSize: 13, color: "#3a3f4a", flex: 1, minWidth: 0 }}>{loc.name}</span>
                        <input
                          name={`stock_${loc.id}`}
                          defaultValue={String(existingQty)}
                          inputMode="numeric"
                          style={{ ...inputStyle, width: 90, textAlign: "right" }}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 9, marginTop: 20 }}>
              <Link
                href={closeHref}
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
                {editing ? "Save changes" : "Add item"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
