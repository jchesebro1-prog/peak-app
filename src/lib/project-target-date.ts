const DAY = 86400000;
const WEEK = 7 * DAY;
const MIN_INSTALL_LEAD_WEEKS = 12;

type QuoteScopeLike = {
  value?: number | null;
  installLeadWeeks?: number | null;
  spec?: {
    sections?: unknown;
    mobs?: unknown;
    hasLabor?: boolean;
  } | null;
};

export type ProjectSchedule = {
  targetDate: number;
  installStart: number | null;
  installEnd: number | null;
};

function sectionCount(q: QuoteScopeLike | null | undefined): number {
  return Array.isArray(q?.spec?.sections) ? q!.spec!.sections!.length : 0;
}

function mobilizationPersonDays(q: QuoteScopeLike | null | undefined): number {
  const mobs = Array.isArray(q?.spec?.mobs) ? (q!.spec!.mobs! as Array<{ days?: number | null; crew?: number | null }>) : [];
  return mobs.reduce(
    (sum, mob) => sum + Math.max(0, mob.days || 0) * Math.max(1, mob.crew || 0),
    0,
  );
}

export function quoteHasInstallLaborLike(q: QuoteScopeLike | null | undefined): boolean {
  const spec = q?.spec;
  if (spec && Array.isArray(spec.sections)) {
    return (spec.sections as Array<{ kind?: string; items?: unknown[] }>).some(
      (s) => s.kind === "labor" && Array.isArray(s.items) && s.items.length > 0,
    );
  }
  if (spec && typeof spec.hasLabor === "boolean") return spec.hasLabor;
  if (mobilizationPersonDays(q) > 0) return true;
  return true;
}

export function defaultInstallLeadWeeks(q: QuoteScopeLike | null | undefined): number {
  const value = q?.value || 0;
  const peopleDays = mobilizationPersonDays(q);
  const sections = sectionCount(q);
  if (value >= 150000 || peopleDays >= 24 || sections >= 6) return 16;
  if (value >= 75000 || peopleDays >= 10 || sections >= 4) return 14;
  return MIN_INSTALL_LEAD_WEEKS;
}

export function normalizeInstallLeadWeeks(
  rawWeeks: number | null | undefined,
  fallbackWeeks: number,
): number {
  const weeks = Number.isFinite(rawWeeks) ? Math.floor(rawWeeks as number) : fallbackWeeks;
  return Math.max(MIN_INSTALL_LEAD_WEEKS, weeks);
}

export function projectScheduleFromTargetDate(
  targetDate: number,
  hasInstallLabor: boolean,
): ProjectSchedule {
  return {
    targetDate,
    installStart: hasInstallLabor ? targetDate - 4 * DAY : null,
    installEnd: hasInstallLabor ? targetDate + 2 * DAY : null,
  };
}

export function projectScheduleFromQuote(
  q: QuoteScopeLike | null | undefined,
  wonAt: number,
): ProjectSchedule {
  const weeks = normalizeInstallLeadWeeks(q?.installLeadWeeks, defaultInstallLeadWeeks(q));
  return projectScheduleFromTargetDate(wonAt + weeks * WEEK, quoteHasInstallLaborLike(q));
}
