import test from 'node:test';
import assert from 'node:assert/strict';
import { searchUrls } from '../extension/search.js';

test('ricerche sui portali: parole chiave, luogo, modalità e ultimi 7 giorni', () => {
  const s = searchUrls({ keywords: 'Head of IT Security', location: 'Lugano', cc: 'CH', modes: ['hybrid', 'remote'], recent: true });
  assert.deepEqual(s.map(x => x.name), ['LinkedIn', 'jobs.ch', 'Indeed']);
  assert.equal(s[0].url, 'https://www.linkedin.com/jobs/search/?keywords=Head+of+IT+Security&location=Lugano&f_WT=3%2C2&f_TPR=r604800');
  assert.equal(s[1].url, 'https://www.jobs.ch/de/stellenangebote/?term=Head+of+IT+Security&location=Lugano');
  assert.equal(s[2].url, 'https://ch.indeed.com/jobs?q=Head+of+IT+Security&l=Lugano&fromage=7');
  const it = searchUrls({ keywords: 'CISO', location: 'Milano', cc: 'IT' });
  assert.deepEqual(it.map(x => x.name), ['LinkedIn', 'Indeed'], 'jobs.ch solo per la Svizzera');
  assert.equal(it[1].url, 'https://it.indeed.com/jobs?q=CISO&l=Milano');
  assert.deepEqual(searchUrls({ keywords: '  ' }), []);
});
