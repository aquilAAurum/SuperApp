// Spec: SDK < 15 KB minified. Run after `vite build`. Exits non-zero when over budget.
import { statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const LIMIT = 15 * 1024;
const file = fileURLToPath(new URL('../dist/superapp-sdk.iife.js', import.meta.url));
const size = statSync(file).size;
console.log(JSON.stringify({ check: 'sdk.size', bytes: size, limit: LIMIT, ok: size < LIMIT }));
process.exitCode = size < LIMIT ? 0 : 1;
