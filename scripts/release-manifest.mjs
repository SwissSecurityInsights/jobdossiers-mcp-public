#!/usr/bin/env node
/* latest.json della release: versione e impronte SHA-256 degli installer e del pacchetto dell'estensione, firmato Ed25519.
 * Le app lo scaricano, ne verificano la firma con la chiave pubblica in src/update.js e poi controllano l'installer con l'impronta.
 * Uso: node scripts/release-manifest.mjs <cartella dist> --sign-env NOME   (chiave privata PEM nella variabile NOME, mai su disco) */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, sign, createPrivateKey } from 'node:crypto';

const dir = process.argv[2];
if (!dir) { console.error('Uso: node scripts/release-manifest.mjs <dist> --sign-env NOME'); process.exit(2); }
const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const WANTED = /^(Jobdossiers-mac-arm64\.pkg|Jobdossiers-Setup-x64\.exe|Jobdossiers-estensione\.json\.gz)$/;
const files = {};
for (const n of readdirSync(dir).filter(n => WANTED.test(n)).sort()) {
  const b = readFileSync(join(dir, n));
  files[n] = { sha256: createHash('sha256').update(b).digest('hex'), size: b.length };
}
const body = Buffer.from(JSON.stringify({ format: 1, version, published_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'), files }, null, 2) + '\n');
writeFileSync(join(dir, 'latest.json'), body);
const i = process.argv.indexOf('--sign-env');
if (i > 0) {
  const pem = process.env[process.argv[i + 1]] || '';
  if (!pem.trim()) { console.error('Chiave di firma assente: latest.json non firmato'); process.exit(1); }
  writeFileSync(join(dir, 'latest.json.sig'), sign(null, body, createPrivateKey(pem)).toString('base64') + '\n');
}
console.log(`latest.json: versione ${version}, ${Object.keys(files).length} file${i > 0 ? ', firmato' : ''}`);
