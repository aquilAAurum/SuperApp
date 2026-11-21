import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// PocketBase rejects these field names at migration time ("must not be in list"); catch it before CI boots a server.
const RESERVED = ['id', 'collectionId', 'collectionName', 'expand'];
const dir = join(__dirname, '../../pb_migrations');

describe('migrations', () => {
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.js'))) {
    it(`${f} uses no reserved field names`, () => {
      const names = [...readFileSync(join(dir, f), 'utf8').matchAll(/\{\s*name:\s*"([^"]+)",\s*type:/g)].map((m) => m[1]);
      expect(names.filter((n) => RESERVED.includes(n!))).toEqual([]);
    });
  }
});
