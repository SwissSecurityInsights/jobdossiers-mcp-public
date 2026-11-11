import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseKey, openDek, encObj, decObj, encBytes, decBytes, wrapDekForAgent, AAD } from '../src/crypto.js';
import { createApi, ApiError } from '../src/api.js';
import { Dossier } from '../src/client.js';
import { normUrl, platformIds, findDuplicates } from '../src/dedupe.js';
import { makeFixture, startMock } from './helpers.mjs';

const NOW = () => new Date('2026-10-26T10:00:00Z');
const mkDossier = (fx, mock) => new Dossier({ api: createApi({ base: mock.url, token: fx.token }), secret: fx.secret, now: NOW });
const decRow = async (fx, row) => decObj(fx.dek, row.enc, AAD.app);

test('cifratura: andata e ritorno, segreto e AAD sbagliati falliscono', async () => {
  const fx = await makeFixture();
  const dek = await openDek(fx.secret, fx.wrapped);
  const blob = await encObj(dek, { a: 1, t: 'è' }, AAD.app);
  assert.deepEqual(await decObj(dek, blob, AAD.app), { a: 1, t: 'è' });
  await assert.rejects(decObj(dek, blob, AAD.docmeta));
  const other = await makeFixture();
  await assert.rejects(openDek(other.secret, fx.wrapped));
  const b = JSON.parse(blob);
  assert.equal(b.v, 1); assert.equal(Buffer.from(b.iv, 'base64').length, 12);
});

test('parseKey rifiuta chiavi malformate senza ripeterle', () => {
  assert.throws(() => parseKey('jda1.corta.corta'), e => e.name === 'KeyFormatError' && !e.message.includes('corta'));
  assert.throws(() => parseKey('jda2.' + 'a'.repeat(43) + '.' + 'b'.repeat(43)));
  const k = 'jda1.' + 'a'.repeat(43) + '.' + 'b'.repeat(43);
  assert.deepEqual(parseKey(' ' + k + '\n'), { token: 'a'.repeat(43), secret: 'b'.repeat(43) });
});

const E2EE = fileURLToPath(new URL('../../jobdossiers.ch/public/assets/e2ee.js', import.meta.url));
test('interoperabilità con public/assets/e2ee.js del portale', { skip: !existsSync(E2EE) && 'repo JobDossiers non presente' }, async () => {
  globalThis.window = globalThis;
  await import(pathToFileURL(E2EE).href);
  const J = globalThis.JDCrypto;
  const dek = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const { secret, wrapped } = await J.newAgentKey(dek);
  const mine = await openDek(secret, wrapped);
  assert.deepEqual(await decObj(mine, await J.encObj(dek, { x: 'dal portale' }, AAD.app), AAD.app), { x: 'dal portale' });
  assert.deepEqual(await J.decObj(dek, await encObj(mine, { y: 'dal client' }, AAD.app), AAD.app), { y: 'dal client' });
  assert.deepEqual(await J.decObj(await J.openAgentKey(secret, await wrapDekForAgent(dek, secret)), await encObj(mine, { z: 1 }, AAD.docmeta), AAD.docmeta), { z: 1 });
  // file: il browser apre ciò che carica l'agente, e viceversa
  const bytes = new TextEncoder().encode('%PDF-1.7 CV');
  assert.deepEqual(await J.decBytes(dek, await encBytes(mine, bytes, AAD.doc), AAD.doc), bytes);
  assert.deepEqual(await decBytes(mine, await J.encBytes(dek, bytes, AAD.doc), AAD.doc), bytes);
  assert.deepEqual(await J.decObj(dek, await encObj(mine, { title: 'Caffè', at: '2026-11-12T09:30' }, AAD.agenda), 'jd1:agenda'), { title: 'Caffè', at: '2026-11-12T09:30' });
});

