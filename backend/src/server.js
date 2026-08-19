require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const path = require('path');

const User = require('./models/User');
const Order = require('./models/Order');
const Message = require('./models/Message');
const DomainSearch = require('./models/DomainSearch');
const DEFAULT_DOMAIN_SEARCH_TLDS = require('./config/domainSearchTlds');
const Wallet = require('./models/Wallet');
const ManagedDomain = require('./models/ManagedDomain');
const DomainTransfer = require('./models/DomainTransfer');
const crypto = require('crypto');
const SystemSetting = require('./models/SystemSetting');
const SystemWallet = require('./models/SystemWallet');
const Withdrawal = require('./models/Withdrawal');
const BankOperation = require('./models/BankOperation');
const ResellerProfile = require('./models/ResellerProfile');
const ResellerApiPayment = require('./models/ResellerApiPayment');
const ProviderPayment = require('./models/ProviderPayment');
const ProviderWebhookEvent = require('./models/ProviderWebhookEvent');
const DeveloperWebhookDelivery = require('./models/DeveloperWebhookDelivery');
const DeveloperCustomer = require('./models/DeveloperCustomer');
const DeveloperApiAudit = require('./models/DeveloperApiAudit');
const DeveloperRateLimit = require('./models/DeveloperRateLimit');
const StaffSupportNote = require('./models/StaffSupportNote');
const Paystack = require('./services/paystack');
const multer = require('multer');

const app = express();
app.set('trust proxy', 1);
const chatUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 3 * 1024 * 1024, files: 1 }, fileFilter(_req,file,cb){ const allowed=/^(image\/(png|jpeg|gif|webp)|application\/(pdf|msword|vnd\.openxmlformats-officedocument\.wordprocessingml\.document)|text\/plain)$/i; cb(allowed.test(file.mimetype)?null:new Error('Unsupported chat attachment type.'), allowed.test(file.mimetype)); } });
const profilePhotoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1500 * 1024, files: 1 }, fileFilter(_req,file,cb){ const allowed=/^image\/(png|jpeg|webp)$/i.test(file.mimetype); cb(allowed?null:new Error('Profile photo must be PNG, JPG or WebP.'), allowed); } });
const PLACEHOLDER_RE = /your_|replace_|example\.com|your-domain|xxxxxxxxx|change_this/i;
const clean = (v = '') => String(v || '').trim();
const firstEnv = (...names) => { for (const name of names) { const value = clean(process.env[name]); if (value) return value; } return ''; };
const DOMAIN_RESELLER_ID = firstEnv('DOMAIN_RESELLER_ID','DOMAIN_NAME_API_RESELLER_ID','DOMAIN_API_RESELLER_ID');
const DOMAIN_API_KEY = firstEnv('DOMAIN_API_KEY','DOMAIN_NAME_API_KEY','DOMAIN_RESELLER_API_KEY');
const validEmailAddress = (v = '') => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean(v)) && clean(v).length <= 254;
const isRealValue = (v) => Boolean(clean(v)) && !PLACEHOLDER_RE.test(clean(v));
const PORT = Number(process.env.PORT || 3000);
const USER_PLATFORM_FEE_RATE = Math.max(0, Number(process.env.USER_PLATFORM_FEE_RATE || 0.04));
const BANKING_API_TRANSACTION_FEE_RATE = Math.max(0, Number(process.env.BANKING_API_TRANSACTION_FEE_RATE || process.env.USER_PLATFORM_FEE_RATE || 0.04));
const addUserFee = (amount) => Number((Number(amount || 0) * (1 + USER_PLATFORM_FEE_RATE)).toFixed(2));
const feePart = (amount) => Number((Number(amount || 0) * USER_PLATFORM_FEE_RATE).toFixed(2));
const DOMAIN_FIRST_YEAR_MARKUP_USD = 5;
const DOMAIN_RENEWAL_MARKUP_USD = 10;
const DOMAIN_RESELLER_API_PLATFORM_FEE_RATE = Math.max(0, Number(process.env.DOMAIN_RESELLER_API_PLATFORM_FEE_RATE || process.env.USER_PLATFORM_FEE_RATE || 0.04));
const domainResellerApiFee = (amount) => Number((Number(amount || 0) * DOMAIN_RESELLER_API_PLATFORM_FEE_RATE).toFixed(2));
const feeAppliesToRole = (role='user') => !['admin','staff'].includes(clean(role).toLowerCase());
const feeForRole = (amount, role) => feeAppliesToRole(role) ? feePart(amount) : 0;
const bankFeeForRole = feeForRole;
const JWT_SECRET = clean(process.env.JWT_SECRET);
function requireJwtSecret(){if(!JWT_SECRET||JWT_SECRET.length<32){const error=new Error('JWT_SECRET must be configured with at least 32 characters.');error.status=503;throw error;}return JWT_SECRET;}
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const normalizeOrigin = (value = '') => String(value || '').trim().replace(/\/+$/, '');
const configuredOrigins = `${process.env.FRONTEND_URL || ''},${process.env.FRONTEND_ORIGINS || ''}`.split(',').map(normalizeOrigin).filter(Boolean);
const localDevelopmentOrigins = ['http://localhost:5173','http://127.0.0.1:5173','http://localhost:4173','http://127.0.0.1:4173','http://localhost:5500','http://127.0.0.1:5500'];
const productionFrontendOrigins = ['https://world-net-hosting-frontend.vercel.app','https://worldnethosting.com','https://www.worldnethosting.com'];
const allowedOrigins = [...new Set([...(configuredOrigins.length ? configuredOrigins : []), ...productionFrontendOrigins, ...(process.env.NODE_ENV === 'production' ? [] : localDevelopmentOrigins)])];
const requestLimitBuckets = new Map();
function requestLimit(name,max,windowMs){return (req,res,next)=>{const now=Date.now(),key=`${name}:${req.ip}`;let bucket=requestLimitBuckets.get(key);if(!bucket||bucket.resetAt<=now)bucket={count:0,resetAt:now+windowMs};bucket.count+=1;requestLimitBuckets.set(key,bucket);if(requestLimitBuckets.size>10000)for(const [entry,item] of requestLimitBuckets)if(item.resetAt<=now)requestLimitBuckets.delete(entry);if(bucket.count>max){res.setHeader('Retry-After',String(Math.ceil((bucket.resetAt-now)/1000)));return res.status(429).json({message:'Too many requests. Please try again shortly.'});}next();};}
const authRequestLimit=requestLimit('auth',20,15*60*1000);
const publicApiRequestLimit=requestLimit('public-api',120,5*60*1000);
const publicWriteRequestLimit=requestLimit('public-write',20,60*60*1000);

app.disable('x-powered-by');
app.use(compression({ threshold: 1024 }));
app.use(helmet({ contentSecurityPolicy: false }));
const corsOptions = {
  origin(origin, cb) {
    const normalizedOrigin = normalizeOrigin(origin);
    if (!origin || !allowedOrigins.length || allowedOrigins.includes('*') || allowedOrigins.includes(normalizedOrigin)) return cb(null, true);
    const error = new Error('Origin is not allowed by CORS');
    error.status = 403;
    return cb(error);
  },
  methods: ['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Accept','Authorization','Content-Type','X-Requested-With','X-Idempotency-Key','X-API-Key','X-API-Secret','X-Public-Key','X-Secret-Key'],
  exposedHeaders: ['Content-Length','Content-Type','Retry-After'],
  credentials: false,
  optionsSuccessStatus: 204,
  maxAge: 86400
};
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(async(req,res,next)=>{
  if(req.path==='/'||req.path==='/api/health'||req.path==='/api/connection-check'||req.path==='/api/payments/paystack/config'||req.path==='/api/v1/status'||req.path==='/api/v1/openapi.json')return next();
  try{await connectDB();next();}catch(error){console.error('Database connection error:',error.message);res.status(503).json({message:'Database is temporarily unavailable.'});}
});

app.get('/api/connection-check', (req,res) => res.json({
  ok:true,
  service:'world-net-hosting-backend',
  origin:req.get('origin')||null,
  corsAllowed:true,
  allowedOrigins,
  apiBase:`${String(process.env.BACKEND_URL||'').replace(/\/$/,'')}/api`,
  developerApiBase:`${String(process.env.BACKEND_URL||'').replace(/\/$/,'')}/api/v1`,
  domainApiConfigured:domainApiConfigured(),
  domainApiMode:DOMAIN_API_MODE,
  paystackConfigured:Paystack.configured(),
  paystackLiveConfigured:Paystack.liveConfigured(),
  timestamp:new Date().toISOString()
}));

async function ensurePaystackVirtualAccount(user, wallet, { consent=false, currency='NGN', kyc={} }={}) {
  if (!user || !wallet) { const error=new Error('User wallet could not be prepared.'); error.status=404; throw error; }
  currency=clean(currency||'NGN').toUpperCase();
  if (wallet.dedicatedAccount?.active && wallet.dedicatedAccount?.accountNumber && clean(wallet.dedicatedAccount.currency).toUpperCase()===currency) return wallet.dedicatedAccount;
  if (!consent && !wallet.dedicatedAccount?.consentAt) { const error=new Error('Confirm consent before requesting a receiving account.'); error.status=400; throw error; }
  const parts=clean(user.name).split(/\s+/).filter(Boolean);
  const firstName=clean(kyc.firstName||parts[0]); const lastName=clean(kyc.lastName||parts.slice(1).join(' ')||parts[0]);
  if (!firstName || !lastName || !validEmailAddress(user.email)) { const error=new Error('Complete your name and email before requesting a banking account.'); error.status=400; throw error; }
  const merchantReference=`WNH-VA-${String(user._id)}-${currency}`;
  if(!supportedPaystackVirtualAccountCurrencies().includes(currency)){const error=new Error(`Dedicated receiving accounts for ${currency} are not enabled by Paystack for this integration.`);error.status=400;throw error;}
  const phone=clean(kyc.phone||user.phone);
  if(!phone){const error=new Error('Add your phone number before requesting your dedicated receiving account.');error.status=400;error.code='PHONE_REQUIRED';throw error;}
  if(phone!==clean(user.phone)){user.phone=phone;await user.save();}
  const body={currency,accountType:'individual',merchantReference,KYCInformation:{firstName,lastName,email:user.email,phone}};
  wallet.dedicatedAccount.consentAt=wallet.dedicatedAccount.consentAt||new Date(); wallet.dedicatedAccount.assignmentStatus='pending'; wallet.dedicatedAccount.assignmentMessage='Dedicated account request submitted to Paystack.'; wallet.dedicatedAccount.merchantReference=merchantReference; wallet.dedicatedAccount.currency=currency; wallet.dedicatedAccount.provider='paystack'; await wallet.save();
  try{
    const response=await Paystack.createVirtualAccount(body); const data=response.data||{}; const normalized=Paystack.normalizeAccount(data);
    wallet.dedicatedAccount={...wallet.dedicatedAccount.toObject?.()||wallet.dedicatedAccount,...normalized,merchantReference:normalized.merchantReference||merchantReference,consentAt:wallet.dedicatedAccount.consentAt||new Date(),assignedAt:normalized.active?new Date():null};
    await wallet.save(); return wallet.dedicatedAccount;
  }catch(error){wallet.dedicatedAccount.assignmentStatus='failed';wallet.dedicatedAccount.assignmentMessage=clean(error.message);await wallet.save();throw error;}
}
function queueDedicatedAccountAssignment(){ /* Banking activation is user-initiated because regulated KYC data is required. */ }
function walletAmount(wallet, currency) {
  currency = clean(currency || wallet.currency || 'NGN').toUpperCase();
  if (wallet.balances && wallet.balances.get(currency) != null) return Number(wallet.balances.get(currency) || 0);
  if (currency === clean(wallet.currency || 'NGN').toUpperCase()) return Number(wallet.balance || 0);
  return 0;
}
function setWalletAmount(wallet, currency, amount) {
  currency = clean(currency || wallet.currency || 'NGN').toUpperCase();
  if (!wallet.balances) wallet.balances = new Map();
  wallet.balances.set(currency, Number(Number(amount || 0).toFixed(2)));
  if (currency === clean(wallet.currency || 'NGN').toUpperCase()) wallet.balance = Number(Number(amount || 0).toFixed(2));
}
function changeWalletAmount(wallet, currency, delta) { const next = walletAmount(wallet, currency) + Number(delta || 0); setWalletAmount(wallet, currency, next); return next; }
function ensureCoreWalletBalances(wallet) {
  if (!wallet.balances) wallet.balances = new Map();
  const base = clean(wallet.currency || 'NGN').toUpperCase();
  if (wallet.balances.get(base) == null) wallet.balances.set(base, Number(wallet.balance || 0));
  if (wallet.balances.get('NGN') == null) wallet.balances.set('NGN', base === 'NGN' ? Number(wallet.balance || 0) : 0);
  if (wallet.balances.get('USD') == null) wallet.balances.set('USD', base === 'USD' ? Number(wallet.balance || 0) : 0);
  return wallet;
}
function walletBalancesObject(wallet) {
  ensureCoreWalletBalances(wallet);
  if (wallet.balances instanceof Map || typeof wallet.balances?.entries === 'function') {
    return Object.fromEntries(wallet.balances.entries());
  }
  if (wallet.balances && typeof wallet.balances === 'object') return { ...wallet.balances };
  return { [clean(wallet.currency || 'NGN').toUpperCase()]: Number(wallet.balance || 0), NGN: 0, USD: 0 };
}
async function repairLegacyWallet(wallet, user) {
  let changed = false;
  if (!wallet.email && user?.email) { wallet.email = clean(user.email).toLowerCase(); changed = true; }
  if (!wallet.currency) { wallet.currency = process.env.WALLET_CURRENCY || 'NGN'; changed = true; }
  const before = JSON.stringify(walletBalancesObject(wallet));
  ensureCoreWalletBalances(wallet);
  if (JSON.stringify(walletBalancesObject(wallet)) !== before) changed = true;
  if (changed || wallet.isModified?.('balances') || wallet.isModified?.('email') || wallet.isModified?.('currency')) await wallet.save();
  return wallet;
}
async function roleWallet(req) {
  if (req.user.role === 'admin') return { wallet: await getSystemWallet(), walletType: 'system' };
  const user = await User.findById(req.user.id); if (!user) { const e = new Error('User account not found.'); e.status = 404; throw e; }
  const wallet = await getOrCreateWallet(user);
  await repairLegacyWallet(wallet, user);
  return { wallet, walletType: 'user' };
}
async function fetchExchangeRates(baseCurrency) {
  const base = clean(baseCurrency).toUpperCase();
  if (!/^[A-Z]{3}$/.test(base)) { const e = new Error('Invalid source currency.'); e.status = 400; throw e; }
  const configuredUrl = clean(process.env.EXCHANGE_RATE_API_URL);
  const configuredKey = '';
  const endpoint = configuredUrl
    ? configuredUrl.replace('{base}', encodeURIComponent(base))
    : `https://open.er-api.com/v6/latest/${encodeURIComponent(base)}`;
  const headers = { Accept: 'application/json' };
  if (configuredKey) headers.Authorization = `Bearer ${configuredKey}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(endpoint, { headers, signal: controller.signal });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) { const e = new Error(payload?.message || `Exchange-rate provider failed (${response.status}).`); e.status = 502; throw e; }
    const rates = payload?.rates || payload?.conversion_rates || payload?.data?.rates;
    if (!rates || typeof rates !== 'object') { const e = new Error('Exchange-rate provider returned no rates.'); e.status = 502; throw e; }
    return rates;
  } catch (error) {
    if (error.name === 'AbortError') { const e = new Error('Exchange-rate provider timed out.'); e.status = 504; throw e; }
    throw error;
  } finally { clearTimeout(timer); }
}

async function resolveRate(from, to) {
  from = clean(from).toUpperCase(); to = clean(to).toUpperCase(); if (from === to) return 1;
  const rates = await fetchExchangeRates(from); const rate = Number(rates?.[to]);
  if (!Number.isFinite(rate) || rate <= 0) { const e = new Error(`Exchange rate from ${from} to ${to} is unavailable.`); e.status = 502; throw e; }
  return rate;
}
function publicBankOperation(item) { const o = item.toObject ? item.toObject() : item; delete o.metadata?.rawProvider; return o; }

function providerSuccess(status=''){return ['success','successful','completed','approved'].includes(clean(status).toLowerCase());}
async function settleResellerApiPaymentByReference(reference, providerData={}) {
  const payment=await ResellerApiPayment.findOne({reference:clean(reference)}); if(!payment)return {applied:false,reason:'payment_not_found'};
  if(payment.status==='success')return {applied:true,duplicate:true,purpose:'reseller_api_payment'};
  const reseller=await User.findById(payment.reseller);if(!reseller)return {applied:false,reason:'reseller_not_found'};
  const resellerWallet=await getOrCreateWallet(reseller), resellerReference=`RESELLER-PAYMENT-${payment.reference}`;
  if(!resellerWallet.transactions.some(item=>item.reference===resellerReference)){changeWalletAmount(resellerWallet,payment.currency,payment.resellerNet);resellerWallet.transactions.push({type:'credit',amount:payment.resellerNet,currency:payment.currency,reference:resellerReference,description:`Verified Banking API payment after World Net Hosting transaction fee: ${payment.description||payment.reference}`,status:'completed'});await resellerWallet.save();}
  const systemWallet=await getSystemWallet(), platformReference=`BANKING-API-FEE-${payment.reference}`;
  if(!systemWallet.transactions.some(item=>item.reference===platformReference)){systemWallet.balance=Number(systemWallet.balance||0)+Number(payment.platformFee||0);systemWallet.currency=payment.currency||systemWallet.currency;systemWallet.transactions.push({type:'credit',amount:payment.platformFee,currency:payment.currency,reference:platformReference,description:`World Net Hosting Banking API transaction fee: ${payment.description||payment.reference}`,status:'completed'});await systemWallet.save();}
  await ResellerProfile.updateOne({_id:payment.resellerProfile},{$set:{lifetimeFreeApiAccess:true,lastActiveBankingTransactionAt:new Date()}});
  payment.status='success';payment.provider='paystack';payment.providerStatus=clean(providerData.status||'successful');payment.settledAt=new Date();payment.metadata={...(payment.metadata||{}),providerReference:clean(providerData.reference||providerData.id),providerData:{status:providerData.status||'',fee:providerData.fee||0}};await payment.save();
  await queueDeveloperWebhook(payment.resellerProfile,payment.apiProjectId,'payment.successful',{reference:payment.reference,status:payment.status,amount:payment.amount,currency:payment.currency}).catch(()=>{});
  return {applied:true,purpose:'reseller_api_payment'};
}
async function settleProviderPayment(reference, providerData={}){
  reference=clean(reference);if(!reference)return {applied:false};
  const payment=await ProviderPayment.findOne({reference});if(!payment)return settleResellerApiPaymentByReference(reference,providerData);
  if(payment.status==='success')return {applied:true,duplicate:true,purpose:payment.purpose};
  if(payment.purpose==='wallet_deposit'){
    const user=await User.findById(payment.user);if(!user)return {applied:false,reason:'user_not_found'};const wallet=await getOrCreateWallet(user);
    if(!wallet.transactions.some(t=>t.reference===reference&&t.type==='credit')){changeWalletAmount(wallet,payment.currency,payment.amount);wallet.transactions.push({type:'credit',amount:payment.amount,currency:payment.currency,reference,description:`Paystack wallet deposit; service fee ${Number(payment.platformFee||0).toFixed(2)} ${payment.currency}`,status:'completed'});await wallet.save();}
  }else if(payment.purpose==='system_wallet_deposit'){
    const wallet=await getSystemWallet();if(!wallet.transactions.some(t=>t.reference===reference&&t.type==='credit')){changeWalletAmount(wallet,payment.currency,payment.amount);wallet.transactions.push({type:'credit',amount:payment.amount,currency:payment.currency,reference,description:'Paystack system wallet deposit',status:'completed'});await wallet.save();}
  }else if(payment.purpose==='order'){
    const order=await Order.findById(payment.order);if(order&&order.status!=='paid'){order.status='paid';order.paymentReference=reference;await order.save();}
    if(order&&domainItemFromOrder(order)&&order.domainProvisionStatus!=='completed'){const user=await User.findById(order.user)||await User.findOne({email:order.customerEmail});if(user){try{await provisionPaidDomain(order,user);}catch(error){console.error('Domain provisioning after payment failed:',error.message);}}}
  }
  payment.status='success';payment.providerReference=clean(providerData.reference||providerData.id);payment.settledAt=new Date();payment.metadata={...(payment.metadata||{}),providerStatus:clean(providerData.status||'successful')};await payment.save();return {applied:true,purpose:payment.purpose};
}
async function processPaystackCollection(data={}){
  const providerReference=clean(data.reference||data.id);
  const localReference=clean(data.reference);
  if(localReference){const local=await ProviderPayment.findOne({reference:localReference})||await ResellerApiPayment.findOne({reference:localReference});if(local)return settleProviderPayment(localReference,{...data,amount:Number(data.amount||0)/100,fee:Number(data.fees||0)/100});}
  const authorization=data.authorization||{};
  if(clean(authorization.channel)!=='dedicated_nuban')return {applied:false,reason:'unmatched_collection'};
  const customerCode=clean(data.customer?.customer_code);
  let wallet=customerCode?await Wallet.findOne({'dedicatedAccount.merchantReference':customerCode}):null;
  if(!wallet&&clean(authorization.receiver_bank_account_number))wallet=await Wallet.findOne({'dedicatedAccount.accountNumber':clean(authorization.receiver_bank_account_number)});
  if(!wallet)return {applied:false,reason:'wallet_not_found'};
  const ref=providerReference||`PAYSTACK-COLLECTION-${crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex').slice(0,24)}`;
  if(wallet.transactions.some(t=>t.reference===ref&&t.type==='credit'))return {applied:true,duplicate:true};
  const owner=await User.findById(wallet.user),currency=clean(data.currency||wallet.dedicatedAccount?.currency||'NGN').toUpperCase(),gross=Number(data.amount||0)/100;if(!Number.isFinite(gross)||gross<=0)return {applied:false,reason:'invalid_amount'};
  const fee=bankFeeForRole(gross,owner?.role||'user'),net=Number((gross-fee).toFixed(2));changeWalletAmount(wallet,currency,net);wallet.transactions.push({type:'credit',amount:net,currency,reference:ref,description:`Bank receive ${gross.toFixed(2)} less ${fee.toFixed(2)} platform fee`,status:'completed'});await wallet.save();
  await BankOperation.create({owner:wallet.user,ownerEmail:wallet.email,ownerRole:owner?.role||'user',walletType:'user',type:'bank_receive',amount:gross,fee,totalDebit:0,currency,provider:'paystack',providerReference:ref,status:'success',description:'Paystack dedicated account receipt',metadata:{channel:authorization.channel}});return {applied:true,purpose:'bank_receive'};
}
async function processPaystackVirtualAccount(event,data={}){
  const normalized=Paystack.normalizeAccount(data);const providerId=clean(normalized.providerAccountId),customerCode=clean(data.customer?.customer_code||normalized.merchantReference);let wallet=null;
  if(providerId)wallet=await Wallet.findOne({'dedicatedAccount.providerAccountId':providerId});if(!wallet&&customerCode)wallet=await Wallet.findOne({'dedicatedAccount.merchantReference':customerCode});if(!wallet)return {applied:false};
  Object.assign(wallet.dedicatedAccount,normalized);wallet.dedicatedAccount.assignmentMessage=clean(data.message||event);wallet.dedicatedAccount.assignedAt=normalized.active?new Date():wallet.dedicatedAccount.assignedAt;await wallet.save();return {applied:true};
}
async function processPaystackPayout(event,data={}){
  const reference=clean(data.reference);if(!reference)return {applied:false};const operation=await BankOperation.findOne({$or:[{providerReference:reference},{providerTransferCode:reference}]});if(!operation)return {applied:false};const status=event==='transfer.success'?'success':event==='transfer.reversed'?'reversed':event==='transfer.failed'?'failed':clean(data.status||'processing');
  if(operation.status!==status){operation.status=status;operation.provider='paystack';operation.providerMessage=clean(data.reason||data.message);operation.providerTransferCode=clean(data.reference||operation.providerTransferCode);await operation.save();if(['failed','reversed'].includes(status)&&!operation.metadata?.refunded){const target=operation.walletType==='system'?await getSystemWallet():await Wallet.findOne({user:operation.owner});if(target){changeWalletAmount(target,operation.currency,operation.totalDebit);target.transactions.push({type:'credit',amount:operation.totalDebit,currency:operation.currency,reference:`REFUND-${reference}`,description:`Refund for ${status} bank transfer`,status:'completed'});await target.save();operation.metadata={...(operation.metadata||{}),refunded:true};await operation.save();}}}
  return {applied:true};
}
app.post('/api/payments/paystack/webhook', express.json({limit:'1mb'}), async(req,res)=>{
  try{
    const event=req.body||{},signature=req.headers['x-paystack-signature'];const webhookEnvironment=['sandbox','live'].find(env=>Paystack.verifyWebhookSignature(event,signature,env));if(!webhookEnvironment)return res.sendStatus(401);
    const eventName=clean(event.event),data=event.data||{};const eventKey=clean(event.id||data.eventId)||crypto.createHash('sha256').update(JSON.stringify(event)).digest('hex');
    let record=await ProviderWebhookEvent.findOne({eventKey});if(record?.status==='processed'||record?.status==='ignored')return res.sendStatus(200);if(!record)record=await ProviderWebhookEvent.create({eventKey,event:eventName,providerReference:clean(data.reference||data.id),payload:event,status:'received'});
    let result={applied:false};if(eventName==='charge.success')result=await processPaystackCollection(data);else if(eventName.startsWith('dedicatedaccount.'))result=await processPaystackVirtualAccount(eventName,data);else if(eventName.startsWith('transfer.'))result=await processPaystackPayout(eventName,data);
    record.status=result.applied?'processed':'ignored';record.processedAt=new Date();await record.save();return res.sendStatus(200);
  }catch(error){console.error('Paystack webhook error:',error.message);try{const key=crypto.createHash('sha256').update(JSON.stringify(req.body||{})).digest('hex');await ProviderWebhookEvent.findOneAndUpdate({eventKey:key},{$set:{status:'failed',error:clean(error.message)}},{upsert:false});}catch{}return res.sendStatus(500);}
});

app.use(express.json({ limit: '1mb' }));
app.use(async (req,res,next)=>{
  try{
    if(process.env.NODE_ENV==='test')return next();
    if(req.path.startsWith('/api/admin')||req.path.startsWith('/api/staff')||req.path.startsWith('/api/auth/')||req.path.includes('/webhook')||req.path==='/api/health') return next();
    const state=await maintenanceState();
    if(!state.enabled) return next();
    let role=''; try{const token=(req.headers.authorization||'').replace('Bearer ',''); if(token) role=jwt.verify(token,JWT_SECRET).role||'';}catch{}
    if(state.allowStaff&&['staff','admin'].includes(role)) return next();
    if(req.path.startsWith('/api/')) return res.status(503).json({maintenance:true,message:state.message||'Platform under maintenance'});
    return next();
  }catch{return next();}
});

const translatorCache = new Map();
app.get('/api/translator/languages',publicApiRequestLimit,async (_req, res) => {
  try {
    const endpoint = clean(process.env.AZURE_TRANSLATOR_ENDPOINT || 'https://api.cognitive.microsofttranslator.com').replace(/\/$/, '');
    const response = await fetch(`${endpoint}/languages?api-version=3.0&scope=translation`,{signal:AbortSignal.timeout(30000)});
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.error?.message || `Language request failed (${response.status})`);
    res.json({ ok: true, translation: payload.translation || {} });
  } catch (error) { res.status(502).json({ ok: false, message: error.message }); }
});
app.post('/api/translator/translate',publicApiRequestLimit,async (req, res) => {
  try {
    const key = clean(process.env.AZURE_TRANSLATOR_KEY);
    const region = clean(process.env.AZURE_TRANSLATOR_REGION);
    const endpoint = clean(process.env.AZURE_TRANSLATOR_ENDPOINT || 'https://api.cognitive.microsofttranslator.com').replace(/\/$/, '');
    if (!key) return res.status(503).json({ ok: false, message: 'Azure Translator is not configured.' });
    const to = clean(req.body?.to), texts = (Array.isArray(req.body?.texts) ? req.body.texts : []).slice(0,100).map(x=>String(x||'').slice(0,5000));
    if (!to || !texts.length) return res.status(400).json({ ok:false, message:'Target language and text are required.' });
    const output=new Array(texts.length), missing=[], indexes=[];
    texts.forEach((text,i)=>{const k=`${to}|${text}`;if(translatorCache.has(k))output[i]=translatorCache.get(k);else{missing.push(text);indexes.push(i);}});
    if(missing.length){
      const headers={'Content-Type':'application/json; charset=UTF-8','Ocp-Apim-Subscription-Key':key}; if(region)headers['Ocp-Apim-Subscription-Region']=region;
      const response=await fetch(`${endpoint}/translate?api-version=3.0&to=${encodeURIComponent(to)}`,{method:'POST',headers,body:JSON.stringify(missing.map(Text=>({Text}))),signal:AbortSignal.timeout(30000)});
      const payload=await response.json().catch(()=>null); if(!response.ok)return res.status(response.status).json({ok:false,message:payload?.error?.message||`Translation failed (${response.status})`});
      payload.forEach((item,pos)=>{const value=item?.translations?.[0]?.text??missing[pos],idx=indexes[pos];output[idx]=value;translatorCache.set(`${to}|${missing[pos]}`,value);});
      if(translatorCache.size>5000)translatorCache.clear();
    }
    res.json({ok:true,to,translations:output});
  } catch(error){res.status(500).json({ok:false,message:error.message||'Translation failed.'});}
});

