/* Aggiornamento online dell'estensione per Chrome ed Edge, senza reinstallare il pacchetto Jobdossiers.
 * L'estensione (non pacchettizzata) si carica da una cartella che l'app ha preparato: qui si scarica dall'ultima release del repo pubblico
 * il pacchetto Jobdossiers-estensione.json.gz con la sua firma Ed25519 (.sig), lo si verifica con la chiave pubblica qui sotto
 * (la privata è solo nei secrets del repo pubblico e firma in release.yml), si controllano versione e compatibilità con questo server
 * e si sostituisce la cartella in un colpo solo. Poi l'estensione si ricarica (chrome.runtime.reload). Firma non valida: nulla cambia. */
import { homedir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { mkdir, writeFile, rm, rename, readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { verify, createPublicKey, createHash } from 'node:crypto';
import { ApiError } from './api.js';

export const UPDATE_BASE = 'https://github.com/SwissSecurityInsights/jobdossiers-mcp-public/releases/latest/download/';
export const BUNDLE = 'Jobdossiers-estensione.json.gz';
export const UPDATE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA8ureIqjJv8Ws8cX9dOHuw29CEbUm5yn1jgFHktxOv3E=
-----END PUBLIC KEY-----`;
/** Versione del protocollo con l'estensione (azioni del native messaging). Un'estensione che chiede di più aspetta un pacchetto completo nuovo. */
export const NATIVE_PROTOCOL = 2;
const MAX_BUNDLE = 5 * 1024 * 1024, MAX_UNPACKED = 20 * 1024 * 1024, MAX_FILES = 200;
const PATH = /^(?:[A-Za-z0-9_-]+\/){0,3}[A-Za-z0-9_.-]+\.(?:js|json|html|css|png|svg)$/;

/** Cartella da cui il browser carica l'estensione: quella preparata dall'app per Mac o dall'installer per Windows. */
export function extensionDir({ platform = process.platform, env = process.env, home = homedir() } = {}) {
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'Jobdossiers', 'estensione');
  if (platform === 'win32') return join(env.LOCALAPPDATA || join(home, 'AppData', 'Local'), 'Jobdossiers', 'estensione');
  return join(env.XDG_CONFIG_HOME || join(home, '.config'), 'jobdossiers', 'estensione');
}

/** -1, 0, 1 tra versioni «1.2.3». */
export function cmpVersion(a, b) {
  const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return Math.sign(d); }
  return 0;
}

/** Verifica la firma e apre il pacchetto. Eccezione se qualcosa non torna: nessun file viene scritto prima di questo controllo. */
export function openBundle(gz, sigB64, publicKey = UPDATE_PUBLIC_KEY) {
  let ok = false;
  try { ok = verify(null, gz, createPublicKey(publicKey), Buffer.from(String(sigB64).trim(), 'base64')); } catch { ok = false; }
  if (!ok) throw new ApiError('bad_signature', { message: 'Firma del pacchetto dell\'estensione non valida: aggiornamento rifiutato' });
  let b;
  try { b = JSON.parse(gunzipSync(gz, { maxOutputLength: MAX_UNPACKED }).toString('utf8')); } catch { throw new ApiError('bad_bundle', { message: 'Pacchetto dell\'estensione illeggibile' }); }
  const names = b && typeof b.files === 'object' && b.files ? Object.keys(b.files) : [];
  const valid = b && b.format === 1 && /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(b.version) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(b.built_at)
    && Number.isInteger(b.protocol) && names.length > 0 && names.length <= MAX_FILES && names.includes('manifest.json')
    && names.every(n => PATH.test(n) && !n.split('/').includes('..') && typeof b.files[n] === 'string');
  if (!valid) throw new ApiError('bad_bundle', { message: 'Pacchetto dell\'estensione non valido' });
  return b;
}

const keyOf = async dir => { try { return JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')).key || ''; } catch { return null; } };

async function download(url, fetchImpl) {
  let r;
  try { r = await fetchImpl(url, { redirect: 'follow', signal: AbortSignal.timeout(30000) }); }
  catch (e) { throw new ApiError('network', { message: 'Aggiornamento non raggiungibile (' + (e?.cause?.code || e?.name || 'errore') + ')' }); }
  if (r.status === 404) return null;
  if (!r.ok) throw new ApiError('http_' + r.status, { message: 'Aggiornamento non disponibile' });
  const u8 = new Uint8Array(await r.arrayBuffer());
  if (u8.length > MAX_BUNDLE) throw new ApiError('too_large', { message: 'Pacchetto dell\'estensione troppo grande' });
  return Buffer.from(u8);
}

/**
 * current: { version, build } dell'estensione caricata. Ritorna { updated, version?, built_at?, reason? }.
 * reason: up_to_date, no_bundle (la release non ha ancora il pacchetto), app_too_old (serve il pacchetto Jobdossiers completo),
 * not_managed (la cartella non è quella preparata dall'app: non si tocca).
 */
export async function updateExtension({ current = {}, fetchImpl = globalThis.fetch, dir = extensionDir(), base = UPDATE_BASE, publicKey = UPDATE_PUBLIC_KEY } = {}) {
  const gz = await download(base + BUNDLE, fetchImpl);
  if (!gz) return { updated: false, reason: 'no_bundle' };
  const sig = await download(base + BUNDLE + '.sig', fetchImpl);
  if (!sig) return { updated: false, reason: 'no_bundle' };
  const b = openBundle(gz, sig.toString('utf8'), publicKey);
  const info = { version: b.version, built_at: b.built_at };
  if (b.protocol > NATIVE_PROTOCOL) return { updated: false, reason: 'app_too_old', ...info };
  const c = cmpVersion(b.version, current.version || '0.0.0');
  if (c < 0 || (c === 0 && b.built_at <= String(current.build || ''))) return { updated: false, reason: 'up_to_date', ...info };
  // si sostituisce solo la cartella preparata dall'app, con la stessa estensione (stessa chiave pubblica nel manifest, quindi stesso ID)
  const newKey = JSON.parse(Buffer.from(b.files['manifest.json'], 'base64').toString('utf8')).key || '';
  const oldKey = await keyOf(dir);
  if (oldKey === null || !newKey || oldKey !== newKey) return { updated: false, reason: 'not_managed', ...info };
  const tmp = join(dirname(dir), basename(dir) + '.nuova'), old = join(dirname(dir), basename(dir) + '.vecchia');
  await rm(tmp, { recursive: true, force: true }); await rm(old, { recursive: true, force: true });
  for (const [name, data] of Object.entries(b.files)) {
    const p = join(tmp, ...name.split('/'));
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, Buffer.from(data, 'base64'));
  }
  await rename(dir, old);
  try { await rename(tmp, dir); } catch (e) { await rename(old, dir); throw e; }
  await rm(old, { recursive: true, force: true });
  return { updated: true, ...info };
}

// ── Aggiornamento automatico delle app (Mac e Windows) ──
// La release pubblica latest.json (versione e SHA-256 degli installer) firmato con la stessa chiave: prima la firma, poi l'impronta.

export const INSTALLERS = { darwin: 'Jobdossiers-mac-arm64.pkg', win32: 'Jobdossiers-Setup-x64.exe' };

/** latest.json verificato: { version, published_at, files: { nome: { sha256, size } } }. */
export async function latestRelease({ fetchImpl = globalThis.fetch, base = UPDATE_BASE, publicKey = UPDATE_PUBLIC_KEY } = {}) {
  const body = await download(base + 'latest.json', fetchImpl);
  const sig = body && await download(base + 'latest.json.sig', fetchImpl);
  if (!body || !sig) return null;
  let ok = false;
  try { ok = verify(null, body, createPublicKey(publicKey), Buffer.from(sig.toString('utf8').trim(), 'base64')); } catch { ok = false; }
  if (!ok) throw new ApiError('bad_signature', { message: 'Firma dell\'aggiornamento non valida: ignorato' });
  let j;
  try { j = JSON.parse(body.toString('utf8')); } catch { throw new ApiError('bad_bundle', { message: 'Descrizione dell\'aggiornamento illeggibile' }); }
  if (j?.format !== 1 || !/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(j.version) || typeof j.files !== 'object' || !j.files) throw new ApiError('bad_bundle', { message: 'Descrizione dell\'aggiornamento non valida' });
  return j;
}

/** C'è una versione più nuova dell'app per questo sistema? → { available, version, current, installer? } */
export async function checkApp({ current, platform = process.platform, arch = process.arch, ...opts } = {}) {
  const rel = await latestRelease(opts);
  if (!rel) return { available: false, current, reason: 'no_manifest' };
  const name = INSTALLERS[platform];
  const supported = name && rel.files[name] && !(platform === 'darwin' && arch !== 'arm64');
  if (!supported) return { available: false, current, version: rel.version, reason: 'no_installer' };
  return { available: cmpVersion(rel.version, current) > 0, current, version: rel.version, installer: name };
}

/** Scarica l'installer dell'ultima versione in dir e lo controlla con l'impronta firmata. → { path, version } */
export async function downloadApp({ current, dir, platform = process.platform, arch = process.arch, fetchImpl = globalThis.fetch, base = UPDATE_BASE, publicKey = UPDATE_PUBLIC_KEY, maxBytes = 300 * 1024 * 1024 } = {}) {
  const c = await checkApp({ current, platform, arch, fetchImpl, base, publicKey });
  if (!c.available) return { path: null, ...c };
  const rel = await latestRelease({ fetchImpl, base, publicKey });
  const want = rel.files[c.installer];
  let r;
  try { r = await fetchImpl(base + c.installer, { redirect: 'follow', signal: AbortSignal.timeout(10 * 60 * 1000) }); }
  catch (e) { throw new ApiError('network', { message: 'Download dell\'aggiornamento non riuscito (' + (e?.cause?.code || e?.name || 'errore') + ')' }); }
  if (!r.ok) throw new ApiError('http_' + r.status, { message: 'Installer non disponibile' });
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > maxBytes || buf.length !== want.size || createHash('sha256').update(buf).digest('hex') !== want.sha256)
    throw new ApiError('bad_installer', { message: 'L\'installer scaricato non corrisponde a quello firmato: aggiornamento annullato' });
  await mkdir(dir, { recursive: true });
  const path = join(dir, c.installer.replace(/(\.\w+)$/, `-${rel.version}$1`));
  await writeFile(path, buf);
  return { path, version: rel.version };
}
