<script lang="ts">
  import { onMount } from 'svelte';
  import type { Shell } from '../../shell.ts';
  import type { AppStatus } from '../../host/lifecycle.ts';
  import {
    appOfLink,
    fmtClock,
    fmtDuration,
    glanceProgress,
    isOpen,
    minutesOf,
    nowNext,
    parseWhen,
    planDay,
    weekOf,
    ymd,
    type AgendaItem,
  } from '../../today/agenda.ts';
  import { showToast } from '../store.ts';

  const {
    shell,
    day,
    onDay,
    onOpen,
    onNavigate,
    onQuickAdd,
  }: {
    shell: Shell;
    day: string;
    onDay: (d: string) => void;
    onOpen: (appId: string) => void;
    onNavigate: (v: 'diagnostics' | 'settings' | 'sync' | 'apps') => void;
    onQuickAdd: () => void;
  } = $props();

  // `shell` is a constant composition root and is never reassigned.
  // svelte-ignore state_referenced_locally
  const items = shell.today.items;
  // svelte-ignore state_referenced_locally
  const glances = shell.today.glances;
  // svelte-ignore state_referenced_locally
  const health = shell.today.health;
  // svelte-ignore state_referenced_locally
  const now = shell.today.now;
  // svelte-ignore state_referenced_locally
  const syncState = shell.sync.status;
  // svelte-ignore state_referenced_locally
  const shellState = shell.state;
  let statuses = $state<readonly AppStatus[]>([]);

  onMount(() => {
    void shell.refreshReachability();
    const stop = shell.today.start();
    const off = shell.statuses((s) => (statuses = s));
    return () => {
      stop();
      off();
    };
  });

  const syncLabel = $derived($syncState.label === 'Pending' ? `Pending (${$syncState.queued})` : $syncState.label);
  const plan = $derived(planDay($items, day, $now));
  const nn = $derived(nowNext(plan, $now));
  const week = $derived(weekOf($items, day, $now));
  const today = $derived(ymd($now));
  const greeting = $derived(($now.getHours() < 12 ? 'Good morning' : $now.getHours() < 18 ? 'Good afternoon' : 'Good evening') + ($shellState.user?.name ? `, ${$shellState.user.name.split(' ')[0]}` : ''));
  const dateLong = (d: string) => {
    const [y, m, dd] = d.split('-').map(Number) as [number, number, number];
    return new Date(y, m - 1, dd).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  };
  const weekdayShort = (d: string) => {
    const [y, m, dd] = d.split('-').map(Number) as [number, number, number];
    return new Date(y, m - 1, dd).toLocaleDateString(undefined, { weekday: 'narrow' });
  };
  const dayNum = (d: string) => Number(d.slice(8));

  const apps = $derived(
    statuses
      .map((s) => ({ status: s, bundle: shell.bundles.get(s.appId) }))
      .filter((x) => x.bundle)
      .sort((a, b) => a.bundle!.manifest.name.localeCompare(b.bundle!.manifest.name)),
  );
  const sourceName = (app: string) => (app === 'shell' ? 'You' : (shell.bundles.get(app)?.manifest.name ?? app));
  const reach = $derived(
    [...plan.overdue, ...plan.allDay].filter((i) => i.kind === 'task' && i.person && isOpen(i)).slice(0, 8),
  );
  const attention = $derived(plan.overdue.filter((i) => !(i.kind === 'task' && i.person)));
  // People already shown in "People to reach" are not repeated as all-day chips.
  const allDay = $derived(plan.allDay.filter((i) => !reach.includes(i)));
  const checkable = (i: AgendaItem) => i.source_app === 'shell' && (i.kind === 'task' || i.kind === 'reminder');
  const initials = (title: string) =>
    title
      .replace(/^Reach out to /, '')
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? '')
      .join('');
  /** Whole days between an item's day and today (local dates compared as UTC midnights). */
  const daysLate = (i: AgendaItem) => {
    const s = parseWhen(i.start);
    return s ? Math.max(0, Math.round((Date.parse(today) - Date.parse(s.day)) / 86400000)) : 0;
  };

  function activate(i: AgendaItem) {
    const app = appOfLink(i.deep_link) ?? (i.source_app !== 'shell' ? i.source_app : null);
    if (app && shell.bundles.has(app)) onOpen(app);
    else if (app) showToast(`${sourceName(app)} is not installed on this phone.`, 'error');
  }

  async function toggle(i: AgendaItem) {
    await shell.today.toggleDone(i);
  }

  async function focusNow() {
    if (!nn.focusWindow) return;
    await shell.today.startFocus(nn.focusWindow.startMin, nn.focusWindow.endMin);
    showToast(`Focus until ${fmtClock(nn.focusWindow.endMin)}. Protected on your agenda.`);
  }

  const until = (min: number) => fmtDuration(Math.max(0, min - minutesOf($now)));
