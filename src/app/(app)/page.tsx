import { requireUser } from "@/lib/session";
import { getUser } from "@/lib/users";
import { getSettings } from "@/lib/settings";
import { firstName } from "@/lib/team";
import { money } from "@/lib/format";
import { makeDashboardData } from "@/lib/dashboard/data";
import { homeAlerts, myQuoteStats, resolvePipe, sheetHrefFor } from "@/lib/dashboard/home-metrics";
import HomeTabs from "./home-tabs";
import HomeGreeting from "./home-greeting";
import HomeStageSheet, { type SheetQuote } from "./home-stage-sheet";
import WidgetHost from "./_dashboard/host";
import { reconcileRecordingsIfStale } from "@/lib/krisp/reconcile";

/**
 * Home dashboard. Since #43 the cards are registry widgets rendered by
 * WidgetHost from the user's saved layout; this file keeps only the page
 * chrome — greeting (identity) and the ?sheet= stage sheet (a modal) — and
 * shares one DashboardData bundle with the host so nothing loads twice.
 * Pipeline filter + stage sheet state still live in the URL (?pipe, ?sheet).
 */

/* ---- responsive + hover rules (prototype hm-* classes, pkh- prefixed) ---- */
const HOME_CSS = `
.pkh-rowscroll::-webkit-scrollbar{display:none}
.pkh-rowscroll{-ms-overflow-style:none;scrollbar-width:none}
.pkh-hover:hover{background:#fafbff}
.pkh-hoverbox:hover{background:#f1f2f5}
.pkh-openbtn:hover{border-color:#c4c9d2}
.pkh-newdesign:hover{border-color:var(--accent);color:color-mix(in srgb,var(--accent) 70%,#000);background:var(--accent-soft)}
.pkh-softbtn:hover{filter:brightness(.98)}
.pkh-accbtn:hover{filter:brightness(1.06)}
.pkh-outbtn:hover{border-color:#c4c9d2;box-shadow:0 1px 3px rgba(0,0,0,.06)}
.pkh-closebtn:hover{background:#e7e9ee}
.pkh-delbtn:hover{background:#f4ddd5}
.pkh-inbox{display:grid;grid-template-columns:minmax(0,1fr) 296px}
.pkh-inbox-aside{border-left:1px solid #f0f1f4;background:#fbfbfc;padding:14px 16px}
.pkh-widget-grid{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:18px;align-items:start}
.pkh-widget-full{grid-column:span 12}
.pkh-widget-half{grid-column:span 6}
.pkh-widget-third{grid-column:span 4}
.pkh-widget-sidebar{grid-column:span 3}
@media (max-width:860px){
  .pkh-content{padding-left:16px !important;padding-right:16px !important}
  .pkh-greet{flex-direction:column !important;align-items:stretch !important}
  .pkh-actions{width:100%}
  .pkh-actions a{flex:1;justify-content:center}
  .pkh-inbox{grid-template-columns:1fr}
  .pkh-inbox-aside{border-left:none;border-top:1px solid #f0f1f4}
  .pkh-widget-full,.pkh-widget-half,.pkh-widget-third,.pkh-widget-sidebar{grid-column:span 12}
  .pkh-sheetwrap{align-items:flex-end !important;padding:0 !important}
  .pkh-sheet{width:100% !important;max-width:100% !important;border-radius:18px 18px 0 0 !important}
}
`;

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const me = user.name;
  const data = makeDashboardData(user);
  void reconcileRecordingsIfStale().catch(() => {});
  const now = Date.now();
  const [userRecord, appSettings, quotesAll, designsAll] = await Promise.all([
    getUser(user.id), getSettings(), data.quotes(), data.designs(),
  ]);

  const pipe = resolvePipe(first(sp.pipe));
  const sheetHref = sheetHrefFor(pipe);
  const s = myQuoteStats(quotesAll, me);
  const { urgentCount, openReviewCount } = homeAlerts(quotesAll, designsAll, me, now, sheetHref);

  /* ---- greeting (unchanged) ---- */
  const office = appSettings.offices.find((o) => o.quoteDefault) || appSettings.offices[0];
  let timezone = office?.timezone || "America/Chicago";
  try { new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(); } catch { timezone = "America/Chicago"; }
  const localParts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", hour12: false }).formatToParts(new Date(now));
  const hour = Number(localParts.find((part) => part.type === "hour")?.value || 0);
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const lastLogin = userRecord?.previousLoginAt
    ? new Intl.DateTimeFormat("en-US", { timeZone: timezone, dateStyle: "medium", timeStyle: "short" }).format(userRecord.previousLoginAt)
    : "First login";
  const standfirst = `${s.openQuotes.length} open quotes worth ${money(s.openValue)} · ${urgentCount} need attention`;

  /* ---- stage sheet (unchanged) ---- */
  const sheetId = first(sp.sheet);
  const sheetQ = sheetId ? s.myQuotes.find((q) => q.id === sheetId) : undefined;
  const sheetQuote: SheetQuote | null = sheetQ
    ? {
        id: sheetQ.id, name: sheetQ.name, meta: `${sheetQ.id} · ${sheetQ.customer || "—"}`, value: money(sheetQ.value),
        marginLabel: sheetQ.margin ? `${Math.round(sheetQ.margin * 100)}% margin` : "", status: sheetQ.status,
      }
    : null;
  const closeHref = pipe === "all" ? "/" : `/?pipe=${pipe}`;

  return (
    <HomeTabs active="dashboard" className="pkh-content">
      <style dangerouslySetInnerHTML={{ __html: HOME_CSS }} />
      <HomeGreeting greeting={greeting} firstName={firstName(me)} standfirst={standfirst} openReviewCount={openReviewCount} lastLogin={lastLogin} timezone={timezone} />
      <WidgetHost user={user} surface="home" sp={sp} data={data} />
      {sheetQuote && <HomeStageSheet quote={sheetQuote} closeHref={closeHref} />}
    </HomeTabs>
  );
}
