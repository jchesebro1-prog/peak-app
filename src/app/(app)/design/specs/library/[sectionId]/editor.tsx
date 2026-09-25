"use client";

import { useMemo, useState, useTransition, type CSSProperties } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ConfirmButton } from "@/components/confirm-button";
import { outlineToText, renderBody } from "@/lib/specs/outline";
import {
  newArticleId,
  type SpecArticle,
  type SpecPart2Style,
  type SpecQuantities,
  type SpecSection,
} from "@/lib/specs/sections";
import type { SpecCategoryArticle } from "@/lib/specs/articles";
import {
  createArticleAction,
  deleteArticleAction,
  removeLibrarySectionAction,
  saveLibrarySectionAction,
  updateArticleAction,
} from "../../actions";

/**
 * Task 9 — the section editor: header (number/title/sort, Part 2 style,
 * quantities policy, delete), Part 1/Part 3 titled-article lists (saved as
 * one array through saveLibrarySectionAction — there is no per-article
 * endpoint for those), and the Part 2 category-article cards (each its own
 * record, saved/removed through Task 8's article actions). Every body gets a
 * live outline preview via renderBody/outlineToText.
 *
 * State rule (PUNCHLIST #141): local state is seeded from props ONCE per
 * component instance — never keyed on section.updatedAt, never re-derived
 * from props in an effect. router.refresh() after a save brings the server
 * state current for anything not already open for editing, without
 * clobbering in-progress edits elsewhere on the page.
 */

const CARD: CSSProperties = { padding: "16px 18px", marginBottom: 18 };
const H: CSSProperties = { fontSize: 14.5, fontWeight: 600, marginBottom: 12 };
const LBL: CSSProperties = {
  display: "block",
  fontSize: 10.5,
  fontWeight: 600,
  color: "#9aa0ab",
  letterSpacing: ".05em",
  textTransform: "uppercase",
  marginBottom: 5,
};
const EXPLAIN: CSSProperties = { fontSize: 11.5, color: "#8c919c", marginTop: 5, lineHeight: 1.4 };
const MUTED: CSSProperties = { fontSize: 11.5, color: "#9aa0ab" };
const SAVED: CSSProperties = { fontSize: 12, color: "#1f7a52", fontWeight: 600 };
const ERR: CSSProperties = { fontSize: 12, color: "#b4543a" };
const PREVIEW: CSSProperties = {
  margin: 0,
  fontFamily: "var(--font-mono)",
  fontSize: 12,
  background: "#fafbfc",
  border: "1px solid #f0f1f4",
  borderRadius: 9,
  padding: "10px 12px",
  minHeight: 160,
  whiteSpace: "pre-wrap",
};

const PART2_STYLE_OPTIONS: Array<{ value: SpecPart2Style; label: string; explain: string }> = [
  {
    value: "paragraphs",
    label: "Paragraphs",
    explain: "Each article's products print as lettered paragraphs (A., B., C. …) under the General clause.",
  },
  {
    value: "table",
    label: "Table",
    explain: "Each article's products print as rows in a schedule table instead of lettered paragraphs.",
  },
];

const QUANTITIES_OPTIONS: Array<{ value: SpecQuantities; label: string; explain: string }> = [
  {
    value: "drawings",
    label: "Per drawings and schedules",
    explain: "Quantities are shown only on the drawings and schedules — not repeated in the spec text.",
  },
  {
    value: "inline",
    label: "Printed on each entry",
    explain: "Each product entry states its own quantity inline, in the spec text.",
  },
];

