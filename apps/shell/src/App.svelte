<script lang="ts">
  import { onMount } from 'svelte';
  import type { Shell } from './shell.ts';
  import Setup from './ui/Setup.svelte';
  import Apps from './ui/Apps.svelte';
  import Today from './ui/today/Today.svelte';
  import Week from './ui/today/Week.svelte';
  import QuickAdd from './ui/today/QuickAdd.svelte';
  import { ymd } from './today/agenda.ts';
  import Diagnostics from './ui/Diagnostics.svelte';
  import Settings from './ui/Settings.svelte';
  import SyncCentre from './ui/SyncCentre.svelte';
  import Toasts from './ui/Toasts.svelte';
  import ConsentSheet from './ui/ConsentSheet.svelte';
  import { showToast } from './ui/store.ts';

  const { shell }: { shell: Shell } = $props();

  type View = 'loading' | 'setup' | 'home' | 'week' | 'apps' | 'app' | 'diagnostics' | 'settings' | 'sync';
  let view = $state<View>('loading');
  let selectedDay = $state(ymd(new Date()));
  let adding = $state(false);
  const tabbed = $derived(view === 'home' || view === 'week' || view === 'apps');
  let activeApp = $state<string | null>(null);
  let host: HTMLElement;
  // `shell` is a constant composition root and is never reassigned.
  // svelte-ignore state_referenced_locally
  const shellState = shell.state;
  // `shell` is a constant composition root and is never reassigned.
  // svelte-ignore state_referenced_locally
  const titles = shell.titles;

  $effect(() => {
    const t = $shellState.theme;
    if (t === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.dataset.theme = t;
  });

  function goHome() {
    if (activeApp) shell.lifecycle.suspend(activeApp);
    activeApp = null;
    view = 'home';
  }

  async function open(appId: string) {
    activeApp = appId;
    view = 'app';
    const st = await shell.lifecycle.launch(appId);
    if (st.state === 'crashed') {
      showToast(`${appId} could not start: ${st.lastError}`, 'error');
      goHome();
    }
  }

  onMount(() => {
    shell.mountHost(host);
    shell.onAppClosed = (appId) => {
      if (activeApp === appId) {
        activeApp = null;
        view = 'home';
      }
    };
    const offStatus = shell.statuses((all) => {
      const cur = all.find((s) => s.appId === activeApp);
      if (cur && cur.state === 'crashed' && view === 'app') {
        showToast(`${cur.appId} stopped: ${cur.lastError}`, 'error');
        activeApp = null;
        view = 'home';
      }
    });
    let offBack = () => {};
    let offResume = () => {};
    // SA-U4: Back closes the topmost surface; an open consent sheet counts as "not now".
    void shell.broker
      .onBackButton(() => {
        if (shell.consent.get()) shell.decideConsent('dismiss');
        else if (adding) adding = false;
        else if (view !== 'home') goHome();
      })
      .then((f) => (offBack = f));
    void shell.broker.onResume(() => void shell.refreshReachability()).then((f) => (offResume = f));
    shell
      .boot()
      .then((v) => (view = v))
      .catch((err: Error) => {
        showToast(`Startup failed: ${err.message}`, 'error');
        view = 'setup';
      });
    return () => {
      offStatus();
      offBack();
      offResume();
      shell.lifecycle.destroyAll();
    };
  });
</script>

<div class="shell">
  {#if view === 'app' && activeApp}
    <header class="app-bar">
      <button type="button" onclick={goHome} aria-label="Back to launcher">←</button>
      <h1>{$titles[activeApp] ?? shell.bundles.get(activeApp)?.manifest.name ?? activeApp}</h1>
    </header>
  {/if}

  <main class="content" hidden={view === 'app'}>
    {#if view === 'loading'}
      <p class="loading" role="status">Starting…</p>
    {:else if view === 'setup'}
      <Setup {shell} onDone={() => (view = 'home')} />
    {:else if view === 'home'}
      <Today {shell} day={selectedDay} onDay={(d) => (selectedDay = d)} onOpen={open} onNavigate={(v) => (view = v)} onQuickAdd={() => (adding = true)} />
    {:else if view === 'week'}
      <Week {shell} day={selectedDay} onDay={(d) => (selectedDay = d)} onOpenDay={(d) => { selectedDay = d; view = 'home'; }} />
    {:else if view === 'apps'}
      <Apps {shell} onOpen={open} onNavigate={(v) => (view = v)} />
    {:else if view === 'sync'}
      <SyncCentre {shell} onBack={() => (view = 'home')} />
    {:else if view === 'diagnostics'}
      <Diagnostics {shell} onBack={() => (view = 'home')} />
    {:else if view === 'settings'}
      <Settings {shell} onBack={() => (view = 'home')} onSignedOut={() => (view = 'setup')} />
    {/if}
  </main>

  <section class="host" bind:this={host} hidden={view !== 'app'} aria-label="Running app" data-testid="subapp-host"></section>
  {#if tabbed}
    <nav class="tabs" aria-label="Main">
      <button type="button" aria-current={view === 'home' ? 'page' : undefined} onclick={() => { view = 'home'; }}>Today</button>
      <button type="button" aria-current={view === 'week' ? 'page' : undefined} onclick={() => (view = 'week')}>Week</button>
      <button type="button" class="add" aria-label="Add to agenda" data-testid="add-button" onclick={() => (adding = true)}>+</button>
      <button type="button" aria-current={view === 'apps' ? 'page' : undefined} onclick={() => (view = 'apps')}>Apps</button>
      <button type="button" onclick={() => (view = 'settings')}>Settings</button>
    </nav>
  {/if}
  {#if adding}
    <QuickAdd {shell} day={selectedDay} onClose={() => (adding = false)} />
  {/if}
  <ConsentSheet {shell} />
  <Toasts />
</div>

<style>
  .tabs {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    align-items: center;
    height: var(--nav-height);
    background: var(--color-surface);
    border-top: 1px solid var(--color-border);
  }
  .tabs button {
    min-height: var(--tap-target);
    border: 0;
    background: none;
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
  }
  .tabs button[aria-current='page'] {
    color: var(--color-accent);
    font-weight: 700;
  }
  .tabs .add {
    justify-self: center;
    width: var(--tap-target);
    border-radius: 50%;
    background: var(--color-accent);
    color: var(--color-accent-text);
    font-size: var(--font-size-xl);
    line-height: 1;
  }
  .shell {
    display: flex;
    flex-direction: column;
    height: 100%;
  }
  .app-bar {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    height: var(--header-height);
    padding: 0 var(--space-2);
    background: var(--color-surface);
    border-bottom: 1px solid var(--color-border);
  }
  .app-bar h1 {
    font-size: var(--font-size-lg);
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .content {
    flex: 1;
    overflow: auto;
  }
  .content[hidden],
  .host[hidden] {
    display: none;
  }
  .host {
    flex: 1;
    min-height: 0;
  }
  .loading {
    padding: var(--space-6);
    color: var(--color-text-muted);
  }
</style>
