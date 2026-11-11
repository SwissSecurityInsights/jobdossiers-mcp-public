import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decObj, decBytes, encObj, AAD } from '../src/crypto.js';
import { createApi } from '../src/api.js';
import { Dossier } from '../src/client.js';
import { makeFixture, startMock } from './helpers.mjs';

const NOW = () => new Date('2026-11-07T10:00:00Z');
const mkDossier = (fx, mock) => new Dossier({ api: createApi({ base: mock.url, token: fx.token }), secret: fx.secret, now: NOW });

async function files() {
  const dir = await mkdtemp(join(tmpdir(), 'jd-upload-'));
  const pdf = join(dir, 'CV Anna Muster.pdf'); await writeFile(pdf, Buffer.from('%PDF-1.7 contenuto riservato'));
  const txt = join(dir, 'note.txt'); await writeFile(txt, 'x');
  const empty = join(dir, 'vuoto.docx'); await writeFile(empty, '');
  const link = join(dir, 'link.pdf'); await symlink(txt, link);
  return { dir, pdf, txt, empty, link };
}

test('caricamento: il file si cifra qui (byte e metadati) e arriva come CV della candidatura', async () => {
  const fx = await makeFixture(), mock = await startMock(fx), f = await files();
  try {
    const d = mkDossier(fx, mock);
    const r = await d.uploadDoc('r2', 'cv', f.pdf, { root: undefined });
    assert.deepEqual(r, { id: 'd1', application_id: 'r2', kind: 'cv', name: 'CV Anna Muster.pdf', size: 28 });
    const up = mock.uploads[0];
    assert.equal(up.kind, 'cv'); assert.equal(up.app, 'r2');
    assert.ok(!Buffer.from(up.bytes).toString('latin1').includes('riservato'), 'i byte viaggiano cifrati');
    assert.equal(Buffer.from(await decBytes(fx.dek, up.bytes, AAD.doc)).toString(), '%PDF-1.7 contenuto riservato');
    assert.deepEqual(await decObj(fx.dek, up.meta, AAD.docmeta), { name: 'CV Anna Muster.pdf', type: 'application/pdf', size: 28 });
    const req = mock.requests.find(x => x.action === 'doc_upload');
    assert.equal(req.headers['content-type'], 'application/octet-stream');
    assert.ok(!req.body.includes('riservato') && !JSON.stringify(req.headers).includes('Anna'), 'né il contenuto né il nome del file passano in chiaro');
  } finally { await mock.close(); await rm(f.dir, { recursive: true }); }
});

test('caricamento: regole su scheda, tipo di documento e file', async () => {
  const fx = await makeFixture(), mock = await startMock(fx), f = await files();
  try {
    const d = mkDossier(fx, mock);
    await assert.rejects(d.uploadDoc('r3', 'cv', f.pdf), e => e.code === 'read_only');
    await assert.rejects(d.uploadDoc('nope', 'cv', f.pdf), e => e.code === 'not_found');
    await assert.rejects(d.uploadDoc('r2', 'cv_profile', f.pdf), e => e.code === 'invalid_value');
    await assert.rejects(d.uploadDoc('r2', 'cv', f.txt), e => e.code === 'invalid_value', 'solo .pdf e .docx');
    await assert.rejects(d.uploadDoc('r2', 'cv', f.link), e => e.code === 'invalid_value', 'un .pdf che punta a un altro file non passa');
    await assert.rejects(d.uploadDoc('r2', 'cv', f.empty), e => e.code === 'invalid_value', 'file vuoto');
    await assert.rejects(d.uploadDoc('r2', 'cv', 'CV.pdf'), e => e.code === 'invalid_value', 'percorso relativo');
    await assert.rejects(d.uploadDoc('r2', 'cv', join(f.dir, 'manca.pdf')), e => e.code === 'not_found');
    await assert.rejects(d.uploadDoc('r2', 'cv', f.pdf, { root: tmpdir() + '/altra-cartella-che-non-esiste' }), e => e.code === 'invalid_value', 'fuori da JD_UPLOAD_DIR');
    assert.equal((await d.uploadDoc('r2', 'letter', f.pdf, { root: f.dir })).kind, 'letter', 'dentro JD_UPLOAD_DIR va');
    assert.equal(mock.uploads.length, 1, 'nessun caricamento partito per i casi rifiutati');
  } finally { await mock.close(); await rm(f.dir, { recursive: true }); }
});

