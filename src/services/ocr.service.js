const { spawn } = require('child_process');
const path = require('path');

// Windows ships an OCR engine; no model download or captured-image file is needed.
class OcrService {
  constructor({ spawnProcess = spawn, timeoutMs = 30000, platform = process.platform } = {}) {
    Object.assign(this, { spawnProcess, timeoutMs, platform });
  }
  recognize(imageBuffer) {
    if (this.platform !== 'win32') return Promise.reject(new Error('Local OCR requires Windows 10/11. Enable image fallback explicitly on other platforms.'));
    return new Promise((resolve, reject) => {
      const script = path.join(__dirname, '../../scripts/windows-ocr.ps1').replace('app.asar', 'app.asar.unpacked');
      const executable = process.env.SystemRoot ? path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe') : 'powershell.exe';
      const child = this.spawnProcess(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      this.child = child;
      let output = ''; let errors = ''; let stopReason = null;
      const stop = error => { stopReason = error; child.kill(); };
      this.stop = () => { const error = new Error('OCR cancelled'); error.name = 'AbortError'; stop(error); };
      const timeout = setTimeout(() => stop(new Error(`Windows OCR timed out after ${this.timeoutMs / 1000} seconds. It will retry automatically; pause and resume if Windows is busy.`)), this.timeoutMs);
      child.stdout.on('data', data => { output += data.toString('utf8'); if (output.length > 200000) stop(new Error('Windows OCR output exceeded the size limit.')); });
      child.stderr.on('data', data => { errors = (errors + data.toString()).slice(-2000); });
      child.on('error', error => {
        clearTimeout(timeout);
        if (this.child === child) { this.child = null; this.stop = null; }
        reject(new Error(`Could not start Windows OCR (${error.code || error.message}). Check access to Windows PowerShell.`));
      });
      child.stdin.on('error', () => {});
      child.on('close', (code, signal) => {
        clearTimeout(timeout); if (this.child === child) { this.child = null; this.stop = null; }
        if (stopReason) { reject(stopReason); return; }
        if (code !== 0) { reject(new Error(errors.trim() || `Windows OCR exited unexpectedly (code ${code}, signal ${signal || 'none'}). It will retry automatically.`)); return; }
        try { resolve(JSON.parse(output.replace(/^\uFEFF/, ''))); } catch (_) { reject(new Error('Windows OCR returned an invalid result.')); }
      });
      child.stdin.end(imageBuffer.toString('base64') + '\n');
    });
  }
  cancel() { this.stop?.(); }
}
module.exports = OcrService;
