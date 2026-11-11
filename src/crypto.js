/* Cifratura del client per agenti di Jobdossiers. Solo WebCrypto, nessuna dipendenza.
 * Formato e derivazione come in public/assets/e2ee.js del portale e in /openapi.json:
 *   KEK = HKDF-SHA256(ikm = segreto, salt = vuoto, info = "jd-agent-kek") -> AES-256-GCM
 *   blob = {"v":1,"iv":<base64, 12 byte>,"ct":<base64, testo cifrato + tag da 16 byte>}
 */
const S = globalThis.crypto.subtle;
const TE = new TextEncoder();
const TD = new TextDecoder();
const AES = { name: 'AES-GCM', length: 256 };
const B64U = /^[A-Za-z0-9_-]{43}$/;

export const AAD = Object.freeze({ app: 'jd1:app', docmeta: 'jd1:docmeta', doc: 'jd1:doc', agenda: 'jd1:agenda' });

export class KeyFormatError extends Error {
  constructor() { super('Formato della chiave non valido: atteso jda1.<token>.<segreto>'); this.name = 'KeyFormatError'; }
}

const b64 = u8 => Buffer.from(u8).toString('base64');
const unb64 = s => new Uint8Array(Buffer.from(String(s), 'base64'));

/** Scompone `jda1.<token>.<segreto>`. Il messaggio d'errore non contiene mai la chiave. */
export function parseKey(text) {
  const p = String(text ?? '').trim().split('.');
  if (p.length !== 3 || p[0] !== 'jda1' || !B64U.test(p[1]) || !B64U.test(p[2])) throw new KeyFormatError();
  return { token: p[1], secret: p[2] };
}

const hkdfParams = info => ({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: TE.encode(info) });

export async function agentKek(secret) {
  const raw = new Uint8Array(Buffer.from(String(secret), 'base64url'));
  const base = await S.importKey('raw', raw, 'HKDF', false, ['deriveKey']);
  return S.deriveKey(hkdfParams('jd-agent-kek'), base, AES, false, ['wrapKey', 'unwrapKey']);
}

function parseBlob(blob) {
  const j = typeof blob === 'string' ? JSON.parse(blob) : blob;
  if (!j || j.v !== 1 || typeof j.iv !== 'string' || typeof j.ct !== 'string') throw new Error('blob non valido');
  const iv = unb64(j.iv);
  if (iv.length !== 12) throw new Error('blob non valido');
  return { iv, ct: unb64(j.ct) };
}

/** Apre la chiave dati avvolta per l'agente; la chiave resta non estraibile. */
export async function openDek(secret, wrappedBlob) {
  const { iv, ct } = parseBlob(wrappedBlob);
  return S.unwrapKey('raw', ct, await agentKek(secret), { name: 'AES-GCM', iv }, AES, false, ['encrypt', 'decrypt']);
}

/** Solo per i test: avvolge una chiave dati estraibile con il segreto, come fa il browser. */
export async function wrapDekForAgent(dek, secret) {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await S.wrapKey('raw', dek, await agentKek(secret), { name: 'AES-GCM', iv }));
  return JSON.stringify({ v: 1, iv: b64(iv), ct: b64(ct) });
}

export async function encObj(dek, obj, aad) {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await S.encrypt({ name: 'AES-GCM', iv, additionalData: TE.encode(aad) }, dek, TE.encode(JSON.stringify(obj))));
  return JSON.stringify({ v: 1, iv: b64(iv), ct: b64(ct) });
}

export async function decObj(dek, blob, aad) {
  const { iv, ct } = parseBlob(blob);
  return JSON.parse(TD.decode(await S.decrypt({ name: 'AES-GCM', iv, additionalData: TE.encode(aad) }, dek, ct)));
}

/** File: IV (12 byte) || testo cifrato || tag (16 byte), byte grezzi e non blob JSON, come encBytes in public/assets/e2ee.js. */
export async function encBytes(dek, u8, aad) {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await S.encrypt({ name: 'AES-GCM', iv, additionalData: TE.encode(aad) }, dek, u8));
  const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12);
  return out;
}

export async function decBytes(dek, u8, aad) {
  return new Uint8Array(await S.decrypt({ name: 'AES-GCM', iv: u8.subarray(0, 12), additionalData: TE.encode(aad) }, dek, u8.subarray(12)));
}
