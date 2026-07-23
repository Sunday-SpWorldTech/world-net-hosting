require('dotenv').config();
const domainSearchTlds = require('./config/domainSearchTlds');

const errors = [];
const warnings = [];
const clean = (input = '') => String(input || '').trim();
const value = (name) => clean(process.env[name]);
const required = (name, min = 1) => {
  const current = value(name);
  if (!current || current.length < min) errors.push(`${name} is missing or too short.`);
  else if (/(?:replace_with|your_(?:username|password|cluster|database|frontend|backend|github|render|domain|azure))/i.test(current)) errors.push(`${name} still contains a placeholder value.`);
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
required('ADMIN_LOGIN_PIN', 4);
required('WITHDRAWAL_ENCRYPTION_KEY', 32);
required('ENV_ENCRYPTION_KEY', 32);
required('PAYSTACK_PUBLIC_KEY', 10);
required('PAYSTACK_SECRET_KEY', 10);
required('AZURE_TRANSLATOR_KEY', 10);
required('AZURE_TRANSLATOR_REGION', 2);
productionUrl('AZURE_TRANSLATOR_ENDPOINT');
required('DOMAIN_RESELLER_ID', 5);
required('DOMAIN_API_KEY', 10);
required('GITHUB_APP_ID', 1);
required('GITHUB_APP_SLUG', 1);
const githubOAuthKey = clean(process.env.GITHUB_OAUTH_APP_KEY || process.env.GITHUB_CLIENT_ID);
const githubOAuthSecret = clean(process.env.GITHUB_OAUTH_APP_SECRET || process.env.GITHUB_CLIENT_SECRET);
if (!githubOAuthKey || githubOAuthKey.length < 5) errors.push('GITHUB_OAUTH_APP_KEY (or GITHUB_CLIENT_ID) is missing or too short.');
if (!githubOAuthSecret || githubOAuthSecret.length < 10) errors.push('GITHUB_OAUTH_APP_SECRET (or GITHUB_CLIENT_SECRET) is missing or too short.');
const privateKey = required('GITHUB_PRIVATE_KEY', 40);
if (/^SHA256:/i.test(privateKey)) errors.push('GITHUB_PRIVATE_KEY is a fingerprint. Paste the full PEM private key instead.');
if (privateKey && !privateKey.includes('BEGIN') && !privateKey.includes('PRIVATE KEY')) errors.push('GITHUB_PRIVATE_KEY does not look like a PEM private key.');

const publicKey = value('PAYSTACK_PUBLIC_KEY');
const secretKey = value('PAYSTACK_SECRET_KEY');
const paystackTest = publicKey.startsWith('pk_test_') && secretKey.startsWith('sk_test_');
const paystackLive = publicKey.startsWith('pk_live_') && secretKey.startsWith('sk_live_');
if (!paystackTest && !paystackLive) errors.push('Paystack public and secret keys must be a matching test or live pair.');
if (value('PAYSTACK_REQUIRE_LIVE').toLowerCase() === 'true' && !paystackLive) errors.push('PAYSTACK_REQUIRE_LIVE is true, so matching pk_live_ and sk_live_ keys are required.');
else if (paystackTest) warnings.push('Paystack is configured in test mode; replace both keys with live keys before accepting real payments.');

productionUrl('FRONTEND_URL');
productionUrl('BACKEND_URL');
productionUrl('PAYSTACK_CALLBACK_URL');
productionUrl('GITHUB_CALLBACK_URL');
productionUrl(process.env.GITHUB_OAUTH_CALLBACK_URL ? 'GITHUB_OAUTH_CALLBACK_URL' : 'GITHUB_AUTH_CALLBACK_URL');
required('RENDER_API_KEY', 10);
required('RENDER_WORKSPACE_ID', 5);
required('RENDER_BACKEND_SERVICE_ID', 5);
required('RENDER_FRONTEND_SERVICE_ID', 5);
if (value('DOMAIN_API_MODE').toLowerCase() !== 'live') errors.push('DOMAIN_API_MODE must be live for production.');
if (value('DOMAIN_API_ALLOW_CUSTOM_BASE').toLowerCase() === 'true') warnings.push('DOMAIN_API_ALLOW_CUSTOM_BASE is enabled; confirm the custom registrar endpoint is intentional.');
if (domainSearchTlds.length !== 200 || new Set(domainSearchTlds).size !== 200) errors.push('The domain search catalog must contain exactly 200 unique TLDs.');
if (value('NODE_ENV') !== 'production') warnings.push('NODE_ENV is not production.');
if (Boolean(value('DEPLOYMENT_WORKER_URL')) !== Boolean(value('DEPLOYMENT_WORKER_TOKEN'))) errors.push('Set both DEPLOYMENT_WORKER_URL and DEPLOYMENT_WORKER_TOKEN, or leave both empty when using direct Render deployments.');

if (warnings.length) console.warn(`Warnings:\n- ${warnings.join('\n- ')}`);
if (errors.length) {
  console.error(`Environment preflight failed:\n- ${errors.join('\n- ')}`);
  process.exit(1);
}
console.log('Environment preflight passed.');
