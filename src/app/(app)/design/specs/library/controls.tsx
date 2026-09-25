"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SearchFilterBar } from "@/components/search/search-filter-bar";
import {
  adoptLegacyPointersAction,
  createLibrarySectionAction,
  importLibraryAction,
  seedLibrarySectionsAction,
} from "../actions";

/** The file goes through a Server Action capped at 1200kb in next.config.ts,
 *  so this guard sits safely below it (headroom for the action's other
 *  arguments and encoding) and our message always wins over Next's. A real
 *  library is a few hundred KB. */
const MAX_LIBRARY_IMPORT_BYTES = 1_000_000;

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
      setErr("That file is too large — the library import limit is 1 MB.");
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

const ACCENT_INK = "color-mix(in srgb, var(--accent) 68%, #000)";
const ACCENT_SOFT = "color-mix(in srgb, var(--accent) 12%, #fff)";

const TOGGLE_BASE: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  height: 36,
  boxSizing: "border-box",
  fontSize: 11.5,
  padding: "0 11px",
  borderRadius: 20,
  cursor: "pointer",
};

/**
 * Task 12 — the coverage table's filter row: search + article + state
 * selects and the on-a-BOM / datasheet toggles share one line (#121). URL-
 * as-state like the Companies FilterBar: every change pushes a fresh query
 * string to this same page so the table (a server component) re-filters.
 */
export function CoverageControls({
  q,
  articleId,
  state,
  bom,
  datasheet,
  articleOptions,
}: {
  q: string;
  articleId: string;
  state: string;
  bom: boolean;
  datasheet: boolean;
  articleOptions: Array<{ id: string; label: string }>;
}) {
  const router = useRouter();
  const [text, setText] = useState(q);
  const [prevQ, setPrevQ] = useState(q);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset the draft text when the URL's q changes from elsewhere (derived-
  // state reset during render, matching the Companies FilterBar idiom).
  if (prevQ !== q) {
    setPrevQ(q);
    setText(q);
  }

  const pushWith = (patch: { q?: string; article?: string; state?: string; bom?: boolean; datasheet?: boolean }) => {
    const p = new URLSearchParams();
    const nq = patch.q !== undefined ? patch.q : text;
    const na = patch.article !== undefined ? patch.article : articleId;
    const ns = patch.state !== undefined ? patch.state : state;
    const nb = patch.bom !== undefined ? patch.bom : bom;
    const nd = patch.datasheet !== undefined ? patch.datasheet : datasheet;
    if (nq.trim()) p.set("q", nq.trim());
    if (na) p.set("article", na);
    if (ns && ns !== "all") p.set("state", ns);
    if (nb) p.set("bom", "1");
    if (nd) p.set("datasheet", "1");
    const s = p.toString();
    router.push("/design/specs/library" + (s ? "?" + s : "") + "#coverage");
  };

  const onSearch = (v: string) => {
    setText(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => pushWith({ q: v }), 300);
  };

  return (
    <SearchFilterBar value={text} onChange={onSearch} placeholder="Search SKU or description…" ariaLabel="Search coverage">
      <select
        className="pk-searchbar-select"
        value={articleId}
        onChange={(e) => pushWith({ article: e.target.value })}
        aria-label="Article filter"
      >
        <option value="">All articles</option>
        <option value="none">No article</option>
        {articleOptions.map((a) => (
          <option key={a.id} value={a.id}>
            {a.label}
          </option>
        ))}
      </select>
      <select
        className="pk-searchbar-select"
        value={state || "all"}
        onChange={(e) => pushWith({ state: e.target.value })}
        aria-label="Spec state filter"
      >
        <option value="all">All states</option>
        <option value="authored">Authored</option>
        <option value="same-as">Same as</option>
        <option value="draft">Draft</option>
        <option value="missing">Missing</option>
      </select>
      <button
        type="button"
        onClick={() => pushWith({ bom: !bom })}
        title="Appeared on a quote, Grid project, or generated spec in the last 90 days"
        style={{
          ...TOGGLE_BASE,
          fontWeight: bom ? 600 : 500,
          border: `1px solid ${bom ? "var(--accent)" : "#e4e7ec"}`,
          background: bom ? ACCENT_SOFT : "#fff",
          color: bom ? ACCENT_INK : "#5b616e",
        }}
      >
        On a BOM
      </button>
      <button
        type="button"
        onClick={() => pushWith({ datasheet: !datasheet })}
        title="Has a datasheet on file"
        style={{
          ...TOGGLE_BASE,
          fontWeight: datasheet ? 600 : 500,
          border: `1px solid ${datasheet ? "var(--accent)" : "#e4e7ec"}`,
          background: datasheet ? ACCENT_SOFT : "#fff",
          color: datasheet ? ACCENT_INK : "#5b616e",
        }}
      >
        Has datasheet
      </button>
    </SearchFilterBar>
  );
}
