const test = require('node:test');
const assert = require('node:assert/strict');
const { LiveContext, detectQuestion, frameChanged } = require('../src/core/live-context');
const Monitoring = require('../src/services/monitoring.service');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function fixture(overrides = {}) {
  const events = []; let captures = 0; let scans = 0; let requests = 0;
  const monitor = new Monitoring({
    capture: { listSources: async () => [{ id: 'screen:1', name: 'Monitor' }],
      captureSource: async () => { captures++; return { name: 'Monitor', sample: Buffer.alloc(400), imageBuffer: Buffer.from('png') }; } },
    ocr: { recognize: async () => { scans++; return { text: 'What is dependency injection?' }; } },
    answer: async ({ onDelta }) => { requests++; onDelta('answer'); return 'answer'; },
    emit: (type, data) => events.push({ type, ...data }), ...overrides
  });
  return { monitor, events, counts: () => ({ captures, scans, requests }) };
}

test('question extraction recognizes explicit, implicit, error and follow-up prompts', () => {
  for (const text of ['What is dependency injection?', 'Explain the purpose of this function.', 'Tell me about your experience.', 'Error: connection failed']) assert.ok(detectQuestion(text));
  assert.equal(detectQuestion('New email notification'), null);
  assert.equal(detectQuestion('And how about caching', true), 'And how about caching');
  assert.equal(detectQuestion('continue', false), null);
});

test('spatial comparison skips near identical frames but detects meaningful changes', () => {
  const image = Buffer.alloc(400); const near = Buffer.alloc(400, 1);
  assert.equal(frameChanged(null, image), true);
  assert.equal(frameChanged(image, image), false);
  assert.equal(frameChanged(image, near), false);
  assert.equal(frameChanged(image, Buffer.alloc(400, 255)), true);
});

test('selected source, stable frame OCR cache, approval, deduplication, pause/resume and stop', async () => {
  const { monitor, counts } = fixture();
  try {
    await assert.rejects(monitor.start('missing'), /available/);
    await monitor.start('screen:1'); await wait(10); clearTimeout(monitor.timer);
    assert.equal(monitor.pending, null);
    await monitor.tick(); clearTimeout(monitor.timer);
    assert.equal(counts().scans, 1); assert.equal(counts().requests, 0);
    await monitor.approve(); assert.equal(counts().requests, 1);
    await monitor.tick(); clearTimeout(monitor.timer); assert.equal(monitor.pending, null);
    monitor.pause(); const count = counts().captures; await monitor.tick(); assert.equal(counts().captures, count);
    await monitor.resume(); await wait(10); clearTimeout(monitor.timer);
    monitor.stop(); assert.equal(monitor.context.screen, null); assert.equal(monitor.state, 'stopped');
  } finally { monitor.shutdown(); }
});

test('OCR failure falls back only when image sending is explicitly enabled', async () => {
  const { monitor } = fixture({ ocr: { recognize: async () => { throw new Error('missing language'); } } });
  try {
    await monitor.start('screen:1'); await wait(10); clearTimeout(monitor.timer);
    await monitor.tick(); clearTimeout(monitor.timer); assert.equal(monitor.pending, null);
    monitor.configure({ visualFallback: true }); monitor.previous = null;
    await monitor.tick(); clearTimeout(monitor.timer); await monitor.tick(); clearTimeout(monitor.timer);
    assert.match(monitor.pending.question, /current image/); assert.match(monitor.ocrStatus, /missing language/);
  } finally { monitor.shutdown(); }
});

test('missing source suspends monitoring', async () => {
  const { monitor } = fixture({ capture: { listSources: async () => [{ id: 'screen:1' }], captureSource: async () => { throw new Error('disappeared'); } } });
  try { await monitor.start('screen:1'); await wait(10); assert.equal(monitor.state, 'suspended'); }
  finally { monitor.shutdown(); }
});

test('failed OCR retries an unchanged frame and recovers question detection', async () => {
  let scans = 0;
  const { monitor } = fixture({ ocr: { recognize: async () => {
    if (++scans === 1) throw new Error('Windows OCR timed out');
    return { text: 'What is dependency injection?' };
  } } });
  try {
    await monitor.start('screen:1'); await wait(10); clearTimeout(monitor.timer);
    assert.match(monitor.ocrStatus, /Retrying in 5s/);
    await monitor.tick(); clearTimeout(monitor.timer); assert.equal(scans, 1);
    monitor.ocrRetryAt = Date.now() - 1;
    await monitor.tick(); clearTimeout(monitor.timer); assert.equal(scans, 2);
    await monitor.tick(); clearTimeout(monitor.timer);
    assert.equal(monitor.pending.question, 'What is dependency injection?');
    assert.equal(monitor.ocrStatus, 'Local OCR');
  } finally { monitor.shutdown(); }
});

