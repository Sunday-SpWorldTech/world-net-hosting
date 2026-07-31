require('dotenv').config();
const domainSearchTlds = require('./config/domainSearchTlds');

const errors = [];
const warnings = [];
const clean = (input = '') => String(input || '').trim();
const value = (name) => clean(process.env[name]);
const required = (name, min = 1) => {
  const current = value(name);
  if (!current || current.length < min) errors.push(`${name} is missing or too short.`);
  else if (/(?:replace_with|your_(?:username|password|cluster|database|frontend|backend|domain|azure))/i.test(current)) errors.push(`${name} still contains a placeholder value.`);
  return current;
};
const productionUrl = (name) => {
  const current = required(name, 12);
  if (current && (!/^https:\/\//i.test(current) || /(?:localhost|127\.0\.0\.1|0\.0\.0\.0)/i.test(current))) errors.push(`${name} must be a public HTTPS URL.`);
  return current;
};

const jwt = required('JWT_SECRET', 32);
if (/^JWT_SECRET=/i.test(jwt)) errors.push('JWT_SECRET must contain only the secret value, not "JWT_SECRET=" twice.');
required('MONGODB_URI', 20);
required('WITHDRAWAL_ENCRYPTION_KEY', 32);
required('PAYSTACK_PUBLIC_KEY', 10);
required('PAYSTACK_SECRET_KEY', 10);
required('AZURE_TRANSLATOR_KEY', 10);
required('AZURE_TRANSLATOR_REGION', 2);
productionUrl('AZURE_TRANSLATOR_ENDPOINT');
required('DOMAIN_RESELLER_ID', 5);
required('DOMAIN_API_KEY', 10);
required('DOMAIN_RESELLER_SANDBOX_PUBLIC_KEY_PREFIX', 8);
required('DOMAIN_RESELLER_SANDBOX_SECRET_KEY_PREFIX', 8);
required('DOMAIN_RESELLER_LIVE_PUBLIC_KEY_PREFIX', 8);
required('DOMAIN_RESELLER_LIVE_SECRET_KEY_PREFIX', 8);
required('BANK_RESELLER_SANDBOX_PUBLIC_KEY_PREFIX', 8);
required('BANK_RESELLER_SANDBOX_SECRET_KEY_PREFIX', 8);
required('BANK_RESELLER_LIVE_PUBLIC_KEY_PREFIX', 8);
required('BANK_RESELLER_LIVE_SECRET_KEY_PREFIX', 8);
required('DOMAIN_API_PROVIDER', 5);
required('BANK_API_PROVIDER', 5);
required('BANK_API_BASE_URL', 10);
if (value('DOMAIN_API_PROVIDER').toLowerCase() !== 'domainnameapi') errors.push('DOMAIN_API_PROVIDER must be domainnameapi for this project.');
if (value('DOMAIN_API_LIVE_ENABLED').toLowerCase() !== 'true') errors.push('DOMAIN_API_LIVE_ENABLED must be true for production.');
const bankApiMode = value('BANK_API_MODE').toLowerCase();
if (!['sandbox','live'].includes(bankApiMode)) errors.push('BANK_API_MODE must be sandbox or live.');
if (bankApiMode === 'live' && value('BANK_API_LIVE_ENABLED').toLowerCase() !== 'true') errors.push('BANK_API_MODE is live, so BANK_API_LIVE_ENABLED must be true.');
if (value('BANK_API_PROVIDER').toLowerCase() !== 'paystack') errors.push('BANK_API_PROVIDER must be paystack for this project.');
if (value('BANK_API_BASE_URL').replace(/\/$/,'') !== 'https://api.paystack.co') errors.push('BANK_API_BASE_URL must be https://api.paystack.co.');
const publicKey = value('PAYSTACK_PUBLIC_KEY');
const secretKey = value('PAYSTACK_SECRET_KEY');
const paystackTest = publicKey.startsWith('pk_test_') && secretKey.startsWith('sk_test_');
const paystackLive = publicKey.startsWith('pk_live_') && secretKey.startsWith('sk_live_');
if (!paystackTest && !paystackLive) errors.push('Paystack public and secret keys must be a matching test or live pair.');
if (value('PAYSTACK_REQUIRE_LIVE').toLowerCase() === 'true' && !paystackLive) errors.push('PAYSTACK_REQUIRE_LIVE is true, so matching pk_live_ and sk_live_ keys are required.');
else if (paystackTest) warnings.push('Paystack is configured with test keys. Replace both with matching pk_live_ and sk_live_ values and restart; live reseller Banking API approval will activate automatically.');

productionUrl('FRONTEND_URL');
productionUrl('BACKEND_URL');
productionUrl('PAYSTACK_CALLBACK_URL');
if (value('DOMAIN_API_MODE').toLowerCase() !== 'live') errors.push('DOMAIN_API_MODE must be live for production.');
if (value('DOMAIN_API_ALLOW_CUSTOM_BASE').toLowerCase() === 'true') warnings.push('DOMAIN_API_ALLOW_CUSTOM_BASE is enabled; confirm the custom registrar endpoint is intentional.');
if (domainSearchTlds.length !== 200 || new Set(domainSearchTlds).size !== 200) errors.push('The domain search catalog must contain exactly 200 unique TLDs.');
if (value('NODE_ENV') !== 'production') warnings.push('NODE_ENV is not production.');

if (warnings.length) console.warn(`Warnings:\n- ${warnings.join('\n- ')}`);
if (errors.length) {
  console.error(`Environment preflight failed:\n- ${errors.join('\n- ')}`);
  process.exit(1);
}
console.log('Environment preflight passed.');
