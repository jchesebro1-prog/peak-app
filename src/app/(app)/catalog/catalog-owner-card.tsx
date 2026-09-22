"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setCatalogOwnerAction } from "@/app/(app)/vendors/actions";

/**
 * #122 — admin picker for the catalog owner: the teammate whose Home Queue
 * receives "Update catalog" / "Request updated price list" tasks (spec §1).
 * Sits with the other admin cards on /catalog (Settings → Admin → Catalog).
 */
export function CatalogOwnerCard({
  value,
  options,
  effectiveName,
}: {
  /** stored settings.catalogOwner.userId, "" when unset */
  value: string;
  options: Array<{ value: string; label: string }>;
  /** who the rule resolves to today (the pick, else Jena Tolksdorf, else the first Admin) */
  effectiveName: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const change = (v: string) =>
    start(async () => {
      setErr("");
      const res = await setCatalogOwnerAction(v);
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      router.refresh();
    });
  return (
    <div style={{ marginTop: 18, border: "1px solid #ececf0", borderRadius: 12, background: "#fff", padding: "15px 18px", boxShadow: "0 1px 2px rgba(0,0,0,.04)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 13.5, fontWeight: 700 }}>Catalog owner</div>
          <div style={{ marginTop: 3, color: "#8c919c", fontSize: 11.5 }}>
            Gets the Home Queue task when a vendor sends a newer price list or a list goes stale. Currently: <b style={{ color: "#3a3f4a" }}>{effectiveName || "nobody (no active team member)"}</b>.
          </div>
        </div>
        <select
          value={value}
          disabled={pending}
          onChange={(e) => change(e.target.value)}
          style={{ fontFamily: "var(--font-ui)", fontSize: 12.5, fontWeight: 500, color: "#16181d", border: "1px solid #e4e7ec", borderRadius: 8, padding: "7px 26px 7px 10px", background: "#fff", cursor: "pointer", minWidth: 200 }}
        >
          <option value="">Default (Jena Tolksdorf, else first Admin)</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>
      {err && <div style={{ marginTop: 8, fontSize: 12, color: "#b4543a" }}>{err}</div>}
    </div>
  );
}
