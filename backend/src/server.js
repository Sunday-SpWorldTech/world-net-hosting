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
const Plan = require('./models/Plan');
const Order = require('./models/Order');
const Message = require('./models/Message');
const DomainSearch = require('./models/DomainSearch');
const DEFAULT_DOMAIN_SEARCH_TLDS = require('./config/domainSearchTlds');
const Wallet = require('./models/Wallet');
const ManagedDomain = require('./models/ManagedDomain');
const DomainTransfer = require('./models/DomainTransfer');
const crypto = require('crypto');
const HostingProject = require('./models/HostingProject');
const HostingSubscription = require('./models/HostingSubscription');
const GitHubConnection = require('./models/GitHubConnection');
const SystemSetting = require('./models/SystemSetting');
const SystemWallet = require('./models/SystemWallet');
const Withdrawal = require('./models/Withdrawal');
const BankOperation = require('./models/BankOperation');
const multer = require('multer');
const { verifyWebhook } = require('./services/githubApp');

const app = express();
app.set('trust proxy', 1);
const chatUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 3 * 1024 * 1024, files: 1 }, fileFilter(_req,file,cb){ const allowed=/^(image\/(png|jpeg|gif|webp)|application\/(pdf|msword|vnd\.openxmlformats-officedocument\.wordprocessingml\.document)|text\/plain)$/i; cb(allowed.test(file.mimetype)?null:new Error('Unsupported chat attachment type.'), allowed.test(file.mimetype)); } });
const PLACEHOLDER_RE = /your_|replace_|example\.com|your-domain|xxxxxxxxx|change_this/i;
const clean = (v = '') => String(v || '').trim();
const validEmailAddress = (v = '') => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean(v)) && clean(v).length <= 254;
const isRealValue = (v) => Boolean(clean(v)) && !PLACEHOLDER_RE.test(clean(v));
const PORT = Number(process.env.PORT || 10000);
const USER_PLATFORM_FEE_RATE = Math.max(0, Number(process.env.USER_PLATFORM_FEE_RATE || 0.04));
const addUserFee = (amount) => Number((Number(amount || 0) * (1 + USER_PLATFORM_FEE_RATE)).toFixed(2));
const feePart = (amount) => Number((Number(amount || 0) * USER_PLATFORM_FEE_RATE).toFixed(2));
const bankFeeForRole = (amount, role) => role === 'admin' ? 0 : feePart(amount);
const PAYSTACK_BASE_URL = 'https://api.paystack.co';
const paystackKeyMode = () => {
  const publicKey = clean(process.env.PAYSTACK_PUBLIC_KEY);
  const secretKey = clean(process.env.PAYSTACK_SECRET_KEY);
  if (publicKey.startsWith('pk_live_') && secretKey.startsWith('sk_live_')) return 'live';
  if (publicKey.startsWith('pk_test_') && secretKey.startsWith('sk_test_')) return 'test';
  return publicKey || secretKey ? 'mixed-or-invalid' : 'missing';
};
const PAYSTACK_REQUIRE_LIVE = clean(process.env.PAYSTACK_REQUIRE_LIVE).toLowerCase() === 'true';
const JWT_SECRET = clean(process.env.JWT_SECRET);
if (!JWT_SECRET || JWT_SECRET.length < 32) throw new Error('JWT_SECRET must be configured with at least 32 characters.');
if (process.env.NODE_ENV === 'production' && PAYSTACK_REQUIRE_LIVE && paystackKeyMode() !== 'live') {
  console.warn('Paystack live keys are not configured yet. The backend will stay online, but payment endpoints will remain unavailable until matching pk_live_ and sk_live_ keys are added on Render.');
}
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const normalizeOrigin = (value = '') => String(value || '').trim().replace(/\/+$/, '');
const configuredOrigins = (process.env.FRONTEND_URL || '').split(',').map(normalizeOrigin).filter(Boolean);
const localDevelopmentOrigins = ['http://localhost:5173','http://127.0.0.1:5173','http://localhost:4173','http://127.0.0.1:4173'];
const allowedOrigins = [...new Set([...(configuredOrigins.length ? configuredOrigins : ['https://world-net-hosting-frontend.onrender.com']), ...(process.env.NODE_ENV === 'production' ? [] : localDevelopmentOrigins)])];
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
  allowedHeaders: ['Accept','Authorization','Content-Type','X-Requested-With','X-Idempotency-Key'],
  exposedHeaders: ['Content-Length','Content-Type','Retry-After'],
  credentials: false,
  optionsSuccessStatus: 204,
  maxAge: 86400
};
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

async function paystackRequest(pathname, options = {}) {
  if (!isRealValue(process.env.PAYSTACK_SECRET_KEY)) {
    const error = new Error('Paystack secret key is not configured.'); error.status = 503; throw error;
  }
  const response = await fetch(`${PAYSTACK_BASE_URL}${pathname}`, {
    ...options,
    signal: options.signal || AbortSignal.timeout(30000),
    headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`, 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.status === false) {
    const error = new Error(payload.message || `Paystack request failed (${response.status})`); error.status = response.status || 502; error.payload = payload; throw error;
  }
  return payload;
}
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
  const configuredUrl = clean(process.env.EXCHANGE_RATE_PROVIDER_URL);
  const configuredKey = clean(process.env.EXCHANGE_RATE_PROVIDER_KEY);
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

async function applySuccessfulPaystackCharge(data) {
  const reference = clean(data?.reference);
  if (!reference || data?.status !== 'success') return { applied: false };
  const metadata = data.metadata || {};
  if (metadata.purpose==='system_wallet_deposit') {
    const wallet=await getSystemWallet();
    const exists=wallet.transactions.some(t=>t.reference===reference&&t.type==='credit');
    if(!exists){const amount=Number(data.amount||0)/100; wallet.balance=Number(wallet.balance||0)+amount; wallet.currency=data.currency||wallet.currency; wallet.transactions.push({type:'credit',amount,currency:data.currency||wallet.currency,reference,description:'Paystack system wallet deposit',status:'completed'}); await wallet.save();}
    return {applied:true,purpose:'system_wallet_deposit'};
  }
  if (metadata.purpose==='wallet_deposit' && metadata.user_id) {
    const user = await User.findById(metadata.user_id);
    if (!user) return { applied: false, reason: 'user_not_found' };
    const wallet = await getOrCreateWallet(user);
    const exists = wallet.transactions.some(t => t.reference === reference && t.type === 'credit');
    if (!exists) {
      const chargedAmount = Number(data.amount || 0) / 100;
      const amount = Number(metadata.requested_amount || chargedAmount);
      wallet.currency = data.currency || wallet.currency;
      ensureCoreWalletBalances(wallet);
      changeWalletAmount(wallet, data.currency || wallet.currency, amount);
      wallet.transactions.push({ type: 'credit', amount, currency: data.currency || wallet.currency, reference, description: `Paystack wallet deposit (4% service fee: ${Number(metadata.platform_fee||0).toFixed(2)} ${data.currency||wallet.currency})`, status: 'completed' });
      await wallet.save();
    }
    return { applied: true, purpose: metadata.purpose };
  }
  if (metadata.purpose === 'hosting_subscription' && metadata.subscription_id) {
    const subscription = await HostingSubscription.findById(metadata.subscription_id);
    if (!subscription) return { applied: false, reason: 'subscription_not_found' };
    if (subscription.status !== 'active') {
      const start = new Date(); const end = new Date(start); end.setMonth(end.getMonth() + 1);
      subscription.status = 'active'; subscription.currentPeriodStart = start; subscription.currentPeriodEnd = end;
      subscription.paymentReference = reference; await subscription.save();
    }
    return { applied: true, purpose: 'hosting_subscription' };
  }
  const order = await Order.findOne({ paymentReference: reference });
  if (order && order.status !== 'paid') {
    order.status = 'paid';
    await order.save();
  }
  if (order && domainItemFromOrder(order) && order.domainProvisionStatus !== 'completed') {
    const user = await User.findOne({ email: order.customerEmail });
    if (user) {
      try { await provisionPaidDomain(order, user); }
      catch (error) { console.error('Domain provisioning after webhook failed:', error.message); }
    }
  }
  return { applied: Boolean(order), purpose: 'order' };
}

app.post('/api/payments/paystack/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const signature = req.headers['x-paystack-signature'];
    const hash = crypto.createHmac('sha512', process.env.PAYSTACK_SECRET_KEY || '').update(req.body).digest('hex');
    if (!signature || hash !== signature) return res.sendStatus(401);
    const event = JSON.parse(req.body.toString('utf8'));
    if (event.event === 'charge.success') {
      const data = event.data || {};
      const authorization = data.authorization || {};
      const customerCode = clean(data.customer?.customer_code || data.customer?.code || authorization.customer_code);
      const accountNumber = clean(authorization.receiver_bank_account_number || authorization.account_number || data.metadata?.dedicated_account_number);
      const wallet = customerCode ? await Wallet.findOne({ paystackCustomerCode: customerCode }) : (accountNumber ? await Wallet.findOne({ 'dedicatedAccount.accountNumber': accountNumber }) : null);
      if (wallet && (authorization.channel === 'dedicated_nuban' || authorization.channel === 'bank_transfer' || data.channel === 'bank_transfer')) {
        const reference = clean(data.reference); const duplicate = wallet.transactions.some(t => t.reference === reference && t.type === 'credit');
        if (!duplicate) {
          const owner = await User.findById(wallet.user); const gross = Number(data.amount || 0) / 100; const fee = bankFeeForRole(gross, owner?.role || 'user'); const net = Number((gross - fee).toFixed(2));
          changeWalletAmount(wallet, data.currency || 'NGN', net); wallet.transactions.push({ type:'credit', amount:net, currency:data.currency||'NGN', reference, description:`Bank receive ${gross.toFixed(2)} less ${fee.toFixed(2)} platform fee`, status:'completed' }); await wallet.save();
          await BankOperation.create({ owner:wallet.user, ownerEmail:wallet.email, ownerRole:owner?.role||'user', walletType:'user', type:'bank_receive', amount:gross, fee, totalDebit:0, currency:data.currency||'NGN', providerReference:reference, status:'success', description:'Dedicated virtual account bank receipt' });
        }
      } else await applySuccessfulPaystackCharge(data);
    }
    if (['transfer.success','transfer.failed','transfer.reversed'].includes(event.event)) {
      const data=event.data||{}, reference=clean(data.reference), status=event.event.split('.')[1];
      const operation=await BankOperation.findOne({providerReference:reference});
      if(operation && operation.status!==status){
        operation.status=status; operation.providerMessage=clean(data.reason||data.message); operation.providerTransferCode=clean(data.transfer_code||operation.providerTransferCode); await operation.save();
        if(['failed','reversed'].includes(status) && !operation.metadata?.refunded){
          const target=operation.walletType==='system'?await getSystemWallet():await Wallet.findOne({user:operation.owner});
          if(target){changeWalletAmount(target,operation.currency,operation.totalDebit);target.transactions.push({type:'credit',amount:operation.totalDebit,currency:operation.currency,reference:`REFUND-${reference}`,description:`Refund for ${status} bank transfer`,status:'completed'});await target.save();operation.metadata={...(operation.metadata||{}),refunded:true};await operation.save();}
        }
      }
    }
    res.sendStatus(200);
  } catch (e) { console.error('Paystack webhook error:', e.message); res.sendStatus(500); }
});

app.post('/api/github/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    if (!verifyWebhook(req.body, req.headers['x-hub-signature-256'])) return res.sendStatus(401);
    const event = req.headers['x-github-event'];
    const payload = JSON.parse(req.body.toString('utf8'));
    if (event === 'push' && payload.installation?.id && payload.repository?.full_name) {
      const connection = await GitHubConnection.findOne({ installationId: payload.installation.id });
      if (connection) {
        const branch = String(payload.ref || '').replace('refs/heads/', '');
        const projects = await HostingProject.find({ user: connection.user, 'repository.fullName': payload.repository.full_name, branch, autoDeploy: true });
        for (const project of projects) {
          project.deployments.unshift({ status: 'queued', branch, commit: payload.after || 'latest', logs: ['Queued automatically from GitHub push webhook.'], liveUrl: `https://${project.platformSubdomain}` });
          project.status = 'deploying'; await project.save();
        }
      }
    }
    res.sendStatus(202);
  } catch (error) { console.error('GitHub webhook error:', error.message); res.sendStatus(500); }
});