app.use(express.static(PUBLIC_DIR,{maxAge:process.env.NODE_ENV==='production'?'7d':0,etag:true,lastModified:true,setHeaders(res,file){if(/\.(html)$/i.test(file))res.setHeader('Cache-Control','no-cache');}}));

const toPublicUser = (user) => ({
  id: user._id,
  name: user.name,
  email: user.email,
  alternateEmails: Array.isArray(user.alternateEmails) ? user.alternateEmails : [],
  profilePhotoAvailable: Boolean(user.profilePhoto?.contentType || user.profilePhoto?.updatedAt),
  profilePhotoUpdatedAt: user.profilePhoto?.updatedAt || null,
  phone: user.phone,
  company: user.company,
  role: user.role,
  active: user.active !== false,
  accountStatus: user.accountStatus || (user.active === false ? 'disabled' : 'active'),
  riskStatus: user.riskStatus || 'normal',
  staffApprovalStatus: user.staffApprovalStatus || (user.role === 'staff' ? 'approved' : undefined),
  staffPermissions: user.staffPermissions || [],
  hasPin: Boolean(user.pinHash)
});
const signToken = (user) => jwt.sign({ id: user._id, email: user.email, role: user.role }, requireJwtSecret(), { expiresIn: '1d' });

function normalizeEmail(value = '') {
  return clean(value).toLowerCase();
}

async function findAccountForAuthentication(email) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return { user: null, raw: null };
  const raw = await User.collection.findOne({
    $or: [
      { email: normalizedEmail },
      { emailAddress: normalizedEmail },
      { username: normalizedEmail }
    ]
  });
  if (!raw) return { user: null, raw: null };
  const user = await User.findById(raw._id).select('+password +password_hash');
  return { user, raw };
}

function storedPasswordHash(user, raw) {
  return clean(user?.passwordHash || user?.password || user?.password_hash || raw?.passwordHash || raw?.password || raw?.password_hash);
}

function accountIsInactive(user, raw) {
  return user?.active === false || raw?.active === false || raw?.isActive === false || ['inactive','disabled','suspended','deleted'].includes(clean(raw?.accountStatus).toLowerCase());
}

async function migrateLegacyAccountAfterSuccessfulLogin(user, raw, normalizedEmail, verifiedHash) {
  if (!user) return user;
  let changed = false;
  if (!user.email && normalizedEmail) { user.email = normalizedEmail; changed = true; }
  if (!user.passwordHash && verifiedHash) { user.passwordHash = verifiedHash; changed = true; }
  if (!user.role || !['user','staff','admin','reseller'].includes(user.role)) { user.role = ['user','staff','admin','reseller'].includes(raw?.role) ? raw.role : 'user'; changed = true; }
  if (user.active === undefined) { user.active = raw?.isActive !== false; changed = true; }
  if (changed) await user.save({ validateModifiedOnly: true });
  return user;
}

async function getOrCreateWallet(user) {
  let wallet = await Wallet.findOne({ user: user._id || user.id });
  if (!wallet) {
    wallet = await Wallet.create({
      user: user._id || user.id,
      email: user.email,
      currency: process.env.WALLET_CURRENCY || 'NGN',
      balance: 0,
      transactions: []
    });
  }
  return wallet;
}

let databaseConnectionPromise=null;
async function connectDB() {
  if (mongoose.connection.readyState === 1) return mongoose.connection;
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is missing in the server environment');
  if (!databaseConnectionPromise) databaseConnectionPromise=mongoose.connect(process.env.MONGODB_URI,{maxPoolSize:10,minPoolSize:0,serverSelectionTimeoutMS:10000,socketTimeoutMS:45000,maxIdleTimeMS:60000}).catch(error=>{databaseConnectionPromise=null;throw error;});
  await databaseConnectionPromise;return mongoose.connection;
}

app.use('/api', async (req, res, next) => {
  if(['/health','/connection-check','/payments/paystack/config','/v1/status','/v1/openapi.json'].includes(req.path)) return next();
  try {
    await connectDB();
    next();
  } catch (error) {
    console.error('Database connection unavailable:', error.message);
    return res.status(503).json({
      success: false,
      code: 'DATABASE_UNAVAILABLE',
      message: 'Database connection is temporarily unavailable.'
    });
  }
});

async function auth(req, res, next) {
  try {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    const payload = jwt.verify(token, JWT_SECRET);
    const account = await User.findById(payload.id).select('email role active accountStatus staffPermissions');
    if (!account || account.active === false || ['suspended','disabled'].includes(clean(account.accountStatus).toLowerCase())) return res.status(403).json({ message: 'Account is suspended, disabled, or unavailable' });
    req.user = { ...payload, email: account.email, role: account.role, staffPermissions: account.staffPermissions || [] };
    next();
  } catch {
    res.status(401).json({ message: 'Invalid or missing token' });
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ message: 'Admin access required' });
  next();
}
function requireStaffOrAdmin(req,res,next){
  if(!['staff','admin'].includes(req.user?.role)) return res.status(403).json({message:'Staff access required'});
  next();
}
const DEFAULT_STAFF_PERMISSIONS=['support.manage','users.read','support.notes','account.security'];
function requireStaffPermission(permission){return (req,res,next)=>{if(req.user?.role==='admin')return next();if(req.user?.role!=='staff')return res.status(403).json({message:'Staff access required'});const permissions=(req.user.staffPermissions&&req.user.staffPermissions.length)?req.user.staffPermissions:DEFAULT_STAFF_PERMISSIONS;if(!permissions.includes(permission)&&!permissions.includes('*'))return res.status(403).json({message:`Staff permission required: ${permission}`});next();};}
async function getSystemWallet(){
  return SystemWallet.findOneAndUpdate({key:'main'},{$setOnInsert:{key:'main',balance:0,currency:process.env.WALLET_CURRENCY||'NGN',transactions:[]}},{new:true,upsert:true});
}
const WITHDRAWAL_CIPHER_KEY = crypto.createHash('sha256').update(process.env.WITHDRAWAL_ENCRYPTION_KEY || JWT_SECRET).digest();
function encryptWithdrawalValue(value=''){ const iv=crypto.randomBytes(12); const cipher=crypto.createCipheriv('aes-256-gcm',WITHDRAWAL_CIPHER_KEY,iv); const encrypted=Buffer.concat([cipher.update(String(value),'utf8'),cipher.final()]); const tag=cipher.getAuthTag(); return [iv,tag,encrypted].map(x=>x.toString('base64')).join('.'); }
function decryptWithdrawalValue(payload=''){ const parts=String(payload||'').split('.'); if(parts.length!==3) return ''; const [ivB64,tagB64,dataB64]=parts; const decipher=crypto.createDecipheriv('aes-256-gcm',WITHDRAWAL_CIPHER_KEY,Buffer.from(ivB64,'base64')); decipher.setAuthTag(Buffer.from(tagB64,'base64')); return Buffer.concat([decipher.update(Buffer.from(dataB64,'base64')),decipher.final()]).toString('utf8'); }
function maskAccountNumber(value=''){ const v=String(value).replace(/\D/g,''); return v.length>4 ? `${'*'.repeat(Math.max(0,v.length-4))}${v.slice(-4)}` : v; }
async function translateText(text,to){
  const key=clean(process.env.AZURE_TRANSLATOR_KEY), region=clean(process.env.AZURE_TRANSLATOR_REGION), endpoint=clean(process.env.AZURE_TRANSLATOR_ENDPOINT||'https://api.cognitive.microsofttranslator.com').replace(/\/$/,'');
  if(!key||!text||!to) return text;
  const headers={'Content-Type':'application/json; charset=UTF-8','Ocp-Apim-Subscription-Key':key}; if(region)headers['Ocp-Apim-Subscription-Region']=region;
  const response=await fetch(`${endpoint}/translate?api-version=3.0&to=${encodeURIComponent(to)}`,{method:'POST',headers,body:JSON.stringify([{Text:String(text).slice(0,5000)}]),signal:AbortSignal.timeout(30000)});
  const payload=await response.json().catch(()=>null); if(!response.ok) throw new Error(payload?.error?.message||'Translation failed');
  return payload?.[0]?.translations?.[0]?.text || text;
}
function publicMessage(item){ const obj=item.toObject?item.toObject():{...item}; delete obj.accessTokenHash; return {...obj,attachments:(obj.attachments||[]).map(a=>({_id:a._id,filename:a.filename,mimeType:a.mimeType,size:a.size,url:`/api/support/chat/${obj._id}/attachments/${a._id}`}))}; }
function hashChatAccessToken(value=''){return crypto.createHash('sha256').update(String(value)).digest('hex');}
function chatTokenMatches(expected='',provided=''){
  if(!expected||!provided)return false;
  const a=Buffer.from(String(expected),'hex'),b=Buffer.from(hashChatAccessToken(provided),'hex');
  return a.length===b.length&&crypto.timingSafeEqual(a,b);
}
async function requireChatAccess(req,res,next){
  try{
    const item=await Message.findById(req.params.id).select('+accessTokenHash');
    if(!item)return res.status(404).json({message:'Conversation not found'});
    let actor=null;const bearer=(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
    if(bearer){try{actor=jwt.verify(bearer,JWT_SECRET)}catch{}}
    const authenticated=actor&&(['admin','staff'].includes(actor.role)||String(item.user||'')===String(actor.id||''));
    const accessToken=clean(req.headers['x-chat-access-token']||req.query.accessToken||req.body?.accessToken);
    if(!authenticated&&!chatTokenMatches(item.accessTokenHash,accessToken))return res.status(403).json({message:'Secure conversation access is required.'});
    req.supportMessage=item;req.supportActor=actor;next();
  }catch(error){if(error?.name==='CastError')return res.status(404).json({message:'Conversation not found'});next(error);}
}
async function maintenanceState(){
  const row=await SystemSetting.findOne({key:'maintenance'}).lean();
  return row?.value||{enabled:false,message:'We are performing scheduled maintenance. Please try again shortly.',allowStaff:true};
}

const domainApiConfigured = () => isRealValue(DOMAIN_RESELLER_ID) && isRealValue(DOMAIN_API_KEY);
const paystackConfigured = () => Paystack.configured();
const translatorConfigured = () => isRealValue(process.env.AZURE_TRANSLATOR_KEY) && isRealValue(process.env.AZURE_TRANSLATOR_REGION);
const productionReadinessIssues = () => {
  const issues = [];
  if (process.env.NODE_ENV !== 'production') issues.push('NODE_ENV must be production.');
  if (!isRealValue(process.env.MONGODB_URI)) issues.push('MongoDB is not configured.');
  if (!domainApiConfigured() || DOMAIN_API_MODE !== 'live') issues.push('Live Domain Name API is not configured.');
  if (!Paystack.liveConfigured()) issues.push('Paystack live banking is not enabled/configured.');
  if (!translatorConfigured()) issues.push('Azure Translator is not configured.');
  if (!isRealValue(process.env.FRONTEND_URL) || !isRealValue(process.env.BACKEND_URL)) issues.push('Production frontend/backend URLs are not configured.');
  return issues;
};

// Domain Name API gateway. Preserve the configured /api/v1 integration exactly.
// Production is the default. Set DOMAIN_API_MODE=test only when intentionally using the OT&E key.
const DOMAIN_API_MODE = clean(process.env.DOMAIN_API_MODE || 'live').toLowerCase();
const DOMAIN_API_LIVE_URL = 'https://api.domainresellerapi.com/api/v1';
const DOMAIN_API_TEST_URL = 'https://ote.domainresellerapi.com/api/v1';
const configuredDomainBase = clean(process.env.DOMAIN_API_BASE_URL || '');
const DOMAIN_API_BASE_URL = (
  configuredDomainBase || (DOMAIN_API_MODE === 'test' ? DOMAIN_API_TEST_URL : DOMAIN_API_LIVE_URL)
).replace(/\/+$/, '');

function safeJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function providerMessage(payload, fallback = 'Domain provider request failed') {
  if (!payload) return fallback;
  if (typeof payload === 'string') return payload;
  return payload.message || payload.Message || payload.title || payload.error?.message || payload.error || payload.Error || payload.details || fallback;
}

async function domainNameApiRequest(method, endpoint, data = {}) {
  if (!domainApiConfigured()) {
    const err = new Error('Domain Name API credentials are missing on the server.');
    err.status = 503;
    throw err;
  }

  const url = new URL(`${DOMAIN_API_BASE_URL}/${String(endpoint).replace(/^\/+/, '')}`);
  const upperMethod = String(method || 'GET').toUpperCase();
  const options = {
    method: upperMethod,
    signal: AbortSignal.timeout(Number(process.env.DOMAIN_API_TIMEOUT_MS || 60000)),
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-API-KEY': DOMAIN_API_KEY,
      '__reseller': DOMAIN_RESELLER_ID
    }
  };

  if (['GET', 'DELETE'].includes(upperMethod)) {
    Object.entries(data || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    });
  } else {
    options.body = JSON.stringify(data || {});
  }

  let response;
  try {
    response = await fetch(url, options);
  } catch (cause) {
    const err = new Error('Could not connect to Domain Name API. Check internet access and server network settings.');
    err.status = 502;
    err.cause = cause;
    throw err;
  }

  const text = await response.text();
  const dataOut = safeJson(text);
  if (!response.ok) {
    const isHtml = /<\s*!doctype|<\s*html/i.test(text);
    const fallback = response.status === 404
      ? 'Domain Name API endpoint was not found. Confirm the configured provider endpoint path.'
      : `Domain Name API returned HTTP ${response.status}.`;
    let msg = isHtml ? fallback : providerMessage(dataOut, fallback);
    if (response.status === 401) msg = 'Live Domain Name API credentials were rejected. Confirm the Live Environment API Key and Reseller ID.';
    if (response.status === 403) {
      const providerDetail = providerMessage(dataOut, 'The domain provider rejected this request.');
      msg = `Domain Name API returned HTTP 403: ${providerDetail} Check the reseller account permissions, request limits, supported extensions, and credentials.`;
    }
    const err = new Error(msg);
    err.status = response.status >= 400 && response.status < 500 ? response.status : 502;
    err.payload = dataOut || { status: response.status, message: fallback };
    throw err;
  }

  if (!dataOut) {
    const err = new Error('Domain Name API returned a non-JSON response.');
    err.status = 502;
    err.payload = { status: response.status };
    throw err;
  }
  return dataOut;
}

function domainEndpoint(name, fallback) {
  return clean(process.env[`DOMAIN_ENDPOINT_${name}`] || fallback).replace(/^\/+/, '');
}

function normalizeBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  const normalized = String(value ?? '').trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'available', 'free', 'registerable', 'registrable', 'notregistered', 'not_registered'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n', 'taken', 'unavailable', 'registered', 'reserved', 'premium'].includes(normalized)) return false;
  return null;
}

function availabilityItems(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];

  // Some current Domain Name API REST responses return a single domain result
  // object instead of wrapping it in an array.
  if (payload.domainName || payload.domain || payload.name || payload.fqdn) return [payload];

  const candidates = [
    payload.infos,
    payload.items,
    payload.results,
    payload.domains,
    payload.data,
    payload.response,
    payload.result
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
    if (candidate && typeof candidate === 'object') {
      const nested = availabilityItems(candidate);
      if (nested.length) return nested;
    }
  }

  // Some provider versions return an object keyed by domain name.
  const keyed = Object.entries(payload)
    .filter(([key, value]) => /^[a-z0-9-]+\.[a-z0-9.-]+$/i.test(key) && value && typeof value === 'object')
    .map(([domainName, value]) => ({ domainName, ...value }));
  return keyed;
}

function normalizeAvailability(payload, query) {
  const items = availabilityItems(payload);
  return items.map((item) => {
    const domain = String(
      item.domainName || item.domain || item.name || item.fqdn || item.host || query || ''
    ).trim().toLowerCase();

    const statusValue = item.status ?? item.availabilityStatus ?? item.availability ?? item.result;
    const explicitAvailability = [
      item.available,
      item.isAvailable,
      item.canRegister,
      item.registerable,
      item.registrable,
      statusValue
    ].map(normalizeBoolean).find(value => value !== null);

    const registered = normalizeBoolean(item.registered ?? item.isRegistered);
    const available = explicitAvailability !== undefined
      ? explicitAvailability
      : registered !== null
        ? !registered
        : false;

    const rawPrice = item.price ?? item.registrationPrice ?? item.registerPrice ?? item.firstYearPrice ?? item.salePrice ?? 0;
    const rawRenewal = item.renewalPrice ?? item.renewPrice ?? item.renewal ?? item.renew ?? item.renewalFee ?? 0;
    const price = Number(rawPrice);
    const renewalPrice = Number(rawRenewal);
    const premium = normalizeBoolean(item.isPremium ?? item.premium) === true;

    return {
      domain,
      available,
      price: Number.isFinite(price) ? price : 0,
      renewalPrice: Number.isFinite(renewalPrice) ? renewalPrice : 0,
      currency: item.currency || item.currencyCode || process.env.DOMAIN_CURRENCY || 'USD',
      premium,
      message: clean(item.reason || item.message || item.description) || (available ? 'Available to register' : premium ? 'Premium domain' : 'Already registered')
    };
  }).filter((item) => item.domain);
}

async function getLiveResellerAccount() {
  if (DOMAIN_API_MODE !== 'live') {
    const err = new Error('Domain API is in test mode. Set DOMAIN_API_MODE=live and use the Live Environment API Key.');
    err.status = 503;
    throw err;
  }
  return domainNameApiRequest('GET', 'deposit/accounts/me');
}

const domainSearchCache = new Map();
const DOMAIN_CACHE_MS = Math.max(10000, Number(process.env.DOMAIN_SEARCH_CACHE_MS || 120000));
const DOMAIN_SEARCH_RESULT_LIMIT = Math.min(50, Math.max(1, Number(process.env.DOMAIN_SEARCH_RESULT_LIMIT || 12)));
const DOMAIN_SEARCH_BATCH_SIZE = Math.min(12, Math.max(1, Number(process.env.DOMAIN_SEARCH_BATCH_SIZE || 12)));
const DOMAIN_SEARCH_BATCH_DELAY_MS = Math.max(0, Number(process.env.DOMAIN_SEARCH_BATCH_DELAY_MS || 150));
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function configuredDomainSearchTlds() {
  const configured = clean(process.env.DOMAIN_SEARCH_TLDS);
  const source = configured ? configured.split(',') : DEFAULT_DOMAIN_SEARCH_TLDS;
  const normalized = source
    .map(value => clean(value).toLowerCase())
    .filter(Boolean)
    .map(value => value.startsWith('.') ? value : `.${value}`)
    .filter(value => /^\.[a-z0-9-]{2,63}(?:\.[a-z0-9-]{2,63})?$/.test(value));
  return [...new Set(normalized.length ? normalized : DEFAULT_DOMAIN_SEARCH_TLDS)];
}

