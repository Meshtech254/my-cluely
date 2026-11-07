importScripts('page.js');
let port, selected, session, generation = 0, paused = false, approved = false, connectionError = '';
let chain = Promise.resolve(), detaching = Promise.resolve();
let pointer = { x: 20, y: 20 };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const send = message => { try { port?.postMessage(message); } catch (_) {} };
const command = (method, params = {}) => chrome.debugger.sendCommand({ tabId: selected.id }, method, params);
function urlScope(raw, origin) {
  const u = new URL(raw);
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || (u.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)) || (origin && u.origin !== origin)) throw new Error('Tab navigation outside approved website');
  return u;
}
async function cancel(revoke = false) {
  generation++; const old = selected; session = null; paused = false; approved = false;
  if (old) await page('remove_cursor').catch(() => {});
  detaching = detaching.catch(() => {}).then(() => old ? chrome.debugger.detach({ tabId: old.id }).catch(() => {}) : undefined);
  await detaching;
  if (revoke) { selected = null; send({ type: 'revoked' }); }
}
async function check(id) {
  if (!session || generation !== id) throw new Error('Task stopped');
  while (paused) { await sleep(40); if (!session || generation !== id) throw new Error('Task stopped'); }
  const tab = await chrome.tabs.get(selected.id); urlScope(tab.url, session.origin);
  if (!tab.active) throw new Error('Selected browser tab is no longer active');
}
async function page(op, args = {}) {
  const results = await chrome.scripting.executeScript({ target: { tabId: selected.id }, func: pageAction, args: [op, args] });
  const reply = results[0]?.result;
  if (!reply?.ok) throw new Error(reply?.error || 'Unable to inspect selected page');
  return reply.value;
}
async function movePointer(point, id, caption = 'OpenCluely') {
  const from = { ...pointer };
  for (let step = 1; step <= 12; step++) {
    await check(id);
    const t = step / 12, ease = t * t * (3 - 2 * t);
    pointer = { x: from.x + (point.x - from.x) * ease, y: from.y + (point.y - from.y) * ease };
    await command('Input.dispatchMouseEvent', { type: 'mouseMoved', ...pointer });
    await page('cursor', { ...pointer, caption }); await sleep(16);
  }
}
async function clickTarget(args, id, caption = 'Clicking') {
  let target = await page('pointer_target', args);
  await movePointer(target, id, `${caption}: ${args.label}`);
  await check(id);
  // Resolve once more after hover/animation so a shifted or covered target is never clicked blindly.
  target = await page('pointer_target', { ...args, ref: target.ref });
  pointer = { x: target.x, y: target.y };
  await page('cursor', { ...pointer, caption, click: true });
  await command('Input.dispatchMouseEvent', { type: 'mousePressed', ...pointer, button: 'left', clickCount: 1 });
  try { await sleep(70); }
  finally { await command('Input.dispatchMouseEvent', { type: 'mouseReleased', ...pointer, button: 'left', clickCount: 1 }); }
  await page('cursor', { ...pointer, caption, click: false }).catch(() => {});
}
const keyInfo = { Tab: [9, 'Tab'], Enter: [13, 'Enter'], Escape: [27, 'Escape'], Backspace: [8, 'Backspace'], ArrowDown: [40, 'ArrowDown'], ArrowUp: [38, 'ArrowUp'], ArrowLeft: [37, 'ArrowLeft'], ArrowRight: [39, 'ArrowRight'], 'Control+A': [65, 'a', 2], 'Shift+Tab': [9, 'Tab', 8] };
async function key(name) {
  const data = keyInfo[name]; if (!data) throw new Error('Unsupported key');
  const [windowsVirtualKeyCode, key, modifiers = 0] = data;
  try { await command('Input.dispatchKeyEvent', { type: 'keyDown', key, windowsVirtualKeyCode, modifiers, ...(name === 'Control+A' ? { commands: ['selectAll'] } : {}) }); }
  finally { await command('Input.dispatchKeyEvent', { type: 'keyUp', key, windowsVirtualKeyCode, modifiers }).catch(() => {}); }
}
async function perform(message) {
  const a = message.args || {};
  if (message.op === 'start') {
    if (!selected) throw new Error('Allow a tab from the extension popup');
    await cancel();
    const tab = await chrome.tabs.get(selected.id); urlScope(tab.url, a.origin);
    if (!tab.active || !Number.isInteger(a.typingDelay) || a.typingDelay < 10 || a.typingDelay > 250) throw new Error('Select an active tab and a valid typing speed');
    session = { origin: a.origin, id: a.session, delay: a.typingDelay }; const id = generation;
    try {
      await chrome.debugger.attach({ tabId: selected.id }, '1.3');
      await command('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
      await check(id); return true;
    } catch (error) { await cancel(); throw error; }
  }
  if (!session || a.session !== session.id) throw new Error('No approved task session');
  const id = generation; await check(id);
  if (message.op === 'inspect') return page('inspect');
  if (message.op === 'screenshot') {
    const metrics = await command('Page.getLayoutMetrics');
    return (await command('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: Math.min(1600, metrics.cssLayoutViewport.clientWidth), height: Math.min(1000, metrics.cssLayoutViewport.clientHeight), scale: 0.75 } })).data;
  }
  if (message.op !== 'action') throw new Error('Unknown extension operation');
  const action = a.action; const args = action?.args || {};
  // Extension defence in depth. Main process has the complete strict schema validator.
  const allowed = ['open_url', 'inspect_page', 'fill_field', 'compose_text', 'click_element', 'select_option', 'toggle_checkbox', 'scroll', 'press_key', 'wait_for_element'];
  if (!allowed.includes(action?.name)) throw new Error('Unsupported extension tool');
  if (!['inspect_page', 'wait_for_element'].includes(action.name) && a.confirmed !== true) throw new Error('Existing-tab input requires approval');
  approved = a.confirmed === true;
  try {
    switch (action.name) {
      case 'open_url':
        urlScope(args.url, session.origin); await chrome.tabs.update(selected.id, { url: args.url });
        for (let n = 0; n < 150; n++) { await check(id); if ((await chrome.tabs.get(selected.id)).status === 'complete') break; await sleep(100); }
        break;
      case 'compose_text':
      case 'fill_field':
        if (typeof args.value !== 'string' || args.value.length > 4000) throw new Error('Invalid text value');
        if (!(await page('focus', args)).focused) throw new Error('Could not focus field');
        await clickTarget(args, id, 'Typing');
        await check(id); await key('Control+A'); await check(id); await key('Backspace');
        for (const character of args.value) {
          await check(id);
          if (!(await page('verify_focus', args))) throw new Error('Field or focus changed during typing');
          const delay = session.delay; await command('Input.insertText', { text: character }); await sleep(delay);
        }
        break;
      case 'click_element': await clickTarget(args, id); await sleep(250); break;
      case 'toggle_checkbox': {
        const target = await page('pointer_target', args);
        if (target.checked !== args.checked) await clickTarget(args, id);
        break;
      }
      case 'select_option':
        await movePointer(await page('pointer_target', args), id, `Selecting: ${args.label}`);
        await page('select_option', args); break;
      case 'scroll':
        if (!Number.isInteger(args.delta) || Math.abs(args.delta) > 2000) throw new Error('Invalid scroll');
        await movePointer({ x: 100, y: 100 }, id, 'Scrolling');
        await command('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 100, y: 100, deltaX: 0, deltaY: args.delta }); await sleep(200); break;
      case 'press_key': await key(args.key); break;
      case 'inspect_page': break;
      case 'wait_for_element': {
        let ready = false;
        for (let n = 0; n < 60; n++) { await check(id); try { await page('wait_for_element', args); ready = true; break; } catch (_) { await sleep(100); } }
        if (!ready) throw new Error('Element did not become ready'); break;
      }
      default: await page(action.name, args);
    }
    await check(id); return page('inspect');
  } finally { approved = false; }
}
chrome.debugger.onEvent.addListener((source, method, params) => {
  if (source.tabId !== selected?.id || method !== 'Fetch.requestPaused') return;
  let allow = !!session;
  try {
    if (params.resourceType === 'Document') urlScope(params.request.url, session.origin);
    if ((!['GET', 'HEAD', 'OPTIONS'].includes(params.request.method) || ['XHR', 'Fetch'].includes(params.resourceType)) && !approved) allow = false;
  } catch (_) { allow = false; }
  command(allow ? 'Fetch.continueRequest' : 'Fetch.failRequest', { requestId: params.requestId, ...(!allow ? { errorReason: 'BlockedByClient' } : {}) }).catch(() => {});
});
chrome.debugger.onDetach.addListener(source => { if (source.tabId === selected?.id && session) { generation++; session = null; send({ type: 'revoked' }); } });
chrome.tabs.onRemoved.addListener(id => { if (id === selected?.id) cancel(true); });
chrome.commands.onCommand.addListener(name => { if (name === 'stop-agent') cancel(true); });
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('popup.html')) return;
  (async () => {
    if (message.op === 'status') return { connected: !!port, tab: selected, session: !!session, id: chrome.runtime.id, error: connectionError };
    if (message.op === 'disconnect') { await cancel(true); port?.disconnect(); port = null; return { connected: false }; }
    if (message.op !== 'connect') throw new Error('Unknown popup operation');
    connectionError = '';
    await cancel(true);
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); urlScope(tab.url);
    selected = { id: tab.id, url: tab.url, title: tab.title };
    if (!port) {
      port = chrome.runtime.connectNative('com.opencluely.agent');
      port.onDisconnect.addListener(() => { connectionError = chrome.runtime.lastError?.message || 'Native host disconnected. Keep OpenCluely running and reconnect.'; port = null; cancel(true); });
      port.onMessage.addListener(request => {
        if (request.op === 'cancel') { cancel(); return; }
        if (request.op === 'pause') { paused = true; return; }
        if (request.op === 'resume') { paused = false; return; }
        const epoch = generation;
        chain = chain.catch(() => {}).then(async () => {
          try { if (epoch !== generation) throw new Error('Queued operation was cancelled'); send({ type: 'result', id: request.id, result: await perform(request) }); }
          catch (error) { send({ type: 'result', id: request.id, error: error.message }); }
        });
      });
    }
    send({ type: 'selection', tab: selected }); return { connected: true, tab: selected, id: chrome.runtime.id };
  })().then(respond, error => respond({ error: error.message })); return true;
});
