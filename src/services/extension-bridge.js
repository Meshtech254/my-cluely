const net = require('net');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { scopedUrl, validateAction } = require('./automation-policy');
const HOST = 'com.opencluely.agent';
class ExtensionBridge {
  constructor({ dataDir, executable = process.execPath, register = execFile, onDisconnect = () => {} }) {
    Object.assign(this, { dataDir, executable, register, onDisconnect });
    this.pipe = process.platform === 'win32' ? `\\\\.\\pipe\\opencluely-${crypto.createHash('sha256').update(dataDir).digest('hex').slice(0, 20)}` : path.join(dataDir, 'agent.sock');
    this.pending = new Map(); this.sequence = 0;
    this.configPath = path.join(dataDir, 'extension-host', 'connection.json');
    try { this.secret = JSON.parse(fs.readFileSync(this.configPath, 'utf8')).secret; } catch (_) {}
    this.secret ||= crypto.randomBytes(32).toString('hex');
  }
  async listen() {
    this.server = net.createServer(socket => {
      socket.setEncoding('utf8');
      let buffer = ''; let authenticated = false;
      const deadline = setTimeout(() => { if (!authenticated) socket.destroy(); }, 3000);
      socket.on('data', chunk => {
        buffer += chunk.toString('utf8');
        if (buffer.length > 2 * 1024 * 1024) return socket.destroy();
        let newline;
        while ((newline = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
          try {
            const message = JSON.parse(line);
            if (!authenticated) {
              if (message.type !== 'hello' || typeof message.secret !== 'string' || message.secret.length !== this.secret.length || !crypto.timingSafeEqual(Buffer.from(message.secret), Buffer.from(this.secret))) return socket.destroy();
              if (this.socket && this.socket !== socket) return socket.destroy();
              authenticated = true; clearTimeout(deadline); this.socket = socket; continue;
            }
            if (message.type === 'selection') {
              scopedUrl(message.tab?.url);
              if (this.selection && (this.selection.id !== message.tab.id || this.selection.url !== message.tab.url)) this.onDisconnect();
              this.selection = { id: message.tab.id, url: message.tab.url, title: String(message.tab.title || '').slice(0, 200) };
            } else if (message.type === 'revoked') { this.selection = null; this.onDisconnect(); }
            else if (message.type === 'result') {
              const pending = this.pending.get(message.id); if (!pending) continue;
              this.pending.delete(message.id); clearTimeout(pending.timer);
              if (message.error) pending.reject(new Error(String(message.error).slice(0, 500))); else pending.resolve(message.result);
            }
          } catch (_) { socket.destroy(); }
        }
      });
      socket.on('error', () => {});
      socket.on('close', () => {
        clearTimeout(deadline);
        if (this.socket !== socket) return;
        this.socket = null; this.selection = null;
        for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(new Error('Browser extension disconnected')); }
        this.pending.clear(); this.onDisconnect();
      });
    });
    await new Promise((resolve, reject) => { this.server.once('error', reject); this.server.listen(this.pipe, resolve); });
  }
  status() { return { connected: !!this.socket, tab: this.selection || null }; }
  request(op, args = {}, timeout = 60000) {
    if (!this.socket || !this.selection) return Promise.reject(new Error('Connect and allow a browser tab from the extension popup first'));
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => { this.pending.delete(id); this.socket?.write(JSON.stringify({ op: 'cancel' }) + '\n'); reject(new Error('Browser extension action timed out')); }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.write(JSON.stringify({ id, op, args }) + '\n');
    });
  }
  cancel() { this.socket?.write(JSON.stringify({ op: 'cancel' }) + '\n'); }
  pause() { this.socket?.write(JSON.stringify({ op: 'pause' }) + '\n'); }
  resume() { this.socket?.write(JSON.stringify({ op: 'resume' }) + '\n'); }
  async install(extensionId) {
    if (process.platform !== 'win32') throw new Error('Native host registration currently supports Windows');
    if (!/^[a-p]{32}$/.test(extensionId)) throw new Error('Paste the 32-letter extension ID from chrome://extensions or edge://extensions');
    const directory = path.dirname(this.configPath); fs.mkdirSync(directory, { recursive: true });
    const worker = path.join(__dirname, '../../scripts/extension-native-host.js').replace('app.asar', 'app.asar.unpacked');
    const launcher = path.join(directory, 'launch.cmd'); const manifest = path.join(directory, `${HOST}.json`);
    for (const value of [this.executable, worker, this.configPath]) if (/[\r\n%!"]/.test(value)) throw new Error('Installation path contains unsupported command-file characters');
    fs.writeFileSync(this.configPath, JSON.stringify({ pipe: this.pipe, secret: this.secret, extensionId }), { mode: 0o600 });
    fs.writeFileSync(launcher, `@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${this.executable}" "${worker}" "${this.configPath}" %*\r\n`);
    fs.writeFileSync(manifest, JSON.stringify({ name: HOST, description: 'OpenCluely local browser bridge', path: launcher, type: 'stdio', allowed_origins: [`chrome-extension://${extensionId}/`] }));
    for (const vendor of ['Google\\Chrome', 'Microsoft\\Edge']) await new Promise((resolve, reject) => {
      this.register('reg.exe', ['ADD', `HKCU\\Software\\${vendor}\\NativeMessagingHosts\\${HOST}`, '/ve', '/t', 'REG_SZ', '/d', manifest, '/f'], { windowsHide: true }, error => error ? reject(new Error('Native host registration failed')) : resolve());
    });
    return { installed: true };
  }
  async close() { this.socket?.destroy(); await new Promise(resolve => this.server ? this.server.close(resolve) : resolve()); }
}
class ExtensionBrowser {
  constructor(bridge, { typingDelay = 65 } = {}) { this.bridge = bridge; this.typingDelay = typingDelay; }
  async start(url, signal) {
    this.origin = scopedUrl(url).origin;
    if (scopedUrl(this.bridge.selection?.url).origin !== this.origin) throw new Error('Selected browser tab does not match task origin');
    this.session = crypto.randomUUID();
    signal?.addEventListener('abort', () => this.bridge.cancel(), { once: true });
    await this.bridge.request('start', { origin: this.origin, session: this.session, typingDelay: this.typingDelay });
    if (signal?.aborted) { this.bridge.cancel(); signal.throwIfAborted(); }
  }
  inspect() { return this.bridge.request('inspect', { session: this.session }); }
  execute(action, confirmed = false) { validateAction(action); return this.bridge.request('action', { action, confirmed, session: this.session }, Math.max(60000, (action.args.value?.length || 0) * this.typingDelay + 15000)); }
  pause() { this.bridge.pause(); }
  resume() { this.bridge.resume(); }
  async screenshot() { return this.bridge.request('screenshot', { session: this.session }); }
  async close() { this.bridge.cancel(); }
}
module.exports = { ExtensionBridge, ExtensionBrowser, HOST };
