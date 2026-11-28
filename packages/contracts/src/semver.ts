/**
 * Semantic-version ordering for subapp bundles (`1.2.10` > `1.2.9`; a release beats its own
 * pre-release, `1.0.0` > `1.0.0-beta.2`). Anything that isn't `n.n.n[-tag]` sorts below every
 * valid version, so a malformed record can never win an update.
 */
const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export function compareVersions(a: string, b: string): number {
  const x = SEMVER.exec(a);
  const y = SEMVER.exec(b);
  if (!x || !y) return x ? 1 : y ? -1 : 0;
  for (let i = 1; i <= 3; i++) {
    const d = Number(x[i]) - Number(y[i]);
    if (d) return Math.sign(d);
  }
  const pa = x[4];
  const pb = y[4];
  if (!pa || !pb) return pa ? -1 : pb ? 1 : 0;
  const sa = pa.split('.');
  const sb = pb.split('.');
  for (let i = 0; i < Math.max(sa.length, sb.length); i++) {
    const p = sa[i];
    const q = sb[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    const np = /^\d+$/.test(p);
    const nq = /^\d+$/.test(q);
    if (np && nq && Number(p) !== Number(q)) return Math.sign(Number(p) - Number(q));
    if (np !== nq) return np ? -1 : 1;
    if (p !== q) return p < q ? -1 : 1;
  }
  return 0;
}

export const isVersion = (v: unknown): v is string => typeof v === 'string' && SEMVER.test(v);
