/* Clic sull'icona o Alt+Shift+J: apre il pannello laterale (se è chiuso) e gli chiede di leggere la scheda attiva.
 * Il clic dà all'estensione il permesso temporaneo su quella sola pagina (activeTab); senza il permesso facoltativo sui siti
 * il pannello non legge nient'altro. sidePanel.open va chiamato subito, dentro il gesto dell'utente. */
function openAndRead(tab) {
  if (!tab) return;
  chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
  // il pannello appena aperto legge da solo; se era già aperto, questo messaggio gli fa rileggere la pagina
  chrome.runtime.sendMessage({ type: 'leggi', tabId: tab.id }).catch(() => {});
}

chrome.action.onClicked.addListener(openAndRead);
chrome.commands.onCommand.addListener((command, tab) => { if (command === 'leggi-pagina') openAndRead(tab); });

/** In quale browser siamo: Edge e Chrome si dichiarano nei «brands»; altrimenti Chromium. */
function browserName() {
  const brands = (navigator.userAgentData?.brands || []).map(b => b.brand);
  if (brands.includes('Microsoft Edge') || /\bEdg\//.test(navigator.userAgent)) return 'edge';
  if (brands.includes('Google Chrome')) return 'chrome';
  return 'chromium';
}

/** «Sono caricata qui, con questa versione»: l'app lo mostra nella scheda Browser (non può leggere da sola i dati dei browser). */
async function buildDate() {
  try { return (await (await fetch(chrome.runtime.getURL('build.json'))).json()).built_at || ''; } catch { return ''; }      // caricata dal repo: niente data
}
const native = msg => new Promise(res => chrome.runtime.sendNativeMessage('ch.jobdossiers.mcp', msg, r => res(r || { ok: false, error: 'native', message: chrome.runtime.lastError?.message || 'nessuna risposta' })));

async function hello() {
  await native({ id: 0, action: 'hello', args: { browser: browserName(), version: chrome.runtime.getManifest().version, build: await buildDate() } });
}

/** Aggiornamento online (src/update.js): l'app scarica il pacchetto firmato dall'ultima release, lo verifica e sostituisce la cartella;
 *  qui si ricarica l'estensione. Automatico al massimo una volta al giorno (disattivabile nel pannello), oppure a richiesta. */
const DAY = 24 * 3600 * 1000;
async function checkUpdate(force = false) {
  const s = await chrome.storage.local.get({ autoUpdate: true, lastUpdateCheck: 0 });
  if (!force && (!s.autoUpdate || Date.now() - s.lastUpdateCheck < DAY)) return { ok: true, result: { updated: false, reason: 'skipped' } };
  await chrome.storage.local.set({ lastUpdateCheck: Date.now() });        // prima di tutto: niente cicli dopo la ricarica
  const r = await native({ id: 0, action: 'update', args: { version: chrome.runtime.getManifest().version, build: await buildDate() } });
  if (r.ok && r.result.updated) {
    await chrome.storage.local.set({ justUpdated: r.result.version });
    setTimeout(() => chrome.runtime.reload(), 300);                       // la risposta arriva prima al pannello
  }
  return r;
}

chrome.runtime.onInstalled.addListener(() => { hello(); checkUpdate(); });      // installazione, aggiornamento, «Ricarica»
chrome.runtime.onStartup.addListener(() => { hello(); checkUpdate(); });        // ogni avvio del browser
chrome.runtime.onMessage.addListener((m, sender, reply) => {
  if (m?.type !== 'update-check' || sender.id !== chrome.runtime.id) return false;
  checkUpdate(true).then(reply);
  return true;                                                            // risposta asincrona
});
