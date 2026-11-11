/* Deduplica: URL normalizzati, ID di piattaforma (LinkedIn, Indeed, jobs.ch) e coppia azienda+ruolo. */

const strip = s => String(s ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const TRACKING = /^(utm_|fbclid$|gclid$|mc_|trk|refid$|trackingid$)/i;

export function normUrl(u) {
  try {
    const x = new URL(u);
    const q = [...x.searchParams.entries()].filter(([k]) => !TRACKING.test(k)).sort(([a], [b]) => a.localeCompare(b));
    const qs = q.length ? '?' + q.map(([k, v]) => `${k}=${v}`).join('&') : '';
    return x.hostname.replace(/^www\./, '').toLowerCase() + x.pathname.replace(/\/+$/, '') + qs;
  } catch { return String(u ?? '').trim().toLowerCase(); }
}

const LEGAL = /\b(ag|sa|gmbh|ltd|limited|inc|llc|sarl|sagl|plc|spa|se|group|holding|schweiz|switzerland|suisse|svizzera)\b/g;

export function normCompany(c) {
  return strip(c).replace(/\([^)]*\)/g, ' ').replace(LEGAL, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
}

const GENDER = /\b(m\s*\/\s*[fw]\s*\/\s*[dx]|[fw]\s*\/\s*m\s*\/\s*[dx]|h\s*\/\s*f)\b/g;
const clean = s => s.replace(GENDER, ' ').replace(/\b\d{2,3}\s*(-\s*\d{2,3})?\s*%/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();

/** Varianti del ruolo: il testo fuori dalle parentesi e quello dentro (es. "Chief Information Security Officer (CISO)"). */
export function roleKeys(r) {
  const s = strip(r);
  const out = new Set();
  const outside = clean(s.replace(/\([^)]*\)/g, ' '));
  if (outside) out.add(outside);
  for (const m of s.matchAll(/\(([^)]*)\)/g)) { const t = clean(m[1]); if (t.length > 2) out.add(t); }
  const all = clean(s); if (all) out.add(all);
  return out;
}

export function platformIds(text) {
  const t = String(text ?? '');
  const out = new Set();
  for (const m of t.matchAll(/linkedin\.com\/jobs\/view\/(?:[^\s\/?#]*?-)?(\d{6,})/gi)) out.add('linkedin:' + m[1]);
  for (const m of t.matchAll(/\blinkedin[\s:#]*(\d{8,})/gi)) out.add('linkedin:' + m[1]);
  for (const m of t.matchAll(/\bjk=([0-9a-f]{12,})/gi)) out.add('indeed:' + m[1].toLowerCase());
  for (const m of t.matchAll(/\bindeed[\s:#]*([0-9a-f]{16})\b/gi)) out.add('indeed:' + m[1].toLowerCase());
  for (const m of t.matchAll(/vacancies\/detail\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi)) out.add('jobsch:' + m[1].toLowerCase());
  for (const m of t.matchAll(/\bjobs\.ch[\s:#]*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi)) out.add('jobsch:' + m[1].toLowerCase());
  return out;
}

export const noteLog = d => Array.isArray(d.note_log) ? d.note_log : (d.notes ? [{ id: 'n0', at: '', text: String(d.notes) }] : []);
const noteText = d => noteLog(d).map(n => n.text || '').join(' ');
const isPlaceholder = c => /^da completare\b/i.test(String(c ?? '').trim());

/** cand: { company, role, urls[], text, alt_companies[] } → [{ id, company, role, status, reason }] */
export function findDuplicates(items, cand) {
  const urls = new Set((cand.urls || []).filter(Boolean).map(normUrl));
  const ids = platformIds([...(cand.urls || []), cand.text || ''].join(' '));
  const companies = new Set([cand.company, ...(cand.alt_companies || [])].map(normCompany).filter(Boolean));
  const roles = cand.role ? roleKeys(cand.role) : new Set();
  const found = [];
  for (const { row, d } of items) {
    const reasons = [];
    const itemUrls = [d.job_url, d.apply_url].filter(Boolean);
    if (itemUrls.some(u => urls.has(normUrl(u)))) reasons.push('url');
    const itemIds = platformIds(itemUrls.join(' ') + ' ' + noteText(d));
    if ([...ids].some(i => itemIds.has(i))) reasons.push('platform_id');
    if (!isPlaceholder(d.company) && companies.size && roles.size && d.role) {
      const c = normCompany(d.company);
      const rk = roleKeys(d.role);
      if (companies.has(c) && [...roles].some(x => rk.has(x))) reasons.push('company_role');
    }
    if (reasons.length) found.push({ id: row.id, company: d.company || '', role: d.role || '', status: row.status, reason: reasons.join('+') });
  }
  return found;
}
