const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { requestAutomation, retryDelay } = require('../src/services/automation-request');

test('temporary HTTP 503 responses recover against a real local server without replaying actions', async () => {
  let requests = 0; const delays = [], progress = [];
  const server = http.createServer((_req, res) => {
    requests++;
    res.writeHead(requests < 3 ? 503 : 200, { 'Content-Type': 'application/json', 'Retry-After': '2' });
    res.end(JSON.stringify(requests < 3 ? { error: 'unavailable' } : { plan: 'ready' }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const data = await requestAutomation(`http://127.0.0.1:${server.address().port}`, { method: 'POST', body: '{}', signal: AbortSignal.timeout(5000) }, {
      sleep: async ms => delays.push(ms), onRetry: event => progress.push(event)
    });
    assert.deepEqual(data, { plan: 'ready' }); assert.equal(requests, 3);
    assert.deepEqual(delays, [2000, 3000]); assert.deepEqual(progress.map(p => p.attempt), [2, 3]);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('persistent service failure stops after four attempts and does not blame the API key', async () => {
  const original = global.fetch; let requests = 0;
  try {
    global.fetch = async () => { requests++; return new Response('private upstream detail', { status: 503 }); };
    await assert.rejects(requestAutomation('https://provider.invalid', {}, { sleep: async () => {} }), error => {
      assert.equal(error.code, 'AI_UNAVAILABLE'); assert.match(error.message, /after 4 attempts/);
      assert.doesNotMatch(error.message, /API key|private upstream detail/); return true;
    });
    assert.equal(requests, 4);
  } finally { global.fetch = original; }
});

test('authentication and model errors do not retry; rate limits have separate guidance', async () => {
  const original = global.fetch;
  try {
    for (const [status, code, expected] of [[401, 'AI_AUTH_ERROR', 1], [403, 'AI_AUTH_ERROR', 1], [404, 'AI_MODEL_NOT_FOUND', 1], [429, 'AI_RATE_LIMITED', 4]]) {
      let requests = 0;
      global.fetch = async () => { requests++; return new Response('{}', { status }); };
      await assert.rejects(requestAutomation('https://provider.invalid', {}, { sleep: async () => {} }), error => error.code === code);
      assert.equal(requests, expected);
    }
  } finally { global.fetch = original; }
});

test('Stop cancels the retry wait immediately without another provider request', async () => {
  const original = global.fetch; const abort = new AbortController(); let requests = 0;
  try {
    global.fetch = async () => { requests++; return new Response('{}', { status: 503 }); };
    await assert.rejects(requestAutomation('https://provider.invalid', { signal: abort.signal }, {
      userSignal: abort.signal, onRetry: () => abort.abort(new Error('Stopped by user'))
    }), /Stopped by user/);
    assert.equal(requests, 1);
  } finally { global.fetch = original; }
});

test('the shared request timeout bounds Retry-After waits and preserves outage guidance', async () => {
  const original = global.fetch; let requests = 0;
  try {
    global.fetch = async () => { requests++; return new Response('{}', { status: 503, headers: { 'Retry-After': '120' } }); };
    await assert.rejects(requestAutomation('https://provider.invalid', { signal: AbortSignal.timeout(25) }), error => error.code === 'AI_UNAVAILABLE');
    assert.equal(requests, 1);
    assert.equal(retryDelay('4', 0), 4000); assert.equal(retryDelay('invalid', 1), 3000);
    const dateDelay = retryDelay(new Date(Date.now() + 20000).toUTCString(), 0);
    assert.ok(dateDelay >= 18000 && dateDelay <= 20000);
  } finally { global.fetch = original; }
});
