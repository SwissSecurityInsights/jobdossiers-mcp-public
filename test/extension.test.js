import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fields, jobPostings, jobUrl } from '../extension/parse.js';
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
  const js = (await readFile(ext('panel.js'), 'utf8')) + (await readFile(ext('background.js'), 'utf8'));
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
  assert.deepEqual([g.company, g.role, g.job_desc, g.source], ['Example AG', 'Annuncio', 'testo della pagina', 'pagina']);
  assert.equal(jobUrl('https://ch.linkedin.com/jobs/view/head-at-belmonte-3912345678/?trk=1'), 'https://www.linkedin.com/jobs/view/3912345678/');
  assert.equal(jobUrl('chrome://settings'), '');
  assert.equal(fields({ role: 'x'.repeat(500), url: 'https://x.ch' }).role.length, 0);
  assert.equal(fields({ h1: 'x'.repeat(500), url: 'https://x.ch' }).role.length, 300);
});
