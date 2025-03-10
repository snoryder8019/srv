import ModelHelper from "./helpers/models.js";
//this.modelFields will help dynamically load crud operation for the frontend.
//>v1>models>helpers>fields.js
//ModelHelper is a crud helper for the backend
export default class Brand extends ModelHelper{
  constructor(brandData){
    super('brands');
    this.modelFields ={
      title: {type:'text', value:null, editable:null}
    }
  }
}