import { describe, expect, it } from 'vitest';
import { runIsolationCheck } from './isolation.ts';

describe('runIsolationCheck', () => {
  it('reports thrown probes as blocked and successful ones as allowed', async () => {
    const res = await runIsolationCheck([
      { name: 'a', run: () => { throw new DOMException('no', 'SecurityError'); } },
      { name: 'b', run: async () => 1 },
      { name: 'c', run: () => Promise.reject(new TypeError('Failed to fetch')) },
    ]);
    expect(res).toEqual([
      { name: 'a', blocked: true, detail: 'SecurityError' },
      { name: 'b', blocked: false, detail: 'allowed' },
      { name: 'c', blocked: true, detail: 'TypeError' },
    ]);
  });
});
