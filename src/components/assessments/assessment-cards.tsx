/* Assessments engine (#337, Task 11) — the server cards on the venue, company, lead and project pages. Server
   components over batch reads (one findings read per scope per request, one assessments read per card); the rows are
   plain links, so nothing here imports a client store. The pages pass their own card / head style consts so the
   cards match the page they sit on. */
import { cache, type CSSProperties } from "react";
import Link from "next/link";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/team";
import { ASSESSMENT_DEF } from "@/lib/assessments/defs";
import { listAssessments } from "@/lib/stores/assessments";
import { listFindings } from "@/lib/stores/findings";
import { getPicklistExtras } from "@/lib/stores/assessment-picklists";
import { getVenueProfile } from "@/lib/stores/venue-profiles";
import { getCompany } from "@/lib/identity/companies";
import { getSite, sitesForCompany } from "@/lib/identity/sites";
import { codeInUse } from "@/lib/assessments/findings-model";
import { findingsPdfHref } from "@/lib/assessments/register";
import { assessmentCardRows, chicagoDay, confirmedLine, openRatingCounts, profileFactRows, registerHref, startHref } from "@/lib/assessments/integration";
import { ShortList } from "@/components/short-list";
import ShortCodeEdit from "./short-code-edit";

const CARD: CSSProperties = { background: "#fff", border: "1px solid #ececf0", borderRadius: 12, boxShadow: "0 1px 2px rgba(0,0,0,.04)", marginBottom: 24, overflow: "hidden" };
const HEAD: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, padding: "14px 18px 12px", borderBottom: "1px solid #f0f1f4" };
const CSS = `.as-card-row:hover { background: #fafbff; }`;
const RATING_INK: Record<string, { ink: string; soft: string; bd: string }> = {
  immediate: { ink: "#8a2f22", soft: "#faece9", bd: "#f0cfc8" },
  needs: { ink: "#8a6d1f", soft: "#fbf3dd", bd: "#eddfae" },
  good: { ink: "#2f6b3d", soft: "#e9f5ec", bd: "#cbe6d2" },
};
const STATUS_INK: Record<string, { ink: string; soft: string; bd: string }> = {
  draft: { ink: "#5b616e", soft: "#f1f2f5", bd: "#e4e7ec" },
  onsite: { ink: "#1f5f9a", soft: "#eaf2fb", bd: "#cfe0f3" },
  completed: { ink: "#2f6b3d", soft: "#e9f5ec", bd: "#cbe6d2" },
};
const STATUS_LABEL: Record<string, string> = { draft: "Draft", onsite: "On site", completed: "Completed" };

/** One findings read per scope per request: the Assessments card's open counts and the Findings card share it. */
const findingsFor = cache((scope: "site" | "customer", id: string) => listFindings(scope === "site" ? { siteId: id } : { customerId: id }));

const dateText = (ms: number) => (ms ? new Date(ms).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }) : "—");

interface CardStyles {
  style?: CSSProperties;
  headStyle?: CSSProperties;
}

const Count = ({ n }: { n: number }) => <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "#9aa0ab" }}>{n}</span>;
const StartLink = ({ href }: { href: string }) => (
  <Link href={href} style={{ fontSize: 12, fontWeight: 700, color: "var(--accent)", textDecoration: "none", whiteSpace: "nowrap" }}>
    Start assessment →
  </Link>
);

