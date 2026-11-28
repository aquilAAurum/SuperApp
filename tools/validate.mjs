#!/usr/bin/env node
// Step 0 (D05): Environment & Prerequisite Validation. Reflects the architecture in
// project-profile.md and exits non-zero on failure (HB-QUAL-04).
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok: Boolean(ok), detail });
const read = (p) => (existsSync(join(ROOT, p)) ? readFileSync(join(ROOT, p), 'utf8') : '');

check('Node.js >= 22', Number(process.versions.node.split('.')[0]) >= 22, process.version);

for (const f of [
  'package.json', 'pnpm-lock.yaml', 'project-profile.md', 'AGENTS.md', 'CLAUDE.md', 'SECURITY.md', 'THREAT_MODEL.md',
  'eslint.config.js', '.github/workflows/ci.yml', '.github/workflows/codeql.yml', '.github/workflows/release.yml',
  '.github/dependabot.yml', '.github/pull_request_template.md', '.github/CODEOWNERS',
  'packages/contracts/src/methods.ts', 'packages/sdk/src/index.ts',
  'apps/shell/src/native/CapabilityBroker.ts', 'apps/shell/src/server/ServerClient.ts', 'apps/shell/capacitor.config.ts',
  'apps/shell/android/app/src/main/AndroidManifest.xml',
  'server/pb_hooks/ops.pb.js', 'subapps/hello/app.json',
]) check(`file present: ${f}`, existsSync(join(ROOT, f)));

const pkg = JSON.parse(read('package.json'));
for (const s of ['validate', 'lint', 'typecheck', 'test', 'build', 'test:e2e']) check(`script "${s}" defined`, pkg.scripts?.[s]);

// Spec implementation notes encoded as checks.
const migrations = readdirSync(join(ROOT, 'server/pb_migrations')).filter((f) => f.endsWith('.js'));
check('PocketBase migrations committed', migrations.length > 0, `${migrations.length} file(s)`);

// ADR-009: what the mini PC pulls must be intact (hash, manifest, zip contents agree).
const { checkPublished } = await import('./published-lib.mjs');
const publishedProblems = checkPublished(join(ROOT, 'published'));
check('published/ subapp bundles are intact', publishedProblems.length === 0, publishedProblems.slice(0, 3).join('; '));

const cap = read('apps/shell/capacitor.config.ts');
check('WebView debugging disabled in release config', /webContentsDebuggingEnabled:\s*false/.test(cap));
check('Capacitor serves the shell over https scheme', /androidScheme:\s*'https'/.test(cap));

const sandbox = read('apps/shell/src/host/sandbox.ts');
check("iframe sandbox has no allow-same-origin", /IFRAME_SANDBOX = 'allow-scripts allow-forms'/.test(sandbox) && !/allow-same-origin'/.test(sandbox.split('IFRAME_SANDBOX =')[1].split('\n')[0]));
check("subapp CSP blocks network (connect-src 'none')", sandbox.includes(`"connect-src 'none'"`));

const manifestPath = 'apps/shell/android/app/src/main/AndroidManifest.xml';
if (existsSync(join(ROOT, manifestPath))) {
  const am = read(manifestPath);
  const allowed = new Set(['INTERNET', 'ACCESS_NETWORK_STATE', 'POST_NOTIFICATIONS', 'ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION', 'READ_CONTACTS', 'VIBRATE', 'USE_BIOMETRIC']);
  // Health Connect (ADR-010): exactly the permissions the contract maps to, nothing broader.
  const { HEALTH_READ_PERMISSION, HEALTH_WRITE_PERMISSION } = await import('../packages/contracts/src/health.ts');
  const health = new Set([...Object.values(HEALTH_READ_PERMISSION), ...Object.values(HEALTH_WRITE_PERMISSION)].map((p) => `health.${p}`));
  // Every <uses-permission>, whatever its namespace (android.permission.health.* included).
  const declared = [...am.matchAll(/<uses-permission[^>]*android:name="([^"]+)"/g)].map((m) => m[1].replace(/^android\.permission\./, ''));
  const extra = declared.filter((p) => !allowed.has(p) && !health.has(p));
  check('AndroidManifest declares only v1 permissions (+ ADR-010 Health Connect)', extra.length === 0, extra.join(', ') || declared.join(', '));
  const missingHealth = [...health].filter((p) => !declared.includes(p));
  check('Health Connect permissions match the contract (ADR-010)', missingHealth.length === 0, missingHealth.join(', '));
  check('Health Connect rationale activity declared (ADR-010)', /androidx\.health\.ACTION_SHOW_PERMISSIONS_RATIONALE/.test(am) && /android\.intent\.category\.HEALTH_PERMISSIONS/.test(am));
  check('Android backups disabled (secrets stay in Keystore)', /android:allowBackup="false"/.test(am));
  check('Cleartext traffic disabled (network_security_config)', !/usesCleartextTraffic="true"/.test(am) && /cleartextTrafficPermitted="false"/.test(read('apps/shell/android/app/src/main/res/xml/network_security_config.xml')));
}

const gradle = read('apps/shell/android/app/build.gradle');
const releaseBlock = gradle.split(/buildTypes\s*\{/)[1]?.split(/release\s*\{/)[1]?.split('}')[0] ?? '';
check('Release build never signs with the debug key (HB-REL-02)', releaseBlock !== '' && !/signingConfigs\.debug/.test(releaseBlock));

const ci = read('.github/workflows/ci.yml') + read('.github/workflows/codeql.yml') + read('.github/workflows/release.yml');
const unpinned = [...ci.matchAll(/uses:\s*([^\s#]+)/g)].map((m) => m[1]).filter((u) => !/@[0-9a-f]{40}$/.test(u));
check('CI actions pinned to full commit SHAs (HB-SUP-01)', unpinned.length === 0, unpinned.join(', '));

const manual = [
  'Mini PC: Tailscale HTTPS + PocketBase service (docs/runbook.md §1) — HB-OPS-02',
  'GitHub: secret scanning + push protection, branch protection with required checks (project-profile.md §7) — HB-SEC-02',
  'Android signing keystore stored in the protected "release" environment — HB-REL-02',
];

console.log('--- Step 0: Environment & Prerequisite Validation (SuperApp) ---');
for (const r of results) console.log(`[${r.ok ? 'PASS' : 'FAIL'}] ${r.name}${r.detail ? ` (${r.detail})` : ''}`);
for (const m of manual) console.log(`[MANUAL] ${m}`);
const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `\n${failed} check(s) failed.` : '\nAll automated checks passed.');
process.exitCode = failed ? 1 : 0;
