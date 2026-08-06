import Link from "next/link";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/team";
import { IMPORT_TYPES, getTypeMeta } from "./types";
import { allCounts } from "./registry";
import { PastePreview } from "./controls";

export const metadata = { title: "Import & export — Quartzite-6" };

const ACCENT = "var(--accent)";

function one(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] ?? "" : v ?? "";
}

const CSS = `
  .im-card:hover { border-color: #d9dce2; }
  .im-linkbtn:hover { filter: brightness(1.05); }
  .im-outbtn:hover { border-color: #c4c9d2; }
  .im-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(304px, 1fr)); gap: 14px; }
  @media (max-width: 720px) { .im-steps { display: none !important; } }
`;

export default async function ImportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [user, sp] = await Promise.all([requireUser(), searchParams]);
  const isAdmin = can("manage_users", user.roles);

  return (
    <div className="pk-content">
      <style>{CSS}</style>

      {/* header */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 18,
          flexWrap: "wrap",
          rowGap: 10,
          marginBottom: 20,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-.015em" }}>Import &amp; export</div>
          <div style={{ fontSize: 13.5, color: "#8c919c", marginTop: 5 }}>
            Move records into Peak from another system, or export what’s in Peak — one data type at a time.
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: ".06em",
              color: "#8a6d1f",
              background: "#fbf3dd",
              border: "1px solid #f0e2bd",
              padding: "3px 9px",
              borderRadius: 6,
            }}
          >
            ADMIN
          </span>
          <span style={{ fontSize: 11.5, color: "#aab0bb", whiteSpace: "nowrap" }}>CSV · Excel · paste</span>
        </div>
      </div>

      {!isAdmin ? (
        <div
          style={{
            background: "#fff",
            border: "1px solid #ececf0",
            borderRadius: 13,
            padding: "48px 24px",
            textAlign: "center",
            boxShadow: "0 1px 2px rgba(0,0,0,.04)",
            maxWidth: 520,
            margin: "24px auto",
          }}
        >
          <div
            style={{
              width: 46,
              height: 46,
              borderRadius: 12,
              background: "#f1f2f5",
              color: "#8c919c",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 22,
              margin: "0 auto 14px",
            }}
          >
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <rect x="3" y="11" width="18" height="11" rx="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>
          <div style={{ fontSize: 15, fontWeight: 600 }}>Admin access required</div>
          <div style={{ fontSize: 13, color: "#9aa0ab", marginTop: 6, lineHeight: 1.55 }}>
            Importing writes records for the whole team, so it’s limited to admins. Ask an admin to
            run the migration, or to grant you the Admin role.
          </div>
        </div>
      ) : (
        <AdminBody sp={sp} />
      )}
    </div>
  );
}

