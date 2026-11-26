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
  assert.deepEqual(m.permissions.sort(), ['activeTab', 'nativeMessaging', 'scripting', 'sidePanel', 'storage']);
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
  for (const f of ['panel.js', 'background.js', 'grab.js', 'detect.js', 'parse.js', 'match.js', 'travel.js', 'search.js']) js += await readFile(ext(f), 'utf8');
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

test('piattaforme: pagine dei singoli annunci, pagine di verifica anti-bot, entità HTML e paesi per esteso', () => {
  for (const u of ['https://ch.talent.com/view?id=641833524766508202', 'https://ch.jooble.org/desc/4986883939559862331?ckey=x', 'https://www.adzuna.ch/details/5972940868',
    'https://www.adzuna.ch/land/ad/5972940868?se=x', 'https://www.simplyhired.com/job/tMMe__6_8_ovDBRQwp9JHvdUNPeBXuFPnae0I2', 'https://www.ziprecruiter.com/c/Acme/Job/Security-Engineer/-in-Austin,TX?jid=1',
    'https://www.monster.com/job-openings/security-engineer-austin-tx--1234', 'https://www.careerbuilder.com/job/J3T0AB6YDQZ2', 'https://uk.jora.com/job/Security-Analyst-123abc',
    'https://www.jobup.ch/fr/emplois/detail/00000000-1111-4222-8333-444455556666/'])
    assert.equal(detectJob({ url: u }).kind, 'job', u);
  for (const t of ['Additional Verification Required', 'Humans only', "Let's confirm you are human", 'Just a moment...', 'Zusätzliche Verifizierung erforderlich', 'Nur einen Moment…', 'Vérification supplémentaire requise'])
    assert.equal(detectJob({ url: 'https://ch.indeed.com/viewjob?jk=0a1b2c3d4e5f6a7b', title: t, ld: [JSON.stringify({ '@type': 'JobPosting', title: 'x' })] }).kind, 'blocked', t);
  const f = fields({ url: 'https://acme.wd1.myworkdayjobs.com/en-US/acme/job/New-York/Analyst_R1', ld: [JSON.stringify({ '@type': 'JobPosting', title: 'Analyst',
    hiringOrganization: { name: 'Muster &amp; Partner, Inc.' }, jobLocation: { address: { addressLocality: 'New York City', addressCountry: 'United States of America' } } })] });
  assert.deepEqual([f.company, f.employer_zip_city, f.employer_country], ['Muster & Partner, Inc.', 'New York City', 'US']);
  assert.equal(fields({ url: 'https://x.example/j', ld: [JSON.stringify({ '@type': 'JobPosting', title: 'Head of IT &#8211; Security' })] }).role, 'Head of IT – Security');
});

