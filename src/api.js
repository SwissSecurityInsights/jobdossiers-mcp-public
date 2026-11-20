/* Client HTTP per le azioni dell'agente (api.php?a=...). Il token va nell'intestazione X-JD-Agent. */

export class ApiError extends Error {
  constructor(code, { status, message, version, retryAfter } = {}) {
    super(message || code);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.version = version;
    this.retryAfter = retryAfter;     // secondi, dall'intestazione Retry-After di un 429 (se il portale la manda)
  }
}

const HOSTS = new Set(['jobdossiers.ch', 'www.jobdossiers.ch', 'localhost', '127.0.0.1', '[::1]']);

/** Il token non deve finire su un host sbagliato né su HTTP in chiaro: ammessi solo il portale e localhost (per i test). */
export function checkBase(url, { allowAnyHost = false } = {}) {
  let u;
  try { u = new URL(url); } catch { throw new ApiError('bad_url', { message: 'JD_URL non valido' }); }
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]';
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) throw new ApiError('bad_url', { message: 'JD_URL deve usare https' });
  if (!allowAnyHost && !HOSTS.has(u.hostname)) throw new ApiError('bad_url', { message: 'Host non ammesso per JD_URL (JD_ALLOW_ANY_HOST=1 per forzarlo)' });
  return u.origin;
}

export function createApi({ base = 'https://jobdossiers.ch', token, fetchImpl = globalThis.fetch, timeoutMs = 30000, allowAnyHost = false } = {}) {
  const root = checkBase(base, { allowAnyHost });
  /** body: oggetto (JSON) oppure Uint8Array (application/octet-stream, per i file già cifrati); extra: intestazioni aggiuntive. */
  async function call(action, body, extra = {}) {
    const url = `${root}/api.php?a=${encodeURIComponent(action)}`;
    const raw = body instanceof Uint8Array;
    const headers = { ...extra, 'X-JD-Agent': token, Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = raw ? 'application/octet-stream' : 'application/json';
    let r;
    try {
      r = await fetchImpl(url, {
        method: body === undefined ? 'GET' : 'POST',
        headers,
        body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
        redirect: 'error', // il token non deve seguire un redirect verso un altro host
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      throw new ApiError('network', { message: 'Rete non raggiungibile (' + (e?.cause?.code || e?.name || 'errore') + ')' });
    }
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.ok !== false) return j;
    throw failure(r, j);
  }

  /** GET che risponde con byte (doc_get: file cifrato IV || ct || tag). params: parametri in più della query; max: byte al massimo. */
  async function bytes(action, params = {}, { max = 8 * 1024 * 1024 } = {}) {
    const q = new URLSearchParams({ a: action, ...params });
    let r;
    try {
      r = await fetchImpl(`${root}/api.php?${q}`, {
        method: 'GET', headers: { 'X-JD-Agent': token, Accept: 'application/octet-stream' },
        redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      throw new ApiError('network', { message: 'Rete non raggiungibile (' + (e?.cause?.code || e?.name || 'errore') + ')' });
    }
    if (!r.ok) throw failure(r, await r.json().catch(() => ({})));
    const u8 = new Uint8Array(await r.arrayBuffer());
    if (u8.length > max) throw new ApiError('too_large', { message: 'Documento troppo grande' });
    return u8;
  }
  return { call, bytes, base: root };
}

function failure(r, j) {
  const code = r.status === 401 ? 'unauthorized' : r.status === 429 ? 'rate_limited' : j.error || 'http_' + r.status;
  const message = r.status === 401 ? 'Chiave rifiutata, revocata o piano Plus scaduto' : j.message;
  const ra = r.status === 429 ? Number.parseInt(r.headers?.get?.('retry-after') ?? '', 10) : NaN;
  return new ApiError(code, { status: r.status, message, version: j.version, retryAfter: Number.isFinite(ra) && ra >= 0 ? ra : undefined });
}
