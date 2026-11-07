const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const Ocr = require('../src/services/ocr.service');

function fixture(timeoutMs = 1000) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.stdin = new EventEmitter();
  child.stdin.end = () => {};
  child.kill = () => { queueMicrotask(() => child.emit('close', null, 'SIGTERM')); };
  const ocr = new Ocr({ platform: 'win32', timeoutMs, spawnProcess: () => child });
  return { child, ocr };
}

test('OCR helper decodes text without storing the captured image', async () => {
  const { child, ocr } = fixture(); const result = ocr.recognize(Buffer.from('fixture'));
  child.stdout.emit('data', Buffer.from('{"text":"What is dependency injection?"}'));
  child.emit('close', 0, null);
  assert.equal((await result).text, 'What is dependency injection?'); assert.equal(ocr.child, null);
});

test('OCR timeout reports the timeout rather than blaming language packs', async () => {
  const { ocr } = fixture(10);
  await assert.rejects(ocr.recognize(Buffer.from('fixture')), /timed out after/);
});

test('OCR cancellation is distinguishable from an unavailable engine', async () => {
  const { ocr } = fixture(); const result = ocr.recognize(Buffer.from('fixture')); ocr.cancel();
  await assert.rejects(result, { name: 'AbortError' });
});

test('OCR unexpected process exit includes the exit code and signal', async () => {
  const { ocr, child } = fixture(); const result = ocr.recognize(Buffer.from('fixture'));
  child.emit('close', 7, null); await assert.rejects(result, /code 7, signal none/);
});

test('OCR launch errors clear the timeout and identify PowerShell access', async () => {
  const { ocr, child } = fixture(); const result = ocr.recognize(Buffer.from('fixture'));
  child.emit('error', Object.assign(new Error('permission denied'), { code: 'EPERM' }));
  await assert.rejects(result, /EPERM.*Windows PowerShell/); assert.equal(ocr.child, null);
});
