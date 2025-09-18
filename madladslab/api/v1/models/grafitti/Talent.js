import ModelHelper from "../helpers/models.js";
//this.modelFields will help dynamically load crud operation for the frontend.
//>v1>models>helpers>fields.js
//ModelHelper is a crud helper for the backend
export default class Talent extends ModelHelper{
  constructor(talentData){
    super('talents');
  }
  static modelFields ={
      type: {type:'text', value:null, editable:true}, //comedy, music, artwork,manager, prodCo, other
    name: {type:'text', value:null, editable:true},
      email: {type:'text', value:null, editable:true},
      website:{type:'text', value:null, editable:true},
      phone: {type:'text', value:null, editable:true},
      history: {type:'text', value:null, editable:true},//performance history
    }
  }


