const mongoose=require('mongoose');
const accountSchema=new mongoose.Schema({provider:{type:String,default:'paystack'},providerAccountId:String,merchantReference:String,accountNumber:String,accountName:String,bankName:String,bankCode:String,currency:String,country:String,status:{type:String,default:'pending'}},{_id:false});
const schema=new mongoose.Schema({
  resellerProfile:{type:mongoose.Schema.Types.ObjectId,ref:'ResellerProfile',required:true,index:true},apiProjectId:{type:mongoose.Schema.Types.ObjectId,required:true,index:true},externalReference:{type:String,required:true},name:{type:String,required:true},email:{type:String,required:true},country:{type:String,default:''},phone:{type:String,default:''},status:{type:String,enum:['active','verification_required','suspended'],default:'active'},accounts:{type:[accountSchema],default:[]}
},{timestamps:true});
schema.index({resellerProfile:1,apiProjectId:1,externalReference:1},{unique:true});
module.exports=mongoose.model('DeveloperCustomer',schema);
