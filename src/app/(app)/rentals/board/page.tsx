import Link from "next/link";
import { requireUser } from "@/lib/session";
import {
  list as listBookings,
  type EquipmentBooking,
  type BookingStatus,
} from "@/lib/stores/equipment-bookings";
import { list as listItems, type EquipmentItem } from "@/lib/stores/equipment-items";
import { list as listLocations } from "@/lib/stores/equipment-locations";
import { shortDate } from "@/lib/format";
import { toggleBookingStatus } from "./actions";

export const metadata = { title: "Booking board — Quartzite-6" };

const DAY = 86400000;

/** Start-of-day, matching the repairs/flame scheduling pages' day-bucket convention. */
function sod(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

const STATUS_META: Record<BookingStatus, { label: string; ink: string; soft: string; bd: string }> = {
  confirmed: { label: "Confirmed", ink: "#3155a8", soft: "#e9eefb", bd: "#d4ddf3" },
  out: { label: "Out", ink: "#9a5a1f", soft: "#fbeede", bd: "#f0dcc0" },
  returned: { label: "Returned", ink: "#2f7a52", soft: "#e6f4ec", bd: "#cde7d8" },
  cancelled: { label: "Cancelled", ink: "#787d87", soft: "#f1f2f5", bd: "#e4e7ec" },
};

/** Overdue badge palette — port of repairs/scheduling.tsx's `sm.overdue` colors
 *  (src/app/(app)/repairs/scheduling/page.tsx), reused here rather than inventing
 *  a new one. */
const OVERDUE_INK = "#b4543a";
const OVERDUE_SOFT = "#f7e9e5";

const CSS = `
  .rb-row:hover { background: #fafbff; }
  .rb-btn:hover { filter: brightness(0.97); }
`;

export default async function BookingBoardPage() {
  const [, bookings, items, locations] = await Promise.all([
    requireUser(),
    listBookings(),
    listItems(),
    listLocations(),
  ]);

  const itemById = new Map<string, EquipmentItem>(items.map((i) => [i.id, i]));
  const locById = new Map(locations.map((l) => [l.id, l.name]));
  const now = Date.now();
  const today = sod(now);

  const nameFor = (b: EquipmentBooking) => itemById.get(b.itemId)?.name || b.itemId;
  const locationFor = (b: EquipmentBooking) => locById.get(b.locationId) || b.locationId;

  const isOverdue = (b: EquipmentBooking) => b.status === "out" && sod(b.endDate) < today;

  const overdue = bookings
    .filter(isOverdue)
    .sort((a, b) => a.endDate - b.endDate);

  const upcoming = bookings.filter((b) => !isOverdue(b));

  /* group the non-overdue bookings by their start-of-day load-in date */
  const groups = new Map<number, EquipmentBooking[]>();
  upcoming.forEach((b) => {
    const key = sod(b.startDate);
    const bucket = groups.get(key);
    if (bucket) bucket.push(b);
    else groups.set(key, [b]);
  });
  const sortedDays = Array.from(groups.keys()).sort((a, b) => a - b);
  sortedDays.forEach((day) => {
    groups.get(day)!.sort((a, b) => nameFor(a).localeCompare(nameFor(b)));
  });

  const standfirst = bookings.length
    ? `${bookings.length} booking${bookings.length === 1 ? "" : "s"}` +
      (overdue.length ? ` · ${overdue.length} overdue` : "")
    : "No equipment bookings yet — rental quotes create bookings when they're won.";

  const daysOverdue = (b: EquipmentBooking) => Math.max(1, Math.round((today - sod(b.endDate)) / DAY));

  const statusBadge = (status: BookingStatus) => {
    const sm = STATUS_META[status];
    return (
      <span
        style={{
          display: "inline-block",
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: ".04em",
          textTransform: "uppercase",
          padding: "1px 6px",
          borderRadius: 4,
          flexShrink: 0,
          color: sm.ink,
          background: sm.soft,
          border: `1px solid ${sm.bd}`,
        }}
      >
        {sm.label}
      </span>
    );
  };

  const toggleButton = (b: EquipmentBooking) => {
    const next: BookingStatus | null = b.status === "confirmed" ? "out" : b.status === "out" ? "returned" : null;
    if (!next) return null;
    return (
      <form action={toggleBookingStatus}>
        <input type="hidden" name="id" value={b.id} />
        <input type="hidden" name="status" value={next} />
        <button
          type="submit"
          className="rb-btn"
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: 12,
            fontWeight: 600,
            color: "#fff",
            background: "var(--accent)",
            border: "none",
            borderRadius: 8,
            padding: "7px 12px",
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          {next === "out" ? "Mark out" : "Mark returned"}
        </button>
      </form>
    );
  };

  const row = (b: EquipmentBooking, opts: { overdue?: boolean } = {}) => (
    <div
      key={b.id}
      className="rb-row"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "12px 16px",
        borderBottom: "1px solid #f1f2f5",
        ...(opts.overdue ? { background: OVERDUE_SOFT } : {}),
      }}
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span
            style={{
              fontSize: 13.5,
              fontWeight: 600,
              lineHeight: 1.25,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {nameFor(b)}
          </span>
          {statusBadge(b.status)}
          {opts.overdue && (
            <span
              style={{
                display: "inline-block",
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: ".04em",
                textTransform: "uppercase",
                padding: "1px 6px",
                borderRadius: 4,
                flexShrink: 0,
                color: OVERDUE_INK,
                background: "#fff",
                border: `1px solid ${OVERDUE_INK}`,
              }}
            >
              {daysOverdue(b)}d overdue
            </span>
          )}
        </div>
        <div style={{ fontSize: 11.5, color: "#9aa0ab", marginTop: 3 }}>
          Qty {b.qty} · {locationFor(b)} · {shortDate(b.startDate)}–{shortDate(b.endDate)}
          {" · "}
          <Link
            href={`/rentals/quote?id=${encodeURIComponent(b.quoteId)}`}
            style={{ color: "#9aa0ab", textDecoration: "underline" }}
          >
            {b.quoteId}
          </Link>
        </div>
      </div>
      <div style={{ flexShrink: 0 }}>{toggleButton(b)}</div>
    </div>
  );

  return (
    <div className="pk-content">
      <style>{CSS}</style>

      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 21, fontWeight: 600, letterSpacing: "-.015em", lineHeight: 1.1 }}>
          Booking board
        </div>
        <div style={{ fontSize: 12.5, color: "#8c919c", marginTop: 3 }}>{standfirst}</div>
      </div>

      {bookings.length === 0 && (
        <div
          style={{
            padding: "60px 24px",
            textAlign: "center",
            color: "#9aa0ab",
            background: "#fff",
            border: "1px solid #e7e9ee",
            borderRadius: 13,
          }}
        >
          <div style={{ fontSize: 15, fontWeight: 600, color: "#5b616e" }}>Nothing booked yet</div>
          <div style={{ fontSize: 13, lineHeight: 1.6, marginTop: 6 }}>
            Win a{" "}
            <Link href="/rentals" style={{ color: "var(--accent)", fontWeight: 600, textDecoration: "none" }}>
              rental quote
            </Link>{" "}
            to create the first booking.
          </div>
        </div>
      )}

      {overdue.length > 0 && (
        <div style={{ marginBottom: 22 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: OVERDUE_INK,
              letterSpacing: ".04em",
              textTransform: "uppercase",
              marginBottom: 8,
            }}
          >
            Overdue — still out past return date
          </div>
          <div
            style={{
              background: "#fff",
              border: `1px solid ${OVERDUE_INK}`,
              borderRadius: 13,
              overflow: "hidden",
            }}
          >
            {overdue.map((b) => row(b, { overdue: true }))}
          </div>
        </div>
      )}

      {sortedDays.map((day) => (
        <div key={day} style={{ marginBottom: 22 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: "#9aa0ab",
              letterSpacing: ".04em",
              textTransform: "uppercase",
              marginBottom: 8,
            }}
          >
            {new Date(day).toLocaleDateString("en-US", {
              weekday: "short",
              month: "short",
              day: "numeric",
            })}
            {day === today ? " · Today" : ""}
          </div>
          <div
            style={{
              background: "#fff",
              border: "1px solid #e7e9ee",
              borderRadius: 13,
              overflow: "hidden",
            }}
          >
            {groups.get(day)!.map((b) => row(b))}
          </div>
        </div>
      ))}
    </div>
  );
}
