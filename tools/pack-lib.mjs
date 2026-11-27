// Pure helpers for tools/pack.mjs (unit-tested in pack.test.mjs).
import { createHash } from 'node:crypto';
import { zipSync } from 'fflate';

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** Deterministic zip: sorted paths, fixed mtime, app.json at the root (spec §Packaging step 1). */
export function buildZip(files) {
  const entries = {};
  const mtime = new Date('2000-01-01T00:00:00Z');
  for (const path of Object.keys(files).sort()) {
    if (path.startsWith('/') || path.split('/').includes('..')) throw new Error(`unsafe path in bundle: ${path}`);
    entries[path] = [files[path], { mtime }];
  }
  if (!entries['app.json']) throw new Error('app.json must be at the bundle root');
  return zipSync(entries, { level: 9 });
}

/** Adds or replaces one app in the built-in index, keeping only the newest version per app. */
export function mergeIndex(index, entry) {
  const apps = (index?.apps ?? []).filter((a) => a.manifest?.id !== entry.manifest.id);
  apps.push(entry);
  apps.sort((a, b) => a.manifest.id.localeCompare(b.manifest.id));
  return { version: 1, apps };
}
