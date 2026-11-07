const { spawn } = require('child_process');
const readline = require('readline');
const path = require('path');
function inside(point, bounds) { return point.x >= bounds.x && point.y >= bounds.y && point.x < bounds.x + bounds.width && point.y < bounds.y + bounds.height; }
class AutomationDesktop {
  constructor({ capture, displays }) { this.capture = capture; this.displays = displays; this.pending = new Map(); this.sequence = 0; }
  async start(sourceId, signal, options = {}) {
    signal?.throwIfAborted();
    if (process.platform !== 'win32') throw new Error('Desktop control requires Windows');
    if (!/^window:\d+:\d+$/.test(sourceId)) throw new Error('Select a specific application window');
    this.signal = signal; this.options = options; this.closed = false; this.paused = false;
    this.shot = null;
    this.typingDelay = options.typingDelay || 65;
    this.approvedWindows = (await this.capture.listSources?.() || []).filter(s => s.id.startsWith('window:') && (s.id === sourceId || options.allowedWindowIds?.includes(s.id)));
    signal?.throwIfAborted();
    this.sourceId = sourceId; this.handle = Number(sourceId.split(':')[1]);
    const script = path.join(__dirname, '../../scripts/windows-agent.ps1').replace('app.asar', 'app.asar.unpacked');
    this.pending = new Map(); const pending = this.pending;
    this.worker = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', script], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const fail = () => { for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error('Desktop worker stopped')); } pending.clear(); };
    this.worker.on('error', fail); this.worker.on('exit', fail); this.worker.stderr.on('data', () => {});
    this.worker.stdin.on('error', fail);
    readline.createInterface({ input: this.worker.stdout }).on('line', line => {
      try { const message = JSON.parse(line); const p = pending.get(message.id); if (!p) return; pending.delete(message.id); clearTimeout(p.timer); if (message.error) p.reject(new Error(message.error)); else p.resolve(message.result); } catch (_) { /* ignore startup diagnostics */ }
    });
    return this.inspect();
  }
  request(op, args = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Desktop worker timed out')); this.close(); }, 15000);
      this.pending.set(id, { resolve, reject, timer });
      this.worker.stdin.write(JSON.stringify({ id, op, args, handle: this.handle }) + '\n');
    });
  }
  async inspect() { this.current = await this.request('inspect'); return { ...this.current, displays: this.displays(), approvedWindows: this.approvedWindows?.map(w => ({ label: w.name, id: w.id })) || [] }; }
  async focus() { await this.request('activate'); return this.inspect(); }
  async screenshot() { const shot = await this.capture.captureSource(this.sourceId); this.shot = { time: Date.now(), bounds: JSON.stringify(this.current.bounds) }; return shot.imageBuffer.toString('base64'); }
  async switchTo(source, expectedProcesses) {
    this.signal?.throwIfAborted();
    const currentSources = await this.capture.listSources();
    if (!currentSources.some(s => s.id === source.id && s.name === source.name)) throw new Error('Approved window disappeared or its identity changed');
    const allowed = this.approvedWindows; const signal = this.signal; const options = this.options;
    await this.close(); await this.start(source.id, signal, options); this.approvedWindows = allowed;
    if (expectedProcesses && !expectedProcesses.includes(String(this.current.processName).toLowerCase())) {
      await this.close(); throw new Error('New window does not belong to the approved application');
    }
    await this.request('activate'); return this.inspect();
  }
  async openApplication(app) {
    const applications = { notepad: ['notepad.exe', /notepad/i, ['notepad']], calculator: ['calc.exe', /calculator/i, ['calculatorapp', 'calculator']], explorer: ['explorer.exe', /file explorer|home|this pc/i, ['explorer']] };
    if (!Object.hasOwn(applications, app)) throw new Error('Application is not on the launch allowlist');
    const before = new Set((await this.capture.listSources()).map(s => s.id));
    this.signal?.throwIfAborted(); if (this.closed) throw new Error('Task stopped');
    const child = spawn(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', applications[app][0]), [], { windowsHide: false, detached: true, stdio: 'ignore' });
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); }); child.unref();
    for (let n = 0; n < 60; n++) {
      this.signal?.throwIfAborted(); if (this.closed) throw new Error('Task stopped');
      const found = (await this.capture.listSources()).filter(s => s.id.startsWith('window:') && !before.has(s.id) && applications[app][1].test(s.name));
      if (found.length === 1) { this.approvedWindows.push(found[0]); return this.switchTo(found[0], applications[app][2]); }
      if (found.length > 1) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('App launched, but its window could not be uniquely selected. Refresh windows and start a new task on it.');
  }
  async execute(action, confirmed = false) {
    if (['switch_window', 'open_application'].includes(action.name)) {
      if (!confirmed) throw new Error('Opening or switching applications requires approval');
      if (action.name === 'open_application') return this.openApplication(action.args.app);
      const matches = this.approvedWindows.filter(s => s.name === action.args.label);
      if (matches.length !== 1) throw new Error('Window was not approved or its name is ambiguous');
      return this.switchTo(matches[0]);
    }
    const state = await this.inspect();
    if (action.name === 'inspect_page') return state;
    if (state.foreground !== this.handle) throw new Error('Selected application must be foreground. Focus it and resume.');
    if (['move_mouse', 'click_coordinates'].includes(action.name)) {
      if (!this.shot || Date.now() - this.shot.time > 15000 || this.shot.bounds !== JSON.stringify(state.bounds)) throw new Error('Screenshot is stale or window moved. Inspect again.');
      if (!inside(action.args, state.bounds)) throw new Error('Coordinates outside selected application');
      const { screen } = require('electron');
      const physicalDisplays = this.displays().map(d => ({ ...screen.dipToScreenRect(null, d.bounds) }));
      if (!physicalDisplays.some(d => inside(action.args, d))) throw new Error('Coordinates outside attached displays');
    }
    if (['fill_field', 'compose_text'].includes(action.name)) {
      await this.request('focus_field', action.args);
      for (const character of action.args.value) {
        while (this.paused && !this.closed) await new Promise(resolve => setTimeout(resolve, 30));
        this.signal?.throwIfAborted(); if (this.closed) throw new Error('Typing stopped');
        await this.request('type_character', { value: character });
        await new Promise(resolve => setTimeout(resolve, this.typingDelay));
      }
    } else await this.request(action.name, action.args);
    this.shot = null;
    return this.inspect();
  }
  pause() { this.paused = true; }
  resume() { this.paused = false; }
  async close() { this.closed = true; this.worker?.kill(); }
}
module.exports = AutomationDesktop;
module.exports.inside = inside;
