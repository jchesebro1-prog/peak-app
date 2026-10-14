/* S5 Lighting and power — stage and house lighting, dimming, control, power distribution (rules L1–L9).
   Observation only: never open panels or test energized equipment. */
import type { Cond, ScopeDef } from "../types";
import { answered, is, long, many, num, one, RULE_ONLY, text, yn } from "../q";

/** L9: any power hazard selected other than "none" (many → any overlap). */
export const POWER_HAZARD_SEEN: Cond = {
  all: [answered("power.hazards"), { not: { key: "power.hazards", state: "unable" } }, { not: is("power.hazards", "none") }],
};

export const LIGHTING_SCOPE: ScopeDef = {
  code: "S5",
  key: "lighting",
  title: "Lighting and power",
  modules: [
    {
      id: "lighting.screen",
      title: "Lighting",
      questions: [
        yn("stage_lighting.present", "Stage lighting present?"),
        one("lighting.plot_matches", "Lighting plot, hookup sheets and riser diagram match what is installed?", "yes_no_unknown"),
      ],
    },
    {
      id: "lighting.house_work",
      title: "House and work lighting",
      when: answered("stage_lighting.present"),
      questions: [
        text("house_lights.controls", "House and work lighting: type and controls"),
        one("house_lights.dimming", "House lights dim?", "yes_no_unknown"),
        num("house_lights.button_stations", "Button stations"),
        one("house_lights.working", "Working order", "working"),
        one("house_lights.work_circuit", "Work lights on a separate circuit?", "yes_no_unknown"),
      ],
    },
    {
      id: "lighting.stage",
      title: "Stage lighting",
      when: RULE_ONLY,
      questions: [
        num("lighting.system_year", "Approximate year the system was installed"),
        one("lighting.system_type", "Type of system", "lighting_type"),
        text("lighting.power_control", "Power control"),
        text("lighting.emergency_arrangement", "Emergency lighting arrangement"),
        yn("dimmer_racks.present", "Dimmer or relay racks present?"),
        yn("console.present", "Lighting console present?"),
        many("control.protocol", "Control signals in use", "protocol"),
        text("control.splitters", "Splitters and terminators"),
        yn("fixtures.overhead", "Overhead fixtures?"),
        num("lighting.pipes", "Number of pipes (electrics)"),
        many("lighting.positions", "Lighting positions", "lighting_position"),
        num("lighting.circuits", "Circuits"),
        text("lighting.data_outs", "Data outs: DMX or Ethernet drop locations"),
        one("lighting.connector", "Connector type", "connector"),
        text("lighting.trim_heights", "Trim heights"),
      ],
      photos: [{ id: "lighting.stage:pipes", label: "Pipes" }],
    },
    {
      id: "lighting.dimmers",
      title: "Dimmer racks",
      when: RULE_ONLY,
      questions: [
        text("dimmer_racks.make", "Make"),
        text("dimmer_racks.model", "Model"),
        num("dimmer_racks.age", "Approximate year installed"),
        one("dimmer_racks.condition", "Condition", "condition"),
        yn("dimmer_racks.ventilation", "Fans and ventilation clear?"),
        one("dimmer_racks.support", "Manufacturer support status", "support"),
        one("dimmer_racks.parts_available", "Parts available?", "yes_no_unknown", {
          flag: { values: ["no"], category: "ELC", rating: "needs", text: "Dimmer rack parts unavailable" },
        }),
      ],
      photos: [{ id: "lighting.dimmers:nameplate", label: "Dimmer rack nameplate" }],
    },
    {
      id: "lighting.console",
      title: "Lighting console",
      when: RULE_ONLY,
      questions: [
        text("console.make_type", "Console make and type"),
        one("console.working", "Working?", "working"),
        one("console.backup", "Backup scenes saved?", "yes_no_unknown"),
      ],
      photos: [{ id: "lighting.console:console", label: "Console" }],
    },
    {
      id: "lighting.network",
      title: "Lighting network",
      when: RULE_ONLY,
      questions: [
        one("control.isolated", "Network isolated from the school network?", "yes_no_unknown"),
        one("control.addressing", "Addressing documented?", "yes_no_unknown"),
      ],
    },
    {
      id: "lighting.fixtures",
      title: "Overhead fixtures",
      when: is("fixtures.overhead", "yes"),
      questions: [
        {
          key: "fixtures.inventory",
          label: "Fixtures by type and count",
          type: "table",
          columns: [
            { key: "type", label: "Type", type: "one", options: "fixture_type" },
            { key: "model", label: "Model", type: "text" },
            { key: "qty", label: "Quantity", type: "number" },
            { key: "notes", label: "Notes", type: "text" },
          ],
        },
        one("fixtures.safety_cables", "Safety cable on every fixture?", "cables"),
        one("fixtures.cable_support", "Cable support", "condition"),
        one("fixtures.pipe_overload", "Any pipe overloaded?", "yes_no_unknown"),
      ],
    },
    {
      id: "lighting.power",
      title: "Power",
      questions: [
        yn("stage_panel.present", "Stage power panel present?"),
        yn("power.fused_disconnects", "Fused disconnects visible?"),
        many("power.hazards", "Damaged cable, improvised adapters or bare-end feeders seen?", "power_hazards"),
        text("power.hazard_location", "Location of the damaged cable, adapters or feeders", { when: POWER_HAZARD_SEEN }),
        long("power.path", "Power path: source, disconnect, feeder, distribution and branch circuits for the stage; panel locations and labels"),
        text("power.overload", "Signs of overload or heat"),
        text("power.grounding_gfci", "Grounding and GFCI where the stage meets damp locations or the public can reach outlets"),
        one("power.connector_condition", "Connector condition", "condition"),
        one("power.cable_condition", "Cable condition: damage, tape repairs, missing strain relief, cable carrying a load", "condition"),
        text("power.lockout", "Lockout/tagout procedure for stage equipment, and who is allowed to operate lighting"),
      ],
    },
    {
      id: "lighting.stage_panel",
      title: "Stage panel (observe only)",
      when: RULE_ONLY,
      questions: [
        yn("stage_panel.labeled", "Panel labeled?"),
        yn("stage_panel.schedule_posted", "Panel schedule posted?"),
        yn("stage_panel.clearance", "36 inches clear in front of the panel?", {
          flag: { values: ["no"], category: "ELC", rating: "needs", text: "Panel clearance under 36 inches" },
        }),
        text("stage_panel.spare_capacity", "Spare capacity, as reported"),
      ],
      photos: [{ id: "lighting.stage_panel:exterior", label: "Panel exterior and labels, never opened" }],
    },
  ],
};
