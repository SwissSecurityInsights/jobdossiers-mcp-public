import test from 'node:test';
import assert from 'node:assert/strict';
import { jobFacts, compare } from '../extension/match.js';
import { fields } from '../extension/parse.js';

const TODAY = '2026-11-22';
const PREFS = {
  v: 1, home_city: 'Lugano', home_cc: 'CH', relocate: 'country', places: ['Mendrisio', 'Bellinzona'], countries: ['IT'],
  modes: ['hybrid', 'remote'], remote_min: 2, sal_min: 150000, sal_cur: 'CHF', pen_min: 80, pen_max: 100,
  contracts: ['permanent'], levels: ['head', 'exec'], travel_max: 20, work_ok: ['CH', 'IT'], start: '2027-01-01',
  avoid: ['Tabacco', 'gambling'], must: { loc: true, sal: true },
};
const run = (raw, prefs = PREFS) => {
  const f = fields(raw);
  return Object.fromEntries(compare(prefs, jobFacts(raw, f), TODAY).map(r => [r.id, r]));
};
const ld = o => JSON.stringify({ '@context': 'https://schema.org', '@type': 'JobPosting', ...o });

test('confronto: annuncio con dati strutturati, tutto corrisponde', () => {
  const r = run({
    url: 'https://careers.rotondo.example/jobs/42',
    ld: [ld({
      title: 'Head of Supply Chain 80-100% (m/w/d)', hiringOrganization: { name: 'Rotondo Logistics SA' }, industry: 'Logistica',
      jobLocation: { address: { postalCode: '6900', addressLocality: 'Lugano', addressCountry: 'CH' } },
      baseSalary: { currency: 'CHF', value: { minValue: 140000, maxValue: 165000, unitText: 'YEAR' } },
      employmentType: ['FULL_TIME'], jobStartDate: '2027-02-01',
      description: '<p>Contratto a tempo indeterminato. Modello ibrido con 2 giorni da remoto. Trasferte: circa 10% travel.</p>',
    })],
  });
  assert.deepEqual(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v.result])),
    { loc: 'ok', mode: 'ok', sal: 'ok', pen: 'ok', con: 'ok', lvl: 'ok', trv: 'ok', spo: 'ok', sta: 'ok', sec: 'ok' });
  assert.equal(r.loc.job, 'Lugano, CH'); assert.equal(r.loc.must, true); assert.equal(r.sal.must, true); assert.equal(r.mode.must, false);
  assert.equal(r.sal.job, 'CHF 140’000–165’000'); assert.match(r.sal.note, /minimo è sotto/);
  assert.equal(r.pen.job, '80–100%'); assert.equal(r.lvl.job, 'head / direttore');
  assert.equal(r.mode.job, 'ibrido, 2 giorni da remoto'); assert.equal(r.trv.job, '10%');
});

test('confronto: solo testo, con dati che non corrispondono', () => {
  const desc = `Für unseren Standort in Zürich suchen wir per sofort einen Senior Data Engineer (100%).
Befristet auf 12 Monate. Lohn: CHF 110'000 – 125'000. Reisetätigkeit ca. 40%. Sie arbeiten vor Ort. Branche: Tabacco & Retail.`;
  const r = run({ url: 'https://example.ch/job/7', h1: 'Senior Data Engineer', og_site: 'Beispiel AG', desc });
  assert.equal(r.loc.result, 'unknown', 'luogo solo nel testo, senza paese: non si indovina'); assert.equal(r.loc.job, 'non indicato');
  assert.equal(r.mode.result, 'no'); assert.equal(r.mode.job, 'in sede');
  assert.equal(r.sal.result, 'no'); assert.equal(r.sal.job, 'CHF 110’000–125’000');
  assert.equal(r.pen.result, 'ok'); assert.equal(r.pen.job, '100%');
  assert.equal(r.con.result, 'no'); assert.equal(r.con.job, 'tempo determinato');
  assert.equal(r.lvl.result, 'no'); assert.equal(r.lvl.job, 'specialista');
  assert.equal(r.trv.result, 'no'); assert.equal(r.sta.result, 'ok', 'da subito e tu dal 2027-01-01, entro 45 giorni');
  const later = run({ url: 'https://example.ch/job/7', h1: 'Senior Data Engineer', desc }, { start: '2027-03-01' });
  assert.equal(later.sta.result, 'unknown'); assert.match(later.sta.note, /2027-03-01/);
  assert.equal(r.sec.result, 'no'); assert.equal(r.sec.job, 'trovato: Tabacco');
});