async function searchDomainReseller(query, options = {}) {
  let normalized = clean(query).toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[^a-z0-9.-]/g, '');
  if (normalized && !normalized.includes('.')) normalized += '.com';
  const requestedLimit = Math.min(50, Math.max(1, Number(options.limit || DOMAIN_SEARCH_RESULT_LIMIT)));
  const cacheKey = `${normalized}:${requestedLimit}`;
  const cached = domainSearchCache.get(cacheKey);
  if (cached && Date.now() - cached.time < DOMAIN_CACHE_MS) return cached.value;

  if (!normalized || !normalized.includes('.')) {
    const err = new Error('Enter a full domain name such as example.com');
    err.status = 400;
    throw err;
  }

  const firstDot = normalized.indexOf('.');
  const label = normalized.slice(0, firstDot);
  const requestedTld = normalized.slice(firstDot);
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) {
    const err = new Error('Enter a valid domain name label using letters, numbers, or internal hyphens.');
    err.status = 400;
    throw err;
  }
  if (!/^\.[a-z0-9-]{2,63}(?:\.[a-z0-9-]{2,63})?$/.test(requestedTld)) {
    const err = new Error('Enter a valid domain extension.');
    err.status = 400;
    throw err;
  }
  if (DOMAIN_API_MODE !== 'live') {
    const err = new Error('Real domain search is disabled because DOMAIN_API_MODE is not live. Add the provider Live Environment API Key and set DOMAIN_API_MODE=live.');
    err.status = 503;
    throw err;
  }

  // Keep the complete catalogue, but never query all extensions for one page load.
  // The exact domain is always first, followed by a controlled number of suggestions.
  const catalog = configuredDomainSearchTlds();
  const orderedTlds = [requestedTld, ...catalog.filter(tld => tld !== requestedTld)];
  const selectedTlds = orderedTlds.slice(0, requestedLimit);
  const requestedDomains = selectedTlds.map(tld => ({ domainName: `${label}${tld}` }));
  const allResults = [];
  const batchErrors = [];

  for (let index = 0; index < requestedDomains.length; index += DOMAIN_SEARCH_BATCH_SIZE) {
    const batch = requestedDomains.slice(index, index + DOMAIN_SEARCH_BATCH_SIZE);
    try {
      const payload = await domainNameApiRequest('POST', 'domains/bulk-search', batch);
      allResults.push(...normalizeAvailability(payload, normalized));
    } catch (error) {
      batchErrors.push({
        start: index,
        count: batch.length,
        status: error.status || 502,
        message: error.message
      });
      // Credential, authorization and malformed-request failures will not improve by continuing.
      if ([400, 401, 403].includes(Number(error.status))) break;
    }
    if (index + DOMAIN_SEARCH_BATCH_SIZE < requestedDomains.length && DOMAIN_SEARCH_BATCH_DELAY_MS > 0) {
      await sleep(DOMAIN_SEARCH_BATCH_DELAY_MS);
    }
  }

  const byDomain = new Map(allResults.map(item => [item.domain, item]));
  if (!allResults.length) {
    const first = batchErrors[0];
    const err = new Error(first?.message || 'Domain Name API returned no availability results.');
    err.status = first?.status || 502;
    err.payload = { failedBatches: batchErrors.length };
    throw err;
  }

  const results = requestedDomains.map(item => {
    const found = byDomain.get(item.domainName);
    return found ? { ...found, status: 'verified' } : {
      domain: item.domainName,
      available: null,
      price: null,
      renewalPrice: null,
      currency: process.env.DOMAIN_CURRENCY || 'USD',
      premium: false,
      status: 'unverified',
      message: 'Availability was not returned by the registry for this extension.'
    };
  });

  const verifiedResults = results.filter(item => item.status === 'verified').length;
  const value = {
    source: 'domainnameapi',
    environment: 'live',
    results,
    exactDomain: normalized,
    totalExtensions: catalog.length,
    returnedExtensions: results.length,
    verifiedResults,
    failedBatches: batchErrors.length,
    hasMore: catalog.length > results.length,
    message: batchErrors.length
      ? `Live results returned for ${verifiedResults} of ${results.length} requested extensions. The remaining catalogue was not queried to protect backend stability.`
      : `Exact-domain result and ${Math.max(0, results.length - 1)} controlled suggestions returned from a ${catalog.length}-extension catalogue.`
  };

  domainSearchCache.set(cacheKey, { time: Date.now(), value });
  if (domainSearchCache.size > 250) domainSearchCache.delete(domainSearchCache.keys().next().value);
  return value;
}

function normalizeContact(contact = {}, type = 'Registrant') {
  const firstName = clean(contact.firstName || contact.FirstName);
  const lastName = clean(contact.lastName || contact.LastName);
  const email = clean(contact.email || contact.EMail);
  const phone = clean(contact.phone || contact.Phone);
  const country = clean(contact.country || contact.Country).toUpperCase();
  const address = clean(contact.address || contact.addressLine1 || contact.AddressLine1);
  const city = clean(contact.city || contact.City);
  const state = clean(contact.state || contact.State || city);
  const zipCode = clean(contact.zipCode || contact.postalCode || contact.ZipCode);
  const phoneCountryCode = Number(contact.phoneCountryCode || contact.PhoneCountryCode || 1);
  if (!firstName || !lastName || !email || !phone || !country || !address || !city || !zipCode) return null;
  return {
    contactType: type,
    firstName,
    lastName,
    company: clean(contact.company || contact.Company),
    email,
    addressLine1: address,
    addressLine2: clean(contact.addressLine2 || contact.AddressLine2),
    addressLine3: '',
    city,
    country,
    fax: clean(contact.fax || contact.Fax),
    faxCountryCode: Number(contact.faxCountryCode || contact.FaxCountryCode || phoneCountryCode),
    phone,
    phoneCountryCode,
    type: 'Contact',
    zipCode,
    state
  };
}

function domainItemFromOrder(order) {
  return (order.items || []).find(i => i.type === 'domain' || /\.[a-z]{2,}$/i.test(String(i.domain || i.name || '')));
}

async function provisionPaidDomain(order, user) {
  if (!order || order.status !== 'paid') throw Object.assign(new Error('Payment has not been verified.'), { status: 400 });
  const existing = await ManagedDomain.findOne({ order: order._id });
  if (existing) return existing;
  const item = domainItemFromOrder(order);
  const domain = clean(item?.domain || item?.name).toLowerCase();
  if (!domain) throw Object.assign(new Error('This order does not contain a domain.'), { status: 400 });
  order.domainProvisionStatus = 'processing'; await order.save();
  try {
    const sourceContact = item.contact || user.contact || user;
    const registrant = normalizeContact(sourceContact, 'Registrant');
    if (!registrant) {
      const err = new Error('Complete registrant contact details are required before domain registration: first name, last name, email, phone, country, address, city and postal code.');
      err.status = 400;
      throw err;
    }
    const contacts = ['Registrant', 'Admin', 'Tech', 'Billing'].map((type) => ({ ...registrant, contactType: type }));
    const nameServers = item.nameservers || [process.env.DEFAULT_NS1 || 'dns.domainnameapi.com', process.env.DEFAULT_NS2 || 'web.domainnameapi.com'];
    const provider = await domainNameApiRequest('POST', 'domains/register-with-contacts', {
      domainName: domain,
      period: Number(item.period || item.years || 1),
      nameServers,
      isLocked: true,
      privacyEnabled: Boolean(item.privacyEnabled),
      contacts,
      tldAttributes: item.tldAttributes || {}
    });
    const managed = await ManagedDomain.create({ user: user._id || user.id, order: order._id, domain, status: 'active', nameservers: item.nameservers || [], providerReference: String(provider.reference || provider.orderId || provider.id || ''), providerResponse: provider });
    order.domainProvisionStatus = 'completed'; order.domainProvisionMessage = providerMessage(provider, 'Domain registered successfully'); await order.save();
    return managed;
  } catch (err) {
    order.domainProvisionStatus = 'failed'; order.domainProvisionMessage = err.message; await order.save();
    throw err;
  }
}
const countryCurrency = {
  NG: 'NGN', US: 'USD', GB: 'GBP', CA: 'CAD', AU: 'AUD', EU: 'EUR', DE: 'EUR', FR: 'EUR', ES: 'EUR', IT: 'EUR', NL: 'EUR',
  GH: 'GHS', KE: 'KES', ZA: 'ZAR', EG: 'EGP', CI: 'XOF', SN: 'XOF', BJ: 'XOF', TG: 'XOF', BF: 'XOF', ML: 'XOF', NE: 'XOF', GW: 'XOF',
  IN: 'INR', CN: 'CNY', JP: 'JPY', BR: 'BRL', MX: 'MXN', AE: 'AED', SA: 'SAR', TR: 'TRY'
};
const supportedPaystackCheckoutCurrencies = () => ['NGN','GHS','KES','ZAR','XOF'];
const supportedPaystackVirtualAccountCurrencies = () => ['NGN','GHS'];
const normalizeCurrency = (c, fallback = 'USD') => /^[A-Z]{3}$/.test(String(c || '').toUpperCase()) ? String(c).toUpperCase() : fallback;

async function getRate(from = 'USD', to = 'NGN') {
  from = normalizeCurrency(from); to = normalizeCurrency(to);
  if (from === to) return 1;
  const envKey = `RATE_${from}_${to}`;
  if (Number(process.env[envKey]) > 0) return Number(process.env[envKey]);
  try {
    const endpoint = process.env.EXCHANGE_RATE_API_URL || `https://open.er-api.com/v6/latest/${encodeURIComponent(from)}`;
    const response = await fetch(endpoint,{signal:AbortSignal.timeout(15000)});
    const data = await response.json();
    const rate = Number(data?.rates?.[to] || data?.conversion_rates?.[to]);
    if (rate > 0) return rate;
  } catch {}
  const fallbackKey = `FALLBACK_RATE_${from}_${to}`;
  if (Number(process.env[fallbackKey]) > 0) return Number(process.env[fallbackKey]);
  if (from === 'USD' && to === 'NGN') return Number(process.env.FALLBACK_USD_NGN_RATE || 1500);
  return 1;
}

function toSubunit(amount, currency) {
  const zeroDecimal = ['JPY', 'KRW', 'VND'];
  return Math.round(Number(amount || 0) * (zeroDecimal.includes(currency) ? 1 : 100));
}


app.get('/api/health', (req, res) => {
  const readinessIssues = productionReadinessIssues();
  res.json({
    ok: true,
    status: mongoose.connection.readyState === 1 ? 'ready' : 'starting',
    app: 'World Net Hosting API',
    database: mongoose.connection.readyState === 1 ? 'connected' : 'not-connected',
    productionReady: readinessIssues.length === 0 && mongoose.connection.readyState === 1,
    readinessIssues,
    domainApiConfigured: domainApiConfigured(),
    domainApiMode: DOMAIN_API_MODE,
    domainApiBaseUrl: DOMAIN_API_BASE_URL,
    paystackConfigured: paystackConfigured(),
    paystackEnvironment: Paystack.environment(),
    translatorConfigured: translatorConfigured(),
    staticFrontendServed: true,
    supportedPaystackCheckoutCurrencies: supportedPaystackCheckoutCurrencies(),
    supportedPaystackVirtualAccountCurrencies: supportedPaystackVirtualAccountCurrencies()
  });
});

app.get('/api/domains/provider-status', auth, requireAdmin, async (req, res) => {
  try {
    const account = await getLiveResellerAccount();
    res.json({
      ok: true,
      mode: 'live',
      provider: 'Domain Name API',
      resellerId: account.resellerId || account.id || '',
      resellerName: account.resellerName || account.name || '',
      usdBalance: Number(account.usdBalance || account.balance || 0),
      tryBalance: Number(account.tryBalance || 0)
    });
  } catch (err) {
    res.status(err.status || 502).json({ ok: false, mode: DOMAIN_API_MODE, message: err.message });
  }
});



async function ensureUnifiedResellerAccount(user, input = {}) {
  if (!user) return null;
  if (user.role === 'user' || !user.role) {
    user.role = 'reseller';
    await user.save();
  }
  if (!['reseller','admin'].includes(user.role)) return null;
  let profile = await ResellerProfile.findOne({ user: user._id });
  if (!profile && user.role === 'reseller') {
    const requested = Array.isArray(input.products) ? input.products : [input.products];
    const normalized = requested.flatMap(value => clean(value).toLowerCase() === 'both' ? ['domain_api','bank_api'] : [clean(value).toLowerCase()]);
    const products = [...new Set(normalized.filter(value => ['domain_api','bank_api'].includes(value)))];
    const enabledProducts = products.length ? products : ['domain_api','bank_api'];
    const businessName = clean(input.businessName || input.company) || clean(user.company) || clean(user.name) || 'World Net Hosting Account';
    const autoDomainLive = enabledProducts.includes('domain_api') && String(process.env.AUTO_APPROVE_DOMAIN_RESELLERS||'true').toLowerCase()==='true' && domainLiveConfigured();
    const autoBankLive = enabledProducts.includes('bank_api') && String(process.env.AUTO_APPROVE_BANK_RESELLERS||'false').toLowerCase()==='true' && Paystack.liveConfigured();
    profile = await ResellerProfile.create({
      user:user._id,
      businessName,
      country:clean(input.country),
      registrationNumber:clean(input.registrationNumber),
      website:clean(input.website),
      useCase:clean(input.useCase),
      products:enabledProducts,
      domainApiStatus:autoDomainLive?'live':'sandbox',
      bankApiStatus:autoBankLive?'live':'sandbox',
      status:(autoDomainLive||autoBankLive)?'approved':'sandbox_approved'
    });
  }
  return profile;
}

function frontendBaseUrl() {
  const configured = String(process.env.FRONTEND_URL || '').split(',').map(x => x.trim()).filter(Boolean);
  const preferred = configured[0] || '';
  return preferred.replace(/\/$/, '');
}
app.post('/api/auth/staff/signup',authRequestLimit,async (req,res,next)=>{
  try{
    if(mongoose.connection.readyState!==1)return res.status(503).json({message:'Account service is starting. Please try again shortly.'});
    const name=clean(req.body?.name),email=clean(req.body?.email).toLowerCase(),password=String(req.body?.password||'');
    if(!name||!validEmailAddress(email)||password.length<6)return res.status(400).json({message:'Name, valid email and password of at least 6 characters are required.'});
    const existing=await User.findOne({email});if(existing)return res.status(409).json({message:'An account already exists with this email. Please sign in.'});
    const user=await User.create({name,email,emailAddress:email,phone:clean(req.body?.phone),company:clean(req.body?.company),passwordHash:await bcrypt.hash(password,10),role:'staff',staffPermissions:DEFAULT_STAFF_PERMISSIONS,staffApprovalStatus:'pending',active:false,accountStatus:'suspended',riskStatus:'normal'});
    return res.status(201).json({success:true,pendingApproval:true,message:'Staff signup received. An administrator must approve this staff account before dashboard access is enabled.',user:toPublicUser(user)});
  }catch(error){if(error?.code===11000)return res.status(409).json({message:'Email already registered.'});return next(error);}
});

app.post('/api/auth/signup',authRequestLimit,async (req, res, next) => {
  try {
    if (mongoose.connection.readyState !== 1) return res.status(503).json({ message: 'Account service is starting. Please try again shortly.' });
    const name = clean(req.body?.name);
    const email = clean(req.body?.email).toLowerCase();
    const password = String(req.body?.password || '');
    if (!name || !validEmailAddress(email) || password.length < 6) return res.status(400).json({ message: 'Name, valid email and password of at least 6 characters are required.' });
    const existingRaw = await User.collection.findOne({ $or: [{ email }, { emailAddress: email }, { username: email }] }, { projection: { _id: 1, active: 1, isActive: 1, accountStatus: 1 } });
    if (existingRaw) {
      const inactive = existingRaw.active === false || existingRaw.isActive === false || ['inactive','disabled','suspended','deleted'].includes(clean(existingRaw.accountStatus).toLowerCase());
      return res.status(409).json({ success:false, code:'ACCOUNT_EXISTS', message: inactive ? 'This email belongs to an inactive account. Contact support to restore access.' : 'An account already exists with this email. Please sign in.' });
    }
    const requestedRole = 'reseller';
    const company = clean(req.body?.company || req.body?.businessName);
    const user = await User.create({ name, email, emailAddress: email, phone: clean(req.body?.phone), company, passwordHash: await bcrypt.hash(password, 10), role: requestedRole, active: true });
    await ensureUnifiedResellerAccount(user, req.body || {});
    const wallet=await getOrCreateWallet(user);
    queueDedicatedAccountAssignment(user,wallet);
    return res.status(201).json({ success:true, message: 'Signup successful. Create your dashboard PIN.', token: signToken(user), user: toPublicUser(user), next: 'create-pin', accountType: requestedRole });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ message: 'Email already registered. Please sign in.' });
    return next(error);
  }
});


app.post('/api/auth/password/reset-with-pin', authRequestLimit, async (req, res) => {
  const email = clean(req.body.email).toLowerCase();
  const pin = String(req.body.pin || '').trim();
  const newPassword = String(req.body.newPassword || '');
  if (!validEmailAddress(email) || !/^\d{4,6}$/.test(pin) || newPassword.length < 6) return res.status(400).json({ message: 'Valid email, current PIN and a new password of at least 6 characters are required.' });
  const user = await User.findOne({ email });
  if (!user || !user.pinHash || !(await bcrypt.compare(pin, user.pinHash))) return res.status(401).json({ message: 'Email or PIN is incorrect.' });
  user.passwordHash = await bcrypt.hash(newPassword, 10);
  await user.save();
  res.json({ message: 'Password reset successfully. You can now sign in.' });
});

app.post('/api/auth/pin/reset-with-password', authRequestLimit, async (req, res) => {
  const email = clean(req.body.email).toLowerCase();
  const password = String(req.body.password || '');
  const newPin = String(req.body.newPin || '').trim();
  if (!validEmailAddress(email) || !password || !/^\d{4,6}$/.test(newPin)) return res.status(400).json({ message: 'Valid email, current password and a new 4–6 digit PIN are required.' });
  const found = await findAccountForAuthentication(email);
  const user = found.user;
  const hash = storedPasswordHash(user, found.raw);
  let valid = false; try { valid = Boolean(user && hash && await bcrypt.compare(password, hash)); } catch {}
  if (!valid) return res.status(401).json({ message: 'Email or password is incorrect.' });
  await migrateLegacyAccountAfterSuccessfulLogin(user, found.raw, email, hash);
  user.pinHash = await bcrypt.hash(newPin, 10);
  await user.save();
  res.json({ message: 'PIN reset successfully. Sign in to continue.' });
});

app.patch('/api/auth/account', auth, async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user) return res.status(404).json({ message: 'User not found.' });
  const currentPassword = String(req.body.currentPassword || '');
  if (!currentPassword || !(await bcrypt.compare(currentPassword, user.passwordHash))) return res.status(401).json({ message: 'Current password is incorrect.' });
  const nextEmail = clean(req.body.email).toLowerCase();
  const nextPassword = String(req.body.newPassword || '');
  const nextPin = String(req.body.newPin || '').trim();
  if (nextEmail) {
    if (!validEmailAddress(nextEmail)) return res.status(400).json({ message: 'Enter a valid email address.' });
    const existing = await User.findOne({ $or:[{email:nextEmail},{alternateEmails:nextEmail}], _id: { $ne: user._id } });
    if (existing) return res.status(409).json({ message: 'That email address is already in use.' });
    const previous=user.email;
    user.email = nextEmail;
    user.alternateEmails=(user.alternateEmails||[]).filter(item=>item!==nextEmail && item!==previous);
    const wallet=await Wallet.findOne({user:user._id}); if(wallet){wallet.email=nextEmail;await wallet.save();}
  }
  if (nextPassword) {
    if (nextPassword.length < 8) return res.status(400).json({ message: 'New password must be at least 8 characters.' });
    user.passwordHash = await bcrypt.hash(nextPassword, 12);
  }
  if (nextPin) {
    if (!/^\d{4,6}$/.test(nextPin)) return res.status(400).json({ message: 'New PIN must be 4–6 numbers.' });
    user.pinHash = await bcrypt.hash(nextPin, 10);
  }
  if (!nextEmail && !nextPassword && !nextPin) return res.status(400).json({ message: 'Enter a new primary email, password or PIN.' });
  await user.save();
  res.json({ message: 'Account security details updated successfully.', user: toPublicUser(user), token: signToken(user) });
});

app.patch('/api/auth/profile', auth, async(req,res)=>{
  const user=await User.findById(req.user.id); if(!user)return res.status(404).json({message:'User not found.'});
  if(req.body.name!==undefined){const name=clean(req.body.name);if(name.length<2)return res.status(400).json({message:'Enter your full name.'});user.name=name.slice(0,120);}
  if(req.body.phone!==undefined)user.phone=clean(req.body.phone).slice(0,40);
  if(req.body.company!==undefined)user.company=clean(req.body.company).slice(0,160);
  await user.save({validateModifiedOnly:true});
  res.json({message:'Profile updated successfully.',user:toPublicUser(user)});
});

app.post('/api/auth/emails', auth, async(req,res)=>{
  const email=normalizeEmail(req.body.email);if(!validEmailAddress(email))return res.status(400).json({message:'Enter a valid email address.'});
  const user=await User.findById(req.user.id);if(!user)return res.status(404).json({message:'User not found.'});
  if(email===user.email || (user.alternateEmails||[]).includes(email))return res.status(409).json({message:'That email is already on your account.'});
  const existing=await User.findOne({$or:[{email},{alternateEmails:email}],_id:{$ne:user._id}});if(existing)return res.status(409).json({message:'That email address is already in use.'});
  user.alternateEmails=[...(user.alternateEmails||[]),email].slice(0,5);await user.save({validateModifiedOnly:true});
  res.status(201).json({message:'Additional email added.',user:toPublicUser(user)});
});
app.delete('/api/auth/emails', auth, async(req,res)=>{
  const email=normalizeEmail(req.body.email||req.query.email);const user=await User.findById(req.user.id);if(!user)return res.status(404).json({message:'User not found.'});
  if(email===user.email)return res.status(400).json({message:'Your primary sign-in email cannot be removed. Change the primary email first.'});
  const before=(user.alternateEmails||[]).length;user.alternateEmails=(user.alternateEmails||[]).filter(item=>item!==email);if(user.alternateEmails.length===before)return res.status(404).json({message:'Email not found on your account.'});
  await user.save({validateModifiedOnly:true});res.json({message:'Email removed.',user:toPublicUser(user)});
});
app.post('/api/auth/profile/photo', auth, profilePhotoUpload.single('photo'), async(req,res)=>{
  try{
    if(!req.file)return res.status(400).json({message:'Choose a profile photo.'});
    const user=await User.findById(req.user.id).select('+profilePhoto.data');if(!user)return res.status(404).json({message:'User not found.'});
    user.profilePhoto={data:req.file.buffer,contentType:req.file.mimetype,updatedAt:new Date()};await user.save({validateModifiedOnly:true});
    res.status(201).json({message:'Profile photo updated.',profilePhotoUpdatedAt:user.profilePhoto.updatedAt});
  }catch(error){res.status(error instanceof multer.MulterError?400:500).json({message:error.message||'Profile photo could not be uploaded.'});}
});
app.get('/api/auth/profile/photo', auth, async(req,res)=>{
  const user=await User.findById(req.user.id).select('+profilePhoto.data');if(!user?.profilePhoto?.data?.length)return res.status(404).end();
  res.setHeader('Content-Type',user.profilePhoto.contentType||'image/jpeg');res.setHeader('Cache-Control','private, max-age=300');res.send(user.profilePhoto.data);
});
app.delete('/api/auth/profile/photo', auth, async(req,res)=>{
  const user=await User.findById(req.user.id).select('+profilePhoto.data');if(!user)return res.status(404).json({message:'User not found.'});
  user.profilePhoto={data:undefined,contentType:'',updatedAt:null};await user.save({validateModifiedOnly:true});res.json({message:'Profile photo removed.'});
});

app.post('/api/auth/login',authRequestLimit,async (req, res, next) => {
  try {
    if (mongoose.connection.readyState !== 1) return res.status(503).json({ message: 'Account service is starting. Please try again shortly.' });
    const email = clean(req.body?.email).toLowerCase();
    const password = String(req.body?.password || '');
    if (!validEmailAddress(email) || !password) return res.status(400).json({ message: 'Enter a valid email address and password.' });
    const found = await findAccountForAuthentication(email);
    const user = found.user;
    const storedHash = storedPasswordHash(user, found.raw);
    let passwordMatches = false;
    try { passwordMatches = Boolean(user && storedHash && await bcrypt.compare(password, storedHash)); } catch { passwordMatches = false; }
    if (!passwordMatches) return res.status(401).json({ success:false, code:'INVALID_CREDENTIALS', message: 'The email or password is incorrect.' });
    if (accountIsInactive(user, found.raw)) return res.status(403).json({ success:false, code:'ACCOUNT_INACTIVE', message: 'This account is currently inactive. Please contact support.' });
    await migrateLegacyAccountAfterSuccessfulLogin(user, found.raw, email, storedHash);
    await ensureUnifiedResellerAccount(user, req.body || {});
    return res.json({ success:true, message: user.pinHash ? 'Login successful. Enter your PIN.' : 'Login successful. Create your PIN.', token: signToken(user), user: toPublicUser(user), next: user.pinHash ? 'verify-pin' : 'create-pin' });
  } catch (error) { return next(error); }
});

const adminPinAttempts = new Map();

app.get('/api/auth/me', auth, async (req, res) => {
  const user = await User.findById(req.user.id).select('-passwordHash -password -password_hash -pinHash');
  if (!user) return res.status(404).json({ success:false, code:'ACCOUNT_NOT_FOUND', message:'Account not found.' });
  return res.json({ success:true, user:toPublicUser(user) });
});

