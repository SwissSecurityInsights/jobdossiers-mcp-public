#!/usr/bin/env node
/* Pacchetto dell'estensione per l'aggiornamento online (src/update.js): JSON compresso con i file di extension/ e build.json,
 * firmato Ed25519. Uso: node scripts/extension-bundle.mjs <uscita.json.gz> [--sign-env NOME]
 * Con --sign-env la chiave privata (PEM) si legge dalla variabile d'ambiente NOME (secret di GitHub) e non tocca mai il disco:
 * accanto al pacchetto si scrive <uscita>.sig (firma in base64). */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { gzipSync } from 'node:zlib';
import { sign, createPrivateKey } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const out = process.argv[2];
if (!out) { console.error('Uso: node scripts/extension-bundle.mjs <uscita.json.gz> [--sign-env NOME]'); process.exit(2); }
const root = new URL('../extension/', import.meta.url).pathname;
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
const { protocol } = JSON.parse(readFileSync(join(root, 'compat.json'), 'utf8'));
let commit = 'sviluppo';
try { commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { /* fuori da git */ }
const built_at = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

const files = {};
const walk = d => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else files[relative(root, p).split(sep).join('/')] = readFileSync(p).toString('base64'); } };
walk(root);
files['build.json'] = Buffer.from(JSON.stringify({ built_at, commit }) + '\n').toString('base64');

const gz = gzipSync(Buffer.from(JSON.stringify({ format: 1, version: manifest.version, built_at, commit, protocol, files })));
writeFileSync(out, gz);
const i = process.argv.indexOf('--sign-env');
if (i > 0) {
  const pem = process.env[process.argv[i + 1]] || '';
  if (!pem.trim()) { console.error('Chiave di firma assente: pacchetto non firmato'); process.exit(1); }
  writeFileSync(out + '.sig', sign(null, gz, createPrivateKey(pem)).toString('base64') + '\n');
}
console.log(`${out}: estensione ${manifest.version}, ${Object.keys(files).length} file, ${gz.length} byte${i > 0 ? ', firmato' : ''}`);
