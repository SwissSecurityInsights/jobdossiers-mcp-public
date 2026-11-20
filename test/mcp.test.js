import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeFixture, startMock } from './helpers.mjs';

const INDEX = fileURLToPath(new URL('../src/index.js', import.meta.url));

test('protocollo MCP su stdio: stdout pulito, chiave mai in output, uscita pulita', async () => {
  const fx = await makeFixture(), mock = await startMock(fx);
  const child = spawn(process.execPath, [INDEX], { env: { PATH: process.env.PATH, JD_AGENT_KEY: fx.key, JD_URL: mock.url }, stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '', errOut = '';
  child.stdout.on('data', c => out += c); child.stderr.on('data', c => errOut += c);
  const send = o => child.stdin.write(JSON.stringify(o) + '\n');
  try {
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } } });
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'jd_list', arguments: { status: 'in_review' } } });
    send({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'nope', arguments: {} } });
    send({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'jd_set_status', arguments: { id: 'r1', status: 'sent' } } });
    send({ jsonrpc: '2.0', id: 6, method: 'unknown/method' });
    child.stdin.end();
    const code = await new Promise(r => child.on('close', r));
    assert.equal(code, 0);
    const msgs = out.trim().split('\n').map(l => JSON.parse(l));
    assert.equal(msgs.length, 6);
    const by = Object.fromEntries(msgs.map(m => [m.id, m]));
    assert.equal(by[1].result.protocolVersion, '2025-06-18');
    assert.deepEqual(by[2].result.tools.map(t => t.name).sort(), ['jd_add_note', 'jd_agenda', 'jd_agenda_save', 'jd_create', 'jd_docs', 'jd_find_duplicates', 'jd_get', 'jd_list', 'jd_preferences', 'jd_quota', 'jd_set_status', 'jd_update', 'jd_upload_doc']);
    const list = JSON.parse(by[3].result.content[0].text);
    assert.equal(list.ok, true); assert.equal(list.rows[0].company, 'Acme Bank AG');
    assert.equal(by[4].error.code, -32602);
    assert.equal(by[5].result.isError, true); assert.match(by[5].result.content[0].text, /invalid_value/);
    assert.equal(by[6].error.code, -32601);
    assert.ok(!out.includes(fx.secret) && !errOut.includes(fx.secret) && !out.includes(fx.token) && !errOut.includes(fx.token) && !out.includes('SECRET JOB TEXT'));
  } finally { child.kill(); await mock.close(); }
});

test('senza chiave: tools/list funziona, la chiamata dà un errore chiaro', async () => {
  const child = spawn(process.execPath, [INDEX], { env: { PATH: process.env.PATH, HOME: '/nonexistent', XDG_CONFIG_HOME: '/nonexistent' }, stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', c => out += c);
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) + '\n');
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'jd_quota', arguments: {} } }) + '\n');
  child.stdin.end();
  await new Promise(r => child.on('close', r));
  const m = out.trim().split('\n').map(l => JSON.parse(l));
  assert.equal(m[0].result.tools.length, 13);
  assert.equal(m[1].result.isError, true);
  assert.match(m[1].result.content[0].text, /Chiave non trovata/);
});

test('sottocomando call: un solo tool, JSON da stdin, errori con exit 1', async () => {
  const fx = await makeFixture(), mock = await startMock(fx);
  const run = (args, input) => new Promise(resolve => {
    const c = spawn(process.execPath, [INDEX, ...args], { env: { PATH: process.env.PATH, JD_AGENT_KEY: fx.key, JD_URL: mock.url }, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    c.stdout.on('data', d => out += d); c.stderr.on('data', d => err += d);
    c.on('close', code => resolve({ code, out, err }));
    c.stdin.end(input ?? '');
  });
  try {
    const q = await run(['call', 'jd_quota']);
    assert.equal(q.code, 0); assert.equal(JSON.parse(q.out).applications, 3);
    const c = await run(['call', 'jd_create', '-'], JSON.stringify({ company: 'Via Stdin SA', role: 'CISO', job_url: 'https://x.example/j/1', job_desc: 'testo\nlungo "con virgolette"' }));
    assert.equal(c.code, 0); assert.equal(JSON.parse(c.out).ok, true);
    const dup = await run(['call', 'jd_create', '{"company":"Altra","role":"Altro","job_url":"https://x.example/j/1"}']);
    assert.equal(dup.code, 1); assert.equal(JSON.parse(dup.out).error, 'duplicate');
    assert.equal((await run(['call', 'nope'])).code, 1);
    assert.equal((await run(['call', 'jd_quota', '{rotto'])).code, 1);
    for (const r of [q, c, dup]) assert.ok(!r.out.includes(fx.secret) && !r.err.includes(fx.secret));
  } finally { await mock.close(); }
});

test('errore con attesa: il risultato del tool riporta retry_after_seconds', async () => {
  const { createServer } = await import('../src/mcp.js');
  const { ApiError } = await import('../src/api.js');
  const tools = [{ name: 't', description: '', inputSchema: { type: 'object' }, handler: async () => { throw new ApiError('rate_limited', { message: 'limite', retryAfter: 90 }); } }];
  const r = await createServer({ tools, info: { name: 'x', version: '0' } }).handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 't', arguments: {} } });
  assert.equal(r.result.isError, true);
  assert.deepEqual(JSON.parse(r.result.content[0].text), { ok: false, error: 'rate_limited', message: 'limite', retry_after_seconds: 90 });
});
