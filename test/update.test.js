import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync, sign, createPublicKey } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { updateExtension, openBundle, cmpVersion, extensionDir, checkApp, downloadApp, NATIVE_PROTOCOL, UPDATE_PUBLIC_KEY, BUNDLE } from '../src/update.js';

const SCRIPT = fileURLToPath(new URL('../scripts/extension-bundle.mjs', import.meta.url));
const MANIFEST = JSON.parse(await readFile(new URL('../extension/manifest.json', import.meta.url), 'utf8'));
const keys = () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return { pub: publicKey.export({ type: 'spki', format: 'pem' }), priv: privateKey.export({ type: 'pkcs8', format: 'pem' }), privateKey };
};
/** Pacchetto costruito dallo stesso script della release, firmato con una chiave di prova. */
async function realBundle(priv) {
  const dir = await mkdtemp(join(tmpdir(), 'jd-bundle-'));
  const out = join(dir, BUNDLE);
  execFileSync(process.execPath, [SCRIPT, out, '--sign-env', 'JD_TEST_KEY'], { env: { ...process.env, JD_TEST_KEY: priv }, stdio: 'ignore' });
  return { gz: await readFile(out), sig: (await readFile(out + '.sig', 'utf8')).trim(), dir };
}
const handmade = (privateKey, obj) => { const gz = gzipSync(Buffer.from(JSON.stringify(obj))); return { gz, sig: sign(null, gz, privateKey).toString('base64') }; };
const fakeFetch = map => async url => {
  const name = url.split('/').pop();
  if (!(name in map)) return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) };
  const b = Buffer.from(map[name]);
  return { ok: true, status: 200, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.length) };
};
async function installed(key = MANIFEST.key) {
  const root = await mkdtemp(join(tmpdir(), 'jd-ext-'));
  const dir = join(root, 'estensione');
  await mkdir(dir);
  await writeFile(join(dir, 'manifest.json'), JSON.stringify({ name: 'Jobdossiers', version: '0.2.0', key }));
  await writeFile(join(dir, 'vecchio.js'), '// vecchio');
  return { root, dir };
}

test('aggiornamento: pacchetto firmato della release → cartella sostituita in un colpo solo', async () => {
  const k = keys(), b = await realBundle(k.priv), t = await installed();
  try {
    const r = await updateExtension({ current: { version: '0.2.0', build: '' }, dir: t.dir, publicKey: k.pub, base: 'https://x.example/', fetchImpl: fakeFetch({ [BUNDLE]: b.gz, [BUNDLE + '.sig']: b.sig }) });
    assert.equal(r.updated, true); assert.equal(r.version, MANIFEST.version);
    const files = await readdir(t.dir);
    for (const f of ['manifest.json', 'panel.js', 'grab.js', 'build.json', 'compat.json']) assert.ok(files.includes(f), f);
    assert.ok(!files.includes('vecchio.js'), 'i file vecchi spariscono');
    assert.deepEqual((await readdir(t.root)).sort(), ['estensione'], 'nessuna cartella temporanea rimasta');
    assert.equal(JSON.parse(await readFile(join(t.dir, 'build.json'), 'utf8')).built_at, r.built_at);
    // stessa versione e stessa data: niente da fare
    const again = await updateExtension({ current: { version: r.version, build: r.built_at }, dir: t.dir, publicKey: k.pub, base: 'https://x.example/', fetchImpl: fakeFetch({ [BUNDLE]: b.gz, [BUNDLE + '.sig']: b.sig }) });
    assert.equal(again.reason, 'up_to_date');
    const newer = await updateExtension({ current: { version: '9.0.0', build: '' }, dir: t.dir, publicKey: k.pub, base: 'https://x.example/', fetchImpl: fakeFetch({ [BUNDLE]: b.gz, [BUNDLE + '.sig']: b.sig }) });
    assert.equal(newer.reason, 'up_to_date', 'mai tornare indietro');
  } finally { await rm(b.dir, { recursive: true }); await rm(t.root, { recursive: true }); }
});

