import Link from "next/link";
import { redirect } from "next/navigation";
import { getAll, create, timeAgo, STAGE_LABEL } from "@/lib/stores/quotes";
import { requireUser } from "@/lib/session";
import { money } from "@/lib/format";
import { StatusPill, QUOTE_STATUS_TONE } from "@/components/ui";
import type { SessionUser } from "@/lib/session";

async function startFreshAction() {
  "use server";
  const user = await requireUser();
  const q = await create({ name: "New Estimate", owner: user.name });
  redirect(`/estimator?id=${q.id}`);
}

export default async function EstimatorDashboard({ user }: { user: SessionUser }) {
  const quotes = await getAll(); // already sorted by updatedAt desc

  /* ---- KPI computations ---- */
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const monthStartMs = monthStart.getTime();

  const drafts = quotes.filter((q) => q.status === "draft").length;
  const inReview = quotes.filter((q) => q.review?.state === "in_review").length;
  const sent = quotes.filter((q) => q.status === "sent").length;
  const wonThisMonth = quotes.filter(
    (q) => q.status === "won" && (q.updatedAt || 0) >= monthStartMs
  ).length;
  const pipeline = quotes
    .filter((q) => q.status !== "lost")
    .reduce((a, q) => a + (q.value || 0), 0);

  const recent = quotes.slice(0, 15);

  const kpis = [
    { label: "Drafts", value: String(drafts) },
    { label: "In Review", value: String(inReview) },
    { label: "Sent", value: String(sent) },
    { label: "Won This Month", value: String(wonThisMonth) },
    { label: "Pipeline Value", value: money(pipeline) },
  ];

  return (
    <div className="pk-content" style={{ padding: "24px 28px", maxWidth: 980 }}>
      <style>{`
        .ed-rowlink:hover { background: #fafbff; }
        .ed-open:hover { opacity: 0.8; }
        @media (max-width: 700px) {
          .ed-kpis { grid-template-columns: repeat(2, 1fr) !important; }
          .ed-cust, .ed-updated { display: none !important; }
        }
      `}</style>

      {/* page heading */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
          rowGap: 14,
          marginBottom: 22,
        }}
      >
        <div>
          <div style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-.015em" }}>
            Estimator
          </div>
          <div style={{ fontSize: 13.5, color: "#8c919c", marginTop: 5 }}>
            {"Welcome back, " + (user.name.split(" ")[0] || user.name)}
          </div>
        </div>
        <form action={startFreshAction}>
          <button
            type="submit"
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: 13,
              fontWeight: 600,
              color: "#fff",
              background: "var(--accent)",
              border: "none",
              borderRadius: 9,
              padding: "10px 18px",
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            + Start fresh estimate
          </button>
        </form>
      </div>

      {/* KPI row */}
      <div
        className="ed-kpis"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(5, 1fr)",
          gap: 14,
          marginBottom: 24,
        }}
      >
        {kpis.map((k) => (
          <div
            key={k.label}
            style={{
              background: "#fff",
              border: "1px solid #ececf0",
              borderRadius: 12,
              padding: "16px 17px",
              boxShadow: "0 1px 2px rgba(0,0,0,.04)",
            }}
          >
            <div
              style={{
                fontSize: 10.5,
                fontWeight: 600,
                color: "#9aa0ab",
                letterSpacing: ".05em",
                textTransform: "uppercase",
              }}
            >
              {k.label}
            </div>
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 24,
                fontWeight: 600,
                letterSpacing: "-.01em",
                marginTop: 10,
              }}
            >
              {k.value}
            </div>
          </div>
        ))}
      </div>

      {/* recent quotes table */}
      <div
        style={{
          background: "#fff",
          border: "1px solid #ececf0",
          borderRadius: 13,
          boxShadow: "0 1px 2px rgba(0,0,0,.04)",
          overflow: "hidden",
          marginBottom: 14,
        }}
      >
        {/* table header */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0,1fr) 200px 120px 80px 56px",
            gap: 12,
            padding: "11px 18px",
            fontSize: 10,
            fontWeight: 600,
            color: "#aab0bb",
            textTransform: "uppercase",
            letterSpacing: ".05em",
            borderBottom: "1px solid #f0f1f4",
            background: "#fbfbfc",
          }}
        >
          <span>Quote</span>
          <span className="ed-cust">Customer</span>
          <span style={{ textAlign: "right" }}>Value</span>
          <span style={{ textAlign: "center" }}>Status</span>
          <span className="ed-updated" style={{ textAlign: "right" }}>
            Updated
          </span>
        </div>

        {recent.length === 0 && (
          <div
            style={{
              padding: "44px 18px",
              textAlign: "center",
              color: "#9aa0ab",
              fontSize: 13,
            }}
          >
            No quotes yet.{" "}
            <form action={startFreshAction} style={{ display: "inline" }}>
              <button
                type="submit"
                style={{
                  fontFamily: "var(--font-ui)",
                  color: "var(--accent)",
                  fontWeight: 600,
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  fontSize: 13,
                  padding: 0,
                }}
              >
                Start your first estimate →
              </button>
            </form>
          </div>
        )}

        {recent.map((q, i) => (
          <div
            key={q.id}
            className="ed-rowlink"
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0,1fr) 200px 120px 80px 56px",
              gap: 12,
              padding: "13px 18px",
              alignItems: "center",
              borderBottom: i < recent.length - 1 ? "1px solid #f5f6f8" : undefined,
              color: "#16181d",
            }}
          >
            {/* Quote ID + name */}
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontSize: 13.5,
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {q.name}
              </div>
              <div
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 10.5,
                  color: "#aab0bb",
                  marginTop: 3,
                }}
              >
                {q.id}
              </div>
            </div>

            {/* Customer */}
            <div
              className="ed-cust"
              style={{
                fontSize: 12.5,
                color: "#5b616e",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {q.customer || "—"}
            </div>

            {/* Value */}
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 13,
                fontWeight: 600,
                textAlign: "right",
              }}
            >
              {money(q.value || 0)}
            </div>

            {/* Status */}
            <div style={{ display: "flex", justifyContent: "center" }}>
              <StatusPill tone={QUOTE_STATUS_TONE[q.status] || "gray"} minWidth={60}>
                {STAGE_LABEL[q.status] || q.status}
              </StatusPill>
            </div>

            {/* Updated + Open link */}
            <div
              className="ed-updated"
              style={{ display: "flex", justifyContent: "flex-end" }}
            >
              <Link
                href={`/estimator?id=${encodeURIComponent(q.id)}`}
                className="ed-open"
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: "var(--accent)",
                  textDecoration: "none",
                  whiteSpace: "nowrap",
                }}
                title={timeAgo(q.updatedAt)}
              >
                Open →
              </Link>
            </div>
          </div>
        ))}
      </div>

      {/* footer link */}
      <div style={{ textAlign: "right" }}>
        <Link
          href="/quotes"
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "var(--accent)",
            textDecoration: "none",
          }}
        >
          All Quotes →
        </Link>
      </div>
    </div>
  );
}