async function ensureAdminPrincipal(){
  let user=await User.findOne({role:'admin',active:{$ne:false},accountStatus:{$nin:['suspended','disabled']}}).sort({createdAt:1});
  if(user)return user;
  const email=normalizeEmail(process.env.ADMIN_ACCOUNT_EMAIL||'admin@worldnethosting.local');
  user=await User.findOne({email});
  if(user){user.role='admin';user.active=true;user.accountStatus='active';await user.save({validateModifiedOnly:true});return user;}
  return User.create({name:clean(process.env.ADMIN_ACCOUNT_NAME)||'World Net Hosting Administrator',email,role:'admin',active:true,accountStatus:'active',riskStatus:'normal'});
}

app.post('/api/auth/admin/login',authRequestLimit,async (req, res) => {
  const key = req.ip || req.socket?.remoteAddress || 'unknown';
  const now = Date.now();
  const state = adminPinAttempts.get(key) || { count: 0, lockedUntil: 0 };
  if (state.lockedUntil > now) return res.status(429).json({ message: 'Too many failed attempts. Try again later.' });
  const configuredPin = clean(process.env.ADMIN_LOGIN_PIN);
  if (!/^\d{6,12}$/.test(configuredPin)) return res.status(503).json({ message: 'ADMIN_LOGIN_PIN must be configured as a 6–12 digit backend secret.' });
  const suppliedPin = clean(req.body.pin);
  const suppliedBuffer = Buffer.from(suppliedPin);
  const configuredBuffer = Buffer.from(configuredPin);
  const pinMatches = /^\d{6,12}$/.test(suppliedPin) && suppliedBuffer.length === configuredBuffer.length && crypto.timingSafeEqual(suppliedBuffer, configuredBuffer);
  if (!pinMatches) {
    state.count += 1;
    if (state.count >= 5) { state.lockedUntil = now + 15 * 60 * 1000; state.count = 0; }
    adminPinAttempts.set(key, state);
    return res.status(401).json({ message: 'Incorrect administrator PIN' });
  }
  const user = await ensureAdminPrincipal();
  adminPinAttempts.delete(key);
  res.json({ message: 'Admin login successful.', token: signToken(user), user: toPublicUser(user), next: 'admin-dashboard' });
});

app.post('/api/auth/pin/create', auth, async (req, res) => {
  const pin = String(req.body.pin || '').trim();
  if (!/^\d{4,6}$/.test(pin)) return res.status(400).json({ message: 'PIN must be 4 to 6 numbers' });
  const user = await User.findById(req.user.id);
  if (!user) return res.status(404).json({ message: 'User not found' });
  user.pinHash = await bcrypt.hash(pin, 10);
  await user.save();
  res.json({ message: 'PIN created successfully. Dashboard access unlocked.', user: toPublicUser(user), dashboardAccess: true });
});

app.post('/api/auth/pin/verify', auth, async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user || !user.pinHash) return res.status(409).json({ code:'PIN_NOT_SET', message: 'No PIN found. Please create a PIN.' });
  const ok = await bcrypt.compare(String(req.body.pin || ''), user.pinHash);
  if (!ok) return res.status(401).json({ message: 'Incorrect PIN' });
  res.json({ message: 'PIN verified. Dashboard access unlocked.', user: toPublicUser(user), dashboardAccess: true });
});

app.get('/api/user/dashboard', auth, async (req, res) => {
  const user = await User.findById(req.user.id).select('-passwordHash -pinHash');
  if (!user) return res.status(404).json({ message: 'User not found' });
  const wallet = await getOrCreateWallet(user);
  const orders = await Order.find({ customerEmail: req.user.email }).sort({ createdAt: -1 }).limit(10);
  const domains = await ManagedDomain.find({ user: user._id }).sort({ createdAt: -1 });
  res.json({ user, domains, wallet: { balance: wallet.balance, currency: wallet.currency, dedicatedAccount: wallet.dedicatedAccount, transactions: wallet.transactions.slice(-10).reverse() }, orders, summary: { orders: orders.length, supportStatus: 'Active', balance: wallet.balance, currency: wallet.currency } });
});


async function requireReseller(req,res,next){ try{if(req.user?.role==='admin')return next();const user=await User.findById(req.user?.id);if(!user)return res.status(401).json({message:'Account not found.'});await ensureUnifiedResellerAccount(user,{});if(user.role!=='reseller')return res.status(403).json({message:'Account portal access is required.'});req.user.role='reseller';return next();}catch(error){return next(error);} }
function makeApiKey(prefix){ return `${prefix}_${crypto.randomBytes(24).toString('hex')}`; }
function developerWebhookSecret(projectId){const master=clean(process.env.JWT_SECRET);if(!master)return '';return crypto.createHmac('sha256',master).update(`developer-webhook:${String(projectId)}`).digest('hex');}
async function deliverDeveloperWebhook(delivery){
  const profile=await ResellerProfile.findById(delivery.resellerProfile);const project=profile?.apiProjects?.id(delivery.apiProjectId);if(!project?.webhookUrl){delivery.status='failed';delivery.lastError='Webhook URL is no longer configured.';return delivery.save();}
  const secret=developerWebhookSecret(project._id);if(!secret){delivery.status='failed';delivery.lastError='Developer webhook signing secret is not configured.';return delivery.save();}
  const timestamp=new Date().toISOString(),body=JSON.stringify(delivery.payload),signature=crypto.createHmac('sha256',secret).update(`${delivery.eventId}.${timestamp}.${body}`).digest('hex');
  delivery.attempts+=1;try{const response=await fetch(project.webhookUrl,{method:'POST',headers:{'content-type':'application/json','x-wnh-event-id':delivery.eventId,'x-wnh-timestamp':timestamp,'x-wnh-signature':signature},body,signal:AbortSignal.timeout(10000)});delivery.lastStatusCode=response.status;if(response.ok){delivery.status='delivered';delivery.deliveredAt=new Date();delivery.lastError='';}else{delivery.status=delivery.attempts>=5?'failed':'pending';delivery.lastError=`HTTP ${response.status}`;delivery.nextAttemptAt=new Date(Date.now()+Math.min(3600000,30000*(2**delivery.attempts)));}}catch(error){delivery.status=delivery.attempts>=5?'failed':'pending';delivery.lastError=clean(error.message);delivery.nextAttemptAt=new Date(Date.now()+Math.min(3600000,30000*(2**delivery.attempts)));}await delivery.save();return delivery;
}
async function queueDeveloperWebhook(profileId,projectId,event,payload){const profile=await ResellerProfile.findById(profileId);const project=profile?.apiProjects?.id(projectId);if(!project?.webhookUrl)return null;const eventId=`evt_${crypto.randomUUID()}`;const delivery=await DeveloperWebhookDelivery.create({resellerProfile:profileId,apiProjectId:projectId,eventId,event,url:project.webhookUrl,payload:{id:eventId,event,createdAt:new Date().toISOString(),data:payload}});deliverDeveloperWebhook(delivery).catch(()=>{});return delivery;}

const apiCredentialFields=(product,environment)=>{
  const prefix=product==='domain'?'domain':'bank';
  const env=environment==='live'?'Live':'Sandbox';
  return {publicField:`${prefix}${env}PublicKey`,secretField:`${prefix}${env}SecretHash`,encryptedField:`${prefix}${env}SecretEncrypted`};
};
function productKey(product){return product==='domain'?'domain_api':'bank_api';}
function productEnabled(profile,product){return profile?.products?.includes(productKey(product));}
async function ensureResellerProductEnabled(profile,product){
  if(!profile||productEnabled(profile,product))return false;
  const key=productKey(product);
  profile.products=Array.isArray(profile.products)?profile.products:[];
  if(!profile.products.includes(key))profile.products.push(key);
  if(product==='domain'&&(!profile.domainApiStatus||['pending','rejected','suspended'].includes(profile.domainApiStatus)))profile.domainApiStatus='sandbox';
  if(product==='bank'&&(!profile.bankApiStatus||['pending','rejected','suspended'].includes(profile.bankApiStatus)))profile.bankApiStatus='sandbox';
  await profile.save();
  return true;
}
function productStatus(profile,product){return product==='domain'?profile?.domainApiStatus:profile?.bankApiStatus;}
function domainLiveConfigured(){
  const provider=clean(process.env.DOMAIN_API_PROVIDER||'domainnameapi').toLowerCase();
  return provider==='domainnameapi' && String(process.env.DOMAIN_API_LIVE_ENABLED||'false').toLowerCase()==='true' && domainApiConfigured() && DOMAIN_API_MODE==='live';
}
function liveProductReady(profile,product){
  if(!productEnabled(profile,product)) return false;
  if(product==='domain') return domainLiveConfigured();
  if(product==='bank') return Paystack.liveConfigured();
  return false;
}
function publicCredential(profile,product,environment){const f=apiCredentialFields(product,environment);return profile?.[f.publicField]||'';}
app.get('/api/reseller/dashboard', auth, requireReseller, async (req,res)=>{
  const user=await User.findById(req.user.id).select('-passwordHash -pinHash');
  const profile=await ResellerProfile.findOne({user:req.user.id});
  const wallet=await getOrCreateWallet(user);
  const domains=await ManagedDomain.find({user:req.user.id}).sort({createdAt:-1}).limit(20);
  const orders=await Order.find({user:req.user.id}).sort({createdAt:-1}).limit(20);
  const safeProfile=profile?{businessName:profile.businessName,country:profile.country,website:profile.website,products:profile.products,status:profile.status,domainApiStatus:domainLiveConfigured()?'live':profile.domainApiStatus,bankApiStatus:liveProductReady(profile,'bank')?'live':profile.bankApiStatus}:null;
  res.json({user,profile:safeProfile,wallet:{currency:wallet.currency,balance:wallet.balance,balances:walletBalancesObject(wallet),transactions:wallet.transactions.slice(-20).reverse()},domains,orders,domainApi:{mode:domainLiveConfigured()?'live':'sandbox',provider:clean(process.env.DOMAIN_API_PROVIDER||'domainnameapi'),baseUrl:DOMAIN_API_BASE_URL,liveEnabled:domainLiveConfigured()},bankApi:{mode:liveProductReady(profile,'bank')?'live':'sandbox',provider:'paystack',baseUrl:Paystack.baseUrl(),liveEnabled:liveProductReady(profile,'bank')},apiBase:`${String(process.env.BACKEND_URL||'').replace(/\/$/,'')}/api/v1`,summary:{domains:domains.length,orders:orders.length,products:profile?.products||[]}});
});
function apiProjectSummary(project){
  const product=project.product;
  const sandboxFields=apiCredentialFields(product,'sandbox'),liveFields=apiCredentialFields(product,'live');
  return {
    id:String(project._id),name:project.name,website:project.website||'',product,
    scopes:project.scopes||[],webhookUrl:project.webhookUrl||'',allowedIps:project.allowedIps||[],revokedAt:project.revokedAt||null,
    sandbox:{publicKey:project[sandboxFields.publicField]||'',secretAvailable:Boolean(project[sandboxFields.encryptedField])},
    live:{publicKey:project[liveFields.publicField]||'',secretAvailable:Boolean(project[liveFields.encryptedField])},
    createdAt:project.createdAt,updatedAt:project.updatedAt
  };
}
async function migrateLegacyApiKeys(profile){
  if(!profile)return profile;
  profile.apiProjects=profile.apiProjects||[];
  const legacyProducts=['domain','bank'];
  let changed=false;
  for(const product of legacyProducts){
    const sandboxFields=apiCredentialFields(product,'sandbox'),liveFields=apiCredentialFields(product,'live');
    const hasLegacy=Boolean(profile[sandboxFields.publicField]||profile[liveFields.publicField]);
    if(!hasLegacy)continue;
    let project=profile.apiProjects.find(item=>item.product===product&&item.name==='Legacy API Project');
    if(!project){profile.apiProjects.push({name:'Legacy API Project',website:profile.website||'',product});project=profile.apiProjects[profile.apiProjects.length-1];changed=true;}
    for(const fields of [sandboxFields,liveFields]){
      if(profile[fields.publicField]&&!project[fields.publicField]){project[fields.publicField]=profile[fields.publicField];project[fields.secretField]=profile[fields.secretField];changed=true;}
      if(profile[fields.publicField]){profile[fields.publicField]='';profile[fields.secretField]='';changed=true;}
    }
  }
  if(changed)await profile.save();
  return profile;
}
app.get('/api/reseller/api-projects',auth,requireReseller,async(req,res)=>{
  res.set('Cache-Control','no-store');
  const product=clean(req.query.product).toLowerCase();
  if(product&&!['domain','bank'].includes(product))return res.status(400).json({message:'Select domain or bank API.'});
  let profile=await ResellerProfile.findOne({user:req.user.id});
  if(!profile)return res.status(404).json({message:'Reseller profile not found.'});
  if(product) await ensureResellerProductEnabled(profile,product);
  profile=await migrateLegacyApiKeys(profile);
  if(product && !(profile.apiProjects||[]).some(item=>item.product===product)){
    profile.apiProjects.push({name:product==='domain'?'Domain API':'Banking API',website:'',product,scopes:product==='domain'?['domains:read']:['banking:read','payments:create','accounts:create','payouts:create','webhooks:write']});
    await profile.save();
  }
  const projects=(profile.apiProjects||[]).filter(item=>!product||item.product===product).sort((a,b)=>new Date(a.createdAt||0)-new Date(b.createdAt||0)).map(apiProjectSummary);
  res.json({projects,liveReady:product?liveProductReady(profile,product):false,status:product?productStatus(profile,product):profile.status,baseUrl:`${String(process.env.BACKEND_URL||'').replace(/\/$/,'')}/api/v1`});
});
app.post('/api/reseller/api-projects',auth,requireReseller,async(req,res)=>{
  const product=clean(req.body?.product).toLowerCase(),name=clean(req.body?.name);
  if(!['domain','bank'].includes(product))return res.status(400).json({message:'Select Domain API or Banking API.'});
  if(name.length<2||name.length>80)return res.status(400).json({message:'Project name must contain 2 to 80 characters.'});
  const profile=await ResellerProfile.findOne({user:req.user.id});
  await ensureResellerProductEnabled(profile,product);
  if(!profile||!productEnabled(profile,product))return res.status(403).json({message:`${product==='domain'?'Domain':'Banking'} API is not enabled for this reseller.`});
  await migrateLegacyApiKeys(profile);
  if((profile.apiProjects||[]).some(item=>item.product===product&&item.name.toLowerCase()===name.toLowerCase()))return res.status(409).json({message:'An API project with this name already exists.'});
  profile.apiProjects.push({name,website:'',product,scopes:product==='domain'?['domains:read']:['banking:read','payments:create','accounts:create','payouts:create','webhooks:write']});await profile.save();
  const project=profile.apiProjects[profile.apiProjects.length-1];
  res.status(201).json({message:`${name} was created successfully.`,project:apiProjectSummary(project)});
});
app.delete('/api/reseller/api-projects/:projectId',auth,requireReseller,async(req,res)=>{
  const profile=await ResellerProfile.findOne({user:req.user.id});if(!profile)return res.status(404).json({message:'Reseller profile not found.'});
  const project=profile.apiProjects.id(req.params.projectId);if(!project)return res.status(404).json({message:'API project not found on this account.'});
  const name=project.name;project.deleteOne();await profile.save();
  res.json({message:`${name} and all of its API credentials were deleted.`});
});
app.post('/api/reseller/api-projects/:projectId/credentials/:environment',auth,requireReseller,async(req,res)=>{
  res.set('Cache-Control','no-store');
  const environment=clean(req.params.environment).toLowerCase();if(!['sandbox','live'].includes(environment))return res.status(400).json({message:'Select test or live environment.'});
  const profile=await ResellerProfile.findOne({user:req.user.id});if(!profile)return res.status(404).json({message:'Reseller profile not found.'});
  const project=profile.apiProjects.id(req.params.projectId);if(!project)return res.status(404).json({message:'API project not found on this account.'});
  const product=project.product;
  await ensureResellerProductEnabled(profile,product);
  if(!productEnabled(profile,product))return res.status(403).json({message:'This API product is not enabled.'});
  if(environment==='live'&&!liveProductReady(profile,product)){
    const message=product==='bank'?'Live Banking API is disabled until the active Paystack environment is live and valid live credentials are configured.':'Live Domain API is pending provider configuration.';
    return res.status(403).json({message,code:'LIVE_API_PENDING'});
  }
  const fields=apiCredentialFields(product,environment);
  if(project[fields.publicField])return res.status(409).json({message:`This project already has a ${environment==='live'?'live':'test'} API key. It remains active until deleted.`,publicKey:project[fields.publicField]});
  const envPart=environment==='live'?'LIVE':'SANDBOX',productPart=product==='domain'?'DOMAIN_RESELLER':'BANK_RESELLER';
  const publicPrefix=clean(process.env[`${productPart}_${envPart}_PUBLIC_KEY_PREFIX`])||`wnh_${product}_pk_${environment==='live'?'live':'test'}`;
  const secretPrefix=clean(process.env[`${productPart}_${envPart}_SECRET_KEY_PREFIX`])||`wnh_${product}_sk_${environment==='live'?'live':'test'}`;
  const publicKey=makeApiKey(publicPrefix),secretKey=makeApiKey(secretPrefix);
  project[fields.publicField]=publicKey;project[fields.secretField]=await bcrypt.hash(secretKey,12);project[fields.encryptedField]=encryptWithdrawalValue(secretKey);project.revokedAt=null;project.lastKeyCreatedAt=new Date();if(!project.scopes?.length)project.scopes=product==='domain'?['domains:read']:['banking:read','payments:create','accounts:create','payouts:create','webhooks:write'];await profile.save();
  res.json({message:`${environment==='live'?'Live':'Test'} credentials created for ${project.name}. Save the secret now; it will not be shown again.`,projectId:String(project._id),projectName:project.name,product,environment,publicKey,secretKey,baseUrl:`${String(process.env.BACKEND_URL||'').replace(/\/$/,'')}/api/v1`,callbackUrl:`${String(process.env.BACKEND_URL||'').replace(/\/$/,'')}/api/v1/callback/${product}/${String(project._id)}/${environment}`});
});
app.delete('/api/reseller/api-projects/:projectId/credentials/:environment',auth,requireReseller,async(req,res)=>{
  const environment=clean(req.params.environment).toLowerCase();if(!['sandbox','live'].includes(environment))return res.status(400).json({message:'Select test or live environment.'});
  const profile=await ResellerProfile.findOne({user:req.user.id});if(!profile)return res.status(404).json({message:'Reseller profile not found.'});
  const project=profile.apiProjects.id(req.params.projectId);if(!project)return res.status(404).json({message:'API project not found on this account.'});
  const fields=apiCredentialFields(project.product,environment);if(!project[fields.publicField])return res.status(404).json({message:'No API key exists for this project and environment.'});
  project[fields.publicField]='';project[fields.secretField]='';project[fields.encryptedField]='';await profile.save();
  res.json({message:`${environment==='live'?'Live':'Test'} credentials deleted from ${project.name}.`});
});
app.patch('/api/reseller/api-projects/:projectId/settings',auth,requireReseller,async(req,res)=>{
  const profile=await ResellerProfile.findOne({user:req.user.id});if(!profile)return res.status(404).json({message:'Reseller profile not found.'});
  const project=profile.apiProjects.id(req.params.projectId);if(!project)return res.status(404).json({message:'API project not found.'});
  const allowedScopes=project.product==='domain'?['domains:read']:['banking:read','payments:create','accounts:create','payouts:create','webhooks:write'];
  if(Array.isArray(req.body.scopes)){const scopes=[...new Set(req.body.scopes.map(clean))];if(scopes.some(x=>!allowedScopes.includes(x)))return res.status(400).json({message:'One or more scopes are invalid for this product.'});project.scopes=scopes;}
  if(req.body.allowedIps!==undefined){if(!Array.isArray(req.body.allowedIps))return res.status(400).json({message:'allowedIps must be an array.'});project.allowedIps=[...new Set(req.body.allowedIps.map(clean).filter(Boolean))].slice(0,20);}
  let webhookSecret='';
  if(req.body.webhookUrl!==undefined){
    const url=clean(req.body.webhookUrl);
    if(url){try{const u=new URL(url);if(u.protocol!=='https:')throw new Error();}catch{return res.status(400).json({message:'Developer webhook URL must be HTTPS.'});}}
    project.webhookUrl=url;webhookSecret=url?developerWebhookSecret(project._id):'';project.webhookSigningSecretHash=webhookSecret?crypto.createHash('sha256').update(webhookSecret).digest('hex'):'';
  }
  await profile.save();res.json({message:'API project settings updated.',project:apiProjectSummary(project),webhookSigningSecret:webhookSecret||undefined});
});
app.post('/api/reseller/api-projects/:projectId/revoke',auth,requireReseller,async(req,res)=>{const profile=await ResellerProfile.findOne({user:req.user.id});if(!profile)return res.status(404).json({message:'Reseller profile not found.'});const project=profile.apiProjects.id(req.params.projectId);if(!project)return res.status(404).json({message:'API project not found.'});project.revokedAt=new Date();await profile.save();res.json({message:'All API credentials for this project are revoked.'});});
app.post('/api/reseller/api-projects/:projectId/credentials/:environment/rotate',auth,requireReseller,async(req,res)=>{res.set('Cache-Control','no-store');const environment=clean(req.params.environment).toLowerCase();if(!['sandbox','live'].includes(environment))return res.status(400).json({message:'Select sandbox or live.'});const profile=await ResellerProfile.findOne({user:req.user.id});const project=profile?.apiProjects?.id(req.params.projectId);if(!project)return res.status(404).json({message:'API project not found.'});if(environment==='live'&&!liveProductReady(profile,project.product))return res.status(403).json({message:'Live API is not enabled.'});const f=apiCredentialFields(project.product,environment),envPart=environment==='live'?'LIVE':'SANDBOX',productPart=project.product==='domain'?'DOMAIN_RESELLER':'BANK_RESELLER',publicPrefix=clean(process.env[`${productPart}_${envPart}_PUBLIC_KEY_PREFIX`])||`wnh_${project.product}_pk_${environment==='live'?'live':'test'}`,secretPrefix=clean(process.env[`${productPart}_${envPart}_SECRET_KEY_PREFIX`])||`wnh_${project.product}_sk_${environment==='live'?'live':'test'}`,publicKey=makeApiKey(publicPrefix),secretKey=makeApiKey(secretPrefix);project[f.publicField]=publicKey;project[f.secretField]=await bcrypt.hash(secretKey,12);project[f.encryptedField]=encryptWithdrawalValue(secretKey);project.revokedAt=null;project.lastKeyCreatedAt=new Date();await profile.save();res.json({message:'API credentials rotated. Save the new secret now.',publicKey,secretKey,environment});});


app.post('/api/reseller/api-projects/:projectId/credentials/:environment/reveal',auth,requireReseller,async(req,res)=>{
  try{
    res.set('Cache-Control','no-store');
    const environment=clean(req.params.environment).toLowerCase();
    if(!['sandbox','live'].includes(environment))return res.status(400).json({message:'Select sandbox or live.'});
    const password=String(req.body.password||'');
    if(!password)return res.status(400).json({message:'Enter your account password to reveal the secret key.'});
    const user=await User.findById(req.user.id);
    const storedHash=userPasswordHash(user);
    let passwordMatches=false;
    try{passwordMatches=Boolean(user&&storedHash&&await bcrypt.compare(password,storedHash));}catch{}
    if(!passwordMatches)return res.status(401).json({message:'Incorrect account password.'});
    const profile=await ResellerProfile.findOne({user:req.user.id});
    const project=profile?.apiProjects?.id(req.params.projectId);
    if(!project)return res.status(404).json({message:'API project not found.'});
    const f=apiCredentialFields(project.product,environment);
    if(!project[f.publicField])return res.status(404).json({message:'API credentials have not been generated.'});
    if(!project[f.encryptedField])return res.status(409).json({code:'ROTATION_REQUIRED',message:'This older secret was stored as a one-way hash and cannot be recovered. Rotate this credential once to make future secure reveal available.'});
    let secretKey='';
    try{secretKey=decryptWithdrawalValue(project[f.encryptedField]);}catch(_){return res.status(409).json({message:'Stored secret cannot be decrypted. Rotate this credential to create a new revealable secret.'});}
    res.json({projectId:String(project._id),product:project.product,environment,publicKey:project[f.publicField],secretKey});
  }catch(e){res.status(e.status||500).json({message:e.message});}
});

