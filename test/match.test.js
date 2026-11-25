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

test('confronto: annunci di jobs.ch (città in addressRegion con «/Hybrid», ore settimanali, contratto in tedesco)', () => {
  const posting = (region, hours, type, title) => ({ url: 'https://www.jobs.ch/de/stellenangebote/detail/00000000-1111-4222-8333-444455556666/',
    ld: [ld({ title, hiringOrganization: { name: 'Muster Kantonalbank' }, employmentType: type, workHours: hours,
      jobLocation: { '@type': 'Place', address: { addressRegion: region, postalCode: '8750', addressCountry: 'CH' } }, description: '<p>Sicherheit.</p>' })] });
  const prefs = { home_cc: 'CH', relocate: 'country', places: ['Glarus'], modes: ['hybrid'], pen_min: 80, pen_max: 100, contracts: ['permanent'] };
  const a = posting('Glarus/Hybrid', '42 - 42 hours/week', 'Festanstellung', 'Information Security Officer');
  const fa = fields(a);
  assert.equal(fa.employer_zip_city, '8750 Glarus'); assert.equal(fa.employer_country, 'CH');
  const r = Object.fromEntries(compare(prefs, jobFacts(a, fa), TODAY).map(x => [x.id, x]));
  assert.deepEqual([r.loc.result, r.mode.result, r.pen.job, r.con.job], ['ok', 'ok', '100%', 'tempo indeterminato']);
  const b = posting('Windisch', '33.6 - 42 hours/week', 'Temporär', 'Security Analyst');
  const rb = Object.fromEntries(compare(prefs, jobFacts(b, fields(b)), TODAY).map(x => [x.id, x]));
  assert.deepEqual([rb.loc.job, rb.mode.result, rb.pen.job, rb.con.job, rb.con.result], ['Windisch, CH', 'unknown', '80–100%', 'interinale', 'no']);
  const c = posting('Biel/Bienne', '', 'Befristet', 'Information Security Officer (ISB) 80 / 100 %');
  const rc = Object.fromEntries(compare(prefs, jobFacts(c, fields(c)), TODAY).map(x => [x.id, x]));
  assert.deepEqual([fields(c).employer_zip_city, rc.pen.job, rc.con.job], ['8750 Biel/Bienne', '80–100%', 'tempo determinato'], 'la barra di Biel/Bienne resta, «80 / 100 %» è un intervallo');
});

test('jobs.ch: «100%» nel riquadro, contratto francese, «/Hybrid» tolto dall\'indirizzo', async () => {
  const { placeFromAddress } = await import('../extension/parse.js');
  assert.deepEqual(placeFromAddress('8750 Glarus/Hybrid', 'https://www.jobs.ch/en/'), { zipCity: '8750 Glarus', country: 'CH' });
  const r = { url: 'https://www.jobs.ch/fr/offres-emplois/detail/00000000-1111-4222-8333-444455556666/', ld: [], title: 'Analyste sécurité', h1: 'Analyste sécurité',
    site: { title: 'Analyste sécurité', company: 'Belmonte SA', place: '1630 Bulle', info: '20 novembre 2026 100% Durée indéterminée 1630 Bulle' } };
  const f = jobFacts(r, { role: 'Analyste sécurité', job_desc: 'Nous cherchons une personne.' });
  assert.deepEqual(f.pensum, { min: 100, max: 100 });
  assert.deepEqual(f.contracts, ['permanent']);
});

test('LinkedIn: etichetta «Hybrid» del riquadro prima del testo, «vor Ort» non è «in sede», «80% oder mehr» → 80–100', () => {
  const desc = 'Wir entwickeln mit unseren Kund:innen Lösungen direkt vor Ort.\nPensum: 80% oder mehr\nDein Arbeitsort ist vor Ort beim Kunden.';
  const base = { url: 'https://www.linkedin.com/jobs/view/3912345678/', ld: [], top: { title: 'Cloud Security Architect', text: 'Zurich, Switzerland · 1 day ago' } };
  const f = jobFacts({ ...base, top: { ...base.top, tags: ['Hybrid', 'Full-time'] } }, { role: 'Cloud Security Architect', job_desc: desc });
  assert.deepEqual(f.modes, ['hybrid']);
  assert.deepEqual(f.pensum, { min: 80, max: 100 });
  assert.deepEqual(jobFacts(base, { role: 'Cloud Security Architect', job_desc: desc }).modes, [], 'senza etichette: «vor Ort» non dice la modalità');
  assert.deepEqual(jobFacts({ ...base, top: { ...base.top, tags: ['On-site'] } }, { role: 'x', job_desc: '' }).modes, ['onsite']);
});