test('interrupted OCR is not cached and pause does not show a false OCR failure', async () => {
  let rejectScan;
  const { monitor } = fixture({ ocr: {
    recognize: () => new Promise((_resolve, reject) => { rejectScan = reject; }),
    cancel: () => { if (rejectScan) rejectScan(Object.assign(new Error('OCR cancelled'), { name: 'AbortError' })); }
  } });
  try {
    await monitor.start('screen:1'); await wait(10);
    monitor.pause(); await wait(10);
    assert.equal(monitor.ocrStatus, ''); assert.equal(monitor.previous, null); assert.equal(monitor.context.screen, null);
  } finally { monitor.shutdown(); }
});

test('enabling image fallback reprocesses an unchanged source after OCR failure', async () => {
  const { monitor } = fixture({ ocr: { recognize: async () => { throw new Error('unavailable'); } } });
  try {
    await monitor.start('screen:1'); await wait(10); clearTimeout(monitor.timer);
    assert.equal(monitor.stableQuestion, null);
    monitor.configure({ visualFallback: true });
    await monitor.tick(); clearTimeout(monitor.timer); await monitor.tick(); clearTimeout(monitor.timer);
    assert.match(monitor.pending.question, /current image/);
  } finally { monitor.shutdown(); }
});

test('stopping aborts active streams and ignores stale deltas and completion', async () => {
  let finish; let signal; let delta;
  const { monitor, events } = fixture({ answer: request => { signal = request.signal; delta = request.onDelta; return new Promise(resolve => { finish = resolve; }); } });
  try {
    monitor.state = 'running'; monitor.queue('Why is this application failing?', 'screen');
    const active = monitor.approve(); monitor.stop(); assert.equal(signal.aborted, true);
    delta('stale'); finish('stale answer'); await active;
    assert.equal(events.some(e => e.type === 'answer-chunk' || e.type === 'answer-end'), false);
    assert.equal(monitor.context.answers.length, 0);
  } finally { monitor.shutdown(); }
});

test('completed Whisper fragments coalesce independently of screen; partials and stopped audio ignored', async () => {
  const { monitor } = fixture();
  try {
    monitor.setAudio(true); monitor.transcript('What is', false); assert.equal(monitor.transcriptBuffer, undefined);
    monitor.transcript('What is'); monitor.transcript('dependency injection?'); await wait(960);
    assert.equal(monitor.pending.question, 'What is dependency injection?');
    assert.equal(monitor.state, 'stopped');
    monitor.setAudio(false); monitor.transcript('Why is this failing?'); await wait(960);
    assert.equal(monitor.pending, null); assert.equal(monitor.context.transcripts.length, 0);
  } finally { monitor.shutdown(); }
});

test('network failure returns to Suggest Only and retains a retryable question', async () => {
  const { monitor } = fixture({ answer: async () => { throw new Error('offline'); } });
  try {
    monitor.state = 'running'; monitor.options.mode = 'auto'; monitor.queue('What is dependency injection?', 'screen');
    clearTimeout(monitor.answerTimer); monitor.answerTimer = null;
    await monitor.approve(); assert.equal(monitor.options.mode, 'suggest'); assert.ok(monitor.pending);
  } finally { monitor.shutdown(); }
});

test('Auto Answer schedules once, dismissal prevents repeated automatic requests', async () => {
  const { monitor, counts } = fixture();
  try {
    monitor.state = 'running'; monitor.options.mode = 'auto';
    monitor.queue('What is dependency injection?', 'screen');
    await wait(850); assert.equal(counts().requests, 1);
    monitor.queue('Why is this application failing?', 'screen'); monitor.dismiss();
    monitor.queue('Why is this application failing?', 'screen');
    assert.equal(monitor.pending, null); assert.equal(monitor.answerTimer, null);
  } finally { monitor.shutdown(); }
});

test('sensitive window titles pause before OCR or answering', async () => {
  const { monitor, counts } = fixture();
  try {
    monitor.options.exclusions = 'monitor';
    await monitor.start('screen:1'); await wait(10);
    assert.equal(monitor.state, 'excluded'); assert.equal(counts().scans, 0);
  } finally { monitor.shutdown(); }
});

test('context bounds speech, screenshots and history, expires stale screen content', () => {
  const context = new LiveContext(); context.setScreen({ name: 'Browser', text: 'screen text' });
  for (let i = 0; i < 100; i++) context.addTranscript(`transcript ${i}`);
  let prompt = JSON.parse(context.prompt('question')); assert.equal(context.transcripts.length, 12);
  assert.equal(prompt.screen.text, 'screen text'); assert.match(prompt.recentSpeech, /99/);
  context.screen.at = Date.now() - 31000; prompt = JSON.parse(context.prompt('question')); assert.equal(prompt.screen, null);
  context.clear(); assert.equal(context.screen, null);
});

test('extended unchanged-frame monitoring stays bounded with one OCR pass', async () => {
  const { monitor, counts } = fixture();
  try {
    monitor.state = 'running'; monitor.sourceId = 'screen:1';
    for (let i = 0; i < 300; i++) { await monitor.tick(); clearTimeout(monitor.timer); }
    assert.equal(counts().scans, 1); assert.equal(counts().requests, 0);
    assert.equal(monitor.context.answers.length, 0); assert.equal(monitor.previous.length, 400);
  } finally { monitor.shutdown(); }
});
