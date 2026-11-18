// Composer Enter probe: what does a plain Enter do in the phone composer?
//
// On a phone there is no Shift key, so the composer's Enter gesture is the only
// key gesture available: before the fix it ran the submit path (the draft left
// the composer and a message went out); the fix makes it insert a line break
// and leaves sending to the send button.
//
// Two scenes, one run each:
//   PROBE_SCENE=phone   390x844 dpr2 + touch emulation -> MOBILE_QUERY arms the
//                       plugin; EXPECT=send reproduces the bug, EXPECT=newline
//                       asserts the fix.
//   PROBE_SCENE=desktop 1280x720, no touch -> the plugin must not arm; EXPECT=send
//                       proves the desktop Enter gesture is untouched.
//
// Env:
//   DSH_PROBE_URL        default http://127.0.0.1:3080/
//   DSH_PROBE_TOKEN      launch token (optional; appended as ?token=)
//   DSH_PROBE_SESSION_ID optional; seeds localStorage so the app opens that session
//   DSH_PROBE_CHROME     default google-chrome
//   DSH_PROBE_EXPECT     send | newline
//   DSH_PROBE_SCENE      phone | desktop
//   DSH_PROBE_TIMEOUT_MS default 30000
//
// Exits 0 when every assertion for the requested expectation passes, 1 otherwise.
// The probe never sends on its own: it types, presses Enter once, and reads back.
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';

