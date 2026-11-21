<script lang="ts">
  import { onMount } from 'svelte';
  import type { Shell } from '../shell.ts';
  import { syncStatus } from '../shell.ts';
  import type { OutboxRow } from '../sync/store.ts';
  import type { Resolution } from '../sync/resolve.ts';
  import { showToast } from './store.ts';

  const { shell, onBack }: { shell: Shell; onBack: () => void } = $props();
  // `shell` is a constant composition root and is never reassigned.
  // svelte-ignore state_referenced_locally
  const status = shell.sync.status;
  // svelte-ignore state_referenced_locally
  const rows = shell.sync.rows;
  // svelte-ignore state_referenced_locally
  const shellState = shell.state;
  let now = $state(Date.now());

  onMount(() => {
    void shell.sync.refreshStatus();
    void shell.refreshReachability();
    const t = setInterval(() => (now = Date.now()), 5_000);
    return () => clearInterval(t);
  });

  const attention = $derived($rows.filter((r) => r.status !== 'queued'));
  const queued = $derived($rows.filter((r) => r.status === 'queued'));
  const age = (iso: string | null) => {
    if (!iso) return '—';
    const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
    return s < 60 ? `${s} s` : s < 3600 ? `${Math.round(s / 60)} min` : `${Math.round(s / 3600)} h`;
  };
  const describe = (r: OutboxRow) => `${r.appId} · ${r.op} ${r.collection}/${r.recordId}`;

  async function act(r: OutboxRow, action: Resolution) {
    await shell.sync.resolve(r.seq, action);
    showToast(action === 'retry' || action === 'recreate' ? 'Queued again.' : 'Local change discarded.');
  }

  async function syncNow() {
    await shell.refreshReachability();
    await shell.sync.sync();
  }
</script>

<header class="bar">
  <button type="button" onclick={onBack} aria-label="Back to launcher">←</button>
  <h1>Sync centre</h1>
</header>

<section class="section" aria-labelledby="sync-h">
  <h2 id="sync-h">Status</h2>
  <dl class="kv">
    <dt>State</dt><dd data-testid="sync-centre-state">{$status.label}</dd>
    <dt>Server</dt><dd>{syncStatus($shellState.reachability).detail}</dd>
    <dt>Last successful sync</dt><dd>{$status.lastSyncAt ? `${age($status.lastSyncAt)} ago` : 'Not yet'}</dd>
    <dt>Outbox</dt><dd data-testid="sync-outbox-count">{queued.length}</dd>
    <dt>Oldest item</dt><dd>{age($status.oldestCreatedAt)}</dd>
  </dl>
  <p class="muted">{$status.detail}</p>
  <button type="button" onclick={syncNow}>Sync now</button>
</section>

<section class="section" aria-labelledby="att-h">
  <h2 id="att-h">Needs attention ({attention.length})</h2>
  {#if attention.length === 0}
    <p class="muted">Nothing needs attention.</p>
  {:else}
    <ul class="items" data-testid="needs-attention">
      {#each attention as r (r.seq)}
        <li class="item" data-testid={`attention-${r.recordId}`} data-status={r.status}>
          <p><strong>{r.status === 'conflict' ? (r.conflictKind === 'deleted_on_server' ? 'Deleted on server' : 'Conflict') : 'Failed'}</strong> · {describe(r)}</p>
          <p class="muted">{r.lastError}</p>
          {#if r.status === 'conflict' && r.server}
            <details>
              <summary>Compare versions</summary>
              <p class="label">Mine</p>
              <pre>{JSON.stringify(r.payload, null, 2)}</pre>
              <p class="label">Server (v{r.server.version})</p>
              <pre>{JSON.stringify(r.server, null, 2)}</pre>
            </details>
          {/if}
          <div class="row">
            {#if r.status === 'conflict' && r.conflictKind === 'deleted_on_server'}
              <button type="button" onclick={() => act(r, 'recreate')}>Recreate</button>
              <button type="button" onclick={() => act(r, 'discard')}>Discard</button>
            {:else if r.status === 'conflict'}
              <button type="button" onclick={() => act(r, 'retry')}>Apply mine</button>
              <button type="button" onclick={() => act(r, 'keep_server')}>Keep server version</button>
            {:else}
              <button type="button" onclick={() => act(r, 'retry')}>Retry</button>
              <button type="button" onclick={() => act(r, 'discard')}>Discard</button>
            {/if}
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<section class="section" aria-labelledby="q-h">
  <h2 id="q-h">Waiting to sync ({queued.length})</h2>
  {#if queued.length === 0}
    <p class="muted">Outbox is empty.</p>
  {:else}
    <ol class="items">
      {#each queued.slice(0, 50) as r (r.seq)}
        <li>{describe(r)} · {age(r.createdAt)}{r.attempts ? ` · ${r.attempts} attempt(s): ${r.lastError}` : ''}</li>
      {/each}
    </ol>
    {#if queued.length > 50}<p class="muted">…and {queued.length - 50} more.</p>{/if}
  {/if}
</section>

<style>
  .bar {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    height: var(--header-height);
    padding: 0 var(--space-2);
    background: var(--color-surface);
    border-bottom: 1px solid var(--color-border);
  }
  h1 {
    font-size: var(--font-size-lg);
    margin: 0;
  }
  h2 {
    font-size: var(--font-size-md);
    margin: 0 0 var(--space-3);
  }
  .section {
    padding: var(--space-4);
    border-bottom: 1px solid var(--color-border);
  }
  .kv {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: var(--space-2) var(--space-4);
    margin: 0 0 var(--space-3);
  }
  dt,
  .muted,
  .label {
    color: var(--color-text-muted);
  }
  dd {
    margin: 0;
  }
  .items {
    margin: 0;
    padding-left: var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    overflow-wrap: anywhere;
  }
  ul.items {
    list-style: none;
    padding: 0;
  }
  .item {
    padding: var(--space-3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-surface);
  }
  .item p {
    margin: 0 0 var(--space-2);
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  pre {
    font-family: var(--font-mono);
    font-size: var(--font-size-sm);
    white-space: pre-wrap;
    background: var(--color-surface-raised);
    padding: var(--space-2);
    border-radius: var(--radius-sm);
  }
</style>
