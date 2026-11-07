const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { frame, decoder } = require('../scripts/extension-native-host');
const { ExtensionBridge, ExtensionBrowser, HOST } = require('../src/services/extension-bridge');
const { validateAction, needsApproval } = require('../src/services/automation-policy');
test('native framing preserves split Unicode messages and rejects oversized/malformed frames', () => {
  const received = []; let rejected = false;
  const decode = decoder(message => received.push(message), () => { rejected = true; });
  const bytes = Buffer.concat([frame({ text: 'Fictional café 🐈' }), frame({ type: 'result', id: 1 })]);
  for (let i = 0; i < bytes.length; i += 3) decode(bytes.subarray(i, i + 3));
  assert.equal(received[0].text, 'Fictional café 🐈'); assert.equal(received[1].id, 1);
  const invalid = Buffer.alloc(4); invalid.writeUInt32LE(2 * 1024 * 1024); decode(invalid); assert.equal(rejected, true);
});
test('native host installer restricts extension origin and registers only fixed per-user browser keys', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'opencluely-extension-unit-')); const commands = [];
  try {
    const bridge = new ExtensionBridge({ dataDir: directory, register: (file, args, options, callback) => { commands.push({ file, args, options }); callback(); } });
    await assert.rejects(bridge.install('malicious & command'), /extension ID|Windows/);
    if (process.platform !== 'win32') return;
    await bridge.install('a'.repeat(32));
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'extension-host', `${HOST}.json`), 'utf8'));
    assert.deepEqual(manifest.allowed_origins, [`chrome-extension://${'a'.repeat(32)}/`]);
    assert.equal(commands.length, 2); assert.ok(commands.every(c => c.file === 'reg.exe' && c.args[1].startsWith('HKCU\\Software\\') && c.options.windowsHide));
    const reloaded = new ExtensionBridge({ dataDir: directory }); assert.equal(reloaded.secret, bridge.secret);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
test('existing-tab adapter requires a selected matching origin and validates actions before transport', async () => {
  const messages = [];
  const bridge = { selection: { url: 'https://example.test/form' }, request: async (...args) => { messages.push(args); return {}; }, cancel() {}, pause() {}, resume() {} };
  const browser = new ExtensionBrowser(bridge, { typingDelay: 45 });
  await assert.rejects(browser.start('https://other.test'), /match/);
  await browser.start('https://example.test');
  assert.equal(messages[0][0], 'start'); assert.equal(messages[0][1].typingDelay, 45);
  assert.throws(() => browser.execute({ name: 'run_javascript', args: { code: 'evil()' } }));
  for (const name of ['fill_field', 'scroll', 'open_application', 'switch_window']) assert.equal(needsApproval({ name }, 'auto', 'extension'), true);
  assert.throws(() => validateAction({ name: 'open_application', args: { app: 'powershell' } }));
});
