import Link from "next/link";

export type AssembliesTab = "assemblies" | "subassemblies";

/** #130 — the Assemblies | Subassemblies switch. A URL param (not client
 *  state) so deep links and the nav's active key keep working. */
export default function AssembliesTabs({ active }: { active: AssembliesTab }) {
  const tabs: Array<{ id: AssembliesTab; label: string; href: string }> = [
    { id: "assemblies", label: "Assemblies", href: "/design/assemblies" },
    { id: "subassemblies", label: "Subassemblies", href: "/design/assemblies?tab=subassemblies" },
  ];
  return (
    <div role="tablist" style={{ display: "inline-flex", background: "#f1f2f5", borderRadius: 9, padding: 3, marginBottom: 18 }}>
      {tabs.map((t) => {
        const on = t.id === active;
        return (
          <Link
            key={t.id}
            href={t.href}
            role="tab"
            aria-selected={on}
            scroll={false}
            style={{
              fontSize: 12.5,
              fontWeight: 600,
              padding: "8px 14px",
              borderRadius: 7,
              textDecoration: "none",
              background: on ? "#fff" : "transparent",
              color: on ? "#16181d" : "#8c919c",
              boxShadow: on ? "0 1px 2px rgba(0,0,0,.1)" : "none",
            }}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
