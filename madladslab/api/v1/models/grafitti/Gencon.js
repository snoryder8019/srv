import ModelHelper from "../helpers/models.js";
//this.modelFields will help dynamically load crud operation for the frontend.
//>v1>models>helpers>fields.js
//ModelHelper is a crud helper for the backend
export default class gencon extends ModelHelper{
  constructor(genconData={}){
    super('locations');
  this.data =genconData;
}
    static modelFields ={
      name: {type:'text', value:null, editable:true},
    address:{type:'text', value:null, editable:true},

    // general contractor questions after estimate
    estimateDate:{type:'date', value:null, editable:true},
    estimateAmount:{type:'number', value:null, editable:true},
    estimateNotes:{type:'textarea', value:null, editable:true},
    approvedDate:{type:'date', value:null, editable:true},
    approvedAmount:{type:'number', value:null, editable:true},
    approvedNotes:{type:'textarea', value:null, editable:true},
    startDate:{type:'date', value:null, editable:true},
    projectedEndDate:{type:'date', value:null, editable:true},
    actualEndDate:{type:'date', value:null, editable:true},
    constructionNotes:{type:'textarea', value:null, editable:true},
    punchlistNotes:{type:'textarea', value:null, editable:true},
    finalWalkthroughDate:{type:'date', value:null, editable:true},
    finalAmount:{type:'number', value:null, editable:true},
    finalNotes:{type:'textarea', value:null, editable:true},

    // additional contractor questionnaire fields
    permitsInspections:{type:'textarea', value:null, editable:true}, // required permits/inspections
    complianceIssues:{type:'textarea', value:null, editable:true}, // ADA/fire/safety/zoning
    structuralLimitations:{type:'textarea', value:null, editable:true}, // building constraints
    hvacPlumbingElectrical:{type:'textarea', value:null, editable:true}, // system capacity notes
    kitchenVentilation:{type:'textarea', value:null, editable:true}, // ventilation/fire suppression
    budgetRange:{type:'textarea', value:null, editable:true}, // contractor budget estimate notes
    timelineEstimates:{type:'textarea', value:null, editable:true}, // projected timeline/delays


    }
  
}

