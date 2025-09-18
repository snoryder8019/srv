import ModelHelper from "../helpers/models.js";
//this.modelFields will help dynamically load crud operation for the frontend.
//>v1>models>helpers>fields.js
//ModelHelper is a crud helper for the backend
export default class Location extends ModelHelper{
  constructor(locationData={}){
    super('locations');
  this.data =locationData;
}
    static modelFields ={
      name: {type:'text', value:null, editable:true},
      address:{type:'text', value:null, editable:true},
      baseRent:{type:'number', value:null, editable:true},
      tripleNNN:{type:'number', value:null, editable:true},
      terms:{type:'text', value:null, editable:true},
      vacancyNotes:{type:'text', value:null, editable:true},
      hoodSystem:{type:'text', value:null, editable:true},
      greaseTrap:{type:'text', value:null, editable:true},
      hvacCapacity:{type:'number', value:null, editable:true},
      hvacAge:{type:'number', value:null, editable:true},
      hvacNotes:{type:'text', value:null, editable:true},
      electrical:{type:'textarea', value:null, editable:true},
      gasNotes:{type:'text', value:null, editable:true},
      plumbing:{type:'textarea', value:null, editable:true},
      healthDept:{type:'textarea', value:null, editable:true},
      deferredCode:{type:'textarea', value:null, editable:true},
      rnmResponsibility:{type:'textarea', value:null, editable:true},
      seatingCap:{type:'number', value:null, editable:true},
      signage:{type:'textarea', value:null, editable:true},
      parkingRatio:{type:'number', value:null, editable:true},
      notes:{type:'textarea', value:null, editable:true},
      lat:{type:'number', value:null, editable:true},
      lng:{type:'number', value:null, editable:true},
      //brand should await new Brands().getAll() and be dropdown options
      //  on dynamic form
      brand:{type:'text', value:null,editable:true  }
    }
  
}

