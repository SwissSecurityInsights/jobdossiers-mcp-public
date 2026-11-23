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
- Aggiornamento automatico delle app: `latest.json` firmato nella release (`scripts/release-manifest.mjs`), `--app-update-check` / `--app-update-download` in `src/update.js`; Mac: `.pkg` con `mac/pkg-scripts/postinstall` che riapre l'app; Windows: `Setup.exe /S /UPDATE`.
- Aggiornamento online dell'estensione (`src/update.js`): pacchetto `Jobdossiers-estensione.json.gz` firmato Ed25519 nella release; chiave privata solo nel secret `EXTENSION_SIGNING_KEY` del repo pubblico (mai su disco né in chat), pubblica in `src/update.js`. Se cambiano le azioni del native messaging aumenta `NATIVE_PROTOCOL` e `extension/compat.json`.
- Collegamento del dispositivo (`--login`, `src/link.js`): il browser crea la chiave e la cifra per l'app (ECDH P-256 + HKDF + AES-GCM, AAD `jd1:link`), risposta su `127.0.0.1`. Contratto con il portale in `docs/collega-dispositivo.md`.
- Estensione per Chrome ed Edge: `extension/` (Manifest V3), parla con il server via native messaging (`src/native.js`, host `ch.jobdossiers.mcp`, solo l'ID dell'estensione e quattro azioni; il confronto annuncio–preferenze è in `extension/match.js`, nel browser). Prova nel browser non automatizzata in CI.
- Controlli in locale (decisione del 23.11.2026, per i costi di GitHub): `sh scripts/check.sh` (Node, Swift, .NET, gitleaks; `--build` costruisce anche app e installer) prima di ogni commit e PR. Nel repo privato i workflow (`ci.yml`, `windows-smoke.yml`, `release.yml`) non partono da soli: solo a mano (Actions → Run workflow), per esempio «Prova Windows» prima di una release. Nel repo pubblico `jobdossiers-mcp-public` (minuti gratuiti) partono da soli su main e sulle PR e la release si fa lì al tag `v*`. Non aspettare né chiedere la CI del repo privato per unire: conta `scripts/check.sh`.
- Residui di build non tracciati (`mac/.build`, `win/**/bin`, `win/**/obj`, `*.bun-build`): non committarli.
- Comando di progetto: `/linkedin-salvate` (in sola lettura su LinkedIn, vedi `.claude/commands/`).

## Regole comuni (repo Swiss Security Insights)
- Le modifiche passano da un branch e da una pull request: non si committa su `main`, e l'unione la decide una persona.
- Segreti, token e chiavi non stanno mai nel repo, nei workflow, nei log o in chat: solo nei secrets di GitHub o nel gestore di chiavi del sistema. Se ne vedi uno, dillo subito.
- Messaggi di commit brevi, con prefisso (`fix:`, `feat:`, `docs:`, `ci:`, `test:`).
- Prima di dire «fatto» controlla il risultato davvero (test, CI, pagina o risposta HTTP) e dichiara cosa non hai potuto verificare.
- Da una sessione Claude Code GraphQL di GitHub è bloccato: usa `gh api` con le route REST.
- Una verifica sulla produzione è in sola lettura, salvo richiesta esplicita.

