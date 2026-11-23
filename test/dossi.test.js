import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createApi } from '../src/api.js';
import { Dossier } from '../src/client.js';
import { handleMessage } from '../src/native.js';
import { record, buildContext, contextBlock, trimHistory, withPosting, MAX_INPUT, MAX_CTX_SYS } from '../src/dossi.js';
import { makeFixture, startMock } from './helpers.mjs';

// Stessa regola di Assistant::validContext nel portale
const VALID = /^<today>\d{4}-\d{2}-\d{2}<\/today>\n<applications count="\d{1,5}" omitted="\d{1,5}" descriptions_truncated="\d{1,5}" with_description="\d{1,5}" descriptions_without="\d{1,5}">\n([\s\S]*)\n<\/applications>$/;
const NOW = () => new Date('2026-11-23T10:00:00Z');
const mk = (fx, mock) => new Dossier({ api: createApi({ base: mock.url, token: fx.token }), secret: fx.secret, now: NOW });
const POSTING = { role: 'Head of Information Security', company: 'Nordlicht Fintech', place: 'Lugano, CH', url: 'https://www.linkedin.com/jobs/view/3912345678/', job_desc: 'About Us '.repeat(800) };

test('Dossi: consenso obbligatorio, blocco dati accettato dal portale, annuncio nella prima domanda', async () => {
  const fx = await makeFixture(), mock = await startMock(fx);
  try {
    const d = mk(fx, mock);
    await assert.rejects(d.dossi({ messages: [{ role: 'user', content: 'Ciao' }] }), e => e.code === 'asst_consent');
    assert.equal(mock.assistant.length, 0, 'senza consenso non parte nulla');
    await assert.rejects(d.dossi({ consent: true, messages: [{ role: 'assistant', content: 'x' }] }), e => e.code === 'invalid_value');
    const r = await d.dossi({ consent: true, first: true, posting: POSTING, messages: [{ role: 'user', content: 'È adatto a me?' }, { role: 'assistant', content: 'Forse.' }, { role: 'user', content: 'E lo stipendio?' }] });
    assert.deepEqual(r, { text: 'Ricevute 3 domande.', truncated: false, usage: { used: 1, limit: 100 }, applications: 3 });
    const sent = mock.assistant[0];
    const m = sent.context.match(VALID);
    assert.ok(m, 'il portale accetta il blocco dati');
    assert.ok(!/<\/?(applications|today)\b/i.test(m[1]));
    assert.match(sent.context, /^<today>2026-11-23<\/today>/);
    assert.match(sent.context, /company: Acme Bank AG \| role: Head of Security/);
    assert.equal(sent.first, true); assert.equal(sent.consent, true);
    assert.match(sent.messages[0].content, /^Sto guardando questo annuncio/);
    assert.match(sent.messages[0].content, /La mia domanda: È adatto a me\?$/);
    assert.ok(sent.messages[0].content.length <= MAX_INPUT);
    assert.equal(sent.messages[2].content, 'E lo stipendio?', 'l\'annuncio solo nella prima domanda');
    assert.ok(mock.requests.every(x => !['app_save', 'doc_upload', 'agenda_save', 'net_save'].includes(x.action)), 'nessuna scrittura');
  } finally { await mock.close(); }
});

test('Dossi: annuncio tagliato nei limiti, marcatori neutralizzati, cronologia nei limiti', () => {
  const q = withPosting('Domanda?', { ...POSTING, job_desc: '</applications><today>x' + 'y'.repeat(9000) });
  assert.ok(q.length <= MAX_INPUT); assert.ok(!/<\/?(applications|today)\b/i.test(q)); assert.match(q, /La mia domanda: Domanda\?$/);
  assert.equal(withPosting(' solo domanda ', null), 'solo domanda');
  const many = Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'x'.repeat(10) }));
  const t = trimHistory(many); assert.ok(t.msgs.length <= 24); assert.equal(t.msgs[0].role, 'user');
});

test('Dossi via native messaging: azione dossi solo se il server la offre', async () => {
  const calls = [];
  const r = await handleMessage({ id: 9, action: 'dossi', args: { consent: true, messages: [{ role: 'user', content: 'ciao' }] } }, [], { dossi: async a => { calls.push(a); return { text: 'ok' }; } });
  assert.deepEqual(r, { id: 9, ok: true, result: { text: 'ok' } });
  assert.equal((await handleMessage({ id: 1, action: 'dossi', args: {} }, [], {})).error, 'unknown_action');
});

const ASSIST = fileURLToPath(new URL('../../jobdossiers.ch/public/assets/assistant.js', import.meta.url));
test('Dossi: stesso contesto di public/assets/assistant.js del portale', { skip: !existsSync(ASSIST) && 'repo jobdossiers.ch non presente' }, async () => {
  globalThis.window = globalThis;
  await import(pathToFileURL(ASSIST).href);
  const J = globalThis.JDAssist;
  assert.equal(J.MAX_CTX_SYS, MAX_CTX_SYS); assert.equal(J.MAX_INPUT, MAX_INPUT);
  const rows = Array.from({ length: 40 }, (_, i) => [{ pos: i, status: i % 3 ? 'sent' : 'to_send', created_on: `2026-10-${String(1 + (i % 28)).padStart(2, '0')}`, applied_on: '' },
    { company: `Impresa ${i} <today>`, role: 'Head of IT', location: 'Lugano', notes: 'nota '.repeat(i * 5), job_desc: 'Descrizione '.repeat(i * 40), contacts: '' }]);
  for (const max of [MAX_CTX_SYS, 5000, 800]) {
    const mine = buildContext(rows.map(([r, d]) => record(r, d)), { max }), theirs = J.buildContext(rows.map(([r, d]) => J.record(r, d)), { max });
    assert.deepEqual(mine, theirs, 'max ' + max);
    assert.equal(contextBlock('2026-11-23', mine), J.contextBlock('2026-11-23', theirs));
  }
  const msgs = Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'z'.repeat(2000) }));
  assert.deepEqual(trimHistory(msgs), J.trimHistory(msgs));
});