test('api: solo il portale o localhost, mai http remoto', () => {
  assert.throws(() => createApi({ base: 'https://evil.example', token: 't' }), ApiError);
  assert.throws(() => createApi({ base: 'http://jobdossiers.ch', token: 't' }), ApiError);
  assert.doesNotThrow(() => createApi({ base: 'https://jobdossiers.ch', token: 't' }));
  assert.doesNotThrow(() => createApi({ base: 'http://127.0.0.1:8080', token: 't' }));
});

test('dedupe: URL, ID di piattaforma, azienda+ruolo con recruiter', () => {
  assert.equal(normUrl('https://www.x.ch/jobs/1/?utm_source=a&b=2'), normUrl('https://x.ch/jobs/1?b=2'));
  const ids = platformIds('https://www.linkedin.com/jobs/view/senior-ciso-1234567890/ Indeed jk=0A1B2C3D4E5F6A7B jobs.ch 00000000-1111-4222-8333-444455556666');
  assert.deepEqual([...ids].sort(), ['indeed:0a1b2c3d4e5f6a7b', 'jobsch:00000000-1111-4222-8333-444455556666', 'linkedin:1234567890']);
  const items = [
    { row: { id: 'a', status: 'sent' }, d: { company: 'Beispiel AG (via Muster Executive Search)', role: 'Chief Information Security Officer (CISO)' } },
    { row: { id: 'b', status: 'to_send' }, d: { company: 'Da completare (example.org)', role: '', job_url: 'https://example.org/job/1' } },
    { row: { id: 'c', status: 'to_send' }, d: { company: 'X', role: 'Y', note_log: [{ text: 'LinkedIn 1234567890' }] } },
  ];
  assert.deepEqual(findDuplicates(items, { company: 'Muster Partners AG', alt_companies: ['Beispiel AG'], role: 'CISO (m/f/d) 80-100%' }).map(x => x.id), ['a']);
  assert.deepEqual(findDuplicates(items, { company: 'Beispiel AG', role: 'Head of SOC' }), []);
  assert.deepEqual(findDuplicates(items, { urls: ['https://www.example.org/job/1/'] }).map(x => x.id), ['b']);
  assert.deepEqual(findDuplicates(items, { text: 'https://www.linkedin.com/jobs/view/1234567890/' }).map(x => x.id), ['c']);
});

test('lista compatta e filtro incomplete', async () => {
  const fx = await makeFixture(), mock = await startMock(fx);
  try {
    const d = mkDossier(fx, mock);
    const all = await d.list();
    assert.equal(all.total, 3);
    assert.ok(!JSON.stringify(all).includes('SECRET JOB TEXT'));
    assert.deepEqual((await d.list({ incomplete: true })).rows.map(r => r.company), ['Da completare (example.org)']);
    const g = await d.get('r1', {});
    assert.equal(g.custom_field, 'keep-me'); assert.ok(g.job_desc_chars > 0); assert.equal(g.job_desc, undefined);
    assert.equal((await d.get('r1', { includeJobDesc: true })).job_desc, 'SECRET JOB TEXT');
  } finally { await mock.close(); }
});

test('create: duplicati rifiutati, nulla in chiaro al server, jobroom mai inviato', async () => {
  const fx = await makeFixture(), mock = await startMock(fx);
  try {
    const d = mkDossier(fx, mock);
    await assert.rejects(d.create({ company: 'Altra', role: 'Altro', job_url: 'https://careers.acme.example/jobs/42' }), e => e.code === 'duplicate');
    await assert.rejects(d.create({ company: 'Acme Bank', role: 'Head of Security (m/f/d)', job_url: 'https://x.example/1' }), e => e.code === 'duplicate');
    const r = await d.create({ company: 'Nuova Banca SA', role: 'CISO', job_url: 'https://nb.example/jobs/9', job_desc: 'TESTO RISERVATO', rav: 'SI', automation: 'assisted', note: 'verificato', fields: { pensum: '80-100%' } });
    const row = mock.rows.find(x => x.id === r.id);
    assert.equal(row.status, 'preparing'); assert.equal(row.rav, 'SI'); assert.equal(row.automation, 'assisted'); assert.equal(row.status_changed_on, '2026-10-26');
    const dec = await decRow(fx, row);
    assert.equal(dec.pensum, '80-100%'); assert.equal(dec.job_desc, 'TESTO RISERVATO'); assert.match(dec.note_log[0].text, /^\[agente\] verificato/);
    for (const q of mock.requests) {
      assert.ok(!q.body.includes(fx.secret) && !q.body.includes('Nuova Banca') && !q.body.includes('TESTO RISERVATO') && !q.body.includes('Acme'));
      assert.ok(!q.body.includes('jobroom_registered_on'));
    }
  } finally { await mock.close(); }
});

