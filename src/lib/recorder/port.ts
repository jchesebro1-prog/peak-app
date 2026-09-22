/**
 * Recorder seam (Recordings spec §2.1 —
 * docs/superpowers/specs/2026-09-21-krisp-recordings-design.md). One
 * interface, two implementations: `native-recorder.ts` (Capacitor, writes a
 * file on device so a 45-minute take never lives in JS memory) and
 * `web-recorder.ts` (MediaRecorder — the desktop/dev fallback). `index.ts`
 * picks one by platform. Everything here is type-only + pure so both the
 * page and the upload queue can import it without pulling a plugin in.
 */

export type RecorderState = "idle" | "recording" | "paused";

/**
 * Where the audio ended up after `stop()`:
 *  - native → a path inside Capacitor `Directory.Data` (the recorder copies
 *    it out of the plugin's cache/tmp dir, which the OS may purge);
 *  - web    → an in-memory Blob (the queue parks it in IndexedDB).
 */
export type RecordedFile =
  | { kind: "native"; path: string }
  | { kind: "web"; blob: Blob };

export type RecorderStopResult = {
  file: RecordedFile;
  /** The container mime actually produced ("audio/mp4", "audio/webm;codecs=opus", …). */
  mime: string;
  durationS: number;
};

export interface RecorderPort {
  start(): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  stop(): Promise<RecorderStopResult>;
  state(): RecorderState;
}

export type RecorderAvailability = { ok: true } | { ok: false; reason: string };
