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
  assert.deepEqual(cleanPrefs({ commute_max: 45, must: { com: true } }).prefs, { commute_max: 45, must: { com: true } });
  assert.deepEqual(cleanPrefs({ commute_max: 1000 }).dropped, ['commute_max']);
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

test('contatti dall\'annuncio: nuove persone nella Rete (formato del portale), già presenti riusate, scheda con soli riferimenti', async () => {
  const fx = await makeFixture();
  const mock = await startMock(fx, [{ d: { company: 'Muster AG', role: 'Cloud Security Architect', contacts_list: [{ id: 'c1', net: 'n1', role: 'recruiter' }] } }]);
  try {
    mock.net.push({ id: 'n1', version: 1, enc: await encObj(fx.dek, { v: 1, name: 'Luca Esempio', kind: 'recruiter', org: 'Muster AG', role: 'Partner', email: '', phone: '', link: '', note: '', log: [] }, AAD.net) });
    mock.net.push({ id: 'n2', version: 1, enc: await encObj(fx.dek, { v: 1, name: 'Giulia Prova', kind: 'insider', org: 'Belmonte SA', role: '', email: '', phone: '', link: 'https://www.linkedin.com/in/giulia-prova/', note: '', log: [] }, AAD.net) });
    const d = mkDossier(fx, mock);
    const r = await d.addContacts('r1', [
      { name: 'Anna Muster', role: 'Associate Partner, People | Talent Acquisition', link: 'https://www.linkedin.com/in/anna-muster-123/', poster: true },
      { name: 'Luca Esempio', role: 'Head of Security', link: 'https://www.linkedin.com/in/luca-esempio/' },      // stesso nome e società: già nella Rete
      { name: 'Giulia Prova', role: 'CISO', link: 'https://ch.linkedin.com/in/giulia-prova' },                    // stesso profilo
      { name: '', role: 'x' }, { name: 'Malevolo', link: 'javascript:alert(1)' },
    ]);
    assert.equal(r.created, 2, 'Anna e «Malevolo» (senza link): le altre due ci sono già');
    assert.deepEqual(r.already, ['Luca Esempio']);
    assert.equal(r.linked, 3);
    const anna = await decObj(fx.dek, mock.net[2].enc, AAD.net);
    assert.deepEqual({ ...anna, note: '' }, { v: 1, name: 'Anna Muster', kind: 'recruiter', org: 'Muster AG', role: 'Associate Partner, People | Talent Acquisition', email: '', phone: '', link: 'https://www.linkedin.com/in/anna-muster-123/', note: '', log: [] });
    assert.equal((await decObj(fx.dek, mock.net[3].enc, AAD.net)).link, '', 'link non LinkedIn scartato');
    const app = await decObj(fx.dek, mock.rows[0].enc, AAD.app);
    assert.deepEqual(app.contacts_list.map(c => [c.net, c.role]), [['n1', 'recruiter'], ['n102', 'Job poster'], ['n2', 'Hiring team'], ['n103', 'Hiring team']]);
    assert.ok(app.contacts_list.every(c => Object.keys(c).every(k => ['id', 'net', 'role'].includes(k))), 'nella scheda solo riferimenti');
    // di nuovo: niente doppioni né nella Rete né nella scheda
    const again = await d.addContacts('r1', [{ name: 'Anna Muster', link: 'https://www.linkedin.com/in/anna-muster-123/' }]);
    assert.deepEqual(again, { created: 0, linked: 0, already: ['Anna Muster'], day: '2026-11-20' });
    assert.equal(mock.net.length, 4);
    // interoperabilità: il portale legge la persona così com'è
    try {
      const { createRequire } = await import('node:module');
      const JDNet = createRequire(import.meta.url)('../../jobdossiers.ch/public/assets/network.js');
      assert.deepEqual(JDNet.normalize(anna), anna);
    } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
    await assert.rejects(d.addContacts('r1', [{ name: '' }]), /Nessun contatto valido/);
    await assert.rejects(d.addContacts('r9', [{ name: 'X' }]), /non trovata/);
  } finally { await mock.close(); }
});

test('Rete nell\'impresa dell\'annuncio: stessa impresa scritta in modi diversi, solo nome, tipo e ruolo', async () => {
  const fx = await makeFixture(), mock = await startMock(fx, []);
  try {
    const add = async (id, p) => mock.net.push({ id, version: 1, enc: await encObj(fx.dek, { v: 1, email: 'x@example.org', phone: '+41 00', note: 'nota privata', log: [], link: '', ...p }, AAD.net) });
    await add('n1', { name: 'Luca Esempio', kind: 'colleague', org: 'Swiss Life Group AG', role: 'Head of IT' });
    await add('n2', { name: 'Anna Muster', kind: 'recruiter', org: 'Muster Executive Search', role: 'Partner' });
    await add('n3', { name: 'Giulia Prova', kind: 'insider', org: 'Swiss Life', role: '' });
    const d = mkDossier(fx, mock);
    const r = await d.networkAt('Swiss Life Schweiz');
    assert.deepEqual(r.people.map(p => p.name).sort(), ['Giulia Prova', 'Luca Esempio']);
    assert.ok(!JSON.stringify(r).includes('example.org') && !JSON.stringify(r).includes('nota privata'), 'niente recapiti né note');
    assert.deepEqual((await d.networkAt('AG')).people, [], 'nome troppo generico');
    assert.ok(mock.requests.every(x => !WRITES.includes(x.action)), 'nessuna scrittura');
  } finally { await mock.close(); }
});

test('candidature nella stessa impresa: ruolo, stato e date, senza testi; eliminate escluse', async () => {
  const fx = await makeFixture();
  const mock = await startMock(fx, [
    { d: { company: 'Swiss Life AG', role: 'Head of IT Security', notes: 'nota privata', job_desc: 'testo' }, status: 'rejected', status_changed_on: '2026-03-10' },
    { d: { company: 'Swiss Life Group', role: 'CISO' }, status: 'deleted' },
    { d: { company: 'Belmonte SA', role: 'CISO' }, status: 'sent' },
    { d: { company: 'Swiss Life Schweiz', role: 'Security Architect' }, status: 'interview', status_changed_on: '2026-11-01' },
  ]);
  try {
    const r = await mkDossier(fx, mock).companyHistory('Swiss Life');
    assert.deepEqual(r.applications.map(a => [a.role, a.status]), [['Security Architect', 'interview'], ['Head of IT Security', 'rejected']]);
    assert.ok(!JSON.stringify(r).includes('nota privata') && !JSON.stringify(r).includes('testo'));
    assert.ok(mock.requests.every(x => !WRITES.includes(x.action)), 'nessuna scrittura');
  } finally { await mock.close(); }
});
