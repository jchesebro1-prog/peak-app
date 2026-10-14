"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { isNativePlatform } from "@/lib/platform";
import { BRIEF_REMINDER_IDS, BRIEF_REMINDER_TARGET, isBriefReminderId, reminderNotifications } from "@/lib/brief/reminders";

/**
 * AI daily brief §5 — the two daily phone reminders. Mounted once in the
 * (app) layout; does nothing outside the Capacitor app. `enabled` is decided
 * on the server (Assist pilot + Daily brief on + the Account pref): true
 * schedules 6:45 and 13:45 device-local repeating notifications, false
 * cancels them. A tap goes to `/?brief=1`.
 *
 * The plugin is loaded with a dynamic import inside the effects — never at
 * module load — so the web bundle and server render never touch it. Every
 * native call is in a try/catch: a missing plugin (an app build from before
 * `npx cap sync`) or a denied permission just means no reminders.
 */
export default function NativeBriefReminders({ enabled }: { enabled: boolean }) {
  const router = useRouter();

  useEffect(() => {
    if (!isNativePlatform()) return;
    let cancelled = false;
    void (async () => {
      try {
        const { LocalNotifications } = await import("@capacitor/local-notifications");
        if (cancelled) return;
        if (!enabled) {
          await LocalNotifications.cancel({ notifications: BRIEF_REMINDER_IDS.map((id) => ({ id })) });
          return;
        }
        // Ask once: after a decision the plugin reports it without prompting again.
        let display = (await LocalNotifications.checkPermissions()).display;
        if (display === "prompt" || display === "prompt-with-rationale") {
          display = (await LocalNotifications.requestPermissions()).display;
        }
        if (cancelled || display !== "granted") return;
        // Fixed ids: scheduling again replaces the pair, never stacks a second.
        await LocalNotifications.schedule({ notifications: reminderNotifications() });
      } catch {
        /* no plugin / no permission — no reminders */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  useEffect(() => {
    if (!isNativePlatform()) return;
    let cancelled = false;
    let remove: (() => Promise<void>) | null = null;
    void (async () => {
      try {
        const { LocalNotifications } = await import("@capacitor/local-notifications");
        const handle = await LocalNotifications.addListener("localNotificationActionPerformed", (e) => {
          if (isBriefReminderId(e?.notification?.id)) router.push(BRIEF_REMINDER_TARGET);
        });
        if (cancelled) void handle.remove().catch(() => {});
        else remove = () => handle.remove();
      } catch {
        /* no plugin — nothing to listen to */
      }
    })();
    return () => {
      cancelled = true;
      void remove?.().catch(() => {});
    };
  }, [router]);

  return null;
}
