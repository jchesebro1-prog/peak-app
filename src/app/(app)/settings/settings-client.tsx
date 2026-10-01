"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  integrationAnchor,
  resolveSettingsSection,
  settingsHref,
  SETTINGS_SECTIONS,
  type SettingsSection,
} from "./settings-sections";
import type { Run } from "./groups/shared";
import type { SettingsData } from "./groups/types";
import { CompanyGroup } from "./groups/company";
import { SalesGroup } from "./groups/sales";
import { FieldGroup } from "./groups/field";
import { ConsultingGroup } from "./groups/consulting";
import { IntegrationsGroup } from "./groups/integrations";
import { TeamGroup } from "./groups/team";
import { DataGroup } from "./groups/data";

/**
 * Settings — admin surface, ported from Settings.dc.html
 * (spec: docs/specs/settings-team.json). Settings cleanup (Oct 1, Jeff): a
 * left-hand menu of groups (SETTINGS_SECTIONS); `?section=<key>` picks one and
 * only that group's cards show. Each group's cards live in ./groups/*.tsx,
 * moved verbatim from this file's old Company / Admin sections.
 *
 * This shell owns what the groups share: the error banner and the `run`
 * wrapper every save goes through, the Gmail connect banner, and the
 * integration-card hash (`/settings#mailboxes` → Integrations, scrolled).
 * A group stays mounted (hidden) once opened, so an unsaved draft or a
 * running geocode batch survives a trip to another group — the same as when
 * every card's state lived in this one component.
 */

const GMAIL_BANNER: Record<string, { msg: string; ok: boolean }> = {
  connected: { msg: "Mailbox connected. Use “Get mail” in the Inbox to import history and receive new mail.", ok: true },
  disabled: { msg: "Gmail isn’t enabled on this deployment yet (set GMAIL_ENABLED once the API is configured — see DEPLOY §5).", ok: false },
  denied: { msg: "Google sign-in was cancelled — the mailbox wasn’t connected.", ok: false },
  forbidden: { msg: "You don’t have permission to connect that mailbox.", ok: false },
  badstate: { msg: "The connect link expired or didn’t match your session — try again.", ok: false },
  badmailbox: { msg: "Unknown mailbox.", ok: false },
  error: { msg: "Couldn’t finish connecting the mailbox. Please try again.", ok: false },
};

export default function SettingsClient({
  sections,
  ...data
}: SettingsData & {
  /** The groups this viewer may open (visibleSettingsSections), menu order. */
  sections: SettingsSection[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const gmailStatus = searchParams.get("gmail");
  const banner = gmailStatus ? GMAIL_BANNER[gmailStatus] : null;
  const sectionParam = searchParams.get("section");
  const section = resolveSettingsSection(sectionParam, { visible: sections });
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run: Run = (fn) =>
    startTransition(async () => {
      setError(null);
      const res = await fn();
      if (!res.ok) setError(res.error || "Something went wrong.");
      router.refresh();
    });

  // Groups opened so far stay mounted (hidden) — see the header comment.
  const [visited, setVisited] = useState<SettingsSection[]>([section]);
  if (!visited.includes(section)) setVisited([...visited, section]);

  // `/settings#mailboxes` / `#recordings` (the hash never reaches the server):
  // open Integrations, keeping the hash and any other params (e.g. ?gmail=).
  useEffect(() => {
    const anchor = integrationAnchor(window.location.hash);
    if (!anchor || sectionParam === "integrations") return;
    const qs = new URLSearchParams(window.location.search);
    qs.set("section", "integrations");
    router.replace(`/settings?${qs.toString()}#${anchor}`, { scroll: false });
  }, [sectionParam, router]);

  // …then bring the named card into view once Integrations is showing.
  useEffect(() => {
    if (section !== "integrations") return;
    const anchor = integrationAnchor(window.location.hash);
    if (!anchor) return;
    const id = setTimeout(() => document.getElementById(anchor)?.scrollIntoView({ block: "start" }), 0);
    return () => clearTimeout(id);
  }, [section]);

  const menu = SETTINGS_SECTIONS.filter((s) => sections.includes(s.key));

  const renderGroup = (key: SettingsSection) => {
    switch (key) {
      case "company":
        return <CompanyGroup settings={data.settings} offices={data.offices} run={run} setError={setError} />;
      case "sales":
        return (
          <SalesGroup
            users={data.users}
            reviewLimits={data.reviewLimits}
            pipelines={data.pipelines}
            pipelineUsage={data.pipelineUsage}
            customerFieldDefs={data.customerFieldDefs}
          />
        );
      case "field":
        return (
          <FieldGroup
            venueTypes={data.venueTypes}
            intakeCatalog={data.intakeCatalog}
            visitReasons={data.visitReasons}
            run={run}
          />
        );
      case "consulting":
        return (
          <ConsultingGroup
            consultingPhases={data.consultingPhases}
            consultingAssumptions={data.consultingAssumptions}
            phaseWeights={data.phaseWeights}
            consultingDisciplines={data.consultingDisciplines}
            run={run}
          />
        );
      case "integrations":
        return (
          <IntegrationsGroup
            gmail={data.gmail}
            recordings={data.recordings}
            catalogPhotos={data.catalogPhotos}
            run={run}
          />
        );
      case "team":
        return (
          <TeamGroup meId={data.meId} meName={data.meName} users={data.users} offices={data.offices} run={run} />
        );
      case "data":
        return (
          <DataGroup
            settings={data.settings}
            users={data.users}
            documentCategories={data.documentCategories}
            recordingsBetaUsers={data.recordings.betaUsers}
            run={run}
            setError={setError}
          />
        );
    }
  };

  return (
    <div className="pk-settings-layout">
      <div className="pk-settings-side">
        <nav aria-label="Settings groups" className="pk-settings-menu">
          {menu.map((s) => (
            <Link
              key={s.key}
              href={settingsHref(s.key)}
              aria-current={s.key === section ? "page" : undefined}
            >
              <span className="pk-settings-menu-label">{s.label}</span>
              <span className="pk-settings-menu-desc">{s.desc}</span>
            </Link>
          ))}
        </nav>
        <label className="pk-settings-select">
          <span className="pk-settings-select-label">Settings group</span>
          <select value={section} onChange={(e) => router.push(settingsHref(e.target.value as SettingsSection))}>
            {menu.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div style={{ minWidth: 0 }}>
        {error && (
          <div
            style={{
              background: "#f9ece8",
              border: "1px solid #f0d6cd",
              color: "#b4543a",
              borderRadius: 10,
              padding: "10px 14px",
              fontSize: 13,
              fontWeight: 500,
              marginBottom: 16,
            }}
          >
            {error}
          </div>
        )}

        {banner && (
          <div
            style={{
              background: banner.ok ? "#eaf6ef" : "#f9ece8",
              border: `1px solid ${banner.ok ? "#cce9da" : "#f0d6cd"}`,
              color: banner.ok ? "#1f7a52" : "#b4543a",
              borderRadius: 10,
              padding: "10px 14px",
              fontSize: 13,
              fontWeight: 500,
              marginBottom: 16,
            }}
          >
            {banner.msg}
          </div>
        )}

        {menu
          .filter((s) => visited.includes(s.key))
          .map((s) => (
            <div key={s.key} data-settings-group={s.key} hidden={s.key !== section}>
              {renderGroup(s.key)}
            </div>
          ))}
      </div>
    </div>
  );
}
