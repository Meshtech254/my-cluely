const { scopedUrl, sensitive, needsApproval, agentError } = require('./automation-policy');
const { pageAction } = require('../../browser-extension/page');
class AutomationBrowser {
  constructor({ headless = false, typingDelay = 65, diagnostic = () => {}, browserType } = {}) { this.headless = headless; this.typingDelay = typingDelay; this.diagnostic = diagnostic; this.browserType = browserType; this.navigationCount = 0; }
  async start(url, signal) {
    this.signal = signal; this.closed = false; this.paused = false;
    this.allowNavigation = true;
    this.origin = scopedUrl(url).origin;
    this.diagnostic('browser_launch_started');
    let chromium;
    try { chromium = this.browserType || require('playwright').chromium; }
    catch (_) { throw agentError('PLAYWRIGHT_MISSING', 'Playwright is not installed. Run npm install, then npx playwright install chromium.'); }
    const missing = error => /Executable doesn't exist|distribution.*not found/i.test(error.message);
    try {
      try { this.browser = await chromium.launch({ headless: this.headless, timeout: 30000 }); }
      catch (error) {
        if (!missing(error) || process.platform !== 'win32') throw error;
        // Keep the existing isolated Edge fallback when bundled Chromium is absent.
        this.browser = await chromium.launch({ headless: this.headless, channel: 'msedge', timeout: 30000 });
      }
    } catch (error) {
      if (missing(error)) throw agentError('BROWSER_EXECUTABLE_MISSING', 'Automation browser executable is missing. Run npx playwright install chromium, or install Microsoft Edge on Windows, then retry.');
      throw agentError('BROWSER_LAUNCH_FAILED', 'Automation browser could not launch. Close stale automation windows, check OS permissions, and retry.');
    }
    this.diagnostic('browser_launch_completed', { engine: this.browser.browserType?.().name?.() || 'chromium' });
    if (signal?.aborted) { await this.close(); signal.throwIfAborted(); }
    signal?.addEventListener('abort', () => { this.close().catch(() => {}); }, { once: true });
    this.context = await this.browser.newContext({ acceptDownloads: false, serviceWorkers: 'block' });
    await this.context.route('**/*', async route => {
      const request = route.request();
      try {
        scopedUrl(request.url(), this.origin);
        if (request.isNavigationRequest() && !this.allowNavigation && !this.confirmed) throw new Error('Unexpected navigation requires explicit approval');
        if (request.isNavigationRequest() && ++this.navigationCount > 20) throw new Error('Navigation limit reached');
        if ((!['GET', 'HEAD', 'OPTIONS'].includes(request.method()) || ['xhr', 'fetch'].includes(request.resourceType())) && !this.confirmed) throw new Error('This request may send data. Explicit approval is required.');
        await route.continue();
      } catch (e) { this.blocked = e.message; await route.abort(); }
    });
    this.context.on('page', page => { if (this.page && page !== this.page) page.close().catch(() => {}); });
    this.page = await this.context.newPage();
    this.page.setDefaultTimeout(6000); this.page.setDefaultNavigationTimeout(15000);
    this.page.on('dialog', dialog => dialog.dismiss().catch(() => {}));
    await this.navigate(url);
  }
  async navigate(url) {
    const target = scopedUrl(url, this.origin);
    this.diagnostic('navigation_started');
    try {
      const response = await this.page.goto(target.href, { waitUntil: 'domcontentloaded' });
      this.signal?.throwIfAborted();
      scopedUrl(this.page.url(), this.origin);
      if (response && response.status() >= 400) throw agentError('NAVIGATION_HTTP_ERROR', `Website returned HTTP ${response.status()}. Check the destination and website access before retrying.`);
      this.diagnostic('navigation_completed', { verified: true, httpStatus: response?.status() || null });
    } catch (error) {
      if (this.signal?.aborted || error.diagnosticReason) throw error;
      if (error.name === 'TimeoutError') throw agentError('NAVIGATION_TIMEOUT', 'Website navigation timed out after 15 seconds. Check connectivity and the destination, then retry.');
      throw agentError('NAVIGATION_FAILED', 'Website navigation failed. Check the URL, network connection and approved origin; redirects to a different origin are blocked.');
    } finally { this.allowNavigation = false; }
  }
  locator(args) { return args.role ? this.page.getByRole(args.role, { name: args.label, exact: true }) : this.page.getByLabel(args.label, { exact: true }); }
  async movePointer(locator, caption) {
    let point = { x: 100, y: 100 };
    if (locator) {
      point = await locator.evaluate(e => { e.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    }
    const from = this.pointer || { x: 20, y: 20 };
    for (let step = 1; step <= 12; step++) {
      while (this.paused && !this.closed) await new Promise(resolve => setTimeout(resolve, 30));
      this.signal?.throwIfAborted(); if (this.closed) throw new Error('Pointer movement stopped');
      const t = step / 12, ease = t * t * (3 - 2 * t);
      this.pointer = { x: from.x + (point.x - from.x) * ease, y: from.y + (point.y - from.y) * ease };
      await this.page.mouse.move(this.pointer.x, this.pointer.y);
      await this.page.evaluate(pageAction, ['cursor', { ...this.pointer, caption }]);
      await new Promise(resolve => setTimeout(resolve, 16));
    }
  }
  async click(locator) {
    await this.movePointer(locator, 'Clicking');
    await this.page.evaluate(pageAction, ['cursor', { ...this.pointer, caption: 'Clicking', click: true }]);
    try { await locator.click(); }
    finally { await this.page.evaluate(pageAction, ['cursor', { ...this.pointer, caption: 'OpenCluely' }]).catch(() => {}); }
  }
  async inspect() {
    scopedUrl(this.page.url(), this.origin);
    // Fixed application code only; the model can never supply JavaScript or selectors.
    const fields = await this.page.locator('input,textarea,select,[contenteditable="true"]').evaluateAll(elements => elements.filter(e => e.getClientRects().length).slice(0, 80).map(e => ({
      label: (e.labels?.[0]?.textContent?.trim() || e.getAttribute('aria-label') || e.getAttribute('placeholder') || '').slice(0, 200),
      type: e.type || e.tagName.toLowerCase(), required: !!e.required, invalid: e.validity ? !e.validity.valid : false,
      options: e.tagName === 'SELECT' ? [...e.options].slice(0, 100).map(o => ({ label: o.label.slice(0, 200), value: o.value.slice(0, 200) })) : undefined
    })));
    const structure = (await this.page.locator('body').ariaSnapshot()).slice(0, 16000);
    const viewport = await this.page.evaluate(() => ({ x: scrollX, y: scrollY, height: innerHeight, pageHeight: document.documentElement.scrollHeight }));
    // ariaSnapshot can include entered values: redact known secrets and never inspect password values.
    return { url: this.page.url(), viewport, structure: structure.replace(/(password|passcode|secret|api.key)[^\n]*/gi, '$1 [redacted]'), fields,
      validationErrors: await this.page.locator('[role="alert"]').evaluateAll(elements => elements.slice(0, 20).map(e => e.textContent.slice(0, 300))), blocked: this.blocked || '' };
  }
  async execute(action, confirmed = false) {
    if (needsApproval(action, 'auto', 'browser') && !confirmed) throw new Error('Explicit approval required for this action');
    this.confirmed = confirmed; this.allowNavigation = action.name === 'open_url'; this.blocked = '';
    const a = action.args; const p = this.page;
    try {
      scopedUrl(p.url(), this.origin);
      switch (action.name) {
        case 'open_url': await this.navigate(a.url); break;
        case 'compose_text':
        case 'fill_field': {
          const locator = this.locator(a);
          const info = await locator.evaluate(e => ({ type: e.isContentEditable ? 'textarea' : e.type, name: `${e.name} ${e.id} ${e.autocomplete} ${e.getAttribute('aria-label')}` }));
          if (['password', 'file', 'hidden'].includes(info.type) || sensitive(info.name)) throw new Error('Protected field: enter this information manually');
          if (info.type !== 'textarea' && /[\r\n]/.test(a.value)) throw new Error('Multiline text requires a textarea');
          await this.click(locator);
          await this.page.evaluate(pageAction, ['cursor', { ...this.pointer, caption: 'Typing' }]);
          await locator.fill('');
          for (const character of a.value) {
            while (this.paused && !this.closed) await new Promise(resolve => setTimeout(resolve, 30));
            this.signal?.throwIfAborted(); if (this.closed) throw new Error('Typing stopped');
            if (!(await locator.evaluate(e => document.activeElement === e))) throw new Error('Field focus changed during typing');
            await p.keyboard.insertText(character);
            await new Promise(resolve => setTimeout(resolve, this.typingDelay));
          }
          break;
        }
        case 'click_element': await this.click(this.locator(a)); break;
        case 'select_option': await this.movePointer(this.locator(a), 'Selecting'); await this.locator(a).selectOption(a.value); break;
        case 'toggle_checkbox': await this.movePointer(this.locator(a), 'Clicking'); await this.locator(a).setChecked(a.checked); break;
        case 'scroll': await this.movePointer(null, 'Scrolling'); await p.mouse.wheel(0, a.delta); await new Promise(resolve => setTimeout(resolve, 200)); break;
        case 'press_key': await p.keyboard.press(a.key); break;
        case 'wait_for_element': await this.locator(a).waitFor({ state: 'visible' }); break;
        case 'inspect_page': break;
        default: throw new Error('This action is available only for a selected desktop window');
      }
      if (this.blocked) throw new Error(this.blocked);
      return await this.inspect();
    } finally { this.confirmed = false; this.allowNavigation = false; }
  }
  async screenshot() { return (await this.page.screenshot({ type: 'png' })).toString('base64'); }
  pause() { this.paused = true; }
  resume() { this.paused = false; }
  async close() { this.closed = true; await this.browser?.close(); }
}
module.exports = AutomationBrowser;
