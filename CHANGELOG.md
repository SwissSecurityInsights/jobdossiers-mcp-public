# Changelog

## 0.2.9 (25.11.2026)

### Aggiunto
- Estensione:
  - più portali letti correttamente (Indeed accanto ai risultati, Jora, Monster, CareerBuilder, ZipRecruiter, Talent.com, SimplyHired, jobup.ch);
  - tempo di percorrenza automatico nella riga del luogo;
  - righe «Carriera», «Competenze» e «Lingue» rispetto al profilo;
  - persone della Rete e candidature precedenti nell'impresa dell'annuncio;
  - date di pubblicazione e scadenza, promemoria in agenda;
  - ricerche su LinkedIn, jobs.ch e Indeed con le preferenze;
  - contatti «Meet the hiring team» di LinkedIn nella Rete.
- Server: nuove azioni per l'estensione (`profile`, `contacts`, `network`, `history`, `reminder`).
- `jd_profile`: profilo professionale dell'utente in sola lettura (headline, sintesi, esperienze, competenze, certificazioni, formazione, lingue, link pubblici), con filtro `sections`, limite di circa 15 000 caratteri (`truncated`) e `omitted` se la chiave non può leggere i documenti. Esclusi nome, recapiti, luogo di residenza, data di nascita, nazionalità, permesso, casi STAR e file. Vedi il README, «Campi di `jd_profile`».

### Corretto
- LinkedIn: titolo ripetuto nella descrizione, etichette «Hybrid»/«Full-time», titoli con «–», contatti nella vista dei risultati.
- jobs.ch: occupazione «5%», contratto «Temporaire».
- Indirizzo salvato senza parametri di tracciamento.

### Tolto
- Dossi nell'estensione.

