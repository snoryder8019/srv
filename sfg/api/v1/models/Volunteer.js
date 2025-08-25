import ModelHelper from "./helpers/models.js";
//this.modelFields will help dynamically load crud operation for the frontend.
//>v1>models>helpers>fields.js
//ModelHelper is a crud helper for the backend
const volunteerDropdown = ['Community Service', 'Event Support', 'Administrative Assistance'];
export default class Volunteer extends ModelHelper{
  constructor(volunteerData){
    super('volunteers');

     this.modelFields ={
     name: {type:'text', value:null, editable:true},
     email: {type:'email', value:null, editable:true},
     phone: {type:'tel', value:null, editable:true},
     work: {type:'dropdown', value:{options:["Community Service", "Event Support", "Administrative Assistance"]}, editable:true}
    }
  }
  static modelFields ={
    name: {type:'text', value:null, editable:null},
    email: {type:'email', value:null, editable:null},
    phone: {type:'tel', value:null, editable:null},
    work: {type:'dropdown', value:{options:["Community Service", "Event Support", "Administrative Assistance"]}, editable:true}
    }
}