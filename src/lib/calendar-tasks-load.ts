import { allTasks } from "@/lib/stores/tasks";
import { allAssignments } from "@/lib/stores/assignments";
import { activeUsers } from "@/lib/users";
import { selectCalendarTasks, type CalendarTaskItem } from "@/lib/calendar-tasks";

/**
 * #215 — the calendar's task feed: open tasks + My Queue assignments,
 * normalized. Not range-limited: undated and overdue items float onto today,
 * so the placement (client side, browser timezone) needs all of them.
 */
export async function loadCalendarTasks(
  me: { id: string; name: string },
  everyone: boolean
): Promise<CalendarTaskItem[]> {
  const [tasks, assignments, roster] = await Promise.all([allTasks(), allAssignments(), activeUsers()]);
  return selectCalendarTasks(tasks, assignments, {
    me,
    everyone,
    roster: roster.map((u) => ({ id: u.id, name: u.name, initials: u.initials })),
  });
}
