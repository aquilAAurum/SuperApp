/** Probes the sandbox from the inside. Each check must report "blocked" in a correctly hosted subapp. */
export interface ProbeResult {
  name: string;
  blocked: boolean;
  detail: string;
}

type Probe = { name: string; run: () => Promise<unknown> | unknown };

export function probes(win: Window = window): Probe[] {
  return [
    { name: 'network', run: () => fetch(new URL('index.json', win.document.baseURI).toString(), { cache: 'no-store' }) },
    { name: 'parent-dom', run: () => (win.parent as Window).document.title },
    { name: 'storage', run: () => win.localStorage.getItem('x') },
    { name: 'cookies', run: () => win.document.cookie },
  ];
}

export async function runIsolationCheck(list: Probe[] = probes()): Promise<ProbeResult[]> {
  const out: ProbeResult[] = [];
  for (const p of list) {
    try {
      await p.run();
      out.push({ name: p.name, blocked: false, detail: 'allowed' });
    } catch (err) {
      out.push({ name: p.name, blocked: true, detail: (err as Error).name || 'Error' });
    }
  }
  return out;
}