// Stati ammessi e «mai sostituire» (07.11.2026)
const SEEDS_UP = () => [
  { d: { company: 'Inviata AG', role: 'CISO', note_log: [{ id: 'n0', at: '2026-11-01T08:00:00.000Z', kind: 'status', from: 'to_send', to: 'sent' }] }, status: 'sent', status_changed_on: '2026-11-01', applied_on: '2026-11-01' },
  { d: { company: 'Da inviare SA', role: 'CISO' }, status: 'to_send', status_changed_on: '2026-11-02' },
  { d: { company: 'Respinta GmbH', role: 'CISO' }, status: 'rejected', status_changed_on: '2026-11-03' },
  { d: { company: 'Colloquio AG', role: 'CISO' }, status: 'hr_interview', status_changed_on: '2026-11-04' },
  { d: { company: 'Colloquio nuovo SA', role: 'CISO' }, status: 'interview', status_changed_on: '2026-11-05' },
];
const rowOf = (mock, id) => mock.rows.find(r => r.id === id);
const notesOf = async (fx, mock, id) => (await decObj(fx.dek, rowOf(mock, id).enc, AAD.app)).note_log || [];

test('caricamento: scheda inviata senza CV → caricato; stato, date e storico invariati; nota [agente] aggiunta', async () => {
  const fx = await makeFixture(), mock = await startMock(fx, SEEDS_UP()), f = await files();
  try {
    const d = mkDossier(fx, mock);
    const before = { ...rowOf(mock, 'r1') }, notes0 = await notesOf(fx, mock, 'r1');
    const r = await d.uploadDoc('r1', 'cv', f.pdf);
    assert.equal(r.kind, 'cv'); assert.equal(r.note, true);
    const after = rowOf(mock, 'r1');
    assert.deepEqual([after.status, after.status_changed_on, after.applied_on], [before.status, before.status_changed_on, before.applied_on], 'stato, data di cambio stato e data di invio invariati');
    const saves = mock.requests.filter(x => x.action === 'app_save').map(x => JSON.parse(x.body));
    assert.ok(saves.length === 1 && Object.keys(saves[0].plain || {}).length === 0, 'la sola scrittura della scheda è la nota, senza campi in chiaro (stato e date)');
    const notes = await notesOf(fx, mock, 'r1');
    assert.deepEqual(notes.slice(0, notes0.length), notes0, 'lo storico precedente resta com\'era');
    assert.equal(notes.length, notes0.length + 1);
    assert.equal(notes.at(-1).text, '[agente] 2026-11-07 caricato cv: CV Anna Muster.pdf');
    assert.equal(notes.filter(n => n.kind === 'status').length, 1, 'nessuna voce di stato nuova');
  } finally { await mock.close(); await rm(f.dir, { recursive: true }); }
});

