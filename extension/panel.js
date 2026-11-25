/* Pannello laterale dell'estensione: legge la scheda attiva, mostra i campi trovati e li salva con il server locale.
 * Lettura: dopo il clic sull'icona o Alt+Shift+J (permesso temporaneo activeTab su quella pagina), oppure a ogni cambio di pagina
 * se l'utente ha concesso il permesso facoltativo sui siti («Leggi automaticamente»). Senza accesso il pannello lo dice e non mostra dati vecchi.
 * Il server (jobdossiers-mcp, registrato come host di native messaging «ch.jobdossiers.mcp») controlla i doppioni, cifra e invia: qui non c'è nessuna chiave.
 * I dati della pagina finiscono solo in campi di testo (value, textContent), mai in HTML. */
import { fields, jobDates } from './parse.js';
import { searchUrls } from './search.js';
import { grab } from './grab.js';
import { detectJob } from './detect.js';
import { jobFacts, compare, commuteRow, careerRow, skillsRow, languagesRow } from './match.js';
import { travelPair, formatTrip, osmLink, makeTravel, TRANSIT_CC } from './travel.js';

const HOST = 'ch.jobdossiers.mcp';
const $ = s => document.querySelector(s);
const form = $('#f');
let seq = 0;

const htmlToText = html => new DOMParser().parseFromString(String(html), 'text/html').body.innerText || '';

/** Un messaggio al server locale. Gli errori del browser diventano frasi utili. */
function native(action, args = {}) {
  return new Promise(resolve => {
    chrome.runtime.sendNativeMessage(HOST, { id: ++seq, action, args }, res => {
      const e = chrome.runtime.lastError?.message;
      if (!e) return resolve(res || { ok: false, error: 'empty', message: 'Nessuna risposta dal server locale' });
      if (/not found/i.test(e)) return resolve({ ok: false, error: 'no_host', message: "L'app Jobdossiers non è collegata a questo browser: installala, poi esegui «jobdossiers-mcp --browser-install» (o il pulsante nell'app)." });
      if (/forbidden/i.test(e)) return resolve({ ok: false, error: 'forbidden', message: 'Il server locale non riconosce questa estensione (ID diverso).' });
      resolve({ ok: false, error: 'native', message: 'Server locale non raggiungibile: ' + e });
    });
  });
}

function show(text, kind = '') {
  const m = $('#msg');
  m.hidden = !text; m.textContent = text || ''; m.className = 'msg ' + kind;
}

function values() {
  const v = Object.fromEntries(new FormData(form).entries());
  for (const k of Object.keys(v)) v[k] = v[k].trim();
  v.employer_country = v.employer_country.toUpperCase();
  return v;
}

async function checkDuplicates() {
  const v = values();
  const box = $('#dups');
  if (!v.job_url && !(v.company && v.role)) { box.hidden = true; return []; }
  const r = await native('find_duplicates', { company: v.company || undefined, role: v.role || undefined, urls: v.job_url ? [v.job_url] : [], text: v.job_url || undefined });
  const list = r.ok ? r.result.duplicates || [] : [];
  box.replaceChildren();
  if (!r.ok) { box.hidden = true; return []; }
  if (list.length) {
    const h = document.createElement('strong'); h.textContent = 'Già in Jobdossiers:';
    const ul = document.createElement('ul');
    for (const d of list.slice(0, 5)) {
      const li = document.createElement('li');
      li.textContent = `${d.company} – ${d.role} (${d.status}; ${d.reason.replace('platform_id', 'stesso annuncio').replace('company_role', 'stessa impresa e ruolo').replace('url', 'stesso indirizzo')})`;
      if (people.length && d.id) {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'addc'; b.textContent = 'Aggiungi i contatti spuntati a questa candidatura';
        b.addEventListener('click', async () => { b.disabled = true; const m = await addPeople(d.id); show((m || ' Nessun contatto spuntato.').trim(), /non sono stati/.test(m) || !m ? 'warn' : 'ok'); b.disabled = false; });
        const div = document.createElement('div'); div.append(b); li.append(div);
      }
      ul.append(li);
    }
    box.append(h, ul);
  }
  box.hidden = !list.length;
  $('#save').disabled = list.length > 0;
  if (list.length && list[0].id) showRemind(list[0].id);
  return list;
}

