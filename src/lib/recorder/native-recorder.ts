"use client";

import { Capacitor } from "@capacitor/core";
import type { RecorderAvailability, RecorderPort, RecorderState, RecorderStopResult } from "./port";

/**
 * Capacitor implementation of the recorder seam (spec §2.1) on
 * `@capgo/capacitor-audio-recorder`:
 *
 *  - writes AAC in an MP4/M4A container to a FILE on device (nothing
 *    base64'd through the bridge while recording);
 *  - iOS keeps recording through screen lock because the plugin uses a
 *    record-capable AVAudioSession and the app declares
 *    `UIBackgroundModes: audio` (DEPLOY.md → Recordings (native build));
 *  - Android: we start the capawesome foreground service (ServiceType
 *    Microphone) BEFORE `startRecording` and stop it after `stopRecording`,
 *    so the OS keeps the process alive for an hour-long visit;
 *  - on stop the plugin's URI (cache/tmp — purgeable) is copied into
 *    `Directory.Data`, and THAT path is what the upload queue persists.
 *
 * Every plugin is dynamic-imported inside the method that needs it so the
 * web bundle never evaluates native plugin registration at module load.
 */

/** Where recordings wait for upload inside Directory.Data. */
export const NATIVE_RECORDINGS_DIR = "recordings";
const FGS_NOTIFICATION_ID = 7301;
const FGS_CHANNEL_ID = "peak-recording";

/** Plugin-level check: platform, plugin presence and mic permission state. */
export async function nativeRecorderAvailable(): Promise<RecorderAvailability> {
  if (!Capacitor.isNativePlatform()) return { ok: false, reason: "Not running in the native app." };
  if (!Capacitor.isPluginAvailable("CapacitorAudioRecorder")) {
    return { ok: false, reason: "Audio recorder plugin is missing from this build (run `npx cap sync`)." };
  }
  try {
    const { CapacitorAudioRecorder } = await import("@capgo/capacitor-audio-recorder");
    const perm = await CapacitorAudioRecorder.checkPermissions();
    if (perm.recordAudio === "denied") {
      return { ok: false, reason: "Microphone access is denied — allow it for Peak in Settings." };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: `Audio recorder unavailable: ${(e as Error)?.message ?? String(e)}` };
  }
}

async function startForegroundService(): Promise<void> {
  if (Capacitor.getPlatform() !== "android") return;
  if (!Capacitor.isPluginAvailable("ForegroundService")) return; // plugin not synced — record anyway
  const { ForegroundService, ServiceType, Importance } = await import(
    "@capawesome-team/capacitor-android-foreground-service"
  );
  try {
    // Android 13+ needs POST_NOTIFICATIONS for the ongoing notification.
    const perm = await ForegroundService.checkPermissions();
    if (perm.display !== "granted") await ForegroundService.requestPermissions();
  } catch {
    /* older Android: no runtime permission */
  }
  try {
    await ForegroundService.createNotificationChannel({
      id: FGS_CHANNEL_ID,
      name: "Recording",
      description: "Shown while Peak is recording a site visit.",
      importance: Importance.Low, // no sound
    });
  } catch {
    /* channel already exists */
  }
  await ForegroundService.startForegroundService({
    id: FGS_NOTIFICATION_ID,
    title: "Recording",
    body: "Peak is recording this visit.",
    smallIcon: "ic_stat_icon_config_sample",
    serviceType: ServiceType.Microphone,
    silent: true,
    notificationChannelId: FGS_CHANNEL_ID,
  });
}

async function stopForegroundService(): Promise<void> {
  if (Capacitor.getPlatform() !== "android") return;
  if (!Capacitor.isPluginAvailable("ForegroundService")) return;
  try {
    const { ForegroundService } = await import("@capawesome-team/capacitor-android-foreground-service");
    await ForegroundService.stopForegroundService();
  } catch {
    /* already stopped */
  }
}

/**
 * Move the plugin's output out of its cache/tmp location into Directory.Data
 * so the OS cannot purge it before the queue has uploaded it. Returns the
 * relative path inside Directory.Data (what RecordedFile.path carries).
 */
async function persistRecording(uri: string, ext: string): Promise<string> {
  const { Filesystem, Directory } = await import("@capacitor/filesystem");
  try {
    await Filesystem.mkdir({ path: NATIVE_RECORDINGS_DIR, directory: Directory.Data, recursive: true });
  } catch {
    /* exists */
  }
  const dest = `${NATIVE_RECORDINGS_DIR}/rec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  await Filesystem.copy({ from: uri, to: dest, toDirectory: Directory.Data });
  try {
    await Filesystem.deleteFile({ path: uri });
  } catch {
    /* the plugin's temp copy is best-effort to remove */
  }
  return dest;
}

export class NativeRecorder implements RecorderPort {
  private st: RecorderState = "idle";
  private fgsStarted = false;

  state(): RecorderState {
    return this.st;
  }

  async start(): Promise<void> {
    if (this.st !== "idle") throw new Error("Recorder already running");
    const { CapacitorAudioRecorder } = await import("@capgo/capacitor-audio-recorder");
    let perm = await CapacitorAudioRecorder.checkPermissions();
    if (perm.recordAudio !== "granted") perm = await CapacitorAudioRecorder.requestPermissions();
    if (perm.recordAudio !== "granted") {
      throw new Error("Microphone permission was not granted.");
    }
    try {
      await startForegroundService();
      this.fgsStarted = true;
    } catch (e) {
      // Recording still works with the app in the foreground; surface later if it dies.
      console.warn("[recorder] foreground service failed to start", e);
      this.fgsStarted = false;
    }
    try {
      await CapacitorAudioRecorder.startRecording({ sampleRate: 44_100, bitRate: 96_000 });
    } catch (e) {
      if (this.fgsStarted) await stopForegroundService();
      this.fgsStarted = false;
      throw e;
    }
    this.st = "recording";
  }

  async pause(): Promise<void> {
    if (this.st !== "recording") return;
    const { CapacitorAudioRecorder } = await import("@capgo/capacitor-audio-recorder");
    await CapacitorAudioRecorder.pauseRecording();
    this.st = "paused";
  }

  async resume(): Promise<void> {
    if (this.st !== "paused") return;
    const { CapacitorAudioRecorder } = await import("@capgo/capacitor-audio-recorder");
    await CapacitorAudioRecorder.resumeRecording();
    this.st = "recording";
  }

  async stop(): Promise<RecorderStopResult> {
    if (this.st === "idle") throw new Error("Recorder is not running");
    const { CapacitorAudioRecorder } = await import("@capgo/capacitor-audio-recorder");
    let result: { uri?: string; blob?: Blob; duration?: number };
    try {
      result = await CapacitorAudioRecorder.stopRecording();
    } finally {
      this.st = "idle";
      if (this.fgsStarted) await stopForegroundService();
      this.fgsStarted = false;
    }
    const durationS = Math.round((result.duration ?? 0) / 1000);
    const mime = "audio/mp4";
    if (result.uri) {
      const path = await persistRecording(result.uri, "m4a");
      return { file: { kind: "native", path }, mime, durationS };
    }
    if (result.blob) {
      // The plugin's web shim — only reachable if a native shell reports web.
      return { file: { kind: "web", blob: result.blob }, mime: result.blob.type || mime, durationS };
    }
    throw new Error("Recorder returned no file.");
  }
}
