import type {
  KrispNoteBlock,
  KrispParticipant,
  RecordingTranscript,
} from "@/lib/stores/recordings";
import {
  KrispApiError,
  KrispAuthError,
  KrispBusyError,
  KrispForbiddenError,
  KrispNotReadyError,
  KrispRateLimitError,
} from "./errors";

export {
  KrispApiError,
  KrispAuthError,
  KrispBusyError,
  KrispForbiddenError,
  KrispNotReadyError,
  KrispRateLimitError,
};

/**
 * Thin typed client for the Krisp Meeting API (Recordings spec, "Krisp API
 * facts", verified 2026-09-21 against meeting-api-docs.krisp.ai). Server-only:
 * the per-rep key never leaves the server (spec decision 4). The transport
 * is injectable so the spec tests exercise the error mapping with a fake
 * `fetch` — production uses the global one.
 *
 * Response envelopes: Krisp's docs show bare objects; `unwrap()` also accepts
 * a `{ data: … }` wrapper so a future envelope change degrades gracefully.
 */
export const KRISP_API_BASE = "https://meeting-api.krisp.ai/v1";

export type KrispTransport = (url: string, init: RequestInit) => Promise<Response>;

const fetchTransport: KrispTransport = (url, init) => fetch(url, init);

export type KrispMe = {
  id: number | null;
  email: string;
  firstName: string;
  lastName: string;
  /** first + last, trimmed — what `krisp_connections.krisp_name` stores. */
  name: string;
  teamId: number | null;
};

export type KrispImportStart = {
  importId: string;
  /** Pre-signed S3 PUT url — the PUT alone creates the meeting and starts transcription. */
  url: string;
  expiresAt: string | null;
};

export type KrispImportState = "uploading" | "processing" | "ready" | "failed";

export type KrispImportStatus = {
  importId: string;
  status: KrispImportState;
  /** null until `ready`. */
  meetingId: string | null;
  error: string | null;
};

export const KRISP_MEETING_FIELDS = [
  "title",
  "started_at",
  "duration",
  "status",
  "participants",
  "transcript",
  "notes",
] as const;
export type KrispMeetingField = (typeof KRISP_MEETING_FIELDS)[number];

export type KrispMeeting = {
  id: string;
  title: string | null;
  startedAt: string | null;
  duration: number | null;
  status: string | null;
  participants: KrispParticipant[] | Record<string, KrispParticipant> | null;
  transcript: RecordingTranscript | null;
  /** Stored RAW on the recording — never reshaped here (spec §1.1). */
  notes: { blocks: KrispNoteBlock[] } | null;
};

type Json = Record<string, unknown>;

async function readBody(res: Response): Promise<{ json: Json | null; text: string }> {
  let text = "";
  try {
    text = await res.text();
  } catch {
    text = "";
  }
  if (!text) return { json: null, text: "" };
  try {
    const parsed: unknown = JSON.parse(text);
    return { json: parsed && typeof parsed === "object" ? (parsed as Json) : null, text };
  } catch {
    return { json: null, text };
  }
}

/** Best-effort human message from a Krisp error body. */
function messageFrom(json: Json | null, text: string, res: Response): string {
  if (json) {
    for (const k of ["message", "error", "detail", "error_description"]) {
      const v = json[k];
      if (typeof v === "string" && v.trim()) return v.trim();
      if (v && typeof v === "object" && typeof (v as Json).message === "string") {
        return String((v as Json).message);
      }
    }
  }
  if (text.trim()) return text.trim().slice(0, 300);
  return `${res.status} ${res.statusText || ""}`.trim();
}

/** Status → error class (spec §2.4 + "Krisp API facts"). Exported for the spec tests. */
export function krispErrorFor(status: number, message: string): KrispApiError {
  if (status === 401) return new KrispAuthError();
  if (status === 403) return new KrispForbiddenError(message);
  if (status === 400 && /still in process/i.test(message)) return new KrispBusyError(message);
  if (status === 429) return new KrispRateLimitError();
  if (status === 409) return new KrispNotReadyError();
  return new KrispApiError(status, message);
}

function unwrap(json: Json | null, key: string): Json {
  if (!json) return {};
  if (key in json) return json;
  const data = json.data;
  if (data && typeof data === "object") return data as Json;
  return json;
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v : v === null || v === undefined ? null : String(v);
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return null;
}

