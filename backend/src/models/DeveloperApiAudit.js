const mongoose=require('mongoose');
const schema=new mongoose.Schema({resellerProfile:{type:mongoose.Schema.Types.ObjectId,ref:'ResellerProfile',index:true},apiProjectId:{type:mongoose.Schema.Types.ObjectId,index:true},product:String,environment:String,method:String,path:String,scope:String,statusCode:Number,requestId:String,ip:String},{timestamps:true});
module.exports=mongoose.model('DeveloperApiAudit',schema);
