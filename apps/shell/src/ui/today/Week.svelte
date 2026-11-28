<script lang="ts">
  import { onMount } from 'svelte';
  import type { Shell } from '../../shell.ts';
  import { addDays, fmtClock, fmtDuration, isOpen, parseWhen, weekOf, ymd } from '../../today/agenda.ts';

  const { shell, day, onDay, onOpenDay }: { shell: Shell; day: string; onDay: (d: string) => void; onOpenDay: (d: string) => void } = $props();
  // svelte-ignore state_referenced_locally
  const items = shell.today.items;
  // svelte-ignore state_referenced_locally
  const now = shell.today.now;

  onMount(() => shell.today.start());

  const week = $derived(weekOf($items, day, $now));
  const today = $derived(ymd($now));
  const label = (d: string) => {
    const [y, m, dd] = d.split('-').map(Number) as [number, number, number];
    return new Date(y, m - 1, dd).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' });
  };
  const onDay_ = (d: string) =>
    $items
      .filter((i) => !i.deleted && parseWhen(i.start)?.day === d)
      .sort((a, b) => (parseWhen(a.start)?.min ?? -1) - (parseWhen(b.start)?.min ?? -1));
  const range = $derived(`${label(week[0]!.day)} – ${label(week[6]!.day)}`);
  const totalFocus = $derived(week.reduce((s, w) => s + w.focusMinutes, 0));
</script>

<header class="bar">
  <button type="button" onclick={() => onDay(addDays(day, -7))} aria-label="Previous week">‹</button>
  <div class="h">
    <h1>Week</h1>
    <p class="muted">{range}</p>
  </div>
  <button type="button" onclick={() => onDay(addDays(day, 7))} aria-label="Next week">›</button>
</header>

<p class="summary" data-testid="week-focus">Focus planned this week: <strong>{totalFocus ? fmtDuration(totalFocus) : 'none yet'}</strong></p>

<ol class="days">
  {#each week as w (w.day)}
    {@const list = onDay_(w.day)}
    <li class="day" class:today={w.day === today}>
      <button type="button" class="dayhead" onclick={() => onOpenDay(w.day)}>
        <span>{label(w.day)}{w.day === today ? ' · Today' : ''}<span class="visually-hidden">, show this day</span></span>
        <span class="muted small">{w.count} item{w.count === 1 ? '' : 's'}{w.focusMinutes ? ` · ${fmtDuration(w.focusMinutes)} focus` : ''}</span>
      </button>
      {#if list.length}
        <ul class="items" data-testid="week-items">
          {#each list as i (i.id)}
            {@const when = parseWhen(i.start)}
            <li class="kind-{i.kind}" class:done={!isOpen(i)}>
              <span class="time">{when?.min === null || when?.min === undefined ? 'All day' : fmtClock(when.min)}</span>
              <span class="t">{i.title}</span>
            </li>
          {/each}
        </ul>
      {/if}
    </li>
  {/each}
</ol>

<style>
  .bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-2);
    background: var(--color-accent);
    color: var(--color-accent-text);
  }
  .bar button {
    background: var(--color-surface);
    color: var(--color-text);
    min-width: var(--tap-target);
  }
  .h {
    text-align: center;
  }
  h1 {
    margin: 0;
    font-size: var(--font-size-lg);
  }
  .bar .muted {
    color: inherit;
    opacity: 0.9;
    margin: 0;
    font-size: var(--font-size-sm);
  }
  .summary {
    margin: var(--space-4);
  }
  .days {
    list-style: none;
    margin: 0;
    padding: 0 var(--space-4) var(--space-6);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .day {
    background: var(--color-surface);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-card);
    overflow: hidden;
  }
  .day.today {
    outline: 2px solid var(--color-accent);
  }
  .dayhead {
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    border: 0;
    border-radius: 0;
    background: var(--color-surface-raised);
    font-weight: 600;
    text-align: left;
    padding: var(--space-2) var(--space-3);
  }
  .muted {
    color: var(--color-text-muted);
  }
  .small {
    font-size: var(--font-size-sm);
    font-weight: 400;
  }
  .items {
    list-style: none;
    margin: 0;
    padding: var(--space-2) var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .items li {
    display: grid;
    grid-template-columns: 4rem 1fr;
    gap: var(--space-2);
    padding-left: var(--space-2);
    border-left: 4px solid var(--kind, var(--color-border));
  }
  .items li.done .t {
    text-decoration: line-through;
    color: var(--color-text-muted);
  }
  .time {
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
    font-variant-numeric: tabular-nums;
  }
  .kind-event {
    --kind: var(--color-kind-event);
  }
  .kind-task {
    --kind: var(--color-kind-task);
  }
  .kind-focus {
    --kind: var(--color-kind-focus);
  }
  .kind-date {
    --kind: var(--color-kind-date);
  }
  .kind-reminder {
    --kind: var(--color-kind-reminder);
  }
</style>
