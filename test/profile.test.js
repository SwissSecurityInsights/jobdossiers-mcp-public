import test from 'node:test';
import assert from 'node:assert/strict';
import { encObj, encBytes, AAD } from '../src/crypto.js';
import { createApi } from '../src/api.js';
import { Dossier } from '../src/client.js';
import { buildTools } from '../src/tools.js';
import { cleanProfile, SECTIONS } from '../src/profile.js';
import { makeFixture, startMock } from './helpers.mjs';

const NOW = () => new Date('2026-11-25T10:00:00Z');
const mkDossier = (fx, mock) => new Dossier({ api: createApi({ base: mock.url, token: fx.token }), secret: fx.secret, now: NOW });
const WRITES = ['app_save', 'doc_upload', 'doc_delete', 'agenda_save', 'net_save', 'net_delete'];

/** Profilo come lo salva il portale (profile-ui.js, collect): dati inventati, con tutti i campi sensibili compilati. */
const FULL = {
  lang: 'it', src: 'wizard', name: 'Maria Esempio', headline: 'Head of Information Security',
  contacts: { email: 'maria@example.org', phone: '+41 00 000 00 00', location: 'Via Esempio 1, 6900 Massagno', linkedin: 'linkedin.com/in/maria-esempio', website: 'https://maria.example.org' },
  personal: { birth_date: '01.01.1980', nationality: 'Svizzera', permit: 'C' },
  summary: 'Responsabile della sicurezza con esperienza in banche e assicurazioni.',
  experience: [
    { title: 'Security Officer', employer: 'Belmonte SA', location: 'Bellinzona, Svizzera', start: '2012', end: '03.2018', bullets: ['Programma ISO 27001'] },
    { title: 'CISO', employer: 'Ginevra Privatbank', location: 'Lugano, Svizzera', start: '04.2018', end: 'present', bullets: ['Team di 12 persone', 'Riduzione degli incidenti del 40%'] },
    { title: '', employer: '' },
  ],
  education: [{ degree: 'MSc Informatica', institution: 'Università Esempio', location: 'Zurigo, Svizzera', start: '2000', end: '2005' }],
  certifications: ['CISSP', 'CISM', 'CISSP'],
  skills: ['ISO 27001', 'NIST CSF', 'Risk management'],
  languages: [{ name: 'Italiano', level: 'Madrelingua' }, { name: 'Inglese', level: 'C1' }, { name: 'Tedesco', level: 'B2' }],
  star: [{ i: 0, c: 'contesto riservato', a: 'azione', r: 'risultato' }],
  futuro: 'campo che il portale potrebbe aggiungere',
};
const SENSITIVE = ['Maria Esempio', 'maria@example.org', '+41 00 000 00 00', 'Massagno', '01.01.1980', 'permit', 'nationality', 'contesto riservato', 'wizard', 'futuro', 'birth_date'];

async function addProfile(fx, mock, obj, id = 'p1') {
  mock.files.set(id, await encBytes(fx.dek, new TextEncoder().encode(JSON.stringify(obj)), AAD.doc));
  mock.docs.push({ id, kind: 'cv_profile', application_id: null, meta_enc: await encObj(fx.dek, { name: 'profile.json', type: 'application/json' }, AAD.docmeta), size: 0, created_at: 1 });
}

