const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');
const { ExtensionBridge } = require('../src/services/extension-bridge');
const { frame, decoder } = require('../scripts/extension-native-host');
test('real native host frames ↔ authenticated local pipe; disconnect rejects outstanding actions', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-native-')); let native; let disconnected = 0;
  const bridge = new ExtensionBridge({ dataDir: dir, onDisconnect: () => { disconnected++; } });
  const wait = async condition => { for (let n = 0; n < 200; n++) { if (condition()) return; await new Promise(r => setTimeout(r, 10)); } throw new Error('Transport condition timed out'); };
  try {
    await bridge.listen();
    const bad = net.connect(bridge.pipe); await new Promise(resolve => bad.once('connect', resolve)); bad.write(JSON.stringify({ type: 'hello', secret: 'wrong' }) + '\n');
    await new Promise(resolve => bad.once('close', resolve)); assert.equal(bridge.status().connected, false);
    fs.mkdirSync(path.dirname(bridge.configPath), { recursive: true });
    fs.writeFileSync(bridge.configPath, JSON.stringify({ secret: bridge.secret, pipe: bridge.pipe, extensionId: 'a'.repeat(32) }));
    native = spawn(process.execPath, [path.resolve(__dirname, '../scripts/extension-native-host.js'), bridge.configPath, `chrome-extension://${'a'.repeat(32)}/`], { windowsHide: true });
    let request;
    native.stdout.on('data', decoder(message => { request = message; if (message.op === 'inspect') native.stdin.write(frame({ type: 'result', id: message.id, result: { text: 'Fictional café 🐈' } })); }, error => { throw error; }));
    native.stdin.write(frame({ type: 'selection', tab: { id: 10, title: 'Local test', url: 'http://127.0.0.1:3000' } }));
    await wait(() => bridge.status().tab);
    assert.equal((await bridge.request('inspect')).text, 'Fictional café 🐈');
    request = null; const pending = bridge.request('action'); const rejected = assert.rejects(pending, /disconnected/);
    await wait(() => request?.op === 'action'); native.kill(); await rejected;
    assert.ok(disconnected > 0); assert.equal(bridge.status().connected, false);
  } finally { native?.kill(); await bridge.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
