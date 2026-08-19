const crypto = require('crypto');

const clean = (v='') => String(v || '').trim();
const isReal = (v='') => Boolean(clean(v)) && !/replace_|your_|example\.com|xxxxxxxx|change_this/i.test(clean(v));

function keyPairFor(targetEnvironment) {
  const env = targetEnvironment === 'live' ? 'live' : 'sandbox';
  const explicitSecret = clean(env === 'live' ? process.env.PAYSTACK_LIVE_SECRET_KEY : process.env.PAYSTACK_TEST_SECRET_KEY);
  const explicitPublic = clean(env === 'live' ? process.env.PAYSTACK_LIVE_PUBLIC_KEY : process.env.PAYSTACK_TEST_PUBLIC_KEY);
  const legacySecret = clean(process.env.PAYSTACK_SECRET_KEY);
  const legacyPublic = clean(process.env.PAYSTACK_PUBLIC_KEY);
  const legacyMatches = env === 'live' ? legacySecret.startsWith('sk_live_') : legacySecret.startsWith('sk_test_');
  return {
    secretKey: explicitSecret || (legacyMatches ? legacySecret : ''),
    publicKey: explicitPublic || (legacyMatches ? legacyPublic : '')
  };
}

function environment(value) {
  const requested=clean(value).toLowerCase();
  if(requested==='live'||requested==='production') return 'live';
  if(requested==='sandbox'||requested==='test') return 'sandbox';
  const explicit=clean(process.env.PAYSTACK_ENV).toLowerCase();
  if(explicit==='live'||explicit==='production') return 'live';
  if(explicit==='sandbox'||explicit==='test') return 'sandbox';
  if(keyPairFor('live').secretKey) return 'live';
  if(keyPairFor('sandbox').secretKey) return 'sandbox';
  return 'sandbox';
}

function credentials(targetEnvironment) {
  const requested=environment(targetEnvironment);
  const pair=keyPairFor(requested);
  return {environment:requested,secretKey:pair.secretKey,publicKey:pair.publicKey,baseUrl:clean(process.env.PAYSTACK_BASE_URL||'https://api.paystack.co').replace(/\/+$/,'')};
}
function baseUrl(){ return clean(process.env.PAYSTACK_BASE_URL||'https://api.paystack.co').replace(/\/+$/,''); }
function configured(targetEnvironment){ const c=credentials(targetEnvironment); return isReal(c.secretKey) && /^sk_(test|live)_/i.test(c.secretKey); }
function liveConfigured(){ return environment()==='live' && configured('live'); }
function smallestUnit(amount){ return Math.round(Number(amount||0)*100); }
function majorUnit(amount){ return Number((Number(amount||0)/100).toFixed(2)); }

async function request(pathname,{method='GET',body,query,timeoutMs=30000,environment:targetEnvironment}={}){
  const c=credentials(targetEnvironment);
  if(!configured(c.environment)){const e=new Error(`Paystack ${c.environment} credentials are not configured on the backend.`);e.status=503;throw e;}
  const url=new URL(`${baseUrl()}${pathname.startsWith('/')?pathname:`/${pathname}`}`);
  Object.entries(query||{}).forEach(([k,v])=>{if(v!==undefined&&v!==null&&String(v)!=='')url.searchParams.set(k,String(v));});
  const headers={accept:'application/json',authorization:`Bearer ${c.secretKey}`};
  if(body!==undefined)headers['content-type']='application/json';
  const response=await fetch(url,{method,headers,body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(timeoutMs)});
  const payload=await response.json().catch(()=>({}));
  if(!response.ok||payload?.status===false){const e=new Error(clean(payload?.message)||`Paystack request failed (${response.status}).`);e.status=response.status||502;e.payload=payload;throw e;}
  return payload;
}
function verifyWebhookSignature(payloadObject,signature,targetEnvironment){
  const secret=credentials(targetEnvironment).secretKey;
  if(!secret||!signature)return false;
  const digest=crypto.createHmac('sha512',secret).update(JSON.stringify(payloadObject)).digest('hex');
  const a=Buffer.from(digest,'utf8'),b=Buffer.from(clean(signature),'utf8');
  return a.length===b.length&&crypto.timingSafeEqual(a,b);
}
function normalizeAccount(data={}){
  const bank=data.bank||data.provider||{};
  const isActive=Boolean(data.active===true||data.assigned===true||data.status==='active'||data.status==='success');
  const assignmentStatus=isActive?'active':data.status==='failed'?'failed':data.status==='rejected'?'rejected':'pending';
  return {provider:'paystack',providerAccountId:clean(data.id||data.dedicated_account_id),merchantReference:clean(data.customer?.customer_code||data.customer_code||data.reference),accountNumber:clean(data.account_number),accountName:clean(data.account_name),bankName:clean(bank.name||data.bank_name),bankSlug:clean(bank.slug),bankCode:clean(bank.code),currency:clean(data.currency||'NGN').toUpperCase(),country:clean(data.country||'NG'),assignmentStatus,assignmentMessage:clean(data.message),active:Boolean(isActive&&clean(data.account_number))};
}

