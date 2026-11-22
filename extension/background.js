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
