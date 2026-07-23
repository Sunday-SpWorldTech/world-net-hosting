process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-jwt-secret-that-is-longer-than-thirty-two-characters';
process.env.ADMIN_LOGIN_PIN = process.env.ADMIN_LOGIN_PIN || '12121991';
const { app } = require('./server');

(async () => {
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    for (const route of ['/api/health', '/api/github/status']) {
      const response = await fetch(`${baseUrl}${route}`);
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(`${route} failed: ${response.status}`);
    }
    for (const route of ['/api/domains/provider-status','/api/hosting/projects','/api/wallet']) {
      const response=await fetch(`${baseUrl}${route}`);
      if(response.status!==401)throw new Error(`Expected ${route} to require authentication, received ${response.status}`);
    }
    const paymentConfig=await fetch(`${baseUrl}/api/payments/paystack/config`).then(response=>response.json());
    if('secretKey' in paymentConfig)throw new Error('Payment config exposed a secret key.');
    const missing = await fetch(`${baseUrl}/api/does-not-exist`);
    if (missing.status !== 404) throw new Error(`Expected API 404, received ${missing.status}`);
    console.log('Backend route smoke test passed.');
  } finally {
    server.close();
  }
})().catch((error) => { console.error(error); process.exit(1); });
