import { describe, expect, it } from 'vitest';
import { newRecordId, newSessionToken, safeEqual } from './ids.ts';
import { validateServerUrl, isPrivateHost } from './url-policy.ts';
import { Logger, type LogEntry } from './logger.ts';
import { RingLog } from './observable.ts';
import { RECORD_ID_PATTERN } from '@superapp/contracts';

describe('ids', () => {
  it('generates PocketBase-format ids', () => {
    for (let i = 0; i < 200; i++) expect(newRecordId()).toMatch(RECORD_ID_PATTERN);
  });
  it('handles biased bytes by rejection sampling', () => {
    let calls = 0;
    const id = newRecordId((b) => {
      calls++;
      b.fill(calls === 1 ? 255 : 0);
      return b;
    });
    expect(id).toBe('aaaaaaaaaaaaaaa');
  });
  it('session tokens are 256-bit hex and compare in constant time', () => {
    const t = newSessionToken();
    expect(t).toMatch(/^[0-9a-f]{64}$/);
    expect(safeEqual(t, t)).toBe(true);
    expect(safeEqual(t, t.replace(/.$/, 'x'))).toBe(false);
    expect(safeEqual(t, 'short')).toBe(false);
  });
});

describe('server URL policy', () => {
  it.each(['https://minipc.tail1234.ts.net', 'https://example.com/pb/', 'http://192.168.1.20:8090', 'http://100.101.1.2:8090', 'http://minipc.tail1234.ts.net', 'http://localhost:8090'])(
    'accepts %s',
    (u) => expect(validateServerUrl(u).ok).toBe(true),
  );
  it.each(['http://example.com', 'ftp://192.168.1.2', 'javascript:alert(1)', '', 'https://user:pw@example.com', 'https://example.com/?x=1', 'http://100.128.0.1'])(
    'rejects %s',
    (u) => expect(validateServerUrl(u).ok).toBe(false),
  );
  it('normalises trailing slashes', () => {
    expect(validateServerUrl('https://example.com/pb/')).toEqual({ ok: true, url: 'https://example.com/pb' });
  });
  it('knows Tailscale ranges', () => {
    expect(isPrivateHost('100.64.0.1')).toBe(true);
    expect(isPrivateHost('100.127.255.255')).toBe(true);
    expect(isPrivateHost('[fd7a:115c:a1e0::1]')).toBe(true);
    expect(isPrivateHost('8.8.8.8')).toBe(false);
  });
});

describe('logger', () => {
  it('writes single-line JSON and redacts secrets and URLs (HB-DATA-03)', () => {
    const lines: string[] = [];
    const entries: LogEntry[] = [];
    const l = new Logger((s) => lines.push(s));
    l.addSink((e) => entries.push(e));
    l.info('auth.ok', { token: 'abc', serverUrl: 'https://u:p@host.ts.net/x?y=1', appId: 'hello' });
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]!);
    expect(parsed).toMatchObject({ level: 'info', msg: 'auth.ok', token: '[redacted]', serverUrl: 'https://host.ts.net', appId: 'hello' });
    expect(lines[0]).not.toContain('abc');
    expect(entries[0]!.msg).toBe('auth.ok');
  });
  it('fields cannot overwrite ts/level/msg', () => {
    const l = new Logger(() => undefined);
    const e = l.warn('real', { msg: 'fake', level: 'debug' });
    expect(e).toMatchObject({ msg: 'real', level: 'warn' });
  });
});

describe('RingLog', () => {
  it('caps size and notifies subscribers', () => {
    const r = new RingLog<number>(3);
    const seen: number[][] = [];
    r.subscribe((x) => seen.push([...x]));
    [1, 2, 3, 4].forEach((n) => r.push(n));
    expect(r.all()).toEqual([2, 3, 4]);
    expect(seen.at(-1)).toEqual([2, 3, 4]);
  });
});
