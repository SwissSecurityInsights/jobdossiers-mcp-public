/* `--check`: prova in sola lettura. Stampa solo conteggi e NOMI dei campi, mai valori. */
import { Dossier } from './client.js';

/** Tipo di ogni campo; per gli oggetti i NOMI delle chiavi, per gli elenchi quelli del primo elemento. Mai valori. */
function shapes(items) {
  const out = {};
  const shape = v => Array.isArray(v) ? { type: 'array', length_max: 0, item_keys: v[0] && typeof v[0] === 'object' ? Object.keys(v[0]) : typeof v[0] }
    : v && typeof v === 'object' ? { type: 'object', keys: Object.keys(v) } : { type: typeof v };
  for (const { d } of items) for (const [k, v] of Object.entries(d)) {
    if (v === '' || v == null || k === 'job_desc') continue;
    const s = shape(v);
    if (!out[k]) out[k] = s;
    if (s.type === 'array') out[k].length_max = Math.max(out[k].length_max || 0, v.length);
    else if (s.type === 'object') out[k].keys = [...new Set([...(out[k].keys || []), ...s.keys])];
    else if (s.type === 'string') out[k].len_max = Math.max(out[k].len_max || 0, v.length);
  }
  return out;
}

export async function runCheck(dossier) {
  const c = await dossier.load(true);
  const status = {}, fields = {};
  let unreadable = 0;
  for (const { row, d, bad } of c.items) {
    status[row.status] = (status[row.status] || 0) + 1;
    if (bad) unreadable++;
    for (const [k, v] of Object.entries(d)) if (v !== '' && v != null && !(Array.isArray(v) && !v.length)) fields[k] = (fields[k] || 0) + 1;
  }
  let docs = null;
  try { docs = (await dossier.docs()).docs.length; } catch { /* facoltativo */ }
  return {
    ok: true, applications: c.items.length, unreadable, by_status: status,
    rav: Object.fromEntries(['SI', 'NO', ''].map(v => [v || 'empty', c.items.filter(x => (x.row.rav || '') === v).length])),
    encrypted_fields_in_use: Object.fromEntries(Object.entries(fields).sort((a, b) => b[1] - a[1])),
    documents: docs, quota: c.quota, editable: c.editable,
    field_shapes: shapes(c.items),
  };
}

export { Dossier };
