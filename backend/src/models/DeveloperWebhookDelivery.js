const mongoose=require('mongoose');
const schema=new mongoose.Schema({
  resellerProfile:{type:mongoose.Schema.Types.ObjectId,ref:'ResellerProfile',required:true,index:true},
  apiProjectId:{type:mongoose.Schema.Types.ObjectId,required:true,index:true},
  eventId:{type:String,required:true,unique:true,index:true},
  event:{type:String,required:true},
  url:{type:String,required:true},
  payload:{type:mongoose.Schema.Types.Mixed,default:{}},
  status:{type:String,enum:['pending','delivered','failed'],default:'pending',index:true},
  attempts:{type:Number,default:0},
  nextAttemptAt:{type:Date,default:Date.now,index:true},
  lastStatusCode:Number,lastError:String,deliveredAt:Date
},{timestamps:true});
module.exports=mongoose.model('DeveloperWebhookDelivery',schema);
