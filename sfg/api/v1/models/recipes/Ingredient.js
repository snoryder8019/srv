import ModelHelper from "../helpers/models.js";
//this.modelFields will help dynamically load crud operation for the frontend.
//>v1>models>helpers>fields.js
//ModelHelper is a crud helper for the backend
export default class Ingredient extends ModelHelper{
  constructor(ingredientData){
    super('ingredients');
  }
    static modelFields ={
      name: {type:'text', value:null, editable:true},
      type: {type:'text', value:null, editable:true},
      brand: {type:'text', value:null, editable:true},
    }
}