const test = require('node:test');
const assert = require('node:assert/strict');
const { promptLoader } = require('../prompt-loader');
const llm = require('../src/services/llm.service');

function service() {
  return Object.assign(Object.create(Object.getPrototypeOf(llm)), {
    isInitialized: true, requestCount: 0, errorCount: 0
  });
}

test('general assistance is available without injecting a programming language', () => {
  assert.deepEqual(promptLoader.getAvailableSkills(), ['general', 'dsa']);
  assert.equal(promptLoader.requiresProgrammingLanguage('general'), false);
  assert.equal(promptLoader.requiresProgrammingLanguage('dsa'), true);
  const prompt = promptLoader.getSkillPrompt('general', 'cpp');
  assert.match(prompt, /general-purpose assistant/);
  assert.match(prompt, /Give the final answer or completed solution first/);
  assert.match(prompt, /correct option label and its answer text/);
  assert.match(prompt, /section titled "What to say"/);
  assert.match(prompt, /Never invent employers/);
  assert.doesNotMatch(prompt, /IMPLEMENTATION LANGUAGE/);
  assert.match(promptLoader.getSkillPrompt('dsa', 'cpp'), /IMPLEMENTATION LANGUAGE: C\+\+/);
});

test('typed questions and follow-ups retain their intent and conversation context', () => {
  const assistant = service();
  const question = 'Explain the meaning of this French sentence';
  const request = assistant.buildGeminiRequestWithHistory(question, 'general', [
    { role: 'user', content: 'Bonjour tout le monde' },
    { role: 'model', content: 'Hello everyone' }
  ], { skillPrompt: promptLoader.getSkillPrompt('general') }, null);
  assert.match(request.systemInstruction.parts[0].text, /language, reading, writing/);
  assert.match(request.systemInstruction.parts[0].text, /Give the final answer or completed solution first/);
  assert.equal(request.contents[0].parts[0].text, 'Bonjour tout le monde');
  assert.equal(request.contents[1].role, 'model');
  assert.equal(request.contents[2].parts[0].text, question);
});

test('voice assistance answers across subjects even when DSA focus is selected', () => {
  const assistant = service();
  for (const skill of ['general', 'dsa']) {
    const prompt = assistant.getIntelligentTranscriptionPrompt(skill, 'cpp');
    assert.match(prompt, /general-purpose assistant/);
    assert.match(prompt, /Give the final answer or completed solution first/);
    assert.doesNotMatch(prompt, /Ask your question relevant to|NOT related to|Respond ONLY in/);
  }
  const request = assistant.buildIntelligentTranscriptionRequestWithHistory(
    'Help me write a polite reply', 'general', [], {}, null
  );
  assert.equal(request.contents[0].parts[0].text, 'Help me write a polite reply');
  assert.match(request.systemInstruction.parts[0].text, /speech transcript/);
});

for (const streamed of [false, true]) {
  test(`${streamed ? 'streamed' : 'non-streamed'} screenshots use general vision instructions and preserve image bytes`, async () => {
    const assistant = service();
    let captured;
    assistant.executeRequest = assistant.executeAlternativeRequest = async request => {
      captured = request;
      return 'This chart shows increasing rainfall.';
    };
    assistant.executeStreamingRequest = async (request, onDelta) => {
      captured = request;
      onDelta('This chart shows increasing rainfall.');
      return 'This chart shows increasing rainfall.';
    };
    for (const translate of [false, true]) {
      const image = Buffer.from('test-image');
      const cv = '[1] cv.txt\nBuilt payment systems at Acme using Python.';
      const result = streamed
        ? await assistant.processImageWithSkillStream(image, 'image/png', 'general', [], null, () => {}, translate, cv)
        : await assistant.processImageWithSkill(image, 'image/png', 'general', [], null, translate, cv);
      assert.equal(result.response, 'This chart shows increasing rainfall.');
      assert.match(captured.systemInstruction.parts[0].text, /general-purpose assistant/);
      assert.match(captured.systemInstruction.parts[0].text, /What to say/);
      assert.match(captured.systemInstruction.parts[0].text, /Built payment systems at Acme/);
      assert.match(captured.systemInstruction.parts[0].text, /untrusted evidence/);
      assert.match(captured.contents[0].parts[0].text, /Give the final answer or completed solution first/);
      assert.match(captured.contents[0].parts[0].text, /correct option label and answer text/);
      assert.doesNotMatch(captured.contents[0].parts[0].text, /final code|do not.*solve/i);
      assert.equal(captured.contents[0].parts[1].inlineData.data, image.toString('base64'));
      if (translate) {
        assert.match(captured.systemInstruction.parts[0].text, /any language into English/);
        assert.match(captured.systemInstruction.parts[0].text, /still requires solving visible questions/);
      }
    }
  });
}
