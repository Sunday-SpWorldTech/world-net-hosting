const express = require('express');
const crypto = require('crypto');
const HostingProject = require('../models/HostingProject');
const GitHubConnection = require('../models/GitHubConnection');
const HostingSubscription = require('../models/HostingSubscription');
const { githubRequest, installationToken } = require('../services/githubApp');

module.exports = function hostingRoutes({ auth, clean, encrypt, publicHostingProject, getUser }) {
  const router = express.Router();
  const hostingMarkupUsd = Math.max(0, Number(process.env.HOSTING_CUSTOMER_MARKUP_USD || 10));
  const usdNgnRate = Math.max(1, Number(process.env.FALLBACK_USD_NGN_RATE || 1500));
  const basePlans = {
    free: { name: 'Free', amount: 0, ramMb: 512, cpu: 0.1, monthlyDeploys: Number(process.env.HOSTING_FREE_MONTHLY_DEPLOYS || 100) },
    starter: { name: 'Starter', amount: Number(process.env.HOSTING_STARTER_PRICE_USD || 5.99), ramMb: 512, cpu: 0.25 },
    pro: { name: 'Pro', amount: Number(process.env.HOSTING_PRO_PRICE_USD || 12.99), ramMb: 1024, cpu: 0.5 },
    business: { name: 'Business', amount: Number(process.env.HOSTING_BUSINESS_PRICE_USD || 24.99), ramMb: 2048, cpu: 1 }
  };
  const plansForRole = (role = 'user') => Object.fromEntries(Object.entries(basePlans).map(([code, plan]) => {
    const markup = role === 'admin' || code === 'free' ? 0 : hostingMarkupUsd;
    return [code, { ...plan, baseAmount: plan.amount, markupUsd: markup, markupAmount: markup, amount: Number((plan.amount + markup).toFixed(2)), currency: 'USD', billing: 'monthly' }];
  }));
  router.use(auth);
  router.get('/config', async (req,res) => {
    const connection = await GitHubConnection.findOne({ user:req.user.id }).lean();
    res.json({
      githubConfigured:Boolean(process.env.GITHUB_APP_ID && process.env.GITHUB_APP_SLUG && process.env.GITHUB_PRIVATE_KEY),
      githubConnected:Boolean(connection), githubAccount:connection?.accountLogin || '',
      githubInstallUrl:process.env.GITHUB_APP_INSTALL_URL || (process.env.GITHUB_APP_SLUG ? `https://github.com/apps/${process.env.GITHUB_APP_SLUG}/installations/new` : ''),
      githubInstallationCallbackUrl:process.env.GITHUB_CALLBACK_URL || `${String(process.env.BACKEND_URL||'').replace(/\/$/,'')}/api/github/callback`,
      githubLoginCallbackUrl:process.env.GITHUB_OAUTH_CALLBACK_URL || process.env.GITHUB_AUTH_CALLBACK_URL || `${String(process.env.BACKEND_URL||'').replace(/\/$/,'')}/api/auth/github/callback`,
      renderConfigured:Boolean(process.env.RENDER_API_KEY && process.env.RENDER_WORKSPACE_ID),
      renderWorkspaceId:process.env.RENDER_WORKSPACE_ID||'',
      platformDomain:process.env.HOSTING_PLATFORM_DOMAIN || 'worldnethosting.com', plans:plansForRole(req.user.role), pricing:{hostingMarkupUsd,displayCurrency:'USD',paystackSettlementCurrency:'NGN',usdNgnRate,adminWholesale:req.user.role==='admin'}
    });
  });
  router.get('/github/repositories', async(req,res,next)=>{try{
    const connection=await GitHubConnection.findOne({user:req.user.id});
    if(!connection) return res.status(409).json({message:'Connect the World Net Hosting GitHub App first.'});
    if(connection.suspendedAt) return res.status(409).json({message:'This GitHub App installation is suspended. Reactivate it in GitHub and reconnect.'});
    const token=await installationToken(connection.installationId);
    const repositories=[];
    for(let page=1;page<=10;page+=1){
      const data=await githubRequest(`/installation/repositories?per_page=100&page=${page}`,{},token);
      const batch=Array.isArray(data.repositories)?data.repositories:[];
      repositories.push(...batch);
      if(batch.length<100) break;
    }
    const unique=[...new Map(repositories.map(r=>[r.id,r])).values()]
      .sort((a,b)=>String(a.full_name).localeCompare(String(b.full_name)))
      .map(r=>({id:r.id,owner:r.owner?.login||'',name:r.name,fullName:r.full_name,private:Boolean(r.private),defaultBranch:r.default_branch||'main',htmlUrl:r.html_url,cloneUrl:r.clone_url,updatedAt:r.updated_at||null,language:r.language||''}));
    res.json(unique);
  }catch(e){next(e)}});
  router.post('/github/complete-installation', async(req,res,next)=>{try{
    const installationId=Number(req.body.installationId);
    if(!installationId) return res.status(400).json({message:'installationId is required'});
    const installation=await githubRequest(`/app/installations/${installationId}`);
    const token=await installationToken(installationId);
    await githubRequest('/installation/repositories?per_page=1',{},token);
    const connection=await GitHubConnection.findOneAndUpdate({user:req.user.id},{installationId,accountLogin:installation.account?.login||'',accountType:installation.account?.type||'',avatarUrl:installation.account?.avatar_url||'',repositorySelection:installation.repository_selection||'selected',suspendedAt:installation.suspended_at||null},{upsert:true,new:true,setDefaultsOnInsert:true});
    res.json({message:'GitHub connected',account:connection.accountLogin});
  }catch(e){next(e)}});
  router.delete('/github/connection', async(req,res)=>{await GitHubConnection.deleteOne({user:req.user.id});res.json({message:'GitHub connection removed from World Net Hosting. Uninstall the GitHub App in GitHub to revoke installation access completely.'})});
  router.get('/plans',(req,res)=>res.json(plansForRole(req.user.role)));
  router.post('/projects/:id/subscribe', async(req,res,next)=>{try{
    const project=await HostingProject.findOne({_id:req.params.id,user:req.user.id}); if(!project)return res.status(404).json({message:'Project not found'});
    const planCode=clean(req.body.planCode); const plan=plansForRole(req.user.role)[planCode]; if(!plan)return res.status(400).json({message:'Invalid hosting plan'});
    const user=await getUser(req.user.id); if(!user)return res.status(404).json({message:'User not found'});
    if(planCode==='free'){
      const now=new Date(); const end=new Date(now); end.setMonth(end.getMonth()+1);
      const subscription=await HostingSubscription.findOneAndUpdate(
        {user:user._id,project:project._id},
        {planCode:'free',status:'active',amount:0,currency:'USD',currentPeriodStart:now,currentPeriodEnd:end,autoRenew:true},
        {upsert:true,new:true,setDefaultsOnInsert:true}
      );
      return res.status(201).json({message:'Free hosting activated.',subscriptionId:subscription._id,subscriptionAmount:0,platformFee:0,chargeAmount:0,active:true});
    }
    if(!process.env.PAYSTACK_SECRET_KEY) return res.status(503).json({message:'Paystack is not configured'});
    const reference=`WNH-HOST-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const feeRate=req.user.role==='admin'?0:Math.max(0,Number(process.env.USER_PLATFORM_FEE_RATE||0.04)); const platformFee=Number((plan.amount*feeRate).toFixed(2)); const chargeAmount=Number((plan.amount+platformFee).toFixed(2)); const paystackChargeNgn=Number((chargeAmount*usdNgnRate).toFixed(2));
    const subscription=await HostingSubscription.create({user:user._id,project:project._id,planCode,amount:plan.amount,currency:'USD',paymentReference:reference});
    const callbackBase=(process.env.FRONTEND_URL||'').split(',')[0].replace(/\/$/,'');
    const response=await fetch('https://api.paystack.co/transaction/initialize',{method:'POST',headers:{Authorization:`Bearer ${process.env.PAYSTACK_SECRET_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({email:user.email,amount:Math.round(paystackChargeNgn*100),currency:'NGN',reference,callback_url:`${callbackBase}/payment-success.html?purpose=hosting`,metadata:{purpose:'hosting_subscription',subscription_id:String(subscription._id),project_id:String(project._id),user_id:String(user._id),plan_code:planCode,provider_base_amount:plan.baseAmount,hosting_markup_usd:plan.markupUsd,hosting_markup_amount:plan.markupAmount,subscription_amount:plan.amount,platform_fee:platformFee,platform_fee_rate:feeRate,charged_amount_usd:chargeAmount,charged_amount_ngn:paystackChargeNgn,display_currency:'USD'}}),signal:AbortSignal.timeout(30000)});
    const data=await response.json(); if(!response.ok||!data.status){await HostingSubscription.deleteOne({_id:subscription._id});return res.status(502).json({message:data.message||'Paystack initialization failed'});}
    res.status(201).json({authorizationUrl:data.data.authorization_url,reference,subscriptionId:subscription._id,providerBaseAmount:plan.baseAmount,hostingMarkupUsd:plan.markupUsd,hostingMarkupAmount:plan.markupAmount,subscriptionAmount:plan.amount,platformFee,platformFeeRate:feeRate,chargeAmount,currency:'USD',paystackChargeNgn,paystackCurrency:'NGN'});
  }catch(e){next(e)}});
  router.get('/subscriptions',async(req,res)=>res.json(await HostingSubscription.find({user:req.user.id}).sort({createdAt:-1}).lean()));
  return router;
};