/** The venue's rolling profile: the confirmed facts, read-only. Renders nothing when there is no profile yet. */
export async function VenueProfileCard({ siteId, style, headStyle }: { siteId: string } & CardStyles) {
  const [profile, extras] = await Promise.all([getVenueProfile(siteId), getPicklistExtras()]);
  const rows = profileFactRows(profile?.facts, ASSESSMENT_DEF, extras);
  if (!rows.length) return null;
  return (
    <div style={{ ...CARD, ...style }}>
      <div style={{ ...HEAD, ...headStyle }}>
        <span style={{ fontSize: 14.5, fontWeight: 600 }}>Venue profile</span>
        <Count n={rows.length} />
      </div>
      <ShortList
        initial={8}
        searchPlaceholder="Search the venue profile…"
        searchText={rows.map((r) => `${r.label} ${r.value}`)}
        items={rows.map((r) => (
          <div key={r.key} style={{ padding: "10px 18px", borderBottom: "1px solid #f5f6f8" }}>
            <div style={{ display: "flex", gap: 12, alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap" }}>
              <span style={{ fontSize: 12.5, color: "#5b616e" }}>{r.label}</span>
              <span style={{ fontSize: 13, fontWeight: 600, textAlign: "right", minWidth: 0, overflowWrap: "anywhere" }}>{r.value}</span>
            </div>
            <div style={{ fontSize: 11, color: "#9aa0ab", marginTop: 2 }}>
              {r.from ? (
                <>
                  confirmed on{" "}
                  <Link href={`/assessments/${encodeURIComponent(r.from)}`} style={{ color: "var(--accent)", textDecoration: "none", fontFamily: "var(--font-mono)" }}>
                    {r.from}
                  </Link>
                  {r.at ? ` · ${chicagoDay(r.at)}` : ""}
                </>
              ) : (
                confirmedLine("", r.at)
              )}
            </div>
          </div>
        ))}
      />
    </div>
  );
}

type AssessmentsCardProps = CardStyles & {
  siteId?: string;
  customerId?: string;
  leadId?: string;
  projectId?: string;
  /** shown in the head instead of "Assessments" */
  title?: string;
  /** a lead / project card with nothing to list is one Start line instead of an empty card */
  compact?: boolean;
};

/** The assessments for a venue, a company, a lead or a project, newest visit first, with Start assessment. */
export async function AssessmentsCard({ siteId, customerId, leadId, projectId, title = "Assessments", compact, style, headStyle }: AssessmentsCardProps) {
  const user = await requireUser();
  const canStart = can("create", user.roles);
  const workScope = !!leadId || !!projectId;
  const [list, findings, siteList] = await Promise.all([
    listAssessments({
      ...(siteId ? { siteId } : {}),
      ...(!siteId && !workScope && customerId ? { customerId } : {}),
      ...(leadId ? { leadId } : {}),
      ...(projectId ? { projectId } : {}),
    }),
    siteId ? findingsFor("site", siteId) : !workScope && customerId ? findingsFor("customer", customerId) : Promise.resolve([]),
    !siteId && !workScope && customerId ? sitesForCompany(customerId) : Promise.resolve([]),
  ]);
  const openCounts = new Map<string, number>();
  for (const f of findings) if (f.status !== "closed") openCounts.set(f.assessmentId, (openCounts.get(f.assessmentId) ?? 0) + 1);
  const siteNames = new Map(siteList.map((s) => [s.id, s.name || s.locationName || s.id]));
  const rows = assessmentCardRows(list, { showVenue: !siteId, siteNames, openCounts });
  const start = startHref({ siteId, customerId, leadId, projectId });
  const byId = new Map(list.map((a) => [a.id, a]));

  if (compact && rows.length === 0) {
    if (!canStart) return null;
    return (
      <div style={{ marginTop: 18, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: "#9aa0ab", letterSpacing: ".05em", textTransform: "uppercase" }}>{title}</span>
        <StartLink href={start} />
      </div>
    );
  }
  return (
    <div style={{ ...CARD, ...(compact ? { marginTop: 18, marginBottom: 0 } : {}), ...style }}>
      <style>{CSS}</style>
      <div style={{ ...HEAD, ...headStyle }}>
        <span style={{ fontSize: 14.5, fontWeight: 600 }}>{title}</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 12 }}>
          <Count n={rows.length} />
          {canStart && <StartLink href={start} />}
        </span>
      </div>
      {rows.length > 0 ? (
        <ShortList
          initial={5}
          searchPlaceholder="Search assessments…"
          searchText={rows.map((r) => r.search)}
          items={rows.map((r) => {
            const st = STATUS_INK[r.status] ?? STATUS_INK.draft;
            return (
              <Link key={r.id} href={r.href} className="as-card-row" style={{ display: "block", padding: "11px 18px", borderBottom: "1px solid #f5f6f8", textDecoration: "none", color: "inherit" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 600, color: "var(--accent)", flex: 1, minWidth: 0 }}>{r.id}</span>
                  <span style={{ fontSize: 11, color: "#8c919c", flexShrink: 0 }}>{dateText(byId.get(r.id)?.visitDate ?? 0)}</span>
                  <span style={{ fontSize: 10, fontWeight: 600, color: st.ink, background: st.soft, border: `1px solid ${st.bd}`, padding: "2px 9px", borderRadius: 20, whiteSpace: "nowrap", flexShrink: 0 }}>
                    {STATUS_LABEL[r.status] ?? r.status}
                  </span>
                </span>
                {r.sub && <span style={{ display: "block", fontSize: 12, color: "#5b616e", marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.sub}</span>}
              </Link>
            );
          })}
        />
      ) : (
        <div style={{ padding: "26px 18px", textAlign: "center", color: "#9aa0ab", fontSize: 12.5 }}>No assessments yet.</div>
      )}
    </div>
  );
}

/** Open findings by rating (chips into the filtered register), the findings PDF, and the short code for printed ids. */
export async function FindingsCard({ siteId, customerId, style, headStyle }: { siteId?: string; customerId: string } & CardStyles) {
  const user = await requireUser();
  const canEdit = can("create", user.roles);
  const canApprove = can("approve", user.roles);
  const [findings, company, site] = await Promise.all([
    siteId ? findingsFor("site", siteId) : findingsFor("customer", customerId),
    siteId ? Promise.resolve(null) : getCompany(customerId),
    siteId ? getSite(siteId) : Promise.resolve(null),
  ]);
  const { counts, total } = openRatingCounts(findings);
  const scope = siteId ? { siteId } : { customerId };
  const code = siteId ? (site?.shortCode ?? null) : (company?.shortCode ?? null);
  const locked = codeInUse(findings, code, siteId ? "site" : "company");
  return (
    <div style={{ ...CARD, ...style }}>
      <div style={{ ...HEAD, ...headStyle }}>
        <span style={{ fontSize: 14.5, fontWeight: 600 }}>Findings</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 12 }}>
          <Count n={total} />
          <Link href={registerHref(scope)} style={{ fontSize: 12, fontWeight: 700, color: "var(--accent)", textDecoration: "none", whiteSpace: "nowrap" }}>
            Register →
          </Link>
        </span>
      </div>
      <div style={{ padding: "14px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
        {total > 0 ? (
          <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
            {counts.map((c) => {
              const t = RATING_INK[c.rating];
              return (
                <Link
                  key={c.rating}
                  href={registerHref(scope, c.rating)}
                  title={`${c.label}: show in the register`}
                  style={{ fontSize: 11.5, fontWeight: 600, color: c.n ? t.ink : "#9aa0ab", background: c.n ? t.soft : "#f6f7f9", border: `1px solid ${c.n ? t.bd : "#e4e7ec"}`, borderRadius: 20, padding: "4px 11px", textDecoration: "none", whiteSpace: "nowrap" }}
                >
                  {c.label} <span style={{ fontFamily: "var(--font-mono)", fontWeight: 400 }}>{c.n}</span>
                </Link>
              );
            })}
          </div>
        ) : (
          <div style={{ fontSize: 12.5, color: "#9aa0ab" }}>No open findings.</div>
        )}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <ShortCodeEdit
            kind={siteId ? "site" : "company"}
            companyId={siteId ? (site?.companyId ?? customerId) : customerId}
            siteId={siteId}
            code={code}
            locked={locked}
            canEdit={canEdit && (siteId ? !!site : !!company)}
            canApprove={canApprove}
          />
          {total > 0 && (
            <a href={findingsPdfHref(siteId ? `site:${siteId}` : `company:${customerId}`)} target="_blank" rel="noreferrer" style={{ fontSize: 12, fontWeight: 700, color: "var(--accent)", textDecoration: "none", whiteSpace: "nowrap" }}>
              Findings PDF
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
