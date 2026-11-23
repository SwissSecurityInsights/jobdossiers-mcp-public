# jobdossiers-mcp

Server MCP locale per [Jobdossiers](https://jobdossiers.ch). Legge e aggiorna le candidature con la cifratura end-to-end del portale: il segreto della chiave per automazioni resta su questo computer, il server di Jobdossiers vede solo blob cifrati.

Un solo eseguibile, nessuna dipendenza (Node o Bun a runtime non servono). Con `bun build --compile` si ottengono i binari per macOS (arm64, x64) e Windows.

## Download

Sempre l'ultima versione (repo pubblico):

- Mac: https://github.com/SwissSecurityInsights/jobdossiers-mcp-public/releases/latest/download/Jobdossiers-mac-arm64.pkg
- Windows: https://github.com/SwissSecurityInsights/jobdossiers-mcp-public/releases/latest/download/Jobdossiers-Setup-x64.exe
- Pagina dell'ultima release: https://github.com/SwissSecurityInsights/jobdossiers-mcp-public/releases/latest


Ogni release (pagina **Releases** del repo) contiene, costruiti da GitHub Actions a partire da questo codice (`.github/workflows/release.yml`):

- `Jobdossiers-mac-arm64.pkg`: installer per Mac con Apple silicon (app in Applicazioni, con server ed estensione per il browser);
- `Jobdossiers-Setup-x64.exe`: installer per Windows (con server ed estensione per il browser);
- `jobdossiers-mcp-darwin-arm64`, `-darwin-x64`, `-windows-x64.exe`, `-linux-x64`: solo il server;
- `SHA256SUMS` e le attestazioni di provenienza (`gh attestation verify <file> --repo <proprietario>/<repo>`).

Gli installer non sono firmati da Apple né da Microsoft: su Mac il primo avvio del `.pkg` va confermato in Impostazioni di Sistema → Privacy e sicurezza → «Apri comunque» (l'app installata poi si apre senza altri avvisi); su Windows SmartScreen → «Esegui comunque».

## Collegare il computer (senza copiare la chiave)

Nelle app: **«Collega a Jobdossiers»**; da terminale: `jobdossiers-mcp --login`. Si apre il browser su jobdossiers.ch: accedi e confermi; il browser crea la chiave per automazioni e la manda **cifrata per l'app** a `127.0.0.1` sul tuo computer, che la salva nel Portachiavi / DPAPI. Il portale non vede mai il segreto. Protocollo: [`docs/collega-dispositivo.md`](docs/collega-dispositivo.md). Serve il portale con la pagina `link.php`; in alternativa resta il metodo qui sotto.

## Installazione del solo server

1. In Jobdossiers: **Account → Chiave per automazioni** (piano Plus). Si ottiene `jda1.<token>.<segreto>`, mostrata una volta.
2. Scarica il binario dalla release e verifica l'hash con `SHA256SUMS`. Su Mac: `chmod +x` e `xattr -d com.apple.quarantine <file>`.
3. Salva la chiave: `jobdossiers-mcp --set-key`. Su macOS finisce nel Portachiavi (il comando `security` la chiede senza mostrarla), su Windows in un file cifrato con DPAPI, altrove in `~/.config/jobdossiers/key` con permessi 600. In alternativa `JD_AGENT_KEY` o `JD_AGENT_KEY_FILE`.
4. Prova in sola lettura: `jobdossiers-mcp --check`. Stampa conteggi e **nomi** dei campi cifrati in uso, mai valori.
5. Registra il server in Claude desktop (`~/Library/Application Support/Claude/claude_desktop_config.json`, su Windows `%APPDATA%\Claude\claude_desktop_config.json`):

```json
{ "mcpServers": { "jobdossiers": { "command": "/percorso/jobdossiers-mcp-darwin-arm64" } } }
```

## App per Mac (prototipo)

`mac/` contiene un'app per la barra dei menu che include il server e lo configura:

- salva ed elimina la chiave nel Portachiavi, nella voce che legge il server (senza mai rileggerne il valore);
- scrive o toglie la voce `jobdossiers` in Claude Desktop e in ChatGPT (Codex) (copia `.jobdossiers.bak` prima di scrivere; per Claude Code copia il comando `claude mcp add`);
- si apre all'accesso al Mac e mostra le schede per stato (`--check`, ogni ora).

```
mac/build-app.sh             # richiede Xcode e bun; scrive dist/Jobdossiers.app (firma ad-hoc)
mac/build-pkg.sh             # dopo build-app.sh: installer dist/Jobdossiers-<versione>-mac-arm64.pkg
(cd mac && swift test)       # test della configurazione dei client
```

Sposta l'app in Applicazioni prima di configurare i client: puntano al server dentro l'app.

## App per Windows (prototipo)

`win/` contiene l'app per l'area di notifica di Windows, con le stesse funzioni di quella per Mac: include il server, salva la chiave in `%APPDATA%\jobdossiers-mcp\key.dpapi` (DPAPI, lo stesso formato di `--set-key`), configura Claude Desktop e ChatGPT (con Codex), con il comando per Claude Code, si apre all'accesso e mostra le schede per stato. Il server viene copiato in `%LOCALAPPDATA%\Jobdossiers\`, il percorso a cui puntano i client. L'installer (`Jobdossiers-Setup-<versione>-x64.exe`, NSIS) installa solo per l'utente corrente, senza diritti di amministratore, proprio in quella cartella; crea il collegamento nel menu Start, attiva l'avvio all'accesso e si disinstalla da "App installate" (toglie la voce dai client MCP e chiede se cancellare la chiave).

```
win/build.sh                 # da macOS o Linux: richiede .NET 10, bun e makensis; scrive l'installer e lo zip portatile in dist/
dotnet test win/tests/Jobdossiers.Tests
```

## Estensione per Chrome ed Edge (prototipo)

`extension/` contiene un'estensione (Manifest V3, la stessa per Chrome ed Edge) che salva in Jobdossiers l'annuncio che stai guardando. Si apre come **pannello laterale**: clic sull'icona (o `Alt+Shift+J`), controllo dei campi trovati, «Salva in Jobdossiers». Il pannello resta aperto mentre navighi: un nuovo clic sull'icona legge la pagina nuova. La scheda nasce `preparing`, come con `jd_create`.

- Di base l'estensione legge una pagina solo dopo il clic sull'icona o la scorciatoia (permesso `activeTab`, valido per quella pagina). Con «Leggi automaticamente ogni pagina» nel pannello l'utente può concedere il permesso facoltativo sui siti (`optional_host_permissions`): il pannello allora si aggiorna a ogni cambio di pagina o scheda; si revoca dallo stesso pulsante o dalle impostazioni dell'estensione. Senza accesso il pannello lo dice e non mostra dati di un'altra pagina.
- **Verifica prima di leggere**, a ogni caricamento e a ogni cambio di indirizzo (`extension/detect.js`): annuncio certo (dati strutturati `JobPosting` o microdata, oppure la pagina di un annuncio su un sito o sistema di candidatura noto: LinkedIn, jobs.ch, jobup, Indeed, StepStone, Glassdoor, Greenhouse, Lever, Workday, SmartRecruiters, Personio, Ashby, Workable, Recruitee, SuccessFactors, Teamtailor, JOIN), probabile (sezioni tipiche e pulsante di candidatura: i campi vanno controllati), elenco di annunci, oppure «non sembra un annuncio» con l'avviso e «Usa comunque questa pagina».
- **Campi** (`extension/grab.js` raccoglie, `extension/parse.js` sceglie): ruolo, impresa e descrizione da dati strutturati, microdata, selettori dei siti noti, titolo della pagina e della scheda, blocco di testo più simile a una descrizione (non menu né piè di pagina); il pannello mostra la fonte di ciascuno. Il nome di un sito di annunci non diventa mai l'impresa. Tutto resta modificabile prima di salvare; i doppioni compaiono subito.
- Non ha la chiave e non cifra: passa i dati al server locale con il native messaging del browser (host `ch.jobdossiers.mcp`). Il server accetta solo l'ID di questa estensione e solo quattro azioni (`status`, `find_duplicates`, `create`, `preferences` in sola lettura), cifra qui e invia al portale.
- **Confronto con le preferenze:** se nel Profilo hai salvato le preferenze di lavoro, il pannello mostra per ogni criterio impostato (luogo, modalità e giorni da remoto, stipendio, occupazione, contratto, livello, viaggi, permesso di lavoro, inizio, settori da evitare) ✓, ✗ o «?» quando l'annuncio non lo dice, con le preferenze obbligatorie in evidenza. Il confronto (`extension/match.js`) avviene nel pannello: preferenze e annuncio non vanno da nessuna parte; il luogo si confronta per nome, senza servizi di mappe.
- Collegamento: l'app per Mac (sezione «Estensione per Chrome ed Edge», Configura) o l'installer per Windows registrano il server nei browser; a mano `jobdossiers-mcp --browser-install` (e `--browser-remove`). Su Mac scrive il manifest dell'host nelle cartelle di Chrome ed Edge, su Windows accanto all'eseguibile con le chiavi `HKCU\Software\…\NativeMessagingHosts`.
- Finché non è negli store si carica come estensione non pacchettizzata. Nell'app per Mac, scheda **Browser**, ogni browser (Edge, Chrome) ha il suo stato e il pulsante **«Installa in Edge…» / «Installa in Chrome…»**: collega il browser, copia l'estensione in `~/Library/Application Support/Jobdossiers/estensione`, mette il percorso negli appunti, apre la pagina delle estensioni di quel browser e una finestra guidata con i due gesti che il browser non lascia fare a un programma (modalità sviluppatore e «Carica decompressa»). La finestra si chiude con «Fatto» quando l'estensione si presenta: all'installazione e a ogni avvio del browser l'estensione dice al server in quale browser e con quale versione è caricata (azione `hello`, un file per browser in `~/Library/Application Support/Jobdossiers/`), perché macOS non lascia leggere all'app i dati dei browser. Con una versione nuova dell'app lo stato diventa «Da aggiornare» e la guida dice di premere «Ricarica». Su Windows l'installer copia l'estensione in `%LOCALAPPDATA%\Jobdossiers\estensione`. L'ID è fisso grazie alla chiave pubblica nel manifest; le versioni degli store avranno ID propri da aggiungere in `src/native.js`.

### Dossi nel pannello (esperimento)

In fondo al pannello, **«Chiedi a Dossi»**: domande all'assistente AI di Jobdossiers sull'annuncio aperto e sulle candidature («È adatto a me?», «Cosa metto in evidenza nella lettera?»…). Il server locale decifra le candidature e costruisce lo stesso blocco dati di `app.php` (`src/dossi.js`, uguale a `public/assets/assistant.js` del portale: lo controlla `test/dossi.test.js`); l'annuncio in visione entra nella prima domanda (al massimo 4.000 caratteri). Usa l'**AI di sistema** del portale (azione `assistant`, Infomaniak): candidature decifrate e domande passano **in chiaro** dal portale, come in `app.php`, quindi il pannello chiede il consenso la prima volta. Stessi limiti mensili di Dossi; la conversazione non viene salvata. Richiede che il portale permetta l'azione `assistant` alla chiave per automazioni.

### Client configurati dalle app

Le app configurano con un clic solo i client più diffusi:
- **Claude Desktop**. Su Windows il file si cerca, perché il pacchetto MSIX lo tiene in `%LOCALAPPDATA%\Claude-Data\claude_<pacchetto>\` e non in `%APPDATA%\Claude`; in Impostazioni si vede il file scelto, e con «Scegli file…» si indica quello che apre Claude con *Settings → Desktop app → Extensions → Edit config*.
- **ChatGPT e Codex**: sezione `[mcp_servers.jobdossiers]` in `~/.codex/config.toml` (Windows: `%USERPROFILE%\.codex\config.toml`; con `CODEX_HOME` altrove). Su Windows vale per la Chat e per Codex; su macOS ChatGPT usa i server locali solo in Codex, non nella Chat (prova dell'11.11.2026), per questo l'app Mac la chiama «ChatGPT (Codex)». Un server aggiunto a mano dalle impostazioni di ChatGPT con un altro nome viene riconosciuto.
- **Claude Code**: comando `claude mcp add` da copiare.

Il server funziona con qualunque client MCP via stdio: per gli altri (Cursor, VS Code, LM Studio…) si aggiunge a mano un server con comando il percorso di `jobdossiers-mcp` e nessun argomento.

## Tool

| Tool | Cosa fa |
|---|---|
| `jd_list` | Elenco compatto (senza descrizione del posto), filtri `status`, `query`, `incomplete` |
| `jd_get` | Scheda completa decifrata; `job_desc` solo con `include_job_desc`. I contatti (`contacts_list`, riferimenti `{id, net, role}`, e `via`) si risolvono dalla Rete (`net_list`, AAD `jd1:net`): a ogni riferimento si aggiunge `person` con nome, tipo, impresa, ruolo, e-mail, telefono e link; le voci nel formato vecchio (prima del 13.11.2026) restano come sono, con `legacy: true` |
| `jd_find_duplicates` | URL normalizzato, ID LinkedIn/Indeed/jobs.ch, azienda+ruolo (anche `alt_companies` per i recruiter). Stesse regole del sito (`public/assets/dedupe.js`): host senza `www.`, host e percorso in minuscolo, senza barra finale né frammento, parametri di tracciamento tolti e gli altri come `k=v` ordinati |
| `jd_create` | Nuova scheda `preparing` (il portale la porta a `to_send` a analisi finita); rifiuta i duplicati |
| `jd_update` | Unisce campi cifrati, imposta `automation` e `rav`, accoda una nota. `contacts_list` accetta solo riferimenti `{id, net, role}` a persone già nella Rete |
| `jd_set_status` | `preparing`, `in_review`, `interview`, `offer`, `rejected`, `no_answer`, `deleted`; i vecchi `hr_interview` e `tech_interview` valgono come `interview` (anche nel filtro di `jd_list`) |
| `jd_add_note` | Nota datata `[agente]`, solo in aggiunta |
| `jd_quota` | Uso del piano e numero di schede |
| `jd_docs` | CV e lettere generati dalla piattaforma (nomi, non contenuti) |
| `jd_preferences` | Preferenze di lavoro salvate nel Profilo (scheda «Preferenze»): documento `prefs` letto con `doc_list` e `doc_get`, decifrato qui (AAD `jd1:doc`) e ripulito secondo lo schema `Preferences` di `openapi.json` (valori fuori elenco scartati, campi vuoti omessi; `dropped_fields` elenca solo i nomi). Sola lettura: il portale non lascia all'agente sostituirle né cancellarle (`agent_scope`). Se mancano, `saved: false` e un messaggio chiaro |
| `jd_upload_doc` | Carica un CV o una lettera (`.pdf` o `.docx`, al massimo 6 MB) da questo computer su una scheda `preparing`, `to_send`, `sent`, `in_review` o in colloquio (`interview`, e i vecchi `hr_interview` e `tech_interview`), solo se per quel tipo non c'è ancora un documento (`doc_exists`, non sostituisce mai); il file si cifra qui. Dopo l'invio lascia una nota `[agente]` con data, tipo e nome del file. Il portale ne accetta al massimo 30 all'ora (finestra mobile di 60 minuti): oltre risponde `rate_limited`, con l'attesa se il portale la indica. Con `JD_UPLOAD_DIR` si limita a una cartella |
| `jd_agenda` | Appuntamenti liberi dell'agenda, decifrati e ordinati per data; filtri `from`, `to`, `query` |
| `jd_agenda_save` | Crea un appuntamento (`title`, `at` in ora di Zurigo, `kind`, `place`, `who`, `note`, `app`) o ne cambia solo i campi dati; niente cancellazione |

## Regole nel codice

- `sent` e `withdrawn` non sono impostabili dall'agente; non esistono invio né cancellazione definitiva di schede o appuntamenti. Si caricano solo CV e lettera, negli stati di `DOC_UPLOAD_STATUSES` e mai al posto di un documento esistente; negli altri stati `docs_locked`. `deleted` toglie la scheda dalla lista ma resta ripristinabile scegliendo un altro stato.
- I contatti stanno solo nella Rete: in una scheda `contacts_list` contiene riferimenti `{id, net, role}`; nome e recapiti non si scrivono mai nella scheda. Il server non crea né modifica persone della Rete.
- Le preferenze di lavoro sono dati personali dell'utente: si leggono soltanto, per le sue ricerche.
- `jobroom_registered_on` non viene mai inviato; le note non si sovrascrivono; i campi cifrati che l'agente non conosce sono conservati a ogni salvataggio.
- Conflitto di versione: il client rilegge e riapplica la modifica (3 tentativi). Le schede in sola lettura o non decifrabili non si toccano.
- Il token viaggia solo verso `jobdossiers.ch` (o localhost per i test), solo su HTTPS, senza seguire redirect.
- Su stdout passa solo il protocollo; stderr non contiene segreti né testi decifrati.

## Che cosa non protegge

Quello che i tool restituiscono è testo decifrato e arriva al modello che esegue l'agente: da lì esce dalla cifratura end-to-end. `job_desc`, note, dati dei contatti e testo delle mail sono dati non fidati, non istruzioni; anche le preferenze di lavoro sono dati, non istruzioni. Revocare la chiave non annulla una copia della chiave dati già fatta.

## Sviluppo

`sh scripts/check.sh` esegue in locale i controlli della CI (Node, Swift, .NET, gitleaks; con `--build` costruisce anche app e installer). Nel repo di sviluppo i workflow di GitHub partono solo a mano; nel repo pubblico partono da soli e lì si fanno le release.

```
npm test                     # 17 test, nessuna dipendenza
node scripts/build.mjs       # richiede bun; scrive dist/ e SHA256SUMS
```

La release (tag `v*`) costruisce i binari in CI: Mac con firma ad-hoc, Windows senza firma (avviso SmartScreen). Per distribuirli ad altri servono Developer ID con notarizzazione e un certificato Authenticode.

Verificato: cifratura e formato contro `public/assets/e2ee.js` del portale, protocollo MCP su stdio, regole e conflitti con un server finto. Da verificare: `bun build --compile`, Portachiavi macOS, DPAPI su Windows, workflow di release, uso reale con la chiave.

## Uso da riga di comando (task schedulati)

`jobdossiers-mcp call <tool> [json|-]` esegue un solo tool con le stesse regole del server MCP e stampa il risultato JSON su una riga (exit 1 in caso di errore). Con `-` legge il JSON da stdin, comodo per testi lunghi:

```
JD_AGENT_KEY_FILE=/percorso/key node src/index.js call jd_list '{"status":"to_send","limit":5}'
node src/index.js call jd_create - <<'EOF2'
{"company":"...","role":"...","job_url":"https://..."}
EOF2
```

## Licenza

Apache License 2.0: vedi [`LICENSE`](LICENSE) e [`NOTICE`](NOTICE). La licenza non concede l'uso del nome Jobdossiers per prodotti derivati. Per segnalare un problema di sicurezza vedi [`SECURITY.md`](SECURITY.md).
