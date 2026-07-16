import Link from "next/link";
import { requireUser } from "@/lib/session";
import { activeUsers } from "@/lib/users";
import {
  get,
  iso,
  msOf,
  fmtShort,
  fmtLong,
  stageMeta,
  categoryMeta,
  priorityMeta,
  warrantyExpiryOf,
  warrantyMonthsOf,
  DEFAULT_WARRANTY_MONTHS,
} from "@/lib/stores/repair-jobs";
import { ResultsForm } from "./controls";

export const metadata = { title: "Repair results — Peak Backend" };

const MONTH_MS = 30 * 86400000;

function one(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] ?? "" : v ?? "";
}

export default async function RepairResultsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [, sp, users] = await Promise.all([requireUser(), searchParams, activeUsers()]);
  const jobId = one(sp.job);
  const saved = one(sp.saved) === "1";
  const job = jobId ? await get(jobId) : null;

  if (!job) {
    return (
      <div className="pk-content">
        <Link
          href="/repairs/scheduling"
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
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Repair not found</div>
          <div style={{ fontSize: 13, color: "#8c919c", lineHeight: 1.6 }}>
            Open a scheduled repair from the scheduler to log its results.
          </div>
          <Link
            href="/repairs/scheduling"
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
  const cat = categoryMeta(job.category);
  const pm = priorityMeta(job.priority);
  const isCompleted = job.stage === "completed";
  const completion = job.completion;

  const performedDate = job.completedAt
    ? iso(job.completedAt)
    : job.scheduledDate || iso(Date.now());
  const performedBy = completion?.performedBy || job.assignedTo || "";
  const warrantyMonths = warrantyMonthsOf(job);
  const partsPrefill =
    completion && completion.partsUsed.length
      ? completion.partsUsed.join("\n")
      : (job.parts || []).map((p) => (p.qty ? p.qty + "× " : "") + p.name).join("\n");

  const expiry = warrantyExpiryOf(job);
  const previewExpiry = (msOf(performedDate) ?? Date.now()) + warrantyMonths * MONTH_MS;

  return (
    <div className="pk-content" style={{ maxWidth: 820 }}>
      <Link
        href="/repairs/scheduling"
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

      {/* header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
        <div style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-.015em" }}>Repair results</div>
        <span
          style={{
            display: "inline-block",
            fontSize: 9.5,
            fontWeight: 700,
            letterSpacing: ".04em",
            textTransform: "uppercase",
            color: sm.ink,
            background: sm.soft,
            border: `1px solid ${sm.bd}`,
            padding: "2px 8px",
            borderRadius: 5,
          }}
        >
          {sm.label}
        </span>
      </div>
      <div style={{ fontSize: 13.5, color: "#8c919c", marginBottom: 18 }}>
        {isCompleted
          ? "Update the logged results for this repair."
          : "Record the work performed on site. Saving completes the repair and starts its warranty window."}
      </div>

      {/* summary card */}
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
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <span style={{ fontSize: 16, fontWeight: 600, lineHeight: 1.2 }}>
              {job.customer || "Customer"}
            </span>
            <span
              style={{
                display: "inline-block",
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: ".04em",
                textTransform: "uppercase",
                color: "#fff",
                background: pm.bar,
                padding: "2px 7px",
                borderRadius: 4,
              }}
            >
              {pm.label}
            </span>
          </div>
          <div style={{ fontSize: 12.5, color: "#aab0bb", marginTop: 3 }}>
            {(job.venue ? job.venue + " · " : "") + cat.label}
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
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 13.5, fontWeight: 600, marginTop: 3 }}>
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

      {/* documents (persistent for any completed repair) */}
      {isCompleted && (
        <div style={{ display: "flex", gap: 9, flexWrap: "wrap", marginBottom: 16 }}>
          {[
            { href: "/repairs/completion-letter?job=" + encodeURIComponent(job.id), label: "Completion letter →" },
            { href: "/repairs/warranty-record?job=" + encodeURIComponent(job.id), label: "Warranty record →" },
            { href: "/repairs/report?job=" + encodeURIComponent(job.id), label: "Service report →" },
          ].map((d) => (
            <Link
              key={d.href}
              href={d.href}
              style={{
                fontSize: 12.5,
                fontWeight: 600,
                color: "var(--accent)",
                background: "#fff",
                border: "1px solid #e4e7ec",
                borderRadius: 9,
                padding: "9px 14px",
                textDecoration: "none",
              }}
            >
              {d.label}
            </Link>
          ))}
        </div>
      )}

      {/* saved banner */}
      {saved && isCompleted && (
        <div
          style={{
            marginBottom: 16,
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
              Results logged · warranty covers through {expiry ? fmtLong(expiry) : "—"}
            </div>
            <div style={{ fontSize: 11.5, color: "#3f8a63", marginTop: 2 }}>
              This repair is complete and on the warranty follow-up clock.
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 9, flexShrink: 0, flexWrap: "wrap" }}>
            <Link
              href={"/repairs/completion-letter?job=" + encodeURIComponent(job.id)}
              style={{
                fontSize: 12.5,
                fontWeight: 600,
                color: "#1f7a52",
                background: "#fff",
                border: "1px solid #cce9da",
                borderRadius: 9,
                padding: "9px 14px",
                textDecoration: "none",
              }}
            >
              Completion letter →
            </Link>
            <Link
              href={"/repairs/warranty-record?job=" + encodeURIComponent(job.id)}
              style={{
                fontSize: 12.5,
                fontWeight: 600,
                color: "#1f7a52",
                background: "#fff",
                border: "1px solid #cce9da",
                borderRadius: 9,
                padding: "9px 14px",
                textDecoration: "none",
              }}
            >
              Warranty record →
            </Link>
            <Link
              href={"/repairs/report?job=" + encodeURIComponent(job.id)}
              style={{
                fontSize: 12.5,
                fontWeight: 600,
                color: "#1f7a52",
                background: "#fff",
                border: "1px solid #cce9da",
                borderRadius: 9,
                padding: "9px 14px",
                textDecoration: "none",
              }}
            >
              View service report →
            </Link>
            <Link
              href="/repairs"
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
              Back to dashboard →
            </Link>
          </div>
        </div>
      )}

      {/* form */}
      <ResultsForm
        record={job}
        users={users.map((u) => ({ id: u.id, name: u.name }))}
        items={job.items}
        parts={job.parts}
        performedDate={performedDate}
        performedBy={performedBy}
        warrantyMonths={warrantyMonths}
        defaultWarrantyMonths={DEFAULT_WARRANTY_MONTHS}
        partsPrefill={partsPrefill}
        workPerformedDefault={completion?.workPerformed || job.scope || ""}
        followUpDefault={completion?.followUp || ""}
        previewExpiryLabel={fmtLong(previewExpiry)}
        isCompleted={isCompleted}
      />
    </div>
  );
}