// Compatibility endpoint: returns all named projects instead of one account-wide credential.
app.get('/api/reseller/credentials/:product',auth,requireReseller,async(req,res)=>{
  const product=clean(req.params.product).toLowerCase();if(!['domain','bank'].includes(product))return res.status(400).json({message:'Select domain or bank API.'});
  let profile=await ResellerProfile.findOne({user:req.user.id});await ensureResellerProductEnabled(profile,product);if(!profile||!productEnabled(profile,product))return res.status(403).json({message:'API product is not enabled for this reseller.'});
  profile=await migrateLegacyApiKeys(profile);res.json({product,status:productStatus(profile,product),liveReady:liveProductReady(profile,product),projects:(profile.apiProjects||[]).filter(item=>item.product===product).map(apiProjectSummary),baseUrl:`${String(process.env.BACKEND_URL||'').replace(/\/$/,'')}/api/v1`});
});
function developerRequiredScope(req,product){
  if(product==='domain')return 'domains:read';
  if(req.path.includes('/webhook'))return 'webhooks:write';
  if(req.path.includes('/payout'))return 'payouts:create';
  if(req.path.includes('/accounts')&&req.method==='POST')return 'accounts:create';
  if(req.path.includes('/payments')&&req.method==='POST')return 'payments:create';
  return 'banking:read';
}
function requestIp(req){return clean((req.headers['x-forwarded-for']||'').split(',')[0]||req.ip).replace(/^::ffff:/,'');}
async function resellerApiKeyAuth(req,res,next){
  try{
    const publicKey=clean(req.headers['x-api-key']||req.headers['x-public-key']),secret=clean(req.headers['x-api-secret']||req.headers['x-secret-key']);
    if(!publicKey||!secret)return res.status(401).json({error:{code:'AUTH_REQUIRED',message:'X-API-Key and X-API-Secret headers are required.'}});
    const domainPrefixes=[clean(process.env.DOMAIN_RESELLER_SANDBOX_PUBLIC_KEY_PREFIX)||'wnh_domain_pk_test',clean(process.env.DOMAIN_RESELLER_LIVE_PUBLIC_KEY_PREFIX)||'wnh_domain_pk_live'];
    const bankPrefixes=[clean(process.env.BANK_RESELLER_SANDBOX_PUBLIC_KEY_PREFIX)||'wnh_bank_pk_test',clean(process.env.BANK_RESELLER_LIVE_PUBLIC_KEY_PREFIX)||'wnh_bank_pk_live'];
    const isDomain=domainPrefixes.some(prefix=>publicKey.startsWith(`${prefix}_`)),isBank=bankPrefixes.some(prefix=>publicKey.startsWith(`${prefix}_`)),isLive=publicKey.startsWith(`${domainPrefixes[1]}_`)||publicKey.startsWith(`${bankPrefixes[1]}_`);
    if(!isDomain&&!isBank)return res.status(401).json({error:{code:'INVALID_KEY',message:'Invalid World Net Hosting API key.'}});
    const product=isDomain?'domain':'bank',environment=isLive?'live':'sandbox',fields=apiCredentialFields(product,environment);
    const profile=await ResellerProfile.findOne({apiProjects:{$elemMatch:{product,[fields.publicField]:publicKey}}});if(!profile)return res.status(401).json({error:{code:'INVALID_CREDENTIALS',message:'Invalid API credentials.'}});
    const project=(profile.apiProjects||[]).find(item=>item.product===product&&item[fields.publicField]===publicKey);if(!project||project.revokedAt||!(await bcrypt.compare(secret,project[fields.secretField]||'')))return res.status(401).json({error:{code:'INVALID_CREDENTIALS',message:'Invalid or revoked API credentials.'}});
    if(environment==='live'&&!liveProductReady(profile,product))return res.status(403).json({error:{code:'LIVE_API_PENDING',message:product==='bank'?'Live Banking API is pending Paystack production activation/approval.':'Live API access is pending provider activation.'}});
    const ip=requestIp(req),allowed=(project.allowedIps||[]).map(clean).filter(Boolean);if(allowed.length&&!allowed.includes(ip))return res.status(403).json({error:{code:'IP_NOT_ALLOWED',message:'This IP address is not allowed for the API project.'}});
    const scope=developerRequiredScope(req,product),scopes=project.scopes?.length?project.scopes:(product==='domain'?['domains:read']:['banking:read','payments:create','accounts:create','payouts:create','webhooks:write']);if(!scopes.includes(scope))return res.status(403).json({error:{code:'SCOPE_DENIED',message:`API key does not include ${scope}.`}});
    const now=Date.now(),windowMs=60000,limit=Math.max(10,Number(process.env.DEVELOPER_API_RATE_LIMIT_PER_MINUTE||120)),windowStart=Math.floor(now/windowMs)*windowMs,rateKey=`${project._id}:${environment}:${windowStart}`;const rate=await DeveloperRateLimit.findOneAndUpdate({key:rateKey},{$inc:{count:1},$setOnInsert:{expiresAt:new Date(windowStart+windowMs*2)}},{upsert:true,new:true,setDefaultsOnInsert:true});res.setHeader('X-RateLimit-Limit',String(limit));res.setHeader('X-RateLimit-Remaining',String(Math.max(0,limit-rate.count)));if(rate.count>limit)return res.status(429).json({error:{code:'RATE_LIMITED',message:'API rate limit exceeded.'}});
    req.resellerApi={profile,project,product,environment,scope,ip};res.on('finish',()=>DeveloperApiAudit.create({resellerProfile:profile._id,apiProjectId:project._id,product,environment,method:req.method,path:req.path,scope,statusCode:res.statusCode,requestId:clean(req.headers['x-request-id']),ip}).catch(()=>{}));next();
  }catch(error){next(error)}
}
app.get('/api/v1/domains/search',resellerApiKeyAuth,async(req,res)=>{
  if(req.resellerApi.product!=='domain')return res.status(403).json({message:'Use a Domain API key.'});
  try{
    const result=await searchDomainReseller(clean(req.query.name),{limit:req.query.limit||12});
    const results=(result.results||[]).map(item=>{
      const providerPrice=Number(item.price||0);
      const providerRenewal=Number(item.renewalPrice||item.renewPrice||providerPrice||0);
      const platformFee=domainResellerApiFee(providerPrice);
      const renewalPlatformFee=domainResellerApiFee(providerRenewal);
      const resellerBasePrice=Number((providerPrice+platformFee).toFixed(2));
      const renewalPrice=Number((providerRenewal+renewalPlatformFee).toFixed(2));
      return {...item,providerPrice,wholesalePrice:providerPrice,worldNetHostingMarkup:0,platformFee,platformFeeRate:DOMAIN_RESELLER_API_PLATFORM_FEE_RATE,resellerBasePrice,minimumCustomerPrice:resellerBasePrice,price:resellerBasePrice,firstYearPrice:resellerBasePrice,renewalPrice,renewalPlatformFee,resellerMarkup:0};
    });
    res.json({...result,results,environment:req.resellerApi.environment,pricingRule:{resellerBasePrice:'provider-price-plus-4-percent-platform-fee',platformFeeRate:DOMAIN_RESELLER_API_PLATFORM_FEE_RATE,platformFeePercent:DOMAIN_RESELLER_API_PLATFORM_FEE_RATE*100,markupUSD:0,resellerMarkup:'chosen-by-reseller-on-their-own-platform'}});
  }catch(e){res.status(e.status||502).json({message:e.message,provider:e.payload})}
});
app.get('/api/v1/banking/balance',resellerApiKeyAuth,async(req,res)=>{if(req.resellerApi.product!=='bank')return res.status(403).json({message:'Use a Banking API key.'});const user=await User.findById(req.resellerApi.profile.user);const wallet=await getOrCreateWallet(user);res.json({environment:req.resellerApi.environment,currency:wallet.currency,balance:walletAmount(wallet,wallet.currency),balances:walletBalancesObject(wallet),provider:clean(process.env.BANK_API_PROVIDER||'sandbox')})});
app.post('/api/v1/banking/payments/initialize',publicWriteRequestLimit,resellerApiKeyAuth,async(req,res)=>{
  try{
    if(req.resellerApi.product!=='bank')return res.status(403).json({message:'Use a Banking API key.'});
    const environment=req.resellerApi.environment;if(!Paystack.configured(environment))return res.status(503).json({message:`Paystack ${environment} credentials are not configured for the Banking API.`});
    const customerEmail=clean(req.body?.customer_email||req.body?.email).toLowerCase(),customerName=clean(req.body?.customer_name||req.body?.name||customerEmail.split('@')[0]);
    const currency=normalizeCurrency(req.body?.currency||'NGN','NGN'),amount=Number(req.body?.amount||0),description=clean(req.body?.description||'Reseller API payment').slice(0,200),callbackUrl=clean(req.body?.callback_url);
    if(!validEmailAddress(customerEmail))return res.status(400).json({message:'A valid customer email is required.'});
    if(!supportedPaystackCheckoutCurrencies().includes(currency))return res.status(400).json({message:`Currency ${currency} is not enabled for Paystack Checkout on this platform.`});
    if(!Number.isFinite(amount)||amount<1)return res.status(400).json({message:'A valid payment amount is required.'});
    if(callbackUrl){try{const parsed=new URL(callbackUrl);if(parsed.protocol!=='https:')throw new Error();}catch{return res.status(400).json({message:'Callback URL must be a valid HTTPS address.'});}}
    const platformFee=Number((amount*BANKING_API_TRANSACTION_FEE_RATE).toFixed(2)),resellerNet=Number((amount-platformFee).toFixed(2));
    const idempotency=clean(req.headers['idempotency-key']);if(!idempotency)return res.status(400).json({message:'Idempotency-Key header is required for payment initialization.'});
    const reference=`WNH-RAPI-${crypto.createHash('sha256').update(`${req.resellerApi.project._id}:${idempotency}`).digest('hex').slice(0,24)}`;
    let record=await ResellerApiPayment.findOne({reference,resellerProfile:req.resellerApi.profile._id,apiProjectId:req.resellerApi.project._id});
    if(record)return res.status(200).json({message:'Existing idempotent payment returned.',authorization_url:record.metadata?.checkoutUrl||'',reference,amount:record.amount,currency:record.currency,status:record.status});
    record=await ResellerApiPayment.create({reference,reseller:req.resellerApi.profile.user,resellerProfile:req.resellerApi.profile._id,apiProjectId:req.resellerApi.project._id,environment,customerEmail,amount,currency,platformFee,resellerNet,platformFeeRate:BANKING_API_TRANSACTION_FEE_RATE,description,callbackUrl,status:'pending',provider:'paystack',providerStatus:'initializing',metadata:{...(req.body?.metadata||{}),idempotencyHash:crypto.createHash('sha256').update(idempotency).digest('hex')}});
    const frontendBase=String(process.env.FRONTEND_URL||'').split(',')[0].trim().replace(/\/$/,'');const redirectUrl=callbackUrl||(frontendBase?`${frontendBase}/payment-success.html`:'');if(!redirectUrl)throw Object.assign(new Error('Payment redirect URL is not configured.'),{status:500});
    try{
      const result=await Paystack.createCheckout({amount,currency,customer:{name:customerName,email:customerEmail},merchantReference:reference,redirectUrl,metadata:{purpose:'reseller_api_payment',paymentId:String(record._id),projectId:String(req.resellerApi.project._id),description}},environment);
      const data=result.data||result;const link=clean(data.link||data.checkoutUrl||data.authorizationUrl);record.providerStatus='initialized';record.metadata={...(record.metadata||{}),checkoutUrl:link,providerId:clean(data.id||data.reference)};await record.save();
      res.status(201).json({message:'Payment initialized through World Net Hosting Banking API.',authorization_url:link,reference,amount,currency,resellerShare:resellerNet,worldNetHostingFee:platformFee,platformFeeRate:BANKING_API_TRANSACTION_FEE_RATE,status:'pending'});
    }catch(error){record.status='failed';record.providerStatus='initialization_failed';record.metadata={...(record.metadata||{}),error:clean(error.message)};await record.save();throw error;}
  }catch(error){res.status(error.status||502).json({message:error.message});}
});
app.get('/api/v1/banking/payments/:reference',resellerApiKeyAuth,async(req,res)=>{
  if(req.resellerApi.product!=='bank')return res.status(403).json({message:'Use a Banking API key.'});
  const payment=await ResellerApiPayment.findOne({reference:clean(req.params.reference),resellerProfile:req.resellerApi.profile._id,apiProjectId:req.resellerApi.project._id});
  if(!payment)return res.status(404).json({message:'Payment was not found for this API account.'});
  res.setHeader('Cache-Control','no-store');
  res.json({reference:payment.reference,status:payment.status,providerStatus:payment.providerStatus,amount:payment.amount,currency:payment.currency,resellerShare:payment.resellerNet,worldNetHostingFee:payment.platformFee,platformFeeRate:payment.platformFeeRate,description:payment.description,createdAt:payment.createdAt,settledAt:payment.settledAt});
});
app.post('/api/v1/banking/customers',resellerApiKeyAuth,async(req,res)=>{try{if(req.resellerApi.product!=='bank')return res.status(403).json({message:'Use a Banking API key.'});const externalReference=clean(req.body.externalReference||req.body.reference),name=clean(req.body.name),email=clean(req.body.email).toLowerCase();if(!externalReference||!name||!validEmailAddress(email))return res.status(400).json({message:'externalReference, name and valid email are required.'});let customer=await DeveloperCustomer.findOne({resellerProfile:req.resellerApi.profile._id,apiProjectId:req.resellerApi.project._id,externalReference});if(customer)return res.status(200).json({customer});customer=await DeveloperCustomer.create({resellerProfile:req.resellerApi.profile._id,apiProjectId:req.resellerApi.project._id,externalReference,name,email,country:clean(req.body.country).toUpperCase(),phone:clean(req.body.phone)});res.status(201).json({customer});}catch(e){res.status(e.status||500).json({message:e.message});}});
app.get('/api/v1/banking/customers/:reference',resellerApiKeyAuth,async(req,res)=>{const customer=await DeveloperCustomer.findOne({resellerProfile:req.resellerApi.profile._id,apiProjectId:req.resellerApi.project._id,externalReference:clean(req.params.reference)});if(!customer)return res.status(404).json({message:'Customer not found.'});res.json({customer});});
app.post('/api/v1/banking/customers/:reference/accounts',resellerApiKeyAuth,async(req,res)=>{try{const customer=await DeveloperCustomer.findOne({resellerProfile:req.resellerApi.profile._id,apiProjectId:req.resellerApi.project._id,externalReference:clean(req.params.reference)});if(!customer)return res.status(404).json({message:'Customer not found.'});const currency=clean(req.body.currency||'NGN').toUpperCase();if(!supportedPaystackVirtualAccountCurrencies().includes(currency))return res.status(400).json({message:`Virtual accounts are not enabled for ${currency}.`});const existing=customer.accounts.find(a=>a.currency===currency&&['pending','active'].includes(a.status));if(existing)return res.status(200).json({account:existing,duplicate:true});const merchantReference=`WNH-DEV-VA-${customer._id}-${currency}`,firstName=customer.name.split(' ')[0]||customer.name,lastName=customer.name.split(' ').slice(1).join(' ')||customer.name,kyc=req.body.kyc||{},payload={currency,merchantReference,accountType:'individual',KYCInformation:{firstName,lastName,email:customer.email}};if(currency==='NGN'){const bvn=clean(req.body.bvn||kyc.bvn).replace(/\D/g,'');if(bvn&& !/^\d{11}$/.test(bvn))return res.status(422).json({message:'If provided, BVN must be 11 digits.'});if(bvn)payload.KYCInformation.bvn=bvn;}if(clean(customer.phone||kyc.phone))payload.KYCInformation.phone=clean(customer.phone||kyc.phone);const result=await Paystack.createVirtualAccount(payload,req.resellerApi.environment),data=result.data||result,normalized=Paystack.normalizeAccount(data);customer.accounts.push({provider:'paystack',providerAccountId:normalized.providerAccountId,merchantReference,accountNumber:normalized.accountNumber,accountName:normalized.accountName,bankName:normalized.bankName,bankCode:normalized.bankCode,currency,country:normalized.country,status:normalized.assignmentStatus});await customer.save();res.status(normalized.active?201:202).json({account:customer.accounts[customer.accounts.length-1]});}catch(e){res.status(e.status||502).json({message:e.message});}});
app.get('/api/v1/banking/customers/:reference/accounts/:currency',resellerApiKeyAuth,async(req,res)=>{const customer=await DeveloperCustomer.findOne({resellerProfile:req.resellerApi.profile._id,apiProjectId:req.resellerApi.project._id,externalReference:clean(req.params.reference)});if(!customer)return res.status(404).json({message:'Customer not found.'});const account=customer.accounts.find(a=>a.currency===clean(req.params.currency).toUpperCase());if(!account)return res.status(404).json({message:'Account not found.'});res.json({account});});
app.get('/api/v1/banking/transactions',resellerApiKeyAuth,async(req,res)=>{const limit=Math.min(100,Math.max(1,Number(req.query.limit||50))),items=await ResellerApiPayment.find({resellerProfile:req.resellerApi.profile._id,apiProjectId:req.resellerApi.project._id}).sort({createdAt:-1}).limit(limit);res.json({transactions:items.map(p=>({reference:p.reference,status:p.status,amount:p.amount,currency:p.currency,fee:p.platformFee,description:p.description,createdAt:p.createdAt,settledAt:p.settledAt}))});});
app.get('/api/v1/banking/capabilities',resellerApiKeyAuth,(req,res)=>res.json({environment:req.resellerApi.environment,provider:'paystack',checkoutCurrencies:supportedPaystackCheckoutCurrencies(),virtualAccountCurrencies:supportedPaystackVirtualAccountCurrencies(),liveEnabled:req.resellerApi.environment==='live'?Paystack.liveConfigured():Paystack.configured('sandbox'),platformApprovalRequired:req.resellerApi.environment==='live'&&!Paystack.liveConfigured()}));
app.get('/api/v1/banking/rates',resellerApiKeyAuth,async(req,res)=>{try{const from=clean(req.query.from).toUpperCase(),to=clean(req.query.to).toUpperCase();if(!from||!to)return res.status(400).json({message:'from and to currencies are required.'});const rate=await resolveRate(from,to);res.json({from,to,rate});}catch(e){res.status(e.status||502).json({message:e.message});}});
app.post('/api/v1/banking/payouts',resellerApiKeyAuth,async(req,res)=>{try{const amount=Number(req.body.amount||0),currency=clean(req.body.currency||'NGN').toUpperCase(),bankCode=clean(req.body.bankCode),accountNumber=clean(req.body.accountNumber).replace(/\s/g,''),accountName=clean(req.body.accountName),description=clean(req.body.description||'Developer payout'),idempotency=clean(req.headers['idempotency-key']);if(!idempotency)return res.status(400).json({message:'Idempotency-Key header is required.'});if(!Number.isFinite(amount)||amount<=0||!bankCode||!accountNumber||!accountName)return res.status(400).json({message:'amount, bankCode, accountNumber and accountName are required.'});const owner=await User.findById(req.resellerApi.profile.user),wallet=await getOrCreateWallet(owner);if(walletAmount(wallet,currency)<amount)return res.status(400).json({message:'Insufficient developer wallet balance.'});const reference=`WNH-DP-${crypto.createHash('sha256').update(`${req.resellerApi.project._id}:${idempotency}`).digest('hex').slice(0,24)}`,existing=await BankOperation.findOne({providerReference:reference,owner:owner._id});if(existing)return res.status(200).json({payout:publicBankOperation(existing),duplicate:true});const fakeReq={user:{id:String(owner._id),email:owner.email,role:owner.role}};const operation=await submitPaystackBankTransfer({req:fakeReq,wallet,walletType:'user',amount,fee:0,totalDebit:amount,currency,bankCode,accountNumber,accountName,reason:description,reference,environment:req.resellerApi.environment});operation.metadata={...(operation.metadata||{}),resellerProfile:String(req.resellerApi.profile._id),apiProjectId:String(req.resellerApi.project._id)};await operation.save();res.status(201).json({payout:publicBankOperation(operation)});}catch(e){res.status(e.status||502).json({message:e.message});}});
app.patch('/api/v1/banking/webhook',resellerApiKeyAuth,async(req,res)=>{const url=clean(req.body.url);if(url){try{const u=new URL(url);if(u.protocol!=='https:')throw new Error();}catch{return res.status(400).json({message:'Webhook URL must be HTTPS.'});}}req.resellerApi.project.webhookUrl=url;const secret=url?developerWebhookSecret(req.resellerApi.project._id):'';req.resellerApi.project.webhookSigningSecretHash=secret?crypto.createHash('sha256').update(secret).digest('hex'):'';await req.resellerApi.profile.save();res.json({message:'Webhook updated.',url,signingSecret:secret||undefined,signatureFormat:'HMAC-SHA256(eventId.timestamp.rawJsonBody)'});});
app.get('/api/v1/status',(req,res)=>res.json({
  ok:true,
  service:'World Net Hosting Reseller API',
  version:'1.0.0',
  baseUrl:`${String(process.env.BACKEND_URL||'').replace(/\/$/,'')}/api/v1`,
  authentication:{headers:['X-API-Key','X-API-Secret'],secretKeys:'server-side-only'},
  domain:{provider:clean(process.env.DOMAIN_API_PROVIDER||'domainnameapi'),mode:DOMAIN_API_MODE,configured:domainApiConfigured(),live:domainLiveConfigured()},
  banking:{provider:'paystack',configured:Paystack.configured(),live:Paystack.liveConfigured()},
  endpoints:{openapi:'/api/v1/openapi.json',domainSearch:'/api/v1/domains/search',bankBalance:'/api/v1/banking/balance',bankCustomers:'/api/v1/banking/customers',bankPayments:'/api/v1/banking/payments/initialize',bankTransactions:'/api/v1/banking/transactions',bankPayouts:'/api/v1/banking/payouts'},
  timestamp:new Date().toISOString()
}));
app.get('/api/v1/openapi.json',(req,res)=>res.json({openapi:'3.0.3',info:{title:'World Net Hosting Developer API',version:'1.0.0'},servers:[{url:`${String(process.env.BACKEND_URL||'').replace(/\/$/,'')}/api/v1`}],paths:{'/domains/search':{get:{summary:'Search domains'}},'/banking/balance':{get:{summary:'Get wallet balance'}},'/banking/customers':{post:{summary:'Register developer customer'}},'/banking/payments/initialize':{post:{summary:'Initialize payment'}},'/banking/transactions':{get:{summary:'List project transactions'}},'/banking/payouts':{post:{summary:'Create approved payout'}},'/banking/webhook':{patch:{summary:'Register developer webhook'}}}}));

