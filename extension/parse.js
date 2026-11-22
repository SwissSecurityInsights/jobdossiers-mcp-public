/* Dai dati grezzi della pagina (grab() in popup.js) ai campi di jd_create. Nessun accesso al DOM: si prova anche in Node (test/extension.test.js).
 * Ordine delle fonti: testo selezionato dall'utente, dati strutturati JobPosting (schema.org, li hanno quasi tutti i siti di annunci),
 * selettori noti di LinkedIn, infine titolo e testo della pagina. Tutto resta modificabile nella finestra prima di salvare. */

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

/** raw: { url, title, h1, og_title, og_site, ld[], selection, desc, main, li_company }; htmlToText: per la descrizione HTML del JobPosting. */
export function fields(raw, htmlToText = s => String(s ?? '').replace(/<[^>]*>/g, ' ')) {
  const r = raw || {};
  const jp = jobPostings(r.ld)[0];
  const where = place(jp);
  const sel = String(r.selection || '').trim();
  const fromLd = jp?.description ? htmlToText(jp.description) : '';
  const desc = sel.length >= 200 ? sel : fromLd.trim() || String(r.desc || '').trim() || String(r.main || '').trim();
  return {
    company: short(name(jp?.hiringOrganization) || r.li_company || r.og_site),
    role: short(jp?.title || r.h1 || r.og_title || r.title),
    employer_zip_city: where.zipCity,
    employer_country: where.country,
    job_url: jobUrl(r.url),
    job_desc: desc.slice(0, MAX_DESC),
    source: sel.length >= 200 ? 'selezione' : jp ? 'dati strutturati' : 'pagina',
  };
}