test('jobs.ch: annuncio aperto accanto ai risultati (…/vacancies/?term=…&jobid=…)', async () => {
  const { selectedUrl, postingFor } = await import('../extension/parse.js');
  const id = 'e8337f23-b9dc-432b-80f7-a489a7f1a98e', other = '00000000-1111-4222-8333-444455556666';
  const posting = (uuid, title, company, city) => ({ '@type': 'JobPosting', title, url: `https://www.jobs.ch/en/vacancies/detail/${uuid}/`,
    hiringOrganization: { name: company }, jobLocation: { address: { addressRegion: city, addressCountry: 'CH' } }, description: '<p>Testo</p>' });
  const list = JSON.stringify({ '@type': 'ItemList', itemListElement: [{ '@type': 'ListItem', item: posting(other, 'Primo risultato', 'Altra AG', 'Bern') }, { '@type': 'ListItem', item: posting(id, 'Information Security Officer 80-100% (w/m)', 'Muster Haustechnik AG', 'Schwerzenbach') }] });
  const raw = { url: `https://www.jobs.ch/en/vacancies/?term=information%20security&jobid=${id}`, title: 'Information Security Jobs | jobs.ch', ld: [list],
    site: { company: 'About the company Muster Haustechnik AG Schwerzenbach See company profile', info: '20 November 2026 80 – 100% Festanstellung' } };
  assert.equal(selectedUrl(raw), `https://www.jobs.ch/en/vacancies/detail/${id}/`);
  assert.equal(detectJob(raw).kind, 'job');
  const f = fields(raw);
  assert.deepEqual([f.role, f.company, f.employer_zip_city, f.employer_country, f.job_url], ['Information Security Officer 80-100% (w/m)', 'Muster Haustechnik AG', 'Schwerzenbach', 'CH', `https://www.jobs.ch/en/vacancies/detail/${id}/`]);
  assert.equal(postingFor({ ...raw, url: 'https://www.jobs.ch/en/vacancies/?term=x' }), undefined, 'senza annuncio scelto: nessun risultato dell\'elenco a caso');
  assert.equal(detectJob({ ...raw, url: 'https://www.jobs.ch/en/vacancies/?term=x' }).kind, 'list');
  assert.equal(postingFor({ ...raw, url: `https://www.jobs.ch/en/vacancies/?jobid=${'1'.repeat(8)}-1111-4111-8111-111111111111` }), undefined, 'jobid non nell\'elenco');
  assert.equal(selectedUrl({ url: `https://example.org/?jobid=${id}` }), '', 'solo jobs.ch e jobup.ch');
  // senza dati strutturati dell'annuncio (elenco cambiato dopo il primo caricamento): luogo dall'indirizzo del riquadro
  const dom = fields({ ...raw, ld: [], site: { title: 'Information Security Officer 80-100% (w/m)', company: 'Muster Haustechnik AG', place: 'Bahnstrasse 24, 8603 Schwerzenbach', info: '' } });
  assert.deepEqual([dom.employer_zip_city, dom.employer_country, dom.company, dom.job_url], ['8603 Schwerzenbach', 'CH', 'Muster Haustechnik AG', `https://www.jobs.ch/en/vacancies/detail/${id}/`]);
});

test('titolo della scheda: con «|» il trattino resta nel titolo', async () => {
  const { splitTitle } = await import('../extension/parse.js');
  assert.deepEqual(splitTitle('INFORMATION SECURITY MANAGER – GROUPE (H/F) | Belmonte SA | LinkedIn'), { role: 'INFORMATION SECURITY MANAGER – GROUPE (H/F)', company: 'Belmonte SA' });
  assert.deepEqual(splitTitle('Head of IT - Muster AG'), { role: 'Head of IT', company: 'Muster AG' });
});

test('paese: sui siti svizzeri un luogo senza paese è in Svizzera, altrove resta vuoto', async () => {
  const { fields, swissSite } = await import('../extension/parse.js');
  const raw = url => ({ url, title: 'Security Engineer | Muster AG', ld: [], top: { title: 'Security Engineer', company: 'Muster AG', location: 'Zürich' } });
  assert.equal(fields(raw('https://ch.talent.com/view?id=1')).employer_country, 'CH');
  assert.equal(fields(raw('https://www.jobs.ch/de/stellenangebote/detail/x/')).employer_country, 'CH');
  assert.equal(fields(raw('https://www.example.com/job/1')).employer_country, '');
  assert.equal(swissSite('https://chase.example.com/'), false);
});

test('verifica anti-bot: le frasi brevi valgono solo come titolo intero', async () => {
  const { detectJob } = await import('../extension/detect.js');
  assert.notEqual(detectJob({ url: 'https://www.example.ch/job/1', title: 'Un momento di svolta: Project Manager', h1: 'Project Manager', ld: [] }).kind, 'blocked');
});

