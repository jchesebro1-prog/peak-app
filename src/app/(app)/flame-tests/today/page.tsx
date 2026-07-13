import Link from "next/link";
import { requireUser } from "@/lib/session";
import {
  getAll,
  msOf,
  fmtShort,
  fmtLong,
  money,
  type FlameJob,
} from "@/lib/stores/flame-jobs";
import { activeUsers } from "@/lib/users";
import { deriveInitials, fallbackColor } from "@/lib/team";

export const metadata = { title: "Today's flame tests — Peak Backend" };

/**
 * Day-of LOG RESULTS quick-start (IDEAS #34) — Jeff's ask: a dashboard
 * "Log results" button that opens "a view of only the tests that are
 * scheduled for that day to quickly get started." This is that view: every
 * scheduled visit due today (plus any overdue visit that still needs its
 * results logged), one green Log-results button per row, with the next
 * upcoming visits underneath so the sheet is never a dead end.
 */

const DAY = 86400000;

function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export default async function FlameTodayPage() {
  const [, jobs, roster] = await Promise.all([requireUser(), getAll(), activeUsers()]);

  const identity = new Map(roster.map((u) => [u.name, { color: u.color, initials: u.initials }]));
  const initialsOf = (n: string) => identity.get(n)?.initials || deriveInitials(n || "");
  const colorOf = (n: string) => identity.get(n)?.color || fallbackColor(n || "");

  const today = startOfToday();
  const tomorrow = today + DAY;

  const scheduled = jobs
    .filter((j) => j.stage === "scheduled" && msOf(j.scheduledDate) != null)
    .sort((a, b) => (msOf(a.scheduledDate) || 0) - (msOf(b.scheduledDate) || 0));

  /** Due now: scheduled for today, or scheduled in the past and never logged. */
  const dueNow = scheduled.filter((j) => (msOf(j.scheduledDate) || 0) < tomorrow);
  const upcoming = scheduled
    .filter((j) => (msOf(j.scheduledDate) || 0) >= tomorrow)
    .slice(0, 5);

  const dayChip = (j: FlameJob) => {
    const ms = msOf(j.scheduledDate) || 0;
    if (ms >= today) return { label: "Today", ink: "#1f7a52", soft: "#eaf6ef", bd: "#cce9da" };
    const days = Math.round((today - ms) / DAY);
    return {
      label: days + "d overdue",
      ink: "#b4543a",
      soft: "#f7e9e5",
      bd: "#f0d6cd",
    };
  };

  const Row = ({ j, due }: { j: FlameJob; due: boolean }) => {
    const chip = dayChip(j);
    return (
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0,1fr) auto",
          gap: 12,
          alignItems: "center",
          padding: "14px 20px",
          borderBottom: "1px solid #f5f6f8",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <span
              style={{
                fontSize: 14,
                fontWeight: 600,
                lineHeight: 1.25,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {j.customer || "Customer"}
            </span>
            {due ? (
              <span
                style={{
                  display: "inline-block",
                  fontSize: 9.5,
                  fontWeight: 700,
                  letterSpacing: ".04em",
                  textTransform: "uppercase",
                  color: chip.ink,
                  background: chip.soft,
                  border: `1px solid ${chip.bd}`,
                  padding: "2px 8px",
                  borderRadius: 5,
                  flexShrink: 0,
                }}
              >
                {chip.label}
              </span>
            ) : (
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  color: "#9aa0ab",
                  flexShrink: 0,
                }}
              >
                {fmtShort(msOf(j.scheduledDate))}
              </span>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 5 }}>
            <span
              style={{
                width: 20,
                height: 20,
                borderRadius: "50%",
                background: j.assignedTo ? colorOf(j.assignedTo) : "#8c919c",
                color: "#fff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 9,
                fontWeight: 600,
                flexShrink: 0,
              }}
            >
              {j.assignedTo ? initialsOf(j.assignedTo) : "?"}
            </span>
            <span
              style={{
                fontSize: 11.5,
                color: "#9aa0ab",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {(j.assignedTo || "Unassigned") +
                " · " +
                (j.venue || "Venue") +
                (j.curtainsTotal ? " · " + j.curtainsTotal + " curtains" : "") +
                " · " +
                money(j.value)}
            </span>
          </div>
        </div>
        <Link
          href={"/flame-tests/results?job=" + encodeURIComponent(j.id)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            fontSize: 12.5,
            fontWeight: 600,
            color: "#fff",
            background: due ? "#1f7a52" : "#8c919c",
            borderRadius: 9,
            padding: "10px 15px",
            textDecoration: "none",
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
        >
          Log results
        </Link>
      </div>
    );
  };

  return (
    <div className="pk-content" style={{ maxWidth: 780 }}>
      <Link
        href="/flame-tests"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          fontSize: 12.5,
          fontWeight: 600,
          color: "#8c919c",
          textDecoration: "none",
          marginBottom: 12,
        }}
      >
        ← Flame tests
      </Link>

      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-.015em" }}>
          Today&#39;s tests
        </div>
        <div style={{ fontSize: 13.5, color: "#8c919c", marginTop: 5 }}>
          {fmtLong(Date.now())} ·{" "}
          {dueNow.length
            ? dueNow.length + " visit" + (dueNow.length === 1 ? "" : "s") + " to log"
            : "nothing scheduled for today"}
        </div>
      </div>

      {/* due today / overdue */}
      <div
        style={{
          background: "#fff",
          border: "1px solid #ececf0",
          borderRadius: 13,
          boxShadow: "0 1px 2px rgba(0,0,0,.04)",
          overflow: "hidden",
          marginBottom: 18,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 9,
            padding: "15px 20px 13px",
            borderBottom: "1px solid #f0f1f4",
          }}
        >
          <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#1f7a52" }} />
          <div style={{ fontSize: 14.5, fontWeight: 600 }}>Ready to log</div>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "#9aa0ab" }}>
            {dueNow.length}
          </span>
        </div>
        {dueNow.map((j) => (
          <Row key={j.id} j={j} due />
        ))}
        {dueNow.length === 0 && (
          <div
            style={{
              padding: "30px 20px",
              textAlign: "center",
              color: "#9aa0ab",
              fontSize: 13,
              lineHeight: 1.6,
            }}
          >
            No visits scheduled for today
            {upcoming.length
              ? " — the next one is " +
                fmtShort(msOf(upcoming[0].scheduledDate)) +
                " at " +
                (upcoming[0].customer || "a venue") +
                "."
              : ". Accepted quotes get a date on the scheduler."}
          </div>
        )}
      </div>

      {/* next up */}
      {upcoming.length > 0 && (
        <div
          style={{
            background: "#fff",
            border: "1px solid #ececf0",
            borderRadius: 13,
            boxShadow: "0 1px 2px rgba(0,0,0,.04)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 9,
              padding: "15px 20px 13px",
              borderBottom: "1px solid #f0f1f4",
            }}
          >
            <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#3155a8" }} />
            <div style={{ fontSize: 14.5, fontWeight: 600 }}>Next up</div>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "#9aa0ab" }}>
              {upcoming.length}
            </span>
          </div>
          {upcoming.map((j) => (
            <Row key={j.id} j={j} due={false} />
          ))}
        </div>
      )}
    </div>
  );
}
