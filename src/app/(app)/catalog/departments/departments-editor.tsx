"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Department } from "@/lib/portal-departments";
import DepartmentsClient from "./departments-client";
import { saveDepartmentsAction } from "./actions";

/**
 * Catalog → Departments — the outer, UNKEYED wrapper (#252 fix round 1).
 *
 * The page keys DepartmentsClient by `JSON.stringify(departments)` so its
 * draft/catDept editing state resets to match the server after a save (the
 * server-generated id of a brand-new department only exists post-save). But
 * `router.refresh()` re-renders the server tree with the new `departments`,
 * which changes that key and REMOUNTS DepartmentsClient — any state owned
 * there, including the "N departments saved." confirmation, is destroyed in
 * the same tick it would have shown. This component owns the save
 * transition and the message instead: it is never keyed, so it survives the
 * refresh, and renders the message above the (still-keyed) editor.
 */

type Result = { ok: true; value: Department[] } | { ok: false; error: string };

export default function DepartmentsEditor({
  departments,
  categories,
  suggestions,
}: {
  departments: Department[];
  categories: Array<{ category: string; count: number }>;
  suggestions: Department[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const save = (payload: Array<{ id?: string; name: string; categories: string[] }>) => {
    setMsg(null);
    start(async () => {
      const r: Result = await saveDepartmentsAction(payload);
      if (r.ok) {
        setMsg({ ok: true, text: `${r.value.length} ${r.value.length === 1 ? "department" : "departments"} saved.` });
        router.refresh();
      } else {
        setMsg({ ok: false, text: r.error });
      }
    });
  };

  return (
    <>
      {msg && (
        <div
          role="status"
          style={{ marginBottom: 12, fontSize: 12.5, borderRadius: 8, padding: "9px 12px", color: msg.ok ? "#1f7a52" : "#b4543a", background: msg.ok ? "#eaf6ef" : "#f9ece8", border: `1px solid ${msg.ok ? "#cfe9da" : "#f0d6cd"}` }}
        >
          {msg.text}
        </div>
      )}
      <DepartmentsClient key={JSON.stringify(departments)} departments={departments} categories={categories} suggestions={suggestions} pending={pending} onSave={save} />
    </>
  );
}
