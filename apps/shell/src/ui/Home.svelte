<script lang="ts">
  import { onMount } from 'svelte';
  import type { Shell } from '../shell.ts';
  import type { AppStatus } from '../host/lifecycle.ts';

  const { shell, onOpen, onNavigate }: { shell: Shell; onOpen: (id: string) => void; onNavigate: (v: 'diagnostics' | 'settings' | 'sync') => void } = $props();
  // `shell` is a constant composition root and is never reassigned.
  // svelte-ignore state_referenced_locally
  const shellState = shell.state;
  // svelte-ignore state_referenced_locally
  const syncState = shell.sync.status;
  let statuses = $state<readonly AppStatus[]>([]);
  // Spec §Home launcher: Synced, Pending (n), Offline, Error.
  const syncLabel = $derived($syncState.label === 'Pending' ? `Pending (${$syncState.queued})` : $syncState.label);

  onMount(() => {
    void shell.refreshReachability();
    return shell.statuses((s) => (statuses = s));
  });

  const apps = $derived(
    statuses
      .map((s) => ({ status: s, bundle: shell.bundles.get(s.appId) }))
      .filter((x) => x.bundle)
      .sort((a, b) => a.bundle!.manifest.name.localeCompare(b.bundle!.manifest.name)),
  );
</script>

<header class="bar">
  <h1>Super app</h1>
  <button type="button" class="sync" data-testid="sync-status" data-state={$syncState.label} onclick={() => onNavigate('sync')} aria-label={`Sync status: ${syncLabel}. ${$syncState.detail} Open Sync centre.`}>
    <span class="dot" aria-hidden="true"></span>{syncLabel}
  </button>
</header>

{#if $shellState.safeMode}
  <p class="banner" role="status">Safe mode is on. All subapps are disabled. Turn it off in Settings.</p>
{/if}

<section aria-labelledby="apps-heading" class="section">
  <h2 id="apps-heading">Apps</h2>
  {#if apps.length === 0}
    <p class="muted">No apps installed yet.</p>
  {:else}
    <ul class="grid">
      {#each apps as { status, bundle } (status.appId)}
        <li>
          <button
            type="button"
            class="tile"
            data-testid={`tile-${status.appId}`}
            data-state={status.state}
            disabled={status.state === 'disabled'}
            onclick={() => onOpen(status.appId)}
          >
            <span class="icon" aria-hidden="true">{bundle!.manifest.name.slice(0, 1)}</span>
            <span class="name">{bundle!.manifest.name}</span>
            {#if status.state !== 'installed'}<span class="state">{status.state}</span>{/if}
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<nav class="section actions" aria-label="Shell">
  <button type="button" onclick={() => onNavigate('sync')}>Sync centre</button>
  <button type="button" onclick={() => onNavigate('diagnostics')}>Diagnostics</button>
  <button type="button" onclick={() => onNavigate('settings')}>Settings</button>
</nav>

<style>
  .bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: var(--header-height);
    padding: 0 var(--space-4);
    background: var(--color-surface);
    border-bottom: 1px solid var(--color-border);
  }
  h1 {
    font-size: var(--font-size-lg);
    margin: 0;
  }
  h2 {
    font-size: var(--font-size-md);
    color: var(--color-text-muted);
    margin: 0 0 var(--space-3);
  }
  .sync {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--font-size-sm);
  }
  .dot {
    width: var(--space-2);
    height: var(--space-2);
    border-radius: 50%;
    background: var(--color-text-muted);
  }
  .sync[data-state='Synced'] .dot {
    background: var(--color-success);
  }
  .sync[data-state='Pending'] .dot {
    background: var(--color-warning);
  }
  .sync[data-state='Error'] .dot {
    background: var(--color-danger);
  }
  .banner {
    margin: var(--space-4);
    padding: var(--space-3);
    border-radius: var(--radius-sm);
    background: var(--color-surface-raised);
    color: var(--color-warning);
  }
  .section {
    padding: var(--space-4);
  }
  .grid {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(var(--tile-size), 1fr));
    gap: var(--space-3);
  }
  .tile {
    width: 100%;
    height: auto;
    padding: var(--space-3) var(--space-2);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-1);
    border-radius: var(--radius-md);
  }
  .icon {
    display: grid;
    place-items: center;
    width: var(--tap-target);
    height: var(--tap-target);
    border-radius: var(--radius-md);
    background: var(--color-accent);
    color: var(--color-accent-text);
    font-size: var(--font-size-lg);
    font-weight: 700;
  }
  .name {
    font-size: var(--font-size-sm);
  }
  .state {
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
  }
  .muted {
    color: var(--color-text-muted);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
  }
</style>
