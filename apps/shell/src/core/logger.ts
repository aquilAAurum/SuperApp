/**
 * Structured JSON logger (CORE-14, HB-OPS-01). One line per event: ts, level, msg, fields.
 * Keys that may carry secrets are redacted; URLs are reduced to their origin.
 */
export type Level = 'debug' | 'info' | 'warn' | 'error';
export interface LogEntry {
  ts: string;
  level: Level;
  msg: string;
  [field: string]: unknown;
}

const SECRET_KEY = /token|secret|password|authorization|cookie|apikey|api_key/i;
const URL_KEY = /url$/i;

export function redact(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (SECRET_KEY.test(k)) out[k] = '[redacted]';
    else if (URL_KEY.test(k) && typeof v === 'string') out[k] = originOf(v);
    else out[k] = v;
  }
  return out;
}

function originOf(value: string): string {
  try {
    return new URL(value).origin;
  } catch {
    return '[invalid-url]';
  }
}

export type Sink = (entry: LogEntry) => void;

export class Logger {
  private sinks: Sink[] = [];
  constructor(private readonly write: (line: string) => void = (l) => console.log(l)) {}

  addSink(sink: Sink): () => void {
    this.sinks.push(sink);
    return () => {
      this.sinks = this.sinks.filter((s) => s !== sink);
    };
  }

  log(level: Level, msg: string, fields: Record<string, unknown> = {}): LogEntry {
    const entry: LogEntry = { ...redact(fields), ts: new Date().toISOString(), level, msg };
    this.write(JSON.stringify(entry));
    for (const s of this.sinks) s(entry);
    return entry;
  }

  debug(msg: string, f?: Record<string, unknown>) {
    return this.log('debug', msg, f);
  }
  info(msg: string, f?: Record<string, unknown>) {
    return this.log('info', msg, f);
  }
  warn(msg: string, f?: Record<string, unknown>) {
    return this.log('warn', msg, f);
  }
  error(msg: string, f?: Record<string, unknown>) {
    return this.log('error', msg, f);
  }
}

export const log = new Logger();
