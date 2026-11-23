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
async function hello() {
  let build = '';
  try { build = (await (await fetch(chrome.runtime.getURL('build.json'))).json()).built_at || ''; } catch { /* caricata dal repo: niente data */ }
  chrome.runtime.sendNativeMessage('ch.jobdossiers.mcp', { id: 0, action: 'hello', args: { browser: browserName(), version: chrome.runtime.getManifest().version, build } }, () => void chrome.runtime.lastError);
}
chrome.runtime.onInstalled.addListener(hello);      // installazione, aggiornamento, «Ricarica»
chrome.runtime.onStartup.addListener(hello);        // ogni avvio del browser
