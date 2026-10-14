/* S2 Rigging — overhead rigging systems and access structures; two depths, screen or full intake
   (rules R1–R12). Screening only: an ETCP-certified rigger does the actual inspection. */
import type { ScopeDef } from "../types";
import { answered, date, ftin, is, long, many, num, one, RULE_ONLY, text, yn } from "../q";

const count = (key: string, label: string) => num(key, label);

export const RIGGING_SCOPE: ScopeDef = {
  code: "S2",
  key: "rigging",
  title: "Rigging",
  depths: ["screen", "full"],
  modules: [
    {
      id: "rigging.system",
      title: "Rigging system",
      questions: [
        one("rigging.overhead", "Overhead rigging system type", "overhead", { profile: true, required: true }),
        yn("rigging.hanging_positions", "Any hanging positions for fixtures?", { when: is("rigging.overhead", "none") }),
        many("rigging.access", "Grid, loading bridge or catwalk present", "rig_access"),
        yn("rigging.pit_lift", "Orchestra pit lift or filler present?"),
      ],
    },
    {
      id: "rigging.screen",
      title: "Rigging screen",
      when: answered("rigging.overhead"),
      questions: [
        num("rigging.total_sets", "Total number of rigged sets", { profile: true }),
        yn("rigging.rope_sets", "Rope (sandbag) sets present?"),
        num("rigging.install_year", "Year the rigging was installed, if known", { profile: true }),
        many("rigging.operators", "Who operates the system", "operators"),
        text("rigging.training_summary", "What training the operators have"),
        many("rigging.red_flags", "Visible red flags", "red_flags", {
          flag: {
            values: ["unrated_hardware", "improvised", "bent_battens", "unmoused_shackles", "frayed_cable", "loose_collars", "unlabeled_weights"],
            category: "RIG", rating: "immediate", text: "Rigging red flag seen", requirePhoto: true,
          },
        }),
        yn("rigging.alteration_since", "Any alteration or repair since the last inspection?"),
        yn("rigging.signage", "Operating signage posted?"),
        yn("rigging.manuals", "Operations manuals on site?"),
        yn("rigging.maintenance_log", "Maintenance log kept?"),
        yn("rigging.schedule_posted", "Line set schedule posted or on file?", { help: "Photograph or copy it." }),
        text("rigging.who_inspects", "Who inspects the rigging, and when"),
      ],
    },
    {
      id: "rigging.counterweight",
      title: "Counterweight",
      when: RULE_ONLY,
      questions: [
        count("rigging.cw_sets", "Number of counterweight sets"),
        one("rigging.cw_purchase", "Single or double purchase", "purchase", { profile: true }),
        one("rigging.cw_arbor_type", "Arbor type", "arbor_type"),
        one("rigging.cw_guide_type", "Guide type", "guide_type"),
        yn("rigging.cw_lock_rail", "Lock rail present?"),
        yn("rigging.cw_loading_gallery", "Loading gallery or bridge?"),
        yn("rigging.cw_rail_log", "Rail log kept?"),
        yn("rigging.cw_temp_labels", "Lock rail labeling separates temporary from permanent line sets?"),
      ],
      photos: [
        { id: "rigging.counterweight:lock_rail", label: "Lock rail" },
        { id: "rigging.counterweight:guide_wall", label: "Guide wall" },
        { id: "rigging.counterweight:head_block", label: "A head block" },
        { id: "rigging.counterweight:termination", label: "A lift line termination" },
        { id: "rigging.counterweight:signage", label: "Operating signage" },
      ],
    },
    {
      id: "rigging.wire_rope",
      title: "Wire rope",
      when: RULE_ONLY,
      questions: [
        text("rigging.wire_rope_type", "Wire rope type"),
        text("rigging.wire_rope_age", "Wire rope age, if known"),
        one("rigging.termination", "Termination type", "termination"),
      ],
    },
    {
      id: "rigging.motorized",
      title: "Motorized",
      when: RULE_ONLY,
      questions: [
        count("rigging.motor_count", "Number of motors"),
        text("rigging.motor_manufacturer", "Manufacturer"),
        text("rigging.motor_model", "Model"),
        one("rigging.hoist_type", "Hoist type", "hoist_type"),
        text("rigging.controller", "Controller type"),
        yn("rigging.estop", "Emergency stop?", { flag: { values: ["no"], category: "RIG", rating: "needs", text: "No emergency stop on a motorized system" } }),
        yn("rigging.hold_to_run", "Hold-to-run controls?", { flag: { values: ["no"], category: "RIG", rating: "needs", text: "No hold-to-run control on a motorized system" } }),
        one("rigging.limit_switches", "Limit switches?", "yes_no_unknown"),
        text("rigging.power_service", "Power service for the hoists"),
        text("rigging.control_position", "Control position and sight line"),
      ],
      photos: [
        { id: "rigging.motorized:nameplates", label: "Nameplates" },
        { id: "rigging.motorized:control_station", label: "Control station" },
        { id: "rigging.motorized:hoist", label: "Any hoist", optional: true },
      ],
    },
    {
      id: "rigging.rope_set_detail",
      title: "Rope (sandbag) sets",
      when: RULE_ONLY,
      questions: [
        count("rigging.rope_set_count", "Number of rope (sandbag) sets"),
        one("rigging.rope_set_condition", "Visible condition", "condition"),
      ],
    },
    {
      id: "rigging.dead_hung",
      title: "Dead hung",
      when: RULE_ONLY,
      questions: [
        count("rigging.dh_points", "Number of rigging points"),
        text("rigging.dh_style", "Rigging point style"),
        ftin("rigging.dh_spacing", "Rigging point spacing"),
        one("rigging.dh_beam_type", "Beam type", "beam_type"),
        ftin("rigging.dh_beam_spacing", "Beam spacing"),
        one("rigging.dh_beam_direction", "Beam direction", "beam_direction"),
        ftin("rigging.dh_ceiling_height", "Ceiling height"),
        ftin("rigging.dh_batten_span", "Batten span"),
        yn("rigging.dh_end_caps", "End caps on batten ends?"),
      ],
      photos: [
        { id: "rigging.dead_hung:overhead_corner_1", label: "Overhead, from the first corner" },
        { id: "rigging.dead_hung:overhead_corner_2", label: "Overhead, from the second corner" },
      ],
    },
    {
      id: "rigging.access_fall",
      title: "Access and fall",
      when: RULE_ONLY,
      questions: [
        yn("rigging.access_handrails", "Handrails in place?"),
        yn("rigging.access_gaps", "Gaps in the walking surface or rails?"),
        yn("rigging.access_lighting", "Adequately lit?"),
        text("rigging.access_fall_protection", "Fall protection in place"),
        text("rigging.access_who", "Who has access"),
        yn("rigging.access_locked", "Locked or caged when not in use?"),
        yn("rigging.fall_hazard", "Fall hazard at the grid, bridge or catwalk?", {
          flag: { values: ["yes"], category: "RIG", rating: "immediate", text: "Fall hazard at grid/bridge/catwalk", requirePhoto: true },
        }),
      ],
      photos: [
        { id: "rigging.access_fall:gaps", label: "Every gap or missing rail", optional: true },
        { id: "rigging.access_fall:access_point", label: "The access point" },
      ],
    },
    {
      id: "rigging.training",
      title: "Operator training",
      when: RULE_ONLY,
      questions: [
        yn("rigging.training_records", "Training records kept?"),
        yn("rigging.authorized_list", "Authorized user list?"),
        text("rigging.supervision", "Supervision practice"),
      ],
    },
    {
      id: "rigging.pit_lift_detail",
      title: "Orchestra pit lift",
      when: RULE_ONLY,
      questions: [
        text("rigging.pit_lift_manufacturer", "Manufacturer"),
        text("rigging.pit_lift_voltage", "Voltage"),
        one("rigging.pit_lift_condition", "Condition", "condition"),
        date("rigging.pit_lift_last_service", "Last service"),
      ],
    },
    {
      id: "rigging.dimensions",
      title: "Stage dimensions (full intake)",
      when: RULE_ONLY,
      questions: [
        ftin("rigging.plaster_to_rear", "Plaster line to rear wall", { profile: true }),
        ftin("rigging.stagehouse_height", "Stagehouse height", { profile: true }),
        long("rigging.install_history", "Install history: installer, renovations, architect or theatre consultant"),
      ],
    },
    {
      id: "rigging.lineset_schedule",
      title: "Line set schedule",
      when: RULE_ONLY,
      questions: [
        {
          key: "rigging.lineset_table",
          label: "Line set schedule",
          type: "table",
          columns: [
            { key: "set", label: "Set", type: "text" },
            { key: "distance", label: "Distance from plaster line", type: "ftin" },
            { key: "hangs", label: "What hangs", type: "text" },
            { key: "fabric", label: "Fabric", type: "text" },
            { key: "qty", label: "Quantity", type: "number" },
            { key: "size", label: "Size", type: "text" },
            { key: "condition", label: "Condition", type: "one", options: "condition" },
            { key: "notes", label: "Notes", type: "text" },
          ],
        },
      ],
      photos: [{ id: "rigging.lineset_schedule:schedule", label: "Photo of the schedule, if posted", optional: true }],
    },
    {
      id: "rigging.hardware_inventory",
      title: "Hardware inventory",
      when: RULE_ONLY,
      questions: [
        count("rigging.hw_span_sets", "Span sets"),
        count("rigging.hw_shackles", "Shackles"),
        count("rigging.hw_cable", "Cable"),
        count("rigging.hw_tie_lines", "Tie lines"),
        count("rigging.hw_controllers", "Motor controllers"),
        count("rigging.hw_batten_clips", "Batten clips"),
        count("rigging.hw_end_caps", "End caps"),
        count("rigging.hw_cable_cradles", "Cable cradles"),
      ],
      photos: [{ id: "rigging.hardware_inventory:unrated", label: "Any unrated or improvised hardware", optional: true }],
    },
  ],
};
