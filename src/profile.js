/* Profilo professionale dell'utente (Profilo → profilo strutturato del CV): documento cifrato di tipo «cv_profile» (uno per account,
 * application_id null, AAD jd1:doc, JSON UTF-8), scritto dal browser (public/assets/profile-ui.js del portale). Qui solo lettura.
 *
 * Si espongono solo le sezioni utili a valutare un annuncio, con i nomi del portale:
 *   headline, summary, experience [{title, employer, location, start, end, bullets}], skills, certifications (testi),
 *   education [{degree, institution, location, start, end}], languages [{name, level}], links {linkedin, website}; più lang (lingua del profilo).
 * Mai: nome, email, telefono, luogo di residenza (contacts.location), data di nascita, nazionalità, permesso (personal.*), casi STAR,
 * origine del profilo (src), foto, CV e lettere, e qualsiasi campo che il portale aggiunga in futuro (elenco chiuso). */

export const PROFILE_KIND = 'cv_profile';
export const SECTIONS = ['headline', 'summary', 'experience', 'skills', 'certifications', 'education', 'languages', 'links'];
export const MAX_CHARS = 15000;

const line = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const text = (v, max) => (typeof v === 'string' ? v.replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').trim().slice(0, max) : '');
const strings = (v, max, n) => [...new Set((Array.isArray(v) ? v : []).map(x => line(x, max)).filter(Boolean))].slice(0, n);
const url = v => { const s = line(v, 300); return /^https?:\/\/[^\s]+$/i.test(s) ? s : ''; };
const LINKEDIN = s => (/^(https?:\/\/)?([a-z]{2,3}\.)?(www\.)?linkedin\.com\//i.test(s) ? (/^https?:/i.test(s) ? s : 'https://' + s) : s);
/** «MM.AAAA», «AAAA» o «present» (come li salva il portale); altro testo scartato. */
const date = v => { const s = line(v, 20); return /^((0[1-9]|1[0-2])\.)?(19|20)\d\d$/.test(s) || s === 'present' ? s : ''; };
/** Chiave per l'ordine «dal più recente»: present prima di tutto, poi fine, poi inizio. */
const when = s => (s === 'present' ? 999912 : (m => (m ? Number(m[3]) * 100 + Number(m[2] || 12) : 0))(String(s).match(/^((\d\d)\.)?((19|20)\d\d)$/)));
const recent = (a, b) => when(b.end) - when(a.end) || when(b.start) - when(a.start);
const drop = o => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== '' && !(Array.isArray(v) && !v.length)));

/** Documento grezzo → { profile, truncated }. sections: sottoinsieme di SECTIONS (tutte se omesso). Nessun campo vuoto nell'uscita. */
export function cleanProfile(raw, sections = SECTIONS, maxChars = MAX_CHARS) {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const want = new Set(sections);
  const c = r.contacts && typeof r.contacts === 'object' ? r.contacts : {};
  const p = {};
  const lang = /^[a-z]{2}$/.test(r.lang) ? r.lang : '';
  if (want.has('headline')) p.headline = line(r.headline, 200);
  if (want.has('summary')) p.summary = text(r.summary, 4000);
  if (want.has('experience')) p.experience = (Array.isArray(r.experience) ? r.experience : []).filter(x => x && typeof x === 'object')
    .map(x => drop({ title: line(x.title, 150), employer: line(x.employer, 150), location: line(x.location, 120), start: date(x.start), end: date(x.end), bullets: strings(x.bullets, 600, 20) }))
    .filter(x => x.title || x.employer).sort(recent).slice(0, 40);
  if (want.has('skills')) p.skills = strings(r.skills, 100, 60);
  if (want.has('certifications')) p.certifications = strings(r.certifications, 200, 30);
  if (want.has('education')) p.education = (Array.isArray(r.education) ? r.education : []).filter(x => x && typeof x === 'object')
    .map(x => drop({ degree: line(x.degree, 200), institution: line(x.institution, 200), location: line(x.location, 120), start: date(x.start), end: date(x.end) }))
    .filter(x => x.degree || x.institution).sort(recent).slice(0, 20);
  if (want.has('languages')) p.languages = (Array.isArray(r.languages) ? r.languages : []).filter(x => x && typeof x === 'object')
    .map(x => drop({ name: line(x.name, 60), level: line(x.level, 60) })).filter(x => x.name).slice(0, 15);
  if (want.has('links')) { const l = drop({ linkedin: url(LINKEDIN(line(c.linkedin, 300))), website: url(c.website) }); if (Object.keys(l).length) p.links = l; }
  const profile = drop(p);
  if (Object.keys(profile).length && lang) profile.lang = lang;
  return { profile, truncated: shrink(profile, maxChars) };
}

/** Oltre maxChars: prima si accorciano e poi si tolgono i risultati delle esperienze più vecchie, poi la sintesi. Ritorna true se ha tagliato. */
function shrink(p, maxChars) {
  const size = () => JSON.stringify(p).length;
  if (size() <= maxChars) return false;
  const exp = p.experience || [];
  for (let i = exp.length - 1; i >= 0 && size() > maxChars; i--) {
    const b = exp[i].bullets || [];
    if (b.length) { exp[i].bullets = b.map(s => (s.length > 160 ? s.slice(0, 157) + '…' : s)).slice(0, 2); if (size() > maxChars) delete exp[i].bullets; }
  }
  if (size() > maxChars && p.summary) p.summary = p.summary.slice(0, 1000) + (p.summary.length > 1000 ? '…' : '');
  for (const k of ['education', 'experience']) while (size() > maxChars && (p[k] || []).length > 1) p[k].pop();          // ultima risorsa: le voci più vecchie
  return true;
}