app.use(express.json({ limit: '1mb' }));
app.use(async (req,res,next)=>{
  try{
    if(process.env.NODE_ENV==='test')return next();
    if(req.path.startsWith('/api/admin')||req.path.startsWith('/api/staff')||req.path.includes('/webhook')||req.path==='/api/health') return next();
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
  phone: user.phone,
  company: user.company,
  role: user.role,
  hasPin: Boolean(user.pinHash)
});
const signToken = (user) => jwt.sign({ id: user._id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '1d' });

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

async function connectDB() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is missing in .env / Render environment');
  await mongoose.connect(process.env.MONGODB_URI, { maxPoolSize: 20, minPoolSize: 2, serverSelectionTimeoutMS: 10000, socketTimeoutMS: 45000, maxIdleTimeMS: 60000 });
  console.log('MongoDB connected');
}

async function auth(req, res, next) {
  try {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    const payload = jwt.verify(token, JWT_SECRET);
    const account = await User.findById(payload.id).select('email role active staffPermissions');
    if (!account || account.active === false) return res.status(403).json({ message: 'Account is inactive or unavailable' });
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
function requireStaffPermission(permission){return (req,res,next)=>{if(req.user?.role==='admin')return next();if(req.user?.role!=='staff')return res.status(403).json({message:'Staff access required'});const permissions=req.user.staffPermissions||[];if(permissions.length&&!permissions.includes(permission)&&!permissions.includes('*'))return res.status(403).json({message:`Staff permission required: ${permission}`});next();};}
async function getSystemWallet(){
  return SystemWallet.findOneAndUpdate({key:'main'},{$setOnInsert:{key:'main',balance:0,currency:process.env.WALLET_CURRENCY||'NGN',transactions:[]}},{new:true,upsert:true});
}
const WITHDRAWAL_CIPHER_KEY = crypto.createHash('sha256').update(process.env.WITHDRAWAL_ENCRYPTION_KEY || JWT_SECRET).digest();
function encryptWithdrawalValue(value=''){ const iv=crypto.randomBytes(12); const cipher=crypto.createCipheriv('aes-256-gcm',WITHDRAWAL_CIPHER_KEY,iv); const encrypted=Buffer.concat([cipher.update(String(value),'utf8'),cipher.final()]); const tag=cipher.getAuthTag(); return [iv,tag,encrypted].map(x=>x.toString('base64')).join('.'); }
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

const githubOAuthClientId = () => clean(process.env.GITHUB_OAUTH_APP_KEY || process.env.GITHUB_CLIENT_ID);
const githubOAuthClientSecret = () => clean(process.env.GITHUB_OAUTH_APP_SECRET || process.env.GITHUB_CLIENT_SECRET);
const domainApiConfigured = () => isRealValue(process.env.DOMAIN_RESELLER_ID) && isRealValue(process.env.DOMAIN_API_KEY);
const paystackConfigured = () => isRealValue(process.env.PAYSTACK_SECRET_KEY) && isRealValue(process.env.PAYSTACK_PUBLIC_KEY);
const renderApiConfigured = () => isRealValue(process.env.RENDER_API_KEY) && isRealValue(process.env.RENDER_WORKSPACE_ID);
const githubAppConfigured = () => isRealValue(process.env.GITHUB_APP_ID) && isRealValue(process.env.GITHUB_APP_SLUG) && clean(process.env.GITHUB_PRIVATE_KEY).includes('PRIVATE KEY');
const translatorConfigured = () => isRealValue(process.env.AZURE_TRANSLATOR_KEY) && isRealValue(process.env.AZURE_TRANSLATOR_REGION);
const productionReadinessIssues = () => {
  const issues = [];
  if (process.env.NODE_ENV !== 'production') issues.push('NODE_ENV must be production.');
  if (!isRealValue(process.env.MONGODB_URI)) issues.push('MongoDB is not configured.');
  if (!domainApiConfigured() || DOMAIN_API_MODE !== 'live') issues.push('Live Domain Name API is not configured.');
  if (!paystackConfigured() || paystackKeyMode() !== 'live') issues.push('Paystack live keys are required.');
  if (!githubAppConfigured()) issues.push('GitHub App is not configured.');
  if (!isRealValue(githubOAuthClientId()) || !isRealValue(githubOAuthClientSecret())) issues.push('GitHub OAuth is not configured. Add GITHUB_OAUTH_APP_KEY and GITHUB_OAUTH_APP_SECRET (or the legacy GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET).');
  if (!renderApiConfigured()) issues.push('Render API and workspace are not configured.');
  if (!isRealValue(process.env.RENDER_BACKEND_SERVICE_ID) || !isRealValue(process.env.RENDER_FRONTEND_SERVICE_ID)) issues.push('Current Render service IDs are not configured.');
  if (!translatorConfigured()) issues.push('Azure Translator is not configured.');
  if (!isRealValue(process.env.FRONTEND_URL) || !isRealValue(process.env.BACKEND_URL)) issues.push('Production frontend/backend URLs are not configured.');
  return issues;
};

// Domain Name API live and test gateways from the provider's current REST SDK.
// Production is the default. Set DOMAIN_API_MODE=test only when intentionally using the OT&E key.
const DOMAIN_API_MODE = clean(process.env.DOMAIN_API_MODE || 'live').toLowerCase();
const DOMAIN_API_LIVE_URL = 'https://api.domainresellerapi.com/api/v1';
const DOMAIN_API_TEST_URL = 'https://ote.domainresellerapi.com/api/v1';
const configuredDomainBase = clean(process.env.DOMAIN_API_BASE_URL || '');
const DOMAIN_API_BASE_URL = (
  process.env.DOMAIN_API_ALLOW_CUSTOM_BASE === 'true' && configuredDomainBase
    ? configuredDomainBase
    : (DOMAIN_API_MODE === 'test' ? DOMAIN_API_TEST_URL : DOMAIN_API_LIVE_URL)
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
      'X-API-KEY': clean(process.env.DOMAIN_API_KEY),
      '__reseller': clean(process.env.DOMAIN_RESELLER_ID)
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
    const err = new Error('Could not connect to Domain Name API. Check internet access and Render network settings.');
    err.status = 502;
    err.cause = cause;
    throw err;
  }

  const text = await response.text();
  const dataOut = safeJson(text);
  if (!response.ok) {
    const isHtml = /<\s*!doctype|<\s*html/i.test(text);
    const fallback = response.status === 404
      ? 'Domain Name API endpoint was not found. The project now uses the official REST gateway; confirm DOMAIN_API_BASE_URL is not overridden with an old value.'
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
  const normalized = clean(query).toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[^a-z0-9.-]/g, '');
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
const supportedPaystackCurrencies = () => (process.env.PAYSTACK_SUPPORTED_CURRENCIES || 'NGN,USD,GHS,KES,ZAR,XOF,EGP').split(',').map(c => c.trim().toUpperCase()).filter(Boolean);
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
    paystackMode: paystackKeyMode(),
    githubAppConfigured: githubAppConfigured(),
    githubOAuthConfigured: githubOAuthConfigured(),
    githubOAuthCallbackUrl: githubAuthCallbackUrl(),
    renderApiConfigured: renderApiConfigured(),
    translatorConfigured: translatorConfigured(),
    staticFrontendServed: true,
    supportedPaystackCurrencies: supportedPaystackCurrencies()
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


function frontendBaseUrl() {
  const configured = String(process.env.FRONTEND_URL || '').split(',').map(x => x.trim()).filter(Boolean);
  const preferred = configured[0] || 'https://world-net-hosting-frontend.onrender.com';
  return preferred.replace(/\/$/, '');
}
function githubOAuthConfigured() { return isRealValue(githubOAuthClientId()) && isRealValue(githubOAuthClientSecret()); }
function githubAuthCallbackUrl() {
  const configured = clean(process.env.GITHUB_OAUTH_CALLBACK_URL || process.env.GITHUB_AUTH_CALLBACK_URL);
  if (configured) return configured.replace(/\/$/, '');
  return `${clean(process.env.BACKEND_URL || 'https://world-net-hosting-backend.onrender.com').replace(/\/$/, '')}/api/auth/github/callback`;
}
function safeReturnPath(value, fallback='dashboard.html') { const v=clean(value); return /^[a-z0-9][a-z0-9._/-]*\.html(?:[?#].*)?$/i.test(v) ? v : fallback; }
app.get('/api/auth/github/start', (req,res)=>{
  if(!githubOAuthConfigured()) return res.status(503).json({message:'GitHub login is not configured.'});
  const requestedRole=clean(req.query.role||'user').toLowerCase();
  if(!['user','staff'].includes(requestedRole)) return res.status(400).json({message:'GitHub login is available for users and existing staff accounts only.'});
  const state=jwt.sign({purpose:'github-login',role:requestedRole,returnTo:safeReturnPath(req.query.returnTo,requestedRole==='staff'?'staff.htm':'dashboard.html'),nonce:crypto.randomBytes(12).toString('hex')},JWT_SECRET,{expiresIn:'10m'});
  const params=new URLSearchParams({client_id:githubOAuthClientId(),redirect_uri:githubAuthCallbackUrl(),scope:'read:user user:email',state,allow_signup:requestedRole==='user'?'true':'false'});
  res.redirect(302,`https://github.com/login/oauth/authorize?${params.toString()}`);
});
app.get('/api/auth/github/callback', async(req,res)=>{
  const finish=(payload)=>{const fragment=new URLSearchParams(payload).toString();return res.redirect(302,`${frontendBaseUrl()}/github-auth-complete.html#${fragment}`)};
  try{
    if(!githubOAuthConfigured()) throw new Error('GitHub login is not configured.');
    const state=jwt.verify(clean(req.query.state),JWT_SECRET); if(state.purpose!=='github-login') throw new Error('Invalid GitHub login state.');
    const tokenResponse=await fetch('https://github.com/login/oauth/access_token',{method:'POST',headers:{Accept:'application/json','Content-Type':'application/json'},body:JSON.stringify({client_id:githubOAuthClientId(),client_secret:githubOAuthClientSecret(),code:clean(req.query.code),redirect_uri:githubAuthCallbackUrl()}),signal:AbortSignal.timeout(30000)});
    const tokenData=await tokenResponse.json(); if(!tokenResponse.ok||!tokenData.access_token) throw new Error(tokenData.error_description||'GitHub authorization failed.');
    const ghHeaders={Authorization:`Bearer ${tokenData.access_token}`,Accept:'application/vnd.github+json','User-Agent':'World-Net-Hosting'};
    const [profileResponse,emailResponse]=await Promise.all([fetch('https://api.github.com/user',{headers:ghHeaders,signal:AbortSignal.timeout(30000)}),fetch('https://api.github.com/user/emails',{headers:ghHeaders,signal:AbortSignal.timeout(30000)})]);
    const profile=await profileResponse.json(); const emails=emailResponse.ok?await emailResponse.json():[];
    const primary=(Array.isArray(emails)?emails.find(x=>x.primary&&x.verified)||emails.find(x=>x.verified):null)?.email || profile.email;
    if(!profileResponse.ok||!profile.id||!primary) throw new Error('GitHub must provide a verified email address.');
    const email=clean(primary).toLowerCase(); let user=await User.findOne({$or:[{githubId:String(profile.id)},{email}]});
    if(state.role==='staff'){
      if(!user||user.role!=='staff'||user.active===false) throw new Error('This GitHub email is not linked to an active staff account.');
    } else if(!user){
      user=await User.create({name:clean(profile.name||profile.login||email.split('@')[0]),email,passwordHash:await bcrypt.hash(crypto.randomBytes(32).toString('hex'),10),role:'user',githubId:String(profile.id),githubLogin:clean(profile.login),githubAvatarUrl:clean(profile.avatar_url)});
      await getOrCreateWallet(user);
    }
    if(user.role==='admin') throw new Error('Administrators must use the secure PIN login.');
    if(state.role==='user'&&user.role==='staff') throw new Error('Use the staff GitHub sign-in option for this account.');
    user.githubId=String(profile.id);user.githubLogin=clean(profile.login);user.githubAvatarUrl=clean(profile.avatar_url);await user.save();
    finish({token:signToken(user),user:Buffer.from(JSON.stringify(toPublicUser(user))).toString('base64url'),next:'dashboard',emailVerified:'true',role:user.role,returnTo:safeReturnPath(state.returnTo,user.role==='staff'?'staff.htm':'dashboard.html')});
  }catch(error){finish({error:error.message||'GitHub login failed.'});}
});

app.post('/api/auth/signup',authRequestLimit,async (req, res) => {
  const name = clean(req.body.name);
  const email = clean(req.body.email).toLowerCase();
  const password = String(req.body.password || '');
  if (!name || !validEmailAddress(email) || password.length < 6) return res.status(400).json({ message: 'Name, valid email and password of at least 6 characters are required' });
  if (await User.findOne({ email })) return res.status(409).json({ message: 'Email already registered. Please sign in.' });
  const user = await User.create({ name, email, phone: clean(req.body.phone), company: clean(req.body.company), passwordHash: await bcrypt.hash(password, 10), role: 'user' });
  await getOrCreateWallet(user);
  res.status(201).json({ message: 'Signup successful. Create your dashboard PIN.', token: signToken(user), user: toPublicUser(user), next: 'create-pin' });
});

app.post('/api/auth/login',authRequestLimit,async (req, res) => {
  const email = clean(req.body.email).toLowerCase();
  const user = await User.findOne({ email });
  if (!user || !(await bcrypt.compare(req.body.password || '', user.passwordHash))) return res.status(401).json({ message: 'Invalid login details' });
  if (user.active === false) return res.status(403).json({ message: 'This account is inactive. Contact support if you believe this is an error.' });
  res.json({ message: user.pinHash ? 'Login successful. Enter your PIN.' : 'Login successful. Create your PIN.', token: signToken(user), user: toPublicUser(user), next: user.pinHash ? 'verify-pin' : 'create-pin' });
});

const adminPinAttempts = new Map();
app.post('/api/auth/admin/login',authRequestLimit,async (req, res) => {
  const key = req.ip || req.socket?.remoteAddress || 'unknown';
  const now = Date.now();
  const state = adminPinAttempts.get(key) || { count: 0, lockedUntil: 0 };
  if (state.lockedUntil > now) return res.status(429).json({ message: 'Too many failed attempts. Try again later.' });
  const configuredPin = clean(process.env.ADMIN_LOGIN_PIN);
  if (!configuredPin) return res.status(503).json({ message: 'ADMIN_LOGIN_PIN is not configured on the backend.' });
  const suppliedPin = clean(req.body.pin);
  if (!/^\d{6,12}$/.test(suppliedPin) || suppliedPin !== configuredPin) {
    state.count += 1;
    if (state.count >= 5) { state.lockedUntil = now + 15 * 60 * 1000; state.count = 0; }
    adminPinAttempts.set(key, state);
    return res.status(401).json({ message: 'Incorrect administrator PIN' });
  }
  const user = await User.findOne({ role: 'admin', active: { $ne: false } }).sort({ createdAt: 1 });
  if (!user) return res.status(503).json({ message: 'No active administrator account exists. Keep the current admin role and assign one account as admin.' });
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
  if (!user || !user.pinHash) return res.status(400).json({ message: 'No PIN found. Please create a PIN.' });
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
  res.json({ user, domains, wallet: { balance: wallet.balance, currency: wallet.currency, transactions: wallet.transactions.slice(-10).reverse() }, orders, summary: { orders: orders.length, supportStatus: 'Active', hostingStatus: 'Ready', balance: wallet.balance, currency: wallet.currency } });
});

app.get('/api/wallet/health', auth, async (req,res)=>{try{const wallet=await ensureUserWallet(req.user);res.json({ok:true,service:'banking',database:mongoose.connection.readyState===1?'connected':'disconnected',walletId:String(wallet._id),currencies:Object.keys(walletBalancesObject(wallet))});}catch(error){res.status(503).json({ok:false,service:'banking',message:error.message||'Wallet information is temporarily unavailable.'});}});
app.get('/api/currency/config', (req, res) => res.json({ userPlatformFeeRate: USER_PLATFORM_FEE_RATE, userPlatformFeePercent: USER_PLATFORM_FEE_RATE*100, countryCurrency, baseCurrency: 'USD', displayCurrencies: ['USD','EUR','GBP','NGN','GHS','KES','ZAR','CAD','AUD','NZD','JPY','CNY','HKD','SGD','INR','BRL','MXN','AED','SAR','QAR','KWD','BHD','OMR','CHF','SEK','NOK','DKK','PLN','CZK','HUF','RON','BGN','TRY','RUB','UAH','ILS','EGP','MAD','DZD','TND','XOF','XAF','XPF','ETB','UGX','TZS','RWF','BWP','NAD','ZMW','MZN','AOA','GMD','GNF','SLL','LRD','CVE','MRU','STN','SCR','MUR','MWK','SZL','LSL','CDF','SOS','SDG','SSP','LYD','JOD','LBP','IQD','IRR','AFN','PKR','BDT','LKR','NPR','BTN','MVR','MMK','THB','VND','KHR','LAK','MYR','IDR','PHP','BND','TWD','KRW','MNT','KZT','UZS','TJS','TMT','KGS','AZN','GEL','AMD','BYN','MDL','RSD','MKD','ALL','BAM','ISK','HRK','CLP','COP','PEN','ARS','UYU','PYG','BOB','VES','GYD','SRD','BZD','GTQ','HNL','NIO','CRC','PAB','DOP','HTG','JMD','TTD','BBD','BSD','BMD','KYD','XCD','AWG','ANG','CUP','CUC','FJD','PGK','SBD','VUV','WST','TOP','KMF','DJF','ERN','BIF','ZWL','ZWG','MOP','XAU','XAG','XPT','XPD','XDR','ADP','AFA','ALK','AOK','AON','AOR','ARA','ARL','ARM','ARP','ATS','AZM','BAD','BAN','BEC'], paystackDefaultCurrency: process.env.PAYSTACK_DEFAULT_CURRENCY || 'NGN', supportedPaystackCurrencies: supportedPaystackCurrencies() }));
app.get('/api/currency/convert',publicApiRequestLimit,async (req, res) => {
  const amount = Number(req.query.amount || 1);
  const from = normalizeCurrency(req.query.from || 'USD');
  const to = normalizeCurrency(req.query.to || 'NGN');
  const rate = await getRate(from, to);
  res.json({ amount, from, to, rate, converted: Number((amount * rate).toFixed(2)) });
});

app.get('/api/domains/search',publicApiRequestLimit,async (req, res) => {
  const query = clean(req.query.name);
  try {
    const apiResult = await searchDomainReseller(query, { limit: req.query.limit });
    await DomainSearch.create({ query, results: apiResult.results, source: apiResult.source, apiMessage: apiResult.message });
    const markup=Number(process.env.DOMAIN_CUSTOMER_MARKUP_USD||10);
    const priced={...apiResult,results:(apiResult.results||[]).map(item=>{
      const firstYearPrice=Number(item.price||0);
      const providerRenewal=Number(item.renewalPrice||0);
      const renewalBase=providerRenewal>0?providerRenewal:firstYearPrice;
      const renewalPrice=item.premium?renewalBase:Number((renewalBase+markup).toFixed(2));
      return {...item,wholesalePrice:firstYearPrice,firstYearPrice,price:firstYearPrice,renewalPrice,customerMarkup:item.premium?0:markup};
    })};
    res.json({ query, ...priced, resellerConfigured: domainApiConfigured(), pricingRule:{firstYear:'live-provider-price-no-markup',renewal:'live-provider-renewal-plus-10-usd-markup',markupUSD:markup} });
  } catch (err) {
    await DomainSearch.create({ query, results: [], source: 'domainnameapi-error', apiMessage: err.message });
    res.status(err.status || 502).json({ query, results: [], source: 'domainnameapi-error', message: err.message });
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
    const provider = await domainNameApiRequest('GET', domainEndpoint('DNS_LIST','domains/dns/records'), { domainName: req.params.domain });
    const records = provider.records || provider.items || provider.data || provider;
    res.json({ domain: req.params.domain, nameservers: req.managedDomain.nameservers || [], records: Array.isArray(records) ? records : [], provider });
  } catch (err) { res.status(err.status || 502).json({ message: err.message, provider: err.payload }); }
});
app.post('/api/domains/:domain/dns', auth, requireOwnedDomain, async (req, res) => {
  try {
    const record = normalizeDnsRecord(req.body);
    const provider = await domainNameApiRequest('POST', domainEndpoint('DNS_CREATE','domains/dns/record'), dnsRecordPayload(req.params.domain, record));
    res.status(201).json({ message: `${record.type} record created successfully.`, record: provider.record || provider.data || provider, provider });
  } catch (err) { res.status(err.status || 502).json({ message: err.message, provider: err.payload }); }
});
app.put('/api/domains/:domain/dns/:recordId', auth, requireOwnedDomain, async (req, res) => {
  try {
    const record = normalizeDnsRecord(req.body);
    const endpoint = domainEndpoint('DNS_UPDATE','domains/dns/record').replace(':recordId', encodeURIComponent(req.params.recordId));
    const provider = await domainNameApiRequest('PUT', endpoint, dnsRecordPayload(req.params.domain, record, req.params.recordId));
    res.json({ message: `${record.type} record updated successfully.`, record: provider.record || provider.data || provider, provider });
  } catch (err) { res.status(err.status || 502).json({ message: err.message, provider: err.payload }); }
});
app.delete('/api/domains/:domain/dns/:recordId', auth, requireOwnedDomain, async (req, res) => {
  try {
    const endpoint = domainEndpoint('DNS_DELETE','domains/dns/record').replace(':recordId', encodeURIComponent(req.params.recordId));
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
function encryptSensitive(value){const secret=crypto.createHash('sha256').update(String(process.env.TRANSFER_ENCRYPTION_KEY||JWT_SECRET)).digest();const iv=crypto.randomBytes(12);const cipher=crypto.createCipheriv('aes-256-gcm',secret,iv);const encrypted=Buffer.concat([cipher.update(String(value),'utf8'),cipher.final()]);return `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${encrypted.toString('hex')}`;}
app.post('/api/domains/transfers',auth,async(req,res)=>{try{const domain=clean(req.body.domain).toLowerCase();const authCode=clean(req.body.authCode);const email=clean(req.body.email).toLowerCase();if(!validDomainName(domain))return res.status(400).json({message:'Enter a valid full domain name.'});if(!authCode||authCode.length<3)return res.status(400).json({message:'A valid authorization/EPP code is required.'});if(!req.body.consent)return res.status(400).json({message:'Ownership authorization confirmation is required.'});const provider=await domainNameApiRequest('POST',domainEndpoint('TRANSFER','domains/transfer'),{domainName:domain,authCode,contactEmail:email,period:Number(req.body.period||1)});const item=await DomainTransfer.create({user:req.user.id,type:'transfer-in',domain,email,authCodeEncrypted:encryptSensitive(authCode),status:'processing',providerReference:String(provider.reference||provider.orderId||provider.id||'')});res.status(201).json({message:providerMessage(provider,'Domain transfer started successfully.'),reference:String(item._id),status:item.status,provider})}catch(e){res.status(e.status||502).json({message:e.message,provider:e.payload})}});

app.post('/api/domains/:domain/renew',auth,requireOwnedDomain,async(req,res)=>{try{const period=Math.max(1,Number(req.body.period||1));const provider=await domainNameApiRequest('POST',domainEndpoint('RENEW','domains/renew'),{domainName:req.params.domain,period});res.json({message:providerMessage(provider,'Domain renewed successfully.'),provider})}catch(e){res.status(e.status||502).json({message:e.message,provider:e.payload})}});
app.put('/api/domains/:domain/lock',auth,requireOwnedDomain,async(req,res)=>{try{const locked=Boolean(req.body.locked);const provider=await domainNameApiRequest('PUT',domainEndpoint('LOCK','domains/lock'),{domainName:req.params.domain,isLocked:locked});req.managedDomain.locked=locked;await req.managedDomain.save();res.json({message:`Domain ${locked?'locked':'unlocked'} successfully.`,locked,provider})}catch(e){res.status(e.status||502).json({message:e.message,provider:e.payload})}});
app.get('/api/domains/:domain/epp',auth,requireOwnedDomain,async(req,res)=>{try{const provider=await domainNameApiRequest('POST',domainEndpoint('EPP','domains/auth-code'),{domainName:req.params.domain});res.json({message:'EPP/auth code retrieved securely.',authCode:provider.authCode||provider.eppCode||provider.code||'',provider})}catch(e){res.status(e.status||502).json({message:e.message,provider:e.payload})}});
app.put('/api/domains/:domain/contact',auth,requireOwnedDomain,async(req,res)=>{try{const registrant=normalizeContact(req.body.contact||req.body,'Registrant');if(!registrant)return res.status(400).json({message:'Complete WHOIS contact details are required.'});const contacts=['Registrant','Admin','Tech','Billing'].map(type=>({...registrant,contactType:type}));const provider=await domainNameApiRequest('PUT',domainEndpoint('CONTACT','domains/contact'),{domainName:req.params.domain,contacts});res.json({message:providerMessage(provider,'WHOIS contacts updated successfully.'),provider})}catch(e){res.status(e.status||502).json({message:e.message,provider:e.payload})}});
app.post('/api/domains/receive-requests',auth,async(req,res)=>{const domain=clean(req.body.domain).toLowerCase();const senderEmail=clean(req.body.senderEmail).toLowerCase();if(!validDomainName(domain))return res.status(400).json({message:'Enter a valid full domain name.'});if(!senderEmail||!senderEmail.includes('@'))return res.status(400).json({message:'A valid sender email is required.'});if(!req.body.consent)return res.status(400).json({message:'Receiving consent is required.'});const item=await DomainTransfer.create({user:req.user.id,type:'receive',domain,senderEmail,note:clean(req.body.note),status:'pending-review'});res.status(201).json({message:'Receive request created successfully and is pending ownership validation.',reference:String(item._id),status:item.status})});
app.get('/api/domains/transfer-requests',auth,async(req,res)=>res.json(await DomainTransfer.find({user:req.user.id}).select('-authCodeEncrypted').sort({createdAt:-1})));
app.get('/api/admin/domain-transfers',auth,requireAdmin,async(req,res)=>res.json(await DomainTransfer.find().select('-authCodeEncrypted').sort({createdAt:-1})));
app.patch('/api/admin/domain-transfers/:id/status',auth,requireAdmin,async(req,res)=>{const allowed=['pending-review','processing','completed','rejected','cancelled'];const status=clean(req.body.status);if(!allowed.includes(status))return res.status(400).json({message:'Invalid transfer status.'});const item=await DomainTransfer.findByIdAndUpdate(req.params.id,{status},{new:true}).select('-authCodeEncrypted');if(!item)return res.status(404).json({message:'Transfer request not found.'});res.json({message:'Transfer status updated.',item})});

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

app.get('/api/plans', async (req, res) => {
  let plans = await Plan.find({ active: true }).sort({ price: 1 });
  if (!plans.length) {
    plans = await Plan.insertMany([
      { name: 'Starter Hosting', type: 'hosting', description: 'For landing pages and small business websites.', price: 5.99, billing: 'mo', features: ['1 website', '10GB storage', 'Free SSL', 'Email support'] },
      { name: 'Business Hosting', type: 'hosting', description: 'For professional company websites and traffic growth.', price: 12.99, billing: 'mo', features: ['5 websites', '50GB storage', 'Daily backup', 'Priority support'] },
      { name: 'Cloud Pro', type: 'hosting', description: 'For dashboards, APIs and serious online platforms.', price: 24.99, billing: 'mo', features: ['Unlimited projects', '100GB storage', 'API ready', 'Advanced security'] }
    ]);
  }
  res.json(plans);
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
    const items = Array.isArray(req.body.items) ? req.body.items : [];
    if (!items.length) return res.status(400).json({ message: 'Cart is empty' });
    const subtotalUSD = items.reduce((sum, item) => sum + Number(item.usdPrice ?? item.price ?? 0), 0);
    const platformFeeUSD = feePart(subtotalUSD);
    const totalUSD = addUserFee(subtotalUSD);
    const wallet = await getOrCreateWallet(await User.findById(req.user.id));
    const rate = await getRate('USD', wallet.currency || 'NGN');
    const walletDebit = Number((totalUSD * rate).toFixed(2));
    if (Number(wallet.balance || 0) < walletDebit) return res.status(400).json({ message: `Insufficient wallet balance. Required ${walletDebit.toFixed(2)} ${wallet.currency}.` });
    const order = await Order.create({ user:req.user.id, customerEmail:req.user.email, items, subtotal:subtotalUSD, platformFee:platformFeeUSD, platformFeeRate:USER_PLATFORM_FEE_RATE, total:totalUSD, currency:'USD', paymentCurrency:wallet.currency, exchangeRate:rate, paymentAmount:walletDebit, status:'paid', paymentReference:`WALLET-${Date.now()}` });
    wallet.balance = Number((Number(wallet.balance || 0) - walletDebit).toFixed(2));
    wallet.transactions.push({type:'debit',amount:walletDebit,currency:wallet.currency,reference:order.paymentReference,description:`Wallet payment for order ${order._id} including 4% platform fee`,status:'completed'});
    await wallet.save();
    if (domainItemFromOrder(order)) { try { await provisionPaidDomain(order, await User.findById(req.user.id)); } catch (e) { console.error('Wallet domain provisioning failed:', e.message); } }
    res.status(201).json({message:'Order paid successfully with wallet balance.',order_id:order._id,walletBalance:wallet.balance,currency:wallet.currency,platformFeeUSD,totalUSD,walletDebit});
  } catch (e) { res.status(e.status || 500).json({message:e.message || 'Wallet checkout failed'}); }
});

app.post('/api/payments/paystack/checkout', auth, async (req, res) => {
  if (!paystackConfigured()) return res.status(400).json({ message: 'Paystack public/secret keys are not configured on Render environment' });
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  const email = clean(req.user.email).toLowerCase();
  if (!items.length) return res.status(400).json({ message: 'Cart is empty' });
  const subtotalUSD = items.reduce((sum, item) => sum + Number(item.usdPrice ?? item.price ?? 0), 0);
  const platformFeeUSD = feePart(subtotalUSD);
  const totalUSD = addUserFee(subtotalUSD);
  const paymentCurrency = 'NGN'; // Display may be USD/local, but Paystack settlement is always initialized in NGN.
  const exchangeRate = await getRate('USD', paymentCurrency);
  const paymentAmount = Number((totalUSD * exchangeRate).toFixed(2));
  const amount = toSubunit(paymentAmount, paymentCurrency);
  if (!amount || amount < 1) return res.status(400).json({ message: 'Valid payment amount is required' });
  const order = await Order.create({ user:req.user.id, customerEmail: email, items, subtotal: subtotalUSD, platformFee: platformFeeUSD, platformFeeRate: USER_PLATFORM_FEE_RATE, total: totalUSD, currency: 'USD', paymentCurrency, exchangeRate, paymentAmount, status: 'payment_pending' });
  let frontendBase = String(process.env.FRONTEND_URL || 'https://world-net-hosting-frontend.onrender.com').split(',')[0].trim().replace(/\/$/, '');
  const callbackUrl = process.env.PAYSTACK_CALLBACK_URL || (frontendBase ? `${frontendBase}/payment-success.html` : undefined);
  if (!callbackUrl) return res.status(500).json({ message: 'Payment callback URL is not configured. Set FRONTEND_URL or PAYSTACK_CALLBACK_URL on Render.' });
  const response = await fetch('https://api.paystack.co/transaction/initialize', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, amount, currency: paymentCurrency, callback_url: callbackUrl, metadata: { purpose: 'domain_order', order_id: String(order._id), user_id: req.user.id, subtotal_usd: subtotalUSD, platform_fee_usd: platformFeeUSD, platform_fee_rate: USER_PLATFORM_FEE_RATE, total_usd: totalUSD, payment_amount: paymentAmount, payment_currency: paymentCurrency } }),
    signal: AbortSignal.timeout(30000)
  });
  const raw = await response.text();
  let data;
  try { data = raw ? JSON.parse(raw) : {}; }
  catch { data = { status: false, message: raw || `Paystack returned HTTP ${response.status}` }; }
  if (data?.data?.reference) {
    order.paymentReference = data.data.reference;
    await order.save();
  }
  res.status(response.status).json({ ...data, order_id: order._id, subtotalUSD, platformFeeUSD, platformFeeRate: USER_PLATFORM_FEE_RATE, totalUSD, paymentAmount, paymentCurrency, exchangeRate });
});

app.post('/api/payments/paystack/initialize', auth, async (req, res) => {
  if (!paystackConfigured()) return res.status(400).json({ message: 'Paystack public/secret keys are not configured in Render environment' });
  const currency = normalizeCurrency(req.body.currency || process.env.PAYSTACK_DEFAULT_CURRENCY || 'NGN', 'NGN');
  if (!supportedPaystackCurrencies().includes(currency)) return res.status(400).json({ message: `Currency ${currency} is not enabled for Paystack on this platform` });
  const requestedAmount = Number(req.body.amount || 0);
  const purpose = clean(req.body.purpose || 'wallet_deposit');
  const isAdminSystemDeposit = purpose === 'system_wallet_deposit' && req.user.role === 'admin';
  if (purpose === 'system_wallet_deposit' && req.user.role !== 'admin') return res.status(403).json({ message: 'Admin access required for system wallet deposits' });
  const platformFee = isAdminSystemDeposit ? 0 : feePart(requestedAmount);
  const chargeAmount = isAdminSystemDeposit ? requestedAmount : addUserFee(requestedAmount);
  const amount = toSubunit(chargeAmount, currency);
  if (!requestedAmount || requestedAmount < 1 || !amount) return res.status(400).json({ message: 'Valid amount is required' });
  const response = await fetch('https://api.paystack.co/transaction/initialize', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: req.user.email,
      amount,
      currency,
      callback_url: process.env.PAYSTACK_CALLBACK_URL || undefined,
      metadata: { ...(req.body.metadata || {}), purpose, user_id: req.user.id, requested_amount: requestedAmount, platform_fee: platformFee, platform_fee_rate: isAdminSystemDeposit ? 0 : USER_PLATFORM_FEE_RATE, charged_amount: chargeAmount }
    }),
    signal: AbortSignal.timeout(30000)
  });
  const data = await response.json().catch(() => ({ status: false, message: `Paystack returned HTTP ${response.status}` }));
  res.status(response.status).json({ ...data, requestedAmount, platformFee, platformFeeRate: isAdminSystemDeposit ? 0 : USER_PLATFORM_FEE_RATE, chargeAmount, currency });
});

app.get('/api/payments/paystack/config', (req, res) => res.json({ publicKey: process.env.PAYSTACK_PUBLIC_KEY || '', callbackUrl: process.env.PAYSTACK_CALLBACK_URL || '', defaultCurrency: process.env.PAYSTACK_DEFAULT_CURRENCY || 'NGN', supportedCurrencies: supportedPaystackCurrencies() }));

app.get('/api/payments/paystack/verify/:reference',publicApiRequestLimit,async (req, res) => {
  if (!paystackConfigured()) return res.status(400).json({ message: 'Paystack public/secret keys are not configured on Render environment' });
  const reference = clean(req.params.reference);
  const response = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, { headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` }, signal: AbortSignal.timeout(30000) });
  const data = await response.json();
  const paid = data?.data?.status === 'success';
  if (paid) await applySuccessfulPaystackCharge(data.data);
  const order = await Order.findOne({ paymentReference: reference });
  if (order && paid) {
    order.status = 'paid';
    await order.save();
    const user = await User.findOne({ email: order.customerEmail });
    if (user && domainItemFromOrder(order)) {
      try { await provisionPaidDomain(order, user); } catch (e) { console.error('Domain provisioning failed:', e.message); }
    }
    if (user) {
      const wallet = await getOrCreateWallet(user);
      const exists = wallet.transactions.some(t => t.reference === reference);
      if (!exists) {
        wallet.transactions.push({ type: 'debit', amount: order.paymentAmount || order.total, currency: order.paymentCurrency || wallet.currency, reference, description: `Payment for order ${order._id}`, status: 'completed' });
        await wallet.save();
      }
    }
  }
  res.status(response.status).json({status:Boolean(data?.status),message:data?.message||'',data:{status:data?.data?.status||'',reference:data?.data?.reference||reference,currency:data?.data?.currency||'',amount:Number(data?.data?.amount||0),paidAt:data?.data?.paid_at||data?.data?.paidAt||null},orderStatus:order?.status||'not_found',domainProvisionStatus:order?.domainProvisionStatus||'not_started',domainProvisionMessage:order?.domainProvisionMessage||''});
});

app.get('/api/payments/paystack/callback', async (req, res) => res.json({ message: 'Paystack callback reached. Use /api/payments/paystack/verify/:reference to confirm payment.', reference: req.query.reference || '' }));

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



// GitHub App installation callback. GitHub returns here after verification/installation.
function githubInstallationCallback(req, res) {
  const frontendBase = String(process.env.FRONTEND_URL || '').split(',')[0].trim().replace(/\/$/, '');
  const installationId = clean(req.query.installation_id);
  const setupAction = clean(req.query.setup_action);
  const code = clean(req.query.code);
  const params = new URLSearchParams();
  if (installationId) params.set('installation_id', installationId);
  if (setupAction) params.set('setup_action', setupAction);
  if (code) params.set('code', code);
  params.set('github', installationId ? 'installed' : 'callback');
  if (!frontendBase) return res.status(500).json({ message: 'FRONTEND_URL is not configured.', installationId, setupAction });
  return res.redirect(302, `${frontendBase}/dashboard-hosting.html?${params.toString()}`);
}
app.get(['/api/github/callback', '/api/github/callback/', '/api/hosting/github/callback', '/api/hosting/github/callback/'], githubInstallationCallback);
app.get('/api/github/status', (_req, res) => res.json({ ok: true, callbackRoute: '/api/github/callback' }));

// Modern Git deployment hosting module. Kept separate from domain orders and Paystack billing.
const rawEnvEncryptionKey = clean(process.env.ENV_ENCRYPTION_KEY);
if (process.env.NODE_ENV === 'production' && (!rawEnvEncryptionKey || rawEnvEncryptionKey.length < 32)) {
  throw new Error('ENV_ENCRYPTION_KEY must be configured with at least 32 characters in production.');
}
const ENV_CIPHER_KEY = crypto.createHash('sha256').update(rawEnvEncryptionKey || JWT_SECRET).digest();
function decryptEnvironmentValue(value='') { const [iv,tag,data]=String(value).split('.').map(x=>Buffer.from(x,'base64')); const decipher=crypto.createDecipheriv('aes-256-gcm',ENV_CIPHER_KEY,iv); decipher.setAuthTag(tag); return Buffer.concat([decipher.update(data),decipher.final()]).toString('utf8'); }
function encryptEnvironmentValue(value='') { const iv=crypto.randomBytes(12); const cipher=crypto.createCipheriv('aes-256-gcm',ENV_CIPHER_KEY,iv); const encrypted=Buffer.concat([cipher.update(String(value),'utf8'),cipher.final()]); const tag=cipher.getAuthTag(); return [iv,tag,encrypted].map(x=>x.toString('base64')).join('.'); }
function publicHostingProject(project){ const obj=project.toObject?project.toObject():project; return {...obj,environment:(obj.environment||[]).map(v=>({key:v.key,isSecret:v.isSecret,value:v.isSecret?'••••••••':'configured'}))}; }
function safeSlug(value='project'){ return String(value).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,42)||'project'; }

const RENDER_API_BASE='https://api.render.com/v1';
async function renderApi(path,{method='GET',body}={}){const apiKey=clean(process.env.RENDER_API_KEY);if(!apiKey){const e=new Error('Render API is not configured.');e.status=503;throw e;}const response=await fetch(`${RENDER_API_BASE}${path}`,{method,headers:{Authorization:`Bearer ${apiKey}`,Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});const data=await response.json().catch(()=>({}));if(!response.ok){const e=new Error(data?.message||data?.error||`Render API returned HTTP ${response.status}`);e.status=response.status;e.payload=data;throw e;}return data;}
function renderServiceType(t='web'){return t==='static'?'static_site':t==='worker'?'background_worker':'web_service';}
function renderRuntime(v='node'){v=String(v).toLowerCase();return ['node','python','ruby','go','rust','elixir','docker'].includes(v)?v:'node';}
function renderServicePayload(project){
  const type=renderServiceType(project.serviceType);
  const repo=project.repository?.htmlUrl||project.repository?.cloneUrl||`https://github.com/${project.repository?.fullName||''}`;
  if(!project.repository?.fullName){const e=new Error('A valid GitHub repository is required.');e.status=400;throw e;}
  const ownerId=clean(process.env.RENDER_WORKSPACE_ID);if(!ownerId){const e=new Error('RENDER_WORKSPACE_ID is not configured.');e.status=503;throw e;}
  const envVars=(project.environment||[]).map(v=>({key:v.key,value:decryptEnvironmentValue(v.valueEncrypted)}));
  const common={type,name:`wnh-${safeSlug(project.name)}-${String(project._id).slice(-5)}`.slice(0,60),ownerId,repo,autoDeploy:project.autoDeploy?'yes':'no',branch:project.branch||'main',rootDir:project.rootDirectory||'',envVars};
  if(type==='static_site'){
    common.serviceDetails={buildCommand:project.buildCommand||'npm install && npm run build',publishPath:project.publishDirectory||'dist'};
  }else{
    common.serviceDetails={runtime:renderRuntime(project.runtime),plan:clean(project.planCode||process.env.RENDER_DEFAULT_PLAN||'free'),region:clean(project.region||process.env.RENDER_DEFAULT_REGION||'virginia'),envSpecificDetails:{buildCommand:project.buildCommand||'npm install',startCommand:project.startCommand||'npm start'},...(type==='web_service'?{healthCheckPath:clean(project.healthCheckPath||'/')}:{})};
  }
  return common;
}
function renderServiceObject(data){return data?.service||data;}
function renderDeployObject(data){return data?.deploy||data;}
function renderCustomDomainObject(data){return data?.customDomain||data;}
function renderCustomDomainList(data){const list=Array.isArray(data)?data:(Array.isArray(data?.customDomains)?data.customDomains:[]);return list.map(renderCustomDomainObject).filter(item=>item?.name);}
function normalizeHostedDomain(value=''){
  let input=clean(value).toLowerCase().replace(/\.$/,'');
  if(!input){const e=new Error('Domain is required');e.status=400;throw e;}
  try{input=new URL(input.includes('://')?input:`https://${input}`).hostname.toLowerCase().replace(/\.$/,'');}catch{const e=new Error('Enter a valid domain such as example.com or app.example.com.');e.status=400;throw e;}
  if(input.length>253||!input.includes('.')||input.includes('*')||!input.split('.').every(label=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))){const e=new Error('Enter a valid domain such as example.com or app.example.com.');e.status=400;throw e;}
  return input;
}
function renderServiceHostname(project){try{return new URL(project.render?.url||`https://${project.platformSubdomain||''}`).hostname;}catch{return clean(project.platformSubdomain).replace(/^https?:\/\//,'').replace(/\/$/,'');}}
function renderDnsInstructions(customDomain,target){
  const domain=clean(customDomain?.name);
  if(customDomain?.domainType==='apex')return [{type:'A',name:'@',value:'216.24.57.1'},{type:'CNAME',name:'www',value:target}];
  return [{type:'CNAME',name:domain,value:target}];
}
function syncRenderCustomDomains(project,data){
  const domains=renderCustomDomainList(data);
  if(!domains.length)return [];
  const existing=new Map((project.customDomains||[]).map(item=>[String(item.domain).toLowerCase(),item]));
  project.customDomains=domains.map((item,index)=>{const prior=existing.get(String(item.name).toLowerCase());const verified=item.verificationStatus==='verified';return {domain:item.name,providerId:item.id||'',domainType:item.domainType||'',status:verified?'active':'pending',verificationStatus:item.verificationStatus||'unverified',sslStatus:verified?'active':'pending',isPrimary:prior?.isPrimary??index===0};});
  return domains;
}

app.get('/api/hosting/status', auth, async(req,res)=>{
  const databaseReady = mongoose.connection.readyState === 1;
  res.status(databaseReady ? 200 : 503).json({
    ok: databaseReady,
    database: databaseReady ? 'connected' : 'unavailable',
    githubConfigured: Boolean(process.env.GITHUB_APP_ID && process.env.GITHUB_APP_SLUG && process.env.GITHUB_PRIVATE_KEY),
    renderConfigured: Boolean(process.env.RENDER_API_KEY && process.env.RENDER_WORKSPACE_ID),
    timestamp: new Date().toISOString()
  });
});

app.get('/api/hosting/projects', auth, async(req,res)=>{try{
  const projects=await HostingProject.find({user:req.user.id}).sort({updatedAt:-1});
  res.json(projects.map(publicHostingProject));
}catch(error){
  console.error('Hosting projects load error:', error.message);
  res.status(500).json({message:'Projects could not be loaded from the database. Please retry.'});
}});
app.post('/api/hosting/projects', auth, async(req,res)=>{ try {
  const name=clean(req.body.name); if(!name)return res.status(400).json({message:'Project name is required'});
  const repository=req.body.repository||{};if(!clean(repository.fullName))return res.status(400).json({message:'Select an authorized GitHub repository.'});
  const serviceType=['static','web','worker'].includes(req.body.serviceType)?req.body.serviceType:'web';
  const variables=Array.isArray(req.body.environment)?req.body.environment:[];
  const environment=[];for(const item of variables){const key=clean(item.key).toUpperCase();if(!key)continue;if(!/^[A-Z_][A-Z0-9_]*$/.test(key))return res.status(400).json({message:`Invalid environment key: ${key}`});environment.push({key,valueEncrypted:encryptEnvironmentValue(item.value||''),isSecret:item.isSecret!==false});}
  const project=await HostingProject.create({user:req.user.id,name,planCode:clean(req.body.planCode||'free'),serviceType,runtime:req.body.runtime||'node',repository,branch:clean(req.body.branch||repository.defaultBranch||'main'),region:clean(req.body.region||'virginia'),projectGroup:clean(req.body.projectGroup),environmentName:clean(req.body.environmentName),healthCheckPath:clean(req.body.healthCheckPath||'/'),rootDirectory:clean(req.body.rootDirectory),buildCommand:clean(req.body.buildCommand||(serviceType==='static'?'npm install && npm run build':'npm install')),startCommand:clean(req.body.startCommand||'npm start'),publishDirectory:clean(req.body.publishDirectory||'dist'),autoDeploy:req.body.autoDeploy!==false,environment,status:'draft',platformSubdomain:''});
  res.status(201).json({message:'Service configuration created',project:publicHostingProject(project)});
} catch(e){res.status(400).json({message:e.message});} });
app.get('/api/hosting/projects/:id', auth, async(req,res)=>{const p=await HostingProject.findOne({_id:req.params.id,user:req.user.id}); if(!p)return res.status(404).json({message:'Project not found'}); res.json(publicHostingProject(p));});
app.patch('/api/hosting/projects/:id', auth, async(req,res)=>{const allowed=['name','serviceType','runtime','branch','rootDirectory','buildCommand','startCommand','publishDirectory','autoDeploy']; const update={}; allowed.forEach(k=>{if(req.body[k]!==undefined)update[k]=req.body[k]}); const p=await HostingProject.findOneAndUpdate({_id:req.params.id,user:req.user.id},update,{new:true,runValidators:true}); if(!p)return res.status(404).json({message:'Project not found'}); res.json({message:'Project updated',project:publicHostingProject(p)});});
app.put('/api/hosting/projects/:id/environment', auth, async(req,res)=>{const p=await HostingProject.findOne({_id:req.params.id,user:req.user.id}); if(!p)return res.status(404).json({message:'Project not found'}); const variables=Array.isArray(req.body.variables)?req.body.variables:[]; for(const item of variables){const key=clean(item.key).toUpperCase(); if(!/^[A-Z_][A-Z0-9_]*$/.test(key))return res.status(400).json({message:`Invalid environment key: ${key}`}); const existing=p.environment.find(v=>v.key===key); if(item.delete===true){p.environment=p.environment.filter(v=>v.key!==key);continue;} if(item.value!==undefined&&String(item.value)!=='••••••••'){const next={key,valueEncrypted:encryptEnvironmentValue(item.value),isSecret:item.isSecret!==false}; if(existing)Object.assign(existing,next);else p.environment.push(next);} } await p.save(); res.json({message:'Environment variables saved. Redeploy to apply changes.',environment:publicHostingProject(p).environment});});
app.post('/api/hosting/projects/:id/deploy', auth, async(req,res)=>{try{const p=await HostingProject.findOne({_id:req.params.id,user:req.user.id});if(!p)return res.status(404).json({message:'Project not found'});const subscription=await HostingSubscription.findOne({project:p._id,status:'active',currentPeriodEnd:{$gt:new Date()}}).sort({createdAt:-1});if(!subscription)return res.status(402).json({message:'An active hosting plan is required before deployment.'});if(subscription.planCode==='free'){const periodStart=subscription.currentPeriodStart||subscription.createdAt||new Date(0);const used=(p.deployments||[]).filter(item=>new Date(item.startedAt||item.createdAt||0)>=periodStart).length;const limit=Math.max(1,Number(process.env.HOSTING_FREE_MONTHLY_DEPLOYS||100));if(used>=limit)return res.status(429).json({message:`The free plan includes ${limit} deployments per billing month. Upgrade to deploy again now.`});}const connection=await GitHubConnection.findOne({user:req.user.id});if(!connection)return res.status(409).json({message:'Connect the World Net Hosting GitHub App before deployment.'});p.deployments.unshift({status:'queued',branch:p.branch,commit:clean(req.body.commit||'latest'),logs:['Deployment requested from World Net Hosting.']});p.status='deploying';await p.save();const localId=p.deployments[0]._id;let serviceId=p.render?.serviceId||'';if(!serviceId){const service=renderServiceObject(await renderApi('/services',{method:'POST',body:renderServicePayload(p)}));serviceId=service?.id||'';if(!serviceId)throw new Error('Render did not return a service ID.');p.render={serviceId,serviceType:renderServiceType(p.serviceType),url:service?.serviceDetails?.url||service?.url||'',status:service?.status||'created',dashboardUrl:`https://dashboard.render.com/${serviceId}`,lastSyncAt:new Date()};p.deployments.id(localId).logs.push('Render service created. Initial deploy started.');}else{const dep=renderDeployObject(await renderApi(`/services/${encodeURIComponent(serviceId)}/deploys`,{method:'POST',body:{clearCache:req.body.clearCache===true?'clear':'do_not_clear',...(req.body.commit&&req.body.commit!=='latest'?{commitId:req.body.commit}:{})}}));p.render.deployId=dep?.id||'';p.render.lastSyncAt=new Date();p.deployments.id(localId).logs.push(`Render deploy triggered${dep?.id?` (${dep.id})`:''}.`);}p.deployments.id(localId).liveUrl=p.render?.url||'';await p.save();res.status(202).json({message:'Deployment started on Render.',project:publicHostingProject(p)});}catch(e){console.error('Deploy error:',e);res.status(e.status||500).json({message:e.message||'Deployment failed'});}});
app.post('/api/hosting/projects/:id/render/sync',auth,async(req,res)=>{try{const p=await HostingProject.findOne({_id:req.params.id,user:req.user.id});if(!p)return res.status(404).json({message:'Project not found'});if(!p.render?.serviceId)return res.status(409).json({message:'This project has not been created on Render yet.'});const serviceId=encodeURIComponent(p.render.serviceId);const service=renderServiceObject(await renderApi(`/services/${serviceId}`));const depData=await renderApi(`/services/${serviceId}/deploys?limit=10`);const list=Array.isArray(depData)?depData.map(renderDeployObject):[];const latest=list[0]||{};p.render.url=service?.serviceDetails?.url||service?.url||p.render.url||'';p.render.status=latest?.status||service?.status||p.render.status||'';p.render.deployId=latest?.id||p.render.deployId||'';p.render.dashboardUrl=`https://dashboard.render.com/${p.render.serviceId}`;p.render.lastSyncAt=new Date();if(p.render.url)p.platformSubdomain=String(p.render.url).replace(/^https?:\/\//,'');if(p.deployments?.length&&latest?.status){const map={live:'live',build_in_progress:'building',update_in_progress:'building',created:'queued',deactivated:'cancelled',build_failed:'failed',canceled:'cancelled'};p.deployments[0].status=map[latest.status]||p.deployments[0].status;p.deployments[0].liveUrl=p.render.url||p.deployments[0].liveUrl;}p.status=latest?.status==='live'?'live':['build_failed','canceled','deactivated'].includes(latest?.status)?'failed':'deploying';let customDomains=[];try{customDomains=syncRenderCustomDomains(p,await renderApi(`/services/${serviceId}/custom-domains`));}catch(error){console.warn('Render custom-domain sync warning:',error.message);}await p.save();res.json({message:'Render status synchronized.',project:publicHostingProject(p),renderDeploys:list,customDomains});}catch(e){res.status(e.status||500).json({message:e.message});}});
app.post('/api/hosting/projects/:id/domains',auth,async(req,res)=>{try{
  const p=await HostingProject.findOne({_id:req.params.id,user:req.user.id});
  if(!p)return res.status(404).json({message:'Project not found'});
  if(!p.render?.serviceId)return res.status(409).json({message:'Deploy this project to Render before attaching a custom domain.'});
  const subscription=await HostingSubscription.findOne({project:p._id,status:'active',currentPeriodEnd:{$gt:new Date()}}).sort({createdAt:-1});
  if(!subscription)return res.status(402).json({message:'An active hosting plan is required before attaching a custom domain.'});
  if(subscription.planCode==='free'&&clean(process.env.HOSTING_FREE_CUSTOM_DOMAIN).toLowerCase()!=='true')return res.status(403).json({message:'Custom domains require a paid hosting plan.'});
  const domain=normalizeHostedDomain(req.body.domain);
  const serviceId=encodeURIComponent(p.render.serviceId);
  let target=renderServiceHostname(p);
  if(!target.endsWith('.onrender.com')){const service=renderServiceObject(await renderApi(`/services/${serviceId}`));p.render.url=service?.serviceDetails?.url||service?.url||p.render.url||'';target=renderServiceHostname(p);if(p.render.url)p.platformSubdomain=target;}
  if(!target){const error=new Error('Render did not return the service hostname. Sync the project and try again.');error.status=502;throw error;}
  const created=await renderApi(`/services/${serviceId}/custom-domains`,{method:'POST',body:{name:domain}});
  let domains=renderCustomDomainList(created);
  if(!domains.length)domains=renderCustomDomainList(await renderApi(`/services/${serviceId}/custom-domains`));
  syncRenderCustomDomains(p,domains);
  await p.save();
  const item=domains.find(entry=>entry.name===domain)||domains[0]||{name:domain};
  res.status(201).json({message:'Domain added to Render. Add the DNS records, remove any AAAA records, then select Verify.',project:publicHostingProject(p),customDomain:item,dns:renderDnsInstructions(item,target)});
}catch(e){res.status(e.status||500).json({message:e.message});}});
app.post('/api/hosting/projects/:id/domains/:domain/verify',auth,async(req,res)=>{try{
  const p=await HostingProject.findOne({_id:req.params.id,user:req.user.id});
  if(!p)return res.status(404).json({message:'Project not found'});
  if(!p.render?.serviceId)return res.status(409).json({message:'This project has not been created on Render yet.'});
  const domain=normalizeHostedDomain(req.params.domain);
  const saved=(p.customDomains||[]).find(item=>item.domain===domain);
  const identifier=encodeURIComponent(saved?.providerId||domain);
  const serviceId=encodeURIComponent(p.render.serviceId);
  await renderApi(`/services/${serviceId}/custom-domains/${identifier}/verify`,{method:'POST'});
  const domains=syncRenderCustomDomains(p,await renderApi(`/services/${serviceId}/custom-domains`));
  await p.save();
  const item=domains.find(entry=>entry.name===domain)||{};
  res.json({message:item.verificationStatus==='verified'?'Domain verified. Render will issue and renew TLS automatically.':'Verification requested. DNS propagation can take time; try Verify again shortly.',customDomain:item,project:publicHostingProject(p)});
}catch(e){res.status(e.status||500).json({message:e.message});}});
app.delete('/api/hosting/projects/:id/domains/:domain',auth,async(req,res)=>{try{
  const p=await HostingProject.findOne({_id:req.params.id,user:req.user.id});
  if(!p)return res.status(404).json({message:'Project not found'});
  if(!p.render?.serviceId)return res.status(409).json({message:'This project has not been created on Render yet.'});
  const domain=normalizeHostedDomain(req.params.domain);
  const saved=(p.customDomains||[]).find(item=>item.domain===domain);
  await renderApi(`/services/${encodeURIComponent(p.render.serviceId)}/custom-domains/${encodeURIComponent(saved?.providerId||domain)}`,{method:'DELETE'});
  p.customDomains=p.customDomains.filter(item=>item.domain!==domain);
  if(p.customDomains.length&&!p.customDomains.some(item=>item.isPrimary))p.customDomains[0].isPrimary=true;
  await p.save();
  res.json({message:'Custom domain removed from Render.',project:publicHostingProject(p)});
}catch(e){res.status(e.status||500).json({message:e.message});}});
app.delete('/api/hosting/projects/:id',auth,async(req,res)=>{try{const p=await HostingProject.findOne({_id:req.params.id,user:req.user.id});if(!p)return res.status(404).json({message:'Project not found'});if(p.render?.serviceId){try{await renderApi(`/services/${encodeURIComponent(p.render.serviceId)}`,{method:'DELETE'});}catch(error){if(error.status!==404)throw error;}}await Promise.all([HostingProject.deleteOne({_id:p._id}),HostingSubscription.deleteMany({project:p._id})]);res.json({message:'Project and its Render service were deleted.'});}catch(e){res.status(e.status||500).json({message:e.message||'Project could not be deleted.'});}});

const hostingRoutes = require('./routes/hostingRoutes');
app.use('/api/hosting', hostingRoutes({ auth, clean, encrypt: encryptEnvironmentValue, publicHostingProject, getUser: (id) => User.findById(id) }));


app.get('/api/system/maintenance', async (_req,res)=>res.json(await maintenanceState()));
app.get('/api/admin/maintenance',auth,requireAdmin,async(_req,res)=>res.json(await maintenanceState()));
app.put('/api/admin/maintenance',auth,requireAdmin,async(req,res)=>{const value={enabled:Boolean(req.body.enabled),message:clean(req.body.message)||'We are performing scheduled maintenance. Please try again shortly.',allowStaff:req.body.allowStaff!==false};await SystemSetting.findOneAndUpdate({key:'maintenance'},{value,updatedBy:req.user.email},{upsert:true,new:true});res.json({message:'Maintenance settings updated.',...value});});


// Unified wallet compatibility routes used by the professional wallet pages.
app.get('/api/wallet', auth, async (req,res)=>{try{
  const {wallet,walletType}=await roleWallet(req);
  const balances=walletBalancesObject(wallet);
  res.json({available_balance:walletAmount(wallet,wallet.currency),balance:walletAmount(wallet,wallet.currency),currency:wallet.currency,balances,ngn_balance:Number(balances.NGN||0),usd_balance:Number(balances.USD||0),balance_updated_at:wallet.updatedAt,user:{name:req.user.name,email:req.user.email,role:req.user.role},walletType,platformFeeRate:req.user.role==='admin'?0:USER_PLATFORM_FEE_RATE,platformFeePercent:req.user.role==='admin'?0:USER_PLATFORM_FEE_RATE*100});
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
  res.json({role:req.user.role,walletType,currency:wallet.currency,balance:walletAmount(wallet,wallet.currency),ngnBalance:Number(balances.NGN||0),usdBalance:Number(balances.USD||0),balances,dedicatedAccount:walletType==='user'?wallet.dedicatedAccount:null,operations:operations.map(publicBankOperation),platformFeePercent:req.user.role==='admin'?0:USER_PLATFORM_FEE_RATE*100});
}catch(e){res.status(e.status||500).json({message:e.message});}});

app.get('/api/wallet/banking/banks', auth, async (req,res)=>{try{
  const currency=clean(req.query.currency||'NGN').toUpperCase(); const country=currency==='GHS'?'ghana':currency==='ZAR'?'south africa':currency==='KES'?'kenya':'nigeria';
  const data=await paystackRequest(`/bank?country=${encodeURIComponent(country)}&currency=${encodeURIComponent(currency)}&perPage=100`,{method:'GET'}); res.json(data.data||[]);
}catch(e){res.status(e.status||502).json({message:e.message});}});

app.get('/api/wallet/banking/resolve-account', auth, async (req,res)=>{try{
  const accountNumber=clean(req.query.accountNumber),bankCode=clean(req.query.bankCode); if(!/^\d{6,20}$/.test(accountNumber)||!bankCode)return res.status(400).json({message:'Valid account number and bank are required.'});
  const data=await paystackRequest(`/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`,{method:'GET'}); res.json(data.data);
}catch(e){res.status(e.status||502).json({message:e.message});}});

app.post('/api/wallet/banking/transfer', auth, async (req,res)=>{try{
  const amount=Number(req.body.amount||0),currency=clean(req.body.currency||'NGN').toUpperCase(),bankCode=clean(req.body.bankCode),accountNumber=clean(req.body.accountNumber),accountName=clean(req.body.accountName),reason=clean(req.body.reason||'World Net Hosting wallet transfer');
  if(!Number.isFinite(amount)||amount<100)return res.status(400).json({message:'Minimum bank transfer is 100.'}); if(!bankCode||!/^\d{6,20}$/.test(accountNumber)||!accountName)return res.status(400).json({message:'Verified bank details are required.'});
  const {wallet,walletType}=await roleWallet(req); const fee=bankFeeForRole(amount,req.user.role),totalDebit=Number((amount+fee).toFixed(2)); if(walletAmount(wallet,currency)<totalDebit)return res.status(400).json({message:`Insufficient ${currency} wallet balance. Transfer and fee require ${totalDebit.toFixed(2)} ${currency}.`});
  const recipientType=currency==='NGN'?'nuban':currency==='GHS'?'ghipss':currency==='KES'?'kepss':currency==='ZAR'?'basa':''; if(!recipientType)return res.status(400).json({message:`Paystack bank transfer is not configured for ${currency}.`});
  const recipientPayload=await paystackRequest('/transferrecipient',{method:'POST',body:JSON.stringify({type:recipientType,name:accountName,account_number:accountNumber,bank_code:bankCode,currency})}); const recipientCode=clean(recipientPayload.data?.recipient_code); if(!recipientCode)throw Object.assign(new Error('Paystack did not return a recipient code.'),{status:502});
  const reference=`wnh-${Date.now()}-${crypto.randomBytes(5).toString('hex')}`; changeWalletAmount(wallet,currency,-totalDebit); wallet.transactions.push({type:'debit',amount:totalDebit,currency,reference,description:`Bank transfer ${amount.toFixed(2)} + ${fee.toFixed(2)} fee`,status:'pending'}); await wallet.save();
  let operation=await BankOperation.create({owner:req.user.id,ownerEmail:req.user.email,ownerRole:req.user.role,walletType,type:'bank_transfer',amount,fee,totalDebit,currency,bankCode,accountName,accountNumberMasked:maskAccountNumber(accountNumber),recipientCode,providerReference:reference,status:'pending',description:reason});
  try{const transfer=await paystackRequest('/transfer',{method:'POST',body:JSON.stringify({source:'balance',amount:Math.round(amount*100),recipient:recipientCode,reference,reason,currency})});operation.status=clean(transfer.data?.status||'processing');operation.providerTransferCode=clean(transfer.data?.transfer_code);operation.providerMessage=clean(transfer.message);operation.metadata={providerId:transfer.data?.id};await operation.save();res.status(201).json({message:'Bank transfer submitted to Paystack.',operation:publicBankOperation(operation)});}catch(e){changeWalletAmount(wallet,currency,totalDebit);wallet.transactions.push({type:'credit',amount:totalDebit,currency,reference:`REFUND-${reference}`,description:'Bank transfer initialization refund',status:'completed'});await wallet.save();operation.status='failed';operation.providerMessage=e.message;operation.metadata={refunded:true};await operation.save();throw e;}
}catch(e){res.status(e.status||502).json({message:e.message,provider:e.payload});}});

app.post('/api/wallet/banking/receive-account', auth, async (req,res)=>{try{
  if(req.user.role==='admin')return res.status(400).json({message:'Admin receives through the Paystack business settlement account. Dedicated user accounts are for user and staff wallets.'});
  const user=await User.findById(req.user.id),wallet=await getOrCreateWallet(user); if(wallet.dedicatedAccount?.active&&wallet.dedicatedAccount?.accountNumber)return res.json({message:'Receive account already active.',dedicatedAccount:wallet.dedicatedAccount});
  if(!user.phone||!user.name)return res.status(400).json({message:'Add your full name and phone number before requesting a receive account.'});
  let customerCode=wallet.paystackCustomerCode;
  if(!customerCode){const parts=user.name.trim().split(/\s+/);const customer=await paystackRequest('/customer',{method:'POST',body:JSON.stringify({email:user.email,first_name:parts[0]||user.name,last_name:parts.slice(1).join(' ')||parts[0]||user.name,phone:user.phone})});customerCode=clean(customer.data?.customer_code);wallet.paystackCustomerCode=customerCode;await wallet.save();}
  const preferredBank=clean(req.body.preferredBank||process.env.PAYSTACK_DVA_PREFERRED_BANK||''); const body={customer:customerCode};if(preferredBank)body.preferred_bank=preferredBank;
  const dva=await paystackRequest('/dedicated_account',{method:'POST',body:JSON.stringify(body)}); const d=dva.data||{};wallet.dedicatedAccount={accountNumber:clean(d.account_number),accountName:clean(d.account_name),bankName:clean(d.bank?.name||d.bank_name),bankSlug:clean(d.bank?.slug||preferredBank),currency:clean(d.currency||'NGN'),active:Boolean(d.active!==false&&d.account_number)};await wallet.save();res.status(201).json({message:'Dedicated receive account created.',dedicatedAccount:wallet.dedicatedAccount});
}catch(e){res.status(e.status||502).json({message:e.message,provider:e.payload});}});

app.post('/api/wallet/banking/convert', auth, async (req,res)=>{try{
  const amount=Number(req.body.amount||0),from=clean(req.body.fromCurrency||'NGN').toUpperCase(),to=clean(req.body.toCurrency||'USD').toUpperCase(); if(!Number.isFinite(amount)||amount<=0||from===to)return res.status(400).json({message:'Enter an amount and two different currencies.'});
  const {wallet,walletType}=await roleWallet(req);const fee=bankFeeForRole(amount,req.user.role),totalDebit=Number((amount+fee).toFixed(2));if(walletAmount(wallet,from)<totalDebit)return res.status(400).json({message:`Insufficient ${from} balance. Conversion and fee require ${totalDebit.toFixed(2)} ${from}.`});
  const rate=await resolveRate(from,to),converted=Number((amount*rate).toFixed(2));changeWalletAmount(wallet,from,-totalDebit);changeWalletAmount(wallet,to,converted);wallet.transactions.push({type:'debit',amount:totalDebit,currency:from,reference:`CONVERT-${Date.now()}`,description:`Converted ${amount} ${from} to ${converted} ${to}; fee ${fee} ${from}`,status:'completed'});wallet.transactions.push({type:'credit',amount:converted,currency:to,reference:`CONVERT-${Date.now()}`,description:`Currency conversion from ${from}`,status:'completed'});await wallet.save();
  const operation=await BankOperation.create({owner:req.user.id,ownerEmail:req.user.email,ownerRole:req.user.role,walletType,type:'currency_convert',amount,fee,totalDebit,currency:from,sourceCurrency:from,targetCurrency:to,exchangeRate:rate,convertedAmount:converted,status:'success',description:'Internal wallet currency conversion'});res.status(201).json({message:'Wallet currency converted successfully.',operation:publicBankOperation(operation),balances:walletBalancesObject(wallet)});
}catch(e){res.status(e.status||502).json({message:e.message});}});

app.get('/api/admin/bank-operations',auth,requireAdmin,async(_req,res)=>res.json((await BankOperation.find().sort({createdAt:-1}).limit(200)).map(publicBankOperation)));
app.get('/api/staff/bank-operations',auth,requireStaffPermission('wallet.manage'),async(_req,res)=>res.json((await BankOperation.find().sort({createdAt:-1}).limit(200)).map(publicBankOperation)));

app.get('/api/wallet/withdrawals',auth,async(req,res)=>{try{
  const operations=await BankOperation.find({owner:req.user.id,type:'bank_transfer'}).sort({createdAt:-1}).limit(100);
  res.json(operations.map(publicBankOperation));
}catch(e){res.status(e.status||500).json({message:e.message});}});

// Backward-compatible direct withdrawal endpoint. A withdrawal is a real Paystack bank transfer,
// not an approval request. The 4% platform fee applies to non-admin wallets; admin transfers have no fee.
app.post('/api/wallet/withdrawals',auth,async(req,res)=>{try{
  const amount=Number(req.body.amount||0),currency=clean(req.body.currency||'NGN').toUpperCase(),bankCode=clean(req.body.bankCode),accountNumber=clean(req.body.accountNumber).replace(/\D/g,''),accountName=clean(req.body.accountName),reason=clean(req.body.note||req.body.reason||'World Net Hosting wallet withdrawal');
  if(!Number.isFinite(amount)||amount<100)return res.status(400).json({message:'Minimum bank withdrawal is 100.'});
  if(!bankCode||!/^\d{6,20}$/.test(accountNumber)||!accountName)return res.status(400).json({message:'Select a bank and verify the account before withdrawing.'});
  const {wallet,walletType}=await roleWallet(req);const fee=bankFeeForRole(amount,req.user.role),totalDebit=Number((amount+fee).toFixed(2));
  if(walletAmount(wallet,currency)<totalDebit)return res.status(400).json({message:`Insufficient ${currency} wallet balance. Withdrawal and fee require ${totalDebit.toFixed(2)} ${currency}.`});
  const recipientType=currency==='NGN'?'nuban':currency==='GHS'?'ghipss':currency==='KES'?'kepss':currency==='ZAR'?'basa':'';
  if(!recipientType)return res.status(400).json({message:`Paystack bank withdrawal is not available for ${currency}.`});
  const recipientPayload=await paystackRequest('/transferrecipient',{method:'POST',body:JSON.stringify({type:recipientType,name:accountName,account_number:accountNumber,bank_code:bankCode,currency})});
  const recipientCode=clean(recipientPayload.data?.recipient_code);if(!recipientCode)throw Object.assign(new Error('Paystack did not return a recipient code.'),{status:502});
  const reference=`WDR-${Date.now()}-${crypto.randomBytes(5).toString('hex')}`;
  changeWalletAmount(wallet,currency,-totalDebit);wallet.transactions.push({type:'debit',amount:totalDebit,currency,reference,description:`Bank withdrawal ${amount.toFixed(2)} + ${fee.toFixed(2)} fee`,status:'pending'});await wallet.save();
  const operation=await BankOperation.create({owner:req.user.id,ownerEmail:req.user.email,ownerRole:req.user.role,walletType,type:'bank_transfer',amount,fee,totalDebit,currency,bankCode,accountName,accountNumberMasked:maskAccountNumber(accountNumber),recipientCode,providerReference:reference,status:'pending',description:reason});
  try{
    const transfer=await paystackRequest('/transfer',{method:'POST',body:JSON.stringify({source:'balance',amount:Math.round(amount*100),recipient:recipientCode,reference,reason,currency})});
    operation.status=clean(transfer.data?.status||'processing');operation.providerTransferCode=clean(transfer.data?.transfer_code);operation.providerMessage=clean(transfer.message);operation.metadata={providerId:transfer.data?.id};await operation.save();
    res.status(201).json({message:'Withdrawal sent securely through Paystack.',operation:publicBankOperation(operation),fee,totalDebit,currency});
  }catch(e){
    changeWalletAmount(wallet,currency,totalDebit);wallet.transactions.push({type:'credit',amount:totalDebit,currency,reference:`REFUND-${reference}`,description:'Failed withdrawal automatically refunded',status:'completed'});await wallet.save();
    operation.status='failed';operation.providerMessage=e.message;operation.metadata={refunded:true};await operation.save();throw e;
  }
}catch(e){res.status(e.status||502).json({message:e.message,provider:e.payload});}});

app.post('/api/admin/system-wallet/withdrawals',auth,requireAdmin,async(req,res)=>{
  // Keep the admin route for existing dashboard code, but execute a real provider transfer immediately.
  req.body.currency=req.body.currency||'NGN';
  const amount=Number(req.body.amount||0),currency=clean(req.body.currency).toUpperCase(),bankCode=clean(req.body.bankCode),accountNumber=clean(req.body.accountNumber).replace(/\D/g,''),accountName=clean(req.body.accountName),reason=clean(req.body.note||'WNH system wallet withdrawal');
  try{
    if(!Number.isFinite(amount)||amount<100||!bankCode||!/^\d{6,20}$/.test(accountNumber)||!accountName)return res.status(400).json({message:'Select a bank and verify the account before withdrawing.'});
    const wallet=await getSystemWallet();if(walletAmount(wallet,currency)<amount)return res.status(400).json({message:'Insufficient system wallet balance.'});
    const recipientType=currency==='NGN'?'nuban':currency==='GHS'?'ghipss':currency==='KES'?'kepss':currency==='ZAR'?'basa':'';if(!recipientType)return res.status(400).json({message:`Paystack bank withdrawal is not available for ${currency}.`});
    const recipientPayload=await paystackRequest('/transferrecipient',{method:'POST',body:JSON.stringify({type:recipientType,name:accountName,account_number:accountNumber,bank_code:bankCode,currency})});const recipientCode=clean(recipientPayload.data?.recipient_code);if(!recipientCode)throw Object.assign(new Error('Paystack did not return a recipient code.'),{status:502});
    const reference=`SYS-WDR-${Date.now()}-${crypto.randomBytes(5).toString('hex')}`;changeWalletAmount(wallet,currency,-amount);wallet.transactions.push({type:'debit',amount,currency,reference,description:'Admin system wallet bank withdrawal',status:'pending'});await wallet.save();
    const operation=await BankOperation.create({owner:req.user.id,ownerEmail:req.user.email,ownerRole:'admin',walletType:'system',type:'bank_transfer',amount,fee:0,totalDebit:amount,currency,bankCode,accountName,accountNumberMasked:maskAccountNumber(accountNumber),recipientCode,providerReference:reference,status:'pending',description:reason});
    try{const transfer=await paystackRequest('/transfer',{method:'POST',body:JSON.stringify({source:'balance',amount:Math.round(amount*100),recipient:recipientCode,reference,reason,currency})});operation.status=clean(transfer.data?.status||'processing');operation.providerTransferCode=clean(transfer.data?.transfer_code);operation.providerMessage=clean(transfer.message);operation.metadata={providerId:transfer.data?.id};await operation.save();res.status(201).json({message:'System wallet withdrawal sent through Paystack.',operation:publicBankOperation(operation)});}catch(e){changeWalletAmount(wallet,currency,amount);wallet.transactions.push({type:'credit',amount,currency,reference:`REFUND-${reference}`,description:'Failed system withdrawal automatically refunded',status:'completed'});await wallet.save();operation.status='failed';operation.providerMessage=e.message;operation.metadata={refunded:true};await operation.save();throw e;}
  }catch(e){res.status(e.status||502).json({message:e.message,provider:e.payload});}
});

app.get('/api/admin/system-wallet',auth,requireAdmin,async(_req,res)=>res.json(await getSystemWallet()));
app.post('/api/admin/system-wallet/adjust',auth,requireAdmin,async(req,res)=>{const amount=Number(req.body.amount||0),type=clean(req.body.type);if(!amount||!['credit','debit'].includes(type))return res.status(400).json({message:'Valid amount and credit/debit type are required.'});const wallet=await getSystemWallet();if(type==='debit'&&wallet.balance<amount)return res.status(400).json({message:'Insufficient system wallet balance.'});wallet.balance=Number(wallet.balance||0)+(type==='credit'?amount:-amount);wallet.transactions.push({type,amount,currency:wallet.currency,reference:`ADMIN-${Date.now()}`,description:clean(req.body.description)||`Admin ${type}`,status:'completed'});await wallet.save();res.json({message:'System wallet updated.',wallet});});
app.get('/api/admin/users',auth,requireAdmin,async(_req,res)=>res.json(await User.find().select('-passwordHash -pinHash').sort({createdAt:-1})));
app.patch('/api/admin/users/:id',auth,requireAdmin,async(req,res)=>{const update={};if(req.body.role&&['user','staff','admin'].includes(req.body.role))update.role=req.body.role;if(Array.isArray(req.body.staffPermissions))update.staffPermissions=req.body.staffPermissions;if(req.body.active!==undefined)update.active=Boolean(req.body.active);const user=await User.findByIdAndUpdate(req.params.id,update,{new:true}).select('-passwordHash -pinHash');if(!user)return res.status(404).json({message:'User not found'});res.json({message:'User access updated.',user});});
app.get('/api/staff/messages',auth,requireStaffPermission('support.manage'),async(_req,res)=>res.json((await Message.find().sort({updatedAt:-1})).map(publicMessage)));
app.post('/api/staff/messages/:id/reply',auth,requireStaffPermission('support.manage'),async(req,res)=>{const body=clean(req.body.body);if(!body)return res.status(400).json({message:'Reply body is required'});const existing=await Message.findById(req.params.id);if(!existing)return res.status(404).json({message:'Conversation not found'});let localBody=body;if(existing.language&&existing.language!=='en'){try{localBody=await translateText(body,existing.language)}catch{}}existing.replies.push({body,englishBody:body,localBody,language:existing.language||'en',repliedBy:req.user.email,createdAt:new Date()});existing.status='replied';await existing.save();res.json({message:'Reply saved in English and customer language.',item:publicMessage(existing)});});
app.patch('/api/staff/messages/:id/status',auth,requireStaffPermission('support.manage'),async(req,res)=>{const allowed=['new','open','replied','closed'];const status=clean(req.body.status);if(!allowed.includes(status))return res.status(400).json({message:'Invalid status'});const item=await Message.findByIdAndUpdate(req.params.id,{status},{new:true});if(!item)return res.status(404).json({message:'Conversation not found'});res.json({message:'Status updated.',item});});

app.get('/api/admin/stats', auth, requireAdmin, async (req, res) => {
  const [orders, messages, users, domainSearches, openChats, wallets] = await Promise.all([Order.find(), Message.countDocuments(), User.countDocuments(), DomainSearch.countDocuments(), Message.countDocuments({ status: { $in: ['new', 'open'] } }), Wallet.find()]);
  const revenue = orders.filter(o => o.status === 'paid').reduce((sum, order) => sum + Number(order.total || 0), 0);
  const pendingRevenue = orders.filter(o => o.status !== 'paid').reduce((sum, order) => sum + Number(order.total || 0), 0);
  const walletBalance = wallets.reduce((sum, wallet) => sum + Number(wallet.balance || 0), 0);
  res.json({ orders: orders.length, messages, users, domainSearches, openChats, revenue: revenue.toFixed(2), pendingRevenue: pendingRevenue.toFixed(2), walletBalance: walletBalance.toFixed(2), domainApiConfigured: domainApiConfigured(), paystackConfigured: paystackConfigured(), supportedPaystackCurrencies: supportedPaystackCurrencies() });
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

app.use((err, req, res, next) => { console.error(err); res.status(err.status || 500).json({ message: err.message || 'Server error' }); });

app.get('/', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));
app.use('/api', (req, res) => res.status(404).json({ message: 'World Net Hosting API route not found' }));
app.use((req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

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

module.exports = { app, startServer };
