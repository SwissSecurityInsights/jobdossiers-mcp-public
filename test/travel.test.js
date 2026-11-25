import test from 'node:test';
import assert from 'node:assert/strict';
import { travelPair, formatTrip, osmLink, makeTravel, GEO, ROUTE, TRANSIT, STOPS, stopName, workday, durationSeconds } from '../extension/travel.js';

test('viaggio: solo nel paese di residenza e con le due località', () => {
  const prefs = { home_city: '6900 Lugano', home_cc: 'CH' };
  assert.deepEqual(travelPair(prefs, { zipCity: '8750 Glarus', city: 'Glarus', country: 'CH' }), { home: '6900 Lugano', job: '8750 Glarus', cc: 'CH' });
  assert.equal(travelPair(prefs, { city: 'Milano', country: 'IT' }), null, 'altro paese: niente richieste');
  assert.equal(travelPair(prefs, { city: '', country: 'CH' }), null);
  assert.equal(travelPair({ home_cc: 'CH' }, { city: 'Bern', country: 'CH' }), null);
});

test('viaggio: formato e collegamento alla mappa', () => {
  assert.equal(formatTrip({ seconds: 25 * 60, meters: 8400 }), '25 min · 8.4 km');
  assert.equal(formatTrip({ seconds: 10128, meters: 191872 }), '2 h 49 min · 192 km');
  assert.equal(formatTrip({ seconds: 3900, meters: 60000 }), '1 h 05 min · 60 km');
  assert.match(osmLink({ lat: 46, lon: 8.95 }, { lat: 47.04, lon: 9.05 }), /^https:\/\/www\.openstreetmap\.org\/directions\?engine=fossgis_osrm_car&route=46%2C8\.95%3B47\.04%2C9\.05$/);
});

test('viaggio: Nominatim e percorso, con cache e senza altri dati', async () => {
  const calls = [], mem = new Map();
  const fetchFn = async url => {
    calls.push(url);
    if (url.startsWith(GEO)) return { ok: true, json: async () => (/Lugano/.test(decodeURIComponent(url)) ? [{ lat: '46.0037', lon: '8.9511' }] : /Glarus/.test(decodeURIComponent(url)) ? [{ lat: '47.0406', lon: '9.0520' }] : []) };
    if (url.startsWith(ROUTE)) return { ok: true, json: async () => ({ code: 'Ok', routes: [{ duration: 10128, distance: 191872 }] }) };
    throw new Error('host inatteso ' + url);
  };
  let t = 0; const tr = makeTravel({ cache: { get: async k => mem.get(k), set: async (k, v) => mem.set(k, v) }, fetchFn, now: () => (t += 2000) });
  const r = await tr.car({ home: '6900 Lugano', job: '8750 Glarus', cc: 'CH' });
  assert.equal(r.seconds, 10128); assert.equal(r.meters, 191872);
  assert.equal(calls.length, 3);
  assert.match(calls[0], /countrycodes=ch&q=6900%20Lugano$/);
  assert.match(calls[2], /driving\/8\.9511,46\.0037;9\.052,47\.0406\?overview=false$/);
  await tr.car({ home: '6900 Lugano', job: '8750 Glarus', cc: 'CH' });
  assert.equal(calls.length, 3, 'seconda volta dalla cache');
  assert.deepEqual(await tr.car({ home: '6900 Lugano', job: 'Atlantide', cc: 'CH' }), { error: 'job' });
});

test('mezzi pubblici: fermate, giorno feriale, durata, formato', () => {
  assert.equal(stopName('6900 Lugano'), 'Lugano'); assert.equal(stopName('1211 Genève 6'), 'Genève'); assert.equal(stopName('Ecublens VD'), 'Ecublens VD');
  assert.equal(workday(Date.parse('2026-11-27T10:00:00Z')), '2026-12-01', 'venerdì → martedì');
  assert.equal(workday(Date.parse('2026-12-01T10:00:00Z')), '2026-12-02');
  assert.equal(durationSeconds('00d02:43:00'), 9780); assert.ok(Number.isNaN(durationSeconds('')));
  assert.equal(formatTrip({ seconds: 9780, transfers: 2 }), '2 h 43 min · 2 cambi');
  assert.equal(formatTrip({ seconds: 2700, transfers: 1 }), '45 min · 1 cambio');
  assert.equal(formatTrip({ seconds: 2700, transfers: 0 }), '45 min · diretto');
});

