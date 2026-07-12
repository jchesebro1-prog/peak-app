"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import {
  getEngine,
  initialStatus,
  DATA_PULLED_EVENT,
  type SyncStatus,
} from "./engine";

/**
 * Mounts once in the app shell: starts the SyncEngine, registers the service
 * worker (so the app installs + loads offline), exposes live sync status to
 * the Nav chip via useSync(), and refreshes the current route when a pull
 * brings in office changes so server-rendered screens stay current.
 */

type SyncApi = SyncStatus & {
  setPaused: (v: boolean) => void;
  syncNow: () => void;
  timeAgo: (ts: number | null) => string;
};

const SyncContext = createContext<SyncApi | null>(null);

export function SyncProvider({ children }: { children: React.ReactNode }) {
  const engine = getEngine();
  // The first client render must produce the same markup the server did, so
  // start from the browser-independent snapshot; subscribe() below delivers
  // the real status (navigator.onLine, pause flag) right after mount.
  const [status, setStatus] = useState<SyncStatus>(initialStatus);
  const router = useRouter();

  useEffect(() => {
    engine.start();
    const unsub = engine.subscribe(setStatus);
    // Register the PWA service worker (best-effort; dev + prod both fine).
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
    const onPulled = () => router.refresh();
    window.addEventListener(DATA_PULLED_EVENT, onPulled);
    return () => {
      unsub();
      window.removeEventListener(DATA_PULLED_EVENT, onPulled);
    };
    // engine is a stable singleton; router is stable — run once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const api = useMemo<SyncApi>(
    () => ({
      ...status,
      setPaused: (v: boolean) => engine.setPaused(v),
      syncNow: () => void engine.syncNow(),
      timeAgo: (ts: number | null) => engine.timeAgo(ts),
    }),
    [status, engine]
  );

  return <SyncContext.Provider value={api}>{children}</SyncContext.Provider>;
}

export function useSync(): SyncApi {
  const ctx = useContext(SyncContext);
  if (!ctx) {
    // Safe fallback if a component renders outside the provider (e.g. tests).
    const engine = getEngine();
    const s = engine.getStatus();
    return {
      ...s,
      setPaused: (v: boolean) => engine.setPaused(v),
      syncNow: () => void engine.syncNow(),
      timeAgo: (ts: number | null) => engine.timeAgo(ts),
    };
  }
  return ctx;
}
