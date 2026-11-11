/* Server MCP minimale su stdio (JSON-RPC 2.0, una riga per messaggio). Nessuna dipendenza.
 * Su stdout passa solo il protocollo; ogni diagnostica va su stderr e non contiene mai segreti o testi decifrati. */
import { createInterface } from 'node:readline';
import { ApiError } from './api.js';

const SUPPORTED = ['2025-06-18', '2025-03-26', '2024-11-05'];
const MAX_TEXT = 80000;

export function createServer({ tools, info, instructions }) {
  const byName = new Map(tools.map(t => [t.name, t]));
  const ok = (id, result) => ({ jsonrpc: '2.0', id, result });
  const err = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

  async function callTool(params) {
    const tool = byName.get(params?.name);
    if (!tool) return { error: [-32602, `Tool sconosciuto: ${params?.name}`] };
    try {
      const args = params.arguments && typeof params.arguments === 'object' ? params.arguments : {};
      const res = await tool.handler(args);
      let text = JSON.stringify({ ok: true, ...res });
      if (text.length > MAX_TEXT) text = text.slice(0, MAX_TEXT) + '… [troncato: restringi i filtri]';
      return { result: { content: [{ type: 'text', text }] } };
    } catch (e) {
      const body = e instanceof ApiError ? { ok: false, error: e.code, message: e.message, ...(e.retryAfter !== undefined && { retry_after_seconds: e.retryAfter }) } : { ok: false, error: 'internal', message: String(e?.message || e).slice(0, 300) };
      return { result: { isError: true, content: [{ type: 'text', text: JSON.stringify(body) }] } };
    }
  }

  async function handle(msg) {
    if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return msg?.id !== undefined ? err(msg.id, -32600, 'Invalid Request') : null;
    const { id, method, params } = msg;
    const isRequest = id !== undefined && id !== null;
    switch (method) {
      case 'initialize': {
        const want = params?.protocolVersion;
        return ok(id, { protocolVersion: SUPPORTED.includes(want) ? want : SUPPORTED[0], capabilities: { tools: { listChanged: false } }, serverInfo: info, instructions });
      }
      case 'ping': return isRequest ? ok(id, {}) : null;
      case 'tools/list': return ok(id, { tools: tools.map(({ name, description, inputSchema, annotations }) => ({ name, description, inputSchema, annotations })) });
      case 'tools/call': {
        const r = await callTool(params);
        return r.error ? err(id, ...r.error) : ok(id, r.result);
      }
      default: return isRequest ? err(id, -32601, `Method not found: ${method}`) : null;
    }
  }

  return { handle };
}

export function serveStdio(server, { input = process.stdin, output = process.stdout } = {}) {
  const rl = createInterface({ input, crlfDelay: Infinity });
  const pending = new Set();
  const send = o => output.write(JSON.stringify(o) + '\n');
  rl.on('line', line => {
    if (!line.trim()) return;
    let msg;
    try { msg = JSON.parse(line); } catch { send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); return; }
    const p = (async () => {
      for (const m of Array.isArray(msg) ? msg : [msg]) {
        const r = await server.handle(m).catch(e => ({ jsonrpc: '2.0', id: m?.id ?? null, error: { code: -32603, message: String(e?.message || e).slice(0, 200) } }));
        if (r) send(r);
      }
    })().finally(() => pending.delete(p));
    pending.add(p);
  });
  return new Promise(resolve => rl.on('close', () => Promise.allSettled([...pending]).then(resolve)));
}
