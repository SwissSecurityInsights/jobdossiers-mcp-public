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
  const r = raw || {}, site = r.site || {}, micro = r.micro || {};
  const jp = jobPostings(r.ld)[0];
  const where = place(jp);
  const fromTitle = splitTitle(r.og_title || r.title);
  const pick = list => { for (const [v, src] of list) if (squash(v)) return [v, src]; return ['', '']; };
  const [role, roleSrc] = pick([[jp?.title, 'dati strutturati'], [micro.title, 'microdata'], [site.title, 'pagina del sito'], [r.h1, 'titolo nella pagina'], [fromTitle.role, 'titolo della scheda']]);
  const [company, companySrc] = pick([[name(jp?.hiringOrganization), 'dati strutturati'], [micro.company, 'microdata'], [site.company || r.li_company, 'pagina del sito'],
    [fromTitle.company, 'titolo della scheda'], [notAggregator(r.og_site) ? r.og_site : '', 'nome del sito']]);
  const sel = String(r.selection || '').trim();
  const [desc, descSrc] = sel.length >= 200 ? [sel, 'selezione'] : pick([[jp?.description ? htmlToText(jp.description) : '', 'dati strutturati'], [micro.desc, 'microdata'],
    [site.desc || r.desc, 'pagina del sito'], [r.best, 'blocco della descrizione'], [r.main, 'testo della pagina']]);
  return {
    company: short(cleanCompany(company)),
    role: short(role),
    employer_zip_city: where.zipCity || short(micro.location),
    employer_country: where.country,
    job_url: jobUrl(r.url),
    job_desc: String(desc).trim().slice(0, MAX_DESC),
    source: descSrc,
    sources: { role: roleSrc, company: companySrc, job_desc: descSrc },
  };
}
