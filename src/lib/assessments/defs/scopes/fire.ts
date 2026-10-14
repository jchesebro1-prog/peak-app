/* S4 Fire and life safety — fire curtain, smoke vents, emergency lighting, alarm, extinguishers
   (rules F1–F5). */
import type { ScopeDef } from "../types";
import { date, num, one, RULE_ONLY, text, yn } from "../q";

export const FIRE_SCOPE: ScopeDef = {
  code: "S4",
  key: "fire",
  title: "Fire and life safety",
  modules: [
    {
      id: "fire.screen",
      title: "Fire and life safety",
      questions: [
        yn("fire_curtain.present", "Fire safety curtain present?"),
        yn("smoke_vents.present", "Smoke vents above the stage?"),
        yn("emergency_lighting.present", "Emergency lighting present?"),
        one("fire.exit_signs", "Exit signs lit", "working"),
        one("fire.alarm_on_stage", "Fire alarm notification on stage?", "yes_no_unknown"),
        yn("fire.extinguishers", "Extinguishers present and charged?"),
      ],
    },
    {
      id: "fire.curtain",
      title: "Fire curtain",
      when: RULE_ONLY,
      questions: [
        one("fire_curtain.type", "Type", "fire_curtain_type", { profile: true }),
        text("fire_curtain.manufacturer", "Manufacturer", { profile: true }),
        num("fire_curtain.install_year", "Installation year", { profile: true }),
        text("fire_curtain.release_stations", "Release stations"),
        text("fire_curtain.release_link", "Release link, as labeled"),
        one("fire_curtain.smoke_seals", "Smoke seals and smoke pockets in place?", "yes_no_unknown"),
        one("fire_curtain.alarm_interface", "Alarm interface?", "yes_no_unknown"),
        date("fire_curtain.last_drop_test", "Last drop test"),
        yn("fire_curtain.test_log", "Test log on site?"),
        yn("fire_curtain.closed_when_idle", "Closed when the stage is not in use?"),
      ],
      photos: [
        { id: "fire.curtain:release_station", label: "Release station" },
        { id: "fire.curtain:curtain_face", label: "Curtain face, if visible" },
        { id: "fire.curtain:test_log", label: "Test log" },
      ],
    },
    {
      id: "fire.smoke_vents",
      title: "Smoke vents",
      when: RULE_ONLY,
      questions: [
        one("smoke_vents.condition", "Vent condition", "condition"),
        one("smoke_vents.penthouse", "Roof penthouse condition", "condition"),
        date("smoke_vents.last_test", "Last test date"),
        one("smoke_vents.tested_with_curtain", "Tested with the curtain?", "yes_no_unknown"),
      ],
    },
    {
      id: "fire.emergency_lighting",
      title: "Emergency lighting",
      when: RULE_ONLY,
      questions: [
        date("emergency_lighting.monthly_test", "Last monthly test"),
        date("emergency_lighting.battery_test", "Last battery discharge test"),
        yn("emergency_lighting.backstage", "Backstage covered?"),
      ],
    },
  ],
};
