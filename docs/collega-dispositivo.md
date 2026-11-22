# Collegare un dispositivo senza copiare la chiave

Stato (22.11.2026): lato app fatto (`src/link.js`, `jobdossiers-mcp --login`, pulsante «Collega a Jobdossiers» nelle app); lato portale fatto nel repo jobdossiers.ch (`public/link.php`, `JDCrypto.linkSeal` in `public/assets/e2ee.js`), interoperabilità provata da `test/link.test.js`. Funziona per gli utenti quando il portale è online con `link.php`.

## Idea

Come il «Accedi» delle app desktop (OAuth per app native, RFC 8252: browser di sistema e risposta su `127.0.0.1`), ma con la cifratura end-to-end di Jobdossiers: la chiave per automazioni `jda1.<token>.<segreto>` la crea **il browser** dell'utente, come oggi in Account, e la consegna **cifrata per l'app**. Il portale non vede mai il segreto, né in chiaro né cifrato in modo che possa aprirlo.

## Flusso

1. **App** (`startLink`):
   - coppia ECDH P-256 temporanea (`pub`: chiave pubblica grezza non compressa, 65 byte, base64url);
   - `state`: 32 byte casuali, base64url;
   - ascolto HTTP su `127.0.0.1`, porta casuale, **una sola risposta**, al massimo 5 minuti;
   - apre nel browser di sistema:
     `https://jobdossiers.ch/link.php?v=1&port=<porta>&state=<state>&pub=<pub>&name=<nome del dispositivo>`
2. **Portale** (`link.php`, nel browser):
   - richiede l'accesso (password e 2FA come al solito; se la sessione è vecchia, chiede di nuovo la password);
   - controlla i parametri: `v=1`, `port` intero 1024–65535, `state` base64url di 32 byte, `pub` base64url di 65 byte che inizia con `0x04`, `name` testo (max 80 caratteri, mostrato come testo, mai come HTML);
   - mostra il consenso: «Collegare *<name>* al tuo account? Potrà leggere e aggiornare le candidature (come una chiave per automazioni). Revocabile in Account.» con «Collega» e «Annulla»;
   - su «Collega»: crea la chiave per automazioni come fa Account (stessa API, etichetta = `name`), poi `JDCrypto.linkSeal(chiave, pub, state)` e **navigazione** (non `fetch`) a
     `http://127.0.0.1:<port>/cb?state=<state>&epk=<…>&iv=<…>&ct=<…>`;
   - su «Annulla»: navigazione a `http://127.0.0.1:<port>/cb?state=<state>&error=access_denied`.
3. **App**: controlla `state` (confronto a tempo costante), decifra, verifica la forma `jda1.…`, salva nel Portachiavi / DPAPI / file 600 come `--set-key`, prova la chiave (`jd_quota`). Mostra al browser una pagina «Dispositivo collegato».

## Cifratura (`linkSeal`)

```
eph       = ECDH P-256, nuova per ogni collegamento
shared    = ECDH(eph.private, pub)                       (256 bit)
k         = HKDF-SHA256(ikm = shared, salt = state (32 byte), info = "jd-link-v1") → AES-256-GCM
iv        = 12 byte casuali
ct        = AES-GCM(k, iv, plaintext = chiave jda1.… in UTF-8, additionalData = "jd1:link")   (con il tag da 16 byte in coda)
risposta  = epk = eph.public grezza (65 byte), iv, ct — tutti base64url senza «=»
```

Implementazione di riferimento: `sealForApp` in `src/link.js` (WebCrypto, gira uguale nel browser). Il test `test/link.test.js` prova `JDCrypto.linkSeal` del portale appena c'è (`public/assets/e2ee.js`).

## Perché è sicuro

- Il segreto nasce nel browser e arriva all'app cifrato per una chiave privata che esiste solo nella memoria dell'app: il portale e chiunque veda la risposta (cronologia, estensioni, un altro programma che ascoltasse su `127.0.0.1`) non lo leggono.
- `state` lega la risposta a quella richiesta (e fa da sale dell'HKDF); l'app accetta una sola risposta e poi chiude la porta.
- La navigazione va a `127.0.0.1`, non a `localhost` (niente DNS), e il portale accetta solo una porta numerica: non si può dirottare verso un altro host.
- Il consenso mostra il nome del dispositivo; ogni dispositivo ha la sua chiave, revocabile in Account come oggi.

## Note per il portale

- Usare una **navigazione** (`location.replace`) e non `fetch`: i browser stanno limitando le richieste dai siti pubblici alla rete locale (Local Network Access), le navigazioni di primo livello sono il caso previsto per le app native.
- Nessun dato della chiave in log, analytics o nella cronologia del portale: la chiave e `ct` stanno solo nell'URL verso `127.0.0.1`.
- `link.php` senza piano Plus: spiegare che serve il piano Plus (come per le chiavi per automazioni).
