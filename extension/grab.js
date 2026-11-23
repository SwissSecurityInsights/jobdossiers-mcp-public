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
    title: ['.job-details-jobs-unified-top-card__job-title h1', '.job-details-jobs-unified-top-card__job-title', '.top-card-layout__title', '.topcard__title',
      'h1.jobsearch-JobInfoHeader-title', '[data-testid="jobsearch-JobInfoHeader-title"]', '[data-automation-id="jobPostingHeader"]',
      '.posting-headline h2', '.app-title', '#header .job-title', '[data-cy="vacancy-title"]', '[data-testid="job-title"]', '[class*="JobTitle"]', '[class*="job-title"]'],
    company: ['.job-details-jobs-unified-top-card__company-name a', '.job-details-jobs-unified-top-card__company-name', '.topcard__org-name-link',
      '[data-testid="inlineHeader-companyName"]', '[data-company-name="true"]', '.company-name', '[data-cy="vacancy-company"]', '[data-testid="company-name"]',
      '[class*="CompanyName"]', '[class*="company-name"]'],
    desc: ['#job-details', '.jobs-description__content', '.show-more-less-html__markup', '.description__text', '#jobDescriptionText',
      '[data-automation-id="jobPostingDescription"]', '.posting-page .section-wrapper', '#content .job__description', '#content',
      '[data-cy="vacancy-description"]', '[data-testid="job-description"]', '[class*="jobDescription"]', '[class*="job-description"]', '[class*="JobDescription"]'],
  };
  const site = { title: txt(first(SITE.title)), company: txt(first(SITE.company)), desc: txt(first(SITE.desc)).slice(0, MAX) };

  // Riquadro dell'annuncio senza classi del sito: l'elemento con lo stesso testo del titolo della scheda, fuori dagli elenchi di annunci
  // (LinkedIn e altri mostrano accanto un elenco con altri titoli). Intorno: impresa, riga «luogo · data», etichette come «Hybrid».
  const JOBLINKS = 'a[href*="/jobs/view/"], a[href*="currentJobId="], a[href*="/viewjob"], a[href*="/vacancies/detail/"]';
  const many = el => el.querySelectorAll(JOBLINKS).length > 2;               // contiene un elenco di annunci
  const inList = el => !!el.closest('li, [role="listitem"], [role="list"], ul, ol');
  const tabRole = document.title.replace(/^\(\d+\)\s*/, '').split(/\s+(?:\||–|—|-)\s+/)[0].trim().toLowerCase();
  // Lo stesso titolo compare anche nella scheda dell'elenco (a sinistra, dentro un link all'annuncio): si sceglie il dettaglio.
  // Punteggio: dentro un link a un annuncio o in un elenco = scheda dell'elenco; h1/h2 = titolo del dettaglio; a parità vince l'ultimo
  // nella pagina (il dettaglio viene dopo l'elenco).
  let titleEl = null, titleScore = -Infinity;
  if (tabRole.length > 2) {
    for (const el of document.querySelectorAll('h1, h2, h3, [role="heading"], a, span, div, p')) {
      if (el.children.length > 3 || txt(el).toLowerCase() !== tabRole) continue;
      const score = (el.tagName === 'H1' ? 4 : el.tagName === 'H2' ? 3 : /^H\d$/.test(el.tagName) || el.getAttribute('role') === 'heading' ? 2 : 0)
        - (el.closest(JOBLINKS) ? 10 : 0) - (inList(el) ? 10 : 0);
      if (score >= titleScore) { titleScore = score; titleEl = el; }
    }
    if (titleScore <= -10) titleEl = null;                                    // solo schede dell'elenco: nessun dettaglio aperto
  }
  if (!titleEl) titleEl = [...document.querySelectorAll('h1')].find(h => !inList(h) && !h.closest(JOBLINKS) && txt(h)) || null;
  // «Ginevra · 2 giorni fa»: LinkedIn mette spazi non separabili (U+00A0) attorno al punto, e a volte ogni pezzo è un elemento a sé
  // (contenitore flex), così nel testo il punto finisce su una riga da solo. Valgono anche «•» e «∙».
  const DOT = /\s[·•∙]\s/, DOT_ALONE = /^[·•∙]$/;
  const WHEN = /\b(ago|reposted|posted|fa|pubblicat|ripubblicat|vor|il y a|publi|heute|today|oggi|aujourd)/i;     // «2 weeks ago», «Reposted…»: non è un luogo
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
      let place = '', meta = false;
      for (let i = at + 1; i < Math.min(lines.length, at + 8); i++) {
        if (DOT.test(lines[i])) { meta = true; place = lines[i].split(DOT)[0].trim(); break; }
        if (DOT_ALONE.test(lines[i])) { meta = true; place = i - 1 > at ? lines[i - 1] : ''; break; }
      }
      // un luogo deve sembrare un luogo: niente date, stati dell'annuncio o righe dell'elenco («Saved», «1 connection works here»…)
      const NOT_PLACE = /^(saved|salvat[oa]|gespeichert|enregistr|promoted|promoss|gesponsert|sponsoris|viewed|visualizzat|applied|candidat|easy apply|be an early applicant|actively recruiting|verified|no longer accepting)|connection|alumni|applicant|candidat|clicked|employees|dipendenti/i;
      if (WHEN.test(place) || NOT_PLACE.test(place) || !/\p{L}{2}/u.test(place) || place.length > 120) place = '';
      // impresa: la riga sopra il titolo, saltando le sue ripetizioni (testi per lettori di schermo come «… (Verified job)»)
      const tl = title.toLowerCase();
      let before = '';
      for (let i = at - 1; i >= 0 && i >= at - 5; i--) {
        const l = lines[i];
        if (l.toLowerCase().startsWith(tl) || !/\p{L}.*\p{L}/u.test(l)) continue;          // ripetizioni del titolo, «…», «•••» e simili
        before = l; break;
      }
      top = {
        title, location: place,
        // impresa solo se c'è la riga «luogo · data» (riquadro di un annuncio): altrimenti sopra il titolo c'è di tutto, per esempio il menu del sito
        company: meta && before && before.length <= 80 && !DOT.test(before) ? before : '',
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

  return {
    url: location.href, title: document.title, h1: txt(document.querySelector('h1')).slice(0, 500),
    og_title: meta('og:title'), og_site: meta('og:site_name'), og_type: meta('og:type'),
    ld: [...document.querySelectorAll('script[type="application/ld+json"]')].slice(0, 20).map(s => s.textContent.slice(0, 200000)),
    micro, site, top, about, best: bestText.slice(0, MAX), sectionHits, apply, jobLinks,
    selection: String(getSelection() || '').trim().slice(0, MAX),
    main: txt(document.querySelector('main, article, [role="main"]') || document.body).slice(0, MAX),
  };
}