test('caricamento: CV già presente → doc_exists e nulla cambia (scheda inviata e «Da inviare»); la lettera si carica comunque', async () => {
  const fx = await makeFixture(), mock = await startMock(fx, SEEDS_UP()), f = await files();
  try {
    const d = mkDossier(fx, mock);
    await d.uploadDoc('r1', 'cv', f.pdf); await d.uploadDoc('r2', 'cv', f.pdf);
    const n0 = mock.uploads.length, saves0 = mock.requests.filter(x => x.action === 'app_save').length, docs0 = JSON.stringify(mock.docs), enc0 = rowOf(mock, 'r1').enc, ver0 = rowOf(mock, 'r1').version;
    await assert.rejects(d.uploadDoc('r1', 'cv', f.pdf), e => e.code === 'doc_exists' && /Esiste già un CV su questa candidatura: non viene sostituito/.test(e.message), 'scheda inviata con CV');
    await assert.rejects(d.uploadDoc('r2', 'cv', f.pdf), e => e.code === 'doc_exists', 'scheda «Da inviare» con CV');
    assert.equal(mock.uploads.length, n0, 'nessun caricamento'); assert.equal(JSON.stringify(mock.docs), docs0, 'nessun documento cambiato o tolto');
    assert.equal(mock.requests.filter(x => x.action === 'app_save').length, saves0, 'nessuna scrittura della scheda'); assert.equal(rowOf(mock, 'r1').enc, enc0); assert.equal(rowOf(mock, 'r1').version, ver0);
    const l = await d.uploadDoc('r2', 'letter', f.pdf);
    assert.equal(l.kind, 'letter', 'CV presente e lettera assente: la lettera si carica');
    assert.equal(l.note, undefined, '«Da inviare»: nessuna nota');
    await assert.rejects(d.uploadDoc('r2', 'letter', f.pdf), e => e.code === 'doc_exists' && /Esiste già una lettera/.test(e.message));
    assert.deepEqual(mock.docs.filter(x => x.application_id === 'r2').map(x => x.kind).sort(), ['cv', 'letter']);
  } finally { await mock.close(); await rm(f.dir, { recursive: true }); }
});

test('caricamento: stati bloccati → docs_locked; stati dopo l\'invio ammessi; chiamate parallele una alla volta', async () => {
  const fx = await makeFixture(), mock = await startMock(fx, SEEDS_UP()), f = await files();
  try {
    const d = mkDossier(fx, mock);
    await assert.rejects(d.uploadDoc('r3', 'cv', f.pdf), e => e.code === 'docs_locked', 'rejected: bloccato');
    assert.equal(mock.uploads.length, 0);
    const rs = await Promise.allSettled([d.uploadDoc('r4', 'cv', f.pdf), d.uploadDoc('r4', 'cv', f.pdf)]);
    assert.deepEqual(rs.map(x => x.status).sort(), ['fulfilled', 'rejected'], 'due chiamate insieme: una carica, l\'altra trova il CV');
    assert.equal(rs.find(x => x.status === 'rejected').reason.code, 'doc_exists');
    assert.equal(mock.uploads.length, 1, 'un solo caricamento');
    const iv = await d.uploadDoc('r5', 'letter', f.pdf);
    assert.ok(iv.kind === 'letter' && iv.note === true, 'stato «interview» del portale: ammesso, con la nota');
  } finally { await mock.close(); await rm(f.dir, { recursive: true }); }
});

test('agenda: crea, elenca decifrando, filtra e ordina per data', async () => {
  const fx = await makeFixture(), mock = await startMock(fx);
  try {
    const d = mkDossier(fx, mock);
    await assert.rejects(d.saveAgenda({ title: 'Senza data' }), e => e.code === 'invalid_value');
    await assert.rejects(d.saveAgenda({ title: 'X', at: '2026-11-10 12:00' }), e => e.code === 'invalid_value');
    await assert.rejects(d.saveAgenda({ title: 'X', at: '2026-11-10T12:00', kind: 'party' }), e => e.code === 'invalid_value');
    await assert.rejects(d.saveAgenda({ title: 'X', at: '2026-11-10T12:00', app: 'nope' }), e => e.code === 'not_found');
    const a = await d.saveAgenda({ title: 'Caffè con Anna', at: '2026-11-12T09:30', kind: 'informal', who: 'Anna', app: 'r1' });
    await d.saveAgenda({ title: 'Evento ISSS', at: '2026-11-10T18:00', kind: 'network', place: 'Zurigo' });
    assert.deepEqual(a, { id: 'a1', version: 1 });
    assert.deepEqual(await decObj(fx.dek, mock.agenda[0].enc, AAD.agenda), { v: 1, title: 'Caffè con Anna', at: '2026-11-12T09:30', kind: 'informal', place: '', who: 'Anna', note: '', app: 'r1' });
    assert.ok(!mock.agenda[0].enc.includes('Anna'), 'il titolo viaggia cifrato');
    const all = await d.agenda();
    assert.deepEqual(all.items.map(x => x.title), ['Evento ISSS', 'Caffè con Anna']);
    assert.equal((await d.agenda({ from: '2026-11-11' })).matched, 1);
    assert.equal((await d.agenda({ query: 'zurigo' })).items[0].title, 'Evento ISSS');
  } finally { await mock.close(); }
});

