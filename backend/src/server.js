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
const multer = require('multer');

const app = express();
app.set('trust proxy', 1);
const chatUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 3 * 1024 * 1024, files: 1 }, fileFilter(_req,file,cb){ const allowed=/^(image\/(png|jpeg|gif|webp)|application\/(pdf|msword|vnd\.openxmlformats-officedocument\.wordprocessingml\.document)|text\/plain)$/i; cb(allowed.test(file.mimetype)?null:new Error('Unsupported chat attachment type.'), allowed.test(file.mimetype)); } });
const PLACEHOLDER_RE = /your_|replace_|example\.com|your-domain|xxxxxxxxx|change_this/i;
const clean = (v = '') => String(v || '').trim();
const firstEnv = (...names) => { for (const name of names) { const value = clean(process.env[name]); if (value) return value; } return ''; };
const PAYSTACK_PUBLIC_KEY = firstEnv('PAYSTACK_PUBLIC_KEY','PAYSTACK_PUBLIC');
const PAYSTACK_SECRET_KEY = firstEnv('PAYSTACK_SECRET_KEY','PAYSTACK_SECRET');
const DOMAIN_RESELLER_ID = firstEnv('DOMAIN_RESELLER_ID','DOMAIN_NAME_API_RESELLER_ID','DOMAIN_API_RESELLER_ID');
const DOMAIN_API_KEY = firstEnv('DOMAIN_API_KEY','DOMAIN_NAME_API_KEY','DOMAIN_RESELLER_API_KEY');
const validEmailAddress = (v = '') => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean(v)) && clean(v).length <= 254;
const isRealValue = (v) => Boolean(clean(v)) && !PLACEHOLDER_RE.test(clean(v));
const PORT = Number(process.env.PORT || 10000);
const USER_PLATFORM_FEE_RATE = Math.max(0, Number(process.env.USER_PLATFORM_FEE_RATE || 0.04));
const BANKING_API_TRANSACTION_FEE_RATE = Math.max(0, Number(process.env.BANKING_API_TRANSACTION_FEE_RATE || 0.04));
const addUserFee = (amount) => Number((Number(amount || 0) * (1 + USER_PLATFORM_FEE_RATE)).toFixed(2));
const feePart = (amount) => Number((Number(amount || 0) * USER_PLATFORM_FEE_RATE).toFixed(2));
const domainCustomerMarkupUSD = () => { const value = Number(process.env.DOMAIN_CUSTOMER_MARKUP_USD || 8); return Number.isFinite(value) && value >= 0 ? value : 8; };
const bankFeeForRole = (amount, role) => feePart(amount);
const PAYSTACK_BASE_URL = 'https://api.paystack.co';
const paystackKeyMode = () => {
  const publicKey = PAYSTACK_PUBLIC_KEY;
  const secretKey = PAYSTACK_SECRET_KEY;
  if (publicKey.startsWith('pk_live_') && secretKey.startsWith('sk_live_')) return 'live';
  if (publicKey.startsWith('pk_test_') && secretKey.startsWith('sk_test_')) return 'test';
  return publicKey || secretKey ? 'mixed-or-invalid' : 'missing';
};
const PAYSTACK_REQUIRE_LIVE = clean(process.env.PAYSTACK_REQUIRE_LIVE).toLowerCase() === 'true';
const JWT_SECRET = clean(process.env.JWT_SECRET);
if (!JWT_SECRET || JWT_SECRET.length < 32) throw new Error('JWT_SECRET must be configured with at least 32 characters.');
if (process.env.NODE_ENV === 'production' && PAYSTACK_REQUIRE_LIVE && paystackKeyMode() !== 'live') {
  console.warn('Paystack live keys are not configured yet. The backend will stay online, but payment endpoints will remain unavailable until matching live keys are configured.');
}
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const normalizeOrigin = (value = '') => String(value || '').trim().replace(/\/+$/, '');
const configuredOrigins = `${process.env.FRONTEND_URL || ''},${process.env.FRONTEND_ORIGINS || ''}`.split(',').map(normalizeOrigin).filter(Boolean);
const localDevelopmentOrigins = ['http://localhost:5173','http://127.0.0.1:5173','http://localhost:4173','http://127.0.0.1:4173','http://localhost:5500','http://127.0.0.1:5500'];
const allowedOrigins = [...new Set([...(configuredOrigins.length ? configuredOrigins : []), ...(process.env.NODE_ENV === 'production' ? [] : localDevelopmentOrigins)])];
const allowRenderOrigins = clean(process.env.CORS_ALLOW_RENDER_ORIGINS || 'true').toLowerCase() !== 'false';
const isAllowedRenderOrigin = origin => {
  try { const url = new URL(origin); return url.protocol === 'https:' && url.hostname.endsWith('.onrender.com'); }
  catch (_) { return false; }
};
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
    if (!origin || !allowedOrigins.length || allowedOrigins.includes('*') || allowedOrigins.includes(normalizedOrigin) || (allowRenderOrigins && isAllowedRenderOrigin(normalizedOrigin))) return cb(null, true);
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
app.get('/api/connection-check', (req,res) => res.json({
  ok:true,
  service:'world-net-hosting-backend',
  origin:req.get('origin')||null,
  corsAllowed:true,
  domainApiConfigured:domainApiConfigured(),
  timestamp:new Date().toISOString()
}));