let timer = null, netTimer = null;
form.addEventListener('input', e => {
  renderMatch();
  if (e.target.name === 'company') { clearTimeout(netTimer); netTimer = setTimeout(renderNetwork, 700); }
  if (!['company', 'role', 'job_url'].includes(e.target.name)) return;
  clearTimeout(timer); timer = setTimeout(checkDuplicates, 600);
});

form.addEventListener('submit', async e => {
  e.preventDefault();
  const btn = $('#save');
  btn.disabled = true; btn.textContent = 'Salvataggio…';
  const v = values();
  const when = [dates.posted ? `pubblicato ${dates.postedApprox ? 'circa ' : ''}il ${dmy(dates.posted)}` : '', dates.deadline ? `candidature entro il ${dmy(dates.deadline)}` : ''].filter(Boolean).join(', ');
  const args = { company: v.company, role: v.role, job_url: v.job_url, note: `Salvata dal browser con l'estensione Jobdossiers${when ? ` (${when})` : ''}` };
  for (const k of ['employer_zip_city', 'employer_country', 'job_desc']) if (v[k]) args[k] = v[k];
  const r = await native('create', args);
  if (r.ok) {
    const extra = await addPeople(r.result.id);
    form.hidden = true; showRemind(r.result.id);
    show(`Salvata in Jobdossiers (in preparazione). La trovi nella lista delle candidature.${extra}`, 'ok');
  } else {
    show(r.error === 'duplicate' ? 'Esiste già: ' + r.message : (r.message || r.error), 'err');
    btn.disabled = false; btn.textContent = 'Salva in Jobdossiers';
  }
});

const SITES = { origins: ['http://*/*', 'https://*/*'] };
let reading = 0;
let connected = false;
let autoOn = false;
let prefs = null, profile = null;          // preferenze di lavoro (jd_preferences), lette una volta: null = non salvate o non leggibili
let lastRaw = null;

/** Preferenze dall'app (sola lettura). Restano in memoria nel pannello, non vengono salvate dall'estensione. */
async function loadPrefs() {
  const r = await native('preferences');
  prefs = r.ok && r.result.saved ? r.result.preferences : null;
  // profilo (solo titolo ed esperienze) per la riga «Carriera»; con un'app più vecchia non c'è e la riga manca
  const p = await native('profile', { sections: ['headline', 'experience', 'skills', 'certifications', 'languages'] });
  profile = p.ok && p.result.saved ? p.result.profile : null;
}

/** Tabella del confronto annuncio–preferenze; i testi entrano solo come textContent. */
function renderMatch() {
  const box = $('#match'), body = $('#match-rows');
  body.replaceChildren();
  $('#noprefs').hidden = !connected || !!prefs || !lastRaw;
  if ((!prefs && !profile) || !lastRaw) { box.hidden = true; return; }
  const v = values(), facts = jobFacts(lastRaw, v);
  const rows = prefs ? compare(prefs, facts) : [];
  const pair = travelPair(prefs, { ...facts, zipCity: v.employer_zip_city, country: v.employer_country || facts.country });
  renderTrip(pair);
  const com = commuteRow(prefs, tripState(pair));
  if (com) rows.splice(rows.findIndex(r => r.id === 'loc') + 1, 0, com);
  // dal profilo: carriera, competenze e lingue (dopo «Livello», o in fondo)
  const fromProfile = [careerRow(profile, facts), skillsRow(profile, facts), languagesRow(profile, facts)].filter(Boolean);
  if (fromProfile.length) rows.splice(Math.max(0, rows.findIndex(r => r.id === 'lvl') + 1) || rows.length, 0, ...fromProfile);
  const sign = { ok: '✓', no: '✗', unknown: '?', same: '=', part: '≈' };
  for (const r of rows) {
    const tr = document.createElement('tr'); tr.className = r.result;
    const a = document.createElement('td'); a.className = 'r'; a.textContent = sign[r.result];
    const b = document.createElement('td'); b.textContent = r.label;
    if (r.must) { const m = document.createElement('div'); m.className = 'must'; m.textContent = 'obbligatorio'; b.append(m); }
    const c = document.createElement('td'); c.textContent = r.job;
    if (r.note) { const n = document.createElement('div'); n.className = 'note'; n.textContent = r.note; c.append(n); }
    if (r.id === 'loc') for (const line of tripNote(pair) || []) { const n = document.createElement('div'); n.className = 'note trip-time'; n.append(...[].concat(line)); c.append(n); }
    tr.append(a, b, c); body.append(tr);
  }
  box.hidden = !rows.length;
}

