/**
 * AI daily brief — slots (spec §1). Morning is 06:45 and afternoon 13:45,
 * America/Chicago; the slot boundary itself lives in triage's clock
 * (`slotAt`, minute-precise) so the brief and the Start-here list never
 * disagree. Pure, client-safe.
 */
import { MORNING_AT_MIN, minuteOfDay, slotAt } from "@/lib/triage/clock";
import type { BriefSlot } from "./types";

export const BRIEF_TIMES: Readonly<Record<BriefSlot, { hour: number; minute: number }>> = {
  morning: { hour: 6, minute: 45 },
  midday: { hour: 13, minute: 45 },
};

/** The blob id: `brief:<userId>:<day>:<slot>`. */
export function briefId(userId: string, day: string, slot: BriefSlot): string {
  return `brief:${userId}:${day}:${slot}`;
}

/** The card header: "Morning brief · 6:45" / "Afternoon brief · 1:45". */
export function briefTitle(slot: BriefSlot): string {
  return slot === "morning" ? "Morning brief · 6:45" : "Afternoon brief · 1:45";
}

/** The slot `ms` falls in. `beforeMorning`: earlier than 6:45 Chicago — the morning brief isn't due yet. */
export function briefSlotAt(ms: number): { day: string; slot: BriefSlot; beforeMorning: boolean } {
  const { day, slot } = slotAt(ms);
  return { day, slot, beforeMorning: minuteOfDay(ms) < MORNING_AT_MIN };
}

/** "YYYY-MM-DD" of the calendar day before. */
export function prevDayKey(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) - 86_400_000).toISOString().slice(0, 10);
}

/** The brief before this one: midday → that morning; morning → yesterday's midday. */
export function previousBriefSlot(day: string, slot: BriefSlot): { day: string; slot: BriefSlot } {
  return slot === "midday" ? { day, slot: "morning" } : { day: prevDayKey(day), slot: "midday" };
}
