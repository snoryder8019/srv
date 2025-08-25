import ModelHelper from "../helpers/models.js";
//this.modelFields will help dynamically load crud operation for the frontend.
//>v1>models>helpers>fields.js
//ModelHelper is a crud helper for the backend
export default class Task extends ModelHelper{
  constructor(taskData){
    super('tasks');}
    static modelFields ={
        type: {type:'text', value:null, editable:true},
      task: {type:'text', value:null, editable:true},
      costs: {type:'number', value:null, editable:true},
      notes: {type:'text', value:null, editable:true},
      priority: {type:'number', value:null, editable:true},
      status: {type:'text', value:null, editable:true}
    }
  }