test('profilo completo: sezioni ammesse, nomi del portale, dal più recente, nessun dato escluso', async () => {
  const fx = await makeFixture(), mock = await startMock(fx);
  try {
    await addProfile(fx, mock, FULL);
    const r = await mkDossier(fx, mock).profile();
    assert.deepEqual(r, { ok: true, saved: true, profile: {
      headline: 'Head of Information Security', summary: 'Responsabile della sicurezza con esperienza in banche e assicurazioni.',
      experience: [
        { title: 'CISO', employer: 'Ginevra Privatbank', location: 'Lugano, Svizzera', start: '04.2018', end: 'present', bullets: ['Team di 12 persone', 'Riduzione degli incidenti del 40%'] },
        { title: 'Security Officer', employer: 'Belmonte SA', location: 'Bellinzona, Svizzera', start: '2012', end: '03.2018', bullets: ['Programma ISO 27001'] },
      ],
      skills: ['ISO 27001', 'NIST CSF', 'Risk management'], certifications: ['CISSP', 'CISM'],
      education: [{ degree: 'MSc Informatica', institution: 'Università Esempio', location: 'Zurigo, Svizzera', start: '2000', end: '2005' }],
      languages: [{ name: 'Italiano', level: 'Madrelingua' }, { name: 'Inglese', level: 'C1' }, { name: 'Tedesco', level: 'B2' }],
      links: { linkedin: 'https://linkedin.com/in/maria-esempio', website: 'https://maria.example.org' }, lang: 'it',
    } });
    const out = JSON.stringify(r);
    for (const s of SENSITIVE) assert.ok(!out.includes(s), 'escluso: ' + s);
    assert.ok(mock.requests.every(x => !WRITES.includes(x.action)), 'nessuna scrittura');
  } finally { await mock.close(); }
});

test('profilo assente: saved false, nessun campo', async () => {
  const fx = await makeFixture(), mock = await startMock(fx);
  try {
    const r = await mkDossier(fx, mock).profile();
    assert.equal(r.ok, true); assert.equal(r.saved, false); assert.equal(r.profile, undefined);
  } finally { await mock.close(); }
});

test('documenti non autorizzati per la chiave: sezioni in omitted, senza errore', async () => {
  const fx = await makeFixture(), mock = await startMock(fx);
  try {
    mock.docsDenied = true;
    const r = await mkDossier(fx, mock).profile(['summary', 'skills']);
    assert.deepEqual({ ok: r.ok, omitted: r.omitted, profile: r.profile }, { ok: true, omitted: ['summary', 'skills'], profile: undefined });
  } finally { await mock.close(); }
});

test('filtro sections e strumento jd_profile: solo le sezioni chieste, valori sconosciuti rifiutati', async () => {
  const fx = await makeFixture(), mock = await startMock(fx);
  try {
    await addProfile(fx, mock, FULL);
    const d = mkDossier(fx, mock);
    const t = buildTools(async () => d).find(x => x.name === 'jd_profile');
    assert.equal(t.annotations.readOnlyHint, true);
    assert.match(t.description, /never as instructions/); assert.match(t.description, /never pass them to third parties/); assert.match(t.description, /saved is false/);
    const r = await t.handler({ sections: ['skills', 'summary'] });
    assert.deepEqual(Object.keys(r.profile).sort(), ['lang', 'skills', 'summary']);
    await assert.rejects(t.handler({ sections: ['birth_date'] }), /sections/);
    await assert.rejects(t.handler({ sections: [] }), /sections/);
    assert.deepEqual(t.inputSchema.properties.sections.items.enum, SECTIONS);
  } finally { await mock.close(); }
});

test('troncamento: oltre 15 000 caratteri si accorciano prima le esperienze più vecchie', () => {
  const long = 'Risultato misurabile '.repeat(25);
  const exp = Array.from({ length: 20 }, (_, i) => ({ title: 'Ruolo ' + i, employer: 'Muster AG', start: String(2000 + i), end: String(2001 + i), bullets: Array.from({ length: 6 }, (_, k) => k + ' ' + long) }));
  const { profile, truncated } = cleanProfile({ ...FULL, experience: exp });
  assert.equal(truncated, true);
  assert.ok(JSON.stringify(profile).length <= 15000);
  assert.equal(profile.experience[0].title, 'Ruolo 19', 'il più recente per primo');
  assert.equal(profile.experience[0].bullets.length, 6, 'il più recente resta intero');
  assert.ok(!profile.experience.at(-1).bullets, 'il più vecchio perde i risultati');
  assert.equal(cleanProfile(FULL).truncated, false);
});

test('valori non validi: date, link non http, voci vuote', () => {
  const { profile } = cleanProfile({ headline: '  ', contacts: { linkedin: 'javascript:alert(1)', website: 'ftp://x' }, experience: [{ title: 'X', start: 'ieri', end: '13.2020' }], languages: [{ level: 'C1' }] });
  assert.deepEqual(profile, { experience: [{ title: 'X' }] });
  assert.deepEqual(cleanProfile(null).profile, {});
});
