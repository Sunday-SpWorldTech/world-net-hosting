'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SOURCE_ROOT = __dirname;
const ROOT = fs.existsSync(path.join(SOURCE_ROOT, 'dist', 'index.html')) ? path.join(SOURCE_ROOT, 'dist') : SOURCE_ROOT;
const PORT = Number(process.env.PORT || process.env.FRONTEND_PORT) || 5500;

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
      'Referrer-Policy': 'strict-origin-when-cross-origin'
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
  if (!['GET', 'HEAD'].includes(req.method || '')) {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    res.end();
    return;
  }

  const requestPath = String(req.url || '/').split('?')[0];
  if (requestPath === '/assets/js/env.js') {
    const configuredApi = String(process.env.WORLDNET_API_BASE_URL || '').trim().replace(/\/$/, '');
    const apiBaseUrl = configuredApi || 'https://world-net-hosting-backend.onrender.com/api';
    const paystackPublicKey = String(process.env.WORLDNET_PAYSTACK_PUBLIC_KEY || process.env.VITE_PAYSTACK_PUBLIC_KEY || '').trim();
    const defaultCurrency = String(process.env.WORLDNET_DEFAULT_DISPLAY_CURRENCY || process.env.VITE_DEFAULT_DISPLAY_CURRENCY || 'USD').trim().toUpperCase();
    const body = `(function configureWorldNetHosting(){window.WORLDNET_CONFIG={API_BASE_URL:${JSON.stringify(apiBaseUrl)},PAYSTACK_PUBLIC_KEY:${JSON.stringify(paystackPublicKey)},DEFAULT_DISPLAY_CURRENCY:${JSON.stringify(defaultCurrency)},FRONTEND_URL:'https://world-net-hosting-frontend.onrender.com'};})();`;
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
