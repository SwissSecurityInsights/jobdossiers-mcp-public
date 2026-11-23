/* Confronto tra l'annuncio letto nel pannello e le preferenze di lavoro dell'utente (jd_preferences, schema Preferences di openapi.json).
 * Tutto qui, nel browser: preferenze e annuncio non vanno da nessuna parte. Nessun servizio di mappe: il luogo si confronta per nome.
 * Esito per criterio: 'ok' (✓), 'no' (✗) o 'unknown' (?) quando l'annuncio non lo dice; niente punteggio unico. Nessun accesso al DOM. */
import { jobPostings } from './parse.js';

const fold = s => String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
const words = s => fold(s).replace(/[^a-z0-9]+/g, ' ').trim();
const name = v => typeof v === 'string' ? v : (v && typeof v === 'object' ? v.name || '' : '');
const num = s => Number(String(s).replace(/['’\s.,](?=\d{3}\b)/g, '').replace(',', '.'));

export const LABELS = { loc: 'Luogo', mode: 'Modalità', sal: 'Stipendio', pen: 'Occupazione', con: 'Contratto', lvl: 'Livello', trv: 'Viaggi', spo: 'Permesso di lavoro', sta: 'Inizio', sec: 'Settori da evitare' };
const MODE = { onsite: 'in sede', hybrid: 'ibrido', remote: 'da remoto' };
const CON = { permanent: 'tempo indeterminato', fixed: 'tempo determinato', freelance: 'freelance', interim: 'interinale', internship: 'stage' };
const LVL = { ic: 'specialista', lead: 'responsabile di team', head: 'head / direttore', exec: 'direzione' };

/** Dati dell'annuncio utili al confronto: dai dati strutturati JobPosting, altrimenti dal testo. */
export function jobFacts(raw, f) {
  const r = raw || {}, jp = jobPostings(r.ld)[0] || {};
  const role = f?.role || jp.title || r.h1 || '';
  const text = [role, r.top?.text, f?.job_desc, r.selection, r.desc].filter(Boolean).join('\n');      // top: riga «luogo · data» ed etichette come «Hybrid»
  const t = fold(text);
  const out = { text, role };

  // luogo
  const places = [].concat(jp.jobLocation || []).map(l => (l && typeof l.address === 'object' ? l.address : {}));
  const a = places[0] || {};
  out.city = a.addressLocality || (f?.employer_zip_city || '').replace(/^\d{4,5}\s*/, '');
  out.region = a.addressRegion || '';
  const cc = name(a.addressCountry) || f?.employer_country || '';
  out.country = /^[a-z]{2}$/i.test(cc) ? cc.toUpperCase() : '';
  out.places = [out.city, out.region, f?.employer_zip_city, ...places.map(p => p.addressLocality)].filter(Boolean);

  // modalità
  const modes = new Set();
  if ([].concat(jp.jobLocationType || []).some(x => /telecommute/i.test(x))) modes.add('remote');
  if (/\b(full[- ]?remote|fully remote|100 ?% remote|remote[- ]first|vollstandig remote|completamente da remoto|teletravail (complet|a 100))/.test(t)) modes.add('remote');
  if (/\b(hybrid|hybride?|ibrid[oa]|home ?office|mobiles arbeiten|telelavoro|smart working|teletravail|remote days?|days? (from|at) home|giorni da remoto)\b/.test(t)) modes.add('hybrid');
  if (/\b(on[- ]?site|vor ort|in sede|sur site|presenza in ufficio)\b/.test(t)) modes.add('onsite');
  out.modes = [...modes];
  const rd = t.match(/\b([1-5])\s*(?:days?|tage?n?|giorn[oi]|jours?)\b[^.\n]{0,25}\b(remote|home ?office|(?:from|at) home|da remoto|da casa|teletravail|mobil)/) || t.match(/\b(?:remote|home ?office|teletravail)[^.\n]{0,15}\b([1-5])\s*(?:days?|tage?n?|giorn[oi]|jours?)\b/);
  if (rd) out.remoteDays = Number(rd[1]);

  // stipendio (annuo)
  const bs = jp.baseSalary && typeof jp.baseSalary === 'object' ? jp.baseSalary : null;
  if (bs) {
    const v = bs.value && typeof bs.value === 'object' ? bs.value : { value: bs.value };
    const unit = String(v.unitText || bs.unitText || 'YEAR').toUpperCase();
    const k = unit === 'YEAR' ? 1 : unit === 'MONTH' ? 12 : 0;
    const lo = Number(v.minValue ?? v.value), hi = Number(v.maxValue ?? v.value);
    if (k && (lo > 0 || hi > 0)) out.salary = { cur: String(bs.currency || '').toUpperCase(), min: (lo || hi) * k, max: (hi || lo) * k };
  }
  if (!out.salary) {
    const m = text.match(/\b(CHF|EUR|USD|GBP|€|\$|£)\s?(\d{2,3}(?:['’.,\s]\d{3})|\d{2,3}\s?k)\s*(?:[-–]|bis|to|a)\s*(?:\1\s?)?(\d{2,3}(?:['’.,\s]\d{3})|\d{2,3}\s?k)?/i)
      || text.match(/\b(\d{2,3}(?:['’.,\s]\d{3})|\d{2,3}\s?k)\s*(?:[-–]\s*(\d{2,3}(?:['’.,\s]\d{3})|\d{2,3}\s?k))?\s*(CHF|EUR|USD|GBP|€|\$|£)/i);
    if (m) {
      const isPre = /^(CHF|EUR|USD|GBP|€|\$|£)$/i.test(m[1]);
      const [cur, a1, a2] = isPre ? [m[1], m[2], m[3]] : [m[3], m[1], m[2]];
      const val = s => s ? (/k$/i.test(s.trim()) ? num(s.replace(/k$/i, '')) * 1000 : num(s)) : NaN;
      const lo = val(a1), hi = val(a2);
      const sym = { '€': 'EUR', '$': 'USD', '£': 'GBP' };
      if (lo >= 10000) out.salary = { cur: (sym[cur] || cur).toUpperCase(), min: lo, max: hi >= lo ? hi : lo };
    }
  }

  // grado di occupazione
  const pm = fold(role).match(/\b(\d{2,3})\s*%?\s*[-–]\s*(\d{2,3})\s*%/) || fold(role).match(/\b(\d{2,3})\s*%/)
    || t.match(/\b(\d{2,3})\s*%?\s*[-–]\s*(\d{2,3})\s*%/) || t.match(/\((\d{2,3})\s*%\)/)            // «(100%)» accanto al titolo nel testo
    || t.match(/(?:pensum|arbeitspensum|taux d'activite|taux|grado di occupazione|workload|beschaftigungsgrad)\D{0,15}(\d{2,3})\s*%/);
  if (pm) { const lo = Number(pm[1]), hi = Number(pm[2] || pm[1]); if (lo >= 10 && hi <= 100 && lo <= hi) out.pensum = { min: lo, max: hi }; }
  else if (/\b(full[- ]?time|vollzeit|tempo pieno|plein temps)\b/.test(t) || [].concat(jp.employmentType || []).includes('FULL_TIME')) out.pensum = { min: 100, max: 100 };

  // contratto
  const con = new Set();
  const et = [].concat(jp.employmentType || []).map(x => String(x).toUpperCase());
  if (et.includes('CONTRACTOR')) con.add('freelance');
  if (et.includes('TEMPORARY')) con.add('fixed');
  if (et.includes('INTERN')) con.add('internship');
  if (/\b(unbefristet|festanstellung|permanent|tempo indeterminato|cdi|contrat a duree indeterminee)\b/.test(t)) con.add('permanent');
  if (/\b(befristet|fixed[- ]term|tempo determinato|cdd|temporary contract)\b/.test(t)) con.add('fixed');
  // «a freelancer» tra i clienti di un'impresa non è un contratto: solo formule che descrivono il rapporto di lavoro
  if (/\b(freelance (position|role|contract|basis|assignment|project)|on a freelance basis|as a freelancer|auf freiberuflicher basis|freiberufliche (mitarbeit|tatigkeit)|in qualita di libero professionista|independent contractor|contractor role)\b/.test(t)) con.add('freelance');
  if (/\b(interim|temporar|ad interim|personalverleih)\b/.test(t)) con.add('interim');
  if (/\b(praktikum|internship|tirocinio|stagiaire|praktikant)\b/.test(t)) con.add('internship');
  out.contracts = [...con];

  // livello (dal titolo)
  const r2 = fold(role);
  out.level = /\b(chief|ceo|cio|cto|cfo|coo|ciso|vp|vice president|managing director|geschaftsfuhrer|direttore generale|executive director|partner|board member|c-level)\b/.test(r2) ? 'exec'
    : /\b(head|director|direktor|direttore|direttrice|leiter|leiterin|bereichsleiter|abteilungsleiter|responsabile|responsable|directeur|directrice)\b/.test(r2) ? 'head'
    : /\b(lead|team ?lead(er)?|teamleiter|teamleiterin|manager|managerin|capo team|chef d'equipe)\b/.test(r2) ? 'lead'
    : /\b(engineer|specialist|analyst|consultant|architect|developer|spezialist|specialista|ingegnere|expert|officer|sachbearbeiter|associate)\b/.test(r2) ? 'ic' : '';

  // viaggi
  const tv = t.match(/\b(\d{1,2})\s*%\s*(?:of\s+)?(?:travel|reise|viaggi|trasferte|deplacements)/) || t.match(/\b(?:travel|reisetatigkeit|reisebereitschaft|trasferte|viaggi|deplacements)\D{0,30}(\d{1,2})\s*%/);
  if (tv) out.travel = Number(tv[1]);
  else if (/\b(no travel|keine reisetatigkeit|nessuna trasferta)\b/.test(t)) out.travel = 0;

  // permesso di lavoro e sponsorizzazione
  if (/\b(visa sponsorship (is )?(available|provided|offered)|we (can|will) sponsor|sponsorship available|relocation and visa support)\b/.test(t)) out.sponsor = true;
  if (/\b(no (visa )?sponsorship|unable to sponsor|cannot sponsor|without sponsorship|must (already )?have (the )?right to work|valid work permit required|arbeitsbewilligung (ist )?(erforderlich|vorausgesetzt)|permesso di lavoro valido)\b/.test(t)) out.sponsor = false;

  // inizio
  const sd = String(jp.jobStartDate || '').match(/^\d{4}-\d{2}-\d{2}/);
  if (sd) out.start = sd[0];
  else if (/\b(ab sofort|per sofort|immediately|asap|as soon as possible|da subito|dal piu presto|des que possible|immediate start)\b/.test(t)) out.start = 'asap';

  out.industry = [jp.industry, name(jp.hiringOrganization), f?.company].filter(Boolean).join(' ');
  return out;
}

const row = (id, job, result, note = '') => ({ id, label: LABELS[id], job, result, note });

/** Righe del confronto per le sole preferenze impostate. today: AAAA-MM-GG (per «Inizio»). */
export function compare(prefs, facts, today = new Date().toISOString().slice(0, 10)) {
  const p = prefs || {}, j = facts || {};
  const out = [];
  const must = p.must || {};

  // luogo
  if (p.home_city || (p.places || []).length || p.relocate || (p.countries || []).length) {
    const where = [j.city, j.country].filter(Boolean).join(', ');
    const mine = [p.home_city, ...(p.places || [])].filter(Boolean).map(words);
    const theirs = j.places.map(words).join(' | ');
    const near = mine.some(m => m && new RegExp(`(^|[ |])${m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[ |])`).test(theirs));
    const fullRemote = j.modes.length === 1 && j.modes[0] === 'remote';
    const inCountry = j.country && (j.country === p.home_cc || (p.countries || []).includes(j.country));
    if (near) out.push(row('loc', where, 'ok', 'tra i tuoi luoghi'));
    else if (fullRemote && (p.modes || []).includes('remote')) out.push(row('loc', where || 'da remoto', 'ok', 'lavoro da remoto'));
    else if (p.relocate === 'any') out.push(row('loc', where || 'non indicato', 'ok', 'disposto a trasferirti'));
    else if (!where) out.push(row('loc', 'non indicato', 'unknown'));
    else if (p.relocate === 'country') out.push(row('loc', where, inCountry ? 'ok' : j.country ? 'no' : 'unknown', inCountry ? 'nei paesi indicati' : 'fuori dai paesi indicati'));
    else if (j.country && p.home_cc && !inCountry) out.push(row('loc', where, 'no', 'in un altro paese'));
    else out.push(row('loc', where, 'unknown', 'non tra i luoghi indicati: verifica la distanza'));
  }

  // modalità
  if ((p.modes || []).length) {
    const job = j.modes.map(m => MODE[m]).join(', ') || 'non indicata';
    const days = j.remoteDays !== undefined ? `, ${j.remoteDays} ${j.remoteDays === 1 ? 'giorno' : 'giorni'} da remoto` : '';
    const ok = j.modes.some(m => p.modes.includes(m));
    // ibrido accettato ma con meno giorni da remoto del minimo, se c'è solo l'ibrido tra le modalità accettate
    const tooFewDays = ok && p.remote_min && j.remoteDays !== undefined && j.remoteDays < p.remote_min
      && !j.modes.some(m => m !== 'hybrid' && p.modes.includes(m));
    if (!j.modes.length) out.push(row('mode', job, 'unknown'));
    else if (tooFewDays) out.push(row('mode', job + days, 'no', `ne vuoi almeno ${p.remote_min}`));
    else out.push(row('mode', job + days, ok ? 'ok' : 'no'));
  }

  // stipendio
  if (p.sal_min) {
    const s = j.salary;
    const fmt = n => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '’');      // 140’000 ovunque, senza dipendere dalla lingua del browser
    if (!s) out.push(row('sal', 'non indicato', 'unknown'));
    else {
      const job = `${s.cur} ${fmt(s.min)}${s.max > s.min ? '–' + fmt(s.max) : ''}`;
      if (p.sal_cur && s.cur && p.sal_cur !== s.cur) out.push(row('sal', job, 'unknown', `valuta diversa (${p.sal_cur})`));
      else out.push(row('sal', job, s.max >= p.sal_min ? 'ok' : 'no', s.max >= p.sal_min ? (s.min < p.sal_min ? 'il minimo è sotto il tuo' : '') : `sotto il tuo minimo (${fmt(p.sal_min)})`));
    }
  }

  // occupazione
  if (p.pen_min || p.pen_max) {
    const lo = p.pen_min || 1, hi = p.pen_max || 100, x = j.pensum;
    if (!x) out.push(row('pen', 'non indicata', 'unknown'));
    else out.push(row('pen', x.min === x.max ? `${x.min}%` : `${x.min}–${x.max}%`, x.max >= lo && x.min <= hi ? 'ok' : 'no', `tu: ${lo === hi ? lo : lo + '–' + hi}%`));
  }

  // contratto
  if ((p.contracts || []).length) {
    if (!j.contracts.length) out.push(row('con', 'non indicato', 'unknown'));
    else out.push(row('con', j.contracts.map(c => CON[c]).join(', '), j.contracts.some(c => p.contracts.includes(c)) ? 'ok' : 'no'));
  }

  // livello
  if ((p.levels || []).length) {
    if (!j.level) out.push(row('lvl', 'non riconosciuto dal titolo', 'unknown'));
    else out.push(row('lvl', LVL[j.level], p.levels.includes(j.level) ? 'ok' : 'no'));
  }

  // viaggi
  if (p.travel_max !== undefined && p.travel_max !== null) {
    if (j.travel === undefined) out.push(row('trv', 'non indicati', 'unknown'));
    else out.push(row('trv', `${j.travel}%`, j.travel <= p.travel_max ? 'ok' : 'no', `al massimo ${p.travel_max}%`));
  }

  // permesso di lavoro
  if ((p.work_ok || []).length) {
    if (!j.country) out.push(row('spo', 'paese non indicato', 'unknown'));
    else if (p.work_ok.includes(j.country)) out.push(row('spo', j.country, 'ok', 'puoi lavorarci senza permesso'));
    else out.push(row('spo', j.country, j.sponsor === true ? 'ok' : j.sponsor === false ? 'no' : 'unknown', j.sponsor === true ? 'sponsorizzazione offerta' : j.sponsor === false ? 'serve già il permesso' : 'serve un permesso: l\'annuncio non dice se lo sponsorizzano'));
  }

  // inizio
  if (p.start) {
    if (!j.start) out.push(row('sta', 'non indicato', 'unknown'));
    else if (j.start === 'asap') {
      const soon = new Date(Date.parse(today) + 45 * 864e5).toISOString().slice(0, 10);
      out.push(row('sta', 'da subito', p.start <= soon ? 'ok' : 'unknown', p.start <= soon ? '' : `tu sei disponibile dal ${p.start}`));
    } else out.push(row('sta', j.start, j.start >= p.start ? 'ok' : 'no', `tu sei disponibile dal ${p.start}`));
  }

  // settori da evitare
  if ((p.avoid || []).length) {
    const hay = ' ' + words(j.industry + ' ' + j.text) + ' ';
    const hit = p.avoid.filter(a => words(a) && hay.includes(' ' + words(a) + ' '));
    out.push(row('sec', hit.length ? 'trovato: ' + hit.join(', ') : 'nessuno trovato', hit.length ? 'no' : 'ok'));
  }

  for (const r of out) r.must = must[r.id] === true;
  return out;
}
