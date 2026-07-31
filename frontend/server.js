'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const httpProxy = require('http');
const httpsProxy = require('https');

const SOURCE_ROOT = __dirname;
const ROOT = fs.existsSync(path.join(SOURCE_ROOT, 'dist', 'index.html')) ? path.join(SOURCE_ROOT, 'dist') : SOURCE_ROOT;
const PORT = Number(process.env.PORT || process.env.FRONTEND_PORT) || 5500;
const frontendUrl = String(process.env.WORLDNET_FRONTEND_URL || process.env.VITE_FRONTEND_URL || '').trim().replace(/\/$/, '');
const configuredApiBase = String(process.env.WORLDNET_API_BASE_URL || process.env.VITE_API_BASE_URL || process.env.BACKEND_URL || '').trim().replace(/\/+$/, '');

function normalizedApiBase(value = '') {
  const clean = String(value || '').trim().replace(/\/+$/, '');
  if (!clean) return '';
  if (/\/api$/i.test(clean)) return clean;
  if (/^https?:\/\//i.test(clean)) return `${clean}/api`;
  return '';
}

function inferredBackendFromHost(host = '') {
  const hostname = String(host || '').split(':')[0].toLowerCase();
  if (!hostname.endsWith('.onrender.com')) return '';
  if (hostname.includes('-frontend.')) return `https://${hostname.replace('-frontend.', '-backend.')}/api`;
  return '';
}

function runtimeApiCandidates(req) {
  const requestHost = String(req.headers.host || '');
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const requestProtocol = forwardedProto || (req.socket.encrypted ? 'https' : 'http');
  const requestOrigin = requestHost ? `${requestProtocol}://${requestHost}` : '';
  const candidates = [
    normalizedApiBase(configuredApiBase),
    inferredBackendFromHost(requestHost),
    requestOrigin ? `${requestOrigin}/api` : '',
    '/api'
  ].filter(Boolean);
  return [...new Set(candidates)];
}

function proxyApiRequest(req, res) {
  const targetBase = normalizedApiBase(configuredApiBase);
  if (!targetBase || targetBase.startsWith('/')) {
    res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ success: false, message: 'Backend API URL is not configured on the frontend service. Set WORLDNET_API_BASE_URL to the live backend URL ending in /api.' }));
    return;
  }
  let target;
  try { target = new URL(targetBase); }
  catch {
    res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: false, message: 'The configured backend API URL is invalid.' }));
    return;
  }
  const requestPath = String(req.url || '/api');
  const suffix = requestPath.replace(/^\/api(?=\/|\?|$)/i, '');
  const targetPath = `${target.pathname.replace(/\/+$/, '')}${suffix || ''}` || '/api';
  const transport = target.protocol === 'https:' ? httpsProxy : httpProxy;
  const headers = { ...req.headers, host: target.host, 'x-forwarded-host': req.headers.host || '', 'x-forwarded-proto': String(req.headers['x-forwarded-proto'] || (req.socket.encrypted ? 'https' : 'http')) };
  delete headers['content-length'];
  const proxyReq = transport.request({ protocol: target.protocol, hostname: target.hostname, port: target.port || undefined, method: req.method, path: targetPath, headers, timeout: 50000 }, proxyRes => {
    const responseHeaders = { ...proxyRes.headers, 'cache-control': 'no-store' };
    delete responseHeaders['access-control-allow-origin'];
    delete responseHeaders['access-control-allow-credentials'];
    res.writeHead(proxyRes.statusCode || 502, responseHeaders);
    proxyRes.pipe(res);
  });
  proxyReq.on('timeout', () => proxyReq.destroy(new Error('Backend request timed out.')));
  proxyReq.on('error', error => {
    if (res.headersSent) return res.end();
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ success: false, message: `Frontend proxy could not reach the backend: ${error.message}` }));
  });
  req.pipe(proxyReq);
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.pdf': 'application/pdf'
};

function safePath(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0]);
  } catch {
    return null;
  }

  const clean = decoded.replace(/^\/+/, '');
  const resolved = path.resolve(ROOT, clean);
  if (resolved !== ROOT && !resolved.startsWith(ROOT + path.sep)) return null;
  return resolved;
}

