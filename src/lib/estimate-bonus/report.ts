/** Estimator bonuses — the Reports rows + CSV (pure). */
import { displayQuoteNumber } from "@/lib/estimate-number";
import type { BonusRecord } from "./record";

export type BonusReportRow = {
  quoteId: string;
  number: string;
  name: string;
  customer: string;
  wonAt: number;
  month: string;
  person: string;
  role: "lead" | "prepared";
  pct: number;
  sellTotal: number;
  amount: number;
};

export type BonusReportQuote = {
  id: string;
  estNo?: number | null;
  estSuffix?: number | null;
  quoteType?: string | null;
  name: string;
  customer?: string | null;
  status: string;
  bonusRecord?: BonusRecord | null;
};

const MONTH_FMT = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit" });
const DAY_FMT = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" });

/** "2026-10" in America/Chicago. */
export function chicagoMonth(ms: number): string {
  return MONTH_FMT.format(ms);
}

/** "2026-10-05" in America/Chicago. */
export function chicagoDay(ms: number): string {
  return DAY_FMT.format(ms);
}

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

export function bonusReportRows(
  quotes: BonusReportQuote[],
  viewer: { id: string; name: string; isAdmin: boolean },
  filter: { from: number; to: number; person?: string | null },
): BonusReportRow[] {
  const want = viewer.isAdmin ? norm(filter.person) : "";
  const rows: BonusReportRow[] = [];
  for (const q of quotes) {
    const rec = q.bonusRecord;
    if (q.status !== "won" || !rec) continue;
    if (!(rec.wonAt >= filter.from && rec.wonAt < filter.to)) continue;
    for (const c of rec.credits) {
      if (viewer.isAdmin) {
        if (want && norm(c.name) !== want) continue;
      } else if (!(c.userId === viewer.id || (!c.userId && norm(c.name) === norm(viewer.name)))) continue;
      rows.push({
        quoteId: q.id,
        number: displayQuoteNumber(q),
        name: q.name,
        customer: q.customer ?? "",
        wonAt: rec.wonAt,
        month: chicagoMonth(rec.wonAt),
        person: c.name,
        role: c.role,
        pct: c.pct,
        sellTotal: rec.sellTotal,
        amount: c.amount,
      });
    }
  }
  return rows.sort((a, b) => a.person.localeCompare(b.person) || a.wonAt - b.wonAt);
}

function field(v: string | number): string {
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function bonusReportCsv(rows: BonusReportRow[]): string {
  const head = ["Person", "Role", "Month", "Estimate #", "Estimate", "Customer", "Won", "Split %", "Estimate total", "Amount"];
  const lines = [head.join(",")];
  for (const r of rows) {
    lines.push(
      [r.person, r.role === "lead" ? "Lead" : "Prepared by", r.month, r.number, r.name, r.customer, chicagoDay(r.wonAt), r.pct, r.sellTotal.toFixed(2), r.amount.toFixed(2)]
        .map(field)
        .join(","),
    );
  }
  return lines.join("\n") + "\n";
}

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Epoch-ms of 00:00 America/Chicago on a YYYY-MM-DD day, or null if malformed. */
export function chicagoDayStart(day: string): number | null {
  const m = DAY_RE.exec(day);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  for (const off of [5, 6]) {
    const c = Date.UTC(y, mo - 1, d, off);
    if (chicagoDay(c) === day && chicagoDay(c - 3_600_000) !== day) return c;
  }
  return null;
}

/** The report window from `?from=&to=` (inclusive days). Default: Jan 1 this year through today. */
export function bonusReportRange(from: string | null | undefined, to: string | null | undefined, now: number): { from: number; to: number; fromDay: string; toDay: string } {
  const today = chicagoDay(now);
  const fromDay = from && chicagoDayStart(from) != null ? from : `${today.slice(0, 4)}-01-01`;
  const toDay = to && chicagoDayStart(to) != null ? to : today;
  const f = chicagoDayStart(fromDay)!;
  const lastStart = chicagoDayStart(toDay)!;
  // Exclusive end = the start of the day after `toDay` (25 h lands inside it on any DST day).
  const next = chicagoDay(lastStart + 25 * 3_600_000);
  return { from: f, to: chicagoDayStart(next) ?? lastStart + 24 * 3_600_000, fromDay, toDay };
}
