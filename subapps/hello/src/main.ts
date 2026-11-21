import { connect, BridgeError } from '@superapp/sdk';
import { runIsolationCheck } from './isolation.ts';

const sa = connect({ appId: 'hello' });
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function result(text: string, ok: boolean | null = null, testId?: string): void {
  const li = document.createElement('li');
  li.textContent = text;
  if (ok !== null) li.className = ok ? 'pass' : 'fail';
  if (testId) li.dataset.testid = testId;
  $('results').append(li);
}

function row(dl: HTMLElement, k: string, v: string): void {
  const dt = document.createElement('dt');
  dt.textContent = k;
  const dd = document.createElement('dd');
  dd.textContent = v;
  dl.append(dt, dd);
}

async function main(): Promise<void> {
  const ctx = await sa.ready;
  document.documentElement.dataset.theme = ctx.theme;
  $('status').textContent = sa.isHosted ? 'Connected to the shell.' : 'Standalone mode (no shell).';
  $('status').dataset.testid = 'hello-status';
  $('status').dataset.connected = 'true';
  const dl = $('context');
  row(dl, 'Hosted', String(sa.isHosted));
  row(dl, 'API', ctx.apiVersion);
  row(dl, 'Form factor', ctx.formFactor);
  row(dl, 'Device', ctx.device.name);
  row(dl, 'Granted scopes', ctx.grantedScopes.join(', ') || 'none');
  await sa.app.ready();
  await sa.data.subscribe<Note>(NOTES, renderNotes, { sort: '-n' });
  sa.data.onSyncFailed((e) => {
    const el = $('sync-failed');
    el.hidden = false;
    el.textContent = `A change to note ${e.recordId} needs attention (${e.status}). Open the Sync centre to resolve it.`;
  });
}

interface Note {
  id: string;
  text: string;
  n: number;
  version: number;
}

const NOTES = 'hello_notes';
let notes: Note[] = [];
let counter = Date.now();

function renderNotes(items: Note[]): void {
  notes = items;
  $('notes-count').textContent = String(items.length);
  const ul = $('notes');
  ul.replaceChildren(
    ...items.slice(0, 5).map((n) => {
      const li = document.createElement('li');
      li.textContent = `${n.text} (v${n.version})`;
      return li;
    }),
  );
}

$('note-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $<HTMLInputElement>('note-text');
  const text = input.value.trim();
  if (!text) return;
  await sa.data.create(NOTES, { text, n: counter++ });
  input.value = '';
});

$('btn-bulk').addEventListener('click', async () => {
  for (let i = 0; i < 100; i++) await sa.data.create(NOTES, { text: `Bulk note ${i + 1}`, n: counter++ });
  result('Wrote 100 notes.', true, 'result-bulk');
});

$('btn-edit-first').addEventListener('click', async () => {
  const first = notes[0];
  if (!first) return;
  await sa.data.update(NOTES, first.id, { text: `${first.text} (edited)` });
  result('Edited the first note.', true, 'result-edit');
});

$('btn-title').addEventListener('click', async () => {
  await sa.app.setTitle('Hello ✓');
  result('Title set.', true, 'result-title');
});

$('btn-caps').addEventListener('click', async () => {
  const caps = await sa.sys.capabilities();
  result(`Platform ${caps.platform}, methods: ${caps.methods.join(', ')}`, true, 'result-caps');
});

$('btn-isolation').addEventListener('click', async () => {
  const res = await runIsolationCheck();
  for (const r of res) result(`${r.name}: ${r.blocked ? 'blocked' : 'ALLOWED'} (${r.detail})`, r.blocked, `isolation-${r.name}`);
  await sa.sys.log(res.every((r) => r.blocked) ? 'info' : 'error', 'isolation_check', { allBlocked: res.every((r) => r.blocked) });
});

$('btn-denied').addEventListener('click', async () => {
  try {
    await sa.call('device.contacts.list', {});
    result('Contacts call was allowed (unexpected).', false, 'result-denied');
  } catch (err) {
    const code = err instanceof BridgeError ? err.code : 'UNKNOWN';
    result(`Contacts call rejected: ${code}`, code === 'SCOPE_DENIED', 'result-denied');
  }
});

$('btn-close').addEventListener('click', () => void sa.app.close());

main().catch((err: Error) => {
  $('status').textContent = `Could not connect: ${err.message}`;
});
