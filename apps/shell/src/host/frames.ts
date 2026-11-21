import type { FrameHandle } from './lifecycle.ts';
import type { BundleRef } from './bundles.ts';
import { IFRAME_ALLOW, IFRAME_SANDBOX, buildSrcdoc, newNonce } from './sandbox.ts';

/** Creates sandboxed iframes inside the host container. Destruction is owned by SubappLifecycle. */
export function domFrameFactory(container: () => HTMLElement, bundles: () => Map<string, BundleRef>) {
  return async (app: { manifest: { id: string } }): Promise<FrameHandle> => {
    const ref = bundles().get(app.manifest.id);
    if (!ref) throw new Error(`No bundle for ${app.manifest.id}`);
    const res = await fetch(`${ref.base}${ref.manifest.entry}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const srcdoc = buildSrcdoc({ html: await res.text(), nonce: newNonce(), bundleOrigin: location.origin, bundleBase: ref.base });

    const iframe = document.createElement('iframe');
    iframe.setAttribute('sandbox', IFRAME_SANDBOX);
    iframe.setAttribute('allow', IFRAME_ALLOW);
    iframe.setAttribute('referrerpolicy', 'no-referrer');
    iframe.setAttribute('title', ref.manifest.name);
    iframe.dataset.appId = ref.manifest.id;
    iframe.className = 'subapp-frame';
    iframe.hidden = true;
    iframe.srcdoc = srcdoc;
    container().append(iframe);
    const win = iframe.contentWindow;
    if (!win) {
      iframe.remove();
      throw new Error('iframe has no window');
    }
    return {
      window: win,
      show: () => {
        iframe.hidden = false;
      },
      hide: () => {
        iframe.hidden = true;
      },
      destroy: () => {
        iframe.removeAttribute('srcdoc');
        iframe.remove();
      },
    };
  };
}
