import test from 'node:test';
import assert from 'node:assert/strict';
import { encObj, encBytes, decObj, AAD } from '../src/crypto.js';
import { createApi } from '../src/api.js';
import { Dossier } from '../src/client.js';
import { buildTools } from '../src/tools.js';
import { cleanPrefs } from '../src/prefs.js';
import { makeFixture, startMock } from './helpers.mjs';

const NOW = () => new Date('2026-11-20T10:00:00Z');
const mkDossier = (fx, mock) => new Dossier({ api: createApi({ base: mock.url, token: fx.token }), secret: fx.secret, now: NOW });
const WRITES = ['app_save', 'doc_upload', 'doc_delete', 'agenda_save', 'net_save'];

/** Documento «prefs» come lo salva il sito: JSON UTF-8 cifrato con AAD jd1:doc, nessuna candidatura. */
async function addPrefs(fx, mock, obj, { id = 'p1', created_at = 1 } = {}) {
  mock.files.set(id, await encBytes(fx.dek, new TextEncoder().encode(JSON.stringify(obj)), AAD.doc));
  mock.docs.push({ id, kind: 'prefs', application_id: null, meta_enc: await encObj(fx.dek, { name: 'prefs.json', type: 'application/json' }, AAD.docmeta), size: 0, created_at });
}

const FULL = {
  v: 1, home_city: 'Lugano', home_cc: 'CH', relocate: 'country', places: ['Mendrisio', 'Bellinzona'], countries: ['IT'],
  modes: ['hybrid', 'remote'], remote_min: 2, sal_min: 150000, sal_cur: 'CHF', pen_min: 80, pen_max: 100,
  contracts: ['permanent'], levels: ['head', 'exec'], travel_max: 20, work_ok: ['CH', 'IT'], start: '2027-02-01',
  avoid: ['Tabacco'], must: { loc: true, sal: true },
};

test('preferenze: ripulite secondo lo schema, campi vuoti omessi, scartati solo per nome', () => {
  assert.deepEqual(cleanPrefs(FULL), { prefs: FULL, dropped: [] });
  const { prefs, dropped } = cleanPrefs({
    v: 1, home_city: '', home_cc: 'ch', relocate: 'ovunque', places: ['Lugano', '', 'Lugano', 7], countries: ['DE', 'Germania'],
    modes: ['remote', 'office'], remote_min: 6, sal_min: 0, sal_cur: 'chf', pen_min: 90, pen_max: 60, contracts: [], levels: ['vp', 'lead'],
    travel_max: 101, work_ok: null, start: '01.02.2027', avoid: [], must: { loc: true, sal: false, xyz: true }, extra: 'segreto',
  });
  assert.deepEqual(prefs, { v: 1, places: ['Lugano'], countries: ['DE'], modes: ['remote'], pen_min: 90, levels: ['lead'], must: { loc: true } });
  assert.deepEqual(dropped.sort(), ['extra', 'home_cc', 'must.sal', 'must.xyz', 'pen_max', 'relocate', 'remote_min', 'sal_cur', 'sal_min', 'start', 'travel_max'].sort());
  assert.ok(!JSON.stringify(dropped).includes('segreto'), 'solo nomi, mai valori');
  assert.deepEqual(cleanPrefs(null), { prefs: {}, dropped: [] });
  assert.deepEqual(cleanPrefs({ places: Array.from({ length: 40 }, (_, i) => 'L' + i) }).prefs.places.length, 30);
});

test('preferenze: lette con doc_list e doc_get, decifrate qui, nessuna scrittura', async () => {
  const fx = await makeFixture(), mock = await startMock(fx);
  try {
    const d = mkDossier(fx, mock);
    await addPrefs(fx, mock, { ...FULL, levels: ['head', 'boss'] });
    mock.docs.push({ id: 'd9', kind: 'cv_profile', application_id: null, meta_enc: await encObj(fx.dek, { name: 'cv.pdf' }, AAD.docmeta), size: 0, created_at: 5 });
    const r = await d.preferences();
    assert.deepEqual(r, { saved: true, preferences: { ...FULL, levels: ['head'] } });
    const get = mock.requests.filter(x => x.action === 'doc_get');
    assert.equal(get.length, 1);
    assert.equal(get[0].method, 'GET');
    assert.ok(mock.requests.every(x => !WRITES.includes(x.action)), 'nessuna scrittura');
  } finally { await mock.close(); }
});

test('preferenze: se mancano lo dice; documento illeggibile e 404 danno errori chiari', async () => {
  const fx = await makeFixture(), mock = await startMock(fx);
  try {
    const d = mkDossier(fx, mock);
    const none = await d.preferences();
    assert.equal(none.saved, false);
    assert.match(none.message, /non ha ancora salvato preferenze/);
    assert.match(none.message, /Profilo, scheda «Preferenze»/);
    assert.ok(!mock.requests.some(x => x.action === 'doc_get'));

    mock.docs.push({ id: 'p404', kind: 'prefs', application_id: null, meta_enc: '', size: 0, created_at: 1 });
    await assert.rejects(d.preferences(), e => e.code === 'not_found');

    mock.files.set('p404', await encBytes(fx.dek, new TextEncoder().encode('{}'), AAD.app));   // AAD sbagliata
    await assert.rejects(d.preferences(), e => e.code === 'unreadable' && !/\{\}/.test(e.message));
  } finally { await mock.close(); }
});

