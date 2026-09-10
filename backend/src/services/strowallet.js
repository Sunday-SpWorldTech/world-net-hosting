
const BASE_URL = 'https://strowallet.com';
const clean = (v='') => String(v ?? '').trim();
const publicKey = () => clean(process.env.STROWALLET_PUBLIC_KEY || process.env.STROWALLET_API_KEY);
const secretKey = () => clean(process.env.STROWALLET_SECRET_KEY);
const mode = () => clean(process.env.STROWALLET_MODE || 'live').toLowerCase();
function configured(){ return Boolean(publicKey()); }
function headers(){ return { Accept:'application/json', 'Content-Type':'application/json' }; }
async function request(path, body={}, {includeSecret=false}={}){
  if(!configured()) throw Object.assign(new Error('StroWallet is not configured on the backend.'),{status:503});
  const payload={public_key:publicKey(), mode:mode(), ...body};
  if(includeSecret && secretKey()) payload.secret_key=secretKey();
  const response=await fetch(`${BASE_URL}${path}`,{method:'POST',headers:headers(),body:JSON.stringify(payload),signal:AbortSignal.timeout(30000)});
  const text=await response.text(); let data={}; try{data=text?JSON.parse(text):{};}catch{data={message:text};}
  if(!response.ok || data?.status==='failed' || data?.success===false){
    const err=new Error(clean(data?.message||data?.error||data?.detail||`StroWallet request failed (${response.status})`)); err.status=response.status>=400?502:502; err.payload=data; throw err;
  }
  return data;
}
function createDollarCard(body){ return request('/api/bitvcard/create-nfc-card/',body); }
function createNairaCard(body){ return request('/api/naira_createcard/',body); }
function createVirtualAccount(body){ return request('/api/virtual-bank/new-customer/',body); }
function extractCustomerId(value){
  if(!value || typeof value!=='object') return '';
  const direct=value.customerId||value.customer_id||value.customerID||value?.data?.customerId||value?.data?.customer_id||value?.data?.customerID;
  if(direct) return clean(direct);
  const stack=[value]; while(stack.length){const node=stack.pop(); if(!node||typeof node!=='object')continue; for(const [k,v] of Object.entries(node)){if(/customer.?id/i.test(k)&&['string','number'].includes(typeof v))return clean(v); if(v&&typeof v==='object')stack.push(v);}}
  return '';
}
module.exports={configured,publicKey,secretKey,mode,createDollarCard,createNairaCard,createVirtualAccount,extractCustomerId};
