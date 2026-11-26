/**
 * Tempo di viaggio in auto tra la tua località e quella dell'annuncio, con OpenStreetMap:
 * Nominatim trova le coordinate, il server di percorsi di FOSSGIS (quello di openstreetmap.org) calcola il tragitto.
 * Solo se l'annuncio è nel tuo paese di residenza e solo con il tuo consenso: a OpenStreetMap vanno le due località, nient'altro.
 * Mezzi pubblici: solo in Svizzera, con transport.opendata.ch (orari dei trasporti pubblici svizzeri, FFS comprese).
 */
export const GEO = 'https://nominatim.openstreetmap.org/search';
export const ROUTE = 'https://routing.openstreetmap.de/routed-car/route/v1/driving/';
export const TRANSIT = 'https://transport.opendata.ch/v1/connections';
export const STOPS = 'https://transport.opendata.ch/v1/locations';
const DAY = 864e5;
const fold = x => String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** Distanza in linea d'aria, km */
export function km(a, b) {
  const r = x => x * Math.PI / 180, dLat = r(b.lat - a.lat), dLon = r(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

/** Paesi con il calcolo dei mezzi pubblici. */
export const TRANSIT_CC = new Set(['CH']);

/** «6900 Lugano» → «Lugano»: transport.opendata.ch cerca le fermate per nome, con l'NPA trova anche le vie. */
export const stopName = s => String(s || '').replace(/^\d{4,5}\s+/, '').replace(/\s+\d{1,2}$/, '').trim();

/** Prossimo giorno feriale da martedì a giovedì (orari tipici, non quelli del weekend o dei ponti), AAAA-MM-GG. */
export function workday(now = Date.now()) {
  const d = new Date(now);
  do d.setUTCDate(d.getUTCDate() + 1); while (![2, 3, 4].includes(d.getUTCDay()));
  return d.toISOString().slice(0, 10);
}

/** «00d01:23:00» → secondi */
export function durationSeconds(s) {
  const m = String(s || '').match(/^(\d+)d(\d{2}):(\d{2}):(\d{2})$/);
  return m ? ((Number(m[1]) * 24 + Number(m[2])) * 60 + Number(m[3])) * 60 + Number(m[4]) : NaN;
}


/** Le due località da confrontare, o null se non si calcola (paese diverso, dati mancanti). */
export function travelPair(prefs, facts) {
  const p = prefs || {}, j = facts || {};
  const home = String(p.home_city || '').trim(), cc = String(p.home_cc || '').toUpperCase();
  const job = String(j.zipCity || j.city || '').trim();
  if (!home || !job || !cc || String(j.country || '').toUpperCase() !== cc) return null;
  return { home, job, cc };
}

/** «1 h 25 min · 112 km» */
export function formatTrip(t) {
  const m = Math.max(1, Math.round(t.seconds / 60)), h = Math.floor(m / 60);
  const km = t.meters >= 10000 ? Math.round(t.meters / 1000) : Math.round(t.meters / 100) / 10;
  const time = `${h ? `${h} h ` : ''}${h ? String(m % 60).padStart(2, '0') : m} min`;
  if (t.meters == null) return `${time}${t.transfers != null ? ` · ${t.transfers ? `${t.transfers} cambi${t.transfers === 1 ? 'o' : ''}` : 'diretto'}` : ''}`;
  return `${time} · ${km} km`;
}

/** Collegamento al percorso su openstreetmap.org, per verificarlo sulla mappa. */
export function osmLink(a, b) {
  return `https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=${a.lat}%2C${a.lon}%3B${b.lat}%2C${b.lon}`;
}

/** cache: { get(k) → valore|undefined, set(k, v) } (chrome.storage.local nel pannello). fetchFn per i test. */
export function makeTravel({ cache, fetchFn = fetch, now = () => Date.now() }) {
  let last = 0;
  const polite = async () => {                       // Nominatim: al massimo una richiesta al secondo
    const wait = last + 1100 - now(); if (wait > 0) await new Promise(r => setTimeout(r, wait));
    last = now();
  };
  async function geocode(q, cc) {
    const key = `geo2:${cc}:${q.toLowerCase()}`;
    const hit = await cache.get(key);
    if (hit && now() - hit.at < 30 * DAY) return hit.v;
    let v = null, err = null;
    try {
      await polite();
      const u = `${GEO}?format=jsonv2&limit=1&namedetails=1&countrycodes=${encodeURIComponent(cc.toLowerCase())}&q=${encodeURIComponent(q)}`;
      const r = await fetchFn(u);
      if (!r.ok) throw new Error(`geocodifica: HTTP ${r.status}`);
      const [d] = await r.json();
      v = d ? { lat: Number(Number(d.lat).toFixed(5)), lon: Number(Number(d.lon).toFixed(5)), name: String(d.namedetails?.name || d.name || '') } : null;     // nome locale («Genève», «Luzern»), utile per le fermate
    } catch (e) { err = e; }
    // Svizzera: se Nominatim non risponde o non trova, la fermata dei trasporti pubblici con lo stesso nome
    if (!v && cc === 'CH') {
      try {
        const r = await fetchFn(`${STOPS}?type=station&query=${encodeURIComponent(stopName(q))}`);
        const want = fold(stopName(q)).split(/[\s,]+/)[0];
        const c = r.ok ? (await r.json()).stations?.find(x => x.coordinate?.x && fold(x.name).split(/[\s,]+/)[0] === want)?.coordinate : null;
        if (c) { v = { lat: Number(Number(c.x).toFixed(5)), lon: Number(Number(c.y).toFixed(5)) }; err = null; }
      } catch { /* resta l'errore di Nominatim */ }
    }
    if (err && !v) throw err;
    await cache.set(key, { at: now(), v });
    return v;
  }
  /** { seconds, meters, from, to } oppure { error: 'home'|'job'|'route' } */
  async function car(pair) {
    const from = await geocode(pair.home, pair.cc); if (!from) return { error: 'home' };
    const to = await geocode(pair.job, pair.cc); if (!to) return { error: 'job' };
    const key = `car:${from.lat},${from.lon};${to.lat},${to.lon}`;
    const hit = await cache.get(key);
    if (hit && now() - hit.at < 30 * DAY) return { ...hit.v, from, to };
    const r = await fetchFn(`${ROUTE}${from.lon},${from.lat};${to.lon},${to.lat}?overview=false`);
    if (!r.ok) return { error: 'route' };
    const d = await r.json();
    const rt = d.code === 'Ok' && d.routes?.[0];
    if (!rt) return { error: 'route' };
    const v = { seconds: rt.duration, meters: rt.distance };
    await cache.set(key, { at: now(), v });
    return { ...v, from, to };
  }
  /** Mezzi pubblici: il collegamento più breve partendo tra le 7 e le 9 di un giorno feriale. { seconds, transfers } oppure { error } */
  async function transit(pair) {
    if (!TRANSIT_CC.has(pair.cc)) return { error: 'country' };
    // stesse coordinate dell'auto: i nomi in altre lingue («Lucerne») cercati come fermata danno altri paesi («Lucens»)
    const a = await geocode(pair.home, pair.cc); if (!a) return { error: 'home' };
    const b = await geocode(pair.job, pair.cc); if (!b) return { error: 'job' };
    const from = await station(a, pair.home), to = await station(b, pair.job);
    if (!from || !to) return { error: 'route' };
    const key = `pt:${from.id};${to.id}`;
    const hit = await cache.get(key);
    if (hit && now() - hit.at < 30 * DAY) return hit.v;
    const q = new URLSearchParams({ from: from.id, to: to.id, date: workday(now()), time: '07:00', limit: '6' });
    for (const f of ['connections/duration', 'connections/transfers', 'connections/from/departure', 'from/name', 'to/name']) q.append('fields[]', f);
    const r = await fetchFn(`${TRANSIT}?${q}`);
    if (!r.ok) throw new Error(`orari: HTTP ${r.status}`);
    const d = await r.json();
    const ok = (d.connections || []).filter(c => /T0[789]:/.test(c.from?.departure || '')).map(c => ({ seconds: durationSeconds(c.duration), transfers: c.transfers }))
      .filter(c => c.seconds > 0).sort((x, y) => x.seconds - y.seconds);
    const v = ok[0] ? { ...ok[0], from: d.from?.name || from.name, to: d.to?.name || to.name } : { error: 'route' };
    await cache.set(key, { at: now(), v });
    return v;
  }
  /**
   * Fermata per il calcolo: prima quella con il nome della località («Glarus», «Genève», «Zürich HB»), se è entro 10 km dal punto
   * di OpenStreetMap (così «Lucerne» non diventa «Lucens»); altrimenti la stazione ferroviaria entro 2 km, poi la fermata più vicina.
   */
  async function station(c, name) {
    const key = `st:${c.lat},${c.lon}:${fold(name)}`;
    const hit = await cache.get(key);
    if (hit && now() - hit.at < 30 * DAY) return hit.v;
    let s = null;
    // il nome scritto nell'annuncio («Lucerne», «Geneva») e quello locale di OpenStreetMap («Luzern», «Genève»)
    for (const n of [...new Set([stopName(name), c.name].filter(Boolean))]) {
      const want = fold(n).split(/[\s,]+/)[0]; if (!want || s) continue;
      const r = await fetchFn(`${STOPS}?type=station&query=${encodeURIComponent(n)}`);
      const list = r.ok ? (await r.json()).stations || [] : [];
      s = list.find(x => x.id && x.coordinate?.x && fold(x.name).split(/[\s,]+/)[0] === want && km(c, { lat: x.coordinate.x, lon: x.coordinate.y }) <= 10);
    }
    if (!s) {
      const r = await fetchFn(`${STOPS}?type=station&x=${c.lat}&y=${c.lon}`);
      if (!r.ok) throw new Error(`fermate: HTTP ${r.status}`);
      const list = ((await r.json()).stations || []).filter(x => x.id);
      s = list.find(x => x.icon === 'train' && Number(x.distance) <= 2000) || list[0];
    }
    const v = s ? { id: String(s.id), name: s.name } : null;
    await cache.set(key, { at: now(), v });
    return v;
  }
  return { geocode, car, transit };
}
