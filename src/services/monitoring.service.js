const { LiveContext, detectQuestion, normalize, frameChanged } = require('../core/live-context');

class MonitoringService {
  constructor({ capture, ocr, answer, emit, debug = () => {} }) {
    Object.assign(this, { capture, ocr, answer, emit, debug });
    this.context = new LiveContext();
    this.options = { interval: 2000, cooldown: 8000, mode: 'suggest', responseMode: 'quick', exclusions: '', pauseOnLock: true, visualFallback: false };
    this.state = 'stopped'; this.audio = false; this.audioManaged = false;
    this.seen = new Map(); this.generation = 0; this.lastRequest = 0;
  }
  status(error) {
    const value = { state: this.state, audio: this.audio, sourceId: this.sourceId, options: this.options,
      question: this.pending?.question || '', history: this.context.answers.slice(-10), error: error || '', ocr: this.ocrStatus || '' };
    this.emit('status', value); return value;
  }
  configure(options = {}) {
    for (const [key, min, max] of [['interval', 1000, 60000], ['cooldown', 1000, 120000]]) {
      if (Number.isFinite(Number(options[key]))) this.options[key] = Math.max(min, Math.min(max, Number(options[key])));
    }
    if (['auto', 'suggest'].includes(options.mode)) this.options.mode = options.mode;
    if (['quick', 'detailed', 'interview'].includes(options.responseMode)) this.options.responseMode = options.responseMode;
    if (typeof options.exclusions === 'string') this.options.exclusions = options.exclusions.slice(0, 1000);
    for (const key of ['pauseOnLock', 'visualFallback']) if (typeof options[key] === 'boolean') this.options[key] = options[key];
    this.cancel(true);
    this.previous = null; this.ocrRetryAt = 0;
    if (this.pending) this.queue(this.pending.question, this.pending.origin);
    return this.status();
  }
  cancel(cancelOcr = false) { this.generation++; clearTimeout(this.answerTimer); this.answerTimer = null; this.controller?.abort(); if (cancelOcr) this.ocr.cancel?.(); }
  retryOcr() { this.previous = null; this.ocrRetryAt = 0; this.ocrFailures = 0; this.ocrStatus = this.state === 'running' ? 'Retrying local OCR…' : ''; return this.status(); }
  dismiss() {
    if (this.pending) this.seen.set(this.pending.key, Date.now());
    this.cancel(); this.pending = null; this.stableQuestion = null; return this.status();
  }
  async start(sourceId) {
    const sources = await this.capture.listSources();
    if (!sources.some(s => s.id === sourceId)) throw new Error('Select an available screen or application window.');
    this.stop(); this.sourceId = sourceId; this.state = 'running'; this.previous = null; this.stableQuestion = null;
    this.status(); this.tick(); return this.status();
  }
  pause(reason = 'paused') {
    this.state = reason; clearTimeout(this.timer); this.cancel(true); this.context.screen = null; this.ocrStatus = '';
    this.ocrRetryAt = 0; this.ocrFailures = 0;
    this.previous = null; this.pending = null; this.stableQuestion = null; return this.status();
  }
  resume() { if (!this.sourceId) throw new Error('Select a source first.'); return this.start(this.sourceId); }
  stop() { this.pause('stopped'); this.sourceId = null; return this.status(); }
  clear() { this.cancel(true); this.context.clear(); this.seen.clear(); this.pending = null; this.previous = null; this.stableQuestion = null; this.ocrStatus = ''; this.ocrRetryAt = 0; return this.status(); }
  async tick() {
    if (this.state !== 'running') return;
    if (this.capturing) { this.timer = setTimeout(() => this.tick(), this.options.interval); return; }
    this.capturing = true;
    const generation = this.generation;
    try {
      const frame = await this.capture.captureSource(this.sourceId);
      if (this.state !== 'running' || generation !== this.generation) return;
      const exclusions = this.options.exclusions.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
      if (exclusions.some(s => frame.name.toLowerCase().includes(s))) { this.pause('excluded'); return; }
      if (frameChanged(this.previous, frame.sample) || (this.ocrRetryAt && Date.now() >= this.ocrRetryAt)) {
        this.previous = frame.sample;
        this.context.screen = null;
        // Invalidate screen-derived requests immediately when the visible context changes.
        if (this.pending?.origin === 'screen') { this.cancel(); this.pending = null; }
        const epoch = this.generation;
        let result;
        let failure = null;
        try { result = await this.ocr.recognize(frame.imageBuffer); }
        catch (error) { failure = error; result = { text: '' }; }
        if (this.state !== 'running' || epoch !== this.generation || failure?.name === 'AbortError') {
          // An interrupted scan is not a valid cached result for this frame.
          this.previous = null; return;
        }
        if (failure) {
          this.ocrFailures = (this.ocrFailures || 0) + 1;
          const retryMs = Math.min(30000, 5000 * 2 ** Math.min(this.ocrFailures - 1, 3));
          this.ocrRetryAt = Date.now() + retryMs;
          this.ocrStatus = `OCR unavailable: ${failure.message} Retrying in ${retryMs / 1000}s.`;
        } else {
          this.ocrFailures = 0; this.ocrRetryAt = 0;
          this.ocrStatus = result.text?.trim() ? 'Local OCR' : 'Local OCR: no readable text in the selected source.';
        }
        this.context.setScreen({ ...frame, sample: undefined, text: result.text || '' });
        const question = detectQuestion(result.text) || (!result.text && this.options.visualFallback ? 'Explain the question or task in the current image. State if no question is visible.' : null);
        this.stableQuestion = question;
      } else {
        // Require two observations of stable content, suppressing scroll/typing transients.
        if (this.context.screen) this.context.screen.at = Date.now();
        if (this.stableQuestion) this.queue(this.stableQuestion, 'screen');
      }
      this.status();
    } catch (error) {
      this.pause('suspended'); this.status(error.message);
    } finally {
      this.capturing = false;
      this.debug({ state: this.state, memory: process.memoryUsage().rss, cpu: process.cpuUsage() });
      if (this.state === 'running') this.timer = setTimeout(() => this.tick(), this.options.interval);
    }
  }
  setAudio(enabled) {
    this.audioManaged = true; this.audio = !!enabled;
    if (!enabled) { clearTimeout(this.transcriptTimer); this.transcriptBuffer = ''; this.cancel(); this.pending = null; this.context.transcripts = []; }
    return this.status();
  }
  transcript(text, final = true) {
    if (!this.audio || !final || !String(text || '').trim()) return;
    this.transcriptBuffer = `${this.transcriptBuffer || ''} ${text}`.trim().slice(-4000);
    clearTimeout(this.transcriptTimer);
    this.transcriptTimer = setTimeout(() => {
      const utterance = this.transcriptBuffer; this.transcriptBuffer = '';
      this.context.addTranscript(utterance);
      const question = detectQuestion(utterance, this.context.answers.length > 0);
      if (question) this.queue(question, 'audio');
    }, 900);
  }
  queue(question, origin) {
    if (origin === 'screen' && this.state !== 'running' || origin === 'audio' && !this.audio) return;
    const key = normalize(question);
    if (this.seen.has(key)) return;
    if (this.pending?.key !== key) { this.cancel(); this.pending = { key, question, origin }; }
    this.status();
    if (this.options.mode === 'auto' && !this.answerTimer && !this.controller) {
      this.answerTimer = setTimeout(() => { this.answerTimer = null; this.approve().catch(() => {}); }, Math.max(800, this.options.cooldown - (Date.now() - this.lastRequest)));
    }
  }
  async approve() {
    if (!this.pending || this.controller) return;
    const pending = this.pending;
    if (pending.origin === 'screen' && this.state !== 'running' || pending.origin === 'audio' && !this.audio) return;
    const epoch = this.generation;
    const controller = new AbortController(); this.controller = controller; this.lastRequest = Date.now();
    this.emit('answer-start', { question: pending.question });
    try {
      const screen = this.state === 'running' ? this.context.screen : null;
      const image = screen && Date.now() - screen.at < 30000 && (!screen.text || this.options.visualFallback) ? screen.imageBuffer : null;
      const answer = await this.answer({ question: pending.question, context: this.context.prompt(pending.question), image,
        mode: this.options.responseMode, signal: controller.signal,
        onDelta: delta => { if (epoch === this.generation) this.emit('answer-chunk', { delta }); } });
      if (epoch !== this.generation) return;
      this.seen.set(pending.key, Date.now());
      while (this.seen.size > 150) this.seen.delete(this.seen.keys().next().value);
      this.context.answers.push({ question: pending.question, answer: answer.slice(0, 16000) });
      this.context.answers = this.context.answers.slice(-10); this.pending = null;
      this.emit('answer-end', { answer }); this.status();
    } catch (error) {
      if (!controller.signal.aborted && epoch === this.generation) { this.options.mode = 'suggest'; this.status(error.message); }
    } finally {
      if (this.controller === controller) this.controller = null;
      if (this.pending && this.options.mode === 'auto') this.queue(this.pending.question, this.pending.origin);
    }
  }
  shutdown() { this.stop(); this.setAudio(false); this.context.clear(); }
}
module.exports = MonitoringService;