test('Indeed accanto ai risultati: annuncio scelto, luogo dall\'indirizzo con NPA, paese svizzero', async () => {
  const { fields, splitPlace } = await import('../extension/parse.js');
  const f = fields({ url: 'https://ch.indeed.com/jobs?q=security&vjk=0123456789abcdef', title: 'Oltre 800 offerte di lavoro | Indeed', h1: 'Offerte di lavoro security', ld: [],
    top: { title: 'Offerte di lavoro security', company: '', location: '' },
    site: { title: 'Security Officer', company: 'Muster AG', desc: 'x'.repeat(400), loc: 'Musterstrasse 1, 8005 Zurigo, ZH' } });
  assert.deepEqual([f.role, f.company, f.employer_zip_city, f.employer_country, f.job_url], ['Security Officer', 'Muster AG', '8005 Zurigo', 'CH', 'https://ch.indeed.com/viewjob?jk=0123456789abcdef']);
  assert.deepEqual(splitPlace('Zurich, Zurich, Switzerland'), { city: 'Zurich', country: 'CH' });
});

test('indirizzo salvato senza parametri di tracciamento (arrivi da Adzuna, Indeed)', async () => {
  const { jobUrl } = await import('../extension/parse.js');
  assert.equal(jobUrl('https://www.jobs.ch/de/stellenangebote/detail/00000000-1111-4222-8333-444455556666/?utm_source=adzuna.ch&inv=ppd-p&slim=0&ppt=abc'), 'https://www.jobs.ch/de/stellenangebote/detail/00000000-1111-4222-8333-444455556666/');
  assert.equal(jobUrl('https://ch.indeed.com/viewjob?jk=0123456789abcdef&from=serp&tk=xyz'), 'https://ch.indeed.com/viewjob?jk=0123456789abcdef');
  assert.equal(jobUrl('https://careers.example.com/job?id=42&utm_campaign=x&gclid=1'), 'https://careers.example.com/job?id=42');
});

test('date dell\'annuncio: pubblicazione e scadenza da dati strutturati, LinkedIn, jobs.ch e testo', async () => {
  const { jobDates, parseDate, agoDate } = await import('../extension/parse.js');
  const now = new Date('2026-11-25T12:00:00Z');
  assert.deepEqual(['Bewerbungsfrist: 15.12.2026', '20 November 2026', '20. Dezember 2026', 'December 15, 2026', '15 décembre 2026', '31/01/2027', 'domani'].map(parseDate), ['2026-12-15', '2026-11-20', '2026-12-20', '2026-12-15', '2026-12-15', '2027-01-31', '']);
  assert.deepEqual(['3 days ago', 'Reposted 2 weeks ago', 'vor 3 Tagen', 'il y a 5 jours', '3 giorni fa', '17 hours ago', 'vor Ort'].map(s => agoDate(s, now)), ['2026-11-22', '2026-11-11', '2026-11-22', '2026-11-20', '2026-11-22', '2026-11-25', '']);
  const ld = JSON.stringify({ '@type': 'JobPosting', title: 'x', datePosted: '2026-11-02T08:00:00Z', validThrough: '2027-02-28' });
  assert.deepEqual(jobDates({ ld: [ld] }, now), { posted: '2026-11-02', postedApprox: false, deadline: '2027-02-28' });
  assert.deepEqual(jobDates({ ld: [ld], site: { desc: 'Bewerbungsschluss ist der 15. Januar 2027.' } }, now).deadline, '2027-01-15', 'la scadenza scritta vale più di validThrough');
  assert.deepEqual(jobDates({ ld: [], top: { lines: ['Zurich, Switzerland · 1 week ago · 14 people clicked apply'] } }, now), { posted: '2026-11-18', postedApprox: true, deadline: '' });
  assert.equal(jobDates({ ld: [], site: { info: '20 November 2026 80 – 100% Festanstellung' } }, now).posted, '2026-11-20');
  assert.equal(jobDates({ ld: [], site: { desc: 'You meet deadlines. Start date: 01.01.2027.' } }, now).deadline, '');
  const ld2 = JSON.stringify({ '@type': 'JobPosting', title: 'x', validThrough: '2027-03-31', description: '<p>Bewerbungsfrist: <b>15.12.2026</b>.</p>' });
  assert.equal(jobDates({ ld: [ld2] }, now).deadline, '2026-12-15', 'scadenza scritta nel testo dei dati strutturati');
});