test('set_status: sent/withdrawn vietati, rejected registra stato e nota', async () => {
  const fx = await makeFixture(), mock = await startMock(fx);
  try {
    const d = mkDossier(fx, mock);
    await assert.rejects(d.setStatus('r1', 'sent'), e => e.code === 'invalid_value');
    await assert.rejects(d.setStatus('r1', 'withdrawn'), e => e.code === 'invalid_value');
    await d.setStatus('r1', 'rejected', 'Rifiuto via mail');
    const row = mock.rows[0];
    assert.equal(row.status, 'rejected'); assert.equal(row.status_changed_on, '2026-10-26'); assert.equal(row.jobroom_registered_on, '2026-10-21');
    const log = (await decRow(fx, row)).note_log;
    assert.deepEqual(log.filter(n => n.kind === 'status').map(n => [n.from, n.to]), [['in_review', 'rejected']]);
    assert.ok(log.some(n => /Rifiuto via mail/.test(n.text)));
    assert.deepEqual(await d.setStatus('r1', 'rejected'), { id: 'r1', unchanged: true });
    await d.setStatus('r1', 'deleted');
    assert.equal(mock.rows[0].status, 'deleted');
    await d.setStatus('r1', 'preparing');
    assert.equal(mock.rows[0].status, 'preparing');
    assert.equal((await d.list({ status: 'preparing' })).rows[0].id, 'r1');
  } finally { await mock.close(); }
});

test('update: campi sconosciuti conservati, note e campi protetti', async () => {
  const fx = await makeFixture(), mock = await startMock(fx);
  try {
    const d = mkDossier(fx, mock);
    await d.updateFields('r1', { fields: { pensum: '100%', address: 'Via X 1, 6900 Lugano, CH' }, rav: 'SI' });
    const dec = await decRow(fx, mock.rows[0]);
    assert.equal(dec.custom_field, 'keep-me'); assert.equal(dec.pensum, '100%'); assert.equal(dec.job_desc, 'SECRET JOB TEXT'); assert.equal(dec.note_log.length, 1);
    assert.equal(mock.rows[0].jobroom_registered_on, '2026-10-21');
    await assert.rejects(d.updateFields('r1', { fields: { note_log: [] } }), e => e.code === 'invalid_value');
    for (const k of ['match', 'job_check', 'jr_result', 'jr_interview']) await assert.rejects(d.updateFields('r1', { fields: { [k]: 1 } }), e => e.code === 'invalid_value');
    await assert.rejects(d.updateFields('r1', { fields: JSON.parse('{"__proto__":{"x":1}}') }), e => e.code === 'invalid_value');
    await assert.rejects(d.updateFields('r1', {}), e => e.code === 'invalid_value');
    await d.addNote('r1', 'seconda nota');
    assert.equal((await decRow(fx, mock.rows[0])).note_log.length, 2);
  } finally { await mock.close(); }
});

