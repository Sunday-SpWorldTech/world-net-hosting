const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  reference:{type:String,required:true,unique:true,index:true},
  provider:{type:String,default:'paystack',index:true},
  purpose:{type:String,enum:['wallet_deposit','system_wallet_deposit','order','reseller_api_payment'],required:true,index:true},
  user:{type:mongoose.Schema.Types.ObjectId,ref:'User',default:null,index:true},
  order:{type:mongoose.Schema.Types.ObjectId,ref:'Order',default:null,index:true},
  amount:{type:Number,required:true},
  grossAmount:{type:Number,required:true},
  platformFee:{type:Number,default:0},
  currency:{type:String,required:true},
  status:{type:String,enum:['pending','processing','success','failed','reversed'],default:'pending',index:true},
  providerReference:{type:String,default:'',index:true},
  checkoutUrl:{type:String,default:''},
  metadata:{type:mongoose.Schema.Types.Mixed,default:{}},
  settledAt:{type:Date,default:null}
},{timestamps:true});
module.exports=mongoose.model('ProviderPayment',schema);
