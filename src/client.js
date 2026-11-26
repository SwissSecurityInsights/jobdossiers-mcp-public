/* Livello dati: decifra le candidature, applica le regole dell'agente e salva riga per riga con controllo di versione. */
import { realpath, stat, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, extname, isAbsolute, join, sep } from 'node:path';
import { PROFILE_KIND, SECTIONS, cleanProfile } from './profile.js';
import { AAD, openDek, encObj, decObj, encBytes, decBytes } from './crypto.js';
import { ApiError } from './api.js';
import { findDuplicates, noteLog } from './dedupe.js';
import { PREFS_KIND, cleanPrefs } from './prefs.js';

/** Ordine di openapi.json (Status). 'preparing': analisi in corso, il portale la porta a 'to_send'. 'deleted': tolta dalla lista, ripristinabile.
 *  'interview' dal 28.10.2026 sostituisce hr_interview e tech_interview. */
export const STATUSES = ['preparing', 'to_send', 'sent', 'in_review', 'interview', 'offer', 'rejected', 'withdrawn', 'no_answer', 'deleted'];
/** Nomi vecchi che il portale accetta ancora in ingresso e salva come 'interview' (LEGACY_STATUS in jobdossiers.ch); qui valgono lo stesso. */
export const LEGACY_STATUS = Object.freeze({ hr_interview: 'interview', tech_interview: 'interview' });
export const normStatus = s => LEGACY_STATUS[s] ?? s;
/** Stati che l'agente può impostare da solo (da posta e da ricerca). 'sent' e 'withdrawn' li decide l'utente; 'deleted' non elimina, la cancellazione definitiva la fa solo il portale. */
export const AGENT_STATUSES = ['preparing', 'in_review', 'interview', 'offer', 'rejected', 'no_answer', 'deleted'];
export const AUTOMATION = ['', 'full', 'assisted', 'not possible'];
export const RAV = ['', 'SI', 'NO'];
/** Campi del record cifrato che l'agente non scrive mai direttamente. */
const PROTECTED = new Set(['note_log', 'notes', 'id', 'version', '__proto__', 'constructor', 'prototype',
  // calcolati o gestiti dal portale: l'agente li legge soltanto
  'job_check', 'match', 'jr_result', 'jr_interview']);
const MAX_FIELD = 200000;
/** Documenti che l'agente carica: solo CV e lettera di una candidatura. */
export const DOC_KINDS = ['cv', 'letter'];
/** Stati in cui l'agente può caricare CV e lettera, sempre e solo se per quel tipo non c'è ancora nessun documento (mai sostituire). Gli altri (offer, rejected,
 *  withdrawn, no_answer, deleted) restano bloccati con docs_locked. Unico elenco: lo usano il controllo, i messaggi e la descrizione dello strumento.
 *  Il portale dal 28.10.2026 usa «interview» al posto di hr_interview e tech_interview (LEGACY_STATUS in jobdossiers.ch): ammessi tutti e tre. */
export const DOC_UPLOAD_STATUSES = ['preparing', 'to_send', 'sent', 'in_review', 'interview', 'hr_interview', 'tech_interview'];
/** Stati dopo l'invio tra quelli ammessi: un caricamento qui lascia una nota [agente] nella scheda. */
const DOC_NOTE_STATUSES = DOC_UPLOAD_STATUSES.filter(s => s !== 'preparing' && s !== 'to_send');
const DOC_LABEL = { cv: 'un CV', letter: 'una lettera' };
const DOC_TYPES = { '.pdf': 'application/pdf', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
const DOC_MAX = 6 * 1024 * 1024 - 28;     // limite del portale sul file cifrato (IV e tag compresi)
/** Caricamenti dell'agente all'ora sul portale (Agent::UPLOAD_HOUR_LIMIT, finestra mobile di 60 minuti): il contatore è lì, qui serve solo per i messaggi. */
export const UPLOAD_HOUR_LIMIT = 30;
/** Agenda: appuntamenti liberi, un blob cifrato ciascuno (AAD jd1:agenda) con {v, title, at, kind, place, who, note, app}. */
export const AGENDA_KINDS = ['informal', 'call', 'network', 'other'];
const AGENDA_TEXT = { title: 300, place: 500, who: 500, note: 5000 };
const invalid = message => new ApiError('invalid_value', { message });

const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const clip = (s, n) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n) + '…' : s; };

