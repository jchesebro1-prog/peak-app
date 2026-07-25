/**
 * Minimal RFC-5545 .ics builder for site-visit calendar invites (D76).
 * Plain string assembly, zero deps — same no-new-deps posture as the Gmail
 * client (D36). METHOD:PUBLISH and no ATTENDEE lines on purpose: the invite
 * goes only to the assignee's own mailbox (decision B — customers are never
 * auto-invited), so there is no RSVP round-trip.
 */

export type IcsEvent = {
  uid: string; // globally unique, e.g. "sv-SV-5001@peak-app"
  title: string;
  description?: string;
  location?: string;
  start: number; // epoch-ms
  end: number; // epoch-ms
  stampAt: number; // epoch-ms (DTSTAMP — pass Date.now() from the caller)
};

/** RFC-5545 TEXT escaping: backslash, semicolon, comma, newline. */
function esc(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** UTC basic format: 20260719T143000Z */
function utc(ms: number): string {
  return new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** Fold lines longer than 75 octets (continuation lines start with a space). */
function fold(line: string): string {
  const out: string[] = [];
  let rest = line;
  while (rest.length > 75) {
    out.push(rest.slice(0, 75));
    rest = " " + rest.slice(75);
  }
  out.push(rest);
  return out.join("\r\n");
}

export function buildIcs(ev: IcsEvent): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Peak Systems Group//Quartzite-6//EN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    "UID:" + esc(ev.uid),
    "DTSTAMP:" + utc(ev.stampAt),
    "DTSTART:" + utc(ev.start),
    "DTEND:" + utc(ev.end),
    "SUMMARY:" + esc(ev.title),
    ...(ev.location ? ["LOCATION:" + esc(ev.location)] : []),
    ...(ev.description ? ["DESCRIPTION:" + esc(ev.description)] : []),
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}
