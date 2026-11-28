import { validateManifest } from '@superapp/contracts';
import type { InstalledApp } from './lifecycle.ts';
import type { Logger } from '../core/logger.ts';

export interface BundleRef extends InstalledApp {
  /** Directory of the unpacked bundle, served by the shell origin, e.g. `/builtin/hello/1.0.0/`. */
  base: string;
  /** Server-installed bundles (ADR-009) are read from the local database instead of `base`. */
  loadHtml?: () => Promise<string>;
}

/**
 * M2 bundle source: reference subapps packed into the shell at build time (`tools/pack.mjs
 * --builtin`). Server-installed bundles (`files/subapps/<id>/<version>/`, SHA-256 verified) arrive
 * with the App manager in M5 behind the same interface.
 */
export async function loadBuiltinBundles(logger: Logger, fetchImpl: typeof fetch = (...a) => fetch(...a)): Promise<BundleRef[]> {
  const res = await fetchImpl('/builtin/index.json', { cache: 'no-store' });
  if (!res.ok) {
    logger.warn('bundles.builtin_index_missing', { status: res.status });
    return [];
  }
  const index = (await res.json()) as { apps?: { base?: unknown; manifest?: unknown }[] };
  const out: BundleRef[] = [];
  for (const entry of index.apps ?? []) {
    const v = validateManifest(entry.manifest);
    if (!v.ok) {
      logger.error('bundles.invalid_manifest', { errors: v.errors.slice(0, 5) });
      continue;
    }
    const base = typeof entry.base === 'string' && /^\/builtin\/[a-z0-9]+\/[0-9A-Za-z.+-]+\/$/.test(entry.base) ? entry.base : null;
    if (!base) {
      logger.error('bundles.invalid_base', { appId: v.manifest.id });
      continue;
    }
    out.push({ manifest: v.manifest, source: 'builtin', base });
  }
  return out;
}