async function ensureCustomer(payload,targetEnvironment){
  const info=payload.KYCInformation||payload.customer||{};
  const email=clean(info.email||payload.email);
  if(!email){const e=new Error('Customer email is required for Paystack dedicated account creation.');e.status=400;throw e;}
  const body={email,first_name:clean(info.firstName||info.first_name),last_name:clean(info.lastName||info.last_name),phone:clean(info.phone),metadata:{merchantReference:clean(payload.merchantReference)}};
  try{
    const result=await request('/customer',{method:'POST',body,environment:targetEnvironment});
    return result.data||result;
  }catch(error){
    // Reuse an existing Paystack customer when this email has already been created.
    if([400,409,422].includes(Number(error.status||0))){
      try{const found=await request(`/customer/${encodeURIComponent(email)}`,{environment:targetEnvironment});return found.data||found;}catch(_){/* return original error below */}
    }
    throw error;
  }
}
async function createVirtualAccount(payload,targetEnvironment){
  const customer=await ensureCustomer(payload,targetEnvironment);
  const body={customer:customer.customer_code||customer.code,preferred_bank:clean(process.env.PAYSTACK_DVA_PREFERRED_BANK)||undefined,first_name:clean(payload.KYCInformation?.firstName),last_name:clean(payload.KYCInformation?.lastName),phone:clean(payload.KYCInformation?.phone)};
  Object.keys(body).forEach(k=>{ if(body[k]===undefined || body[k]==='') delete body[k]; });
  const result=await request('/dedicated_account',{method:'POST',body,environment:targetEnvironment});
  if(result?.data) result.data.customer=result.data.customer||customer;
  return result;
}
async function getVirtualAccount(id,targetEnvironment){return request(`/dedicated_account/${encodeURIComponent(id)}`,{environment:targetEnvironment});}
async function listVirtualAccounts(_currency,targetEnvironment){return request('/dedicated_account',{environment:targetEnvironment});}
async function createCheckout(payload,targetEnvironment){
  const customer=payload.customer||{};
  const body={email:clean(customer.email||payload.email),amount:smallestUnit(payload.amount),currency:clean(payload.currency||'NGN').toUpperCase(),reference:clean(payload.merchantReference||payload.reference),callback_url:clean(payload.redirectUrl),metadata:payload.metadata||{}};
  const result=await request('/transaction/initialize',{method:'POST',body,environment:targetEnvironment});
  const d=result.data||{}; result.data={...d,link:d.authorization_url,checkoutUrl:d.authorization_url,id:d.access_code,reference:d.reference||body.reference}; return result;
}
async function verifyCheckout(reference,targetEnvironment){
  const result=await request(`/transaction/verify/${encodeURIComponent(reference)}`,{environment:targetEnvironment});
  const d=result.data||{}; result.data={...d,amount:majorUnit(d.amount),fee:majorUnit(d.fees||0)}; return result;
}
async function listBanks({currency='NGN',country='nigeria'}={},targetEnvironment){
  const countryMap={NG:'nigeria',GH:'ghana',ZA:'south africa',KE:'kenya',CI:"côte d'ivoire"};
  return request('/bank',{query:{currency:clean(currency).toLowerCase(),country:countryMap[clean(country).toUpperCase()]||clean(country).toLowerCase(),perPage:100},environment:targetEnvironment});
}
async function resolveAccount(payload,targetEnvironment){return request('/bank/resolve',{query:{account_number:clean(payload.accountNumber),bank_code:clean(payload.bankCode)},environment:targetEnvironment});}
async function createPayout(payload,targetEnvironment){
  const beneficiary=payload.beneficiary||{};
  const currency=clean(payload.destinationCurrency||payload.sourceCurrency||'NGN').toUpperCase();
  const recipientResult=await request('/transferrecipient',{method:'POST',body:{type:'nuban',name:clean(beneficiary.accountHolderName||`${beneficiary.firstName||''} ${beneficiary.lastName||''}`),account_number:clean(beneficiary.accountNumber),bank_code:clean(beneficiary.bankCode),currency},environment:targetEnvironment});
  const recipient=recipientResult.data||{};
  const result=await request('/transfer',{method:'POST',body:{source:'balance',amount:smallestUnit(payload.amount),recipient:recipient.recipient_code,reason:clean(payload.description),reference:clean(payload.customerReference)},environment:targetEnvironment});
  const d=result.data||{}; result.data={...d,id:d.id,reference:d.reference||payload.customerReference,recipientCode:recipient.recipient_code}; return result;
}
async function getPayoutByReference(reference,targetEnvironment){return request(`/transfer/verify/${encodeURIComponent(reference)}`,{environment:targetEnvironment});}
async function getPayoutByCustomerReference(reference,targetEnvironment){return getPayoutByReference(reference,targetEnvironment);}
async function listPayouts(query={},targetEnvironment){return request('/transfer',{query,environment:targetEnvironment});}
async function listCollections(query={},targetEnvironment){return request('/transaction',{query,environment:targetEnvironment});}
async function generateQuote(){const e=new Error('Currency quotes are handled by the World Net Hosting exchange-rate service, not Paystack.');e.status=400;throw e;}
async function initiateConversion(){const e=new Error('Wallet currency conversion is handled internally by World Net Hosting.');e.status=400;throw e;}
module.exports={environment,credentials,baseUrl,configured,liveConfigured,request,verifyWebhookSignature,normalizeAccount,createVirtualAccount,getVirtualAccount,listVirtualAccounts,createCheckout,verifyCheckout,listBanks,resolveAccount,createPayout,getPayoutByReference,getPayoutByCustomerReference,listPayouts,listCollections,generateQuote,initiateConversion};
