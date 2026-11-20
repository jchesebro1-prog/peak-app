"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
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
 * wrapper every save goes through.
 * A group stays mounted (hidden) once opened, so an unsaved draft or a
 * running geocode batch survives a trip to another group — the same as when
 * every card's state lived in this one component.
 */

export default function SettingsClient({
  sections,
  ...data
}: SettingsData & {
  /** The groups this viewer may open (visibleSettingsSections), menu order. */
  sections: SettingsSection[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
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
            estimateOutput={data.estimateOutput}
            pipelines={data.pipelines}
            pipelineUsage={data.pipelineUsage}
            customerFieldDefs={data.customerFieldDefs}
            assumptions={data.consultingAssumptions}
            run={run}
          />
        );
      case "field":
        return (
          <FieldGroup
            venueTypes={data.venueTypes}
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
