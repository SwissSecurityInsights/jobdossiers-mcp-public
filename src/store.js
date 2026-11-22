/* Dove sta la chiave `jda1.<token>.<segreto>` sul computer.
 * Ordine di ricerca: JD_AGENT_KEY, JD_AGENT_KEY_FILE, portachiavi di macOS, DPAPI di Windows, file 0600 (Linux e altri).
 * Il segreto non passa mai da argomenti di riga di comando, log o output. */
import { execFile, spawnSync } from 'node:child_process';
import { readFile, stat, writeFile, mkdir } from 'node:fs/promises';
import { homedir, userInfo } from 'node:os';
import { join, dirname } from 'node:path';
import { parseKey } from './crypto.js';

export const SERVICE = 'jobdossiers-mcp';
const run = (cmd, args, { input, env } = {}) => new Promise((resolve, reject) => {
  const p = execFile(cmd, args, { timeout: 20000, windowsHide: true, env: env || process.env }, (e, out) => e ? reject(e) : resolve(String(out)));
  if (input !== undefined) p.stdin.end(input);
});

export function defaultKeyFile(platform = process.platform, env = process.env) {
  if (platform === 'win32') return join(env.APPDATA || join(homedir(), 'AppData', 'Roaming'), SERVICE, 'key.dpapi');
  return join(env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'jobdossiers', 'key');
}

async function readPlainFile(path) {
  const st = await stat(path);
  if (process.platform !== 'win32' && (st.mode & 0o077) !== 0) {
    throw new Error(`Permessi troppo aperti su ${path}: esegui chmod 600`);
  }
  return (await readFile(path, 'utf8')).trim();
}

const PS_DECRYPT = '$s = Get-Content -Raw -LiteralPath $env:JD_KEYFILE | ConvertTo-SecureString; [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))';
const PS_ENCRYPT = '$k = [Console]::In.ReadLine(); ConvertTo-SecureString -String $k -AsPlainText -Force | ConvertFrom-SecureString';

export async function loadKey({ env = process.env, platform = process.platform } = {}) {
  if (env.JD_AGENT_KEY) return parseKey(env.JD_AGENT_KEY);
  if (env.JD_AGENT_KEY_FILE) return parseKey(await readPlainFile(env.JD_AGENT_KEY_FILE));
  if (platform === 'darwin') {
    try { return parseKey((await run('security', ['find-generic-password', '-s', SERVICE, '-a', userInfo().username, '-w'])).trim()); }
    catch (e) { if (e?.name === 'KeyFormatError') throw e; /* non presente: provo il file */ }
  }
  const file = defaultKeyFile(platform, env);
  if (platform === 'win32') {
    try { return parseKey((await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', PS_DECRYPT], { env: { ...env, JD_KEYFILE: file } })).trim()); }
    catch (e) { if (e?.name === 'KeyFormatError') throw e; }
  } else {
    try { return parseKey(await readPlainFile(file)); }
    catch (e) { if (e?.name === 'KeyFormatError' || /Permessi/.test(e?.message || '')) throw e; }
  }
  throw new Error('Chiave non trovata. Creala in Account → Chiave per automazioni e salvala con: jobdossiers-mcp --set-key');
}

export function promptHidden(label) {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) return reject(new Error('Serve un terminale interattivo'));
    process.stderr.write(label);
    stdin.setRawMode(true); stdin.resume(); stdin.setEncoding('utf8');
    let buf = '';
    const finish = () => { stdin.setRawMode(false); stdin.pause(); stdin.off('data', onData); process.stderr.write('\n'); };
    const onData = chunk => {
      for (const c of chunk) {
        if (c === '\r' || c === '\n') { finish(); return resolve(buf); }
        if (c === '\u0003') { finish(); return reject(new Error('Annullato')); }
        if (c === '\u007f' || c === '\b') buf = buf.slice(0, -1); else buf += c;
      }
    };
    stdin.on('data', onData);
  });
}

/** Salva una chiave già nota (collegamento dal browser, src/link.js) nello stesso posto di --set-key. Mai su riga di comando:
 *  su macOS passa a `security -i` dallo standard input. Ritorna dove è finita (mai la chiave). */
export async function storeKey(text, { platform = process.platform, env = process.env } = {}) {
  parseKey(text);
  if (platform === 'darwin') {
    const user = userInfo().username;
    const q = s => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
    spawnSync('security', ['delete-generic-password', '-s', SERVICE, '-a', user], { stdio: 'ignore' });
    const r = spawnSync('security', ['-i'], { input: `add-generic-password -s ${q(SERVICE)} -a ${q(user)} -l ${q(SERVICE)} -w ${q(text)}\n`, stdio: ['pipe', 'ignore', 'ignore'] });
    if (r.status !== 0) throw new Error('Il portachiavi non ha salvato la chiave');
    return 'portachiavi di macOS';
  }
  const file = defaultKeyFile(platform, env);
  await mkdir(dirname(file), { recursive: true });
  if (platform === 'win32') {
    const enc = (await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', PS_ENCRYPT], { input: text + '\n' })).trim();
    await writeFile(file, enc, { mode: 0o600 });
    return `${file} (cifrato con DPAPI, valido solo per questo utente Windows)`;
  }
  await writeFile(file, text + '\n', { mode: 0o600 });
  return `${file} (permessi 600)`;
}

/** Salva la chiave nello store del sistema. Ritorna una descrizione di dove è finita (mai la chiave). */
export async function saveKey({ platform = process.platform } = {}) {
  if (platform === 'darwin') {
    const user = userInfo().username;
    process.stderr.write('Incolla la chiave jda1… quando il portachiavi la chiede (non viene mostrata).\n');
    const r = spawnSync('security', ['add-generic-password', '-U', '-s', SERVICE, '-a', user, '-w'], { stdio: 'inherit' });
    if (r.status !== 0) throw new Error('Il portachiavi non ha salvato la chiave');
    try { await loadKey({ env: {}, platform }); }
    catch (e) { spawnSync('security', ['delete-generic-password', '-s', SERVICE, '-a', user], { stdio: 'ignore' }); throw e; }
    return 'portachiavi di macOS';
  }
  return storeKey(await promptHidden('Chiave jda1.… (non viene mostrata): '), { platform });
}
