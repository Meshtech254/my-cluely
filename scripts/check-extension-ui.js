// Loads the actual unpacked extension in a disposable browser profile; no registry changes.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert/strict');
const http = require('http');
(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'opencluely-extension-ui-'));
  const extension = path.join(profile, 'extension');
  fs.cpSync(path.resolve(__dirname, '../browser-extension'), extension, { recursive: true });
  // Fixture-only host grant substitutes for the toolbar's activeTab user gesture in headless tests.
  const manifestPath = path.join(extension, 'manifest.json'); const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.host_permissions = ['http://127.0.0.1/*']; fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  let submissions = 0;
  const server = http.createServer((req, res) => { if (req.url === '/submitted') submissions++; res.setHeader('Content-Type', 'text/html'); res.end(fs.readFileSync(path.join(__dirname, '../test/fixtures', req.url === '/shop' ? 'agent-shop.html' : 'agent-form.html'))); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let context;
  try {
    const options = { headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] };
    try { context = await chromium.launchPersistentContext(profile, options); }
    catch (error) { if (!/Executable doesn't exist/.test(error.message)) throw error; context = await chromium.launchPersistentContext(profile, { ...options, channel: 'msedge' }); }
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 10000 });
    const id = new URL(worker.url()).hostname;
    const popup = await context.newPage(); await popup.goto(`chrome-extension://${id}/popup.html`);
    assert.equal(await popup.locator('#id').textContent(), id);
    await popup.waitForFunction(() => document.getElementById('status').textContent.includes('Disconnected'));
    const page = await context.newPage(); await page.goto(origin); await page.bringToFront();
    await page.evaluate(() => { window.inputEvents = []; document.querySelector('input[name=name]').addEventListener('input', event => inputEvents.push({ value: event.target.value, trusted: event.isTrusted })); });
    await worker.evaluate(async ({ origin }) => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      selected = { id: tab.id, url: tab.url, title: tab.title };
      await perform({ op: 'start', args: { origin, session: 'fixture', typingDelay: 30 } });
    }, { origin });
    const inspect = await worker.evaluate(() => perform({ op: 'inspect', args: { session: 'fixture' } }));
    assert.ok(inspect.fields.some(f => f.label === 'Full name'));
    const value = 'Alex Fictional Example';
    const type = worker.evaluate(value => perform({ op: 'action', args: { session: 'fixture', confirmed: true, action: { name: 'fill_field', args: { label: 'Full name', value, sourceQuote: 'USER' } } } }), value);
    await page.waitForFunction(() => document.querySelector('input[name=name]').value.length >= 3);
    await worker.evaluate(() => { paused = true; }); await new Promise(resolve => setTimeout(resolve, 80));
    const partial = await page.getByLabel('Full name', { exact: true }).inputValue();
    assert.ok(partial.length < value.length, 'Typing must expose partial text in real time');
    await new Promise(resolve => setTimeout(resolve, 120)); assert.equal(await page.getByLabel('Full name', { exact: true }).inputValue(), partial);
    await worker.evaluate(() => { paused = false; }); await type;
    assert.equal(await page.getByLabel('Full name', { exact: true }).inputValue(), value);
    assert.ok((await page.evaluate(() => window.inputEvents)).every(e => e.trusted));
    const performAction = action => worker.evaluate(action => perform({ op: 'action', args: { session: 'fixture', confirmed: true, action } }), action);
    await performAction({ name: 'select_option', args: { label: 'Country', value: 'KE' } });
    await performAction({ name: 'toggle_checkbox', args: { label: 'Remote work', checked: true } });
    assert.equal(await page.getByLabel('Country', { exact: true }).inputValue(), 'KE'); assert.ok(await page.getByLabel('Remote work', { exact: true }).isChecked());
    await assert.rejects(performAction({ name: 'fill_field', args: { label: 'Password', value: 'never enter' } }), /Protected/);
    await assert.rejects(performAction({ name: 'open_url', args: { url: 'https://example.org/' } }), /outside/);
    await assert.rejects(worker.evaluate(() => perform({ op: 'action', args: { session: 'fixture', confirmed: false, action: { name: 'click_element', args: { label: 'Submit application', role: 'button' } } } })), /approval/);
    await performAction({ name: 'compose_text', args: { label: 'Message body', value: 'Thank you for the update.' } });
    assert.equal(await page.getByRole('textbox', { name: 'Message body', exact: true }).textContent(), 'Thank you for the update.');
    const cancelled = performAction({ name: 'fill_field', args: { label: 'Full name', value: 'This fictional text should stop partway through' } });
    const rejected = assert.rejects(cancelled, /stopped|session|detached|closed|cancel/i);
    await page.waitForFunction(() => document.querySelector('input[name=name]').value.startsWith('This'));
    await worker.evaluate(() => cancel()); await rejected;
    const stopped = await page.getByLabel('Full name', { exact: true }).inputValue(); await new Promise(resolve => setTimeout(resolve, 150));
    assert.equal(await page.getByLabel('Full name', { exact: true }).inputValue(), stopped); assert.equal(submissions, 0);
    assert.equal(await page.locator('[data-opencluely-overlay]').count(), 0, 'Stopping removes the pointer');
    await page.goto(`${origin}/shop`); await page.bringToFront();
    await worker.evaluate(async origin => perform({ op: 'start', args: { origin, session: 'shop', typingDelay: 30 } }), origin);
    const shopAction = action => worker.evaluate(action => perform({ op: 'action', args: { session: 'shop', confirmed: true, action } }), action);
    const shopState = await worker.evaluate(() => perform({ op: 'inspect', args: { session: 'shop' } }));
    const products = shopState.fields.filter(f => f.label === 'Add to cart');
    assert.equal(products.length, 2); assert.notEqual(products[0].ref, products[1].ref);
    const keyboard = products.find(f => f.context.includes('Example keyboard'));
    assert.ok(keyboard);
    await assert.rejects(shopAction({ name: 'click_element', args: { label: 'Add to cart', role: 'button' } }), /ambiguous/);
    await shopAction({ name: 'click_element', args: { label: keyboard.label, role: keyboard.role, ref: keyboard.ref } });
    assert.equal(await page.locator('#cart').textContent(), 'Cart: keyboard');
    assert.deepEqual(await page.evaluate(() => clicks), [{ product: 'keyboard', trusted: true }]);
    assert.equal(await page.locator('[data-opencluely-overlay]').count(), 1);
    const moves = await page.evaluate(() => moves);
    assert.ok(moves.length >= 10 && moves.every(m => m.trusted));
    assert.ok(new Set(moves.map(m => `${m.x},${m.y}`)).size >= 8, 'Pointer moves along a visible path');
    const search = shopState.fields.find(f => f.label === 'Search products');
    await shopAction({ name: 'fill_field', args: { label: search.label, ref: search.ref, value: 'Example keyboard', sourceQuote: 'USER' } });
    assert.equal(await page.getByLabel('Search products').inputValue(), 'Example keyboard');
    fs.mkdirSync(path.resolve(__dirname, '../tmp'), { recursive: true });
    await page.screenshot({ path: path.resolve(__dirname, '../tmp/extension-shopping-proof.png') });
    const beforeScroll = await worker.evaluate(() => perform({ op: 'inspect', args: { session: 'shop' } }));
    const afterScroll = await shopAction({ name: 'scroll', args: { delta: 650 } });
    assert.ok(afterScroll.viewport.y > beforeScroll.viewport.y);
    assert.notEqual(afterScroll.viewport.text, beforeScroll.viewport.text);
    assert.ok(!afterScroll.structure.includes('OpenCluely'), 'Pointer overlay is excluded from inspection');
    await worker.evaluate(() => cancel());
    assert.equal(await page.locator('[data-opencluely-overlay]').count(), 0);
    // Exercise the task service's automatic authorization against the real MV3 worker.
    await page.goto(`${origin}/shop`); await page.bringToFront();
    const Automation = require('../src/services/automation.service');
    const { ExtensionBrowser } = require('../src/services/extension-bridge');
    const bridge = {
      selection: { url: `${origin}/shop` },
      request: (op, args) => worker.evaluate(message => perform(message), { op, args }),
      cancel: () => { worker.evaluate(() => cancel()).catch(() => {}); }
    };
    let step = 0; const autoStates = [];
    const agent = new Automation({ knowledge: { list: () => [] }, extensionFactory: options => new ExtensionBrowser(bridge, options),
      emit: state => autoStates.push(state.state),
      planner: async ({ state, autoApprove }) => {
        assert.equal(autoApprove, true);
        if (step++ === 0) {
          const field = state.fields.find(f => f.label === 'Search products');
          return { action: { name: 'fill_field', args: { label: field.label, ref: field.ref, value: 'Example keyboard', sourceQuote: 'USER' } }, tokens: 10 };
        }
        if (step === 2) {
          const product = state.fields.find(f => f.label === 'Add to cart' && f.context.includes('Example keyboard'));
          return { action: { name: 'click_element', args: { label: product.label, role: product.role, ref: product.ref } }, tokens: 10 };
        }
        assert.match(state.structure, /Cart: keyboard/);
        return { action: { name: 'stop_task', args: { summary: 'Keyboard added to cart', missing: [] } }, tokens: 10 };
      } });
    await agent.start({ instruction: 'Search Example keyboard and add it to cart. Stop before checkout.', mode: 'auto', autoApprove: true, target: 'extension', url: `${origin}/shop`, typingDelay: 15, durationMinutes: 30 });
    await agent.running;
    assert.equal(agent.state, 'completed', agent.summary);
    assert.ok(!autoStates.includes('awaiting_approval'));
    assert.equal(await page.locator('#cart').textContent(), 'Cart: keyboard');
    assert.deepEqual(await page.evaluate(() => clicks), [{ product: 'keyboard', trusted: true }]);
    console.log('Actual MV3 extension passed: popup, inspect, trusted paced typing, pause/resume, dropdown, checkbox, scope, protected fields, approval and mid-typing cancellation. No submission.');
    console.log('Shopping fixture passed: duplicate product references, trusted Add to cart click, visible pointer path, search typing, viewport progress and pointer cleanup.');
    console.log('Auto approve task completed search and Add to cart through the real extension without any approval gate.');
  } finally { await context?.close(); await new Promise(resolve => server.close(resolve)); fs.rmSync(profile, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
