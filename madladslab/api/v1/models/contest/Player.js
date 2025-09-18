// /api/v1/ep/models/contest/Player.js
import ModelHelper from "../helpers/models.js";

export default class Player extends ModelHelper {
  static modelFields = {
    name:    { type: "string",  formType: "INPUT" },
    avatar:  { type: "string",  formType: "INPUT" },
    joinedAt:{ type: "date",    formType: "HIDDEN" }
  };

  constructor() {
    super("contest_players");
  }
}
