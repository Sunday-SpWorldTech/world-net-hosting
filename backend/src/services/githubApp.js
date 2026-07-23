const crypto = require('crypto');

function base64url(input) { return Buffer.from(input).toString('base64url'); }
function appJwt() {
  const appId = String(process.env.GITHUB_APP_ID || '').trim();
  const privateKey = String(process.env.GITHUB_PRIVATE_KEY || '').replace(/^['\"]|['\"]$/g, '').replace(/\\n/g, '\n').replace(/\r/g, '').trim();
  if (!appId || !privateKey) throw Object.assign(new Error('GitHub App credentials are not configured.'), { status: 503 });
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: appId }));
  const unsigned = `${header}.${payload}`;
  let keyObject; try { keyObject = crypto.createPrivateKey({ key: privateKey, format: 'pem' }); } catch (error) { throw Object.assign(new Error('GitHub App private key is invalid. Re-add the complete PEM key in Render using escaped \\n line breaks.'), { status: 503, cause: error }); }
  const signature = crypto.sign('RSA-SHA256', Buffer.from(unsigned), keyObject).toString('base64url');
  return `${unsigned}.${signature}`;
}
async function githubRequest(path, options = {}, token) {
  const response = await fetch(`https://api.github.com${path}`, {
    ...options,
    signal: options.signal || AbortSignal.timeout(30000),
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'World-Net-Hosting',
      Authorization: `Bearer ${token || appJwt()}`,
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let data; try { data = text ? JSON.parse(text) : {}; } catch { data = { message: text }; }
  if (!response.ok) throw Object.assign(new Error(data.message || `GitHub returned HTTP ${response.status}`), { status: response.status, details: data });
  return data;
}
async function installationToken(installationId) {
  const data = await githubRequest(`/app/installations/${installationId}/access_tokens`, { method: 'POST' });
  return data.token;
}
function verifyWebhook(raw, signature) {
  const secret = String(process.env.GITHUB_WEBHOOK_SECRET || '');
  if (!secret || !signature) return false;
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(raw).digest('hex')}`;
  const a = Buffer.from(expected); const b = Buffer.from(String(signature));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
module.exports = { githubRequest, installationToken, verifyWebhook };
