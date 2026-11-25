/* Preferenze di lavoro dell'utente: documento cifrato di tipo «prefs» (uno per account, application_id null, AAD jd1:doc, JSON UTF-8).
 * Schema «Preferences» di https://jobdossiers.ch/openapi.json (1.2.0). Qui solo lettura: l'agente non le sostituisce né le cancella (403 agent_scope).
 * Ogni campo è facoltativo; vuoto o null = non impostato, e allora non compare nell'uscita. Valori fuori schema scartati. */

export const PREFS_KIND = 'prefs';
export const RELOCATE = ['no', 'country', 'any'];
export const MODES = ['onsite', 'hybrid', 'remote'];
export const CONTRACTS = ['permanent', 'fixed', 'freelance', 'interim', 'internship'];
export const LEVELS = ['ic', 'lead', 'head', 'exec'];
export const MUST = ['loc', 'com', 'mode', 'sal', 'pen', 'con', 'lvl', 'trv', 'spo', 'sta', 'sec'];

const CC = /^[A-Z]{2}$/;
const TEXT_MAX = 100;

const text = (v, max = TEXT_MAX) => (typeof v === 'string' && v.trim() && v.trim().length <= max ? v.trim() : undefined);
const match = (v, re) => (typeof v === 'string' && re.test(v) ? v : undefined);
const oneOf = (v, list) => (list.includes(v) ? v : undefined);
const int = (v, min, max = Infinity) => (Number.isInteger(v) && v >= min && v <= max ? v : undefined);
const list = (v, keep, max = Infinity) => {
  if (!Array.isArray(v)) return undefined;
  const out = [...new Set(v.map(keep).filter(x => x !== undefined))].slice(0, max);
  return out.length ? out : undefined;
};

/** Ritorna { prefs, dropped }: prefs con i soli campi impostati e validi, dropped con i NOMI dei campi presenti ma scartati (mai i valori). */
export function cleanPrefs(raw) {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const p = {
    v: r.v === 1 ? 1 : undefined,
    home_city: text(r.home_city),
    home_cc: match(r.home_cc, CC),
    relocate: oneOf(r.relocate, RELOCATE),
    commute_max: int(r.commute_max, 5, 240),          // minuti di tragitto casa-lavoro (portale, 25.11.2026)
    places: list(r.places, x => text(x), 30),
    countries: list(r.countries, x => match(x, CC)),
    modes: list(r.modes, x => oneOf(x, MODES)),
    remote_min: int(r.remote_min, 1, 5),
    sal_min: int(r.sal_min, 1),
    sal_cur: match(r.sal_cur, /^[A-Z]{3}$/),
    pen_min: int(r.pen_min, 1, 100),
    pen_max: int(r.pen_max, 1, 100),
    contracts: list(r.contracts, x => oneOf(x, CONTRACTS)),
    levels: list(r.levels, x => oneOf(x, LEVELS)),
    travel_max: int(r.travel_max, 0, 100),
    work_ok: list(r.work_ok, x => match(x, CC)),
    start: match(r.start, /^\d{4}-\d{2}-\d{2}$/),
    avoid: list(r.avoid, x => text(x), 30),
  };
  // pen_max non è mai sotto pen_min (schema)
  if (p.pen_min !== undefined && p.pen_max !== undefined && p.pen_max < p.pen_min) p.pen_max = undefined;
  if (r.must && typeof r.must === 'object' && !Array.isArray(r.must)) {
    const keys = MUST.filter(k => r.must[k] === true);
    if (keys.length) p.must = Object.fromEntries(keys.map(k => [k, true]));
  }
  const prefs = Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined));
  const empty = v => v === null || v === '' || (Array.isArray(v) && !v.length) || (v && typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length);
  const dropped = Object.keys(r).filter(k => !(k in prefs) && !empty(r[k]));
  if (r.must && typeof r.must === 'object' && !Array.isArray(r.must)) for (const k of Object.keys(r.must)) if (!(MUST.includes(k) && r.must[k] === true)) dropped.push('must.' + k);
  return { prefs, dropped: [...new Set(dropped)] };
}
