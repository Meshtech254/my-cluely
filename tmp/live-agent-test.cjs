const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const assert = require('node:assert/strict');
const electron = require('electron');
if (typeof electron === 'string') {
  const { spawn } = require('node:child_process');
  const testProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-live-agent-'));
  const childEnv = { ...process.env, OPENCLUELY_LIVE_TEST_PROFILE: testProfile }; delete childEnv.ELECTRON_RUN_AS_NODE;
  const child = spawn(electron, [__filename], { env: childEnv, stdio: 'inherit', windowsHide: true });
  child.on('error', error => { console.error(error.message); process.exitCode = 1; });
  child.on('exit', code => {
    process.exitCode = code || 0;
    const resolved = path.resolve(testProfile), temporaryRoot = path.resolve(os.tmpdir()) + path.sep;
    if (!resolved.startsWith(temporaryRoot)) throw new Error('Unexpected temporary profile path');
    fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
} else {
const { app } = electron;
const root = path.resolve(__dirname, '..');
const credentials = path.join(process.env.APPDATA, 'opencluely', '.env');
const env = require('dotenv').parse(fs.readFileSync(credentials));
for (const key of ['LLM_PROVIDER', 'GEMINI_API_KEY', 'OPENAI_API_KEY', 'OPENAI_MODEL']) if (env[key]) process.env[key] = env[key];
const profile = process.env.OPENCLUELY_LIVE_TEST_PROFILE;
const electronData = path.join(profile, 'electron'); fs.mkdirSync(electronData, { recursive: true });
app.setPath('userData', electronData); app.disableHardwareAcceleration();
for (const name of ['Local State', 'secrets.json']) fs.copyFileSync(path.join(process.env.APPDATA, 'opencluely', name), path.join(electronData, name));
app.whenReady().then(async () => {
new (require('../src/core/secret-store'))().load();
process.env.OPENCLUELY_DATA_DIR = path.join(profile, 'app-data');
const llm = require('../src/services/llm.service');
const Automation = require('../src/services/automation.service');
const { ExtensionBrowser } = require('../src/services/extension-bridge');
const { chromium } = require('playwright');
const report = { provider: llm.provider, model: llm.model, liveProvider: true, states: [], plans: 0, retries: 0 };
let context, agent;
const server = http.createServer((_req, res) => {
  res.setHeader('Content-Type', 'text/html'); res.end(fs.readFileSync(path.join(root, 'test/fixtures/agent-shop.html')));
});

await (async () => {
  try {
    assert.ok(llm.isInitialized, 'AI provider is not configured');
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const extension = path.join(profile, 'extension'); fs.cpSync(path.join(root, 'browser-extension'), extension, { recursive: true });
    const manifestPath = path.join(extension, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath)); manifest.host_permissions = ['http://127.0.0.1/*'];
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    const options = { headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] };
    const browserProfile = path.join(profile, 'browser');
    try { context = await chromium.launchPersistentContext(browserProfile, options); }
    catch (error) { if (!/Executable doesn't exist/.test(error.message)) throw error; context = await chromium.launchPersistentContext(browserProfile, { ...options, channel: 'msedge' }); }
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 10000 });
    const page = await context.newPage(); await page.goto(origin + '/shop'); await page.bringToFront();
    await worker.evaluate(async () => { const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); selected = { id: tab.id, url: tab.url, title: tab.title }; });
    const bridge = { selection: { url: origin + '/shop' }, request: (op, args) => worker.evaluate(message => perform(message), { op, args }),
      cancel: () => { worker.evaluate(() => cancel()).catch(() => {}); } };
    let previous = '';
    agent = new Automation({ knowledge: { list: () => [] }, extensionFactory: options => new ExtensionBrowser(bridge, options), limits: { actions: 12, tokens: 100000, timeout: 120000 },
      planner: async request => { report.plans++; return llm.planAutomation(request); },
      emit: state => {
        report.states.push(state.state);
        const latest = state.log.at(-1);
        if (latest && latest !== previous) { previous = latest; console.log(latest); if (/Retrying/.test(latest)) report.retries++; }
      } });
    console.log(JSON.stringify({ event: 'live_test_started', provider: report.provider, model: report.model }));
    await agent.start({ instruction: 'Search for Example keyboard by typing Example keyboard into Search products. Then add exactly one Example keyboard priced 3000 to the cart. Do not add headphones. Verify that Cart: keyboard is visible and stop. Do not checkout.',
      mode: 'auto', autoApprove: true, target: 'extension', url: origin + '/shop', durationMinutes: 30, typingDelay: 25 });
    await agent.running;
    report.state = agent.state; report.error = agent.error; report.summary = agent.summary; report.actions = agent.actions;
    report.cart = await page.locator('#cart').textContent(); report.search = await page.getByLabel('Search products').inputValue();
    report.clicks = await page.evaluate(() => clicks); report.pointerEvents = await page.evaluate(() => moves.length);
    report.approvalPrompts = report.states.filter(state => state === 'awaiting_approval').length;
    await page.screenshot({ path: path.join(__dirname, 'live-agent-proof.png') });
    assert.equal(agent.state, 'completed', agent.summary);
    assert.equal(report.cart, 'Cart: keyboard'); assert.equal(report.search, 'Example keyboard');
    assert.deepEqual(report.clicks, [{ product: 'keyboard', trusted: true }]); assert.equal(report.approvalPrompts, 0);
    report.success = true;
  } catch (error) {
    report.success = false; report.failure = error.diagnosticReason || (error.code ? `${error.code}: ${error.message}` : error.message);
    process.exitCode = 1;
  } finally {
    agent?.stop(); await context?.close();
    if (server.listening) await new Promise(resolve => server.close(resolve));
    // Credentials are never written to this report or printed.
    delete report.states;
    fs.writeFileSync(path.join(__dirname, 'live-agent-report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  }
})();
app.exit(process.exitCode || 0);
}).catch(error => { console.error(error.diagnosticReason || error.message); app.exit(1); });
}
