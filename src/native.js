/* Native messaging di Chrome ed Edge: l'estensione «Jobdossiers» (extension/) parla con questo eseguibile, che cifra e salva come per i client MCP.
 * Il browser avvia l'eseguibile indicato nel manifest dell'host passando come argomento l'origine dell'estensione (chrome-extension://<id>/);
 * i messaggi sono JSON UTF-8 preceduti dalla lunghezza (uint32 little endian) su stdin e stdout.
 * Solo tre azioni, nessun'altra: status, find_duplicates, create. La chiave resta nel Portachiavi o in DPAPI: l'estensione non la vede mai. */
import { homedir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { mkdir, writeFile, rm, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { ApiError } from './api.js';

export const HOST_NAME = 'ch.jobdossiers.mcp';
/** ID dell'estensione: quello fissato dalla chiave pubblica in extension/manifest.json. Le versioni degli store avranno ID propri, da aggiungere qui. */
export const EXTENSION_IDS = ['glgadembfbimaofodjfmhcnjkfffinne'];
export const ALLOWED_ORIGINS = EXTENSION_IDS.map(id => `chrome-extension://${id}/`);
/** Azione dell'estensione → strumento MCP che la esegue (stesse regole e controlli). */
export const ACTIONS = Object.freeze({ status: 'jd_quota', find_duplicates: 'jd_find_duplicates', create: 'jd_create' });
const MAX_IN = 1024 * 1024;          // l'estensione manda al massimo una pagina di testo
const MAX_OUT = 1024 * 1024;         // limite di Chrome per i messaggi dall'host

/** Il browser passa l'origine dell'estensione come primo argomento (su Windows segue --parent-window=…). */
export const nativeOrigin = argv => argv.slice(2).find(a => /^chrome-extension:\/\/[a-p]{32}\/$/.test(a));

export function encode(obj) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  const head = Buffer.alloc(4); head.writeUInt32LE(body.length);
  return Buffer.concat([head, body]);
}

/** Legge i messaggi a lunghezza prefissata; chiama onMessage per ognuno, onError se un messaggio è troppo grande o non è JSON. */
export function decoder(onMessage, onError) {
  let buf = Buffer.alloc(0);
  return chunk => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 4) {
      const n = buf.readUInt32LE(0);
      if (n > MAX_IN) { buf = Buffer.alloc(0); onError(new ApiError('too_large', { message: 'Messaggio troppo grande' })); return; }
      if (buf.length < 4 + n) return;
      const body = buf.subarray(4, 4 + n); buf = buf.subarray(4 + n);
      let msg;
      try { msg = JSON.parse(body.toString('utf8')); } catch { onError(new ApiError('bad_request', { message: 'Messaggio non in JSON valido' })); continue; }
      onMessage(msg);
    }
  };
}

/** Esegue un messaggio {id, action, args} con gli strumenti MCP. Risposta {id, ok: true, result} oppure {id, ok: false, error, message}. */
export async function handleMessage(msg, tools) {
  const id = msg && typeof msg === 'object' ? msg.id ?? null : null;
  const name = ACTIONS[msg?.action];
  if (!name || !Object.hasOwn(ACTIONS, msg.action)) return { id, ok: false, error: 'unknown_action', message: 'Azione non ammessa' };
  const tool = tools.find(t => t.name === name);
  const args = msg.args && typeof msg.args === 'object' && !Array.isArray(msg.args) ? msg.args : {};
  try {
    const res = await tool.handler(args);
    const out = { id, ok: true, result: res };
    return Buffer.byteLength(JSON.stringify(out)) > MAX_OUT ? { id, ok: false, error: 'too_large', message: 'Risposta troppo grande' } : out;
  } catch (e) {
    return e instanceof ApiError
      ? { id, ok: false, error: e.code, message: e.message, ...(e.retryAfter !== undefined && { retry_after_seconds: e.retryAfter }) }
      : { id, ok: false, error: 'internal', message: String(e?.message || e).slice(0, 300) };
  }
}

