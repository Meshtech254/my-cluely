const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const readline = require('readline');
const path = require('path');
const Desktop = require('../src/services/automation-desktop');
test('real Windows helper: UI Automation inspect, cursor, clicks, typing, shortcuts and cleanup', { skip: process.platform !== 'win32', timeout: 30000 }, async () => {
  const fixture = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', path.join(__dirname, 'fixtures/agent-window.ps1')], { windowsHide: true });
  let ready, actual = ''; let startupError = '';
  fixture.stderr.on('data', chunk => { startupError += chunk; });
  const messages = readline.createInterface({ input: fixture.stdout });
  messages.on('line', line => { try { const data = JSON.parse(line); if (data.handle) ready = data; if (typeof data.value === 'string') actual = data.value; } catch (_) {} });
  const wait = async fn => { for (let i = 0; i < 200; i++) { if (fn()) return; await new Promise(r => setTimeout(r, 50)); } throw new Error('Fixture timed out; last fictional value: ' + JSON.stringify(actual) + '. ' + startupError); };
  const desktop = new Desktop({ capture: {}, displays: () => [] });
  try {
    await wait(() => ready);
    const state = await desktop.start(`window:${ready.handle}:0`);
    assert.equal(state.title, 'OpenCluely fictional input test');
    await desktop.request('activate');
    await desktop.request('move_mouse', { x: ready.x, y: ready.y });
    await desktop.request('click_coordinates', { x: ready.x, y: ready.y, button: 'left', count: 2 });
    const label = state.controls.some(c => c.label === 'Test entry') ? 'Test entry' : '__focused_text_field__';
    if (label === '__focused_text_field__') console.log('This desktop exposes no named UIA field; exercising the guarded native Edit fallback.');
    await desktop.execute({ name: 'fill_field', args: { label, value: 'Fictional test text' } });
    await wait(() => actual === 'Fictional test text');
    await desktop.execute({ name: 'press_key', args: { key: 'Control+A' } });
    await desktop.execute({ name: 'press_key', args: { key: 'Backspace' } });
    await wait(() => actual === '');
    await desktop.request('scroll', { delta: 120 });
    await assert.rejects(desktop.request('click_coordinates', { x: -100000, y: -100000, button: 'left', count: 1 }), /outside|covered/);
  } finally { await desktop.close(); fixture.kill(); messages.close(); }
});