// ── Tempo di percorrenza (auto con OpenStreetMap, mezzi pubblici in Svizzera con transport.opendata.ch) ──
// Automatico quando il luogo è nel paese di residenza; si può spegnere. Ai servizi vanno solo le due località.
const TRIP_OFF = 'viaggio-spento';
const store = {
  get: async k => { try { return (await chrome.storage.local.get(k))[k]; } catch { return undefined; } },
  set: async (k, v) => { try { await chrome.storage.local.set({ [k]: v }); } catch { /* memoria non disponibile */ } },
};
const travel = makeTravel({ cache: store });
let tripKey = '', tripDone = null;              // tripDone: { key, car, pt } dell'ultimo calcolo finito
const pairKey = pair => `${pair.home}|${pair.job}|${pair.cc}`;
const tripOn = () => ls.get(TRIP_OFF) !== '1';
const tripBest = t => [t?.car, t?.pt].filter(x => x && !x.error).map(x => x.seconds).sort((a, b) => a - b)[0] || 0;
function tripState(pair) {
  if (!pair) return null;
  if (!tripOn()) return { ask: true };
  return tripDone && tripDone.key === pairKey(pair) ? { seconds: tripBest(tripDone) } : { pending: true };
}
/** Righe con il tempo di percorrenza, per la riga «Luogo» della tabella (testo e collegamento alla mappa). */
function tripNote(pair) {
  if (!pair || !tripOn()) return null;
  const t = tripDone && tripDone.key === pairKey(pair) ? tripDone : null;
  if (!t) return [`Da ${pair.home}: calcolo del tempo di percorrenza…`];
  const out = [];
  if (t.car && !t.car.error) {
    const a = document.createElement('a'); a.href = osmLink(t.car.from, t.car.to); a.target = '_blank'; a.rel = 'noopener'; a.textContent = 'mappa';
    out.push([`Da ${pair.home} in auto: ${formatTrip(t.car)} (`, a, ')']);
  } else out.push([`In auto: ${t.car?.error === 'home' ? `«${pair.home}» non trovato` : t.car?.error === 'job' ? `«${pair.job}» non trovato` : 'non disponibile ora'}`]);
  if (TRANSIT_CC.has(pair.cc)) out.push([t.pt && !t.pt.error ? `Con i mezzi pubblici: ${formatTrip(t.pt)} (${t.pt.from} → ${t.pt.to})` : 'Con i mezzi pubblici: collegamento non trovato']);
  return out;
}
async function renderTrip(pair) {
  $('#trip').hidden = !pair;
  $('#trip-on').hidden = !tripOn(); $('#trip-off').hidden = tripOn();
  if (!pair || !tripOn()) { tripKey = ''; return; }
  $('#trip-pt').hidden = pair.cc !== 'CH';
  const key = pairKey(pair);
  if (key === tripKey) return;                           // già calcolato (o in corso) per queste due località
  tripKey = key;
  const safe = p => p.catch(() => ({ error: 'net' }));
  const [car, pt] = await Promise.all([safe(travel.car(pair)), TRANSIT_CC.has(pair.cc) ? safe(travel.transit(pair)) : null]);
  if (tripKey !== key) return;                           // nel frattempo è cambiato l'annuncio
  tripDone = { key, car, pt };
  if (car.error === 'net' || pt?.error === 'net') tripKey = '';     // errore di rete: si riprova al prossimo aggiornamento
  else renderMatch();                                   // riga «Luogo» e «Tragitto casa-lavoro» con i tempi
}
$('#trip-stop').addEventListener('click', () => { ls.set(TRIP_OFF, '1'); tripKey = ''; renderMatch(); });
$('#trip-start').addEventListener('click', () => { ls.set(TRIP_OFF, ''); tripKey = ''; renderMatch(); });

