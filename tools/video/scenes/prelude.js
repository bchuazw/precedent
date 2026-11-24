// Shared helpers for scene scripts. Each scene runs inside the logged-in Playwright browser (browser_run_code),
// streams Chrome screencast frames to tools/video/recv.mjs and drops named markers for the editor.
const R = 'http://127.0.0.1:8899';
const now = () => Date.now() / 1000;
const sleep = (ms) => page.waitForTimeout(ms);

async function startRecording(seg) {
  await page.request.post(`${R}/start?seg=${seg}&t=${now()}`);
  const cdp = await page.context().newCDPSession(page);
  const posts = [];
  cdp.on('Page.screencastFrame', (f) => {
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
    posts.push(page.request.post(`${R}/frame?seg=${seg}&t=${f.metadata.timestamp}`, { data: f.data, headers: { 'content-type': 'text/plain' } }).catch(() => {}));
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 90, maxWidth: 1600, maxHeight: 900, everyNthFrame: 1 });
  return {
    mark: (m) => page.request.post(`${R}/mark?seg=${seg}&m=${m}&t=${now()}`),
    stop: async () => {
      await sleep(300);
      await cdp.send('Page.stopScreencast');
      await Promise.all(posts);
      await page.request.post(`${R}/stop?seg=${seg}&t=${now()}`);
      await cdp.detach();
      return posts.length;
    },
  };
}

/** A visible arrow cursor and a click ripple (the screencast does not show the real cursor). */
async function installCursor() {
  await page.evaluate(() => {
    if (document.getElementById('__pc')) return;
    const c = document.createElement('div');
    c.id = '__pc';
    c.innerHTML = '<svg width="30" height="30" viewBox="0 0 28 28"><path d="M5 3 L5 23 L10.5 17.5 L14 25.5 L17.5 24 L14 16 L21.5 16 Z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    Object.assign(c.style, { position: 'fixed', left: '0', top: '0', zIndex: '2147483647', pointerEvents: 'none', transform: `translate(${window.__pcx ?? 800}px, ${window.__pcy ?? 450}px)`, filter: 'drop-shadow(0 2px 3px rgba(0,0,0,.35))' });
    const ring = document.createElement('div');
    Object.assign(ring.style, { position: 'fixed', width: '40px', height: '40px', margin: '-20px 0 0 -20px', borderRadius: '50%', border: '3px solid rgba(12,102,228,.9)', zIndex: '2147483646', pointerEvents: 'none', opacity: '0', left: '0', top: '0' });
    document.documentElement.append(c, ring);
    document.addEventListener('mousemove', (e) => { window.__pcx = e.clientX - 5; window.__pcy = e.clientY - 3; c.style.transform = `translate(${e.clientX - 5}px, ${e.clientY - 3}px)`; }, true);
    document.addEventListener('mousedown', (e) => {
      ring.style.left = `${e.clientX}px`;
      ring.style.top = `${e.clientY}px`;
      ring.animate([{ opacity: 1, transform: 'scale(.4)' }, { opacity: 0, transform: 'scale(1.5)' }], { duration: 550 });
    }, true);
  });
}

let mx = 800;
let my = 450;
/** Eased mouse move, ~60 fps, so the cursor glides instead of jumping. */
async function glide(x, y, ms = 700) {
  const steps = Math.max(8, Math.round(ms / 16));
  const sx = mx;
  const sy = my;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    await page.mouse.move(sx + (x - sx) * e, sy + (y - sy) * e);
    await sleep(16);
  }
  mx = x;
  my = y;
}

async function centerOf(locator) {
  await locator.waitFor({ state: 'visible', timeout: 30000 });
  const b = await locator.boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

async function moveTo(locator, ms) {
  const p = await centerOf(locator);
  await glide(p.x, p.y, ms);
  return p;
}

async function clickOn(locator, ms) {
  await moveTo(locator, ms);
  await sleep(220);
  await page.mouse.down();
  await sleep(70);
  await page.mouse.up();
}

/** Smoothly scrolls the nearest scrollable ancestor of an element so the element sits near `top` px. */
async function smoothScrollTo(locator, top = 120, ms = 1200) {
  const handle = await locator.elementHandle();
  await page.evaluate(
    ([el, top, ms]) =>
      new Promise((resolve) => {
        let s = el.parentElement;
        while (s && !(s.scrollHeight > s.clientHeight + 10 && /(auto|scroll)/.test(getComputedStyle(s).overflowY))) s = s.parentElement;
        s = s ?? document.scrollingElement;
        const from = s.scrollTop;
        const to = from + (el.getBoundingClientRect().top - (s === document.scrollingElement ? 0 : s.getBoundingClientRect().top)) - top;
        const t0 = performance.now();
        const step = (t) => {
          const k = Math.min(1, (t - t0) / ms);
          const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
          s.scrollTop = from + (to - from) * e;
          if (k < 1) requestAnimationFrame(step);
          else resolve();
        };
        requestAnimationFrame(step);
      }),
    [handle, top, ms],
  );
}

/** Waits until the page's text stops changing (for streamed Rovo answers). */
async function waitForStableText(selector, stableMs = 3500, timeoutMs = 90000) {
  const t0 = Date.now();
  let last = '';
  let since = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const txt = await page.evaluate((s) => (document.querySelector(s) ?? document.body).innerText, selector).catch(() => '');
    if (txt !== last) {
      last = txt;
      since = Date.now();
    } else if (Date.now() - since > stableMs) return true;
    await sleep(500);
  }
  return false;
}
