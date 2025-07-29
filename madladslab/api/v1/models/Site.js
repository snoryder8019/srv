import ModelHelper from "./helpers/models.js";
//this.modelFields will help dynamically load crud operation for the frontend.
//>v1>models>helpers>fields.js
//ModelHelper is a crud helper for the backend
export default class Site extends ModelHelper{
  constructor(siteData){
    super('sites');
    this.modelFields ={
      siteName: {type:'text', value:null, editable:null},
      siteUrl: {type:'text', value:null, editable:null}
    }
  }
}