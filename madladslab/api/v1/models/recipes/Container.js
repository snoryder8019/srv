import ModelHelper from "../helpers/models.js";

export default class Container extends ModelHelper {
  constructor(containerData) {
    super('containers');
  }

  static modelFields = {
    name: { type: 'text', value: null, editable: true },
    type: { type: 'text', value: null, editable: true },
    size: { type: 'text', value: null, editable: true },
  };
}