test('tragitto casa-lavoro: il tempo più breve rispetto al massimo, senza il mezzo nel nome', async () => {
  const { commuteRow } = await import('../extension/match.js');
  const p = { commute_max: 60, must: { com: true } };
  assert.equal(commuteRow({}, { seconds: 100 }), null, 'senza massimo nessuna riga');
  assert.deepEqual(commuteRow(p, { seconds: 50 * 60 }), { id: 'com', label: 'Tragitto casa-lavoro', must: true, note: 'massimo 60 min', job: '50 min', result: 'ok' });
  assert.equal(commuteRow(p, { seconds: 99 * 60 }).result, 'no'); assert.equal(commuteRow(p, { seconds: 99 * 60 }).job, '1 h 39 min');
  assert.equal(commuteRow(p, { ask: true }).result, 'unknown');
  assert.equal(commuteRow(p, null).job, 'non calcolabile');
  assert.equal(commuteRow(p, { seconds: 0 }).job, 'non disponibile');
  assert.ok(!/auto|mezzi/i.test(commuteRow(p, { seconds: 1 }).label));
});

test('jobs.ch in francese: occupazione «5%» e contratto «Temporaire»', () => {
  const base = { url: 'https://www.jobs.ch/fr/offres-emplois/detail/00000000-1111-4222-8333-444455556666/', ld: [], title: 'Technicien', h1: 'Technicien' };
  assert.deepEqual(jobFacts({ ...base, site: { info: '20 novembre 2026 5% Durée indéterminée 1007 Lausanne' } }, { role: 'Technicien', job_desc: '' }).pensum, { min: 5, max: 5 });
  assert.deepEqual(jobFacts({ ...base, site: { info: '20 novembre 2026 100% Temporaire 1212 Grand-Lancy' } }, { role: 'Technicien', job_desc: '' }).contracts, ['interim']);
});

test('carriera: livello dell\'annuncio rispetto al ruolo attuale del profilo', async () => {
  const { careerRow, currentRole } = await import('../extension/match.js');
  const profile = { headline: 'Security leader', experience: [{ title: 'Security Officer', employer: 'Belmonte SA', end: '03.2018' }, { title: 'Head of IT Security', employer: 'Ginevra Privatbank', end: 'present' }] };
  assert.deepEqual(currentRole(profile), { title: 'Head of IT Security', employer: 'Ginevra Privatbank' });
  assert.equal(careerRow(profile, { level: 'exec' }).job, 'miglioramento');
  assert.equal(careerRow(profile, { level: 'exec' }).result, 'ok');
  assert.equal(careerRow(profile, { level: 'head' }).result, 'same');
  assert.equal(careerRow(profile, { level: 'ic' }).job, 'peggioramento');
  assert.match(careerRow(profile, { level: 'ic' }).note, /da head \/ direttore a specialista/);
  assert.equal(careerRow(profile, { level: '' }).result, 'unknown');
  assert.equal(careerRow(null, { level: 'exec' }), null);
  assert.deepEqual(currentRole({ headline: 'CISO', experience: [] }), { title: 'CISO', employer: '' });
});

test('competenze e lingue: annuncio rispetto al profilo, senza falsi allarmi comuni', async () => {
  const { skillsRow, languagesRow, levelIndex } = await import('../extension/match.js');
  const p = { skills: ['ISO 27001', 'Risk management', 'Python'], certifications: ['CISSP'], languages: [{ name: 'Italiano', level: 'Madrelingua' }, { name: 'Inglese', level: 'C1' }, { name: 'Tedesco', level: 'B2' }] };
  const text = 'We require CISSP or CISM, ISO 27001 and AWS. Sehr gute Deutschkenntnisse (C1) und fliessend Englisch. Standort Deutschschweiz. Go-live planning, lean processes, excel at communication.';
  const s = skillsRow(p, { text });
  assert.equal(s.result, 'part'); assert.match(s.note, /trovate: ISO 27001, CISSP/); assert.match(s.note, /non nel profilo: CISM, AWS$/);
  const l = languagesRow(p, { text });
  assert.equal(l.result, 'no'); assert.match(l.note, /tedesco C1: tu B2/); assert.match(l.note, /inglese C1 ✓/);
  assert.equal(languagesRow(p, { text: 'Standort Deutschschweiz, Deutsche Bahn in der Nähe.' }).job, 'non indicate');
  assert.equal(levelIndex('verhandlungssicher'), 4); assert.equal(levelIndex('Madrelingua'), 5); assert.equal(levelIndex('B2'), 3);
  assert.equal(skillsRow({ skills: [] }, { text }), null); assert.equal(languagesRow({ languages: [] }, { text }), null);
});

test('lingue: il livello vale per la lingua vicina, non per quella accanto', async () => {
  const { requiredLanguages } = await import('../extension/match.js');
  const lv = t => Object.fromEntries(requiredLanguages(t).map(x => [x.code, x.level]));
  assert.deepEqual(lv('Sehr gute Deutschkenntnisse (C1), gute Englischkenntnisse.'), { de: 4, en: 3 });
  assert.deepEqual(lv('Fluent English and basic German.'), { de: 1, en: 4 });
  assert.deepEqual(lv('Ottima conoscenza dell\'inglese (C1) e tedesco B2.'), { de: 3, en: 4 });
  assert.deepEqual(lv('Anglais courant, allemand un atout.'), { de: -1, en: 4 });
});