// ── Ricerche sui portali con le preferenze (si aprono in schede nuove; l'estensione non legge né salva nulla da sola) ──
const S_KW = 'ricerca-parole';
function renderSearch() {
  $('#search').hidden = !connected || (!prefs && !profile);
  if ($('#search').hidden) return;
  const cur = (profile?.experience || []).find(x => x?.end === 'present' && x.title) || (profile?.experience || [])[0];
  if (!$('#s-kw').value) $('#s-kw').value = ls.get(S_KW) || profile?.headline || cur?.title || '';
  if (!$('#s-loc').value) $('#s-loc').value = prefs?.home_city || '';
  if (!$('#s-cc').value) $('#s-cc').value = prefs?.home_cc || '';
  updateSearchLinks();
}
function updateSearchLinks() {
  const links = searchUrls({ keywords: $('#s-kw').value, location: $('#s-loc').value, cc: $('#s-cc').value.toUpperCase(), modes: prefs?.modes || [], recent: $('#s-recent').checked });
  $('#s-links').replaceChildren(...links.map(l => { const b = document.createElement('button'); b.type = 'button'; b.className = 'chip'; b.textContent = l.name;
    b.addEventListener('click', () => chrome.tabs.create({ url: l.url })); return b; }));
}
for (const id of ['#s-kw', '#s-loc', '#s-cc', '#s-recent']) $(id).addEventListener('input', () => { if (id === '#s-kw') ls.set(S_KW, $('#s-kw').value.trim()); updateSearchLinks(); });

// ── Date dell'annuncio e promemoria in agenda ──
let dates = { posted: '', postedApprox: false, deadline: '' }, remindApp = '';
const dmy = d => d.split('-').reverse().join('.');
const daysFrom = d => Math.round((Date.parse(d + 'T00:00:00Z') - Date.parse(new Date().toISOString().slice(0, 10) + 'T00:00:00Z')) / 864e5);
const plusDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
function renderDates() {
  const parts = [];
  if (dates.posted) { const n = -daysFrom(dates.posted); parts.push(`Pubblicato ${dates.postedApprox ? 'circa ' : ''}${n <= 0 ? 'oggi' : n === 1 ? 'ieri' : `${n} giorni fa`} (${dmy(dates.posted)})`); }
  if (dates.deadline) { const n = daysFrom(dates.deadline); parts.push(n < 0 ? `Candidature chiuse il ${dmy(dates.deadline)}` : `Candidature entro il ${dmy(dates.deadline)} (${n === 0 ? 'oggi' : n === 1 ? 'domani' : `tra ${n} giorni`})`); }
  $('#dates').textContent = parts.join(' · '); $('#dates').hidden = !parts.length;
}
function showRemind(appId) {
  remindApp = appId || '';
  $('#remind').hidden = !remindApp || !connected;
  $('#remind-dl').hidden = !(dates.deadline && daysFrom(dates.deadline) >= 0);
  $('#remind-dl').textContent = dates.deadline && daysFrom(dates.deadline) >= 2 ? '2 giorni prima della scadenza' : 'il giorno della scadenza';
}
async function remind(kind) {
  const v = values(), what = [v.role, v.company].filter(Boolean).join(' – ') || 'annuncio';
  const today = new Date().toISOString().slice(0, 10);
  const day = kind === '7' ? plusDays(today, 7) : daysFrom(dates.deadline) >= 2 ? plusDays(dates.deadline, -2) : dates.deadline;
  const title = kind === '7' ? `Ricontrolla: ${what}` : `Scadenza ${dmy(dates.deadline)}: ${what}`;
  const r = await native('reminder', { title: title.slice(0, 200), at: `${day}T09:00`, app: remindApp, note: v.job_url || '' });
  show(r.ok ? `Promemoria in agenda per il ${dmy(day)} alle 9:00.` : r.error === 'unknown_action' ? 'Per i promemoria serve l\'app Jobdossiers aggiornata.' : `Promemoria non salvato (${r.message || r.error}).`, r.ok ? 'ok' : 'warn');
}
$('#remind-7').addEventListener('click', () => remind('7'));
$('#remind-dl').addEventListener('click', () => remind('dl'));