function Warnings({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return null;
  return (
    <div style={{ marginTop: 6 }}>
      {warnings.map((w, i) => (
        <div key={i} style={MUTED}>
          {w}
        </div>
      ))}
    </div>
  );
}

export default function SectionEditor({
  section,
  articles,
  partCounts,
}: {
  section: SpecSection;
  articles: SpecCategoryArticle[];
  partCounts: Record<string, number>;
}) {
  return (
    <div className="pk-content" style={{ maxWidth: 960, margin: "0 auto" }}>
      <div style={{ marginBottom: 10 }}>
        <Link href="/design/specs/library" style={{ fontSize: 12, color: "#8c919c", textDecoration: "none" }}>
          ← Spec library
        </Link>
      </div>
      <div style={{ marginBottom: 18 }}>
        <div className="pk-page-title">
          {section.number} · {section.title || "Untitled section"}
        </div>
        <div className="pk-page-sub">Part 1/Part 3 boilerplate, the Part 2 style, and this section&apos;s category articles.</div>
      </div>

      <HeaderCard section={section} />
      <PartArticles section={section} field="part1" heading="Part 1 — General" initial={section.part1} />
      <PartArticles section={section} field="part3" heading="Part 3 — Execution" initial={section.part3} />
      <CategoryArticles section={section} articles={articles} partCounts={partCounts} />
    </div>
  );
}

function HeaderCard({ section }: { section: SpecSection }) {
  const router = useRouter();
  const [number, setNumber] = useState(section.number);
  const [title, setTitle] = useState(section.title);
  const [sortText, setSortText] = useState(String(section.sort));
  const [part2Style, setPart2Style] = useState<SpecPart2Style>(section.part2Style);
  const [quantities, setQuantities] = useState<SpecQuantities>(section.quantities);
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const [saved, setSaved] = useState(false);

  const styleOpt = PART2_STYLE_OPTIONS.find((o) => o.value === part2Style) ?? PART2_STYLE_OPTIONS[0];
  const qtyOpt = QUANTITIES_OPTIONS.find((o) => o.value === quantities) ?? QUANTITIES_OPTIONS[0];

  const save = () => {
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
      const res = await saveLibrarySectionAction(section.id, {
        number: n,
        title: t,
        sort: sortText.trim() === "" ? undefined : Number(sortText),
        part2Style,
        quantities,
      });
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      setSaved(true);
      router.refresh();
    });
  };

  return (
    <div className="pk-card" style={CARD}>
      <div style={{ display: "grid", gridTemplateColumns: "170px minmax(0,1fr) 100px", gap: 12, marginBottom: 14 }}>
        <div>
          <label style={LBL}>Number</label>
          <input
            className="pk-input mono"
            value={number}
            onChange={(e) => {
              setSaved(false);
              setNumber(e.target.value);
            }}
          />
        </div>
        <div>
          <label style={LBL}>Title</label>
          <input
            className="pk-input"
            value={title}
            onChange={(e) => {
              setSaved(false);
              setTitle(e.target.value);
            }}
          />
        </div>
        <div>
          <label style={LBL}>Sort</label>
          <input
            className="pk-input mono"
            inputMode="numeric"
            value={sortText}
            onChange={(e) => {
              setSaved(false);
              setSortText(e.target.value);
            }}
          />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 16, marginBottom: 14 }}>
        <div>
          <label style={LBL}>Part 2 style</label>
          <select
            className="pk-input"
            style={{ cursor: "pointer" }}
            value={part2Style}
            onChange={(e) => {
              setSaved(false);
              setPart2Style(e.target.value as SpecPart2Style);
            }}
          >
            {PART2_STYLE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <div style={EXPLAIN}>{styleOpt.explain}</div>
        </div>
        <div>
          <label style={LBL}>Quantities</label>
          <select
            className="pk-input"
            style={{ cursor: "pointer" }}
            value={quantities}
            onChange={(e) => {
              setSaved(false);
              setQuantities(e.target.value as SpecQuantities);
            }}
          >
            {QUANTITIES_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <div style={EXPLAIN}>{qtyOpt.explain}</div>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <button type="button" className="pk-btn-accent" disabled={pending} onClick={save}>
          {pending ? "Saving…" : "Save"}
        </button>
        {saved && <span style={SAVED}>Saved</span>}
        {err && <span style={ERR}>{err}</span>}
      </div>

      <div style={{ borderTop: "1px solid #f0f1f4", paddingTop: 14 }}>
        <div style={{ fontSize: 12.5, color: "#8c919c", lineHeight: 1.5, marginBottom: 10 }}>
          Deleting a section is refused while parts still print in it or Part 2 articles are still under it.
        </div>
        <ConfirmButton
          className="pk-btn-danger"
          label="Delete section"
          confirmLabel="Delete this section"
          onConfirm={async () => {
            const res = await removeLibrarySectionAction(section.id);
            if (!res.ok) throw new Error(res.error);
            router.push("/design/specs/library");
          }}
        />
      </div>
    </div>
  );
}