async function paystackRequest(pathname, options = {}) {
  if (!isRealValue(PAYSTACK_SECRET_KEY)) {
    const error = new Error('Paystack secret key is not configured.'); error.status = 503; throw error;
  }
  const response = await fetch(`${PAYSTACK_BASE_URL}${pathname}`, {
    ...options,
    signal: options.signal || AbortSignal.timeout(30000),
    headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`, 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.status === false) {
    const error = new Error(payload.message || `Paystack request failed (${response.status})`); error.status = response.status || 502; error.payload = payload; throw error;
  }
  return payload;
}

function paystackTestMode(){ return paystackKeyMode()==='test'; }
async function ensurePaystackCustomerAndDedicatedAccount(user, wallet, { consent=false, preferredBank='' }={}) {
  if (!user || !wallet) { const error=new Error('User wallet could not be prepared.'); error.status=404; throw error; }
  if (wallet.dedicatedAccount?.active && wallet.dedicatedAccount?.accountNumber) return wallet.dedicatedAccount;
  if (!consent && !wallet.dedicatedAccount?.consentAt) { const error=new Error('Confirm consent before assigning a receiving account.'); error.status=400; throw error; }
  if (!user.phone || !user.name) { const error=new Error('Add your full name and phone number before requesting a receiving account.'); error.status=400; throw error; }
  if (consent && !wallet.dedicatedAccount?.consentAt) wallet.dedicatedAccount.consentAt = new Date();
  let customerCode=clean(wallet.paystackCustomerCode);
  if (!customerCode) {
    const parts=clean(user.name).split(/\s+/).filter(Boolean);
    const customer=await paystackRequest('/customer',{method:'POST',body:JSON.stringify({email:user.email,first_name:parts[0]||user.name,last_name:parts.slice(1).join(' ')||parts[0]||user.name,phone:user.phone})});
    customerCode=clean(customer.data?.customer_code);
    if (!customerCode) { const error=new Error('Paystack did not return a customer code.'); error.status=502; throw error; }
    wallet.paystackCustomerCode=customerCode;
  }
  const bank=clean(preferredBank || process.env.PAYSTACK_DVA_PREFERRED_BANK || (paystackTestMode()?'test-bank':''));
  const body={customer:customerCode}; if(bank) body.preferred_bank=bank;
  wallet.dedicatedAccount.assignmentStatus='pending'; wallet.dedicatedAccount.assignmentMessage='Account assignment requested from Paystack.'; await wallet.save();
  try {
    const dva=await paystackRequest('/dedicated_account',{method:'POST',body:JSON.stringify(body)}); const d=dva.data||{};
    wallet.dedicatedAccount={provider:'paystack',providerAccountId:clean(d.id),accountNumber:clean(d.account_number),accountName:clean(d.account_name),bankName:clean(d.bank?.name||d.bank_name),bankSlug:clean(d.bank?.slug||bank),currency:clean(d.currency||'NGN'),assignmentStatus:d.account_number?'active':'pending',assignmentMessage:clean(dva.message||'Dedicated account assignment is processing.'),consentAt:wallet.dedicatedAccount?.consentAt||new Date(),assignedAt:d.account_number?new Date():null,active:Boolean(d.active!==false&&d.account_number)};
    await wallet.save(); return wallet.dedicatedAccount;
  } catch(error) {
    wallet.dedicatedAccount.assignmentStatus='failed'; wallet.dedicatedAccount.assignmentMessage=clean(error.message); await wallet.save(); throw error;
  }
}
function queueDedicatedAccountAssignment(user, wallet){
  if(clean(process.env.PAYSTACK_AUTO_ASSIGN_DVA_ON_SIGNUP).toLowerCase()!=='true') return;
  setImmediate(()=>ensurePaystackCustomerAndDedicatedAccount(user,wallet,{consent:true}).catch(error=>console.warn(`Automatic DVA assignment skipped for ${user.email}: ${error.message}`)));
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

async function settleResellerApiPayment(data) {
  const reference = clean(data?.reference);
  const metadata = data?.metadata || {};
  if (!reference || data?.status !== 'success' || metadata.purpose !== 'reseller_api_payment') return { applied:false };
  const payment = await ResellerApiPayment.findOne({ reference });
  if (!payment) return { applied:false, reason:'payment_not_found' };
  if (payment.status === 'success') return { applied:true, duplicate:true, purpose:'reseller_api_payment' };
  const paidAmount = Number(data.amount || 0) / 100;
  const paidCurrency = clean(data.currency || '').toUpperCase();
  if (paidCurrency !== payment.currency || Math.abs(paidAmount - payment.amount) > 0.01) {
    payment.status = 'failed';
    payment.providerStatus = 'amount_or_currency_mismatch';
    payment.metadata = { ...(payment.metadata || {}), paidAmount, paidCurrency };
    await payment.save();
    return { applied:false, reason:'amount_or_currency_mismatch' };
  }
  const reseller = await User.findById(payment.reseller);
  if (!reseller) return { applied:false, reason:'reseller_not_found' };
  const resellerWallet = await getOrCreateWallet(reseller);
  const resellerReference = `RESELLER-PAYMENT-${reference}`;
  const resellerExists = resellerWallet.transactions.some(item => item.reference === resellerReference);
  if (!resellerExists) {
    changeWalletAmount(resellerWallet, payment.currency, payment.resellerNet);
    resellerWallet.transactions.push({ type:'credit', amount:payment.resellerNet, currency:payment.currency, reference:resellerReference, description:`Verified reseller API payment after World Net Hosting transaction fee: ${payment.description || payment.reference}`, status:'completed' });
    await resellerWallet.save();
  }
  const systemWallet = await getSystemWallet();
  const platformReference = `BANKING-API-FEE-${reference}`;
  const platformExists = systemWallet.transactions.some(item => item.reference === platformReference);
  if (!platformExists) {
    systemWallet.balance = Number(systemWallet.balance || 0) + Number(payment.platformFee || 0);
    systemWallet.currency = payment.currency || systemWallet.currency;
    systemWallet.transactions.push({ type:'credit', amount:payment.platformFee, currency:payment.currency, reference:platformReference, description:`World Net Hosting 4% Banking API transaction fee: ${payment.description || payment.reference}`, status:'completed' });
    await systemWallet.save();
  }
  await ResellerProfile.updateOne({ _id:payment.resellerProfile }, { $set:{ lifetimeFreeApiAccess:true, lastActiveBankingTransactionAt:new Date() } });
  payment.status = 'success';
  payment.providerStatus = clean(data.status || 'success');
  payment.settledAt = new Date();
  payment.metadata = { ...(payment.metadata || {}), paystackTransactionId:data.id || null, channel:clean(data.channel), paidAt:data.paid_at || data.paidAt || null };
  await payment.save();
  return { applied:true, purpose:'reseller_api_payment', resellerNet:payment.resellerNet, platformFee:payment.platformFee, platformFeeRate:payment.platformFeeRate };
}

async function applySuccessfulPaystackCharge(data) {
  const reference = clean(data?.reference);
  if (!reference || data?.status !== 'success') return { applied: false };
  const metadata = data.metadata || {};
  if (metadata.purpose === 'reseller_api_payment') return settleResellerApiPayment(data);
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
    if (['dedicatedaccount.assign.success','dedicatedaccount.assign.failed'].includes(event.event)) {
      const data=event.data||{};
      const customerCode=clean(data.customer?.customer_code||data.customer?.code||data.customer_code);
      const wallet=customerCode?await Wallet.findOne({paystackCustomerCode:customerCode}):null;
      if(wallet){
        const failed=event.event.endsWith('.failed');
        wallet.dedicatedAccount.provider='paystack';
        wallet.dedicatedAccount.providerAccountId=clean(data.id||data.dedicated_account_id);
        wallet.dedicatedAccount.accountNumber=clean(data.account_number||wallet.dedicatedAccount.accountNumber);
        wallet.dedicatedAccount.accountName=clean(data.account_name||wallet.dedicatedAccount.accountName);
        wallet.dedicatedAccount.bankName=clean(data.bank?.name||data.bank_name||wallet.dedicatedAccount.bankName);
        wallet.dedicatedAccount.bankSlug=clean(data.bank?.slug||wallet.dedicatedAccount.bankSlug);
        wallet.dedicatedAccount.currency=clean(data.currency||wallet.dedicatedAccount.currency||'NGN');
        wallet.dedicatedAccount.assignmentStatus=failed?'failed':(wallet.dedicatedAccount.accountNumber?'active':'pending');
        wallet.dedicatedAccount.assignmentMessage=clean(data.reason||data.message||(failed?'Paystack account assignment failed.':'Paystack account assignment completed.'));
        wallet.dedicatedAccount.active=!failed&&Boolean(wallet.dedicatedAccount.accountNumber);
        wallet.dedicatedAccount.assignedAt=wallet.dedicatedAccount.active?new Date():null;
        await wallet.save();
      }
    }
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

app.use(express.json({ limit: '1mb' }));
app.use(async (req,res,next)=>{
  try{
    if(process.env.NODE_ENV==='test')return next();
    if(req.path.startsWith('/api/staff')||req.path.startsWith('/api/auth/')||req.path.includes('/webhook')||req.path==='/api/health') return next();
    const state=await maintenanceState();
    if(!state.enabled) return next();
    let role=''; try{const token=(req.headers.authorization||'').replace('Bearer ',''); if(token) role=jwt.verify(token,JWT_SECRET).role||'';}catch{}
    if(state.allowStaff&&role==='staff') return next();
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
  if (!user.role || !['user','staff','reseller'].includes(user.role)) { user.role = ['user','staff','reseller'].includes(raw?.role) ? raw.role : 'user'; changed = true; }
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

async function connectDB() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is missing in the server environment');
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

function requireStaffPermission(permission){return (req,res,next)=>{if(req.user?.role!=='staff')return res.status(403).json({message:'Staff access required'});const permissions=req.user.staffPermissions||[];if(permissions.length&&!permissions.includes(permission)&&!permissions.includes('*'))return res.status(403).json({message:`Staff permission required: ${permission}`});next();};}
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
    const authenticated=actor&&(actor.role==='staff'||String(item.user||'')===String(actor.id||''));
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
const paystackConfigured = () => isRealValue(process.env.PAYSTACK_SECRET_KEY) && isRealValue(process.env.PAYSTACK_PUBLIC_KEY);
const translatorConfigured = () => isRealValue(process.env.AZURE_TRANSLATOR_KEY) && isRealValue(process.env.AZURE_TRANSLATOR_REGION);
const productionReadinessIssues = () => {
  const issues = [];
  if (process.env.NODE_ENV !== 'production') issues.push('NODE_ENV must be production.');
  if (!isRealValue(process.env.MONGODB_URI)) issues.push('MongoDB is not configured.');
  if (!domainApiConfigured() || DOMAIN_API_MODE !== 'live') issues.push('Live Domain Name API is not configured.');
  if (!paystackConfigured() || paystackKeyMode() !== 'live') issues.push('Paystack live keys are required.');
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
      ? 'Domain Name API endpoint was not found. The application uses the official REST gateway; confirm DOMAIN_API_BASE_URL is not overridden with an old value.'
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
    const contacts = ['Registrant', 'Management', 'Tech', 'Billing'].map((type) => ({ ...registrant, contactType: type }));
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
    translatorConfigured: translatorConfigured(),
    staticFrontendServed: true,
    supportedPaystackCurrencies: supportedPaystackCurrencies()
  });
});

function frontendBaseUrl() {
  const configured = String(process.env.FRONTEND_URL || '').split(',').map(x => x.trim()).filter(Boolean);
  const preferred = configured[0] || '';
  return preferred.replace(/\/$/, '');
}
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
    const requestedRole = clean(req.body?.accountType).toLowerCase() === 'reseller' ? 'reseller' : 'user';
    const company = clean(req.body?.company || req.body?.businessName);
    if (requestedRole === 'reseller' && !company) return res.status(400).json({ message: 'Business or company name is required for a reseller account.' });
    const user = await User.create({ name, email, emailAddress: email, phone: clean(req.body?.phone), company, passwordHash: await bcrypt.hash(password, 10), role: requestedRole, active: true });
    if (requestedRole === 'reseller') {
      const requestedProducts = Array.isArray(req.body?.products) ? req.body.products : [req.body?.products];
      const products = requestedProducts.filter(x => ['domain_api','bank_api'].includes(x));
      const enabledProducts=products.length?products:['domain_api'];
      const autoDomainLive=enabledProducts.includes('domain_api') && String(process.env.AUTO_APPROVE_DOMAIN_RESELLERS||'true').toLowerCase()==='true' && domainLiveConfigured();
      const autoBankLive=enabledProducts.includes('bank_api') && String(process.env.AUTO_APPROVE_BANK_RESELLERS||'true').toLowerCase()==='true' && paystackLiveConfigured();
      await ResellerProfile.create({ user:user._id, businessName:company, country:clean(req.body?.country), registrationNumber:clean(req.body?.registrationNumber), website:clean(req.body?.website), useCase:clean(req.body?.useCase), products:enabledProducts, domainApiStatus:autoDomainLive?'live':'sandbox', bankApiStatus:autoBankLive?'live':'sandbox', status:(autoDomainLive||autoBankLive)?'approved':'sandbox_approved' });
    }
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
    const existing = await User.findOne({ email: nextEmail, _id: { $ne: user._id } });
    if (existing) return res.status(409).json({ message: 'That email address is already in use.' });
    user.email = nextEmail;
  }
  if (nextPassword) {
    if (nextPassword.length < 6) return res.status(400).json({ message: 'New password must be at least 6 characters.' });
    user.passwordHash = await bcrypt.hash(nextPassword, 10);
  }
  if (nextPin) {
    if (!/^\d{4,6}$/.test(nextPin)) return res.status(400).json({ message: 'New PIN must be 4–6 numbers.' });
    user.pinHash = await bcrypt.hash(nextPin, 10);
  }
  if (!nextEmail && !nextPassword && !nextPin) return res.status(400).json({ message: 'Enter a new email, password or PIN.' });
  await user.save();
  res.json({ message: 'Account security details updated successfully.', user: toPublicUser(user), token: signToken(user) });
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
    const requestedType=clean(req.body?.accountType).toLowerCase();
    if(requestedType==='reseller' && user.role!=='reseller') return res.status(403).json({success:false,code:'WRONG_PORTAL',message:'This is a normal customer account. Use the user sign-in page.'});
    if(requestedType==='user' && user.role==='reseller') return res.status(403).json({success:false,code:'WRONG_PORTAL',message:'This is a reseller account. Use the reseller sign-in page.'});
    await migrateLegacyAccountAfterSuccessfulLogin(user, found.raw, email, storedHash);
    return res.json({ success:true, message: user.pinHash ? 'Login successful. Enter your PIN.' : 'Login successful. Create your PIN.', token: signToken(user), user: toPublicUser(user), next: user.pinHash ? 'verify-pin' : 'create-pin' });
  } catch (error) { return next(error); }
});


app.get('/api/auth/me', auth, async (req, res) => {
  const user = await User.findById(req.user.id).select('-passwordHash -password -password_hash -pinHash');
  if (!user) return res.status(404).json({ success:false, code:'ACCOUNT_NOT_FOUND', message:'Account not found.' });
  return res.json({ success:true, user:toPublicUser(user) });
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
  res.json({ user, domains, wallet: { balance: wallet.balance, currency: wallet.currency, transactions: wallet.transactions.slice(-10).reverse() }, orders, summary: { orders: orders.length, supportStatus: 'Active', balance: wallet.balance, currency: wallet.currency } });
});


function requireReseller(req,res,next){ if(!['user','reseller'].includes(req.user?.role)) return res.status(403).json({message:'Users Dashboard access is required.'}); next(); }
function makeApiKey(prefix){ return `${prefix}_${crypto.randomBytes(24).toString('hex')}`; }
const apiCredentialFields=(product,environment)=>{
  const prefix=product==='domain'?'domain':'bank';
  const env=environment==='live'?'Live':'Sandbox';
  return {publicField:`${prefix}${env}PublicKey`,secretField:`${prefix}${env}SecretHash`,encryptedField:`${prefix}${env}SecretEncrypted`};
};
const API_CREDENTIAL_CIPHER_KEY=crypto.createHash('sha256').update(clean(process.env.API_CREDENTIAL_ENCRYPTION_KEY||JWT_SECRET)).digest();
function encryptApiCredential(value=''){const iv=crypto.randomBytes(12);const cipher=crypto.createCipheriv('aes-256-gcm',API_CREDENTIAL_CIPHER_KEY,iv);const encrypted=Buffer.concat([cipher.update(String(value),'utf8'),cipher.final()]);const tag=cipher.getAuthTag();return [iv,tag,encrypted].map(part=>part.toString('base64')).join('.');}
function decryptApiCredential(value=''){try{const [iv,tag,encrypted]=String(value||'').split('.').map(part=>Buffer.from(part,'base64'));if(!iv||!tag||!encrypted)return '';const decipher=crypto.createDecipheriv('aes-256-gcm',API_CREDENTIAL_CIPHER_KEY,iv);decipher.setAuthTag(tag);return Buffer.concat([decipher.update(encrypted),decipher.final()]).toString('utf8');}catch{return '';}}
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
function paystackLiveConfigured(){
  const provider=clean(process.env.BANK_API_PROVIDER).toLowerCase();
  const base=clean(process.env.BANK_API_BASE_URL).replace(/\/$/,'');
  const publicKey=clean(process.env.PAYSTACK_PUBLIC_KEY);
  const secretKey=clean(process.env.PAYSTACK_SECRET_KEY);
  return provider==='paystack' && base==='https://api.paystack.co' && String(process.env.BANK_API_LIVE_ENABLED||'false').toLowerCase()==='true' && publicKey.startsWith('pk_live_') && secretKey.startsWith('sk_live_');
}
function domainLiveConfigured(){
  const provider=clean(process.env.DOMAIN_API_PROVIDER||'domainnameapi').toLowerCase();
  return provider==='domainnameapi' && String(process.env.DOMAIN_API_LIVE_ENABLED||'false').toLowerCase()==='true' && domainApiConfigured() && DOMAIN_API_MODE==='live';
}
function liveProductReady(profile,product){
  if(!productEnabled(profile,product)) return false;
  if(product==='domain') return domainLiveConfigured();
  if(product==='bank') return paystackLiveConfigured();
  return false;
}
function publicCredential(profile,product,environment){const f=apiCredentialFields(product,environment);return profile?.[f.publicField]||'';}
app.get('/api/reseller/dashboard', auth, requireReseller, async (req,res)=>{
  const user=await User.findById(req.user.id).select('-passwordHash -pinHash');
  const profile=await ResellerProfile.findOne({user:req.user.id});
  const wallet=await getOrCreateWallet(user);
  const domains=await ManagedDomain.find({user:req.user.id}).sort({createdAt:-1}).limit(20);
  const orders=await Order.find({user:req.user.id}).sort({createdAt:-1}).limit(20);
  const safeProfile=profile?{businessName:profile.businessName,country:profile.country,website:profile.website,products:profile.products,status:profile.status,domainApiStatus:domainLiveConfigured()?'live':profile.domainApiStatus,bankApiStatus:paystackLiveConfigured()?'live':'pending'}:null;
  res.json({user,profile:safeProfile,wallet:{currency:wallet.currency,balance:wallet.balance,balances:walletBalancesObject(wallet),transactions:wallet.transactions.slice(-20).reverse()},domains,orders,domainApi:{mode:domainLiveConfigured()?'live':'sandbox',provider:clean(process.env.DOMAIN_API_PROVIDER||'domainnameapi'),baseUrl:clean(process.env.DOMAIN_API_BASE_URL||'https://api.domainresellerapi.com/api/v1'),liveEnabled:domainLiveConfigured()},bankApi:{mode:paystackLiveConfigured()?'live':'sandbox',provider:clean(process.env.BANK_API_PROVIDER||'paystack'),baseUrl:clean(process.env.BANK_API_BASE_URL||'https://api.paystack.co'),liveEnabled:paystackLiveConfigured()},apiBase:`${String(process.env.BACKEND_URL||'').replace(/\/$/,'')}/api/v1`,summary:{domains:domains.length,orders:orders.length,products:profile?.products||[]}});
});
function apiProjectSummary(project){
  const product=project.product;
  const sandboxFields=apiCredentialFields(product,'sandbox'),liveFields=apiCredentialFields(product,'live');
  return {
    id:String(project._id),name:project.name,website:project.website||'',product,
    sandbox:{publicKey:project[sandboxFields.publicField]||'',secretKey:decryptApiCredential(project[sandboxFields.encryptedField]||''),secretAvailable:Boolean(project[sandboxFields.encryptedField])},
    live:{publicKey:project[liveFields.publicField]||'',secretKey:decryptApiCredential(project[liveFields.encryptedField]||''),secretAvailable:Boolean(project[liveFields.encryptedField])},
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
    profile.apiProjects.push({name:product==='domain'?'Domain API':'Banking API',website:'',product});
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
  profile.apiProjects.push({name,website:'',product});await profile.save();
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
    const message=product==='bank'?'Live Banking API is pending Paystack approval. It will activate automatically when valid Paystack live keys and BANK_API_LIVE_ENABLED=true are configured in Render.':'Live Domain API is pending provider configuration.';
    return res.status(403).json({message,code:'LIVE_API_PENDING'});
  }
  const fields=apiCredentialFields(product,environment);
  if(project[fields.publicField])return res.status(409).json({message:`This project already has a ${environment==='live'?'live':'test'} API key. It remains active until deleted.`,publicKey:project[fields.publicField]});
  const envPart=environment==='live'?'LIVE':'SANDBOX',productPart=product==='domain'?'DOMAIN_RESELLER':'BANK_RESELLER';
  const publicPrefix=clean(process.env[`${productPart}_${envPart}_PUBLIC_KEY_PREFIX`])||`wnh_${product}_pk_${environment==='live'?'live':'test'}`;
  const secretPrefix=clean(process.env[`${productPart}_${envPart}_SECRET_KEY_PREFIX`])||`wnh_${product}_sk_${environment==='live'?'live':'test'}`;
  const publicKey=makeApiKey(publicPrefix),secretKey=makeApiKey(secretPrefix);
  project[fields.publicField]=publicKey;project[fields.secretField]=await bcrypt.hash(secretKey,10);project[fields.encryptedField]=encryptApiCredential(secretKey);project.lastKeyCreatedAt=new Date();await profile.save();
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
// Compatibility endpoint: returns all named projects instead of one account-wide credential.
app.get('/api/reseller/credentials/:product',auth,requireReseller,async(req,res)=>{
  const product=clean(req.params.product).toLowerCase();if(!['domain','bank'].includes(product))return res.status(400).json({message:'Select domain or bank API.'});
  let profile=await ResellerProfile.findOne({user:req.user.id});await ensureResellerProductEnabled(profile,product);if(!profile||!productEnabled(profile,product))return res.status(403).json({message:'API product is not enabled for this reseller.'});
  profile=await migrateLegacyApiKeys(profile);res.json({product,status:productStatus(profile,product),liveReady:liveProductReady(profile,product),projects:(profile.apiProjects||[]).filter(item=>item.product===product).map(apiProjectSummary),baseUrl:`${String(process.env.BACKEND_URL||'').replace(/\/$/,'')}/api/v1`});
});
async function resellerApiKeyAuth(req,res,next){
  try{
    const publicKey=clean(req.headers['x-api-key']||req.headers['x-public-key']),secret=clean(req.headers['x-api-secret']||req.headers['x-secret-key']);
    if(!publicKey||!secret)return res.status(401).json({message:'X-API-Key and X-API-Secret headers are required.'});
    const domainPrefixes=[clean(process.env.DOMAIN_RESELLER_SANDBOX_PUBLIC_KEY_PREFIX)||'wnh_domain_pk_test',clean(process.env.DOMAIN_RESELLER_LIVE_PUBLIC_KEY_PREFIX)||'wnh_domain_pk_live'];
    const bankPrefixes=[clean(process.env.BANK_RESELLER_SANDBOX_PUBLIC_KEY_PREFIX)||'wnh_bank_pk_test',clean(process.env.BANK_RESELLER_LIVE_PUBLIC_KEY_PREFIX)||'wnh_bank_pk_live'];
    const isDomain=domainPrefixes.some(prefix=>publicKey.startsWith(`${prefix}_`)),isBank=bankPrefixes.some(prefix=>publicKey.startsWith(`${prefix}_`));
    const isLive=publicKey.startsWith(`${domainPrefixes[1]}_`)||publicKey.startsWith(`${bankPrefixes[1]}_`);
    if(!isDomain&&!isBank)return res.status(401).json({message:'Invalid World Net Hosting API key.'});
    const product=isDomain?'domain':'bank',environment=isLive?'live':'sandbox',fields=apiCredentialFields(product,environment);
    const profile=await ResellerProfile.findOne({apiProjects:{$elemMatch:{product,[fields.publicField]:publicKey}}});
    if(!profile)return res.status(401).json({message:'Invalid API credentials.'});
    const project=(profile.apiProjects||[]).find(item=>item.product===product&&item[fields.publicField]===publicKey);
    if(!project||!(await bcrypt.compare(secret,project[fields.secretField]||'')))return res.status(401).json({message:'Invalid API credentials.'});
    if(environment==='live'&&!liveProductReady(profile,product))return res.status(403).json({message:product==='bank'?'Live Banking API is pending Paystack approval.':'Live API access is pending provider activation.',code:'LIVE_API_PENDING'});
    req.resellerApi={profile,project,product,environment};next();
  }catch(error){next(error)}
}
app.get('/api/v1/domains/search',resellerApiKeyAuth,async(req,res)=>{
  if(req.resellerApi.product!=='domain')return res.status(403).json({message:'Use a Domain API key.'});
  try{
    const result=await searchDomainReseller(clean(req.query.name),{limit:req.query.limit||12});
    const markup=domainCustomerMarkupUSD();
    const results=(result.results||[]).map(item=>{
      const providerPrice=Number(item.price||0);
      const appliedMarkup=item.premium?0:markup;
      const resellerBasePrice=Number((providerPrice+appliedMarkup).toFixed(2));
      return {...item,providerPrice,worldNetHostingMarkup:appliedMarkup,resellerBasePrice,minimumCustomerPrice:resellerBasePrice,price:resellerBasePrice,firstYearPrice:resellerBasePrice};
    });
    res.json({...result,results,environment:req.resellerApi.environment,pricingRule:{resellerBasePrice:'provider-price-plus-existing-world-net-hosting-markup',markupUSD:markup,resellerMarkup:'chosen-by-reseller-on-their-own-platform'}});
  }catch(e){res.status(e.status||502).json({message:e.message,provider:e.payload})}
});
app.get('/api/v1/banking/balance',resellerApiKeyAuth,async(req,res)=>{if(req.resellerApi.product!=='bank')return res.status(403).json({message:'Use a Banking API key.'});const user=await User.findById(req.resellerApi.profile.user);const wallet=await getOrCreateWallet(user);res.json({environment:req.resellerApi.environment,currency:wallet.currency,balance:walletAmount(wallet,wallet.currency),balances:walletBalancesObject(wallet),provider:clean(process.env.BANK_API_PROVIDER||'sandbox')})});
app.post('/api/v1/banking/payments/initialize',publicWriteRequestLimit,resellerApiKeyAuth,async(req,res)=>{
  if(req.resellerApi.product!=='bank')return res.status(403).json({message:'Use a Banking API key.'});
  const environment=req.resellerApi.environment;
  const mode=paystackKeyMode();
  if(environment==='live' && mode!=='live')return res.status(503).json({message:'Live Banking API is pending Paystack approval. Configure matching Paystack live keys in Render to activate it automatically.'});
  if(environment==='sandbox' && mode!=='test')return res.status(503).json({message:'Test Banking API requires matching Paystack test keys in the backend environment.'});
  const customerEmail=clean(req.body?.customer_email||req.body?.email).toLowerCase();
  const currency=normalizeCurrency(req.body?.currency||'NGN','NGN');
  const amount=Number(req.body?.amount||0);
  const description=clean(req.body?.description||'Reseller API payment').slice(0,200);
  const callbackUrl=clean(req.body?.callback_url);
  if(!validEmailAddress(customerEmail))return res.status(400).json({message:'A valid customer email is required.'});
  if(!supportedPaystackCurrencies().includes(currency))return res.status(400).json({message:`Currency ${currency} is not enabled for Paystack on this platform.`});
  if(!Number.isFinite(amount)||amount<1)return res.status(400).json({message:'A valid payment amount is required.'});
  if(callbackUrl){try{const parsed=new URL(callbackUrl);if(parsed.protocol!=='https:')throw new Error();}catch{return res.status(400).json({message:'Callback URL must be a valid HTTPS address.'});}}
  const platformFee=Number((amount*BANKING_API_TRANSACTION_FEE_RATE).toFixed(2));
  const resellerNet=Number((amount-platformFee).toFixed(2));
  const reference=`WNH-RAPI-${Date.now()}-${crypto.randomBytes(5).toString('hex')}`;
  const record=await ResellerApiPayment.create({reference,reseller:req.resellerApi.profile.user,resellerProfile:req.resellerApi.profile._id,apiProjectId:req.resellerApi.project._id,environment,customerEmail,amount,currency,platformFee,resellerNet,platformFeeRate:BANKING_API_TRANSACTION_FEE_RATE,description,callbackUrl,status:'pending',providerStatus:'initializing',metadata:req.body?.metadata||{}});
  try{
    const frontendBase=String(process.env.FRONTEND_URL||'').split(',')[0].trim().replace(/\/$/,'');
    const providerCallback=callbackUrl||clean(process.env.PAYSTACK_CALLBACK_URL)||(frontendBase?`${frontendBase}/payment-success.html`:undefined);
    if(!providerCallback)throw Object.assign(new Error('Payment callback URL is not configured.'),{status:500});
    const result=await paystackRequest('/transaction/initialize',{method:'POST',body:JSON.stringify({email:customerEmail,amount:toSubunit(amount,currency),currency,reference,callback_url:providerCallback,metadata:{...(req.body?.metadata||{}),purpose:'reseller_api_payment',payment_id:String(record._id),reseller_id:String(req.resellerApi.profile.user),project_id:String(req.resellerApi.project._id),environment,description}})});
    record.providerStatus='initialized';await record.save();
    res.status(201).json({message:'Payment initialized securely through Paystack.',authorization_url:result.data?.authorization_url,access_code:result.data?.access_code,reference,amount,currency,resellerShare:resellerNet,worldNetHostingFee:platformFee,platformFeeRate:BANKING_API_TRANSACTION_FEE_RATE,status:'pending'});
  }catch(error){record.status='failed';record.providerStatus='initialization_failed';record.metadata={...(record.metadata||{}),error:clean(error.message)};await record.save();throw error;}
});
app.get('/api/v1/banking/payments/:reference',resellerApiKeyAuth,async(req,res)=>{
  if(req.resellerApi.product!=='bank')return res.status(403).json({message:'Use a Banking API key.'});
  const payment=await ResellerApiPayment.findOne({reference:clean(req.params.reference),resellerProfile:req.resellerApi.profile._id,apiProjectId:req.resellerApi.project._id});
  if(!payment)return res.status(404).json({message:'Payment was not found for this API account.'});
  res.setHeader('Cache-Control','no-store');
  res.json({reference:payment.reference,status:payment.status,providerStatus:payment.providerStatus,amount:payment.amount,currency:payment.currency,resellerShare:payment.resellerNet,worldNetHostingFee:payment.platformFee,platformFeeRate:payment.platformFeeRate,description:payment.description,createdAt:payment.createdAt,settledAt:payment.settledAt});
});
app.all('/api/v1/callback/:product/:projectId/:environment',(req,res)=>{
  const product=clean(req.params.product).toLowerCase();
  const environment=clean(req.params.environment).toLowerCase();
  res.json({message:'World Net Hosting callback received.',product,projectId:req.params.projectId||'',environment,received:true,reference:clean(req.query.reference||req.body?.reference||'')});
});
app.post('/api/reseller/credentials/sandbox', auth, requireReseller, async(req,res)=>{req.params.product='domain';req.params.environment='sandbox';return res.status(410).json({message:'Use the product-specific Domain or Banking API credential section.'})});
app.get('/api/reseller/domain-search', auth, requireReseller, async(req,res)=>{
  const profile=await ResellerProfile.findOne({user:req.user.id}); if(!profile?.products?.includes('domain_api'))return res.status(403).json({message:'Domain API is not enabled for this reseller.'});
  const result=await searchDomainReseller(clean(req.query.name),{limit:req.query.limit||12}); res.json(result);
});
app.post('/api/reseller/domains/wallet-purchase', auth, requireReseller, async(req,res)=>{
  try{
    const profile=await ResellerProfile.findOne({user:req.user.id}); if(!profile?.products?.includes('domain_api'))return res.status(403).json({message:'Domain API is not enabled for this reseller.'});
    const item=req.body?.item; if(!item?.name)return res.status(400).json({message:'Select a domain to purchase.'});
    const subtotalUSD=Number(item.usdPrice??item.price??0); if(!(subtotalUSD>0))return res.status(400).json({message:'A valid live domain price is required.'});
    const user=await User.findById(req.user.id), wallet=await getOrCreateWallet(user); const currency=clean(req.body.currency||wallet.currency||'NGN').toUpperCase(); const rate=await getRate('USD',currency); const debit=Number((subtotalUSD*rate).toFixed(2));
    if(walletAmount(wallet,currency)<debit)return res.status(400).json({message:`Insufficient reseller balance. Required ${debit.toFixed(2)} ${currency}.`});
    const order=await Order.create({user:user._id,customerEmail:user.email,items:[item],subtotal:subtotalUSD,platformFee:0,platformFeeRate:0,total:subtotalUSD,currency:'USD',paymentCurrency:currency,exchangeRate:rate,paymentAmount:debit,status:'paid',paymentReference:`RESELLER-WALLET-${Date.now()}`});
    changeWalletAmount(wallet,currency,-debit); wallet.transactions.push({type:'debit',amount:debit,currency,reference:order.paymentReference,description:`Reseller domain purchase: ${item.name}`,status:'completed'}); await wallet.save();
    let domain=null; try{domain=await provisionPaidDomain(order,user)}catch(e){console.error('Reseller domain provisioning failed:',e.message)}
    res.status(201).json({message:domain?'Domain purchased and registered successfully.':'Payment completed; domain registration is processing.',orderId:order._id,domain,balance:walletAmount(wallet,currency),currency});
  }catch(e){res.status(e.status||500).json({message:e.message||'Reseller domain purchase failed.'});}
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
    const markup=domainCustomerMarkupUSD();
    const priced={...apiResult,results:(apiResult.results||[]).map(item=>{
      const providerPrice=Number(item.price||0);
      const providerRenewal=Number(item.renewalPrice||0);
      const renewalBase=providerRenewal>0?providerRenewal:providerPrice;
      const appliedMarkup=item.premium?0:markup;
      const firstYearPrice=Number((providerPrice+appliedMarkup).toFixed(2));
      const renewalPrice=Number((renewalBase+appliedMarkup).toFixed(2));
      return {...item,wholesalePrice:providerPrice,providerPrice,worldNetHostingMarkup:appliedMarkup,firstYearPrice,price:firstYearPrice,renewalPrice,customerMarkup:appliedMarkup};
    })};
    res.json({ query, ...priced, resellerConfigured: domainApiConfigured(), pricingRule:{firstYear:'provider-price-plus-existing-world-net-hosting-markup',renewal:'provider-renewal-plus-existing-world-net-hosting-markup',markupUSD:markup} });
  } catch (err) {
    await DomainSearch.create({ query, results: [], source: 'domainnameapi-error', apiMessage: err.message });
    res.status(err.status || 502).json({ query, results: [], source: 'domainnameapi-error', message: err.message });
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
app.put('/api/domains/:domain/contact',auth,requireOwnedDomain,async(req,res)=>{try{const registrant=normalizeContact(req.body.contact||req.body,'Registrant');if(!registrant)return res.status(400).json({message:'Complete WHOIS contact details are required.'});const contacts=['Registrant','Management','Tech','Billing'].map(type=>({...registrant,contactType:type}));const provider=await domainNameApiRequest('PUT',domainEndpoint('CONTACT','domains/contact'),{domainName:req.params.domain,contacts});res.json({message:providerMessage(provider,'WHOIS contacts updated successfully.'),provider})}catch(e){res.status(e.status||502).json({message:e.message,provider:e.payload})}});
app.post('/api/domains/receive-requests',auth,async(req,res)=>{const domain=clean(req.body.domain).toLowerCase();const senderEmail=clean(req.body.senderEmail).toLowerCase();if(!validDomainName(domain))return res.status(400).json({message:'Enter a valid full domain name.'});if(!senderEmail||!senderEmail.includes('@'))return res.status(400).json({message:'A valid sender email is required.'});if(!req.body.consent)return res.status(400).json({message:'Receiving consent is required.'});const item=await DomainTransfer.create({user:req.user.id,type:'receive',domain,senderEmail,note:clean(req.body.note),status:'pending-review'});res.status(201).json({message:'Receive request created successfully and is pending ownership validation.',reference:String(item._id),status:item.status})});
app.get('/api/domains/transfer-requests',auth,async(req,res)=>res.json(await DomainTransfer.find({user:req.user.id}).select('-authCodeEncrypted').sort({createdAt:-1})));

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
    await repairLegacyWallet(wallet, await User.findById(req.user.id));
    const debitCurrency = clean(req.body.currency || wallet.currency || 'NGN').toUpperCase();
    const rate = await getRate('USD', debitCurrency);
    const walletDebit = Number((totalUSD * rate).toFixed(2));
    if (walletAmount(wallet, debitCurrency) < walletDebit) return res.status(400).json({ message: `Insufficient wallet balance. Required ${walletDebit.toFixed(2)} ${debitCurrency}.` });
    const order = await Order.create({ user:req.user.id, customerEmail:req.user.email, items, subtotal:subtotalUSD, platformFee:platformFeeUSD, platformFeeRate:USER_PLATFORM_FEE_RATE, total:totalUSD, currency:'USD', paymentCurrency:debitCurrency, exchangeRate:rate, paymentAmount:walletDebit, status:'paid', paymentReference:`WALLET-${Date.now()}` });
    changeWalletAmount(wallet, debitCurrency, -walletDebit);
    wallet.transactions.push({type:'debit',amount:walletDebit,currency:debitCurrency,reference:order.paymentReference,description:`Wallet payment for order ${order._id} including 4% platform fee`,status:'completed'});
    await wallet.save();
    if (domainItemFromOrder(order)) { try { await provisionPaidDomain(order, await User.findById(req.user.id)); } catch (e) { console.error('Wallet domain provisioning failed:', e.message); } }
    res.status(201).json({message:'Order paid successfully with wallet balance.',order_id:order._id,walletBalance:walletAmount(wallet,debitCurrency),balances:walletBalancesObject(wallet),currency:debitCurrency,platformFeeUSD,totalUSD,walletDebit});
  } catch (e) { res.status(e.status || 500).json({message:e.message || 'Wallet checkout failed'}); }
});

app.post('/api/payments/paystack/checkout', auth, async (req, res) => {
  if (!paystackConfigured()) return res.status(400).json({ message: 'Paystack public/secret keys are not configured in the server environment' });
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
  let frontendBase = String(process.env.FRONTEND_URL || '').split(',')[0].trim().replace(/\/$/, '');
  const callbackUrl = process.env.PAYSTACK_CALLBACK_URL || (frontendBase ? `${frontendBase}/payment-success.html` : undefined);
  if (!callbackUrl) return res.status(500).json({ message: 'Payment callback URL is not configured. Set FRONTEND_URL or PAYSTACK_CALLBACK_URL in the server environment.' });
  const response = await fetch('https://api.paystack.co/transaction/initialize', {
    method: 'POST',
    headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`, 'Content-Type': 'application/json' },
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
  if (!paystackConfigured()) return res.status(400).json({ message: 'Paystack public/secret keys are not configured in the server environment' });
  const currency = normalizeCurrency(req.body.currency || process.env.PAYSTACK_DEFAULT_CURRENCY || 'NGN', 'NGN');
  if (!supportedPaystackCurrencies().includes(currency)) return res.status(400).json({ message: `Currency ${currency} is not enabled for Paystack on this platform` });
  const requestedAmount = Number(req.body.amount || 0);
  const purpose = clean(req.body.purpose || 'wallet_deposit');
  if (purpose !== 'wallet_deposit') return res.status(400).json({ message: 'Unsupported payment purpose' });
  const platformFee = feePart(requestedAmount);
  const chargeAmount = addUserFee(requestedAmount);
  const amount = toSubunit(chargeAmount, currency);
  if (!requestedAmount || requestedAmount < 1 || !amount) return res.status(400).json({ message: 'Valid amount is required' });
  const frontendBase = String(process.env.FRONTEND_URL || '').split(',')[0].trim().replace(/\/$/, '');
  const callbackUrl = clean(process.env.PAYSTACK_CALLBACK_URL) || (frontendBase ? `${frontendBase}/payment-success.html` : '');
  if (!callbackUrl) return res.status(500).json({ message: 'Payment callback URL is not configured. Set FRONTEND_URL or PAYSTACK_CALLBACK_URL in the server environment.' });
  const response = await fetch('https://api.paystack.co/transaction/initialize', {
    method: 'POST',
    headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: req.user.email,
      amount,
      currency,
      callback_url: callbackUrl,
      metadata: { ...(req.body.metadata || {}), purpose, user_id: req.user.id, requested_amount: requestedAmount, platform_fee: platformFee, platform_fee_rate: USER_PLATFORM_FEE_RATE, charged_amount: chargeAmount }
    }),
    signal: AbortSignal.timeout(30000)
  });
  const data = await response.json().catch(() => ({ status: false, message: `Paystack returned HTTP ${response.status}` }));
  res.status(response.status).json({ ...data, requestedAmount, platformFee, platformFeeRate: USER_PLATFORM_FEE_RATE, chargeAmount, currency });
});

