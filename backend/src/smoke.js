require('dotenv').config();
const base=String(process.env.BACKEND_URL||'http://localhost:3000').replace(/\/$/,'');
(async()=>{for(const path of ['/api/health','/api/payments/paystack/config','/api/v1/openapi.json']){const r=await fetch(`${base}${path}`);if(!r.ok)throw new Error(`${path} returned ${r.status}`);console.log(`${path}: ${r.status}`);}})().catch(e=>{console.error(e.message);process.exit(1);});
