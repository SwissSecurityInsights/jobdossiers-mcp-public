/* Dai dati grezzi della pagina (grab.js) ai campi di jd_create, dopo la verifica (detect.js). Nessun accesso al DOM: si prova anche in Node.
 * Ordine delle fonti: dati strutturati JobPosting (schema.org), microdata, selettori noti dei siti, titolo della pagina e della scheda,
 * blocco di testo più simile a una descrizione; per la descrizione prima di tutto il testo selezionato dall'utente.
 * Il nome di un sito di annunci (LinkedIn, Indeed…) non diventa mai l'impresa. Tutto resta modificabile nel pannello prima di salvare. */

const MAX_FIELD = 300;
const MAX_DESC = 100000;
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
/** «Heidrick &amp; Struggles» (Workday e altri mettono entità HTML nei dati strutturati) → «Heidrick & Struggles». */
const decode = s => String(s ?? '').replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e) => e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENT[e.toLowerCase()] ?? m);
const squash = s => decode(s).replace(/\s+/g, ' ').trim();
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
  // jobs.ch e jobup.ch: il dettaglio è tutto nel percorso; Indeed: basta jk (arrivi da Adzuna, Jooble, avvisi e-mail con parametri di tracciamento)
  if (/(^|\.)(jobs\.ch|jobup\.ch)$/i.test(x.hostname) && /\/detail\/[0-9a-f-]{36}/i.test(x.pathname)) x.search = '';
  if (/(^|\.)indeed\.[a-z.]+$/i.test(x.hostname) && /^\/viewjob/.test(x.pathname) && x.searchParams.get('jk')) x.search = `?jk=${x.searchParams.get('jk')}`;
  for (const k of [...x.searchParams.keys()]) if (TRACKING.test(k)) x.searchParams.delete(k);
  x.hash = '';
  return x.href;
}
/** Parametri di tracciamento sicuri da togliere ovunque (come src/dedupe.js): «ref» o «source» in certi siti sono il numero dell'annuncio, restano. */
const TRACKING = /^(utm_|fbclid$|gclid$|msclkid$|mc_|trk|refid$|trackingid$)/i;

const isPosting = o => o && typeof o === 'object' && [].concat(o['@type'] || []).some(t => String(t).toLowerCase() === 'jobposting');

/** Oggetti JobPosting nei blocchi JSON-LD della pagina (anche dentro @graph o in elenchi). I blocchi non validi si ignorano.
 *  lists: anche dentro gli ItemList delle pagine di ricerca (solo quando si sa quale annuncio è aperto: vedi postingFor). */
export function jobPostings(blocks, { lists = false } = {}) {
  const out = [], max = lists ? 200 : 5;
  const walk = (v, depth) => {
    if (depth > 6 || out.length >= max || !v || typeof v !== 'object') return;
    if (Array.isArray(v)) { for (const x of v) walk(x, depth + 1); return; }
    if (isPosting(v)) { out.push(v); return; }
    if (v['@graph']) walk(v['@graph'], depth + 1);
    if (lists && v.itemListElement) walk([].concat(v.itemListElement).map(x => (x && x.item) || x), depth + 1);
  };
  for (const b of (blocks || []).slice(0, 20)) { try { walk(JSON.parse(b), 0); } catch { /* blocco non valido */ } }
  return out;
}

const name = v => typeof v === 'string' ? v : (v && typeof v === 'object' ? v.name || '' : '');

/** Annuncio aperto accanto ai risultati: jobs.ch e jobup.ch lo scrivono nell'indirizzo (…/vacancies/?term=…&jobid=<uuid>);
 *  in alternativa il risultato evidenziato nell'elenco (grab.js). → indirizzo del dettaglio dell'annuncio, o '' */
export function selectedUrl(r) {
  try {
    const u = new URL(r.url);
    const id = u.searchParams.get('jobid');
    if (/(^|\.)(jobs\.ch|jobup\.ch)$/i.test(u.hostname) && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id || '') && !/\/detail\//.test(u.pathname))
      return `${u.origin}${u.pathname.replace(/\/?$/, '/')}detail/${id.toLowerCase()}/`;
    // Indeed, annuncio aperto accanto ai risultati: /jobs?q=…&vjk=<id> → /viewjob?jk=<id>
    const vjk = u.searchParams.get('vjk');
    if (/(^|\.)indeed\.[a-z.]+$/i.test(u.hostname) && /^[0-9a-f]{16}$/i.test(vjk || '') && !/^\/viewjob/.test(u.pathname)) return `${u.origin}/viewjob?jk=${vjk.toLowerCase()}`;
  } catch { /* indirizzo non valido */ }
  return r.selectedUrl || '';
}

