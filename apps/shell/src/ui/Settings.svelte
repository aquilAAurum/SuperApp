<script lang="ts">
  import type { Shell, ShellState } from '../shell.ts';
  import { SHELL_VERSION } from '../shell.ts';
  import { showToast } from './store.ts';

  const { shell, onBack, onSignedOut }: { shell: Shell; onBack: () => void; onSignedOut: () => void } = $props();
  // `shell` is a constant composition root and is never reassigned.
  // svelte-ignore state_referenced_locally
  const shellState = shell.state;

  async function changeTheme(e: Event) {
    await shell.setTheme((e.currentTarget as HTMLSelectElement).value as ShellState['theme']);
  }

  async function toggleSafeMode(e: Event) {
    const on = (e.currentTarget as HTMLInputElement).checked;
    await shell.setSafeMode(on);
    showToast(on ? 'Safe mode on: all subapps disabled.' : 'Safe mode off.');
  }

  type Row = { id: string; name: string; version: string; source: string };
  const rows = (): Row[] =>
    [...shell.bundles.values()]
      .map((b) => ({ id: b.manifest.id, name: b.manifest.name, version: b.manifest.version, source: b.source === 'server' ? 'from server' : 'built in' }))
      .sort((a, b) => a.name.localeCompare(b.name));
  let apps = $state<Row[]>(rows());
  let checking = $state(false);

  async function checkUpdates() {
    checking = true;
    try {
      const res = await shell.checkForUpdates();
      const rejected = res.filter((r) => r.outcome === 'rejected');
      if (rejected.length) showToast(`Update rejected: ${rejected.map((r) => `${r.appId} ${r.version} (${r.reason})`).join('; ')}`, 'error', 8000);
      else if (!res.length) showToast('All subapps are up to date.');
    } catch (err) {
      showToast(`Couldn't check for updates: ${(err as Error).message}`, 'error');
    } finally {
      checking = false;
      apps = rows();
    }
  }

  async function signOut() {
    await shell.signOut();
    showToast('Signed out.');
    onSignedOut();
  }
</script>

<header class="bar">
  <button type="button" onclick={onBack} aria-label="Back to launcher">←</button>
  <h1>Settings</h1>
</header>

<section class="section">
  <h2>Server</h2>
  <p data-testid="settings-server">{$shellState.serverUrl ?? 'Not configured'}</p>
  <p class="muted">Signed in as {$shellState.user?.email ?? '—'}</p>
  <button type="button" onclick={signOut}>Sign out</button>
</section>

<section class="section">
  <label for="theme">Theme</label>
  <select id="theme" value={$shellState.theme} onchange={changeTheme}>
    <option value="system">System</option>
    <option value="light">Light</option>
    <option value="dark">Dark</option>
  </select>
</section>

<section class="section">
  <div class="row">
    <input id="safe-mode" type="checkbox" checked={$shellState.safeMode} onchange={toggleSafeMode} />
    <label for="safe-mode">Safe mode (start with all subapps disabled)</label>
  </div>
</section>

<section class="section" aria-labelledby="subapps-heading">
  <h2 id="subapps-heading">Subapps</h2>
  <ul class="apps" data-testid="settings-subapps">
    {#each apps as a (a.id)}
      <li data-app-id={a.id}>{a.name} <span class="muted">{a.version} · {a.source}</span></li>
    {/each}
  </ul>
  <button type="button" onclick={checkUpdates} disabled={checking}>{checking ? 'Checking…' : 'Check for updates'}</button>
  <p class="muted">Updates are pulled from your server when Supra opens and every 6 hours. An update applies the next time that app starts.</p>
</section>

<section class="section">
  <h2>About</h2>
  <p>~Supra~ shell {SHELL_VERSION}</p>
</section>

<style>
  .apps {
    list-style: none;
    margin: 0 0 var(--space-3);
    padding: 0;
    display: grid;
    gap: var(--space-1);
  }
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
    margin: 0 0 var(--space-2);
  }
  .section {
    padding: var(--space-4);
    border-bottom: 1px solid var(--color-border);
  }
  .muted {
    color: var(--color-text-muted);
  }
  label {
    display: block;
    font-weight: 600;
    margin-bottom: var(--space-2);
  }
  .row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }
  .row input {
    width: var(--space-6);
    min-height: var(--space-6);
  }
  .row label {
    margin: 0;
  }
</style>