test('conflitto di versione: rilegge e riprova; sola lettura e illeggibili protette', async () => {
  const fx = await makeFixture(), mock = await startMock(fx);
  try {
    const d = mkDossier(fx, mock);
    mock.conflictOnce = true;
    await d.addNote('r1', 'dopo conflitto');
    assert.equal(mock.requests.filter(q => q.action === 'app_save').length, 2);
    assert.equal((await decRow(fx, mock.rows[0])).note_log.at(-1).text, '[agente] dopo conflitto');
    await assert.rejects(d.addNote('r3', 'x'), e => e.code === 'read_only');
    await assert.rejects(d.addNote('zzz', 'x'), e => e.code === 'not_found');
  } finally { await mock.close(); }
  const mock2 = await startMock(fx, [{ d: {}, rawEnc: '{"v":1,"iv":"AAAAAAAAAAAAAAAA","ct":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"}' }]);
  try { await assert.rejects(mkDossier(fx, mock2).addNote('r1', 'x'), e => e.code === 'unreadable'); } finally { await mock2.close(); }
});

test('token errato: unauthorized', async () => {
  const fx = await makeFixture(), mock = await startMock(fx);
  try {
    const d = new Dossier({ api: createApi({ base: mock.url, token: 'x'.repeat(43) }), secret: fx.secret, now: NOW });
    await assert.rejects(d.list(), e => e.code === 'unauthorized');
  } finally { await mock.close(); }
});

test('missing_docs: solo to_send senza CV o lettera; employer_zip_city nella vista', async () => {
  const fx = await makeFixture(), mock = await startMock(fx, [
    { d: { company: 'A', role: 'R1', employer_zip_city: '6900 Lugano' }, status: 'to_send' },
    { d: { company: 'B', role: 'R2' }, status: 'to_send' },
    { d: { company: 'C', role: 'R3' }, status: 'to_send' },
    { d: { company: 'D', role: 'R4' }, status: 'sent' },
  ]);
  const meta = async name => encObj(fx.dek, { name, type: 'application/pdf' }, AAD.docmeta);
  mock.docs = [
    { id: 'd1', kind: 'cv', application_id: 'r1', meta_enc: await meta('cv.pdf'), size: 1, created_at: 1 },
    { id: 'd2', kind: 'letter', application_id: 'r1', meta_enc: await meta('l.pdf'), size: 1, created_at: 1 },
    { id: 'd3', kind: 'cv', application_id: 'r2', meta_enc: await meta('cv2.pdf'), size: 1, created_at: 1 },
  ];
  try {
    const d = mkDossier(fx, mock);
    const r = await d.list({ missingDocs: true });
    assert.deepEqual(r.rows.map(x => [x.company, x.missing_docs]), [['C', ['cv', 'letter']], ['B', ['letter']]]);
    assert.equal((await d.list({ query: 'lugano' })).rows[0].employer_zip_city, '6900 Lugano');
  } finally { await mock.close(); }
});

test('stato interview: allineato al portale, i nomi vecchi valgono come interview', async () => {
  const fx = await makeFixture(), mock = await startMock(fx, [
    { d: { company: 'Vecchio AG', role: 'CISO' }, status: 'hr_interview' },
    { d: { company: 'Nuovo SA', role: 'CISO' }, status: 'interview' },
    { d: { company: 'Valutazione AG', role: 'CISO' }, status: 'in_review' },
  ]);
  try {
    const d = mkDossier(fx, mock);
    assert.deepEqual((await d.list({ status: 'interview' })).rows.map(r => r.company).sort(), ['Nuovo SA', 'Vecchio AG'], 'il filtro trova anche le schede con il nome vecchio');
    assert.equal((await d.list({ status: 'tech_interview' })).matched, 2, 'un nome vecchio nel filtro vale come interview');
    assert.deepEqual(await d.setStatus('r1', 'tech_interview'), { id: 'r1', unchanged: true }, 'già in colloquio: niente da cambiare');
    await d.setStatus('r3', 'hr_interview');
    assert.equal(mock.rows[2].status, 'interview', 'il nome vecchio si salva come interview');
    await assert.rejects(d.setStatus('r3', 'sent'), e => e.code === 'invalid_value');
    await assert.rejects(d.setStatus('r3', 'colloquio'), e => e.code === 'invalid_value');
  } finally { await mock.close(); }
});
