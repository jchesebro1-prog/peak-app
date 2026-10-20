/* S7 Access and logistics — load-in, lifts, ladders, fall protection, working conditions for later crews
   (rules X1, X2). */
import type { ScopeDef } from "../types";
import { ftin, one, RULE_ONLY, text, yn } from "../q";

export const ACCESS_SCOPE: ScopeDef = {
  code: "S7",
  key: "access",
  title: "Access and logistics",
  modules: [
    {
      id: "access.screen",
      title: "Access and logistics",
      questions: [
        yn("access.lift_needed", "Is a lift needed for the work?"),
        text("access.anchors", "Fall-arrest anchor points"),
        text("access.ladders_lifts", "Ladders and lifts available on site"),
      ],
    },
    {
      id: "access.load_in",
      title: "Load-in",
      when: RULE_ONLY,
      questions: [
        one("access.load_in_door_type", "Load-in door type", "door_type"),
        text("access.load_in_door", "Load-in dock or door location"),
        text("access.load_in_size", "Dock or door size"),
        text("access.load_in_route", "Route to the stage"),
        text("access.load_in_elevator", "Elevator size"),
        text("access.load_in_floor", "Floor type along the route"),
      ],
    },
    {
      id: "access.lift",
      title: "Lift for the work",
      when: RULE_ONLY,
      questions: [
        one("access.lift_type", "Lift type", "lift_type"),
        ftin("access.lift_height", "Working height"),
        text("access.lift_supplier", "Who supplies the lift"),
        yn("access.lift_fits", "Can it get into the building?"),
      ],
    },
  ],
};
