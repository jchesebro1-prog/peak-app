"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  adoptLegacyPointersAction,
  createLibrarySectionAction,
  importLibraryAction,
  seedLibrarySectionsAction,
} from "../actions";

/** Mirrors the catalog importer's 1 MB cap in spirit — a library file
 *  carries four small collections, so 5 MB is generous headroom. */
const MAX_LIBRARY_IMPORT_BYTES = 5 * 1_048_576;

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

export function ImportExportLibraryControls() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > MAX_LIBRARY_IMPORT_BYTES) {
      setErr(`That file is too large — the library import limit is 5 MB.`);
      setMsg("");
      return;
    }
    start(async () => {
      setErr("");
      setMsg("");
      let text: string;
      try {
        text = await file.text();
      } catch {
        setErr("Could not read that file. Try again.");
        return;
      }
      const res = await importLibraryAction(text);
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      const skippedNote = res.skipped > 0 ? ` · ${res.skipped} skipped` : "";
      setMsg(
        `Imported ${res.sections} section${res.sections === 1 ? "" : "s"}, ${res.articles} article${res.articles === 1 ? "" : "s"}, ${res.templates} formula${res.templates === 1 ? "" : "s"}, ${res.curtainTemplates} curtain template${res.curtainTemplates === 1 ? "" : "s"}.${skippedNote}`
      );
      router.refresh();
    });
  };

  return (
    <div className="pk-card" style={{ padding: "16px 18px" }}>
      <div style={{ fontSize: 14.5, fontWeight: 600, marginBottom: 6 }}>Import / Export</div>
      <div style={{ fontSize: 12.5, color: "#8c919c", lineHeight: 1.5, marginBottom: 12 }}>
        Move the whole library — sections, Part 2 articles, authoring formulas and curtain templates — as one JSON
        file. Importing upserts by id: a record already in the library is overwritten, and a new record is added.
        Nothing is ever deleted by an import.
      </div>
      <div style={ROW}>
        <a href="/api/spec-library" className="pk-btn-outline" style={{ textDecoration: "none" }}>
          Export library
        </a>
        <button
          type="button"
          className="pk-btn-outline"
          disabled={pending}
          onClick={() => fileRef.current?.click()}
        >
          {pending ? "Importing…" : "Import library"}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          style={{ display: "none" }}
          onChange={onFile}
        />
      </div>
      {msg && <div style={{ marginTop: 8, fontSize: 12, color: "#1f7a52" }}>{msg}</div>}
      {err && <div style={{ marginTop: 8, fontSize: 12, color: "#b4543a" }}>{err}</div>}
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
