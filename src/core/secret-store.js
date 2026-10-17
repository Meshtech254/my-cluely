const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');
const dotenv = require('dotenv');

const SECRET_KEYS = ['GEMINI_API_KEY', 'OPENAI_API_KEY', 'AZURE_SPEECH_KEY'];

class SecretStore {
  constructor() {
    this.filePath = path.join(app.getPath('userData'), 'secrets.json');
  }

  isAvailable() {
    return safeStorage.isEncryptionAvailable();
  }

  load() {
    if (!this.isAvailable()) return false;
    try {
      const encrypted = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      for (const key of SECRET_KEYS) {
        if (encrypted[key]) process.env[key] = safeStorage.decryptString(Buffer.from(encrypted[key], 'base64'));
      }
      return true;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      return true;
    }
  }

  set(key, value) {
    if (!SECRET_KEYS.includes(key)) throw new Error('Unsupported secret key');
    if (!this.isAvailable()) return false;
    let stored = {};
    try { stored = JSON.parse(fs.readFileSync(this.filePath, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (value) stored[key] = safeStorage.encryptString(String(value)).toString('base64');
    else delete stored[key];
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(stored), { mode: 0o600 });
    fs.renameSync(tempPath, this.filePath);
    if (value) process.env[key] = String(value);
    else delete process.env[key];
    return true;
  }

  migrateLegacyEnv(envPath) {
    if (!this.isAvailable()) return false;
    const content = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
    const legacy = dotenv.parse(content);
    const values = {};
    for (const key of SECRET_KEYS) {
      const current = process.env[key] || legacy[key] || '';
      values[key] = /^your_.*_here$/i.test(current.trim()) ? '' : current;
      if (!values[key]) delete process.env[key];
    }
    for (const [key, value] of Object.entries(values)) {
      if (value && !this.set(key, value)) return false;
    }
    if (SECRET_KEYS.some((key) => Object.prototype.hasOwnProperty.call(legacy, key))) {
      const clean = content.split(/\r?\n/).filter((line) => {
        const match = line.match(/^\s*([A-Z0-9_]+)\s*=/);
        return !match || !SECRET_KEYS.includes(match[1]);
      }).join('\n');
      const tempPath = `${envPath}.tmp`;
      fs.writeFileSync(tempPath, clean, { mode: 0o600 });
      fs.renameSync(tempPath, envPath);
    }
    return true;
  }
}

module.exports = SecretStore;
