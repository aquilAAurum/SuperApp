#!/usr/bin/env node
// Gate for CodeQL SARIF when results cannot be uploaded to GitHub code scanning (see codeql.yml).
// Prints every finding as a JSON line and exits non-zero if any has security-severity >= 7.0
// (GitHub's High/Critical threshold) or, lacking a score, SARIF level "error".
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2] ?? 'codeql-results';
const files = readdirSync(dir).filter((f) => f.endsWith('.sarif'));
if (files.length === 0) {
  console.error(JSON.stringify({ level: 'error', msg: 'sarif.missing', dir }));
  process.exit(1);
}

let blocking = 0;
let total = 0;
for (const f of files) {
  const sarif = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  for (const run of sarif.runs ?? []) {
    const rules = new Map();
    for (const r of run.tool?.driver?.rules ?? []) rules.set(r.id, r);
    for (const ext of run.tool?.extensions ?? []) for (const r of ext.rules ?? []) rules.set(r.id, r);
    for (const res of run.results ?? []) {
      total++;
      const rule = rules.get(res.ruleId) ?? {};
      const score = Number(rule.properties?.['security-severity'] ?? NaN);
      const level = res.level ?? rule.defaultConfiguration?.level ?? 'warning';
      const isBlocking = Number.isFinite(score) ? score >= 7 : level === 'error';
      if (isBlocking) blocking++;
      const loc = res.locations?.[0]?.physicalLocation;
      console.log(JSON.stringify({ level: isBlocking ? 'error' : 'warn', msg: 'sarif.finding', rule: res.ruleId, severity: Number.isFinite(score) ? score : level, file: loc?.artifactLocation?.uri, line: loc?.region?.startLine, text: res.message?.text?.slice(0, 200) }));
    }
  }
}
console.log(JSON.stringify({ level: blocking ? 'error' : 'info', msg: 'sarif.summary', total, blocking }));
process.exitCode = blocking ? 1 : 0;
