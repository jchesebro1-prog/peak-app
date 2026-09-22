"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { pickRecorder, recorderAvailable, type RecorderPort, type RecorderStopResult } from "@/lib/recorder";
import { buildRecordingTitle, formatElapsed } from "@/lib/recorder/helpers";
import { drainUploadQueue, enqueueUpload, subscribeUploadQueue, type UploadQueueSnapshot } from "@/lib/recorder/upload-queue";
import { getEngine } from "@/lib/sync/engine";
import { createRecordingAction, type CaptureContext } from "../capture-actions";

/* ============================================================
 * Recorder — /recordings/new (spec §2.2). Full-screen, phone-first.
 *
 * Record → (Pause/Resume) → Stop. Stop:
 *   1. createRecordingAction(parentKind, parentId, meta)  → REC-####
 *      (offline: a client-minted `rec-<uuid>` doc goes through the doc-sync
 *      outbox, the same convention field-created tasks use — never renumbered)
 *   2. enqueueUpload(file) → the device upload queue (§2.3)
 *   3. drainUploadQueue()  — kicked, NOT awaited
 *   4. router.push(/recordings/<id>)
 *
 * The screen stays awake via navigator.wakeLock while recording (WKWebView
 * mutes the mic on lock when running as a web fallback — the native plugin
 * survives lock on its own, the wake lock is belt-and-braces there).
 * ============================================================ */

type Phase = "checking" | "unavailable" | "idle" | "starting" | "recording" | "paused" | "stopping" | "saving" | "error";

function mintOfflineId(): string {
  const uuid =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `rec-${uuid}`;
}

function isOfflineError(e: unknown): boolean {
  return e instanceof TypeError || (typeof navigator !== "undefined" && !navigator.onLine);
}

/** Whole-document shape for the outbox (normalizeRecording backfills the rest on read). */
function offlineRecordingDoc(
  id: string,
  ctx: CaptureContext,
  meta: { startedAt: number; endedAt: number; durationS: number; mime: string; sizeBytes: number },
  remember: string
): Record<string, unknown> {
  const at = Date.now();
  return {
    id,
    rev: 1,
    parentKind: ctx.parentKind,
    parentId: ctx.parentId,
    customerId: ctx.customerId,
    customer: ctx.customer,
    locationId: ctx.locationId,
    venue: ctx.venue,
    title: buildRecordingTitle({
      parentId: ctx.parentId,
      venue: ctx.venue,
      customer: ctx.customer,
      parentLabel: ctx.label,
      remember,
      at: meta.startedAt,
    }),
    recordedByUserId: ctx.user.id,
    recordedByName: ctx.user.name,
    startedAt: meta.startedAt,
    endedAt: meta.endedAt,
    durationS: meta.durationS,
    mime: meta.mime,
    sizeBytes: meta.sizeBytes,
    audio: {
      state: "on_device",
      blobPathname: null,
      uploadError: null,
      driveFileId: null,
      driveLink: null,
      archivedAt: null,
      archiveError: null,
    },
    krisp: {
      status: "pending",
      krispUserId: null,
      importId: null,
      meetingId: null,
      meetingUrl: null,
      error: null,
      lastCheckedAt: null,
      readyAt: null,
    },
    transcript: null,
    notes: null,
    summary: [],
    keyPoints: [],
    actionItems: [],
    feedNoteId: null,
    prefill: { insertedKeys: [] },
    createdAt: at,
    updatedAt: at,
  };
}

