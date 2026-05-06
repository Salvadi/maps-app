const fs = require('fs');
const path = require('path');

const swPath = path.join(__dirname, '..', 'build', 'service-worker.js');

if (!fs.existsSync(swPath)) {
  console.error('❌ build/service-worker.js not found — run this after craco build');
  process.exit(1);
}

const version = Date.now();
let content = fs.readFileSync(swPath, 'utf8');

if (!/const CACHE_VERSION = \d+;/.test(content)) {
  console.error('❌ CACHE_VERSION pattern not found in service-worker.js');
  process.exit(1);
}

content = content.replace(/const CACHE_VERSION = \d+;/, `const CACHE_VERSION = ${version};`);
fs.writeFileSync(swPath, content);
console.log(`✅ Injected CACHE_VERSION = ${version} into build/service-worker.js`);
