import ModelHelper from "./helpers/models.js";
//this.modelFields will help dynamically load crud operation for the frontend.
//>v1>models>helpers>fields.js
//ModelHelper is a crud helper for the backend
export default class Blog extends ModelHelper{
  constructor(blogData){
    super('blogs');
    this.modelFields ={
      title: {type:'text', value:null, editable:true},
      //brand should await new Brands().getAll() and be dropdownv opntions on dynamic form
      brand:{type:'text', value:null,editable:true  }
    }
  }
}