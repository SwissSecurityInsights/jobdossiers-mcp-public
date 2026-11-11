import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadKey } from '../src/store.js';
import { runCheck } from '../src/check.js';
import { createApi } from '../src/api.js';
import { Dossier } from '../src/client.js';
import { makeFixture, startMock } from './helpers.mjs';

test('chiave da variabile e da file: permessi aperti rifiutati', { skip: process.platform === 'win32' }, async () => {
  const fx = await makeFixture();
  assert.equal((await loadKey({ env: { JD_AGENT_KEY: fx.key } })).token, fx.token);
  const dir = await mkdtemp(join(tmpdir(), 'jdk-'));
  const f = join(dir, 'key');
  await writeFile(f, fx.key + '\n'); await chmod(f, 0o644);
  await assert.rejects(loadKey({ env: { JD_AGENT_KEY_FILE: f } }), e => /Permessi/.test(e.message) && !e.message.includes(fx.secret));
  await chmod(f, 0o600);
  assert.equal((await loadKey({ env: { JD_AGENT_KEY_FILE: f } })).secret, fx.secret);
  await assert.rejects(loadKey({ env: { JD_AGENT_KEY: 'jda1.x.y' } }), e => e.name === 'KeyFormatError');
});

test('--check stampa conteggi e nomi dei campi, nessun valore', async () => {
  const fx = await makeFixture(), mock = await startMock(fx);
  try {
    const r = await runCheck(new Dossier({ api: createApi({ base: mock.url, token: fx.token }), secret: fx.secret }));
    assert.equal(r.applications, 3);
    assert.equal(r.encrypted_fields_in_use.custom_field, 1);
    assert.equal(r.rav.SI, 1);
    const s = JSON.stringify(r);
    for (const v of ['Acme', 'SECRET JOB TEXT', 'keep-me', fx.secret]) assert.ok(!s.includes(v));
  } finally { await mock.close(); }
});
