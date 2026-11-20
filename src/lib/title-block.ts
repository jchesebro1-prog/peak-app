/**
 * The title block's data (moved out of the Grid's drawing-set model when the
 * Grid was removed). Rack submittal sheets and curtain cut sheets print
 * through `src/components/drawing/title-block.tsx`. Pure — no DB.
 */

/** 0 → A … 25 → Z, 26 → AA, 27 → AB … */
export function revLetter(index: number): string {
  let n = Math.max(0, Math.floor(index));
  let s = "";
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

export type RevisionRow = { rev: number; letter: string; date: number; label: string };

/** How many revision rows the title strip prints (newest first). */
export const REV_ROWS = 6;

/** "Rev C" — or "— Preliminary" for a design never snapshotted. */
export function revisionStatus(rows: RevisionRow[]): string {
  return rows.length ? `Rev ${rows[rows.length - 1].letter}` : "— Preliminary";
}

export type TitleBlockData = {
  company: { name: string; addressLines: string[]; phone: string; logoDark: string | null };
  project: { id: string; name: string; customer: string; venue: string; address: string };
  /** null when the design has a single option. */
  optionName: string | null;
  quoteId: string | null;
  /** Newest first, at most REV_ROWS. */
  revisions: RevisionRow[];
  /** How many older rows didn't fit. */
  earlierRevisions: number;
  /** "Rev C" | "— Preliminary". */
  status: string;
  /** #369 — "PRELIMINARY — NOT FOR CONSTRUCTION" on curtain cut sheets; absent everywhere else. */
  stamp?: string;
  drawnBy: string;
  checkedBy: string;
  scale: string;
  /** Print date (epoch ms). */
  date: number;
  sheet: { number: string; title: string; index: number; total: number };
};

export type TitleBlockInput = {
  company: {
    name: string;
    logoDark?: string | null;
    offices?: Array<{ street?: string; city?: string; state?: string; zip?: string; phone?: string; quoteDefault?: boolean }>;
  };
  project: {
    id: string;
    name: string;
    customer: string;
    siteName?: string;
    intake?: { venueName?: string; address?: string } | null;
    createdBy: string;
  };
  option: { name: string; quoteId: string | null };
  optionCount: number;
  /** revisionRows(...) output, oldest first. */
  revisions: RevisionRow[];
  set: { drawnBy?: string; checkedBy?: string } | undefined;
  sheet: { number: string; title: string; scale: string };
  index: number;
  total: number;
  now: number;
};

export function titleBlockData(input: TitleBlockInput): TitleBlockData {
  const offices = input.company.offices || [];
  const office = offices.find((o) => o.quoteDefault) || offices[0];
  const stateZip = office ? [office.state, office.zip].filter((s) => (s || "").trim()).join(" ") : "";
  const cityLine = office ? [office.city || "", stateZip].map((s) => s.trim()).filter(Boolean).join(", ") : "";
  const addressLines = office ? [office.street || "", cityLine].map((s) => s.trim()).filter(Boolean) : [];
  const rows = input.revisions;
  return {
    company: {
      name: input.company.name || "",
      addressLines,
      phone: (office?.phone || "").trim(),
      logoDark: input.company.logoDark || null,
    },
    project: {
      id: input.project.id,
      name: input.project.name,
      customer: input.project.customer || "",
      venue: input.project.siteName || input.project.intake?.venueName || "",
      address: input.project.intake?.address || "",
    },
    optionName: input.optionCount > 1 ? input.option.name : null,
    quoteId: input.option.quoteId,
    revisions: [...rows].reverse().slice(0, REV_ROWS),
    earlierRevisions: Math.max(0, rows.length - REV_ROWS),
    status: revisionStatus(rows),
    drawnBy: input.set?.drawnBy ?? input.project.createdBy ?? "",
    checkedBy: input.set?.checkedBy ?? "",
    scale: input.sheet.scale,
    date: input.now,
    sheet: { number: input.sheet.number, title: input.sheet.title, index: input.index, total: input.total },
  };
}
