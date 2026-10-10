/**
 * Minimal RFC-5545 .ics builder for site-visit calendar invites (D76).
 * Plain string assembly, zero deps — same no-new-deps posture as the Gmail
 * client (D36). METHOD:PUBLISH and no ATTENDEE lines on purpose: the invite
 * goes only to the assignee's own mailbox (decision B — customers are never
 * auto-invited), so there is no RSVP round-trip. An update re-sends PUBLISH
 * with a higher SEQUENCE; a removal sends METHOD:CANCEL with the same UID
 * (spec 2026-10-09 site-visit scheduling), which also names the ORGANIZER
 * (sending mailbox) and ATTENDEE (recipient) as RFC 5546 requires.
 */

export type IcsEvent = {
  uid: string; // globally unique, e.g. "sv-SV-5001@peak-app"
  title: string;
  description?: string;
  location?: string;
  start: number; // epoch-ms
  end: number; // epoch-ms
  stampAt: number; // epoch-ms (DTSTAMP — pass Date.now() from the caller)
  /** Spec 2026-10-09 site-visit scheduling: "CANCEL" removes the event
   *  (same UID). Omitted = PUBLISH, byte-identical to the original invite. */
  method?: "PUBLISH" | "CANCEL";
  /** RFC-5545 SEQUENCE — an update or cancel carries a higher number than
   *  the last copy sent. Omitted = no SEQUENCE line. */
  sequence?: number;
  /** ORGANIZER (the sending mailbox) and ATTENDEE (the recipient) addresses.
   *  Printed only with a METHOD other than PUBLISH — RFC 5546 requires both
   *  on a CANCEL; a PUBLISH stays byte-identical to the original invite. */
  organizer?: string;
  attendee?: string;
};

/** The attachment's MIME type: a non-PUBLISH .ics carries its METHOD
 *  (`text/calendar; method=CANCEL`) so mail clients act on it; PUBLISH stays
 *  plain `text/calendar` as before. */
export function icsMimeType(icsText: string): string {
  const method = /^METHOD:([A-Z-]+)\r?$/m.exec(icsText)?.[1];
  return method && method !== "PUBLISH" ? `text/calendar; method=${method}` : "text/calendar";
}

/** mailto: value for ORGANIZER / ATTENDEE — no line breaks, no stray colons/semicolons. */
function mailto(addr: string): string {
  return "mailto:" + addr.replace(/[\r\n;:,"<>\s]/g, "");
}

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
    "METHOD:" + (ev.method ?? "PUBLISH"),
    "BEGIN:VEVENT",
    "UID:" + esc(ev.uid),
    "DTSTAMP:" + utc(ev.stampAt),
    ...(ev.sequence != null ? ["SEQUENCE:" + Math.max(0, Math.round(ev.sequence))] : []),
    "DTSTART:" + utc(ev.start),
    "DTEND:" + utc(ev.end),
    ...(ev.method === "CANCEL" ? ["STATUS:CANCELLED"] : []),
    ...(ev.method && ev.method !== "PUBLISH" && ev.organizer ? ["ORGANIZER:" + mailto(ev.organizer)] : []),
    ...(ev.method && ev.method !== "PUBLISH" && ev.attendee ? ["ATTENDEE:" + mailto(ev.attendee)] : []),
    "SUMMARY:" + esc(ev.title),
    ...(ev.location ? ["LOCATION:" + esc(ev.location)] : []),
    ...(ev.description ? ["DESCRIPTION:" + esc(ev.description)] : []),
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}