export class Dossier {
  constructor({ api, secret, now = () => new Date(), ttlMs = 20000 }) {
    Object.assign(this, { api, secret, now, ttlMs });
    this._dek = null;
    this._cache = null;
  }

  today() { return this.now().toLocaleDateString('sv-SE', { timeZone: 'Europe/Zurich' }); }

  async dek() {
    if (this._dek) return this._dek;
    const j = await this.api.call('agent_keys');
    try { this._dek = await openDek(this.secret, j.wrapped_dek); }
    catch { throw new ApiError('bad_secret', { message: 'Il segreto non apre la chiave dati: la chiave è sbagliata o è stata ricreata' }); }
    return this._dek;
  }

  async load(force = false) {
    if (!force && this._cache && this.now().getTime() - this._cache.at < this.ttlMs) return this._cache;
    const j = await this.api.call('app_list');
    const k = await this.dek();
    const items = [];
    for (const row of j.rows || []) {
      let d = {}, bad = false;
      if (row.enc) { try { d = await decObj(k, row.enc, AAD.app); } catch { bad = true; } }
      items.push({ row, d, bad });
    }
    this._cache = { at: this.now().getTime(), items, quota: j.quota ?? null, editable: j.editable ?? null };
    return this._cache;
  }

  static view(item, { full = false } = {}) {
    const { row, d } = item;
    const notes = noteLog(d).filter(n => n.text);
    const o = {
      id: row.id, pos: row.pos, version: row.version, status: row.status,
      applied_on: row.applied_on ?? null, status_changed_on: row.status_changed_on ?? null,
      automation: row.automation || '', rav: row.rav || '', jobroom_registered_on: row.jobroom_registered_on ?? null,
      company: d.company || '', role: d.role || '', employer_zip_city: d.employer_zip_city || '', employer_address: d.employer_address || '',
      job_url: d.job_url || '', apply_url: d.apply_url || '', employer_country: d.employer_country || '',
      last_note: notes.length ? clip(notes[notes.length - 1].text, 300) : '',
    };
    if (row.ro) o.read_only = true;
    if (item.bad) o.unreadable = true;
    if (full) {
      for (const [k, v] of Object.entries(d)) if (!(k in o) && k !== 'note_log' && k !== 'notes' && k !== 'job_desc') o[k] = v;
      o.notes = notes.slice(-30).map(n => (n.at ? n.at.slice(0, 16).replace('T', ' ') + ': ' : '') + n.text);
    }
    return o;
  }

  async list({ status, query, incomplete, missingDocs, limit = 100 } = {}) {
    const { items, quota } = await this.load();
    let have = null;
    if (missingDocs) {
      const { docs } = await this.docs();
      have = new Map();
      for (const x of docs) if (x.application_id) { const s = have.get(x.application_id) || new Set(); s.add(x.kind); have.set(x.application_id, s); }
    }
    const q = query ? String(query).toLowerCase() : '';
    let rows = items.filter(x => (!status || normStatus(x.row.status) === normStatus(status))
      && (!q || (x.d.company + ' ' + x.d.role + ' ' + (x.d.employer_zip_city || '')).toLowerCase().includes(q))
      && (!incomplete || ((x.row.status === 'preparing' || x.row.status === 'to_send') && (!x.d.role || /^da completare\b/i.test(x.d.company || ''))))
      && (!have || (x.row.status === 'to_send' && !x.row.ro && (!have.get(x.row.id)?.has('cv') || !have.get(x.row.id)?.has('letter')))));
    rows = rows.sort((a, b) => b.row.pos - a.row.pos);
    return { total: items.length, matched: rows.length, rows: rows.slice(0, Math.min(limit, 300)).map(x => { const v = Dossier.view(x); if (have) v.missing_docs = ['cv', 'letter'].filter(k => !have.get(x.row.id)?.has(k)); return v; }), quota };
  }

  async get(id, { includeJobDesc = false } = {}) {
    const { items } = await this.load();
    const item = items.find(x => x.row.id === id);
    if (!item) throw new ApiError('not_found', { message: 'Scheda non trovata' });
    const v = Dossier.view(item, { full: true });
    if (includeJobDesc && item.d.job_desc) v.job_desc = item.d.job_desc;
    else if (item.d.job_desc) v.job_desc_chars = String(item.d.job_desc).length;
    await this.resolveContacts(v);
    return v;
  }