export default function RecorderClient({ ctx }: { ctx: CaptureContext }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("checking");
  const [reason, setReason] = useState<string>("");
  const [remember, setRemember] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [queue, setQueue] = useState<UploadQueueSnapshot | null>(null);

  const recorder = useRef<RecorderPort | null>(null);
  const startedAt = useRef(0); // wall-clock of first start
  const segmentStart = useRef(0); // wall-clock of the current recording stretch
  const accumulated = useRef(0); // ms recorded before the current stretch
  const wakeLock = useRef<WakeLockSentinel | null>(null);

  /* availability */
  useEffect(() => {
    let alive = true;
    recorderAvailable().then((a) => {
      if (!alive) return;
      if (a.ok) setPhase("idle");
      else {
        setReason(a.reason);
        setPhase("unavailable");
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  /* queue chip */
  useEffect(() => subscribeUploadQueue(setQueue), []);

  /* elapsed ticker */
  useEffect(() => {
    if (phase !== "recording") return;
    const t = setInterval(() => {
      setElapsed(Math.floor((accumulated.current + (Date.now() - segmentStart.current)) / 1000));
    }, 250);
    return () => clearInterval(t);
  }, [phase]);

  /* keep the screen awake while recording */
  const requestWakeLock = useCallback(async () => {
    try {
      if ("wakeLock" in navigator && !wakeLock.current) {
        wakeLock.current = await navigator.wakeLock.request("screen");
        wakeLock.current.addEventListener("release", () => {
          wakeLock.current = null;
        });
      }
    } catch {
      /* not granted / not supported — the native plugin does not need it */
    }
  }, []);
  const releaseWakeLock = useCallback(() => {
    void wakeLock.current?.release().catch(() => undefined);
    wakeLock.current = null;
  }, []);
  useEffect(() => {
    if (phase !== "recording") return;
    const onVis = () => {
      if (document.visibilityState === "visible") void requestWakeLock();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [phase, requestWakeLock]);

  /* warn before leaving mid-take */
  useEffect(() => {
    if (phase !== "recording" && phase !== "paused") return;
    const onUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [phase]);

  const fail = (e: unknown) => {
    setReason((e as Error)?.message ?? String(e));
    setPhase("error");
    releaseWakeLock();
  };

  const onRecord = async () => {
    setPhase("starting");
    try {
      const r = recorder.current ?? (await pickRecorder());
      recorder.current = r;
      await r.start();
      const now = Date.now();
      startedAt.current = now;
      segmentStart.current = now;
      accumulated.current = 0;
      setElapsed(0);
      setPhase("recording");
      void requestWakeLock();
    } catch (e) {
      fail(e);
    }
  };

  const onPause = async () => {
    const r = recorder.current;
    if (!r) return;
    try {
      await r.pause();
      accumulated.current += Date.now() - segmentStart.current;
      setPhase("paused");
    } catch (e) {
      fail(e);
    }
  };

  const onResume = async () => {
    const r = recorder.current;
    if (!r) return;
    try {
      await r.resume();
      segmentStart.current = Date.now();
      setPhase("recording");
      void requestWakeLock();
    } catch (e) {
      fail(e);
    }
  };

  const onStop = async () => {
    const r = recorder.current;
    if (!r) return;
    setPhase("stopping");
    let stopped: RecorderStopResult;
    try {
      stopped = await r.stop();
    } catch (e) {
      fail(e);
      return;
    }
    releaseWakeLock();
    setPhase("saving");

    const endedAt = Date.now();
    const sizeBytes = stopped.file.kind === "web" ? stopped.file.blob.size : 0;
    const meta = {
      startedAt: startedAt.current || endedAt,
      endedAt,
      durationS: stopped.durationS,
      mime: stopped.mime,
      sizeBytes,
    };
    const note = remember.trim();

    let id: string | null = null;
    try {
      const res = await createRecordingAction(ctx.parentKind, ctx.parentId, { ...meta, remember: note || undefined });
      if (!res.ok) {
        fail(new Error(res.error));
        return;
      }
      id = res.id;
    } catch (e) {
      const digest = (e as { digest?: unknown })?.digest;
      if (typeof digest === "string" && digest.startsWith("NEXT_")) throw e; // redirect → let Next handle
      if (!isOfflineError(e)) {
        fail(e);
        return;
      }
      // Offline: client-minted id through the doc-sync outbox (spec §2.2 step 1).
      id = mintOfflineId();
      await getEngine().enqueue("recordings", id, offlineRecordingDoc(id, ctx, meta, note), 1);
    }

    try {
      await enqueueUpload({ recordingId: id, file: stopped.file, mime: stopped.mime, sizeBytes });
    } catch (e) {
      // The record exists; the audio could not be parked (e.g. no IndexedDB). Say so and still navigate.
      console.warn("[recorder] could not queue upload", e);
    }
    void drainUploadQueue();
    router.push(`/recordings/${id}`);
  };

  const place = ctx.venue || ctx.customer;
  const busy = phase === "starting" || phase === "stopping" || phase === "saving";
  const live = phase === "recording" || phase === "paused";
  const pendingCount = queue?.items.length ?? 0;

  return (
    <div
      style={{
        minHeight: "100%",
        display: "flex",
        flexDirection: "column",
        width: "100%",
        maxWidth: 520,
        margin: "0 auto",
        padding: "18px 18px calc(28px + env(safe-area-inset-bottom, 0px))",
        boxSizing: "border-box",
      }}
    >
      {/* header: parent + venue */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div className="pk-field-label" style={{ marginBottom: 2 }}>
            {ctx.label}
          </div>
          <div className="pk-page-title" style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span className="pk-badge">{ctx.parentId}</span>
            <span>{place || "Recording"}</span>
          </div>
          {ctx.venue && ctx.customer && ctx.venue !== ctx.customer ? (
            <div className="pk-page-sub">{ctx.customer}</div>
          ) : null}
        </div>
        {!live && !busy ? (
          <button type="button" className="pk-btn-outline" style={{ padding: "8px 12px" }} onClick={() => router.back()}>
            Cancel
          </button>
        ) : null}
      </div>

      {/* server-side gates */}
      {!ctx.blobEnabled ? (
        <div
          style={{
            marginTop: 14,
            padding: "10px 12px",
            borderRadius: 10,
            background: "#fbf3dd",
            border: "1px solid #f0e2bd",
            color: "#8a6d1f",
            fontSize: 12.5,
            lineHeight: 1.45,
          }}
        >
          <strong>Upload unavailable on this server.</strong> You can still record — the audio stays on this device
          and the record is created; it uploads once a Blob token is configured.
        </div>
      ) : null}

      {/* the stage */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 18, padding: "28px 0" }}>
        {phase === "checking" ? (
          <div className="pk-page-sub">Checking the microphone…</div>
        ) : phase === "unavailable" ? (
          <div className="pk-card" style={{ padding: "18px 20px", textAlign: "center", maxWidth: 380 }}>
            <div className="pk-h3">Can&apos;t record here</div>
            <p className="pk-page-sub" style={{ marginTop: 6, lineHeight: 1.5 }}>
              {reason}
            </p>
          </div>
        ) : (
          <>
            <div
              className="mono"
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 56,
                fontWeight: 600,
                letterSpacing: "0.02em",
                fontVariantNumeric: "tabular-nums",
                color: phase === "paused" ? "var(--muted)" : "var(--ink)",
                lineHeight: 1,
              }}
            >
              {formatElapsed(elapsed)}
            </div>
            <div className="pk-page-sub" style={{ minHeight: 18 }}>
              {phase === "recording"
                ? "Recording…"
                : phase === "paused"
                  ? "Paused"
                  : phase === "starting"
                    ? "Starting…"
                    : phase === "stopping"
                      ? "Finishing…"
                      : phase === "saving"
                        ? "Saving…"
                        : phase === "error"
                          ? ""
                          : "Tap to start"}
            </div>

            {phase === "error" ? (
              <div
                style={{
                  padding: "10px 12px",
                  borderRadius: 10,
                  background: "#f9ece8",
                  border: "1px solid #f0d6cd",
                  color: "var(--red)",
                  fontSize: 12.5,
                  maxWidth: 380,
                  textAlign: "center",
                }}
              >
                {reason}
              </div>
            ) : null}

            {/* big button */}
            {phase === "idle" || phase === "error" || phase === "starting" ? (
              <button
                type="button"
                onClick={onRecord}
                disabled={busy}
                aria-label="Record"
                style={{
                  width: 132,
                  height: 132,
                  borderRadius: "50%",
                  border: "none",
                  background: "var(--accent)",
                  color: "var(--accent-contrast, #16181b)",
                  fontSize: 15,
                  fontWeight: 700,
                  fontFamily: "var(--font-ui)",
                  boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
                  cursor: busy ? "default" : "pointer",
                  opacity: busy ? 0.6 : 1,
                }}
              >
                {phase === "error" ? "Try again" : "Record"}
              </button>
            ) : (
              <button
                type="button"
                onClick={phase === "recording" ? onPause : onResume}
                disabled={busy}
                aria-label={phase === "recording" ? "Pause" : "Resume"}
                style={{
                  width: 132,
                  height: 132,
                  borderRadius: "50%",
                  border: phase === "recording" ? "none" : "2px solid var(--red)",
                  background: phase === "recording" ? "var(--red)" : "#fff",
                  color: phase === "recording" ? "#fff" : "var(--red)",
                  fontSize: 15,
                  fontWeight: 700,
                  fontFamily: "var(--font-ui)",
                  boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
                  cursor: busy ? "default" : "pointer",
                  opacity: busy ? 0.6 : 1,
                  animation: phase === "recording" ? "pk-rec-pulse 1.6s ease-in-out infinite" : undefined,
                }}
              >
                {phase === "recording" ? "Pause" : "Resume"}
              </button>
            )}
          </>
        )}
      </div>

      {/* what to remember + stop */}
      {phase !== "checking" && phase !== "unavailable" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <div className="pk-field-label">What to remember (optional)</div>
            <input
              className="pk-input"
              value={remember}
              maxLength={120}
              placeholder="e.g. main curtain + rigging walkthrough"
              onChange={(e) => setRemember(e.target.value)}
              disabled={busy}
            />
          </div>
          <button
            type="button"
            className="pk-btn-danger"
            onClick={onStop}
            disabled={!live || busy}
            style={{ width: "100%", padding: "14px 16px", fontSize: 15, opacity: !live || busy ? 0.5 : 1 }}
          >
            {phase === "saving" ? "Saving…" : "Stop & save"}
          </button>
          {pendingCount > 0 ? (
            <div className="pk-page-sub" style={{ textAlign: "center" }}>
              {queue?.active
                ? `Uploading ${queue.active.recordingId} · ${queue.active.percentage}%`
                : `${pendingCount} recording${pendingCount === 1 ? "" : "s"} waiting to upload from this device`}
            </div>
          ) : null}
        </div>
      ) : null}

      <style>{`@keyframes pk-rec-pulse { 0%,100% { box-shadow: 0 8px 24px rgba(0,0,0,0.12); } 50% { box-shadow: 0 8px 24px rgba(0,0,0,0.12), 0 0 0 14px rgba(180,84,58,0.15); } }`}</style>
    </div>
  );
}
