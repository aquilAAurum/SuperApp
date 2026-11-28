<script lang="ts">
  import { toasts } from './store.ts';
</script>

<!-- CORE-24: non-blocking feedback in an aria-live region. -->
<div class="toasts" role="status" aria-live="polite" data-testid="toasts">
  {#each $toasts as t (t.id)}
    <div class="toast" class:error={t.kind === 'error'}>{t.text}</div>
  {/each}
</div>

<style>
  .toasts {
    position: fixed;
    left: var(--space-4);
    right: var(--space-4);
    bottom: calc(var(--space-4) + var(--inset-bottom));
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    pointer-events: none;
  }
  .toast {
    padding: var(--space-3) var(--space-4);
    border-radius: var(--radius-sm);
    background: var(--color-text);
    color: var(--color-bg);
    box-shadow: var(--shadow-raised);
  }
  .toast.error {
    background: var(--color-danger);
    color: var(--color-surface);
  }
</style>
