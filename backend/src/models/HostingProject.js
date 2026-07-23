const mongoose = require('mongoose');
const environmentSchema = new mongoose.Schema({ key:{type:String,required:true,trim:true}, valueEncrypted:{type:String,required:true}, isSecret:{type:Boolean,default:true} },{_id:false});
const deploymentSchema = new mongoose.Schema({ status:{type:String,enum:['queued','building','live','failed','cancelled'],default:'queued'}, commit:{type:String,default:''}, branch:{type:String,default:'main'}, logs:[{type:String}], startedAt:{type:Date,default:Date.now}, finishedAt:Date, liveUrl:{type:String,default:''} },{timestamps:true});
const schema = new mongoose.Schema({
 user:{type:mongoose.Schema.Types.ObjectId,ref:'User',required:true,index:true},
 name:{type:String,required:true,trim:true}, planCode:{type:String,default:'free'}, serviceType:{type:String,enum:['static','web','worker'],default:'web'}, runtime:{type:String,default:'node'},
 repository:{owner:String,name:String,fullName:String,htmlUrl:String,cloneUrl:String,private:{type:Boolean,default:false}}, branch:{type:String,default:'main'}, region:{type:String,default:'virginia'}, projectGroup:{type:String,default:''}, environmentName:{type:String,default:''}, healthCheckPath:{type:String,default:'/'}, rootDirectory:{type:String,default:''},
 buildCommand:{type:String,default:'npm install && npm run build'}, startCommand:{type:String,default:'npm start'}, publishDirectory:{type:String,default:'dist'},
 autoDeploy:{type:Boolean,default:true}, status:{type:String,enum:['draft','deploying','live','failed','suspended'],default:'draft'},
 platformSubdomain:{type:String,default:''}, customDomains:[{domain:String,providerId:{type:String,default:''},domainType:{type:String,default:''},status:{type:String,default:'pending'},verificationStatus:{type:String,default:'unverified'},sslStatus:{type:String,default:'pending'},isPrimary:{type:Boolean,default:false}}],
 environment:[environmentSchema], deployments:[deploymentSchema],
 render:{serviceId:{type:String,default:''},serviceType:{type:String,default:''},url:{type:String,default:''},deployId:{type:String,default:''},status:{type:String,default:''},dashboardUrl:{type:String,default:''},lastSyncAt:Date}
},{timestamps:true});
module.exports=mongoose.model('HostingProject',schema);
