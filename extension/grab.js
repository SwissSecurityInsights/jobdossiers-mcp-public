/* Raccoglie i dati grezzi della pagina. Gira DENTRO la pagina (chrome.scripting.executeScript con func: grab): deve bastare a sé stessa,
 * senza variabili esterne né import. Non decide nulla: la verifica (detect.js) e l'estrazione dei campi (parse.js) lavorano su quello che ritorna.
 * Legge soltanto: non modifica la pagina e non invia nulla. */
export function grab() {
  const MAX = 100000;
  const txt = el => (el && el.innerText ? el.innerText : '').replace(/\n{3,}/g, '\n\n').trim();
  const meta = n => document.querySelector(`meta[property="${n}"], meta[name="${n}"]`)?.content || '';
  const first = sels => { for (const s of sels) { try { const el = document.querySelector(s); if (el && txt(el)) return el; } catch { /* selettore non valido */ } } return null; };

  // Selettori noti dei siti e dei sistemi di candidatura più diffusi (best effort: se cambiano, restano i dati strutturati e il testo)
  const SITE = {
    title: ['[data-cy="vacancy-title"]', '[data-testid="vj-job-title"]', '.job-details-jobs-unified-top-card__job-title h1', '.job-details-jobs-unified-top-card__job-title', '.top-card-layout__title', '.topcard__title',
      'h1.jobsearch-JobInfoHeader-title', '[data-testid="jobsearch-JobInfoHeader-title"]', '[data-automation-id="jobPostingHeader"]',
      '.posting-headline h2', '.app-title', '#header .job-title', '[data-cy="vacancy-title"]', '[data-testid="job-title"]', '[class*="JobTitle"]', '[class*="job-title"]'],
    company: ['[data-cy="company-link"]', '[data-testid="company-info-metadata"] a', '.job-details-jobs-unified-top-card__company-name a', '.job-details-jobs-unified-top-card__company-name', '.topcard__org-name-link',
      '[data-testid="inlineHeader-companyName"]', '[data-company-name="true"]', '.company-name', '[data-cy="vacancy-company"]', '[data-testid="company-name"]',
      '[class*="CompanyName"]', '[class*="company-name"]'],
    desc: ['[data-cy="vacancy-description"]', '[data-testid="viewjob-job-content"]', '#job-details', '.jobs-description__content', '.show-more-less-html__markup', '.description__text', '#jobDescriptionText',
      '[data-automation-id="jobPostingDescription"]', '.posting-page .section-wrapper', '#content .job__description', '#content',
      '[data-cy="vacancy-description"]', '[data-testid="job-description"]', '[class*="jobDescription"]', '[class*="job-description"]', '[class*="JobDescription"]'],
  };
  // riga con data, occupazione, contratto e luogo del riquadro (jobs.ch: «20 November 2026 · 80 – 100% · Festanstellung · 5210 Windisch»)
  // jobs.ch: i dati si cercano nel riquadro dell'annuncio (il contenitore del titolo), non nel primo elemento della pagina con lo stesso marcatore
  const jcTitle = document.querySelector('[data-cy="vacancy-title"]');
  let jc = jcTitle;
  while (jc && jc.parentElement && !jc.querySelector('[data-cy="vacancy-info"]')) jc = jc.parentElement;
  // riquadro senza etichetta per il luogo (Bundesamt: «01 November 2026 · 100% · Temporär · Zollikofen»): l'ultimo testo fuori dagli elementi con data-cy
  const looseInfo = () => {
    const box = (jc || document).querySelector('[data-cy="vacancy-info"]'); if (!box) return '';
    const w = document.createTreeWalker(box, NodeFilter.SHOW_TEXT); const out = []; let n;
    while ((n = w.nextNode())) { const v = n.nodeValue.replace(/\s+/g, ' ').trim(); if (v && n.parentElement.closest('[data-cy]') === box) out.push(v); }
    return out.filter(v => /\p{L}{2}/u.test(v) && !/^[·•∙,|-]$/.test(v)).pop() || '';
  };
  const inJc = sels => { if (!jc) return ''; for (const s of sels) { const e = jc.querySelector(s); if (e && txt(e)) return txt(e); } return ''; };
  const site = { title: txt(first(SITE.title)), company: txt(first(SITE.company)), desc: txt(first(SITE.desc)).slice(0, MAX),
    info: (inJc(['[data-cy="vacancy-info"]']) || txt(first(['[data-cy="vacancy-info"]']))).slice(0, 500),
    place: (inJc(['[data-cy="info-location-link"]', '[data-cy="info-location"]']) || txt(first(['[data-cy="info-location-link"]', '[data-cy="info-location"]'])) || looseInfo()).slice(0, 200) };      // «Bahnstrasse 24, 8603 Schwerzenbach»
  // Indeed (riquadro accanto ai risultati): impresa · valutazione · luogo; il luogo è l'ultimo pezzo di testo
  const indeedMeta = document.querySelector('[data-testid="company-info-metadata"]');
  if (indeedMeta) {
    const bits = []; const w = document.createTreeWalker(indeedMeta, NodeFilter.SHOW_TEXT); let n;
    while ((n = w.nextNode())) { const v = n.nodeValue.replace(/\s+/g, ' ').trim(); if (v) bits.push(v); }
    site.loc = (bits.filter(v => /\p{L}{2}/u.test(v) && v !== txt(indeedMeta.querySelector('a'))).pop() || '').slice(0, 200);
  }
  // Jora: impresa e luogo accanto al titolo («Transport for NSW – Sydney CBD NSW»)
  if (/(^|\.)jora\.com$/i.test(location.hostname)) {
    const jt = document.querySelector('h1.job-title'), box = jt && jt.parentElement && jt.parentElement.parentElement;
    if (box) { site.company = site.company || txt(box.querySelector('.company')); site.loc = site.loc || txt(box.querySelector('.location')); }
  }
  const jcDesc = document.querySelector('[data-cy="vacancy-description"]');
  if (jcDesc && txt(jcDesc).length > site.desc.length) site.desc = txt(jcDesc).slice(0, MAX);
  // Annuncio aperto accanto ai risultati senza cambiare indirizzo (jobs.ch, jobup.ch): il risultato selezionato e il suo link al dettaglio
  const active = document.querySelector('[data-cy="vacancy-serp-item-active"] a[href*="/detail/"], a[data-cy="vacancy-serp-item-active"][href*="/detail/"]');
  const selectedUrl = active ? active.href : '';

  // Riquadro dell'annuncio senza classi del sito: l'elemento con lo stesso testo del titolo della scheda, fuori dagli elenchi di annunci
  // (LinkedIn e altri mostrano accanto un elenco con altri titoli). Intorno: impresa, riga «luogo · data», etichette come «Hybrid».
  const JOBLINKS = 'a[href*="/jobs/view/"], a[href*="currentJobId="], a[href*="/viewjob"], a[href*="/vacancies/detail/"]';
  // etichette dell'annuncio (LinkedIn: «✓ Hybrid», «✓ Full-time», che sono link di ricerca con currentJobId: non contano come elenco)
  const TAG = /^(on-?site|hybrid|remote|full-time|part-time|contract|temporary|internship|vor ort|homeoffice|vollzeit|teilzeit|in sede|ibrido|da remoto|tempo pieno|part-time|sur site|hybride|t[ée]l[ée]travail|[àa] distance|temps plein|temps partiel)$/i;
  const jobLinkCount = el => [...el.querySelectorAll(JOBLINKS)].filter(a => !TAG.test(txt(a).replace(/^[✓✔]\s*/, '').trim())).length;
  const many = el => jobLinkCount(el) > 2;               // contiene un elenco di annunci
  const inList = el => !!el.closest('li, [role="listitem"], [role="list"], ul, ol');
  // «Titolo | Impresa | LinkedIn»: il titolo può contenere «–» («INFORMATION SECURITY MANAGER – GROUPE (H/F)»)
  const tabText = document.title.replace(/^\(\d+\)\s*/, '');
  const pipes = tabText.split(/\s+\|\s+/);
  const tabRole = (pipes.length >= 3 ? pipes[0] : pipes[0].split(/\s+(?:–|—|-)\s+/)[0]).trim().toLowerCase();      // «Titolo | Impresa | Sito»: il titolo resta intero
  // Lo stesso titolo compare anche nella scheda dell'elenco (a sinistra, dentro un link all'annuncio): si sceglie il dettaglio.
  // Punteggio: dentro un link a un annuncio o in un elenco = scheda dell'elenco; h1/h2 = titolo del dettaglio; a parità vince l'ultimo
  // nella pagina (il dettaglio viene dopo l'elenco).
  // Il titolo del riquadro ha poco sotto la riga «luogo · data» (intera o a pezzi): così non vince la copia del titolo che alcune imprese
  // ripetono dentro la descrizione (PwC: «About PwC … (Associate) Cyber Security…», con elenchi puntati «· …» che non sono quella riga).
  const META_LINE = l => /\S\s[·•∙]\s\S/.test(l) || /^[·•∙]$/.test(l);
  const hasMeta = el => {
    let b = el;
    for (let i = 0; i < 5 && b.parentElement; i++) {
      b = b.parentElement; if (many(b)) return false;
      const ls = txt(b).split('\n').map(l => l.trim()).filter(Boolean), same = ls.filter(l => l.toLowerCase() === tabRole).length;
      if (same > 1) return false;                         // il contenitore comprende anche l'altra copia del titolo: la riga trovata non è la sua
      const at = ls.findIndex(l => l.toLowerCase() === tabRole);
      if (at >= 0 && ls.slice(at + 1, at + 6).some(META_LINE)) return true;
    }
    return false;
  };
  let titleEl = null, titleScore = -Infinity;
  if (tabRole.length > 2) {
    for (const el of document.querySelectorAll('h1, h2, h3, [role="heading"], a, span, div, p')) {
      if (el.children.length > 3 || txt(el).toLowerCase() !== tabRole) continue;
      const score = (el.tagName === 'H1' ? 4 : el.tagName === 'H2' ? 3 : /^H\d$/.test(el.tagName) || el.getAttribute('role') === 'heading' ? 2 : 0)
        - (el.closest(JOBLINKS) ? 10 : 0) - (inList(el) ? 10 : 0) + (hasMeta(el) ? 8 : 0);
      if (score >= titleScore) { titleScore = score; titleEl = el; }
    }
    if (titleScore <= -10) titleEl = null;                                    // solo schede dell'elenco: nessun dettaglio aperto
  }
  if (!titleEl) titleEl = [...document.querySelectorAll('h1')].find(h => !inList(h) && !h.closest(JOBLINKS) && txt(h)) || null;
  // «Ginevra · 2 giorni fa»: LinkedIn mette spazi non separabili (U+00A0) attorno al punto, e a volte ogni pezzo è un elemento a sé
  // (contenitore flex), così nel testo il punto finisce su una riga da solo. Valgono anche «•» e «∙».
  const DOT = /\s[·•∙]\s/, DOT_ALONE = /^[·•∙]$/;
  const WHEN = /\b(ago|reposted|posted|fa|vor|il y a|heute|today|oggi|gestern|yesterday|ieri|hier)\b|\b(pubblicat|ripubblicat|publi|aujourd)|^\d+\s*(h|d|w|min|tag|giorn|jour)/i;     // «2 weeks ago», «Reposted…»: non è un luogo
  // un luogo deve sembrare un luogo: niente date, stati dell'annuncio o righe dell'elenco («Saved», «1 connection works here»…)
  const NOT_PLACE = /^(saved|salvat[oa]|gespeichert|enregistr|promoted|promoss|gesponsert|sponsoris|viewed|visualizzat|applied|candidat|easy apply|be an early applicant|actively recruiting|verified|no longer accepting|bewerben|apply)|connection|alumni|applicant|candidat|clicked|employees|dipendenti/i;
  let top = null;
  if (titleEl) {
    const title = txt(titleEl);
    let box = titleEl;
    for (let i = 0; i < 7 && box.parentElement; i++) {
      box = box.parentElement;
      if (many(box)) { box = null; break; }
      if (/[·•∙]/.test(txt(box))) break;
    }
    if (box) {
      const lines = txt(box).split('\n').map(l => l.trim()).filter(Boolean);
      const at = lines.findIndex(l => l.toLowerCase() === title.toLowerCase());
      // riga «luogo · data» dopo il titolo: tutta su una riga, oppure a pezzi con il punto da solo
      // pezzi attorno al punto: «Luogo · data» (LinkedIn) oppure «Impresa • Luogo • data» (Talent.com e altri)
      let segs = null, meta = false;
      for (let i = at + 1; i < Math.min(lines.length, at + 8); i++) {
        if (DOT.test(lines[i])) { segs = lines[i].split(DOT).map(x => x.trim()); break; }
        if (DOT_ALONE.test(lines[i])) { segs = [i - 1 > at ? lines[i - 1] : '', lines[i + 1] || '', lines[i + 2] || '']; break; }
      }
      let place = '', metaCompany = '';
      if (segs) {
        meta = true;
        if (segs[1] && !WHEN.test(segs[1]) && !NOT_PLACE.test(segs[1]) && /\p{L}{2}/u.test(segs[1]) && !DOT_ALONE.test(segs[1])) { metaCompany = segs[0]; place = segs[1]; }
        else place = segs[0];
      }
      if (WHEN.test(place) || NOT_PLACE.test(place) || !/\p{L}{2}/u.test(place) || place.length > 120) place = '';
      // impresa: la riga sopra il titolo, saltando le sue ripetizioni (testi per lettori di schermo come «… (Verified job)»)
      const tl = title.toLowerCase();
      let before = '';
      for (let i = at - 1; i >= 0 && i >= at - 5; i--) {
        const l = lines[i];
        if (l.toLowerCase().startsWith(tl) || !/\p{L}.*\p{L}/u.test(l)) continue;          // ripetizioni del titolo, «…», «•••» e simili
        before = l; break;
      }
      // etichette sotto il riquadro (LinkedIn: «✓ Hybrid», «✓ Full-time»): fuori dal blocco del titolo, qualche livello più su
      const tags = new Set();
      for (let up = box, i = 0; i < 6 && up.parentElement && !tags.size; i++) {
        up = up.parentElement; if (many(up) || inList(up)) break;          // non le etichette delle schede dell'elenco
        for (const e of up.querySelectorAll('button, li, span, a')) {
          const s = txt(e).replace(/^[✓✔]\s*/, '').trim(); if (s.length <= 30 && TAG.test(s)) tags.add(s);
        }
      }
      top = {
        title, location: place, tags: [...tags],
        // impresa solo se c'è la riga «luogo · data» (riquadro di un annuncio): altrimenti sopra il titolo c'è di tutto, per esempio il menu del sito
        company: meta && before && before.length <= 80 && !DOT.test(before) ? before : metaCompany.length <= 80 ? metaCompany : '',
        text: lines.slice(Math.max(0, at - 1), at + 10).join('\n').slice(0, 2000),
        lines: lines.slice(Math.max(0, at - 4), at + 10).map(l => l.slice(0, 200)),      // per «Copia diagnostica»
      };
    }
  }

  // Sezione «About the job» (titoli dell'interfaccia di LinkedIn e di altri siti, in più lingue): il contenitore della sezione
  const ABOUT = /^(about the job|job description|informazioni sull.offerta di lavoro|descrizione (del lavoro|dell.offerta)|uber den job|über den job|infos zum job|stellenbeschreibung|a propos de l.offre d.emploi|à propos de l.offre d.emploi|description du poste)$/i;
  let about = '';
  for (const h of document.querySelectorAll('h1, h2, h3, h4, strong, [role="heading"], span')) {
    if (!ABOUT.test(txt(h))) continue;
    let box = h;
    for (let i = 0; i < 6 && box.parentElement; i++) {
      box = box.parentElement;
      if (many(box)) { box = null; break; }
      if (txt(box).length >= 300) break;
    }
    if (box) { const lines = txt(box).split('\n'); while (lines.length && (!lines[0].trim() || ABOUT.test(lines[0].trim()))) lines.shift(); about = lines.join('\n').trim().slice(0, MAX); break; }
  }

  // Microdata schema.org/JobPosting
  const md = document.querySelector('[itemtype*="schema.org/JobPosting" i]');
  const micro = md ? {
    title: txt(md.querySelector('[itemprop="title"]')),
    company: txt(md.querySelector('[itemprop="hiringOrganization"] [itemprop="name"]')) || txt(md.querySelector('[itemprop="hiringOrganization"]')),
    desc: txt(md.querySelector('[itemprop="description"]')).slice(0, MAX),
    location: txt(md.querySelector('[itemprop="jobLocation"]')),
  } : null;

  // Blocco di testo più simile a una descrizione di lavoro: sezioni tipiche, testo abbondante, pochi link
  const SECTIONS = /(responsibilit|requirement|qualification|your profile|your role|what you('| wi)ll do|what we offer|we offer|benefits|about the role|ihre aufgaben|ihr profil|deine aufgaben|dein profil|wir bieten|anforderungen|aufgaben|mansioni|requisiti|il tuo profilo|cosa offriamo|offriamo|responsabilit|vos missions|votre profil|nous offrons|profil recherch|missions)/gi;
  let best = null, bestScore = 0;
  for (const el of document.querySelectorAll('main, article, section, div[class], div[id]')) {
    const t = el.innerText || '';
    if (t.length < 400 || t.length > 60000) continue;
    const linkText = [...el.querySelectorAll('a')].reduce((n, a) => n + (a.innerText || '').length, 0);
    if (linkText / t.length > 0.35) continue;                          // navigazione, elenchi di link
    if (many(el)) continue;                                            // elenco di annunci (colonna di LinkedIn e simili)
    const hits = new Set((t.match(SECTIONS) || []).map(s => s.toLowerCase())).size;
    if (!hits) continue;
    const score = hits * 3000 - t.length / 10;                         // a parità di sezioni, il blocco più stretto
    if (score > bestScore) { best = el; bestScore = score; }
  }
  const bestText = txt(best);
  const sectionHits = new Set((bestText.match(SECTIONS) || []).map(s => s.toLowerCase())).size;

  // Segnali per la verifica
  const APPLY = /^\s*(apply|apply now|easy apply|candidature|candidati|candidarsi|invia candidatura|jetzt bewerben|bewerben|online bewerben|postuler|je postule)\b/i;
  const apply = [...document.querySelectorAll('a, button, [role="button"], input[type="submit"]')].some(b => APPLY.test(b.innerText || b.value || b.getAttribute('aria-label') || ''));
  const JOBLINK = /(\/jobs\/view\/\d|\/vacancies\/detail\/|\/viewjob\?|\/job\/|\/jobs\/\d|\/stellen?angebot|\/annuncio|\/offre|\/position\/|currentjobid=)/i;
  const jobLinks = new Set([...document.querySelectorAll('a[href]')].map(a => a.href).filter(h => JOBLINK.test(h))).size;

  // LinkedIn, «Meet the hiring team»: chi pubblica l'annuncio e chi seleziona (nome, ruolo, profilo). Solo quello che la pagina mostra.
  const people = [];
  if (/(^|\.)linkedin\.com$/i.test(location.hostname)) {
    const HIRE = /^(meet the hiring team|lerne das (recruiting-?)?team kennen|incontra il team (di selezione|di assunzione|che assume)|rencontrez l.[ée]quipe (de recrutement|d.embauche)|conoce al equipo de contrataci[oó]n)$/i;
    const POSTER = /^(job poster|jobinserent(in)?|inserzionista|autore dell.offerta|auteur de l.offre( d.emploi)?|publicador del empleo)$/i;
    const SKIP = /^(message|messaggio|nachricht|envoyer un message|mensaje|follow|segui|folgen|suivre|connect|collegati|vernetzen|se connecter|\d+(st|nd|rd|th|°)|[·•]\s*\d+.*|verified|verificat.*|verifiziert|vérifié)$/i;
    const head = [...document.querySelectorAll('h1, h2, h3, h4, p, span, div')].find(e => e.children.length <= 2 && HIRE.test(txt(e)));      // nella vista dei risultati è un <p>
    let box = head;
    for (let i = 0; box && i < 6 && !box.querySelector('a[href*="/in/"]'); i++) box = box.parentElement;
    const slugOf = a => (a.getAttribute('href') || '').match(/\/in\/([^/?#]+)/)?.[1] || '';
    if (box && !many(box)) {
      const seen = new Set();
      for (const a of box.querySelectorAll('a[href*="/in/"]')) {
        const slug = slugOf(a); if (!slug || seen.has(slug) || people.length >= 5) continue;
        // il riquadro della persona: si sale finché c'è un solo profilo
        let card = a;
        while (card.parentElement && card.parentElement !== box && new Set([...card.parentElement.querySelectorAll('a[href*="/in/"]')].map(slugOf)).size === 1) card = card.parentElement;
        const lines = txt(card).split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
        // il nome: il testo del link al profilo (non quello della foto), senza grado di collegamento, segno di verifica e pronomi
        const named = [...card.querySelectorAll('a[href*="/in/"]')].map(x => txt(x).split('\n').map(l => l.trim()).find(Boolean) || '').find(Boolean) || lines[0] || '';
        const name = named.replace(/\s*[·•].*$/, '').replace(/[\s✓✔]+$/, '').replace(/\s*\((he|she|they|er|sie|lui|lei|il|elle)\/[^)]*\)\s*$/i, '').trim();
        if (!name || name.length > 80 || /linkedin member|utente linkedin|linkedin-mitglied|membre de linkedin/i.test(name)) continue;
        const rest = lines.filter(l => l !== name && !l.startsWith(name) && !SKIP.test(l) && !POSTER.test(l) && !/^[✓✔·•\s]*$/.test(l));
        seen.add(slug);
        people.push({ name, role: (rest[0] || '').slice(0, 120), link: `https://www.linkedin.com/in/${slug}/`, poster: lines.some(l => POSTER.test(l)) });
      }
    }
  }

  return {
    people,
    url: location.href, title: document.title, h1: txt(document.querySelector('h1')).slice(0, 500),
    og_title: meta('og:title'), og_site: meta('og:site_name'), og_type: meta('og:type'),
    ld: [...document.querySelectorAll('script[type="application/ld+json"]')].slice(0, 20).map(s => s.textContent.slice(0, 200000)),
    micro, site, top, about, selectedUrl, best: bestText.slice(0, MAX), sectionHits, apply, jobLinks,
    selection: String(getSelection() || '').trim().slice(0, MAX),
    main: txt(document.querySelector('main, article, [role="main"]') || document.body).slice(0, MAX),
  };
}