app.all('/api/v1/callback/:product/:projectId/:environment',(req,res)=>{
  const product=clean(req.params.product).toLowerCase();
  const environment=clean(req.params.environment).toLowerCase();
  res.json({message:'World Net Hosting callback received.',product,projectId:req.params.projectId||'',environment,received:true,reference:clean(req.query.reference||req.body?.reference||'')});
});
app.post('/api/reseller/credentials/sandbox', auth, requireReseller, async(req,res)=>{req.params.product='domain';req.params.environment='sandbox';return res.status(410).json({message:'Use the product-specific Domain or Banking API credential section.'})});
app.get('/api/reseller/domain-search', auth, requireReseller, async(req,res)=>{
  const profile=await ResellerProfile.findOne({user:req.user.id}); if(!profile?.products?.includes('domain_api'))return res.status(403).json({message:'Domain API is not enabled for this reseller.'});
  const result=await searchDomainReseller(clean(req.query.name),{limit:req.query.limit||12});
  const results=(result.results||[]).map(item=>{
    const providerPrice=Number(item.price||0);
    const providerRenewal=Number(item.renewalPrice||item.renewPrice||providerPrice||0);
    const platformFee=domainResellerApiFee(providerPrice),renewalPlatformFee=domainResellerApiFee(providerRenewal);
    const firstYearPrice=Number((providerPrice+platformFee).toFixed(2)),renewalPrice=Number((providerRenewal+renewalPlatformFee).toFixed(2));
    return {...item,providerPrice,wholesalePrice:providerPrice,platformFee,platformFeeRate:DOMAIN_RESELLER_API_PLATFORM_FEE_RATE,worldNetHostingMarkup:0,resellerMarkup:0,firstYearPrice,price:firstYearPrice,renewalPrice,renewalPlatformFee};
  });
  res.json({...result,results,pricingRule:{platformFeeRate:DOMAIN_RESELLER_API_PLATFORM_FEE_RATE,platformFeePercent:DOMAIN_RESELLER_API_PLATFORM_FEE_RATE*100,markupUSD:0}});
});
app.post('/api/reseller/domains/wallet-purchase', auth, requireReseller, async(req,res)=>{
  try{
    const profile=await ResellerProfile.findOne({user:req.user.id}); if(!profile?.products?.includes('domain_api'))return res.status(403).json({message:'Domain API is not enabled for this reseller.'});
    const item=req.body?.item; if(!item?.name)return res.status(400).json({message:'Select a domain to purchase.'});
    const liveSearch=await searchDomainReseller(clean(item.name),{limit:1});
    const liveItem=(liveSearch.results||[]).find(x=>clean(x.domain).toLowerCase()===clean(item.name).toLowerCase())||(liveSearch.results||[])[0];
    if(!liveItem||liveItem.available===false)return res.status(409).json({message:'This domain is no longer available.'});
    const providerPrice=Number(liveItem.price||0); if(!(providerPrice>0))return res.status(400).json({message:'A valid live provider domain price is required.'});
    const platformFeeUSD=domainResellerApiFee(providerPrice),subtotalUSD=providerPrice,totalUSD=Number((providerPrice+platformFeeUSD).toFixed(2));
    const pricedItem={...item,...liveItem,providerPrice,wholesalePrice:providerPrice,worldNetHostingMarkup:0,resellerMarkup:0,platformFee:platformFeeUSD,platformFeeRate:DOMAIN_RESELLER_API_PLATFORM_FEE_RATE,price:totalUSD,usdPrice:totalUSD,firstYearPrice:totalUSD};
    const user=await User.findById(req.user.id), wallet=await getOrCreateWallet(user); const currency=clean(req.body.currency||wallet.currency||'NGN').toUpperCase(); const rate=await getRate('USD',currency); const debit=Number((totalUSD*rate).toFixed(2));
    if(walletAmount(wallet,currency)<debit)return res.status(400).json({message:`Insufficient reseller balance. Required ${debit.toFixed(2)} ${currency}.`});
    const order=await Order.create({user:user._id,customerEmail:user.email,items:[pricedItem],subtotal:subtotalUSD,platformFee:platformFeeUSD,platformFeeRate:DOMAIN_RESELLER_API_PLATFORM_FEE_RATE,total:totalUSD,currency:'USD',paymentCurrency:currency,exchangeRate:rate,paymentAmount:debit,status:'paid',paymentReference:`RESELLER-WALLET-${Date.now()}`});
    changeWalletAmount(wallet,currency,-debit); wallet.transactions.push({type:'debit',amount:debit,currency,reference:order.paymentReference,description:`Reseller domain purchase: ${item.name} (4% platform fee included)`,status:'completed'}); await wallet.save();
    let domain=null; try{domain=await provisionPaidDomain(order,user)}catch(e){console.error('Reseller domain provisioning failed:',e.message)}
    res.status(201).json({message:domain?'Domain purchased and registered successfully.':'Payment completed; domain registration is processing.',orderId:order._id,domain,balance:walletAmount(wallet,currency),currency});
  }catch(e){res.status(e.status||500).json({message:e.message||'Reseller domain purchase failed.'});}
});
app.get('/api/wallet/health', auth, async (req,res)=>{try{const wallet=await ensureUserWallet(req.user);res.json({ok:true,service:'banking',database:mongoose.connection.readyState===1?'connected':'disconnected',walletId:String(wallet._id),currencies:Object.keys(walletBalancesObject(wallet))});}catch(error){res.status(503).json({ok:false,service:'banking',message:error.message||'Wallet information is temporarily unavailable.'});}});
app.get('/api/currency/config', (req, res) => res.json({ userPlatformFeeRate: USER_PLATFORM_FEE_RATE, userPlatformFeePercent: USER_PLATFORM_FEE_RATE*100, domainFirstYearMarkupUSD:DOMAIN_FIRST_YEAR_MARKUP_USD, domainRenewalMarkupUSD:DOMAIN_RENEWAL_MARKUP_USD, domainResellerApiPlatformFeeRate:DOMAIN_RESELLER_API_PLATFORM_FEE_RATE, domainResellerApiPlatformFeePercent:DOMAIN_RESELLER_API_PLATFORM_FEE_RATE*100, domainResellerApiMarkupUSD:0, countryCurrency, baseCurrency: 'USD', displayCurrencies: ['USD','EUR','GBP','NGN','GHS','KES','ZAR','CAD','AUD','NZD','JPY','CNY','HKD','SGD','INR','BRL','MXN','AED','SAR','QAR','KWD','BHD','OMR','CHF','SEK','NOK','DKK','PLN','CZK','HUF','RON','BGN','TRY','RUB','UAH','ILS','EGP','MAD','DZD','TND','XOF','XAF','XPF','ETB','UGX','TZS','RWF','BWP','NAD','ZMW','MZN','AOA','GMD','GNF','SLL','LRD','CVE','MRU','STN','SCR','MUR','MWK','SZL','LSL','CDF','SOS','SDG','SSP','LYD','JOD','LBP','IQD','IRR','AFN','PKR','BDT','LKR','NPR','BTN','MVR','MMK','THB','VND','KHR','LAK','MYR','IDR','PHP','BND','TWD','KRW','MNT','KZT','UZS','TJS','TMT','KGS','AZN','GEL','AMD','BYN','MDL','RSD','MKD','ALL','BAM','ISK','HRK','CLP','COP','PEN','ARS','UYU','PYG','BOB','VES','GYD','SRD','BZD','GTQ','HNL','NIO','CRC','PAB','DOP','HTG','JMD','TTD','BBD','BSD','BMD','KYD','XCD','AWG','ANG','CUP','CUC','FJD','PGK','SBD','VUV','WST','TOP','KMF','DJF','ERN','BIF','ZWL','ZWG','MOP','XAU','XAG','XPT','XPD','XDR','ADP','AFA','ALK','AOK','AON','AOR','ARA','ARL','ARM','ARP','ATS','AZM','BAD','BAN','BEC'], paystackDefaultCurrency: 'NGN', supportedPaystackCheckoutCurrencies: supportedPaystackCheckoutCurrencies(),
    supportedPaystackVirtualAccountCurrencies: supportedPaystackVirtualAccountCurrencies() }));
app.get('/api/currency/convert',publicApiRequestLimit,async (req, res) => {
  const amount = Number(req.query.amount || 1);
  const from = normalizeCurrency(req.query.from || 'USD');
  const to = normalizeCurrency(req.query.to || 'NGN');
  const rate = await getRate(from, to);
  res.json({ amount, from, to, rate, converted: Number((amount * rate).toFixed(2)) });
});

app.get('/api/domains/search',publicApiRequestLimit,async (req, res) => {
  const query = clean(req.query.name || req.query.domain);
  try {
    const apiResult = await searchDomainReseller(query, { limit: req.query.limit });
    if (mongoose.connection.readyState === 1) {
      DomainSearch.create({ query, results: apiResult.results, source: apiResult.source, apiMessage: apiResult.message })
        .catch(error => console.warn('Domain search audit log skipped:', error.message));
    }
    const priced={...apiResult,results:(apiResult.results||[]).map(item=>{
      const providerPrice=Number(item.price||0);
      const providerRenewal=Number(item.renewalPrice||0);
      const renewalBase=providerRenewal>0?providerRenewal:providerPrice;
      const firstYearPrice=Number((providerPrice+DOMAIN_FIRST_YEAR_MARKUP_USD).toFixed(2));
      const renewalPrice=Number((renewalBase+DOMAIN_RENEWAL_MARKUP_USD).toFixed(2));
      return {...item,wholesalePrice:providerPrice,providerPrice,worldNetHostingMarkup:DOMAIN_FIRST_YEAR_MARKUP_USD,firstYearMarkupUSD:DOMAIN_FIRST_YEAR_MARKUP_USD,renewalMarkupUSD:DOMAIN_RENEWAL_MARKUP_USD,firstYearPrice,price:firstYearPrice,renewalPrice,customerMarkup:DOMAIN_FIRST_YEAR_MARKUP_USD};
    })};
    res.json({ query, ...priced, resellerConfigured: domainApiConfigured(), pricingRule:{firstYear:'provider-price-plus-5-usd',renewal:'provider-renewal-plus-10-usd',firstYearMarkupUSD:DOMAIN_FIRST_YEAR_MARKUP_USD,renewalMarkupUSD:DOMAIN_RENEWAL_MARKUP_USD} });
  } catch (err) {
    if (mongoose.connection.readyState === 1) {
      DomainSearch.create({ query, results: [], source: 'domainnameapi-error', apiMessage: err.message })
        .catch(error => console.warn('Domain search error audit log skipped:', error.message));
    }
    res.status(err.status || 502).json({ query, results: [], source: 'domainnameapi-error', message: err.message, provider: err.payload });
  }
});

app.get('/api/admin/domains/search', auth, requireAdmin, async (req, res) => {
  const query = clean(req.query.name);
  try {
    const apiResult = await searchDomainReseller(query, { limit: req.query.limit });
    const results = (apiResult.results || []).map(item => {
      const firstYearPrice = Number(item.price || 0);
      const renewalPrice = Number(item.renewalPrice || item.renewPrice || firstYearPrice || 0);
      return { ...item, wholesalePrice:firstYearPrice, firstYearPrice, price:firstYearPrice, renewalPrice, customerMarkup:0 };
    });
    res.json({ query, ...apiResult, results, resellerConfigured:domainApiConfigured(), pricingRule:{firstYear:'provider-price',renewal:'provider-price',markupUSD:0,platformFeeRate:0} });
  } catch (error) {
    res.status(error.status || 502).json({ message:error.message, provider:error.payload });
  }
});

app.post('/api/domains/register-paid-order', auth, async (req, res) => {
  try {
    const order = await Order.findOne({ _id: req.body.orderId, customerEmail: req.user.email });
    if (!order) return res.status(404).json({ message: 'Order not found' });
    const user = await User.findById(req.user.id);
    const domain = await provisionPaidDomain(order, user);
    res.json({ message: 'Domain registered successfully.', domain });
  } catch (err) { res.status(err.status || 502).json({ message: err.message, provider: err.payload }); }
});

app.get('/api/domains/managed', auth, async (req, res) => res.json(await ManagedDomain.find({ user: req.user.id }).sort({ createdAt: -1 })));

async function requireOwnedDomain(req, res, next) {
  const record = await ManagedDomain.findOne({ user: req.user.id, domain: req.params.domain.toLowerCase() });
  if (!record) return res.status(404).json({ message: 'Domain not found in your account' });
  req.managedDomain = record; next();
}

const DNS_RECORD_TYPES = new Set(['A','AAAA','ANAME','ALIAS','CNAME','MX','TXT','CAA','SRV','NS']);
function normalizeDnsRecord(input = {}) {
  const type = clean(input.type).toUpperCase();
  const name = clean(input.name || input.host || '@');
  const value = clean(input.value || input.content || input.target);
  const ttl = Math.max(60, Math.min(86400, Number(input.ttl || 3600)));
  const priority = input.priority === '' || input.priority == null ? undefined : Number(input.priority);
  if (!DNS_RECORD_TYPES.has(type)) throw Object.assign(new Error('Unsupported DNS record type.'), { status: 400 });
  if (!name) throw Object.assign(new Error('DNS record host/name is required.'), { status: 400 });
  if (!value) throw Object.assign(new Error('DNS record value is required.'), { status: 400 });
  if (type === 'A' && !/^(?:\d{1,3}\.){3}\d{1,3}$/.test(value)) throw Object.assign(new Error('A record must contain a valid IPv4 address.'), { status: 400 });
  if (type === 'AAAA' && !value.includes(':')) throw Object.assign(new Error('AAAA record must contain a valid IPv6 address.'), { status: 400 });
  if (type === 'MX' && (!Number.isFinite(priority) || priority < 0)) throw Object.assign(new Error('MX record priority is required.'), { status: 400 });
  return { type, name, value, ttl, ...(Number.isFinite(priority) ? { priority } : {}) };
}
function dnsRecordPayload(domain, record, recordId) {
  return {
    domainName: domain,
    ...(recordId ? { id: recordId, recordId } : {}),
    recordType: record.type,
    type: record.type,
    host: record.name,
    name: record.name,
    value: record.value,
    content: record.value,
    ttl: record.ttl,
    ...(record.priority !== undefined ? { priority: record.priority } : {})
  };
}
app.get('/api/domains/:domain/dns', auth, requireOwnedDomain, async (req, res) => {
  try {
    const provider = await domainNameApiRequest('GET', domainEndpoint('DNS_LIST','api/domain/dns/records'), { domainName: req.params.domain });
    const records = provider.records || provider.items || provider.data || provider;
    res.json({ domain: req.params.domain, nameservers: req.managedDomain.nameservers || [], records: Array.isArray(records) ? records : [], provider });
  } catch (err) { res.status(err.status || 502).json({ message: err.message, provider: err.payload }); }
});
app.post('/api/domains/:domain/dns', auth, requireOwnedDomain, async (req, res) => {
  try {
    const record = normalizeDnsRecord(req.body);
    const provider = await domainNameApiRequest('POST', domainEndpoint('DNS_CREATE','api/domain/dns/record'), dnsRecordPayload(req.params.domain, record));
    res.status(201).json({ message: `${record.type} record created successfully.`, record: provider.record || provider.data || provider, provider });
  } catch (err) { res.status(err.status || 502).json({ message: err.message, provider: err.payload }); }
});
app.put('/api/domains/:domain/dns/:recordId', auth, requireOwnedDomain, async (req, res) => {
  try {
    const record = normalizeDnsRecord(req.body);
    const endpoint = domainEndpoint('DNS_UPDATE','api/domain/dns/record').replace(':recordId', encodeURIComponent(req.params.recordId));
    const provider = await domainNameApiRequest('PUT', endpoint, dnsRecordPayload(req.params.domain, record, req.params.recordId));
    res.json({ message: `${record.type} record updated successfully.`, record: provider.record || provider.data || provider, provider });
  } catch (err) { res.status(err.status || 502).json({ message: err.message, provider: err.payload }); }
});
app.delete('/api/domains/:domain/dns/:recordId', auth, requireOwnedDomain, async (req, res) => {
  try {
    const endpoint = domainEndpoint('DNS_DELETE','api/domain/dns/record').replace(':recordId', encodeURIComponent(req.params.recordId));
    const provider = await domainNameApiRequest('DELETE', endpoint, { domainName: req.params.domain, id: req.params.recordId, recordId: req.params.recordId });
    res.json({ message: 'DNS record deleted successfully.', provider });
  } catch (err) { res.status(err.status || 502).json({ message: err.message, provider: err.payload }); }
});
app.put('/api/domains/:domain/nameservers', auth, requireOwnedDomain, async (req, res) => {
  try {
    const nameservers = Array.isArray(req.body.nameservers) ? req.body.nameservers.map(clean).filter(Boolean) : [];
    if (nameservers.length < 2) return res.status(400).json({ message: 'Provide at least two nameservers.' });
    const result = await domainNameApiRequest('PUT', 'domains/dns/name-server', { domainName: req.params.domain, nameServers: nameservers });
    req.managedDomain.nameservers = nameservers;
    await req.managedDomain.save();
    res.json({ message: 'Nameservers updated successfully.', nameservers: result.nameServers || nameservers, provider: result });
  } catch (err) {
    res.status(err.status || 502).json({ message: err.message, provider: err.payload });
  }
});


