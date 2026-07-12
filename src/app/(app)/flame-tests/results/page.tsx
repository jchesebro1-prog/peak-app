import Link from "next/link";
import { requireUser } from "@/lib/session";
import { get, stageMeta, iso, msOf, fmtShort, fmtLong } from "@/lib/stores/flame-jobs";
import { activeUsers } from "@/lib/users";
import { ResultsEditor, type VenueInit } from "./controls";

export const metadata = { title: "Flame test results — Peak Backend" };

const YEAR = 365 * 86400000;

function one(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] ?? "" : v ?? "";
}

const CSS = `
  @media (max-width: 720px) { .ftr-3 { grid-template-columns: 1fr !important; } }
`;

export default async function FlameResultsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [, sp, roster] = await Promise.all([requireUser(), searchParams, activeUsers()]);
  const id = one(sp.job);
  const saved = one(sp.saved) === "1";
  const job = id ? await get(id) : null;

  const backLink = (
    <Link
      href="/flame-tests/scheduling"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontSize: 12.5,
        fontWeight: 600,
        color: "#8c919c",
        textDecoration: "none",
        marginBottom: 14,
      }}
    >
      ← Scheduler
    </Link>
  );

  if (!job) {
    return (
      <div className="pk-content" style={{ maxWidth: 820 }}>
        {backLink}
        <div
          style={{
            maxWidth: 520,
            margin: "50px auto",
            padding: 32,
            textAlign: "center",
            background: "#fff",
            border: "1px solid #ececf0",
            borderRadius: 14,
          }}
        >
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
            Flame test not found
          </div>
          <div style={{ fontSize: 13, color: "#8c919c", lineHeight: 1.6 }}>
            Open a scheduled flame test from the scheduler to log its results.
          </div>
          <Link
            href="/flame-tests/scheduling"
            style={{
              display: "inline-block",
              marginTop: 16,
              fontSize: 13,
              fontWeight: 600,
              color: "var(--accent)",
              textDecoration: "none",
            }}
          >
            Go to scheduler →
          </Link>
        </div>
      </div>
    );
  }

  const sm = stageMeta(job.stage);
  const r = job.results;
  const rvById = new Map((r?.venues || []).map((v) => [v.id, v]));
  const venues: VenueInit[] = (job.venues || []).map((v) => {
    const rv = rvById.get(v.id);
    return {
      id: v.id,
      label: v.label || "Venue",
      place: [v.city, v.state].filter(Boolean).join(", "),
      tested: String(rv ? rv.tested : v.curtains || 0),
      passed: String(rv ? rv.passed : v.curtains || 0),
      retreated: String(rv ? rv.retreated || 0 : 0),
    };
  });

  const performedDate = job.completedAt
    ? iso(job.completedAt)
    : job.scheduledDate || iso(Date.now());
  const renewMs = msOf(performedDate);
  const renewNoteDate = renewMs != null ? fmtLong(renewMs + YEAR) : "—";
  const reportHref = "/flame-tests/report?job=" + encodeURIComponent(job.id);
  const renewDate = job.completedAt ? fmtLong(job.completedAt + YEAR) : renewNoteDate;

  return (
    <div className="pk-content" style={{ maxWidth: 820 }}>
      <style>{CSS}</style>
      {backLink}

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
        <div style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-.015em" }}>
          Flame test results
        </div>
        <span
          style={{
            display: "inline-block",
            fontSize: 9.5,
            fontWeight: 700,
            letterSpacing: ".04em",
            textTransform: "uppercase",
            color: sm.ink,
            background: sm.soft,
            border: "1px solid " + sm.bd,
            padding: "2px 8px",
            borderRadius: 5,
          }}
        >
          {job.stage === "completed" ? "Completed" : "Scheduled"}
        </span>
        {job.stage === "completed" && (
          <Link
            href={reportHref}
            style={{
              marginLeft: "auto",
              fontSize: 12.5,
              fontWeight: 600,
              color: "var(--accent)",
              textDecoration: "none",
            }}
          >
            View report →
          </Link>
        )}
      </div>
      <div style={{ fontSize: 13.5, color: "#8c919c", marginBottom: 18 }}>
        {job.stage === "completed"
          ? "Update the logged results for this annual flame test."
          : "Record what was tested on site. Saving completes the job and schedules next year’s renewal."}
      </div>

      {/* dark summary card */}
      <div
        style={{
          background: "#16181d",
          color: "#fff",
          borderRadius: 13,
          padding: "16px 20px",
          marginBottom: 16,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 600, lineHeight: 1.2 }}>
            {job.customer || "Customer"}
          </div>
          <div style={{ fontSize: 12.5, color: "#aab0bb", marginTop: 3 }}>
            {(job.venue || "") + " · " + (job.curtainsTotal || 0) + " curtains"}
          </div>
        </div>
        <div style={{ display: "flex", gap: 22 }}>
          <div>
            <div
              style={{
                fontSize: 10,
                fontWeight: 600,
                color: "#9aa0ab",
                letterSpacing: ".05em",
                textTransform: "uppercase",
              }}
            >
              Scheduled
            </div>
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 13.5,
                fontWeight: 600,
                marginTop: 3,
              }}
            >
              {job.scheduledDate ? fmtShort(msOf(job.scheduledDate)) : "—"}
            </div>
          </div>
          <div>
            <div
              style={{
                fontSize: 10,
                fontWeight: 600,
                color: "#9aa0ab",
                letterSpacing: ".05em",
                textTransform: "uppercase",
              }}
            >
              Assigned
            </div>
            <div style={{ fontSize: 13.5, fontWeight: 600, marginTop: 3 }}>
              {job.assignedTo || "Unassigned"}
            </div>
          </div>
        </div>
      </div>

      {/* form */}
      <div
        style={{
          background: "#fff",
          border: "1px solid #ececf0",
          borderRadius: 13,
          boxShadow: "0 1px 2px rgba(0,0,0,.04)",
          padding: 20,
        }}
      >
        <ResultsEditor
          record={job}
          jobId={job.id}
          stage={job.stage}
          venues={venues}
          performedDate={performedDate}
          performedBy={r?.performedBy || job.assignedTo || ""}
          cert={r?.cert || ""}
          overall={r?.overall || "pass"}
          overallTouched={!!r?.overall}
          notes={r?.notes || ""}
          techOptions={roster.map((u) => u.name)}
          renewNoteDate={renewNoteDate}
        />

        {saved && job.stage === "completed" && (
          <div
            style={{
              marginTop: 14,
              padding: "14px 16px",
              background: "#eaf6ef",
              border: "1px solid #cce9da",
              borderRadius: 10,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 14,
              flexWrap: "wrap",
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#1f7a52" }}>
                Results logged · renews {renewDate}
              </div>
              <div style={{ fontSize: 11.5, color: "#3f8a63", marginTop: 2 }}>
                Open the results report to print or share it.
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 9, flexShrink: 0 }}>
              <Link
                href="/flame-tests"
                style={{
                  fontSize: 12.5,
                  fontWeight: 600,
                  color: "#1f7a52",
                  textDecoration: "none",
                  padding: "8px 12px",
                  border: "1px solid #cce9da",
                  borderRadius: 9,
                  background: "#fff",
                }}
              >
                Dashboard
              </Link>
              <Link
                href={reportHref}
                style={{
                  fontSize: 12.5,
                  fontWeight: 600,
                  color: "#fff",
                  background: "#1f7a52",
                  borderRadius: 9,
                  padding: "9px 14px",
                  textDecoration: "none",
                }}
              >
                View / Print report →
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
