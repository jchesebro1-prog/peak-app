"use client";

import { useEffect, useRef } from "react";
import { recordShareOpenAction } from "./actions";

/** #301 slice B — records one open per page load (R18). Strict Mode's
 *  double effect is absorbed by the ref; failures are swallowed (no UI). */
export function OpenBeacon({ id, token }: { id: string; token: string }) {
  const sent = useRef(false);
  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    recordShareOpenAction(id, token).catch(() => undefined);
  }, [id, token]);
  return null;
}