function validDomainName(value){return /^(?=.{3,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(clean(value));}
function encryptSensitive(value){const secret=crypto.createHash('sha256').update(String(process.env.WITHDRAWAL_ENCRYPTION_KEY||JWT_SECRET)).digest();const iv=crypto.randomBytes(12);const cipher=crypto.createCipheriv('aes-256-gcm',secret,iv);const encrypted=Buffer.concat([cipher.update(String(value),'utf8'),cipher.final()]);return `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${encrypted.toString('hex')}`;}
app.post('/api/domains/transfers',auth,async(req,res)=>{try{const domain=clean(req.body.domain).toLowerCase();const authCode=clean(req.body.authCode);const email=clean(req.body.email).toLowerCase();if(!validDomainName(domain))return res.status(400).json({message:'Enter a valid full domain name.'});if(!authCode||authCode.length<3)return res.status(400).json({message:'A valid authorization/EPP code is required.'});if(!req.body.consent)return res.status(400).json({message:'Ownership authorization confirmation is required.'});const provider=await domainNameApiRequest('POST',domainEndpoint('TRANSFER','api/domain/transfer'),{domainName:domain,authCode,contactEmail:email,period:Number(req.body.period||1)});const item=await DomainTransfer.create({user:req.user.id,type:'transfer-in',domain,email,authCodeEncrypted:encryptSensitive(authCode),status:'processing',providerReference:String(provider.reference||provider.orderId||provider.id||'')});res.status(201).json({message:providerMessage(provider,'Domain transfer started successfully.'),reference:String(item._id),status:item.status,provider})}catch(e){res.status(e.status||502).json({message:e.message,provider:e.payload})}});

app.post('/api/domains/:domain/renew',auth,requireOwnedDomain,async(req,res)=>{try{const period=Math.max(1,Number(req.body.period||1));const provider=await domainNameApiRequest('POST',domainEndpoint('RENEW','api/domain/renew'),{domainName:req.params.domain,period});res.json({message:providerMessage(provider,'Domain renewed successfully.'),provider})}catch(e){res.status(e.status||502).json({message:e.message,provider:e.payload})}});
app.put('/api/domains/:domain/lock',auth,requireOwnedDomain,async(req,res)=>{try{const locked=Boolean(req.body.locked);const provider=await domainNameApiRequest('PUT',domainEndpoint('LOCK','api/domain/lock'),{domainName:req.params.domain,isLocked:locked});req.managedDomain.locked=locked;await req.managedDomain.save();res.json({message:`Domain ${locked?'locked':'unlocked'} successfully.`,locked,provider})}catch(e){res.status(e.status||502).json({message:e.message,provider:e.payload})}});
app.get('/api/domains/:domain/epp',auth,requireOwnedDomain,async(req,res)=>{try{const provider=await domainNameApiRequest('POST',domainEndpoint('EPP','api/domain/auth-code'),{domainName:req.params.domain});res.json({message:'EPP/auth code retrieved securely.',authCode:provider.authCode||provider.eppCode||provider.code||'',provider})}catch(e){res.status(e.status||502).json({message:e.message,provider:e.payload})}});
app.put('/api/domains/:domain/contact',auth,requireOwnedDomain,async(req,res)=>{try{const registrant=normalizeContact(req.body.contact||req.body,'Registrant');if(!registrant)return res.status(400).json({message:'Complete WHOIS contact details are required.'});const contacts=['Registrant','Admin','Tech','Billing'].map(type=>({...registrant,contactType:type}));const provider=await domainNameApiRequest('PUT',domainEndpoint('CONTACT','api/domain/contact'),{domainName:req.params.domain,contacts});res.json({message:providerMessage(provider,'WHOIS contacts updated successfully.'),provider})}catch(e){res.status(e.status||502).json({message:e.message,provider:e.payload})}});
app.post('/api/domains/receive-requests',auth,async(req,res)=>{const domain=clean(req.body.domain).toLowerCase();const senderEmail=clean(req.body.senderEmail).toLowerCase();if(!validDomainName(domain))return res.status(400).json({message:'Enter a valid full domain name.'});if(!senderEmail||!senderEmail.includes('@'))return res.status(400).json({message:'A valid sender email is required.'});if(!req.body.consent)return res.status(400).json({message:'Receiving consent is required.'});const item=await DomainTransfer.create({user:req.user.id,type:'receive',domain,senderEmail,note:clean(req.body.note),status:'pending-review'});res.status(201).json({message:'Receive request created successfully and is pending ownership validation.',reference:String(item._id),status:item.status})});
app.get('/api/domains/transfer-requests',auth,async(req,res)=>res.json(await DomainTransfer.find({user:req.user.id}).select('-authCodeEncrypted').sort({createdAt:-1})));
app.get('/api/admin/domain-transfers',auth,requireAdmin,async(req,res)=>res.json(await DomainTransfer.find().select('-authCodeEncrypted').sort({createdAt:-1})));
app.patch('/api/admin/domain-transfers/:id/status',auth,requireAdmin,async(req,res)=>{const allowed=['pending-review','processing','completed','rejected','cancelled'];const status=clean(req.body.status);if(!allowed.includes(status))return res.status(400).json({message:'Invalid transfer status.'});const item=await DomainTransfer.findByIdAndUpdate(req.params.id,{status},{new:true}).select('-authCodeEncrypted');if(!item)return res.status(404).json({message:'Transfer request not found.'});res.json({message:'Transfer status updated.',item})});

app.post('/api/ai-builder/generate', auth, publicWriteRequestLimit, async (req, res) => {
  const businessName=clean(req.body.businessName).slice(0,80),businessType=clean(req.body.businessType).slice(0,80),description=clean(req.body.description).slice(0,2400);
  const primaryAction=clean(req.body.primaryAction||'Contact us').slice(0,60),contact=clean(req.body.contact).slice(0,120);
  const stack=clean(req.body.stack||'html').toLowerCase(),language=clean(req.body.language||'javascript').toLowerCase();
  if(!businessName||!businessType||description.length<20)return res.status(400).json({message:'Business name, business type and a description of at least 20 characters are required.'});
  const esc=v=>String(v||'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));
  const title=esc(businessName),type=esc(businessType),summary=esc(description),action=esc(primaryAction),contactText=esc(contact||'Add your phone number or email');
  const html=`<!DOCTYPE html>\n<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><link rel="stylesheet" href="style.css"></head><body><header><strong>${title}</strong><nav><a href="#about">About</a><a href="#services">Services</a><a href="#contact">Contact</a></nav></header><main><section class="hero"><span>${type}</span><h1>${title}</h1><p>${summary}</p><a href="#contact">${action}</a></section><section id="about"><h2>About</h2><p>${summary}</p></section><section id="services"><h2>Services</h2><div class="grid"><article>Professional service</article><article>Secure support</article><article>Reliable results</article></div></section><section id="contact"><h2>Contact</h2><p>${contactText}</p></section></main><footer>© ${new Date().getFullYear()} ${title}</footer><script src="script.js"></script></body></html>`;
  const css=`:root{font-family:Inter,Arial,sans-serif;color:#10233c}*{box-sizing:border-box}body{margin:0;background:#f7fafc}header{display:flex;justify-content:space-between;padding:20px 6%;background:#fff;position:sticky;top:0}nav{display:flex;gap:18px}a{color:#087f5b}.hero,section{padding:70px 8%}.hero{min-height:70vh;background:linear-gradient(135deg,#e6fcf5,#e7f5ff)}h1{font-size:clamp(42px,8vw,80px)}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:20px}.grid article{padding:24px;background:#fff;border-radius:16px}footer{padding:30px;text-align:center;background:#10233c;color:#fff}`;
  const js=`document.querySelectorAll('a[href^="#"]').forEach(a=>a.addEventListener('click',e=>{const t=document.querySelector(a.getAttribute('href'));if(t){e.preventDefault();t.scrollIntoView({behavior:'smooth'})}}));`;
  const files={'index.html':html,'style.css':css,'script.js':js};
  if(stack.includes('node')||stack.includes('full')){files['package.json']=JSON.stringify({name:businessName.toLowerCase().replace(/[^a-z0-9]+/g,'-'),version:'1.0.0',scripts:{start:'node server.js'},dependencies:{express:'^4.21.0',mongoose:'^8.9.0',cors:'^2.8.5',dotenv:'^16.4.5'}},null,2);files['server.js']=`require('dotenv').config();const express=require('express'),cors=require('cors'),mongoose=require('mongoose');const app=express();app.use(cors());app.use(express.json());app.use(express.static('public'));app.get('/api/health',(_q,r)=>r.json({ok:true,service:'${businessName}'}));mongoose.connect(process.env.MONGODB_URI).then(()=>app.listen(process.env.PORT||10000));`;files['.env.example']='MONGODB_URI=your_mongodb_connection\nPORT=10000';}
  if(language==='python'){files['app.py']="from flask import Flask, jsonify\napp=Flask(__name__)\n@app.get('/api/health')\ndef health(): return jsonify(ok=True)\nif __name__=='__main__': app.run()";files['requirements.txt']='Flask==3.1.0\npymongo==4.10.1';}
  res.json({message:'Complete website code generated successfully.',website:{name:businessName,stack,language,files}});
});

app.get('/api/plans', (_req, res) => res.json([
  { name: 'Starter', description: 'Domain, DNS and account tools for a new online presence.', price: 5.99, billing: 'month', features: ['Domain dashboard', 'DNS management', 'Business support'] },
  { name: 'Business', description: 'Professional service tools for growing businesses.', price: 12.99, billing: 'month', features: ['Domain controls', 'Business email ordering', 'Priority support'] },
  { name: 'Professional', description: 'Expanded account and service management for established teams.', price: 24.99, billing: 'month', features: ['Advanced domain controls', 'Orders and wallet access', 'Priority service'] }
]));

app.get('/api/email/plans', async (req, res) => {
  const markup = Math.max(0, Number(process.env.EMAIL_CUSTOMER_MARKUP_USD || 5));
  const base = [
    { code:'starter-email', name:'Starter Email', basePrice:2.99, description:'Professional mailbox for small teams.' },
    { code:'business-email', name:'Business Email', basePrice:6.99, description:'More storage and team mailboxes.' },
    { code:'email-security', name:'Email Security', basePrice:9.99, description:'Spam and phishing protection setup.' }
  ];
  res.json(base.map(plan => ({ ...plan, markupUSD:markup, price:Number((plan.basePrice + markup).toFixed(2)), billing:'monthly' })));
});

app.get('/api/admin/email/plans', auth, requireAdmin, async (_req, res) => {
  res.json([
    { code:'starter-email', name:'Starter Email', basePrice:2.99, price:2.99, markupUSD:0, billing:'monthly' },
    { code:'business-email', name:'Business Email', basePrice:6.99, price:6.99, markupUSD:0, billing:'monthly' },
    { code:'email-security', name:'Email Security', basePrice:9.99, price:9.99, markupUSD:0, billing:'monthly' }
  ]);
});

app.post('/api/orders', auth, async (req, res) => {
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  const customerEmail = clean(req.user.email).toLowerCase();
  const total = items.reduce((sum, item) => sum + Number(item.usdPrice ?? item.price ?? 0), 0);
  if (!items.length) return res.status(400).json({ message: 'Cart is empty' });
  const saved = await Order.create({ customerEmail, items, total, currency: 'USD', status: 'pending' });
  res.status(201).json({ message: 'Order created successfully', order_id: saved._id, total, currency: 'USD' });
});

app.post('/api/orders/wallet-checkout', auth, async (req, res) => {
  try {
    if(['admin','staff'].includes(req.user.role)) return res.status(403).json({message:'Customer checkout is available to user/reseller accounts. Use the administration payment tools for admin transactions.'});
    const items = Array.isArray(req.body.items) ? req.body.items : [];
    if (!items.length) return res.status(400).json({ message: 'Cart is empty' });
    const subtotalUSD = items.reduce((sum, item) => sum + Number(item.usdPrice ?? item.price ?? 0), 0);
    const platformFeeUSD = feeForRole(subtotalUSD, req.user.role);
    const totalUSD = Number((subtotalUSD + platformFeeUSD).toFixed(2));
    const wallet = await getOrCreateWallet(await User.findById(req.user.id));
    await repairLegacyWallet(wallet, await User.findById(req.user.id));
    const debitCurrency = clean(req.body.currency || wallet.currency || 'NGN').toUpperCase();
    const rate = await getRate('USD', debitCurrency);
    const walletDebit = Number((totalUSD * rate).toFixed(2));
    if (walletAmount(wallet, debitCurrency) < walletDebit) return res.status(400).json({ message: `Insufficient wallet balance. Required ${walletDebit.toFixed(2)} ${debitCurrency}.` });
    const order = await Order.create({ user:req.user.id, customerEmail:req.user.email, items, subtotal:subtotalUSD, platformFee:platformFeeUSD, platformFeeRate:feeAppliesToRole(req.user.role)?USER_PLATFORM_FEE_RATE:0, total:totalUSD, currency:'USD', paymentCurrency:debitCurrency, exchangeRate:rate, paymentAmount:walletDebit, status:'paid', paymentReference:`WALLET-${Date.now()}` });
    changeWalletAmount(wallet, debitCurrency, -walletDebit);
    wallet.transactions.push({type:'debit',amount:walletDebit,currency:debitCurrency,reference:order.paymentReference,description:`Wallet payment for order ${order._id}${platformFeeUSD?` including ${(USER_PLATFORM_FEE_RATE*100).toFixed(2)}% platform fee`:''}`,status:'completed'});
    await wallet.save();
    if (domainItemFromOrder(order)) { try { await provisionPaidDomain(order, await User.findById(req.user.id)); } catch (e) { console.error('Wallet domain provisioning failed:', e.message); } }
    res.status(201).json({message:'Order paid successfully with wallet balance.',order_id:order._id,walletBalance:walletAmount(wallet,debitCurrency),balances:walletBalancesObject(wallet),currency:debitCurrency,platformFeeUSD,totalUSD,walletDebit});
  } catch (e) { res.status(e.status || 500).json({message:e.message || 'Wallet checkout failed'}); }
});

app.post('/api/payments/paystack/checkout',auth,async(req,res)=>{try{
  if(['admin','staff'].includes(req.user.role))return res.status(403).json({message:'Customer checkout is for user/reseller accounts. Use admin payment tools for administrative payments.'});
  if(!Paystack.configured())return res.status(503).json({message:'Paystack is not configured in the backend environment.'});
  const items=Array.isArray(req.body.items)?req.body.items:[];if(!items.length)return res.status(400).json({message:'Cart is empty'});
  const subtotalUSD=items.reduce((sum,item)=>sum+Number(item.usdPrice??item.price??0),0),platformFeeUSD=feeForRole(subtotalUSD,req.user.role),totalUSD=Number((subtotalUSD+platformFeeUSD).toFixed(2));
  const paymentCurrency=normalizeCurrency(req.body.currency||'NGN','NGN');if(!supportedPaystackCheckoutCurrencies().includes(paymentCurrency))return res.status(400).json({message:`Currency ${paymentCurrency} is not enabled for checkout.`});
  const exchangeRate=await getRate('USD',paymentCurrency),paymentAmount=Number((totalUSD*exchangeRate).toFixed(2));
  const order=await Order.create({user:req.user.id,customerEmail:req.user.email,items,subtotal:subtotalUSD,platformFee:platformFeeUSD,platformFeeRate:feeAppliesToRole(req.user.role)?USER_PLATFORM_FEE_RATE:0,total:totalUSD,currency:'USD',paymentCurrency,exchangeRate,paymentAmount,status:'payment_pending'});
  const reference=`WNH-ORDER-${order._id}`;order.paymentReference=reference;await order.save();
  const frontendBase=String(process.env.FRONTEND_URL||'').split(',')[0].trim().replace(/\/$/,'');const redirectUrl=clean(req.body.redirectUrl)||(frontendBase?`${frontendBase}/payment-success.html`:'');if(!redirectUrl)return res.status(500).json({message:'FRONTEND_URL is required for payment redirects.'});
  const payment=await ProviderPayment.create({reference,purpose:'order',user:req.user.id,order:order._id,amount:paymentAmount,grossAmount:paymentAmount,platformFee:platformFeeUSD,currency:paymentCurrency,status:'pending',metadata:{subtotalUSD,totalUSD,exchangeRate}});
  const result=await Paystack.createCheckout({amount:paymentAmount,currency:paymentCurrency,customer:{name:req.user.name||req.user.email,email:req.user.email},merchantReference:reference,redirectUrl,metadata:{purpose:'order',orderId:String(order._id),userId:req.user.id}});const data=result.data||result;payment.checkoutUrl=clean(data.link||data.checkoutUrl);payment.providerReference=clean(data.id||data.reference);await payment.save();
  res.status(201).json({message:'Checkout initialized.',data:{reference,link:payment.checkoutUrl},order_id:order._id,subtotalUSD,platformFeeUSD,platformFeeRate:feeAppliesToRole(req.user.role)?USER_PLATFORM_FEE_RATE:0,totalUSD,paymentAmount,paymentCurrency,exchangeRate});
}catch(e){res.status(e.status||502).json({message:e.message});}});

app.post('/api/payments/paystack/initialize',auth,async(req,res)=>{try{
  if(!Paystack.configured())return res.status(503).json({message:'Paystack is not configured in the backend environment.'});
  const currency=normalizeCurrency(req.body.currency||'NGN','NGN');if(!supportedPaystackCheckoutCurrencies().includes(currency))return res.status(400).json({message:`Currency ${currency} is not enabled for checkout.`});
  const requestedAmount=Number(req.body.amount||0),purpose=clean(req.body.purpose||'wallet_deposit'),isAdmin=purpose==='system_wallet_deposit'&&req.user.role==='admin',chargePlatformFee=feeAppliesToRole(req.user.role)&&!isAdmin;if(purpose==='system_wallet_deposit'&&req.user.role!=='admin')return res.status(403).json({message:'Admin access required for system wallet deposits'});if(!Number.isFinite(requestedAmount)||requestedAmount<1)return res.status(400).json({message:'Valid amount is required'});
  const platformFee=chargePlatformFee?feePart(requestedAmount):0,chargeAmount=Number((requestedAmount+platformFee).toFixed(2)),reference=`WNH-${isAdmin?'SYSDEP':'DEP'}-${Date.now()}-${crypto.randomBytes(5).toString('hex')}`;
  const frontendBase=String(process.env.FRONTEND_URL||'').split(',')[0].trim().replace(/\/$/,'');const redirectUrl=clean(req.body.redirectUrl)||(frontendBase?`${frontendBase}/payment-success.html`:'');if(!redirectUrl)return res.status(500).json({message:'FRONTEND_URL is required for payment redirects.'});
  const payment=await ProviderPayment.create({reference,purpose:isAdmin?'system_wallet_deposit':'wallet_deposit',user:req.user.id,amount:requestedAmount,grossAmount:chargeAmount,platformFee,currency,status:'pending'});
  const result=await Paystack.createCheckout({amount:chargeAmount,currency,customer:{name:req.user.name||req.user.email,email:req.user.email},merchantReference:reference,redirectUrl,metadata:{purpose:payment.purpose,userId:req.user.id,requestedAmount,platformFee}});const data=result.data||result;payment.checkoutUrl=clean(data.link||data.checkoutUrl);payment.providerReference=clean(data.id||data.reference);await payment.save();
  res.status(201).json({message:'Payment initialized.',data:{reference,link:payment.checkoutUrl},requestedAmount,platformFee,platformFeeRate:chargePlatformFee?USER_PLATFORM_FEE_RATE:0,chargeAmount,currency});
}catch(e){res.status(e.status||502).json({message:e.message});}});

app.get('/api/payments/paystack/config',(_req,res)=>res.json({provider:'paystack',environment:Paystack.environment(),defaultCurrency:'NGN',supportedCurrencies:supportedPaystackCheckoutCurrencies(),virtualAccountCurrencies:supportedPaystackVirtualAccountCurrencies()}));
app.get('/api/payments/paystack/verify/:reference',auth,publicApiRequestLimit,async(req,res)=>{try{
  const reference=clean(req.params.reference);let local=await ProviderPayment.findOne({reference,user:req.user.id});if(!local){const order=await Order.findOne({paymentReference:reference,user:req.user.id});if(!order)return res.status(404).json({message:'Payment not found.'});}
  const result=await Paystack.verifyCheckout(reference);const data=result.data||result;const status=clean(data.status);if(providerSuccess(status))await settleProviderPayment(reference,data);
  local=await ProviderPayment.findOne({reference,user:req.user.id});res.json({status:true,data:{status:local?.status||status,reference,currency:local?.currency||data.currency||'',amount:Number(local?.grossAmount||data.amount||0)},verifiedBy:'paystack-server'});
}catch(e){res.status(e.status||502).json({message:e.message});}});
app.get('/api/payments/paystack/callback',async(req,res)=>res.json({message:'Payment callback received. Final status is confirmed server-to-server or by validated webhook.',reference:req.query.reference||req.query.merchantReference||''}));

app.post('/api/contact',publicWriteRequestLimit,async (req, res) => {
  const { name, email, service, message } = req.body;
  if (!clean(name) || !validEmailAddress(email) || !clean(message)) return res.status(400).json({ message: 'Name, valid email and message are required' });
  await Message.create({ name: clean(name), email: clean(email).toLowerCase(), service: clean(service), subject: clean(service) || 'Website contact', message: clean(message), source: 'contact' });
  res.status(201).json({ message: 'Message saved. World Net Hosting support will reply soon.' });
});

app.post('/api/support/chat',publicWriteRequestLimit,chatUpload.single('file'),async (req, res) => {
  try {
    let user=null; const token=(req.headers.authorization||'').replace('Bearer ','');
    if(token){ try{const payload=jwt.verify(token,JWT_SECRET); user=await User.findById(payload.id);}catch{} }
    const name=clean(req.body.name||user?.name||'Website Visitor');
    const email=clean(req.body.email||user?.email||'visitor@example.com').toLowerCase();
    const message=clean(req.body.message), language=clean(req.body.language||'en').toLowerCase();
    if(req.body.email&&!validEmailAddress(email))return res.status(400).json({message:'Enter a valid email address.'});
    if(!message && !req.file) return res.status(400).json({message:'Chat message or attachment is required'});
    let englishMessage=message;
    if(message && language!=='en'){ try{englishMessage=await translateText(message,'en');}catch{englishMessage=message;} }
    const attachments=req.file?[{filename:req.file.originalname,mimeType:req.file.mimetype,size:req.file.size,data:req.file.buffer}]:[];
    const accessToken=crypto.randomBytes(32).toString('base64url');
    const saved=await Message.create({name,email,user:user?._id||null,service:'Live support chat',subject:clean(req.body.subject||'Support chat'),message:message||`Attachment: ${req.file.originalname}`,language,englishMessage,localMessage:message,attachments,accessTokenHash:hashChatAccessToken(accessToken),source:'chat',status:'new'});
    res.status(201).json({message:'Chat delivered to staff and admin dashboards.',ticketId:saved._id,accessToken,item:publicMessage(saved)});
  } catch(error){ res.status(error instanceof multer.MulterError?400:500).json({message:error.message||'Chat could not be sent.'}); }
});
app.get('/api/support/chat/:id',requireChatAccess,async(req,res)=>res.json(publicMessage(req.supportMessage)));
app.patch('/api/support/chat/:id/status',requireChatAccess,async(req,res)=>{const status=clean(req.body.status);if(!['open','closed'].includes(status))return res.status(400).json({message:'Status must be open or closed.'});req.supportMessage.status=status;await req.supportMessage.save();res.json({message:`Chat ${status}.`,item:publicMessage(req.supportMessage)});});
app.get('/api/support/chat/:id/attachments/:attachmentId',requireChatAccess,async(req,res)=>{const file=req.supportMessage.attachments?.id(req.params.attachmentId);if(!file)return res.status(404).json({message:'Attachment not found'});res.setHeader('Content-Type',file.mimeType);res.setHeader('Content-Disposition',`inline; filename="${String(file.filename).replace(/"/g,'')}"`);res.setHeader('Cache-Control','private, no-store');res.send(file.data);});





app.get('/api/system/maintenance', async (_req,res)=>res.json(await maintenanceState()));
app.get('/api/admin/maintenance',auth,requireAdmin,async(_req,res)=>res.json(await maintenanceState()));
app.put('/api/admin/maintenance',auth,requireAdmin,async(req,res)=>{const value={enabled:Boolean(req.body.enabled),message:clean(req.body.message)||'We are performing scheduled maintenance. Please try again shortly.',allowStaff:req.body.allowStaff!==false};await SystemSetting.findOneAndUpdate({key:'maintenance'},{value,updatedBy:req.user.email},{upsert:true,new:true});res.json({message:'Maintenance settings updated.',...value});});


// Unified wallet compatibility routes used by the professional wallet pages.
app.get('/api/wallet', auth, async (req,res)=>{try{
  const {wallet,walletType}=await roleWallet(req);
  const balances=walletBalancesObject(wallet);
  res.json({available_balance:walletAmount(wallet,wallet.currency),balance:walletAmount(wallet,wallet.currency),currency:wallet.currency,balances,ngn_balance:Number(balances.NGN||0),usd_balance:Number(balances.USD||0),balance_updated_at:wallet.updatedAt,user:{name:req.user.name,email:req.user.email,role:req.user.role},walletType,platformFeeRate:feeAppliesToRole(req.user.role)?USER_PLATFORM_FEE_RATE:0,platformFeePercent:feeAppliesToRole(req.user.role)?USER_PLATFORM_FEE_RATE*100:0,paystackEnvironment:Paystack.environment(),virtualAccountCurrencies:supportedPaystackVirtualAccountCurrencies()});
}catch(e){res.status(e.status||500).json({message:e.message});}});
app.get('/api/wallet/transactions', auth, async (req,res)=>{try{
  const {wallet}=await roleWallet(req);
  res.json({transactions:[...(wallet.transactions||[])].reverse().slice(0,100).map(t=>({type:t.type,amount:t.amount,currency:t.currency||wallet.currency,reference:t.reference,status:t.status,description:t.description,created_at:t.createdAt||t.date||wallet.updatedAt}))});
}catch(e){res.status(e.status||500).json({message:e.message});}});
app.post('/api/wallet/send', auth, async (req,res)=>{try{
  if(req.user.role==='admin') return res.status(403).json({message:'Admin system wallet cannot send directly to customer wallets. Use approved admin wallet operations.'});
  const amount=Number(req.body.amount||0), currency=clean(req.body.currency||'NGN').toUpperCase(), recipientEmail=clean(req.body.recipientEmail||req.body.email).toLowerCase(), note=clean(req.body.note||'Wallet-to-wallet transfer');
  if(!Number.isFinite(amount)||amount<=0)return res.status(400).json({message:'Enter a valid amount.'});
  if(!recipientEmail||recipientEmail===String(req.user.email).toLowerCase())return res.status(400).json({message:'Enter another registered user email.'});
  const recipient=await User.findOne({email:recipientEmail,active:{$ne:false}});if(!recipient||recipient.role==='admin')return res.status(404).json({message:'Recipient wallet was not found.'});
  const sender=await User.findById(req.user.id), senderWallet=await getOrCreateWallet(sender), recipientWallet=await getOrCreateWallet(recipient);
  const fee=bankFeeForRole(amount,req.user.role), totalDebit=Number((amount+fee).toFixed(2));
  if(walletAmount(senderWallet,currency)<totalDebit)return res.status(400).json({message:`Insufficient ${currency} wallet balance. Send and fee require ${totalDebit.toFixed(2)} ${currency}.`});
  const reference=`SEND-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  changeWalletAmount(senderWallet,currency,-totalDebit);changeWalletAmount(recipientWallet,currency,amount);
  senderWallet.transactions.push({type:'debit',amount:totalDebit,currency,reference,description:`Sent ${amount.toFixed(2)} ${currency} to ${recipientEmail}; fee ${fee.toFixed(2)}`,status:'completed'});
  recipientWallet.transactions.push({type:'credit',amount,currency,reference,description:`Received from ${req.user.email}${note?`: ${note}`:''}`,status:'completed'});
  await senderWallet.save();await recipientWallet.save();
  await BankOperation.create({owner:req.user.id,ownerEmail:req.user.email,ownerRole:req.user.role,walletType:'user',type:'wallet_send',amount,fee,totalDebit,currency,providerReference:reference,status:'success',description:note,metadata:{recipientUser:String(recipient._id),recipientEmail}});
  res.status(201).json({message:'Funds sent successfully.',reference,amount,fee,totalDebit,currency});
}catch(e){res.status(e.status||500).json({message:e.message});}});

app.get('/api/wallet/banking/summary', auth, async (req,res)=>{try{
  const {wallet,walletType}=await roleWallet(req); const operations=await BankOperation.find({owner:req.user.id,walletType}).sort({createdAt:-1}).limit(50);
  const balances=walletBalancesObject(wallet);
  res.json({role:req.user.role,walletType,currency:wallet.currency,balance:walletAmount(wallet,wallet.currency),ngnBalance:Number(balances.NGN||0),usdBalance:Number(balances.USD||0),balances,dedicatedAccount:walletType==='user'?wallet.dedicatedAccount:null,operations:operations.map(publicBankOperation),platformFeePercent:feeAppliesToRole(req.user.role)?USER_PLATFORM_FEE_RATE*100:0,paystackEnvironment:Paystack.environment(),virtualAccountCurrencies:supportedPaystackVirtualAccountCurrencies()});
}catch(e){res.status(e.status||500).json({message:e.message});}});

app.get('/api/wallet/banking/banks',auth,async(req,res)=>{try{const currency=clean(req.query.currency||'NGN').toUpperCase(),country=clean(req.query.country||'NG').toUpperCase();const data=await Paystack.listBanks({currency,country});res.json(data.data||data);}catch(e){res.status(e.status||502).json({message:e.message});}});
app.get('/api/wallet/banking/resolve-account',auth,async(req,res)=>{try{const accountNumber=clean(req.query.accountNumber),bankCode=clean(req.query.bankCode),currency=clean(req.query.currency||'NGN').toUpperCase();if(!accountNumber||!bankCode)return res.status(400).json({message:'Account number and bank are required.'});const data=await Paystack.resolveAccount({accountNumber,bankCode,currency});res.json(data.data||data);}catch(e){res.status(e.status||502).json({message:e.message});}});
app.post('/api/wallet/banking/resolve-account',auth,async(req,res)=>{try{const accountNumber=clean(req.body.accountNumber),bankCode=clean(req.body.bankCode),currency=clean(req.body.currency||'NGN').toUpperCase(),type=clean(req.body.type||'nuban');if(!accountNumber)return res.status(400).json({message:'Account number is required.'});const data=await Paystack.resolveAccount({accountNumber,bankCode,type,currency});res.json(data.data||data);}catch(e){res.status(e.status||502).json({message:e.message});}});
async function submitPaystackBankTransfer({req,wallet,walletType,amount,fee,totalDebit,currency,bankCode,accountNumber,accountName,reason,reference,environment}){
  const parts=accountName.trim().split(/\s+/),firstName=parts.shift()||accountName,lastName=parts.join(' ')||firstName;changeWalletAmount(wallet,currency,-totalDebit);wallet.transactions.push({type:'debit',amount:totalDebit,currency,reference,description:`Bank transfer ${amount.toFixed(2)} + ${fee.toFixed(2)} fee`,status:'pending'});await wallet.save();
  const operation=await BankOperation.create({owner:req.user.id,ownerEmail:req.user.email,ownerRole:req.user.role,walletType,type:'bank_transfer',amount,fee,totalDebit,currency,bankCode,accountName,accountNumberMasked:maskAccountNumber(accountNumber),provider:'paystack',providerReference:reference,status:'pending',description:reason});
  try{const c=Paystack.credentials(environment);const result=await Paystack.createPayout({business:c.businessId,sourceCurrency:currency,destinationCurrency:currency,amount,description:reason,paymentDestination:'bank_account',customerReference:reference,beneficiary:{firstName,lastName,accountHolderName:accountName,accountNumber,type:'individual',bankCode}},environment);const data=result.data||result;operation.status=providerSuccess(data.status)?'success':clean(data.status||'processing');operation.providerTransferCode=clean(data.reference||data.id);operation.providerMessage=clean(result.message);operation.metadata={providerId:clean(data.id)};await operation.save();return operation;}catch(e){changeWalletAmount(wallet,currency,totalDebit);wallet.transactions.push({type:'credit',amount:totalDebit,currency,reference:`REFUND-${reference}`,description:'Failed bank transfer initialization refund',status:'completed'});await wallet.save();operation.status='failed';operation.providerMessage=e.message;operation.metadata={refunded:true};await operation.save();throw e;}
}
app.post('/api/wallet/banking/transfer',auth,async(req,res)=>{try{const amount=Number(req.body.amount||0),currency=clean(req.body.currency||'NGN').toUpperCase(),bankCode=clean(req.body.bankCode),accountNumber=clean(req.body.accountNumber).replace(/\s/g,''),accountName=clean(req.body.accountName),reason=clean(req.body.reason||'World Net Hosting transfer');if(!Number.isFinite(amount)||amount<=0||!bankCode||!accountNumber||!accountName)return res.status(400).json({message:'Amount, bank, account number and verified account name are required.'});const {wallet,walletType}=await roleWallet(req),fee=bankFeeForRole(amount,req.user.role),totalDebit=Number((amount+fee).toFixed(2));if(walletAmount(wallet,currency)<totalDebit)return res.status(400).json({message:`Insufficient ${currency} balance.`});const reference=`WNH-TRF-${Date.now()}-${crypto.randomBytes(5).toString('hex')}`;const operation=await submitPaystackBankTransfer({req,wallet,walletType,amount,fee,totalDebit,currency,bankCode,accountNumber,accountName,reason,reference});res.status(201).json({message:'Bank transfer submitted to Paystack.',operation:publicBankOperation(operation)});}catch(e){res.status(e.status||502).json({message:e.message});}});
app.post('/api/wallet/banking/receive-account',auth,async(req,res)=>{try{if(req.user.role==='admin')return res.status(400).json({message:'Dedicated receiving accounts are assigned to customer wallets.'});const user=await User.findById(req.user.id),wallet=await getOrCreateWallet(user);const account=await ensurePaystackVirtualAccount(user,wallet,{consent:req.body.consent===true,currency:clean(req.body.currency||'NGN'),kyc:req.body.kyc||req.body});const active=Boolean(account?.active&&account?.accountNumber);res.status(active?201:202).json({message:active?'Dedicated receive account is active.':'Banking verification/account issuance is pending.',dedicatedAccount:account,environment:Paystack.environment()});}catch(e){res.status(e.status||502).json({message:e.message});}});

app.post('/api/wallet/banking/convert', auth, async (req,res)=>{try{
  const amount=Number(req.body.amount||0),from=clean(req.body.fromCurrency||'NGN').toUpperCase(),to=clean(req.body.toCurrency||'USD').toUpperCase(); if(!Number.isFinite(amount)||amount<=0||from===to)return res.status(400).json({message:'Enter an amount and two different currencies.'});
  const {wallet,walletType}=await roleWallet(req);const fee=bankFeeForRole(amount,req.user.role),totalDebit=Number((amount+fee).toFixed(2));if(walletAmount(wallet,from)<totalDebit)return res.status(400).json({message:`Insufficient ${from} balance. Conversion and fee require ${totalDebit.toFixed(2)} ${from}.`});
  const rate=await resolveRate(from,to),converted=Number((amount*rate).toFixed(2)),reference=`CONVERT-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;changeWalletAmount(wallet,from,-totalDebit);changeWalletAmount(wallet,to,converted);wallet.transactions.push({type:'debit',amount:totalDebit,currency:from,reference,description:`Converted ${amount} ${from} to ${converted} ${to}; fee ${fee} ${from}`,status:'completed'});wallet.transactions.push({type:'credit',amount:converted,currency:to,reference,description:`Currency conversion from ${from}`,status:'completed'});await wallet.save();
  const operation=await BankOperation.create({owner:req.user.id,ownerEmail:req.user.email,ownerRole:req.user.role,walletType,type:'currency_convert',amount,fee,totalDebit,currency:from,sourceCurrency:from,targetCurrency:to,exchangeRate:rate,convertedAmount:converted,status:'success',description:'Internal wallet currency conversion'});res.status(201).json({message:'Wallet currency converted successfully.',operation:publicBankOperation(operation),balances:walletBalancesObject(wallet)});
}catch(e){res.status(e.status||502).json({message:e.message});}});

app.get('/api/admin/finance/config',auth,requireAdmin,async(_req,res)=>res.json({
  provider:'paystack',environment:Paystack.environment(),liveConfigured:Paystack.liveConfigured(),
  adminPlatformFeePercent:0,staffPlatformFeePercent:0,userPlatformFeePercent:USER_PLATFORM_FEE_RATE*100,
  resellerPlatformFeePercent:USER_PLATFORM_FEE_RATE*100,bankingApiTransactionFeePercent:BANKING_API_TRANSACTION_FEE_RATE*100,
  resellerBankingApiNetPercent:(1-BANKING_API_TRANSACTION_FEE_RATE)*100,
  domainFirstYearMarkupUSD:DOMAIN_FIRST_YEAR_MARKUP_USD,domainRenewalMarkupUSD:DOMAIN_RENEWAL_MARKUP_USD,resellerDomainApiMarkupUSD:0,resellerDomainApiPlatformFeePercent:DOMAIN_RESELLER_API_PLATFORM_FEE_RATE*100,
  emailCustomerMarkupUSD:Math.max(0,Number(process.env.EMAIL_CUSTOMER_MARKUP_USD||5))
}));
app.post('/api/admin/payments/paystack/initialize',auth,requireAdmin,async(req,res)=>{
  req.body={...req.body,purpose:'system_wallet_deposit'};
  if(!Paystack.configured('live') && Paystack.environment()==='live')return res.status(503).json({message:'Paystack live credentials are not configured.'});
  try{
    const currency=normalizeCurrency(req.body.currency||'NGN','NGN'),amount=Number(req.body.amount||0);if(!Number.isFinite(amount)||amount<1)return res.status(400).json({message:'Valid amount is required.'});
    if(!supportedPaystackCheckoutCurrencies().includes(currency))return res.status(400).json({message:`Currency ${currency} is not enabled for checkout.`});
    const reference=`WNH-SYSDEP-${Date.now()}-${crypto.randomBytes(5).toString('hex')}`,frontendBase=String(process.env.FRONTEND_URL||'').split(',')[0].trim().replace(/\/$/,'');
    const redirectUrl=clean(req.body.redirectUrl)||(frontendBase?`${frontendBase}/payment-success.html`:'');
    const payment=await ProviderPayment.create({reference,purpose:'system_wallet_deposit',user:req.user.id,amount,grossAmount:amount,platformFee:0,currency,status:'pending',metadata:{admin:true}});
    const result=await Paystack.createCheckout({amount,currency,customer:{name:req.user.name||'World Net Hosting Administrator',email:req.user.email},merchantReference:reference,redirectUrl,metadata:{purpose:'system_wallet_deposit',userId:req.user.id,admin:true}});const data=result.data||result;
    payment.checkoutUrl=clean(data.link||data.checkoutUrl);payment.providerReference=clean(data.id||data.reference);await payment.save();
    res.status(201).json({message:'Live Paystack system-wallet payment initialized with 0% WNH platform fee.',data:{reference,link:payment.checkoutUrl},amount,currency,platformFee:0,platformFeeRate:0});
  }catch(e){res.status(e.status||502).json({message:e.message});}
});
app.get('/api/admin/bank-operations',auth,requireAdmin,async(_req,res)=>res.json((await BankOperation.find().sort({createdAt:-1}).limit(200)).map(publicBankOperation)));
app.get('/api/staff/bank-operations',auth,requireStaffPermission('wallet.manage'),async(_req,res)=>res.json((await BankOperation.find().sort({createdAt:-1}).limit(200)).map(publicBankOperation)));

app.get('/api/wallet/withdrawals',auth,async(req,res)=>{try{
  const operations=await BankOperation.find({owner:req.user.id,type:'bank_transfer'}).sort({createdAt:-1}).limit(100);
  res.json(operations.map(publicBankOperation));
}catch(e){res.status(e.status||500).json({message:e.message});}});

// Backward-compatible withdrawal endpoint; provider settlement is handled by Paystack.
app.post('/api/wallet/withdrawals',auth,async(req,res)=>{try{const amount=Number(req.body.amount||0),currency=clean(req.body.currency||'NGN').toUpperCase(),bankCode=clean(req.body.bankCode),accountNumber=clean(req.body.accountNumber).replace(/\s/g,''),accountName=clean(req.body.accountName),reason=clean(req.body.note||req.body.reason||'World Net Hosting wallet withdrawal');if(!Number.isFinite(amount)||amount<100||!bankCode||!accountNumber||!accountName)return res.status(400).json({message:'Select a bank and verify the account before withdrawing.'});const {wallet,walletType}=await roleWallet(req),fee=bankFeeForRole(amount,req.user.role),totalDebit=Number((amount+fee).toFixed(2));if(walletAmount(wallet,currency)<totalDebit)return res.status(400).json({message:`Insufficient ${currency} wallet balance.`});const reference=`WDR-${Date.now()}-${crypto.randomBytes(5).toString('hex')}`;const operation=await submitPaystackBankTransfer({req,wallet,walletType,amount,fee,totalDebit,currency,bankCode,accountNumber,accountName,reason,reference});res.status(201).json({message:'Withdrawal submitted securely through Paystack.',operation:publicBankOperation(operation),fee,totalDebit,currency});}catch(e){res.status(e.status||502).json({message:e.message});}});
app.post('/api/admin/system-wallet/withdrawals',auth,requireAdmin,async(req,res)=>{try{const amount=Number(req.body.amount||0),currency=clean(req.body.currency||'NGN').toUpperCase(),bankCode=clean(req.body.bankCode),accountNumber=clean(req.body.accountNumber).replace(/\s/g,''),accountName=clean(req.body.accountName),reason=clean(req.body.note||'WNH system wallet withdrawal');if(!Number.isFinite(amount)||amount<100||!bankCode||!accountNumber||!accountName)return res.status(400).json({message:'Select a bank and verify the account before withdrawing.'});const wallet=await getSystemWallet();if(walletAmount(wallet,currency)<amount)return res.status(400).json({message:'Insufficient system wallet balance.'});const reference=`SYS-WDR-${Date.now()}-${crypto.randomBytes(5).toString('hex')}`;const operation=await submitPaystackBankTransfer({req,wallet,walletType:'system',amount,fee:0,totalDebit:amount,currency,bankCode,accountNumber,accountName,reason,reference});res.status(201).json({message:'System wallet withdrawal submitted through Paystack.',operation:publicBankOperation(operation)});}catch(e){res.status(e.status||502).json({message:e.message});}});

app.post('/api/internal/developer-webhooks/retry',async(req,res)=>{const required=crypto.createHmac('sha256',JWT_SECRET).update('developer-webhook-retry').digest('hex');if(clean(req.headers.authorization)!==`Bearer ${required}`)return res.sendStatus(401);const deliveries=await DeveloperWebhookDelivery.find({status:'pending',nextAttemptAt:{$lte:new Date()}}).sort({nextAttemptAt:1}).limit(25);for(const d of deliveries)await deliverDeveloperWebhook(d);res.json({processed:deliveries.length});});

app.get('/api/admin/system-wallet',auth,requireAdmin,async(_req,res)=>res.json(await getSystemWallet()));
app.post('/api/admin/system-wallet/adjust',auth,requireAdmin,async(req,res)=>{const amount=Number(req.body.amount||0),type=clean(req.body.type);if(!amount||!['credit','debit'].includes(type))return res.status(400).json({message:'Valid amount and credit/debit type are required.'});const wallet=await getSystemWallet();if(type==='debit'&&wallet.balance<amount)return res.status(400).json({message:'Insufficient system wallet balance.'});wallet.balance=Number(wallet.balance||0)+(type==='credit'?amount:-amount);wallet.transactions.push({type,amount,currency:wallet.currency,reference:`ADMIN-${Date.now()}`,description:clean(req.body.description)||`Admin ${type}`,status:'completed'});await wallet.save();res.json({message:'System wallet updated.',wallet});});
app.get('/api/admin/users',auth,requireAdmin,async(_req,res)=>{
  const users=await User.find().select('-passwordHash -password -password_hash -pinHash').sort({createdAt:-1}).lean();
  const wallets=await Wallet.find({user:{$in:users.map(u=>u._id)}}).lean();
  const walletByUser=new Map(wallets.map(w=>[String(w.user),w]));
  res.json(users.map(user=>({...user,wallet:walletByUser.get(String(user._id))||null})));
});
app.patch('/api/admin/users/:id',auth,requireAdmin,async(req,res)=>{
  const user=await User.findById(req.params.id);if(!user)return res.status(404).json({message:'User not found'});
  if(req.body.role&&['user','staff','admin','reseller'].includes(req.body.role)){user.role=req.body.role;if(user.role==='staff'&&(!user.staffPermissions||!user.staffPermissions.length))user.staffPermissions=DEFAULT_STAFF_PERMISSIONS;}
  if(Array.isArray(req.body.staffPermissions))user.staffPermissions=req.body.staffPermissions;
  if(req.body.riskStatus&&['normal','review','suspicious'].includes(req.body.riskStatus))user.riskStatus=req.body.riskStatus;
  if(req.body.adminNote!==undefined)user.adminNote=clean(req.body.adminNote).slice(0,1000);
  if(req.body.accountStatus&&['active','suspended','disabled'].includes(req.body.accountStatus)){user.accountStatus=req.body.accountStatus;user.active=req.body.accountStatus==='active';if(user.role==='staff'&&req.body.accountStatus==='active')user.staffApprovalStatus='approved';}
  if(req.body.active!==undefined){user.active=Boolean(req.body.active);user.accountStatus=user.active?'active':'disabled';}
  if(req.body.resetPin===true)user.pinHash='';
  await user.save({validateModifiedOnly:true});
  res.json({message:'User access updated.',user:toPublicUser(user)});
});
function adminAdjustmentPercent(value){const percent=Number(value);return Number.isFinite(percent)&&percent>0&&percent<=100?percent:null;}
function adminAdjustmentAmount(value){const amount=Number(value);return Number.isFinite(amount)&&amount>0?Number(amount.toFixed(2)):null;}
async function adjustWalletByAdmin(wallet,{mode,value,type,currency,description,actorEmail}){
  await normalizeWalletDocument(wallet);
  const targetCurrency=clean(currency||wallet.currency||'NGN').toUpperCase();
  const current=walletAmount(wallet,targetCurrency);
  let amount;
  if(mode==='percent'){
    const percent=adminAdjustmentPercent(value);if(percent===null){const error=new Error('Percentage must be greater than 0 and no more than 100.');error.status=400;throw error;}
    amount=Number((current*(percent/100)).toFixed(2));
  }else{
    amount=adminAdjustmentAmount(value);if(amount===null){const error=new Error('Enter a valid amount greater than 0.');error.status=400;throw error;}
  }
  if(amount<=0){const error=new Error('This adjustment produces a zero amount for the selected balance.');error.status=400;throw error;}
  if(type==='debit'&&current<amount){const error=new Error(`Insufficient ${targetCurrency} balance for this debit.`);error.status=400;throw error;}
  changeWalletAmount(wallet,targetCurrency,type==='credit'?amount:-amount);
  wallet.transactions.push({type,amount,currency:targetCurrency,reference:`ADMIN-USER-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,description:clean(description)||`Administrator ${mode==='percent'?`${value}% `:''}${type} by ${actorEmail}`,status:'completed'});
  await wallet.save();
  return {amount,currency:targetCurrency,balance:walletAmount(wallet,targetCurrency)};
}
app.post('/api/admin/users/:id/wallet-adjust',auth,requireAdmin,async(req,res)=>{
  const user=await User.findById(req.params.id);if(!user)return res.status(404).json({message:'User not found'});
  const type=clean(req.body.type).toLowerCase(),mode=clean(req.body.mode||'amount').toLowerCase();
  if(!['credit','debit'].includes(type)||!['amount','percent'].includes(mode))return res.status(400).json({message:'Select credit/debit and amount/percentage.'});
  const wallet=await getOrCreateWallet(user);
  try{const result=await adjustWalletByAdmin(wallet,{mode,value:req.body.value,type,currency:req.body.currency,description:req.body.description,actorEmail:req.user.email});res.json({message:`User wallet ${type} completed.`,user:toPublicUser(user),...result});}catch(error){res.status(error.status||400).json({message:error.message});}
});
app.post('/api/admin/users/bulk-percentage-adjust',auth,requireAdmin,async(req,res)=>{
  const type=clean(req.body.type).toLowerCase(),percent=adminAdjustmentPercent(req.body.percent);
  if(!['credit','debit'].includes(type)||percent===null)return res.status(400).json({message:'Select credit/debit and a percentage greater than 0 and no more than 100.'});
  const users=await User.find({role:{$ne:'admin'}});let adjusted=0,skipped=0,totalAmount=0;
  for(const user of users){
    const wallet=await getOrCreateWallet(user);await normalizeWalletDocument(wallet);
    const currencies=Object.entries(walletBalancesObject(wallet)).filter(([,balance])=>Number(balance)>0);
    if(!currencies.length){skipped+=1;continue;}
    let touched=false;
    for(const [currency,balance] of currencies){
      const amount=Number((Number(balance)*(percent/100)).toFixed(2));if(amount<=0)continue;
      changeWalletAmount(wallet,currency,type==='credit'?amount:-amount);totalAmount+=amount;touched=true;
      wallet.transactions.push({type,amount,currency,reference:`ADMIN-BULK-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,description:clean(req.body.description)||`Administrator bulk ${percent}% ${type} by ${req.user.email}`,status:'completed'});
    }
    if(touched){await wallet.save();adjusted+=1}else skipped+=1;
  }
  res.json({message:`Bulk ${percent}% ${type} completed.`,adjustedUsers:adjusted,skippedUsers:skipped,totalAdjusted:Number(totalAmount.toFixed(2))});
});