// ── Persone della Rete nell'impresa dell'annuncio (lette dall'app, solo nome, tipo e ruolo) ──
const KIND = { recruiter: 'recruiter', colleague: 'ex collega', insider: 'referente interno', mentor: 'mentore', other: 'contatto' };
let netFor = '';
const STATUS = { preparing: 'in preparazione', to_send: 'da inviare', sent: 'inviata', in_review: 'in valutazione', interview: 'colloquio', offer: 'offerta', rejected: 'rifiutata', withdrawn: 'ritirata', no_answer: 'nessuna risposta' };
async function renderHistory(company) {
  const r = await native('history', { company });
  if (netFor !== company) return;
  const apps = r.ok ? r.result.applications || [] : [];
  $('#history-list').replaceChildren(...apps.map(a => { const li = document.createElement('li'); const d = a.changed_on || a.applied_on; li.textContent = [a.role || '(ruolo non indicato)', STATUS[a.status] || a.status, d ? d.split('-').reverse().join('.') : ''].filter(Boolean).join(' · '); return li; }));
  $('#history').hidden = !apps.length;
}
async function renderNetwork() {
  const company = values().company || '', box = $('#netco'), list = $('#netco-list');
  if (!connected || company.length < 3) { box.hidden = true; $('#history').hidden = true; netFor = ''; return; }
  if (company === netFor) return;
  netFor = company;
  renderHistory(company);
  const r = await native('network', { company });
  if (netFor !== company) return;                       // nel frattempo è cambiata l'impresa
  const people = r.ok ? r.result.people || [] : [];
  list.replaceChildren(...people.map(p => { const li = document.createElement('li'); li.textContent = [p.name, KIND[p.kind] || '', p.role].filter(Boolean).join(' · '); return li; }));
  box.hidden = !people.length;
}

// ── Contatti dell'annuncio (LinkedIn, «Meet the hiring team») → Rete e candidatura ──
let people = [];
function renderPeople(list) {
  people = Array.isArray(list) ? list : [];
  const box = $('#people-list'); box.replaceChildren();
  for (const [i, p] of people.entries()) {
    const row = document.createElement('label'); row.className = 'people-row';
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = true; cb.dataset.i = String(i);
    const t = document.createElement('span');
    const b = document.createElement('strong'); b.textContent = p.name;
    const r = document.createElement('div'); r.className = 'muted'; r.textContent = [p.poster ? 'ha pubblicato l\'annuncio' : '', p.role].filter(Boolean).join(' · ');
    t.append(b, r); row.append(cb, t); box.append(row);
  }
  $('#people').hidden = !people.length || !connected;
}
const chosenPeople = () => [...document.querySelectorAll('#people-list input:checked')].map(cb => people[Number(cb.dataset.i)]).filter(Boolean);
async function addPeople(appId) {
  const list = chosenPeople(); if (!list.length) return '';
  const r = await native('contacts', { app_id: appId, people: list });
  if (!r.ok) return r.error === 'unknown_action' ? ' I contatti non sono stati aggiunti: aggiorna l\'app Jobdossiers.' : ` I contatti non sono stati aggiunti (${r.message || r.error}).`;
  const { created, linked, already } = r.result;
  return ` Contatti: ${linked} collegati alla candidatura${created ? `, ${created} nuovi nella Rete` : ''}${already.length ? `; già collegati: ${already.join(', ')}` : ''}.`;
}

/** Stato del collegamento con l'app (una volta all'apertura del pannello). */
async function connect() {
  const s = await native('status');
  connected = s.ok;
  $('#conn').textContent = s.ok ? `collegato · ${s.result.applications} candidature` : 'non collegato';
  if (!s.ok) show(s.message || s.error, 'err');
  return s.ok;
}

async function autoState() {
  autoOn = await chrome.permissions.contains(SITES);
  $('#auto').textContent = autoOn ? 'Lettura automatica attiva: disattiva' : 'Leggi automaticamente ogni pagina';
  return autoOn;
}

function noAccess(text, { askAuto = false } = {}) {
  form.hidden = true;
  lastRaw = null; renderMatch();
  $('#dups').hidden = true;
  $('#notjob').hidden = true;
  show(text, 'info');
  $('#auto-hint').hidden = !askAuto || autoOn;
}

