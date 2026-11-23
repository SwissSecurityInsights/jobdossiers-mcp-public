/* Dai dati grezzi della pagina (grab.js) ai campi di jd_create, dopo la verifica (detect.js). Nessun accesso al DOM: si prova anche in Node.
 * Ordine delle fonti: dati strutturati JobPosting (schema.org), microdata, selettori noti dei siti, titolo della pagina e della scheda,
 * blocco di testo più simile a una descrizione; per la descrizione prima di tutto il testo selezionato dall'utente.
 * Il nome di un sito di annunci (LinkedIn, Indeed…) non diventa mai l'impresa. Tutto resta modificabile nel pannello prima di salvare. */

const MAX_FIELD = 300;
const MAX_DESC = 100000;
const squash = s => String(s ?? '').replace(/\s+/g, ' ').trim();
const short = s => squash(s).slice(0, MAX_FIELD);

/** URL da salvare: per le liste di LinkedIn (…?currentJobId=<id>) la pagina dell'annuncio; senza frammento. */
export function jobUrl(u) {
  let x;
  try { x = new URL(u); } catch { return ''; }
  if (!/^https?:$/.test(x.protocol)) return '';
  if (/(^|\.)linkedin\.com$/i.test(x.hostname)) {
    const id = x.searchParams.get('currentJobId') || (x.pathname.match(/\/jobs\/view\/(?:[^/]*?-)?(\d{6,})/) || [])[1];
    if (id && /^\d{6,}$/.test(id)) return `https://www.linkedin.com/jobs/view/${id}/`;
  }
  x.hash = '';
  return x.href;
}

const isPosting = o => o && typeof o === 'object' && [].concat(o['@type'] || []).some(t => String(t).toLowerCase() === 'jobposting');

/** Oggetti JobPosting nei blocchi JSON-LD della pagina (anche dentro @graph o in elenchi). I blocchi non validi si ignorano. */
export function jobPostings(blocks) {
  const out = [];
  const walk = (v, depth) => {
    if (depth > 6 || out.length >= 5 || !v || typeof v !== 'object') return;
    if (Array.isArray(v)) { for (const x of v) walk(x, depth + 1); return; }
    if (isPosting(v)) { out.push(v); return; }
    if (v['@graph']) walk(v['@graph'], depth + 1);
  };
  for (const b of (blocks || []).slice(0, 20)) { try { walk(JSON.parse(b), 0); } catch { /* blocco non valido */ } }
  return out;
}

const name = v => typeof v === 'string' ? v : (v && typeof v === 'object' ? v.name || '' : '');

function place(jp) {
  const loc = [].concat(jp?.jobLocation || [])[0];
  const a = loc?.address && typeof loc.address === 'object' ? loc.address : {};
  const cc = squash(name(a.addressCountry));
  return { zipCity: short([a.postalCode, a.addressLocality].filter(Boolean).join(' ')), country: /^[a-z]{2}$/i.test(cc) ? cc.toUpperCase() : '' };
}

