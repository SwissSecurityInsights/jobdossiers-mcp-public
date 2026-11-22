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
    micro, site, best: bestText.slice(0, MAX), sectionHits, apply, jobLinks,
    selection: String(getSelection() || '').trim().slice(0, MAX),
    main: txt(document.querySelector('main, article, [role="main"]') || document.body).slice(0, MAX),
  };
}
