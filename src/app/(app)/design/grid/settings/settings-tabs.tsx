import Link from "next/link";

/** Grid Settings sections (#GEM): General (the card stack) | Equipment map. */
export function GridSettingsTabs({ active }: { active: "general" | "equipment" }) {
  const tab = (key: "general" | "equipment", href: string, label: string) => (
    <Link
      href={href}
      aria-current={active === key ? "page" : undefined}
      style={{
        padding: "8px 14px",
        borderRadius: 8,
        fontSize: 13,
        fontWeight: 600,
        textDecoration: "none",
        color: active === key ? "#16181d" : "#737985",
        background: active === key ? "#fff" : "transparent",
        boxShadow: active === key ? "0 1px 2px rgba(0,0,0,.08)" : "none",
      }}
    >
      {label}
    </Link>
  );
  return (
    <nav aria-label="Grid settings sections" style={{ display: "inline-flex", gap: 4, background: "#f1f2f5", borderRadius: 10, padding: 4, marginBottom: 18 }}>
      {tab("general", "/design/grid/settings", "General")}
      {tab("equipment", "/design/grid/settings/equipment-map", "Equipment map")}
    </nav>
  );
}
