<script lang="ts">
  import type { Shell } from '../shell.ts';
  import { validateServerUrl } from '../core/url-policy.ts';
  import { showToast } from './store.ts';

  const { shell, onDone }: { shell: Shell; onDone: () => void } = $props();
  // `shell` is a constant composition root and is never reassigned.
  // svelte-ignore state_referenced_locally
  let url = $state(shell.server.url ?? '');
  let email = $state('');
  let password = $state('');
  let busy = $state(false);
  let error = $state('');

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    error = '';
    const check = validateServerUrl(url);
    if (!check.ok) {
      error = check.error;
      return;
    }
    busy = true;
    try {
      await shell.setup(check.url, email.trim(), password);
      password = '';
      showToast('Signed in. This phone is registered.');
      onDone();
    } catch (err) {
      error = (err as Error).message;
    } finally {
      busy = false;
    }
  }
</script>

<section class="setup">
  <h1>Set up ~Supra~</h1>
  <p class="muted">Connect to your mini PC over Tailscale or your home network.</p>
  <form onsubmit={submit} novalidate>
    <label for="server-url">Server URL</label>
    <input id="server-url" type="url" inputmode="url" autocomplete="url" placeholder="https://minipc.tailnet.ts.net" bind:value={url} required />

    <label for="email">Email</label>
    <input id="email" type="email" autocomplete="username" bind:value={email} required />

    <label for="password">Password</label>
    <input id="password" type="password" autocomplete="current-password" bind:value={password} required />

    {#if error}
      <p class="error" role="alert" data-testid="setup-error">{error}</p>
    {/if}
    <button class="primary" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in and register this phone'}</button>
  </form>
</section>

<style>
  .setup {
    max-width: 480px;
    margin: 0 auto;
    padding: var(--space-6) var(--space-4);
  }
  h1 {
    font-size: var(--font-size-xl);
    margin: 0 0 var(--space-2);
  }
  .muted {
    color: var(--color-text-muted);
    margin: 0 0 var(--space-6);
  }
  form {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  label {
    font-weight: 600;
    margin-top: var(--space-2);
  }
  button {
    margin-top: var(--space-4);
  }
  .error {
    color: var(--color-danger);
    margin: var(--space-2) 0 0;
  }
</style>
