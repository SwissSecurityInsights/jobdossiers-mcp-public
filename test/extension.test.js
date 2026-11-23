import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fields, jobPostings, jobUrl, splitTitle, splitPlace } from '../extension/parse.js';
import { detectJob } from '../extension/detect.js';
import { EXTENSION_IDS } from '../src/native.js';

const ext = f => new URL('../extension/' + f, import.meta.url);

test('estensione: manifest con permessi minimi e ID uguale a quello ammesso dal server', async () => {
  const m = JSON.parse(await readFile(ext('manifest.json'), 'utf8'));
  assert.equal(m.manifest_version, 3);
  assert.deepEqual(m.permissions.sort(), ['activeTab', 'nativeMessaging', 'scripting', 'sidePanel']);
  assert.equal(m.host_permissions, undefined, 'nessun accesso permanente ai siti senza il consenso dell\'utente');
  assert.deepEqual(m.optional_host_permissions, ['http://*/*', 'https://*/*'], 'lettura automatica: solo se l\'utente la concede');
  assert.equal(m.content_scripts, undefined);
  assert.equal(m.action.default_popup, undefined, 'pannello laterale, non finestra sovrapposta');
  assert.equal(m.side_panel.default_path, 'panel.html');
  assert.deepEqual(Object.keys(m.commands), ['leggi-pagina']);
  for (const f of [m.side_panel.default_path, m.background.service_worker, 'panel.js', 'panel.css', 'parse.js']) await readFile(ext(f));
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(m.version, pkg.version);
  const hex = createHash('sha256').update(Buffer.from(m.key, 'base64')).digest('hex').slice(0, 32);
  assert.equal([...hex].map(c => String.fromCharCode(97 + parseInt(c, 16))).join(''), EXTENSION_IDS[0]);
  let js = '';
  for (const f of ['panel.js', 'background.js', 'grab.js', 'detect.js', 'parse.js', 'match.js']) js += await readFile(ext(f), 'utf8');
  assert.ok(!/innerHTML|insertAdjacentHTML|eval\(|new Function/.test(js), 'i dati della pagina non diventano HTML né codice');
});

const LD = JSON.stringify({
  '@context': 'https://schema.org', '@graph': [
    { '@type': 'WebPage', name: 'x' },
    { '@type': ['JobPosting'], title: 'Head of Supply Chain (m/w/d)', description: '<p>Guida la <b>logistica</b>.</p>',
      hiringOrganization: { '@type': 'Organization', name: 'Rotondo Logistics AG' },
      jobLocation: [{ '@type': 'Place', address: { postalCode: '6900', addressLocality: 'Lugano', addressCountry: 'ch' } }] },
  ],
});

test('estensione: campi dai dati strutturati JobPosting (anche in @graph)', () => {
  const f = fields({ url: 'https://careers.rotondo.example/jobs/42#apply', title: 'Jobs', h1: 'Altro titolo', ld: ['{rotto', LD], main: 'tutta la pagina' });
  assert.deepEqual(f, {
    company: 'Rotondo Logistics AG', role: 'Head of Supply Chain (m/w/d)', employer_zip_city: '6900 Lugano', employer_country: 'CH',
    job_url: 'https://careers.rotondo.example/jobs/42', job_desc: 'Guida la  logistica .', source: 'dati strutturati',
    sources: { role: 'dati strutturati', company: 'dati strutturati', job_desc: 'dati strutturati' },
  });
  assert.equal(jobPostings([JSON.stringify([{ '@type': 'JobPosting', title: 'a' }])]).length, 1);
});

test('estensione: testo selezionato, LinkedIn e pagine senza dati strutturati', () => {
  const sel = 'Descrizione scelta dall\'utente. '.repeat(10);
  const f = fields({ url: 'https://www.linkedin.com/jobs/collections/recommended/?currentJobId=3912345678&trk=x', h1: 'Head of IT', li_company: '  Belmonte  SA ', selection: sel, desc: 'descrizione del riquadro', ld: [] });
  assert.equal(f.job_url, 'https://www.linkedin.com/jobs/view/3912345678/');
  assert.equal(f.company, 'Belmonte SA'); assert.equal(f.role, 'Head of IT');
  assert.equal(f.job_desc, sel.trim()); assert.equal(f.source, 'selezione');
  const g = fields({ url: 'https://example.org/job?id=1', title: 'Annuncio', og_site: 'Example AG', desc: '', main: 'testo della pagina', selection: 'breve' });
  assert.deepEqual([g.company, g.role, g.job_desc, g.source], ['Example AG', 'Annuncio', 'testo della pagina', 'testo della pagina']);
  assert.equal(jobUrl('https://ch.linkedin.com/jobs/view/head-at-belmonte-3912345678/?trk=1'), 'https://www.linkedin.com/jobs/view/3912345678/');
  assert.equal(jobUrl('chrome://settings'), '');
  assert.equal(fields({ role: 'x'.repeat(500), url: 'https://x.ch' }).role.length, 0);
  assert.equal(fields({ h1: 'x'.repeat(500), url: 'https://x.ch' }).role.length, 300);
});

test('verifica: è un annuncio? dati strutturati, siti noti, segnali nel testo, elenchi e altre pagine', () => {
  const ld = JSON.stringify({ '@type': 'JobPosting', title: 'x' });
  assert.equal(detectJob({ url: 'https://example.org/qualcosa', ld: [ld] }).kind, 'job');
  assert.equal(detectJob({ url: 'https://example.org/x', micro: { title: 'Head of IT', desc: '' } }).kind, 'job');
  for (const u of ['https://www.linkedin.com/jobs/view/3912345678/', 'https://www.linkedin.com/jobs/collections/recommended/?currentJobId=3912345678',
    'https://www.jobs.ch/it/offerte-di-lavoro/detail/00000000-1111-4222-8333-444455556666/', 'https://www.jobs.ch/de/stellenangebote/detail/00000000-1111-4222-8333-444455556666/',
    'https://www.jobs.ch/en/vacancies/detail/00000000-1111-4222-8333-444455556666/',
    'https://ch.indeed.com/viewjob?jk=0a1b2c3d4e5f6a7b', 'https://boards.greenhouse.io/acme/jobs/4012345', 'https://jobs.lever.co/acme/0b1c2d3e-0000-4000-8000-123456789abc',
    'https://acme.wd3.myworkdayjobs.com/External/job/Zurich/Head-of-IT_R123', 'https://jobs.smartrecruiters.com/Acme/743999123456789', 'https://acme.jobs.personio.de/job/123456',
    'https://jobs.ashbyhq.com/acme/0b1c2d3e-0000-4000-8000-123456789abc', 'https://apply.workable.com/acme/j/ABC123DEF4/', 'https://join.com/companies/acme/1234567-head-of-it']) {
    assert.equal(detectJob({ url: u }).kind, 'job', u);
  }
  assert.equal(detectJob({ url: 'https://www.linkedin.com/jobs/search/?keywords=ciso' }).kind, 'list');
  assert.equal(detectJob({ url: 'https://ch.indeed.com/jobs?q=ciso' }).kind, 'list');
  assert.equal(detectJob({ url: 'https://news.example/articolo', jobLinks: 12 }).kind, 'list');
  const best = 'Le tue mansioni ... Requisiti ... '.padEnd(600, 'x');
  assert.equal(detectJob({ url: 'https://acme.example/careers/head-it', best, sectionHits: 2, apply: true }).kind, 'probable');
  assert.equal(detectJob({ url: 'https://acme.example/careers/head-it', best, sectionHits: 2, apply: false }).kind, 'no', 'due sezioni senza pulsante: non basta');
  assert.equal(detectJob({ url: 'https://acme.example/careers/head-it', best, sectionHits: 3 }).kind, 'probable');
  assert.equal(detectJob({ url: 'https://www.nzz.ch/wirtschaft/artikel', best: 'x'.repeat(5000), sectionHits: 0, apply: false, jobLinks: 0 }).kind, 'no');
  assert.equal(detectJob({ url: 'https://www.linkedin.com/feed/' }).kind, 'no');
  assert.equal(detectJob(null).kind, 'no');
});

test('estrazione: ruolo, impresa e descrizione dalle fonti in ordine, mai il nome di un sito come impresa', () => {
  // LinkedIn con accesso: niente dati strutturati, selettori del sito
  const li = fields({ url: 'https://www.linkedin.com/jobs/view/3912345678/', title: '(3) Head of Supply Chain | Rotondo Logistics SA | LinkedIn', og_site: 'LinkedIn',
    h1: 'Head of Supply Chain', site: { title: 'Head of Supply Chain', company: 'Rotondo Logistics SA', desc: 'About the job\nYour profile ...' }, best: 'blocco', main: 'feed intero' });
  assert.deepEqual([li.role, li.company, li.job_desc], ['Head of Supply Chain', 'Rotondo Logistics SA', 'About the job\nYour profile ...']);
  assert.deepEqual(li.sources, { role: 'pagina del sito', company: 'pagina del sito', job_desc: 'pagina del sito' });
  // microdata
  const md = fields({ url: 'https://acme.example/j/1', micro: { title: 'CISO', company: 'Acme SA', desc: 'Testo', location: 'Lugano' }, og_site: 'Acme Careers' });
  assert.deepEqual([md.role, md.company, md.job_desc, md.employer_zip_city], ['CISO', 'Acme SA', 'Testo', 'Lugano']);
  // solo titolo della scheda e blocco della descrizione; il sito di annunci non è l'impresa
  const t = fields({ url: 'https://www.jobs.ch/en/vacancies/detail/x/', title: 'Head of IT - Beispiel AG | jobs.ch', og_site: 'jobs.ch', best: 'Ihre Aufgaben ... Ihr Profil ...', main: 'tutto' });
  assert.deepEqual([t.role, t.company, t.job_desc, t.sources.company, t.sources.job_desc], ['Head of IT', 'Beispiel AG', 'Ihre Aufgaben ... Ihr Profil ...', 'titolo della scheda', 'blocco della descrizione']);
  const g = fields({ url: 'https://ch.indeed.com/viewjob?jk=1', title: 'Indeed', og_site: 'Indeed', h1: 'Engineer' });
  assert.equal(g.company, '', 'Indeed non è l\'impresa'); assert.equal(g.sources.company, '');
  assert.deepEqual(splitTitle('Senior Engineer at Acme'), { role: 'Senior Engineer', company: 'Acme' });
  assert.deepEqual(splitTitle('Careers'), { role: '', company: '' });
  const c = fields({ url: 'https://www.acme.example/careers/head-it', title: 'Head of IT | Acme Careers', h1: 'Head of IT' });
  assert.equal(c.company, 'Acme');
  for (const [a, b] of [['Beispiel AG – Karriere', 'Beispiel AG'], ['Jobs bei Muster AG', 'Muster AG'], ['Rotondo SA | Lavora con noi', 'Rotondo SA'], ['Acme SA', 'Acme SA']])
    assert.equal(fields({ url: 'https://x.example/j', og_site: a }).company, b, a);
});

test('estrazione: riquadro dell\'annuncio e sezione «About the job» (LinkedIn senza classi note), luogo e paese', () => {
  const raw = { url: 'https://www.linkedin.com/jobs/search-results/?currentJobId=3912345678', title: 'Head of Information Security | Nordlicht Fintech | LinkedIn', og_site: 'LinkedIn',
    top: { title: 'Head of Information Security', company: 'Nordlicht Fintech', location: 'Lugano, Ticino, Switzerland', text: 'Nordlicht Fintech\nHead of Information Security\n✓ Hybrid ✓ Full-time' },
    about: 'About Us\nUMO is a FinTech venture.', best: 'Jobs based on your preferences ... Muster AG ...', main: 'tutta la pagina' };
  const f = fields(raw);
  assert.deepEqual([f.role, f.company, f.employer_zip_city, f.employer_country, f.job_desc], ['Head of Information Security', 'Nordlicht Fintech', 'Lugano', 'CH', 'About Us\nUMO is a FinTech venture.']);
  assert.deepEqual(f.sources, { role: 'riquadro dell\'annuncio', company: 'riquadro dell\'annuncio', job_desc: 'sezione «About the job»' });
  assert.deepEqual(splitPlace('Zurich, Zurich, Switzerland (Hybrid)'), { city: 'Zurich', country: 'CH' });
  assert.deepEqual(splitPlace('Lugano, Svizzera'), { city: 'Lugano', country: 'CH' });
  assert.deepEqual(splitPlace('Switzerland'), { city: '', country: 'CH' });
  assert.deepEqual(splitPlace('Buchs (SG)'), { city: 'Buchs (SG)', country: '' }, 'paese non indicato: non si inventa');
  assert.deepEqual(splitPlace(''), { city: '', country: '' });
});
