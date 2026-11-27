#!/usr/bin/env node
// Governance doc checks (CI). Mirrors reimagined-bassoon core/scripts/check-governance.js for an app repo:
//  1. ADR front matter: id matches file name, status, date, decided_by, supersedes paths exist and are marked.
//  2. Feature docs carry a valid SA-YYYY-NNN Feature ID and Status.
//  3. The Core pin is the same in ADR-001, AGENTS.md and project-profile.md.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const errors = [];
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const adrDir = 'docs/adr';
let corePin = null;
for (const f of readdirSync(join(ROOT, adrDir)).filter((x) => x.endsWith('.md'))) {
  const text = read(`${adrDir}/${f}`);
  const fm = text.match(/^---\n([\s\S]*?)\n---\n/)?.[1];
  if (!fm) {
    errors.push(`${f}: missing front matter`);
    continue;
  }
  const get = (k) => fm.match(new RegExp(`^${k}:\\s*(.*)$`, 'm'))?.[1]?.trim();
  const id = get('id');
  if (!id || !f.startsWith(`${id}_`)) errors.push(`${f}: id "${id}" must prefix the file name`);
  if (!['Proposed', 'Accepted', 'Superseded'].includes(get('status'))) errors.push(`${f}: status must be Proposed, Accepted or Superseded`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(get('date') ?? '')) errors.push(`${f}: date must be YYYY-MM-DD`);
  if (!get('decided_by')) errors.push(`${f}: decided_by required`);
  for (const m of fm.matchAll(/^\s+-\s+(\S+)$/gm)) {
    const p = m[1];
    if (!existsSync(join(ROOT, p))) errors.push(`${f}: superseded path ${p} does not exist`);
    else if (!/Superseded-by:/.test(read(p))) errors.push(`${f}: ${p} must carry "Superseded-by:"`);
  }
  if (id === 'ADR-001') corePin = get('core_pin');
}

if (!corePin || !/^[0-9a-f]{40}$/.test(corePin)) errors.push('ADR-001: core_pin must be a 40-char commit SHA');
else {
  const short = corePin.slice(0, 7);
  for (const p of ['AGENTS.md', 'project-profile.md']) if (!read(p).includes(short)) errors.push(`${p}: must reference Core pin ${short}`);
}

for (const f of readdirSync(join(ROOT, 'docs/features')).filter((x) => x.endsWith('.md'))) {
  const text = read(`docs/features/${f}`);
  const id = text.match(/\*\*Feature ID:\*\*\s*(SA-\d{4}-\d{3})/)?.[1];
  if (!id) errors.push(`${f}: missing **Feature ID:** SA-YYYY-NNN`);
  else if (!f.startsWith(id)) errors.push(`${f}: file name must start with ${id}`);
  if (!/\*\*Status:\*\*\s*(Proposal|Approved|Superseded)/.test(text)) errors.push(`${f}: missing **Status:**`);
}

if (errors.length) {
  for (const e of errors) console.error(`[FAIL] ${e}`);
  process.exitCode = 1;
} else {
  console.log('[PASS] governance docs');
}
