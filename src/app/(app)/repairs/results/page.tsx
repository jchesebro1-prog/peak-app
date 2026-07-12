import Link from "next/link";
import { requireUser } from "@/lib/session";
import { activeUsers } from "@/lib/users";
import {
  get,
  iso,
  msOf,
  money,
  fmtShort,
  fmtLong,
  stageMeta,
  categoryMeta,
  priorityMeta,
  warrantyExpiryOf,
  warrantyMonthsOf,
  DEFAULT_WARRANTY_MONTHS,
} from "@/lib/stores/repair-jobs";
import { completeRepair, reopenRepair } from "../actions";

export const metadata = { title: "Repair results — Peak Backend" };

const MONTH_MS = 30 * 86400000;

function one(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] ?? "" : v ?? "";
}

const LABEL: React.CSSProperties = {
  display: "block",
  fontSize: 11,
  fontWeight: 600,
  color: "#9aa0ab",
  letterSpacing: ".05em",
  textTransform: "uppercase",
  marginBottom: 7,
};

const INPUT: React.CSSProperties = {
  width: "100%",
  fontSize: 13.5,
  color: "#16181d",
  background: "#fff",
  border: "1px solid #e4e7ec",
  borderRadius: 9,
  padding: "10px 12px",
  outline: "none",
};

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
              flexShrink: 0,
            }}
          >
            Back to dashboard →
          </Link>
        </div>
      )}

      {/* form */}
      <form action={completeRepair}>
        <input type="hidden" name="id" value={job.id} />
        <div
          style={{
            background: "#fff",
            border: "1px solid #ececf0",
            borderRadius: 13,
            boxShadow: "0 1px 2px rgba(0,0,0,.04)",
            padding: 20,
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              gap: 14,
              marginBottom: 20,
            }}
          >
            <div>
              <label style={LABEL}>Date performed</label>
              <input
                type="date"
                name="completedDate"
                defaultValue={performedDate}
                required
                style={{ ...INPUT, fontFamily: "var(--font-mono)" }}
              />
            </div>
            <div>
              <label style={LABEL}>Performed by</label>
              <select
                name="performedBy"
                defaultValue={performedBy}
                style={{ ...INPUT, cursor: "pointer", paddingRight: 34 }}
              >
                <option value="">Select technician…</option>
                {users.map((u) => (
                  <option key={u.id} value={u.name}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={LABEL}>Warranty (months)</label>
              <input
                type="number"
                min={0}
                name="warrantyMonths"
                defaultValue={warrantyMonths || DEFAULT_WARRANTY_MONTHS}
                style={{ ...INPUT, fontFamily: "var(--font-mono)" }}
              />
            </div>
          </div>

          {/* scope reference */}
          {(job.items?.length ?? 0) > 0 && (
            <div style={{ marginBottom: 20 }}>
              <div style={LABEL}>Scope of work</div>
              <div style={{ border: "1px solid #f0f1f4", borderRadius: 9, overflow: "hidden" }}>
                {job.items.map((it, i) => (
                  <div
                    key={i}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "minmax(0,1fr) 56px",
                      gap: 10,
                      alignItems: "center",
                      padding: "9px 12px",
                      borderTop: i === 0 ? "none" : "1px solid #f3f4f7",
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{it.label}</div>
                      {it.note && (
                        <div style={{ fontSize: 11, color: "#9aa0ab", marginTop: 1 }}>{it.note}</div>
                      )}
                    </div>
                    <div
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 12.5,
                        color: "#5b616e",
                        textAlign: "right",
                      }}
                    >
                      ×{it.qty}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{ marginBottom: 16 }}>
            <label style={LABEL}>Work performed</label>
            <textarea
              name="workPerformed"
              rows={3}
              defaultValue={completion?.workPerformed || job.scope || ""}
              placeholder="What was done on site, method, and any parts replaced…"
              style={{ ...INPUT, lineHeight: 1.5, resize: "vertical" }}
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 16 }}>
            <div>
              <label style={LABEL}>Parts used (one per line)</label>
              <textarea
                name="partsUsed"
                rows={4}
                defaultValue={partsPrefill}
                placeholder={"e.g.\n2× Wire rope clip\n1× Lift line 3/16″"}
                style={{ ...INPUT, fontFamily: "var(--font-mono)", lineHeight: 1.5, resize: "vertical" }}
              />
              {(job.parts?.length ?? 0) > 0 && (
                <div style={{ fontSize: 11, color: "#9aa0ab", marginTop: 6, lineHeight: 1.5 }}>
                  Quoted parts:{" "}
                  {job.parts
                    .map((p) => (p.qty ? p.qty + "× " : "") + p.name + " (" + money(p.cost) + ")")
                    .join(", ")}
                </div>
              )}
            </div>
            <div>
              <label style={LABEL}>Follow-up needed</label>
              <textarea
                name="followUp"
                rows={4}
                defaultValue={completion?.followUp || ""}
                placeholder="Any re-visit, re-quote, or monitoring the office should track…"
                style={{ ...INPUT, lineHeight: 1.5, resize: "vertical" }}
              />
            </div>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              marginTop: 20,
              paddingTop: 18,
              borderTop: "1px solid #f0f1f4",
            }}
          >
            <div style={{ fontSize: 11.5, color: "#9aa0ab", lineHeight: 1.5, flex: 1 }}>
              On save, this repair is marked complete and its {warrantyMonths}-month warranty runs
              through {fmtLong(previewExpiry)}.
            </div>
            {isCompleted && (
              <button
                type="submit"
                formAction={reopenRepair}
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: 13,
                  fontWeight: 600,
                  color: "#b4543a",
                  background: "#fff",
                  border: "1px solid #f0d6cd",
                  borderRadius: 10,
                  padding: "11px 16px",
                  cursor: "pointer",
                }}
              >
                Reopen
              </button>
            )}
            <button
              type="submit"
              style={{
                fontFamily: "var(--font-ui)",
                fontSize: 13.5,
                fontWeight: 600,
                color: "#fff",
                border: "none",
                borderRadius: 10,
                padding: "12px 20px",
                cursor: "pointer",
                background: "var(--accent)",
                flexShrink: 0,
              }}
            >
              {isCompleted ? "Update results" : "Complete & log results"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
