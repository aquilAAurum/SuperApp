<script lang="ts">
  import type { Shell } from '../shell.ts';
  import { consentCopy } from './consent-copy.ts';

  const { shell }: { shell: Shell } = $props();
  // `shell` is a constant composition root and is never reassigned.
  // svelte-ignore state_referenced_locally
  const consent = shell.consent;
  let allowBtn = $state<HTMLButtonElement | null>(null);

  const copy = $derived($consent ? consentCopy($consent.scope) : null);

  $effect(() => {
    // Move focus into the sheet when it opens so touch, keyboard and D-pad all land on it.
    if ($consent && allowBtn) allowBtn.focus();
  });

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') shell.decideConsent('dismiss');
  }
</script>

{#if $consent && copy}
  <div class="scrim" role="presentation"></div>
  <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="consent-title" aria-describedby="consent-body" data-testid="consent-sheet" tabindex="-1" onkeydown={onKey}>
    <h2 id="consent-title">{$consent.appName} wants to {copy.action}</h2>
    <p id="consent-body">{copy.detail}</p>
    <p class="muted">You can change this any time in Settings → Permissions.</p>
    <div class="actions">
      <button type="button" class="primary" bind:this={allowBtn} onclick={() => shell.decideConsent('allow')}>Allow</button>
      <button type="button" onclick={() => shell.decideConsent('allow_once')}>Allow once</button>
      <button type="button" onclick={() => shell.decideConsent('deny')}>Don't allow</button>
    </div>
  </div>
{/if}

<style>
  .scrim {
    position: fixed;
    inset: 0;
    background: rgb(0 0 0 / 0.4);
  }
  .sheet {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    padding: var(--space-6) var(--space-4) calc(var(--space-6) + var(--inset-bottom));
    background: var(--color-surface);
    color: var(--color-text);
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
    box-shadow: var(--shadow-raised);
  }
  h2 {
    font-size: var(--font-size-lg);
    margin: 0 0 var(--space-2);
  }
  p {
    margin: 0 0 var(--space-3);
  }
  .muted {
    color: var(--color-text-muted);
    font-size: var(--font-size-sm);
  }
  .actions {
    display: grid;
    gap: var(--space-2);
  }
  button {
    min-height: var(--tap-target);
    font: inherit;
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-border);
    background: var(--color-surface-raised);
    color: var(--color-text);
  }
  button.primary {
    background: var(--color-accent);
    color: var(--color-accent-text);
    border-color: var(--color-accent);
  }
  button:focus-visible {
    outline: var(--focus-ring);
    outline-offset: 2px;
  }
  @media (prefers-reduced-motion: no-preference) {
    .sheet {
      animation: rise var(--motion-duration) ease-out;
    }
  }
  @keyframes rise {
    from {
      transform: translateY(16px);
      opacity: 0;
    }
  }
</style>
