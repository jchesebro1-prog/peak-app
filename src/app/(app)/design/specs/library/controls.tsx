"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  adoptLegacyPointersAction,
  createLibrarySectionAction,
  seedLibrarySectionsAction,
} from "../actions";

/**
 * Task 8 — client bits for the Specs library index: the inline "+ Add
 * section" form, the "Add the starter sections" seed button, and the
 * "Adopt legacy pointers" button for the Displays metadata card. Follows
 * the vendors/controls.tsx idiom: useTransition, a local error line under
 * the control, router.refresh() on success. No store imports.
 */

const ROW: React.CSSProperties = { display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" };

export function AddSectionForm() {
  const router = useRouter();
  const [number, setNumber] = useState("");
  const [title, setTitle] = useState("");
  const [sort, setSort] = useState("");
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();

  const submit = () => {
    const n = number.trim();
    const t = title.trim();
    if (!n) {
      setErr("A section needs a CSI number.");
      return;
    }
    if (!t) {
      setErr("A section needs a title.");
      return;
    }
    start(async () => {
      setErr("");
      const res = await createLibrarySectionAction({
        number: n,
        title: t,
        sort: sort.trim() === "" ? undefined : Number(sort),
      });
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      setNumber("");
      setTitle("");
      setSort("");
      router.refresh();
    });
  };

  return (
    <div className="pk-card" style={{ padding: "12px 16px", marginBottom: 12 }}>
      <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 8 }}>+ Add section</div>
      <div style={ROW}>
        <input
          value={number}
          onChange={(e) => setNumber(e.target.value)}
          placeholder="CSI number, e.g. 11 61 43"
          aria-label="CSI number"
          className="pk-input mono"
          style={{ width: 190 }}
        />
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title, e.g. Stage Curtains"
          aria-label="Section title"
          className="pk-input"
          style={{ flex: "1 1 220px" }}
        />
        <input
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          placeholder="Sort"
          aria-label="Sort"
          inputMode="numeric"
          className="pk-input mono"
          style={{ width: 90 }}
        />
        <button type="button" className="pk-btn-accent" disabled={pending} onClick={submit}>
          {pending ? "Adding…" : "Add section"}
        </button>
      </div>
      {err && <div style={{ marginTop: 8, fontSize: 12, color: "#b4543a" }}>{err}</div>}
    </div>
  );
}

export function SeedStarterSectionsButton() {
  const router = useRouter();
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();

  const run = () =>
    start(async () => {
      setErr("");
      setMsg("");
      const res = await seedLibrarySectionsAction();
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      setMsg(`Added ${res.made} starter section${res.made === 1 ? "" : "s"}.`);
      router.refresh();
    });

  return (
    <div style={{ marginBottom: 12 }}>
      <button type="button" className="pk-btn-outline" disabled={pending} onClick={run}>
        {pending ? "Adding…" : "Add the starter sections"}
      </button>
      {msg && <span style={{ marginLeft: 8, fontSize: 12, color: "#1f7a52" }}>{msg}</span>}
      {err && <span style={{ marginLeft: 8, fontSize: 12, color: "#b4543a" }}>{err}</span>}
    </div>
  );
}

export function AdoptLegacyPointersButton() {
  const router = useRouter();
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();

  const run = () =>
    start(async () => {
      setErr("");
      setMsg("");
      const res = await adoptLegacyPointersAction();
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      setMsg(
        `Linked ${res.adopted} part${res.adopted === 1 ? "" : "s"} · ${res.unresolved} left as text (no single matching section or article).`
      );
      router.refresh();
    });

  return (
    <div>
      <button type="button" className="pk-btn-outline" disabled={pending} onClick={run}>
        {pending ? "Adopting…" : "Adopt legacy pointers"}
      </button>
      {msg && <div style={{ marginTop: 8, fontSize: 12, color: "#1f7a52" }}>{msg}</div>}
      {err && <div style={{ marginTop: 8, fontSize: 12, color: "#b4543a" }}>{err}</div>}
    </div>
  );
}
