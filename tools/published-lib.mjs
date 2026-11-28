// Helpers for the published/ folder (ADR-009): the hand-off point between Claude sessions, which
// commit built subapps here, and the mini PC, which pulls it (tools/sync-subapps.ps1).
//   published/<id>/<id>-<version>.zip          deterministic bundle (pack-lib buildZip)
//   published/<id>/<id>-<version>.zip.sha256   "<hash>  <file name>"
//   published/<id>/<id>-<version>.json         manifest (same as the zip's app.json)
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { unzipSync } from 'fflate';
import { compareVersions, validateManifest } from '../packages/contracts/src/index.ts';
import { sha256 } from './pack-lib.mjs';

export const KEEP_VERSIONS = 2;

/** Versions published for one app, oldest first. */
export function publishedVersions(dir, id) {
  if (!existsSync(dir)) return [];
  const re = new RegExp(`^${id}-(.+)\\.zip$`);
  return readdirSync(dir)
    .map((f) => re.exec(f)?.[1])
    .filter(Boolean)
    .sort(compareVersions);
}

/** Every problem with a published/ folder, as strings (empty = good). */
export function checkPublished(root) {
  const problems = [];
  if (!existsSync(root)) return problems;
  for (const id of readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)) {
    const dir = join(root, id);
    for (const version of publishedVersions(dir, id)) {
      const base = `${id}/${id}-${version}`;
      const zipPath = join(dir, `${id}-${version}.zip`);
      const zip = readFileSync(zipPath);
      const shaFile = `${zipPath}.sha256`;
      const jsonFile = join(dir, `${id}-${version}.json`);
      if (!existsSync(shaFile) || !existsSync(jsonFile)) {
        problems.push(`${base}: .zip.sha256 or .json missing`);
        continue;
      }
      if (readFileSync(shaFile, 'utf8').trim().split(/\s+/)[0] !== sha256(zip)) problems.push(`${base}: SHA-256 file does not match the zip`);
      let inner;
      try {
        inner = JSON.parse(new TextDecoder().decode(unzipSync(zip)['app.json']));
      } catch {
        problems.push(`${base}: zip has no readable app.json`);
        continue;
      }
      const v = validateManifest(inner);
      if (!v.ok) problems.push(`${base}: invalid manifest (${v.errors.slice(0, 2).join('; ')})`);
      else if (v.manifest.id !== id || v.manifest.version !== version) problems.push(`${base}: zip says ${v.manifest.id}@${v.manifest.version}`);
      else if (JSON.stringify(JSON.parse(readFileSync(jsonFile, 'utf8'))) !== JSON.stringify(v.manifest)) problems.push(`${base}: .json differs from the zip's app.json`);
    }
  }
  return problems;
}