let override = '';
let lastDiag = null;        // ultima lettura, per «Copia diagnostica»          // pagina che l'utente ha deciso di usare anche se non sembra un annuncio

/** Verifica la scheda attiva (è un annuncio?) e solo allora ne estrae i campi. Solo l'ultima lettura avviata aggiorna il pannello.
 *  attempt: nuovi tentativi mentre la pagina carica ancora i contenuti (siti che si compongono dopo il caricamento, come LinkedIn). */
async function read(attempt = 0) {
  const mine = ++reading;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  let raw;
  try { [{ result: raw }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: grab }); }
  catch {
    if (mine !== reading) return;
    if (tab.url && !/^https?:/i.test(tab.url)) return noAccess('Apri la pagina di un annuncio.');
    return noAccess("Per leggere questa pagina premi l'icona Jobdossiers nella barra degli strumenti (o Alt+Shift+J).", { askAuto: true });
  }
  if (mine !== reading || !raw) return;
  const check = detectJob(raw);
  lastDiag = { check, raw };
  if (check.kind !== 'job' && check.kind !== 'probable' && raw.url !== override) {
    if (attempt < 2) { setTimeout(() => { if (mine === reading) read(attempt + 1); }, 1200); }      // il contenuto può arrivare dopo
    form.hidden = true; lastRaw = null; renderMatch(); renderPeople([]); showRemind(''); $('#dates').hidden = true; $('#dups').hidden = true; $('#auto-hint').hidden = true;
    show(check.kind === 'list' ? 'Questa pagina è un elenco di annunci: apri un annuncio per salvarlo.'
      : check.kind === 'blocked' ? 'Il sito mostra una pagina di verifica («sei una persona?»): completala, poi premi di nuovo l\'icona.'
      : 'Questa pagina non sembra un annuncio di lavoro.', 'warn');
    $('#notjob').hidden = false;
    return;
  }
  $('#notjob').hidden = true; $('#auto-hint').hidden = true;
  lastRaw = raw;
  const f = fields(raw, htmlToText);
  form.reset();
  for (const [k, v] of Object.entries(f)) if (form.elements[k]) form.elements[k].value = v;
  $('#src').textContent = f.job_desc ? `(${f.source}, ${f.job_desc.length} caratteri)` : '';
  $('#src-role').textContent = f.sources.role ? `(${f.sources.role})` : '(non trovato)';
  $('#src-company').textContent = f.sources.company ? `(${f.sources.company})` : '(non trovata)';
  const btn = $('#save');
  btn.textContent = 'Salva in Jobdossiers'; btn.disabled = !connected;
  form.hidden = false;
  renderMatch();
  renderPeople(raw.people);
  renderNetwork();
  dates = jobDates(raw); renderDates(); showRemind('');
  const note = check.kind === 'probable' ? `Sembra un annuncio (${check.reason}): controlla i campi.` : raw.url === override && check.kind !== 'job' ? 'Pagina usata come annuncio su tua scelta: controlla i campi.' : '';
  if (connected) { show(note, note ? 'warn' : ''); await checkDuplicates(); }
  // le pagine che si compongono dopo il caricamento: se manca ancora il titolo, si riprova
  if (!f.role && attempt < 2) setTimeout(() => { if (mine === reading) read(attempt + 1); }, 1200);
}

/** Solo ciò che il pannello ha letto dal riquadro dell'annuncio: niente parametri dell'indirizzo, niente dati del browser o dell'account. */
$('#diag').addEventListener('click', async () => {
  if (!lastDiag) return show('Niente da copiare: premi prima l\'icona su un annuncio.', 'info');
  const { check, raw } = lastDiag, f = fields(raw, htmlToText);
  let page = ''; try { const u = new URL(raw.url); page = u.host + u.pathname; } catch { /* indirizzo non valido */ }
  const d = {
    estensione: $('#ver').textContent, pagina: page, verifica: check,
    campi: { role: f.role, company: f.company, luogo: f.employer_zip_city, paese: f.employer_country, fonti: f.sources, testo: f.job_desc.slice(0, 160), caratteri: f.job_desc.length },
    contatti: (raw.people || []).map(p => ({ nome: p.name, ruolo: p.role, pubblica: p.poster, profilo: !!p.link })),
    riquadro: raw.top ? { title: raw.top.title, company: raw.top.company, location: raw.top.location, etichette: raw.top.tags, righe: raw.top.lines } : null,
    dati_strutturati: (raw.ld || []).length, sezione_about: (raw.about || '').length, blocco: (raw.best || '').length,
  };
  try { await navigator.clipboard.writeText(JSON.stringify(d, null, 2)); show('Diagnostica copiata negli appunti: incollala nella chat.', 'ok'); }
  catch { show('Copia non riuscita: il browser non ha dato accesso agli appunti.', 'err'); }
});