  /** Persone della Rete (net_list, AAD jd1:net), per id. Nome e recapiti stanno solo qui dal 13.11.2026. */
  async network() {
    const j = await this.api.call('net_list');
    const k = await this.dek();
    const people = new Map();
    for (const it of j.items || []) {
      let p = null;
      try { p = await decObj(k, it.enc, AAD.net); } catch { p = null; }
      people.set(it.id, p);
    }
    return people;
  }

  /**
   * Contatti visti nell'annuncio (LinkedIn, «Meet the hiring team») → persone della Rete e riferimenti nella scheda.
   * Una persona già nella Rete (stesso profilo, oppure stesso nome e stessa società) non si duplica. La scheda riceve solo {id, net, role}.
   * people: [{name, role, link, poster}], tutto testo della pagina: si accetta solo il necessario e solo link a profili LinkedIn.
   */
  async addContacts(appId, people, now = this.now()) {
    const list = Dossier.cleanPeople(people);
    if (!list.length) throw invalid('Nessun contatto valido (servono nome e, se c\'è, un link a un profilo LinkedIn)');
    const { items } = await this.load(true);
    const app = items.find(x => x.row.id === appId);
    if (!app) throw new ApiError('not_found', { message: 'Scheda non trovata' });
    if (app.bad) throw new ApiError('unreadable', { message: 'Scheda non decifrabile: non la modifico' });
    const company = String(app.d.company || '').slice(0, 120);
    const k = await this.dek();
    const net = [];
    for (const it of (await this.api.call('net_list')).items || []) { try { net.push({ rid: it.id, p: await decObj(k, it.enc, AAD.net) }); } catch { /* voce non leggibile: non si tocca */ } }
    const fold = v => String(v || '').normalize('NFD').replace(/\p{M}/gu, '').replace(/\s+/g, ' ').trim().toLowerCase();
    const slug = v => (String(v || '').match(/linkedin\.com\/in\/([^/?#]+)/i)?.[1] || '').toLowerCase();
    const day = now.toISOString().slice(0, 10);
    const refs = []; let created = 0;
    for (const c of list) {
      let hit = net.find(r => r.p && c.link && slug(r.p.link) && slug(r.p.link) === slug(c.link))
        || net.find(r => r.p && fold(r.p.name) === fold(c.name) && (!fold(r.p.org) || !company || fold(r.p.org) === fold(company)));
      if (!hit) {
        const p = { v: 1, name: c.name, kind: /talent|recruit|\bhr\b|human resources|people|personal|acquisition|hiring|selezione|risorse umane/i.test(c.role) ? 'recruiter' : 'insider',
          org: company, role: c.role, email: '', phone: '', link: c.link, note: `Dall'annuncio «${String(app.d.role || '').slice(0, 100)}» (${company}), estensione Jobdossiers.`.slice(0, 2000),
          log: [] };
        const j = await this.api.call('net_save', { enc: await encObj(k, p, AAD.net) });
        hit = { rid: j.id, p }; net.push(hit); created++;
      }
      refs.push({ net: hit.rid, role: c.poster ? 'Job poster' : 'Hiring team', name: c.name });
    }
    let linked = 0; const already = [];
    await this.update(appId, d => {
      const cur = Array.isArray(d.contacts_list) ? d.contacts_list.filter(x => x && typeof x === 'object') : [];
      linked = 0; already.length = 0;
      for (const r of refs) {
        if (cur.some(x => x.net === r.net)) { already.push(r.name); continue; }
        cur.push({ id: newId(), net: r.net, role: r.role }); linked++;
      }
      d.contacts_list = cur;
    });
    return { created, linked, already, day };
  }

  /** Persone della Rete che lavorano nell'impresa dell'annuncio (per il pannello dell'estensione): solo nome, tipo e ruolo, mai recapiti né note. */
  async networkAt(company) {
    const want = Dossier.companyCore(company);
    if (want.length < 3) return { people: [] };
    const out = [];
    for (const [, p] of await this.network()) {
      if (!p || typeof p.name !== 'string' || !p.name) continue;
      const org = Dossier.companyCore(p.org);
      if (org.length >= 3 && (org === want || ` ${org} `.includes(` ${want} `) || ` ${want} `.includes(` ${org} `))) out.push({ name: p.name.slice(0, 120), kind: String(p.kind || ''), role: String(p.role || '').slice(0, 120) });
      if (out.length >= 10) break;
    }
    return { people: out };
  }

  /** Candidature già presenti nella stessa impresa (pannello dell'estensione): ruolo, stato e date, mai note, contatti né testo. */
  async companyHistory(company) {
    const want = Dossier.companyCore(company);
    if (want.length < 3) return { applications: [] };
    const { items } = await this.load();
    const out = [];
    for (const { row, d, bad } of items) {
      if (bad || normStatus(row.status) === 'deleted') continue;
      const org = Dossier.companyCore(d.company);
      if (org.length < 3 || !(org === want || ` ${org} `.includes(` ${want} `) || ` ${want} `.includes(` ${org} `))) continue;
      out.push({ id: row.id, role: String(d.role || '').slice(0, 150), status: normStatus(row.status), applied_on: row.applied_on || '', changed_on: row.status_changed_on || '' });
    }
    out.sort((a, b) => String(b.changed_on || b.applied_on).localeCompare(String(a.changed_on || a.applied_on)));
    return { applications: out.slice(0, 10) };
  }

  /** «Swiss Life Group AG» → «swiss life»: senza forma giuridica, gruppo e paese, per riconoscere la stessa impresa scritta in modi diversi. */
  static companyCore(s) {
    return String(s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9& ]+/g, ' ')
      .replace(/\b(ag|sa|gmbh|ltd|limited|inc|llc|plc|sarl|sagl|spa|srl|bv|nv|se|kg|co|corp|corporation|company|group|gruppe|groupe|gruppo|holding|schweiz|switzerland|suisse|svizzera|swiss branch|international)\b/g, ' ')
      .replace(/\s+/g, ' ').trim();
  }

  static cleanPeople(people) {
    const line = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
    const out = [];
    for (const c of Array.isArray(people) ? people.slice(0, 10) : []) {
      if (!c || typeof c !== 'object') continue;
      const name = line(c.name, 120); if (!name) continue;
      const m = line(c.link, 300).match(/^https:\/\/([a-z]{2,3}\.)?(www\.)?linkedin\.com\/in\/([^/?#\s]+)\/?$/i);
      out.push({ name, role: line(c.role, 120), link: m ? `https://www.linkedin.com/in/${m[3]}/` : '', poster: c.poster === true });
    }
    return out;
  }

  static personView(p) {
    const o = {};
    for (const k of ['name', 'kind', 'org', 'role', 'email', 'phone', 'link']) if (typeof p[k] === 'string' && p[k]) o[k] = p[k];
    return o;
  }

  /** contacts_list contiene riferimenti {id, net, role}: a ognuno si aggiunge person, letta dalla Rete; `via` (id di una persona) diventa anche via_person.
   *  Le voci nel formato vecchio {id, name, role, email, phone} (schede salvate prima del 13.11.2026) restano come sono, con legacy: true. */
  async resolveContacts(v) {
    const refs = Array.isArray(v.contacts_list) ? v.contacts_list : [];
    const needs = refs.some(c => c && typeof c.net === 'string' && c.net) || (typeof v.via === 'string' && v.via);
    if (!refs.length && !needs) return v;
    let people = null;
    if (needs) {
      try { people = await this.network(); } catch (e) { v.network_error = e.code || 'error'; }
    }
    const resolve = netId => {
      if (!people) return { unresolved: true };
      if (!people.has(netId)) return { missing_in_network: true };
      const p = people.get(netId);
      return p ? Dossier.personView(p) : { unreadable: true };
    };
    if (Array.isArray(v.contacts_list)) {
      v.contacts_list = refs.map(c => {
        if (!c || typeof c !== 'object') return c;
        if (typeof c.net === 'string' && c.net) return { ...c, person: resolve(c.net) };
        return { ...c, legacy: true };
      });
    }
    if (typeof v.via === 'string' && v.via) v.via_person = resolve(v.via);
    return v;
  }

  /** Preferenze di lavoro (documento «prefs» del Profilo), decifrate e ripulite secondo lo schema. Sola lettura. */
  async preferences() {
    const j = await this.api.call('doc_list');
    const doc = (j.docs || []).filter(x => x.kind === PREFS_KIND).sort((a, b) => (b.created_at || 0) - (a.created_at || 0))[0];
    if (!doc) return { saved: false, message: "L'utente non ha ancora salvato preferenze di lavoro: si impostano in Jobdossiers, nel Profilo, scheda «Preferenze»." };
    const k = await this.dek();
    const bytes = await this.api.bytes('doc_get', { id: doc.id }, { max: 1024 * 1024 });
    let raw;
    try { raw = JSON.parse(new TextDecoder().decode(await decBytes(k, bytes, AAD.doc))); }
    catch { throw new ApiError('unreadable', { message: 'Documento delle preferenze non decifrabile o non in formato JSON' }); }
    const { prefs, dropped } = cleanPrefs(raw);
    const out = { saved: true, preferences: prefs };
    if (dropped.length) out.dropped_fields = dropped;
    return out;
  }

  /** Profilo professionale (documento cv_profile), solo le sezioni ammesse da src/profile.js. Sola lettura, nulla su disco né nei log. */
  async profile(sections = SECTIONS) {
    let j;
    try { j = await this.api.call('doc_list'); }
    catch (e) { if (e.code === 'agent_scope') return { ok: true, omitted: sections, message: 'La chiave per automazioni non può leggere i documenti: profilo non disponibile.' }; throw e; }
    const doc = (j.docs || []).filter(x => x.kind === PROFILE_KIND && !x.application_id).sort((a, b) => (b.created_at || 0) - (a.created_at || 0))[0];
    if (!doc) return { ok: true, saved: false, message: "L'utente non ha ancora salvato un profilo: si crea in Jobdossiers, nella pagina Profilo." };
    let bytes;
    try { bytes = await this.api.bytes('doc_get', { id: doc.id }, { max: 1024 * 1024 }); }
    catch (e) { if (e.code === 'agent_scope') return { ok: true, omitted: sections, message: 'La chiave per automazioni non può leggere il profilo.' }; throw e; }
    let raw;
    try { raw = JSON.parse(new TextDecoder().decode(await decBytes(await this.dek(), bytes, AAD.doc))); }
    catch { throw new ApiError('unreadable', { message: 'Documento del profilo non decifrabile o non in formato JSON' }); }
    const { profile, truncated } = cleanProfile(raw, sections);
    return { ok: true, saved: true, profile, ...(truncated && { truncated: true }) };
  }

  async findDuplicates(cand) {
    const { items } = await this.load();
    return findDuplicates(items, cand);
  }

  static checkFields(fields) {
    if (fields === undefined) return {};
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) throw new ApiError('invalid_value', { message: 'fields deve essere un oggetto' });
    for (const [k, v] of Object.entries(fields)) {
      if (PROTECTED.has(k)) throw new ApiError('invalid_value', { message: `Il campo ${k} non si scrive direttamente (le note si aggiungono con jd_add_note)` });
      if (JSON.stringify(v ?? null).length > MAX_FIELD) throw new ApiError('invalid_value', { message: `Il campo ${k} è troppo lungo` });
    }
    if ('contacts_list' in fields) Dossier.checkContacts(fields.contacts_list);
    return fields;
  }

  /** Dal 13.11.2026 contacts_list contiene solo riferimenti {id, net, role}: nome e recapiti stanno nella Rete, che questo server non modifica. */
  static checkContacts(list) {
    const ok = Array.isArray(list) && list.every(c => c && typeof c === 'object' && !Array.isArray(c)
      && typeof c.net === 'string' && c.net && Object.keys(c).every(k => ['id', 'net', 'role'].includes(k))
      && ['id', 'role'].every(k => c[k] === undefined || typeof c[k] === 'string'));
    if (!ok) throw invalid('contacts_list contiene solo riferimenti {id, net, role} a persone già nella Rete dell\'utente (net = id della persona): nome e recapiti stanno nella Rete, non nella scheda');
  }

  static checkPlain({ automation, rav } = {}) {
    const plain = {};
    if (automation !== undefined) { if (!AUTOMATION.includes(automation)) throw new ApiError('invalid_value', { message: 'automation non valido' }); plain.automation = automation; }
    if (rav !== undefined) { if (!RAV.includes(rav)) throw new ApiError('invalid_value', { message: 'rav non valido' }); plain.rav = rav; }
    return plain;
  }

  async create(input) {
    const fields = Dossier.checkFields(input.fields);
    const plain = { ...Dossier.checkPlain(input), status: 'preparing', status_changed_on: this.today() };
    const { items } = await this.load(true);
    const dup = findDuplicates(items, { company: input.company, role: input.role, urls: [input.job_url, input.apply_url], text: input.note });
    if (dup.length) throw new ApiError('duplicate', { message: 'Esiste già: ' + dup.map(x => `${x.id} (${x.reason})`).join(', ') });
    const d = { ...fields };
    for (const k of ['company', 'role', 'employer_zip_city', 'employer_address', 'job_url', 'apply_url', 'employer_country', 'job_desc']) if (input[k] !== undefined && input[k] !== '') d[k] = input[k];
    if (input.note) d.note_log = [{ id: newId(), at: this.now().toISOString(), text: '[agente] ' + input.note }];
    const enc = await encObj(await this.dek(), d, AAD.app);
    const j = await this.api.call('app_save', { enc, plain });
    this._cache = null;
    return { id: j.id, version: j.version };
  }

  /** Read-modify-write di una scheda; su conflitto di versione rilegge e riapplica (al massimo 3 tentativi). */
  async update(id, mutate, plain = {}) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const { items } = await this.load(attempt > 0);
      const item = items.find(x => x.row.id === id);
      if (!item) throw new ApiError('not_found', { message: 'Scheda non trovata' });
      if (item.row.ro) throw new ApiError('read_only', { message: 'Scheda in sola consultazione (piano Basic)' });
      if (item.bad) throw new ApiError('unreadable', { message: 'Scheda non decifrabile: non la modifico' });
      const d = structuredClone(item.d);
      mutate(d, item);
      const enc = await encObj(await this.dek(), d, AAD.app);
      try {
        const j = await this.api.call('app_save', { id, version: item.row.version, enc, plain });
        item.row.version = j.version; item.d = d; Object.assign(item.row, plain);
        return { id, version: j.version };
      } catch (e) {
        if (e.code === 'conflict' && attempt < 2) { this._cache = null; continue; }
        throw e;
      }
    }
  }

  textNote(text) { return { id: newId(), at: this.now().toISOString(), text: '[agente] ' + text }; }

  async updateFields(id, { fields, note, automation, rav }) {
    const f = Dossier.checkFields(fields);
    const plain = Dossier.checkPlain({ automation, rav });
    if (!Object.keys(f).length && !note && !Object.keys(plain).length) throw new ApiError('invalid_value', { message: 'Niente da aggiornare' });
    return this.update(id, d => {
      Object.assign(d, f);
      if (note) { d.note_log = noteLog(d).concat([this.textNote(note)]); delete d.notes; }
    }, plain);
  }

  async addNote(id, text) {
    return this.update(id, d => { d.note_log = noteLog(d).concat([this.textNote(text)]); delete d.notes; });
  }

  async setStatus(id, status, note) {
    status = normStatus(status);
    if (!AGENT_STATUSES.includes(status)) throw new ApiError('invalid_value', { message: `Stato non impostabile dall'agente. Ammessi: ${AGENT_STATUSES.join(', ')}` });
    const { items } = await this.load();
    const cur = items.find(x => x.row.id === id);
    if (cur && normStatus(cur.row.status) === status && !note) return { id, unchanged: true };
    return this.update(id, (d, item) => {
      const log = noteLog(d).concat([{ id: newId(), at: this.now().toISOString(), kind: 'status', from: item.row.status, to: status }]);
      if (note) log.push(this.textNote(note));
      d.note_log = log; delete d.notes;
    }, { status, status_changed_on: this.today() });
  }

  async docs({ applicationId } = {}) {
    const j = await this.api.call('doc_list');
    const k = await this.dek();
    const out = [];
    for (const doc of j.docs || []) {
      if (applicationId && doc.application_id !== applicationId) continue;
      let m = {};
      try { m = await decObj(k, doc.meta_enc, AAD.docmeta); } catch { m = { name: '(metadati non leggibili)' }; }
      out.push({ id: doc.id, kind: doc.kind, application_id: doc.application_id ?? null, name: m.name, type: m.type, size: doc.size, created_at: doc.created_at });
    }
    return { docs: out };
  }

  /** File locale da caricare: percorso assoluto, .pdf o .docx (anche dopo i link simbolici), al massimo 6 MB, dentro root se impostata (JD_UPLOAD_DIR). */
  static async localFile(p, root) {
    let abs = String(p ?? '').trim();
    if (abs === '~' || abs.startsWith('~/')) abs = join(homedir(), abs.slice(1));
    if (!isAbsolute(abs)) throw invalid('Serve il percorso assoluto del file');
    let real, st;
    try { real = await realpath(abs); st = await stat(real); } catch { throw new ApiError('not_found', { message: 'File non trovato' }); }
    const type = DOC_TYPES[extname(real).toLowerCase()];
    if (!type || !DOC_TYPES[extname(abs).toLowerCase()]) throw invalid('Si caricano solo file .pdf o .docx');
    if (!st.isFile()) throw invalid('Il percorso non è un file');
    if (root) {
      const r = await realpath(root).catch(() => null);
      if (!r || !(real + sep).startsWith(r.endsWith(sep) ? r : r + sep)) throw invalid('Il file deve stare nella cartella indicata da JD_UPLOAD_DIR');
    }
    if (st.size === 0 || st.size > DOC_MAX) throw invalid('Il file deve essere tra 1 byte e 6 MB');
    return { path: real, name: basename(abs), type, size: st.size };
  }

  /** Cifra qui un file locale e lo carica come CV o lettera di una candidatura, solo negli stati ammessi (DOC_UPLOAD_STATUSES) e solo se per quel tipo
   *  non c'è ancora un documento: non sostituisce mai. Il caricamento non cambia stato, data di cambio stato né storico; dopo l'invio lascia una nota [agente].
   *  Le chiamate per la stessa scheda e lo stesso tipo passano una alla volta in questo processo (_docLock); tra processi o dispositivi diversi la garanzia
   *  può darla solo il portale (vedi il riepilogo della modifica). */
  async uploadDoc(id, kind, filePath, { root = process.env.JD_UPLOAD_DIR } = {}) {
    if (!DOC_KINDS.includes(kind)) throw invalid(`kind deve essere ${DOC_KINDS.join(' o ')}`);
    const key = id + '\u0000' + kind;
    this._docLock ??= new Map();
    const prev = this._docLock.get(key) ?? Promise.resolve();
    const run = prev.catch(() => {}).then(() => this._uploadDoc(id, kind, filePath, root));
    this._docLock.set(key, run);
    try { return await run; } finally { if (this._docLock.get(key) === run) this._docLock.delete(key); }
  }

  async _uploadDoc(id, kind, filePath, root) {
    const item = (await this.load(true)).items.find(x => x.row.id === id);
    if (!item) throw new ApiError('not_found', { message: 'Scheda non trovata' });
    if (item.row.ro) throw new ApiError('read_only', { message: 'Scheda in sola consultazione (piano Basic)' });
    if (!DOC_UPLOAD_STATUSES.includes(item.row.status)) throw new ApiError('docs_locked', { message: `CV e lettera si caricano solo su candidature negli stati ${DOC_UPLOAD_STATUSES.join(', ')}` });
    const file = await Dossier.localFile(filePath, root);
    // mai sostituire: stessa lettura di jd_docs, appena prima della scrittura
    if ((await this.docs({ applicationId: id })).docs.some(x => x.kind === kind)) throw new ApiError('doc_exists', { message: `Esiste già ${DOC_LABEL[kind]} su questa candidatura: non viene sostituito` });
    const bytes = new Uint8Array(await readFile(file.path));
    if (bytes.length === 0 || bytes.length > DOC_MAX) throw invalid('Il file deve essere tra 1 byte e 6 MB');
    const k = await this.dek();
    const ct = await encBytes(k, bytes, AAD.doc);
    const meta = await encObj(k, { name: file.name, type: file.type, size: bytes.length }, AAD.docmeta);
    let j;
    try { j = await this.api.call('doc_upload', ct, { 'X-Doc-Meta': Buffer.from(meta).toString('base64'), 'X-Doc-Kind': kind, 'X-Doc-App': id }); }
    catch (e) {
      if (e.code !== 'rate_limited') throw e;
      const wait = e.retryAfter !== undefined ? ` Riprova tra circa ${Math.max(1, Math.ceil(e.retryAfter / 60))} minuti.` : ' Si libera un posto quando il caricamento più vecchio dell\'ultima ora esce dalla finestra.';
      throw new ApiError('rate_limited', { status: e.status, retryAfter: e.retryAfter,
        message: `Limite dei caricamenti raggiunto sul portale: al massimo ${UPLOAD_HOUR_LIMIT} all'ora, su una finestra mobile di 60 minuti.${wait} Il file non è stato caricato.` });
    }
    const out = { id: j.id, application_id: id, kind, name: file.name, size: bytes.length };
    if (DOC_NOTE_STATUSES.includes(item.row.status)) {          // stessa logica di jd_add_note: solo il registro delle note, stato e date invariati
      try { await this.addNote(id, `${this.today()} caricato ${kind}: ${file.name}`); out.note = true; }
      catch (e) { out.note = false; out.note_error = e.code || 'error'; }          // il documento è caricato comunque: lo si dice, non lo si nasconde
    }
    return out;
  }

  async agendaItems() {
    const j = await this.api.call('agenda_list');
    const k = await this.dek();
    const out = [];
    for (const it of j.items || []) { let d = null; try { d = await decObj(k, it.enc, AAD.agenda); } catch { d = null; } out.push({ it, d }); }
    return out;
  }

  static agendaView({ it, d }) {
    if (!d) return { id: it.id, version: it.version, unreadable: true };
    return { id: it.id, version: it.version, title: d.title || '', at: d.at || '', kind: d.kind || '', place: d.place || '', who: d.who || '', note: d.note || '', app: d.app || '' };
  }

  async agenda({ from, to, query } = {}) {
    const all = (await this.agendaItems()).map(Dossier.agendaView);
    const q = query ? String(query).toLowerCase() : '';
    const day = r => (r.at || '').slice(0, 10);
    const items = all.filter(r => (!from || day(r) >= from) && (!to || (day(r) && day(r) <= to))
      && (!q || [r.title, r.place, r.who, r.note].join(' ').toLowerCase().includes(q))).sort((a, b) => (a.at || '').localeCompare(b.at || ''));
    return { total: all.length, matched: items.length, items };
  }

  static checkAgenda(input, { create }) {
    const out = {};
    for (const [k, max] of Object.entries(AGENDA_TEXT)) if (input[k] !== undefined) {
      if (typeof input[k] !== 'string' || input[k].length > max) throw invalid(`${k} non valido (testo, al massimo ${max} caratteri)`);
      out[k] = input[k];
    }
    if (input.at !== undefined) {
      if (typeof input.at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(input.at) || Number.isNaN(Date.parse(input.at + ':00Z'))) throw invalid('at deve essere AAAA-MM-GGTHH:MM (ora di Zurigo)');
      out.at = input.at;
    }
    if (input.kind !== undefined) { if (!AGENDA_KINDS.includes(input.kind)) throw invalid(`kind non valido (ammessi: ${AGENDA_KINDS.join(', ')})`); out.kind = input.kind; }
    if (input.app !== undefined) out.app = input.app;
    if (create && (!out.title || !out.at)) throw invalid('title e at sono obbligatori per un appuntamento nuovo');
    if (!create && !Object.keys(out).length) throw invalid('Niente da aggiornare');
    return out;
  }

  /** Crea un appuntamento (senza id) o cambia solo i campi dati, conservando gli altri (anche quelli che l'agente non conosce). Cancellare non è previsto. */
  async saveAgenda(input) {
    const id = input.id;
    const f = Dossier.checkAgenda(input, { create: !id });
    if (f.app && !(await this.load()).items.some(x => x.row.id === f.app)) throw new ApiError('not_found', { message: 'Candidatura collegata non trovata' });
    const k = await this.dek();
    if (!id) {
      const d = { v: 1, title: '', at: '', kind: 'other', place: '', who: '', note: '', app: '', ...f };
      const j = await this.api.call('agenda_save', { enc: await encObj(k, d, AAD.agenda) });
      return { id: j.id, version: j.version };
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      const cur = (await this.agendaItems()).find(x => x.it.id === id);
      if (!cur) throw new ApiError('not_found', { message: 'Appuntamento non trovato' });
      if (!cur.d) throw new ApiError('unreadable', { message: 'Appuntamento non decifrabile: non lo modifico' });
      try {
        const j = await this.api.call('agenda_save', { id, version: cur.it.version, enc: await encObj(k, { ...cur.d, ...f }, AAD.agenda) });
        return { id, version: j.version };
      } catch (e) {
        if (e.code === 'conflict' && attempt < 2) continue;
        throw e;
      }
    }
  }

  async quota() {
    const c = await this.load(true);
    return { quota: c.quota, editable: c.editable, applications: c.items.length };
  }
}
