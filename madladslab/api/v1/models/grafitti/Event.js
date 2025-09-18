import ModelHelper from "../helpers/models.js";
//this.modelFields will help dynamically load crud operation for the frontend.
//>v1>models>helpers>fields.js
//ModelHelper is a crud helper for the backend
export default class Event extends ModelHelper{
  constructor(eventData){
    super('events');}
    static modelFields ={
      title: {type:'text', value:null, editable:true},
      description: {type:'text', value:null, editable:true},
      date: {type:'date', value:null, editable:true},
      location: {type:'text', value:null, editable:true},
      organizer: {type:'text', value:null, editable:true},
      attendees: {type:'array', value:null, editable:true}
    }
  }


