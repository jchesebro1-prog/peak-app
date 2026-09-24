const MEETING_HOSTS = [
  "meet.google.com",
  "zoom.us",
  "teams.microsoft.com",
  "webex.com",
  "whereby.com",
] as const;

function isMeetingUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && MEETING_HOSTS.some((host) =>
      url.hostname === host || url.hostname.endsWith("." + host),
    );
  } catch {
    return false;
  }
}

/** Find the first provider URL Google exposes in an event's location or body. */
export function findMeetingLink(...values: Array<string | undefined>): string {
  for (const value of values) {
    if (!value) continue;
    const candidates = value.match(/https?:\/\/[^\s<>()]+/gi) || [];
    const match = candidates.find((candidate) => isMeetingUrl(candidate.replace(/[.,;]+$/, "")));
    if (match) return match.replace(/[.,;]+$/, "");
  }
  return "";
}
