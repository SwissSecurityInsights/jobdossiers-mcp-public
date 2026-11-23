import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PassThrough } from 'node:stream';
import { encode, decoder, serveNative, handleMessage, installHost, removeHost, hostPath, nativeOrigin, seenDir, ALLOWED_ORIGINS, HOST_NAME, ACTIONS } from '../src/native.js';
import { decObj, encObj, encBytes, AAD } from '../src/crypto.js';
import { makeFixture, startMock } from './helpers.mjs';

const INDEX = fileURLToPath(new URL('../src/index.js', import.meta.url));
const ORIGIN = ALLOWED_ORIGINS[0];

test('native: messaggi a lunghezza prefissata, anche spezzati in più pezzi', () => {
  const got = [], errs = [];
  const feed = decoder(m => got.push(m), e => errs.push(e.code));
  const a = encode({ id: 1, t: 'è' }), b = encode({ id: 2 });
  const all = Buffer.concat([a, b]);
  for (let i = 0; i < all.length; i += 3) feed(all.subarray(i, i + 3));
  assert.deepEqual(got, [{ id: 1, t: 'è' }, { id: 2 }]);
  const big = Buffer.alloc(4); big.writeUInt32LE(5 * 1024 * 1024);
  feed(big);
  assert.deepEqual(errs, ['too_large']);
  assert.equal(nativeOrigin(['node', 'x', ORIGIN, '--parent-window=0']), ORIGIN);
  assert.equal(nativeOrigin(['node', 'x', 'chrome-extension://evil/']), undefined);
  assert.deepEqual(Object.keys(ACTIONS), ['status', 'find_duplicates', 'create', 'preferences']);
});

test('native: un\'estensione con un altro ID riceve solo un errore', async () => {
  const input = new PassThrough(), output = new PassThrough();
  const chunks = []; output.on('data', c => chunks.push(c));
  let called = false;
  await serveNative({ origin: 'chrome-extension://' + 'a'.repeat(32) + '/', tools: [{ name: 'jd_quota', handler: () => { called = true; } }], input, output });
  input.end(encode({ id: 1, action: 'status' }));
  const got = []; decoder(m => got.push(m), () => {})(Buffer.concat(chunks));
  assert.deepEqual(got, [{ id: null, ok: false, error: 'forbidden_origin', message: 'Estensione non riconosciuta' }]);
  assert.equal(called, false);
});

/** Avvia il server come fa il browser: origine dell'estensione come argomento, messaggi su stdin. */
function runHost(fx, mock, messages, origin = ORIGIN) {
  return new Promise(resolve => {
    const c = spawn(process.execPath, [INDEX, origin], { env: { PATH: process.env.PATH, JD_AGENT_KEY: fx.key, JD_URL: mock.url }, stdio: ['pipe', 'pipe', 'pipe'] });
    const out = [], err = [];
    c.stdout.on('data', d => out.push(d)); c.stderr.on('data', d => err.push(d));
    c.on('close', code => {
      const got = [], bad = [];
      decoder(m => got.push(m), e => bad.push(e))(Buffer.concat(out));
      resolve({ code, got, bad, err: Buffer.concat(err).toString() });
    });
    for (const m of messages) c.stdin.write(encode(m));
    c.stdin.end();
  });
}

