const mongoose=require('mongoose');
const tx=new mongoose.Schema({type:{type:String,enum:['credit','debit'],required:true},amount:{type:Number,required:true},currency:{type:String,default:'NGN'},reference:{type:String,default:''},description:{type:String,default:''},status:{type:String,default:'completed'},createdAt:{type:Date,default:Date.now}},{_id:false});
const schema=new mongoose.Schema({key:{type:String,default:'main',unique:true},balance:{type:Number,default:0},currency:{type:String,default:'NGN'},balances:{type:Map,of:Number,default:{}},transactions:[tx]},{timestamps:true});
module.exports=mongoose.model('SystemWallet',schema);
