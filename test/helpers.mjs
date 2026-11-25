import http from 'node:http';
import { encObj, wrapDekForAgent, AAD } from '../src/crypto.js';

const rnd = () => Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
const PLAIN = ['status', 'status_changed_on', 'applied_on', 'automation', 'rav', 'jobroom_registered_on'];

export async function makeFixture() {
  const dek = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const token = rnd(), secret = rnd();
  return { dek, token, secret, key: `jda1.${token}.${secret}`, wrapped: await wrapDekForAgent(dek, secret) };
}

export const SEEDS = () => [
  { d: { company: 'Acme Bank AG', role: 'Head of Security', location: 'Zurich', job_url: 'https://careers.acme.example/jobs/42?utm_source=x', job_desc: 'SECRET JOB TEXT', custom_field: 'keep-me', note_log: [{ id: 'n1', at: '2026-10-20T10:00:00.000Z', text: 'Proposta agente [LinkedIn 1234567890]' }] }, status: 'in_review', rav: 'SI', jobroom_registered_on: '2026-10-21' },
  { d: { company: 'Da completare (example.org)', role: '', job_url: 'https://example.org/job/1' }, status: 'to_send' },
  { d: { company: 'Readonly Corp', role: 'CISO' }, status: 'to_send', ro: true },
];

export async function startMock(fx, seeds = SEEDS()) {
  const rows = [], requests = [];
  let n = 0;
  const mk = async s => ({ id: 'r' + (++n), pos: n, status: 'to_send', applied_on: null, status_changed_on: null, automation: '', rav: '', jobroom_registered_on: null, version: 1, enc: s.rawEnc ?? await encObj(fx.dek, s.d, AAD.app), ...Object.fromEntries(Object.entries(s).filter(([k]) => PLAIN.includes(k) || k === 'ro')) });
  for (const s of seeds) rows.push(await mk(s));
  const state = { rows, requests, conflictOnce: false, docs: [], uploads: [], agenda: [], files: new Map(), net: [], netDenied: false, assistant: [] };
  let ag = 0;
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', async () => {
      const raw = Buffer.concat(chunks), body = raw.toString('utf8');
      const action = new URL(req.url, 'http://x').searchParams.get('a');
      requests.push({ action, method: req.method, headers: req.headers, body });
      const send = (code, o) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (req.headers['x-jd-agent'] !== fx.token) return send(401, { ok: false, error: 'unauthorized' });
      if (action === 'agent_keys') return send(200, { ok: true, wrapped_dek: fx.wrapped });
      if (action === 'app_list') return send(200, { ok: true, rows, quota: { used: 3, cap: 100 }, editable: null, csrf: '' });
      if (action === 'doc_list') return state.docsDenied ? send(403, { ok: false, error: 'agent_scope' }) : send(200, { ok: true, docs: state.docs });
      if (action === 'doc_upload') {
        if (req.headers['content-type'] !== 'application/octet-stream') return send(415, { ok: false, error: 'bad_request' });
        const kind = req.headers['x-doc-kind'], app = req.headers['x-doc-app'];
        if (!['cv', 'letter'].includes(kind) || !app) return send(403, { ok: false, error: 'agent_scope' });
        if (state.uploadLimited) {          // come Agent::within del portale: 429, con Retry-After solo se impostato nel test
          res.writeHead(429, { 'Content-Type': 'application/json', ...(state.retryAfter !== undefined && { 'Retry-After': String(state.retryAfter) }) });
          return res.end(JSON.stringify({ ok: false, error: 'rate_limited', message: 'Troppi tentativi. Riprova più tardi.' }));
        }
        const id = 'd' + (state.uploads.length + 1);
        const meta = Buffer.from(req.headers['x-doc-meta'] || '', 'base64').toString('utf8');
        state.uploads.push({ id, kind, app, bytes: new Uint8Array(raw), meta });
        // come Documents::put del portale: un documento per tipo e candidatura, quello nuovo prende il posto del precedente
        state.docs = state.docs.filter(x => !(x.kind === kind && x.application_id === app)).concat([{ id, kind, application_id: app, meta_enc: meta, size: raw.length, created_at: 0 }]);
        return send(200, { ok: true, id });
      }
      if (action === 'doc_get') {          // byte cifrati del documento (IV || ct || tag), come Documents del portale
        const f = state.files.get(new URL(req.url, 'http://x').searchParams.get('id'));
        if (!f) return send(404, { ok: false, error: 'not_found' });
        res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
        return res.end(Buffer.from(f));
      }
      if (action === 'net_list') return state.netDenied ? send(403, { ok: false, error: 'agent_scope' }) : send(200, { ok: true, items: state.net });
      if (action === 'net_save') {           // solo creazione (l'app non modifica persone esistenti)
        const b = JSON.parse(body);
        if (b.id) return send(400, { ok: false, error: 'not_expected' });
        const it = { id: 'n' + (100 + state.net.length), enc: b.enc, version: 1 }; state.net.push(it);
        return send(200, { ok: true, id: it.id, version: 1 });
      }
      if (action === 'assistant') {          // Dossi con l'AI di sistema (Assistant::chat): qui risponde con quello che ha ricevuto
        const b = JSON.parse(body); state.assistant.push(b);
        if (b.consent !== true) return send(400, { ok: false, error: 'err.asst_consent' });
        return send(200, { ok: true, text: `Ricevute ${b.messages.length} domande.`, truncated: false, usage: { used: state.assistant.length, limit: 100 } });
      }
      if (action === 'agenda_list') return send(200, { ok: true, items: state.agenda });
      if (action === 'agenda_save') {
        const b = JSON.parse(body);
        if (!b.id) { const it = { id: 'a' + (++ag), enc: b.enc, version: 1 }; state.agenda.push(it); return send(200, { ok: true, id: it.id, version: 1 }); }
        const it = state.agenda.find(x => x.id === b.id);
        if (!it) return send(400, { ok: false, error: 'not_found' });
        if (state.conflictOnce) { state.conflictOnce = false; it.version++; return send(409, { ok: false, error: 'conflict', version: it.version }); }
        if (b.version !== it.version) return send(409, { ok: false, error: 'conflict', version: it.version });
        it.enc = b.enc; it.version++;
        return send(200, { ok: true, id: it.id, version: it.version });
      }
      if (action === 'app_save') {
        const b = JSON.parse(body);
        const plain = Object.fromEntries(Object.entries(b.plain || {}).filter(([k]) => PLAIN.includes(k)));
        if (b.id) {
          const row = rows.find(r => r.id === b.id);
          if (!row) return send(400, { ok: false, error: 'not_found' });
          if (state.conflictOnce) { state.conflictOnce = false; row.version++; return send(409, { ok: false, error: 'conflict', version: row.version }); }
          if (b.version !== row.version) return send(409, { ok: false, error: 'conflict', version: row.version });
          row.enc = b.enc; Object.assign(row, plain); row.version++;
          return send(200, { ok: true, id: row.id, version: row.version });
        }
        const row = await mk({ rawEnc: b.enc, ...plain });
        rows.push(row);
        return send(200, { ok: true, id: row.id, version: row.version });
      }
      return send(403, { ok: false, error: 'agent_scope' });
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return Object.assign(state, { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(r => { server.closeAllConnections?.(); server.close(r); }) });
}
