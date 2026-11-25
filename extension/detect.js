/* È un annuncio di lavoro? Si decide prima di estrarre i campi, a ogni caricamento della pagina. Nessun accesso al DOM (dati di grab.js).
 * Esiti: 'job' (certo: dati strutturati JobPosting o pagina di un annuncio su un sito o sistema di candidatura noto),
 *        'probable' (pulsante di candidatura e sezioni tipiche: i campi vanno controllati),
 *        'list' (elenco o ricerca di annunci), 'no' (non sembra un annuncio). */
import { jobPostings, selectedUrl } from './parse.js';

/** Pagine del singolo annuncio sui siti di annunci e sui sistemi di candidatura (ATS) più diffusi. */
const JOB_PAGES = [
  [/(^|\.)linkedin\.com$/, u => /^\/jobs\/view\/[^/]*\d{6,}/.test(u.pathname) || /^\d{6,}$/.test(u.searchParams.get('currentJobId') || '')],
  [/(^|\.)jobs\.ch$/, u => /\/detail\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(u.pathname)],      // /it/offerte-di-lavoro/, /de/stellenangebote/, /en/vacancies/…
  [/(^|\.)jobup\.ch$/, u => /\/jobs\/detail\//.test(u.pathname)],
  [/(^|\.)indeed\.[a-z.]+$/, u => /^\/(viewjob|rc\/clk|m\/basecamp\/viewjob)/.test(u.pathname) || !!u.searchParams.get('vjk') || !!u.searchParams.get('jk')],
  [/(^|\.)stepstone\.[a-z.]+$/, u => /\/stellenangebote--|\/offres-emploi--|\/job-/.test(u.pathname)],
  [/(^|\.)glassdoor\.[a-z.]+$/, u => /\/job-listing\//i.test(u.pathname)],
  [/(^|\.)greenhouse\.io$/, u => /\/jobs\/\d+/.test(u.pathname)],
  [/^jobs\.lever\.co$/, u => /^\/[^/]+\/[0-9a-f-]{36}/.test(u.pathname)],
  [/\.myworkdayjobs\.com$/, u => /\/job\//.test(u.pathname)],
  [/^(jobs|careers)\.smartrecruiters\.com$/, u => /^\/[^/]+\/\d+/.test(u.pathname)],
  [/\.jobs\.personio\.(de|com)$/, u => /^\/job\/\d+/.test(u.pathname)],
  [/^jobs\.ashbyhq\.com$/, u => /^\/[^/]+\/[0-9a-f-]{36}/.test(u.pathname)],
  [/^apply\.workable\.com$/, u => /\/j\/[0-9A-F]+/i.test(u.pathname)],
  [/\.recruitee\.com$/, u => /^\/o\//.test(u.pathname)],
  [/(successfactors\.(com|eu)|jobs\.sap\.com)$/, u => /\/job\//i.test(u.pathname) || /career_job_req_id|jobId/i.test(u.search)],
  [/\.teamtailor\.com$/, u => /^\/jobs\/\d+/.test(u.pathname)],
  [/^join\.com$/, u => /^\/companies\/[^/]+\/\d+/.test(u.pathname)],
  [/(^|\.)jobup\.ch$/, u => /\/detail\/[0-9a-f]{8}-[0-9a-f]{4}-/i.test(u.pathname)],
  [/(^|\.)talent\.com$/, u => u.pathname === '/view' && /^\d+$/.test(u.searchParams.get('id') || '')],
  [/(^|\.)jooble\.org$/, u => /^\/desc\/\d+/.test(u.pathname)],
  [/(^|\.)adzuna\.[a-z.]+$/, u => /^\/(details|land\/ad)\/\d+/.test(u.pathname)],
  [/(^|\.)simplyhired\.[a-z.]+$/, u => /^\/job\/[\w-]{10,}/.test(u.pathname)],
  [/(^|\.)ziprecruiter\.[a-z.]+$/, u => /^\/(c\/[^/]+\/job\/|jobs\/[\w-]+-[0-9a-f]{6,}|jobs\/\d{6,}-|ojob\/)/i.test(u.pathname)],
  [/(^|\.)monster\.[a-z.]+$/, u => /^\/job-openings\//.test(u.pathname)],
  [/(^|\.)careerbuilder\.[a-z.]+$/, u => /^\/(job\/\w{10,}|job-details\/)/.test(u.pathname)],
  [/(^|\.)jora\.com$/, u => /^\/job\/[^/]+/.test(u.pathname)],
  [/(^|\.)jobrapido\.com$/, u => /^\/jobpreview\/\d+/.test(u.pathname)],
];
/** Ricerche ed elenchi sugli stessi siti. */
const LIST_PAGES = [
  [/(^|\.)linkedin\.com$/, u => /^\/jobs\/(search|collections)/.test(u.pathname) && !u.searchParams.get('currentJobId')],
  [/(^|\.)(jobs\.ch|jobup\.ch)$/, u => /\/(vacancies|jobs)\/?$/.test(u.pathname) || u.searchParams.has('term')],
  [/(^|\.)indeed\.[a-z.]+$/, u => /^\/(jobs|q-)/.test(u.pathname) && !u.searchParams.get('vjk')],
];

const known = (rules, url) => {
  let u; try { u = new URL(url); } catch { return false; }
  return rules.some(([host, path]) => host.test(u.hostname.toLowerCase()) && path(u));
};

/** raw: dati di grab(). Ritorna { kind, reason }. */
export function detectJob(raw) {
  const r = raw || {};
  // pagine di verifica anti-bot (Indeed, Glassdoor, Adzuna, Cloudflare…): non sono l'annuncio, anche se l'indirizzo lo è
  if (/(additional verification required|humans only|confirm you are (a )?human|verify you are (a )?human|are you a robot|just a moment|checking your browser|attention required|access denied|bitte bestätigen|vérifiez que vous|let.s confirm you are human|zusätzliche verifizierung erforderlich|vérification supplémentaire requise|verifica aggiuntiva richiesta)/i.test(`${r.title || ''} ${r.h1 || ''}`)
    // «Nur einen Moment…» (Cloudflare in tedesco) e simili: solo se è tutto il titolo, perché «un momento» può stare in un annuncio
    || /^(nur einen moment|einen moment bitte|un instant|un moment|solo un momento|un momento|just a moment)\W*$/i.test(String(r.title || '').trim()))
    return { kind: 'blocked', reason: 'pagina di verifica del sito' };
  const sel = selectedUrl(r);
  if (sel && known(JOB_PAGES, sel)) return { kind: 'job', reason: 'annuncio aperto accanto ai risultati' };
  if (jobPostings(r.ld).length) return { kind: 'job', reason: 'dati strutturati dell\'annuncio (JobPosting)' };
  if (r.micro && (r.micro.title || r.micro.desc)) return { kind: 'job', reason: 'dati strutturati dell\'annuncio (microdata)' };
  if (known(JOB_PAGES, r.url)) return { kind: 'job', reason: 'pagina di un annuncio su un sito noto' };
  if (known(LIST_PAGES, r.url)) return { kind: 'list', reason: 'elenco o ricerca di annunci' };
  const hits = r.sectionHits || 0;
  if (hits >= 2 && (r.apply || hits >= 3) && (r.best || '').length >= 400) return { kind: 'probable', reason: 'sezioni tipiche di un annuncio' + (r.apply ? ' e pulsante di candidatura' : '') };
  if ((r.jobLinks || 0) >= 5) return { kind: 'list', reason: 'molti link ad annunci' };
  return { kind: 'no', reason: 'nessun segno di un annuncio di lavoro' };
}
