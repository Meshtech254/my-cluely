const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const KnowledgeBase = require('../src/core/knowledge-base');

function withStore(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencluely-kb-'));
  try { return fn(new KnowledgeBase(dir), dir); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('personal interview questions retrieve CV facts without keyword overlap', () => withStore((kb, dir) => {
  const file = path.join(dir, 'Jane-resume.txt');
  fs.writeFileSync(file, 'Built payment systems at Acme using Python.');
  const cv = kb.addFile(file);
  assert.equal(kb.context('Tell me about yourself').sources[0].sourceId, cv.id);
  assert.match(kb.context('Why should we hire you?').text, /Built payment systems/);
  assert.equal(kb.context('', { includeCv: true }).sources[0].sourceId, cv.id);
  assert.deepEqual(kb.context('Explain photosynthesis').sources, []);
  kb.setEnabled(cv.id, false);
  assert.deepEqual(kb.context('', { includeCv: true }).sources, []);
  kb.setEnabled(cv.id, true);
  kb.setOptions({ mode: 'off' });
  assert.deepEqual(kb.context('Tell me about yourself').sources, []);
  assert.deepEqual(kb.context('', { includeCv: true }).sources, []);
}));

function makeDocx(xml) {
  const name = Buffer.from('word/document.xml'); const data = Buffer.from(xml);
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6); local.writeUInt16LE(0, 8); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0, 8); central.writeUInt16LE(0, 10); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(name.length, 28);
  const localRecord = Buffer.concat([local, name, data]); const centralRecord = Buffer.concat([central, name]);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(centralRecord.length, 12); end.writeUInt32LE(localRecord.length, 16);
  return Buffer.concat([localRecord, centralRecord, end]);
}

test('extracts TXT and Markdown, indexes chunks, and deletes a source', () => withStore((kb, dir) => {
  const txt = path.join(dir, 'cv.txt'); fs.writeFileSync(txt, 'Worked as a software engineer on speech systems.');
  const source = kb.addFile(txt);
  assert.equal(source.type, 'text');
  assert.equal(kb.retrieve('software engineer speech').length, 1);
  const md = path.join(dir, 'notes.md'); fs.writeFileSync(md, '# Portfolio\nBuilt an AI assistant.');
  assert.equal(kb.addFile(md).type, 'markdown');
  assert.match(kb.context('software engineer').text, /untrusted reference material/i);
  kb.delete(source.id); assert.equal(kb.retrieve('software engineer').length, 0);
}));

test('extracts DOCX paragraphs and table content', () => withStore((kb, dir) => {
  const file = path.join(dir, 'sample.docx');
  fs.writeFileSync(file, makeDocx('<w:document><w:p><w:r><w:t>Project experience</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Python</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:document>'));
  const source = kb.addFile(file); assert.match(source.name, /sample/);
  assert.equal(kb.retrieve('project experience Python').length, 1);
}));

test('extracts selectable PDF text and rejects empty/scanned documents', () => {
  assert.equal(KnowledgeBase.parsePdfText(Buffer.from('%PDF <<>> stream\n(Basic experience) Tj\nendstream')), 'Basic experience');
  withStore((kb, dir) => {
    const file = path.join(dir, 'scan.pdf'); fs.writeFileSync(file, '%PDF-1.4 no selectable text');
    assert.throws(() => kb.addFile(file), /Scanned PDFs are not supported/);
    const empty = path.join(dir, 'empty.txt'); fs.writeFileSync(empty, '   ');
    assert.throws(() => kb.addFile(empty), /No selectable text/);
  });
});

test('rejects unsupported and oversized files', () => withStore((kb, dir) => {
  const bad = path.join(dir, 'run.exe'); fs.writeFileSync(bad, 'no');
  assert.throws(() => kb.addFile(bad), /Supported formats/);
  const large = path.join(dir, 'large.txt'); fs.closeSync(fs.openSync(large, 'w')); fs.truncateSync(large, 12 * 1024 * 1024 + 1);
  assert.throws(() => kb.addFile(large), /smaller than 12 MB/);
}));