</script>

<header class="hero">
  <div class="hero-top">
    <h1 class="brand">~Supra~</h1>
    <button type="button" class="sync" data-testid="sync-status" data-state={$syncState.label} onclick={() => onNavigate('sync')} aria-label={`Sync status: ${syncLabel}. ${$syncState.detail} Open Sync centre.`}>
      <span class="dot" aria-hidden="true"></span>{syncLabel}
    </button>
  </div>
  <p class="greeting">{day === today ? greeting : dateLong(day)}</p>
  <p class="date">{day === today ? dateLong(day) : day < today ? 'Past day' : 'Upcoming'}</p>

  <ol class="week" aria-label="This week">
    {#each week as w (w.day)}
      <li>
        <button type="button" class="wday" class:today={w.isToday} aria-pressed={w.day === day} onclick={() => onDay(w.day)}>
          <span class="wd" aria-hidden="true">{weekdayShort(w.day)}</span>
          <span class="dn">{dayNum(w.day)}</span>
          <span class="visually-hidden">{dateLong(w.day)}, {w.count} item{w.count === 1 ? '' : 's'}</span>
          <span class="dots" aria-hidden="true">{#each Array(Math.min(w.count, 3)) as _, k (k)}<i></i>{/each}</span>
        </button>
      </li>
    {/each}
  </ol>
</header>

{#if $shellState.safeMode}
  <p class="banner" role="status">Safe mode is on. All subapps are disabled. Turn it off in Settings.</p>
{/if}

<section class="card now" aria-labelledby="now-h" data-testid="now-card">
  <h2 id="now-h" class="visually-hidden">Now and next</h2>
  {#if plan.isToday && nn.current}
    <p class="eyebrow">Now</p>
    <p class="big">{nn.current.item.title}</p>
    <p class="muted">Until {fmtClock(nn.current.endMin)} · {until(nn.current.endMin)} left</p>
  {:else if plan.isToday && nn.focusWindow}
    <p class="eyebrow">Free time</p>
    <p class="big">{fmtDuration(nn.focusWindow.endMin - nn.focusWindow.startMin)} until {fmtClock(nn.focusWindow.endMin)}</p>
    <button type="button" class="primary" onclick={focusNow} data-testid="start-focus">Protect it as focus time</button>
  {:else if plan.isToday}
    <p class="eyebrow">Today</p>
    <p class="big">{plan.timeline.some((e) => e.type === 'item') ? 'Nothing else timed today' : 'Your day is open'}</p>
  {:else}
    <p class="eyebrow">{dateLong(day)}</p>
    <p class="big">{plan.timeline.filter((e) => e.type === 'item').length + plan.allDay.length} items · {fmtDuration(plan.freeMinutes)} free</p>
  {/if}
  {#if nn.next && plan.isToday}
    <p class="next">Next: <strong>{nn.next.item.title}</strong> at {fmtClock(nn.next.startMin)} ({until(nn.next.startMin)})</p>
  {/if}
  {#if plan.isToday && plan.timeline.some((e) => e.type === 'item')}
    <!-- With nothing timed, this would repeat the free-time line above (off by the 5-minute rounding). -->
    <p class="muted small">{fmtDuration(plan.freeMinutes)} free for the rest of the day</p>
  {/if}
</section>

{#if reach.length}
  <section class="section" aria-labelledby="reach-h">
    <h2 id="reach-h">People to reach</h2>
    <ul class="people">
      {#each reach as r (r.id)}
        <li>
          <button type="button" class="person" onclick={() => activate(r)}>
            <span class="avatar" aria-hidden="true">{initials(r.title)}</span>
            <span class="visually-hidden">Reach out to</span>
            <span class="pname">{r.title.replace(/^Reach out to /, '')}</span>
            {#if daysLate(r) > 0}<span class="late"><span aria-hidden="true">{daysLate(r)} d</span><span class="visually-hidden">, {daysLate(r)} days overdue</span></span>{/if}
          </button>
        </li>
      {/each}
    </ul>
  </section>
{/if}

{#if attention.length}
  <section class="section" aria-labelledby="att-h">
    <h2 id="att-h">Still open</h2>
    <ul class="list">
      {#each attention as i (i.id)}
        <li class="row kind-{i.kind}">
          {#if i.source_app === 'shell'}
            <input type="checkbox" id={`done-${i.id}`} checked={!isOpen(i)} onchange={() => toggle(i)} />
            <label for={`done-${i.id}`}>{i.title}</label>
          {:else}
            <button type="button" class="link" onclick={() => activate(i)}>{i.title}</button>
          {/if}
          <span class="late">{daysLate(i)} d late</span>
        </li>
      {/each}
    </ul>
  </section>
{/if}

<section class="section" aria-labelledby="agenda-h">
  <h2 id="agenda-h">Agenda</h2>
  {#if allDay.length}
    <ul class="chips" aria-label="All day">
      {#each allDay as i (i.id)}
        <li>
          <button type="button" class="chip kind-{i.kind}" class:done={!isOpen(i)} onclick={() => (checkable(i) ? toggle(i) : activate(i))}>
            {i.title}<span class="src">{sourceName(i.source_app)}</span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
  <ol class="timeline" data-testid="timeline">
    {#each plan.timeline as e, k (k)}
      {#if e.type === 'now'}
        <li class="nowline" aria-label={`Now, ${fmtClock(e.min)}`}><span>{fmtClock(e.min)}</span></li>
      {:else if e.type === 'free'}
        <li class="free">
          <span class="time">{fmtClock(e.startMin)}</span>
          <span class="freebox">Free · {fmtDuration(e.endMin - e.startMin)}</span>
        </li>
      {:else}
        <li class="item kind-{e.item.kind}" class:done={!isOpen(e.item)} data-testid={`agenda-${e.item.id}`}>
          <span class="time">{fmtClock(e.startMin)}</span>
          <div class="body">
            {#if checkable(e.item)}
              <input type="checkbox" id={`done-${e.item.id}`} checked={!isOpen(e.item)} onchange={() => toggle(e.item)} aria-label={`Done: ${e.item.title}`} />
            {/if}
            <button type="button" class="title" onclick={() => activate(e.item)}>
              <span class="t">{e.item.title}</span>
              <span class="meta">{e.endMin > e.startMin ? `${fmtClock(e.startMin)}–${fmtClock(e.endMin)}` : fmtClock(e.startMin)} · {sourceName(e.item.source_app)}</span>
            </button>
          </div>
        </li>
      {/if}
    {/each}
  </ol>
  {#if !plan.timeline.some((e) => e.type === 'item') && !allDay.length}
    <p class="muted">Nothing planned. <button type="button" class="link" onclick={onQuickAdd}>Add something</button></p>
  {/if}
</section>

{#if $glances.length || $health}
  <section class="section" aria-labelledby="glance-h">
    <h2 id="glance-h">Today at a glance</h2>
    <ul class="glances">
      {#each $glances as g (g.id)}
        {@const p = glanceProgress(g)}
        <li class="card glance" data-testid={`glance-${g.app_id}-${g.key}`}>
          <button type="button" class="gbtn" onclick={() => { const a = appOfLink(g.deep_link) ?? g.app_id; if (shell.bundles.has(a)) onOpen(a); }}>
            <span class="gtitle">{g.title}</span>
            <span class="gvalue">{g.value ?? '–'}{#if g.unit}<small> {g.unit}</small>{/if}{#if g.target}<small> / {g.target}</small>{/if}</span>
            {#if p !== null}<span class="bar" aria-hidden="true"><i style:width={`${Math.round(p * 100)}%`}></i></span>{/if}
            {#if g.detail}<span class="muted small">{g.detail}</span>{/if}
            <span class="src">{sourceName(g.app_id)}</span>
          </button>
        </li>
      {/each}
      {#if $health}
        <li class="card glance">
          <div class="gbtn">
            <span class="gtitle">Activity</span>
            <span class="gvalue">{$health.steps ?? '–'}<small> steps</small></span>
            <span class="muted small">{$health.activeCalories === null ? 'Active calories not shared' : `${Math.round($health.activeCalories)} active kcal`}</span>
            <span class="src">Health Connect</span>
          </div>
        </li>
      {/if}
    </ul>
  </section>
{/if}

<section class="section" aria-labelledby="apps-heading">
  <div class="sechead">
    <h2 id="apps-heading">Apps</h2>
    <button type="button" class="link" onclick={() => onNavigate('apps')}>All apps</button>
  </div>
  {#if apps.length === 0}
    <p class="muted">No apps installed yet.</p>
  {:else}
    <ul class="approw">
      {#each apps as { status, bundle } (status.appId)}
        <li>
          <button type="button" class="tile" data-testid={`tile-${status.appId}`} data-state={status.state} disabled={status.state === 'disabled'} onclick={() => onOpen(status.appId)}>
            <span class="icon" aria-hidden="true">{bundle!.manifest.name.slice(0, 1)}</span>
            <span class="name">{bundle!.manifest.name}</span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<nav class="section tools" aria-label="Shell">
  <button type="button" onclick={() => onNavigate('sync')}>Sync centre</button>
  <button type="button" onclick={() => onNavigate('diagnostics')}>Diagnostics</button>
</nav>

<style>
  .hero {
    background: var(--color-accent);
    color: var(--color-accent-text);
    padding: var(--space-3) var(--space-4) var(--space-4);
    border-radius: 0 0 var(--radius-xl) var(--radius-xl);
  }
  .hero-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .brand {
    margin: 0;
    font-size: var(--font-size-md);
    font-weight: 700;
    opacity: 0.9;
  }
  .greeting {
    margin: var(--space-3) 0 0;
    font-size: var(--font-size-xl);
    font-weight: 700;
  }
  .date {
    margin: 0 0 var(--space-3);
    opacity: 0.9;
  }
  .sync {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--font-size-sm);
    background: var(--color-surface);
    color: var(--color-text);
    border-radius: var(--radius-lg);
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
  .week {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: var(--space-1);
  }
  .wday {
    width: 100%;
    min-height: var(--tap-target);
    padding: var(--space-1) 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    background: transparent;
    color: var(--color-accent-text);
    border: 1px solid transparent;
    border-radius: var(--radius-md);
  }
  .wday[aria-pressed='true'] {
    background: var(--color-surface);
    color: var(--color-text);
  }
  .wday.today .dn {
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .wd {
    font-size: var(--font-size-sm);
    opacity: 0.85;
  }
  .dn {
    font-weight: 700;
  }
  .dots {
    display: flex;
    gap: 2px;
    min-height: 6px;
  }
  .dots i {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: currentColor;
    opacity: 0.8;
  }
  .card {
    background: var(--color-surface);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-card);
  }
  .now {
    margin: calc(-1 * var(--space-2)) var(--space-4) 0;
    padding: var(--space-4);
    position: relative;
  }
  .eyebrow {
    margin: 0;
    font-size: var(--font-size-sm);
    font-weight: 700;
    color: var(--color-accent);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .big {
    margin: var(--space-1) 0 var(--space-2);
    font-size: var(--font-size-lg);
    font-weight: 700;
  }
  .next {
    margin: var(--space-3) 0 0;
  }
  .muted {
    color: var(--color-text-muted);
    margin: var(--space-1) 0 0;
  }
  .small {
    font-size: var(--font-size-sm);
  }
  .banner {
    margin: var(--space-4);
    padding: var(--space-3);
    border-radius: var(--radius-sm);
    background: var(--color-surface-raised);
    color: var(--color-warning);
  }
  .section {
    padding: var(--space-4) var(--space-4) 0;
  }
  h2 {
    font-size: var(--font-size-md);
    margin: 0 0 var(--space-3);
  }
  .sechead {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }
  .link {
    min-height: auto;
    padding: 0;
    border: 0;
    background: none;
    color: var(--color-accent);
    text-decoration: underline;
  }
  .people,
  .glances,
  .approw,
  .chips,
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .people,
  .glances,
  .approw {
    display: flex;
    gap: var(--space-3);
    overflow-x: auto;
    padding-bottom: var(--space-2);
  }
  .person {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-1);
    width: calc(var(--tile-size) - var(--space-2));
    height: auto;
    padding: var(--space-2) var(--space-1);
    background: var(--color-surface);
    border: 0;
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-card);
  }
  .avatar {
    display: grid;
    place-items: center;
    width: var(--tap-target);
    height: var(--tap-target);
    border-radius: 50%;
    background: var(--color-kind-date-soft);
    color: var(--color-kind-date);
    font-weight: 700;
  }
  .pname {
    font-size: var(--font-size-sm);
    text-align: center;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100%;
  }
  .late {
    font-size: var(--font-size-sm);
    color: var(--color-danger);
    font-weight: 600;
  }
  .row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    margin-bottom: var(--space-2);
    background: var(--color-surface);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-card);
  }
  .row label,
  .row .link {
    flex: 1;
    text-align: left;
  }
  .row input,
  .body input {
    width: var(--space-6);
    min-height: var(--space-6);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin-bottom: var(--space-3);
  }
  .chip {
    min-height: var(--tap-target);
    border-radius: var(--radius-lg);
    border: 0;
    display: flex;
    gap: var(--space-2);
    align-items: center;
  }
  .chip.done {
    text-decoration: line-through;
    opacity: 0.7;
  }
  .src {
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
  }
  .timeline {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .timeline li {
    display: grid;
    grid-template-columns: 3.25rem 1fr;
    align-items: center;
    gap: var(--space-2);
  }
  .time {
    font-variant-numeric: tabular-nums;
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
  }
  .item .body {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    background: var(--color-surface);
    border-radius: var(--radius-md);
    border-left: 4px solid var(--kind, var(--color-border));
    box-shadow: var(--shadow-card);
  }
  .item.done .t {
    text-decoration: line-through;
    color: var(--color-text-muted);
  }
  .title {
    flex: 1;
    min-height: var(--tap-target);
    padding: 0;
    border: 0;
    background: none;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    justify-content: center;
    text-align: left;
  }
  .t {
    font-weight: 600;
  }
  .meta {
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
  }
  .freebox {
    padding: var(--space-2) var(--space-3);
    border: 1px dashed var(--color-accent);
    border-radius: var(--radius-md);
    color: var(--color-accent);
    background: var(--color-accent-soft);
    font-size: var(--font-size-sm);
    font-weight: 600;
  }
  .nowline span {
    grid-column: 1 / -1;
    display: block;
    border-top: 2px solid var(--color-now);
    color: var(--color-now);
    font-size: var(--font-size-sm);
    font-weight: 700;
    padding-top: 2px;
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
  .chip.kind-event {
    background: var(--color-kind-event-soft);
  }
  .chip.kind-task {
    background: var(--color-kind-task-soft);
  }
  .chip.kind-date {
    background: var(--color-kind-date-soft);
  }
  .chip.kind-reminder {
    background: var(--color-kind-reminder-soft);
  }
  .chip.kind-focus {
    background: var(--color-kind-focus-soft);
  }
  .glance {
    min-width: 11rem;
  }
  .gbtn {
    width: 100%;
    height: 100%;
    padding: var(--space-3);
    border: 0;
    background: none;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-1);
    text-align: left;
  }
  .gtitle {
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
    font-weight: 600;
  }
  .gvalue {
    font-size: var(--font-size-xl);
    font-weight: 700;
  }
  .gvalue small {
    font-size: var(--font-size-sm);
    font-weight: 400;
    color: var(--color-text-muted);
  }
  .bar {
    width: 100%;
    height: var(--space-2);
    border-radius: var(--space-1);
    background: var(--color-surface-raised);
    overflow: hidden;
  }
  .bar i {
    display: block;
    height: 100%;
    background: var(--color-accent);
  }
  .tile {
    width: var(--tile-size);
    height: auto;
    padding: var(--space-2) var(--space-1);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-1);
    border: 0;
    background: none;
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
  .tools {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    padding-bottom: var(--space-6);
  }
  .tools button {
    font-size: var(--font-size-sm);
  }
  @media (prefers-reduced-motion: no-preference) {
    .wday,
    .item .body {
      transition: background var(--motion-duration);
    }
  }
</style>
