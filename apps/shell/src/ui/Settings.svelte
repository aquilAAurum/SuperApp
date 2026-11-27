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

<section class="section">
  <h2>About</h2>
  <p>Super app shell {SHELL_VERSION}</p>
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
