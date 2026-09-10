/**
 * Historical provider migration (2026-08-12).
 * Preserves legacy Paystack transaction history while removing reversible developer secrets.
 * This migration never deletes users, balances, orders, domains, or transaction records.
 */
require('dotenv').config();
const mongoose=require('mongoose');
const Wallet=require('../models/Wallet');
const ResellerProfile=require('../models/ResellerProfile');
(async()=>{if(!process.env.MONGODB_URI)throw new Error('MONGODB_URI is required');await mongoose.connect(process.env.MONGODB_URI);
  await Wallet.collection.updateMany({paystackCustomerCode:{$exists:true}},{$rename:{paystackCustomerCode:'legacyPaymentCustomerCode'}});
  const profiles=await ResellerProfile.find({'apiProjects.0':{$exists:true}});let scrubbed=0;
  for(const profile of profiles){let changed=false;for(const project of profile.apiProjects){for(const f of ['domainSandboxSecretEncrypted','domainLiveSecretEncrypted','bankSandboxSecretEncrypted','bankLiveSecretEncrypted','webhookSigningSecretEncrypted'])if(project[f]){project[f]='';changed=true;}}if(changed){await profile.save();scrubbed++;}}
  console.log(`Migration complete. Scrubbed reversible secrets from ${scrubbed} reseller profile(s).`);await mongoose.disconnect();
})().catch(async e=>{console.error(e.message);try{await mongoose.disconnect();}catch{}process.exit(1);});
