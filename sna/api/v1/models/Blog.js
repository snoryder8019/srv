import ModelHelper from "./helpers/models.js";

export default class Blog extends ModelHelper{
  constructor(blogData){
    super('blogs');
    this.modelFields ={
      title: {type:'text', value:null}
    }
  }
}