/** Serve l'estensione su stdin/stdout finché il browser chiude stdin. Un'origine non ammessa riceve un solo errore e nient'altro. */
export function serveNative({ origin, tools, input = process.stdin, output = process.stdout }) {
  const send = o => output.write(encode(o));
  if (!ALLOWED_ORIGINS.includes(origin)) { send({ id: null, ok: false, error: 'forbidden_origin', message: 'Estensione non riconosciuta' }); return Promise.resolve(); }
  // Un messaggio alla volta: due creazioni dello stesso annuncio non passano insieme il controllo dei doppioni.
  let queue = Promise.resolve();
  const onChunk = decoder(msg => { queue = queue.then(() => handleMessage(msg, tools)).then(send); },
    e => { queue = queue.then(() => send({ id: null, ok: false, error: e.code, message: e.message })); });
  input.on('data', onChunk);
  return new Promise(resolve => input.on('end', () => queue.then(resolve)));
}

// ── Registrazione dell'host in Chrome ed Edge (per l'utente corrente, senza diritti di amministratore) ──

const BROWSERS = [
  { id: 'chrome', name: 'Google Chrome', mac: 'Library/Application Support/Google/Chrome', linux: '.config/google-chrome', win: 'Software\\Google\\Chrome' },
  { id: 'edge', name: 'Microsoft Edge', mac: 'Library/Application Support/Microsoft Edge', linux: '.config/microsoft-edge', win: 'Software\\Microsoft\\Edge' },
];

export function hostManifest(path) {
  return { name: HOST_NAME, description: 'Jobdossiers: salva gli annunci dal browser (cifratura end-to-end su questo computer)', path, type: 'stdio', allowed_origins: ALLOWED_ORIGINS };
}

const exists = p => access(p).then(() => true, () => false);
const regKey = b => `HKCU\\${b.win}\\NativeMessagingHosts\\${HOST_NAME}`;
const defaultReg = args => spawnSync('reg', args, { stdio: 'ignore', windowsHide: true }).status;

/** Percorso dell'eseguibile da registrare: quello indicato, altrimenti questo stesso eseguibile (non node: il browser deve poterlo avviare da solo). */
export function hostPath(given, execPath = process.execPath) {
  if (given) return given;
  if (/^(node|bun)(\.exe)?$/i.test(basename(execPath))) throw new ApiError('invalid_value', { message: 'Indica il percorso dell\'eseguibile jobdossiers-mcp (da sorgente non si registra node)' });
  return execPath;
}

/** Scrive il manifest dell'host e lo registra nei browser installati (Windows: nel registro di entrambi). Ritorna dove l'ha fatto, senza segreti. */
export async function installHost({ path, platform = process.platform, home = homedir(), reg = defaultReg } = {}) {
  const manifest = JSON.stringify(hostManifest(path), null, 2) + '\n';
  const done = [];
  if (platform === 'win32') {
    const file = join(dirname(path), `${HOST_NAME}.json`);
    await writeFile(file, manifest);
    for (const b of BROWSERS) if (reg(['add', regKey(b), '/ve', '/t', 'REG_SZ', '/d', file, '/f']) === 0) done.push({ browser: b.name, at: regKey(b) });
    return { manifest: file, browsers: done };
  }
  for (const b of BROWSERS) {
    const base = join(home, platform === 'darwin' ? b.mac : b.linux);
    if (!await exists(base)) continue;             // browser mai avviato: niente cartelle nuove
    const dir = join(base, 'NativeMessagingHosts');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${HOST_NAME}.json`), manifest);
    done.push({ browser: b.name, at: join(dir, `${HOST_NAME}.json`) });
  }
  return { browsers: done };
}

export async function removeHost({ path, platform = process.platform, home = homedir(), reg = defaultReg } = {}) {
  const done = [];
  if (platform === 'win32') {
    for (const b of BROWSERS) if (reg(['delete', regKey(b), '/f']) === 0) done.push(b.name);
    if (path) await rm(join(dirname(path), `${HOST_NAME}.json`), { force: true });
    return { browsers: done };
  }
  for (const b of BROWSERS) {
    const file = join(home, platform === 'darwin' ? b.mac : b.linux, 'NativeMessagingHosts', `${HOST_NAME}.json`);
    if (await exists(file)) { await rm(file); done.push(b.name); }
  }
  return { browsers: done };
}
