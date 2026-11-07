const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');
const Browser = require('../src/services/automation-browser');
const Automation = require('../src/services/automation.service');
const Knowledge = require('../src/core/knowledge-base');
const os = require('os');
const call = (name, args = {}) => ({ name, args });
test('real browser E2E: fictional CV → inspect → fill → select → checkbox → missing → review without submit', async () => {
  let submissions = 0;
  const server = http.createServer((req, res) => {
    if (req.url === '/submitted') submissions++;
    res.setHeader('Content-Type', 'text/html'); res.end(fs.readFileSync(path.join(__dirname, 'fixtures/agent-form.html')));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'opencluely-agent-'));
  const knowledge = new Knowledge(directory);
  fs.writeFileSync(path.join(directory, 'sample-cv.txt'), 'Full name: Alex Example\nEmail: alex@example.test\nCountry: Kenya');
  const profile = await knowledge.addFile(path.join(directory, 'sample-cv.txt'));
  const browser = new Browser({ headless: true });
  const plans = [call('inspect_page'), call('fill_field', { label: 'Full name', value: 'Alex Example', sourceQuote: 'Full name: Alex Example' }), call('fill_field', { label: 'Email', value: 'alex@example.test', sourceQuote: 'Email: alex@example.test' }), call('select_option', { label: 'Country', value: 'KE' }), call('toggle_checkbox', { label: 'Remote work', checked: true }), call('fill_field', { label: 'Certificate number', value: 'UNKNOWN', sourceQuote: 'not present' }), call('stop_task', { summary: 'Ready for review. Not submitted.', missing: ['Certificate number'] })];
  const agent = new Automation({ knowledge, browserFactory: () => browser, planner: async request => {
    assert.ok(request.state.fields); assert.match(request.knowledge, /Alex Example/);
    return { action: plans.shift(), tokens: 100 };
  }, emit: state => { if (state.state === 'awaiting_approval') setImmediate(() => agent.approve(true)); } });
  try {
    await agent.start({ instruction: 'Fill using CV, remote work enabled; leave ready for review', mode: 'auto', target: 'browser', url: origin, profileId: profile.id }); await agent.running;
    assert.equal(agent.state, 'completed', agent.summary);
    assert.equal(await browser.page.getByLabel('Full name', { exact: true }).inputValue(), 'Alex Example');
    assert.equal(await browser.page.getByLabel('Email', { exact: true }).inputValue(), 'alex@example.test');
    assert.equal(await browser.page.getByLabel('Country', { exact: true }).inputValue(), 'KE');
    assert.equal(await browser.page.getByLabel('Remote work', { exact: true }).isChecked(), true);
    assert.equal(await browser.page.getByLabel('Certificate number', { exact: true }).inputValue(), '');
    assert.equal(submissions, 0); assert.equal(agent.fields.length, 4);
    await browser.execute(call('click_element', { label: 'Show more', role: 'button' }), true);
    await browser.execute(call('wait_for_element', { label: 'Portfolio' }));
    await browser.execute(call('fill_field', { label: 'Portfolio', value: 'https://example.test/alex', sourceQuote: 'USER' }));
    await browser.execute(call('press_key', { key: 'Tab' }), true);
    await assert.rejects(browser.execute(call('fill_field', { label: 'Password', value: 'never', sourceQuote: 'USER' })), /Protected/);
    await assert.rejects(browser.execute(call('open_url', { url: 'https://example.org/' }), true), /outside/);
    await browser.execute(call('scroll', { delta: 200 }));
    assert.ok((await browser.screenshot()).length > 100);
    await browser.execute(call('open_url', { url: origin + '/again' }), true);
    await assert.rejects(browser.execute(call('click_element', { label: 'Submit application', role: 'button' })), /approval|send data/i);
    const sent = await browser.page.evaluate(async () => {
      try { await fetch('/submitted', { method: 'POST', body: 'fictional data' }); return true; } catch (_) { return false; }
    });
    assert.equal(sent, false); assert.match(browser.blocked, /approval/i);
    assert.equal(submissions, 0);
  } finally { agent.stop(); await browser.close(); await new Promise(resolve => server.close(resolve)); fs.rmSync(directory, { recursive: true, force: true }); }
});