function PartArticles({
  section,
  field,
  heading,
  initial,
}: {
  section: SpecSection;
  field: "part1" | "part3";
  heading: string;
  initial: SpecArticle[];
}) {
  const router = useRouter();
  const [list, setList] = useState<SpecArticle[]>(() => initial);
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const [saved, setSaved] = useState(false);

  const update = (i: number, patch: Partial<SpecArticle>) => {
    setSaved(false);
    setList((prev) => prev.map((a, idx) => (idx === i ? { ...a, ...patch } : a)));
  };
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    setSaved(false);
    setList((prev) => {
      const next = prev.slice();
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };
  const remove = (i: number) => {
    setSaved(false);
    setList((prev) => prev.filter((_, idx) => idx !== i));
  };
  const add = () => {
    setSaved(false);
    setList((prev) => [...prev, { id: newArticleId(), title: "", body: "" }]);
  };

  const save = () =>
    start(async () => {
      setErr("");
      const patch = field === "part1" ? { part1: list } : { part3: list };
      const res = await saveLibrarySectionAction(section.id, patch);
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      setSaved(true);
      router.refresh();
    });

  return (
    <div className="pk-card" style={CARD}>
      <div style={H}>{heading}</div>
      {list.map((a, i) => (
        <PartArticleRow
          key={a.id}
          article={a}
          index={i}
          total={list.length}
          section={section}
          onChange={(patch) => update(i, patch)}
          onMoveUp={() => move(i, -1)}
          onMoveDown={() => move(i, 1)}
          onRemove={() => remove(i)}
        />
      ))}
      {list.length === 0 && <div style={{ ...MUTED, marginBottom: 12 }}>No articles yet.</div>}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: list.length ? 14 : 0 }}>
        <button type="button" className="pk-btn-outline" onClick={add}>
          + Add article
        </button>
        <button type="button" className="pk-btn-accent" disabled={pending} onClick={save}>
          {pending ? "Saving…" : "Save"}
        </button>
        {saved && <span style={SAVED}>Saved</span>}
        {err && <span style={ERR}>{err}</span>}
      </div>
    </div>
  );
}

function PartArticleRow({
  article,
  index,
  total,
  section,
  onChange,
  onMoveUp,
  onMoveDown,
  onRemove,
}: {
  article: SpecArticle;
  index: number;
  total: number;
  section: SpecSection;
  onChange: (patch: Partial<SpecArticle>) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
}) {
  const preview = useMemo(
    () =>
      renderBody(article.body, {
        context: "article",
        placeholders: {
          section: { number: section.number, title: section.title },
          manufacturers: [],
          articles: [],
        },
      }),
    [article.body, section.number, section.title]
  );

  return (
    <div
      style={{
        borderTop: index === 0 ? "none" : "1px solid #f0f1f4",
        paddingTop: index === 0 ? 0 : 14,
        marginTop: index === 0 ? 0 : 14,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <input
          className="pk-input"
          value={article.title}
          onChange={(e) => onChange({ title: e.target.value })}
          placeholder="SUBMITTALS"
          style={{ flex: 1 }}
        />
        <button
          type="button"
          className="pk-btn-outline"
          disabled={index === 0}
          onClick={onMoveUp}
          title="Move up"
          aria-label="Move article up"
        >
          ↑
        </button>
        <button
          type="button"
          className="pk-btn-outline"
          disabled={index === total - 1}
          onClick={onMoveDown}
          title="Move down"
          aria-label="Move article down"
        >
          ↓
        </button>
        <ConfirmButton className="pk-btn-danger" label="Remove" confirmLabel="Remove article" onConfirm={onRemove} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 12 }}>
        <textarea
          className="pk-input pk-mono"
          rows={8}
          value={article.body}
          onChange={(e) => onChange({ body: e.target.value })}
          style={{ resize: "vertical" }}
        />
        <div>
          <pre style={PREVIEW}>{outlineToText(preview.lines, "  ")}</pre>
          <Warnings warnings={preview.warnings} />
        </div>
      </div>
    </div>
  );
}

function CategoryArticles({
  section,
  articles,
  partCounts,
}: {
  section: SpecSection;
  articles: SpecCategoryArticle[];
  partCounts: Record<string, number>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");

  const addArticle = () =>
    start(async () => {
      setErr("");
      const nextSort = articles.reduce((max, a) => Math.max(max, a.sort), 0) + 10;
      const res = await createArticleAction({ sectionId: section.id, title: "New article", sort: nextSort });
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      router.refresh();
    });

  return (
    <div className="pk-card" style={CARD}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 12 }}>
        <div style={H}>Part 2 — category articles</div>
        <button type="button" className="pk-btn-outline" disabled={pending} onClick={addArticle}>
          {pending ? "Adding…" : "+ Add category article"}
        </button>
      </div>
      {err && <div style={{ ...ERR, marginBottom: 12 }}>{err}</div>}
      {articles.map((a, i) => (
        <CategoryArticleCard key={a.id} index={i} section={section} article={a} partCount={partCounts[a.id] || 0} />
      ))}
      {articles.length === 0 && <div style={MUTED}>No Part 2 articles yet.</div>}
    </div>
  );
}

