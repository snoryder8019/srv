import ModelHelper from "./helpers/models.js";

export default class Skin extends ModelHelper {
  constructor() {
    super('skins');
    this.modelFields = {
      name:           { type: 'text',    value: null, editable: true },
      category:       { type: 'text',    value: null, editable: true },
      description:    { type: 'text',    value: null, editable: true },
      layout:         { type: 'text',    value: null, editable: true },
      primaryColor:   { type: 'text',    value: null, editable: true },
      secondaryColor: { type: 'text',    value: null, editable: true },
      accentColor:    { type: 'text',    value: null, editable: true },
      bgColor:        { type: 'text',    value: null, editable: true },
      textColor:      { type: 'text',    value: null, editable: true },
      fontBody:       { type: 'text',    value: null, editable: true },
      fontHeading:    { type: 'text',    value: null, editable: true },
      borderRadius:   { type: 'text',    value: null, editable: true },
      darkMode:       { type: 'boolean', value: null, editable: true },
      customCss:      { type: 'text',    value: null, editable: true },
      tags:           { type: 'array',   value: null, editable: true },
      createdBy:      { type: 'text',    value: null, editable: false },
      createdAt:      { type: 'date',    value: null, editable: false },
      updatedAt:      { type: 'date',    value: null, editable: false },
    };
  }
}
