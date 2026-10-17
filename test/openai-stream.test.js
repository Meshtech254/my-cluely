const test = require('node:test');
const after = require('node:test').after;
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencluely-llm-'));
process.env.OPENCLUELY_DATA_DIR = dataDir;
const llm = require('../src/services/llm.service');
llm.provider = 'openai'; llm.model = 'gpt-test'; process.env.OPENAI_API_KEY = 'test-key-not-real';
llm.isInitialized = true;

function sseResponse(text) {
  const frame = `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`;
  return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(frame)); controller.close(); } }), { status: 200 });
}

test('typed and Whisper transcript pipelines preserve streamed OpenAI responses', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(options.headers.Authorization, 'Bearer test-key-not-real');
    assert.equal(body.model, 'gpt-test'); assert.equal(body.stream, true);
    assert.match(body.messages[0].content, /untrusted evidence/i);
    return sseResponse('grounded reply');
  };
  try {
    llm.buildGeminiRequest = (text) => ({ contents: [{ role: 'user', parts: [{ text }] }] });
    llm.buildIntelligentTranscriptionRequest = (text) => ({ contents: [{ role: 'user', parts: [{ text }] }] });
    let typedDelta = '';
    const typed = await llm.processTextWithSkillStream('typed question', 'general', [], null, (d) => typedDelta += d, '[1] local fact');
    assert.equal(typed.response, 'grounded reply'); assert.equal(typedDelta, typed.response);
    let voiceDelta = '';
    const voice = await llm.processTranscriptionWithIntelligentResponseStream('spoken follow-up', 'general', [], null, (d) => voiceDelta += d, '[1] local fact');
    assert.equal(voice.response, 'grounded reply'); assert.equal(voiceDelta, voice.response);
  } finally { global.fetch = originalFetch; }
});

test('maps screenshot image parts into OpenAI vision message format', () => {
  const messages = llm.toOpenAIMessages({
    systemInstruction: { parts: [{ text: 'System prompt' }] },
    contents: [{ role: 'user', parts: [{ text: 'Describe this' }, { inlineData: { mimeType: 'image/png', data: 'YWJj' } }] }]
  });
  assert.equal(messages[0].role, 'system');
  assert.equal(messages[1].content[1].image_url.url, 'data:image/png;base64,YWJj');
});

after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
