// S-2: how long does a 24-frame radar loop take to cross the bridge into a sandboxed subapp?
//
// Mirrors the shell's setup (ADR-003): srcdoc iframe with sandbox="allow-scripts", a CSP with
// connect-src 'none' and img-src data: blob:, and a private MessagePort. The parent sends each tile as
// { mime, dataBase64 } (the proposed weather.radarTile result); the iframe decodes it to a Blob, makes a
// blob: URL and waits for the <img> to decode. Variant B sends one pre-composited image per frame.
//
// Usage: node bridge_transfer.mjs <tilesDir> [cpuThrottle=4]
//   tilesDir holds the PNG tiles of one viewport frame (downloaded by the caller); they are reused for every frame.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const [dir, throttleArg] = process.argv.slice(2);
const throttle = Number(throttleArg ?? 4);
const tiles = readdirSync(dir).filter((f) => f.endsWith('.png')).map((f) => readFileSync(join(dir, f)).toString('base64'));
const FRAMES = 24;

const child = `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'">
<script>
onmessage = (e) => {
  const port = e.ports[0];
  port.onmessage = async ({ data }) => {
    if (data.type !== 'frame') return;
    const t0 = performance.now();
    const imgs = await Promise.all(data.tiles.map(async (t) => {
      const bin = atob(t.dataBase64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([bytes], { type: t.mime }));
      const img = new Image(); img.src = url; await img.decode(); return img;
    }));
    port.postMessage({ type: 'done', frame: data.frame, ms: performance.now() - t0, n: imgs.length });
  };
};
</script>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 412, height: 915 } });
const cdp = await page.context().newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
await page.setContent('<iframe id="f" sandbox="allow-scripts"></iframe>');
await page.$eval('#f', (f, html) => { f.srcdoc = html; return new Promise((r) => (f.onload = r)); }, child);

const run = (perFrame) => page.evaluate(({ perFrame, frames }) => new Promise((resolve) => {
  const { port1, port2 } = new MessageChannel();
  document.getElementById('f').contentWindow.postMessage('init', '*', [port2]);
  const t0 = performance.now(); let first = null; let done = 0; const childMs = [];
  port1.onmessage = ({ data }) => {
    if (data.type !== 'done') return;
    if (first === null) first = performance.now() - t0;
    childMs.push(data.ms);
    if (++done === frames) resolve({ firstFrameMs: first, loopMs: performance.now() - t0, childMedianMs: childMs.sort((a, b) => a - b)[frames >> 1] });
  };
  for (let i = 0; i < frames; i++) port1.postMessage({ type: 'frame', frame: i, tiles: perFrame.map((d) => ({ mime: 'image/png', dataBase64: d })) });
}), { perFrame, frames: FRAMES });

const kib = (arr) => (arr.reduce((s, d) => s + d.length * 0.75, 0) / 1024).toFixed(1);
const a = await run(tiles);
console.log(`A tiles: ${tiles.length}/frame, ${kib(tiles)} KiB/frame, CPU x${throttle}:`, a);

// B: one composited image per frame. Approximate it with a canvas-stitched PNG of the same tiles.
const composite = await page.evaluate(async (tiles) => {
  const cols = 4, rows = Math.ceil(tiles.length / cols);
  const c = new OffscreenCanvas(256 * cols, 256 * rows); const g = c.getContext('2d');
  await Promise.all(tiles.map(async (d, i) => {
    const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + d)).blob());
    g.drawImage(bmp, (i % cols) * 256, Math.floor(i / cols) * 256);
  }));
  const blob = await c.convertToBlob({ type: 'image/png' });
  const buf = new Uint8Array(await blob.arrayBuffer()); let s = '';
  for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
  return btoa(s);
}, tiles);
const b = await run([composite]);
console.log(`B composite: 1/frame, ${kib([composite])} KiB/frame, CPU x${throttle}:`, b);
await browser.close();