test('native: stato, doppioni e creazione dal browser; azioni non ammesse rifiutate', async () => {
  const fx = await makeFixture(), mock = await startMock(fx);
  try {
    const r = await runHost(fx, mock, [
      { id: 1, action: 'status' },
      { id: 2, action: 'find_duplicates', args: { urls: ['https://www.Careers.Acme.example/Jobs/42/?utm_source=y'] } },
      { id: 3, action: 'create', args: { company: 'Rotondo Logistics SA', role: 'Head of Supply Chain', job_url: 'https://careers.rotondo.example/jobs/7', job_desc: 'TESTO RISERVATO', employer_country: 'CH', note: "Salvata dal browser con l'estensione Jobdossiers" } },
      { id: 4, action: 'create', args: { company: 'Rotondo Logistics AG', role: 'Head of Supply Chain (m/w/d)', job_url: 'https://altro.example/1' } },
      { id: 5, action: 'set_status', args: { id: 'r1', status: 'deleted' } },
      { id: 6, action: 'toString' },
      { id: 7, action: 'create', args: { company: 'X' } },
    ]);
    assert.equal(r.code, 0);
    assert.deepEqual(r.got.map(m => m.id), [1, 2, 3, 4, 5, 6, 7], 'risposte nell\'ordine dei messaggi');
    assert.deepEqual(r.bad, [], 'stdout contiene solo messaggi del protocollo');
    const by = Object.fromEntries(r.got.map(m => [m.id, m]));
    assert.equal(by[1].ok, true); assert.equal(by[1].result.applications, 3);
    assert.deepEqual(by[2].result.duplicates.map(d => [d.id, d.reason]), [['r1', 'url']]);
    assert.equal(by[3].ok, true); assert.ok(by[3].result.id);
    assert.equal(by[4].ok, false); assert.equal(by[4].error, 'duplicate');
    assert.equal(by[5].error, 'unknown_action'); assert.equal(by[6].error, 'unknown_action');
    assert.equal(by[7].error, 'invalid_value');
    const saved = mock.requests.filter(x => x.action === 'app_save');
    assert.equal(saved.length, 1, 'una sola scrittura: la creazione');
    assert.ok(!saved[0].body.includes('RISERVATO') && !saved[0].body.includes('Rotondo'), 'al portale arriva solo il blob cifrato');
    const row = mock.rows.find(x => x.id === by[3].result.id);
    const d = await decObj(fx.dek, row.enc, AAD.app);
    assert.equal(d.job_desc, 'TESTO RISERVATO'); assert.equal(row.status, 'preparing');
    assert.match(d.note_log[0].text, /^\[agente\] Salvata dal browser/);
    assert.ok(!r.err.includes(fx.key.split('.')[2]), 'il segreto non compare su stderr');
  } finally { await mock.close(); }
});

test('native: preferenze in sola lettura per il confronto nel pannello', async () => {
  const fx = await makeFixture(), mock = await startMock(fx);
  try {
    const none = await runHost(fx, mock, [{ id: 1, action: 'preferences' }]);
    assert.equal(none.got[0].ok, true); assert.equal(none.got[0].result.saved, false);
    mock.files.set('p1', await encBytes(fx.dek, new TextEncoder().encode(JSON.stringify({ v: 1, home_city: 'Lugano', modes: ['hybrid', 'office'] })), AAD.doc));
    mock.docs.push({ id: 'p1', kind: 'prefs', application_id: null, meta_enc: await encObj(fx.dek, { name: 'prefs.json' }, AAD.docmeta), size: 0, created_at: 1 });
    const r = await runHost(fx, mock, [{ id: 2, action: 'preferences' }]);
    assert.deepEqual(r.got[0].result, { saved: true, preferences: { v: 1, home_city: 'Lugano', modes: ['hybrid'] } }, 'valori fuori elenco tolti, come in jd_preferences');
    assert.ok(mock.requests.every(x => !['app_save', 'doc_upload', 'agenda_save', 'net_save'].includes(x.action)), 'nessuna scrittura');
  } finally { await mock.close(); }
});

