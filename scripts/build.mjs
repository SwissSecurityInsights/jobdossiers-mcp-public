#!/usr/bin/env node
/* Eseguibili autocontenuti con `bun build --compile`. Uso: node scripts/build.mjs [darwin-arm64 darwin-x64 windows-x64 linux-x64]
 * Senza argomenti costruisce i tre target principali. Scrive in dist/ e crea SHA256SUMS. */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const TARGETS = { 'darwin-arm64': 'bun-darwin-arm64', 'darwin-x64': 'bun-darwin-x64', 'windows-x64': 'bun-windows-x64', 'linux-x64': 'bun-linux-x64' };
const wanted = process.argv.slice(2).length ? process.argv.slice(2) : ['darwin-arm64', 'darwin-x64', 'windows-x64'];
mkdirSync('dist', { recursive: true });
for (const t of wanted) {
  if (!TARGETS[t]) { console.error('Target sconosciuto: ' + t); process.exit(2); }
  const out = join('dist', `jobdossiers-mcp-${t}${t.startsWith('windows') ? '.exe' : ''}`);
  const r = spawnSync('bun', ['build', '--compile', '--minify', `--target=${TARGETS[t]}`, 'src/index.js', '--outfile', out], { stdio: 'inherit' });
  if (r.error?.code === 'ENOENT') { console.error('bun non trovato: https://bun.sh'); process.exit(1); }
  if (r.status !== 0) process.exit(r.status || 1);
}
const sums = readdirSync('dist').filter(f => f.startsWith('jobdossiers-mcp-')).sort()
  .map(f => `${createHash('sha256').update(readFileSync(join('dist', f))).digest('hex')}  ${f}`);
writeFileSync(join('dist', 'SHA256SUMS'), sums.join('\n') + '\n');
console.log(sums.join('\n'));
