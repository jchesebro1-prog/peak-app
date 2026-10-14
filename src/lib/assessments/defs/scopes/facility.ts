/* S1 Facility and house — seating, egress, ADA, finishes, water, hazardous materials (rules H1–H7). */
import type { ScopeDef } from "../types";
import { ftin, is, long, many, num, one, RULE_ONLY, text, yn } from "../q";

export const FACILITY_SCOPE: ScopeDef = {
  code: "S1",
  key: "facility",
  title: "Facility and house",
  modules: [
    {
      id: "house.screen",
      title: "House, egress and finishes",
      questions: [
        yn("house.balcony", "Is there a balcony?"),
        yn("house.lift_present", "Is there a lift to the house or stage?"),
        yn("house.above_grade", "Is the house or stage above grade?"),
        yn("house.accessible_route", "Is there a lift or ramp giving an accessible route?", { when: is("house.above_grade", "yes") }),
        yn("house.water_damage", "Water damage, water stains or roof leak evidence?"),
        many("house.suspect_materials", "Suspected mold, or finishes that may contain asbestos (sound panels, vintage floor tile)", "suspect_materials"),
        yn("house.trap_doors", "Trap doors?"),
        yn("house.orchestra_pit", "Orchestra pit?"),
        one("house.plaster", "Plaster condition", "condition"),
        one("house.stage_deck", "Stage deck condition", "condition"),
        one("house.flooring", "House flooring condition", "condition"),
        yn("house.booth_present", "Is there a booth or control position?"),
      ],
    },
    {
      id: "house.lift",
      title: "Lift",
      when: is("house.lift_present", "yes"),
      questions: [yn("house.lift_working", "Is the lift working?")],
      photos: [{ id: "house.lift:lift", label: "Lift" }],
    },
    {
      id: "house.seating",
      title: "Seating and egress",
      when: RULE_ONLY,
      questions: [
        text("house.layout", "House layout"),
        one("house.seat_condition", "Seat anchorage and condition", "condition"),
        num("house.broken_seats", "Broken seats"),
        ftin("house.aisle_width", "Narrowest aisle width", { help: "36 inches is a typical minimum." }),
        one("house.step_lights", "Aisle step lights working", "working"),
        num("house.wheelchair_spaces", "Wheelchair spaces"),
        num("house.companion_seats", "Companion seats"),
        one("house.exit_hardware", "Exit doors and panic hardware working", "working"),
        yn("house.exits_clear", "Exits clear?", {
          flag: { values: ["no"], category: "STR", rating: "immediate", text: "Exit blocked", requirePhoto: true },
        }),
      ],
      photos: [
        { id: "house.seating:exits", label: "Exits" },
        { id: "house.seating:broken_seats", label: "Any broken seats" },
      ],
    },
    {
      id: "house.balcony_detail",
      title: "Balcony",
      when: RULE_ONLY,
      questions: [
        text("house.balcony_dims", "Balcony dimensions"),
        text("house.balcony_exits", "Balcony exits"),
        one("house.balcony_rail", "Balcony rail condition", "condition"),
      ],
    },
    {
      id: "house.booth_detail",
      title: "Booth or control position",
      when: is("house.booth_present", "yes"),
      questions: [
        text("house.booth_size", "Booth size"),
        text("house.booth_access", "Booth access"),
        text("house.booth_ventilation", "Booth ventilation"),
        text("house.booth_sightlines", "Sight lines from the booth"),
      ],
    },
    {
      id: "house.water",
      title: "Water damage",
      when: RULE_ONLY,
      questions: [
        text("house.water_location", "Location of the water damage"),
        yn("house.water_active_leak", "Active leak?"),
        yn("house.water_mold_smell", "Smell of mold?"),
      ],
      photos: [{ id: "house.water:affected_area", label: "Each affected area" }],
    },
    {
      id: "house.hazmat",
      title: "Suspect materials (do not disturb)",
      when: RULE_ONLY,
      questions: [
        long("house.hazmat_location", "Where, and what was seen", { help: "Do not disturb; no sampling by the assessor." }),
        one("house.hazmat_testing", "Testing status", "hazmat_testing"),
      ],
      photos: [{ id: "house.hazmat:affected_area", label: "Each affected area" }],
    },
    {
      id: "house.traps_pit",
      title: "Trap doors and orchestra pit",
      when: RULE_ONLY,
      questions: [
        yn("house.traps_guarded", "Guarded?", {
          flag: { values: ["no"], category: "STR", rating: "immediate", text: "Trap door or orchestra pit unguarded", requirePhoto: true },
        }),
        one("house.traps_condition", "Condition", "condition"),
        text("house.traps_access", "Access control"),
      ],
      photos: [{ id: "house.traps_pit:affected_area", label: "Each affected area" }],
    },
  ],
};