export function createKrispClient(apiKey: string, transport: KrispTransport = fetchTransport) {
  async function call(method: "GET" | "POST", path: string, body?: Json): Promise<Json | null> {
    const init: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    };
    const res = await transport(`${KRISP_API_BASE}${path}`, init);
    const { json, text } = await readBody(res);
    if (!res.ok) throw krispErrorFor(res.status, messageFrom(json, text, res));
    return json;
  }

  return {
    /** `GET /me` — identity check at connect time. */
    async me(): Promise<KrispMe> {
      const d = unwrap(await call("GET", "/me"), "email");
      const firstName = str(d.first_name) ?? "";
      const lastName = str(d.last_name) ?? "";
      return {
        id: num(d.id),
        email: str(d.email) ?? "",
        firstName,
        lastName,
        name: [firstName, lastName].filter(Boolean).join(" ").trim(),
        teamId: num(d.team_id),
      };
    },

    /** `POST /import` → the pre-signed upload slot (201). */
    async startImport(input: {
      title?: string;
      language?: string;
      size?: number;
      duration?: number;
    }): Promise<KrispImportStart> {
      const body: Json = {};
      if (input.title) body.title = input.title;
      if (input.language) body.language = input.language;
      if (typeof input.size === "number") body.size = input.size;
      if (typeof input.duration === "number") body.duration = input.duration;
      const d = unwrap(await call("POST", "/import", body), "import_id");
      const importId = str(d.import_id);
      const url = str(d.url);
      if (!importId || !url) {
        throw new KrispApiError(502, "Krisp import response lacked import_id/url.");
      }
      return { importId, url, expiresAt: str(d.expires_at) };
    },

    /** `GET /import/{id}/status`. */
    async importStatus(importId: string): Promise<KrispImportStatus> {
      const d = unwrap(await call("GET", `/import/${encodeURIComponent(importId)}/status`), "status");
      const raw = (str(d.status) ?? "processing").toLowerCase();
      const status: KrispImportState =
        raw === "uploading" || raw === "processing" || raw === "ready" || raw === "failed"
          ? raw
          : "processing";
      return {
        importId: str(d.import_id) ?? importId,
        status,
        meetingId: str(d.meeting_id),
        error: str(d.error),
      };
    },

    /** `GET /meetings/{id}?fields=…` — 409 while processing → KrispNotReadyError. */
    async meeting(
      id: string,
      fields: readonly KrispMeetingField[] = KRISP_MEETING_FIELDS
    ): Promise<KrispMeeting> {
      const qs = fields.length ? `?fields=${encodeURIComponent(fields.join(","))}` : "";
      const d = unwrap(await call("GET", `/meetings/${encodeURIComponent(id)}${qs}`), "title");
      const transcript = d.transcript;
      const notes = d.notes;
      const participants = d.participants;
      return {
        id: str(d.id) ?? id,
        title: str(d.title),
        startedAt: str(d.started_at),
        duration: num(d.duration),
        status: str(d.status),
        participants:
          participants && typeof participants === "object"
            ? (participants as KrispMeeting["participants"])
            : null,
        transcript:
          transcript && typeof transcript === "object" ? (transcript as RecordingTranscript) : null,
        notes:
          notes && typeof notes === "object" && Array.isArray((notes as Json).blocks)
            ? (notes as { blocks: KrispNoteBlock[] })
            : null,
      };
    },
  };
}

export type KrispClient = ReturnType<typeof createKrispClient>;

/**
 * The S3 PUT to the pre-signed `url` from `startImport` (spec §2.4 step 3).
 * No Authorization header — the signature is in the url; `Content-Type` must
 * be the audio mime. A stream body needs `duplex: "half"` under Node's fetch.
 */
export async function putToPresignedUrl(
  url: string,
  body: ReadableStream<Uint8Array> | Buffer | Uint8Array,
  contentType: string,
  transport: KrispTransport = fetchTransport
): Promise<void> {
  const isStream = typeof ReadableStream !== "undefined" && body instanceof ReadableStream;
  const init: RequestInit & { duplex?: "half" } = {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: body as BodyInit,
    ...(isStream ? { duplex: "half" as const } : {}),
  };
  const res = await transport(url, init);
  if (!res.ok) {
    const { json, text } = await readBody(res);
    throw new KrispApiError(res.status, `Audio upload to Krisp failed: ${messageFrom(json, text, res)}`);
  }
}

/** Deep link to the meeting's AI notes in the Krisp web app (spec §1.1 `meetingUrl`). */
export function krispMeetingUrl(meetingId: string): string {
  return `https://app.krisp.ai/m/${encodeURIComponent(meetingId)}?active_tab=ai_notes`;
}