function CategoryArticleCard({
  index,
  section,
  article,
  partCount,
}: {
  index: number;
  section: SpecSection;
  article: SpecCategoryArticle;
  partCount: number;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(article.title);
  const [sortText, setSortText] = useState(String(article.sort));
  const [mfrText, setMfrText] = useState(article.manufacturers.join("\n"));
  const [keysText, setKeysText] = useState(article.categoryKeys.join(", "));
  const [general, setGeneral] = useState(article.general);
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const [saved, setSaved] = useState(false);

  const manufacturers = useMemo(() => mfrText.split("\n").map((s) => s.trim()).filter(Boolean), [mfrText]);

  const preview = useMemo(
    () =>
      renderBody(general, {
        context: "article",
        placeholders: {
          section: { number: section.number, title: section.title },
          manufacturers,
          articles: [],
        },
      }),
    [general, section.number, section.title, manufacturers]
  );

  const save = () => {
    const t = title.trim();
    if (!t) {
      setErr("An article needs a title.");
      return;
    }
    start(async () => {
      setErr("");
      const categoryKeys = keysText.split(",").map((s) => s.trim()).filter(Boolean);
      const res = await updateArticleAction(article.id, {
        title: t,
        sort: sortText.trim() === "" ? undefined : Number(sortText),
        manufacturers,
        categoryKeys,
        general,
        sectionId: section.id,
      });
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      setSaved(true);
      router.refresh();
    });
  };

  return (
    <div
      style={{
        borderTop: index === 0 ? "none" : "1px solid #f0f1f4",
        paddingTop: index === 0 ? 0 : 16,
        marginTop: index === 0 ? 0 : 16,
      }}
    >
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 100px", gap: 12, marginBottom: 10 }}>
        <div>
          <label style={LBL}>Title</label>
          <input
            className="pk-input"
            value={title}
            onChange={(e) => {
              setSaved(false);
              setTitle(e.target.value);
            }}
          />
        </div>
        <div>
          <label style={LBL}>Sort</label>
          <input
            className="pk-input mono"
            inputMode="numeric"
            value={sortText}
            onChange={(e) => {
              setSaved(false);
              setSortText(e.target.value);
            }}
          />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 12, marginBottom: 10 }}>
        <div>
          <label style={LBL}>Manufacturers (one per line)</label>
          <textarea
            className="pk-input"
            rows={3}
            value={mfrText}
            onChange={(e) => {
              setSaved(false);
              setMfrText(e.target.value);
            }}
            style={{ resize: "vertical" }}
          />
        </div>
        <div>
          <label style={LBL}>Category keys (comma-separated)</label>
          <textarea
            className="pk-input"
            rows={3}
            value={keysText}
            onChange={(e) => {
              setSaved(false);
              setKeysText(e.target.value);
            }}
            style={{ resize: "vertical" }}
          />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 12, marginBottom: 10 }}>
        <div>
          <label style={LBL}>General</label>
          <textarea
            className="pk-input pk-mono"
            rows={8}
            value={general}
            onChange={(e) => {
              setSaved(false);
              setGeneral(e.target.value);
            }}
            style={{ resize: "vertical" }}
          />
        </div>
        <div>
          <label style={LBL}>Preview</label>
          <pre style={PREVIEW}>{outlineToText(preview.lines, "  ")}</pre>
          <Warnings warnings={preview.warnings} />
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <button type="button" className="pk-btn-accent" disabled={pending} onClick={save}>
          {pending ? "Saving…" : "Save"}
        </button>
        {saved && <span style={SAVED}>Saved</span>}
        <span style={MUTED}>
          {partCount} part{partCount === 1 ? "" : "s"} print here
        </span>
        <ConfirmButton
          className="pk-btn-danger"
          label="Remove"
          confirmLabel="Remove article"
          onConfirm={async () => {
            const r = await deleteArticleAction(article.id);
            if (!r.ok) throw new Error(r.error); // ConfirmButton renders the thrown message inline
            router.refresh();
          }}
        />
        {err && <span style={ERR}>{err}</span>}
      </div>
    </div>
  );
}