test('native: hello registra browser e versione dell\'estensione, senza altri dati', async () => {
  const home = await mkdtemp(join(tmpdir(), 'jd-seen-'));
  try {
    const tools = [];
    const opts = { platform: 'darwin', home };
    const ok = await handleMessage({ id: 3, action: 'hello', args: { browser: 'edge', version: '0.2.3', build: '2026-11-23T14:05:00Z', extra: 'x' } }, tools, opts);
    assert.deepEqual(ok, { id: 3, ok: true, result: { recorded: true } });
    const saved = JSON.parse(await readFile(join(seenDir(opts), 'estensione-edge.json'), 'utf8'));
    assert.deepEqual(Object.keys(saved), ['browser', 'version', 'build', 'seen_at']); assert.equal(saved.version, '0.2.3'); assert.equal(saved.build, '2026-11-23T14:05:00Z');
    await handleMessage({ id: 5, action: 'hello', args: { browser: 'chrome', version: '0.2.3', build: '<script>' } }, tools, opts);
    assert.equal(JSON.parse(await readFile(join(seenDir(opts), 'estensione-chrome.json'), 'utf8')).build, '', 'data non valida: scartata');
    assert.ok(seenDir(opts).endsWith('Library/Application Support/Jobdossiers'));
    for (const args of [{ browser: '../x', version: '0.2.3' }, { browser: 'edge', version: '1; rm' }, {}])
      assert.equal((await handleMessage({ id: 4, action: 'hello', args }, tools, opts)).error, 'invalid_value');
  } finally { await rm(home, { recursive: true }); }
});

test('native: avviato da un\'estensione sconosciuta non legge la chiave e non chiama il portale', async () => {
  const fx = await makeFixture(), mock = await startMock(fx);
  try {
    const r = await runHost(fx, mock, [{ id: 1, action: 'status' }], 'chrome-extension://' + 'b'.repeat(32) + '/');
    assert.equal(r.got[0].error, 'forbidden_origin');
    assert.equal(mock.requests.length, 0);
  } finally { await mock.close(); }
});

const exists = p => access(p).then(() => true, () => false);

test('registrazione su macOS: manifest solo nei browser presenti, poi rimosso', async () => {
  const home = await mkdtemp(join(tmpdir(), 'jd-home-'));
  try {
    await mkdir(join(home, 'Library/Application Support/Microsoft Edge'), { recursive: true });
    const r = await installHost({ path: '/Applications/Jobdossiers.app/Contents/Resources/jobdossiers-mcp', platform: 'darwin', home });
    const file = join(home, 'Library/Application Support/Microsoft Edge/NativeMessagingHosts', `${HOST_NAME}.json`);
    assert.deepEqual(r.browsers, [{ browser: 'Microsoft Edge', at: file }]);
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), {
      name: HOST_NAME, description: 'Jobdossiers: salva gli annunci dal browser (cifratura end-to-end su questo computer)',
      path: '/Applications/Jobdossiers.app/Contents/Resources/jobdossiers-mcp', type: 'stdio', allowed_origins: ALLOWED_ORIGINS,
    });
    assert.equal(await exists(join(home, 'Library/Application Support/Google')), false, 'Chrome assente: nessuna cartella creata');
    assert.deepEqual((await removeHost({ platform: 'darwin', home })).browsers, ['Microsoft Edge']);
    assert.equal(await exists(file), false);
  } finally { await rm(home, { recursive: true }); }
});

test('registrazione su Windows: manifest accanto all\'eseguibile e chiavi HKCU per Chrome ed Edge', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jd-win-'));
  const calls = [];
  const reg = args => { calls.push(args); return 0; };
  try {
    const exe = join(dir, 'jobdossiers-mcp.exe');
    const r = await installHost({ path: exe, platform: 'win32', reg });
    assert.equal(r.manifest, join(dir, `${HOST_NAME}.json`));
    assert.deepEqual(calls.map(a => a[1]), [`HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`, `HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\${HOST_NAME}`]);
    assert.ok(calls.every(a => a[0] === 'add' && a.includes(r.manifest) && a.includes('/f')));
    assert.equal(JSON.parse(await readFile(r.manifest, 'utf8')).path, exe);
    calls.length = 0;
    await removeHost({ path: exe, platform: 'win32', reg });
    assert.deepEqual(calls.map(a => a[0]), ['delete', 'delete']);
    assert.equal(await exists(r.manifest), false);
  } finally { await rm(dir, { recursive: true }); }
  assert.throws(() => hostPath(undefined, '/usr/local/bin/node'), e => e.code === 'invalid_value');
  assert.equal(hostPath(undefined, '/x/jobdossiers-mcp'), '/x/jobdossiers-mcp');
});