$('#use-anyway').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  override = tab?.url || ''; read();
});
$('#auto-hint-btn').addEventListener('click', () => $('#auto').click());

$('#reread').addEventListener('click', () => read());
$('#auto').addEventListener('click', async () => {
  // permissions.request vuole il gesto dell'utente: va chiamato subito, senza await prima
  const req = autoOn ? chrome.permissions.remove(SITES) : chrome.permissions.request(SITES);
  await req.catch(() => false);
  if (await autoState()) read();
});

// clic sull'icona o scorciatoia con il pannello già aperto (background.js)
chrome.runtime.onMessage.addListener(m => { if (m?.type === 'leggi') read(); });
// cambio di scheda o pagina: si legge se c'è il permesso; altrimenti il pannello lo dice
chrome.tabs.onActivated.addListener(() => read());
// ogni caricamento, e ogni cambio di indirizzo senza ricaricare (LinkedIn e altri siti che cambiano annuncio nella stessa pagina): nuova verifica
chrome.tabs.onUpdated.addListener((tabId, info, tab) => { if (tab.active && (info.status === 'complete' || info.url)) read(); });

const ls = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* memoria non disponibile */ } } };

// ── Aggiornamento online dell'estensione (background.js e src/update.js) ──
const UPD_REASON = {
  up_to_date: 'L\'estensione è già aggiornata.', no_bundle: 'Nessun aggiornamento online disponibile per ora.',
  app_too_old: 'C\'è un\'estensione più nuova, ma serve prima aggiornare l\'app Jobdossiers (pacchetto completo).',
  not_managed: 'Questa estensione non è nella cartella preparata dall\'app: aggiornala dall\'app (scheda Browser).',
};
async function updateUi() {
  const s = await chrome.storage.local.get({ autoUpdate: true, justUpdated: '' });
  $('#autoupd').checked = s.autoUpdate;
  if (s.justUpdated) { show(`Estensione aggiornata alla v${s.justUpdated}.`, 'ok'); await chrome.storage.local.set({ justUpdated: '' }); }
}
$('#autoupd').addEventListener('change', e => chrome.storage.local.set({ autoUpdate: e.target.checked }));
$('#updnow').addEventListener('click', async () => {
  const b = $('#updnow'); b.disabled = true; b.textContent = 'Controllo…';
  const r = await chrome.runtime.sendMessage({ type: 'update-check' }).catch(e => ({ ok: false, message: String(e?.message || e) }));
  b.disabled = false; b.textContent = 'Controlla aggiornamenti';
  if (r?.ok && r.result.updated) show(`Aggiornamento alla v${r.result.version}: l'estensione si ricarica…`, 'ok');
  else if (r?.ok) show(UPD_REASON[r.result.reason] || 'Nessun aggiornamento.', 'info');
  else show('Controllo non riuscito: ' + (r?.message || r?.error || 'errore'), 'err');
});

async function main() {
  updateUi().catch(() => {});
  $('#ver').textContent = 'v' + chrome.runtime.getManifest().version;      // la versione dell'estensione caricata nel browser
  // e la data di costruzione (build.json, scritto da build-app.sh e win/build.sh): con la stessa versione distingue le build locali
  Promise.resolve().then(() => fetch(chrome.runtime.getURL('build.json'))).then(r => r.json()).then(b => {
    const d = new Date(b.built_at);
    if (!isNaN(d)) $('#ver').textContent += ' · ' + d.toLocaleString('it-CH', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  }).catch(() => { $('#ver').textContent += ' · sviluppo'; });
  await autoState();
  if (await connect()) { await loadPrefs(); renderSearch(); }
  await read();
}

main();
