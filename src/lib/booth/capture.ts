/**
 * Trade show booth capture — the record every capture path produces (the
 * public card page's share-back, staff Booth mode, a scanned card), the
 * dedupe rule, and the copy written onto the lead and the follow-up draft.
 * Pure. The server path is `capture-server.ts`.
 */

export const INTERESTS = ["rigging", "curtains", "lighting", "av", "flame", "inspections"] as const;
export type Interest = (typeof INTERESTS)[number];
export const INTEREST_LABEL: Record<Interest, string> = {
  rigging: "Rigging",
  curtains: "Curtains",
  lighting: "Lighting",
  av: "AV",
  flame: "Flame testing",
  inspections: "Inspections",
};

export const TEMPERATURES = ["hot", "warm", "cold"] as const;
export type Temperature = (typeof TEMPERATURES)[number];

export type BoothCapture = {
  id: string; // bc_<16 hex>, minted on the device (or by the share-back route)
  via: "card" | "booth";
  showId: string | null;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  company: string;
  title: string;
  interests: Interest[];
  temperature: Temperature | null;
  notes: string;
  /** On the way in only: a ≤ 250 KB JPEG data URL. The server moves it to Blob and drops it. */
  cardImage?: string;
  /** Set by the server: private Blob path (or "inline" in dev without Blob). */
  cardImagePath?: string;
  capturedAt: number;
  capturedById: string;
  capturedByName: string;
  /** Set by the server once recorded. */
  leadId?: string;
  outcome?: "created" | "merged";
  rev?: number;
};

export const CAPTURE_ID = /^bc_[0-9a-f]{16}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MAX_IMAGE_CHARS = 350_000;

export function newCaptureId(randHex16: () => string): string {
  return "bc_" + randHex16();
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export function sanitizeCapture(raw: unknown): { ok: true; capture: BoothCapture } | { ok: false; error: string } {
  const o = (raw || {}) as Record<string, unknown>;
  const id = str(o.id, 40);
  if (!CAPTURE_ID.test(id)) return { ok: false, error: "Bad capture id." };
  const firstName = str(o.firstName, 80);
  const lastName = str(o.lastName, 80);
  if (!firstName && !lastName) return { ok: false, error: "Add a name." };
  const email = str(o.email, 200).toLowerCase();
  const phone = str(o.phone, 40);
  if (!email && !phone) return { ok: false, error: "Add an email or a phone number." };
  if (email && !EMAIL.test(email)) return { ok: false, error: "That email doesn't look right." };
  const interests = Array.isArray(o.interests)
    ? INTERESTS.filter((k) => (o.interests as unknown[]).includes(k))
    : [];
  const temperature = (TEMPERATURES as readonly string[]).includes(o.temperature as string) ? (o.temperature as Temperature) : null;
  const img = typeof o.cardImage === "string" && o.cardImage.startsWith("data:image/jpeg;base64,") && o.cardImage.length <= MAX_IMAGE_CHARS ? o.cardImage : undefined;
  const showId = typeof o.showId === "string" && /^sh_[0-9a-f]{8}$/.test(o.showId) ? o.showId : null;
  const capturedAt = typeof o.capturedAt === "number" && Number.isFinite(o.capturedAt) ? o.capturedAt : 0;
  const capture: BoothCapture = {
    id,
    via: o.via === "card" ? "card" : "booth",
    showId,
    firstName,
    lastName,
    email,
    phone,
    company: str(o.company, 160),
    title: str(o.title, 120),
    interests,
    temperature,
    notes: str(o.notes, 4000),
    ...(img ? { cardImage: img } : {}),
    capturedAt,
    capturedById: str(o.capturedById, 80),
    capturedByName: str(o.capturedByName, 120),
  };
  return { ok: true, capture };
}

export type LeadLite = { id: string; email: string; stage: string; boothCaptureIds?: string[] };

// Mirrors OPEN_STAGES in src/lib/stores/leads.ts (kept local so this file stays pure).
const OPEN = new Set(["new", "contacted", "qualified", "quoted"]);

export function dedupeDecision(c: BoothCapture, openLeads: LeadLite[]): { kind: "merge"; leadId: string } | { kind: "new" } {
  if (!c.email) return { kind: "new" };
  const hit = openLeads.find((l) => OPEN.has(l.stage) && (l.email || "").trim().toLowerCase() === c.email);
  return hit ? { kind: "merge", leadId: hit.id } : { kind: "new" };
}

export function alreadyRecorded(captureId: string, leads: LeadLite[]): string | null {
  return leads.find((l) => (l.boothCaptureIds || []).includes(captureId))?.id ?? null;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function leadMessage(c: BoothCapture, showName: string | null): string {
  const parts = [showName ? `Met at ${showName}` : "Met at a trade show"];
  if (c.interests.length) parts.push("Interests: " + c.interests.map((k) => INTEREST_LABEL[k]).join(", "));
  if (c.temperature) parts.push("Temperature: " + cap(c.temperature));
  if (c.notes) parts.push(c.notes);
  return parts.join("\n");
}

function list(words: string[]): string {
  if (words.length <= 1) return words.join("");
  return words.slice(0, -1).join(", ") + " and " + words[words.length - 1];
}

export function followUpCopy(input: { firstName: string; showName: string | null; interests: Interest[]; senderName: string }): { subject: string; body: string } {
  const subject = input.showName ? `Great meeting you at ${input.showName}` : "Great meeting you";
  const hi = input.firstName ? `Hi ${input.firstName},` : "Hi,";
  const about = input.interests.length
    ? `I'd be glad to follow up on ${list(input.interests.map((k) => INTEREST_LABEL[k].toLowerCase()))} for your space.`
    : "I'd be glad to help with whatever your space needs next.";
  const where = input.showName ? ` at ${input.showName}` : "";
  const body = `${hi}\n\nThanks for stopping by our booth${where}. ${about} My contact card is attached so you have my direct line.\n\nWhat's a good time for a quick call this week or next?\n\n${input.senderName}\n`;
  return { subject, body };
}
