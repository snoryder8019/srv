import ModelHelper from "../helpers/models.js";
//this.modelFields will help dynamically load crud operation for the frontend.
//>v1>models>helpers>fields.js
//ModelHelper is a crud helper for the backend
export default class Qrs extends ModelHelper{
  constructor(qrsData){
    super('qrs');
  }
  static modelFields ={
      type: {type:'text', value:null, editable:true}, //website, form, coupon, event, 
     url: {type:'text', value:null, editable:true},
     name: {type:'text', value:null, editable:true},
     description: {type:'text', value:null, editable:true},
    }
  }


