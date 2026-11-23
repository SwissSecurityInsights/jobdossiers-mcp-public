/* Pannello laterale dell'estensione: legge la scheda attiva, mostra i campi trovati e li salva con il server locale.
 * Lettura: dopo il clic sull'icona o Alt+Shift+J (permesso temporaneo activeTab su quella pagina), oppure a ogni cambio di pagina
 * se l'utente ha concesso il permesso facoltativo sui siti («Leggi automaticamente»). Senza accesso il pannello lo dice e non mostra dati vecchi.
 * Il server (jobdossiers-mcp, registrato come host di native messaging «ch.jobdossiers.mcp») controlla i doppioni, cifra e invia: qui non c'è nessuna chiave.
 * I dati della pagina finiscono solo in campi di testo (value, textContent), mai in HTML. */
import { fields } from './parse.js';
import { grab } from './grab.js';
import { detectJob } from './detect.js';
import { jobFacts, compare } from './match.js';

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

function noAccess(text, { askAuto = false } = {}) {
  form.hidden = true;
  lastRaw = null; renderMatch();
  $('#dups').hidden = true;
  $('#notjob').hidden = true;
  show(text, 'info');
  $('#auto-hint').hidden = !askAuto || autoOn;
}

let override = '';          // pagina che l'utente ha deciso di usare anche se non sembra un annuncio

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
  if (check.kind !== 'job' && check.kind !== 'probable' && raw.url !== override) {
    if (attempt < 2) { setTimeout(() => { if (mine === reading) read(attempt + 1); }, 1200); }      // il contenuto può arrivare dopo
    form.hidden = true; lastRaw = null; renderMatch(); $('#dups').hidden = true; $('#auto-hint').hidden = true;
    show(check.kind === 'list' ? 'Questa pagina è un elenco di annunci: apri un annuncio per salvarlo.' : 'Questa pagina non sembra un annuncio di lavoro.', 'warn');
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
  const note = check.kind === 'probable' ? `Sembra un annuncio (${check.reason}): controlla i campi.` : raw.url === override && check.kind !== 'job' ? 'Pagina usata come annuncio su tua scelta: controlla i campi.' : '';
  if (connected) { show(note, note ? 'warn' : ''); await checkDuplicates(); }
  // le pagine che si compongono dopo il caricamento: se manca ancora il titolo, si riprova
  if (!f.role && attempt < 2) setTimeout(() => { if (mine === reading) read(attempt + 1); }, 1200);
}

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

// ── Dossi (esperimento): domande all'assistente AI di Jobdossiers sull'annuncio aperto e sulle candidature ──
const DOSSI_OK = 'dossi-consenso-ai-sistema';
let dossiMsgs = [], dossiFor = '', dossiBusy = false;
const ls = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* memoria non disponibile */ } } };
const DOSSI_ERR = {
  'err.asst_limit': 'Hai usato tutte le domande a Dossi di questo mese.', 'err.ai_day_cap': 'Dossi ha raggiunto il limite giornaliero della piattaforma: riprova domani.',
  'err.rate_limited': 'Troppe domande in un\'ora: riprova più tardi.', rate_limited: 'Troppe domande in un\'ora: riprova più tardi.', 'err.ai_busy': 'Dossi è occupato: riprova tra poco.',
  'err.asst_unavailable': 'Dossi con l\'AI di sistema non è disponibile per il tuo piano.', agent_scope: 'Il portale non permette ancora Dossi dall\'app Jobdossiers (in arrivo).',
};

function dossiShow() {
  $('#dossi').hidden = !connected;
  const ok = ls.get(DOSSI_OK) === '1';
  $('#dossi-consent').hidden = ok; $('#dossi-chat').hidden = !ok;
}

function dossiAdd(role, text) {
  const div = document.createElement('div'); div.className = role === 'user' ? 'msg-u' : 'msg-a'; div.textContent = text;
  $('#dossi-log').append(div); div.scrollIntoView({ block: 'nearest' });
  return div;
}

function dossiReset() { dossiMsgs = []; $('#dossi-log').replaceChildren(); $('#dossi-quick').hidden = false; }

/** L'annuncio in visione: i campi del pannello come li vede l'utente (se è un annuncio). */
function dossiPosting() {
  if (form.hidden) return null;
  const v = values();
  return { role: v.role, company: v.company, place: [v.employer_zip_city, v.employer_country].filter(Boolean).join(', '), url: v.job_url, job_desc: v.job_desc };
}

async function dossiAsk(text) {
  const q = String(text || '').trim();
  if (!q || dossiBusy) return;
  const posting = dossiPosting();
  if ((posting?.url || '') !== dossiFor) { dossiReset(); dossiFor = posting?.url || ''; }
  dossiBusy = true; $('#dossi-send').disabled = true; $('#dossi-quick').hidden = true; $('#dossi-q').value = '';
  dossiAdd('user', q); dossiMsgs.push({ role: 'user', content: q });
  const wait = dossiAdd('assistant', 'Dossi sta pensando…');
  const r = await native('dossi', { messages: dossiMsgs, posting, first: dossiMsgs.length === 1, consent: true });
  if (r.ok) {
    wait.textContent = r.result.text + (r.result.truncated ? '\n[risposta interrotta]' : '');
    dossiMsgs.push({ role: 'assistant', content: r.result.text });
    const u = r.result.usage; $('#dossi-usage').textContent = u && u.limit ? `Domande questo mese: ${u.used}/${u.limit}` : '';
  } else {
    // 429 vale sia per il limite del mese sia per quello orario: conta il messaggio del portale, poi il codice
    wait.textContent = DOSSI_ERR[r.message] || (r.error === 'agent_scope' ? DOSSI_ERR.agent_scope : '') || r.message || DOSSI_ERR[r.error] || r.error;
    dossiMsgs.pop();                                       // la domanda non è arrivata: si può riprovare
  }
  dossiBusy = false; $('#dossi-send').disabled = false;
}

$('#dossi-ok').addEventListener('click', () => { ls.set(DOSSI_OK, '1'); dossiShow(); });
$('#dossi-send').addEventListener('click', () => dossiAsk($('#dossi-q').value));
$('#dossi-q').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) dossiAsk($('#dossi-q').value); });
$('#dossi-new').addEventListener('click', dossiReset);
for (const b of document.querySelectorAll('#dossi-quick .chip')) b.addEventListener('click', () => dossiAsk(b.textContent));

async function main() {
  $('#ver').textContent = 'v' + chrome.runtime.getManifest().version;      // la versione dell'estensione caricata nel browser
  // e la data di costruzione (build.json, scritto da build-app.sh e win/build.sh): con la stessa versione distingue le build locali
  Promise.resolve().then(() => fetch(chrome.runtime.getURL('build.json'))).then(r => r.json()).then(b => {
    const d = new Date(b.built_at);
    if (!isNaN(d)) $('#ver').textContent += ' · ' + d.toLocaleString('it-CH', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  }).catch(() => { $('#ver').textContent += ' · sviluppo'; });
  await autoState();
  if (await connect()) await loadPrefs();
  dossiShow();
  await read();
}

main();