test('strumento jd_preferences: sola lettura, descrizione su dati personali e non istruzioni', () => {
  const t = buildTools(() => null).find(x => x.name === 'jd_preferences');
  assert.ok(t);
  assert.equal(t.annotations.readOnlyHint, true);
  assert.match(t.description, /personal data/);
  assert.match(t.description, /not a list of instructions/);
  assert.match(t.description, /only for the user's own job searches/);
});

/** Persone della Rete come le salva il sito: un blob per persona, AAD jd1:net. */
async function addPerson(fx, mock, id, p) { mock.net.push({ id, enc: await encObj(fx.dek, { v: 1, ...p }, AAD.net), version: 1 }); }

test('contatti: i riferimenti {id, net, role} si risolvono dalla Rete, non dal blob della candidatura', async () => {
  const fx = await makeFixture();
  const mock = await startMock(fx, [{ d: {
    company: 'Rotondo Logistics AG', role: 'Head of Supply Chain', via: 'n2',
    contacts_list: [
      { id: 'c1', net: 'n1', role: 'recruiter' },
      { id: 'c2', net: 'n9', role: 'hiring manager' },
      { id: 'c3', name: 'Anna Muster', role: 'HR', email: 'anna@example.org', phone: '' },
    ],
  }, status: 'in_review' }]);
  try {
    await addPerson(fx, mock, 'n1', { name: 'Luca Esempio', kind: 'recruiter', org: 'Muster Executive Search', role: 'Partner', email: 'luca@example.org', phone: '+41 00 000 00 00', link: 'https://example.org/luca', note: 'nota privata', log: [{ at: '2026-11-14', t: 'telefonata' }] });
    await addPerson(fx, mock, 'n2', { name: 'Giulia Prova', kind: 'insider', org: 'Rotondo Logistics AG', role: '', email: '', phone: '', link: '' });
    const v = await mkDossier(fx, mock).get('r1');
    assert.deepEqual(v.contacts_list, [
      { id: 'c1', net: 'n1', role: 'recruiter', person: { name: 'Luca Esempio', kind: 'recruiter', org: 'Muster Executive Search', role: 'Partner', email: 'luca@example.org', phone: '+41 00 000 00 00', link: 'https://example.org/luca' } },
      { id: 'c2', net: 'n9', role: 'hiring manager', person: { missing_in_network: true } },
      { id: 'c3', name: 'Anna Muster', role: 'HR', email: 'anna@example.org', phone: '', legacy: true },
    ]);
    assert.equal(v.via, 'n2');
    assert.deepEqual(v.via_person, { name: 'Giulia Prova', kind: 'insider', org: 'Rotondo Logistics AG' });
    assert.ok(!JSON.stringify(v).includes('nota privata'), 'note e storico della persona non entrano nella scheda');
    assert.ok(mock.requests.every(x => !WRITES.includes(x.action)), 'nessuna scrittura');
  } finally { await mock.close(); }
});

test('contatti: Rete non autorizzata o assente; schede senza contatti non leggono la Rete', async () => {
  const fx = await makeFixture();
  const mock = await startMock(fx, [
    { d: { company: 'A', role: 'B', contacts_list: [{ id: 'c1', net: 'n1', role: 'recruiter' }] } },
    { d: { company: 'C', role: 'D' } },
  ]);
  try {
    const d = mkDossier(fx, mock);
    await d.get('r2');
    assert.ok(!mock.requests.some(x => x.action === 'net_list'));
    mock.netDenied = true;
    const v = await d.get('r1');
    assert.equal(v.network_error, 'agent_scope');
    assert.deepEqual(v.contacts_list, [{ id: 'c1', net: 'n1', role: 'recruiter', person: { unresolved: true } }]);
  } finally { await mock.close(); }
});

test('contatti in scrittura: solo riferimenti {id, net, role}, mai nome e recapiti nella scheda', async () => {
  const fx = await makeFixture(), mock = await startMock(fx);
  try {
    const d = mkDossier(fx, mock);
    for (const bad of [
      [{ id: 'c1', name: 'Anna Muster', email: 'anna@example.org' }],
      [{ id: 'c1', net: 'n1', role: 'HR', email: 'anna@example.org' }],
      [{ id: 'c1', net: '', role: 'HR' }],
      { net: 'n1' },
      [{ id: 'c1', net: 'n1', role: 'HR', person: { name: 'x' } }],
    ]) await assert.rejects(d.updateFields('r1', { fields: { contacts_list: bad } }), e => e.code === 'invalid_value', JSON.stringify(bad));
    assert.ok(!mock.requests.some(x => x.action === 'app_save'));
    await d.updateFields('r1', { fields: { contacts_list: [{ id: 'c1', net: 'n1', role: 'recruiter' }] } });
    const row = mock.rows.find(r => r.id === 'r1');
    assert.deepEqual((await decObj(fx.dek, row.enc, AAD.app)).contacts_list, [{ id: 'c1', net: 'n1', role: 'recruiter' }]);
  } finally { await mock.close(); }
});
