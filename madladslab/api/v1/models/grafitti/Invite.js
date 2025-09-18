import ModelHelper from "../helpers/models.js";
//this.modelFields will help dynamically load crud operation for the frontend.
//>v1>models>helpers>fields.js
//ModelHelper is a crud helper for the backend
export default class Invite extends ModelHelper{
  constructor(inviteData){
    super('invites');}
    static modelFields ={
        type: {type:'text', value:null, editable:true}, //calendar invite , coupon, comp, contest, emailer, likeness, testimony
      link: {type:'text', value:null, editable:true},
      email: {type:'text', value:null, editable:true},
      confirmed: {type:'boolean', value:null, editable:false},
      emailConsent: {type:'boolean', value:null, editable:false},
      likenessConsent: {type:'boolean', value:null, editable:false},
      marketingConsent: {type:'boolean', value:null, editable:false},
      name:{type:'text', value:null, editable:true},
      phone: {type:'text', value:null, editable:true},
      regId: {type:'text', value:null, editable:false},
      expire:{type:'date', value:null, editable:true},
      inviteStatus: {type:'text', value:null, editable:false} //notClaimed,Claimed,Redeemed,Voided,Returned
    }
  }


