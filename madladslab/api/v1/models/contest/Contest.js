// /api/v1/ep/models/contest/Contest.js
import ModelHelper from "../helpers/models.js";

export default class Contest extends ModelHelper {
  static modelFields = {
    startDate: { type: "date",   formType: "HIDDEN" },
    endDate:   { type: "date",   formType: "HIDDEN" },
    status:    { type: "string", formType: "DROPDOWN" }, // active, ended
    prize:     { type: "string", formType: "INPUT" }
  };

  constructor() {
    super("contest_meta");
  }
}
