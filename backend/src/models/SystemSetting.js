const mongoose=require('mongoose');
const schema=new mongoose.Schema({
  key:{type:String,required:true,unique:true,index:true},
  value:{type:mongoose.Schema.Types.Mixed,default:null},
  updatedBy:{type:String,default:''}
},{timestamps:true});
module.exports=mongoose.model('SystemSetting',schema);
