<script lang="ts">
  import { onMount } from 'svelte';
  import type { Shell } from '../../shell.ts';
  import type { QuickAddInput } from '../../today/service.ts';
  import { showToast } from '../store.ts';

  const { shell, day, onClose }: { shell: Shell; day: string; onClose: () => void } = $props();

  type Kind = QuickAddInput['kind'];
  const KINDS: { value: Kind; label: string }[] = [
    { value: 'event', label: 'Event' },
    { value: 'task', label: 'Task' },
    { value: 'reminder', label: 'Reminder' },
    { value: 'focus', label: 'Focus' },
  ];
  let title = $state('');
  let kind = $state<Kind>('event');
  // svelte-ignore state_referenced_locally
  let date = $state(day);
  let time = $state('');
  let duration = $state(60);
  let busy = $state(false);
  let error = $state('');
  let input: HTMLInputElement;

  onMount(() => {
    input.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  async function save(e: SubmitEvent) {
    e.preventDefault();
    error = '';
    const m = /^(\d{2}):(\d{2})$/.exec(time);
    if ((kind === 'event' || kind === 'focus' || kind === 'reminder') && !m) {
      error = 'Choose a time for events, reminders and focus blocks.';
      return;
    }
    busy = true;
    try {
      await shell.today.quickAdd({ title, kind, day: date, timeMin: m ? Number(m[1]) * 60 + Number(m[2]) : null, durationMin: duration });
      showToast(`${KINDS.find((k) => k.value === kind)!.label} added.`);
      onClose();
    } catch (err) {
      error = (err as Error).message;
    } finally {
      busy = false;
    }
  }
</script>

<div class="scrim" role="presentation" onclick={onClose}></div>
<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="qa-h" data-testid="quick-add">
  <h2 id="qa-h">Add to your agenda</h2>
  <form onsubmit={save}>
    <label for="qa-title">What</label>
    <input id="qa-title" bind:this={input} bind:value={title} maxlength="200" autocomplete="off" required />

    <fieldset>
      <legend>Type</legend>
      <div class="seg">
        {#each KINDS as k (k.value)}
          <label class="opt" class:on={kind === k.value}>
            <input type="radio" name="qa-kind" value={k.value} bind:group={kind} />
            {k.label}
          </label>
        {/each}
      </div>
    </fieldset>

    <div class="two">
      <div>
        <label for="qa-date">Day</label>
        <input id="qa-date" type="date" bind:value={date} required />
      </div>
      <div>
        <label for="qa-time">Time{kind === 'task' ? ' (optional)' : ''}</label>
        <input id="qa-time" type="time" bind:value={time} />
      </div>
    </div>

    {#if kind === 'event' || kind === 'focus'}
      <label for="qa-dur">Length</label>
      <select id="qa-dur" bind:value={duration}>
        {#each [15, 30, 45, 60, 90, 120, 180] as d (d)}<option value={d}>{d < 60 ? `${d} min` : `${d / 60} h`}</option>{/each}
      </select>
    {/if}

    {#if error}<p class="error" role="alert">{error}</p>{/if}
    <div class="actions">
      <button type="button" onclick={onClose}>Cancel</button>
      <button type="submit" class="primary" disabled={busy}>{busy ? 'Saving…' : 'Add'}</button>
    </div>
  </form>
</div>

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
    max-height: 90%;
    overflow-y: auto;
    padding: var(--space-4) var(--space-4) calc(var(--space-4) + var(--inset-bottom));
    background: var(--color-surface);
    border-radius: var(--radius-xl) var(--radius-xl) 0 0;
    box-shadow: var(--shadow-raised);
  }
  h2 {
    margin: 0 0 var(--space-3);
    font-size: var(--font-size-lg);
  }
  form {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  label,
  legend {
    font-weight: 600;
  }
  fieldset {
    border: 0;
    margin: 0;
    padding: 0;
  }
  .seg {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: var(--space-1);
    margin-top: var(--space-1);
  }
  .opt {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-1);
    min-height: var(--tap-target);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    font-weight: 400;
    font-size: var(--font-size-sm);
  }
  .opt.on {
    border-color: var(--color-accent);
    background: var(--color-accent-soft);
    font-weight: 600;
  }
  .opt input {
    width: auto;
    min-height: 0;
  }
  .two {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-3);
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
    margin-top: var(--space-2);
  }
  .error {
    color: var(--color-danger);
    margin: 0;
  }
</style>
