const mongoose=require('mongoose');
require('dotenv').config();
const Wallet=require('../models/Wallet');
(async()=>{try{
  await mongoose.connect(process.env.MONGODB_URI);
  let wallets=0,cleared=0;
  for await(const wallet of Wallet.find().cursor()){
    const base=String(wallet.currency||'NGN').toUpperCase();
    if(base==='USD') continue;
    const hasUsdTransaction=(wallet.transactions||[]).some(t=>String(t.currency||'').toUpperCase()==='USD' && Number(t.amount)>0);
    const current=Number(wallet.balances?.get?.('USD') ?? wallet.balances?.USD ?? 0);
    if(current>0 && !hasUsdTransaction){
      if(wallet.balances?.set) wallet.balances.set('USD',0); else wallet.balances={...(wallet.balances||{}),USD:0};
      await wallet.save(); wallets++; cleared+=current;
    }
  }
  console.log(JSON.stringify({walletsCleared:wallets,usdBalanceCleared:Number(cleared.toFixed(2))}));
  await mongoose.disconnect();
}catch(e){console.error(e);process.exit(1)}})();
