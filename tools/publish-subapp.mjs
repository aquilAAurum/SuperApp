#!/usr/bin/env node
// Publish a subapp for phones to pull (ADR-009):  pnpm publish:subapp <id>
// 1. builds subapps/<id> (vite, single file), 2. validates app.json, 3. writes a deterministic zip,
// its SHA-256 and the manifest to published/<id>/, 4. keeps the newest two versions.
// A version is immutable: re-publishing the same version with different content is refused (bump
// "version" in app.json and package.json). Commit published/ and open a PR; after Nick merges to
// main, the mini PC pulls it within 15 minutes and phones pick it up on their next check.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { validateManifest } from '../packages/contracts/src/manifest.ts';
import { buildZip, sha256 } from './pack-lib.mjs';
import { compareVersions } from '../packages/contracts/src/semver.ts';
import { KEEP_VERSIONS, publishedVersions } from './published-lib.mjs';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const log = (msg, fields = {}) => console.log(JSON.stringify({ ts: new Date().toISOString(), level: 'info', msg, ...fields }));
const die = (msg, fields = {}) => {
  console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'error', msg, ...fields }));
  process.exit(1);
};

const id = process.argv[2];
if (!id || !/^[a-z][a-z0-9]{1,31}$/.test(id)) die('publish.usage', { hint: 'pnpm publish:subapp <id>' });
const appDir = join(ROOT, 'subapps', id);
if (!existsSync(join(appDir, 'app.json'))) die('publish.no_such_subapp', { appDir: relative(ROOT, appDir) });

if (!process.argv.includes('--no-build')) {
  const b = spawnSync('pnpm', ['exec', 'vite', 'build', '--logLevel', 'warn'], { cwd: appDir, stdio: 'inherit' });
  if (b.status !== 0) die('publish.build_failed', { appId: id });
}

const v = validateManifest(JSON.parse(readFileSync(join(appDir, 'app.json'), 'utf8')));
if (!v.ok) die('publish.invalid_manifest', { errors: v.errors });
const m = v.manifest;
if (m.id !== id) die('publish.id_mismatch', { folder: id, manifestId: m.id });
const dist = join(appDir, 'dist');
if (!existsSync(join(dist, m.entry))) die('publish.entry_missing', { entry: m.entry });

const files = { 'app.json': new TextEncoder().encode(JSON.stringify(m, null, 2)) };
const walk = (d) => {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const full = join(d, e.name);
    if (e.isDirectory()) walk(full);
    else if (e.isFile()) files[relative(dist, full).split('\\').join('/')] = readFileSync(full);
  }
};
walk(dist);
const zip = buildZip(files);
const hash = sha256(zip);

const out = join(ROOT, 'published', id);
const name = `${id}-${m.version}.zip`;
if (existsSync(join(out, name))) {
  if (sha256(readFileSync(join(out, name))) === hash) {
    log('publish.unchanged', { appId: id, version: m.version, sha256: hash });
    process.exit(0);
  }
  die('publish.version_exists', { appId: id, version: m.version, hint: 'bump "version" in app.json (and package.json); published versions are immutable' });
}
const newest = publishedVersions(out, id).at(-1);
if (newest && compareVersions(m.version, newest) <= 0) die('publish.not_newer', { appId: id, version: m.version, newest, hint: 'phones only take newer versions; bump "version"' });
mkdirSync(out, { recursive: true });
writeFileSync(join(out, name), zip);
writeFileSync(join(out, `${name}.sha256`), `${hash}  ${name}\n`);
writeFileSync(join(out, `${id}-${m.version}.json`), `${JSON.stringify(m, null, 2)}\n`);
for (const old of publishedVersions(out, id).slice(0, -KEEP_VERSIONS)) {
  for (const f of [`${id}-${old}.zip`, `${id}-${old}.zip.sha256`, `${id}-${old}.json`]) rmSync(join(out, f), { force: true });
  log('publish.pruned', { appId: id, version: old });
}
log('publish.done', { appId: id, version: m.version, bytes: zip.length, sha256: hash, path: relative(ROOT, join(out, name)), next: 'commit published/ and open a PR; the mini PC pulls main' });