test('mezzi pubblici: dalle coordinate alla stazione vicina, il collegamento più breve tra le 7 e le 9, con cache', async () => {
  const calls = [], mem = new Map();
  const fetchFn = async url => {
    calls.push(url); const u = new URL(url);
    if (url.startsWith(GEO)) return { ok: true, json: async () => (/Lugano/.test(u.searchParams.get('q')) ? [{ lat: '46.0037', lon: '8.9511', name: 'Lugano' }] : [{ lat: '47.0502', lon: '8.3093', name: 'Luzern' }]) };
    if (url.startsWith(STOPS) && u.searchParams.get('query') === 'Luzern') return { ok: true, json: async () => ({ stations: [{ id: '8505000', name: 'Luzern', coordinate: { x: 47.0502, y: 8.3101 } }] }) };
    if (url.startsWith(STOPS) && u.searchParams.get('query')) return { ok: true, json: async () => ({ stations: u.searchParams.get('query') === 'Lucerne'
      ? [{ id: '8504986', name: 'Lucens', coordinate: { x: 46.709, y: 6.838 } }]                        // altro paese, a 120 km: scartato
      : [{ id: '8589002', name: 'Lugano, Centro', coordinate: { x: 46.006, y: 8.952 } }] }) };          // non «Lugano» da solo? sì: primo nome uguale
    if (url.startsWith(STOPS)) {
      assert.fail('fermate per coordinate non necessarie qui');
      return { ok: true, json: async () => ({ stations: u.searchParams.get('x') === '46.0037'
        ? [] : [{ id: '8508450', name: 'Luzern, Bahnhof', icon: 'bus', distance: 30 }, { id: '8505000', name: 'Luzern', icon: 'train', distance: 67 }] }) };
    }
    if (url.startsWith(TRANSIT)) {
      assert.equal(u.searchParams.get('from'), '8589002', 'per nome, vicino al punto');
      assert.equal(u.searchParams.get('to'), '8505000', '«Lucerne»: non «Lucens» (lontano), ma «Luzern», il nome locale di OpenStreetMap'); assert.equal(u.searchParams.get('date'), '2026-12-01');
      return { ok: true, json: async () => ({ from: { name: 'Lugano' }, to: { name: 'Luzern' }, connections: [
        { from: { departure: '2026-12-01T06:02:00+0100' }, duration: '00d02:00:00', transfers: 1 },
        { from: { departure: '2026-12-01T07:02:00+0100' }, duration: '00d02:13:00', transfers: 1 },
        { from: { departure: '2026-12-01T07:30:00+0100' }, duration: '00d02:45:00', transfers: 2 }] }) };
    }
    throw new Error('host inatteso ' + url);
  };
  let t = Date.parse('2026-11-27T10:00:00Z');
  const tr = makeTravel({ cache: { get: async k => mem.get(k), set: async (k, v) => mem.set(k, v) }, fetchFn, now: () => (t += 2000) });
  assert.deepEqual(await tr.transit({ home: '6900 Lugano', job: 'Lucerne', cc: 'CH' }), { seconds: 7980, transfers: 1, from: 'Lugano', to: 'Luzern' });
  const n = calls.length;
  await tr.transit({ home: '6900 Lugano', job: 'Lucerne', cc: 'CH' });
  assert.equal(calls.length, n, 'seconda volta dalla cache');
  assert.deepEqual(await tr.transit({ home: 'Milano', job: 'Torino', cc: 'IT' }), { error: 'country' });
  assert.equal(calls.length, n, 'fuori dalla Svizzera nessuna richiesta');
});

test('ripiego per nome: la fermata deve avere quel nome («Lucerne» non è «Lucens»)', async () => {
  const fetchFn = async url => {
    if (url.startsWith(GEO)) throw new TypeError('Failed to fetch');
    return { ok: true, json: async () => ({ stations: [{ name: 'Lucens', coordinate: { x: 46.7, y: 6.8 } }] }) };
  };
  const tr = makeTravel({ cache: { get: async () => undefined, set: async () => {} }, fetchFn, now: () => 0 });
  await assert.rejects(tr.geocode('Lucerne', 'CH'), /Failed to fetch/);
});

test('viaggio in Svizzera: se Nominatim non risponde, coordinate della fermata', async () => {
  const fetchFn = async url => {
    if (url.startsWith(GEO)) throw new TypeError('Failed to fetch');
    if (url.startsWith(STOPS)) { assert.match(url, /query=Lugano$/); return { ok: true, json: async () => ({ stations: [{ name: 'Lugano', coordinate: { x: 46.005502, y: 8.946996 } }] }) }; }
    throw new Error('host inatteso ' + url);
  };
  const mem = new Map();
  const tr = makeTravel({ cache: { get: async k => mem.get(k), set: async (k, v) => mem.set(k, v) }, fetchFn, now: () => 0 });
  assert.deepEqual(await tr.geocode('6900 Lugano', 'CH'), { lat: 46.0055, lon: 8.947 });
  await assert.rejects(tr.geocode('Milano', 'IT'), /Failed to fetch/, 'fuori dalla Svizzera nessun ripiego');
});