/** L'annuncio della pagina. Con un risultato selezionato in una pagina di ricerca (selectedUrl), solo il JobPosting dell'elenco
 *  con lo stesso identificativo (uuid o numero nel percorso): mai il primo dell'elenco a caso. */
export function postingFor(r) {
  const sel = selectedUrl(r || {});
  if (!sel) return jobPostings((r || {}).ld)[0];
  const id = (String(sel).match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d{6,}/i) || [])[0];
  if (!id) return undefined;
  return jobPostings(r.ld, { lists: true }).find(p => [p.url, p.mainEntityOfPage, name(p.identifier), p.identifier?.value].some(v => String(v || '').toLowerCase().includes(id.toLowerCase())));
}

function place(jp) {
  const loc = [].concat(jp?.jobLocation || [])[0];
  const a = loc?.address && typeof loc.address === 'object' ? loc.address : {};
  const ccRaw = squash(name(a.addressCountry));
  const cc = /^[a-z]{2}$/i.test(ccRaw) ? ccRaw : COUNTRIES[fold(ccRaw)] || '';            // «United States of America» → US
  // jobs.ch e jobup.ch mettono la città in addressRegion («Glarus/Hybrid»): senza la modalità, che legge match.js
  const city = a.addressLocality || String(a.addressRegion || '').replace(/\s*\/\s*(hybrid|remote|home ?office|teletravail|télétravail).*$/i, '');
  return { zipCity: short([a.postalCode, city].filter(Boolean).join(' ')), country: /^[a-z]{2}$/i.test(cc) ? cc.toUpperCase() : '' };
}

/** Sito svizzero: dominio .ch oppure sezione svizzera di un portale internazionale (ch.talent.com, ch.indeed.com). */
export function swissSite(url) { try { const h = new URL(url).hostname; return /\.ch$/i.test(h) || /^ch\./i.test(h); } catch { return false; } }