test('aggiornamento: firma sbagliata, pacchetto manomesso o cartella non nostra → nulla cambia', async () => {
  const k = keys(), other = keys(), b = await realBundle(k.priv), t = await installed();
  const opts = map => ({ current: { version: '0.2.0' }, dir: t.dir, publicKey: k.pub, base: 'https://x.example/', fetchImpl: fakeFetch(map) });
  try {
    await assert.rejects(updateExtension(opts({ [BUNDLE]: b.gz, [BUNDLE + '.sig']: sign(null, b.gz, other.privateKey).toString('base64') })), e => e.code === 'bad_signature');
    const tampered = Buffer.from(b.gz); tampered[tampered.length - 5] ^= 1;
    await assert.rejects(updateExtension(opts({ [BUNDLE]: tampered, [BUNDLE + '.sig']: b.sig })), e => e.code === 'bad_signature');
    assert.ok((await readdir(t.dir)).includes('vecchio.js'), 'cartella intatta');
    const evil = handmade(k.privateKey, { format: 1, version: '9.9.9', built_at: '2030-01-01T00:00:00Z', protocol: 1, files: { 'manifest.json': Buffer.from('{}').toString('base64'), '../../fuori.js': 'eA==' } });
    await assert.rejects(updateExtension(opts({ [BUNDLE]: evil.gz, [BUNDLE + '.sig']: evil.sig })), e => e.code === 'bad_bundle');
    const future = handmade(k.privateKey, { format: 1, version: '9.9.9', built_at: '2030-01-01T00:00:00Z', protocol: NATIVE_PROTOCOL + 1, files: { 'manifest.json': Buffer.from(JSON.stringify({ key: MANIFEST.key })).toString('base64') } });
    assert.equal((await updateExtension(opts({ [BUNDLE]: future.gz, [BUNDLE + '.sig']: future.sig }))).reason, 'app_too_old');
    assert.equal((await updateExtension(opts({}))).reason, 'no_bundle');
    const foreign = await installed('ALTRA-CHIAVE');
    assert.equal((await updateExtension({ ...opts({ [BUNDLE]: b.gz, [BUNDLE + '.sig']: b.sig }), dir: foreign.dir })).reason, 'not_managed');
    await rm(foreign.root, { recursive: true });
    assert.equal((await updateExtension({ ...opts({ [BUNDLE]: b.gz, [BUNDLE + '.sig']: b.sig }), dir: join(t.root, 'manca') })).reason, 'not_managed');
    assert.ok((await readdir(t.dir)).includes('vecchio.js'), 'cartella ancora intatta');
  } finally { await rm(b.dir, { recursive: true }); await rm(t.root, { recursive: true }); }
});

test('aggiornamento: chiave pubblica, protocollo, versioni e cartelle per sistema', async () => {
  assert.equal(createPublicKey(UPDATE_PUBLIC_KEY).asymmetricKeyType, 'ed25519');
  const compat = JSON.parse(await readFile(new URL('../extension/compat.json', import.meta.url), 'utf8'));
  assert.equal(compat.protocol, NATIVE_PROTOCOL, 'estensione e server parlano lo stesso protocollo');
  assert.equal(cmpVersion('0.2.10', '0.2.9'), 1); assert.equal(cmpVersion('0.2.6', '0.2.6'), 0); assert.equal(cmpVersion('0.1.9', '0.2.0'), -1);
  assert.ok(extensionDir({ platform: 'darwin', home: '/Users/x' }).endsWith('Library/Application Support/Jobdossiers/estensione'));
  assert.equal(extensionDir({ platform: 'win32', env: { LOCALAPPDATA: 'C:\\L' }, home: 'C:\\U' }).replace(/\\/g, '/'), 'C:/L/Jobdossiers/estensione');
  assert.throws(() => openBundle(Buffer.from('x'), 'AAAA'), e => e.code === 'bad_signature');
});

