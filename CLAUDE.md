# jobdossiers-mcp: guida del progetto per Claude Code

## Cos'è
Il server MCP **locale** di Jobdossiers (`jobdossiers.ch`), con gli eseguibili da installare su Mac e Windows. Non è il connettore esposto via internet, che sta nel repo `jobdossiers.ch` (`app/Mcp.php`). Legge e aggiorna le candidature con la cifratura end-to-end del portale; la chiave per automazioni resta sul computer dell'utente.

## Invarianti da non rompere
- La chiave per automazioni (`jda1.<token>.<segreto>`) non esce dal computer: non leggerla, non stamparla, non registrarla nei log. Su macOS sta nel Portachiavi, su Windows in un file cifrato con DPAPI. Non leggere `.local/`.
- `--check` stampa conteggi e **nomi** dei campi cifrati, mai i valori. Lo stesso vale per i log e per gli errori.
- Il formato di cifratura deve restare compatibile con `public/assets/e2ee.js` del portale: il test di interoperabilità lo cerca in `../jobdossiers.ch/` (cartella accanto a questo repo).

## Stack e layout
- Server: Node 20 o superiore, ES modules, nessuna dipendenza a runtime (`src/*.js`). Test: `npm test` (`node --test test/*.test.js`).
- Build degli eseguibili: `node scripts/build.mjs` (richiede Bun), scrive `dist/` e `SHA256SUMS`. `dist/` non va committato.
- App Mac (barra dei menu): `mac/`, Swift; `mac/build-app.sh`, test con `(cd mac && swift test)`.
- App Windows: `win/`, .NET 10; test con `dotnet test win/tests/Jobdossiers.Tests`, installer NSIS in `win/installer/`.
- Estensione per Chrome ed Edge: `extension/` (Manifest V3), parla con il server via native messaging (`src/native.js`, host `ch.jobdossiers.mcp`, solo l'ID dell'estensione e tre azioni). Prova nel browser non automatizzata in CI.
- CI (`ci.yml`): Node su Linux, Swift su macOS, .NET su Windows. `windows-smoke.yml` (quando cambiano `win/`, `src/` o `scripts/`) costruisce l'installer e lo prova su Windows con `win/tests/smoke.ps1`: installazione silenziosa, avvio con screenshot negli artefatti, disinstallazione. `release.yml` al tag `v*` costruisce e pubblica nella release app per Mac, installer e zip per Windows, server per macOS, Windows e Linux, `SHA256SUMS` e attestazioni; avviato a mano fa solo la prova, senza release.
- Residui di build non tracciati (`mac/.build`, `win/**/bin`, `win/**/obj`, `*.bun-build`): non committarli.
- Comando di progetto: `/linkedin-salvate` (in sola lettura su LinkedIn, vedi `.claude/commands/`).

## Regole comuni (repo Swiss Security Insights)
- Le modifiche passano da un branch e da una pull request: non si committa su `main`, e l'unione la decide una persona.
- Segreti, token e chiavi non stanno mai nel repo, nei workflow, nei log o in chat: solo nei secrets di GitHub o nel gestore di chiavi del sistema. Se ne vedi uno, dillo subito.
- Messaggi di commit brevi, con prefisso (`fix:`, `feat:`, `docs:`, `ci:`, `test:`).
- Prima di dire «fatto» controlla il risultato davvero (test, CI, pagina o risposta HTTP) e dichiara cosa non hai potuto verificare.
- Da una sessione Claude Code GraphQL di GitHub è bloccato: usa `gh api` con le route REST.
- Una verifica sulla produzione è in sola lettura, salvo richiesta esplicita.

