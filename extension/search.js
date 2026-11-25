/**
 * Ricerche di annunci sui portali con le preferenze dell'utente: solo indirizzi da aprire in una scheda nuova, nessuna lettura né salvataggio.
 * keywords (dal titolo del profilo, modificabili), location e cc (dalle preferenze), modes (onsite/hybrid/remote), recent (ultimi 7 giorni).
 */
const INDEED = { CH: 'ch', DE: 'de', AT: 'at', IT: 'it', FR: 'fr', GB: 'uk', IE: 'ie', NL: 'nl', BE: 'be', ES: 'es', US: 'www' };
const LI_WT = { onsite: '1', remote: '2', hybrid: '3' };

export function searchUrls({ keywords = '', location = '', cc = '', modes = [], recent = false } = {}) {
  const kw = String(keywords).replace(/\s+/g, ' ').trim().slice(0, 200), loc = String(location).replace(/\s+/g, ' ').trim().slice(0, 100);
  if (!kw) return [];
  const q = o => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== '' && v != null)).toString();
  const wt = [...new Set((modes || []).map(m => LI_WT[m]).filter(Boolean))].join(',');
  const out = [{ name: 'LinkedIn', url: `https://www.linkedin.com/jobs/search/?${q({ keywords: kw, location: loc, f_WT: wt, f_TPR: recent ? 'r604800' : '' })}` }];
  if (!cc || cc === 'CH') out.push({ name: 'jobs.ch', url: `https://www.jobs.ch/de/stellenangebote/?${q({ term: kw, location: loc })}` });
  const sub = INDEED[String(cc).toUpperCase()] || 'www';
  out.push({ name: 'Indeed', url: `https://${sub}.indeed.com/jobs?${q({ q: kw, l: loc, fromage: recent ? '7' : '' })}` });
  return out;
}