async function AdminBody({ sp }: { sp: Record<string, string | string[] | undefined> }) {
  const tab = one(sp.tab) === "export" ? "export" : "import";
  const openKey = tab === "import" ? one(sp.type) : "";
  const openType = openKey ? getTypeMeta(openKey) : null;
  const resultRaw = one(sp.r);
  const errRaw = tab === "import" ? one(sp.err) : "";
  const counts = await allCounts();

  const hrefFor = (over: { tab?: string; type?: string | null; r?: string | null }) => {
    const qs = new URLSearchParams();
    const t = over.tab ?? tab;
    if (t && t !== "import") qs.set("tab", t);
    const ty = over.type === undefined ? openKey : over.type;
    if (ty) qs.set("type", ty);
    const r = over.r === undefined ? "" : over.r;
    if (r) qs.set("r", r);
    const s = qs.toString();
    return "/import" + (s ? "?" + s : "");
  };

  const segBase = {
    fontFamily: "var(--font-ui)",
    fontSize: 12.5,
    fontWeight: 600,
    padding: "8px 20px",
    borderRadius: 7,
    textDecoration: "none",
  } as const;

  return (
    <>
      {/* import / export toggle */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
          rowGap: 10,
          marginBottom: 18,
        }}
      >
        <div style={{ display: "inline-flex", background: "#eceef1", borderRadius: 9, padding: 3 }}>
          <Link
            href={hrefFor({ tab: "import", type: null, r: null })}
            style={{
              ...segBase,
              ...(tab === "import"
                ? { color: "#16181d", background: "#fff", boxShadow: "0 1px 2px rgba(0,0,0,.1)" }
                : { color: "#8c919c", background: "transparent" }),
            }}
          >
            Import
          </Link>
          <Link
            href={hrefFor({ tab: "export", type: null, r: null })}
            style={{
              ...segBase,
              ...(tab === "export"
                ? { color: "#16181d", background: "#fff", boxShadow: "0 1px 2px rgba(0,0,0,.1)" }
                : { color: "#8c919c", background: "transparent" }),
            }}
          >
            Export
          </Link>
        </div>
        <div style={{ fontSize: 12, color: "#8c919c", maxWidth: 540, lineHeight: 1.45 }}>
          {tab === "import"
            ? "Paste a CSV or spreadsheet export — rows write straight into Peak."
            : "Download what’s in Peak as CSV — edit and re-import, or keep it as a backup. Same columns as the import template."}
        </div>
      </div>

      {/* migration strip (import only) */}
      {tab === "import" && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 20,
            flexWrap: "wrap",
            rowGap: 12,
            background: "#fff",
            border: "1px solid #ececf0",
            borderRadius: 13,
            boxShadow: "0 1px 2px rgba(0,0,0,.04)",
            padding: "15px 18px",
            marginBottom: 20,
          }}
        >
          <div style={{ minWidth: 200, flex: 1 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600 }}>Moving in from another system?</div>
            <div style={{ fontSize: 12, color: "#8c919c", marginTop: 2, lineHeight: 1.45 }}>
              Export a CSV or spreadsheet from wherever your data lives now, then import each type
              below. Pick a data type to start.
            </div>
          </div>
          <div className="im-steps" style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
            {[
              { n: "1", label: "Grab a template" },
              { n: "2", label: "Paste your export" },
              { n: "3", label: "Review & import" },
            ].map((s) => (
              <div key={s.n} style={{ display: "flex", alignItems: "center", gap: 9 }}>
                <span
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: "50%",
                    background: "var(--accent-soft)",
                    color: "color-mix(in srgb, var(--accent) 70%, #000)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    fontWeight: 600,
                    flexShrink: 0,
                  }}
                >
                  {s.n}
                </span>
                <span style={{ fontSize: 12, fontWeight: 500, color: "#3a3f4a", whiteSpace: "nowrap" }}>
                  {s.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* import error surfaced with nowhere else to render (e.g. stale/unknown type) */}
      {errRaw && !openType && (
        <div
          style={{
            background: "#f9ece8",
            border: "1px solid #f0d6cd",
            borderRadius: 10,
            padding: "11px 14px",
            fontSize: 12.5,
            color: "#a0442b",
            marginBottom: 18,
          }}
        >
          Import failed: {errRaw}
        </div>
      )}

      {/* cards */}
      <div className="im-cards">
        {IMPORT_TYPES.map((t) => {
          const count = counts[t.key] || 0;
          return (
            <div
              key={t.key}
              className="im-card"
              style={{
                display: "flex",
                flexDirection: "column",
                background: "#fff",
                border: "1px solid #ececf0",
                borderRadius: 13,
                boxShadow: "0 1px 2px rgba(0,0,0,.04)",
                overflow: "hidden",
              }}
            >
              <div style={{ padding: "16px 16px 0", flex: 1 }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
                  <span
                    style={{
                      width: 38,
                      height: 38,
                      borderRadius: 10,
                      flexShrink: 0,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontFamily: "var(--font-mono)",
                      fontSize: 12,
                      fontWeight: 700,
                      color: "#fff",
                      background: t.color,
                    }}
                  >
                    {t.mono}
                  </span>
                  <span
                    style={{
                      fontSize: 10.5,
                      fontWeight: 600,
                      padding: "3px 9px",
                      borderRadius: 20,
                      whiteSpace: "nowrap",
                      flexShrink: 0,
                      ...(count > 0
                        ? {
                            color: "color-mix(in srgb, var(--accent) 70%, #000)",
                            background: "var(--accent-soft)",
                            border: "1px solid color-mix(in srgb, var(--accent) 30%, #fff)",
                          }
                        : { color: "#9aa0ab", background: "#f4f5f7", border: "1px solid #eceef1" }),
                    }}
                  >
                    {count > 0 ? count + " in Peak" : "None yet"}
                  </span>
                </div>
                <div style={{ fontSize: 14.5, fontWeight: 600, marginTop: 12, letterSpacing: "-.01em" }}>
                  {t.label}
                </div>
                <div style={{ fontSize: 12, color: "#8c919c", marginTop: 4, lineHeight: 1.5, minHeight: 36 }}>
                  {t.blurb}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "13px 16px", marginTop: 6 }}>
                {tab === "import" ? (
                  <>
                    <Link
                      href={hrefFor({ type: t.key, r: null })}
                      className="im-linkbtn"
                      style={{
                        flex: 1,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 7,
                        fontSize: 12.5,
                        fontWeight: 600,
                        color: "#fff",
                        background: ACCENT,
                        padding: "9px 12px",
                        borderRadius: 8,
                        textDecoration: "none",
                      }}
                    >
                      <span style={{ fontSize: 13, lineHeight: 1 }}>↑</span> Import
                    </Link>
                    <a
                      href={`/import/export?type=${encodeURIComponent(t.key)}&kind=template`}
                      className="im-outbtn"
                      title="Download a blank CSV template"
                      style={{
                        fontSize: 12.5,
                        fontWeight: 600,
                        color: "#5b616e",
                        background: "#fff",
                        border: "1px solid #e4e7ec",
                        padding: "9px 12px",
                        borderRadius: 8,
                        textDecoration: "none",
                        whiteSpace: "nowrap",
                      }}
                    >
                      Template
                    </a>
                  </>
                ) : count > 0 ? (
                  <a
                    href={`/import/export?type=${encodeURIComponent(t.key)}`}
                    className="im-linkbtn"
                    style={{
                      flex: 1,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 7,
                      fontSize: 12.5,
                      fontWeight: 600,
                      color: "#fff",
                      background: ACCENT,
                      padding: "9px 12px",
                      borderRadius: 8,
                      textDecoration: "none",
                    }}
                  >
                    <span style={{ fontSize: 13, lineHeight: 1 }}>↓</span> Export CSV
                  </a>
                ) : (
                  <span
                    style={{
                      flex: 1,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 7,
                      fontSize: 12.5,
                      fontWeight: 600,
                      color: "#aab0bb",
                      background: "#eef0f3",
                      padding: "9px 12px",
                      borderRadius: 8,
                    }}
                  >
                    Nothing to export
                  </span>
                )}
              </div>
            </div>
          );
        })}

        {/* pricing / estimating-rules export (export tab only) */}
        {tab === "export" && (
          <div
            className="im-card"
            style={{
              display: "flex",
              flexDirection: "column",
              background: "#fff",
              border: "1px solid #ececf0",
              borderRadius: 13,
              boxShadow: "0 1px 2px rgba(0,0,0,.04)",
              overflow: "hidden",
            }}
          >
            <div style={{ padding: "16px 16px 0", flex: 1 }}>
              <span
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 10,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontFamily: "var(--font-mono)",
                  fontSize: 12,
                  fontWeight: 700,
                  color: "#fff",
                  background: "#2f6f6f",
                }}
              >
                PX
              </span>
              <div style={{ fontSize: 14.5, fontWeight: 600, marginTop: 12, letterSpacing: "-.01em" }}>
                Estimating rules &amp; pricing
              </div>
              <div style={{ fontSize: 12, color: "#8c919c", marginTop: 4, lineHeight: 1.5, minHeight: 36 }}>
                Every rate &amp; formula the estimator uses — export for a backup or an off-line review.
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "13px 16px", marginTop: 6 }}>
              <a
                href="/import/export?type=pricing&fmt=csv"
                className="im-linkbtn"
                style={{
                  flex: 1,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 7,
                  fontSize: 12.5,
                  fontWeight: 600,
                  color: "#fff",
                  background: ACCENT,
                  padding: "9px 12px",
                  borderRadius: 8,
                  textDecoration: "none",
                }}
              >
                <span style={{ fontSize: 13, lineHeight: 1 }}>↓</span> Export CSV
              </a>
              <a
                href="/import/export?type=pricing&fmt=json"
                className="im-outbtn"
                style={{
                  fontSize: 12.5,
                  fontWeight: 600,
                  color: "#5b616e",
                  background: "#fff",
                  border: "1px solid #e4e7ec",
                  padding: "9px 12px",
                  borderRadius: 8,
                  textDecoration: "none",
                  whiteSpace: "nowrap",
                }}
              >
                JSON
              </a>
            </div>
          </div>
        )}
      </div>

      <div style={{ fontSize: 11.5, color: "#aab0bb", marginTop: 18, lineHeight: 1.5 }}>
        Price books &amp; parts import separately on the{" "}
        <Link href="/catalog" style={{ color: ACCENT, fontWeight: 600, textDecoration: "none" }}>
          Catalog
        </Link>{" "}
        screen. Imports write straight into the app like any other change.
      </div>

      {/* per-type flow modal */}
      {openType && (
        <ImportFlowModal
          type={openType}
          resultRaw={resultRaw}
          errRaw={errRaw}
          closeHref={hrefFor({ type: null, r: null })}
          anotherHref={hrefFor({ type: openType.key, r: null })}
        />
      )}
    </>
  );
}