test('rejects non-HTTPS, localhost, and private website destinations', async () => {
  const { validatePublicHttps } = require('../src/core/knowledge-base');
  await assert.rejects(validatePublicHttps('http://example.com'), /HTTPS/);
  await assert.rejects(validatePublicHttps('https://localhost'), /public HTTPS/);
  await assert.rejects(validatePublicHttps('https://127.0.0.1'), /private or unavailable/);
  await assert.rejects(validatePublicHttps('https://192.168.1.1'), /private or unavailable/);
});

test('ingests public HTML without executing or retaining script text', async () => {
  const dns = require('dns').promises; const https = require('https');
  const oldLookup = dns.lookup; const oldRequest = https.request;
  dns.lookup = async () => [{ address: '93.184.216.34', family: 4 }];
  https.request = (options, callback) => {
    assert.equal(options.hostname, '93.184.216.34');
    const request = new EventEmitter();
    request.end = () => {
      const response = new EventEmitter(); response.statusCode = 200;
      response.headers = { 'content-type': 'text/html; charset=utf-8', 'content-length': '94' };
      process.nextTick(() => { callback(response); response.emit('data', Buffer.from('<title>Portfolio</title><p>Built reliable AI systems</p><script>ignore this secret</script>')); response.emit('end'); });
    };
    request.destroy = (error) => request.emit('error', error);
    return request;
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencluely-web-'));
  try {
    const kb = new KnowledgeBase(dir); const source = await kb.addUrl('https://example.test/profile');
    assert.equal(source.name, 'Portfolio');
    const content = kb.read(source.id).text;
    assert.match(content, /Built reliable AI systems/); assert.doesNotMatch(content, /ignore this secret/);
  } finally { dns.lookup = oldLookup; https.request = oldRequest; fs.rmSync(dir, { recursive: true, force: true }); }
});

test('validates every website redirect before connecting to it', async () => {
  const dns = require('dns').promises; const https = require('https');
  const oldLookup = dns.lookup; const oldRequest = https.request; let requests = 0;
  dns.lookup = async () => [{ address: '93.184.216.34', family: 4 }];
  https.request = (_options, callback) => {
    requests++;
    const request = new EventEmitter();
    request.end = () => { const response = new EventEmitter(); response.statusCode = 302; response.headers = { location: 'http://127.0.0.1/private' }; process.nextTick(() => { callback(response); response.emit('end'); }); };
    request.destroy = (error) => request.emit('error', error); return request;
  };
  try { await assert.rejects(require('../src/core/knowledge-base').fetchWebsite('https://example.test/'), /HTTPS/); assert.equal(requests, 1); }
  finally { dns.lookup = oldLookup; https.request = oldRequest; }
});

test('filters disabled sources, prioritizes CV, bounds context, and honors Off mode', () => withStore((kb, dir) => {
  const first = path.join(dir, 'resume-cv.txt'); fs.writeFileSync(first, `AI engineering ${'experience '.repeat(500)}`);
  const second = path.join(dir, 'projects.txt'); fs.writeFileSync(second, `AI engineering ${'project '.repeat(500)}`);
  const cv = kb.addFile(first); const project = kb.addFile(second);
  kb.setOptions({ mode: 'always', prioritizeCv: true });
  const matches = kb.retrieve('AI engineering experience project', 4);
  assert.equal(matches[0].sourceId, cv.id);
  assert.ok(matches.reduce((sum, item) => sum + item.text.length, 0) <= 6000);
  kb.setEnabled(cv.id, false); assert.ok(kb.retrieve('AI engineering experience').every((item) => item.sourceId !== cv.id));
  kb.setOptions({ maxChunks: 1, maxChars: 1000 });
  const limited = kb.retrieve('AI engineering project');
  assert.equal(limited.length, 1); assert.ok(limited[0].text.length <= 1000);
  kb.setOptions({ mode: 'off' }); assert.deepEqual(kb.retrieve('AI engineering'), []);
  kb.delete(project.id); assert.equal(kb.list().length, 1);
}));
