/* Pannello laterale dell'estensione: legge la scheda attiva, mostra i campi trovati e li salva con il server locale.
 * Lettura: dopo il clic sull'icona o Alt+Shift+J (permesso temporaneo activeTab su quella pagina), oppure a ogni cambio di pagina
 * se l'utente ha concesso il permesso facoltativo sui siti («Leggi automaticamente»). Senza accesso il pannello lo dice e non mostra dati vecchi.
 * Il server (jobdossiers-mcp, registrato come host di native messaging «ch.jobdossiers.mcp») controlla i doppioni, cifra e invia: qui non c'è nessuna chiave.
 * I dati della pagina finiscono solo in campi di testo (value, textContent), mai in HTML. */
import { fields } from './parse.js';
import { jobFacts, compare } from './match.js';

const HOST = 'ch.jobdossiers.mcp';
const $ = s => document.querySelector(s);
const form = $('#f');
let seq = 0;

/** Dati grezzi della pagina. Gira dentro la pagina: deve bastare a sé stessa. */
function grab() {
  const text = el => (el && el.innerText ? el.innerText : '').trim();
  const meta = n => document.querySelector(`meta[property="${n}"], meta[name="${n}"]`)?.content || '';
  const desc = document.querySelector('#job-details, .jobs-description__content, .description__text, [class*="job-description"], [data-testid*="description"]');
  const main = document.querySelector('main, article, [role="main"]') || document.body;
  return {
    url: location.href, title: document.title, h1: text(document.querySelector('h1')),
    og_title: meta('og:title'), og_site: meta('og:site_name'),
    ld: [...document.querySelectorAll('script[type="application/ld+json"]')].slice(0, 20).map(s => s.textContent.slice(0, 200000)),
    li_company: text(document.querySelector('.job-details-jobs-unified-top-card__company-name, .topcard__org-name-link')),
    selection: String(getSelection() || '').trim().slice(0, 100000),
    desc: text(desc).slice(0, 100000), main: text(main).slice(0, 100000),
  };
}

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
      ul.append(li);
    }
    box.append(h, ul);
  }
  box.hidden = !list.length;
  $('#save').disabled = list.length > 0;
  return list;
}

let timer = null;
form.addEventListener('input', e => {
  renderMatch();
  if (!['company', 'role', 'job_url'].includes(e.target.name)) return;
  clearTimeout(timer); timer = setTimeout(checkDuplicates, 600);
});

form.addEventListener('submit', async e => {
  e.preventDefault();
  const btn = $('#save');
  btn.disabled = true; btn.textContent = 'Salvataggio…';
  const v = values();
  const args = { company: v.company, role: v.role, job_url: v.job_url, note: "Salvata dal browser con l'estensione Jobdossiers" };
  for (const k of ['employer_zip_city', 'employer_country', 'job_desc']) if (v[k]) args[k] = v[k];
  const r = await native('create', args);
  if (r.ok) {
    form.hidden = true;
    show(`Salvata in Jobdossiers (in preparazione). La trovi nella lista delle candidature.`, 'ok');
  } else {
    show(r.error === 'duplicate' ? 'Esiste già: ' + r.message : (r.message || r.error), 'err');
    btn.disabled = false; btn.textContent = 'Salva in Jobdossiers';
  }
});

const SITES = { origins: ['http://*/*', 'https://*/*'] };
let reading = 0;
let connected = false;
let autoOn = false;
let prefs = null;          // preferenze di lavoro (jd_preferences), lette una volta: null = non salvate o non leggibili
let lastRaw = null;

/** Preferenze dall'app (sola lettura). Restano in memoria nel pannello, non vengono salvate dall'estensione. */
async function loadPrefs() {
  const r = await native('preferences');
  prefs = r.ok && r.result.saved ? r.result.preferences : null;
}

/** Tabella del confronto annuncio–preferenze; i testi entrano solo come textContent. */
function renderMatch() {
  const box = $('#match'), body = $('#match-rows');
  body.replaceChildren();
  $('#noprefs').hidden = !connected || !!prefs || !lastRaw;
  if (!prefs || !lastRaw) { box.hidden = true; return; }
  const rows = compare(prefs, jobFacts(lastRaw, values()));
  const sign = { ok: '✓', no: '✗', unknown: '?' };
  for (const r of rows) {
    const tr = document.createElement('tr'); tr.className = r.result;
    const a = document.createElement('td'); a.className = 'r'; a.textContent = sign[r.result];
    const b = document.createElement('td'); b.textContent = r.label;
    if (r.must) { const m = document.createElement('div'); m.className = 'must'; m.textContent = 'obbligatorio'; b.append(m); }
    const c = document.createElement('td'); c.textContent = r.job;
    if (r.note) { const n = document.createElement('div'); n.className = 'note'; n.textContent = r.note; c.append(n); }
    tr.append(a, b, c); body.append(tr);
  }
  box.hidden = !rows.length;
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

function noAccess(text) {
  form.hidden = true;
  lastRaw = null; renderMatch();
  $('#dups').hidden = true;
  show(text, 'info');
}

/** Legge la scheda attiva di questa finestra. Solo l'ultima lettura avviata aggiorna il pannello. */
async function read() {
  const mine = ++reading;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  let raw;
  try { [{ result: raw }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: grab }); }
  catch {
    if (mine !== reading) return;
    if (tab.url && !/^https?:/i.test(tab.url)) return noAccess('Apri la pagina di un annuncio.');
    return noAccess("Per leggere questa pagina premi l'icona Jobdossiers nella barra degli strumenti (o Alt+Shift+J).");
  }
  if (mine !== reading || !raw) return;
  lastRaw = raw;
  const f = fields(raw, htmlToText);
  form.reset();
  for (const [k, v] of Object.entries(f)) if (form.elements[k]) form.elements[k].value = v;
  $('#src').textContent = f.job_desc ? `(${f.source}, ${f.job_desc.length} caratteri)` : '';
  const btn = $('#save');
  btn.textContent = 'Salva in Jobdossiers'; btn.disabled = !connected;
  form.hidden = false;
  renderMatch();
  if (connected) { show(''); await checkDuplicates(); }
}

$('#reread').addEventListener('click', read);
$('#auto').addEventListener('click', async () => {
  // permissions.request vuole il gesto dell'utente: va chiamato subito, senza await prima
  const req = autoOn ? chrome.permissions.remove(SITES) : chrome.permissions.request(SITES);
  await req.catch(() => false);
  if (await autoState()) read();
});

// clic sull'icona o scorciatoia con il pannello già aperto (background.js)
chrome.runtime.onMessage.addListener(m => { if (m?.type === 'leggi') read(); });
// cambio di scheda o pagina: si legge se c'è il permesso; altrimenti il pannello lo dice
chrome.tabs.onActivated.addListener(read);
chrome.tabs.onUpdated.addListener((tabId, info, tab) => { if (info.status === 'complete' && tab.active) read(); });

async function main() {
  await autoState();
  if (await connect()) await loadPrefs();
  await read();
}

main();
