// Hidden Electron smoke test: synthetic capture/OCR/provider, real preload and UI.
const electron = require('electron');
if (typeof electron === 'string') {
  const { spawn } = require('child_process');
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(electron, [__filename], { env, stdio: 'inherit', windowsHide: true });
  child.on('error', error => { console.error(error); process.exitCode = 1; });
  child.on('exit', code => { process.exitCode = code || 0; });
} else {
  const { app, BrowserWindow, ipcMain } = electron;
  const path = require('path');
  const assert = require('assert/strict');
  const Monitoring = require('../src/services/monitoring.service');
  app.whenReady().then(async () => {
    const errors = [];
    const window = new BrowserWindow({ show: false, width: 520, height: 650,
      webPreferences: { preload: path.join(__dirname, '../preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    const monitor = new Monitoring({
      capture: { listSources: async () => [{ id: 'screen:fixture', name: 'Test screen' }],
        captureSource: async () => ({ name: 'Test screen', sample: Buffer.alloc(400), imageBuffer: Buffer.from('fixture') }) },
      ocr: { recognize: async () => ({ text: 'What is dependency injection?' }) },
      answer: async ({ onDelta }) => { onDelta('A dependency is supplied externally.'); return 'A dependency is supplied externally.'; },
      emit: (type, data) => { if (!window.isDestroyed()) window.webContents.send('monitoring-event', { type, ...data }); }
    });
    const Automation = require('../src/services/automation.service');
    let planned = false;
    let registeredExtension;
    const agent = new Automation({
      knowledge: { list: () => [], read: () => null },
      browserFactory: () => ({ start: async () => {}, inspect: async () => ({ url: 'https://example.test/' }), execute: async () => ({ url: 'https://example.test/' }), close: async () => {} }),
      planner: async () => ({ action: planned ? { name: 'stop_task', args: { summary: 'Ready for review', missing: ['Certificate'] } } : (planned = true, { name: 'fill_field', args: { label: 'Name', value: 'Alex Example', sourceQuote: 'USER' } }), tokens: 100 }),
      emit: state => { if (!window.isDestroyed()) window.webContents.send('agent-status', state); }
    });
    const handlers = {
      'knowledge-list': () => [],
      'agent-extension-status': () => ({ connected: true, tab: { title: 'Fictional browser tab', url: 'https://example.test' } }),
      'agent-extension-install': (_event, id) => { registeredExtension = id; return { installed: true }; },
      'agent-status': () => agent.status(),
      'agent-start': (_event, options) => agent.start(options),
      'agent-pause': () => agent.pause(), 'agent-resume': () => agent.resume(),
      'agent-stop': () => agent.stop(), 'agent-approve': (_event, approved) => agent.approve(approved),
      'agent-auto-approve': (_event, enabled) => agent.setAutoApprove(enabled),
      'get-settings': () => ({ activeSkill: 'general' }), 'get-window-stats': () => ({ isInteractive: true }),
      'save-settings': () => ({ success: true }),
      'get-speech-availability': () => false,
      'resize-window': (_event, size) => { if (!window.isDestroyed()) window.setContentSize(Math.min(520, size.width), size.height); return { success: true }; },
      'monitoring-sources': () => monitor.capture.listSources(), 'monitoring-status': () => monitor.status(),
      'monitoring-retry-ocr': () => monitor.retryOcr(),
      'monitoring-configure': (_event, options) => monitor.configure(options),
      'monitoring-start': (_event, id) => monitor.start(id), 'monitoring-pause': () => monitor.pause(),
      'monitoring-resume': () => monitor.resume(), 'monitoring-stop': () => monitor.stop(),
      'monitoring-approve': () => monitor.approve(), 'monitoring-cancel': () => monitor.dismiss(),
      'clear-session-memory': () => monitor.clear()
    };
    for (const [channel, handler] of Object.entries(handlers)) ipcMain.handle(channel, handler);
    window.webContents.on('console-message', (_event, level, message) => { if (level === 3) errors.push(message); });
    try {
      await window.loadFile(path.join(__dirname, '../index.html'));
      await window.webContents.executeJavaScript(`new Promise(resolve => {
        const check = () => document.getElementById('liveSource')?.options.length ? resolve() : setTimeout(check, 25); check();
      })`);
      await window.webContents.executeJavaScript(`document.getElementById('monitoringPanel').open = true; document.getElementById('liveStart').click()`);
      await new Promise(resolve => setTimeout(resolve, 150));
      clearTimeout(monitor.timer); await monitor.tick(); clearTimeout(monitor.timer);
      assert.equal(await window.webContents.executeJavaScript(`document.getElementById('liveQuestion').textContent`), 'What is dependency injection?');
      await window.webContents.executeJavaScript(`document.getElementById('liveApprove').click()`);
      await new Promise(resolve => setTimeout(resolve, 150));
      assert.match(await window.webContents.executeJavaScript(`document.getElementById('liveAnswer').textContent`), /supplied externally/);
      const bounds = await window.webContents.executeJavaScript(`({ panel: document.getElementById('monitoringPanel').getBoundingClientRect().right, width: innerWidth, height: innerHeight })`);
      assert.ok(bounds.panel <= bounds.width); assert.ok(bounds.height > 100);
      await window.webContents.executeJavaScript(`document.getElementById('liveRetryOcr').click()`);
      await new Promise(resolve => setTimeout(resolve, 50)); assert.equal(monitor.previous, null);
      await window.webContents.executeJavaScript(`document.getElementById('liveStop').click()`);
      await new Promise(resolve => setTimeout(resolve, 100)); assert.equal(monitor.state, 'stopped');
      await window.webContents.executeJavaScript(`document.getElementById('monitoringPanel').open = false; document.getElementById('agentPanel').open = true;
        document.getElementById('agentMode').value = 'guided'; document.getElementById('agentUrl').value = 'https://example.test';
        document.getElementById('agentTask').value = 'Fill Name: Alex Example'; document.getElementById('agentStart').click();`);
      await new Promise(resolve => setTimeout(resolve, 150));
      assert.equal(agent.state, 'awaiting_approval');
      assert.equal(await window.webContents.executeJavaScript(`document.getElementById('agentApproval').hidden`), false);
      await window.webContents.executeJavaScript(`document.getElementById('agentApprove').click()`);
      await new Promise(resolve => setTimeout(resolve, 150));
      assert.equal(agent.state, 'completed');
      assert.match(await window.webContents.executeJavaScript(`document.getElementById('agentFields').textContent`), /Alex Example/);
      assert.match(await window.webContents.executeJavaScript(`document.getElementById('agentSummary').textContent`), /Certificate/);
      // Layout IPC is asynchronous; wait for the rendered bounds rather than a fixed delay.
      await window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
        const deadline = Date.now() + 4000;
        const check = () => {
          if (document.getElementById('agentPanel').getBoundingClientRect().bottom <= innerHeight) return resolve();
          if (Date.now() > deadline) return reject(new Error('Agent panel resize timed out'));
          setTimeout(check, 25);
        }; check();
      })`);
      const agentBounds = await window.webContents.executeJavaScript(`({ bottom: document.getElementById('agentPanel').getBoundingClientRect().bottom, height: innerHeight })`);
      assert.ok(agentBounds.bottom <= agentBounds.height, JSON.stringify({ ...agentBounds, errors, ui: await window.webContents.executeJavaScript(`typeof window.mainWindowUI`) }));
      await window.webContents.executeJavaScript(`document.getElementById('agentExtensionId').value = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'; document.getElementById('agentInstallExtension').click()`);
      await new Promise(resolve => setTimeout(resolve, 100)); assert.equal(registeredExtension, 'a'.repeat(32));
      assert.equal(await window.webContents.executeJavaScript(`document.getElementById('agentTarget').value`), 'extension');
      await window.webContents.executeJavaScript(`document.getElementById('agentTarget').value = 'browser'`);
      await window.webContents.executeJavaScript(`document.getElementById('agentCheckExtension').click()`);
      await new Promise(resolve => setTimeout(resolve, 100));
      assert.match(await window.webContents.executeJavaScript(`document.getElementById('agentExtensionStatus').textContent`), /Fictional browser tab/);
      assert.equal(await window.webContents.executeJavaScript(`document.getElementById('agentTarget').value`), 'extension');
      await window.webContents.executeJavaScript(`document.getElementById('agentStop').click()`);
      await new Promise(resolve => setTimeout(resolve, 50)); assert.equal(agent.state, 'stopped');
      planned = false;
      await window.webContents.executeJavaScript(`document.getElementById('agentMode').value = 'auto'; document.getElementById('agentMode').dispatchEvent(new Event('change')); document.getElementById('agentTarget').value = 'browser'; document.getElementById('agentAutoApprove').checked = true; document.getElementById('agentStart').click()`);
      await new Promise(resolve => setTimeout(resolve, 150));
      assert.equal(agent.state, 'completed'); assert.equal(agent.options.autoApprove, true);
      assert.equal(await window.webContents.executeJavaScript(`document.getElementById('agentApproval').hidden`), true);
      planned = false;
      await window.webContents.executeJavaScript(`document.getElementById('agentAutoApprove').checked = false; document.getElementById('agentAutoApprove').dispatchEvent(new Event('change')); document.getElementById('agentStart').click()`);
      await new Promise(resolve => setTimeout(resolve, 150)); assert.equal(agent.state, 'awaiting_approval');
      await window.webContents.executeJavaScript(`document.getElementById('agentAutoApprove').click()`);
      await new Promise(resolve => setTimeout(resolve, 150)); assert.equal(agent.state, 'completed');
      assert.equal(agent.options.autoApprove, true);
      assert.deepEqual(errors, []);
      console.log('Hidden Electron UI passed: monitoring and agent start → approval → field/missing summary → stop; panels fit.');
      app.exit(0);
    } catch (error) { console.error(error); app.exit(1); }
    finally { monitor.shutdown(); }
  }).catch(error => { console.error(error); app.exit(1); });
  setTimeout(() => { console.error('UI smoke test timed out'); app.exit(1); }, 20000);
}
