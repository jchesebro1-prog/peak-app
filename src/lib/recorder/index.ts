"use client";

import { isNativePlatform } from "@/lib/platform";
import type { RecorderAvailability, RecorderPort } from "./port";

export type { RecordedFile, RecorderPort, RecorderState, RecorderStopResult, RecorderAvailability } from "./port";

/**
 * Choose the recorder for this runtime (spec §2.1): the Capacitor plugin
 * inside the iOS/Android shell, MediaRecorder everywhere else. Both modules
 * are loaded lazily so the plugin registration never runs in a browser and
 * MediaRecorder types never matter on the server.
 */
export async function pickRecorder(): Promise<RecorderPort> {
  if (isNativePlatform()) {
    const { NativeRecorder } = await import("./native-recorder");
    return new NativeRecorder();
  }
  const { WebRecorder } = await import("./web-recorder");
  return new WebRecorder();
}

/** Can this runtime record at all? (plugin present, mic not denied, HTTPS…) */
export async function recorderAvailable(): Promise<RecorderAvailability> {
  if (typeof window === "undefined") return { ok: false, reason: "Not in a browser." };
  if (isNativePlatform()) {
    const { nativeRecorderAvailable } = await import("./native-recorder");
    return nativeRecorderAvailable();
  }
  const { webRecorderAvailable } = await import("./web-recorder");
  return webRecorderAvailable();
}