test('agenda: modifica solo i campi dati, conserva gli sconosciuti, riprova su conflitto', async () => {
  const fx = await makeFixture(), mock = await startMock(fx);
  try {
    mock.agenda.push({ id: 'z9', version: 3, enc: await encObj(fx.dek, { v: 1, title: 'Pranzo', at: '2026-11-20T12:00', kind: 'informal', place: 'Lugano', who: '', note: '', app: '', extra: 'keep-me' }, AAD.agenda) });
    mock.agenda.push({ id: 'bad', version: 1, enc: '{"v":1,"iv":"AAAAAAAAAAAAAAAA","ct":"AAAA"}' });
    const d = mkDossier(fx, mock);
    mock.conflictOnce = true;
    assert.deepEqual(await d.saveAgenda({ id: 'z9', note: 'Portare il CV' }), { id: 'z9', version: 5 });
    const z = await decObj(fx.dek, mock.agenda[0].enc, AAD.agenda);
    assert.equal(z.note, 'Portare il CV'); assert.equal(z.place, 'Lugano'); assert.equal(z.extra, 'keep-me');
    await assert.rejects(d.saveAgenda({ id: 'z9' }), e => e.code === 'invalid_value', 'niente da aggiornare');
    await assert.rejects(d.saveAgenda({ id: 'bad', note: 'x' }), e => e.code === 'unreadable');
    await assert.rejects(d.saveAgenda({ id: 'zz', note: 'x' }), e => e.code === 'not_found');
    const items = (await d.agenda()).items;
    assert.ok(items.some(x => x.id === 'bad' && x.unreadable), 'un appuntamento non decifrabile si segnala, senza bloccare gli altri');
  } finally { await mock.close(); }
});

test('caricamento: limite orario del portale (429) → messaggio chiaro, attesa se il portale la indica, nessuna nota', async () => {
  const fx = await makeFixture(), mock = await startMock(fx, SEEDS_UP()), f = await files();
  try {
    const d = mkDossier(fx, mock);
    mock.uploadLimited = true;
    await assert.rejects(d.uploadDoc('r1', 'cv', f.pdf), e => e.code === 'rate_limited' && e.retryAfter === undefined
      && /al massimo 30 all'ora, su una finestra mobile di 60 minuti/.test(e.message) && /non è stato caricato/.test(e.message) && !e.message.includes(f.dir));
    mock.retryAfter = 1500;
    await assert.rejects(d.uploadDoc('r1', 'cv', f.pdf), e => e.code === 'rate_limited' && e.retryAfter === 1500 && /Riprova tra circa 25 minuti/.test(e.message));
    assert.equal(mock.uploads.length, 0);
    assert.equal(mock.requests.filter(x => x.action === 'app_save').length, 0, 'nessuna nota per un caricamento non avvenuto');
    mock.uploadLimited = false;
    assert.equal((await d.uploadDoc('r1', 'cv', f.pdf)).kind, 'cv', 'tolto il blocco il caricamento riparte');
  } finally { await mock.close(); await rm(f.dir, { recursive: true }); }
});
