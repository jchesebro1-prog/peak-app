import Link from "next/link";
import { requireUser } from "@/lib/session";
import { getSettings } from "@/lib/settings";
import { quoteBuilderHref } from "@/lib/quote-links";
import { PrintButton } from "@/components/letter/print-button";
import { CutSheetPages, CLIENT_PRINT_CSS, SUBMITTAL_PRINT_CSS } from "@/components/cutsheets/cut-sheet-pages";
import { loadCutSheets } from "@/lib/curtain-cut-sheets/load";
import { CUT_SHEETS_NONE, type CutSheetStyle } from "@/lib/curtain-cut-sheets/model";

export const dynamic = "force-dynamic";
export const metadata = { title: "Cut sheets — Quartzite-6" };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || "";
const LINK = { fontFamily: "var(--font-ui)", fontSize: 12.5, color: "var(--accent)", textDecoration: "none" } as const;

/** Curtain cut sheets (#292 §4.2): /estimator/cut-sheets?id=<quoteId>&style=submittal|client. */
export default async function CutSheetsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUser();
  const sp = await searchParams;
  const id = first(sp.id);
  const style: CutSheetStyle = first(sp.style) === "client" ? "client" : "submittal";
  const [loaded, settings] = await Promise.all([loadCutSheets(id, { images: style === "client" ? "url" : "none" }), getSettings()]);
  const accent = settings.accent || "#b08d4a";
  if (!loaded.ok) {
    return (
      <div className="pk-content" style={{ maxWidth: 960 }}>
        <div className="pk-card" style={{ padding: "48px 24px", textAlign: "center", fontSize: 15, fontWeight: 600 }}>{loaded.error}</div>
      </div>
    );
  }
  const { quote, result, models, photos } = loaded;
  const back = quoteBuilderHref(quote);
  const editHref = `/estimator?id=${encodeURIComponent(quote.id)}`;
  const curtains = result.types.reduce((a, t) => a + t.totalQty, 0);
  const href = (s: CutSheetStyle) => `/estimator/cut-sheets?id=${encodeURIComponent(quote.id)}&style=${s}`;
  const warnings = result.types.flatMap((t) => t.warnings.map((w) => `${t.sheetNo} ${t.title}: ${w}`));
  const hasPanel = result.unreadable.length + result.skippedOptional.length + warnings.length + result.notes.length > 0;
  return (
    <div className="pk-content" style={{ maxWidth: "none", padding: "22px 24px 64px" }}>
      <style>{style === "submittal" ? SUBMITTAL_PRINT_CSS : CLIENT_PRINT_CSS}</style>
      <div className="pk-doc-toolbar pk-no-print" style={{ maxWidth: "none", justifyContent: "flex-start", flexWrap: "wrap", gap: 14 }}>
        <Link href={back} style={LINK}>← Back to estimate</Link>
        <span style={{ display: "inline-flex", gap: 8 }}>
          <Link href={href("submittal")} style={{ ...LINK, fontWeight: style === "submittal" ? 700 : 400 }}>Submittal</Link>
          <Link href={href("client")} style={{ ...LINK, fontWeight: style === "client" ? 700 : 400 }}>Client</Link>
        </span>
        <span style={{ marginLeft: "auto", fontSize: 12.5, color: "#8c919c", fontFamily: "var(--font-ui)" }}>
          {`${result.types.length} curtain type${result.types.length === 1 ? "" : "s"} · ${curtains} curtain${curtains === 1 ? "" : "s"}`}
        </span>
        {result.types.length > 0 && <PrintButton accent={accent} />}
      </div>
      {hasPanel && (
        <div className="pk-card pk-no-print" style={{ padding: "14px 18px", margin: "12px 0 18px", fontSize: 13, lineHeight: 1.55 }}>
          {result.notes.map((n) => <div key={n} style={{ color: "#8a6d1f" }}>{n}</div>)}
          {result.unreadable.map((u) => (
            <div key={u.ref}>
              {`${u.where} — ${u.desc}: ${u.reason} `}
              <Link href={editHref} style={LINK}>Edit the curtain →</Link>
            </div>
          ))}
          {result.skippedOptional.map((o) => <div key={o.ref} style={{ color: "#5b616e" }}>{`Left out: ${o.where} — ${o.desc}`}</div>)}
          {warnings.map((w) => <div key={w} style={{ color: "#8a6d1f" }}>{w}</div>)}
        </div>
      )}
      {result.types.length === 0 ? (
        <div className="pk-card" style={{ padding: "48px 24px", textAlign: "center", fontSize: 15, fontWeight: 600 }}>{CUT_SHEETS_NONE}</div>
      ) : (
        <CutSheetPages models={models[style]} style={style} photos={photos} />
      )}
    </div>
  );
}