app.get('/api/staff/summary',auth,requireStaffPermission('users.read'),async(req,res)=>{
  const [openTickets,totalUsers,reviewUsers,notes]=await Promise.all([Message.countDocuments({status:{$in:['new','open','replied']}}),User.countDocuments({role:{$ne:'admin'}}),User.countDocuments({riskStatus:{$in:['review','suspicious']}}),StaffSupportNote.countDocuments({staff:req.user.id})]);
  res.json({openTickets,totalUsers,reviewUsers,notes});
});
app.get('/api/staff/users',auth,requireStaffPermission('users.read'),async(req,res)=>{
  const q=clean(req.query.q||req.query.query);const filter={role:{$ne:'admin'}};
  if(q)filter.$or=[{name:{$regex:q,$options:'i'}},{email:{$regex:q,$options:'i'}},{phone:{$regex:q,$options:'i'}},{company:{$regex:q,$options:'i'}}];
  const users=await User.find(filter).select('-passwordHash -password -password_hash -pinHash').sort({updatedAt:-1}).limit(100).lean();
  res.json(users);
});
app.get('/api/staff/users/:id/notes',auth,requireStaffPermission('support.notes'),async(req,res)=>{
  const user=await User.findById(req.params.id).select('name email role accountStatus riskStatus');if(!user)return res.status(404).json({message:'User not found'});
  const notes=await StaffSupportNote.find({user:user._id}).sort({createdAt:-1}).limit(100).lean();res.json({user,notes});
});
app.post('/api/staff/users/:id/notes',auth,requireStaffPermission('support.notes'),async(req,res)=>{
  const user=await User.findById(req.params.id);if(!user||user.role==='admin')return res.status(404).json({message:'User not found'});const body=clean(req.body.body),kind=clean(req.body.kind||'note');
  if(!body)return res.status(400).json({message:'Support note is required.'});const allowed=['note','follow_up','escalation','security'];if(!allowed.includes(kind))return res.status(400).json({message:'Invalid support note type.'});
  const note=await StaffSupportNote.create({user:user._id,staff:req.user.id,staffEmail:req.user.email,kind,body});res.status(201).json({message:'Support note saved.',note});
});
app.post('/api/staff/users/:id/escalate',auth,requireStaffPermission('support.notes'),async(req,res)=>{
  const user=await User.findById(req.params.id);if(!user||user.role==='admin')return res.status(404).json({message:'User not found'});const level=clean(req.body.level||'review');if(!['review','suspicious'].includes(level))return res.status(400).json({message:'Escalation must be review or suspicious.'});
  user.riskStatus=level;await user.save({validateModifiedOnly:true});const body=clean(req.body.note)||`Account escalated to ${level} by support staff.`;await StaffSupportNote.create({user:user._id,staff:req.user.id,staffEmail:req.user.email,kind:'escalation',body});res.json({message:`Account escalated to ${level}. Financial and role controls remain administrator-only.`,user:toPublicUser(user)});
});
app.post('/api/staff/users/:id/reset-pin',auth,requireStaffPermission('account.security'),async(req,res)=>{
  const user=await User.findById(req.params.id);if(!user||user.role==='admin')return res.status(404).json({message:'User not found'});user.pinHash='';await user.save({validateModifiedOnly:true});await StaffSupportNote.create({user:user._id,staff:req.user.id,staffEmail:req.user.email,kind:'security',body:'Dashboard PIN reset by support staff. User must create a new PIN after password sign-in.'});res.json({message:'User PIN reset. The user must create a new PIN after signing in with their password.'});
});

app.get('/api/staff/messages',auth,requireStaffPermission('support.manage'),async(_req,res)=>res.json((await Message.find().sort({updatedAt:-1})).map(publicMessage)));
app.post('/api/staff/messages/:id/reply',auth,requireStaffPermission('support.manage'),async(req,res)=>{const body=clean(req.body.body);if(!body)return res.status(400).json({message:'Reply body is required'});const existing=await Message.findById(req.params.id);if(!existing)return res.status(404).json({message:'Conversation not found'});let localBody=body;if(existing.language&&existing.language!=='en'){try{localBody=await translateText(body,existing.language)}catch{}}existing.replies.push({body,englishBody:body,localBody,language:existing.language||'en',repliedBy:req.user.email,createdAt:new Date()});existing.status='replied';await existing.save();res.json({message:'Reply saved in English and customer language.',item:publicMessage(existing)});});
app.patch('/api/staff/messages/:id/status',auth,requireStaffPermission('support.manage'),async(req,res)=>{const allowed=['new','open','replied','closed'];const status=clean(req.body.status);if(!allowed.includes(status))return res.status(400).json({message:'Invalid status'});const item=await Message.findByIdAndUpdate(req.params.id,{status},{new:true});if(!item)return res.status(404).json({message:'Conversation not found'});res.json({message:'Status updated.',item});});

app.get('/api/admin/stats', auth, requireAdmin, async (req, res) => {
  const [orders, messages, users, domainSearches, openChats, wallets] = await Promise.all([Order.find(), Message.countDocuments(), User.countDocuments(), DomainSearch.countDocuments(), Message.countDocuments({ status: { $in: ['new', 'open'] } }), Wallet.find()]);
  const revenue = orders.filter(o => o.status === 'paid').reduce((sum, order) => sum + Number(order.total || 0), 0);
  const pendingRevenue = orders.filter(o => o.status !== 'paid').reduce((sum, order) => sum + Number(order.total || 0), 0);
  const walletBalance = wallets.reduce((sum, wallet) => sum + Number(wallet.balance || 0), 0);
  res.json({ orders: orders.length, messages, users, domainSearches, openChats, revenue: revenue.toFixed(2), pendingRevenue: pendingRevenue.toFixed(2), walletBalance: walletBalance.toFixed(2), domainApiConfigured: domainApiConfigured(), paystackConfigured: Paystack.configured(), supportedPaystackCheckoutCurrencies: supportedPaystackCheckoutCurrencies(),
    supportedPaystackVirtualAccountCurrencies: supportedPaystackVirtualAccountCurrencies() });
});
app.get('/api/admin/orders', auth, requireAdmin, async (req, res) => res.json(await Order.find().sort({ createdAt: -1 })));
app.get('/api/admin/wallets', auth, requireAdmin, async (req, res) => res.json(await Wallet.find().sort({ updatedAt: -1 })));
app.get('/api/admin/messages', auth, requireAdmin, async (req, res) => res.json((await Message.find().sort({ createdAt: -1 })).map(publicMessage)));
app.patch('/api/admin/messages/:id/status', auth, requireAdmin, async (req, res) => {
  const status = clean(req.body.status || 'open');
  const updated = await Message.findByIdAndUpdate(req.params.id, { status }, { new: true });
  if (!updated) return res.status(404).json({ message: 'Message not found' });
  res.json({ message: 'Message status updated', item: updated });
});
app.post('/api/admin/messages/:id/reply', auth, requireAdmin, async (req, res) => {
  const body=clean(req.body.body); if(!body)return res.status(400).json({message:'Reply body is required'});
  const item=await Message.findById(req.params.id); if(!item)return res.status(404).json({message:'Message not found'});
  let localBody=body; if(item.language&&item.language!=='en'){try{localBody=await translateText(body,item.language)}catch{}}
  item.replies.push({body,englishBody:body,localBody,language:item.language||'en',repliedBy:req.user.email,createdAt:new Date()}); item.status='replied'; await item.save();
  res.json({message:'Reply saved in English and customer language.',item:publicMessage(item)});
});
app.get('/api/admin/domain-searches', auth, requireAdmin, async (req, res) => res.json(await DomainSearch.find().sort({ createdAt: -1 }).limit(50)));

app.get('/', (req, res) => res.status(200).json({ success:true, message:'World Net Hosting API is running', health:'/api/health' }));
app.use('/api', (req, res) => res.status(404).json({ message: `World Net Hosting API route not found: ${req.method} ${req.originalUrl}` }));
app.use((req, res) => res.status(404).json({ success:false, message:'Backend route not found', method:req.method, path:req.originalUrl }));
app.use((err, req, res, next) => { console.error(err); if (res.headersSent) return next(err); res.status(err.status || 500).json({ message: err.message || 'Server error' }); });

async function connectDatabaseWithRetry() {
  let delay = 5000;
  while (mongoose.connection.readyState !== 1) {
    try {
      await connectDB();
      console.log('MongoDB connected successfully');
      return;
    } catch (err) {
      console.error(`MongoDB connection failed: ${err.message}. Retrying in ${Math.round(delay/1000)}s.`);
      await new Promise(resolve => setTimeout(resolve, delay));
      delay = Math.min(delay * 2, 60000);
    }
  }
}

async function startServer() {
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`World Net Hosting API running on port ${PORT}`);
    console.log('Health check: /api/health');
  });
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;
  server.requestTimeout = 120000;
  connectDatabaseWithRetry().catch(err => console.error('Database retry loop stopped:', err.message));
  return server;
}

if (require.main === module) {
  startServer().catch(err => {
    console.error('Server failed to start:', err.message);
    process.exit(1);
  });
}

// Vercel Express auto-detection requires this recognized entry file to export
// the Express application itself, not an object wrapper.
module.exports = app;
// Preserve local/test access to the start helper without changing the default export.
module.exports.startServer = startServer;