/** Paesi come li scrivono i siti di annunci (riga «Città, Regione, Paese»), in inglese, italiano, tedesco e francese. */
const COUNTRIES = {
  switzerland: 'CH', svizzera: 'CH', schweiz: 'CH', suisse: 'CH', italy: 'IT', italia: 'IT', italien: 'IT', italie: 'IT',
  germany: 'DE', germania: 'DE', deutschland: 'DE', allemagne: 'DE', france: 'FR', francia: 'FR', frankreich: 'FR',
  austria: 'AT', osterreich: 'AT', autriche: 'AT', liechtenstein: 'LI', luxembourg: 'LU', lussemburgo: 'LU', luxemburg: 'LU',
  'united states of america': 'US', 'united kingdom': 'GB', 'great britain': 'GB', england: 'GB', 'regno unito': 'GB', 'vereinigtes konigreich': 'GB', 'royaume-uni': 'GB', ireland: 'IE', irlanda: 'IE',
  spain: 'ES', spagna: 'ES', spanien: 'ES', espagne: 'ES', portugal: 'PT', portogallo: 'PT', netherlands: 'NL', 'paesi bassi': 'NL', niederlande: 'NL', 'pays-bas': 'NL',
  belgium: 'BE', belgio: 'BE', belgien: 'BE', belgique: 'BE', sweden: 'SE', svezia: 'SE', denmark: 'DK', danimarca: 'DK', norway: 'NO', norvegia: 'NO',
  finland: 'FI', finlandia: 'FI', poland: 'PL', polonia: 'PL', 'united states': 'US', 'stati uniti': 'US', usa: 'US', canada: 'CA',
  'united arab emirates': 'AE', 'emirati arabi uniti': 'AE', 'vereinigte arabische emirate': 'AE', 'emirats arabes unis': 'AE',
  'saudi arabia': 'SA', qatar: 'QA', singapore: 'SG', 'hong kong': 'HK', china: 'CN', cina: 'CN', japan: 'JP', giappone: 'JP',
  india: 'IN', australia: 'AU', 'new zealand': 'NZ', israel: 'IL', israele: 'IL',
};
const fold = s => String(s ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

/** Indirizzo mostrato nel riquadro del sito («Bahnstrasse 24, 8603 Schwerzenbach»): NPA e località; CH se il sito è svizzero e l'NPA ha 4 cifre. */
export function placeFromAddress(addr, url) {
  const parts = squash(addr).split(',').map(squash).filter(Boolean);
  if (!parts.length) return { zipCity: '', country: '' };
  const last = parts[parts.length - 1];
  const m = last.match(/^(\d{4,5})\s+(.+)$/);
  // «3052 Hauptsitz Zollikofen (BE)» → «3052 Zollikofen»: senza «sede principale» e senza cantone
  if (m) m[2] = m[2].replace(/^(hauptsitz|sitz|headquarters|hq|siège( social)?|sede( centrale| principale)?)\s+/i, '').replace(/\s*\((AG|AI|AR|BE|BL|BS|FR|GE|GL|GR|JU|LU|NE|NW|OW|SG|SH|SO|SZ|TG|TI|UR|VD|VS|ZG|ZH)\)$/, '')
    .replace(/\s*\/\s*(hybrid|remote|home ?office|hybride|ibrido)$/i, '');      // «8750 Glarus/Hybrid» → «8750 Glarus»
  let host = ''; try { host = new URL(url).hostname; } catch { /* indirizzo non valido */ }
  return { zipCity: short(m ? `${m[1]} ${m[2]}` : last), country: m && m[1].length === 4 && /\.ch$/i.test(host) ? 'CH' : '' };
}

/** «Zurich, Zurich, Switzerland (Hybrid)» → { city: 'Zurich', country: 'CH' }. Paese sconosciuto: vuoto, mai inventato. */
export function splitPlace(s) {
  const parts = squash(s).replace(/\((hybrid|remote|on-?site|ibrido|da remoto|in sede|hybride|teletravail)\)/ig, '').split(',').map(squash).filter(Boolean);
  if (!parts.length) return { city: '', country: '' };
  const last = COUNTRIES[fold(parts[parts.length - 1])] || '';
  // «Pfingstweidstrasse 110, 8005 Zurigo, ZH» (Indeed): la parte con l'NPA, non la via
  const zip = parts.find(x => /^\d{4,5}\s+\p{L}/u.test(x));
  const city = zip || (parts.length > 1 || !last ? parts[0] : '');
  return { city: COUNTRIES[fold(city)] ? '' : short(city), country: last };
}

/** Siti di annunci e sistemi di candidatura: il loro nome non è mai l'impresa. */
const AGGREGATORS = /^(linkedin|indeed|jobs\.?ch|jobup|glassdoor|stepstone|monster|xing|jobscout24|jobwinner|jora|talent\.com|talent|simplyhired|jooble|jobrapido|adzuna|ziprecruiter|careerbuilder|greenhouse|lever|workday|smartrecruiters|personio|ashby|workable|recruitee|join|teamtailor|successfactors|sap successfactors|careers?|jobs?|karriere|lavora con noi)$/i;
const notAggregator = s => s && !AGGREGATORS.test(squash(s).replace(/\.(com|ch|de|io)$/i, ''));

/** «Acme Careers», «Beispiel AG – Karriere», «Jobs bei Acme»: il nome dell'impresa senza le parole della pagina carriere. */
export function cleanCompany(s) {
  return squash(s).replace(/^(jobs?|karriere|careers?|stellen(angebote)?)\s+(bei|at|chez|presso|da)\s+/i, '')
    .replace(/\s*[-–|:]?\s*(careers?|karriere|jobs?|stellenangebote|offene stellen|lavora con noi|offerte di lavoro|carri[eè]res?|emplois?|recrutement)$/i, '').trim();
}

/** «Ruolo - Impresa | Sito», «(3) Ruolo | Impresa | LinkedIn», «Ruolo at Impresa»: ruolo e impresa dal titolo della scheda. */
export function splitTitle(t) {
  const s = squash(t).replace(/^\(\d+\)\s*/, '');
  // con «|» si divide solo lì: il titolo può contenere «–» o «at» («INFORMATION SECURITY MANAGER – GROUPE (H/F) | Impresa | LinkedIn»)
  const DASH = /\s+(?:–|—|-|·|at|bei|presso|chez|@)\s+/i;
  let parts = s.split(/\s+\|\s+/).map(squash).filter(notAggregator);
  if (parts.length < 2) parts = (parts[0] || '').split(DASH).map(squash).filter(notAggregator);      // «Head of IT - Beispiel AG | jobs.ch»
  return { role: parts[0] || '', company: parts.length > 1 ? parts[1] : '' };
}

/** raw: dati di grab() (grab.js); htmlToText: per la descrizione HTML del JobPosting. Ogni campo dice da dove viene (sources). */
export function fields(raw, htmlToText = s => String(s ?? '').replace(/<[^>]*>/g, ' ')) {
  const r = raw || {}, site = r.site || {}, micro = r.micro || {};
  // riquadro trovato dal titolo della scheda: se il sito indica un altro titolo (Indeed accanto ai risultati: la scheda ha il titolo della ricerca), non è quello dell'annuncio
  const top = r.top && !(site.title && r.top.title && squash(site.title).toLowerCase() !== squash(r.top.title).toLowerCase()) ? r.top : {};
  const jp = postingFor(r);
  const where = place(jp);
  const sitePlace = placeFromAddress(site.place, r.url);
  const topPlace = splitPlace(top.location || site.loc);      // site.loc: luogo del riquadro senza indirizzo (Indeed: «Zurigo, ZH»)
  const fromTitle = splitTitle(r.og_title || r.title);
  const pick = list => { for (const [v, src] of list) if (squash(v)) return [v, src]; return ['', '']; };
  const [role, roleSrc] = pick([[jp?.title, 'dati strutturati'], [micro.title, 'microdata'], [site.title, 'pagina del sito'], [top.title, 'riquadro dell\'annuncio'], [r.h1, 'titolo nella pagina'], [fromTitle.role, 'titolo della scheda']]);
  const [company, companySrc] = pick([[name(jp?.hiringOrganization), 'dati strutturati'], [micro.company, 'microdata'], [site.company || r.li_company, 'pagina del sito'], [top.company, 'riquadro dell\'annuncio'],
    [fromTitle.company, 'titolo della scheda'], [notAggregator(r.og_site) ? r.og_site : '', 'nome del sito']]);
  const sel = String(r.selection || '').trim();
  // testo dei dati strutturati troppo corto (jobs.ch nell'elenco dei risultati: «We are looking for a … to join our team.»): meglio quello del riquadro
  const ldDesc = jp?.description ? htmlToText(jp.description).trim() : '';
  const longer = [site.desc || r.desc, r.about].map(x => String(x || '').trim()).sort((a, b) => b.length - a.length)[0] || '';
  const ldOk = ldDesc.length >= 400 || ldDesc.length >= longer.length;
  const [desc, descSrc] = sel.length >= 200 ? [sel, 'selezione'] : pick([[ldOk ? ldDesc : '', 'dati strutturati'], [micro.desc, 'microdata'],
    [site.desc || r.desc, 'pagina del sito'], [r.about, 'sezione «About the job»'], [r.best, 'blocco della descrizione'], [r.main, 'testo della pagina']]);
  const zipCity = (/^\d{4,5}\s/.test(sitePlace.zipCity) && !/^\d/.test(where.zipCity) ? sitePlace.zipCity : '') || where.zipCity || short(micro.location) || sitePlace.zipCity || topPlace.city;
  return {
    company: short(cleanCompany(company)),
    role: short(role),
    // l'indirizzo del riquadro con l'NPA è più preciso della sola località dei dati strutturati
    employer_zip_city: zipCity,
    // siti svizzeri (jobs.ch, ch.talent.com…): un luogo senza paese è in Svizzera; altrove resta vuoto, mai inventato
    employer_country: where.country || sitePlace.country || topPlace.country || (swissSite(r.url) && zipCity ? 'CH' : ''),
    job_url: jobUrl(selectedUrl(r) || r.url),           // annuncio aperto accanto ai risultati: l'indirizzo del suo dettaglio
    job_desc: String(desc).trim().slice(0, MAX_DESC),
    source: descSrc,
    sources: { role: roleSrc, company: companySrc, job_desc: descSrc },
  };
}

// ── Date dell'annuncio: pubblicazione e scadenza delle candidature ──
const MONTHS = { jan: 1, january: 1, januar: 1, janvier: 1, gennaio: 1, feb: 2, february: 2, februar: 2, fevrier: 2, febbraio: 2, mar: 3, march: 3, marz: 3, mars: 3, marzo: 3,
  apr: 4, april: 4, avril: 4, aprile: 4, may: 5, mai: 5, maggio: 5, jun: 6, june: 6, juni: 6, juin: 6, giugno: 6, jul: 7, july: 7, juli: 7, juillet: 7, luglio: 7,
  aug: 8, august: 8, aout: 8, agosto: 8, sep: 9, sept: 9, september: 9, septembre: 9, settembre: 9, oct: 10, october: 10, oktober: 10, octobre: 10, ottobre: 10,
  nov: 11, november: 11, novembre: 11, dec: 12, december: 12, dezember: 12, decembre: 12, dicembre: 12 };
const iso = (y, m, d) => { const t = new Date(Date.UTC(+y, +m - 1, +d)); return t.getUTCFullYear() === +y && t.getUTCMonth() === +m - 1 && t.getUTCDate() === +d ? t.toISOString().slice(0, 10) : ''; };
/** Prima data in un testo: 2026-12-15, 15.12.2026, 15/12/2026, 15 December 2026, 15. Dezember 2026, December 15, 2026. '' se non c'è. */
export function parseDate(s) {
  const t = fold(s);
  let m = t.match(/\b(20\d\d)-(\d\d)-(\d\d)/); if (m) return iso(m[1], m[2], m[3]);
  m = t.match(/\b(\d{1,2})[./](\d{1,2})[./](20\d\d)\b/); if (m) return iso(m[3], m[2], m[1]);
  m = t.match(/\b(\d{1,2})\.?\s+([a-z]{3,9})\.?\s+(20\d\d)\b/); if (m && MONTHS[m[2]]) return iso(m[3], MONTHS[m[2]], m[1]);
  m = t.match(/\b([a-z]{3,9})\.?\s+(\d{1,2}),?\s+(20\d\d)\b/); if (m && MONTHS[m[1]]) return iso(m[3], MONTHS[m[1]], m[2]);
  return '';
}
/** «3 days ago», «Reposted 2 weeks ago», «vor 3 Tagen», «il y a 5 jours», «3 giorni fa», «17 hours ago» → data approssimativa (AAAA-MM-GG). */
export function agoDate(s, now = new Date()) {
  const t = fold(s);
  const m = t.match(/(\d+)\s*(minute|min|hour|hr|stunde|heure|ora|ore|day|tag|jour|giorn|week|woche|semaine|settiman|month|monat|mois|mes)/);
  if (!m || !/(ago|vor|il y a|fa\b)/.test(t)) return /\b(today|heute|aujourd|oggi|just now)\b/.test(t) ? now.toISOString().slice(0, 10) : '';
  const n = Number(m[1]), u = m[2];
  const days = /^(minute|min|hour|hr|stunde|heure|ora|ore)/.test(u) ? 0 : /^(day|tag|jour|giorn)/.test(u) ? n : /^(week|woche|semaine|settiman)/.test(u) ? 7 * n : 30 * n;
  return new Date(now.getTime() - days * 864e5).toISOString().slice(0, 10);
}
const DEADLINE = /(bewerbungsfrist|bewerbungsschluss|einsendeschluss|anmeldeschluss|apply by|application deadline|applications? close|closing date|deadline(?!s)|candidature entro|candidarsi entro|scadenza|termine (di|per la) candidatura|delai de postulation|date limite|postuler avant|postulez avant)/;
/** { posted, postedApprox, deadline } in AAAA-MM-GG ('' se non si sa). Dati strutturati prima, poi il riquadro e il testo. */
export function jobDates(raw, now = new Date()) {
  const r = raw || {}, jp = postingFor(r) || {};
  let posted = parseDate(String(jp.datePosted || '')), approx = false;
  if (!posted) posted = parseDate(String(r.site?.info || '').slice(0, 40));                     // jobs.ch: «20 November 2026 · 80 – 100% · …»
  if (!posted) { const w = (r.top?.lines || String(r.top?.text || '').split('\n')).join(' · ').split(/\s[·•∙]\s/).find(x => /(ago|vor |il y a| fa\b|today|heute|aujourd|oggi)/i.test(x)); if (w) { posted = agoDate(w, now); approx = !!posted; } }
  let deadline = parseDate(String(jp.validThrough || ''));
  const text = fold([String(jp.description || '').replace(/<[^>]*>/g, ' '), r.site?.desc, r.about, r.best, r.selection].filter(Boolean).join('\n'));      // anche il testo dei dati strutturati
  const dm = text.match(DEADLINE);
  if (dm) { const d = parseDate(text.slice(dm.index, dm.index + dm[0].length + 35)); if (d) deadline = d; }      // la scadenza scritta nell'annuncio vale più di validThrough (spesso automatico)
  return { posted, postedApprox: approx, deadline };
}
