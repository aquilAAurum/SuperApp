/**
 * Local evaluation of the subset of PocketBase filter syntax the mirror supports:
 *   field = value [&& field != value ...]   with 'string', "string", numbers, true, false, null
 * The same string is sent to the server on refresh, so local and server results agree.
 * Anything else is rejected (INVALID_PARAMS) rather than silently ignored.
 */
type Clause = { field: string; op: '=' | '!='; value: unknown };

const CLAUSE = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*(!=|=)\s*('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?|true|false|null)\s*$/;

export function parseFilter(filter: string | undefined): Clause[] | null {
  if (!filter || filter.trim() === '') return [];
  const out: Clause[] = [];
  for (const part of filter.split('&&')) {
    const m = CLAUSE.exec(part);
    if (!m) return null;
    const raw = m[3]!;
    let value: unknown;
    if (raw.startsWith("'") || raw.startsWith('"')) value = raw.slice(1, -1).replace(/\\(.)/g, '$1');
    else if (raw === 'true' || raw === 'false') value = raw === 'true';
    else if (raw === 'null') value = null;
    else value = Number(raw);
    out.push({ field: m[1]!, op: m[2] as Clause['op'], value });
  }
  return out;
}

export function matches(record: Record<string, unknown>, clauses: Clause[]): boolean {
  return clauses.every((c) => {
    const v = record[c.field] ?? null;
    return c.op === '=' ? v === c.value : v !== c.value;
  });
}

export function sortRecords<T extends Record<string, unknown>>(records: T[], sort: string | undefined): T[] {
  if (!sort) return records;
  const keys = sort.split(',').map((s) => s.trim()).filter(Boolean).map((s) => (s.startsWith('-') ? { f: s.slice(1), dir: -1 } : { f: s.replace(/^\+/, ''), dir: 1 }));
  return [...records].sort((a, b) => {
    for (const { f, dir } of keys) {
      const x = a[f] as never;
      const y = b[f] as never;
      if (x === y) continue;
      if (x === undefined || x === null) return -dir;
      if (y === undefined || y === null) return dir;
      return (x < y ? -1 : 1) * dir;
    }
    return 0;
  });
}
