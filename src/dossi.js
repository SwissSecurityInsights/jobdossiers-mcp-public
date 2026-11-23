/* Dossi, l'assistente AI di Jobdossiers, dal pannello dell'estensione (esperimento del 23.11.2026).
 * Il contesto è quello che costruisce il browser nel portale (public/assets/assistant.js di jobdossiers.ch: record, buildContext,
 * contextBlock, trimHistory): stesse regole, così Assistant::validContext lo accetta e Dossi vede le candidature come in app.php.
 * test/dossi.test.js confronta il risultato con assistant.js quando il repo del portale è accanto.
 * Con l'AI di sistema le candidature decifrate e le domande passano in chiaro dal portale a Infomaniak: eccezione dichiarata alla
 * cifratura, solo con il consenso esplicito dell'utente (come in app.php). L'annuncio in visione entra nella prima domanda. */

export const MAX_CTX = 200000, MAX_CTX_SYS = 60000, MAX_INPUT = 4000, MAX_MSGS = 24, MAX_HIST = 40000;
const MAX_FIELD = 300, MAX_NOTES = 600, MAX_DESC = 4000, MIN_DESC = 150, DESC_OVERHEAD = 20;

export const neutral = s => String(s == null ? '' : s).replace(/<(\/?)(applications|today)\b/gi, '<$1 $2');
const clean = (s, n) => { const t = neutral(s).replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n) + '…' : t; };

export function record(row, d) {
  const x = d || {}, pick = k => (x[k] == null ? '' : String(x[k]));
  return {
    pos: Number(row.pos) || 0, status: String(row.status || ''), created_on: String(row.created_on || ''), applied_on: String(row.applied_on || ''), status_changed_on: String(row.status_changed_on || ''),
    company: pick('company'), role: pick('role'), location: pick('location'), pensum: pick('pensum'), jr_result: pick('jr_result'), rejection_reason: pick('rejection_reason'),
    contact_person: pick('contact_person'), contacts: pick('contacts'), job_url: pick('job_url'), notes: pick('notes'), job_desc: pick('job_desc'),
  };
}

const HEAD = ['company', 'role', 'location', 'status', 'created_on', 'applied_on', 'status_changed_on'];
const MORE = ['pensum', 'jr_result', 'rejection_reason', 'contact_person', 'contacts', 'job_url'];
function line(r, n, level, descLen) {
  const parts = HEAD.filter(k => r[k]).map(k => k + ': ' + clean(r[k], MAX_FIELD));
  let s = '[' + n + '] ' + parts.join(' | ');
  if (level <= 1) {
    const m = MORE.filter(k => r[k]).map(k => k + ': ' + clean(r[k], MAX_FIELD));
    if (r.notes) m.push('notes: ' + clean(r.notes, level === 0 ? MAX_NOTES : MAX_FIELD));
    if (level === 0 && r.job_desc && descLen > 0) m.push('description: ' + clean(r.job_desc, descLen));
    if (m.length) s += ' | ' + m.join(' | ');
  }
  return s;
}
const cmp = (a, b) => (a.created_on < b.created_on ? 1 : a.created_on > b.created_on ? -1 : b.pos - a.pos);

function shareDescriptions(descs, budget) {
  const idx = descs.map((d, i) => i).filter(i => descs[i] > 0).sort((a, b) => descs[a] - descs[b]), out = descs.map(() => 0);
  let left = budget, k = idx.length;
  for (const i of idx) { const share = Math.floor(left / k), take = Math.min(descs[i], MAX_DESC, share); const t = take < MIN_DESC && take < descs[i] ? 0 : take; out[i] = t; left -= t; k--; }
  return out;
}

export function buildContext(records, opts) {
  const max = (opts && opts.max) || MAX_CTX, sorted = records.slice().sort(cmp);
  for (let level = 0; level <= 2; level++) {
    let lens = sorted.map(() => 0);
    const base = sorted.map((r, i) => line(r, i + 1, level, 0));
    if (level === 0) {
      const baseTotal = base.reduce((s, l) => s + l.length + 1, 0);
      const descs = sorted.map(r => (r.job_desc ? clean(r.job_desc, 1e9).length + DESC_OVERHEAD : 0));
      if (baseTotal <= max) lens = shareDescriptions(descs, max - baseTotal).map(t => (t > 0 ? Math.max(0, t - DESC_OVERHEAD) : 0));
      else lens = null;
    }
    if (lens === null) continue;
    const lines = sorted.map((r, i) => line(r, i + 1, level, lens[i]));
    let total = 0, n = 0;
    for (const l of lines) { if (total + l.length + 1 > max) break; total += l.length + 1; n++; }
    if (n === lines.length || level === 2) {
      const withDesc = sorted.slice(0, n).filter(r => r.job_desc);
      const truncated = level === 0 ? withDesc.filter(r => clean(r.job_desc, 1e9).length > (lens[sorted.indexOf(r)] || 0)).length : withDesc.length;
      return { text: lines.slice(0, n).join('\n'), included: n, omitted: lines.length - n, level, truncated, withDesc: withDesc.length, withoutDesc: n - withDesc.length };
    }
  }
}

export function contextBlock(today, ctx) {
  return '<today>' + neutral(today) + '</today>\n<applications count="' + ctx.included + '" omitted="' + ctx.omitted + '" descriptions_truncated="' + (ctx.truncated || 0) + '" with_description="' + (ctx.withDesc || 0) + '" descriptions_without="' + (ctx.withoutDesc || 0) + '">\n' + ctx.text + '\n</applications>';
}

export function trimHistory(msgs) {
  let out = msgs.slice(-MAX_MSGS), total = out.reduce((s, m) => s + m.content.length, 0);
  while (out.length > 1 && total > MAX_HIST) { total -= out[0].content.length; out = out.slice(1); }
  while (out.length && out[0].role !== 'user') out = out.slice(1);
  return { msgs: out, trimmed: out.length < msgs.length };
}

/** L'annuncio in visione dentro la prima domanda, nei limiti di MAX_INPUT: prima la domanda, poi quanto ci sta dell'annuncio. */
export function withPosting(question, posting) {
  const q = String(question || '').trim();
  if (!posting) return q.slice(0, MAX_INPUT);
  const head = [posting.role && 'Ruolo: ' + posting.role, posting.company && 'Impresa: ' + posting.company,
    posting.place && 'Luogo: ' + posting.place, posting.url && 'Indirizzo: ' + posting.url].filter(Boolean).map(s => neutral(s).slice(0, 300)).join('\n');
  const wrap = d => `Sto guardando questo annuncio (non ancora tra le mie candidature, a meno che non lo trovi nei dati):\n${head}${d ? '\nTesto: ' + d : ''}\n\nLa mia domanda: ${q}`;
  const room = MAX_INPUT - wrap('').length - 12;
  const desc = room > 200 ? clean(posting.job_desc, room) : '';
  return wrap(desc).slice(0, MAX_INPUT);
}
