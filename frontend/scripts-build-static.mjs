import fs from 'node:fs';
import path from 'node:path';

function loadLocalEnv(file) {
  if (!fs.existsSync(file)) return {};
  const values = {};
  for (const rawLine of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index < 1) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('\"') && value.endsWith('\"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    values[key] = value;
  }
  return values;
}

const root = process.cwd();
const localEnv = loadLocalEnv(path.join(root, '.env'));
const env = { ...localEnv, ...process.env };
const dist = path.join(root, 'dist');
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

const skip = new Set(['node_modules', 'dist', '.git']);
const skipFiles = new Set(['package.json', 'package-lock.json', 'server.js', '.env', '.env.sample', '.env.example', 'scripts-build-static.mjs', 'scripts-build-env.mjs']);
function copyDir(src, dest) {
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (skip.has(entry.name) || skipFiles.has(entry.name)) continue;
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) { fs.mkdirSync(to, { recursive: true }); copyDir(from, to); }
    else fs.copyFileSync(from, to);
  }
}
copyDir(root, dist);

const configuredApiBase = env.WORLDNET_API_BASE_URL || env.VITE_API_BASE_URL || env.BACKEND_URL || '';
const productionFallback = 'https://world-net-hosting-backend.onrender.com/api';
const apiBase = String(configuredApiBase || productionFallback).replace(/\/$/, '');
if (!(apiBase === '/api' || (/^https?:\/\//i.test(apiBase) && /\/api$/i.test(apiBase)))) {
  throw new Error('WORLDNET_API_BASE_URL/VITE_API_BASE_URL must be /api or a complete backend URL ending in /api.');
}
const paystackPublicKey = String(env.WORLDNET_PAYSTACK_PUBLIC_KEY || env.VITE_PAYSTACK_PUBLIC_KEY || '');
const defaultCurrency = String(env.WORLDNET_DEFAULT_DISPLAY_CURRENCY || env.VITE_DEFAULT_DISPLAY_CURRENCY || 'USD').toUpperCase();
const frontendUrl = String(env.FRONTEND_URL || env.WORLDNET_FRONTEND_URL || env.VITE_FRONTEND_URL || '').replace(/\/$/, '');
const envFile = path.join(dist, 'assets/js/env.js');
fs.mkdirSync(path.dirname(envFile), { recursive: true });
const apiCandidates = [...new Set([apiBase, productionFallback, '/api'].filter(Boolean))];
fs.writeFileSync(envFile, `(function configureWorldNetHosting(){const candidates=Object.freeze(${JSON.stringify(apiCandidates)});window.WORLDNET_CONFIG=Object.freeze({API_BASE_URL:${JSON.stringify(apiBase)},API_CANDIDATES:candidates,PAYSTACK_PUBLIC_KEY:${JSON.stringify(paystackPublicKey)},DEFAULT_DISPLAY_CURRENCY:${JSON.stringify(defaultCurrency)},FRONTEND_URL:${JSON.stringify(frontendUrl)}});window.WORLDNET_API_BASE=${JSON.stringify(apiBase)};window.WORLDNET_API_BASE_URL=${JSON.stringify(apiBase)};window.WORLDNET_API_CANDIDATES=candidates;})();\n`);
console.log(`Built complete static site in ${dist}`);
