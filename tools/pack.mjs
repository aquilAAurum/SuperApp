#!/usr/bin/env node
// Packs a built subapp (spec §Packaging and install):
//   node tools/pack.mjs <subappDir> [--builtin <shellPublicDir>] [--out <dir>]
// 1. validates app.json against packages/contracts (same rules the shell enforces),
// 2. zips dist/ + app.json (app.json at the root), writes <id>-<version>.zip and its SHA-256,
// 3. with --builtin, also unpacks it into <shellPublicDir>/builtin/<id>/<version>/ and updates index.json.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { validateManifest } from '../packages/contracts/src/manifest.ts';
import { buildZip, mergeIndex, sha256 } from './pack-lib.mjs';

const args = process.argv.slice(2);
const dir = resolve(args[0] ?? '.');
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? resolve(args[i + 1]) : null;
};
const log = (msg, fields = {}) => console.log(JSON.stringify({ ts: new Date().toISOString(), level: 'info', msg, ...fields }));
const die = (msg, fields = {}) => {
  console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'error', msg, ...fields }));
  process.exit(1);
};

const manifestRaw = JSON.parse(readFileSync(join(dir, 'app.json'), 'utf8'));
const v = validateManifest(manifestRaw);
if (!v.ok) die('pack.invalid_manifest', { errors: v.errors });
const m = v.manifest;

const dist = join(dir, 'dist');
if (!existsSync(join(dist, m.entry))) die('pack.entry_missing', { entry: m.entry, hint: 'run the subapp build first' });

const files = { 'app.json': new TextEncoder().encode(JSON.stringify(m, null, 2)) };
const walk = (d) => {
  for (const name of readdirSync(d)) {
    const full = join(d, name);
    if (statSync(full).isDirectory()) walk(full);
    else files[relative(dist, full).split('\\').join('/')] = readFileSync(full);
  }
};
walk(dist);

const zip = buildZip(files);
const hash = sha256(zip);
const out = flag('--out') ?? join(dir, 'release');
mkdirSync(out, { recursive: true });
const zipName = `${m.id}-${m.version}.zip`;
writeFileSync(join(out, zipName), zip);
writeFileSync(join(out, `${zipName}.sha256`), `${hash}  ${zipName}\n`);
log('pack.zip_written', { appId: m.id, version: m.version, bytes: zip.length, sha256: hash });

const pub = flag('--builtin');
if (pub) {
  const target = join(pub, 'builtin', m.id, m.version);
  rmSync(join(pub, 'builtin', m.id), { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  cpSync(dist, target, { recursive: true });
  writeFileSync(join(target, 'app.json'), JSON.stringify(m, null, 2));
  const indexPath = join(pub, 'builtin', 'index.json');
  const index = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, 'utf8')) : null;
  writeFileSync(indexPath, JSON.stringify(mergeIndex(index, { base: `/builtin/${m.id}/${m.version}/`, sha256: hash, manifest: m }), null, 2));
  log('pack.builtin_installed', { appId: m.id, path: relative(process.cwd(), target) });
}
