const { toolsForTarget, validateAction, needsApproval, scopedUrl, navigationRequest, agentError } = require('./automation-policy');
const { randomUUID } = require('crypto');
const Browser = require('./automation-browser');
const Desktop = require('./automation-desktop');
const terminal = new Set(['idle', 'completed', 'stopped', 'blocked']);
class AutomationService {
  constructor({ planner, knowledge, emit = () => {}, diagnostic = () => {}, capture, displays, browserFactory, desktopFactory, extensionFactory, limits = {} }) {
    Object.assign(this, { planner, knowledge, emit, diagnostic, capture, displays });
    this.browserFactory = browserFactory || (options => new Browser({ typingDelay: options.typingDelay || 65, diagnostic: options.diagnostic }));
    this.desktopFactory = desktopFactory || (() => new Desktop({ capture, displays }));
    this.extensionFactory = extensionFactory;
    this.limits = { actions: 600, timeout: 1800000, failures: 3, tokens: 2000000, screenshots: 600, ...limits };
    this.state = 'idle'; this.log = []; this.fields = []; this.missing = []; this.runId = 0;
  }
  status() { return { state: this.state, mode: this.options?.mode || 'assist', target: this.options?.target || '', permission: !terminal.has(this.state) && this.options?.mode !== 'assist', planned: this.action ? { name: this.action.name, label: this.action.args.label || '' } : null,
    taskId: this.taskId || null, phase: this.phase || 'idle', error: this.error || null, navigatedUrl: this.navigatedUrl || null,
    targetLabel: ['browser', 'extension'].includes(this.options?.target) ? this.options.url : this.adapter?.current?.title || this.options?.sourceId || '',
    approval: this.state === 'awaiting_approval' ? { name: this.action.name, args: this.action.args } : null,
    autoApprove: this.options?.mode === 'auto' && this.options?.autoApprove === true,
    durationMinutes: this.options?.durationMinutes || 30, remainingSeconds: this.deadline ? Math.max(0, Math.ceil((this.deadline - Date.now()) / 1000)) : null,
    log: this.log, fields: this.fields, missing: this.missing, summary: this.summary || '', actions: this.actions || 0, tokens: this.tokens || 0, image: this.image || null };
  }
  publish(message) { if (message) this.log = [...this.log.slice(-79), message]; this.emit(this.status()); }
  trace(event, details = {}) {
    this.phase = event;
    this.diagnostic(event, { taskId: this.taskId, mode: this.options?.mode, target: this.options?.target, ...details });
  }
  fail(error) {
    const phase = this.phase;
    this.state = 'blocked'; this.action = null;
    this.summary = String(error.message || 'Task failed').slice(0, 600);
    this.error = { code: error.code || 'TASK_FAILED', phase, reason: this.summary };
    clearTimeout(this.timer);
    // Raw provider/Playwright errors can include URLs or field content: never log them.
    this.trace('task_failed', { phase, code: this.error.code, reason: error.diagnosticReason || 'Check the overlay error, task options, browser installation and AI provider settings.' });
    this.publish(this.summary);
  }
  async start(options) {
    if (!terminal.has(this.state)) throw new Error('Stop the current task first');
    this.taskId = randomUUID(); this.error = null; this.navigatedUrl = null;
    this.trace('task_received', { mode: ['assist', 'guided', 'auto'].includes(options?.mode) ? options.mode : 'invalid', target: ['browser', 'desktop', 'extension'].includes(options?.target) ? options.target : 'invalid', hasUrl: !!options?.url });
    try {
    if (!options || Object.keys(options).some(k => !['instruction', 'mode', 'target', 'url', 'sourceId', 'profileId', 'typingDelay', 'allowedWindowIds', 'durationMinutes', 'autoApprove'].includes(k)) || typeof options.instruction !== 'string' || options.instruction.length > 4000 || !['assist', 'guided', 'auto'].includes(options.mode) || !['browser', 'desktop', 'extension'].includes(options.target)) throw new Error('Invalid task options');
    if (options.autoApprove !== undefined && typeof options.autoApprove !== 'boolean') throw new Error('Auto approve must be on or off');
    if (options.durationMinutes !== undefined && (!Number.isInteger(options.durationMinutes) || options.durationMinutes < 1 || options.durationMinutes > 30)) throw new Error('Task duration must be between 1 and 30 minutes');
    const navigation = navigationRequest(options.instruction, options.url);
    if (['browser', 'extension'].includes(options.target)) {
      if (!navigation.url) throw agentError('TASK_URL_REQUIRED', 'Enter the website URL, or select Existing browser tab (extension) and connect the tab from the extension popup.');
      options = { ...options, instruction: navigation.instruction, url: scopedUrl(navigation.url).href };
    }
    if (!options.instruction.trim()) throw new Error('Enter a task instruction or a valid website URL');
    this.navigationOnly = options.target !== 'desktop' && navigation.navigationOnly;
    if (options.typingDelay !== undefined && (!Number.isInteger(options.typingDelay) || options.typingDelay < 10 || options.typingDelay > 250)) throw new Error('Typing delay must be between 10 and 250 ms');
    if (options.allowedWindowIds !== undefined && (!Array.isArray(options.allowedWindowIds) || options.allowedWindowIds.length > 20 || options.allowedWindowIds.some(id => typeof id !== 'string' || !/^window:\d+:\d+$/.test(id)))) throw new Error('Invalid approved window list');
    if (['browser', 'extension'].includes(options.target)) scopedUrl(options.url);
    else if (typeof options.sourceId !== 'string' || !/^window:\d+:\d+$/.test(options.sourceId)) throw new Error('Select an application window');
    const sources = this.knowledge.list();
    if (options.profileId && !sources.some(s => s.id === options.profileId && s.enabled)) throw new Error('Select an enabled knowledge profile');
    this.options = { ...options }; this.state = 'starting'; const startupId = ++this.runId;
    this.publish('Starting task');
    await this.running;
    await this.adapter?.close();
    if (startupId !== this.runId) return this.status();
    this.options = { ...options }; this.log = []; this.fields = []; this.missing = []; this.summary = ''; this.action = null; this.image = null;
    this.actions = 0; this.tokens = 0; this.screenshots = 0; this.failures = 0; this.history = [];
    this.stalledScrolls = 0;
    this.reference = options.profileId ? this.knowledge.read(options.profileId)?.text.slice(0, 16000) || '' : '';
    this.reference = this.reference.split('\n').filter(line => !/password|passcode|api.?key|private key|credit card|authentication code|verification code/i.test(line)).join('\n');
    this.abort = new AbortController(); const id = ++this.runId;
    this.state = 'running'; this.publish('Task started with explicit user scope.');
    const timeout = Math.min(this.limits.timeout, (options.durationMinutes || 30) * 60000);
    this.deadline = Date.now() + timeout;
    this.timer = setTimeout(() => this.stop('Execution timeout reached'), timeout);
    this.running = this.run(id); return this.status();
    } catch (error) { this.fail(error); throw error; }
  }
  async gate() {
    while (['paused', 'awaiting_approval'].includes(this.state)) await new Promise(resolve => { this.wake = resolve; });
    this.abort.signal.throwIfAborted();
  }
  pause() {
    if (this.state === 'running') { this.state = 'paused'; this.adapter?.pause?.(); this.publish('Paused; paced typing pauses between characters.'); }
    return this.status();
  }
  resume() { if (this.state === 'paused') { this.state = 'running'; this.adapter?.resume?.(); this.wake?.(); this.publish('Resumed'); } return this.status(); }
  approve(approved) {
    if (this.state !== 'awaiting_approval' || typeof approved !== 'boolean') throw new Error('No action awaiting approval');
    if (!approved) { this.stop('Action declined'); return this.status(); }
    this.approved = true; this.state = 'running'; this.wake?.(); this.publish('User approved the displayed action'); return this.status();
  }
  setAutoApprove(enabled) {
    if (typeof enabled !== 'boolean') throw new Error('Auto approve must be on or off');
    if (this.options?.mode !== 'auto') throw new Error('Auto approve is available in Auto mode');
    this.options.autoApprove = enabled;
    if (enabled && this.state === 'awaiting_approval') return this.approve(true);
    this.publish(enabled ? 'Auto approve enabled for this task' : 'Auto approve disabled; subsequent input actions require approval');
    return this.status();
  }
  stop(reason = 'Stopped by user') {
    ++this.runId; clearTimeout(this.timer); this.abort?.abort(); this.state = 'stopped'; this.action = null; this.image = null;
    this.summary = reason; this.wake?.(); this.adapter?.close().catch(() => {});
    this.trace('task_failed', { code: /timeout/i.test(reason) ? 'TASK_TIMEOUT' : 'TASK_CANCELLED', reason: /timeout/i.test(reason) ? 'Task execution timeout reached; reduce the task scope and retry.' : 'Task cancelled; no further actions will run.' });
    this.publish(reason); return this.status();
  }
  async screenshot() {
    if (++this.screenshots > this.limits.screenshots) throw new Error('Screenshot limit reached');
    this.image = await this.adapter.screenshot(); this.publish(); return this.image;
  }
  async run(id) {
    try {
      let state;
      const navigation = this.options.target !== 'desktop' ? validateAction({ name: 'open_url', args: { url: this.options.url } }) : null;
      if (this.navigationOnly && this.options.mode === 'assist') {
        this.summary = 'Assist mode cannot navigate. Select Guided or Auto and start again to open this URL.';
        this.state = 'completed'; clearTimeout(this.timer); this.trace('task_completed', { outcome: 'assist_only', navigated: false }); this.publish(this.summary); return;
      }
      if (this.options.mode === 'assist') state = { target: this.options.target, url: this.options.url, note: 'Assist mode: no browser launch or desktop control. Explain the proposed approach then stop_task.' };
      else {
        if (navigation) { this.action = navigation; this.trace('tool_call_generated', { name: 'open_url', source: 'user_url' }); this.publish('Opening the requested website'); }
        this.adapter = this.options.target === 'extension' ? this.extensionFactory?.(this.options) : this.options.target === 'browser' ? this.browserFactory({ ...this.options, diagnostic: (event, details) => { if (id === this.runId) this.trace(event, details); } }) : this.desktopFactory(this.options);
        if (!this.adapter) throw new Error('Browser extension is not configured');
        await this.adapter.start(this.options.target === 'desktop' ? this.options.sourceId : this.options.url, this.abort.signal, this.options);
        if (id !== this.runId) { await this.adapter.close(); return; }
        if (this.options.target === 'desktop' && this.options.mode === 'auto' && this.options.autoApprove === true) await this.adapter.focus?.();
        state = await this.adapter.inspect();
        if (id !== this.runId) return;
        if (navigation) {
          if (this.options.target === 'extension' && state.url !== this.options.url) {
            scopedUrl(this.options.url, scopedUrl(state.url).origin);
            if (!(this.options.mode === 'auto' && this.options.autoApprove === true)) {
              this.state = 'awaiting_approval'; this.publish('Approve navigation in the selected browser tab'); await this.gate();
            }
            this.trace('navigation_started'); state = await this.adapter.execute(navigation, true);
            if (id !== this.runId) return;
          }
          scopedUrl(state.url, scopedUrl(this.options.url).origin);
          this.navigatedUrl = state.url; this.actions++; this.action = null;
          if (this.options.target === 'extension') this.trace('navigation_completed', { verified: true });
          if (this.navigationOnly) {
            if (this.options.target === 'extension') await this.adapter.close();
            if (id !== this.runId) return;
            this.summary = 'Website opened and navigation verified.'; this.state = 'completed'; clearTimeout(this.timer);
            this.trace('task_completed', { outcome: 'navigation', navigated: true }); this.publish(this.summary); return;
          }
        }
      }
      while (id === this.runId) {
        await this.gate();
        if (this.actions >= this.limits.actions || this.tokens >= this.limits.tokens) throw new Error('Task action or AI token limit reached');
        let image;
        if (this.options.target === 'desktop' && this.options.mode !== 'assist') image = await this.screenshot();
        this.trace('planning_started'); this.publish('Planning the next action');
        let plan;
        try {
          plan = await this.planner({ instruction: this.options.instruction, mode: this.options.mode, autoApprove: this.options.mode === 'auto' && this.options.autoApprove === true, target: this.options.target, state, knowledge: this.reference, history: this.history.slice(-12), fields: this.fields, tools: toolsForTarget(this.options.target), image, signal: this.abort.signal,
            onProgress: message => { if (id === this.runId) this.publish(message); } });
        } catch (error) { if (id === this.runId) this.trace('planning_completed', { ok: false }); throw error; }
        if (id !== this.runId) return;
        this.trace('planning_completed', { ok: !!plan?.action });
        if (!plan?.action) throw agentError('AI_EMPTY_RESPONSE', 'AI planner returned no action. Check the configured provider and select a model supporting tool calls.');
        this.tokens += plan.tokens || 0;
        if (this.tokens > this.limits.tokens) throw new Error('AI token limit reached');
        this.action = validateAction(plan.action); await this.gate();
        this.trace('tool_call_generated', { name: this.action.name, source: 'planner' });
        const action = this.action;
        if (action.name === 'stop_task') {
          this.summary = action.args.summary; this.missing = [...new Set([...this.missing, ...action.args.missing])];
          if (this.options.target !== 'browser') await this.adapter?.close();
          if (id !== this.runId) return;
          this.state = 'completed'; this.action = null; clearTimeout(this.timer); this.trace('task_completed', { outcome: 'planned_task' }); this.publish('Task complete. Review all fields before submission.'); return;
        }
        if (this.options.mode === 'assist') {
          this.summary = `Proposed action: ${action.name}. ${action.args.label || ''} Assist mode cannot execute actions.`;
          this.state = 'completed'; this.action = null; clearTimeout(this.timer); this.trace('task_completed', { outcome: 'assist_only', navigated: false }); this.publish(this.summary); return;
        }
        let unsupported = false;
        if (action.name === 'compose_text' && !/\b(write|draft|compose|reply|respond|explain|describe|type|answer|letter|message|note|document)\b/i.test(this.options.instruction)) throw new Error('Original prose requires a user-requested writing task');
        if (action.name === 'fill_field') {
          const source = action.args.sourceQuote === 'USER' ? this.options.instruction : this.reference;
          const quote = action.args.sourceQuote === 'USER' ? action.args.value : action.args.sourceQuote;
          const normalize = text => text.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
          unsupported = !normalize(source).includes(normalize(quote)) || !normalize(quote).includes(normalize(action.args.value));
          const narrative = /cover letter|motivation|why.*(?:role|company|apply|interest)|personal statement|written response/i.test(action.args.label);
          if (unsupported && (this.options.mode === 'auto' || !narrative)) {
            this.missing.push(action.args.label);
            this.history.push({ action: action.name, label: action.args.label, error: 'Unsupported by source. Leave empty and continue.' });
            this.actions++; this.publish('Unsupported field left empty'); continue;
          }
        }
        this.approved = this.options.mode === 'auto' && this.options.autoApprove === true;
        if (needsApproval(action, this.options.mode, this.options.target, this.options.autoApprove) || unsupported) {
          this.approved = false;
          this.state = 'awaiting_approval'; this.publish(unsupported ? 'Review generated text: it is not an exact source fact.' : 'Review the planned action and field summary. This action can send data or change the selected application.');
          await this.gate();
          if (this.options.target === 'desktop' && !['switch_window', 'open_application'].includes(action.name)) {
            this.publish('Focus the selected application within 3 seconds.');
            await new Promise(resolve => { const timer = setTimeout(resolve, 3000); this.abort.signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true }); });
            await this.gate();
          }
        }
        this.actions++; this.publish(`Executing ${action.name}`);
        try {
          if (['browser', 'extension'].includes(this.options.target) && !['inspect_page', 'capture_screen'].includes(action.name)) {
            const fresh = await this.adapter.inspect();
            if (JSON.stringify(fresh) !== JSON.stringify(state)) {
              let unchangedTarget = false;
              if (this.options.target === 'extension' && fresh.url === state.url) {
                const matching = snapshot => (snapshot.fields || []).filter(f => f.label === action.args.label && (!action.args.role || f.role === action.args.role) && (!action.args.ref || f.ref === action.args.ref));
                const old = matching(state), current = matching(fresh);
                unchangedTarget = ['scroll', 'open_url'].includes(action.name) || (action.name === 'press_key' && fresh.focusedRef && fresh.focusedRef === state.focusedRef) || (old.length === 1 && current.length === 1 && JSON.stringify(old[0]) === JSON.stringify(current[0]));
              }
              if (!unchangedTarget) throw new Error('Page changed after planning. Reinspect and choose a new action.');
              state = fresh;
            }
          }
          const before = state;
          state = action.name === 'capture_screen' ? (await this.screenshot(), await this.adapter.inspect()) : await this.adapter.execute(action, this.approved);
          if (id !== this.runId) return;
          if (action.name === 'scroll') {
            const noProgress = before.viewport && state.viewport ? JSON.stringify(before.viewport) === JSON.stringify(state.viewport) : JSON.stringify(before) === JSON.stringify(state);
            this.stalledScrolls = noProgress ? this.stalledScrolls + 1 : 0;
            if (this.stalledScrolls >= 3) throw agentError('TASK_NO_PROGRESS', 'Scrolling is no longer changing the page. Stop and review the selected tab or refine the product search.');
          } else if (!['inspect_page', 'capture_screen', 'wait_for_element'].includes(action.name)) this.stalledScrolls = 0;
          if (['fill_field', 'compose_text', 'select_option', 'toggle_checkbox'].includes(action.name)) {
            this.fields = this.fields.filter(f => f.label !== action.args.label);
            this.fields.push({ label: action.args.label, value: action.args.value ?? action.args.checked });
          }
          this.failures = 0; this.history.push({ action: action.name, label: action.args.label, ref: action.args.ref, delta: action.args.delta, result: action.name === 'scroll' && this.stalledScrolls ? 'No scrolling progress. Use search or a different visible control.' : 'Executed; inspect resulting state' });
        } catch (error) {
          if (id !== this.runId) return;
          if (error.code === 'TASK_NO_PROGRESS') throw error;
          this.history.push({ action: action.name, error: String(error.message).slice(0, 400) });
          this.publish(`Action failed: ${action.name}. Fresh inspection required.`);
          if (++this.failures >= this.limits.failures) throw new Error('Consecutive failure limit reached');
          // Failed input never proceeds to another blind action. Reinspect first.
          state = await this.adapter.inspect();
        }
        this.action = null; this.publish();
      }
    } catch (error) {
      if (id !== this.runId) return;
      if (this.options.target !== 'browser') await this.adapter?.close();
      if (id === this.runId) this.fail(error);
    }
  }
}
module.exports = AutomationService;