function chooseFile(requestPath) {
  const candidates = [];
  const resolved = safePath(requestPath);
  if (!resolved) return null;

  if (requestPath === '/' || requestPath === '') {
    candidates.push(path.join(ROOT, 'index.html'));
  } else {
    candidates.push(resolved);
    if (!path.extname(resolved)) {
      candidates.push(`${resolved}.html`);
      candidates.push(path.join(resolved, 'index.html'));
    }
  }

  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      // Try the next candidate.
    }
  }

  // Keep direct page links working after refresh.
  return path.join(ROOT, 'index.html');
}

function sendFile(req, res, filePath) {
  fs.stat(filePath, (statError, stat) => {
    if (statError || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Page not found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const headers = {
      'Content-Type': contentType,
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=86400',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'SAMEORIGIN',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Resource-Policy': 'same-site',
      'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
      'Content-Security-Policy': "default-src 'self'; object-src 'none'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline' https://js.paystack.co; connect-src 'self' https://*.onrender.com https://api.paystack.co; frame-src https://checkout.paystack.com; base-uri 'self'; form-action 'self' https://checkout.paystack.com; frame-ancestors 'self'; upgrade-insecure-requests"
    };

    const acceptsGzip = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
    const compressible = /^(text\/|application\/(javascript|json|xml)|image\/svg\+xml)/.test(contentType);

    res.writeHead(200, acceptsGzip && compressible
      ? { ...headers, 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' }
      : headers);

    const stream = fs.createReadStream(filePath);
    stream.on('error', () => {
      if (!res.headersSent) res.writeHead(500);
      res.end('Unable to load file');
    });

    if (acceptsGzip && compressible) stream.pipe(zlib.createGzip()).pipe(res);
    else stream.pipe(res);
  });
}

const server = http.createServer((req, res) => {
  const method = String(req.method || 'GET').toUpperCase();
  const requestPath = String(req.url || '/').split('?')[0];

  if (requestPath === '/frontend-health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    if (method === 'HEAD') return res.end();
    return res.end(JSON.stringify({ ok: true, service: 'world-net-hosting-frontend', apiConfigured: Boolean(normalizedApiBase(configuredApiBase)), apiBase: normalizedApiBase(configuredApiBase) || null }));
  }

  if (/^\/api(?:\/|$)/i.test(requestPath)) return proxyApiRequest(req, res);

  if (!['GET', 'HEAD'].includes(method)) {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    res.end();
    return;
  }

  if (requestPath === '/assets/js/env.js') {
    const requestHost = String(req.headers.host || '');
    const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
    const requestProtocol = forwardedProto || (req.socket.encrypted ? 'https' : 'http');
    const requestOrigin = `${requestProtocol}://${requestHost}`;
    const candidates = runtimeApiCandidates(req);
    const apiBaseUrl = candidates[0] || '/api';
    const runtimeFrontendUrl = String(process.env.WORLDNET_FRONTEND_URL || process.env.VITE_FRONTEND_URL || requestOrigin).trim().replace(/\/$/, '');
    const paystackPublicKey = String(process.env.WORLDNET_PAYSTACK_PUBLIC_KEY || process.env.VITE_PAYSTACK_PUBLIC_KEY || '').trim();
    const defaultCurrency = String(process.env.WORLDNET_DEFAULT_DISPLAY_CURRENCY || process.env.VITE_DEFAULT_DISPLAY_CURRENCY || 'USD').trim().toUpperCase();
    const body = `(function configureWorldNetHosting(){const candidates=Object.freeze(${JSON.stringify(candidates)});window.WORLDNET_CONFIG=Object.freeze({API_BASE_URL:${JSON.stringify(apiBaseUrl)},API_CANDIDATES:candidates,PAYSTACK_PUBLIC_KEY:${JSON.stringify(paystackPublicKey)},DEFAULT_DISPLAY_CURRENCY:${JSON.stringify(defaultCurrency)},FRONTEND_URL:${JSON.stringify(runtimeFrontendUrl)}});window.WORLDNET_API_BASE=${JSON.stringify(apiBaseUrl)};window.WORLDNET_API_BASE_URL=${JSON.stringify(apiBaseUrl)};window.WORLDNET_API_CANDIDATES=candidates;})();`;
    res.writeHead(200, {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff'
    });
    if (req.method === 'HEAD') return res.end();
    return res.end(body);
  }

  const filePath = chooseFile(req.url || '/');
  if (!filePath) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Invalid request');
    return;
  }

  if (req.method === 'HEAD') {
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end();
    return;
  }

  sendFile(req, res, filePath);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`World Net Hosting frontend running on port ${PORT}`);
});

server.on('error', (error) => {
  console.error('Frontend server failed:', error.message);
  process.exit(1);
});
