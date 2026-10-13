"use client";

/**
 * #335 Inbox organization (spec §9) — refresh this page when another window
 * or tab changes a thread's filing, court, noise or archive state (the
 * `inbox-changed` message on BroadcastChannel("peak")), debounced 1 s.
 * Mounted by the Inbox shell and Home. Renders nothing.
 */
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { subscribeInboxChanged } from "@/lib/inbox-org/broadcast";

export default function InboxChangedListener() {
  const router = useRouter();
  useEffect(() => subscribeInboxChanged(() => router.refresh(), 1000), [router]);
  return null;
}