/** Paesi come li scrivono i siti di annunci (riga «Città, Regione, Paese»), in inglese, italiano, tedesco e francese. */
const COUNTRIES = {
  switzerland: 'CH', svizzera: 'CH', schweiz: 'CH', suisse: 'CH', italy: 'IT', italia: 'IT', italien: 'IT', italie: 'IT',
  germany: 'DE', germania: 'DE', deutschland: 'DE', allemagne: 'DE', france: 'FR', francia: 'FR', frankreich: 'FR',
  austria: 'AT', osterreich: 'AT', autriche: 'AT', liechtenstein: 'LI', luxembourg: 'LU', lussemburgo: 'LU', luxemburg: 'LU',
  'united kingdom': 'GB', 'regno unito': 'GB', 'vereinigtes konigreich': 'GB', 'royaume-uni': 'GB', ireland: 'IE', irlanda: 'IE',
  spain: 'ES', spagna: 'ES', spanien: 'ES', espagne: 'ES', portugal: 'PT', portogallo: 'PT', netherlands: 'NL', 'paesi bassi': 'NL', niederlande: 'NL', 'pays-bas': 'NL',
  belgium: 'BE', belgio: 'BE', belgien: 'BE', belgique: 'BE', sweden: 'SE', svezia: 'SE', denmark: 'DK', danimarca: 'DK', norway: 'NO', norvegia: 'NO',
  finland: 'FI', finlandia: 'FI', poland: 'PL', polonia: 'PL', 'united states': 'US', 'stati uniti': 'US', usa: 'US', canada: 'CA',
  'united arab emirates': 'AE', 'emirati arabi uniti': 'AE', 'vereinigte arabische emirate': 'AE', 'emirats arabes unis': 'AE',
  'saudi arabia': 'SA', qatar: 'QA', singapore: 'SG', 'hong kong': 'HK', china: 'CN', cina: 'CN', japan: 'JP', giappone: 'JP',
  india: 'IN', australia: 'AU', 'new zealand': 'NZ', israel: 'IL', israele: 'IL',
};
const fold = s => String(s ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

/** «Zurich, Zurich, Switzerland (Hybrid)» → { city: 'Zurich', country: 'CH' }. Paese sconosciuto: vuoto, mai inventato. */
export function splitPlace(s) {
  const parts = squash(s).replace(/\((hybrid|remote|on-?site|ibrido|da remoto|in sede|hybride|teletravail)\)/ig, '').split(',').map(squash).filter(Boolean);
  if (!parts.length) return { city: '', country: '' };
  const last = COUNTRIES[fold(parts[parts.length - 1])] || '';
  const city = parts.length > 1 || !last ? parts[0] : '';
  return { city: COUNTRIES[fold(city)] ? '' : short(city), country: last };
}

/** Siti di annunci e sistemi di candidatura: il loro nome non è mai l'impresa. */
const AGGREGATORS = /^(linkedin|indeed|jobs\.?ch|jobup|glassdoor|stepstone|monster|xing|jobscout24|jobwinner|greenhouse|lever|workday|smartrecruiters|personio|ashby|workable|recruitee|join|teamtailor|successfactors|sap successfactors|careers?|jobs?|karriere|lavora con noi)$/i;
const notAggregator = s => s && !AGGREGATORS.test(squash(s).replace(/\.(com|ch|de|io)$/i, ''));

/** «Acme Careers», «Beispiel AG – Karriere», «Jobs bei Acme»: il nome dell'impresa senza le parole della pagina carriere. */
export function cleanCompany(s) {
  return squash(s).replace(/^(jobs?|karriere|careers?|stellen(angebote)?)\s+(bei|at|chez|presso|da)\s+/i, '')
    .replace(/\s*[-–|:]?\s*(careers?|karriere|jobs?|stellenangebote|offene stellen|lavora con noi|offerte di lavoro|carri[eè]res?|emplois?|recrutement)$/i, '').trim();
}

/** «Ruolo - Impresa | Sito», «(3) Ruolo | Impresa | LinkedIn», «Ruolo at Impresa»: ruolo e impresa dal titolo della scheda. */
export function splitTitle(t) {
  const parts = squash(t).replace(/^\(\d+\)\s*/, '').split(/\s+(?:\||–|—|-|·|at|bei|presso|chez|@)\s+/i).map(squash).filter(notAggregator);
  return { role: parts[0] || '', company: parts.length > 1 ? parts[1] : '' };
}

/** raw: dati di grab() (grab.js); htmlToText: per la descrizione HTML del JobPosting. Ogni campo dice da dove viene (sources). */
export function fields(raw, htmlToText = s => String(s ?? '').replace(/<[^>]*>/g, ' ')) {
  const r = raw || {}, site = r.site || {}, micro = r.micro || {}, top = r.top || {};
  const jp = jobPostings(r.ld)[0];
  const where = place(jp);
  const topPlace = splitPlace(top.location);
  const fromTitle = splitTitle(r.og_title || r.title);
  const pick = list => { for (const [v, src] of list) if (squash(v)) return [v, src]; return ['', '']; };
  const [role, roleSrc] = pick([[jp?.title, 'dati strutturati'], [micro.title, 'microdata'], [site.title, 'pagina del sito'], [top.title, 'riquadro dell\'annuncio'], [r.h1, 'titolo nella pagina'], [fromTitle.role, 'titolo della scheda']]);
  const [company, companySrc] = pick([[name(jp?.hiringOrganization), 'dati strutturati'], [micro.company, 'microdata'], [site.company || r.li_company, 'pagina del sito'], [top.company, 'riquadro dell\'annuncio'],
    [fromTitle.company, 'titolo della scheda'], [notAggregator(r.og_site) ? r.og_site : '', 'nome del sito']]);
  const sel = String(r.selection || '').trim();
  const [desc, descSrc] = sel.length >= 200 ? [sel, 'selezione'] : pick([[jp?.description ? htmlToText(jp.description) : '', 'dati strutturati'], [micro.desc, 'microdata'],
    [site.desc || r.desc, 'pagina del sito'], [r.about, 'sezione «About the job»'], [r.best, 'blocco della descrizione'], [r.main, 'testo della pagina']]);
  return {
    company: short(cleanCompany(company)),
    role: short(role),
    employer_zip_city: where.zipCity || short(micro.location) || topPlace.city,
    employer_country: where.country || topPlace.country,
    job_url: jobUrl(r.url),
    job_desc: String(desc).trim().slice(0, MAX_DESC),
    source: descSrc,
    sources: { role: roleSrc, company: companySrc, job_desc: descSrc },
  };
}
