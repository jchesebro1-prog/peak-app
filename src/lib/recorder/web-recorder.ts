"use client";

import type { RecorderAvailability, RecorderPort, RecorderState, RecorderStopResult } from "./port";

/**
 * MediaRecorder implementation of the recorder seam (spec §2.1).
 *
 * DESKTOP / DEV FALLBACK ONLY. It is what `pickRecorder()` returns in a plain
 * browser so the capture → upload → Krisp flow can be exercised without a
 * device build. It is NOT the field recorder: inside WKWebView (iOS) the mic
 * track is muted the moment the screen locks or the app backgrounds, and the
 * chunks live in JS memory (a 45-minute Opus take is ~20–30 MB, fine for a
 * desktop test, wrong for a phone). Native builds go through
 * `native-recorder.ts`.
 *
 * Output: `audio/webm;codecs=opus` when the browser supports it, else the
 * first supported type from PREFERRED (Safari produces `audio/mp4`). The
 * `mime` returned from `stop()` is whatever the recorder actually used.
 */

const PREFERRED = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4;codecs=mp4a.40.2",
  "audio/mp4",
  "audio/ogg;codecs=opus",
];

function pickMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  for (const t of PREFERRED) {
    try {
      if (MediaRecorder.isTypeSupported(t)) return t;
    } catch {
      /* isTypeSupported can throw on odd strings in old engines */
    }
  }
  return undefined; // let the browser choose its default
}

export async function webRecorderAvailable(): Promise<RecorderAvailability> {
  if (typeof window === "undefined") return { ok: false, reason: "Not in a browser." };
  if (typeof MediaRecorder === "undefined") {
    return { ok: false, reason: "This browser cannot record audio (no MediaRecorder)." };
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    return { ok: false, reason: "Microphone access is unavailable (needs HTTPS or localhost)." };
  }
  return { ok: true };
}

export class WebRecorder implements RecorderPort {
  private rec: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private chunks: BlobPart[] = [];
  private st: RecorderState = "idle";
  /** Wall-clock accounting that excludes paused stretches. */
  private startedAt = 0;
  private accumulatedMs = 0;

  state(): RecorderState {
    return this.st;
  }

  async start(): Promise<void> {
    if (this.st !== "idle") throw new Error("Recorder already running");
    const avail = await webRecorderAvailable();
    if (!avail.ok) throw new Error(avail.reason);
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = pickMime();
    this.rec = new MediaRecorder(this.stream, mimeType ? { mimeType } : undefined);
    this.chunks = [];
    this.rec.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) this.chunks.push(e.data);
    };
    // Timeslice so a long take is flushed into chunks as it goes rather than
    // one giant Blob at stop().
    this.rec.start(10_000);
    this.startedAt = Date.now();
    this.accumulatedMs = 0;
    this.st = "recording";
  }

  async pause(): Promise<void> {
    if (this.st !== "recording" || !this.rec) return;
    this.rec.pause();
    this.accumulatedMs += Date.now() - this.startedAt;
    this.st = "paused";
  }

  async resume(): Promise<void> {
    if (this.st !== "paused" || !this.rec) return;
    this.rec.resume();
    this.startedAt = Date.now();
    this.st = "recording";
  }

  async stop(): Promise<RecorderStopResult> {
    const rec = this.rec;
    if (!rec || this.st === "idle") throw new Error("Recorder is not running");
    if (this.st === "recording") this.accumulatedMs += Date.now() - this.startedAt;
    const durationS = Math.round(this.accumulatedMs / 1000);

    await new Promise<void>((resolve) => {
      rec.onstop = () => resolve();
      try {
        rec.stop();
      } catch {
        resolve();
      }
    });
    const mime = rec.mimeType || pickMime() || "audio/webm";
    const blob = new Blob(this.chunks, { type: mime.split(";")[0] });

    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.rec = null;
    this.chunks = [];
    this.st = "idle";

    return { file: { kind: "web", blob }, mime, durationS };
  }
}