const MANIFEST_SCRIPT = fileURLToPath(new URL('../scripts/release-manifest.mjs', import.meta.url));
/** dist finta come nel job publish: installer con i nomi fissi, latest.json firmato dallo script della release. */
async function fakeRelease(priv, version) {
  const dir = await mkdtemp(join(tmpdir(), 'jd-rel-'));
  await writeFile(join(dir, 'Jobdossiers-mac-arm64.pkg'), 'PKG ' + 'x'.repeat(1000));
  await writeFile(join(dir, 'Jobdossiers-Setup-x64.exe'), 'EXE ' + 'y'.repeat(1000));
  await writeFile(join(dir, 'jobdossiers-mcp-linux-x64'), 'non elencato');
  execFileSync(process.execPath, [MANIFEST_SCRIPT, dir, '--sign-env', 'JD_TEST_KEY'], { env: { ...process.env, JD_TEST_KEY: priv }, stdio: 'ignore' });
  const map = {};
  for (const n of await readdir(dir)) map[n] = await readFile(join(dir, n));
  return { dir, map, latest: JSON.parse(map['latest.json']) };
}

test('aggiornamento dell\'app: latest.json firmato, installer controllato con l\'impronta', async () => {
  const k = keys(), rel = await fakeRelease(k.priv);
  const out = await mkdtemp(join(tmpdir(), 'jd-dl-'));
  const opts = (map, extra = {}) => ({ base: 'https://x.example/', publicKey: k.pub, fetchImpl: fakeFetch(map), ...extra });
  try {
    const version = rel.latest.version;
    assert.deepEqual(Object.keys(rel.latest.files).sort(), ['Jobdossiers-Setup-x64.exe', 'Jobdossiers-mac-arm64.pkg']);
    const ok = await checkApp({ current: '0.0.1', platform: 'darwin', arch: 'arm64', ...opts(rel.map) });
    assert.deepEqual(ok, { available: true, current: '0.0.1', version, installer: 'Jobdossiers-mac-arm64.pkg' });
    assert.equal((await checkApp({ current: version, platform: 'win32', ...opts(rel.map) })).available, false, 'già aggiornata');
    assert.equal((await checkApp({ current: '0.0.1', platform: 'darwin', arch: 'x64', ...opts(rel.map) })).reason, 'no_installer', 'Mac Intel: niente app');
    assert.equal((await checkApp({ current: '0.0.1', platform: 'darwin', arch: 'arm64', ...opts({}) })).reason, 'no_manifest');
    const d = await downloadApp({ current: '0.0.1', platform: 'win32', dir: out, ...opts(rel.map) });
    assert.equal(d.version, version); assert.match(d.path, new RegExp(`Jobdossiers-Setup-x64-${version.replace(/\./g, '\\.')}\\.exe$`));
    assert.equal((await readFile(d.path, 'utf8')).slice(0, 4), 'EXE ');
    // installer manomesso: stessa dimensione, contenuto diverso
    const bad = { ...rel.map, 'Jobdossiers-mac-arm64.pkg': Buffer.from('PKG ' + 'z'.repeat(1000)) };
    await assert.rejects(downloadApp({ current: '0.0.1', platform: 'darwin', arch: 'arm64', dir: out, ...opts(bad) }), e => e.code === 'bad_installer');
    // latest.json con una firma di un'altra chiave
    const other = keys();
    await assert.rejects(checkApp({ current: '0.0.1', platform: 'darwin', arch: 'arm64', ...opts(rel.map, { publicKey: other.pub }) }), e => e.code === 'bad_signature');
    const forged = { ...rel.map, 'latest.json': Buffer.from(String(rel.map['latest.json']).replace(/"version": "[^"]+"/, '"version": "99.0.0"')) };
    await assert.rejects(checkApp({ current: '0.0.1', platform: 'darwin', arch: 'arm64', ...opts(forged) }), e => e.code === 'bad_signature');
  } finally { await rm(rel.dir, { recursive: true }); await rm(out, { recursive: true }); }
});
