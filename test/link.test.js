import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startLink, sealForApp, LINK_AAD } from '../src/link.js';
import { storeKey } from '../src/store.js';
import { makeFixture } from './helpers.mjs';

const BASE = 'http://127.0.0.1:9';     // portale finto: qui serve solo a comporre l'indirizzo
const params = url => Object.fromEntries(new URL(url).searchParams);
const cb = (link, q) => fetch(`http://127.0.0.1:${link.port}/cb?${new URLSearchParams(q)}`);

test('collegamento: il browser cifra la chiave per l\'app e l\'app la riceve', async () => {
  const fx = await makeFixture();
  const link = await startLink({ base: BASE, name: 'Mac di prova' });
  const p = params(link.url);
  assert.match(link.url, /^http:\/\/127\.0\.0\.1:9\/link\.php\?/);
  assert.equal(p.v, '1'); assert.equal(p.name, 'Mac di prova'); assert.equal(Number(p.port), link.port);
  assert.equal(Buffer.from(p.pub, 'base64url').length, 65, 'chiave pubblica P-256 non compressa');
  assert.equal(Buffer.from(p.state, 'base64url').length, 32);
  assert.ok(!link.url.includes(fx.secret));

  const sealed = await sealForApp(fx.key, p.pub, p.state);
  assert.ok(!JSON.stringify(sealed).includes(fx.secret) && !JSON.stringify(sealed).includes(fx.token), 'nella risposta la chiave viaggia cifrata');
  const r = await cb(link, { state: p.state, ...sealed });
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.match(html, /Dispositivo collegato/); assert.ok(!html.includes(fx.secret));
  assert.equal(await link.done, fx.key);
  await assert.rejects(cb(link, { state: p.state, ...sealed }), 'una sola risposta: poi non ascolta più');
});

test('collegamento: state sbagliato ignorato, annullamento e risposta manomessa rifiutati', async () => {
  const fx = await makeFixture();
  const a = await startLink({ base: BASE });
  const pa = params(a.url);
  const sealed = await sealForApp(fx.key, pa.pub, pa.state);
  assert.equal((await cb(a, { state: Buffer.alloc(32).toString('base64url'), ...sealed })).status, 400);
  assert.equal((await fetch(`http://127.0.0.1:${a.port}/altro`)).status, 404);
  assert.equal((await cb(a, { state: pa.state, error: 'access_denied' })).status, 200);
  await assert.rejects(a.done, e => e.code === 'denied');

  const b = await startLink({ base: BASE });
  const pb = params(b.url);
  const s2 = await sealForApp(fx.key, pb.pub, pb.state);
  const ct = Buffer.from(s2.ct, 'base64url'); ct[0] ^= 1;
  assert.equal((await cb(b, { state: pb.state, ...s2, ct: ct.toString('base64url') })).status, 400);
  await assert.rejects(b.done, e => e.code === 'bad_payload' && !e.message.includes(fx.secret));

  const c = await startLink({ base: BASE });
  const pc = params(c.url);
  const wrongPair = await sealForApp(fx.key, pa.pub, pc.state);          // cifrata per un'altra app
  assert.equal((await cb(c, { state: pc.state, ...wrongPair })).status, 400);
  await assert.rejects(c.done, e => e.code === 'bad_payload');

  const d = await startLink({ base: BASE });
  const pd = params(d.url);
  assert.equal((await cb(d, { state: pd.state, ...(await sealForApp('non una chiave', pd.pub, pd.state)) })).status, 400);
  await assert.rejects(d.done, e => e.code === 'bad_payload');
});

test('collegamento: tempo scaduto, annullamento e portale non ammesso', async () => {
  const t = await startLink({ base: BASE, timeoutMs: 50 });
  await assert.rejects(t.done, e => e.code === 'timeout');
  const c = await startLink({ base: BASE });
  c.cancel();
  await assert.rejects(c.done, e => e.code === 'cancelled');
  await assert.rejects(startLink({ base: 'https://evil.example' }), e => e.code === 'bad_url');
  await assert.rejects(startLink({ base: 'http://jobdossiers.ch' }), e => e.code === 'bad_url');
});

test('chiave ricevuta salvata come con --set-key (file 600 fuori da macOS e Windows)', { skip: process.platform === 'win32' }, async () => {
  const fx = await makeFixture();
  const dir = await mkdtemp(join(tmpdir(), 'jd-store-'));
  try {
    const where = await storeKey(fx.key, { platform: 'linux', env: { XDG_CONFIG_HOME: dir } });
    const file = join(dir, 'jobdossiers', 'key');
    assert.equal(where, `${file} (permessi 600)`);
    assert.equal((await readFile(file, 'utf8')).trim(), fx.key);
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    await assert.rejects(storeKey('jda1.x.y', { platform: 'linux', env: { XDG_CONFIG_HOME: dir } }), e => e.name === 'KeyFormatError');
  } finally { await rm(dir, { recursive: true }); }
});

const E2EE = fileURLToPath(new URL('../../jobdossiers.ch/public/assets/e2ee.js', import.meta.url));
test('interoperabilità: cifratura del collegamento in public/assets/e2ee.js del portale', { skip: !existsSync(E2EE) && 'repo jobdossiers.ch non presente' }, async t => {
  globalThis.window = globalThis;
  await import(pathToFileURL(E2EE).href);
  const seal = globalThis.JDCrypto?.linkSeal;
  if (!seal) return t.skip('JDCrypto.linkSeal non ancora nel portale');
  const fx = await makeFixture();
  const link = await startLink({ base: BASE });
  const p = params(link.url);
  const r = await cb(link, { state: p.state, ...(await seal(fx.key, p.pub, p.state)) });
  assert.equal(r.status, 200);
  assert.equal(await link.done, fx.key);
  assert.equal(LINK_AAD, 'jd1:link');
});