function ImportFlowModal({
  type,
  resultRaw,
  errRaw,
  closeHref,
  anotherHref,
}: {
  type: NonNullable<ReturnType<typeof getTypeMeta>>;
  resultRaw: string;
  errRaw: string;
  closeHref: string;
  anotherHref: string;
}) {
  const done = parseResult(resultRaw);

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
            width: 640,
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
          {/* header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "16px 20px",
              borderBottom: "1px solid #f0f1f4",
              flexShrink: 0,
            }}
          >
            <span
              style={{
                width: 34,
                height: 34,
                borderRadius: 9,
                flexShrink: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                fontWeight: 700,
                color: "#fff",
                background: type.color,
              }}
            >
              {type.mono}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.25 }}>Import {type.label}</div>
              <div style={{ fontSize: 11.5, color: "#9aa0ab", marginTop: 1 }}>
                {done ? "Import complete" : "Paste a CSV block & review"}
              </div>
            </div>
            <Link
              href={closeHref}
              scroll={false}
              style={{
                width: 30,
                height: 30,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                border: "none",
                background: "#f1f2f5",
                borderRadius: 8,
                color: "#5b616e",
                fontSize: 17,
                textDecoration: "none",
                flexShrink: 0,
              }}
            >
              ×
            </Link>
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: "18px 20px" }}>
            {done ? (
              <DonePanel type={type} r={done} />
            ) : (
              <>
                {errRaw && (
                  <div
                    style={{
                      background: "#f9ece8",
                      border: "1px solid #f0d6cd",
                      borderRadius: 10,
                      padding: "10px 13px",
                      fontSize: 12.5,
                      color: "#a0442b",
                      marginBottom: 14,
                    }}
                  >
                    {errRaw}
                  </div>
                )}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    background: "#fbfbfc",
                    border: "1px solid #eef0f3",
                    borderRadius: 10,
                    padding: "11px 13px",
                    marginBottom: 14,
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600 }}>Uploading a file?</div>
                    <div style={{ fontSize: 11.5, color: "#9aa0ab", marginTop: 1, lineHeight: 1.4 }}>
                      Choose an Excel file, or copy rows from any spreadsheet and paste them below — same result.
                    </div>
                  </div>
                  <a
                    href={`/import/export?type=${encodeURIComponent(type.key)}&kind=template`}
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: "color-mix(in srgb, var(--accent) 70%, #000)",
                      background: "var(--accent-soft)",
                      border: "1px solid color-mix(in srgb, var(--accent) 30%, #fff)",
                      padding: "8px 13px",
                      borderRadius: 8,
                      textDecoration: "none",
                      whiteSpace: "nowrap",
                      flexShrink: 0,
                    }}
                  >
                    ↓ Template
                  </a>
                </div>
                <PastePreview
                  typeKey={type.key}
                  fields={type.fields}
                  dedupeLabel={type.dedupeLabel}
                  accent="var(--accent)"
                />
              </>
            )}
          </div>

          {done && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                padding: "13px 20px",
                borderTop: "1px solid #f0f1f4",
                background: "#fbfbfc",
                flexShrink: 0,
              }}
            >
              <Link
                href={type.viewHref}
                style={{ fontSize: 13, fontWeight: 600, color: "var(--accent)", textDecoration: "none" }}
              >
                {type.viewLabel} →
              </Link>
              <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                <Link
                  href={anotherHref}
                  scroll={false}
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: "#3a3f4a",
                    background: "#fff",
                    border: "1px solid #e4e7ec",
                    padding: "9px 14px",
                    borderRadius: 9,
                    textDecoration: "none",
                  }}
                >
                  Import another
                </Link>
                <Link
                  href={closeHref}
                  scroll={false}
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: "#fff",
                    background: "var(--accent)",
                    padding: "10px 18px",
                    borderRadius: 9,
                    textDecoration: "none",
                  }}
                >
                  Done
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

type DoneResult = { created: number; updated: number; skipped: number; errored: number; total: number };

function parseResult(raw: string): DoneResult | null {
  if (!raw) return null;
  const p = raw.split(".").map((n) => parseInt(n, 10));
  if (p.length < 5 || p.some((n) => isNaN(n))) return null;
  return { created: p[0], updated: p[1], skipped: p[2], errored: p[3], total: p[4] };
}

function DonePanel({
  type,
  r,
}: {
  type: NonNullable<ReturnType<typeof getTypeMeta>>;
  r: DoneResult;
}) {
  const totalIn = r.created + r.updated;
  const hasErrors = r.errored > 0;
  // Zero rows written must never read as a green success — split "nothing to
  // do" (everything was already a duplicate, no errors) from "it failed"
  // (rows errored out) so the panel can't imply records changed when none did.
  const nothingImported = totalIn === 0;
  const stats: Array<{ label: string; num: number; color: string }> = [
    { label: "Created", num: r.created, color: "#1f8a5b" },
    { label: "Updated", num: r.updated, color: "#3155a8" },
    { label: "Skipped", num: r.skipped, color: "#8c919c" },
    { label: "Errors", num: r.errored, color: hasErrors ? "#b4543a" : "#8c919c" },
  ];

  const icon = nothingImported ? (hasErrors ? "!" : "–") : "✓";
  const iconBg = nothingImported ? (hasErrors ? "#f9ece8" : "#f1f2f5") : "#eaf6ef";
  const iconColor = nothingImported ? (hasErrors ? "#a0442b" : "#8c919c") : "#1f8a5b";

  const headline = nothingImported
    ? hasErrors
      ? "Nothing imported"
      : "Nothing new to import"
    : `${totalIn} ${type.label.toLowerCase()} imported`;

  const subtext = nothingImported
    ? hasErrors
      ? `${r.errored} row${r.errored === 1 ? "" : "s"} failed — nothing was written.`
      : r.skipped > 0
        ? `All ${r.skipped} row${r.skipped === 1 ? "" : "s"} already existed — nothing changed.`
        : "No rows were written."
    : `${r.skipped > 0 ? `${r.skipped} skipped as duplicates. ` : ""}Records are live across Peak.`;

  return (
    <>
      <div style={{ textAlign: "center", padding: "8px 0 4px" }}>
        <div
          style={{
            width: 52,
            height: 52,
            borderRadius: "50%",
            background: iconBg,
            color: iconColor,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 26,
            margin: "0 auto 12px",
          }}
        >
          {icon}
        </div>
        <div style={{ fontSize: 16, fontWeight: 600 }}>{headline}</div>
        <div style={{ fontSize: 12.5, color: "#8c919c", marginTop: 4 }}>{subtext}</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9, marginTop: 18 }}>
        {stats.map((s) => (
          <div
            key={s.label}
            style={{ background: "#fbfbfc", border: "1px solid #eef0f3", borderRadius: 10, padding: "11px 13px" }}
          >
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 20, fontWeight: 600, color: s.color }}>
              {s.num}
            </div>
            <div style={{ fontSize: 11, color: "#8c919c", marginTop: 2 }}>{s.label}</div>
          </div>
        ))}
      </div>
      {r.errored > 0 && (
        <div
          style={{
            marginTop: 14,
            background: "#f9ece8",
            border: "1px solid #f0d6cd",
            borderRadius: 10,
            padding: "10px 12px",
            fontSize: 12,
            color: "#a0442b",
            lineHeight: 1.5,
          }}
        >
          {r.errored} row{r.errored === 1 ? "" : "s"} couldn’t be imported — usually a missing
          required field. Fix them in your source and import again.
        </div>
      )}
    </>
  );
}