const MARKER = 'probe-enter-marker';
const COMPOSER_INPUT = '[data-composer-input]';
const COMPOSER_CARD = '[data-composer-card]';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function readConfig(env = process.env) {
  const url = new URL(env.DSH_PROBE_URL || 'http://127.0.0.1:3080/');
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('DSH_PROBE_URL must be http(s)');
  const token = env.DSH_PROBE_TOKEN?.trim();
  if (token) url.searchParams.set('token', token);
  const expect = env.DSH_PROBE_EXPECT?.trim() || 'newline';
  if (expect !== 'send' && expect !== 'newline') throw new Error('DSH_PROBE_EXPECT must be send or newline');
  const scene = env.DSH_PROBE_SCENE?.trim() || 'phone';
  if (scene !== 'phone' && scene !== 'desktop') throw new Error('DSH_PROBE_SCENE must be phone or desktop');
  const timeoutMs = Number(env.DSH_PROBE_TIMEOUT_MS || 30000);
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) throw new Error('DSH_PROBE_TIMEOUT_MS must be a positive integer');
  return {
    url: url.href,
    origin: url.origin,
    sessionId: env.DSH_PROBE_SESSION_ID?.trim() || null,
    chromePath: env.DSH_PROBE_CHROME || 'google-chrome',
    expect,
    scene,
    timeoutMs,
  };
}

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`);
}

async function waitFor(label, timeoutMs, probe) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await probe().catch(() => null);
    if (value) return value;
    await sleep(100);
  }
  throw new Error(`timeout: ${label}`);
}

function allocatePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

function createClient(ws) {
  let nextId = 0;
  const pending = new Map();
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    // A CDP call issued while the page is navigating can be dropped on the
    // floor by the renderer; without this bound the probe would wait forever
    // instead of retrying the read.
    const timer = setTimeout(() => {
      if (!pending.delete(id)) return;
      reject(new Error(`CDP ${method} timed out`));
    }, 8000);
    pending.set(id, {
      resolve: (value) => { clearTimeout(timer); resolve(value); },
      reject: (error) => { clearTimeout(timer); reject(error); },
    });
    ws.send(JSON.stringify({ id, method, params }));
  });
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id === undefined) return;
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(JSON.stringify(message.error)));
    else request.resolve(message.result);
  };
  const evaluate = async (expression) => {
    const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (response.exceptionDetails) {
      throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
    }
    return response.result.value;
  };
  return { send, evaluate };
}

/** Everything the probe judges after the keypress. */
const STATE = `(() => {
  const input = document.querySelector(${JSON.stringify(COMPOSER_INPUT)});
  const current = localStorage.getItem('dsh.sessions.current');
  let sessionId = null;
  try { sessionId = current === null ? null : JSON.parse(current).sessionId ?? null; } catch { sessionId = null; }
  return {
    card: document.querySelector(${JSON.stringify(COMPOSER_CARD)}) !== null,
    input: input !== null,
    draft: input === null ? '' : input.textContent ?? '',
    html: input === null ? '' : input.innerHTML,
    userRows: document.querySelectorAll('[data-chat-flow-kind="user"]').length,
    flowRows: document.querySelectorAll('[data-chat-flow-kind]').length,
    // Diagnostic: the popup guard must be closed on a plain composer, or the
    // rewrite would never arm.
    cardListbox: document.querySelector(${JSON.stringify(COMPOSER_CARD)} + ' [role="listbox"]') !== null,
    sessionId,
    phase: document.querySelector('[data-phase="active"], [data-phase="hero"]')?.getAttribute('data-phase') ?? null,
  };
})()`;

async function main() {
  const config = readConfig();
  const port = await allocatePort();
  await mkdir(join(homedir(), '.cache'), { recursive: true });
  const profileDir = await mkdtemp(join(homedir(), '.cache', 'dsh-web-mobile-enter-'));
  const [width, height] = config.scene === 'phone' ? [390, 844] : [1280, 720];
  const chrome = spawn(config.chromePath, [
    '--headless=new',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    // The host exports HTTP(S)_PROXY for its tool calls; Chrome would send the
    // loopback probe through it and Page.navigate would never commit.
    '--no-proxy-server',
    '--disable-extensions',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    `--window-size=${width},${height}`,
    'about:blank',
  ], { stdio: 'ignore' });

  let ws = null;
  try {
    const target = await waitFor('chrome target', config.timeoutMs, async () => {
      const response = await fetch(`http://127.0.0.1:${port}/json`);
      if (!response.ok) return null;
      const targets = await response.json();
      // A packaged Chrome exposes its own component-extension pages as targets;
      // only a real page target can be navigated.
      return targets.find((target) => target.type === 'page' && target.url === 'about:blank')
        ?? targets.find((target) => target.type === 'page')
        ?? null;
    });
    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('CDP WebSocket open timed out')), 10_000);
      ws.onopen = () => { clearTimeout(timer); resolve(); };
      ws.onerror = () => { clearTimeout(timer); reject(new Error('CDP WebSocket connection failed')); };
    });
    const client = createClient(ws);
    await client.send('Page.enable');
    await client.send('Runtime.enable');
    await client.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: config.scene === 'phone' ? 2 : 1,
      mobile: config.scene === 'phone',
    });
    await client.send('Emulation.setTouchEmulationEnabled', {
      enabled: config.scene === 'phone',
      maxTouchPoints: config.scene === 'phone' ? 5 : 1,
    });
    if (config.sessionId !== null) {
      await client.send('Page.addScriptToEvaluateOnNewDocument', {
        source: `localStorage.setItem('dsh.sessions.current', ${JSON.stringify(JSON.stringify({ sessionId: config.sessionId }))})`,
      });
    }
    await client.send('Page.navigate', { url: config.url });
    await waitFor('page load', config.timeoutMs, async () => {
      const state = await client.evaluate(`({ ready: document.readyState === 'complete', href: location.href })`);
      return state.ready && state.href.startsWith(config.origin) ? state : null;
    });
    await waitFor('composer mounted', config.timeoutMs, async () => {
      const state = await client.evaluate(STATE);
      return state.card && state.input ? state : null;
    });

    // Touch emulation makes the composer row's pointer events synthesize touch;
    // the input itself still takes a mouse click, which is how the existing
    // probes focus it.
    const rect = await client.evaluate(`(() => {
      const input = document.querySelector(${JSON.stringify(COMPOSER_INPUT)});
      const box = input.getBoundingClientRect();
      return { x: box.left + box.width / 2, y: box.top + box.height / 2, width: box.width, height: box.height };
    })()`);
    record('composer.visible', rect.width > 0 && rect.height > 0, `rect=${Math.round(rect.width)}x${Math.round(rect.height)}`);
    await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rect.x, y: rect.y });
    await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
    await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
    await sleep(150);

    await client.send('Input.insertText', { text: MARKER });
    await sleep(200);
    const typed = await client.evaluate(STATE);
    record('composer.typed', typed.draft.includes(MARKER), `draft=${JSON.stringify(typed.draft)}`);

    const keyParams = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 };
    await client.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...keyParams });
    await client.send('Input.dispatchKeyEvent', { type: 'keyUp', ...keyParams });
    // The submit path is asynchronous (optimistic row, then the round trip);
    // give the line-break path the same window so the read is fair.
    await sleep(1500);

    const after = await client.evaluate(STATE);
    console.log('STATE', JSON.stringify({ ...after, html: after.html.slice(0, 240) }));

    if (config.expect === 'newline') {
      record('enter.line-break', /<br\b/i.test(after.html) || after.draft.includes('\n'), `html=${JSON.stringify(after.html.slice(0, 160))}`);
      record('enter.draft-retained', after.draft.includes(MARKER), `draft=${JSON.stringify(after.draft)}`);
      record('enter.nothing-sent', after.userRows === typed.userRows && after.sessionId === typed.sessionId, `userRows ${typed.userRows}->${after.userRows} session ${typed.sessionId}->${after.sessionId}`);
    } else {
      record('enter.submitted', !after.draft.includes(MARKER), `draft=${JSON.stringify(after.draft)}`);
      record('enter.sent', after.userRows > typed.userRows || after.sessionId !== typed.sessionId, `userRows ${typed.userRows}->${after.userRows} session ${typed.sessionId}->${after.sessionId}`);
    }
  } finally {
    if (ws !== null && ws.readyState === WebSocket.OPEN) ws.close();
    chrome.kill('SIGKILL');
    await rm(profileDir, { recursive: true, force: true });
  }

  const failed = results.filter((result) => !result.ok);
  console.log(`SUMMARY scene=${config.scene} expect=${config.expect} pass=${results.length - failed.length} fail=${failed.length}`);
  process.exitCode = failed.length === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error('PROBE ERROR', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
