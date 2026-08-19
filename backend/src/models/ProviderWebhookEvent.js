const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  provider:{type:String,default:'paystack',index:true},
  eventKey:{type:String,required:true,unique:true,index:true},
  event:{type:String,required:true,index:true},
  providerReference:{type:String,default:'',index:true},
  status:{type:String,enum:['received','processed','ignored','failed'],default:'received',index:true},
  payload:{type:mongoose.Schema.Types.Mixed,default:{}},
  processedAt:{type:Date,default:null},
  error:{type:String,default:''}
},{timestamps:true});
module.exports=mongoose.model('ProviderWebhookEvent',schema);
