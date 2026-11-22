/* Finestra dell'estensione: legge la scheda attiva (solo dopo il clic, permesso activeTab), mostra i campi trovati e li salva con il server locale.
 * Il server (jobdossiers-mcp, registrato come host di native messaging «ch.jobdossiers.mcp») controlla i doppioni, cifra e invia: qui non c'è nessuna chiave.
 * I dati della pagina finiscono solo in campi di testo (value, textContent), mai in HTML. */
import { fields } from './parse.js';

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

async function main() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/^https?:/i.test(tab.url || '')) { show("Apri la pagina di un annuncio, poi premi di nuovo l'icona.", 'err'); $('#conn').textContent = ''; return; }
  const st = native('status');
  let raw;
  try { [{ result: raw }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: grab }); }
  catch { show('Questa pagina non si può leggere (pagine del browser o dello store).', 'err'); return; }
  const f = fields(raw, htmlToText);
  for (const [k, v] of Object.entries(f)) if (form.elements[k]) form.elements[k].value = v;
  $('#src').textContent = f.job_desc ? `(${f.source}, ${f.job_desc.length} caratteri)` : '';
  form.hidden = false;
  const s = await st;
  $('#conn').textContent = s.ok ? `collegato · ${s.result.applications} candidature` : 'non collegato';
  if (!s.ok) { show(s.message || s.error, 'err'); $('#save').disabled = true; return; }
  await checkDuplicates();
}

main();
