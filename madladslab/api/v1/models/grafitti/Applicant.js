import ModelHelper from "../helpers/models.js";
//this.modelFields will help dynamically load crud operation for the frontend.
//>v1>models>helpers>fields.js
//ModelHelper is a crud helper for the backend
export default class Applicant extends ModelHelper{
  constructor(applicantata){
    super('applicants');}
    static modelFields ={
      title: {type:'text', value:null, editable:true},
   
    }
  }


