<script lang="ts">
  import { onMount } from 'svelte';
  import { API_VERSION } from '@superapp/contracts';
  import type { Shell } from '../shell.ts';
  import { SHELL_VERSION, syncStatus } from '../shell.ts';
  import type { InspectorEntry, Rejection } from '../bridge/types.ts';
  import type { AppStatus } from '../host/lifecycle.ts';

  const { shell, onBack }: { shell: Shell; onBack: () => void } = $props();
  // `shell` is a constant composition root and is never reassigned.
  // svelte-ignore state_referenced_locally
  const shellState = shell.state;
  let rejections = $state<readonly Rejection[]>([]);
  let inspector = $state<readonly InspectorEntry[]>([]);
  let statuses = $state<readonly AppStatus[]>([]);
  let filter = $state('');
  let webView = $state('…');

  onMount(() => {
    const offs = [
      shell.router.rejections.subscribe((r) => (rejections = [...r])),
      shell.router.inspector.subscribe((r) => (inspector = [...r])),
      shell.statuses((s) => (statuses = s)),
    ];
    shell.broker
      .device()
      .then((d) => (webView = d.webViewVersion || navigator.userAgent))
      .catch(() => (webView = navigator.userAgent));
    void shell.refreshReachability();
    return () => offs.forEach((o) => o());
  });

  // Re-evaluated whenever bridge traffic or app states change.
  const sessions = $derived((inspector.length, statuses.length, shell.router.sessionCount()));
  const shownInspector = $derived(inspector.filter((e) => !filter || e.appId === filter).slice(-100).reverse());
  const shownRejections = $derived(rejections.filter((e) => !filter || e.appId === filter).slice(-100).reverse());
</script>

<header class="bar">
  <button type="button" onclick={onBack} aria-label="Back to launcher">←</button>
  <h1>Diagnostics</h1>
</header>

<section class="section" aria-labelledby="health-h">
  <h2 id="health-h">Health</h2>
  <dl class="kv">
    <dt>Server</dt><dd data-testid="diag-server">{syncStatus($shellState.reachability).detail}</dd>
    <dt>Shell version</dt><dd>{SHELL_VERSION}</dd>
    <dt>Bridge API</dt><dd>{API_VERSION}</dd>
    <dt>Platform</dt><dd>{shell.broker.platform}</dd>
    <dt>WebView</dt><dd class="wrap">{webView}</dd>
    <dt>Live sessions</dt><dd data-testid="diag-sessions">{sessions}</dd>
  </dl>
</section>

<section class="section" aria-labelledby="apps-h">
  <h2 id="apps-h">Apps</h2>
  <table>
    <thead><tr><th scope="col">App</th><th scope="col">State</th><th scope="col">Handshake</th><th scope="col">Last error</th></tr></thead>
    <tbody>
      {#each statuses as s (s.appId)}
        <tr data-testid={`diag-app-${s.appId}`}>
          <td>{s.appId}</td>
          <td>{s.state}</td>
          <td data-testid={`diag-handshake-${s.appId}`} data-ms={s.handshakeMs ?? ''}>{s.handshakeMs === null ? '–' : `${s.handshakeMs} ms`}</td>
          <td>{s.lastError ?? '–'}</td>
        </tr>
      {/each}
    </tbody>
  </table>
</section>

<section class="section">
  <label for="diag-filter">Filter by app</label>
  <select id="diag-filter" bind:value={filter}>
    <option value="">All apps</option>
    {#each statuses as s (s.appId)}<option value={s.appId}>{s.appId}</option>{/each}
  </select>
</section>

<section class="section" aria-labelledby="errors-h">
  <h2 id="errors-h">Error log ({shownRejections.length})</h2>
  {#if shownRejections.length === 0}
    <p class="muted">No rejected calls.</p>
  {:else}
    <ol class="log" data-testid="error-log">
      {#each shownRejections as r, i (i)}
        <li><code>{r.ts}</code> <strong>{r.appId}</strong> {r.method} <span class="code">{r.code}</span> {r.message}</li>
      {/each}
    </ol>
  {/if}
</section>

<section class="section" aria-labelledby="insp-h">
  <h2 id="insp-h">Bridge inspector</h2>
  {#if shownInspector.length === 0}
    <p class="muted">No bridge traffic yet.</p>
  {:else}
    <ol class="log" data-testid="bridge-inspector">
      {#each shownInspector as e, i (i)}
        <li>
          <code>{e.ts.slice(11, 23)}</code> {e.direction === 'in' ? '→' : '←'} <strong>{e.appId}</strong> {e.kind} {e.method ?? ''}
          {#if e.ok === false}<span class="code">{e.code}</span>{/if}{#if e.ms !== undefined} · {e.ms} ms{/if}
        </li>
      {/each}
    </ol>
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
    margin: 0;
  }
  dt {
    color: var(--color-text-muted);
  }
  dd {
    margin: 0;
  }
  .wrap {
    overflow-wrap: anywhere;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--font-size-sm);
  }
  th,
  td {
    text-align: left;
    padding: var(--space-1) var(--space-2);
    border-bottom: 1px solid var(--color-border);
  }
  .log {
    margin: 0;
    padding-left: var(--space-4);
    font-size: var(--font-size-sm);
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    overflow-wrap: anywhere;
  }
  code {
    font-family: var(--font-mono);
  }
  .code {
    color: var(--color-danger);
    font-weight: 600;
  }
  .muted {
    color: var(--color-text-muted);
  }
  label {
    display: block;
    font-weight: 600;
    margin-bottom: var(--space-2);
  }
</style>
