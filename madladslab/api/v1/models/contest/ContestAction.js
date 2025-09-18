// /api/v1/ep/models/contest/ContestAction.js
import ModelHelper from "../helpers/models.js";

export default class ContestAction extends ModelHelper {
  static modelFields = {
    playerId:   { type: "string", formType: "HIDDEN" },
    ownerId:    { type: "string", formType: "HIDDEN" }, // for steals
    action:     { type: "string", formType: "DROPDOWN" }, // foodRun, drinkRun, preBus, mistake, steal
    points:     { type: "number", formType: "HIDDEN" },
    status:     { type: "string", formType: "HIDDEN" }, // pending, approved, rejected
    approvedBy: { type: "string", formType: "HIDDEN" },
    createdAt:  { type: "date",   formType: "HIDDEN" }
  };

  constructor() {
    super("contest_actions");
  }
}