app.get('/api/payments/paystack/config', (req, res) => res.json({ publicKey: process.env.PAYSTACK_PUBLIC_KEY || '', callbackUrl: process.env.PAYSTACK_CALLBACK_URL || '', defaultCurrency: process.env.PAYSTACK_DEFAULT_CURRENCY || 'NGN', supportedCurrencies: supportedPaystackCurrencies() }));

app.get('/api/payments/paystack/verify/:reference',publicApiRequestLimit,async (req, res) => {
  if (!paystackConfigured()) return res.status(400).json({ message: 'Paystack public/secret keys are not configured in the server environment' });
  const reference = clean(req.params.reference);
  const response = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, { headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` }, signal: AbortSignal.timeout(30000) });
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
    res.status(201).json({message:'Chat delivered to the staff dashboard.',ticketId:saved._id,accessToken,item:publicMessage(saved)});
  } catch(error){ res.status(error instanceof multer.MulterError?400:500).json({message:error.message||'Chat could not be sent.'}); }
});
app.get('/api/support/chat/:id',requireChatAccess,async(req,res)=>res.json(publicMessage(req.supportMessage)));
app.patch('/api/support/chat/:id/status',requireChatAccess,async(req,res)=>{const status=clean(req.body.status);if(!['open','closed'].includes(status))return res.status(400).json({message:'Status must be open or closed.'});req.supportMessage.status=status;await req.supportMessage.save();res.json({message:`Chat ${status}.`,item:publicMessage(req.supportMessage)});});
app.get('/api/support/chat/:id/attachments/:attachmentId',requireChatAccess,async(req,res)=>{const file=req.supportMessage.attachments?.id(req.params.attachmentId);if(!file)return res.status(404).json({message:'Attachment not found'});res.setHeader('Content-Type',file.mimeType);res.setHeader('Content-Disposition',`inline; filename="${String(file.filename).replace(/"/g,'')}"`);res.setHeader('Cache-Control','private, no-store');res.send(file.data);});





app.get('/api/system/maintenance', async (_req,res)=>res.json(await maintenanceState()));


// Unified wallet compatibility routes used by the professional wallet pages.
app.get('/api/wallet', auth, async (req,res)=>{try{
  const {wallet,walletType}=await roleWallet(req);
  const balances=walletBalancesObject(wallet);
  res.json({available_balance:walletAmount(wallet,wallet.currency),balance:walletAmount(wallet,wallet.currency),currency:wallet.currency,balances,ngn_balance:Number(balances.NGN||0),usd_balance:Number(balances.USD||0),balance_updated_at:wallet.updatedAt,user:{name:req.user.name,email:req.user.email,role:req.user.role},walletType,platformFeeRate:USER_PLATFORM_FEE_RATE,platformFeePercent:USER_PLATFORM_FEE_RATE*100});
}catch(e){res.status(e.status||500).json({message:e.message});}});
app.get('/api/wallet/transactions', auth, async (req,res)=>{try{
  const {wallet}=await roleWallet(req);
  res.json({transactions:[...(wallet.transactions||[])].reverse().slice(0,100).map(t=>({type:t.type,amount:t.amount,currency:t.currency||wallet.currency,reference:t.reference,status:t.status,description:t.description,created_at:t.createdAt||t.date||wallet.updatedAt}))});
}catch(e){res.status(e.status||500).json({message:e.message});}});
app.post('/api/wallet/send', auth, async (req,res)=>{try{
    const amount=Number(req.body.amount||0), currency=clean(req.body.currency||'NGN').toUpperCase(), recipientEmail=clean(req.body.recipientEmail||req.body.email).toLowerCase(), note=clean(req.body.note||'Wallet-to-wallet transfer');
  if(!Number.isFinite(amount)||amount<=0)return res.status(400).json({message:'Enter a valid amount.'});
  if(!recipientEmail||recipientEmail===String(req.user.email).toLowerCase())return res.status(400).json({message:'Enter another registered user email.'});
  const recipient=await User.findOne({email:recipientEmail,active:{$ne:false}});if(!recipient)return res.status(404).json({message:'Recipient wallet was not found.'});
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
  res.json({role:req.user.role,walletType,currency:wallet.currency,balance:walletAmount(wallet,wallet.currency),ngnBalance:Number(balances.NGN||0),usdBalance:Number(balances.USD||0),balances,dedicatedAccount:walletType==='user'?wallet.dedicatedAccount:null,operations:operations.map(publicBankOperation),platformFeePercent:USER_PLATFORM_FEE_RATE*100});
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
    const user=await User.findById(req.user.id),wallet=await getOrCreateWallet(user);
  const account=await ensurePaystackCustomerAndDedicatedAccount(user,wallet,{consent:req.body.consent===true,preferredBank:clean(req.body.preferredBank)});
  const active=Boolean(account?.active&&account?.accountNumber);
  res.status(active?201:202).json({message:active?'Dedicated receive account is active.':'Paystack is processing the receiving-account assignment.',dedicatedAccount:account,testMode:paystackTestMode()});
}catch(e){res.status(e.status||502).json({message:e.message,provider:e.payload});}});

app.post('/api/wallet/banking/convert', auth, async (req,res)=>{try{
  const amount=Number(req.body.amount||0),from=clean(req.body.fromCurrency||'NGN').toUpperCase(),to=clean(req.body.toCurrency||'USD').toUpperCase(); if(!Number.isFinite(amount)||amount<=0||from===to)return res.status(400).json({message:'Enter an amount and two different currencies.'});
  const {wallet,walletType}=await roleWallet(req);const fee=bankFeeForRole(amount,req.user.role),totalDebit=Number((amount+fee).toFixed(2));if(walletAmount(wallet,from)<totalDebit)return res.status(400).json({message:`Insufficient ${from} balance. Conversion and fee require ${totalDebit.toFixed(2)} ${from}.`});
  const rate=await resolveRate(from,to),converted=Number((amount*rate).toFixed(2)),reference=`CONVERT-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;changeWalletAmount(wallet,from,-totalDebit);changeWalletAmount(wallet,to,converted);wallet.transactions.push({type:'debit',amount:totalDebit,currency:from,reference,description:`Converted ${amount} ${from} to ${converted} ${to}; fee ${fee} ${from}`,status:'completed'});wallet.transactions.push({type:'credit',amount:converted,currency:to,reference,description:`Currency conversion from ${from}`,status:'completed'});await wallet.save();
  const operation=await BankOperation.create({owner:req.user.id,ownerEmail:req.user.email,ownerRole:req.user.role,walletType,type:'currency_convert',amount,fee,totalDebit,currency:from,sourceCurrency:from,targetCurrency:to,exchangeRate:rate,convertedAmount:converted,status:'success',description:'Internal wallet currency conversion'});res.status(201).json({message:'Wallet currency converted successfully.',operation:publicBankOperation(operation),balances:walletBalancesObject(wallet)});
}catch(e){res.status(e.status||502).json({message:e.message});}});

app.get('/api/staff/bank-operations',auth,requireStaffPermission('wallet.manage'),async(_req,res)=>res.json((await BankOperation.find().sort({createdAt:-1}).limit(200)).map(publicBankOperation)));

app.get('/api/wallet/withdrawals',auth,async(req,res)=>{try{
  const operations=await BankOperation.find({owner:req.user.id,type:'bank_transfer'}).sort({createdAt:-1}).limit(100);
  res.json(operations.map(publicBankOperation));
}catch(e){res.status(e.status||500).json({message:e.message});}});

// Backward-compatible direct withdrawal endpoint. A withdrawal is a real Paystack bank transfer,
// This is a direct banking operation, not an approval request. The configured platform fee applies.
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


app.get('/api/staff/messages',auth,requireStaffPermission('support.manage'),async(_req,res)=>res.json((await Message.find().sort({updatedAt:-1})).map(publicMessage)));
app.post('/api/staff/messages/:id/reply',auth,requireStaffPermission('support.manage'),async(req,res)=>{const body=clean(req.body.body);if(!body)return res.status(400).json({message:'Reply body is required'});const existing=await Message.findById(req.params.id);if(!existing)return res.status(404).json({message:'Conversation not found'});let localBody=body;if(existing.language&&existing.language!=='en'){try{localBody=await translateText(body,existing.language)}catch{}}existing.replies.push({body,englishBody:body,localBody,language:existing.language||'en',repliedBy:req.user.email,createdAt:new Date()});existing.status='replied';await existing.save();res.json({message:'Reply saved in English and customer language.',item:publicMessage(existing)});});
app.patch('/api/staff/messages/:id/status',auth,requireStaffPermission('support.manage'),async(req,res)=>{const allowed=['new','open','replied','closed'];const status=clean(req.body.status);if(!allowed.includes(status))return res.status(400).json({message:'Invalid status'});const item=await Message.findByIdAndUpdate(req.params.id,{status},{new:true});if(!item)return res.status(404).json({message:'Conversation not found'});res.json({message:'Status updated.',item});});


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

module.exports = { app, startServer };
