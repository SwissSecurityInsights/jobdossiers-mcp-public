/* Collegamento del dispositivo senza copiare la chiave (docs/collega-dispositivo.md).
 * 1. Qui: coppia ECDH P-256 temporanea, state casuale, ascolto su 127.0.0.1 (porta casuale, una sola risposta, pochi minuti).
 * 2. Il browser apre <portale>/link.php?v=1&port&state&pub&name: login, consenso, il browser crea la chiave per automazioni (come in Account)
 *    e la cifra per questa coppia (ECDH + HKDF + AES-GCM), poi rimanda a http://127.0.0.1:<port>/cb?state&epk&iv&ct.
 * 3. Qui si decifra e si salva nel Portachiavi / DPAPI. Il segreto non passa mai in chiaro dal portale, né da riga di comando, log o output. */
import http from 'node:http';
import { hostname } from 'node:os';
import { timingSafeEqual } from 'node:crypto';
import { parseKey } from './crypto.js';
import { checkBase } from './api.js';

const S = globalThis.crypto.subtle;
const TE = new TextEncoder(), TD = new TextDecoder();
export const LINK_VERSION = 1;
export const LINK_AAD = 'jd1:link';
export const LINK_INFO = 'jd-link-v1';
const b64u = u8 => Buffer.from(u8).toString('base64url');
const unb64u = s => new Uint8Array(Buffer.from(String(s ?? ''), 'base64url'));
const ECDH = { name: 'ECDH', namedCurve: 'P-256' };

/** Chiave AES-GCM condivisa: ECDH(P-256) → HKDF-SHA256(salt = state, info = "jd-link-v1"). Stessa funzione dalle due parti. */
export async function sharedKey(myPrivate, theirPublicRaw, stateBytes) {
  const pub = await S.importKey('raw', theirPublicRaw, ECDH, false, []);
  const bits = await S.deriveBits({ name: 'ECDH', public: pub }, myPrivate, 256);
  const ikm = await S.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
  return S.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: stateBytes, info: TE.encode(LINK_INFO) }, ikm, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/** Lato browser, di riferimento (il portale lo fa in public/assets/e2ee.js): cifra la chiave jda1.… per la coppia dell'app. */
export async function sealForApp(keyText, appPubB64u, stateB64u) {
  const eph = await S.generateKey(ECDH, true, ['deriveBits']);
  const k = await sharedKey(eph.privateKey, unb64u(appPubB64u), unb64u(stateB64u));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await S.encrypt({ name: 'AES-GCM', iv, additionalData: TE.encode(LINK_AAD) }, k, TE.encode(keyText)));
  return { epk: b64u(new Uint8Array(await S.exportKey('raw', eph.publicKey))), iv: b64u(iv), ct: b64u(ct) };
}

const PAGE = (title, text) => `<!doctype html><html lang="it"><head><meta charset="utf-8"><title>Jobdossiers</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1rem;color:#222}h1{font-size:1.3rem}</style></head>
<body><h1>${title}</h1><p>${text}</p></body></html>`;

export class LinkError extends Error { constructor(code, message) { super(message); this.name = 'LinkError'; this.code = code; } }

/**
 * Avvia l'ascolto e ritorna { url, done }: url da aprire nel browser, done si risolve con la chiave (testo jda1.…) o si rifiuta con LinkError.
 * base: indirizzo del portale (controllato come JD_URL); name: nome del dispositivo mostrato nel consenso; timeoutMs: attesa massima.
 */
export async function startLink({ base = 'https://jobdossiers.ch', name = hostname(), timeoutMs = 5 * 60 * 1000, allowAnyHost = false } = {}) {
  const root = checkBase(base, { allowAnyHost });
  const pair = await S.generateKey(ECDH, true, ['deriveBits']);
  const pub = b64u(new Uint8Array(await S.exportKey('raw', pair.publicKey)));
  const stateBytes = globalThis.crypto.getRandomValues(new Uint8Array(32));
  const state = b64u(stateBytes);
  let settle;
  const done = new Promise((resolve, reject) => { settle = { resolve, reject }; });
  done.catch(() => {});        // l'esito può arrivare prima che qualcuno aspetti: chi aspetta riceve comunque l'errore
  let finished = false;

  const server = http.createServer(async (req, res) => {
    const reply = (code, title, text) => { res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }); res.end(PAGE(title, text)); };
    let u;
    try { u = new URL(req.url, 'http://127.0.0.1'); } catch { return reply(400, 'Richiesta non valida', ''); }
    if (req.method !== 'GET' || u.pathname !== '/cb' || finished) return reply(404, 'Pagina non trovata', '');
    const got = unb64u(u.searchParams.get('state'));
    if (got.length !== stateBytes.length || !timingSafeEqual(got, stateBytes)) return reply(400, 'Collegamento non valido', 'Questa risposta non corrisponde alla richiesta dell\'app. Riprova dall\'app.');
    finished = true;
    const end = (err, key) => { clearTimeout(timer); server.close(); err ? settle.reject(err) : settle.resolve(key); };
    if (u.searchParams.get('error')) {
      reply(200, 'Collegamento annullato', 'Nessuna chiave è stata creata. Puoi chiudere questa scheda.');
      return end(new LinkError('denied', 'Collegamento annullato nel browser'));
    }
    try {
      const k = await sharedKey(pair.privateKey, unb64u(u.searchParams.get('epk')), stateBytes);
      const pt = await S.decrypt({ name: 'AES-GCM', iv: unb64u(u.searchParams.get('iv')), additionalData: TE.encode(LINK_AAD) }, k, unb64u(u.searchParams.get('ct')));
      const key = TD.decode(pt).trim();
      parseKey(key);
      reply(200, 'Dispositivo collegato', 'L\'app ha ricevuto la chiave e la salva su questo computer. Puoi chiudere questa scheda.');
      end(null, key);
    } catch {
      reply(400, 'Collegamento non riuscito', 'La risposta non si è potuta leggere. Riprova dall\'app.');
      end(new LinkError('bad_payload', 'Risposta del browser non valida'));
    }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const timer = setTimeout(() => { if (!finished) { finished = true; server.close(); settle.reject(new LinkError('timeout', 'Tempo scaduto: nessuna risposta dal browser')); } }, timeoutMs);
  const q = new URLSearchParams({ v: String(LINK_VERSION), port: String(server.address().port), state, pub, name: String(name).slice(0, 80) });
  return { url: `${root}/link.php?${q}`, done, port: server.address().port, cancel: () => { if (!finished) { finished = true; clearTimeout(timer); server.close(); settle.reject(new LinkError('cancelled', 'Annullato')); } } };
}
