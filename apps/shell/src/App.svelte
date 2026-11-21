<script lang="ts">
  import { onMount } from 'svelte';
  import type { Shell } from './shell.ts';
  import Setup from './ui/Setup.svelte';
  import Home from './ui/Home.svelte';
  import Diagnostics from './ui/Diagnostics.svelte';
  import Settings from './ui/Settings.svelte';
  import Toasts from './ui/Toasts.svelte';
  import { showToast } from './ui/store.ts';

  const { shell }: { shell: Shell } = $props();

  type View = 'loading' | 'setup' | 'home' | 'app' | 'diagnostics' | 'settings';
  let view = $state<View>('loading');
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
    void shell.broker.onBackButton(() => (view === 'home' ? undefined : goHome())).then((f) => (offBack = f));
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
      <Home {shell} onOpen={open} onNavigate={(v) => (view = v)} />
    {:else if view === 'diagnostics'}
      <Diagnostics {shell} onBack={() => (view = 'home')} />
    {:else if view === 'settings'}
      <Settings {shell} onBack={() => (view = 'home')} onSignedOut={() => (view = 'setup')} />
    {/if}
  </main>

  <section class="host" bind:this={host} hidden={view !== 'app'} aria-label="Running app" data-testid="subapp-host"></section>
  <Toasts />
</div>

<style>
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
