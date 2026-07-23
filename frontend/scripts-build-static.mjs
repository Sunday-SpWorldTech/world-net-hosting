import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
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

const apiBase = String(process.env.WORLDNET_API_BASE_URL || process.env.VITE_API_BASE_URL || 'https://world-net-hosting-backend.onrender.com/api').replace(/\/$/, '');
const paystackPublicKey = String(process.env.WORLDNET_PAYSTACK_PUBLIC_KEY || process.env.VITE_PAYSTACK_PUBLIC_KEY || '');
const defaultCurrency = String(process.env.WORLDNET_DEFAULT_DISPLAY_CURRENCY || process.env.VITE_DEFAULT_DISPLAY_CURRENCY || 'USD').toUpperCase();
const frontendUrl = String(process.env.FRONTEND_URL || process.env.WORLDNET_FRONTEND_URL || 'https://world-net-hosting-frontend.onrender.com').replace(/\/$/, '');
const envFile = path.join(dist, 'assets/js/env.js');
fs.mkdirSync(path.dirname(envFile), { recursive: true });
fs.writeFileSync(envFile, `(function configureWorldNetHosting(){window.WORLDNET_CONFIG={API_BASE_URL:${JSON.stringify(apiBase)},PAYSTACK_PUBLIC_KEY:${JSON.stringify(paystackPublicKey)},DEFAULT_DISPLAY_CURRENCY:${JSON.stringify(defaultCurrency)},FRONTEND_URL:${JSON.stringify(frontendUrl)}};})();\n`);
console.log(`Built complete static site in ${dist}`);
