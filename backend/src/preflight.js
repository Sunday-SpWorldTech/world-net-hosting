require('dotenv').config();
const missing=[];
const placeholder=/replace_|your-|your_|example\.com|mongodb\+srv:\/\/replace/i;
function required(name,min=1){
  const v=String(process.env[name]||'').trim();
  if(v.length<min||placeholder.test(v))missing.push(name);
  return v;
}
required('MONGODB_URI');
required('JWT_SECRET',32);
required('FRONTEND_URL');
required('BACKEND_URL');
const paystackSecret=required('PAYSTACK_SECRET_KEY');
if(paystackSecret && !/^sk_(test|live)_/i.test(paystackSecret)) missing.push('PAYSTACK_SECRET_KEY must start with sk_test_ or sk_live_');
const paystackPublic=String(process.env.PAYSTACK_PUBLIC_KEY||'').trim();
if(paystackPublic && !placeholder.test(paystackPublic) && !/^pk_(test|live)_/i.test(paystackPublic)) missing.push('PAYSTACK_PUBLIC_KEY must start with pk_test_ or pk_live_');
if(String(process.env.NODE_ENV||'').toLowerCase()==='production'&&!String(process.env.FRONTEND_URL||'').startsWith('https://')) missing.push('FRONTEND_URL must use HTTPS');
if(missing.length){console.error(`Preflight failed: ${[...new Set(missing)].join(', ')}`);process.exit(1);}
console.log('Preflight passed.');