test('confronto: dati mancanti danno «?» e mai ✗', () => {
  const r = run({ url: 'https://example.org/a', title: 'Annuncio', h1: 'Responsabile acquisti', desc: 'Bella opportunità.' });
  for (const k of ['mode', 'sal', 'pen', 'con', 'trv', 'spo', 'sta']) assert.equal(r[k].result, 'unknown', k);
  assert.equal(r.loc.result, 'unknown'); assert.equal(r.loc.job, 'non indicato');
  assert.equal(r.lvl.result, 'ok', '«Responsabile» = head');
  assert.equal(r.sec.result, 'ok');
});

test('confronto: luogo, permesso e preferenze non impostate', () => {
  const abroad = { url: 'https://x.de/j', ld: [ld({ title: 'Head of IT', jobLocation: { address: { addressLocality: 'Berlin', addressCountry: 'DE' } }, description: 'No visa sponsorship.' })] };
  let r = run(abroad);
  assert.equal(r.loc.result, 'no'); assert.equal(r.spo.result, 'no');
  r = run(abroad, { ...PREFS, relocate: 'any' });
  assert.equal(r.loc.result, 'ok');
  r = run({ ...abroad, ld: [ld({ title: 'Head of IT', jobLocation: { address: { addressLocality: 'Berlin', addressCountry: 'DE' } }, jobLocationType: 'TELECOMMUTE' })] });
  assert.equal(r.loc.result, 'ok'); assert.equal(r.loc.note, 'lavoro da remoto'); assert.equal(r.spo.result, 'unknown');
  r = run({ url: 'https://x.ch/j', h1: 'Head of IT', employer_zip_city: '', desc: 'Sede: Bellinzona' }, { home_city: 'Lugano', places: ['Bellinzona'], relocate: 'no' });
  assert.deepEqual(Object.keys(r), ['loc'], 'solo le preferenze impostate');
  const f = fields({ url: 'https://x.ch/j', h1: 'Head of IT' }); f.employer_zip_city = '6500 Bellinzona';
  assert.equal(compare({ home_city: 'Lugano', places: ['Bellinzona'] }, jobFacts({ url: 'https://x.ch/j' }, f), TODAY)[0].result, 'ok');
  assert.deepEqual(compare({}, jobFacts({}, fields({})), TODAY), []);
  assert.deepEqual(compare(null, null, TODAY), []);
});

test('confronto: modalità ibrida con meno giorni da remoto del minimo', () => {
  const r = run({ url: 'https://x.ch/j', h1: 'Head of IT', desc: 'Hybrid working: 1 day from home per week.' }, { modes: ['hybrid'], remote_min: 2 });
  assert.equal(r.mode.result, 'no'); assert.equal(r.mode.note, 'ne vuoi almeno 2');
  const s = run({ url: 'https://x.ch/j', h1: 'Head of IT', desc: 'Hybrid, 3 Tage Homeoffice.' }, { modes: ['hybrid'], remote_min: 2 });
  assert.equal(s.mode.result, 'ok'); assert.equal(s.mode.job, 'ibrido, 3 giorni da remoto');
  const one = run({ url: 'https://x.ch/j', h1: 'Head of IT', desc: 'Modello ibrido, 1 giorno da remoto.' }, { modes: ['hybrid'], remote_min: 2 });
  assert.equal(one.mode.result, 'no'); assert.equal(one.mode.job, 'ibrido, 1 giorno da remoto');
});

test('confronto: «a freelancer» tra i clienti non è un contratto freelance; le etichette del riquadro contano', () => {
  const raw = { url: 'https://www.linkedin.com/jobs/view/3912345678/', top: { title: 'CISO', location: 'Lugano, Ticino, Switzerland', text: '✓ Hybrid ✓ Full-time' },
    about: 'A platform that works for One — a business owner, an artist, a freelancer.' };
  const r = Object.fromEntries(compare({ contracts: ['permanent'], modes: ['hybrid'], pen_min: 80 }, jobFacts(raw, fields(raw)), TODAY).map(x => [x.id, x]));
  assert.equal(r.con.result, 'unknown'); assert.equal(r.mode.result, 'ok'); assert.equal(r.pen.job, '100%');
  const fl = { url: 'https://x.example/j', h1: 'Security Consultant', about: 'This is a freelance position for 6 months.' };
  assert.equal(compare({ contracts: ['permanent'] }, jobFacts(fl, fields(fl)), TODAY)[0].job, 'freelance');
});
